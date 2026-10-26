import { el, link, buttonLink } from '../utils/dom.js';
import { competitions, events, gallery } from '../data/demo.js';
import { eyebrow, sectionHeading, competitionCard, eventCard, galleryTile } from '../components/shared.js';
import { admissionsCTA } from '../components/layout.js';

export function homePage() {
  return el('div', {},
    el('section', { class: 'hero container' },
      el('div', { class: 'hero-copy' }, eyebrow('A WORLD OF POSSIBILITIES'), el('h1', { tabindex: '-1' }, 'Small discoveries.', el('br'), 'Bright ', el('em', {}, 'futures.')), el('p', { class: 'lead' }, 'A school experience shaped around curiosity, creativity, and the joy of learning together.'), el('div', { class: 'button-row' }, buttonLink('Discover our school ↗', '/about'), buttonLink('Explore competitions', '/competitions', true)), el('div', { class: 'hero-note' }, el('span', { class: 'small-star', 'aria-hidden': 'true' }, '✧'), el('p', {}, 'An invitation to imagine what comes next.', el('span', {}, 'Illustrative copy · not an official school statement')))),
      el('figure', { class: 'hero-visual' }, el('div', { class: 'image-stamp' }, 'LEARN', el('span', { 'aria-hidden': 'true' }, '✺'), 'GROW'), el('img', { src: '/images/campus.svg', alt: 'Geometric illustration of a welcoming school building; not an actual campus', width: '720', height: '600', fetchpriority: 'high' }), el('figcaption', {}, el('span', {}, 'A place for possibility'), el('span', {}, 'Campus illustration · placeholder')))),
    el('div', { class: 'values-strip' }, el('div', { class: 'container' }, ['Curiosity in every classroom', 'Confidence through expression', 'Community at the heart'].map((text) => el('p', {}, el('span', { 'aria-hidden': 'true' }, '✦'), text)))),
    el('section', { class: 'section container overview' }, el('div', {}, eyebrow('MORE THAN A CLASSROOM'), el('h2', {}, 'Room to discover.', el('br'), 'Space to become.')), el('div', {}, el('p', { class: 'lead' }, 'Learning comes alive when there is space to ask, to explore, and to try something new.'), el('p', {}, 'This prototype brings school life, creative showcases, and family information into one welcoming place. The learning approach shown here is illustrative and awaits school approval.'), link('Get to know the school ↗', '/about', 'text-link'))),
    el('section', { class: 'section section-tinted' }, el('div', { class: 'container' }, sectionHeading('THE POSSIBILITIES', 'Growing in every direction'), el('div', { class: 'grid grid-three highlights' }, [
      ['01', 'A curious mind', 'Placeholder for school-approved academic highlights and learning opportunities.'],
      ['02', 'A creative voice', 'Space for future achievements in art, music, expression, and discovery.'],
      ['03', 'A shared journey', 'A place for approved stories of community, collaboration, and belonging.'],
    ].map(([number, title, copy]) => el('article', {}, el('span', { class: 'highlight-number' }, number), el('h3', {}, title), el('p', {}, copy)))), el('p', { class: 'section-note' }, 'Highlights are content placeholders. No awards, rankings, or achievements are claimed.'))),
    el('section', { class: 'section container' }, sectionHeading('STEP INTO SCHOOL LIFE', 'Good things on the horizon', '/events', 'All events'), el('div', { class: 'grid grid-three' }, events.map(eventCard))),
    el('section', { class: 'section container competitions-section' }, sectionHeading('A STAGE FOR EVERY SPARK', 'Discover. Express. Celebrate.', '/competitions', 'All competitions'), el('p', { class: 'section-intro' }, 'Explore our synthetic competition showcases. Voting controls are demonstration-only.'), el('div', { class: 'grid grid-two' }, competitions.slice(0, 2).map(competitionCard))),
    admissionsCTA(),
    el('section', { class: 'section container' }, sectionHeading('LITTLE MOMENTS, BIG MEMORIES', 'A glimpse of school life', '/gallery', 'View gallery'), el('div', { class: 'grid grid-three gallery-preview' }, gallery.slice(0, 3).map(galleryTile))));
}
