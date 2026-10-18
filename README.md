# laa-lander-template

The starting point for every lander deployed with the **deploy-lander-laa** skill. It's a plain HTML landing page setup with a built-in 50/50 split test, lead and call tracking, and a password-protected reports dashboard. There's no build step: Cloudflare Pages serves it directly.

You don't set this up by hand. The skill creates a private copy of this repo for each lander (`lander-[slug]`), adds your pages, and wires up Cloudflare. This README explains what's in the box.

---

## Files

| File | Purpose |
|------|---------|
| `_worker.js` | Cloudflare worker: the A/B split, `/a` and `/b` previews, `/thank-you`, the `/reports` login, the tracking API, and the 404 for internal files |
| `reports.html` | The reports dashboard (login protected; the worker fills in its settings) |
| `schema.sql` | The D1 database tables, run once during setup |
| `index-a.html` | Variant A. Added by the skill, not in the template |
| `index-b.html` | Variant B. Added by the skill, not in the template |
| `thank-you.html` | Thank-you page. Added by the skill, not in the template |
| `assets/` | Images, logo, and favicon. Added by the skill |

---

## Routes

| URL | What it does |
|-----|--------------|
| `/` | Splits visitors 50/50 between A and B. The choice is saved in the `ab_variant` cookie for 30 days |
| `/a` | Always shows Variant A (for previewing, not counted as split traffic) |
| `/b` | Always shows Variant B |
| `/thank-you` | Thank-you page. Logs the lead from the GHL redirect (`?name=&email=&phone=`) |
| `/reports` | Reports dashboard, behind a username and password |
| `/api/*` | Tracking and dashboard endpoints used by the pages |
| `/README.md`, `/wrangler.toml`, `/schema.sql`, any `.md` | Always 404, so setup details are never public |

---

## Settings (Cloudflare secrets)

The skill sets these on the Pages project. They are never written into any file in the repo.

| Secret | Purpose |
|--------|---------|
| `REPORTS_USER` | Reports login username |
| `REPORTS_PASS` | Reports login password. The skill generates a random one |
| `REPORTS_TOKEN` | Random token the dashboard uses for its data calls. You never type it |
| `PROJECT_NAME` | Business name shown on the dashboard and in CSV export names |
| `PROJECT_SLUG` | Used in CSV export file names |
| `VARIANT_A_URL` | Preview link on the dashboard's A card: `/a` |
| `VARIANT_B_URL` | Preview link on the dashboard's B card: `/b` |
| `META_DATASET_ID`, `META_CAPI_TOKEN`, `GHL_WEBHOOK_SECRET`, `CALL_MIN_DURATION` | Optional. Only for Meta Conversions API (see the skill's `references/meta-capi.md`) |

Variant descriptions for each test round live in the `rounds` table in D1, not in secrets.

> Never put the reports password in this README or any other file. Everything in the repo folder is uploaded to Cloudflare on deploy, and the README lives in GitHub.

---

## Tracking placeholders

The skill pastes tracking code into these comment blocks:

- `TRACKING SCRIPTS (HEAD)` in all three pages: Google Ads tag, Meta Pixel base code
- `TRACKING SCRIPTS (BODY)` in all three pages: call tracking number swap script
- `CONVERSION TRACKING` in `thank-you.html` only: Google Ads conversion event

Every `tel:` link should carry the `data-tel-link` attribute so call clicks show up in reports. The skill adds it automatically.

---

## Lander details

Fill this in after deploy. **No passwords here.**

| | |
|---|---|
| Business | |
| Live URL | |
| Preview A / B | `/a` and `/b` |
| Reports URL | `/reports` |
| Deployed | |
