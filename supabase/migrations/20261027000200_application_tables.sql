-- Initial baseline, part 2: relational schema, constraints, and closed RLS.
-- No seeds, Auth DML, policies, counters, or business-operation functions.
begin;

create table app.staff_roles (
    user_id uuid primary key references auth.users(id) on delete restrict,
    role text not null constraint staff_roles_role check (role in ('admin', 'super_admin')),
    active boolean not null default true,
    granted_by uuid references auth.users(id) on delete restrict,
    granted_at timestamptz not null default clock_timestamp()
);

create table app.media_assets (
    id uuid primary key default gen_random_uuid(),
    bucket_name text not null check (char_length(bucket_name) between 1 and 100),
    object_path text not null check (char_length(object_path) between 1 and 1024),
    mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
    byte_size bigint not null check (byte_size between 1 and 20971520),
    width integer not null check (width between 1 and 10000),
    height integer not null check (height between 1 and 10000),
    alt_text text not null default '' check (char_length(alt_text) <= 500),
    approval_status text not null default 'pending' check (approval_status in ('pending', 'approved', 'rejected')),
    permission_status text not null default 'pending' check (permission_status in ('pending', 'authorized', 'revoked')),
    is_public_derivative boolean not null default false,
    uploaded_by uuid not null references auth.users(id) on delete restrict,
    approved_by uuid references auth.users(id) on delete restrict,
    approved_at timestamptz,
    created_at timestamptz not null default clock_timestamp(),
    constraint media_assets_object unique (bucket_name, object_path),
    constraint media_assets_approval check (
        (approval_status = 'approved' and approved_by is not null and approved_at is not null)
        or (approval_status <> 'approved' and approved_by is null and approved_at is null)
    ),
    constraint media_assets_public_approval check (
        not is_public_derivative or (approval_status = 'approved' and permission_status = 'authorized')
    )
);

create table app.school_pages (
    id uuid primary key default gen_random_uuid(),
    page_key text not null unique check (page_key in ('home', 'about', 'admissions', 'contact')),
    title text not null check (char_length(btrim(title)) between 1 and 200),
    content jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
    status text not null default 'draft' check (status in ('draft', 'published')),
    published_by uuid references auth.users(id) on delete restrict,
    published_at timestamptz,
    created_by uuid not null references auth.users(id) on delete restrict,
    updated_by uuid not null references auth.users(id) on delete restrict,
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp(),
    constraint school_pages_publication check (
        (status = 'published' and published_by is not null and published_at is not null)
        or (status = 'draft' and published_by is null and published_at is null)
    )
);

create table app.events (
    id uuid primary key default gen_random_uuid(),
    slug text not null unique check (char_length(slug) between 1 and 100 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    title text not null check (char_length(btrim(title)) between 1 and 200),
    description text not null default '' check (char_length(description) <= 10000),
    starts_at timestamptz not null,
    ends_at timestamptz not null,
    status text not null default 'draft' check (status in ('draft', 'published')),
    cover_media_id uuid references app.media_assets(id) on delete restrict,
    published_by uuid references auth.users(id) on delete restrict,
    published_at timestamptz,
    created_by uuid not null references auth.users(id) on delete restrict,
    updated_by uuid not null references auth.users(id) on delete restrict,
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp(),
    constraint events_window check (starts_at < ends_at),
    constraint events_publication check (
        (status = 'published' and published_by is not null and published_at is not null)
        or (status = 'draft' and published_by is null and published_at is null)
    )
);

create table app.competitions (
    id uuid primary key default gen_random_uuid(),
    event_id uuid references app.events(id) on delete restrict,
    slug text not null unique check (char_length(slug) between 1 and 100 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    title text not null check (char_length(btrim(title)) between 1 and 200),
    description text not null default '' check (char_length(description) <= 10000),
    max_votes_per_voter integer not null constraint competitions_allowance check (max_votes_per_voter between 1 and 1000),
    starts_at timestamptz not null,
    ends_at timestamptz not null,
    published_by uuid references auth.users(id) on delete restrict,
    published_at timestamptz,
    enabled boolean not null default false,
    paused boolean not null default false,
    archived_at timestamptz,
    show_vote_totals boolean not null default false,
    show_live_counts boolean not null default false,
    show_rankings boolean not null default false,
    current_result_publication_id uuid,
    created_by uuid not null references auth.users(id) on delete restrict,
    updated_by uuid not null references auth.users(id) on delete restrict,
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp(),
    constraint competitions_window check (starts_at < ends_at),
    constraint competitions_visibility check (not show_live_counts or show_vote_totals),
    constraint competitions_publication check ((published_at is null) = (published_by is null)),
    constraint competitions_enabled check (not enabled or (published_at is not null and archived_at is null)),
    constraint competitions_result_listing check (current_result_publication_id is null or published_at is not null)
);

create table app.candidates (
    id uuid primary key default gen_random_uuid(),
    competition_id uuid not null references app.competitions(id) on delete restrict,
    slug text not null check (char_length(slug) between 1 and 100 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    display_name text not null check (char_length(btrim(display_name)) between 1 and 200),
    description text not null default '' check (char_length(description) <= 10000),
    photo_media_id uuid references app.media_assets(id) on delete restrict,
    eligible boolean not null default true,
    youtube_video_id text check (youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'),
    video_start_seconds integer not null default 0 check (video_start_seconds >= 0),
    created_by uuid not null references auth.users(id) on delete restrict,
    updated_by uuid not null references auth.users(id) on delete restrict,
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp(),
    constraint candidates_competition_id unique (competition_id, id),
    constraint candidates_competition_slug unique (competition_id, slug),
    constraint candidates_video_start check (youtube_video_id is not null or video_start_seconds = 0)
);

create table app.gallery_items (
    id uuid primary key default gen_random_uuid(),
    media_asset_id uuid not null references app.media_assets(id) on delete restrict,
    event_id uuid references app.events(id) on delete restrict,
    caption text not null default '' check (char_length(caption) <= 1000),
    display_order integer not null default 0 check (display_order >= 0),
    status text not null default 'draft' check (status in ('draft', 'published')),
    published_by uuid references auth.users(id) on delete restrict,
    published_at timestamptz,
    created_by uuid not null references auth.users(id) on delete restrict,
    updated_by uuid not null references auth.users(id) on delete restrict,
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp(),
    constraint gallery_items_publication check (
        (status = 'published' and published_by is not null and published_at is not null)
        or (status = 'draft' and published_by is null and published_at is null)
    )
);

create table app.competition_voters (
    competition_id uuid not null references app.competitions(id) on delete restrict,
    voter_id uuid not null references auth.users(id) on delete restrict,
    created_at timestamptz not null default clock_timestamp(),
    primary key (competition_id, voter_id)
);

create table app.votes (
    id uuid primary key default gen_random_uuid(),
    competition_id uuid not null,
    voter_id uuid not null,
    candidate_id uuid not null,
    accepted_at timestamptz not null default clock_timestamp(),
    constraint votes_voter_guard foreign key (competition_id, voter_id)
        references app.competition_voters(competition_id, voter_id) on delete restrict,
    constraint votes_candidate_competition foreign key (competition_id, candidate_id)
        references app.candidates(competition_id, id) on delete restrict,
    constraint votes_one_per_candidate unique (competition_id, voter_id, candidate_id)
);

create table app.vote_adjustment_requests (
    id uuid primary key default gen_random_uuid(),
    competition_id uuid not null,
    candidate_id uuid not null,
    delta bigint not null check (delta between -1000000000000 and 1000000000000 and delta <> 0),
    reason text not null check (char_length(btrim(reason)) between 1 and 2000),
    proposed_by uuid not null references auth.users(id) on delete restrict,
    proposed_at timestamptz not null default clock_timestamp(),
    state text not null default 'proposed' check (state in ('proposed', 'approved', 'rejected')),
    reviewed_by uuid references auth.users(id) on delete restrict,
    reviewed_at timestamptz,
    review_note text check (char_length(review_note) <= 2000),
    constraint adjustment_requests_candidate foreign key (competition_id, candidate_id)
        references app.candidates(competition_id, id) on delete restrict,
    constraint adjustment_requests_application_key unique (competition_id, candidate_id, id, delta, state),
    constraint adjustment_requests_review check (
        (state = 'proposed' and reviewed_by is null and reviewed_at is null)
        or (state in ('approved', 'rejected') and reviewed_by is not null and reviewed_at is not null and reviewed_at >= proposed_at)
    )
);

create table app.vote_adjustments (
    id uuid primary key default gen_random_uuid(),
    competition_id uuid not null,
    candidate_id uuid not null,
    request_id uuid not null unique,
    request_state text not null default 'approved' check (request_state = 'approved'),
    delta bigint not null check (delta between -1000000000000 and 1000000000000 and delta <> 0),
    reason text not null check (char_length(btrim(reason)) between 1 and 2000),
    applied_by uuid not null references auth.users(id) on delete restrict,
    applied_at timestamptz not null default clock_timestamp(),
    reverses_adjustment_id uuid unique,
    constraint vote_adjustments_request foreign key (competition_id, candidate_id, request_id, delta, request_state)
        references app.vote_adjustment_requests(competition_id, candidate_id, id, delta, state) on delete restrict,
    constraint vote_adjustments_reversal_key unique (competition_id, candidate_id, id),
    constraint vote_adjustments_reversal foreign key (competition_id, candidate_id, reverses_adjustment_id)
        references app.vote_adjustments(competition_id, candidate_id, id) on delete restrict,
    constraint vote_adjustments_no_self_reversal check (reverses_adjustment_id is null or reverses_adjustment_id <> id)
);

create table app.result_publications (
    id uuid primary key default gen_random_uuid(),
    competition_id uuid not null references app.competitions(id) on delete restrict,
    version integer not null check (version > 0),
    outcome text not null check (outcome in ('winners', 'no_votes_received')),
    published_by uuid not null references auth.users(id) on delete restrict,
    published_at timestamptz not null default clock_timestamp(),
    ledger_cutoff_at timestamptz not null,
    correction_notice text check (char_length(correction_notice) <= 2000),
    constraint result_publications_version unique (competition_id, version),
    constraint result_publications_competition_id unique (competition_id, id),
    constraint result_publications_outcome_key unique (competition_id, id, outcome),
    constraint result_publications_cutoff check (ledger_cutoff_at <= published_at),
    constraint result_publications_correction check (version = 1 or (correction_notice is not null and char_length(btrim(correction_notice)) > 0))
);

create table app.result_rows (
    publication_id uuid not null,
    candidate_id uuid not null,
    competition_id uuid not null,
    outcome text not null,
    original_count bigint not null check (original_count >= 0),
    adjustment_sum bigint not null,
    official_total bigint not null check (official_total >= 0),
    rank bigint not null check (rank > 0),
    is_winner boolean not null default false,
    is_tied_winner boolean not null default false,
    primary key (publication_id, candidate_id),
    constraint result_rows_publication foreign key (competition_id, publication_id, outcome)
        references app.result_publications(competition_id, id, outcome) on delete restrict,
    constraint result_rows_candidate foreign key (competition_id, candidate_id)
        references app.candidates(competition_id, id) on delete restrict,
    constraint result_rows_total check (official_total::numeric = original_count::numeric + adjustment_sum::numeric),
    constraint result_rows_positive_winner check (not is_winner or (official_total > 0 and rank = 1)),
    constraint result_rows_tied_winner check (not is_tied_winner or is_winner),
    constraint result_rows_no_votes check (outcome <> 'no_votes_received' or (official_total = 0 and not is_winner and not is_tied_winner))
);

-- Complete the circular relationship only after both tables exist. MATCH SIMPLE
-- permits the nullable current pointer; a non-null pointer must match this ID.
alter table app.competitions add constraint competitions_current_result
    foreign key (id, current_result_publication_id)
    references app.result_publications(competition_id, id) on delete restrict;

create table app.enquiries (
    id uuid primary key default gen_random_uuid(),
    contact_name text not null check (char_length(btrim(contact_name)) between 1 and 200),
    reply_channel text not null check (reply_channel in ('email', 'phone')),
    reply_value text not null check (char_length(btrim(reply_value)) between 1 and 320),
    message text not null check (char_length(btrim(message)) between 1 and 5000),
    privacy_notice_version text not null check (char_length(btrim(privacy_notice_version)) between 1 and 100),
    marketing_consent boolean not null default false,
    marketing_consent_at timestamptz,
    state text not null default 'new' check (state in ('new', 'in_progress', 'closed')),
    closed_at timestamptz,
    created_at timestamptz not null default clock_timestamp(),
    constraint enquiries_consent check (marketing_consent = (marketing_consent_at is not null)),
    constraint enquiries_closure check ((state = 'closed' and closed_at is not null) or (state <> 'closed' and closed_at is null))
);

create table app.analytics_daily (
    day date not null,
    event_type text not null check (event_type in ('page_view', 'performance_click', 'enquiry_accepted', 'vote_accepted')),
    entity_key text not null check (
        entity_key = 'site'
        or entity_key in ('page:home', 'page:about', 'page:admissions', 'page:gallery', 'page:contact', 'page:events', 'page:competitions', 'page:results')
        or entity_key ~ '^(event|competition|candidate):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ),
    event_count bigint not null default 0 check (event_count >= 0),
    primary key (day, event_type, entity_key)
);

create table app.audit_logs (
    id uuid primary key default gen_random_uuid(),
    actor_id uuid not null references auth.users(id) on delete restrict,
    actor_role text not null check (actor_role in ('admin', 'super_admin', 'operator')),
    action text not null check (char_length(btrim(action)) between 1 and 100),
    target_type text not null check (char_length(btrim(target_type)) between 1 and 100),
    target_id uuid,
    recorded_at timestamptz not null default clock_timestamp(),
    reason text check (char_length(reason) <= 2000),
    details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object' and pg_column_size(details) <= 16384),
    correlation_id uuid not null default gen_random_uuid()
);

-- All tables are closed before this transaction commits. No policies exist.
alter table app.staff_roles enable row level security;
alter table app.media_assets enable row level security;
alter table app.school_pages enable row level security;
alter table app.events enable row level security;
alter table app.competitions enable row level security;
alter table app.candidates enable row level security;
alter table app.gallery_items enable row level security;
alter table app.competition_voters enable row level security;
alter table app.votes enable row level security;
alter table app.vote_adjustment_requests enable row level security;
alter table app.vote_adjustments enable row level security;
alter table app.result_publications enable row level security;
alter table app.result_rows enable row level security;
alter table app.enquiries enable row level security;
alter table app.analytics_daily enable row level security;
alter table app.audit_logs enable row level security;

revoke all on all tables in schema app from public, anon, authenticated, service_role;
revoke all on all sequences in schema app from public, anon, authenticated, service_role;
commit;
