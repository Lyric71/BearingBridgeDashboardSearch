// Server-side repository for blog_articles — the individual articles a 'blog'
// content plan proposes. Each is accept/delete-able and, once accepted, tracks
// publication (published flag + URL). Supabase is the single source of truth.
import { db } from './db';

export type ArticleStatus = 'proposed' | 'accepted';
export interface BlogArticle {
  id: string;
  content_plan_id: string | null;
  project_id: string | null;
  cluster: string | null;
  language: string;
  sort_order: number;
  title: string;
  primary_keyword: string | null;
  secondary_keywords: string | null;
  intent: string | null;
  funnel_stage: string | null;
  est_words: number | null;
  role: string | null;
  slug: string | null;
  outline_md: string | null;
  status: ArticleStatus;
  published: boolean;
  published_url: string | null;
  created_at: string;
  updated_at: string;
}

const COLS =
  'id,content_plan_id,project_id,cluster,language,sort_order,title,primary_keyword,secondary_keywords,intent,funnel_stage,est_words,role,slug,outline_md,status,published,published_url,created_at,updated_at';

// Every article, oldest→newest within a plan (for SSR grouping by plan).
export async function listBlogArticles(): Promise<BlogArticle[]> {
  const { data, error } = await db
    .from('blog_articles')
    .select(COLS)
    .order('content_plan_id')
    .order('sort_order');
  if (error) throw new Error(error.message);
  return data as BlogArticle[];
}

// Existing articles for a cluster — used to tell Claude what NOT to duplicate,
// and to continue sort_order when appending a new batch.
export async function listArticlesForCluster(
  projectId: string, cluster: string, language: string,
): Promise<BlogArticle[]> {
  const { data, error } = await db
    .from('blog_articles')
    .select(COLS)
    .eq('project_id', projectId)
    .eq('cluster', cluster)
    .eq('language', language)
    .order('sort_order');
  if (error) throw new Error(error.message);
  return data as BlogArticle[];
}

export interface BlogArticleInput {
  content_plan_id: string | null;
  project_id: string | null;
  cluster: string | null;
  language: string;
  sort_order: number;
  title: string;
  primary_keyword: string | null;
  secondary_keywords: string | null;
  intent: string | null;
  funnel_stage: string | null;
  est_words: number | null;
  role: string | null;
  slug: string | null;
  outline_md: string | null;
}

// Insert a batch of freshly-proposed articles (append; never replaces existing).
export async function createBlogArticles(rows: BlogArticleInput[]): Promise<BlogArticle[]> {
  if (rows.length === 0) return [];
  const { data, error } = await db.from('blog_articles').insert(rows).select(COLS);
  if (error) throw new Error(error.message);
  return data as BlogArticle[];
}

export interface BlogArticlePatch {
  status?: ArticleStatus;
  published?: boolean;
  published_url?: string | null;
}

export async function updateBlogArticle(id: string, patch: BlogArticlePatch): Promise<BlogArticle | null> {
  const row: Record<string, unknown> = {};
  if (patch.status === 'proposed' || patch.status === 'accepted') row.status = patch.status;
  if (typeof patch.published === 'boolean') row.published = patch.published;
  if ('published_url' in patch) row.published_url = patch.published_url || null;
  if (Object.keys(row).length === 0) return null;
  const { data, error } = await db.from('blog_articles').update(row).eq('id', id).select(COLS).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? (data as BlogArticle) : null;
}

export async function deleteBlogArticle(id: string): Promise<void> {
  const { error } = await db.from('blog_articles').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
