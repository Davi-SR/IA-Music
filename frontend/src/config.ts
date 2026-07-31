export const config = Object.freeze({
  apiBaseUrl: "",
  maxFileSizeBytes: 500 * 1024 * 1024,
  uploadTimeoutMs: 10 * 60 * 1000,
  requestTimeoutMs: 15 * 1000,
  initialPollDelayMs: 2500,
  maxPollDelayMs: 30_000,
  uploadFieldName: "file",
  youtubeUrlFieldName: "youtube_url",
  endpoints: Object.freeze({
    createJob: "/api/jobs",
    getJob: (jobId: string) => `/api/jobs/${encodeURIComponent(jobId)}`,
    downloadJob: (jobId: string) =>
      `/api/jobs/${encodeURIComponent(jobId)}/download`,
    library: "/api/library",
    auth: Object.freeze({
      register: "/api/auth/register",
      login: "/api/auth/login",
      logout: "/api/auth/logout",
      me: "/api/auth/me",
      forgotPassword: "/api/auth/forgot-password",
      resetPassword: "/api/auth/reset-password",
      googleStart: "/api/auth/google/start",
    }),
  }),
});

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = config.apiBaseUrl.replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
