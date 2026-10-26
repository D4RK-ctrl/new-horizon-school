# New Horizon School

A planned hobby prototype of a school website and audience voting platform, intended for a future school pitch. The project name is a working label; all school facts, branding, images, and candidate identities must remain placeholders until authorized content is supplied.

## Status

Phase 0: architecture and planning only. No application, database migrations, dependencies, cloud resources, or deployment have been created. Phase 1 requires explicit authorization from the project architect (ChatGPT). This is not ready for real student data or public voting.

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

## Local setup expectations

Nothing needs installing for Phase 0. There is no `package.json` or runnable application yet.

After Phase 1 approval, select a supported Node.js LTS release compatible with the selected Vite version, add a lockfile and documented npm scripts, and configure a separate development Supabase project (or local Supabase with its CLI/container prerequisites). Expected scripts will cover development, build, and preview; they do not exist yet.

Only the Supabase project URL and publishable/legacy anon key may enter future `VITE_*` variables. Every `VITE_*` value is public in the browser bundle. Service-role/secret keys, database passwords, and SMS credentials must stay in server/provider configuration. A future tracked `.env.example` must contain placeholders only; actual `.env*` files are ignored.

Use synthetic data and isolated test phone numbers. Real SMS requires provider configuration and may cost money. Configure cloud accounts, deploy, initialize Git, or commit only in a later authorized stage as applicable. No repository initialization was necessary for Phase 0.
