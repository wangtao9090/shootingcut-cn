# Shooting Cut Chinese GEO Implementation Plan

> Approved on 2026-07-29 as the independent Chinese half of the two-domain GEO plan. Work on `codex/geo-optimization`; keep `main` production-only until final review.

## Global Constraints

- This repository publishes Chinese-only content to `https://shootingcut.cn`.
- Do not retain `zh/`, `*-zh.html`, English content pages, or compatibility redirects.
- Chinese pages use the same root-relative path as their English counterpart on `https://shootingcut.com`.
- Each page is self-canonical on `.cn` and has reciprocal cross-domain alternates: `zh-Hans` self, `en` matching `.com`, `x-default` matching `.com`.
- Current version 1.1.3 is live.
- Shooting Cut is a complete competitive-shooting video editor, not primarily a gunshot-subtitle utility.
- Public modes:
  - Auto Trim: exactly 1 video.
  - Merge: up to 20 videos.
  - Split Sync: exactly 2 videos; Full Screen, Dual Center HUD, Dual Top HUD, and Side by Side layouts.
  - Stage Mix: 2–3 POV/Follow/Static videos; movement-aware switching and manual override.
- Strings is not a current public mode. TikTok direct upload is not current; YouTube and Facebook direct upload are supported.
- One subscription covers all Apple devices. Never promise one purchase, lifetime, or buyout access.
- Auto Trim and score import are free. Free Auto Trim exports include the Shooting Cut watermark and logo intro card.
- Safe Pro facts: watermark removal, custom intro cards, Split Sync/Stage Mix, and macOS batch export. Do not state a single-platform social-upload paywall.
- Export ratios: Source, 9:16, 3:4, 4:5, 6:7, 1:1, 16:9. Resolutions: Original, 4K, 1080p, 720p.
- PractiScore supports official per-shot anchoring. ESS/PractiScore/HDP/IDPA import paths exist; ESS has 41 configured regions. Do not claim arbitrary PDFs or WinMSS.
- Troubleshooting may cover AGC, neighboring gunshots, echo/reverb, weak timer beeps, sensitivity, timer-marker adjustment, adding/removing shots, last-shot correction, and minimum split. Never describe `.22` as a limitation.
- Privacy wording:
  - core media analysis/editing and person tracking run on device;
  - original media is not uploaded to a Shooting Cut processing server;
  - Photos/iCloud behavior follows Apple/user settings;
  - iCloud KVS can sync aliases, perspectives, gun type, score links, and imported match records;
  - RevenueCat handles app user identifiers and subscription status;
  - limited pseudonymous detection-quality data is user-controlled, currently enabled by default, excludes raw media, and can be disabled;
  - online score import and user-initiated social upload use the network.
- Never claim 100% security, all data stays on device, all features are offline, no analytics, no third parties, or no data leaves the Apple ecosystem.
- Public pages do not name or compare competing products.
- Every guide starts with a standalone answer, includes inputs/output/steps/limitations/verified Free-Pro boundary, an updated date, and strict JSON-LD.

## Task 1: Establish the independent Chinese baseline

1. Port the corrected Chinese facts from the English branch:
   - English `zh/index.html` → Chinese `index.html`
   - English `faq-zh.html` → Chinese `faq.html`
   - English `privacy-zh.html` → Chinese `privacy.html`
   - English `support-zh.html` → Chinese `support.html`
   - English `terms-zh.html` → Chinese `terms.html`
2. Rewrite all canonical, OG, structured-data, image, and internal URLs for `shootingcut.cn`.
3. Remove `zh/`, `privacy-zh.html`, `support-zh.html`, and `terms-zh.html`; add no redirects.
4. Add a Chinese or language-neutral `og-image.svg`.
5. Remove competitor comparisons, stale Stage Mix facts, one-purchase copy, and absolute privacy claims.
6. Commit in English and push the branch.

## Task 2: Add Chinese validation, crawl metadata, privacy, and support

1. Add a dependency-free Node validator and GitHub Actions CI.
2. Validate strict JSON-LD, local links/fragments/assets, `.cn` canonical/OG/JSON-LD URLs, `lang="zh-Hans"`, reciprocal cross-domain hreflang, sitemap paths, and stale product/privacy claims.
3. Reject duplicate `zh/` or `*-zh.html` public pages.
4. Add Chinese `robots.txt` and `.cn`-only `sitemap.xml`.
5. Correct privacy/terms/support using the precise Global Constraints, including the user-controlled detection-quality switch and current default.
6. Validate locally with Node, `xmllint`, HTTP route checks, and `git diff --check`; commit/push.

## Task 3: Publish the Chinese GEO foundation

Create:

- `assets/content.css`
- `competitive-shooting-video-editor/`
- `on-device-shooting-video-editor/`

Add answer-first content, accurate privacy exceptions, contextual navigation, self-canonical `.cn` URLs, reciprocal `.com` hreflang, accessibility basics, and Article/Breadcrumb/HowTo JSON-LD where appropriate.

## Task 4: Publish Chinese core workflow guides

Create:

- `auto-trim-shooting-match-video/`
- `sync-two-shooting-videos-by-timer-beep/`
- `edit-multi-camera-shooting-video/`
- `shot-detection-troubleshooting/`
- `reframe-landscape-shooting-video-for-social-media/`

The Reframe/Track guide must show how one landscape recording can generate multiple locally tracked exports for vertical short video, portrait feed, square feed, and landscape video. Include every verified ratio/resolution; platform names are format examples only, and TikTok must not be presented as a direct-upload integration.

## Task 5: Publish Chinese advanced workflow guides

Create:

- `side-by-side-shooting-video-comparison/`
- `merge-uspsa-stage-videos/`
- `batch-export-match-videos/`
- `import-practiscore-ess-hdp-match-results/`
- `thailand-hdp-ess-match-results/`
- `add-shot-times-and-scores-to-match-video/`

Keep Side by Side inside Split Sync, distinguish Merge from multi-camera sync, and state macOS + Pro for batch export. The general score-import guide covers PractiScore, ESS, and HDP/IDPA inputs and limitations. The Thailand guide covers HDP and ESS Thailand together because their participant populations substantially overlap; explain both import paths and how one shooter can keep results/videos from both systems in one archive. The overlay guide explains that, when PractiScore official per-shot timing records are available, Shooting Cut aligns them to footage using the timer beep and can use official times/splits, shot count, and score data in subtitles. ESS/HDP/IDPA score import must not be described as PractiScore-style official per-shot anchoring.

## Task 6: Complete discovery, HTTPS, and handoff

1. Add Chinese `llms.txt`, complete the `.cn` sitemap, and add contextual navigation.
2. Document local validation and independent GitHub Pages deployment in README.
3. Re-provision the `shootingcut.cn` GitHub Pages certificate, verify hostname/SAN/chain, then enable HTTPS enforcement.
4. Run final whole-branch review and all local checks.
5. Merge to `main`, monitor Pages, and verify every production `.cn` route over HTTPS.
