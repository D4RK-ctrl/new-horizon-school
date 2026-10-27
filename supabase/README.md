# Local database migrations and verification

Phase 2B-3B adds `20261027000800_voting_transactions.sql` after the seven reviewed files: private live-SMS identity bridge, limited voting owner, eight owner-only policies, `cast_vote` and `own_voting_state`. See [VOTING_ENGINE.md](../docs/VOTING_ENGINE.md) for contracts and the four-suite clean-replay workflow, including `node supabase/tests/verify-voting.mjs` after SMS verification. No frontend, results, adjustments, deployment or subsequent phase is included.

The reviewed Phase 2B-3A layer, `20261027000700_sms_session_proof.sql`, provides four private proof/abuse-control tables, three server-only operations and one authenticated own-session boolean check. Its Auth-managed table boundaries and six preceding migrations are unchanged. The gateway and isolated local SMS setup remain documented in [VOTING_IDENTITY_REVIEW.md](../docs/VOTING_IDENTITY_REVIEW.md); use the current four-suite workflow above for Phase 2B-3B. Generated dummy-provider/test-code config stays in ignored `tmp/`, never the tracked config or a remote deployment.

The verified Phase 2A/2B-1 migrations are preserved. Phase 2B-2 adds nine current-staff competition/candidate management APIs with lifecycle locks and atomic audits. See [ACCESS_FOUNDATION.md](../docs/ACCESS_FOUNDATION.md) and [COMPETITION_MANAGEMENT.md](../docs/COMPETITION_MANAGEMENT.md) for those baseline contracts. The website continues using Phase 1 fixtures; tests use supported local Auth APIs and synthetic identities only. No remote database, Auth schema changes, official result/adjustment/role-management APIs or frontend integration is included.

## Migration order

Apply the complete baseline in filename order as the same trusted migration owner:

| Migration | Purpose |
| --- | --- |
| `20261027000100_private_app_schema.sql` | Private `app` namespace and creator-specific default privilege hardening. |
| `20261027000200_application_tables.sql` | All 16 tables, keys and CHECKs; circular competition/result FK after publication tables; RLS and explicit table/sequence revokes before commit. |
| `20261027000300_indexes_and_immutability.sql` | Initial indexes and invoker-only triggers rejecting immutable-record UPDATE/DELETE/TRUNCATE. |
| `20261027000400_access_roles_and_policies.sql` | Two limited NOLOGIN owners, API namespace, column grants and six reader-only SELECT policies; private request-identity helper. |
| `20261027000500_read_only_api.sql` | Five public projections, five authenticated status/role gates, validators and explicit execution allowlist. |
| `20261027000600_competition_management.sql` | Limited writer, seven owner-only policies, validators/locking/audit helpers, and nine authorized management RPCs. |
| `20261027000700_sms_session_proof.sql` | Private SMS challenge/proof/key/rate tables, limited owner, two private Auth projections, three server-only operations and authenticated own-session validity. |
| `20261027000800_voting_transactions.sql` | Narrow voting owner/identity bridge, eight RLS policies, atomic original votes and private own-state/receipt RPCs; existing immutable protections unchanged. |

Each file has an explicit transaction. Do not use a partial baseline. Initially `app` must not exist: absence of `IF NOT EXISTS` intentionally rejects conflicting objects. Preserve applied migration history and add ordered forward migrations for changes. Original migrations remain unchanged; all application/execution is confined to the named disposable local instance, never a remote project.

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
node supabase/tests/verify-management.mjs
```

Run both commands in order after a clean replay. The first enforces the loopback target, creates synthetic Auth identities, runs the Phase 2A SQL regression, and checks 190 access assertions. The second provisions separate synthetic management users and runs real mutation/lifecycle/concurrency/audit-rollback tests. Keys and tokens stay in memory. Fixtures remain for inspection and must be cleared by the **local** reset before rerunning; the schema regression transaction itself still rolls back. Regression policy checks permit only the named reader and management-owner policies, retaining all client-privilege/immutable-record protections. Access inventory now includes 19 reviewed API functions/13 limited-owner policies; historical source checks remain scoped to their original migrations. No verified migration was edited.

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

All tables remain private in `app` with RLS enabled. There are six reader-role SELECT policies plus seven management-owner policies; none grants client roles table access. PUBLIC/anon/authenticated/service_role retain no app schema usage/create, table/column privileges, or helper execution. Only explicitly allowlisted `api` RPCs are callable; management operations independently recheck current staff authority. All three routine owners are NOLOGIN without table ownership/RLS bypass, and temporary CREATE rights are revoked. The management owner has only selected competition/candidate fields and audit INSERT, not staff/ledger/media/result access. Superusers/table owners remain trusted and can disable triggers.

Defaults are creator-specific. PostgreSQL's implicit PUBLIC function execution cannot be removed by a schema-only revoke. Migration 1 therefore globally revokes future table/sequence/function API privileges for its creator, then removes scoped additions in `app`. This also affects **future objects this creator creates in other schemas**, but does not alter existing Auth/Supabase objects or grants. Review this impact before applying anywhere beyond a disposable test database. Different future creators need equivalent hardening. Defaults do not automatically enable RLS on future tables; each migration must explicitly enable it and revoke grants.

Historical FKs use restrictive deletion: Auth account, competition, and candidate deletion can be blocked; no delete/archive operation exists in this stage. Immutable triggers also reject zero-row UPDATE/DELETE. Snapshot completeness remains future publication work. Bootstrap and every successful management mutation audit atomically; no audit-reading/role-management API exists. Management implements original-window configuration/candidate freezing and parent locks; vote allowance concurrency, verified-phone eligibility, adjusted aggregate totals, reversals, and result publication remain future work.

## Remaining boundary

Only Phase 2B-3B atomic voting is currently authorized on top of reviewed SMS proof and competition management. Phase 2B-4 requires architect approval. Staff management, adjustments/results, deletion/archiving/uploads, production operations and frontend integration remain absent. Do not expose private tables or substitute a client role/phone/AMR indicator for server authorization.

References: [PostgreSQL default privilege scope](https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html), [statement/TRUNCATE triggers](https://www.postgresql.org/docs/current/sql-createtrigger.html), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [migration history](https://supabase.com/docs/guides/deployment/database-migrations).
