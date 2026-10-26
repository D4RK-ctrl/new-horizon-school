import { el, link } from '../utils/dom.js';
import { statusLabel, schoolDate } from '../utils/format.js';
import { competitionPath, candidatePath } from '../data/demo.js';

export const eyebrow = (text) => el('p', { class: 'eyebrow' }, text);
export const badge = (status) => el('span', { class: `badge badge-${status}` }, statusLabel(status));
export const notice = (text = 'Frontend demonstration only. All content is synthetic; no real voting, applications, or enquiries are accepted.') => el('div', { class: 'notice' }, el('span', { class: 'notice-mark', 'aria-hidden': 'true' }, 'i'), el('p', {}, text));
export const emptyState = (title, description) => el('div', { class: 'empty-state' }, el('span', { 'aria-hidden': 'true', class: 'empty-symbol' }, '◇'), el('h2', {}, title), el('p', {}, description));
export function pageHeading(kicker, title, description) {
  return el('div', { class: 'page-heading' }, eyebrow(kicker), el('h1', { tabindex: '-1' }, title), el('p', { class: 'lead' }, description));
}
export function sectionHeading(kicker, title, href, label = 'Explore more') {
  return el('div', { class: 'section-heading' }, el('div', {}, eyebrow(kicker), el('h2', {}, title)), href ? link(`${label} ↗`, href, 'text-link') : null);
}
export function competitionCard(competition) {
  return el('article', { class: 'card competition-card' },
    el('div', { class: `card-art tone-${competition.tone}`, 'aria-hidden': 'true' }, el('span', {}, competition.symbol), el('span', { class: 'art-caption' }, 'DEMO SHOWCASE')),
    el('div', { class: 'card-body' }, badge(competition.status), el('p', { class: 'card-category' }, competition.category), el('h3', {}, link(competition.title, competitionPath(competition))), el('p', {}, competition.description), el('div', { class: 'card-foot' }, el('span', {}, `${competition.allowance} votes per voter · planned`), link('Explore ↗', competitionPath(competition), 'text-link'))));
}
export function eventCard(event) {
  return el('article', { class: 'event-card' }, el('div', { class: `event-date tone-${event.tone}`, 'aria-hidden': 'true' }, el('strong', {}, event.day), el('span', {}, event.month)), el('div', {}, el('p', { class: 'card-category' }, event.category), el('h3', {}, event.title), el('time', { datetime: event.date }, schoolDate(event.date)), el('p', {}, event.description)), el('span', { class: 'small-label' }, 'Sample event'));
}
export function portrait(candidate, large = false) {
  return el('div', { class: `portrait tone-${candidate.tone}${large ? ' portrait-large' : ''}`, role: 'img', 'aria-label': 'Abstract photo placeholder; no real student depicted' }, el('span', { class: 'portrait-shape', 'aria-hidden': 'true' }), el('span', { class: 'art-caption' }, 'PHOTO PLACEHOLDER'));
}
export function candidateCard(competition, candidate) {
  return el('article', { class: 'card' }, portrait(candidate), el('div', { class: 'card-body' }, el('p', { class: 'card-category' }, 'Synthetic participant'), el('h3', {}, link(candidate.name, candidatePath(competition, candidate))), el('p', {}, candidate.performance), link('Meet the candidate ↗', candidatePath(competition, candidate), 'text-link')));
}
export function galleryTile(item) {
  return el('figure', { class: 'gallery-tile' }, item.kind === 'campus'
    ? el('img', { src: '/images/campus.svg', alt: 'Illustrated school building; placeholder, not a real campus', width: '720', height: '600', loading: 'lazy' })
    : el('div', { class: `gallery-art tone-${item.tone}`, role: 'img', 'aria-label': `Abstract ${item.title.toLowerCase()} placeholder` }, el('span', { 'aria-hidden': 'true' }, item.symbol)), el('figcaption', {}, el('strong', {}, item.title), el('span', {}, item.caption)));
}
