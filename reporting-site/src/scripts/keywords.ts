// Client-side keyword store. Seeded from data/keywords.json on first use, then
// persisted to localStorage so add / edit / delete / duplicate all survive
// reloads. Scoped per project (projectId -> Keyword[]), mirroring how
// src/scripts/kanban.ts handles GTM tasks.
import seedData from '../data/keywords.json';

export interface Keyword {
  id: string;
  keyword: string;
  language: string;
  intent: string;
  cluster: string;
  priority: string;
}
type State = Record<string, Keyword[]>; // projectId -> keywords

const KEY = 'bbg_keywords_v1';

// Controlled vocabularies for the editor dropdowns. Free text is still allowed
// for cluster; language/intent/priority are constrained for clean sorting.
export const LANGUAGES = ['EN', 'FR', 'ES', 'DE', 'ZH'];
export const INTENTS = ['Commercial', 'Informational', 'Navigational'];
export const PRIORITIES = ['High', 'Medium-High', 'Medium', 'Low-Medium', 'Low'];

// Sort rank for the ordinal priority column (High first).
export const PRIORITY_RANK: Record<string, number> = {
  High: 0,
  'Medium-High': 1,
  Medium: 2,
  'Low-Medium': 3,
  Low: 4,
};

const SEED = seedData.projects as Record<string, Keyword[]>;

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

function seed(): State {
  return clone(SEED);
}

let counter = 0;
function uid(): string {
  counter += 1;
  return 'kw' + Date.now().toString(36) + counter.toString(36);
}

let state: State | null = null;
function db(): State {
  if (state) return state;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      state = JSON.parse(raw) as State;
      return state!;
    }
  } catch {
    /* fall through to seed */
  }
  state = seed();
  persist();
  return state;
}
function persist() {
  if (state) localStorage.setItem(KEY, JSON.stringify(state));
}

export type KeywordInput = Omit<Keyword, 'id'>;

export function listKeywords(projectId: string): Keyword[] {
  return clone(db()[projectId] ?? []);
}

export function addKeyword(projectId: string, input: KeywordInput): Keyword {
  const s = db();
  if (!s[projectId]) s[projectId] = [];
  const kw: Keyword = { ...clone(input), id: uid() };
  s[projectId].push(kw);
  persist();
  return clone(kw);
}

export function updateKeyword(projectId: string, id: string, patch: Partial<KeywordInput>) {
  const kw = (db()[projectId] ?? []).find(k => k.id === id);
  if (kw) {
    Object.assign(kw, clone(patch), { id: kw.id });
    persist();
  }
}

export function removeKeyword(projectId: string, id: string) {
  const s = db();
  if (s[projectId]) {
    s[projectId] = s[projectId].filter(k => k.id !== id);
    persist();
  }
}

// Duplicate a row right after the original so it's easy to tweak the copy.
export function duplicateKeyword(projectId: string, id: string): Keyword | null {
  const s = db();
  const list = s[projectId];
  if (!list) return null;
  const idx = list.findIndex(k => k.id === id);
  if (idx < 0) return null;
  const copy: Keyword = { ...clone(list[idx]), id: uid() };
  list.splice(idx + 1, 0, copy);
  persist();
  return clone(copy);
}

// Reset a single project's keywords back to the JSON seed (empty if unseeded).
export function resetKeywords(projectId: string) {
  const s = db();
  s[projectId] = clone(SEED[projectId] ?? []);
  persist();
}

// Drop all keywords for a deleted project so its store entry doesn't linger.
export function purgeProjectKeywords(projectId: string) {
  const s = db();
  if (s[projectId]) {
    delete s[projectId];
    persist();
  }
}
