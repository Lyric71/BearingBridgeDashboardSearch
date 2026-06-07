import { readdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import gtm from '../data/gtm.json';

export interface ProjectMeta {
  id: string;
  name: string;
  color: string;
  owner: string;
}

// The project is the top-level entry for the whole dashboard. The GTM plan is
// the single source of truth for which projects exist.
export const projects: ProjectMeta[] = gtm.projects.map(p => ({
  id: p.id,
  name: p.name,
  color: p.color,
  owner: p.owner,
}));

// Repo root (the Astro site lives in reporting-site/).
export const ROOT = join(process.cwd(), '..');

// Per-project data lives under data/projects/<id>/. Beyond Border Group also
// falls back to the original (pre-multi-project) data locations.
export function projectDir(id: string): string {
  return join(ROOT, 'data', 'projects', id);
}

export function readMdFiles(dir: string, prefix = ''): { file: string; raw: string }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.md') && f.startsWith(prefix))
    .sort()
    .map(f => ({ file: f, raw: readFileSync(join(dir, f), 'utf8') }));
}

export function readJsonIfExists<T>(path: string): T | null {
  try {
    return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : null;
  } catch {
    return null;
  }
}
