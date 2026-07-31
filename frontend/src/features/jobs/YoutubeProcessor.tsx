import { type FormEvent, useCallback, useEffect, useState } from "react";
import { ApiError, createYoutubeJob } from "../../api/client";
import { apiUrl, config } from "../../config";
import { Icon } from "../../components/Icon";
import { useAuthGate } from "../../components/AuthGate";
import type { JobResponse } from "../../types";
import { useJobPoller } from "./useJobPoller";
import { isYoutubeUrl } from "./validation";

const sessionKey = "musicai.youtubeJob.v2";

type YoutubePhase = "form" | "processing" | "completed" | "failed";

export function YoutubeProcessor() {
  const { authState, requestAccess } = useAuthGate();
  const [phase, setPhase] = useState<YoutubePhase>("form");
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [reconnecting, setReconnecting] = useState(false);

  const clear = useCallback(() => {
    try {
      sessionStorage.removeItem(sessionKey);
    } catch {
      // No action is needed.
    }
  }, []);

  const reset = () => {
    clear();
    setJobId(null);
    setProgress(0);
    setMessage("");
    setError("");
    setReconnecting(false);
    setPhase("form");
  };

  const applyJob = useCallback(
    (job: JobResponse): boolean => {
      const measured = Number(job.progress_percent);
      if (Number.isFinite(measured)) {
        setProgress((current) => Math.max(current, Math.min(100, measured)));
      }
      setReconnecting(false);
      if (job.status === "completed") {
        setProgress(100);
        setDownloadUrl(
          apiUrl(job.download_url ?? config.endpoints.downloadJob(job.job_id)),
        );
        setElapsed(job.elapsed_seconds ?? null);
        setPhase("completed");
        return true;
      }
      if (job.status === "failed") {
        clear();
        setError(
          job.error?.message ??
            job.message ??
            "Não foi possível concluir esse processamento.",
        );
        setPhase("failed");
        return true;
      }
      setMessage(job.message ?? friendlyFallback(progress));
      setPhase("processing");
      return false;
    },
    [clear, progress],
  );

  useJobPoller({
    jobId,
    enabled: authState === "authenticated" && phase === "processing",
    onJob: applyJob,
    onTemporaryFailure: (_error, failures) => {
      if (failures >= 1) setReconnecting(true);
      setMessage(
        "A conexão oscilou, mas o trabalho segue no servidor. Vamos consultar novamente.",
      );
    },
    onMissing: () => {
      clear();
      setError("Esse processamento não está mais disponível no servidor.");
      setPhase("failed");
    },
  });

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(sessionKey) ?? "null") as {
        jobId?: string;
      } | null;
      if (saved?.jobId) {
        setJobId(String(saved.jobId));
        setMessage("Consultando o andamento salvo neste navegador.");
        setPhase("processing");
      }
    } catch {
      clear();
    }
  }, [clear]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!requestAccess("youtube", "index.html#workspace")) return;
    const form = new FormData(event.currentTarget);
    const sourceUrl = String(form.get("youtube_url") ?? "").trim();
    if (!isYoutubeUrl(sourceUrl)) {
      setError("Informe uma URL válida de um vídeo do YouTube.");
      return;
    }
    setError("");
    setProgress(1);
    setMessage("Validando o link e reservando seu lugar na fila.");
    setPhase("processing");
    try {
      const job = await createYoutubeJob(sourceUrl);
      setJobId(job.job_id);
      try {
        sessionStorage.setItem(
          sessionKey,
          JSON.stringify({ jobId: job.job_id, savedAt: new Date().toISOString() }),
        );
      } catch {
        // Polling remains active in this tab.
      }
    } catch (submitError) {
      if (submitError instanceof ApiError && submitError.status === 401) {
        setPhase("form");
        requestAccess("youtube", "index.html#workspace");
      } else {
        setError(
          submitError instanceof ApiError
            ? submitError.message
            : "Não foi possível enviar o link.",
        );
        setPhase("failed");
      }
    }
  };

  if (phase === "form") {
    return (
      <section className="youtube-source" aria-labelledby="youtube-source-title">
        <div className="youtube-source__heading">
          <span className="youtube-source__icon"><Icon name="youtube" /></span>
          <h3 id="youtube-source-title">Cole o link de um vídeo</h3>
          <p>Nós cuidamos do download e preparamos cada faixa para você.</p>
        </div>
        <form className="youtube-source__form" onSubmit={(event) => void submit(event)}>
          <label className="sr-only" htmlFor="youtube-url">URL do YouTube</label>
          <input
            className="youtube-source__input"
            id="youtube-url"
            name="youtube_url"
            type="url"
            inputMode="url"
            autoComplete="url"
            placeholder="https://www.youtube.com/watch?v=..."
            aria-describedby="youtube-help"
            required
            maxLength={2048}
          />
          <button className="button button--primary" type="submit"><Icon name="sparkles" /> Separar</button>
        </form>
        <small className="youtube-source__help" id="youtube-help">Um vídeo por vez · o processamento continua no servidor</small>
        {error && <div className="message-card message-card--error" role="alert">{error}</div>}
      </section>
    );
  }

  if (phase === "completed") {
    const duration = elapsed === null ? "" : ` em ${friendlyDuration(elapsed)}`;
    return (
      <div className="youtube-job" role="status">
        <span className="youtube-source__icon"><Icon name="circle-check" /></span>
        <h3>Suas faixas estão prontas</h3>
        <p>Finalizamos tudo{duration}. Agora é só baixar e explorar cada instrumento.</p>
        <Progress progress={100} />
        <a className="button button--primary" href={downloadUrl}><Icon name="download" /> Baixar ZIP</a>
        {jobId && (
          <a className="button button--secondary" href={`musics.html#library/${jobId}`}><Icon name="sliders-horizontal" /> Abrir no mixer</a>
        )}
        <button className="button button--secondary" type="button" onClick={reset}>Processar outro link</button>
      </div>
    );
  }

  if (phase === "failed") {
    return (
      <div className="youtube-job" role="alert">
        <span className="youtube-source__icon"><Icon name="circle-alert" /></span>
        <h3>Não conseguimos concluir dessa vez</h3>
        <p>{error}</p>
        {jobId && <small className="youtube-source__help">Job {jobId.slice(0, 8)}…</small>}
        <button className="button button--primary" type="button" onClick={reset}>Tentar outro link</button>
      </div>
    );
  }

  return (
    <div className="youtube-job" role="status" aria-live="polite">
      <h3>{progressTitle(progress)}</h3>
      <p>{message || friendlyFallback(progress)}</p>
      <Progress progress={progress} />
      {reconnecting && (
        <div className="youtube-job__connection"><Icon name="wifi-off" /> Reconectando automaticamente — não é preciso reenviar o link.</div>
      )}
      {jobId && <small className="youtube-source__help">Job {jobId.slice(0, 8)}…</small>}
    </div>
  );
}

function Progress({ progress }: { progress: number }) {
  const percent = Math.max(0, Math.min(100, Math.round(progress)));
  return (
    <div className="youtube-job__progress">
      <div className="youtube-job__progress-meta">
        <span className="youtube-job__stage"><i className="youtube-job__stage-dot" aria-hidden="true" />{stageLabel(percent)}</span>
        <strong>{percent}%</strong>
      </div>
      <div className="youtube-job__track" role="progressbar" aria-label="Progresso do processamento" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div className="youtube-job__bar" style={{ "--job-progress": `${percent}%` } as React.CSSProperties} />
      </div>
    </div>
  );
}

export function progressTitle(progress: number): string {
  if (progress < 5) return "Tudo pronto para começar";
  if (progress >= 92) return "Preparando seu download";
  if (progress < 30) return "Trazendo o áudio do vídeo";
  if (progress < 70) return "Descobrindo cada instrumento";
  return "Seu resultado está quase pronto";
}

export function stageLabel(progress: number): string {
  if (progress < 5) return "Na fila";
  if (progress < 30) return "Preparando o áudio";
  if (progress < 92) return "Separando as faixas";
  if (progress < 100) return "Organizando o ZIP";
  return "Concluído";
}

function friendlyFallback(progress: number): string {
  if (progress < 30) return "Buscando a melhor versão do áudio para você.";
  if (progress < 60) return "Reconhecendo os detalhes da música.";
  if (progress < 92) return "Dando forma a cada faixa separada.";
  return "Organizando tudo para o download.";
}

function friendlyDuration(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  if (rounded < 60) return `${rounded} segundos`;
  return `${Math.floor(rounded / 60)} min ${String(rounded % 60).padStart(2, "0")} s`;
}
