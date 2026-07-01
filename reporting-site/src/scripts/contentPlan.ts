// Client controller for /seo/content-plan.
//   • Landing mode: single keyword → streamed Markdown brief, saved as a card.
//   • Blog mode: a cluster → Claude proposes N NEW distinct articles (added to
//     any existing ones). Each article renders as a card that can be Accepted or
//     Deleted; accepted articles get a Published toggle + publication URL, all
//     persisted via /api/blog-articles/:id.
import { marked } from 'marked';

type Kind = 'landing' | 'blog';
interface KwMeta { keyword: string; intent: string; language: string; }
interface Article {
  id: string; title: string; primary_keyword: string | null; secondary_keywords: string | null;
  intent: string | null; funnel_stage: string | null; est_words: number | null; role: string | null;
  slug: string | null; outline_md: string | null; status: 'proposed' | 'accepted';
  published: boolean; published_url: string | null;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtDate = (d: Date) => d.toLocaleDateString('en-CA');

// ── /api/blog-articles auth helper (same bearer as the rest of /api/*) ────────
const tok = () => sessionStorage.getItem('bbg_session') ?? '';
async function apiArticle(id: string, method: 'PATCH' | 'DELETE', body?: unknown): Promise<any> {
  const res = await fetch(`/api/blog-articles/${id}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { msg = (await res.json()).error ?? msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

// ── Article card rendering ────────────────────────────────────────────────────
function badge(a: Article): string {
  if (a.status === 'proposed')
    return '<span class="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-muted text-muted-foreground">Proposed</span>';
  if (a.published)
    return '<span class="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded text-white" style="background:#16a34a">Published</span>';
  return '<span class="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded text-white" style="background:var(--bbg-blue)">Accepted</span>';
}

function controls(a: Article): string {
  const del = '<button data-article-delete class="text-xs px-2.5 py-1.5 rounded-lg text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">Delete</button>';
  if (a.status === 'proposed') {
    return `<button data-article-accept class="btn-primary text-xs">Accept</button>${del}`;
  }
  return `<label class="flex items-center gap-1.5 text-xs"><input type="checkbox" data-article-published ${a.published ? 'checked' : ''}/> Published</label>
    <input data-article-url type="url" value="${esc(a.published_url ?? '')}" placeholder="Publication URL" class="ui-input text-xs flex-1 min-w-[12rem]"/>${del}`;
}

function articleCard(a: Article): string {
  const meta = [a.role, a.primary_keyword, a.intent, a.funnel_stage, a.est_words ? `~${a.est_words}w` : null]
    .filter(Boolean).map(x => esc(String(x))).join(' · ');
  const slug = a.slug ? `<div class="text-xs text-muted-foreground">Slug: ${esc(a.slug)}</div>` : '';
  const sec = a.secondary_keywords ? `<div class="text-xs text-muted-foreground">Secondary: ${esc(a.secondary_keywords)}</div>` : '';
  const outline = a.outline_md ? marked.parse(a.outline_md) : '';
  return `<div class="ui-card p-4" data-article="${a.id}" data-status="${a.status}">
    <div class="flex items-start justify-between gap-3">
      <div><div class="font-semibold">${esc(a.title)}</div>
        <div class="text-xs text-muted-foreground mt-0.5">${meta}</div></div>
      <span data-article-badge>${badge(a)}</span>
    </div>
    <details class="mt-2"><summary class="text-xs cursor-pointer text-muted-foreground">Outline &amp; details</summary>
      ${slug}${sec}
      <div class="prose prose-sm max-w-none mt-2">${outline}</div>
    </details>
    <div class="mt-3 flex flex-wrap items-center gap-2" data-article-controls>${controls(a)}</div>
  </div>`;
}

const emptyArticles = '<div data-cp-articles-empty class="text-xs text-muted-foreground">No articles yet.</div>';

function refreshCount(shell: HTMLElement) {
  const n = shell.querySelectorAll('[data-cp-articles] [data-article]').length;
  const el = shell.querySelector('[data-cp-article-count]');
  if (el) el.textContent = String(n);
}

function wirePanel(panel: HTMLElement) {
  const projectId = panel.dataset.project ?? '';
  const projectName = panel.dataset.projectName ?? '';
  const output = panel.querySelector<HTMLElement>('[data-cp-output]');
  const outputTitle = panel.querySelector<HTMLElement>('[data-cp-output-title]');
  const outputBody = panel.querySelector<HTMLElement>('[data-cp-output-body]');
  const signalsEl = panel.querySelector<HTMLElement>('[data-cp-signals]');
  const savedBlog = panel.querySelector<HTMLElement>('[data-cp-saved="blog"]');
  if (!output || !outputBody) return;

  const kwData: KwMeta[] = (() => {
    try { return JSON.parse(panel.querySelector('[data-cp-keywords]')?.textContent || '[]'); }
    catch { return []; }
  })();
  const articleData: Record<string, Article[]> = (() => {
    try { return JSON.parse(panel.querySelector('[data-cp-articles-data]')?.textContent || '{}'); }
    catch { return {}; }
  })();

  // Initial render of existing article cards into each blog plan shell.
  panel.querySelectorAll<HTMLElement>('[data-cp-articles]').forEach(container => {
    const shell = container.closest<HTMLElement>('[data-plan-id]');
    const list = (shell && articleData[shell.dataset.planId ?? '']) || [];
    container.innerHTML = list.length ? list.map(articleCard).join('') : emptyArticles;
  });

  // ── Article actions (delegated on the blog saved section) ─────────────────
  if (savedBlog) {
    savedBlog.addEventListener('click', async e => {
      const target = e.target as HTMLElement;
      const card = target.closest<HTMLElement>('[data-article]');
      if (!card) return;
      const id = card.dataset.article!;
      if (target.closest('[data-article-accept]')) {
        try { card.outerHTML = articleCard(await apiArticle(id, 'PATCH', { status: 'accepted' })); }
        catch (err) { alert((err as Error).message); }
      } else if (target.closest('[data-article-delete]')) {
        if (!confirm('Delete this article? This cannot be undone.')) return;
        const shell = card.closest<HTMLElement>('[data-plan-id]');
        try {
          await apiArticle(id, 'DELETE');
          const container = card.parentElement;
          card.remove();
          if (shell) refreshCount(shell);
          if (container && !container.querySelector('[data-article]')) container.innerHTML = emptyArticles;
        } catch (err) { alert((err as Error).message); }
      }
    });
    savedBlog.addEventListener('change', async e => {
      const target = e.target as HTMLElement;
      const card = target.closest<HTMLElement>('[data-article]');
      if (!card) return;
      const id = card.dataset.article!;
      if (target.matches('[data-article-published]')) {
        const cb = target as HTMLInputElement;
        try {
          const up: Article = await apiArticle(id, 'PATCH', { published: cb.checked });
          const b = card.querySelector('[data-article-badge]'); if (b) b.innerHTML = badge(up);
        } catch (err) { cb.checked = !cb.checked; alert((err as Error).message); }
      } else if (target.matches('[data-article-url]')) {
        try { await apiArticle(id, 'PATCH', { published_url: (target as HTMLInputElement).value.trim() }); }
        catch (err) { alert((err as Error).message); }
      }
    });
  }

  // ── Mode toggle ───────────────────────────────────────────────────────────
  const modeBtns = panel.querySelectorAll<HTMLButtonElement>('[data-cp-mode]');
  function setMode(mode: Kind) {
    modeBtns.forEach(b => {
      const active = b.dataset.cpMode === mode;
      b.classList.toggle('bg-background', active);
      b.classList.toggle('shadow-sm', active);
      b.classList.toggle('text-foreground', active);
      b.classList.toggle('text-muted-foreground', !active);
    });
    panel.querySelectorAll<HTMLElement>('[data-cp-form-wrap]').forEach(w => {
      w.classList.toggle('hidden', w.dataset.cpFormWrap !== mode);
    });
  }
  modeBtns.forEach(b => b.addEventListener('click', () => setMode(b.dataset.cpMode as Kind)));
  setMode('landing');

  let running = false;

  // ── Forms ─────────────────────────────────────────────────────────────────
  panel.querySelectorAll<HTMLFormElement>('[data-cp-form]').forEach(form => {
    const kind = (form.dataset.kind as Kind) || 'landing';
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    const phase = form.querySelector<HTMLElement>('[data-cp-phase]');

    form.addEventListener('submit', e => {
      e.preventDefault();
      if (running) return;
      const fd = new FormData(form);
      const language = String(fd.get('language') || 'EN');
      const targetUrl = String(fd.get('targetUrl') || '').trim();

      const params = new URLSearchParams({ kind, language, targetUrl, projectId, projectName });
      let label = '';
      if (kind === 'blog') {
        const cluster = String(fd.get('cluster') || '').trim();
        if (!cluster) return;
        label = cluster;
        params.set('cluster', cluster);
        const articleCount = String(fd.get('articleCount') || '1').trim() || '1';
        params.set('articleCount', articleCount);
        if (!confirm(`Draft ${articleCount} new article(s) for the cluster "${cluster}"?\n\nExisting articles are kept; new ones will be distinct. This calls the paid DataForSEO API and Claude.`)) return;
      } else {
        const keyword = String(fd.get('keyword') || '').trim();
        if (!keyword) return;
        label = keyword;
        const match = kwData.find(k => k.keyword.toLowerCase() === keyword.toLowerCase() && (k.language || 'EN') === language)
          ?? kwData.find(k => k.keyword.toLowerCase() === keyword.toLowerCase());
        params.set('keyword', keyword);
        params.set('intent', match?.intent || '');
        if (!confirm(`Generate a landing-page plan for "${keyword}"?\n\nThis calls the paid DataForSEO API and Claude.`)) return;
      }

      running = true;
      submit?.setAttribute('disabled', 'true');
      submit?.classList.add('opacity-60', 'cursor-not-allowed');
      if (phase) { phase.textContent = 'Starting…'; phase.style.color = ''; }

      output.classList.remove('hidden');
      if (outputTitle) outputTitle.textContent = label;
      if (signalsEl) signalsEl.textContent = '';
      outputBody.classList.remove('whitespace-pre-wrap', 'font-mono', 'text-sm');
      outputBody.innerHTML = '<div class="text-xs text-muted-foreground">Working…</div>';
      output.scrollIntoView({ behavior: 'smooth', block: 'start' });

      let raw = '';
      let started = false;
      const es = new EventSource(`/seo/content-plan-generate/?${params.toString()}`);
      let finished = false;

      const stop = (msg?: string, isError = false) => {
        finished = true;
        running = false;
        es.close();
        submit?.removeAttribute('disabled');
        submit?.classList.remove('opacity-60', 'cursor-not-allowed');
        if (phase && msg !== undefined) { phase.textContent = msg; phase.style.color = isError ? 'var(--bbg-red)' : ''; }
      };

      es.onmessage = ev => {
        let m: any;
        try { m = JSON.parse(ev.data); } catch { return; }

        if (m.event === 'phase') {
          if (phase) { phase.textContent = m.msg; phase.style.color = ''; }
        } else if (m.event === 'signals') {
          if (signalsEl) signalsEl.textContent = m.summary || '';
        } else if (m.event === 'token') {
          if (!started) { started = true; outputBody.innerHTML = ''; outputBody.classList.add('whitespace-pre-wrap', 'font-mono', 'text-sm'); }
          raw += m.text;
          outputBody.textContent = raw;
        } else if (m.event === 'done') {
          if (m.kind === 'blog') {
            outputBody.classList.remove('whitespace-pre-wrap', 'font-mono', 'text-sm');
            const n = (m.articles || []).length;
            outputBody.innerHTML = `<div class="text-sm">✓ Added ${n} new article${n === 1 ? '' : 's'} to <span class="font-semibold">${esc(m.label)}</span>. See the plan below.</div>`;
            onBlogDone(m);
          } else {
            outputBody.classList.remove('whitespace-pre-wrap', 'font-mono', 'text-sm');
            outputBody.innerHTML = m.html;
            prependLanding(m.label, m.language, m.html, m.indicators);
          }
          stop('Saved to the shared database.');
        } else if (m.event === 'error') {
          stop(m.msg || 'Generation failed.', true);
          if (!started) outputBody.innerHTML = `<div class="text-sm" style="color: var(--bbg-red)">${esc(m.msg || 'Generation failed.')}</div>`;
        }
      };

      es.onerror = () => { if (!finished) stop('Connection lost. Is the server running?', true); };
    });
  });

  // Landing: prepend (or replace) a saved brief card.
  function prependLanding(keyword: string, language: string, html: string, indicators: any) {
    const savedEl = panel.querySelector<HTMLElement>('[data-cp-saved="landing"]');
    if (!savedEl) return;
    savedEl.querySelector('.ui-empty')?.remove();
    const key = `landing||${keyword}||${language}`;
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

  // Blog: create-or-update the plan shell, then append the new article cards.
  function onBlogDone(m: any) {
    if (!savedBlog) return;
    panel.querySelector('[data-cp-blog-empty]')?.classList.add('hidden');
    let shell = savedBlog.querySelector<HTMLElement>(`[data-plan-id="${CSS.escape(m.planId)}"]`);
    if (!shell) {
      shell = document.createElement('div');
      shell.className = 'mb-6 ui-card overflow-hidden';
      shell.setAttribute('data-cp-saved-item', `blog||${m.label}||${m.language}`);
      shell.dataset.planId = m.planId;
      shell.dataset.cluster = m.label;
      shell.dataset.language = m.language;
      shell.innerHTML =
        `<div class="px-6 py-4 border-b border-border flex items-center justify-between bg-muted">
          <span class="font-semibold">${esc(m.label)}</span>
          <span class="text-xs text-muted-foreground">${esc(m.language)} · <span data-cp-article-count>0</span> articles · ${fmtDate(new Date())}</span>
        </div>
        <div class="p-6">
          <div data-cp-articles class="grid gap-3"></div>
          <details class="mt-4"><summary class="ui-eyebrow cursor-pointer">Plan overview &amp; linking</summary>
            <div data-cp-overview class="prose max-w-none overflow-x-auto mt-3"></div></details>
        </div>`;
      const empty = savedBlog.querySelector('[data-cp-blog-empty]');
      savedBlog.insertBefore(shell, empty ? empty.nextSibling : savedBlog.firstChild);
    }
    const overview = shell.querySelector('[data-cp-overview]'); if (overview) overview.innerHTML = m.html;
    const container = shell.querySelector<HTMLElement>('[data-cp-articles]')!;
    container.querySelector('[data-cp-articles-empty]')?.remove();
    container.insertAdjacentHTML('beforeend', (m.articles || []).map(articleCard).join(''));
    refreshCount(shell);
    shell.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

export function mountContentPlan() {
  document.querySelectorAll<HTMLElement>('[data-cp-panel]').forEach(wirePanel);
}
