# New Horizon School

A school website and audience voting platform prototype for a future school pitch. The project name is a working label. All content, participants, dates, results, and artwork in this frontend are explicitly synthetic; no official school facts, branding, student identities, or achievements are claimed.

## Status

Phase 2B-2 adds secure backend competition/candidate management and atomic confidential auditing on top of the reviewed access foundation. Existing verified migrations remain unchanged; only a forward migration is added. The frontend still uses its Phase 1 fixtures; no remote database has been touched. Phase 0/0B planning remains authoritative. Phase 2B-3 requires separate architect authorization.

No connected frontend backend, Supabase browser packages, authentication UI, OTP, vote submission, enquiry intake, analytics collection, or cloud resources exist. Backend RPCs now support published reads, current staff checks, and limited competition/candidate mutations; no role-management, adjustment, or result-publication operations exist. Voting and frontend forms remain disabled. Admin routes are public demo layouts, **not secured portals**. No real personal data is collected; database verification uses synthetic local identities only.

## Planned stack

- HTML5, CSS3, vanilla JavaScript ES Modules, and Vite.
- Supabase PostgreSQL, Auth, and Storage; transactional database functions for voting and privileged operations.
- YouTube links with candidate start timestamps for performances.
- Vercel Hobby for eligible personal prototype hosting; Git and GitHub for later version control.
- A small framework-free Vercel Function for candidate HTML/social metadata. No React, Next.js, TypeScript, Express, or additional framework is planned.

## Planning documents

- [Requirements](docs/REQUIREMENTS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Database design](docs/DATABASE_DESIGN.md)
- [Development plan and open decisions](docs/DEVELOPMENT_PLAN.md)
- [Phase 1 delivery and verification report](docs/PHASE_1_HANDOFF.md)
- [Database migrations, local setup, verification, and Phase 2B boundary](supabase/README.md)
- [Read-only access contract, permissions, local bootstrap, and Phase 2B-1 verification](docs/ACCESS_FOUNDATION.md)
- [Competition/candidate RPCs, lifecycle, locks, audits, and Phase 2B-2 verification](docs/COMPETITION_MANAGEMENT.md)

## Run locally

Use **Node.js 22 LTS, version 22.12.0 or newer within the 22.x line**, and npm. `.nvmrc` selects 22; use a current patched 22.x release when setting up a machine. Validation used the host's Node 22.13.1 and npm 10.9.2. Direct development dependencies are Vite 8.3.5 and the official Supabase CLI 2.122.0, pinned in `package.json` and `package-lock.json`. The CLI is local verification tooling, not a browser dependency. Docker is needed only for database verification, not the frontend.

```sh
npm ci
npm run dev
```

Open the URL Vite prints (normally `http://127.0.0.1:5173`). No environment file, credentials, accounts, or service configuration are needed. There is deliberately no `.env.example` because Phase 1 has no configuration values.

```sh
npm test
npm run build
npm run preview -- --port=4173
```

Tests use Node's built-in runner. Build output is generated in ignored `dist/`. Preview serves that output at `http://127.0.0.1:4173`; stop the server with Ctrl+C. Ports may differ if occupied. Local development/preview servers are not production servers.

## Routes and sample entries

| Route | Purpose |
| --- | --- |
| `/` | Home with overview, placeholder highlights, events, competitions, admissions, gallery, and footer |
| `/about` | Placeholder school introduction |
| `/admissions` | Illustrative admissions steps; no applications accepted |
| `/gallery` | Local SVG/abstract image placeholders |
| `/contact` | Placeholder contact information and disabled enquiry form |
| `/events` | Synthetic event calendar |
| `/competitions` | Filterable synthetic competitions |
| `/competitions/:slug` | Competition details, candidates, and planned voting rules |
| `/competitions/:competitionSlug/candidates/:candidateSlug` | Candidate introduction, photo placeholder, sample timestamp link, disabled voting |
| `/competitions/:slug/results` | Unpublished, positive tied-winner, or all-zero result examples |
| `/admin/login` | Disabled staff sign-in preview; no credentials accepted |
| `/admin` | Public, unsecured Admin layout with section navigation |
| `/super-admin` | Public, unsecured Super Admin layout with additional section navigation |

Sample slugs: `creative-voices` (active), `ideas-for-tomorrow` (upcoming), `rhythm-and-motion` (closed), `colour-and-craft` (published tied winners), and `discovery-journal` (published “No votes received”). Every competition includes `demo-candidate-01`, `demo-candidate-02`, and `demo-candidate-03`. For example:

```text
/competitions/creative-voices/candidates/demo-candidate-01
/competitions/rhythm-and-motion/results
/competitions/colour-and-craft/results
/competitions/discovery-journal/results
/super-admin?section=vote-adjustments
```

Demo states are fixed fixtures, not computed from the viewer's clock. Dates use Asia/Kolkata. The YouTube example is an unrelated public sample (“Me at the zoo”), explicitly labeled and linked only after a visitor clicks; no video embeds or third-party assets load automatically.

## Frontend structure

```text
public/             Local favicon and campus SVG illustration
src/components/     Header/mobile menu, footer, CTA, cards, badges, headings, empty states
src/pages/          Home, information, competitions/candidates/results, admin previews
src/router/         Pure route matcher and minimal History API navigation
src/data/           Synthetic public-view fixtures
src/styles/         Tokens, base styles, layouts, components, responsive rules
src/utils/          Safe DOM construction, date/status/YouTube formatting
tests/              Built-in Node tests for meaningful routing/data/format logic
```

The UI uses DOM nodes and text nodes, without raw HTML injection. Navigation supports direct paths, back/forward, validated parameters, active links, and useful not-found views. Slugs absent from the fixtures also show a not-found view. Navigation focuses the new heading. The mobile disclosure menu supports keyboard operation, Escape-to-close, and closing when focus leaves the header; reduced-motion settings are respected.

## Hosting boundary and future integration

Vite development and preview servers supply HTML fallback for deep-route refreshes. `vercel.json` documents a future static fallback while leaving asset paths alone; no Vercel deployment was performed. On static SPA hosting, unknown routes have a useful client-rendered 404 view but an HTTP 200 shell. A true route-specific HTTP 404 needs future server routing.

Candidate-specific social-preview HTML and the documented Vercel Function are **not implemented in Phase 1**. The canonical route shape is preserved. When that function is authorized, add its rewrite before the SPA fallback and reuse the frontend assets. Client-rendered titles are not a substitute for crawler-readable social metadata. The prototype is marked `noindex, nofollow`.

Frontend fixtures are public examples, not an authorization layer. Never connect private ledgers or hidden totals to this bundle and rely on UI hiding. Future visibility enforcement, verified-phone eligibility, atomic voting, staff roles, audit records, and result republication belong to the trusted backend stages. No voting records or privileges are simulated in local storage.

Never put service-role credentials, database passwords, SMS secrets, or other secrets into frontend code or `VITE_*` variables. No real credentials are configured. The database exposes only reviewed `api` RPCs; private `app` tables remain inaccessible directly, even to staff JWTs. Mutations independently require current active staff and atomically insert audits. Other product APIs, Storage, production security headers, social previews, QR support, approved media, and independent security/accessibility audits remain later-stage work. Local CLI credentials are generated at runtime and must never be committed or copied into the frontend.

Toolchain references: [Node release schedule](https://github.com/nodejs/Release), [Vite requirements](https://vite.dev/guide/). Future provider operational limits are documented in the architecture; no services are configured by this stage.
