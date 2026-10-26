// Synthetic public-view fixtures, never real school/student or privileged data.
// States are intentionally fixed so every demonstration remains inspectable.
export const competitions = [
  { slug: 'creative-voices', title: 'Creative voices', category: 'Expression & performance', status: 'active', symbol: '✺', tone: 'sage', description: 'A demonstration stage for stories, spoken word, and creative expression.', startsAt: '2026-11-07T09:00:00+05:30', endsAt: '2026-11-14T17:00:00+05:30', allowance: 3 },
  { slug: 'ideas-for-tomorrow', title: 'Ideas for tomorrow', category: 'Science & discovery', status: 'upcoming', symbol: '↗', tone: 'sand', description: 'An illustrative showcase of curiosity, experiments, and thoughtful ideas.', startsAt: '2026-11-21T09:00:00+05:30', endsAt: '2026-11-28T17:00:00+05:30', allowance: 2 },
  { slug: 'rhythm-and-motion', title: 'Rhythm & motion', category: 'Music & movement', status: 'closed', symbol: '♫', tone: 'rose', description: 'A sample performance showcase with voting closed and results awaiting publication.', startsAt: '2026-10-10T09:00:00+05:30', endsAt: '2026-10-17T17:00:00+05:30', allowance: 3 },
  { slug: 'colour-and-craft', title: 'Colour & craft', category: 'Art & imagination', status: 'published', symbol: '◈', tone: 'sand', description: 'A synthetic published-results example with two tied winners.', startsAt: '2026-10-01T09:00:00+05:30', endsAt: '2026-10-08T17:00:00+05:30', allowance: 2,
    publishedResult: { outcome: 'winners', show_vote_totals: true, show_rankings: true, rows: [{ candidateSlug: 'demo-candidate-01', label: 'Demo candidate 01', total: 12, rank: 1, winner: true, tied: true }, { candidateSlug: 'demo-candidate-02', label: 'Demo candidate 02', total: 12, rank: 1, winner: true, tied: true }, { candidateSlug: 'demo-candidate-03', label: 'Demo candidate 03', total: 5, rank: 2, winner: false, tied: false }] } },
  { slug: 'discovery-journal', title: 'Discovery journal', category: 'A no-votes example', status: 'published', symbol: '✧', tone: 'sage', description: 'A synthetic all-zero result: no winner is declared.', startsAt: '2026-09-01T09:00:00+05:30', endsAt: '2026-09-08T17:00:00+05:30', allowance: 1,
    publishedResult: { outcome: 'no_votes_received', show_vote_totals: false, show_rankings: false, rows: [] } },
];

export const candidates = ['01', '02', '03'].map((number, index) => ({
  slug: `demo-candidate-${number}`, name: `Demo candidate ${number}`, number, tone: ['sage', 'sand', 'rose'][index],
  introduction: 'This is a synthetic participant profile created to demonstrate the candidate experience. No real student is represented.',
  performance: ['A story in our own words', 'A little spark of imagination', 'A different point of view'][index],
  sampleVideoId: 'jNQXAC9IVRw', startSeconds: 3 + index * 2,
}));

export const events = [
  { slug: 'discovery-day', title: 'Discovery day', category: 'Explore & learn', date: '2026-11-07T09:00:00+05:30', day: '07', month: 'NOV', description: 'A sample day of hands-on learning and classroom discovery.', tone: 'sage' },
  { slug: 'creative-afternoon', title: 'A creative afternoon', category: 'Create & express', date: '2026-11-14T14:00:00+05:30', day: '14', month: 'NOV', description: 'An illustrative gathering for art, stories, and shared ideas.', tone: 'rose' },
  { slug: 'community-open-day', title: 'Community open day', category: 'Connect & discover', date: '2026-11-21T10:00:00+05:30', day: '21', month: 'NOV', description: 'A placeholder event for families to explore the school experience.', tone: 'sand' },
];

export const gallery = [
  { title: 'Spaces for discovery', caption: 'Campus illustration · placeholder', kind: 'campus', tone: 'sage' },
  { title: 'Ideas taking shape', caption: 'Creative learning · placeholder', symbol: '◈', tone: 'sand' },
  { title: 'Moments of expression', caption: 'Arts & performance · placeholder', symbol: '♫', tone: 'rose' },
  { title: 'Learning together', caption: 'Community · placeholder', symbol: '✺', tone: 'sage' },
];

export const competitionPath = (competition) => `/competitions/${competition.slug}`;
export const candidatePath = (competition, candidate) => `${competitionPath(competition)}/candidates/${candidate.slug}`;
