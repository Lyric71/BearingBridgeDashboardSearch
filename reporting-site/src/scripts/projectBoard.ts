// /gtm task board: renders one Kanban panel per project from the project store,
// so every project (including ones created on /projects) gets a board. Project
// lifecycle (create / edit / delete) is NOT handled here — that lives on the
// dedicated /projects page. This module only renders + wires task CRUD.
import { columns } from './kanban';
import { mountKanban } from './kanbanBoard';
import { listProjects, type Project } from './projects';

function channelToneClass(v: string): string {
  if (/^yes/i.test(v)) return 'bg-green-50 text-green-700';
  if (/^no/i.test(v)) return 'bg-gray-100 text-gray-400';
  return 'bg-amber-50 text-amber-700';
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Panel markup mirrors the old `full` variant of KanbanBoard.astro.
function panelHtml(p: Project): string {
  const detail = (label: string, value: string) =>
    value ? `<div><span class="text-gray-400">${label}:</span> <span class="text-gray-700">${esc(value)}</span></div>` : '';
  const chip = (label: string, v: string) =>
    `<span class="text-xs px-2 py-0.5 rounded ${channelToneClass(v)}">${label} · ${esc(v || '—')}</span>`;
  const cols = columns
    .map(
      col => `
      <div class="rounded-2xl bg-gray-50 border border-gray-100 p-3 min-h-[120px] flex flex-col">
        <div class="flex items-center justify-between px-1 mb-3">
          <span class="text-xs font-semibold uppercase tracking-widest text-gray-500">${esc(col.label)}</span>
          <span class="text-xs text-gray-400" data-kanban-count="${p.id}:${col.id}">0</span>
        </div>
        <div class="space-y-2 min-h-[48px]" data-kanban-zone="${p.id}:${col.id}"></div>
        <button type="button" data-kanban-add="${p.id}:${col.id}"
          class="mt-2 text-xs text-gray-400 hover:text-gray-700 rounded-lg border border-dashed border-gray-200 hover:border-gray-400 py-1.5 transition-colors">+ Add task</button>
      </div>`,
    )
    .join('');

  return `
    <div class="rounded-2xl border border-gray-100 p-6 mb-6" style="box-shadow: 10px 5px 10px rgba(0,0,0,0.05); border-left: 4px solid ${p.color}">
      <div class="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div>
          <h2 class="font-bold text-xl" style="color: ${p.color}">${esc(p.name)}</h2>
          <p class="text-sm text-gray-500 mt-1">${esc(p.targetCustomers)}</p>
        </div>
        <div class="text-right shrink-0">
          <div class="text-2xl font-bold" style="color: ${p.color}" data-kanban-pct="${p.id}">0%</div>
          <div class="text-xs text-gray-400"><span data-kanban-done="${p.id}">0</span> / <span data-kanban-total="${p.id}">0</span> done</div>
        </div>
      </div>
      <div class="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden mb-4">
        <div class="h-full rounded-full transition-all" style="width: 0%; background: ${p.color}" data-kanban-bar="${p.id}"></div>
      </div>
      <div class="grid sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
        ${detail('Reason to buy', p.rtb)}
        ${detail('Targeting', p.preciseTargeting)}
        ${detail('Email target', p.emailTarget)}
        ${detail('Owner', p.owner)}
      </div>
      <div class="flex flex-wrap gap-2 mt-4">
        ${chip('SEO', p.channels.seo)}
        ${chip('SEM', p.channels.sem)}
        ${chip('Email', p.channels.email)}
      </div>
    </div>
    <div class="grid md:grid-cols-3 gap-4">${cols}</div>`;
}

export function mountProjectBoard() {
  const container = document.getElementById('project-board');
  if (!container) return;
  // Only projects with the Kanban module enabled get a board.
  const projects = listProjects().filter(p => p.modules.kanban);
  if (projects.length === 0) {
    container.innerHTML =
      '<div class="rounded-3xl border border-dashed border-gray-200 p-12 text-center text-gray-400">No projects have the Kanban module enabled. Enable it on the <a href="/projects" class="underline">Projects</a> page.</div>';
    return;
  }
  container.innerHTML = projects
    .map(p => `<div data-project-panel="${p.id}" class="hidden">${panelHtml(p)}</div>`)
    .join('');
  mountKanban();
  // Panels now exist — let the layout reconcile the selector and reveal the
  // active project's panel (order-independent of the layout's own init).
  document.dispatchEvent(new CustomEvent('projectsupdated'));
}
