const STORAGE_KEY = 'threadbeacon.basic-auth';
let installed = false;

export function basicCredential(username: string, password: string) {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

export function authCredential() {
  return sessionStorage.getItem(STORAGE_KEY) ?? '';
}

export function saveAuthCredential(value: string) {
  sessionStorage.setItem(STORAGE_KEY, value);
}

export function clearAuthCredential() {
  sessionStorage.removeItem(STORAGE_KEY);
}

export function installAuthenticatedFetch() {
  if (installed) return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return original(input, init);
    const credential = authCredential();
    if (!credential) return original(input, init);
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    if (!headers.has('authorization')) headers.set('authorization', credential);
    return original(input, { ...init, headers });
  };
}
