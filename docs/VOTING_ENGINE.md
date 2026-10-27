# Phase 2B-3B atomic voting contract

Backend only, on `phase-2b3/secure-voting`, based on reviewed SMS-proof commit `70243af`. Migration `20261027000800_voting_transactions.sql` adds two API RPCs, one private identity bridge, one limited function owner and eight owner-only RLS policies. No new tables, frontend integration, adjustments, official results, role-management endpoints or deployment are included. The seven approved migrations and 15-minute SMS proof policy are unchanged.

## RPCs and responses

Both entry points require `authenticated` execution and independently validate the caller's live SMS proof. No voter ID, phone, count, timestamp, session ID or authorization flag is an input. Successful own-data responses specify `Cache-Control: no-store`.

| Function | Return contract |
| --- | --- |
| `api.cast_vote(p_competition_id uuid,p_candidate_id uuid)` | Exactly one receipt: `vote_id`, `competition_id`, `candidate_id`, original `accepted_at`, `replayed`, `max_votes_per_voter`, `accepted_vote_count` (bigint), `remaining_allowance` (bigint). `replayed=false` denotes a newly inserted vote; true returns the existing immutable receipt. |
| `api.own_voting_state(p_competition_id uuid)` | One row: competition ID, maximum allowance, own accepted-original count, remaining allowance, `availability`, and `receipts` JSON array containing only own vote ID/candidate ID/acceptance time. No target-user parameter. |

Own state counts and receipts use one SQL statement/snapshot, ordered by acceptance time/UUID; it does not create a guard or lock the competition. Availability precedence is `archived`, `disabled`, `upcoming`, `closed`, `paused`, then `active`. Draft/future-publication/missing competitions are unavailable, without disclosing draft configuration. Published archived/disabled/closed competitions retain own receipts, but a valid current SMS proof is still necessary. After proof expiry, reauthenticate through the gateway to retrieve history. Public result visibility flags do not remove the caller's own original receipts.

## Identity and permissions

The approved `app.sms_session_is_valid()` is an **invoker** function that needs its owner's private proof/key/Auth-projection access. Simply granting its execution to a voting role would be insufficient. New `app.require_voting_identity()` is a private, fixed-path SECURITY DEFINER bridge owned by the existing limited `nhs_sms_proof_owner`. It runs the approved check and returns only the verified caller UUID, or raises 42501. Only `nhs_voting_writer` receives its execution grant; browser/service roles cannot execute it directly. The voting owner receives no proof/key/Auth-table access, Auth schema usage, owner-role membership or unrestricted operator helper.

The check binds verified JWT `sub`/`session_id` to a live matching Auth session, confirmed current +91 phone, HMAC binding, confirmation timestamp, proof expiry, session `not_after` and current account ban/anonymous state. Generic OTP AMR, metadata or a frontend status check cannot authorize voting. The gateway's identity contract and real-provider limitations remain in [VOTING_IDENTITY_REVIEW.md](VOTING_IDENTITY_REVIEW.md). Staff authority and voter eligibility remain separate; Auth ban/revocation invalidates voting, while staff-role membership is not a voter requirement.

`nhs_voting_writer` is NOLOGIN/NOINHERIT, owns only its two API routines, and has no superuser/RLS bypass, table ownership, role/database creation or replication rights. Column grants allow published competition configuration, candidate identity/eligibility, own guards and own original votes. INSERT is limited to guards and original votes. No adjustment/result/audit/staff/media writes or reads are granted. All 20 app tables retain RLS and no browser/service role receives direct app schema/table/column rights. Only `api` remains exposed.

PostgreSQL row locks require UPDATE permission and an applicable UPDATE USING policy. The owner receives only `UPDATE(id)` on competitions and `UPDATE(voter_id)` on guards for locking. Their **WITH CHECK(false)** policies reject actual UPDATE, including writing the existing value back. No voting function updates these columns. Original votes retain their approved immutable UPDATE/DELETE/TRUNCATE rejection trigger and have no UPDATE/DELETE grant for this owner. The INSERT policy independently checks own SMS identity, candidate membership/eligibility and enabled/unpaused/unarchived window binding. Cross-row allowance is enforced by the locked function, avoiding a recursive self-counting RLS policy.

## Transaction and idempotency

`cast_vote` is VOLATILE and requires PostgreSQL READ COMMITTED. PostgREST receives that per-function setting; a raw SQL caller using an unsafe isolation level is refused. One RPC is one transaction:

1. Derive the authorized caller through the private SMS bridge.
2. Lock the published competition `FOR SHARE`, before any guard/ledger access. Concurrent voters share this lock; the reviewed Admin `FOR UPDATE` convention conflicts with it.
3. Insert the `(competition_id,voter_id)` guard `ON CONFLICT ... DO NOTHING`, then lock that guard `FOR UPDATE`. A second simultaneous first request waits for the guard's unique key and then for its lock.
4. In fresh, separate statements, recheck SMS identity and read current configuration/own receipt. Post-lock statements see previously committed votes at READ COMMITTED. No count is taken in a pre-lock snapshot or combined stale CTE.
5. An existing own candidate receipt is returned without any new acceptance, even after the deadline or while published voting is paused/disabled/archived. This check deliberately precedes current time/eligibility/allowance gates. Historical identity/candidate/competition relations remain immutable; no receipt from another voter is visible.
6. For a new vote, reject unavailable competition or wrong/ineligible candidate; count own accepted **original** votes; reject count >= N. Adjustments never enter usage. N may exceed eligible candidate count, but one vote per candidate still limits usage.
7. Recheck proof, then take `clock_timestamp()` immediately before INSERT. Require `starts_at <= instant < ends_at` and store that database instant. A transaction validated before the deadline may commit after it; commit time is not the acceptance timestamp.
8. INSERT relies additionally on the existing composite FK and original-vote unique constraint. A candidate-key conflict inserts nothing, then rereads/recounts only the own receipt. Other unique failures are not disguised as successful acceptance. Recheck identity and return ledger-derived usage; all work commits together.

An exception rolls back a new guard and vote together. A repeated accepted candidate consumes no allowance, a rejected new attempt consumes none, and different competition guards have independent allowances. A network retry after commit returns the original receipt. No withdrawal, transfer or mutable voting counter exists. All application insertion paths must keep this protocol; unrestricted migration operators remain outside the application threat boundary.

## Timeouts and errors

Both RPCs specify `lock_timeout=2s`, `statement_timeout=8s`, and READ COMMITTED. PostgREST 16 [hoists per-function statement/isolation settings](https://docs.postgrest.org/en/stable/references/transactions.html) using its documented defaults. The integration suite verifies actual lock cancellation and statement cancellation under an injected sleep. Direct trusted SQL clients must set statement timeout **before** issuing their statement; an in-function SET alone is not a general timer guarantee for arbitrary SQL clients. No external Auth calls occur inside voting database locks; proof verification uses the reviewed local database helper.

| SQLSTATE | Meaning/action |
| --- | --- |
| `42501` | Invalid/expired/revoked/mismatched SMS identity, or denied access; reauthenticate when appropriate. |
| `22023` / binding error | Missing IDs / invalid argument types. |
| `P0002` | Competition/candidate unavailable or mismatched; no draft information. |
| `55000` | New acceptance outside the original window or while unavailable. |
| `54000` | Original voting allowance exhausted. |
| `55P03`, `57014` | Lock/statement timeout; transaction rolls back; retry the same candidate safely. |
| `25001` | Unsupported raw SQL isolation; use READ COMMITTED. |
| `40001` | Unexpected conflicting insertion could not be reread; retry after rollback. |

Do not infer acceptance from a timeout, stale UI count or an earlier proof/status response. Retry the same candidate to resolve an uncertain outcome. Own receipts contain no official candidate totals, rankings, other voter IDs, phones, adjustment information, result snapshots or confidential audits.

## Disposable verification

Use the existing isolated fixed-code/dummy-provider local setup; no dependency/provider install, hosted project or real SMS is required. After `node supabase/scripts/local-sms.mjs start`, run in order:

```sh
node supabase/tests/verify-access.mjs
node supabase/tests/verify-management.mjs
node supabase/tests/verify-sms-proof.mjs
node supabase/tests/verify-voting.mjs
```

Then `node supabase/scripts/local-sms.mjs reset` and repeat all suites on the clean eight-migration chain. Run local app/api lint, `npm test`, `npm run build`, and `git diff --check`; stop/remove only this disposable project with `node supabase/scripts/local-sms.mjs stop`. The voting runner obtains genuine SMS-attested sessions through the gateway and creates other synthetic Auth identities through supported local APIs. Operator SQL supplies controlled competition windows/locks, temporary failure/sleep/advisory-gate triggers and deliberately shortened proof lifetimes; these are not product endpoints or Auth bypasses. Every race checks persisted rows and the <=N invariant, not just JavaScript promise results. The adjustment-usage fixture is operator-only and rollback-only; no adjustment RPC is implemented.

Verified on local PostgreSQL 17.11 / PostgREST 16.5 / Auth v2.197.0, with pinned CLI 2.122.0 and Docker 29.4.2:

| Check | Executed result |
| --- | --- |
| Migration application and clean replay | All eight applied in order. First seven files unchanged; local migration history matches. |
| Phase 2A/access regression | 190 assertions passed, including 35 schema groups and future/default/helper privilege checks; schema fixture transaction rolled back. |
| Management regression | 330 assertions passed with original staff, lifecycle, audit and ledger assertions retained. |
| SMS proof regression | 136 assertions passed, including genuine email/password versus explicit local SMS exchange and live revocation/phone checks. |
| Voting suite | Final clean-replay run: **225 passed, 0 failed, 0 skipped**. Initial complete run passed 219 before adding six further service-role/historical-receipt authorization assertions. |
| Real concurrency/failure coverage | **13 scenarios**: same-candidate first-vote replay; final-allowance competition; six submissions with N=3; independent voters; independent competitions; actual Admin pause waiting for a vote; Admin-first pause; start-boundary wait; deadline-boundary wait; lock timeout; proof expiry while waiting on guard; forced INSERT failure/retry; statement timeout. Every scenario checks persisted rows and <=N. |
| Receipt and allowance rules | N=1, N>1, N exceeding candidate count, stable duplicate/after-deadline receipts, closed/disabled/paused/archived own history, account isolation, no-cache responses and rollback-only adjustment independence passed. |
| Security | Genuine email OTP/password, missing/forged JWT, expired/revoked/phone-changed/banned sessions and service-role voting were denied. Raw client/service INSERT and ledger UPDATE/DELETE/TRUNCATE were rejected. Lock-only UPDATE privileges failed actual mutation. The owner had no Auth/proof/key/audit/adjustment access or RLS bypass. |
| Deterministic replay | Voting function/policy catalog hash matched before/after clean replay: `7861915a67e82e1c196ceb8cfcb9fe82d647d70392a5966a01ece57920d61073`. |
| Final checks | app/api lint: no warnings/errors; Node: 32 passed, 0 failed/skipped; production build passed; whitespace/local-link/credential-pattern and frontend-isolation checks passed. |

The first development run found recursive RLS when an INSERT policy tried to count its own votes table (42P17). That redundant policy count was removed from the new migration; the trusted function's separately executed post-guard count is the cross-row allowance authority. Candidate/window/identity RLS checks remain. Timed test gates were replaced with explicit separate-session release after observing actual API lock waits, so races do not depend on a marker arriving before a fixed sleep finishes. No approved migration, SMS proof lifetime or administrative lifecycle rule was changed to obtain these results.

The disposable services/volumes and synthetic records are removed after verification. The source is committed/pushed only on the authorized feature branch; main, the original logos, frontend, dependencies and remote databases/configuration are unchanged. Real provider delivery, realistic production load, voting-endpoint abuse controls, hosted ingress, phone/account lifecycle policies, proof retention and independent security review remain future gates. No frontend, hosted deployment or Phase 2B-4 is authorized by this delivery. Architect review is the only current manual action.
