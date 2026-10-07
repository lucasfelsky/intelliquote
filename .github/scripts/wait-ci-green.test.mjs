import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRuns, isContainedStatus, parseArgs } from './wait-ci-green.mjs';

const REPO = 'lucasfelsky/intelliquote';
const REQUIRED = ['Unit + Build', 'E2E (Playwright)'];
const ctx = { requiredJobs: REQUIRED, repo: REPO, branch: 'main' };

const mkRun = (over = {}) => ({
  id: 1,
  run_attempt: 1,
  event: 'push',
  head_branch: 'main',
  head_repository: { full_name: REPO },
  status: 'completed',
  conclusion: 'success',
  html_url: 'https://example.test/run/1',
  ...over,
});
const okJobs = () => [
  { name: 'Unit + Build', status: 'completed', conclusion: 'success' },
  { name: 'E2E (Playwright)', status: 'completed', conclusion: 'success' },
];

test('(a) run success com os 2 jobs success -> success', () => {
  const r = evaluateRuns([{ run: mkRun(), jobs: okJobs() }], ctx);
  assert.equal(r.state, 'success');
  assert.equal(r.passed.id, 1);
});

test('(b) attempt 1 falho + latest success (re-run) -> success', () => {
  const r = evaluateRuns([{ run: mkRun({ run_attempt: 2 }), jobs: okJobs() }], ctx);
  assert.equal(r.state, 'success');
  assert.equal(r.passed.attempt, 2);
});

test('(c) um run cancelled e outro success -> success', () => {
  const r = evaluateRuns(
    [
      { run: mkRun({ id: 1, conclusion: 'cancelled' }), jobs: [] },
      { run: mkRun({ id: 2 }), jobs: okJobs() },
    ],
    ctx,
  );
  assert.equal(r.state, 'success');
  assert.equal(r.passed.id, 2);
});

test('(d) unico run cancelled -> failure com hint rerun', () => {
  const r = evaluateRuns(
    [{ run: mkRun({ id: 37653952544, conclusion: 'cancelled' }), jobs: [] }],
    ctx,
  );
  assert.equal(r.state, 'failure');
  assert.match(r.message, /gh run rerun 37653952544/);
  assert.match(r.message, /37653952544/);
});

test('(e) run queued sem jobs -> pending', () => {
  const r = evaluateRuns(
    [{ run: mkRun({ status: 'queued', conclusion: null }), jobs: [] }],
    ctx,
  );
  assert.equal(r.state, 'pending');
});

test('(f) run success mas job E2E ausente -> failure citando o nome', () => {
  const r = evaluateRuns(
    [{ run: mkRun(), jobs: [okJobs()[0]] }],
    ctx,
  );
  assert.equal(r.state, 'failure');
  assert.match(r.message, /E2E \(Playwright\)/);
});

test('(f2) job exigido com failure -> failure com --failed', () => {
  const jobs = okJobs();
  jobs[0].conclusion = 'failure';
  const r = evaluateRuns([{ run: mkRun({ conclusion: 'failure' }), jobs }], ctx);
  assert.equal(r.state, 'failure');
  assert.match(r.message, /--failed/);
});

test('(g) lista vazia -> none', () => {
  assert.equal(evaluateRuns([], ctx).state, 'none');
});

test('(h) run de pull_request ou de outro repo e ignorado -> none', () => {
  const r = evaluateRuns(
    [
      { run: mkRun({ event: 'pull_request' }), jobs: okJobs() },
      { run: mkRun({ head_repository: { full_name: 'fork/intelliquote' } }), jobs: okJobs() },
      { run: mkRun({ head_branch: 'feat/x' }), jobs: okJobs() },
    ],
    ctx,
  );
  assert.equal(r.state, 'none');
});

test('(i) isContainedStatus', () => {
  assert.equal(isContainedStatus('identical'), true);
  assert.equal(isContainedStatus('ahead'), true);
  assert.equal(isContainedStatus('diverged'), false);
  assert.equal(isContainedStatus('behind'), false);
});

test('(j) parseArgs: CSV com espacos/parenteses e defaults', () => {
  const o = parseArgs(
    ['--sha', 'abc', '--required-jobs', ' Unit + Build , E2E (Playwright) '],
    { GITHUB_REPOSITORY: REPO },
  );
  assert.deepEqual(o.requiredJobs, REQUIRED);
  assert.equal(o.repo, REPO);
  assert.equal(o.workflow, 'ci.yml');
  assert.equal(o.branch, 'main');
  assert.equal(o.timeoutSec, 1500);
  assert.equal(o.noRunGraceSec, 300);
  assert.equal(o.intervalSec, 30);
});

test('(j2) parseArgs: sha obrigatorio e flag desconhecida', () => {
  assert.throws(() => parseArgs([], { GITHUB_REPOSITORY: REPO }), /--sha/);
  assert.throws(() => parseArgs(['--x', '1'], { GITHUB_REPOSITORY: REPO }), /desconhecido/);
});
