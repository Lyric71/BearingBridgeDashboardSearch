# BearingBridge Group — SEO & Ads Optimizer

Manual analysis and content generation workflow for beyondbordergroup.com (EN + FR).

## Tech Stack

The reporting site (`reporting-site/`) is a statically-built Astro app.

| Component          | Version  | Role                                              |
| :----------------- | :------- | :------------------------------------------------ |
| Node.js            | ≥ 22.12  | Runtime                                            |
| Astro              | 7.0.3    | Static site framework (SSG; dev-only SSE route)   |
| Tailwind CSS       | 4.3.1    | Styling (via the `@tailwindcss/vite` 4.3.1 plugin)|
| marked             | 18.0.5   | Markdown → HTML rendering for reports             |
| sharp              | 0.35.2   | Image optimization (`img:batch` script)           |
| TypeScript         | strict   | Typed scripts and server route                    |

## Folder Structure

```
config/         → Domain settings, competitor list
data/
  raw/          → Raw exports from Search Console, DataForSEO (CSV/JSON)
  processed/    → Cleaned/merged data ready for analysis
reports/
  keywords/     → Keyword audit reports
  ads/          → Generated ad copy
  content/      → SEO content briefs and drafts
  competitors/  → Competitor ranking snapshots
inputs/         → Prompts and data you paste into Claude
prompts/        → Reusable Claude prompt templates
```

## Workflow

1. Export data from Google Search Console or DataForSEO → save in `data/raw/`
2. Paste data into Claude with the relevant prompt from `prompts/`
3. Save Claude's output in the appropriate `reports/` subfolder

## Data Sources

- **Google Search Console** → search-console.google.com
- **DataForSEO** → dataforseo.com
