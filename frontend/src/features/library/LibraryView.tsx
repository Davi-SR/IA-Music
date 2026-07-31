import { apiUrl } from "../../config";
import { Icon } from "../../components/Icon";
import type { LibraryItem } from "../../types";

export function LibraryView({
  items,
  onRefresh,
}: {
  items: LibraryItem[];
  onRefresh: () => void;
}) {
  return (
    <div className="library-shell glass-panel glass-panel--static">
      <header className="library-header">
        <div>
          <p className="micro-label">Seu espaço musical</p>
          <h1>Minhas músicas</h1>
          <p>Ouça, misture e baixe as faixas que você já separou.</p>
        </div>
        <div className="library-actions">
          <button className="button button--secondary" type="button" onClick={onRefresh}>
            <Icon name="refresh-cw" /> Atualizar
          </button>
          <a className="button button--primary" href="index.html#workspace">
            <Icon name="plus" /> Nova música
          </a>
        </div>
      </header>
      {items.length ? (
        <div className="library-grid">
          {items.map((item) => <MusicCard item={item} key={item.job_id} />)}
        </div>
      ) : (
        <div className="library-empty">
          <div className="library-empty__content">
            <span className="library-empty__icon"><Icon name="audio-lines" /></span>
            <h2>Sua biblioteca está esperando a primeira música</h2>
            <p>Quando uma separação terminar, ela aparecerá aqui com todas as faixas prontas para ouvir.</p>
            <a className="button button--primary" href="index.html#workspace" style={{ marginTop: 24 }}>
              Separar uma música
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function MusicCard({ item }: { item: LibraryItem }) {
  const date = item.completed_at
    ? new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(new Date(item.completed_at * 1000))
    : "Processada recentemente";
  return (
    <article className="music-card">
      <div className="music-card__top">
        <span className="music-card__art"><Icon name="audio-waveform" /></span>
        <div className="music-card__copy">
          <h2 title={item.title}>{item.title}</h2>
          <p>{item.source_type === "youtube" ? "YouTube" : "Upload"} · {date}</p>
        </div>
      </div>
      <div className="music-card__stems">
        {item.stems.map((stem) => <span className="stem-chip" key={stem.id}>{stem.name}</span>)}
      </div>
      <div className="music-card__actions">
        <a className="button button--primary" href={`#library/${item.job_id}`}>
          <Icon name="sliders-horizontal" /> Abrir mixer
        </a>
        <a className="button button--secondary" href={apiUrl(item.download_url)}>
          <Icon name="download" /> ZIP
        </a>
      </div>
    </article>
  );
}
