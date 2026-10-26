import { el, buttonLink, link } from '../utils/dom.js';
import { competitions, candidates, competitionPath } from '../data/demo.js';
import { pageHeading, notice, badge, competitionCard, candidateCard, portrait, emptyState } from '../components/shared.js';
import { schoolDate, youtubeUrl } from '../utils/format.js';
import { notFoundPage } from './information.js';

export function competitionsPage() {
  const grid = el('div', { class: 'grid grid-three' });
  const tabs = el('div', { class: 'filter-bar', role: 'group', 'aria-label': 'Filter demonstration competitions' });
  const count = el('p', { class: 'section-note', role: 'status', 'aria-live': 'polite' });
  const filter = (state) => {
    const visible = competitions.filter((c) => state === 'all' || c.status === state);
    grid.replaceChildren(...visible.map(competitionCard));
    count.textContent = `${visible.length} demonstration ${visible.length === 1 ? 'competition' : 'competitions'}`;
    for (const button of tabs.children) button.setAttribute('aria-pressed', String(button.dataset.state === state));
  };
  for (const [state, label] of [['all', 'All showcases'], ['active', 'Active'], ['upcoming', 'Upcoming'], ['closed', 'Closed'], ['published', 'Published']]) tabs.append(el('button', { type: 'button', class: 'filter-button', 'data-state': state, onClick: () => filter(state) }, label));
  filter('all');
  return el('div', { class: 'container page-content' }, pageHeading('A STAGE FOR EVERY SPARK', 'Let their talents shine.', 'Discover creative work, explore sample performances, and preview the future audience experience.'), notice('All competitions, participants, dates, and results are synthetic fixtures. States are fixed for demonstration; no voting is connected.'), tabs, count, grid);
}
function findCompetition(slug) { return competitions.find((competition) => competition.slug === slug); }
function breadcrumb(competition, last) {
  return el('nav', { class: 'breadcrumbs', 'aria-label': 'Breadcrumb' }, link('Competitions', '/competitions'), el('span', { 'aria-hidden': 'true' }, '/'), last ? link(competition.title, competitionPath(competition)) : el('span', { 'aria-current': 'page' }, competition.title), last ? el('span', { 'aria-hidden': 'true' }, '/') : null, last ? el('span', { 'aria-current': 'page' }, last) : null);
}
export function competitionPage(slug) {
  const competition = findCompetition(slug);
  if (!competition) return notFoundPage();
  return el('div', { class: 'container page-content' }, breadcrumb(competition), pageHeading(competition.category, competition.title, competition.description), badge(competition.status), notice('Demonstration competition. The displayed status is a fixed fixture, not a live voting window.'), el('dl', { class: 'competition-facts' }, el('div', {}, el('dt', {}, 'Sample voting opens'), el('dd', {}, schoolDate(competition.startsAt), ' · 09:00 IST')), el('div', {}, el('dt', {}, 'Sample voting closes'), el('dd', {}, schoolDate(competition.endsAt), ' · 17:00 IST')), el('div', {}, el('dt', {}, 'Planned allowance'), el('dd', {}, `${competition.allowance} votes, distinct candidates`))), el('div', { class: 'section-heading' }, el('h2', {}, 'Meet the creative voices'), buttonLink(competition.status === 'published' ? 'View sample results ↗' : 'Result publication status ↗', `${competitionPath(competition)}/results`, true)), el('div', { class: 'grid grid-three' }, candidates.map((candidate) => candidateCard(competition, candidate))), el('section', { class: 'panel rules-panel' }, el('h2', {}, 'How voting will work'), el('ul', {}, el('li', {}, 'Browse profiles and watch performance links without signing in.'), el('li', {}, 'Future voting will require a verified Indian (+91) mobile-authenticated identity.'), el('li', {}, `Up to ${competition.allowance} votes per voter, with one vote per distinct candidate.`), el('li', {}, 'Eligibility, timing, and remaining allowance will be enforced atomically by the trusted database.')), el('p', {}, 'No vote can be cast in this frontend prototype.')));
}
export function candidatePage(competitionSlug, candidateSlug) {
  const competition = findCompetition(competitionSlug);
  const candidate = candidates.find((entry) => entry.slug === candidateSlug);
  if (!competition || !candidate) return notFoundPage();
  return el('div', { class: 'container page-content' }, breadcrumb(competition, candidate.name), el('div', { class: 'candidate-layout' }, el('div', {}, portrait(candidate, true), el('p', { class: 'section-note' }, 'Abstract photo placeholder. No real student is depicted.')), el('div', {}, pageHeading('SYNTHETIC PARTICIPANT', candidate.name, candidate.introduction), badge(competition.status), el('section', { class: 'panel' }, el('h2', {}, candidate.performance), el('p', {}, 'Performance video mapping will connect approved school videos in a later phase.'), el('p', {}, 'The link below opens a public YouTube sample (“Me at the zoo”) to demonstrate timestamp construction. It is unrelated to the school or this candidate.'), el('a', { href: youtubeUrl(candidate.sampleVideoId, candidate.startSeconds), target: '_blank', rel: 'noopener noreferrer', class: 'button button-secondary' }, `Open unrelated sample at ${candidate.startSeconds}s ↗`)), el('section', { class: 'panel voting-panel', 'aria-labelledby': 'vote-heading' }, el('h2', { id: 'vote-heading' }, 'Support a creative voice'), el('p', { id: 'vote-description' }, 'Voting preview only. Mobile verification, remaining allowance, and vote submission are not connected.'), el('button', { type: 'button', class: 'button', disabled: true, 'aria-describedby': 'vote-description' }, 'Voting unavailable · demo'), el('p', { class: 'section-note' }, `Planned maximum: ${competition.allowance} votes per voter across distinct candidates. No votes are stored.`)))));
}
export function resultsPage(slug) {
  const competition = findCompetition(slug);
  if (!competition) return notFoundPage();
  const content = el('div', { class: 'container page-content' }, breadcrumb(competition, 'Results'), pageHeading('THE SHOWCASE OUTCOME', `${competition.title}: results`, 'Synthetic examples of how authorized result publication will appear.'), notice('Demonstration only. No real votes or results are represented. Frontend fixtures do not implement backend access controls.'));
  if (competition.status !== 'published') {
    content.append(emptyState('Results not published', 'No public totals, rankings, or winner labels are available. Results will appear here only after authorized publication.'));
    return content;
  }
  const result = competition.publishedResult;
  if (result.outcome === 'no_votes_received') content.append(emptyState('No votes received', 'Every eligible candidate has a zero official total in this synthetic example. No winner is declared.'));
  else {
    content.append(el('p', { class: 'published-note' }, 'Sample published snapshot · two tied winners'));
    const head = el('tr', {}, el('th', { scope: 'col' }, 'Candidate'), el('th', { scope: 'col' }, 'Outcome'));
    if (result.show_vote_totals) head.append(el('th', { scope: 'col' }, 'Official total'));
    if (result.show_rankings) head.append(el('th', { scope: 'col' }, 'Rank'));
    const rows = result.rows.map((row) => {
      const tr = el('tr', {}, el('th', { scope: 'row' }, link(row.label, `${competitionPath(competition)}/candidates/${row.candidateSlug}`)), el('td', {}, row.winner ? (row.tied ? 'Tied winner' : 'Winner') : 'Participant'));
      if (result.show_vote_totals) tr.append(el('td', {}, row.total));
      if (result.show_rankings) tr.append(el('td', {}, row.rank));
      return tr;
    });
    content.append(el('div', { class: 'table-scroll' }, el('table', {}, el('caption', {}, 'Synthetic published results · not real voting data'), el('thead', {}, head), el('tbody', {}, rows))));
  }
  content.append(el('p', { class: 'section-note' }, 'Published outcome labels are public. Numeric totals and rankings will respect their separate backend visibility settings.'));
  return content;
}
