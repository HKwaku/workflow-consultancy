'use client';

const DEFAULT_TIMEOUT_MS = 60000;

/**
 * Fetch wrapper that adds Authorization header when accessToken is provided.
 * Supports optional timeout via AbortController.
 */
export function apiFetch(url, options = {}, accessToken = null) {
  const { timeout, ...fetchOptions } = options;
  const headers = { ...(fetchOptions.headers || {}) };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  const timeoutMs = timeout ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...fetchOptions, headers, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}
