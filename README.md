# BearingBridge Group — SEO & Ads Optimizer

Manual analysis and content generation workflow for beyondbordergroup.com (EN + FR).

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
