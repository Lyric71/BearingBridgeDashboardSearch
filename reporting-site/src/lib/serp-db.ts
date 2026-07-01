// Server-side SERP report + refresh-history repository (read side).
import { db } from './db';

export interface SerpReport {
  cluster: string;
  title: string | null;
  report_date: string | null;
  content_md: string;
  indicators: Record<string, number> | null;
}

export async function listReports(projectId: string): Promise<SerpReport[]> {
  const { data, error } = await db
    .from('serp_reports')
    .select('cluster,title,report_date,content_md,indicators')
    .eq('project_id', projectId)
    .order('cluster');
  if (error) throw new Error(error.message);
  return data as SerpReport[];
}

export async function listHistory(projectId: string): Promise<SerpHistoryEntry[]> {
  const { data, error } = await db
    .from('serp_history')
    .select('cluster,label,ts,before,after')
    .eq('project_id', projectId)
    .order('ts');
  if (error) throw new Error(error.message);
  return data as SerpHistoryEntry[];
}

// Per-keyword refresh history: one row per keyword (the latest refresh), holding
// the previous refresh's rank (before) and this refresh's rank (after).
export interface KeywordHistoryEntry {
  cluster: string; keyword: string;
  before_rank: number | null; after_rank: number | null;
  before_ts: string | null; after_ts: string | null;
}

export async function listKeywordHistory(projectId: string): Promise<KeywordHistoryEntry[]> {
  const { data, error } = await db
    .from('serp_keyword_history')
    .select('cluster,keyword,before_rank,after_rank,before_ts,after_ts')
    .eq('project_id', projectId)
    .order('cluster')
    .order('keyword');
  if (error) throw new Error(error.message);
  return data as KeywordHistoryEntry[];
}
