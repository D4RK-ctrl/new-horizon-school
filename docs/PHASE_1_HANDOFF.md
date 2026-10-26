# Phase 1 frontend handoff

Delivery branch: `phase-1/frontend-foundation`. Base: reviewed `main` at `201b58f02d213097dc74e594c8a588c380a92125`. The final chat handoff supplies the delivery commit SHA and push outcome. Phase 2 is not authorized by this work.

## Delivered behavior

Responsive HTML/CSS/vanilla ES Modules frontend, built with stable Vite 8.3.5 and npm. Node 22 LTS is selected, with a minimum 22.12.0 within the 22.x line. Validation used installed Node 22.13.1/npm 10.9.2. The lockfile pins the build dependency tree; no runtime libraries, Supabase packages, frameworks, or testing frameworks were added.

The [README route table](../README.md#routes-and-sample-entries) covers all 13 requested route patterns. Five synthetic competitions provide upcoming, active, closed, and published examples; three candidate entries per competition demonstrate deep routes. Published results show positive tied winners and the all-zero "No votes received" outcome. Closed/unpublished examples have no totals/ranks/winner labels. There is no publication operation in this frontend; the future backend must reject publication with no eligible candidates.

Reusable components include header/mobile navigation, footer, button links, section/page headings, admissions CTA, event/competition/candidate cards, status badges, portrait/gallery placeholders, notices, and empty states. History API navigation supports direct URLs, back/forward, route parameters, focus on new headings, and not-found views. The mobile disclosure supports keyboard operation and Escape-to-close; reduced motion is supported.

## Files changed

Modified: `README.md`.

Created:

```text
.nvmrc
index.html
package.json
package-lock.json
vercel.json
public/favicon.svg
public/images/campus.svg
src/main.js
src/components/layout.js
src/components/shared.js
src/data/demo.js
src/pages/admin.js
src/pages/competitions.js
src/pages/home.js
src/pages/information.js
src/router/index.js
src/router/routes.js
src/styles/base.css
src/styles/components.css
src/styles/layout.css
src/styles/tokens.css
src/utils/dom.js
src/utils/format.js
tests/frontend.test.js
docs/PHASE_1_HANDOFF.md
```

Removed: none. Phase 0/0B requirements, architecture, database design, development plan, ignore rules, and existing ZIP review archives are unchanged. Generated `dist/`, dependencies, and local QA scripts/screenshots in `tmp/` are ignored and excluded from the commit.

## Verification results

- `npm install`: passed, 15 packages added, 16 audited, zero reported vulnerabilities at installation time. Generated `package-lock.json`.
- `npm test`: 8 passed, 0 failed/skipped. Tests cover static/dynamic routing, parameter decoding/validation, unknown paths, fixture destinations, safe status formatting, YouTube timestamp validation, school timezone formatting, and public result fixtures.
- `npm run build`: passed, 18 modules transformed. Output: HTML 0.92 kB (0.50 kB gzip), CSS 17.32 kB (4.56 kB gzip), JS 29.18 kB (10.34 kB gzip).
- `npm.cmd run preview -- --port=4173 --strictPort`: passed; actual built-output HTTP requests returned 200. The `npm.cmd` spelling avoided argument forwarding issues in this host's PowerShell wrapper. README documents the portable `--port=4173` syntax.
- Bundled Playwright with an already-installed isolated headless Chromium: 35 direct route requests returned HTTP 200 with rendered content, a single main/heading, no desktop overflow, and disabled voting. Checked 56 unique internal link destinations, including admin section links, with no broken destinations.
- Browser behavior: unknown routes and unknown candidate/competition slugs render the 404 view; deep candidate reload, back/forward, active navigation, competition filters, and unpublished/all-zero/tied-winner results pass.
- Responsive checks: 13 representative views at 390×844 and direct-route checks at 1440×1000 show no horizontal page overflow. Keyboard menu opening, Tab entry, Escape/focus return, route heading focus, and reduced motion pass.
- Visually inspected screenshots of desktop home/competition listings/Super Admin adjustments placeholder, and mobile home/candidate profile. No claim of a full accessibility audit or cross-browser certification.
- Browser requests were GET-only and same-origin; no third-party resources, mutation requests, or browser exceptions occurred. No raw HTML-injection APIs, browser persistence, or backend requests exist in application sources.
- `git diff --check` and source whitespace/final-newline checks passed. Recognized credential-pattern scan passed; authored sources were also reviewed. These checks are not a formal security audit.

The existing Chrome-debugging connector was unavailable; isolated Chromium supplied browser QA instead. Initial sandbox HTTP connectivity and PowerShell argument-forwarding issues were resolved for the final successful preview checks. No browser/test packages were added to the project for QA.

## Limits and security boundary

All school content, people, media, events, and results are demonstration fixtures. No real contact destination is configured. Contact/sign-in inputs and submit buttons are disabled; no voting, authentication, authorization, administrative changes, analytics collection, storage, or personal-data intake is implemented. Admin/Super Admin layouts are intentionally public and clearly marked unsecured. Their future protection belongs to the trusted backend, not the router or hidden UI controls.

Static SPA fallback returns an HTTP 200 shell for unknown routes while the UI displays a useful 404. Candidate-specific crawler HTML and social previews, QR functionality, real permissions, production security headers, and database concurrency guarantees are deferred. Candidate route shape remains compatible with a future Vercel HTML Function; its rewrite must precede the static fallback. `vercel.json` is configuration only and has not been deployed or verified against a cloud account.

No `.env.example` is needed: the frontend has no configuration or credentials. Do not introduce secrets or private/hidden data into the bundle. Use a current patched Node 22.x for future local setup. Review accessibility, production privacy/media permissions, and provider plan eligibility in the appropriate later phase.

## Review and next action

Architect: inspect the delivery branch and run the README commands to review the public and staff demo layouts. No accounts or manual cloud configuration are required. Approve or request corrections to Phase 1 before any Phase 2 work.

Only this feature branch is authorized for commit/push. No merge, main push, pull request, deployment, or new cloud resources are part of delivery. The local preview server is stopped after QA; run the README preview command to reopen it.
