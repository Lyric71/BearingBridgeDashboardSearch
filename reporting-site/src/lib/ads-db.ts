// Server-side Google Ads snapshot repository (read side).
import { db } from './db';

// Shape the click-report page expects (mirrors the old JSON export).
export interface AdsPerf {
  account: string | null;
  date: string;            // snapshot_date
  currency: string | null;
  timeframes: Record<string, any>;
}

// Most recent snapshot for a project (or null if none).
export async function latestAdsSnapshot(projectId: string): Promise<AdsPerf | null> {
  const { data, error } = await db
    .from('ads_snapshots')
    .select('snapshot_date,account,currency,data')
    .eq('project_id', projectId)
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    account: data.account,
    date: data.snapshot_date,
    currency: data.currency,
    timeframes: data.data ?? {},
  };
}
