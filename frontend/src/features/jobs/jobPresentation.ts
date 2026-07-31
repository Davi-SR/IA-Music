import { ApiError } from "../../api/client";
import type { JobStatus } from "../../types";

export type FilePhase =
  | "idle"
  | "file_selected"
  | "uploading"
  | "queued"
  | "processing"
  | "packaging"
  | "completed"
  | "failed"
  | "connection_lost";

export const phaseLabels: Record<FilePhase, string> = {
  idle: "Novo processamento",
  file_selected: "Arquivo pronto",
  uploading: "Enviando arquivo",
  queued: "Job criado",
  processing: "Separação em andamento",
  packaging: "Preparando o download",
  completed: "Processamento concluído",
  failed: "Ação necessária",
  connection_lost: "Reconectando",
};

export const processingSteps = [
  "Áudio recebido",
  "Preparando processamento",
  "Separando instrumentos",
  "Organizando arquivos",
  "Criando pacote ZIP",
  "Finalizando",
] as const;

export function phaseFromStatus(status: JobStatus): FilePhase {
  return status;
}

export interface PresentedError {
  title: string;
  message: string;
  details: string | null;
  retryable: boolean;
}

export function presentError(
  error: unknown,
  context: "upload" | "status" | "youtube",
): PresentedError {
  if (!(error instanceof ApiError)) {
    return {
      title: "Erro inesperado",
      message: "Não foi possível concluir esta etapa. Tente novamente.",
      details: error instanceof Error ? error.message : String(error),
      retryable: true,
    };
  }
  const titles: Partial<Record<typeof error.kind, string>> = {
    network: "Sem conexão com o servidor",
    timeout: "O servidor demorou a responder",
    server: "Serviço temporariamente indisponível",
    http:
      context === "upload"
        ? "O arquivo não foi aceito"
        : "Não foi possível continuar",
    invalid_response: "Resposta inválida do servidor",
  };
  return {
    title: titles[error.kind] ?? "Não foi possível continuar",
    message: error.message,
    details: [
      error.status ? `HTTP ${error.status}` : null,
      error.code ? `Código ${error.code}` : null,
      error.details,
    ]
      .filter(Boolean)
      .join("\n") || null,
    retryable: error.retryable,
  };
}
