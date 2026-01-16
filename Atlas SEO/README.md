# Atlas SEO (No-API)

Modern, all-in-one SEO audit, SERP helper, AI visibility inspector, and RE2-safe regex builder that runs entirely in the browser—no external APIs or accounts.

## Highlights
- **On-page audit**: titles, descriptions, canonicals, robots, headings, OG/Twitter, viewport/lang, snippet preview.
- **Links & media**: header/body/footer link grouping with hover/jump, images with dims, transfer size, section context, and alt checks.
- **Structured data & tech**: JSON-LD + microdata linting, schema issues/warnings, rich tech detection (CMS, frameworks, analytics, CDN, ecommerce, tag managers).
- **Performance snapshot**: TTFB (start/net), FCP, LCP, CLS, INP, FID, DOMContentLoaded, load.
- **SERP helpers**: SERP gap terms/entities, intent/format classifier, top results view.
- **AI visibility**: robots/meta directives + HTML vs JS visibility; hover to highlight visible/invisible sections.
- **Exports**: detailed audit CSV (per-section detail).
- **Regex tab**: RE2-safe builder for GSC + GA4 (handles GA4 full-match, lookaround warnings, clipboard copy).
- **UX touches**: hover/click highlight + smooth jump to headings/links/images, JS-rendered block detection, accordion-aware highlighting, glassmorphism UI.

## Install (developer mode)
1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Click the Atlas SEO icon to open the popup.

## Usage
- Open any web page and click **Refresh Audit** (Overview, On-Page, Links, Media, Schema, Tech, AI Visibility, Regex tabs).
- Open a Google results page to use the **SERP** tab.
- Hover or click list items (headings, links, images, JS blocks) to highlight and scroll to them on the page.
- Open **AI Visibility** and hover the page to see visible (green) vs invisible (red) sections.
- Use **Export Audit CSV** for reporting; Regex tab to generate RE2-safe patterns for GSC/GA4.

## Notes
- Fully client-side; robots.txt fetch uses extension context (some sites may block requests).
- Performance metrics reflect the current page load only.
- SERP parsing depends on Google’s DOM and may change.
