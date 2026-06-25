// Interactive keyword table for /seo/keywords. One table per project panel.
// Columns sort on click (language, intent, priority + keyword/cluster); rows
// support add / edit / delete / duplicate via the keyword store (localStorage).
import {
  listKeywords,
  addKeyword,
  updateKeyword,
  removeKeyword,
  duplicateKeyword,
  resetKeywords,
  LANGUAGES,
  INTENTS,
  PRIORITIES,
  PRIORITY_RANK,
  type Keyword,
  type KeywordInput,
} from './keywords';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

type SortKey = 'keyword' | 'language' | 'intent' | 'cluster' | 'priority';
interface SortState { key: SortKey; dir: 1 | -1; }

interface Filters { language: string; intent: string; priority: string; }

// Per-panel view state (sort + search + filters), keyed by project id.
const viewState = new Map<string, { sort: SortState; query: string; filters: Filters }>();
function vs(id: string) {
  if (!viewState.has(id))
    viewState.set(id, { sort: { key: 'priority', dir: 1 }, query: '', filters: { language: '', intent: '', priority: '' } });
  return viewState.get(id)!;
}

const intentColor: Record<string, string> = {
  Commercial: 'var(--bbg-blue)',
  Informational: 'var(--bbg-orange)',
  Navigational: 'var(--bbg-purple)',
};
const priorityColor: Record<string, string> = {
  High: 'var(--bbg-red)',
  'Medium-High': 'var(--bbg-orange)',
  Medium: 'var(--bbg-blue)',
  'Low-Medium': 'var(--bbg-gray-muted)',
  Low: 'var(--bbg-gray-muted)',
};

function compare(a: Keyword, b: Keyword, key: SortKey): number {
  if (key === 'priority') {
    return (PRIORITY_RANK[a.priority] ?? 99) - (PRIORITY_RANK[b.priority] ?? 99);
  }
  return String(a[key]).localeCompare(String(b[key]), undefined, { sensitivity: 'base' });
}

// Populate a filter <select> with the distinct values present in the data,
// preserving the current selection. Priority is ordered by rank; others A→Z.
function fillSelect(sel: HTMLSelectElement, values: string[], byRank: boolean) {
  const current = sel.value;
  const sorted = byRank
    ? values.slice().sort((a, b) => (PRIORITY_RANK[a] ?? 99) - (PRIORITY_RANK[b] ?? 99))
    : values.slice().sort((a, b) => a.localeCompare(b));
  const placeholder = sel.options[0]; // keep the "All …" option
  sel.innerHTML = '';
  sel.appendChild(placeholder);
  for (const v of sorted) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.text = v;
    sel.appendChild(opt);
  }
  // Restore selection if it still exists; otherwise fall back to "All".
  sel.value = sorted.includes(current) ? current : '';
}

function syncFilterOptions(panel: HTMLElement, all: Keyword[], filters: Filters) {
  const fields: { key: keyof Filters; byRank: boolean }[] = [
    { key: 'language', byRank: false },
    { key: 'intent', byRank: false },
    { key: 'priority', byRank: true },
  ];
  for (const { key, byRank } of fields) {
    const sel = panel.querySelector<HTMLSelectElement>(`[data-kw-filter="${key}"]`);
    if (!sel) continue;
    const values = Array.from(new Set(all.map(k => k[key]).filter(Boolean)));
    fillSelect(sel, values, byRank);
    filters[key] = sel.value; // keep state in sync if a value disappeared
  }
}

function pill(text: string, color: string): string {
  return `<span class="inline-block text-xs font-semibold px-2 py-0.5 rounded-full text-white" style="background: ${color}">${esc(text)}</span>`;
}

function rowHtml(k: Keyword): string {
  return `
    <tr data-kw-row="${k.id}">
      <td class="font-medium">${esc(k.keyword)}</td>
      <td><span class="text-xs font-semibold px-2 py-0.5 rounded border border-gray-200 text-gray-600">${esc(k.language)}</span></td>
      <td>${pill(k.intent, intentColor[k.intent] ?? 'var(--bbg-gray-muted)')}</td>
      <td class="text-gray-600">${esc(k.cluster)}</td>
      <td>${pill(k.priority, priorityColor[k.priority] ?? 'var(--bbg-gray-muted)')}</td>
      <td>
        <div class="flex gap-1 justify-end">
          <button type="button" data-kw-edit="${k.id}" title="Edit" aria-label="Edit keyword"
            class="w-7 h-7 flex items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:text-gray-700 hover:border-gray-400 transition-colors">✎</button>
          <button type="button" data-kw-dup="${k.id}" title="Duplicate" aria-label="Duplicate keyword"
            class="w-7 h-7 flex items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:text-gray-700 hover:border-gray-400 transition-colors">⧉</button>
          <button type="button" data-kw-del="${k.id}" title="Delete" aria-label="Delete keyword"
            class="w-7 h-7 flex items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:text-red-600 hover:border-red-300 transition-colors">✕</button>
        </div>
      </td>
    </tr>`;
}

function renderPanel(panel: HTMLElement) {
  const id = panel.dataset.project!;
  const state = vs(id);
  const body = panel.querySelector<HTMLElement>('[data-kw-body]')!;
  const empty = panel.querySelector<HTMLElement>('[data-kw-empty]')!;
  const table = panel.querySelector<HTMLElement>('[data-kw-table]')!;

  const all = listKeywords(id);
  const total = all.length;

  // Refresh dropdown options from current data (preserving selections), then filter.
  syncFilterOptions(panel, all, state.filters);
  const f = state.filters;
  let rows = all.filter(
    k =>
      (!f.language || k.language === f.language) &&
      (!f.intent || k.intent === f.intent) &&
      (!f.priority || k.priority === f.priority),
  );

  const q = state.query.trim().toLowerCase();
  if (q) rows = rows.filter(k => k.keyword.toLowerCase().includes(q) || k.cluster.toLowerCase().includes(q));

  rows.sort((a, b) => {
    const c = compare(a, b, state.sort.key);
    return (c !== 0 ? c : a.keyword.localeCompare(b.keyword)) * state.sort.dir;
  });

  body.innerHTML = rows.map(rowHtml).join('');

  // Count + empty state. Show "x of N" whenever any search/filter narrows the set.
  const filtered = q || f.language || f.intent || f.priority;
  const count = panel.querySelector<HTMLElement>('[data-kw-count]');
  if (count) count.textContent = filtered ? `${rows.length} of ${total}` : `${total} keyword${total === 1 ? '' : 's'}`;
  const clearBtn = panel.querySelector<HTMLElement>('[data-kw-clear]');
  if (clearBtn) clearBtn.classList.toggle('hidden', !filtered);
  // Stash the server-rendered "add your first keyword" prompt once, so we can
  // swap in a distinct "no matches" message when filters exclude everything.
  if (empty.dataset.defaultHtml === undefined) empty.dataset.defaultHtml = empty.innerHTML;
  const showTable = rows.length > 0;
  table.classList.toggle('hidden', !showTable);
  empty.classList.toggle('hidden', showTable);
  if (!showTable) {
    empty.innerHTML =
      total > 0
        ? '<div class="text-gray-400 mb-1">No keywords match the current filters.</div><div class="text-xs text-gray-400">Try a different language, intent or priority — or <button type="button" data-kw-clear-inline class="underline">clear filters</button>.</div>'
        : empty.dataset.defaultHtml!;
  }

  // Sort-direction indicators on headers.
  panel.querySelectorAll<HTMLElement>('[data-sort]').forEach(th => {
    const active = th.dataset.sort === state.sort.key;
    const caret = th.querySelector('[data-caret]');
    if (caret) caret.textContent = active ? (state.sort.dir === 1 ? '▲' : '▼') : '';
    th.classList.toggle('text-white', true);
  });
}

// ---- Editor modal (add / edit) ----
let modalEl: HTMLElement | null = null;
function closeModal() {
  modalEl?.remove();
  modalEl = null;
}

function selectField(label: string, name: string, options: string[], value: string): string {
  return `
    <label class="block">
      <span class="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">${label}</span>
      <select name="${name}" class="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:border-gray-900 transition-colors">
        ${options.map(o => `<option value="${esc(o)}" ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}
      </select>
    </label>`;
}

function textField(label: string, name: string, value: string, placeholder = ''): string {
  return `
    <label class="block">
      <span class="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">${label}</span>
      <input name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}"
        class="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-gray-900 transition-colors" />
    </label>`;
}

function openEditor(projectId: string, existing: Keyword | null, clusters: string[], onDone: () => void) {
  closeModal();
  const k = existing;
  const clusterList = Array.from(new Set([...clusters, k?.cluster].filter(Boolean) as string[])).sort();

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30';
  overlay.innerHTML = `
    <div class="w-full max-w-md max-h-[90vh] overflow-auto rounded-3xl bg-white p-6 border border-gray-100" style="box-shadow: 10px 5px 30px rgba(0,0,0,0.15)">
      <h2 class="text-lg font-bold mb-4">${k ? 'Edit keyword' : 'Add keyword'}</h2>
      <form id="kw-form" class="space-y-3">
        ${textField('Keyword', 'keyword', k?.keyword ?? '', 'e.g. wordpress china')}
        <div class="grid grid-cols-2 gap-3">
          ${selectField('Language', 'language', LANGUAGES, k?.language ?? LANGUAGES[0])}
          ${selectField('Intent', 'intent', INTENTS, k?.intent ?? INTENTS[0])}
        </div>
        <label class="block">
          <span class="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Cluster</span>
          <input name="cluster" list="kw-clusters" value="${esc(k?.cluster ?? '')}" placeholder="e.g. Hosting & ICP"
            class="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-gray-900 transition-colors" />
          <datalist id="kw-clusters">${clusterList.map(c => `<option value="${esc(c)}"></option>`).join('')}</datalist>
        </label>
        ${selectField('Priority', 'priority', PRIORITIES, k?.priority ?? 'Medium')}
        <p id="kw-form-error" class="text-sm text-red-500 hidden">Keyword is required.</p>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" data-cancel class="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:border-gray-400">Cancel</button>
          <button type="submit" class="px-4 py-2 rounded-lg text-sm font-semibold text-white" style="background: var(--bbg-gray-dark)">${k ? 'Save' : 'Add'}</button>
        </div>
      </form>
    </div>`;

  modalEl = overlay;
  document.body.appendChild(overlay);

  const form = overlay.querySelector<HTMLFormElement>('#kw-form')!;
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  overlay.querySelector('[data-cancel]')!.addEventListener('click', closeModal);
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', onKey); }
  });
  form.querySelector<HTMLInputElement>('input[name="keyword"]')?.focus();

  form.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(form);
    const keyword = String(fd.get('keyword') ?? '').trim();
    if (!keyword) {
      overlay.querySelector('#kw-form-error')!.classList.remove('hidden');
      return;
    }
    const input: KeywordInput = {
      keyword,
      language: String(fd.get('language') ?? LANGUAGES[0]),
      intent: String(fd.get('intent') ?? INTENTS[0]),
      cluster: String(fd.get('cluster') ?? '').trim(),
      priority: String(fd.get('priority') ?? 'Medium'),
    };
    if (k) updateKeyword(projectId, k.id, input);
    else addKeyword(projectId, input);
    closeModal();
    onDone();
  });
}

function clustersOf(projectId: string): string[] {
  return Array.from(new Set(listKeywords(projectId).map(k => k.cluster).filter(Boolean)));
}

function wirePanel(panel: HTMLElement) {
  const id = panel.dataset.project!;
  const state = vs(id);
  const refresh = () => renderPanel(panel);

  // Header sort.
  panel.querySelectorAll<HTMLElement>('[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort as SortKey;
      if (state.sort.key === key) state.sort.dir = state.sort.dir === 1 ? -1 : 1;
      else state.sort = { key, dir: 1 };
      refresh();
    });
  });

  // Search.
  const search = panel.querySelector<HTMLInputElement>('[data-kw-search]');
  search?.addEventListener('input', () => { state.query = search.value; refresh(); });

  // Filters (language / intent / priority).
  panel.querySelectorAll<HTMLSelectElement>('[data-kw-filter]').forEach(sel => {
    sel.addEventListener('change', () => {
      const key = sel.dataset.kwFilter as keyof Filters;
      state.filters[key] = sel.value;
      refresh();
    });
  });

  // Clear all search + filters (toolbar button and the inline empty-state link).
  const clearAll = () => {
    state.query = '';
    state.filters = { language: '', intent: '', priority: '' };
    if (search) search.value = '';
    refresh();
  };
  panel.querySelector<HTMLElement>('[data-kw-clear]')?.addEventListener('click', clearAll);
  panel.addEventListener('click', e => {
    if ((e.target as HTMLElement).closest('[data-kw-clear-inline]')) clearAll();
  });

  // Add.
  panel.querySelectorAll<HTMLElement>('[data-kw-add]').forEach(btn =>
    btn.addEventListener('click', () => openEditor(id, null, clustersOf(id), refresh)),
  );

  // Reset.
  panel.querySelector<HTMLElement>('[data-kw-reset]')?.addEventListener('click', () => {
    if (confirm('Reset keywords for this project back to the original list? This discards your edits.')) {
      resetKeywords(id);
      refresh();
    }
  });

  // Row actions (delegated).
  panel.querySelector<HTMLElement>('[data-kw-body]')!.addEventListener('click', e => {
    const target = e.target as HTMLElement;
    const editBtn = target.closest<HTMLElement>('[data-kw-edit]');
    if (editBtn) {
      const kw = listKeywords(id).find(k => k.id === editBtn.dataset.kwEdit);
      if (kw) openEditor(id, kw, clustersOf(id), refresh);
      return;
    }
    const dupBtn = target.closest<HTMLElement>('[data-kw-dup]');
    if (dupBtn) { duplicateKeyword(id, dupBtn.dataset.kwDup!); refresh(); return; }
    const delBtn = target.closest<HTMLElement>('[data-kw-del]');
    if (delBtn) {
      const kw = listKeywords(id).find(k => k.id === delBtn.dataset.kwDel);
      if (kw && confirm(`Delete keyword “${kw.keyword}”?`)) { removeKeyword(id, kw.id); refresh(); }
    }
  });

  refresh();
}

export function mountKeywordTables() {
  document.querySelectorAll<HTMLElement>('[data-kw-panel]').forEach(wirePanel);
}
