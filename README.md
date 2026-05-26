# LAA-lander-template

**Type:** DJM A/B landing page template
**Managed by:** Strive Marketing / Dirty Job Marketing

Plain HTML landing page template with built-in A/B traffic splitting, lead/call tracking, and a password-protected reports dashboard. No build step — Cloudflare Pages serves it directly.

---

## Files

| File | Purpose |
|------|---------|
| `index-a.html` | Variant A — exported from Claude Design, added by Claude Code |
| `index-b.html` | Variant B — exported from Claude Design, added by Claude Code |
| `thank-you.html` | Thank-you page — exported from Claude Design, added by Claude Code |
| `reports.html` | A/B stats dashboard (Basic Auth protected, tokens auto-injected by worker) |
| `_worker.js` | Cloudflare Worker: A/B routing, API endpoints, reports auth, DB logic |
| `schema.sql` | D1 database schema — run once during setup |
| `favicon.png` | Client favicon — added by Claude Code |
| `uploads/` | Client-provided photos |
| `assets/` | Fallback/default photos |

> `index-a.html`, `index-b.html`, and `thank-you.html` are **not included** in this template. They come from the Claude Design export and are wired up by Claude Code during setup.

---

## Setup — Tell Claude Code

Follow the SOP steps in order. Each step is a single prompt to Claude Code.

### Step 1 — Create GitHub repo
Use this template: **Use this template** → **Create a new repository**
- Name: `lander-[client-slug]` (e.g. `lander-suncoast-dumpsters`)
- Visibility: Private

### Step 2 — Export from Claude Design
Export all three files from the DJM lander template in Claude Design:
- `index-a.html` (Variant A)
- `index-b.html` (Variant B)
- `thank-you.html`

### Step 3 — Wire it up
Tell Claude Code: *"Here are the three HTML files from Claude Design. Add them to the repo and wire everything up."*

Claude Code adds tracking scripts, call tracking, noindex tags, and favicon, then uploads via GitHub API.

### Step 4 — Connect to Cloudflare Pages
1. Cloudflare → Workers & Pages → Create → Pages → Connect to Git
2. Select the repo → Build command: *(blank)* → Output directory: *(blank)*
3. Save and Deploy

### Step 5 — Create D1 database and set environment variables
Tell Claude Code:

> "Set up the D1 database for this project. The Cloudflare Pages project name is `[project-name]`. Then set these environment variables on the Pages project via the Cloudflare API:
> - `REPORTS_USER`: `[project-name]`
> - `REPORTS_PASS`: `[project-name with all dashes removed]`
> - `REPORTS_TOKEN`: `[project-name with all dashes removed]`
> - `PROJECT_NAME`: `[Human readable title, e.g. "ABC Dumpster Lander"]`
> - `PROJECT_SLUG`: `[project-name]`
> - `VARIANT_A_LABEL`: `Variant A — [short description]`
> - `VARIANT_A_URL`: `/`
> - `VARIANT_B_LABEL`: `Variant B — [short description]`
> - `VARIANT_B_URL`: `/b`"

### Step 6 — Add URL routing worker
Tell Claude Code:

> "Write a complete `_worker.js` for the `[project-name]` Cloudflare Pages project that routes `/` with a 50/50 A/B split, `/b` always to Variant B, `/thank-you` to the thank-you page, `/reports` with basic auth and token injection, all `/api/*` routes for the dashboard, and everything else to static assets. Catch Cloudflare pretty-URL redirects so browser URLs stay clean. Upload via GitHub API."

### Step 7 — Add custom domain *(when ready)*
Tell Claude Code: *"Add the custom domain `[domain]` to the `[project-name]` Cloudflare Pages project via the API."*

The reports page works automatically on any domain — no extra steps needed.

---

## Environment Variables Reference

All set via Cloudflare API (no manual edits to any files needed).

| Variable | Example value | Purpose |
|----------|--------------|---------|
| `REPORTS_USER` | `lander-suncoast-dumpsters` | Reports page login username |
| `REPORTS_PASS` | `landersuncoastdumpsters` | Reports page login password (no dashes) |
| `REPORTS_TOKEN` | `landersuncoastdumpsters` | API token used by the dashboard JS |
| `PROJECT_NAME` | `Suncoast Dumpster Lander` | Shown in reports page title and subtitle |
| `PROJECT_SLUG` | `lander-suncoast-dumpsters` | Used for CSV export filenames |
| `VARIANT_A_LABEL` | `Variant A — Light Hero` | Label shown on the reports A card |
| `VARIANT_A_URL` | `/` | Link shown on the reports A card |
| `VARIANT_B_LABEL` | `Variant B — Dark Hero` | Label shown on the reports B card |
| `VARIANT_B_URL` | `/b` | Link shown on the reports B card |

> `REPORTS_PASS` and `REPORTS_TOKEN` should always be the same value and never contain dashes (shorter, cleaner when hidden behind password dots).

> The reports page subtitle (domain + project name) is generated automatically from the live request URL — it always reflects the current domain, including after a custom domain is added.

---

## Reports Page

| | |
|---|---|
| URL | `[project-domain]/reports` |
| Username | Value of `REPORTS_USER` env var |
| Password | Value of `REPORTS_PASS` env var |

Log these in the client's ClickUp task after setup.

---

## A/B Testing

- Traffic split 50/50 between `index-a.html` and `index-b.html` via the Cloudflare Worker
- Variant assigned on first visit, persisted via `ab_variant` cookie for 30 days
- Bots excluded from pageview counts
- Each pageview logged to D1 with variant, device, and all UTM params
- Leads and calls logged via `/api/track-event` POST from the lander HTML
- Dashboard auto-refreshes every 30 seconds

---

## Client Info

| | |
|---|---|
| Business | *(fill in)* |
| Location | *(fill in)* |
| Phone | *(fill in)* |
| Service Area | *(fill in)* |
| GHL Form ID | *(fill in)* |
| Live URL | *(fill in after domain connected)* |
| GitHub | *(fill in)* |
| Reports URL | *(fill in)* |
| Reports Login | *(fill in — username / password)* |

---

## Tracking Scripts

Search for these placeholders in both index files and `thank-you.html`:

- `TRACKING SCRIPTS (HEAD)` — Google Ads Global Site Tag, Meta Pixel base code
- `TRACKING SCRIPTS (BODY)` — noscript tags, body-level scripts
- Conversion events go in `thank-you.html` only

Tell Claude Code and paste the script codes — it inserts them in the right spots.
