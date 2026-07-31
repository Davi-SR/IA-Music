import { config } from "../../config";
import { formatBytes } from "../../lib/format";

const acceptedExtensions = new Set(["mp3", "wav"]);
const acceptedMimeTypes = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
]);

export function validateAudioFiles(
  fileList: FileList | File[] | null | undefined,
): { file?: File; error?: string } {
  const files = Array.from(fileList ?? []);
  if (files.length === 0) return { error: "Selecione um arquivo MP3 ou WAV." };
  if (files.length > 1) return { error: "Selecione apenas um arquivo." };
  const [file] = files;
  const extension = file.name.includes(".")
    ? file.name.split(".").pop()?.toLowerCase() ?? ""
    : "";
  if (!acceptedExtensions.has(extension)) {
    return { error: "Este formato não é suportado. Use um arquivo MP3 ou WAV." };
  }
  if (file.type && !acceptedMimeTypes.has(file.type.toLowerCase())) {
    return { error: "O tipo de áudio informado pelo arquivo não é suportado." };
  }
  if (file.size === 0) return { error: "O arquivo está vazio." };
  if (file.size > config.maxFileSizeBytes) {
    return {
      error: `O arquivo excede o limite permitido de ${formatBytes(config.maxFileSizeBytes)}.`,
    };
  }
  if (file.name.length > 180) {
    return { error: "O nome do arquivo é muito longo. Use até 180 caracteres." };
  }
  return { file };
}

export function isYoutubeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      [
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "music.youtube.com",
        "youtu.be",
      ].includes(url.hostname.toLowerCase()) &&
      url.pathname !== "/"
    );
  } catch {
    return false;
  }
}
