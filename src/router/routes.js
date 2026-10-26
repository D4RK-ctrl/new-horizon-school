const staticRoutes = new Map([
  ['/', 'home'], ['/about', 'about'], ['/admissions', 'admissions'], ['/gallery', 'gallery'], ['/contact', 'contact'],
  ['/events', 'events'], ['/competitions', 'competitions'], ['/admin/login', 'login'], ['/admin', 'admin'], ['/super-admin', 'super-admin'],
]);

export function matchRoute(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/') || pathname.includes('?') || pathname.includes('#')) return { name: 'not-found', params: {} };
  let parts;
  try { parts = pathname.split('/').slice(1).map(decodeURIComponent); } catch { return { name: 'not-found', params: {} }; }
  if (parts.at(-1) === '') parts.pop();
  if (parts.some((part) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(part))) return { name: 'not-found', params: {} };
  const normalized = `/${parts.join('/')}`;
  if (staticRoutes.has(normalized)) return { name: staticRoutes.get(normalized), params: {} };
  if (parts[0] === 'competitions') {
    if (parts.length === 2) return { name: 'competition', params: { slug: parts[1] } };
    if (parts.length === 3 && parts[2] === 'results') return { name: 'results', params: { slug: parts[1] } };
    if (parts.length === 4 && parts[2] === 'candidates') return { name: 'candidate', params: { competitionSlug: parts[1], candidateSlug: parts[3] } };
  }
  return { name: 'not-found', params: {} };
}
