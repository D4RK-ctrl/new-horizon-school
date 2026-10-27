# Phase 2B-3A trusted SMS session proof

This document retains the reviewed Phase 2B-3A evidence and limitations. The separately authorized [Phase 2B-3B voting engine](VOTING_ENGINE.md) adds a private identity bridge under the existing SMS owner; it changes none of the seven approved migrations, proof lifetime, gateway or proof-minting permissions. Historical statements below about voting being absent describe the 3A handoff.

The original blocked diagnostic is preserved below. Phase 2B-3A now implements the architect-selected server-mediated SMS verification and private session proof. The voting engine remains **not implemented**; `cast_vote` and Phase 2B-3B require separate authorization. Current contracts and verification are after the historical evidence.

## Local evidence, 27 October 2026

Local `main` and `origin/main` were both `2f0509575cf776d128a1cda8f52900fffa10bd56`; branch `phase-2b3/secure-voting` starts there. Docker client/server 29.4.2, Supabase CLI 2.122.0, Auth image `public.ecr.aws/supabase/gotrue:v2.197.0`, PostgreSQL image `17.11.0.006`, Node 22.13.1. Only the dedicated disposable project `nhs-phase2a-verification` and loopback API `http://127.0.0.1:55431` were used.

The six approved migrations applied successfully on initial startup and on `supabase db reset --local --no-seed --workdir . --yes`. No historical migration was edited.

For the SMS prerequisite probe, the local config temporarily enabled SMS signup/confirmation and defined one synthetic phone/test-code pair using the documented `[auth.sms.test_otp]` mechanism. No SMS provider or delivery hook was configured. CLI startup warned `no SMS provider is enabled. Disabling phone login`; the actual `/auth/v1/otp` request returned HTTP **400**, `phone_provider_disabled`, `Unsupported phone provider`. Consequently **no successful SMS verification/session is claimed**. The exact original config was restored after diagnosis.

The diagnostic then provisioned a synthetic account with a confirmed phone and email through local Auth's supported admin API. Supported local `admin/generate_link` produced an email OTP without sending mail; `/verify` with `type=email` exchanged that code for a genuine Auth-issued session. A separate password login used the same account. No Auth internal table was modified with SQL; trusted operator SQL inspected session records only.

| Actual flow | JWT AMR | Persisted `auth.mfa_amr_claims` | Confirmed account phone |
| --- | --- | --- | --- |
| Email OTP | `method=otp`, no provider/channel | `authentication_method=otp` | Present, normalized `91` plus ten digits; no leading `+` in this Auth version |
| Email/password | `method=password`, no provider/channel | `authentication_method=password` | Same confirmed phone |
| SMS OTP | Not obtained: provider disabled | Not tested | Not evidence of SMS-session authentication |

Both obtained tokens were accepted by Auth `/user` and PostgREST `api.account_status`. Both had account metadata `provider=email`, `providers=[email,phone]`; this describes linked account identities, not the session's OTP channel. The email OTP JWT included the phone despite that session never authenticating by SMS. `auth.sessions` has no OTP delivery-channel column; its session ID links to the same generic AMR record. Changing the JWT payload to claim SMS without signing it returned HTTP **401**. The original vote ledger remained empty.

There were **22 passed diagnostic assertions**. These establish the counterexample and identify the disabled-provider failure; they are not voting acceptance, SMS delivery, or concurrency tests. The manual runner is [probe-voting-identity.mjs](../supabase/tests/probe-voting-identity.mjs). Run `node supabase/tests/probe-voting-identity.mjs` only on the freshly reset dedicated local stack described in [supabase/README.md](../supabase/README.md). It refuses remote-link state, a different API/project, or existing Auth users, and keeps generated credentials/tokens out of output. With the unchanged config it reports the provider-disabled failure; an actual SMS comparison remains conditional on an approved supported local configuration. It leaves synthetic fixtures until the disposable database is removed/reset.

## Why the original implementation stopped

`confirmed +91 phone AND AMR contains otp` would authorize the demonstrated email OTP session. Checking `session_id`, linked phone identity, or account provider metadata does not repair that channel ambiguity. A request parameter, user metadata, inferred timestamps, or a fabricated `sms` claim would not be trusted SMS evidence.

The matching [Auth v2.197.0 verification implementation](https://github.com/supabase/auth/blob/v2.197.0/internal/api/verify.go) passes `models.OTP` when issuing sessions from both SMS and email OTP verification. Its [session AMR implementation](https://github.com/supabase/auth/blob/v2.197.0/internal/models/sessions.go) does not add an OTP-channel discriminator. This source evidence explains the ambiguity; it does **not** substitute for a successful local SMS test.

Relevant supported-provider references: [JWT claims](https://supabase.com/docs/guides/auth/jwt-fields), [session semantics](https://supabase.com/docs/guides/auth/sessions), [local Auth tests](https://supabase.com/docs/guides/auth/testing-auth-flows), [CLI SMS test configuration](https://supabase.com/docs/guides/local-development/cli/config#auth.sms.test_otp), and [admin-generated email OTPs](https://supabase.com/docs/reference/javascript/auth-admin-generatelink).

At the original blocked handoff, architect approval of a reliable, server-controlled session-bound SMS attestation design and supported local verification setup was required. A channel-specific phone MFA design was another option, not an implemented substitute. The selected Phase 2B-3A gateway below preserves staff email login, rejects email-only OTP sessions, binds proof to the relevant verified phone/session, and supplies genuine local positive/negative evidence. No authentication restriction has been weakened.

## Historical verification and repository state

`npm test`: **30 passed, 0 failed, 0 skipped**. `npm run build`: **passed**. The existing migration chain replayed, but Phase 2A/access/management integration suites, database lint, and voting/identity/concurrency acceptance suites were **not rerun/completed for Phase 2B-3** because implementation stopped at the identity prerequisite. No voting transaction, allowance lookup, receipt, timeout, locking, or idempotency implementation exists to validate.

The original blocked handoff added only this review document and the manual diagnostic runner. Configuration, approved migrations, frontend, dependencies, and both untracked logo images were unchanged. The disposable services/volumes and synthetic data were removed after that probe. No remote project, paid service, merge, PR, deployment, or Phase 2B-4 work was involved. Those review files were left uncommitted then; no misleading `added secure voting` commit or branch push was made while the required engine was blocked.

## Selected Phase 2B-3A solution and trust boundary

`server/sms-gateway.mjs` exports a framework-free Node request handler; `server/local-sms-gateway.mjs` exposes only `POST /verify-sms` on loopback port 55439. There is no deployed adapter or frontend connection. The client requests delivery through Auth `/otp`, then sends exactly `{phone,code}` to the gateway. The gateway never accepts a preexisting JWT, acting UUID, session UUID, caller-selected verification type or verified boolean.

The gateway normalizes an Indian E.164 input to Auth's digits-only form, reserves the pending challenge, and itself calls Auth `/verify` with **`type=sms`**. It verifies the resulting token with Auth `/user`, then checks matching returned/verified user, phone confirmation, signed subject/session/phone/issuer/audience/role, fresh issuance and JWT expiry. Only then does it invoke the server-only proof operation. The HTTP response contains the Auth access/refresh tokens and proof expiry only after proof insertion succeeds. These session tokens are intended for the receiving client; they are not logged, stored in proofs, or copied into Vite code.

Only this explicit SMS exchange establishes the channel. AMR remains a supplementary consistency check. An email OTP session can have the same `otp` AMR and confirmed phone but has no matching attestation. Calling Auth directly can obtain a legitimate SMS token but cannot create a proof. The original probe is preserved as historical evidence; fixed-code SMS comparisons can now be executed with the local launcher.

## Database contract and expiry

Forward migration `20261027000700_sms_session_proof.sql` adds four private tables: `sms_proof_key` (one random database binding key), `sms_verification_limits` (keyed rate buckets), `sms_verification_challenges` (one reservation per Auth user/challenge timestamp), and `sms_session_attestations` (one proof per session and consumed challenge). The first six migrations are unchanged.

Server-only `api.reserve_sms_verification(p_phone text,p_network_key text)` consumes rate capacity and returns a random lease or null. It requires a pending, nonempty Auth challenge no more than **60 seconds old**, leases it for **30 seconds**, and serializes concurrent reservations. This one-minute window is deliberately stricter than a longer provider OTP lifetime. An absent/expired/consumed challenge returns null without avoiding rate accounting. `api.cancel_sms_verification(p_lease_id uuid)` permits another attempt after an unsuccessful exchange. `api.attest_sms_session(p_lease_id uuid,p_session_id uuid)` verifies the reserved identity against the newly issued live Auth session, inserts the proof and consumes the reservation atomically. All three are executable only by `service_role`; no browser role can call them. They are not generic SQL or table-write endpoints.

`api.sms_session_status()` returns only a boolean for the validated caller's `sub` and `session_id`; it accepts no identifiers. Its private `app.sms_session_is_valid()` helper is inaccessible to browser roles. Future voting must call that live check inside its own transaction; checking status earlier never authorizes a later mutation.

Proof expiry is the earlier of **15 minutes from Auth-session creation** and `auth.sessions.not_after`, when present. Database clocks generate proof/reservation times. Refreshing an access token with the same session ID preserves the original expiry and cannot renew the proof. A new SMS exchange/challenge is needed after expiry. A PostgREST-verified, unexpired access JWT is necessary but insufficient: each check also verifies that the Auth session still exists, belongs to the user and is not past `not_after`, that the account is not banned/anonymous, and that the current confirmed Indian phone matches the proof's confirmation timestamp and **HMAC-SHA256 binding**. The random HMAC key remains in private database storage, protecting low-entropy phone numbers from a plain phone-hash dictionary. Neither OTPs, OTP hashes, full phones, access/refresh tokens nor provider secrets are persisted in these app tables. Challenge rows store only identity, keyed phone binding and timestamps/leases.

Session deletion (including supported local-scope logout) cascades proof removal. Account deletion cascades these auxiliary records; existing original-vote restrictive deletion rules remain intact. Changing the phone, clearing/changing confirmation, banning an account, expiring a proof/session or removing a session denies proof immediately on the next database request, even with an old authentic JWT. Provider-wide session timeout settings other than `not_after` are not configured locally: before deployment, align any new inactivity/timebox settings with this policy or extend the reviewed live check. This prototype does not promise instant cancellation of an already running transaction during concurrent revocation; future voting must recheck after its locks.

## Privilege and abuse boundaries

`nhs_sms_proof_owner` is NOLOGIN/NOINHERIT, has no table ownership/RLS bypass or role/database creation rights, and receives only SELECT on the private binding key, SELECT/INSERT on proofs and SELECT/INSERT/selected operational UPDATE on limits/challenges. Nine owner-only policies protect the four new tables. Browser and service roles retain no direct app schema/table/column access. The owner cannot access votes, adjustments, staff roles, results or confidential audits and has no Auth-table/schema grants.

Supabase Auth startup manages its own ACLs and RLS. Two **private, operator-owned SECURITY DEFINER** projections, `app.sms_auth_challenge(text)` and `app.sms_auth_session(uuid,uuid)`, provide only the required current challenge or confirmed-phone/session facts. They are callable only by the limited proof owner, use qualified static SQL and fixed empty search paths, perform no Auth writes, and expose no tokens/credential hashes. No managed Auth policies/tables are changed. The operator's RLS bypass is limited by these fixed reviewed function bodies; it is an explicit trusted boundary, not a blanket Auth grant to the gateway owner.

The gateway uses its server-only service credential solely for the three proof RPCs; it is an issuer credential and must be protected. Compromise of that credential or the trusted gateway is outside the client threat boundary and can undermine proof issuance. It has no newly granted ledger/audit/role/result mutations. There is no exposed client proxy for arbitrary RPCs or service-token requests.

Verification attempts are durably limited to **5 per phone and 20 per network address per 5 minutes**. Keys are HMAC-derived; no raw IP is stored. Bucket rows lock in sorted order. Auth independently limits OTP delivery. The gateway limits JSON bodies to 512 bytes, accepts only six-digit codes and normalized +91 numbers, requires an exact allowed Origin (not treated as authentication), rejects Authorization/token/ID inputs, has bounded upstream calls, disables redirects and caching, and logs only predefined failure-stage names. The local adapter trusts only the socket address, never forwarded headers. Hosted proxy trust, TLS ingress, an end-to-end shared deadline, bot controls, key rotation/retention and production load/abuse testing require review before deployment. A stable secret must be shared by gateway instances for network-bucket consistency; the database phone buckets persist across gateway restarts. Auxiliary expired rate/challenge/proof rows need a reviewed maintenance/retention schedule before real use.

## Reproduce using disposable local services

Use the pinned Node/CLI/Docker prerequisites from the project README. No new dependencies, paid provider, SMS messages or remote project are needed:

```sh
node supabase/scripts/local-sms.mjs start
node supabase/tests/verify-access.mjs
node supabase/tests/verify-management.mjs
node supabase/tests/verify-sms-proof.mjs
node supabase/scripts/local-sms.mjs reset
# Repeat the three suites above after clean replay.
node node_modules/supabase/dist/supabase.js db lint --local --schema app,api --level warning --fail-on warning
npm test
npm run build
git diff --check
node supabase/scripts/local-sms.mjs stop
```

The launcher only permits start/reset/stop against the fixed disposable project. It generates `tmp/sms-proof-local/supabase/config.toml` and migration copies, all ignored, leaving the tracked config unchanged. Fixed test numbers/codes and dummy Twilio configuration satisfy CLI 2.122.0's enabled-provider requirement; Auth v2.197.0 short-circuits external delivery for mapped numbers. The dummy values are visibly invalid test placeholders, not production provider credentials. Tests send only mapped numbers; do not request delivery to any other number with this configuration. No upgrade was required. Never copy this generated workdir, test maps or dummy provider block into a deployment, run `config push` from it, or link it remotely. The repository has no deployment path referencing this workdir; the provided launcher has no remote/config-push action and refuses remote-link state. Before any hosted deployment, remove all test bypasses, configure a separately approved provider and repeat the security review.

The integration runner starts the local gateway with credentials supplied in child-process memory, invokes real HTTP/Auth/PostgREST/database behavior, and removes its process afterward. It never writes session secrets to disk. Only trusted disposable-operator fixtures advance timestamps or inject a proof INSERT failure; actual phone changes, account bans/deletion, login, refresh and logout use supported Auth APIs. The fixed-code provider intentionally permits reuse/does not model real SMS delivery or code expiry. Gateway pending-challenge age/consumption are independently tested, including expired timestamps and simultaneous attempts, so that bypass cannot create extra proofs from one challenge. A storage failure can leave an Auth session without a proof; no token is returned and a fresh delivery request is required to retry. No promise of exactly-once HTTP session delivery or transparent recovery is made.

For manual local gateway execution, the server-only environment names are `SMS_SUPABASE_URL`, `SMS_ANON_KEY`, `SMS_SERVICE_KEY`, and `SMS_RATE_SECRET`; the integration runner supplies them automatically without a credential file. Never expose the service key/rate secret through `VITE_*` or a browser bundle. A confirmation timestamp change can conservatively invalidate an earlier proof even if the phone digits are unchanged.

## Executed Phase 2B-3A verification

| Check | Actual final result |
| --- | --- |
| Migrations and clean replay | All seven applied successfully in order. The first six approved files are byte-for-byte unchanged in the working tree. |
| Phase 2A/access regressions | 190 assertions passed, including 35 Phase 2A groups plus default/helper privilege checks; the schema test transaction rolled back. |
| Management regressions | 330 assertions passed, including unchanged staff authorization, lifecycle locks/freezes, atomic audits and protected ledger checks. |
| SMS proof integration | 136 assertions passed before and after clean replay, using real HTTP, local Auth, PostgREST, SQL and separate concurrent gateway requests. |
| Positive SMS/provider evidence | Actual `/otp` and gateway-controlled `/verify` with `type=sms` succeeded on Auth v2.197.0 using the isolated fixed-code/dummy-provider setup. No SMS was delivered externally. |
| Negative identity/permissions | Confirmed-phone email OTP and password sessions, unverified/foreign phones, wrong codes, expired pending challenges, forged JWT/IDs/metadata, direct Auth sessions, different user/session reuse and browser proof mint/read/write paths were denied. |
| Lifecycle/replay/abuse | Same-challenge replay and parallel attempts produced at most one proof. Phone changes, proof/session expiry, supported session logout, bans and account deletion invalidated eligibility. Refresh did not extend proof expiry. Both durable rate limits and forwarded-header spoof rejection passed. |
| Failure/logging isolation | Forced proof INSERT failure returned no tokens/proof; a fresh challenge recovered. Voting/guard/audit/result/adjustment digests were unchanged. Captured gateway output contained no OTP, local API keys or access/refresh tokens. |
| Deterministic function replay | SMS function catalog SHA-256 matched: `ba2f4d03ccef57a86d0ecc451857826019f2731bf647fe931494549ec7e9f6fe`. |
| Lint and source/build checks | app/api lint: no warnings/errors. `npm test`: 32 passed, 0 failed/skipped. `npm run build`, syntax, whitespace, local documentation links and credential/bundle checks passed. |

During development, direct limited-role Auth reads failed because managed Auth ACLs/RLS are closed; the private operator-owned projections above resolve that without changing Auth grants/policies. A lint warning for an unused local variable was removed. A full regression rerun encountered a local HTTP transport failure; gateway upstream requests and local test clients now explicitly use fresh connections. The entire clean replay and all assertions then passed without relaxing authorization/lifecycle checks. No approved migration was edited.

The disposable services/volumes are removed after verification. Only the feature branch is committed/pushed for review; main, remote databases/configuration, frontend, dependencies and both original untracked logos are unchanged. No voting engine, production SMS delivery, frontend OTP UI, PR, merge, deployment or Phase 2B-3B work is part of this phase. Architect review is the only current manual action; production provider delivery/expiry/reuse, hosted ingress/proxy trust, service-key protection, retention/cleanup and realistic load testing remain future gates.
