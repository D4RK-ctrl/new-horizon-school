import { matchRoute } from './routes.js';

export function startRouter(render) {
  const show = (focus = true) => {
    render(matchRoute(location.pathname));
    if (focus) {
      document.querySelector('h1')?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  };
  document.addEventListener('click', (event) => {
    const anchor = event.target.closest('a[href]');
    if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || anchor.hasAttribute('download') || anchor.target || anchor.getAttribute('href').startsWith('#')) return;
    const url = new URL(anchor.href);
    if (url.origin !== location.origin || url.hash) return;
    event.preventDefault();
    if (url.href !== location.href) history.pushState({}, '', url);
    show();
  });
  window.addEventListener('popstate', () => show());
  show(false);
}
