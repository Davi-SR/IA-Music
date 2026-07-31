import {
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ApiError, createFileJob } from "../../api/client";
import { apiUrl, config } from "../../config";
import { formatBytes, formatDuration, shortJobId } from "../../lib/format";
import type { JobResponse } from "../../types";
import { Icon } from "../../components/Icon";
import { useAuthGate } from "../../components/AuthGate";
import {
  type FilePhase,
  phaseFromStatus,
  phaseLabels,
  presentError,
  processingSteps,
  type PresentedError,
} from "./jobPresentation";
import { useJobPoller } from "./useJobPoller";
import { validateAudioFiles } from "./validation";

const sessionKey = "stemlab.activeJob.v1";

interface FileState {
  phase: FilePhase;
  file: File | null;
  fileMeta: { name: string; size: number; type: string } | null;
  validationError: string | null;
  uploadProgress: number;
  uploadedBytes: number;
  jobId: string | null;
  jobMessage: string | null;
  downloadUrl: string | null;
  elapsedSeconds: number | null;
  error: PresentedError | null;
  networkFailures: number;
}

const initialState: FileState = {
  phase: "idle",
  file: null,
  fileMeta: null,
  validationError: null,
  uploadProgress: 0,
  uploadedBytes: 0,
  jobId: null,
  jobMessage: null,
  downloadUrl: null,
  elapsedSeconds: null,
  error: null,
  networkFailures: 0,
};

export function FileProcessor() {
  const { authState, requestAccess } = useAuthGate();
  const [state, setState] = useState<FileState>(initialState);
  const [announcement, setAnnouncement] = useState("");
  const [confirming, setConfirming] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadController = useRef<AbortController | null>(null);

  const patch = useCallback(
    (next: Partial<FileState>, message?: string) => {
      setState((current) => ({ ...current, ...next }));
      if (message) setAnnouncement(message);
    },
    [],
  );

  const clearSession = useCallback(() => {
    try {
      sessionStorage.removeItem(sessionKey);
    } catch {
      // The active UI remains functional when browser storage is disabled.
    }
  }, []);

  const persist = useCallback((jobId: string, fileMeta: FileState["fileMeta"]) => {
    try {
      sessionStorage.setItem(
        sessionKey,
        JSON.stringify({ jobId, fileMeta, savedAt: new Date().toISOString() }),
      );
    } catch {
      // Polling remains active in this tab.
    }
  }, []);

  const applyJob = useCallback(
    (job: JobResponse): boolean => {
      if (job.status === "failed") {
        patch(
          {
            phase: "failed",
            jobMessage: job.message ?? null,
            error: {
              title: "A separação não foi concluída",
              message:
                job.error?.message ??
                job.message ??
                "O servidor encontrou um problema ao processar o áudio.",
              details: job.error?.code ? `Código: ${job.error.code}` : null,
              retryable: true,
            },
          },
          "O servidor informou uma falha no processamento.",
        );
        persist(job.job_id, state.fileMeta);
        return true;
      }
      if (job.status === "completed") {
        patch(
          {
            phase: "completed",
            jobMessage: job.message ?? null,
            downloadUrl:
              job.download_url ?? config.endpoints.downloadJob(job.job_id),
            elapsedSeconds: job.elapsed_seconds ?? null,
            networkFailures: 0,
          },
          "Processamento concluído. O pacote ZIP está disponível.",
        );
        persist(job.job_id, state.fileMeta);
        return true;
      }
      patch({
        phase: phaseFromStatus(job.status),
        jobMessage: job.message ?? null,
        networkFailures: 0,
      });
      return false;
    },
    [patch, persist, state.fileMeta],
  );

  useJobPoller({
    jobId: state.jobId,
    enabled:
      authState === "authenticated"
      && ["queued", "processing", "packaging", "connection_lost"].includes(
        state.phase,
      ),
    onJob: applyJob,
    onTemporaryFailure: (error, failures) =>
      patch({
        phase: failures >= 2 ? "connection_lost" : state.phase,
        networkFailures: failures,
        error: presentError(error, "status"),
      }),
    onMissing: () => {
      clearSession();
      patch({
        phase: "failed",
        jobId: null,
        error: {
          title: "Job não encontrado",
          message:
            "O servidor não reconhece mais este processamento. Inicie um novo envio.",
          details: "HTTP 404",
          retryable: false,
        },
      });
    },
  });

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(sessionKey) ?? "null") as {
        jobId?: string;
        fileMeta?: FileState["fileMeta"];
      } | null;
      if (saved?.jobId) {
        setState((current) => ({
          ...current,
          phase: "queued",
          jobId: String(saved.jobId),
          fileMeta: saved.fileMeta ?? null,
          jobMessage: "Retomando o acompanhamento do job salvo…",
        }));
        setAnnouncement("Acompanhamento do processamento restaurado.");
      }
    } catch {
      clearSession();
    }
    return () => uploadController.current?.abort();
  }, [clearSession]);

  const selectFiles = (files: FileList | File[] | null) => {
    if (!requestAccess("upload", "index.html#workspace")) return;
    const result = validateAudioFiles(files);
    if (!result.file) {
      patch({
        phase: "idle",
        file: null,
        fileMeta: null,
        validationError: result.error ?? "Arquivo inválido.",
      });
      return;
    }
    patch(
      {
        phase: "file_selected",
        file: result.file,
        fileMeta: {
          name: result.file.name,
          size: result.file.size,
          type: result.file.type,
        },
        validationError: null,
        error: null,
      },
      `Arquivo ${result.file.name} selecionado e validado.`,
    );
  };

  const startUpload = async () => {
    if (!requestAccess("upload", "index.html#workspace")) return;
    if (!state.file) {
      patch(
        { phase: "idle", validationError: "Selecione o arquivo novamente." },
        "O arquivo precisa ser selecionado novamente.",
      );
      return;
    }
    const controller = new AbortController();
    uploadController.current = controller;
    patch({
      phase: "uploading",
      uploadProgress: 0,
      uploadedBytes: 0,
      error: null,
      jobId: null,
    });
    try {
      const job = await createFileJob(state.file, {
        signal: controller.signal,
        onProgress: ({ percent, loaded }) =>
          patch({ uploadProgress: percent, uploadedBytes: loaded }),
      });
      patch({
        phase: "queued",
        jobId: job.job_id,
        jobMessage: job.message ?? null,
        uploadProgress: 100,
        networkFailures: 0,
      });
      persist(job.job_id, state.fileMeta);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        patch({ phase: "file_selected" });
        requestAccess("upload", "index.html#workspace");
      } else if (error instanceof ApiError && error.kind === "cancelled") {
        patch({ phase: "file_selected" }, "Upload cancelado.");
      } else {
        patch({ phase: "failed", error: presentError(error, "upload") });
      }
    } finally {
      uploadController.current = null;
    }
  };

  const reset = () => {
    uploadController.current?.abort();
    clearSession();
    setConfirming(false);
    setState(initialState);
    setAnnouncement("Pronto para selecionar um novo arquivo.");
  };

  const requestReset = () => {
    if (state.phase === "idle" || state.phase === "file_selected") reset();
    else setConfirming(true);
  };

  const meta = state.file
    ? { name: state.file.name, size: state.file.size, type: state.file.type }
    : state.fileMeta;

  return (
    <>
      <div
        id="status-announcer"
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {announcement}
      </div>
      <div id="app-view" className="app-view">
        {state.phase === "idle" && (
          <IdleView
            error={state.validationError}
            inputRef={fileInput}
            onFiles={selectFiles}
            onOpen={() => {
              if (requestAccess("upload", "index.html#workspace")) {
                fileInput.current?.click();
              }
            }}
          />
        )}
        {state.phase === "file_selected" && meta && (
          <SelectedView
            file={meta}
            inputRef={fileInput}
            onFiles={selectFiles}
            onRemove={() =>
              patch({
                phase: "idle",
                file: null,
                fileMeta: null,
                validationError: null,
              })
            }
            onStart={() => void startUpload()}
          />
        )}
        {state.phase === "uploading" && meta && (
          <UploadingView
            file={meta}
            percent={state.uploadProgress}
            uploaded={state.uploadedBytes}
            onCancel={() => uploadController.current?.abort()}
          />
        )}
        {["queued", "processing", "packaging"].includes(state.phase) && (
          <ProcessingView state={state} />
        )}
        {state.phase === "completed" && (
          <CompletedView state={state} fileName={meta?.name} onReset={requestReset} />
        )}
        {state.phase === "connection_lost" && (
          <ConnectionView
            state={state}
            onReset={requestReset}
            onRetry={() => patch({ phase: "queued", networkFailures: 0 })}
          />
        )}
        {state.phase === "failed" && (
          <ErrorView
            state={state}
            onReset={requestReset}
            onRetry={() =>
              state.jobId
                ? patch({ phase: "queued", networkFailures: 0 })
                : void startUpload()
            }
          />
        )}
      </div>
      {confirming && (
        <div className="react-dialog-backdrop" role="presentation">
          <div
            className="confirmation-dialog glass-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-title"
          >
            <span className="dialog-icon"><Icon name="refresh-cw" /></span>
            <h2 id="reset-title">Processar outro arquivo?</h2>
            <p>O acompanhamento do job atual será encerrado neste navegador.</p>
            <div className="dialog-actions">
              <button
                className="button button--secondary cursor-hover"
                type="button"
                onClick={() => setConfirming(false)}
              >
                Continuar aqui
              </button>
              <button
                className="button button--primary cursor-hover"
                type="button"
                onClick={reset}
              >
                Novo arquivo
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

interface FileInputProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFiles: (files: FileList | File[] | null) => void;
  id?: string;
}

function FileInput({ inputRef, onFiles, id = "audio-file" }: FileInputProps) {
  return (
    <input
      ref={inputRef}
      className="file-input"
      id={id}
      type="file"
      accept=".mp3,.wav,audio/mpeg,audio/wav,audio/x-wav"
      aria-describedby="file-help"
      onChange={(event: ChangeEvent<HTMLInputElement>) =>
        onFiles(event.target.files)
      }
    />
  );
}

function IdleView({
  error,
  inputRef,
  onFiles,
  onOpen,
}: FileInputProps & { error: string | null; onOpen: () => void }) {
  const [dragging, setDragging] = useState(false);
  const open = onOpen;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    }
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    onFiles(event.dataTransfer.files);
  };
  return (
    <>
      <div
        className={`dropzone cursor-hover${dragging ? " is-dragging" : ""}`}
        tabIndex={0}
        role="button"
        aria-label="Selecionar ou arrastar um arquivo MP3 ou WAV"
        onClick={(event) => {
          if (!(event.target as Element).closest("button")) open();
        }}
        onKeyDown={onKeyDown}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <div>
          <span className="dropzone__icon"><Icon name="upload-cloud" /></span>
          <h3>Arraste seu áudio para cá</h3>
          <p>ou escolha um arquivo no seu dispositivo</p>
          <FileInput inputRef={inputRef} onFiles={onFiles} />
          <button
            className="button button--primary cursor-hover"
            type="button"
            onClick={open}
          >
            <Icon name="folder-open" /> Selecionar arquivo
          </button>
          <small className="dropzone__meta" id="file-help">
            MP3 ou WAV · até {formatBytes(config.maxFileSizeBytes)} · 1 arquivo
            por vez
          </small>
        </div>
      </div>
      {error && (
        <div className="message-card message-card--error" role="alert">
          <Icon name="circle-alert" /><span>{error}</span>
        </div>
      )}
    </>
  );
}

function SelectedView({
  file,
  inputRef,
  onFiles,
  onRemove,
  onStart,
}: FileInputProps & {
  file: NonNullable<FileState["fileMeta"]>;
  onRemove: () => void;
  onStart: () => void;
}) {
  return (
    <div className="selected-file">
      <div className="file-card">
        <span className="file-card__icon"><Icon name="file-audio-2" /></span>
        <div className="file-card__info">
          <strong title={file.name}>{file.name}</strong>
          <span>{file.type || "áudio"} · {formatBytes(file.size)}</span>
        </div>
        <button
          className="icon-button cursor-hover"
          type="button"
          aria-label="Remover arquivo selecionado"
          onClick={onRemove}
        >
          <Icon name="trash-2" />
        </button>
      </div>
      <div className="validation-ok" role="status">
        <Icon name="circle-check" /><span>Arquivo validado e pronto para envio.</span>
      </div>
      <FileInput id="replace-audio-file" inputRef={inputRef} onFiles={onFiles} />
      <div className="button-row">
        <button
          className="button button--secondary cursor-hover"
          type="button"
          onClick={() => inputRef.current?.click()}
        >
          <Icon name="replace" /> Substituir
        </button>
        <button
          className="button button--primary cursor-hover"
          type="button"
          onClick={onStart}
        >
          <Icon name="sparkles" /> Separar instrumentos
        </button>
      </div>
    </div>
  );
}

function UploadingView({
  file,
  percent,
  uploaded,
  onCancel,
}: {
  file: NonNullable<FileState["fileMeta"]>;
  percent: number;
  uploaded: number;
  onCancel: () => void;
}) {
  return (
    <div className="upload-state">
      <div className="state-heading">
        <span className="state-icon"><Icon name="cloud-upload" /></span>
        <h3>Enviando seu áudio</h3>
        <p>Não feche esta página durante o envio. O processamento começará assim que o servidor confirmar o recebimento.</p>
      </div>
      <div className="progress-card">
        <div className="progress-card__meta">
          <strong title={file.name}>{file.name}</strong><span>{percent}%</span>
        </div>
        <div
          className="progress-track"
          role="progressbar"
          aria-label="Progresso do upload"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div className="progress-bar" style={{ "--progress": `${percent}%` } as React.CSSProperties} />
        </div>
        <div className="progress-card__meta" style={{ margin: "10px 0 0" }}>
          <span>{formatBytes(uploaded)} enviados</span><span>{formatBytes(file.size)}</span>
        </div>
      </div>
      <div className="button-row">
        <button className="button button--danger cursor-hover" type="button" onClick={onCancel}>
          <Icon name="x" /> Cancelar envio
        </button>
      </div>
    </div>
  );
}

function ProcessingView({ state }: { state: FileState }) {
  const titles = {
    queued: "Áudio recebido",
    processing: "Separando instrumentos",
    packaging: "Montando seu pacote",
  };
  const descriptions = {
    queued: "Seu job está na fila e será iniciado assim que houver capacidade disponível.",
    processing: "Estamos encontrando cada instrumento e preparando suas faixas.",
    packaging: "As faixas estão sendo organizadas e compactadas para download.",
  };
  const phase = state.phase as "queued" | "processing" | "packaging";
  const activeIndex = phase === "queued" ? 1 : phase === "processing" ? 2 : 4;
  return (
    <div className="processing-state">
      <div className="state-heading">
        <span className="state-icon"><Icon name="audio-waveform" /></span>
        <h3>{titles[phase]}</h3>
        <p>{state.jobMessage || descriptions[phase]}</p>
      </div>
      <div className="job-reference"><Icon name="fingerprint" /> Job {shortJobId(state.jobId)}</div>
      <div className="progress-card">
        <div className="progress-card__meta"><strong>Processamento no servidor</strong><span>Tempo variável</span></div>
        <div className="progress-track" role="progressbar" aria-label="Processamento em andamento">
          <div className="indeterminate" />
        </div>
        <ol className="processing-steps">
          {processingSteps.map((label, index) => {
            const complete = index < activeIndex;
            const active = index === activeIndex;
            return (
              <li
                className={`processing-step${complete ? " is-complete" : active ? " is-active" : ""}`}
                key={label}
              >
                <span className="processing-step__marker">
                  {complete ? <Icon name="check" /> : String(index + 1).padStart(2, "0")}
                </span>
                <span>{label}</span>
                <span className="processing-step__status">
                  {complete ? "Confirmado" : active ? "Em andamento" : ""}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

const miniStems = [
  ["mic-2", "Voz"],
  ["drum", "Bateria"],
  ["music-2", "Baixo"],
  ["guitar", "Guitarra"],
  ["piano", "Piano"],
  ["sparkles", "Outros"],
] as const;

function CompletedView({
  state,
  fileName,
  onReset,
}: {
  state: FileState;
  fileName?: string;
  onReset: () => void;
}) {
  const duration = formatDuration(state.elapsedSeconds);
  const download = apiUrl(
    state.downloadUrl ?? config.endpoints.downloadJob(state.jobId ?? ""),
  );
  return (
    <div className="result-state">
      <div className="state-heading">
        <span className="state-icon"><Icon name="circle-check-big" /></span>
        <h3>Suas faixas estão prontas</h3>
        <p>A separação foi concluída e os seis stems foram organizados em um pacote ZIP.</p>
      </div>
      <div className="result-summary">
        <div>
          <strong title={fileName}>{fileName || "Áudio processado"}</strong>
          <span>Job {shortJobId(state.jobId)}{duration ? ` · ${duration}` : ""}</span>
        </div>
        <span className="result-summary__count">6 stems</span>
      </div>
      <div className="mini-stems" aria-label="Faixas incluídas">
        {miniStems.map(([icon, label]) => (
          <span className="mini-stem" key={label}><Icon name={icon} />{label}</span>
        ))}
      </div>
      <a className="button button--primary button--full cursor-hover" href={download} download>
        <Icon name="download" /> Baixar pacote ZIP
      </a>
      {state.jobId && (
        <a
          className="button button--secondary button--full cursor-hover"
          href={`musics.html#library/${state.jobId}`}
          style={{ marginTop: 10 }}
        >
          <Icon name="sliders-horizontal" /> Abrir no mixer
        </a>
      )}
      <div className="button-row">
        <button className="button button--secondary cursor-hover button--full" type="button" onClick={onReset}>
          <Icon name="refresh-cw" /> Processar outro arquivo
        </button>
      </div>
    </div>
  );
}

function ConnectionView({
  state,
  onReset,
  onRetry,
}: {
  state: FileState;
  onReset: () => void;
  onRetry: () => void;
}) {
  const nextAttempt = Math.min(
    config.maxPollDelayMs,
    config.initialPollDelayMs * 2 ** Math.max(0, state.networkFailures - 1),
  );
  return (
    <div className="error-state">
      <div className="state-heading">
        <span className="state-icon" style={{ color: "var(--color-warning)" }}><Icon name="wifi-off" /></span>
        <h3>Conexão interrompida</h3>
        <p>O processamento pode continuar no servidor. Tentaremos consultar o status novamente.</p>
      </div>
      <div className="message-card message-card--warning" role="status">
        <Icon name="rotate-cw" /><span>Nova tentativa automática em até {Math.ceil(nextAttempt / 1000)} segundos.</span>
      </div>
      <div className="job-reference" style={{ marginTop: 18 }}><Icon name="fingerprint" /> Job {shortJobId(state.jobId)}</div>
      <div className="button-row">
        <button className="button button--secondary cursor-hover" type="button" onClick={onReset}>Novo arquivo</button>
        <button className="button button--primary cursor-hover" type="button" onClick={onRetry}><Icon name="refresh-cw" /> Consultar agora</button>
      </div>
    </div>
  );
}

function ErrorView({
  state,
  onReset,
  onRetry,
}: {
  state: FileState;
  onReset: () => void;
  onRetry: () => void;
}) {
  const error = state.error ?? {
    title: "Não foi possível concluir",
    message: "Tente novamente em alguns instantes.",
    details: null,
    retryable: true,
  };
  return (
    <div className="error-state">
      <div className="state-heading">
        <span className="state-icon"><Icon name="circle-alert" /></span>
        <h3>{error.title}</h3><p>{error.message}</p>
      </div>
      {error.details && (
        <details className="error-details"><summary>Ver detalhes técnicos</summary><pre>{error.details}</pre></details>
      )}
      <div className="button-row">
        <button className="button button--secondary cursor-hover" type="button" onClick={onReset}>Escolher outro arquivo</button>
        {error.retryable && (state.jobId || state.file) && (
          <button className="button button--primary cursor-hover" type="button" onClick={onRetry}><Icon name="refresh-cw" /> Tentar novamente</button>
        )}
      </div>
    </div>
  );
}

export function FileStateLabel({ phase }: { phase: FilePhase }) {
  return <>{phaseLabels[phase]}</>;
}
