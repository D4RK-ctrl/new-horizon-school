# Phase 2B-1 database access contract

This document records the reviewed Phase 2B-1 read-only foundation. The separately authorized [Phase 2B-2 management contract](COMPETITION_MANAGEMENT.md) adds nine staff-only competition/candidate APIs and a limited writer; no frontend integration is supplied. The verified Phase 2A/2B-1 migrations are unchanged. Foundation migrations `20261027000400_access_roles_and_policies.sql` and `20261027000500_read_only_api.sql` add two limited readers, six SELECT policies, and the ten entry points below.

## Callable surface

Local PostgREST exposes **only `api`**, selected using `Accept-Profile: api` / `Content-Profile: api`. No tables or views exist in that schema. Calls use `/rest/v1/rpc/<name>`. `app`, `public`, Auth, and private helpers are not exposed schemas. The following foundation functions retain their reviewed grants; additional management grants are documented separately:

| RPC | Caller | Parameters / result |
| --- | --- | --- |
| `published_school_pages` | anon, authenticated | Optional `p_page_key` (home/about/admissions/contact); published key/title/structured content/publication time only. |
| `published_events` | anon, authenticated | `p_limit=20`, `p_offset=0`; published event details and approved public cover metadata. |
| `published_competitions` | anon, authenticated | Same pagination; published, nonarchived listing details, window/allowance/enabled/paused fields. |
| `competition_details` | anon, authenticated | Required `p_slug`; published details, including archival state; unknown/unpublished slug returns no rows. |
| `candidate_profiles` | anon, authenticated | Required `p_competition_slug`, optional `p_candidate_slug`; same pagination; eligible profiles within a published competition, video mapping and approved public photo metadata only. |
| `account_status` | authenticated | No parameters; caller's UUID and active staff role, or null staff role. No Auth credentials, phone, tokens, or other accounts. |
| `is_admin` | authenticated | Exact active Admin classification; false for Super Admin, ordinary, or inactive users. |
| `is_super_admin` | authenticated | Exact active Super Admin classification. |
| `require_admin` | authenticated | True for current active Admin **or** Super Admin; otherwise SQLSTATE 42501. No mutation. |
| `require_super_admin` | authenticated | True only for current active Super Admin; otherwise SQLSTATE 42501. No mutation. |

Pagination accepts limits 1–100 and offsets 0–10,000; slugs are 1–100 lowercase alphanumeric/hyphen characters. Invalid arguments fail with 22023; wrong JSON argument types fail safely at PostgreSQL/PostgREST binding. Required null slugs are rejected. Missing authentication is denied by function grants and identity checks.

Publication requires the published state (where present) and a publication timestamp no later than the database statement time. Candidate publication is inherited from its competition because the baseline has no separate candidate publication flag. Archived listings are omitted, while published archived detail/profile URLs remain readable. Candidate order is always neutral slug/UUID order: rankings are not implemented even when a competition would permit them. No totals, rank, winner/tie labels, result snapshots, private object paths, adjustment rows, voter records, audit reasons, or actor identities are projected. Private/pending/revoked media produce null image fields, not a leaked object URL. Published structured page content is the approved public content field; future CMS validation must keep private information out of it.

## Permission and identity boundaries

`nhs_public_reader` and `nhs_identity_reader` are NOLOGIN, NOINHERIT roles with no superuser, role/database creation, replication, or RLS bypass. Neither owns application tables. They have only column SELECT grants and schema usage needed by their routines. Six SELECT-only RLS policies constrain published content/public derivatives or the requester's own active staff record. No client-role policy or direct table/column grant is added. Unrestricted migration operators remain trusted, as in Phase 2A.

Each foundation API function is STABLE SECURITY DEFINER with an empty fixed search_path and qualified object references. Its owner is the corresponding limited reader, so RLS remains enforced rather than bypassed by postgres ownership. Temporary CREATE grants used for ownership transfer are revoked before commit. PUBLIC/service_role have no API execution grants; anon gets the five public readers and authenticated gets those plus protected status/gates and the separately authorized management APIs. Client roles and PostgREST's authenticator have no membership in owner roles. Defaults for future routines owned by these roles are denied. No untrusted dynamic SQL is used.

The identity helper reads only `sub` from PostgREST's **verified JWT request context**. User-editable metadata is never an authority. No Auth table/schema permission is granted to routine owners. Account status describes the request identity, not phone verification or voter eligibility. Staff checks query `app.staff_roles` on every request; deactivation/deletion takes effect with the same existing JWT on the next request. A cached frontend boolean cannot authorize another operation; future mutations must recheck their own server-side permissions. No arbitrary SQL/GUC-setting endpoint may be exposed.

## First Super Admin: local operator only

Start the dedicated disposable project as described in [supabase/README.md](../supabase/README.md). Provision a synthetic confirmed email identity using local Auth's supported signup API; there is no default administrator account or password. Then, as the trusted local postgres migration operator, run the script against the named local container:

```powershell
$targetUuid = 'UUID_OF_CONFIRMED_SYNTHETIC_LOCAL_AUTH_USER'
$reason = 'Approved first local Super Admin bootstrap'
Get-Content -Raw supabase/scripts/bootstrap_local_super_admin.sql | docker exec -i supabase_db_nhs-phase2a-verification psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -v "bootstrap_user_id=$targetUuid" -v "bootstrap_reason=$reason"
```

The script is **not installed in the database** and has no API entry point. It requires the postgres operator, a confirmed existing nonanonymous Auth identity, and a nonblank reason. An exclusive staff-table lock serializes first-user checks. Any existing Super Admin row, including inactive rows, blocks reuse. The new role and immutable confidential audit record commit together; failure rolls back both. The audit records the bootstrap target UUID as the affected identity and `operator` as the acting category, with the database operator in details. The target/grantee is not represented as an authenticated initiating administrator. No Auth internals or credentials are written by the script.

Running a reviewed operator script requires local Docker/database operator access; it is not client self-promotion. Subsequent promotion, recovery, last-Super-Admin management, and production bootstrap remain unimplemented and need separate review.

## Verification and limits

From a clean disposable local database, run `node supabase/tests/verify-access.mjs`. It refuses remote-link state, enforces the fixed loopback API/project, keeps keys/tokens in memory, provisions four synthetic identities (ordinary/Admin/Super Admin/inactive Admin), and tests anonymous requests separately. It creates deliberate local fixtures through the trusted operator, not product CRUD. It leaves fixtures for inspection; reset **only this disposable instance** before another run.

Actual results: 190 access assertions passed in both initial and clean-replay rounds; the Phase 2A script's 35 groups plus default/helper checks also passed twice with ROLLBACK. Tests include draft/future/ineligible filtering, private media, neutral ordering, explicit field omissions, own-account isolation, forged metadata/JWT rejection, Admin/Super Admin separation, anonymous denial, deactivation/revocation with old tokens, repeat-bootstrap denial, durable audit creation/no audit leakage, SQL-injection/malformed argument rejection, no mutation endpoints, direct SQL/API denial, owner membership/column ACLs/RLS/function paths, and anonymous API discovery. The access function/policy catalog SHA-256 matched across replay (`e502453743b0c0394dc5cc0503d75ad82b148324dc3468e4dce1c1daeba56be4`).

All five migrations replayed successfully on local Supabase PostgreSQL 17.11 / CLI 2.122.0 / Docker 29.4.2. Lint on app/api passed with no warnings; `npm test` passed 24/24 and the Vite build passed. Baseline static tests now explicitly inspect only the original three migrations and normalize Windows newlines; the regression SQL permits only the six reader-role SELECT policies, retaining client/default-grant and immutable-record assertions. No historical migration was edited.

Voting, eligibility/OTP, totals/rankings, result publishing, adjustments, role-management APIs, enquiries, audit-reading APIs, production operations, and frontend Auth remain absent. Limited competition/candidate management is now implemented separately. Future service upgrades, production capacity, and independent security review are not established by local tests. No remote service/database is modified; await architect approval before Phase 2B-3.
