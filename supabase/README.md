# Database baseline (Phase 2A)

Versioned Supabase PostgreSQL migrations only; no deployed database, seed data, Auth changes, policies, voting/CRUD RPCs, or frontend integration. The website continues using Phase 1 fixtures.

## Migration order

Apply the complete baseline in filename order as the same trusted migration owner:

| Migration | Purpose |
| --- | --- |
| `20261027000100_private_app_schema.sql` | Private `app` namespace and creator-specific default privilege hardening. |
| `20261027000200_application_tables.sql` | All 16 tables, keys and CHECKs; circular competition/result FK after publication tables; RLS and explicit table/sequence revokes before commit. |
| `20261027000300_indexes_and_immutability.sql` | Initial indexes and invoker-only triggers rejecting immutable-record UPDATE/DELETE/TRUNCATE. |

Each file has an explicit transaction. Do not use a partial baseline. `app` must not already exist: absence of `IF NOT EXISTS` intentionally rejects conflicting objects. Once applied anywhere, preserve migration history and add a later ordered migration for corrections. No migration has been applied during Phase 2A.

## Local setup when tooling is authorized and available

No installation or daemon reconfiguration is part of this phase. Future execution needs an isolated disposable **local** Supabase PostgreSQL environment (PostgreSQL 15+), supplying Supabase-managed `auth.users(id uuid)` and `anon`, `authenticated`, and `service_role`. Run as its trusted migration owner with permission to reference Auth and create schema/functions. Do not manufacture or modify Auth internals, link an existing remote project, or use real student/voter data.

If using Supabase CLI later, separately authorize/init its local configuration and Docker stack. Keep `app` outside `[api].schemas`; use the CLI's local migration workflow. No CLI config is included here, so `supabase start` is not yet a ready-to-run repository command.

Alternatively, once this disposable database and `psql` exist, apply files explicitly. The example's libpq service `nhs_schema_test` must be configured locally for loopback and the disposable database; credentials belong outside the repository. Run from the repository root:

```sh
psql "service=nhs_schema_test" -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261027000100_private_app_schema.sql
psql "service=nhs_schema_test" -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261027000200_application_tables.sql
psql "service=nhs_schema_test" -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261027000300_indexes_and_immutability.sql
```

Use a fresh disposable database for each replay. Direct psql application does not record Supabase CLI migration history; do not mix application methods without deliberate history reconciliation. Do not run `supabase db push`, link a cloud project, or reset a shared database for this phase.

## Static verification (available now)

```sh
node --test tests/schema-static.test.js
npm test
git diff --check
```

The new suite checks migration order/transactions and lexical delimiters, the 16-table inventory/primary keys, FK creation order, grants/defaults, RLS declarations, key integrity clauses, immutable triggers, and indexes. It rejects policies, privileged routines, seed inserts, and Auth/public-table mutations. These are structural source checks, **not PostgreSQL parsing or execution**. No parser dependency or database substitute was installed.

## Integration verification (pending)

After a clean replay, provision one synthetic identity through LOCAL Auth's supported interface and obtain its UUID. Neither the migrations nor the script below writes to `auth.users`. As the same trusted migration owner, run:

```sh
psql "service=nhs_schema_test" -X -v ON_ERROR_STOP=1 -v test_user_id=REPLACE_WITH_SYNTHETIC_LOCAL_AUTH_UUID -f supabase/tests/schema_verification.sql
```

The script inserts synthetic application fixtures within BEGIN/ROLLBACK and uses a temporary invoker-only assertion helper. On failure, ON_ERROR_STOP terminates psql and connection closure rolls back pending changes. Use only a disposable local database: truncate-rejection assertions deliberately exercise `TRUNCATE ... CASCADE` in exception subtransactions. They expect the immutable triggers to reject the statement.

Pending tests cover table/PK/validated-constraint inventory, all-table RLS/no policies, effective schema/table/helper/default privileges, duplicate votes, cross-competition candidate FKs, invalid allowances/windows/visibility, valid rankings without totals, invalid result pointers/versions/row relationships, negative totals, all-zero winner rejection, adjustment state/review/approved-request rules, duplicate application, and immutable UPDATE/DELETE/TRUNCATE rejection. Inspect all catalog constraint definitions and indexes after replay as well. Runtime verification must use actual Supabase role inheritance/default grants and confirm the Data API excludes `app`.

## Security and migration risks

All tables are private in `app`, have RLS enabled, and have no policies. PUBLIC/anon/authenticated/service_role receive no schema usage/create, table privileges, or helper execution. No exposed API schema is configured. A service role's RLS bypass does not grant object privileges. RLS is enabled, not forced: superusers/owners remain trusted, and unrestricted operators can disable triggers.

Defaults are creator-specific. PostgreSQL's implicit PUBLIC function execution cannot be removed by a schema-only revoke. Migration 1 therefore globally revokes future table/sequence/function API privileges for its creator, then removes scoped additions in `app`. This also affects **future objects this creator creates in other schemas**, but does not alter existing Auth/Supabase objects or grants. Review this impact before applying anywhere beyond a disposable test database. Different future creators need equivalent hardening. Defaults do not automatically enable RLS on future tables; each migration must explicitly enable it and revoke grants.

Historical FKs use restrictive deletion: Auth account, competition, and candidate deletion can be blocked; future workflows use controlled deactivation/archiving. Immutable triggers also reject zero-row UPDATE/DELETE. Snapshot rows remain owner-insertable until future publication operations validate completeness. No automatic updated-at maintenance, action-audit insertion, role escalation protection, or application permission path exists yet. Cross-row ledger accuracy, vote allowance concurrency, verified-phone eligibility, nonnegative adjusted aggregate totals, exact reversals, lifecycle freezing, and correct winner/rank publication require future trusted operations, not these CHECKs alone.

## Phase 2B boundary

Phase 2B needs separate architect authorization. Proposed work: reviewed owners/grants and scoped access paths, public/voter/admin/Super Admin RPCs, live role/phone checks, atomic vote locking, audited adjustment review/application, result aggregation/publication/republication, lifecycle restrictions, and real permission/concurrency tests. Do not expose private tables or connect the frontend first. No Phase 2B policies or business functions were added here.

References: [PostgreSQL default privilege scope](https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html), [statement/TRUNCATE triggers](https://www.postgresql.org/docs/current/sql-createtrigger.html), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [migration history](https://supabase.com/docs/guides/deployment/database-migrations).
