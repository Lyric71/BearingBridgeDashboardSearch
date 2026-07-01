// Server-side content-plan repository (read side). Supabase is the single
// source of truth; briefs are written by src/lib/content-plan.ts.
import { db } from './db';

export interface Competitor { rank: number; domain: string; title: string; url: string; }
export interface ContentPlanIndicators {
  volume: number | null; cpc: number | null; competition: number | null;
  intent: string | null; competitors: Competitor[] | null;
}
export interface ContentPlan {
  id: string;
  project_id: string | null;
  keyword: string;
  language: string;
  target_url: string | null;
  plan_md: string;
  indicators: ContentPlanIndicators | null;
  created_at: string;
  updated_at: string;
}

export async function listContentPlans(): Promise<ContentPlan[]> {
  const { data, error } = await db
    .from('content_plans')
    .select('id,project_id,keyword,language,target_url,plan_md,indicators,created_at,updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data as ContentPlan[];
}
