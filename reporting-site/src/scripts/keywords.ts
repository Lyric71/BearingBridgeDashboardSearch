// Client-side keyword store, backed by the database via /api/keywords.
//
// Reads are SYNCHRONOUS from a cache hydrated from the server-rendered JSON
// (#keywords-data on the keywords page). Writes are OPTIMISTIC: the cache
// updates immediately and the API call runs in the background; on failure we
// resync from the server and re-render. No more localStorage.

export interface Keyword {
  id: string;
  keyword: string;
  language: string;
  intent: string;
  cluster: string;
  priority: string;
}
type State = Record<string, Keyword[]>; // projectId -> keywords

// Controlled vocabularies for the editor dropdowns.
export const LANGUAGES = ['EN', 'FR', 'ES', 'DE', 'ZH'];
export const INTENTS = ['Commercial', 'Informational', 'Navigational'];
export const PRIORITIES = ['High', 'Medium-High', 'Medium', 'Low-Medium', 'Low'];
export const PRIORITY_RANK: Record<string, number> = {
  High: 0, 'Medium-High': 1, Medium: 2, 'Low-Medium': 3, Low: 4,
};

export type KeywordInput = Omit<Keyword, 'id'>;

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }

function hydrate(): State {
  try {
    const raw = document.getElementById('keywords-data')?.textContent?.trim();
    if (raw) return JSON.parse(raw) as State;
  } catch { /* fall through */ }
  return {};
}
let state: State = hydrate();

// ---- API helper ------------------------------------------------------------
function tok(): string { return sessionStorage.getItem('bbg_session') ?? ''; }
async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`/api/keywords${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}`, ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { msg = (await res.json()).error ?? msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

let onResync: (() => void) | null = null;
export function setKeywordResyncHandler(fn: () => void) { onResync = fn; }
function bg(promise: Promise<unknown>) {
  promise.catch(async err => {
    console.error('[keywords] write failed:', err);
    try { state = await api(''); } catch { /* ignore */ }
    onResync?.();
    alert(`Could not save the change: ${(err as Error).message}`);
  });
}
const uuid = () => crypto.randomUUID();

// ---- synchronous reads -----------------------------------------------------
export function listKeywords(projectId: string): Keyword[] {
  return clone(state[projectId] ?? []);
}

// ---- optimistic writes -----------------------------------------------------
export function addKeyword(projectId: string, input: KeywordInput): Keyword {
  const kw: Keyword = { ...clone(input), id: uuid() };
  (state[projectId] ??= []).push(kw);
  bg(api('', { method: 'POST', body: JSON.stringify({ id: kw.id, projectId, ...input }) }));
  return clone(kw);
}

export function updateKeyword(projectId: string, id: string, patch: Partial<KeywordInput>) {
  const kw = (state[projectId] ?? []).find(k => k.id === id);
  if (!kw) return;
  Object.assign(kw, clone(patch), { id: kw.id });
  bg(api(`/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }));
}

export function removeKeyword(projectId: string, id: string) {
  if (!state[projectId]) return;
  state[projectId] = state[projectId].filter(k => k.id !== id);
  bg(api(`/${id}`, { method: 'DELETE' }));
}

// Duplicate a row right after the original so it's easy to tweak the copy.
export function duplicateKeyword(projectId: string, id: string): Keyword | null {
  const list = state[projectId];
  if (!list) return null;
  const idx = list.findIndex(k => k.id === id);
  if (idx < 0) return null;
  const copy: Keyword = { ...clone(list[idx]), id: uuid() };
  list.splice(idx + 1, 0, copy);
  const { id: _omit, ...input } = copy;
  bg(api('', { method: 'POST', body: JSON.stringify({ id: copy.id, projectId, ...input }) }));
  return clone(copy);
}

// Reset a project's keywords back to the seed (async; callers await).
export async function resetKeywords(projectId: string): Promise<void> {
  const fresh = (await api(`/reset?project=${encodeURIComponent(projectId)}`, { method: 'POST' })) as Keyword[];
  state[projectId] = fresh;
}

// Drop a deleted project's keywords from the cache (DB cascade handled the rest).
export function purgeProjectKeywords(projectId: string) {
  if (state[projectId]) delete state[projectId];
}
