// Client-side GTM task store. Seeded from the GTM plan (gtm.json) on first use,
// then persisted to localStorage so add / edit / delete / move all survive
// reloads and stay in sync across the homepage board and the /gtm board.
import gtm from '../data/gtm.json';

export interface Task {
  id: string;
  title: string;
  status: string; // column id: todo | doing | done
}
type State = Record<string, Task[]>; // projectId -> tasks

const KEY = 'bbg_gtm_tasks_v1';

export const columns = gtm.columns as { id: string; label: string }[];
export const projects = gtm.projects.map(p => ({ id: p.id, name: p.name, color: p.color }));

let counter = 0;
function uid(): string {
  counter += 1;
  return 't' + Date.now().toString(36) + counter.toString(36);
}

function seed(): State {
  const s: State = {};
  for (const p of gtm.projects) {
    s[p.id] = p.tasks.map((t, i) => ({ id: `${p.id}-${i}`, title: t.title, status: t.status }));
  }
  return s;
}

let state: State | null = null;
function db(): State {
  if (state) return state;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      state = JSON.parse(raw);
      return state!;
    }
  } catch {
    /* fall through to seed */
  }
  state = seed();
  persist();
  return state;
}
function persist() {
  if (state) localStorage.setItem(KEY, JSON.stringify(state));
}

export function tasksFor(projectId: string, status: string): Task[] {
  return (db()[projectId] ?? []).filter(t => t.status === status);
}
export function allTasks(projectId: string): Task[] {
  return db()[projectId] ?? [];
}
export function addTask(projectId: string, status: string, title: string): Task {
  const s = db();
  if (!s[projectId]) s[projectId] = [];
  const task: Task = { id: uid(), title, status };
  s[projectId].push(task);
  persist();
  return task;
}
export function updateTask(projectId: string, id: string, title: string) {
  const task = (db()[projectId] ?? []).find(t => t.id === id);
  if (task) {
    task.title = title;
    persist();
  }
}
export function moveTask(projectId: string, id: string, status: string) {
  const task = (db()[projectId] ?? []).find(t => t.id === id);
  if (task && task.status !== status) {
    task.status = status;
    persist();
  }
}
export function removeTask(projectId: string, id: string) {
  const s = db();
  if (s[projectId]) {
    s[projectId] = s[projectId].filter(t => t.id !== id);
    persist();
  }
}
export function resetAll() {
  state = seed();
  persist();
}
