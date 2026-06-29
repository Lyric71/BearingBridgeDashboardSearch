"""
ChinaWebFoundry — Google SERP ranking + competitor + content-coverage report.

For every English keyword in seo/keywords/master-list.md (grouped by cluster):
  1. Fetch the top-100 Google organic SERP (DataForSEO).
  2. Find chinawebfoundry.com's rank position (if any).
  3. Auto-discover the top-10 competitor domains across the cluster.
  4. Map the keyword to the most relevant page on chinawebfoundry.com (if any).
  5. Compute a visibility index /100 for us and for each competitor.

Output: data/projects/chinawebfoundry/competitors/<cluster>.md
        (rendered on the dashboard /seo/competitors page)
"""
import http.client, json, base64, re, time, sys, argparse
from collections import defaultdict
from datetime import date
from pathlib import Path

# ── Credentials (same DataForSEO account used for the BBG reports) ──────────────
LOGIN    = "cyril.drouin@beyondbordergroup.com"
PASSWORD = "9e6796d9d94cf3e3"
CREDENTIALS = base64.b64encode(f"{LOGIN}:{PASSWORD}".encode()).decode()

US = "chinawebfoundry.com"
BASE = "https://www.chinawebfoundry.com"
OUT_DIR = Path("c:/Users/cyril/Project/GoogleSearch/data/projects/chinawebfoundry/competitors")

# Google only, global English audience.
LOCATION_CODE = 2840   # United States / global English
LANGUAGE_CODE = "en"

# Generic / non-competitor domains we don't treat as "competitors".
SKIP_DOMAINS = {
    "google.com", "google.co", "youtube.com", "linkedin.com", "facebook.com",
    "instagram.com", "twitter.com", "x.com", "wikipedia.org", "reddit.com",
    "quora.com", "amazon.com", "yelp.com", "medium.com", "github.com",
    "wordpress.org", "wordpress.com", "cloudflare.com", "alibabacloud.com",
    "cloud.tencent.com", "statista.com", "gov.cn", "trade.gov",
}

# ── Keyword clusters (English, from seo/keywords/master-list.md) ────────────────
CLUSTERS = [
    ("01-core-web-agency", "Core Service — Web Agency & China Websites", [
        "web agency china", "china web design", "chinese website design",
        "chinese website development", "website in china", "china website",
        "china market entry website", "cross border website china",
        "bilingual website china",
    ]),
    ("02-wordpress-woocommerce", "WordPress / WooCommerce in China", [
        "wordpress china", "wordpress in china", "make wordpress work in china",
        "woocommerce china",
    ]),
    ("03-hosting-icp-infra", "Hosting · ICP · Infrastructure", [
        "china web hosting", "host website in china", "best china hosting",
        "alibaba cloud hosting", "tencent cloud hosting", "china cdn",
        ".cn domain registration", "icp license", "icp filing",
        "do i need an icp license", "icp license cost",
    ]),
    ("04-performance-firewall", "Performance · Access · Great Firewall", [
        "why is my website slow in china", "website not working in china",
        "is my website blocked in china", "speed up website in china",
        "great firewall website", "does google work in china",
        "is google blocked in china", "wechat browser compatibility",
    ]),
    ("05-baidu-china-seo", "Baidu & China SEO", [
        "baidu seo", "baidu seo agency", "china seo", "how to rank on baidu",
        "baidu tongji", "baidu index", "baidu webmaster tools", "sogou seo",
        "baidu ads",
    ]),
    ("06-ai-search-geo", "AI Search / GEO China", [
        "geo china", "generative engine optimization china",
        "ai search optimization china", "baidu ai seo", "deepseek seo",
        "chinese ai search engines", "how to rank on chinese ai",
    ]),
    ("07-localization-ux", "Localization · UX · Design Best Practices", [
        "china website localization", "chinese website translation",
        "mobile first design china", "mobile only china",
        "chinese web design best practices", "chinese ux design",
        "wechat mini program development", "hreflang china",
    ]),
    ("08-compliance-legal", "Compliance · Legal", [
        "china pipl", "china personal information protection law",
        "china data privacy law", "china cybersecurity law",
        "china data security law", "pipl website compliance",
        "china advertising law compliance",
    ]),
    ("09-digital-marketing", "Digital Marketing · Social · Campaigns", [
        "digital marketing china", "china content marketing",
        "zhongcao marketing", "xiaohongshu marketing", "douyin marketing",
        "kol marketing china", "singles day china", "618 shopping festival",
    ]),
]

# ── Keyword → best on-site content (chinawebfoundry.com) ────────────────────────
# None = no dedicated page covering this keyword yet (a content gap).
G = "/resources/china-web-guide"
S = "/services"
CONTENT = {
    # 01 core
    "web agency china":            ("/web-agency-china", "Web Agency China (service hub)"),
    "china web design":            ("/web-agency-china", "Web Agency China"),
    "chinese website design":      ("/web-agency-china", "Web Agency China"),
    "chinese website development":  ("/web-agency-china", "Web Agency China"),
    "website in china":            ("/", "Homepage"),
    "china website":               ("/", "Homepage"),
    "china market entry website":  (f"{S}/strategy-audit", "Strategy & Audit"),
    "cross border website china":  ("/web-agency-china", "Web Agency China"),
    "bilingual website china":     ("/web-agency-china", "Web Agency China"),
    # 02 wordpress
    "wordpress china":             ("/wordpress", "WordPress in China"),
    "wordpress in china":          ("/wordpress", "WordPress in China"),
    "make wordpress work in china": ("/wordpress", "WordPress in China"),
    "woocommerce china":           ("/wordpress", "WordPress in China"),
    # 03 hosting / icp
    "china web hosting":           (f"{S}/china-hosting", "China Hosting"),
    "host website in china":       (f"{G}/china-website-hosting-guide", "Guide: China Website Hosting"),
    "best china hosting":          (f"{S}/china-hosting", "China Hosting"),
    "alibaba cloud hosting":       (f"{G}/china-website-hosting-guide", "Guide: China Website Hosting"),
    "tencent cloud hosting":       (f"{G}/china-website-hosting-guide", "Guide: China Website Hosting"),
    "china cdn":                   (f"{S}/china-hosting", "China Hosting"),
    ".cn domain registration":     None,
    "icp license":                 (f"{G}/icp-licence-filing-foreign-companies", "Guide: ICP Licence & Filing"),
    "icp filing":                  (f"{G}/icp-licence-filing-foreign-companies", "Guide: ICP Licence & Filing"),
    "do i need an icp license":    (f"{G}/icp-licence-filing-foreign-companies", "Guide: ICP Licence & Filing"),
    "icp license cost":            (f"{G}/icp-licence-filing-foreign-companies", "Guide: ICP Licence & Filing"),
    # 04 performance / firewall
    "why is my website slow in china": (f"{G}/great-firewall-what-it-blocks", "Guide: Great Firewall"),
    "website not working in china":    ("/china-site-scanner", "China Site Scanner (tool)"),
    "is my website blocked in china":  ("/china-site-scanner", "China Site Scanner (tool)"),
    "speed up website in china":       (f"{S}/technical-integration", "Technical Integration"),
    "great firewall website":          (f"{G}/great-firewall-what-it-blocks", "Guide: Great Firewall"),
    "does google work in china":       (f"{G}/great-firewall-what-it-blocks", "Guide: Great Firewall"),
    "is google blocked in china":      (f"{G}/great-firewall-what-it-blocks", "Guide: Great Firewall"),
    "wechat browser compatibility":    ("/wechat", "WeChat"),
    # 05 baidu / china seo
    "baidu seo":                   (f"{S}/baidu-seo", "Baidu SEO"),
    "baidu seo agency":            (f"{S}/baidu-seo", "Baidu SEO"),
    "china seo":                   (f"{S}/baidu-seo", "Baidu SEO"),
    "how to rank on baidu":        (f"{G}/baidu-seo-ranking-in-china", "Guide: Baidu SEO Ranking"),
    "baidu tongji":                (f"{G}/baidu-keyword-research-tools", "Guide: Baidu Keyword Tools"),
    "baidu index":                 (f"{G}/baidu-keyword-research-tools", "Guide: Baidu Keyword Tools"),
    "baidu webmaster tools":       (f"{G}/baidu-keyword-research-tools", "Guide: Baidu Keyword Tools"),
    "sogou seo":                   (f"{G}/china-search-landscape-beyond-baidu", "Guide: Search Landscape Beyond Baidu"),
    "baidu ads":                   None,
    # 06 ai search / geo
    "geo china":                          (f"{S}/geo", "GEO (Generative Engine Optimization)"),
    "generative engine optimization china": (f"{S}/geo", "GEO"),
    "ai search optimization china":       (f"{S}/geo", "GEO"),
    "baidu ai seo":                       (f"{S}/geo", "GEO"),
    "deepseek seo":                       (f"{S}/geo", "GEO"),
    "chinese ai search engines":          (f"{G}/china-search-landscape-beyond-baidu", "Guide: Search Landscape Beyond Baidu"),
    "how to rank on chinese ai":          (f"{S}/geo", "GEO"),
    # 07 localization / ux
    "china website localization":  (f"{G}/china-website-localisation", "Guide: China Website Localisation"),
    "chinese website translation": (f"{S}/chinese-content", "Chinese Content"),
    "mobile first design china":   (f"{G}/mobile-first-design-china", "Guide: Mobile-First Design China"),
    "mobile only china":           (f"{G}/mobile-first-design-china", "Guide: Mobile-First Design China"),
    "chinese web design best practices": (f"{S}/ux-ui-design", "UX/UI Design"),
    "chinese ux design":           (f"{S}/ux-ui-design", "UX/UI Design"),
    "wechat mini program development": ("/wechat", "WeChat"),
    "hreflang china":              (f"{G}/china-website-localisation", "Guide: China Website Localisation"),
    # 08 compliance / legal
    "china pipl":                          (f"{G}/china-data-privacy-pipl-dsl", "Guide: China Data Privacy (PIPL/DSL)"),
    "china personal information protection law": (f"{G}/china-data-privacy-pipl-dsl", "Guide: China Data Privacy (PIPL/DSL)"),
    "china data privacy law":              (f"{G}/china-data-privacy-pipl-dsl", "Guide: China Data Privacy (PIPL/DSL)"),
    "china cybersecurity law":             (f"{G}/china-data-privacy-pipl-dsl", "Guide: China Data Privacy (PIPL/DSL)"),
    "china data security law":             (f"{G}/china-data-privacy-pipl-dsl", "Guide: China Data Privacy (PIPL/DSL)"),
    "pipl website compliance":             (f"{G}/china-data-privacy-pipl-dsl", "Guide: China Data Privacy (PIPL/DSL)"),
    "china advertising law compliance":    None,
    # 09 digital marketing
    "digital marketing china":     (f"{G}/china-content-marketing-strategy", "Guide: China Content Marketing"),
    "china content marketing":     (f"{G}/china-content-marketing-strategy", "Guide: China Content Marketing"),
    "zhongcao marketing":          None,
    "xiaohongshu marketing":       None,
    "douyin marketing":            None,
    "kol marketing china":         None,
    "singles day china":           None,
    "618 shopping festival":       None,
}

# ── API ─────────────────────────────────────────────────────────────────────────
def api_post(endpoint, payload):
    conn = http.client.HTTPSConnection("api.dataforseo.com", timeout=90)
    conn.request("POST", endpoint, json.dumps(payload), {
        "Authorization": f"Basic {CREDENTIALS}",
        "Content-Type": "application/json",
    })
    data = json.loads(conn.getresponse().read().decode())
    conn.close()
    return data

def get_serp(keyword):
    data = api_post("/v3/serp/google/organic/live/regular", [{
        "keyword": keyword,
        "location_code": LOCATION_CODE,
        "language_code": LANGUAGE_CODE,
        "device": "desktop",
        "depth": 100,
    }])
    try:
        task = data["tasks"][0]
        if task.get("status_code") != 20000:
            print(f"  ! SERP error [{task.get('status_code')}] {task.get('status_message')} kw={keyword!r}")
            return False, []
        items = task["result"][0].get("items", []) or []
        return True, [i for i in items if i.get("type") == "organic"]
    except Exception as e:
        print(f"  ! SERP parse error kw={keyword!r}: {e}")
        return False, []

def get_volumes(keywords):
    data = api_post("/v3/keywords_data/google_ads/search_volume/live", [{
        "keywords": keywords,
        "location_code": LOCATION_CODE,
        "language_code": LANGUAGE_CODE,
    }])
    vols = {}
    try:
        task = data["tasks"][0]
        if task.get("status_code") != 20000:
            print(f"  ! Volume error [{task.get('status_code')}] {task.get('status_message')}")
            return vols
        for it in (task["result"] or []):
            kw = (it.get("keyword") or "").lower()
            vols[kw] = {
                "volume": it.get("search_volume") or 0,
                "cpc": round(it.get("cpc") or 0, 2),
                "competition": it.get("competition_index") or 0,
            }
    except Exception as e:
        print(f"  ! Volume parse error: {e}")
    return vols

# ── Helpers ─────────────────────────────────────────────────────────────────────
def extract_domain(url):
    try:
        return re.sub(r"^www\.", "", url.split("/")[2].lower())
    except Exception:
        return ""

def is_skip(domain):
    return any(s in domain for s in SKIP_DOMAINS)

def fmt(r):
    if r is None: return "—"
    if r <= 3:    return f"**{r}**"
    if r <= 10:   return str(r)
    return f"*{r}*"

def vis_index(rank):
    """Visibility index /100: rank 1 = 100, rank 100 = 1, not ranked = 0."""
    if rank is None: return 0
    return max(0, 101 - rank)

def discover_top_competitors(organic_lists, top_n=10):
    appear, rank_sum = defaultdict(int), defaultdict(int)
    for items in organic_lists:
        seen = set()
        for it in items:
            d = extract_domain(it.get("url", ""))
            r = it.get("rank_absolute", 999)
            if not d or d == US or is_skip(d) or d in seen:
                continue
            appear[d] += 1
            rank_sum[d] += r
            seen.add(d)
    scored = [(d, c, rank_sum[d] / c, c * 100 - rank_sum[d] / c) for d, c in appear.items()]
    scored.sort(key=lambda x: -x[3])
    return [d for d, *_ in scored[:top_n]], appear, rank_sum

def ranks_for(items, tracked):
    out = {d: None for d in tracked}
    for it in items:
        url, r = it.get("url", ""), it.get("rank_absolute")
        d = extract_domain(url)
        for t in tracked:
            if (t == d or url.find("//" + t) > -1 or url.find("." + t) > -1) and out[t] is None:
                out[t] = r
    return out

# ── Report builder ──────────────────────────────────────────────────────────────
def build_cluster(cid, label, keywords, organic_cache, volumes):
    top10, appear, rank_sum = discover_top_competitors([organic_cache[k] for k in keywords])
    tracked = [US] + top10

    rows = []
    comp_index_sum = defaultdict(int)   # cumulative visibility index per domain
    for kw in keywords:
        items = organic_cache[kw]
        rk = ranks_for(items, tracked)
        top_domain = extract_domain(items[0].get("url", "")) if items else "—"
        content = CONTENT.get(kw)
        rows.append((kw, rk, top_domain, content))
        for d in tracked:
            comp_index_sum[d] += vis_index(rk[d])

    n = len(keywords)
    today = date.today().strftime("%Y-%m-%d")
    cols = ["Volume", "CPC", "Comp.", "#1 Domain", US] + top10 + ["Our Content", "Index/100"]
    header = "| Keyword | " + " | ".join(cols) + " |"
    sep = "|---|" + "|".join(["---"] * len(cols)) + "|"

    lines = [
        f"# SERP Report — {label}",
        f"Date: {today} | google.com | Global (EN) | Depth: 100 | Tracking: {US}",
        "",
        "**Bold** = top 3 · plain = top 10 · *italic* = 11–100 · — = not ranked · Index/100 = our visibility (rank 1 = 100, unranked = 0)",
        "",
        header, sep,
    ]
    for kw, rk, top_domain, content in rows:
        v = volumes.get(kw.lower(), {})
        row = [
            f"{v.get('volume', 0):,}" if v.get("volume") else "—",
            f"${v.get('cpc', 0):.2f}" if v.get("cpc") else "—",
            str(v.get("competition", "—")),
            top_domain or "—",
        ]
        row += [fmt(rk[d]) for d in tracked]
        if content:
            row.append(f"[{content[1]}]({BASE}{content[0]})")
        else:
            row.append("— *(gap)*")
        row.append(str(vis_index(rk[US])))
        lines.append("| " + kw + " | " + " | ".join(row) + " |")

    # Our headline index for the cluster
    our_idx = round(sum(comp_index_sum[US] for _ in [0]) / n, 1)
    best_comp = max(((d, comp_index_sum[d] / n) for d in top10), key=lambda x: x[1], default=(None, 0))
    rel = round(our_idx / best_comp[1] * 100, 1) if best_comp[1] else 100.0
    ranked_n = sum(1 for _, rk, _, _ in rows if rk[US] is not None)
    covered_n = sum(1 for _, _, _, c in rows if c)

    lines += [
        "",
        "## Top 10 Competitors (auto-discovered)",
        "",
        "| Rank | Domain | Appearances | Avg Position | Visibility Index/100 |",
        "|---|---|---|---|---|",
    ]
    comp_table = [(d, appear[d], round(rank_sum[d] / appear[d], 1), round(comp_index_sum[d] / n, 1)) for d in top10]
    for i, (d, c, avg, idx) in enumerate(comp_table, 1):
        lines.append(f"| {i} | {d} | {c}/{n} | {avg} | {idx} |")

    lines += [
        "",
        "## Ranking Index — ChinaWebFoundry vs Competitors",
        "",
        f"- **Keywords ranked (top 100):** {ranked_n}/{n}",
        f"- **Keywords with on-site content:** {covered_n}/{n}",
        f"- **ChinaWebFoundry visibility index:** **{round(comp_index_sum[US] / n, 1)}/100**",
        f"- **Strongest competitor:** {best_comp[0] or '—'} ({round(best_comp[1], 1)}/100)",
        f"- **Competitive index (us ÷ strongest competitor):** **{rel}/100**",
        "",
        "| Entity | Visibility Index/100 |",
        "|---|---|",
        f"| **{US} (us)** | **{round(comp_index_sum[US] / n, 1)}** |",
    ]
    for d, _, _, idx in comp_table:
        lines.append(f"| {d} | {idx} |")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"{cid}.md"
    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"  saved -> {out.name}  (us ranked {ranked_n}/{n}, index {round(comp_index_sum[US]/n,1)}/100)")
    # our_index_sum is the unrounded cumulative visibility (used to recompute the
    # global overview index exactly when only one cluster has been refreshed).
    return {"cid": cid, "label": label, "n": n, "ranked": ranked_n, "covered": covered_n,
            "our_index": round(comp_index_sum[US] / n, 1), "our_index_sum": round(comp_index_sum[US], 4),
            "rel": rel, "best_comp": best_comp[0], "best_idx": round(best_comp[1], 1)}

def build_overview(summaries):
    """Write 00-overview.md from the per-cluster summaries (order = CLUSTERS).
    Returns the global headline indicators so callers can report before/after."""
    today = date.today().strftime("%Y-%m-%d")
    total = sum(s["n"] for s in summaries)
    ranked = sum(s["ranked"] for s in summaries)
    covered = sum(s["covered"] for s in summaries)
    our_sum = sum(s.get("our_index_sum", s["our_index"] * s["n"]) for s in summaries)
    our_avg = round(our_sum / total, 1) if total else 0
    lines = [
        "# SERP Report — 00 Overview (All Clusters)",
        f"Date: {today} | google.com | Global (EN) | Depth: 100 | Tracking: {US}",
        "",
        f"Across **{total}** English buyer-intent keywords (Google organic, global EN).",
        "",
        "## Headline",
        "",
        f"- **Keywords ranked in top 100:** {ranked}/{total}",
        f"- **Keywords with dedicated on-site content:** {covered}/{total}",
        f"- **Overall ChinaWebFoundry visibility index:** **{our_avg}/100**",
        "",
        "## By Cluster",
        "",
        "| Cluster | Keywords | We rank | Content | Our Index/100 | Top competitor | Their Index | Us vs them /100 |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for s in summaries:
        lines.append(
            f"| {s['label']} | {s['n']} | {s['ranked']}/{s['n']} | {s['covered']}/{s['n']} | "
            f"{s['our_index']} | {s['best_comp'] or '—'} | {s['best_idx']} | {s['rel']} |"
        )
    lines += [
        "",
        "## Top 10 Competitors (auto-discovered)",
        "",
        "Per-cluster competitor tables are in each cluster report. The strongest competitor",
        "per cluster is listed above; open a cluster below for its full top-10 and per-keyword ranks.",
    ]
    (OUT_DIR / "00-overview.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"  saved -> 00-overview.md  (overall index {our_avg}/100)")
    return {"ranked": ranked, "covered": covered, "total": total, "index": our_avg}

# ── Per-cluster state (summaries + history sidecars) ──────────────────────────────
CLUSTER_ORDER  = [cid for cid, _, _ in CLUSTERS]
CLUSTER_LABELS = {cid: label for cid, label, _ in CLUSTERS}
CLUSTER_KWS    = {cid: kws for cid, _, kws in CLUSTERS}
SUMMARIES_PATH = OUT_DIR / "_summaries.json"
HISTORY_PATH   = OUT_DIR / "_history.json"

def emit(obj):
    """Emit one JSON progress line, consumed by the dashboard SSE endpoint."""
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()

def parse_cluster_md(cid):
    """Reconstruct a cluster summary from its rendered .md (bootstrap when no
    _summaries.json exists yet, e.g. the very first per-cluster refresh)."""
    p = OUT_DIR / f"{cid}.md"
    if not p.exists():
        return None
    raw = p.read_text(encoding="utf-8")
    def g(pat, default=None, cast=str):
        m = re.search(pat, raw)
        return cast(m.group(1)) if m else default
    ranked = g(r"Keywords ranked \(top 100\):\*\*\s*(\d+)/", cast=int)
    n      = g(r"Keywords ranked \(top 100\):\*\*\s*\d+/(\d+)", cast=int)
    covered = g(r"Keywords with on-site content:\*\*\s*(\d+)/", cast=int)
    index  = g(r"ChinaWebFoundry visibility index:\*\*\s*\*\*([\d.]+)/100", cast=float)
    if n is None:
        return None
    bm = re.search(r"Strongest competitor:\*\*\s*(.+?)\s*\(([\d.]+)/100\)", raw)
    rel = g(r"Competitive index.*?\*\*\s*\*\*([\d.]+)/100", cast=float)
    index = index or 0.0
    return {
        "cid": cid, "label": CLUSTER_LABELS.get(cid, cid), "n": n,
        "ranked": ranked or 0, "covered": covered or 0,
        "our_index": index, "our_index_sum": round(index * n, 4),
        "rel": rel or 0.0,
        "best_comp": (bm.group(1) if bm and bm.group(1) != "—" else None),
        "best_idx": (float(bm.group(2)) if bm else 0.0),
    }

def read_summaries():
    """Map cid -> summary, preferring the JSON sidecar, else parsing each .md."""
    if SUMMARIES_PATH.exists():
        try:
            return json.loads(SUMMARIES_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    out = {}
    for cid in CLUSTER_ORDER:
        s = parse_cluster_md(cid)
        if s:
            out[cid] = s
    return out

def ordered_summaries(by_cid):
    return [by_cid[c] for c in CLUSTER_ORDER if c in by_cid]

def global_indicators(by_cid):
    summaries = ordered_summaries(by_cid)
    total = sum(s["n"] for s in summaries)
    our_sum = sum(s.get("our_index_sum", s["our_index"] * s["n"]) for s in summaries)
    return {
        "ranked": sum(s["ranked"] for s in summaries),
        "covered": sum(s["covered"] for s in summaries),
        "total": total,
        "index": round(our_sum / total, 1) if total else 0,
    }

def save_summaries(by_cid):
    SUMMARIES_PATH.write_text(json.dumps(by_cid, indent=2), encoding="utf-8")

def append_history(entry):
    hist = []
    if HISTORY_PATH.exists():
        try:
            hist = json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
        except Exception:
            hist = []
    hist.append(entry)
    HISTORY_PATH.write_text(json.dumps(hist, indent=2), encoding="utf-8")

# ── Supabase sync (single source of truth) ───────────────────────────────────────
def _parse_indicators(raw):
    """Pull {ranked, covered, total, index} from a report's headline bullets."""
    raw = raw.replace("\r\n", "\n").replace("\r", "\n")
    out = {}
    for m in re.finditer(r"^-\s*\*\*(.+?):\*\*\s*(.+)$", raw, re.M):
        label = m.group(1).lower()
        val = m.group(2).replace("**", "").strip()
        frac = re.search(r"(\d+)\s*/\s*(\d+)", val)
        if "ranked" in label and frac:
            out["ranked"], out["total"] = int(frac.group(1)), int(frac.group(2))
        elif "content" in label and frac:
            out["covered"] = int(frac.group(1))
        elif "index" in label:
            num = re.search(r"([\d.]+)", val)
            if num:
                out["index"] = float(num.group(1))
    return out or None

def sync_to_db(project_id="chinawebfoundry"):
    """Best-effort: push the freshly written reports + history to Supabase so the
    web app (which reads the DB) reflects this run. Never breaks the file flow."""
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parents[2]))  # repo root
        import supabase_rest
        if not supabase_rest.configured():
            print("  ! Supabase sync skipped: not configured")
            return
        rows = []
        for p in sorted(OUT_DIR.glob("*.md")):
            raw = p.read_text(encoding="utf-8")
            lines = raw.split("\n")
            title_line = next((l for l in lines if l.startswith("# ")), None)
            title = (re.sub(r"^#\s*(SERP Report\s*[—-]\s*)?", "", title_line).strip()
                     if title_line else p.stem)
            date_line = next((l for l in lines if l.startswith("Date:")), None)
            dm = re.search(r"(\d{4}-\d{2}-\d{2})", date_line) if date_line else None
            rows.append({
                "project_id": project_id, "cluster": p.stem, "title": title,
                "report_date": dm.group(1) if dm else None,
                "content_md": raw, "indicators": _parse_indicators(raw),
            })
        supabase_rest.upsert("serp_reports", rows, "project_id,cluster")
        if HISTORY_PATH.exists():
            hist = json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
            supabase_rest.delete_eq("serp_history", "project_id", project_id)
            hrows = [{"project_id": project_id, "cluster": h.get("cluster"),
                      "label": h.get("label"), "ts": h.get("ts"),
                      "before": h.get("before"), "after": h.get("after")} for h in hist]
            if hrows:
                supabase_rest.upsert("serp_history", hrows, "id")
        print(f"  synced {len(rows)} reports -> Supabase")
    except Exception as e:
        print(f"  ! Supabase sync skipped: {e}")

# ── Runs ──────────────────────────────────────────────────────────────────────────
# Full-site refresh is intentionally not supported — refresh one cluster
# (section) at a time via --cluster. This keeps each run cheap/fast and matches
# the per-section "Refresh" buttons on the dashboard.
def run_cluster(cid):
    """Refresh a single cluster, streaming keyword-by-keyword progress as JSON
    lines, then rebuild that cluster's report + the global overview."""
    if cid not in CLUSTER_LABELS:
        emit({"event": "error", "msg": f"unknown cluster: {cid}"})
        return
    label, kws = CLUSTER_LABELS[cid], CLUSTER_KWS[cid]

    by_cid = read_summaries()
    before = {"cluster": by_cid.get(cid), "global": global_indicators(by_cid)}
    emit({"event": "start", "cluster": cid, "label": label, "n": len(kws),
          "keywords": kws, "before": before})

    organic_cache = {}
    for i, kw in enumerate(kws, 1):
        ok, items = get_serp(kw)
        organic_cache[kw] = items
        r = next((it.get("rank_absolute") for it in items
                  if US in extract_domain(it.get("url", ""))), None)
        emit({"event": "keyword", "i": i, "n": len(kws), "kw": kw, "rank": r, "ok": ok})
        time.sleep(0.4)

    emit({"event": "phase", "msg": "Fetching search volumes…"})
    volumes = get_volumes(kws)

    emit({"event": "phase", "msg": "Building report…"})
    summary = build_cluster(cid, label, kws, organic_cache, volumes)
    by_cid[cid] = summary
    save_summaries(by_cid)
    gov = build_overview(ordered_summaries(by_cid))

    after = {"cluster": summary, "global": {k: gov[k] for k in ("ranked", "covered", "total", "index")}}
    entry = {"ts": date.today().strftime("%Y-%m-%d"), "cluster": cid, "label": label,
             "before": before, "after": after}
    append_history(entry)
    sync_to_db()
    emit({"event": "done", **entry})

# ── Main ────────────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description="ChinaWebFoundry SERP ranking report (per-cluster)")
    ap.add_argument("--cluster", required=True,
                    help="Cluster id to refresh, e.g. 05-baidu-china-seo. Full-site refresh is "
                         "intentionally unsupported — refresh section by section.")
    ap.add_argument("--stream", action="store_true", help="Emit JSON progress lines (used by the dashboard)")
    args = ap.parse_args()
    run_cluster(args.cluster)

if __name__ == "__main__":
    main()
