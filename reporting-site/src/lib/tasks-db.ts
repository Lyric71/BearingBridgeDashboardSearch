// Server-side GTM task + board-column repository.
import { db } from './db';
import gtm from '../data/gtm.json';

export interface Task {
  id: string;
  title: string;
  status: string; // column id
}
export type TaskState = Record<string, Task[]>; // projectId -> tasks
export interface Column { id: string; label: string }

interface TaskRow { id: string; project_id: string; title: string; status: string; sort_order: number }

export async function listColumns(): Promise<Column[]> {
  const { data, error } = await db.from('board_columns').select('id,label').order('sort_order');
  if (error) throw new Error(error.message);
  return data as Column[];
}

// All tasks, grouped by project id (matches the client store's State shape).
export async function listTasksGrouped(): Promise<TaskState> {
  const { data, error } = await db
    .from('tasks').select('id,project_id,title,status,sort_order')
    .order('project_id').order('sort_order');
  if (error) throw new Error(error.message);
  const out: TaskState = {};
  for (const r of data as TaskRow[]) {
    (out[r.project_id] ??= []).push({ id: r.id, title: r.title, status: r.status });
  }
  return out;
}

async function nextOrder(projectId: string): Promise<number> {
  const { count } = await db
    .from('tasks').select('*', { count: 'exact', head: true }).eq('project_id', projectId);
  return count ?? 0;
}

export async function createTask(input: {
  id?: string; projectId: string; title: string; status: string;
}): Promise<Task> {
  const row: Record<string, unknown> = {
    project_id: input.projectId,
    title: input.title,
    status: input.status,
    sort_order: await nextOrder(input.projectId),
  };
  if (input.id) row.id = input.id; // client may supply a uuid for optimistic UI
  const { data, error } = await db.from('tasks').insert(row).select('id,title,status').single();
  if (error) throw new Error(error.message);
  return data as Task;
}

export async function updateTask(id: string, patch: { title?: string; status?: string }): Promise<Task | null> {
  const row: Record<string, unknown> = {};
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.status !== undefined) row.status = patch.status;
  if (Object.keys(row).length === 0) return null;
  const { data, error } = await db.from('tasks').update(row).eq('id', id).select('id,title,status').maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Task) ?? null;
}

export async function deleteTask(id: string): Promise<void> {
  const { error } = await db.from('tasks').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// Reset all tasks back to the original GTM plan (gtm.json). Discards changes.
export async function resetTasks(): Promise<TaskState> {
  const { error: delErr } = await db.from('tasks').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (delErr) throw new Error(delErr.message);
  const rows: { project_id: string; title: string; status: string; sort_order: number }[] = [];
  for (const p of gtm.projects) {
    (p.tasks ?? []).forEach((t, i) => rows.push({ project_id: p.id, title: t.title, status: t.status, sort_order: i }));
  }
  if (rows.length) {
    const { error } = await db.from('tasks').insert(rows);
    if (error) throw new Error(error.message);
  }
  return listTasksGrouped();
}
