// Per-cluster "Refresh" on /seo/competitors. Clicking a cluster's Refresh
// button opens an EventSource to /seo/refresh, which re-runs the SERP
// ranking for just that cluster server-side and streams progress
// keyword-by-keyword. We animate a live checklist, then show a before → after
// comparison of every indicator and update the headline KPI cards in place.
// Reports + history are persisted to Supabase and re-rendered on the next load.
const PROJECT = 'chinawebfoundry';

interface Indicators { ranked: number; covered: number; total: number; index: number; }
interface ClusterSummary { n: number; ranked: number; covered: number; our_index: number; rel: number; best_comp: string | null; best_idx: number; }
interface Snapshot { cluster: ClusterSummary | null; global: Indicators; }
interface KeywordHistory {
  keyword: string;
  before_rank: number | null; after_rank: number | null;
  before_ts: string | null; after_ts: string | null;
}
interface DoneEvent {
  ts: string; cluster: string; label: string; before: Snapshot; after: Snapshot;
  rankHtml: string; scoreHtml: string; keywordHistory: KeywordHistory[];
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function statusIcon(state: 'pending' | 'active' | 'done' | 'miss'): string {
  if (state === 'active') return '<span class="inline-block w-2.5 h-2.5 rounded-full bg-blue-500 animate-ping"></span>';
  if (state === 'done') return '<span class="inline-block w-2.5 h-2.5 rounded-full" style="background:#16a34a"></span>';
  if (state === 'miss') return '<span class="inline-block w-2.5 h-2.5 rounded-full bg-gray-300"></span>';
  return '<span class="inline-block w-2.5 h-2.5 rounded-full border border-gray-300"></span>';
}

// One before → after metric line, coloured by direction (green up, red down).
function deltaLine(label: string, before: number | null | undefined, after: number | null | undefined, suffix = ''): string {
  const bn = Number(before), an = Number(after);
  const dir = isNaN(bn) || isNaN(an) || an === bn ? 0 : an > bn ? 1 : -1;
  const color = dir > 0 ? '#16a34a' : dir < 0 ? 'var(--bbg-red)' : 'var(--bbg-gray-muted)';
  const b = before ?? '—', a = after ?? '—';
  return `<div class="flex items-center gap-2 text-sm">
    <span class="text-gray-400 w-28">${label}</span>
    <span class="tabular-nums text-gray-600">${b}${suffix}</span>
    <span style="color:${color}">→</span>
    <span class="tabular-nums font-semibold" style="color:${color}">${a}${suffix}</span>
  </div>`;
}

function progressShell(label: string, n: number): string {
  return `
    <div class="ui-card p-4 mb-3">
      <div class="flex items-center justify-between mb-2">
        <span class="ui-eyebrow">Refreshing — ${esc(label)}</span>
        <span data-prog-count class="text-xs tabular-nums text-muted-foreground">0/${n}</span>
      </div>
      <div class="h-1.5 rounded-full bg-muted overflow-hidden mb-3">
        <div data-prog-bar class="h-full rounded-full transition-all duration-300" style="width:0%; background: var(--bbg-blue)"></div>
      </div>
      <div data-prog-list class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1"></div>
      <div data-prog-phase class="text-xs text-muted-foreground mt-3"></div>
      <div data-prog-result class="hidden mt-4 pt-4 border-t border-border"></div>
    </div>`;
}

function kwRow(idx: number, kw: string): string {
  return `<div data-kw-row="${idx}" class="flex items-center gap-2 text-xs py-0.5">
    <span data-kw-status>${statusIcon('pending')}</span>
    <span class="text-gray-700 truncate">${esc(kw)}</span>
    <span data-kw-rank class="ml-auto tabular-nums text-gray-400"></span>
  </div>`;
}

function startRefresh(details: HTMLDetailsElement, cid: string, btn: HTMLButtonElement) {
  if (btn.dataset.busy === '1') return;
  if (!confirm('Re-run the live Google SERP ranking for this cluster?\n\nThis calls the paid DataForSEO API (one request per keyword).')) return;

  const zone = details.querySelector<HTMLElement>('[data-refresh-zone]');
  if (!zone) return;
  details.open = true;
  btn.dataset.busy = '1';
  btn.setAttribute('disabled', 'true');
  btn.classList.add('opacity-60', 'cursor-not-allowed');
  btn.querySelector('[data-refresh-icon]')?.classList.add('animate-spin');

  zone.classList.remove('hidden');
  zone.innerHTML = `<div class="text-xs text-gray-400">Starting…</div>`;

  const panel = details.closest<HTMLElement>('[data-competitors-panel]');
  // Trailing slash required: the site is configured with trailingSlash: 'always'.
  const es = new EventSource(`/seo/refresh/?project=${encodeURIComponent(PROJECT)}&cluster=${encodeURIComponent(cid)}`);
  let finished = false;

  const finish = (msg?: string, isError = false) => {
    finished = true;
    es.close();
    btn.dataset.busy = '';
    btn.removeAttribute('disabled');
    btn.classList.remove('opacity-60', 'cursor-not-allowed');
    btn.querySelector('[data-refresh-icon]')?.classList.remove('animate-spin');
    if (msg) {
      const phase = zone.querySelector<HTMLElement>('[data-prog-phase]');
      if (phase) { phase.textContent = msg; phase.style.color = isError ? 'var(--bbg-red)' : ''; }
    }
  };

  es.onmessage = ev => {
    let m: any;
    try { m = JSON.parse(ev.data); } catch { return; }

    if (m.event === 'start') {
      zone.innerHTML = progressShell(m.label ?? cid, m.n);
      const list = zone.querySelector<HTMLElement>('[data-prog-list]')!;
      list.innerHTML = (m.keywords as string[]).map((kw, i) => kwRow(i + 1, kw)).join('');
      // Mark the first keyword active.
      const first = list.querySelector('[data-kw-row="1"] [data-kw-status]');
      if (first) first.innerHTML = statusIcon('active');
    } else if (m.event === 'keyword') {
      const list = zone.querySelector<HTMLElement>('[data-prog-list]');
      const row = list?.querySelector<HTMLElement>(`[data-kw-row="${m.i}"]`);
      if (row) {
        row.querySelector('[data-kw-status]')!.innerHTML = statusIcon(m.rank ? 'done' : 'miss');
        const rankEl = row.querySelector<HTMLElement>('[data-kw-rank]')!;
        rankEl.textContent = m.rank ? `#${m.rank}` : 'not ranked';
        if (m.rank) { rankEl.style.color = '#16a34a'; rankEl.classList.add('font-semibold'); }
      }
      const next = list?.querySelector(`[data-kw-row="${m.i + 1}"] [data-kw-status]`);
      if (next) next.innerHTML = statusIcon('active');
      const pct = Math.round((m.i / m.n) * 100);
      zone.querySelector<HTMLElement>('[data-prog-bar]')!.style.width = `${pct}%`;
      zone.querySelector<HTMLElement>('[data-prog-count]')!.textContent = `${m.i}/${m.n}`;
    } else if (m.event === 'phase') {
      const phase = zone.querySelector<HTMLElement>('[data-prog-phase]');
      if (phase) phase.textContent = m.msg;
    } else if (m.event === 'done') {
      renderDone(zone, panel, m as DoneEvent);
    } else if (m.event === 'error') {
      finish(m.msg || 'Refresh failed.', true);
    } else if (m.event === 'exit') {
      if (!finished) finish(m.code === 0 ? undefined : `Script exited (code ${m.code}).`, m.code !== 0);
    }
  };

  es.onerror = () => {
    if (!finished) finish('Connection lost. Is the dev server running?', true);
  };
}

// Recompute the collapsed summary badges (keyword count + "p1: x/total") from
// the freshly swapped-in ranking table, so they match after keywords are added.
// Mirrors the server-side column logic: our rank is the 6th cell (| Keyword |
// Volume | CPC | Comp. | #1 Domain | us | …), a top-3 hit renders as **bold**,
// top-10 as plain, 11–100 as *italic*, and — / empty as not ranked.
// A row is top-10 (page 1) when the "us" column is bold (top 3) or plain
// (top 10) — i.e. present and not italic (*11–100*) and not — / empty.
function rowIsTop10(tr: Element): boolean {
  const cell = tr.querySelectorAll('td')[5]; // 0-based: [0]=Keyword…[5]=us column
  const txt = cell?.textContent?.trim() ?? '';
  if (!txt || txt === '—' || txt === '-') return false;
  return !!cell?.querySelector('strong') || !cell?.querySelector('em');
}

function updateGroupBadge(details: HTMLElement, rankEl: HTMLElement) {
  const rows = Array.from(rankEl.querySelectorAll('tbody tr'));
  let page1 = 0;
  const total = rows.length;
  for (const tr of rows) if (rowIsTop10(tr)) page1++;
  const countEl = details.querySelector<HTMLElement>('[data-count-badge]');
  if (countEl) countEl.textContent = `${total} ${total === 1 ? 'keyword' : 'keywords'}`;
  const p1El = details.querySelector<HTMLElement>('[data-p1-badge]');
  if (p1El) {
    if (page1 > 0) { p1El.textContent = `p1: ${page1}/${total}`; p1El.style.background = 'var(--bbg-blue)'; }
    else { p1El.textContent = 'not on p1'; p1El.style.background = 'var(--bbg-gray-muted)'; }
  }
}

// Re-render the per-keyword Refresh History (previous → current rank) in place.
// Creates the container just after the refresh zone if this is the first refresh
// (server only renders [data-history] when history already existed).
function renderKeywordHistory(details: HTMLElement, zone: HTMLElement, hist: KeywordHistory[]) {
  if (!hist || hist.length === 0) return;
  const fmt = (r: number | null) => (r == null ? '—' : `#${r}`);
  const rows = hist.map(h => {
    const b = h.before_rank, a = h.after_rank;
    const dir = b == null || a == null || a === b ? 0 : a < b ? 1 : -1;
    const color = dir > 0 ? '#16a34a' : dir < 0 ? 'var(--bbg-red)' : 'var(--bbg-gray-muted)';
    return `<div class="flex items-center gap-2 text-xs py-0.5">
      <span class="text-gray-600 truncate">${esc(h.keyword)}</span>
      <span class="ml-auto tabular-nums text-gray-400">${fmt(b)}</span>
      <span style="color:${color}">→</span>
      <span class="tabular-nums font-semibold" style="color:${color}">${fmt(a)}</span>
    </div>`;
  }).join('');
  const inner = `<h3 class="ui-eyebrow mb-3">Refresh History <span class="text-muted-foreground font-normal normal-case">· previous → current rank</span></h3>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">${rows}</div>`;

  let box = details.querySelector<HTMLElement>('[data-history]');
  if (!box) {
    box = document.createElement('div');
    box.setAttribute('data-history', '');
    box.className = 'px-6 pt-5 pb-2';
    zone.insertAdjacentElement('afterend', box);
  }
  box.innerHTML = inner;
}

function renderDone(zone: HTMLElement, panel: HTMLElement | null, m: DoneEvent) {
  const bar = zone.querySelector<HTMLElement>('[data-prog-bar]');
  if (bar) { bar.style.width = '100%'; bar.style.background = '#16a34a'; }
  const count = zone.querySelector<HTMLElement>('[data-prog-count]');
  if (count && m.after.cluster) count.textContent = `${m.after.cluster.n}/${m.after.cluster.n}`;

  const cb = m.before.cluster, ca = m.after.cluster, gb = m.before.global, ga = m.after.global;
  const result = zone.querySelector<HTMLElement>('[data-prog-result]');
  if (result && ca) {
    result.classList.remove('hidden');
    result.innerHTML = `
      <div class="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-2">Before → After</div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5">
        <div>
          <div class="text-[10px] uppercase tracking-widest text-gray-400 mb-1">This cluster</div>
          ${deltaLine('We rank', cb?.ranked, ca.ranked, `/${ca.n}`)}
          ${deltaLine('Content', cb?.covered, ca.covered, `/${ca.n}`)}
          ${deltaLine('Visibility index', cb?.our_index, ca.our_index)}
          ${deltaLine('Us vs best', cb?.rel, ca.rel)}
        </div>
        <div>
          <div class="text-[10px] uppercase tracking-widest text-gray-400 mb-1">Overall (all clusters)</div>
          ${deltaLine('Ranked', gb?.ranked, ga.ranked, `/${ga.total}`)}
          ${deltaLine('Content', gb?.covered, ga.covered, `/${ga.total}`)}
          ${deltaLine('Visibility index', gb?.index, ga.index)}
        </div>
      </div>
      <div class="text-xs text-gray-400 mt-3">Saved to history · ${esc(m.ts)}. Tables below updated with the latest keywords.</div>`;
  }
  const phase = zone.querySelector<HTMLElement>('[data-prog-phase]');
  if (phase) phase.textContent = '';

  // Swap the cluster's ranking + competitor tables in place so keywords added on
  // /seo/keywords since the last refresh show immediately (no page reload).
  const details = zone.closest<HTMLDetailsElement>('details[data-group]');
  if (details) {
    const rankEl = details.querySelector<HTMLElement>('[data-rank-table]');
    if (rankEl && m.rankHtml) rankEl.innerHTML = m.rankHtml;
    const scoreEl = details.querySelector<HTMLElement>('[data-score-table]');
    if (scoreEl && m.scoreHtml) scoreEl.innerHTML = m.scoreHtml;
    if (rankEl) updateGroupBadge(details, rankEl);
    renderKeywordHistory(details, zone, m.keywordHistory);
  }

  // Live-update the headline KPI cards at the top of the page.
  if (panel) {
    const set = (key: string, val: string) => {
      const el = panel.querySelector<HTMLElement>(`[data-kpi="${key}"]`);
      if (el) el.textContent = val;
    };
    set('ranked', `${m.after.global.ranked}/${m.after.global.total}`);
    // Top-10 count isn't in the refresh payload; recompute from every rank
    // table in the panel (the refreshed cluster's table was just swapped in).
    const top10 = Array.from(panel.querySelectorAll('[data-rank-table] tbody tr'))
      .filter(rowIsTop10).length;
    set('rankedTop10', `${top10}/${m.after.global.total}`);
    set('covered', `${m.after.global.covered}/${m.after.global.total}`);
    set('index', `${m.after.global.index}/100`);
  }
}

// Open every cluster that has a top-10 keyword and highlight those rows green.
// Clicking again clears the highlights (toggle).
function viewTop10(panel: HTMLElement) {
  const rows = Array.from(panel.querySelectorAll<HTMLElement>('[data-rank-table] tbody tr'));
  const alreadyOn = rows.some(r => r.classList.contains('top10-hl'));
  for (const tr of rows) { tr.classList.remove('top10-hl'); tr.style.removeProperty('background'); }
  if (alreadyOn) return; // second click = clear

  let first: HTMLElement | null = null;
  for (const tr of rows) {
    if (!rowIsTop10(tr)) continue;
    tr.classList.add('top10-hl');
    tr.style.background = 'rgba(22, 163, 74, 0.14)';
    tr.closest<HTMLDetailsElement>('details[data-group]')?.setAttribute('open', '');
    if (!first) first = tr;
  }
  first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export function mountCompetitorsRefresh() {
  const panel = document.querySelector<HTMLElement>(`[data-competitors-panel][data-project="${PROJECT}"]`);
  if (!panel) return;

  // Capture phase so we cancel the <summary> toggle before it happens.
  panel.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-refresh]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const details = btn.closest<HTMLDetailsElement>('details[data-group]');
    if (details) startRefresh(details, btn.dataset.cid!, btn);
  }, true);

  // Click a rank-table row to toggle a selection colour.
  panel.addEventListener('click', e => {
    const tr = (e.target as HTMLElement).closest<HTMLElement>('[data-rank-table] tbody tr');
    if (tr) tr.classList.toggle('rank-row-selected');
  });

  // "View" button on the top-10 KPI card.
  panel.addEventListener('click', e => {
    if ((e.target as HTMLElement).closest('[data-view-top10]')) viewTop10(panel);
  });
}
