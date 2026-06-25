// Per-cluster "Refresh" on /seo/competitors. Clicking a cluster's Refresh
// button opens an EventSource to /seo/refresh, which re-runs the SERP ranking
// for just that cluster and streams progress keyword-by-keyword. We animate a
// live checklist, then show a before → after comparison of every indicator and
// update the headline KPI cards in place. History is persisted server-side
// (_history.json) and re-rendered on the next load.
const PROJECT = 'chinawebfoundry';

interface Indicators { ranked: number; covered: number; total: number; index: number; }
interface ClusterSummary { n: number; ranked: number; covered: number; our_index: number; rel: number; best_comp: string | null; best_idx: number; }
interface Snapshot { cluster: ClusterSummary | null; global: Indicators; }
interface DoneEvent { ts: string; cluster: string; label: string; before: Snapshot; after: Snapshot; }

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
    <div class="rounded-2xl border border-gray-100 p-4 mb-3" style="box-shadow: 5px 3px 8px rgba(0,0,0,0.04)">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-semibold uppercase tracking-widest text-gray-500">Refreshing — ${esc(label)}</span>
        <span data-prog-count class="text-xs tabular-nums text-gray-400">0/${n}</span>
      </div>
      <div class="h-1.5 rounded-full bg-gray-100 overflow-hidden mb-3">
        <div data-prog-bar class="h-full rounded-full transition-all duration-300" style="width:0%; background: var(--bbg-blue)"></div>
      </div>
      <div data-prog-list class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1"></div>
      <div data-prog-phase class="text-xs text-gray-400 mt-3"></div>
      <div data-prog-result class="hidden mt-4 pt-4 border-t border-gray-100"></div>
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
  const es = new EventSource(`/seo/refresh?project=${encodeURIComponent(PROJECT)}&cluster=${encodeURIComponent(cid)}`);
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
      <div class="text-xs text-gray-400 mt-3">Saved to history · ${esc(m.ts)}. Reload to refresh the ranking tables.</div>`;
  }
  const phase = zone.querySelector<HTMLElement>('[data-prog-phase]');
  if (phase) phase.textContent = '';

  // Live-update the headline KPI cards at the top of the page.
  if (panel) {
    const set = (key: string, val: string) => {
      const el = panel.querySelector<HTMLElement>(`[data-kpi="${key}"]`);
      if (el) el.textContent = val;
    };
    set('ranked', `${m.after.global.ranked}/${m.after.global.total}`);
    set('covered', `${m.after.global.covered}/${m.after.global.total}`);
    set('index', `${m.after.global.index}/100`);
  }
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
}
