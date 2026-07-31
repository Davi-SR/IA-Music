import { apiUrl, config } from "../config";
import type { AuthResponse } from "../types";
import { requestJson } from "./client";

export function getCurrentUser(signal?: AbortSignal): Promise<AuthResponse> {
  return requestJson<AuthResponse>(config.endpoints.auth.me, {
    signal,
    cache: "no-store",
  });
}

export function registerUser(
  name: string,
  email: string,
  password: string,
): Promise<AuthResponse> {
  return requestJson<AuthResponse>(config.endpoints.auth.register, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password }),
  });
}

export function loginUser(email: string, password: string): Promise<AuthResponse> {
  return requestJson<AuthResponse>(config.endpoints.auth.login, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

export async function logoutUser(): Promise<void> {
  await requestJson<Record<string, never>>(config.endpoints.auth.logout, {
    method: "POST",
  });
}

export function updateProfile(name: string): Promise<AuthResponse> {
  return requestJson<AuthResponse>(config.endpoints.auth.me, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await requestJson<Record<string, never>>("/api/auth/password", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      current_password: currentPassword || null,
      new_password: newPassword,
    }),
  });
}

export async function deleteAccount(password: string): Promise<void> {
  await requestJson<Record<string, never>>(config.endpoints.auth.me, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: password || null }),
  });
}

export function requestPasswordReset(email: string): Promise<{ message: string }> {
  return requestJson<{ message: string }>(
    config.endpoints.auth.forgotPassword,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    },
  );
}

export async function resetPassword(
  token: string,
  password: string,
): Promise<void> {
  await requestJson<Record<string, never>>(
    config.endpoints.auth.resetPassword,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    },
  );
}

export function googleLoginUrl(next = "musics.html"): string {
  const query = new URLSearchParams({ next });
  return apiUrl(`${config.endpoints.auth.googleStart}?${query}`);
}
