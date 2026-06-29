// Client-side GTM task store, backed by the database via /api/tasks.
//
// The DB is the single source of truth. Reads are SYNCHRONOUS from an in-memory
// cache hydrated from the server-rendered JSON (#tasks-data / #columns-data in
// Layout.astro), so the existing synchronous board code keeps working. Writes
// are OPTIMISTIC: the cache updates immediately (board re-renders) and the API
// call runs in the background; on failure we resync from the server and alert.
import { listProjects } from './projects';

export interface Task {
  id: string;
  title: string;
  status: string; // column id: todo | doing | done
}
type State = Record<string, Task[]>; // projectId -> tasks

function hydrate<T>(id: string, fallback: T): T {
  try {
    const raw = document.getElementById(id)?.textContent?.trim();
    if (raw) return JSON.parse(raw) as T;
  } catch { /* fall through */ }
  return fallback;
}

export const columns = hydrate<{ id: string; label: string }[]>('columns-data', [
  { id: 'todo', label: 'To Do' },
  { id: 'doing', label: 'In Progress' },
  { id: 'done', label: 'Done' },
]);

// Project metadata is owned by the project store; tasks key off project ids.
export const projects = () => listProjects().map(p => ({ id: p.id, name: p.name, color: p.color }));

let state: State = hydrate<State>('tasks-data', {});

// ---- API helper ------------------------------------------------------------
function token(): string {
  return sessionStorage.getItem('bbg_session') ?? '';
}
async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`/api/tasks${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { msg = (await res.json()).error ?? msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

// Background write helper: on failure, resync from server + re-render + alert.
let onResync: (() => void) | null = null;
export function setTaskResyncHandler(fn: () => void) { onResync = fn; }
function bg(promise: Promise<unknown>) {
  promise.catch(async err => {
    console.error('[tasks] write failed:', err);
    try { state = await api(''); } catch { /* ignore */ }
    onResync?.();
    alert(`Could not save the change: ${(err as Error).message}`);
  });
}

function uuid(): string {
  return crypto.randomUUID();
}

// ---- synchronous reads -----------------------------------------------------
export function tasksFor(projectId: string, status: string): Task[] {
  return (state[projectId] ?? []).filter(t => t.status === status);
}
export function allTasks(projectId: string): Task[] {
  return state[projectId] ?? [];
}

// ---- optimistic writes -----------------------------------------------------
export function addTask(projectId: string, status: string, title: string): Task {
  const task: Task = { id: uuid(), title, status };
  (state[projectId] ??= []).push(task);
  bg(api('', { method: 'POST', body: JSON.stringify({ id: task.id, projectId, title, status }) }));
  return task;
}
export function updateTask(projectId: string, id: string, title: string) {
  const task = (state[projectId] ?? []).find(t => t.id === id);
  if (!task) return;
  task.title = title;
  bg(api(`/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }));
}
export function moveTask(projectId: string, id: string, status: string) {
  const task = (state[projectId] ?? []).find(t => t.id === id);
  if (!task || task.status === status) return;
  task.status = status;
  bg(api(`/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }));
}
export function removeTask(projectId: string, id: string) {
  if (!state[projectId]) return;
  state[projectId] = state[projectId].filter(t => t.id !== id);
  bg(api(`/${id}`, { method: 'DELETE' }));
}

export async function resetAll() {
  state = await api('/reset', { method: 'POST' });
}

// Drop a deleted project's tasks from the cache. The DB cascade already removed
// them server-side when the project was deleted, so this is cache-only.
export function purgeProject(projectId: string) {
  if (state[projectId]) delete state[projectId];
}
