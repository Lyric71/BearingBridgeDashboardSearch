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

// Panel markup mirrors KanbanBoard.astro (full = rich header, compact = slim bar).
function panelHtml(p: Project, variant: 'full' | 'compact'): string {
  const detail = (label: string, value: string) =>
    value ? `<div><span class="text-gray-400">${label}:</span> <span class="text-gray-700">${esc(value)}</span></div>` : '';
  const chip = (label: string, v: string) =>
    `<span class="text-xs px-2 py-0.5 rounded ${channelToneClass(v)}">${label} · ${esc(v || '—')}</span>`;
  const cols = columns
    .map(
      col => `
      <div class="rounded-2xl bg-muted/50 border border-border p-3 min-h-[120px] flex flex-col">
        <div class="flex items-center justify-between px-1 mb-3">
          <span class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">${esc(col.label)}</span>
          <span class="text-xs text-muted-foreground" data-kanban-count="${p.id}:${col.id}">0</span>
        </div>
        <div class="space-y-2 min-h-[48px]" data-kanban-zone="${p.id}:${col.id}"></div>
        <button type="button" data-kanban-add="${p.id}:${col.id}"
          class="mt-2 text-xs text-muted-foreground hover:text-foreground rounded-lg border border-dashed border-border hover:border-ring py-1.5 transition-colors">+ Add task</button>
      </div>`,
    )
    .join('');

  // Rich header (/gtm "full") vs. slim progress bar (dashboard "compact").
  const fullHeader = `
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
      <div class="h-1.5 w-full rounded-full bg-muted overflow-hidden mb-4">
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
      </div>`;

  const compactHeader = `
      <div class="flex items-center gap-3 mb-4">
        <div class="h-2 flex-1 rounded-full bg-muted overflow-hidden">
          <div class="h-full rounded-full transition-all" style="width: 0%; background: ${p.color}" data-kanban-bar="${p.id}"></div>
        </div>
        <span class="text-sm font-bold tabular-nums" style="color: ${p.color}" data-kanban-pct="${p.id}">0%</span>
        <span class="text-xs text-gray-400 tabular-nums"><span data-kanban-done="${p.id}">0</span> / <span data-kanban-total="${p.id}">0</span> done</span>
      </div>`;

  if (variant === 'full') {
    return `
    <div class="ui-card p-6 mb-6" style="border-left: 4px solid ${p.color}">${fullHeader}
    </div>
    <div class="grid md:grid-cols-3 gap-4">${cols}</div>`;
  }
  return `${compactHeader}
    <div class="grid md:grid-cols-3 gap-4">${cols}</div>`;
}

// Render a Kanban board (full or compact) into a container, client-side from the
// project store, so created projects get a board everywhere — not just /gtm.
export function mountProjectBoard(variant: 'full' | 'compact' = 'full', containerId = 'project-board') {
  const container = document.getElementById(containerId);
  if (!container) return;
  // Only projects with the Kanban module enabled get a board.
  const projects = listProjects().filter(p => p.modules.kanban);
  if (projects.length === 0) {
    container.innerHTML =
      '<div class="ui-empty">No projects have the Kanban module enabled. Enable it on the <a href="/projects" class="underline">Projects</a> page.</div>';
    return;
  }
  container.innerHTML = projects
    .map(p => `<div data-project-panel="${p.id}" class="hidden">${panelHtml(p, variant)}</div>`)
    .join('');
  mountKanban();
  // Panels now exist — let the layout reconcile the selector and reveal the
  // active project's panel (order-independent of the layout's own init).
  document.dispatchEvent(new CustomEvent('projectsupdated'));
}
