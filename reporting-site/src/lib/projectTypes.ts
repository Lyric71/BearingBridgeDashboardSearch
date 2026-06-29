// Shared project types + UI constants. No server or browser dependencies, so
// both the server repo (src/lib/projects-db.ts) and the client store
// (src/scripts/projects.ts) can import it safely.

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

export type ProjectInput = Omit<Project, 'id'>;

// UI metadata: order + labels for the module pickers.
export const MODULES: { key: keyof Modules; label: string }[] = [
  { key: 'kanban', label: 'Kanban' },
  { key: 'seo', label: 'SEO' },
  { key: 'googleAds', label: 'Google Ads' },
];

// Brand palette offered in the project editor (maps to global.css CSS vars).
export const PALETTE: { label: string; value: string }[] = [
  { label: 'Blue', value: 'var(--bbg-blue)' },
  { label: 'Purple', value: 'var(--bbg-purple)' },
  { label: 'Red', value: 'var(--bbg-red)' },
  { label: 'Orange', value: 'var(--bbg-orange)' },
  { label: 'Slate', value: 'var(--bbg-gray-dark)' },
];

export function ensureModules(m?: Partial<Modules>): Modules {
  return {
    kanban: m?.kanban ?? true,
    seo: m?.seo ?? true,
    googleAds: m?.googleAds ?? true,
  };
}
