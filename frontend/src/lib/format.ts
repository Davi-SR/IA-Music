export function formatBytes(bytes: number | undefined | null): string {
  if (!Number.isFinite(bytes) || !bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 || value >= 10 ? 0 : 1)} ${units[index]}`;
}

export function formatDuration(seconds: number | null | undefined): string | null {
  if (!Number.isFinite(seconds)) return null;
  const safeSeconds = Number(seconds);
  if (safeSeconds < 60) return `${Math.round(safeSeconds)} s`;
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = Math.round(safeSeconds % 60);
  return `${minutes} min ${remainder.toString().padStart(2, "0")} s`;
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "--:--";
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function shortJobId(jobId: string | null): string {
  if (!jobId) return "aguardando";
  return jobId.length > 12 ? `${jobId.slice(0, 8)}…` : jobId;
}
