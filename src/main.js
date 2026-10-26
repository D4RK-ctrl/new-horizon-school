import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import { el } from './utils/dom.js';
import { startRouter } from './router/index.js';
import { header, footer } from './components/layout.js';
import { homePage } from './pages/home.js';
import { aboutPage, admissionsPage, galleryPage, contactPage, eventsPage, notFoundPage } from './pages/information.js';
import { competitionsPage, competitionPage, candidatePage, resultsPage } from './pages/competitions.js';
import { loginPage, adminPage } from './pages/admin.js';

const pages = { home: homePage, about: aboutPage, admissions: admissionsPage, gallery: galleryPage, contact: contactPage, events: eventsPage, competitions: competitionsPage, login: loginPage, admin: () => adminPage(), 'super-admin': () => adminPage(true), 'not-found': notFoundPage };

startRouter(({ name, params }) => {
  const app = document.querySelector('#app');
  try {
    let page;
    if (name === 'competition') page = competitionPage(params.slug);
    else if (name === 'candidate') page = candidatePage(params.competitionSlug, params.candidateSlug);
    else if (name === 'results') page = resultsPage(params.slug);
    else page = (pages[name] ?? notFoundPage)();
    const demoBar = el('div', { class: 'demo-bar' }, el('div', { class: 'container' }, el('span', {}, 'DESIGN PROTOTYPE'), el('span', {}, 'Illustrative content only · No live services')));
    app.replaceChildren(demoBar, header(location.pathname.replace(/\/$/, '') || '/'), el('main', { id: 'main', tabindex: '-1' }, page), footer());
    document.title = `${page.querySelector('h1')?.textContent ?? 'Page'} · New Horizon School Prototype`;
  } catch (error) {
    console.error('Page rendering failed', error);
    app.replaceChildren(header(location.pathname), el('main', { id: 'main' }, el('div', { class: 'container page-content' }, el('h1', { tabindex: '-1' }, 'This page could not load'), el('p', {}, 'Please refresh the page or return home.'), el('a', { href: '/' }, 'Return home'))), footer());
  }
});
