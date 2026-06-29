// Server-side project repository. Maps DB rows (snake_case) <-> the app's
// Project shape (camelCase). Used by API routes and by Layout's SSR.
import { db } from './db';
import {
  ensureModules,
  type Project,
  type ProjectInput,
  type Channels,
  type Modules,
} from './projectTypes';

// The columns we read; sort_order keeps the display order stable.
const COLS = 'id,name,color,owner,website,target_customers,precise_targeting,rtb,email_target,channels,modules,sort_order';

interface ProjectRow {
  id: string;
  name: string;
  color: string;
  owner: string;
  website: string;
  target_customers: string;
  precise_targeting: string;
  rtb: string;
  email_target: string;
  channels: Channels;
  modules: Modules;
  sort_order: number;
}

function toProject(r: ProjectRow): Project {
  return {
    id: r.id,
    name: r.name,
    color: r.color,
    owner: r.owner ?? '',
    website: r.website ?? '',
    targetCustomers: r.target_customers ?? '',
    preciseTargeting: r.precise_targeting ?? '',
    rtb: r.rtb ?? '',
    emailTarget: r.email_target ?? '',
    channels: {
      seo: r.channels?.seo ?? '',
      sem: r.channels?.sem ?? '',
      email: r.channels?.email ?? '',
    },
    modules: ensureModules(r.modules),
  };
}

// Map the camelCase input to DB columns. `sort_order` handled by callers.
function toRow(input: Partial<ProjectInput>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (input.name !== undefined) row.name = input.name;
  if (input.color !== undefined) row.color = input.color;
  if (input.owner !== undefined) row.owner = input.owner;
  if (input.website !== undefined) row.website = input.website;
  if (input.targetCustomers !== undefined) row.target_customers = input.targetCustomers;
  if (input.preciseTargeting !== undefined) row.precise_targeting = input.preciseTargeting;
  if (input.rtb !== undefined) row.rtb = input.rtb;
  if (input.emailTarget !== undefined) row.email_target = input.emailTarget;
  if (input.channels !== undefined) row.channels = input.channels;
  if (input.modules !== undefined) row.modules = ensureModules(input.modules);
  return row;
}

export async function listProjects(): Promise<Project[]> {
  const { data, error } = await db.from('projects').select(COLS).order('sort_order');
  if (error) throw new Error(error.message);
  return (data as ProjectRow[]).map(toProject);
}

export async function getProject(id: string): Promise<Project | null> {
  const { data, error } = await db.from('projects').select(COLS).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toProject(data as ProjectRow) : null;
}

// Slugify a name into an id, guaranteeing uniqueness against existing ids.
async function makeId(name: string): Promise<string> {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 40) || 'project';
  const { data, error } = await db.from('projects').select('id');
  if (error) throw new Error(error.message);
  const existing = new Set((data ?? []).map(r => r.id as string));
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}${n}`)) n += 1;
  return `${base}${n}`;
}

export async function createProject(input: ProjectInput): Promise<Project> {
  const id = await makeId(input.name);
  // New projects go to the end of the list.
  const { count } = await db.from('projects').select('*', { count: 'exact', head: true });
  const row = { id, ...toRow(input), modules: ensureModules(input.modules), sort_order: count ?? 0 };
  const { data, error } = await db.from('projects').insert(row).select(COLS).single();
  if (error) throw new Error(error.message);
  return toProject(data as ProjectRow);
}

export async function updateProject(id: string, patch: Partial<ProjectInput>): Promise<Project | null> {
  const row = toRow(patch);
  if (Object.keys(row).length === 0) return getProject(id);
  const { data, error } = await db.from('projects').update(row).eq('id', id).select(COLS).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toProject(data as ProjectRow) : null;
}

export async function deleteProject(id: string): Promise<void> {
  // tasks/keywords/serp_reports/ads_snapshots cascade via FK ON DELETE CASCADE.
  const { error } = await db.from('projects').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
