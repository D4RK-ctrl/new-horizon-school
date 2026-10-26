# Local database migrations and verification

Phase 2A's verified schema is preserved. Phase 2B-1 adds read-only access through narrow `api` RPCs and dedicated-reader SELECT policies. See [ACCESS_FOUNDATION.md](../docs/ACCESS_FOUNDATION.md) for exact callable functions, ownership/security boundaries, local bootstrap, and current verification results. No remote database, seed data, Auth schema changes, voting/CRUD RPCs, or frontend integration. The website continues using Phase 1 fixtures; tests use supported local Auth APIs and synthetic identities only.

## Migration order

Apply the complete baseline in filename order as the same trusted migration owner:

| Migration | Purpose |
| --- | --- |
| `20261027000100_private_app_schema.sql` | Private `app` namespace and creator-specific default privilege hardening. |
| `20261027000200_application_tables.sql` | All 16 tables, keys and CHECKs; circular competition/result FK after publication tables; RLS and explicit table/sequence revokes before commit. |
| `20261027000300_indexes_and_immutability.sql` | Initial indexes and invoker-only triggers rejecting immutable-record UPDATE/DELETE/TRUNCATE. |
| `20261027000400_access_roles_and_policies.sql` | Two limited NOLOGIN owners, API namespace, column grants and six reader-only SELECT policies; private request-identity helper. |
| `20261027000500_read_only_api.sql` | Five public projections, five authenticated status/role gates, validators and explicit execution allowlist. |

Each file has an explicit transaction. Do not use a partial baseline. `app` must not already exist: absence of `IF NOT EXISTS` intentionally rejects conflicting objects. Preserve applied migration history and add a later ordered migration for corrections unless the architect authorizes local-only baseline repair. All three files were applied successfully and replayed on a disposable local instance; none was changed during verification or applied remotely.

## Local verification setup

The official Supabase CLI 2.122.0 is pinned as a project-local npm development dependency, using the supported npm installation method. Docker Desktop must be running in Linux-container mode. `config.toml` retains the dedicated disposable project `nhs-phase2a-verification`, with API port 55431, PostgreSQL port 55432, and shadow port 55430. It now exposes only `api`; `app` and all private helpers are excluded. No project is linked remotely and no credentials are stored in the configuration.

The configuration disables optional services; the startup exclusion list also avoids unnecessary containers. Email auto-confirmation is enabled only for synthetic local verification, and no real mail/SMS provider is configured. These are not production authentication settings. Use Node 22.x and run from the repository root (Windows PowerShell users can use `npx.cmd` for reliable argument forwarding):

```sh
npm ci
npx supabase start --exclude=realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
npx supabase migration list --local
```

On a fresh local database, `start` applies the migration chain. To apply pending migrations to this already-started disposable instance, use `npx supabase migration up --local`. Always keep explicit `--local` on database commands and do not link a project. The existing `auth.users` and API roles come from Supabase's managed initialization, not application-written substitutes.

Clean replay is deliberately destructive only to this named disposable local database:

```sh
npx supabase db reset --local --no-seed
npx supabase db lint --local --schema app,api --level warning --fail-on warning
npx supabase migration list --local
```

Do not use `--linked`, `--project-ref`, `--db-url`, `supabase db push`, or reset a shared instance. Use psql inside the owned local database container for tests, so no host PostgreSQL installation is needed. The two untracked logo files are unrelated and must remain untouched.

## Static verification (available now)

```sh
node --test tests/schema-static.test.js
npm test
git diff --check
```

The baseline suite explicitly checks only the original three migrations: order/transactions, table/PK inventory, FK order, grants/defaults, RLS, integrity clauses, immutable triggers, indexes, and absence of Phase 2A policies/privileged routines/seeds/Auth mutations. Forward access tests independently inspect the new API/owner/grant/policy/bootstrap/configuration boundaries. Sources normalize Windows CRLF. These are structural checks, not PostgreSQL execution; the separate integration suite uses actual local roles.

## Integration verification

Current access verification (run only after a clean disposable replay, with no existing staff fixtures):

```sh
node supabase/tests/verify-access.mjs
```

The runner enforces the local project/loopback target, creates four synthetic Auth identities, runs the Phase 2A SQL script, bootstraps the first synthetic Super Admin, and checks 190 Auth/SQL/PostgREST assertions. Keys and tokens stay in memory. Fixtures remain for inspection and must be cleared by the **local** reset before rerunning; the original SQL regression transaction itself still rolls back. The regression script now permits only the named SELECT policies for the two inert owners, retaining client-privilege and immutable-record assertions. No Phase 2A migration was edited.

After starting/replaying, provision one synthetic identity through the LOCAL Auth signup API. Neither migrations nor test SQL writes to Auth internals. This PowerShell example keeps local keys, credentials, and tokens in memory rather than printing or saving them:

```powershell
$localStatus = (& .\node_modules\.bin\supabase.cmd status -o json | ConvertFrom-Json)
if ($localStatus.API_URL -ne 'http://127.0.0.1:55431') { throw 'Unexpected local API target' }
$syntheticBody = @{
    email = "phase2a-$([guid]::NewGuid())@example.test"
    password = "Test-$([guid]::NewGuid())-9aZ!"
} | ConvertTo-Json
$syntheticSession = Invoke-RestMethod -Method Post -Uri "$($localStatus.API_URL)/auth/v1/signup" -Headers @{apikey=$localStatus.ANON_KEY} -ContentType 'application/json' -Body $syntheticBody
Get-Content -Raw supabase/tests/schema_verification.sql | docker exec -i supabase_db_nhs-phase2a-verification psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -v "test_user_id=$($syntheticSession.user.id)"
Remove-Variable localStatus,syntheticBody,syntheticSession
```

The script inserts synthetic application fixtures within BEGIN/ROLLBACK and uses a temporary invoker-only assertion helper. On failure, ON_ERROR_STOP terminates psql and connection closure rolls back pending changes. Use only a disposable local database: truncate-rejection assertions deliberately exercise `TRUNCATE ... CASCADE` in exception subtransactions. They expect the immutable triggers to reject the statement.

The executed tests cover table/PK/validated-constraint inventory, all-table RLS/no policies, effective schema/table/helper/default privileges, duplicate votes, cross-competition candidate FKs, invalid allowances/windows/visibility, valid rankings without totals, invalid result pointers/versions/row relationships, negative totals, all-zero winner rejection, adjustment state/review/approved-request rules, duplicate application, and immutable UPDATE/DELETE/TRUNCATE rejection.

## Recorded Phase 2A baseline verification (before access foundation)

Verified on Docker client/server 29.4.2 (Linux containers/WSL2, 3.65 GiB), official CLI 2.122.0, Node 22.13.1/npm 10.9.2, and Supabase PostgreSQL 17.11 (`supabase/postgres:17.11.0.006`). Services were Auth v2.197.0, PostgREST v16.5, and Kong 2.8.1. No memory settings were changed; the reduced stack fit within the available memory.

| Check | Actual result |
| --- | --- |
| Migration execution | All three existing migrations applied in order via `migration up --local`; history matched all three versions. |
| Catalog inspection | 16 tables, 16 PKs, 40 FKs, 79 CHECKs, 14 unique constraints, 23 explicit indexes/53 total indexes, and 5 immutable triggers. Every constraint was validated and every index valid; definitions were inspected. Requested negative cases were executed, not every possible branch of all 79 CHECKs. |
| Integration script | 35 assertion groups plus future table/function-default and helper-permission checks passed in BOTH rounds. All required duplicate, FK, bounds, visibility, result, adjustment, and immutable-operation rejections passed. |
| Rollback | Both executions ended with ROLLBACK; all 16 application tables were empty, probe table/function absent, and Auth user count unchanged by the SQL test transaction. |
| RLS/policies/SQL access | RLS enabled on 16/16; zero policies; anon/authenticated/service_role lacked direct privileges. Six real-role SELECT/INSERT attempts returned SQLSTATE 42501. A separate rollback-only test temporarily granted read access and confirmed no-policy RLS hid an existing synthetic row; grants/data rolled back. |
| Data API | Anonymous and authenticated GET/POST requests with profile `app` returned 406/PGRST106 in both rounds. API OpenAPI paths contained no private app tables; public API root remained functional. |
| Managed/default privileges | Existing managed relation/routine/schema inventories and ACLs matched the pre-migration baseline exactly; other creators' default ACLs were unchanged. Local Auth signup/password sign-in succeeded after migrations and reset. A rollback-only probe confirmed this creator's hardened defaults also apply in another temporary schema. |
| Clean replay | `db reset --local --no-seed` succeeded, replayed all three files, removed the first synthetic identity, and produced an identical normalized app catalog (including all constraint/index/trigger definitions); the complete integration/Auth/API checks passed again. |
| Supabase checks | Local migration history matched; `db lint --local --schema app --level warning --fail-on warning` returned no schema errors. |
| Corrections | None: migration and integration-test SQL remain unchanged from commit `151409f`. |
| Final repository checks | `npm test`: 18 passed, zero failed/skipped. `npm run build`: passed. Whitespace/link/credential-pattern checks passed. Both untracked logo files retained their original SHA-256 hashes; no frontend source or branding changes. |

For the initial managed-ACL comparison only, services were bootstrapped from an ignored scratch workdir with identical project configuration and an empty migration directory. Original migration files were never moved or edited. The application chain was then applied through the root project's CLI. Clean replay used the root project's full migration chain. Temporary catalog/verification output remains ignored under `tmp/`; no keys/tokens or data volumes are tracked.

Cleanup after verification removes only this disposable project's services and volumes, including its synthetic identities:

```sh
npx supabase stop --project-id nhs-phase2a-verification --no-backup
```

The disposable services and their volumes were stopped/removed after verification; synthetic identities were not retained. No remote database, cloud resource, or production configuration was touched. Passing these local checks does not prove compatibility with future Supabase-managed upgrades or provide Phase 2B voting/authorization guarantees.

## Security and migration risks

All tables remain private in `app` with RLS enabled. Phase 2B-1 adds six SELECT-only policies for limited routine owners, with no client-role policies. PUBLIC/anon/authenticated/service_role retain no app schema usage/create, table/column privileges, or helper execution. Only explicit read-only RPC grants in exposed `api` are callable. Routine owners are NOLOGIN, have no table ownership or RLS bypass, and cannot create additional objects after migration. A service role's RLS bypass does not grant object privileges. Superusers/table owners remain trusted and can disable triggers.

Defaults are creator-specific. PostgreSQL's implicit PUBLIC function execution cannot be removed by a schema-only revoke. Migration 1 therefore globally revokes future table/sequence/function API privileges for its creator, then removes scoped additions in `app`. This also affects **future objects this creator creates in other schemas**, but does not alter existing Auth/Supabase objects or grants. Review this impact before applying anywhere beyond a disposable test database. Different future creators need equivalent hardening. Defaults do not automatically enable RLS on future tables; each migration must explicitly enable it and revoke grants.

Historical FKs use restrictive deletion: Auth account, competition, and candidate deletion can be blocked; future workflows use controlled deactivation/archiving. Immutable triggers also reject zero-row UPDATE/DELETE. Snapshot rows remain owner-insertable until future publication operations validate completeness. Bootstrap now audits its one privileged action atomically, and role gates use protected current records; general mutation auditing/role management is not implemented. Cross-row ledger accuracy, vote allowance concurrency, verified-phone eligibility, nonnegative adjusted aggregate totals, exact reversals, lifecycle freezing, and correct winner/rank publication remain future work.

## Remaining boundary

Only Phase 2B-1's read-only access/role/bootstrap foundation is authorized and implemented. Phase 2B-2 requires architect approval. Voting/phone eligibility, mutations/administrator management, adjustments/results, production operations, and frontend integration remain absent. Do not expose private tables or substitute a client role indicator for backend authorization.

References: [PostgreSQL default privilege scope](https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html), [statement/TRUNCATE triggers](https://www.postgresql.org/docs/current/sql-createtrigger.html), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [migration history](https://supabase.com/docs/guides/deployment/database-migrations).
