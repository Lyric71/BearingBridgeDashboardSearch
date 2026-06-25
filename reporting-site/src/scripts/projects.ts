// Client-side project store. Seeded from the GTM plan (gtm.json) on first use,
// then persisted to localStorage so create / edit / delete all survive reloads
// and stay in sync across the global project selector and the /gtm board.
//
// Projects are the top-level entry for the whole dashboard. gtm.json is the
// build-time seed; once a browser has edited the set, this store is the source
// of truth for that browser (mirrors how src/scripts/kanban.ts handles tasks).
import gtm from '../data/gtm.json';

export interface Channels {
  seo: string;
  sem: string;
  email: string;
}

// Modules a project can opt into. A module that's off simply doesn't appear for
// that project (nav entry, drill-in link and page are all hidden/gated).
export interface Modules {
  kanban: boolean;
  seo: boolean;
  googleAds: boolean;
}

// UI metadata: order + labels for the module pickers.
export const MODULES: { key: keyof Modules; label: string }[] = [
  { key: 'kanban', label: 'Kanban' },
  { key: 'seo', label: 'SEO' },
  { key: 'googleAds', label: 'Google Ads' },
];

export interface Project {
  id: string;
  name: string;
  color: string;
  owner: string;
  // Every project MUST be linked to a website (mandatory). Stored as a full URL.
  website: string;
  targetCustomers: string;
  preciseTargeting: string;
  rtb: string;
  emailTarget: string;
  channels: Channels;
  modules: Modules;
}

function ensureModules(m?: Partial<Modules>): Modules {
  return {
    kanban: m?.kanban ?? true,
    seo: m?.seo ?? true,
    googleAds: m?.googleAds ?? true,
  };
}

const KEY = 'bbg_gtm_projects_v1';

// Brand palette offered in the project editor (maps to global.css CSS vars).
export const PALETTE: { label: string; value: string }[] = [
  { label: 'Blue', value: 'var(--bbg-blue)' },
  { label: 'Purple', value: 'var(--bbg-purple)' },
  { label: 'Red', value: 'var(--bbg-red)' },
  { label: 'Orange', value: 'var(--bbg-orange)' },
  { label: 'Slate', value: 'var(--bbg-gray-dark)' },
];

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

function seed(): Project[] {
  return gtm.projects.map(p => {
    const channels = {
      seo: p.channels?.seo ?? '',
      sem: p.channels?.sem ?? '',
      email: p.channels?.email ?? '',
    };
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      owner: p.owner ?? '',
      website: p.website ?? '',
      targetCustomers: p.targetCustomers ?? '',
      preciseTargeting: p.preciseTargeting ?? '',
      rtb: p.rtb ?? '',
      emailTarget: p.emailTarget ?? '',
      channels,
      // Seed modules from the existing plan: every seeded project has a GTM
      // board; SEO / Google Ads follow the project's declared channels.
      modules: {
        kanban: true,
        seo: /^yes/i.test(channels.seo),
        googleAds: /^yes/i.test(channels.sem),
      },
    };
  });
}

let state: Project[] | null = null;
function db(): Project[] {
  if (state) return state;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      // Normalize older stored projects that predate the modules field.
      state = (JSON.parse(raw) as Project[]).map(p => ({ ...p, modules: ensureModules(p.modules) }));
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

export function listProjects(): Project[] {
  return clone(db());
}
export function getProject(id: string): Project | undefined {
  const p = db().find(x => x.id === id);
  return p ? clone(p) : undefined;
}

// Slugify a name into an id, guaranteeing uniqueness against the current set.
function makeId(name: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .slice(0, 40) || 'project';
  const existing = new Set(db().map(p => p.id));
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}${n}`)) n += 1;
  return `${base}${n}`;
}

export type ProjectInput = Omit<Project, 'id'>;

export function createProject(input: ProjectInput): Project {
  const s = db();
  const project: Project = { ...clone(input), modules: ensureModules(input.modules), id: makeId(input.name) };
  s.push(project);
  persist();
  return clone(project);
}

// Patch a project's editable fields. The id is immutable (tasks key off it).
export function updateProject(id: string, patch: Partial<ProjectInput>) {
  const p = db().find(x => x.id === id);
  if (!p) return;
  Object.assign(p, clone(patch), { id: p.id });
  persist();
}

export function deleteProject(id: string) {
  state = db().filter(p => p.id !== id);
  persist();
}

export function resetProjects(): Project[] {
  state = seed();
  persist();
  return clone(state);
}
