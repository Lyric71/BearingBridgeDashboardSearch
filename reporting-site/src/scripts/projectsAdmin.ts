// Dedicated project management for the /projects page. Project is the top-level
// entity; this is the single place to create / edit / delete one. Everything
// else in the app (GTM tasks, SEO, SEM data) is scoped *under* the selected
// project. Persisted in localStorage via the project store.
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
import { allTasks, purgeProject } from './kanban';

const ACTIVE_KEY = 'bbg_active_project';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function channelToneClass(v: string): string {
  if (/^yes/i.test(v)) return 'bg-green-50 text-green-700';
  if (/^no/i.test(v)) return 'bg-gray-100 text-gray-400';
  return 'bg-amber-50 text-amber-700';
}

// Sections that belong to a project — clicking sets it active and drills in.
const SECTIONS: { label: string; href: string }[] = [
  { label: 'GTM', href: '/gtm' },
  { label: 'Keywords', href: '/seo/keywords' },
  { label: 'Competitors', href: '/seo/competitors' },
  { label: 'Google Ads', href: '/sem/ads' },
  { label: 'Click Report', href: '/sem/report' },
];

function cardHtml(p: Project): string {
  const tasks = allTasks(p.id);
  const done = tasks.filter(t => t.status === 'done').length;
  const total = tasks.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const chip = (label: string, v: string) =>
    `<span class="text-xs px-2 py-0.5 rounded ${channelToneClass(v)}">${label} · ${esc(v || '—')}</span>`;
  const sections = SECTIONS.map(
    s =>
      `<a href="${s.href}" data-project-open="${p.id}" class="text-xs px-2 py-1 rounded-lg border border-gray-200 text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors">${s.label}</a>`,
  ).join('');

  return `
    <div class="rounded-3xl border border-gray-100 p-6 flex flex-col" style="box-shadow: 10px 5px 10px rgba(0,0,0,0.05); border-left: 4px solid ${p.color}">
      <div class="flex items-start justify-between gap-3 mb-2">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background: ${p.color}"></span>
            <h2 class="font-bold text-lg truncate" style="color: ${p.color}">${esc(p.name)}</h2>
          </div>
          <p class="text-xs text-gray-400 mt-1">Owner: ${esc(p.owner || '—')}</p>
        </div>
        <div class="flex gap-1 shrink-0">
          <button type="button" data-project-edit="${p.id}" title="Edit" aria-label="Edit project"
            class="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:text-gray-700 hover:border-gray-400 transition-colors">✎</button>
          <button type="button" data-project-delete="${p.id}" title="Delete" aria-label="Delete project"
            class="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:text-red-600 hover:border-red-300 transition-colors">✕</button>
        </div>
      </div>

      <p class="text-sm text-gray-600 mb-3 line-clamp-2">${esc(p.targetCustomers || 'No description yet.')}</p>

      <div class="flex flex-wrap gap-2 mb-4">
        ${chip('SEO', p.channels.seo)}
        ${chip('SEM', p.channels.sem)}
        ${chip('Email', p.channels.email)}
      </div>

      <div class="mt-auto">
        <div class="flex items-center gap-2 mb-3">
          <div class="h-1.5 flex-1 rounded-full bg-gray-100 overflow-hidden">
            <div class="h-full rounded-full" style="width: ${pct}%; background: ${p.color}"></div>
          </div>
          <span class="text-xs text-gray-400 tabular-nums">${done}/${total} GTM</span>
        </div>
        <div class="flex flex-wrap gap-1.5">${sections}</div>
      </div>
    </div>`;
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

function openEditor(existing: Project | null, onDone: (savedId?: string) => void) {
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
    let savedId: string;
    if (p) {
      updateProject(p.id, input);
      savedId = p.id;
    } else {
      savedId = createProject(input).id;
    }
    closeModal();
    onDone(savedId);
  });
}

// ---- Mount ----
export function mountProjectsAdmin() {
  const grid = document.getElementById('projects-grid');
  if (!grid) return;

  function render() {
    const projects = listProjects();
    grid.innerHTML = projects.map(cardHtml).join('');
    const count = String(projects.length);
    document.querySelectorAll<HTMLElement>('[data-project-total]').forEach(el => { el.textContent = count; });
    document.dispatchEvent(new CustomEvent('projectsupdated'));
  }

  grid.addEventListener('click', e => {
    const target = e.target as HTMLElement;

    const openLink = target.closest<HTMLElement>('[data-project-open]');
    if (openLink) {
      // Set the clicked project active before navigating into its section.
      localStorage.setItem(ACTIVE_KEY, openLink.dataset.projectOpen!);
      return; // let the <a> navigate
    }

    const editBtn = target.closest<HTMLElement>('[data-project-edit]');
    if (editBtn) {
      const proj = listProjects().find(p => p.id === editBtn.dataset.projectEdit);
      if (proj) openEditor(proj, () => render());
      return;
    }

    const delBtn = target.closest<HTMLElement>('[data-project-delete]');
    if (delBtn) {
      const id = delBtn.dataset.projectDelete!;
      const proj = listProjects().find(p => p.id === id);
      if (proj && confirm(`Delete project “${proj.name}” and all its data? This can't be undone.`)) {
        deleteProject(id);
        purgeProject(id);
        if (localStorage.getItem(ACTIVE_KEY) === id) localStorage.removeItem(ACTIVE_KEY);
        render();
      }
    }
  });

  document.querySelectorAll<HTMLElement>('[data-project-new]').forEach(btn =>
    btn.addEventListener('click', () =>
      openEditor(null, savedId => {
        if (savedId) localStorage.setItem(ACTIVE_KEY, savedId);
        render();
      }),
    ),
  );

  document.querySelectorAll<HTMLElement>('[data-projects-reset]').forEach(btn =>
    btn.addEventListener('click', () => {
      if (confirm('Reset the project list back to the original plan? This discards created/edited projects.')) {
        resetProjects();
        render();
      }
    }),
  );

  render();
}
