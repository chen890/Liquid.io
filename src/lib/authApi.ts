/** All requests include cookies for httpOnly JWT session. */

async function readApiError(r: Response): Promise<string> {
  const text = await r.text();
  try {
    const j = JSON.parse(text) as { detail?: string | { msg?: string }[] };
    if (typeof j.detail === 'string') return j.detail;
    if (Array.isArray(j.detail)) {
      return j.detail.map((x) => (typeof x === 'object' && x && 'msg' in x ? String(x.msg) : String(x))).join('; ');
    }
  } catch {
    /* use raw */
  }
  return text.slice(0, 400) || `HTTP ${r.status}`;
}

function formatDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((x) => (typeof x === 'object' && x !== null && 'msg' in x ? String((x as { msg: string }).msg) : String(x)))
      .join('; ');
  }
  return '';
}

export interface AuthUser {
  id: number;
  email: string;
  createdAt?: string;
}

async function parseJson<T>(r: Response): Promise<T> {
  const text = await r.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(text.slice(0, 200) || `HTTP ${r.status}`);
  }
}

export type SessionProbe =
  | { status: 'authenticated'; user: AuthUser }
  | { status: 'anonymous' }
  | { status: 'no_backend' }
  | { status: 'error'; message: string };

/**
 * Detect whether the Python API (with auth routes) is reachable.
 * Static hosts (e.g. Vercel SPA) return 404 for /api/* — treat as no_backend
 * so the dashboard still runs local-first without blocking on login.
 */
export async function probeSession(): Promise<SessionProbe> {
  try {
    const r = await fetch('/api/auth/me', { credentials: 'include' });
    const text = await r.text();
    if (r.status === 404) return { status: 'no_backend' };
    if (r.status === 401) return { status: 'anonymous' };
    if (!r.ok) {
      try {
        const j = JSON.parse(text) as { detail?: unknown };
        const msg = formatDetail(j.detail) || text.slice(0, 400) || `HTTP ${r.status}`;
        return { status: 'error', message: msg };
      } catch {
        return { status: 'error', message: text.slice(0, 400) || `HTTP ${r.status}` };
      }
    }
    try {
      const d = JSON.parse(text) as { user?: AuthUser };
      if (!d.user) return { status: 'error', message: 'Invalid server response' };
      return { status: 'authenticated', user: d.user };
    } catch {
      if (text.includes('NOT_FOUND')) return { status: 'no_backend' };
      return { status: 'error', message: 'Unexpected response from /api/auth/me' };
    }
  } catch {
    return { status: 'no_backend' };
  }
}

export async function authMe(): Promise<{ ok: boolean; user: AuthUser }> {
  const r = await fetch('/api/auth/me', { credentials: 'include' });
  if (r.status === 401) {
    const err = new Error('Unauthorized') as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  if (!r.ok) throw new Error(await readApiError(r));
  return parseJson(r);
}

export async function authRegister(email: string, password: string): Promise<{ user: AuthUser }> {
  const r = await fetch('/api/auth/register', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const text = await r.text();
  let d: { ok?: boolean; user?: AuthUser; detail?: unknown } = {};
  try {
    d = JSON.parse(text) as typeof d;
  } catch {
    /* non-JSON error */
  }
  if (!r.ok) throw new Error(formatDetail(d.detail) || text.slice(0, 400) || `HTTP ${r.status}`);
  if (!d.user) throw new Error('Invalid server response');
  return { user: d.user };
}

export async function authLogin(email: string, password: string): Promise<{ user: AuthUser }> {
  const r = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const text = await r.text();
  let d: { ok?: boolean; user?: AuthUser; detail?: unknown } = {};
  try {
    d = JSON.parse(text) as typeof d;
  } catch {
    /* non-JSON */
  }
  if (!r.ok) throw new Error(formatDetail(d.detail) || text.slice(0, 400) || `HTTP ${r.status}`);
  if (!d.user) throw new Error('Invalid server response');
  return { user: d.user };
}

export async function authLogout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
}

// --- Vault ---

export interface VaultSecretMeta {
  name: string;
  updated_at: string;
}

export interface VaultFileMeta {
  id: number;
  filename: string;
  mime: string;
  size_plain: number;
  updated_at: string;
}

export async function vaultListSecrets(): Promise<VaultSecretMeta[]> {
  const r = await fetch('/api/vault/secrets', { credentials: 'include' });
  if (!r.ok) throw new Error(await r.text());
  const d = await r.json() as { secrets?: VaultSecretMeta[] };
  return d.secrets ?? [];
}

export async function vaultPutSecret(name: string, value: string): Promise<void> {
  const r = await fetch(`/api/vault/secrets/${encodeURIComponent(name)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  if (!r.ok) throw new Error(await r.text());
}

export async function vaultGetSecret(name: string): Promise<string> {
  const r = await fetch(`/api/vault/secrets/${encodeURIComponent(name)}`, { credentials: 'include' });
  if (!r.ok) throw new Error(await r.text());
  const d = await r.json() as { value?: string };
  return d.value ?? '';
}

export async function vaultDeleteSecret(name: string): Promise<void> {
  const r = await fetch(`/api/vault/secrets/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!r.ok) throw new Error(await r.text());
}

export async function vaultListFiles(): Promise<VaultFileMeta[]> {
  const r = await fetch('/api/vault/files', { credentials: 'include' });
  if (!r.ok) throw new Error(await r.text());
  const d = await r.json() as { files?: VaultFileMeta[] };
  return d.files ?? [];
}

export async function vaultUploadFile(file: File): Promise<{ id: number; filename: string }> {
  const fd = new FormData();
  fd.append('file', file);
  const r = await fetch('/api/vault/files', { method: 'POST', credentials: 'include', body: fd });
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<{ id: number; filename: string }>;
}

export function vaultDownloadUrl(fileId: number): string {
  return `/api/vault/files/${fileId}/download`;
}

export async function vaultDeleteFile(fileId: number): Promise<void> {
  const r = await fetch(`/api/vault/files/${fileId}`, { method: 'DELETE', credentials: 'include' });
  if (!r.ok) throw new Error(await r.text());
}
