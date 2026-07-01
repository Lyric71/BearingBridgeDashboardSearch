// Client controller for /seo/content-plan. Each project panel has a form that
// opens an EventSource to /seo/content-plan-generate, which streams the brief
// token-by-token (live SERP + Claude), then persists it to Supabase. We render
// the streaming text live, then swap in the server-rendered HTML on completion
// and prepend the finished brief to the "Saved briefs" list.
interface KwMeta { keyword: string; intent: string; language: string; }
interface Competitor { rank: number; domain: string; title: string; url: string; }

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const fmtDate = (d: Date) => d.toLocaleDateString('en-CA');

function wirePanel(panel: HTMLElement) {
  const projectId = panel.dataset.project ?? '';
  const projectName = panel.dataset.projectName ?? '';
  const form = panel.querySelector<HTMLFormElement>('[data-cp-form]');
  const submit = panel.querySelector<HTMLButtonElement>('[data-cp-submit]');
  const phase = panel.querySelector<HTMLElement>('[data-cp-phase]');
  const output = panel.querySelector<HTMLElement>('[data-cp-output]');
  const outputTitle = panel.querySelector<HTMLElement>('[data-cp-output-title]');
  const outputBody = panel.querySelector<HTMLElement>('[data-cp-output-body]');
  const signalsEl = panel.querySelector<HTMLElement>('[data-cp-signals]');
  const savedEl = panel.querySelector<HTMLElement>('[data-cp-saved]');
  if (!form || !submit || !output || !outputBody) return;

  // keyword -> intent map, so we can auto-fill the intent the SERP was tagged with.
  const kwData: KwMeta[] = (() => {
    try { return JSON.parse(panel.querySelector('[data-cp-keywords]')?.textContent || '[]'); }
    catch { return []; }
  })();

  let running = false;

  form.addEventListener('submit', e => {
    e.preventDefault();
    if (running) return;
    const fd = new FormData(form);
    const keyword = String(fd.get('keyword') || '').trim();
    if (!keyword) return;
    const language = String(fd.get('language') || 'EN');
    const targetUrl = String(fd.get('targetUrl') || '').trim();
    // Prefer the tracked intent for this keyword+language if we have it.
    const match = kwData.find(k => k.keyword.toLowerCase() === keyword.toLowerCase() && (k.language || 'EN') === language)
      ?? kwData.find(k => k.keyword.toLowerCase() === keyword.toLowerCase());
    const intent = match?.intent || '';

    if (!confirm(`Generate a content plan for "${keyword}"?\n\nThis calls the paid DataForSEO API and Claude.`)) return;

    running = true;
    submit.setAttribute('disabled', 'true');
    submit.classList.add('opacity-60', 'cursor-not-allowed');
    if (phase) phase.textContent = 'Starting…';

    output.classList.remove('hidden');
    if (outputTitle) outputTitle.textContent = keyword;
    if (signalsEl) signalsEl.textContent = '';
    outputBody.innerHTML = '<div class="text-xs text-muted-foreground">Waiting for the first tokens…</div>';
    output.scrollIntoView({ behavior: 'smooth', block: 'start' });

    let raw = '';
    let started = false;

    const params = new URLSearchParams({
      keyword, language, intent, targetUrl, projectId, projectName,
    });
    const es = new EventSource(`/seo/content-plan-generate/?${params.toString()}`);
    let finished = false;

    const stop = (msg?: string, isError = false) => {
      finished = true;
      running = false;
      es.close();
      submit.removeAttribute('disabled');
      submit.classList.remove('opacity-60', 'cursor-not-allowed');
      if (phase && msg !== undefined) { phase.textContent = msg; phase.style.color = isError ? 'var(--bbg-red)' : ''; }
    };

    es.onmessage = ev => {
      let m: any;
      try { m = JSON.parse(ev.data); } catch { return; }

      if (m.event === 'phase') {
        if (phase) { phase.textContent = m.msg; phase.style.color = ''; }
      } else if (m.event === 'signals') {
        const v = m.volume;
        const comps: Competitor[] = m.competitors ?? [];
        if (signalsEl) {
          signalsEl.textContent = [
            v ? `${v.volume.toLocaleString('en-US')}/mo` : 'volume n/a',
            v ? `CPC $${v.cpc.toFixed(2)}` : null,
            `${comps.length} competitors`,
          ].filter(Boolean).join(' · ');
        }
      } else if (m.event === 'token') {
        if (!started) { started = true; outputBody.innerHTML = ''; outputBody.classList.add('whitespace-pre-wrap', 'font-mono', 'text-sm'); }
        raw += m.text;
        outputBody.textContent = raw;
      } else if (m.event === 'done') {
        // Swap the live plain-text stream for the rendered Markdown.
        outputBody.classList.remove('whitespace-pre-wrap', 'font-mono', 'text-sm');
        outputBody.innerHTML = m.html;
        if (outputTitle) outputTitle.textContent = m.keyword;
        prependSaved(m.keyword, m.language, m.html, m.indicators);
        stop('Saved to the shared database.');
      } else if (m.event === 'error') {
        stop(m.msg || 'Generation failed.', true);
        if (!started) outputBody.innerHTML = `<div class="text-sm" style="color: var(--bbg-red)">${esc(m.msg || 'Generation failed.')}</div>`;
      }
    };

    es.onerror = () => { if (!finished) stop('Connection lost. Is the server running?', true); };
  });

  // Prepend (or replace) a finished brief in the Saved briefs list.
  function prependSaved(keyword: string, language: string, html: string, indicators: any) {
    if (!savedEl) return;
    // Drop the empty-state if present.
    savedEl.querySelector('.ui-empty')?.remove();

    const key = `${keyword}||${language}`;
    savedEl.querySelector(`[data-cp-saved-item="${CSS.escape(key)}"]`)?.remove();

    const vol = indicators?.volume != null ? ` · ${Number(indicators.volume).toLocaleString('en-US')}/mo` : '';
    const el = document.createElement('details');
    el.className = 'mb-4 ui-card overflow-hidden';
    el.setAttribute('data-cp-saved-item', key);
    el.open = true;
    el.innerHTML =
      `<summary class="px-6 py-4 border-b border-border flex items-center justify-between bg-muted cursor-pointer">
        <span class="font-semibold capitalize">${esc(keyword)}</span>
        <span class="text-xs text-muted-foreground">${esc(language)}${vol} · ${fmtDate(new Date())}</span>
      </summary>
      <div class="p-6 prose max-w-none overflow-x-auto">${html}</div>`;
    savedEl.prepend(el);
  }
}

export function mountContentPlan() {
  document.querySelectorAll<HTMLElement>('[data-cp-panel]').forEach(wirePanel);
}
