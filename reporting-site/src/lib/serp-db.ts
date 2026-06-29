// Server-side SERP report + refresh-history repository (read side).
import { db } from './db';

export interface SerpReport {
  cluster: string;
  title: string | null;
  report_date: string | null;
  content_md: string;
  indicators: Record<string, number> | null;
}
export interface SerpHistoryEntry {
  cluster: string; label: string | null; ts: string;
  before: any; after: any;
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
