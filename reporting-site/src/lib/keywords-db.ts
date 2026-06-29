// Server-side keyword repository.
import { db } from './db';
import seed from '../data/keywords.json';

export interface Keyword {
  id: string;
  keyword: string;
  language: string;
  intent: string;
  cluster: string;
  priority: string;
}
export type KeywordState = Record<string, Keyword[]>; // projectId -> keywords

interface KeywordRow {
  id: string; project_id: string; keyword: string;
  language: string; intent: string | null; cluster: string | null; priority: string | null;
}

const toKw = (r: KeywordRow): Keyword => ({
  id: r.id,
  keyword: r.keyword,
  language: r.language ?? '',
  intent: r.intent ?? '',
  cluster: r.cluster ?? '',
  priority: r.priority ?? '',
});

export async function listKeywordsGrouped(): Promise<KeywordState> {
  const { data, error } = await db
    .from('keywords').select('id,project_id,keyword,language,intent,cluster,priority')
    .order('project_id').order('cluster').order('keyword');
  if (error) throw new Error(error.message);
  const out: KeywordState = {};
  for (const r of data as KeywordRow[]) (out[r.project_id] ??= []).push(toKw(r));
  return out;
}

interface KeywordInput { keyword: string; language: string; intent: string; cluster: string; priority: string }

export async function createKeyword(projectId: string, input: KeywordInput, id?: string): Promise<Keyword> {
  const row: Record<string, unknown> = { project_id: projectId, ...input };
  if (id) row.id = id;
  const { data, error } = await db.from('keywords').insert(row)
    .select('id,project_id,keyword,language,intent,cluster,priority').single();
  if (error) throw new Error(error.message);
  return toKw(data as KeywordRow);
}

export async function updateKeyword(id: string, patch: Partial<KeywordInput>): Promise<Keyword | null> {
  const row: Record<string, unknown> = {};
  for (const k of ['keyword', 'language', 'intent', 'cluster', 'priority'] as const) {
    if (patch[k] !== undefined) row[k] = patch[k];
  }
  if (Object.keys(row).length === 0) return null;
  const { data, error } = await db.from('keywords').update(row).eq('id', id)
    .select('id,project_id,keyword,language,intent,cluster,priority').maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toKw(data as KeywordRow) : null;
}

export async function deleteKeyword(id: string): Promise<void> {
  const { error } = await db.from('keywords').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// Reset a single project's keywords back to the keywords.json seed.
export async function resetKeywords(projectId: string): Promise<Keyword[]> {
  const { error: delErr } = await db.from('keywords').delete().eq('project_id', projectId);
  if (delErr) throw new Error(delErr.message);
  const seedList = (seed.projects as Record<string, any[]>)[projectId] ?? [];
  if (seedList.length) {
    const rows = seedList.map(k => ({
      project_id: projectId, legacy_id: k.id ?? null, keyword: k.keyword,
      language: k.language ?? 'EN', intent: k.intent ?? null,
      cluster: k.cluster ?? null, priority: k.priority ?? null,
    }));
    const { error } = await db.from('keywords').insert(rows);
    if (error) throw new Error(error.message);
  }
  const grouped = await listKeywordsGrouped();
  return grouped[projectId] ?? [];
}
