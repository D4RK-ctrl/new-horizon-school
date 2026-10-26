import test from 'node:test';
import assert from 'node:assert/strict';
import { matchRoute } from '../src/router/routes.js';
import { statusLabel, youtubeUrl, schoolDate } from '../src/utils/format.js';
import { competitions, candidates, competitionPath, candidatePath } from '../src/data/demo.js';

test('all approved static routes match directly', () => {
  for (const [path, name] of [['/', 'home'], ['/about', 'about'], ['/admissions', 'admissions'], ['/gallery', 'gallery'], ['/contact', 'contact'], ['/events', 'events'], ['/competitions', 'competitions'], ['/admin/login', 'login'], ['/admin', 'admin'], ['/super-admin', 'super-admin']]) assert.equal(matchRoute(path).name, name);
});
test('deep routes decode validated parameters and optional trailing slash', () => {
  assert.deepEqual(matchRoute('/competitions/%63reative-voices/'), { name: 'competition', params: { slug: 'creative-voices' } });
  assert.deepEqual(matchRoute('/competitions/creative-voices/candidates/demo-candidate-01'), { name: 'candidate', params: { competitionSlug: 'creative-voices', candidateSlug: 'demo-candidate-01' } });
  assert.deepEqual(matchRoute('/competitions/creative-voices/results'), { name: 'results', params: { slug: 'creative-voices' } });
});
test('unknown routes and malformed or unsafe parameters do not match', () => {
  for (const path of ['/missing', '/admin/users', '/competitions/a/extra', '/competitions/a/candidates', '/competitions/%', '/competitions/%2fadmin', '/competitions/%2e%2e', '/competitions/%3Cscript%3E', '/competitions/a//', '//', '', null, '/competitions/a?x=y', '/about#fragment']) assert.equal(matchRoute(path).name, 'not-found', String(path));
});
test('every fixture link resolves to a real fixture and expected route', () => {
  assert.equal(new Set(competitions.map((c) => c.slug)).size, competitions.length);
  assert.equal(new Set(candidates.map((c) => c.slug)).size, candidates.length);
  for (const competition of competitions) {
    assert.equal(matchRoute(competitionPath(competition)).params.slug, competition.slug);
    assert.equal(matchRoute(`${competitionPath(competition)}/results`).name, 'results');
    for (const candidate of candidates) assert.equal(matchRoute(candidatePath(competition, candidate)).params.candidateSlug, candidate.slug);
  }
});
test('all competition demonstration states format explicitly; unknown state is safe', () => {
  assert.deepEqual(['upcoming', 'active', 'closed', 'published'].map(statusLabel), ['Upcoming', 'Voting open · demo', 'Voting closed', 'Results published']);
  assert.equal(statusLabel('invented'), 'Status unavailable');
  assert.equal(statusLabel('toString'), 'Status unavailable');
});
test('YouTube links use the trusted host and explicit start seconds', () => {
  assert.equal(youtubeUrl('jNQXAC9IVRw', 3), 'https://www.youtube.com/watch?v=jNQXAC9IVRw&t=3s');
  assert.equal(new URL(youtubeUrl('jNQXAC9IVRw')).searchParams.get('t'), '0s');
  for (const id of ['https://evil.example', '<script>', '', null]) assert.throws(() => youtubeUrl(id), TypeError);
  for (const seconds of [-1, 1.2, '3', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => youtubeUrl('jNQXAC9IVRw', seconds), TypeError);
});
test('dates display the school timezone even across a UTC date boundary', () => {
  assert.match(schoolDate('2026-11-06T20:00:00Z'), /7 Nov 2026/);
});
test('published fixtures contain only intended public synthetic outcomes', () => {
  for (const competition of competitions) {
    if (competition.status !== 'published') {
      assert.equal(competition.publishedResult, undefined);
      continue;
    }
    const result = competition.publishedResult;
    if (result.outcome === 'no_votes_received') {
      assert.deepEqual(result.rows, []); // No hidden totals/ranks are shipped for this fixture.
    } else {
      assert.ok(result.rows.filter((r) => r.winner).length > 1);
      for (const row of result.rows) {
        assert.ok(candidates.some((c) => c.slug === row.candidateSlug));
        if (row.winner) assert.ok(row.total > 0);
        if (row.tied) assert.equal(row.winner, true);
      }
    }
  }
});
