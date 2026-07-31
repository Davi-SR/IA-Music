import { useCallback, useEffect, useRef, useState } from "react";
import { apiUrl } from "../../config";
import { Icon } from "../../components/Icon";
import { formatTime } from "../../lib/format";
import type { LibraryItem, LibraryStem } from "../../types";

const trackUi: Record<
  string,
  { name: string; subtitle: string; icon: string }
> = {
  vocals: { name: "Voz", subtitle: "Vocals", icon: "mic-2" },
  drums: { name: "Bateria", subtitle: "Drums", icon: "drum" },
  bass: { name: "Baixo", subtitle: "Bass", icon: "music-2" },
  guitar: { name: "Guitarra", subtitle: "Guitar", icon: "guitar" },
  piano: { name: "Piano", subtitle: "Piano", icon: "piano" },
  other: { name: "Outros", subtitle: "Other", icon: "sparkles" },
};

interface TrackState {
  stem: LibraryStem;
  volume: number;
  muted: boolean;
  solo: boolean;
  unavailable: boolean;
}

export function Mixer({ item }: { item: LibraryItem }) {
  const [tracks, setTracks] = useState<TrackState[]>(() =>
    item.stems.map((stem) => ({
      stem,
      volume: 85,
      muted: false,
      solo: false,
      unavailable: false,
    })),
  );
  const [duration, setDuration] = useState(item.duration_seconds ?? 0);
  const [position, setPosition] = useState(0);
  const [masterVolume, setMasterVolume] = useState(100);
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState(
    item.duration_seconds
      ? "Tudo pronto. Dê play e monte sua própria mixagem."
      : "Carregando as faixas do mixer…",
  );
  const audios = useRef(new Map<string, HTMLAudioElement>());
  const frame = useRef<number | null>(null);
  const playingRef = useRef(false);
  const durationRef = useRef(duration);
  const syncAt = useRef(0);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  const currentTime = useCallback(() => {
    const values = [...audios.current.values()];
    const active = values.find(
      (audio) =>
        !audio.paused &&
        !audio.ended &&
        audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA,
    );
    if (active) return active.currentTime;
    return Math.max(
      0,
      ...values.map((audio) => audio.currentTime).filter(Number.isFinite),
    );
  }, []);

  const stopFrame = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);

  const pause = useCallback(
    (message = "Reprodução pausada.") => {
      audios.current.forEach((audio) => audio.pause());
      playingRef.current = false;
      setPlaying(false);
      stopFrame();
      setStatus(message);
    },
    [stopFrame],
  );

  const tick = useCallback(
    (timestamp: number) => {
      if (!playingRef.current) return;
      const current = currentTime();
      setPosition(current);
      if (timestamp - syncAt.current > 1000) {
        audios.current.forEach((audio) => {
          if (
            !audio.paused &&
            audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
            Math.abs(audio.currentTime - current) > 0.09
          ) {
            audio.currentTime = current;
          }
        });
        syncAt.current = timestamp;
      }
      if (current >= durationRef.current - 0.05) {
        pause("Fim da música.");
        audios.current.forEach((audio) => {
          audio.currentTime = 0;
        });
        setPosition(0);
        return;
      }
      frame.current = requestAnimationFrame(tick);
    },
    [currentTime, pause],
  );

  useEffect(() => {
    const audioMap = new Map<string, HTMLAudioElement>();
    const disposers: Array<() => void> = [];
    for (const stem of item.stems) {
      const audio = new Audio(apiUrl(stem.stream_url));
      audio.preload = "metadata";
      audioMap.set(stem.id, audio);
      const onMetadata = () => {
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          setDuration((current) => Math.max(current, audio.duration));
          setStatus("Tudo pronto. Dê play e monte sua própria mixagem.");
        }
      };
      const onError = () => {
        setTracks((current) =>
          current.map((track) =>
            track.stem.id === stem.id
              ? { ...track, unavailable: true }
              : track,
          ),
        );
      };
      audio.addEventListener("loadedmetadata", onMetadata);
      audio.addEventListener("durationchange", onMetadata);
      audio.addEventListener("canplay", onMetadata);
      audio.addEventListener("error", onError);
      disposers.push(() => {
        audio.removeEventListener("loadedmetadata", onMetadata);
        audio.removeEventListener("durationchange", onMetadata);
        audio.removeEventListener("canplay", onMetadata);
        audio.removeEventListener("error", onError);
      });
      audio.load();
    }
    audios.current = audioMap;
    const loadingHint = window.setTimeout(() => {
      if (!durationRef.current) {
        setStatus(
          "As faixas continuam carregando. O player será liberado automaticamente.",
        );
      }
    }, 3000);
    return () => {
      window.clearTimeout(loadingHint);
      playingRef.current = false;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      disposers.forEach((dispose) => dispose());
      audioMap.forEach((audio) => {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      });
      audios.current.clear();
    };
  }, [item]);

  useEffect(() => {
    const hasSolo = tracks.some((track) => track.solo);
    for (const track of tracks) {
      const audio = audios.current.get(track.stem.id);
      if (!audio) continue;
      const audible =
        !track.unavailable &&
        !track.muted &&
        (!hasSolo || track.solo);
      audio.volume = audible
        ? Math.max(0, Math.min(1, (track.volume / 100) * (masterVolume / 100)))
        : 0;
    }
  }, [masterVolume, tracks]);

  const play = async () => {
    if (!audios.current.size || !duration) return;
    const startAt = position >= duration - 0.1 ? 0 : position;
    if (startAt === 0) setPosition(0);
    playingRef.current = true;
    setPlaying(true);
    setStatus("Iniciando sua mixagem…");
    const attempts = [...audios.current.entries()].map(
      async ([trackId, audio]) => {
        try {
          if (Number.isFinite(audio.duration)) {
            audio.currentTime = Math.min(startAt, audio.duration);
          }
          await audio.play();
          if (!playingRef.current) {
            audio.pause();
            return false;
          }
          setTracks((current) =>
            current.map((track) =>
              track.stem.id === trackId
                ? { ...track, unavailable: false }
                : track,
            ),
          );
          return true;
        } catch {
          setTracks((current) =>
            current.map((track) =>
              track.stem.id === trackId
                ? { ...track, unavailable: true }
                : track,
            ),
          );
          return false;
        }
      },
    );
    stopFrame();
    frame.current = requestAnimationFrame(tick);
    void Promise.all(attempts).then((results) => {
      if (!playingRef.current) return;
      const started = results.filter(Boolean).length;
      if (started === 0) {
        pause(
          "O navegador não conseguiu iniciar o áudio. Atualize a página e tente novamente.",
        );
      } else if (started === results.length) {
        setStatus("Reproduzindo todas as faixas em sincronia.");
      } else {
        setStatus("Reproduzindo a mixagem enquanto as outras faixas entram.");
      }
    });
  };

  const seek = (nextPosition: number) => {
    const safe = Math.max(0, Math.min(duration, nextPosition || 0));
    audios.current.forEach((audio) => {
      if (Number.isFinite(audio.duration)) {
        audio.currentTime = Math.min(safe, audio.duration);
      }
    });
    setPosition(safe);
  };

  const patchTrack = (id: string, patch: Partial<TrackState>) =>
    setTracks((current) =>
      current.map((track) =>
        track.stem.id === id ? { ...track, ...patch } : track,
      ),
    );

  const hasSolo = tracks.some((track) => track.solo);
  return (
    <div className="library-shell glass-panel glass-panel--static">
      <header className="mixer-header">
        <div>
          <a href="#library" className="micro-label">← Voltar para minhas músicas</a>
          <h1>{item.title}</h1>
          <p>Controle cada instrumento e crie a mixagem que você quer ouvir.</p>
        </div>
        <div className="library-actions">
          <a className="button button--secondary" href={apiUrl(item.download_url)}>
            <Icon name="archive" /> Baixar tudo
          </a>
        </div>
      </header>
      <div className="mixer-layout">
        <div className="mixer-console">
          <div className="mixer-transport">
            <button
              className="transport-play"
              type="button"
              aria-label={playing ? "Pausar" : duration ? "Reproduzir" : "Carregando faixas"}
              disabled={!duration}
              onClick={() => (playing ? pause() : void play())}
            >
              <Icon name={playing ? "pause" : duration ? "play" : "loader-circle"} />
            </button>
            <div className="transport-timeline">
              <input
                className="range-control"
                type="range"
                min={0}
                max={duration}
                step={0.05}
                value={position}
                aria-label="Posição da música"
                onChange={(event) => seek(Number(event.target.value))}
              />
              <div className="transport-time">
                <span>{formatTime(position)}</span>
                <span>{duration ? formatTime(duration) : "--:--"}</span>
              </div>
            </div>
            <label className="master-volume">
              <Icon name="volume-2" />
              <input
                className="range-control"
                type="range"
                min={0}
                max={100}
                value={masterVolume}
                aria-label="Volume geral"
                onChange={(event) => setMasterVolume(Number(event.target.value))}
              />
            </label>
          </div>
          <div className="track-list">
            {tracks.map((track) => {
              const ui = trackUi[track.stem.id] ?? {
                name: track.stem.name,
                subtitle: track.stem.id,
                icon: "music",
              };
              const visuallyMuted =
                track.unavailable ||
                track.muted ||
                (hasSolo && !track.solo);
              return (
                <div
                  className={`mixer-track${visuallyMuted ? " is-muted" : ""}${track.solo ? " is-solo" : ""}`}
                  key={track.stem.id}
                >
                  <div className="track-identity">
                    <span className="track-icon"><Icon name={ui.icon} /></span>
                    <div><strong>{ui.name}</strong><small>{ui.subtitle}</small></div>
                  </div>
                  <div className="track-toggles">
                    <button
                      className={`track-toggle${track.muted ? " is-active" : ""}`}
                      type="button"
                      aria-label={`Silenciar ${ui.name}`}
                      aria-pressed={track.muted}
                      onClick={() => patchTrack(track.stem.id, { muted: !track.muted })}
                    >
                      M
                    </button>
                    <button
                      className={`track-toggle${track.solo ? " is-active" : ""}`}
                      type="button"
                      aria-label={`Ouvir apenas ${ui.name}`}
                      aria-pressed={track.solo}
                      onClick={() => patchTrack(track.stem.id, { solo: !track.solo })}
                    >
                      S
                    </button>
                  </div>
                  <label className="track-volume">
                    <span className="sr-only">Volume de {ui.name}</span>
                    <input
                      className="range-control"
                      type="range"
                      min={0}
                      max={100}
                      value={track.volume}
                      onChange={(event) =>
                        patchTrack(track.stem.id, {
                          volume: Number(event.target.value),
                        })
                      }
                    />
                    <output>{track.volume}%</output>
                  </label>
                  <a
                    className="track-download"
                    href={apiUrl(track.stem.download_url)}
                    aria-label={`Baixar ${ui.name} separadamente`}
                  >
                    <Icon name="download" />
                  </a>
                </div>
              );
            })}
          </div>
        </div>
        <aside className="mixer-now-playing">
          <div className="now-playing-art"><Icon name="audio-waveform" /></div>
          <div>
            <p className="micro-label">Agora no mixer</p>
            <h2>{item.title}</h2>
            <p>{item.source_type === "youtube" ? "Importado do YouTube" : "Arquivo enviado"} · seis camadas sincronizadas</p>
            <div className="now-playing-stats">
              <div className="now-playing-stat"><small>Faixas</small><strong>{item.stems.length}</strong></div>
              <div className="now-playing-stat"><small>Qualidade</small><strong>WAV</strong></div>
            </div>
          </div>
          <div className="mixer-status"><Icon name="info" /> {status}</div>
        </aside>
      </div>
    </div>
  );
}
