import { el, link, buttonLink } from '../utils/dom.js';
import { pageHeading, notice, emptyState } from '../components/shared.js';

const adminSections = ['Overview', 'Competitions', 'Candidates', 'Events', 'Gallery / Media', 'School Content', 'Enquiries', 'Analytics', 'Results'];
const superSections = ['Administrator Management', 'Vote Adjustments', 'Confidential Audit Logs'];
const sectionKey = (section) => section.toLowerCase().replaceAll(' / ', '-').replaceAll(' ', '-');

export function loginPage() {
  return el('div', { class: 'container page-content login-layout' }, pageHeading('STAFF WORKSPACE · PREVIEW', 'Welcome to the workspace.', 'An interface preview for future school administration.'), notice('Authentication is not implemented. These demo pages are public and unsecured. Do not enter real credentials.'), el('form', { class: 'panel', onSubmit: (event) => event.preventDefault() }, el('fieldset', { disabled: true }, el('legend', {}, 'Sign-in preview · not connected'), el('label', { for: 'staff-email' }, 'Staff email'), el('input', { id: 'staff-email', type: 'email', placeholder: 'Not connected', autocomplete: 'off' }), el('label', { for: 'staff-password' }, 'Password'), el('input', { id: 'staff-password', type: 'password', placeholder: 'Do not enter credentials', autocomplete: 'off' }), el('button', { class: 'button', type: 'submit', disabled: true }, 'Sign-in unavailable'))), buttonLink('Explore the public demo dashboard ↗', '/admin', true));
}
export function adminPage(superAdmin = false) {
  const base = superAdmin ? '/super-admin' : '/admin';
  const sections = superAdmin ? [...adminSections, ...superSections] : adminSections;
  const requested = new URLSearchParams(location.search).get('section') || 'overview';
  const selected = sections.find((section) => sectionKey(section) === requested) ?? 'Overview';
  const nav = el('nav', { class: 'workspace-nav', 'aria-label': superAdmin ? 'Super Admin demo sections' : 'Admin demo sections' }, sections.map((section) => {
    const anchor = link(section, `${base}?section=${sectionKey(section)}`);
    if (section === selected) anchor.setAttribute('aria-current', 'page');
    return anchor;
  }));
  const panel = selected === 'Overview'
    ? el('div', {}, el('div', { class: 'grid grid-three workspace-stats' }, ['Content workspace', 'Competition workspace', 'Community insights'].map((title) => el('article', { class: 'panel' }, el('span', { class: 'small-label' }, 'LAYOUT PREVIEW'), el('h2', {}, title), el('p', {}, 'Not connected · no live data')))), el('section', { class: 'panel' }, el('h2', {}, 'A thoughtful home for school life'), el('p', {}, 'Use the section navigation to inspect the planned workspace. Content management, results, and analytics will be connected only in their authorized phases.'), el('button', { type: 'button', class: 'button', disabled: true }, 'Administrative actions unavailable')))
    : el('div', {}, emptyState(`${selected} · layout preview`, superSections.includes(selected) ? 'No administrator identities, adjustment records, or confidential logs are loaded. Future access requires trusted Super Admin authorization.' : 'No live records are loaded. This section is a navigation and layout placeholder.'), el('button', { class: 'button', type: 'button', disabled: true }, `${selected === 'Vote Adjustments' ? 'Apply adjustment' : 'Manage records'} unavailable`));
  return el('div', { class: 'container page-content' }, pageHeading('DEVELOPMENT WORKSPACE', superAdmin ? 'Super Admin preview' : 'Admin preview', 'A foundation for future school operations.'), notice('Public, unsecured demo layout. No authentication or authorization exists here yet. All administrative mutations are disabled and no privileged data is present.'), el('div', { class: 'workspace-layout' }, el('aside', {}, el('p', { class: 'eyebrow' }, 'WORKSPACE'), nav, link(superAdmin ? 'Admin preview ↗' : 'Super Admin preview ↗', superAdmin ? '/admin' : '/super-admin', 'text-link')), el('section', { class: 'workspace-content', 'aria-label': selected }, el('h2', { class: 'workspace-title' }, selected), panel)));
}
