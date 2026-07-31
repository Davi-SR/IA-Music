import { useState } from "react";
import { AppShell } from "../components/AppShell";
import { Icon } from "../components/Icon";
import { FileProcessor } from "../features/jobs/FileProcessor";
import { YoutubeProcessor } from "../features/jobs/YoutubeProcessor";
import type { SourceMode } from "../types";

const stems = [
  ["mic-2", "blue", "Voz", "Vocals", "▂▅▇▄▆"],
  ["drum", "purple", "Bateria", "Drums", "▆▂▇▃▆"],
  ["music-2", "cyan", "Baixo", "Bass", "▃▅▃▆▂"],
  ["guitar", "amber", "Guitarra", "Guitar", "▂▇▅▃▆"],
  ["piano", "emerald", "Piano", "Piano", "▅▃▆▂▇"],
  ["sparkles", "rose", "Outros", "Other", "▃▆▂▅▇"],
] as const;

export function HomePage() {
  const [mode, setMode] = useState<SourceMode>("file");

  return (
    <AppShell activePage="home">
      <main id="top">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero__copy reveal active">
            <h1 id="hero-title">
              Separe a música.
              <span>Encontre cada instrumento.</span>
            </h1>
            <p className="hero__lead">
              Envie um MP3 ou WAV, ou cole um link do YouTube, e receba voz,
              bateria, baixo, guitarra, piano e outros em um único ZIP.
            </p>
            <div className="hero__trust" aria-label="Características do serviço">
              <span><Icon name="shield-check" /> Upload protegido</span>
              <span><Icon name="activity" /> Status em tempo real</span>
              <span><Icon name="archive" /> Download em ZIP</span>
            </div>
          </div>
          <HeroVisual />
        </section>

        <section
          className="workspace-section"
          id="workspace"
          aria-labelledby="workspace-title"
        >
          <div className="workspace-grid">
            <article className="workspace glass-panel glass-panel--static">
              <header className="workspace__header">
                <div>
                  <p className="micro-label" id="state-label">
                    {mode === "file"
                      ? "Novo processamento"
                      : "Processar vídeo do YouTube"}
                  </p>
                  <h2 id="workspace-title">Seu áudio, em camadas.</h2>
                </div>
              </header>
              <SourcePicker mode={mode} onChange={setMode} />
              <div hidden={mode !== "file"}>
                <FileProcessor />
              </div>
              <div id="youtube-view" hidden={mode !== "youtube"}>
                <YoutubeProcessor />
              </div>
            </article>
            <StemPreview />
          </div>
        </section>

        <HowItWorks />
      </main>
    </AppShell>
  );
}

function SourcePicker({
  mode,
  onChange,
}: {
  mode: SourceMode;
  onChange: (mode: SourceMode) => void;
}) {
  return (
    <div className="source-picker" role="tablist" aria-label="Origem do áudio">
      <button
        className={`source-picker__button${mode === "file" ? " is-active" : ""}`}
        type="button"
        role="tab"
        aria-selected={mode === "file"}
        onClick={() => onChange("file")}
      >
        <Icon name="file-audio" /> Arquivo
      </button>
      <button
        className={`source-picker__button${mode === "youtube" ? " is-active" : ""}`}
        type="button"
        role="tab"
        aria-selected={mode === "youtube"}
        onClick={() => onChange("youtube")}
      >
        <Icon name="youtube" /> YouTube
      </button>
    </div>
  );
}

function HeroVisual() {
  const heights = [26, 48, 76, 40, 92, 64, 36, 82, 52, 30, 68, 44];
  return (
    <div className="hero__visual" aria-hidden="true">
      <div className="orbital">
        <div className="orbital__core"><Icon name="audio-lines" width={36} /></div>
        <span className="orbital__ring orbital__ring--one" />
        <span className="orbital__ring orbital__ring--two" />
        <div className="waveform">
          {heights.map((height, index) => (
            <i
              key={`${height}-${index}`}
              style={{ "--height": `${height}%` } as React.CSSProperties}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function StemPreview() {
  return (
    <aside className="stem-preview" id="stems" aria-labelledby="stems-title">
      <div className="stem-preview__heading">
        <p className="micro-label">Uma passagem · seis resultados</p>
        <h2 id="stems-title">Tudo que você recebe</h2>
      </div>
      <div className="stem-grid">
        {stems.map(([icon, color, name, subtitle, wave]) => (
          <div className="stem-card glass-panel" key={name}>
            <span className={`stem-card__icon stem-card__icon--${color}`}>
              <Icon name={icon} />
            </span>
            <div><strong>{name}</strong><small>{subtitle}</small></div>
            <span className="stem-card__wave">{wave}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}

function HowItWorks() {
  const steps = [
    [
      "upload-cloud",
      "Escolha a origem",
      "Envie um arquivo MP3/WAV ou cole a URL de um vídeo do YouTube.",
    ],
    [
      "audio-waveform",
      "Acompanhe a separação",
      "O job continua no servidor e você acompanha cada estado confirmado.",
    ],
    [
      "download",
      "Baixe os seis stems",
      "Ao final, todas as faixas chegam organizadas em um único pacote ZIP.",
    ],
  ] as const;
  return (
    <section className="how-section" id="como-funciona" aria-labelledby="how-title">
      <header className="section-heading">
        <p className="micro-label">Do arquivo ao estúdio</p>
        <h2 id="how-title">Simples para você.<br /><span>Potente por trás.</span></h2>
      </header>
      <ol className="how-grid">
        {steps.map(([icon, title, copy], index) => (
          <li className="how-card glass-panel" key={title}>
            <span className="how-card__number">{String(index + 1).padStart(2, "0")}</span>
            <span className="how-card__icon"><Icon name={icon} /></span>
            <h3>{title}</h3>
            <p>{copy}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
