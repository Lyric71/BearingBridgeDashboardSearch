// Renders Kanban cards from the task store into any [data-kanban-zone] on the
// page and wires up CRUD: add (per column), edit (inline), delete, drag-to-move.
// Used by both the homepage board and the /gtm board.
import {
  projects,
  columns,
  tasksFor,
  allTasks,
  addTask,
  updateTask,
  moveTask,
  removeTask,
  resetAll,
  type Task,
} from './kanban';

const colorOf = (pid: string): string =>
  projects().find(p => p.id === pid)?.color || '#999';

function iconButton(symbol: string, label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = symbol;
  b.title = label;
  b.setAttribute('aria-label', label);
  b.className =
    'w-5 h-5 flex items-center justify-center rounded text-xs text-gray-400 hover:text-gray-700 hover:bg-gray-100';
  return b;
}

function startEdit(card: HTMLElement, pid: string, task: Task) {
  const titleEl = card.querySelector<HTMLElement>('.kanban-title');
  if (!titleEl || card.querySelector('input')) return;
  const input = document.createElement('input');
  input.value = task.title;
  input.className = 'w-full border border-gray-300 rounded px-1.5 py-1 text-sm focus:outline-none focus:border-gray-500';
  card.draggable = false;
  titleEl.replaceWith(input);
  input.focus();
  input.select();
  let settled = false;
  const commit = (saveIt: boolean) => {
    if (settled) return;
    settled = true;
    const v = input.value.trim();
    if (saveIt && v) updateTask(pid, task.id, v);
    render();
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') commit(true);
    else if (e.key === 'Escape') commit(false);
  });
  input.addEventListener('blur', () => commit(true));
}

function cardEl(pid: string, task: Task): HTMLElement {
  const card = document.createElement('div');
  card.className =
    'kanban-card group/card relative bg-white rounded-xl border border-gray-100 pl-3 pr-12 py-2.5 text-sm cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow';
  card.draggable = true;
  card.dataset.kanbanCard = task.id;
  card.style.borderLeft = `3px solid ${colorOf(pid)}`;

  const title = document.createElement('span');
  title.className = 'kanban-title block break-words';
  title.textContent = task.title;
  card.appendChild(title);

  const actions = document.createElement('div');
  actions.className =
    'absolute right-2 top-1/2 -translate-y-1/2 flex gap-0.5 opacity-0 group-hover/card:opacity-100 transition-opacity';
  const edit = iconButton('✎', 'Edit task');
  const del = iconButton('✕', 'Delete task');
  actions.append(edit, del);
  card.appendChild(actions);

  edit.addEventListener('click', e => { e.stopPropagation(); startEdit(card, pid, task); });
  del.addEventListener('click', e => {
    e.stopPropagation();
    if (confirm(`Delete “${task.title}”?`)) { removeTask(pid, task.id); render(); }
  });
  card.addEventListener('dblclick', () => startEdit(card, pid, task));

  return card;
}

function render() {
  // Cards
  document.querySelectorAll<HTMLElement>('[data-kanban-zone]').forEach(zone => {
    const [pid, col] = zone.dataset.kanbanZone!.split(':');
    zone.querySelectorAll('.kanban-card, .kanban-new').forEach(n => n.remove());
    tasksFor(pid, col).forEach(t => zone.appendChild(cardEl(pid, t)));
  });
  // Counts
  document.querySelectorAll<HTMLElement>('[data-kanban-count]').forEach(badge => {
    const [pid, col] = badge.dataset.kanbanCount!.split(':');
    badge.textContent = String(tasksFor(pid, col).length);
  });
  // Progress
  document.querySelectorAll<HTMLElement>('[data-kanban-bar]').forEach(bar => {
    const pid = bar.dataset.kanbanBar!;
    const total = allTasks(pid).length;
    const done = tasksFor(pid, 'done').length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    bar.style.width = pct + '%';
    const set = (sel: string, val: string) =>
      document.querySelectorAll<HTMLElement>(sel).forEach(el => { el.textContent = val; });
    set(`[data-kanban-pct="${pid}"]`, pct + '%');
    set(`[data-kanban-done="${pid}"]`, String(done));
    set(`[data-kanban-total="${pid}"]`, String(total));
  });
}

function wireAdd() {
  document.querySelectorAll<HTMLElement>('[data-kanban-add]').forEach(btn => {
    if (btn.dataset.wired) return; // idempotent: panels can be rebuilt
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => {
      const [pid, col] = btn.dataset.kanbanAdd!.split(':');
      const zone = document.querySelector<HTMLElement>(`[data-kanban-zone="${pid}:${col}"]`);
      if (!zone || zone.querySelector('.kanban-new')) return;
      const input = document.createElement('input');
      input.className =
        'kanban-new w-full bg-white rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:border-gray-500';
      input.placeholder = 'New task…';
      zone.appendChild(input);
      input.focus();
      let settled = false;
      const commit = (saveIt: boolean) => {
        if (settled) return;
        settled = true;
        const v = input.value.trim();
        if (saveIt && v) addTask(pid, col, v);
        render();
      };
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') commit(true);
        else if (e.key === 'Escape') commit(false);
      });
      input.addEventListener('blur', () => commit(true));
    });
  });
}

// Document-level drag handlers — bound once (cards are delegated by closest()).
let dragged: HTMLElement | null = null;
function wireDragGlobal() {
  document.addEventListener('dragstart', e => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('.kanban-card');
    if (!card) return;
    dragged = card;
    card.classList.add('opacity-40');
  });
  document.addEventListener('dragend', () => {
    dragged?.classList.remove('opacity-40');
    dragged = null;
    document.querySelectorAll('[data-kanban-zone]').forEach(z => z.classList.remove('ring-2', 'ring-gray-300'));
  });
}
// Per-zone drop targets — re-run after panels are rebuilt (idempotent).
function wireZones() {
  document.querySelectorAll<HTMLElement>('[data-kanban-zone]').forEach(zone => {
    if (zone.dataset.wired) return;
    zone.dataset.wired = '1';
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('ring-2', 'ring-gray-300'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('ring-2', 'ring-gray-300'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('ring-2', 'ring-gray-300');
      if (!dragged) return;
      const id = dragged.dataset.kanbanCard!;
      const [pid, col] = zone.dataset.kanbanZone!.split(':');
      moveTask(pid, id, col);
      render();
    });
  });
}

// Extra work to run on "Reset to plan" (e.g. the project board re-seeds projects).
const resetHooks: Array<() => void> = [];
export function registerResetHook(fn: () => void) {
  resetHooks.push(fn);
}
function wireReset() {
  document.querySelectorAll<HTMLElement>('[data-kanban-reset]').forEach(btn => {
    if (btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => {
      if (confirm('Reset everything back to the original GTM plan? This discards your changes.')) {
        resetAll();
        resetHooks.forEach(fn => fn());
        render();
      }
    });
  });
}

// ---- Right-click context menu ----
interface MenuCtx { pid: string; col: string; id: string; title: string }

let menuEl: HTMLElement | null = null;
function hideMenu() { menuEl?.classList.add('hidden'); }
function ensureMenu(): HTMLElement {
  if (menuEl) return menuEl;
  menuEl = document.createElement('div');
  menuEl.className =
    'kanban-menu fixed z-50 hidden min-w-[190px] bg-white rounded-xl border border-gray-200 shadow-lg py-1 text-sm';
  menuEl.addEventListener('click', e => e.stopPropagation());
  document.body.appendChild(menuEl);
  document.addEventListener('click', hideMenu);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hideMenu(); });
  document.addEventListener('scroll', hideMenu, true);
  window.addEventListener('blur', hideMenu);
  return menuEl;
}

function menuItem(label: string, onClick?: () => void, disabled = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.className =
    'w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-default';
  if (disabled) b.disabled = true;
  else if (onClick) b.addEventListener('click', onClick);
  return b;
}
function divider(): HTMLElement {
  const d = document.createElement('div');
  d.className = 'my-1 border-t border-gray-100';
  return d;
}

function openMenu(x: number, y: number, ctx: MenuCtx) {
  const m = ensureMenu();
  m.innerHTML = '';
  const ci = columns.findIndex(c => c.id === ctx.col);

  m.appendChild(menuItem(
    '← Move left',
    () => { moveTask(ctx.pid, ctx.id, columns[ci - 1].id); render(); hideMenu(); },
    ci <= 0,
  ));
  m.appendChild(menuItem(
    'Move right →',
    () => { moveTask(ctx.pid, ctx.id, columns[ci + 1].id); render(); hideMenu(); },
    ci >= columns.length - 1,
  ));
  m.appendChild(divider());
  m.appendChild(menuItem(
    '⧉ Duplicate',
    () => { addTask(ctx.pid, ctx.col, ctx.title); render(); hideMenu(); },
  ));

  // Duplicate to another project → submenu
  const wrap = document.createElement('div');
  wrap.className = 'relative';
  const trigger = menuItem('⧉ Duplicate to project  ▸');
  const sub = document.createElement('div');
  sub.className =
    'submenu absolute left-full -top-1 ml-1 min-w-[170px] bg-white rounded-xl border border-gray-200 shadow-lg py-1 hidden max-h-72 overflow-auto';
  projects().filter(p => p.id !== ctx.pid).forEach(p => {
    const it = document.createElement('button');
    it.type = 'button';
    it.className = 'w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-gray-100';
    const dot = document.createElement('span');
    dot.className = 'w-2 h-2 rounded-full shrink-0';
    dot.style.background = p.color;
    const name = document.createElement('span');
    name.textContent = p.name;
    it.append(dot, name);
    it.addEventListener('click', () => { addTask(p.id, ctx.col, ctx.title); render(); hideMenu(); });
    sub.appendChild(it);
  });
  trigger.addEventListener('click', e => { e.stopPropagation(); sub.classList.toggle('hidden'); });
  wrap.addEventListener('mouseenter', () => sub.classList.remove('hidden'));
  wrap.addEventListener('mouseleave', () => sub.classList.add('hidden'));
  wrap.append(trigger, sub);
  m.appendChild(wrap);

  // Show, then clamp to viewport.
  m.classList.remove('hidden');
  const rect = m.getBoundingClientRect();
  let px = x, py = y;
  if (px + rect.width > window.innerWidth) px = window.innerWidth - rect.width - 8;
  if (py + rect.height > window.innerHeight) py = window.innerHeight - rect.height - 8;
  m.style.left = Math.max(8, px) + 'px';
  m.style.top = Math.max(8, py) + 'px';
}

function wireContextMenu() {
  document.addEventListener('contextmenu', e => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('.kanban-card');
    if (!card) return; // normal browser menu elsewhere
    const zone = card.closest<HTMLElement>('[data-kanban-zone]');
    if (!zone) return;
    e.preventDefault();
    const [pid, col] = zone.dataset.kanbanZone!.split(':');
    openMenu((e as MouseEvent).clientX, (e as MouseEvent).clientY, {
      pid,
      col,
      id: card.dataset.kanbanCard!,
      title: card.querySelector('.kanban-title')?.textContent ?? '',
    });
  });
}

export { render };

// Wire the element-level handlers for whatever panels exist right now. Safe to
// call again after panels are rebuilt (each pass is idempotent), so the dynamic
// project board can re-attach handlers to freshly created columns.
export function wireBoard() {
  wireAdd();
  wireZones();
  wireReset();
}

let globalsWired = false;
export function mountKanban() {
  if (!globalsWired) {
    globalsWired = true;
    wireDragGlobal();
    wireContextMenu();
    // Re-render when the active project changes (keeps counts/progress fresh).
    document.addEventListener('projectchange', () => render());
  }
  wireBoard();
  render();
}
