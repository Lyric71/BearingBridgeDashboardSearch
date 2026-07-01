// Interactive keyword table for /seo/keywords. One table per project panel.
// Columns sort on click (language, intent, priority + keyword/cluster); rows
// support add / edit / delete / duplicate via the keyword store (localStorage).
import {
  listKeywords,
  addKeyword,
  updateKeyword,
  removeKeyword,
  duplicateKeyword,
  setKeywordResyncHandler,
  LANGUAGES,
  INTENTS,
  PRIORITIES,
  PRIORITY_RANK,
  type Keyword,
  type KeywordInput,
} from './keywords';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

type SortKey = 'keyword' | 'language' | 'intent' | 'priority';
interface SortState { key: SortKey; dir: 1 | -1; }

interface Filters { language: string; intent: string; priority: string; }

// Per-panel view state (sort + search + filters + collapsed clusters), keyed by
// project id. `collapsed` holds the cluster names whose rows are hidden; clusters
// start collapsed by default (seeded on first render — see `collapseInit`).
const viewState = new Map<string, { sort: SortState; query: string; filters: Filters; collapsed: Set<string>; collapseInit: boolean }>();
function vs(id: string) {
  if (!viewState.has(id))
    viewState.set(id, { sort: { key: 'priority', dir: 1 }, query: '', filters: { language: 'EN', intent: '', priority: '' }, collapsed: new Set(), collapseInit: false });
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
function fillSelect(sel: HTMLSelectElement, values: string[], byRank: boolean, desired: string) {
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
  // Reflect the state's selection if it's still available; otherwise "All".
  sel.value = sorted.includes(desired) ? desired : '';
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
    fillSelect(sel, values, byRank, filters[key]); // state drives the selection
    filters[key] = sel.value; // fall back to "All" if that value disappeared
  }
}

function pill(text: string, color: string): string {
  return `<span class="inline-block text-xs font-semibold px-2 py-0.5 rounded-full text-white" style="background: ${color}">${esc(text)}</span>`;
}

// Full-width divider row that introduces each cluster group. Clicking it toggles
// the group's rows via the collapsed-clusters set in view state.
function groupHeader(cluster: string, n: number, collapsed: boolean): string {
  return `
    <tr class="cluster-row cursor-pointer select-none hover:bg-muted/70" data-cluster-toggle="${esc(cluster)}">
      <td colspan="5" class="bg-muted/50 font-semibold text-sm text-foreground py-2 px-3 border-t border-border">
        <span class="inline-block w-3 text-[10px] text-muted-foreground transition-transform">${collapsed ? '▶' : '▼'}</span>
        ${esc(cluster)} <span class="text-muted-foreground font-normal tabular-nums">(${n})</span>
      </td>
    </tr>`;
}

function rowHtml(k: Keyword): string {
  return `
    <tr data-kw-row="${k.id}">
      <td class="font-medium">${esc(k.keyword)}</td>
      <td><span class="text-xs font-semibold px-2 py-0.5 rounded border border-border text-muted-foreground">${esc(k.language)}</span></td>
      <td>${pill(k.intent, intentColor[k.intent] ?? 'var(--bbg-gray-muted)')}</td>
      <td>${pill(k.priority, priorityColor[k.priority] ?? 'var(--bbg-gray-muted)')}</td>
      <td>
        <div class="flex gap-1 justify-end">
          <button type="button" data-kw-edit="${k.id}" title="Edit" aria-label="Edit keyword"
            class="w-7 h-7 flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">✎</button>
          <button type="button" data-kw-dup="${k.id}" title="Duplicate" aria-label="Duplicate keyword"
            class="w-7 h-7 flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">⧉</button>
          <button type="button" data-kw-del="${k.id}" title="Delete" aria-label="Delete keyword"
            class="w-7 h-7 flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-red-600 hover:border-red-300 transition-colors">✕</button>
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

  // Collapse every cluster on the first render for this panel (default state).
  if (!state.collapseInit && all.length) {
    for (const k of all) state.collapsed.add(k.cluster || 'Uncategorized');
    state.collapseInit = true;
  }

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

  // Group rows by cluster. Clusters are ordered by their strongest (lowest-rank)
  // priority, then alphabetically; rows within a cluster follow the active sort.
  const groups = new Map<string, Keyword[]>();
  for (const k of rows) {
    const key = k.cluster || 'Uncategorized';
    let arr = groups.get(key);
    if (!arr) { arr = []; groups.set(key, arr); }
    arr.push(k);
  }
  const rank = (c: string) => Math.min(...groups.get(c)!.map(k => PRIORITY_RANK[k.priority] ?? 99));
  const clusterOrder = Array.from(groups.keys()).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

  // A text search force-expands matching clusters so hits are visible; the user's
  // manual collapse state is preserved and restored once the search is cleared.
  // Dropdown filters (incl. the default EN language) only narrow — they leave
  // clusters collapsed so "collapsed by default" holds on first load.
  const forceExpand = !!q;

  body.innerHTML = clusterOrder
    .map(cluster => {
      const items = groups.get(cluster)!.sort((a, b) => {
        const c = compare(a, b, state.sort.key);
        return (c !== 0 ? c : a.keyword.localeCompare(b.keyword)) * state.sort.dir;
      });
      const isCollapsed = !forceExpand && state.collapsed.has(cluster);
      const rowsHtml = isCollapsed ? '' : items.map(rowHtml).join('');
      return groupHeader(cluster, items.length, isCollapsed) + rowsHtml;
    })
    .join('');

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
      <span class="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">${label}</span>
      <select name="${name}" class="ui-select w-full">
        ${options.map(o => `<option value="${esc(o)}" ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}
      </select>
    </label>`;
}

function textField(label: string, name: string, value: string, placeholder = ''): string {
  return `
    <label class="block">
      <span class="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">${label}</span>
      <input name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}"
        class="ui-input" />
    </label>`;
}

function openEditor(projectId: string, existing: Keyword | null, clusters: string[], onDone: () => void) {
  closeModal();
  const k = existing;
  const clusterList = Array.from(new Set([...clusters, k?.cluster].filter(Boolean) as string[])).sort();

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30';
  overlay.innerHTML = `
    <div class="w-full max-w-md max-h-[90vh] overflow-auto ui-card p-6 shadow-xl">
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
            class="ui-input" />
          <datalist id="kw-clusters">${clusterList.map(c => `<option value="${esc(c)}"></option>`).join('')}</datalist>
        </label>
        ${selectField('Priority', 'priority', PRIORITIES, k?.priority ?? 'Medium')}
        <p id="kw-form-error" class="text-sm text-red-500 hidden">Keyword is required.</p>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" data-cancel class="btn-outline">Cancel</button>
          <button type="submit" class="btn-primary">${k ? 'Save' : 'Add'}</button>
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

  // Row actions + cluster collapse/expand (delegated).
  panel.querySelector<HTMLElement>('[data-kw-body]')!.addEventListener('click', e => {
    const target = e.target as HTMLElement;
    const toggle = target.closest<HTMLElement>('[data-cluster-toggle]');
    if (toggle) {
      const cluster = toggle.dataset.clusterToggle!;
      if (state.collapsed.has(cluster)) state.collapsed.delete(cluster);
      else state.collapsed.add(cluster);
      refresh();
      return;
    }
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
  const panels = Array.from(document.querySelectorAll<HTMLElement>('[data-kw-panel]'));
  panels.forEach(wirePanel);
  // If a background write fails, the store resyncs — re-render every panel.
  setKeywordResyncHandler(() => panels.forEach(renderPanel));
}
