-- Initial baseline, part 3: query indexes and schema-integrity triggers only.
begin;

-- Shared rejection trigger: no identity lookup, mutation, or privileged access.
create function app.reject_immutable_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    raise exception 'Table %.% is append-only; % is forbidden', tg_table_schema, tg_table_name, tg_op
        using errcode = '55000';
end;
$$;
revoke all on function app.reject_immutable_mutation() from public, anon, authenticated, service_role;

create trigger votes_immutable before update or delete or truncate on app.votes
    for each statement execute function app.reject_immutable_mutation();
create trigger vote_adjustments_immutable before update or delete or truncate on app.vote_adjustments
    for each statement execute function app.reject_immutable_mutation();
create trigger result_publications_immutable before update or delete or truncate on app.result_publications
    for each statement execute function app.reject_immutable_mutation();
create trigger result_rows_immutable before update or delete or truncate on app.result_rows
    for each statement execute function app.reject_immutable_mutation();
create trigger audit_logs_immutable before update or delete or truncate on app.audit_logs
    for each statement execute function app.reject_immutable_mutation();

-- Unique/primary indexes already cover slugs, per-voter allowance queries,
-- guard lookup, per-competition candidates, versions, requests, and reversals.
create index competitions_listing_idx on app.competitions (starts_at, id)
    where published_at is not null and archived_at is null;
create index competitions_event_idx on app.competitions (event_id) where event_id is not null;
create index competitions_current_result_idx on app.competitions (id, current_result_publication_id)
    where current_result_publication_id is not null;
create index events_listing_idx on app.events (starts_at, id) where status = 'published';
create index events_cover_idx on app.events (cover_media_id) where cover_media_id is not null;
create index candidates_photo_idx on app.candidates (photo_media_id) where photo_media_id is not null;
create index gallery_items_order_idx on app.gallery_items (display_order, id) where status = 'published';
create index gallery_items_media_idx on app.gallery_items (media_asset_id);
create index gallery_items_event_idx on app.gallery_items (event_id) where event_id is not null;
create index competition_voters_identity_idx on app.competition_voters (voter_id, competition_id);
create index votes_candidate_totals_idx on app.votes (competition_id, candidate_id);
create index votes_identity_idx on app.votes (voter_id);
create index adjustment_requests_review_idx on app.vote_adjustment_requests (state, proposed_at);
create index vote_adjustments_candidate_totals_idx on app.vote_adjustments (competition_id, candidate_id);
create index vote_adjustments_request_fk_idx on app.vote_adjustments (competition_id, candidate_id, request_id, delta, request_state);
create index vote_adjustments_reversal_fk_idx on app.vote_adjustments (competition_id, candidate_id, reverses_adjustment_id)
    where reverses_adjustment_id is not null;
create index result_rows_publication_fk_idx on app.result_rows (competition_id, publication_id, outcome);
create index result_rows_candidate_idx on app.result_rows (competition_id, candidate_id);
create index enquiries_queue_idx on app.enquiries (state, created_at);
create index enquiries_retention_idx on app.enquiries (closed_at) where closed_at is not null;
create index audit_logs_time_idx on app.audit_logs (recorded_at, id);
create index audit_logs_actor_idx on app.audit_logs (actor_id, recorded_at);
create index audit_logs_target_idx on app.audit_logs (target_type, target_id, recorded_at);

comment on table app.votes is 'Immutable original ledger. No direct client writes; future cast_vote must lock the guard and enforce verified identity, window and allowance.';
comment on table app.vote_adjustment_requests is 'Review states describe requests only. Applied status is represented by the unique linked vote_adjustments row. Future RPCs enforce transitions, Super Admin authority and atomic audit.';
comment on table app.vote_adjustments is 'Append-only signed ledger. Never modifies original votes or voter allowance. Approval, nonnegative aggregate totals and correct reversal delta require future trusted RPCs.';
comment on table app.result_publications is 'Append-only versioned snapshots. Future publication RPC validates closure, eligible candidates, completeness and positive winners/all-zero outcome; republication changes only the competition pointer.';
comment on table app.result_rows is 'Immutable snapshot rows. Outcome copied and FK-bound to publication for per-row all-zero checks. Cross-row rank/winner/ledger accuracy requires future publication RPC.';
comment on table app.audit_logs is 'Confidential append-only audit storage. Future operations must insert durable actor-derived audits in their transaction. No automatic action-auditing exists yet.';
commit;
