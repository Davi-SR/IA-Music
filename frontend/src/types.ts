export type JobStatus =
  | "queued"
  | "processing"
  | "packaging"
  | "completed"
  | "failed";

export interface JobErrorPayload {
  code: string;
  message: string;
}

export interface JobResponse {
  job_id: string;
  status: JobStatus;
  message?: string | null;
  progress_percent?: number | null;
  download_url?: string | null;
  elapsed_seconds?: number | null;
  stems?: string[] | null;
  error?: JobErrorPayload | null;
}

export interface LibraryStem {
  id: string;
  name: string;
  stream_url: string;
  download_url: string;
}

export interface LibraryItem {
  job_id: string;
  title: string;
  source_type: "youtube" | "upload" | string;
  created_at: number;
  completed_at: number | null;
  duration_seconds: number | null;
  download_url: string;
  stems: LibraryStem[];
}

export interface LibraryResponse {
  items: LibraryItem[];
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  has_password: boolean;
  google_connected: boolean;
  avatar_url: string | null;
  created_at: number;
}

export interface AuthResponse {
  user: AuthUser;
}

export type SourceMode = "file" | "youtube";
