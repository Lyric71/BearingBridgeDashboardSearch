// Client-side project store, backed by the database via /api/projects.
//
// The DB is the single source of truth. Reads are SYNCHRONOUS from an in-memory
// cache hydrated from the server-rendered JSON (#projects-data in Layout.astro),
// so existing synchronous callers (Layout, kanban, project board) keep working
// without an API round-trip. Writes are ASYNC: they hit the API, then update
// the cache so the UI stays in sync. No more localStorage as source of truth.
import {
  ensureModules,
  MODULES,
  PALETTE,
  type Project,
  type ProjectInput,
  type Channels,
  type Modules,
} from '../lib/projectTypes';

// Re-export so existing imports from './projects' keep resolving.
export { MODULES, PALETTE, ensureModules };
export type { Project, ProjectInput, Channels, Modules };

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

// ---- cache, hydrated from the SSR-injected JSON ----------------------------
function hydrate(): Project[] {
  try {
    const raw = document.getElementById('projects-data')?.textContent?.trim();
    if (raw) {
      return (JSON.parse(raw) as Project[]).map(p => ({ ...p, modules: ensureModules(p.modules) }));
    }
  } catch {
    /* fall through to empty */
  }
  return [];
}
let cache: Project[] = hydrate();

// ---- API helper ------------------------------------------------------------
function token(): string {
  return sessionStorage.getItem('bbg_session') ?? '';
}
async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`/api/projects${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token()}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { msg = (await res.json()).error ?? msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

// ---- synchronous reads (from cache) ----------------------------------------
export function listProjects(): Project[] {
  return cache.map(clone);
}
export function getProject(id: string): Project | undefined {
  const p = cache.find(x => x.id === id);
  return p ? clone(p) : undefined;
}

// Pull a fresh copy from the server (e.g. after returning to a stale tab).
export async function refreshProjects(): Promise<Project[]> {
  const rows = (await api('')) as Project[];
  cache = rows.map(p => ({ ...p, modules: ensureModules(p.modules) }));
  return listProjects();
}

// ---- async writes (API + cache update) -------------------------------------
export async function createProject(input: ProjectInput): Promise<Project> {
  const created = (await api('', { method: 'POST', body: JSON.stringify(input) })) as Project;
  cache.push(created);
  return clone(created);
}

export async function updateProject(id: string, patch: Partial<ProjectInput>): Promise<void> {
  const updated = (await api(`/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })) as Project;
  const i = cache.findIndex(p => p.id === id);
  if (i >= 0) cache[i] = updated; else cache.push(updated);
}

export async function deleteProject(id: string): Promise<void> {
  await api(`/${id}`, { method: 'DELETE' });
  cache = cache.filter(p => p.id !== id);
}
