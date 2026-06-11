// Dynamic /gtm project board: renders one panel per project from the client-side
// project store, with full project CRUD (create / edit / delete) on top of the
// existing task CRUD. Panels mirror KanbanBoard.astro's `full` variant so the
// styling matches; tasks are rendered/wired by kanbanBoard.ts.
import { columns, purgeProject } from './kanban';
import { mountKanban, registerResetHook } from './kanbanBoard';
import {
  listProjects,
  createProject,
  updateProject,
  deleteProject,
  resetProjects,
  PALETTE,
  type Project,
  type ProjectInput,
} from './projects';

const ACTIVE_KEY = 'bbg_active_project';

function channelToneClass(v: string): string {
  if (/^yes/i.test(v)) return 'bg-green-50 text-green-700';
  if (/^no/i.test(v)) return 'bg-gray-100 text-gray-400';
  return 'bg-amber-50 text-amber-700';
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---- Panel markup (mirrors the `full` variant of KanbanBoard.astro) ----
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
        <div class="flex items-start gap-4 shrink-0">
          <div class="text-right">
            <div class="text-2xl font-bold" style="color: ${p.color}" data-kanban-pct="${p.id}">0%</div>
            <div class="text-xs text-gray-400"><span data-kanban-done="${p.id}">0</span> / <span data-kanban-total="${p.id}">0</span> done</div>
          </div>
          <div class="flex gap-1">
            <button type="button" data-project-edit="${p.id}" title="Edit project" aria-label="Edit project"
              class="w-7 h-7 flex items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:text-gray-700 hover:border-gray-400 transition-colors">✎</button>
            <button type="button" data-project-delete="${p.id}" title="Delete project" aria-label="Delete project"
              class="w-7 h-7 flex items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:text-red-600 hover:border-red-300 transition-colors">✕</button>
          </div>
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

function buildPanels(container: HTMLElement) {
  const projects = listProjects();
  container.innerHTML = projects
    .map(p => `<div data-project-panel="${p.id}" class="hidden">${panelHtml(p)}</div>`)
    .join('');
  if (projects.length === 0) {
    container.innerHTML =
      '<div class="rounded-3xl border border-dashed border-gray-200 p-12 text-center text-gray-400">No projects yet. Use “+ New project” to add one.</div>';
  }
}

// ---- Editor modal ----
function field(label: string, name: string, value: string, placeholder = ''): string {
  return `
    <label class="block">
      <span class="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">${label}</span>
      <input name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}"
        class="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-gray-900 transition-colors" />
    </label>`;
}

let modalEl: HTMLElement | null = null;
function closeModal() {
  modalEl?.remove();
  modalEl = null;
}

function openEditor(existing: Project | null, onDone: () => void) {
  closeModal();
  const p = existing;
  const initialColor = p?.color ?? PALETTE[0].value;

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30';
  overlay.innerHTML = `
    <div class="w-full max-w-lg max-h-[90vh] overflow-auto rounded-3xl bg-white p-6 border border-gray-100" style="box-shadow: 10px 5px 30px rgba(0,0,0,0.15)">
      <h2 class="text-lg font-bold mb-4">${p ? 'Edit project' : 'New project'}</h2>
      <form id="project-form" class="space-y-3">
        ${field('Name', 'name', p?.name ?? '', 'Project name')}
        <div>
          <span class="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Color</span>
          <div class="flex flex-wrap gap-2" data-color-picker>
            ${PALETTE.map(
              c => `<button type="button" data-color="${c.value}" title="${c.label}" aria-label="${c.label}"
                class="w-8 h-8 rounded-full border-2 transition-transform hover:scale-110 ${
                  c.value === initialColor ? 'border-gray-900' : 'border-transparent'
                }" style="background: ${c.value}"></button>`,
            ).join('')}
          </div>
          <input type="hidden" name="color" value="${initialColor}" />
        </div>
        ${field('Owner', 'owner', p?.owner ?? '', 'e.g. Cyril')}
        ${field('Target customers', 'targetCustomers', p?.targetCustomers ?? '')}
        ${field('Precise targeting', 'preciseTargeting', p?.preciseTargeting ?? '')}
        ${field('Reason to buy', 'rtb', p?.rtb ?? '')}
        ${field('Email target', 'emailTarget', p?.emailTarget ?? '')}
        <div class="grid grid-cols-3 gap-2">
          ${field('SEO', 'seo', p?.channels.seo ?? '')}
          ${field('SEM', 'sem', p?.channels.sem ?? '')}
          ${field('Email', 'email', p?.channels.email ?? '')}
        </div>
        <p id="project-form-error" class="text-sm text-red-500 hidden">Name is required.</p>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" data-cancel class="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:border-gray-400">Cancel</button>
          <button type="submit" class="px-4 py-2 rounded-lg text-sm font-semibold text-white" style="background: var(--bbg-gray-dark)">${p ? 'Save' : 'Create'}</button>
        </div>
      </form>
    </div>`;

  modalEl = overlay;
  document.body.appendChild(overlay);

  const form = overlay.querySelector<HTMLFormElement>('#project-form')!;
  const colorInput = form.querySelector<HTMLInputElement>('input[name="color"]')!;
  const picker = overlay.querySelector<HTMLElement>('[data-color-picker]')!;
  picker.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-color]');
    if (!btn) return;
    colorInput.value = btn.dataset.color!;
    picker.querySelectorAll('[data-color]').forEach(b => {
      b.classList.toggle('border-gray-900', b === btn);
      b.classList.toggle('border-transparent', b !== btn);
    });
  });

  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  overlay.querySelector('[data-cancel]')!.addEventListener('click', closeModal);
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', onKey); }
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(form);
    const name = String(fd.get('name') ?? '').trim();
    if (!name) {
      overlay.querySelector('#project-form-error')!.classList.remove('hidden');
      return;
    }
    const input: ProjectInput = {
      name,
      color: String(fd.get('color') ?? PALETTE[0].value),
      owner: String(fd.get('owner') ?? '').trim(),
      targetCustomers: String(fd.get('targetCustomers') ?? '').trim(),
      preciseTargeting: String(fd.get('preciseTargeting') ?? '').trim(),
      rtb: String(fd.get('rtb') ?? '').trim(),
      emailTarget: String(fd.get('emailTarget') ?? '').trim(),
      channels: {
        seo: String(fd.get('seo') ?? '').trim(),
        sem: String(fd.get('sem') ?? '').trim(),
        email: String(fd.get('email') ?? '').trim(),
      },
    };
    let activeId: string | null = null;
    if (p) {
      updateProject(p.id, input);
    } else {
      activeId = createProject(input).id;
      localStorage.setItem(ACTIVE_KEY, activeId); // jump to the new project
    }
    closeModal();
    onDone();
  });
}

// ---- Mount ----
export function mountProjectBoard() {
  const container = document.getElementById('project-board');
  if (!container) return;

  // Rebuild panels, re-wire tasks, and tell the rest of the app the project set
  // changed (global selector reconciles + active panel re-applies).
  function refresh() {
    buildPanels(container);
    const count = String(listProjects().length);
    document.querySelectorAll<HTMLElement>('[data-project-total]').forEach(el => { el.textContent = count; });
    mountKanban(); // idempotent globals + (re)wire element handlers + render tasks
    document.dispatchEvent(new CustomEvent('projectsupdated'));
  }

  // Delegate project edit / delete clicks (panels are rebuilt, so use the container).
  container.addEventListener('click', e => {
    const editBtn = (e.target as HTMLElement).closest<HTMLElement>('[data-project-edit]');
    if (editBtn) {
      const proj = listProjects().find(p => p.id === editBtn.dataset.projectEdit);
      if (proj) openEditor(proj, refresh);
      return;
    }
    const delBtn = (e.target as HTMLElement).closest<HTMLElement>('[data-project-delete]');
    if (delBtn) {
      const id = delBtn.dataset.projectDelete!;
      const proj = listProjects().find(p => p.id === id);
      if (proj && confirm(`Delete project “${proj.name}” and all its tasks? This can't be undone.`)) {
        deleteProject(id);
        purgeProject(id);
        if (localStorage.getItem(ACTIVE_KEY) === id) localStorage.removeItem(ACTIVE_KEY);
        refresh();
      }
    }
  });

  document.querySelectorAll<HTMLElement>('[data-project-new]').forEach(btn =>
    btn.addEventListener('click', () => openEditor(null, refresh)),
  );

  // "Reset to plan" should also restore the original project set.
  registerResetHook(() => {
    resetProjects();
    refresh();
  });

  refresh();
}
