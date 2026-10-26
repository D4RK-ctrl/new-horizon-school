import { el, link, buttonLink } from '../utils/dom.js';

const navItems = [['Home', '/'], ['About', '/about'], ['Admissions', '/admissions'], ['Gallery', '/gallery'], ['Events', '/events'], ['Competitions', '/competitions'], ['Contact', '/contact']];
export function header(pathname) {
  const nav = el('nav', { id: 'primary-navigation', class: 'primary-navigation', 'aria-label': 'Main navigation' }, navItems.map(([label, href]) => link(label, href)));
  for (const anchor of nav.querySelectorAll('a')) {
    const href = anchor.getAttribute('href');
    if (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)) anchor.setAttribute('aria-current', 'page');
  }
  const toggle = el('button', { class: 'menu-toggle', type: 'button', 'aria-expanded': 'false', 'aria-controls': nav.id }, 'Menu', el('span', { 'aria-hidden': 'true' }, '☰'));
  const close = () => { toggle.setAttribute('aria-expanded', 'false'); nav.classList.remove('is-open'); };
  toggle.addEventListener('click', () => { const open = toggle.getAttribute('aria-expanded') !== 'true'; toggle.setAttribute('aria-expanded', String(open)); nav.classList.toggle('is-open', open); });
  const node = el('header', { class: 'site-header' }, el('div', { class: 'container header-inner' }, linkBrand(), toggle, nav));
  node.addEventListener('keydown', (event) => { if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') { close(); toggle.focus(); } });
  node.addEventListener('focusout', (event) => { if (!node.contains(event.relatedTarget)) close(); });
  return node;
}
function linkBrand() {
  return el('a', { href: '/', class: 'brand', 'aria-label': 'New Horizon School, prototype home' }, el('img', { src: '/favicon.svg', alt: '', width: '42', height: '42' }), el('span', {}, el('strong', {}, 'New Horizon'), el('span', {}, 'SCHOOL · DESIGN PROTOTYPE')));
}
export function footer() {
  return el('footer', { class: 'site-footer' }, el('div', { class: 'container footer-grid' }, el('div', {}, linkBrand(), el('p', {}, 'A space to learn. A place to grow.'), el('p', { class: 'footer-note' }, 'Illustrative design direction. School branding and information await approval.')), el('div', {}, el('h2', {}, 'Explore'), link('About the school', '/about'), link('Admissions', '/admissions'), link('Events & experiences', '/events')), el('div', {}, el('h2', {}, 'Stay connected'), el('p', {}, 'Address: awaiting school confirmation'), el('p', {}, 'Phone & email: not provided'), link('Contact information ↗', '/contact')), el('div', {}, el('h2', {}, 'Prototype workspace'), link('Admin layout', '/admin'), link('Super Admin layout', '/super-admin'), link('Staff sign-in preview', '/admin/login'))), el('div', { class: 'container footer-bottom' }, el('span', {}, 'New Horizon School · Phase 1 demonstration'), el('span', {}, 'Synthetic content. No personal data collected.')));
}
export const admissionsCTA = () => el('section', { class: 'admissions-cta container' }, el('div', {}, el('p', { class: 'eyebrow' }, 'THE NEXT CHAPTER'), el('h2', {}, 'Every journey begins with curiosity.'), el('p', {}, 'Explore the admissions experience. Official dates and criteria will be added after school approval.')), buttonLink('Explore admissions ↗', '/admissions'));
