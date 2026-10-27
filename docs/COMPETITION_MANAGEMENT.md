# Phase 2B-2 competition management

This contract records the reviewed management baseline. The separately authorized [Phase 2B-3A SMS proof](VOTING_IDENTITY_REVIEW.md) leaves these operations, lifecycle rules and six approved migrations unchanged; vote submission still requires separate authorization.

Backend-only, through exposed `api`; the fixture-based frontend is unchanged. Forward migration `20261027000600_competition_management.sql` preserves all five verified migrations and adds nine RPCs, five private helpers, one limited owner role, and seven owner-only RLS policies. No voting, results, adjustments, role management, deletion, archiving, photo uploads, or frontend Auth is implemented.

## RPC contract

Every RPC is callable only by `authenticated`, then independently checks current active Admin/Super Admin authority. Other authenticated users cannot gain permission through metadata or a previous gate result. Anonymous execution is revoked. No RPC accepts an acting-user ID. Mutation RPCs return the affected competition/candidate UUID; reads return only the management fields listed below, never audit/ledger data.

| RPC | Parameters and behavior |
| --- | --- |
| `create_competition` | `p_slug`, `p_title`, `p_description`, `p_starts_at`, `p_ends_at`, `p_max_votes_per_voter`; creates a disabled, unpublished draft with trusted actor IDs and database timestamps. |
| `update_draft_competition` | `p_competition_id`, `p_title`, `p_description`, `p_starts_at`, `p_ends_at`, `p_max_votes_per_voter`; draft and before its original start only. Slug is not editable. |
| `set_competition_visibility` | `p_competition_id`, `p_show_vote_totals`, `p_show_live_counts`, `p_show_rankings`; before voting starts, draft or published; live counts require totals. |
| `publish_competition` | `p_competition_id`; draft and before start only; sets trusted publisher/time, enables availability for the configured window, and clears paused. Repeated publication fails; there is no unpublish endpoint. |
| `set_competition_paused` | `p_competition_id`, `p_paused`; published/enabled, unarchived and inside `[starts_at, ends_at)` only. Requires an actual state change. Never changes the window or reopens closed voting. |
| `add_candidate` | `p_competition_id`, `p_slug`, `p_display_name`, `p_description`, optional `p_eligible=true`, `p_youtube_video_id=null`, `p_video_start_seconds=0`; draft competition before start only. |
| `update_candidate` | `p_competition_id`, `p_candidate_id`, `p_display_name`, `p_description`, `p_eligible`, `p_youtube_video_id`, `p_video_start_seconds`; before start, including a published listing; scope must match the candidate's competition. |
| `managed_competitions` | Optional `p_competition_id=null`, `p_limit=20`, `p_offset=0`; staff-only listing/detail of draft/published/archived records: UUID/slug/title/description, window/allowance, publication time, enabled/paused/archive and visibility settings, updated time. |
| `managed_candidates` | Required `p_competition_id`, optional `p_limit=20`, `p_offset=0`; UUID/competition UUID/slug/name/description/eligibility/video mapping/updated time, ordered neutrally by slug/UUID. |

Slugs are lowercase alphanumeric/hyphen, 1–100 characters; competition slugs are globally unique, candidate slugs competition-unique. Trimmed title/name length is 1–200; descriptions are non-null and at most 10,000 characters. Windows must be finite, future-starting and strictly increasing; allowance is an integer 1–1000. Null visibility/eligibility flags are rejected. Pagination retains limits 1–100 and offsets 0–10,000. YouTube IDs are 11 allowlisted characters; timestamp is a nonnegative PostgreSQL integer. Clearing a video uses null ID and zero seconds. This validates format, not YouTube existence/ownership.

Invalid inputs use 22023 (or type-binding errors), duplicate slugs use 23505, missing/mismatched IDs use P0002, missing authority uses 42501, and frozen/invalid lifecycle states use 55000. Failed requests commit neither mutation nor audit.

## Lifecycle and locks

Draft configuration can change only before its original start. Publishing is one-way in this stage. Competition title/description/window/allowance editing remains draft-only even before start; visibility can change on a published listing before start. For this stage, **visibility is included in the configuration freeze**. All candidate names/descriptions/video/eligibility changes also stop at start. Candidate UUID, competition membership and slug are never mutable through these RPCs; no delete path exists.

Pause/resume is the sole in-window lifecycle mutation. Publication alone does not open voting early: future voting must still validate enabled/unpaused state and the database time window. There is no reopening, deadline extension, archive/delete, expired-draft recovery, or post-freeze correction endpoint. Listing publication does not impose a candidate minimum; finish draft candidate setup before publishing because later candidate additions are not permitted.

All mutations on an existing competition take its row `FOR UPDATE`; candidate edits then lock the matching candidate row `FOR UPDATE`. Locks last until the RPC transaction commits. This follows the approved order (competition, then child/guard) and conflicts with future voters' competition `FOR SHARE` lock. Different competitions remain independent. Creation instead relies on the unique slug constraint because no parent row exists yet.

Mutations are VOLATILE, use separate statements under READ COMMITTED, recheck active authority after lock waits, and decide freeze/deadline using `clock_timestamp()` after acquiring locks. They do not use a transaction-start timestamp that could become stale while waiting. Candidate edits recheck time after their child lock as well. No external calls occur inside database locks. Future role-management concurrency rules require separate authorization; a client gate result is never a permission token.

## Ownership, RLS and confidential audit

`nhs_management_writer` is NOLOGIN/NOINHERIT with no superuser, RLS bypass, role/database creation or replication. It owns only its routines, no tables. Only postgres receives membership; unrestricted database operators remain trusted. Temporary schema CREATE rights used to transfer ownership are revoked before commit; future routines default-deny API roles. All API routines have a fixed empty search_path and qualified references; no untrusted dynamic SQL is used.

Column grants allow competition/candidate INSERT and selected UPDATE fields, minimal management SELECT, and audit INSERT only. The owner cannot change slugs/parent IDs/archive/result pointers/photos, read audits, modify staff roles, or access original votes/guards/adjustments/results/media. It reuses reviewed caller/gate RPCs, without raw staff-table grants. Seven RLS policies apply only to this owner; SELECT/INSERT/UPDATE require the live Admin gate and trusted actor fields. Audit policy additionally verifies the actor's current protected role and an action/target allowlist. Client roles retain no app schema/table/column privileges; RLS remains enabled. Existing reader policies and public projections remain intact.

Every successful mutation inserts exactly one immutable confidential audit in the same transaction. Actor UUID and role come from the verified request and protected staff record, with another live authorization check at audit time. Action, target UUID/type and database timestamp are recorded. Details are capped at 8 KiB and contain submitted field names, parent UUID, and relevant configuration times/allowance/boolean before/after values. Candidate names, free-text titles/descriptions, credentials, tokens, OTPs and phone numbers are not copied into audits. Failure to insert the audit aborts the mutation; no exception handler swallows it. No audit-reading API exists.

## Local verification and limits

Use the existing dedicated local stack; never link or modify a remote project. After a clean **local** replay, run in order:

```sh
node supabase/tests/verify-access.mjs
node supabase/tests/verify-management.mjs
```

The new runner enforces the loopback project, keeps Auth credentials/tokens in memory, and creates only synthetic identities/fixtures. Operator-only fixture SQL prepares past/open/closed windows and role deactivation; these are not product endpoints. Audit-failure injection creates and removes a test-only INSERT-rejection trigger in the disposable database. Fixtures are left for inspection; reset the disposable database before rerunning and stop/remove its volumes after review. Never run the fixture scripts on a shared or remote database.

The access/schema regressions now recognize the nine additional APIs and seven exact owner-role policies. Client-grant, immutable-ledger, role isolation, and public draft-filtering assertions remain enforced. Static access tests stay scoped to the reviewed first five migrations; the new management source suite checks the forward-only contract. Existing verified migrations were not edited.

Verified locally on Supabase PostgreSQL 17.11, CLI 2.122.0 and Docker 29.4.2:

| Check | Actual result |
| --- | --- |
| Migration and clean replay | All six migrations applied/replayed successfully; local migration history matched. No historical migration edits or schema corrections were needed. |
| Management suite | 330 assertions passed in both initial and replay rounds, using anonymous/ordinary/Admin/Super Admin/inactive requests and real PostgreSQL/PostgREST permissions. |
| Regressions | 190 access-foundation assertions and Phase 2A's 35 groups plus default/helper checks passed in both rounds; the schema assertion transaction rolled back. |
| Audit atomicity/privacy | All seven mutation types rolled back under a forced audit INSERT failure. Successes committed exactly one audit with the correct trusted actor/role/action/target; names/free-text descriptions were absent. |
| Concurrency | Shared voter-style lock exclusion, post-wait start/deadline checks, single-success concurrent publication, and post-wait role deactivation all passed. Original votes/guards/adjustments/results remained byte-for-byte identical in the digest comparison. |
| Replay catalog | Normalized function/policy SHA-256 matched both rounds: `a0cdaa799b26c871e27ea82707ca020d191b75b751ea3b6c2facd432c6b5c1cd`. |
| Final checks | `npm test`: 30 passed, zero failed/skipped; `npm run build`: passed; app/api database lint: no warnings/errors; whitespace/link/credential-pattern checks passed. No new dependencies or frontend/branding changes. |

The named disposable services/volumes are removed after verification, clearing synthetic identities and fixtures. No remote database, cloud configuration, or production data was touched.

Remaining limitations: no retries/idempotency keys (duplicate slug or unchanged pause state fails), production deployment/security review, real voting concurrency/load guarantees, scoped per-competition staff, role management/recovery, uploads, or frontend forms. On uncertain create outcomes, staff can use management reads to check the unique slug/record; no extra vote or result behavior is implied. Phase 2B-3 requires separate architect approval.
