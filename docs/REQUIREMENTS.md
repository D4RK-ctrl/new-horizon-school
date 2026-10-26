# Requirements

Status: proposed Phase 0 baseline, 27 October 2026. All behavior below is planned, not implemented. Approval gates and unresolved policy decisions are in [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md).

## Roles and access

| Role | Authorized experience |
| --- | --- |
| Visitor | Browse published school content, events, candidates, performance links, and permitted statistics/results; submit an enquiry through a protected endpoint. No login required. |
| Voter | Visitor access plus SMS authentication using a verified Indian (+91) mobile number, own voting receipt/remaining allowance, and vote submission. |
| Admin | Email/password login; manage school content, galleries, events, competitions, candidates, performance mappings, voting configuration, publication, archiving, and aggregate analytics. No role management, confidential audit access, or vote adjustments. |
| Super Admin | Admin access plus administrator management, confidential audit review, and controlled vote adjustments. |

An authenticated account alone grants neither voter eligibility nor staff authority. Roles are stored in protected database records. Admin email login alone cannot vote; a staff account would also have to satisfy the voter phone-authentication checks.

## Public and audience experience

- Provide Home, About School, Admissions, Gallery, Contact, Events, Competition details, Candidate profile, and Competition results pages.
- Publish only approved placeholder or authorized content. Show useful loading, empty, error, closed-voting, and unpublished-results states.
- Give every candidate a stable shareable URL, matching QR-code destination, and candidate-specific HTML social metadata for WhatsApp and similar crawlers.
- Open an allowlisted YouTube performance link at the configured nonnegative start timestamp. Performance viewing never requires platform authentication.
- Display phone authentication only when needed to vote. Explain allowance, duplicate rules, deadline in Asia/Kolkata, and accepted/rejected status. Handle expired OTPs/sessions and uncertain network outcomes without silently casting extra votes.
- Collect minimal enquiry contact details and message with a privacy notice. Marketing opt-in must be separate and optional; no public access to submissions. Staff enquiry handling is a proposed limited admin capability, pending confirmation.

## Admin experience

- Create draft competitions, publish listings, set each competition's allowance and voting window, manage candidates and approved images, map video IDs/start seconds, and publish results after voting closes.
- Configure `show_vote_totals`, `show_live_counts`, and `show_rankings`. Public numeric totals require `show_vote_totals`; during active voting, numeric responses and updates additionally require `show_live_counts`. Enforce `show_live_counts => show_vote_totals` in the database; a live-count setting without totals permission is invalid.
- Public rankings require `show_rankings` and may be visible without numeric totals. Ranking permission authorizes relative ordering/rank only, never hidden numeric totals. Use neutral candidate ordering when rankings are hidden.
- After closure but before result publication, expose no public results: no totals, rankings, winner/tie labels, or no-votes outcome. After publication, winner/tie labels (or the all-zero outcome) become public; totals still require `show_vote_totals`, rankings still require `show_rankings`, and `show_live_counts` no longer gates published snapshot totals.
- Enforce every visibility rule in authorized backend responses, never only through frontend hiding. Do not leak hidden information through candidate ordering, metadata, exports, cached responses, or public API fields.
- Freeze allowance, schedule, and candidate eligibility once voting starts; close or pause voting through an audited control. No reopening in the initial design. A paused competition may resume only within its original window. Cosmetic content edits remain audited.
- View aggregate visits, performance-link clicks, enquiry conversions, and accepted-vote conversions; do not expose voter lists or cross-user voting histories to ordinary admins.

## Voting rules and integrity

1. Identify a voter from the authenticated Supabase user UUID with a currently confirmed +91 phone and an SMS-authenticated session; never accept a caller-supplied voter identity. Do not store phone numbers in public/application voting tables.
2. Configure a positive integer maximum N for each competition. A voter may cast at most N accepted votes in that competition, distributed among distinct candidates. N may exceed the number of candidates; distinctness still limits effective usage.
3. Enforce one original vote per `(competition, voter, candidate)` using a unique database constraint. A rejected or repeated submission consumes no allowance. Accepted votes cannot be withdrawn or moved in the prototype.
4. Accept only published, enabled, unarchived, unpaused competitions and eligible candidates during `starts_at <= database_time < ends_at`. Check the actual database clock after lock acquisition; browser clocks are advisory.
5. Validate eligibility, competition state/time, duplicates, and allowance and insert in one transaction. Serialize concurrent submissions for the same voter/competition. Deny all direct client writes to original votes, counters, and adjustment records.
6. Keep original votes immutable. Only Super Admins may initiate, review, and apply adjustments. A single Super Admin may propose, review, and apply an adjustment in the prototype; each operation must commit a protected, durable audit record. Preserve the separate append-only, signed-delta ledger with actor, reason, review record, and timestamp. Adjustments never change a voter's remaining allowance or bypass original duplicate constraints. Reevaluate independent approval before real-school deployment.
7. Official total = original accepted votes + applied adjustment deltas. Reject adjustments that would make any candidate total negative. A correction is a new reversing entry, never a historical overwrite.
8. If the highest official total is greater than zero, the candidate with that total wins; multiple candidates sharing the highest positive total are tied winners. If every eligible candidate has an official total of zero, display "No votes received" after publication and declare no winner or tied winners. With no eligible candidates, reject result publication.
9. Public results appear only after an authorized publication transaction. Draft results and confidential audit details must remain inaccessible through APIs, Storage, HTML, logs, and analytics.

## Lifecycle, publishing, and archives

Listing publication, voting availability, result publication, and archiving are separate concepts. A published listing can be upcoming, open, paused, or closed as derived from its window and enabled/paused flags. Time closure does not depend on a scheduled job.

After closure, an Admin publishes an immutable result snapshot with a version, publisher, totals, ranks, and the positive-total winner/tied winners or the all-zero "No votes received" outcome. Reject publication with no eligible candidates. Publication and adjustments serialize against the competition. Published snapshots never change through an adjustment: an explicit republication operation creates a new version, and the previous public version stays visible until an atomic version switch, with a public correction notice. Never silently change published totals.

Archiving ends all voting and removes the event from active listings while retaining authorized public details, the last published result version, original votes, adjustments, and audits. Retention/removal of candidate media is a separate privacy action. Never hard-delete a competition with voting history. Draft competitions/candidates without history may be removed through authorized operations.

## Non-functional requirements

- Accessible, responsive interfaces with semantic HTML, keyboard operation, visible focus, labeled inputs, useful errors, and sensible mobile/network performance; target WCAG 2.2 AA during implementation review.
- Database-enforced authorization and integrity; least privilege, output escaping, bounded inputs, upload checks, abuse protection, secret isolation, and security-relevant audit events.
- Store instants as PostgreSQL `timestamptz`, accept explicitly zoned administrative input, and display school times in Asia/Kolkata. Server decisions must not trust client time or claimed roles.
- Fail closed during backend outages; retry safely. Monitor quota use and errors without logging tokens, OTPs, full phone numbers, or enquiry bodies.
- Minimize personal data, maintain consent/retention processes, and separate public and private media. No invented official claims or real student identities in tests.
- Establish measurable load, availability, recovery, and performance targets before a real event; the prototype offers no production service guarantee.

## Prototype and future production

The prototype uses synthetic content, small controlled tests, manual setup, modest polling, and free-tier services where eligible. It demonstrates the proposed workflows, not real-school readiness.

Before production: school authorization and media permissions, applicable privacy/legal review, SMS delivery and abuse testing, privileged MFA, independent security review, realistic concurrency/load tests, backups with tested restores, monitoring/on-call ownership, retention/export/deletion procedures, and an eligible funded hosting plan. Verified phone possession is not proof of a unique human; SIM sharing, multiple numbers, recycled numbers, and account recovery remain policy risks.
