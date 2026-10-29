import { config } from '../config.js';

const TOKEN_KEY = 'pi-reporting-token';
const unauthorizedListeners = new Set();

function readToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

let token = readToken();

export const getToken = () => token;

export function setToken(value) {
  token = value || null;
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage blocked: the session lasts until the page reloads.
  }
}

/** Called when an authenticated request comes back 401 (expired or revoked session). */
export function onUnauthorized(fn) {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = config.api.timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: options.signal ?? controller.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Request to ${url} timed out after ${timeoutMs} ms`);
    throw new Error(`Could not reach ${url}. Is the Function API running (npm run api)?`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Call the Function API. Throws an Error with `status` and, for validation errors, `field`.
 * Pass `auth: false` for calls made before sign-in.
 */
export async function apiFetch(path, { method = 'GET', body, auth = true } = {}) {
  if (!config.api.baseUrl) throw new Error('VITE_API_BASE_URL is not set. Add it to .env.local and rebuild.');
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  if (config.api.key) headers['x-functions-key'] = config.api.key;

  const url = `${config.api.baseUrl}${path}`;
  const res = await fetchWithTimeout(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && auth) unauthorizedListeners.forEach((fn) => fn());
    throw Object.assign(new Error(data.error || `${res.status} ${res.statusText} from ${url}`), { status: res.status, field: data.field });
  }
  return data;
}
