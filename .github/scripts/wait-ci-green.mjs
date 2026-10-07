#!/usr/bin/env node
// Gate de deploy: so libera se o commit estiver contido na main e tiver um run
// do workflow de CI (evento push, branch main) concluido com sucesso, com todos
// os jobs exigidos = success. Espera com polling ate um teto se o CI ainda roda.
//
// Zero dependencias (so fetch/node:test/node:assert). Saidas:
//   0 = verde | 1 = vermelho/ausente/timeout/fora da main | 2 = uso/config.
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const DEFAULT_REQUIRED_JOBS = ['Unit + Build', 'E2E (Playwright)'];

const PENDING_STATUSES_DESC = 'queued/in_progress/waiting/requested/pending';

export function parseArgs(argv, env = process.env) {
  const opts = {
    repo: env.GITHUB_REPOSITORY || '',
    sha: '',
    workflow: 'ci.yml',
    branch: 'main',
    requiredJobs: [...DEFAULT_REQUIRED_JOBS],
    timeoutSec: 1500,
    noRunGraceSec: 300,
    intervalSec: 30,
  };
  const known = new Set([
    '--repo',
    '--sha',
    '--workflow',
    '--branch',
    '--required-jobs',
    '--timeout-sec',
    '--no-run-grace-sec',
    '--interval-sec',
  ]);
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!known.has(flag)) throw new Error(`Argumento desconhecido: ${flag}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Valor ausente para ${flag}`);
    }
    i += 1;
    switch (flag) {
      case '--repo':
        opts.repo = value;
        break;
      case '--sha':
        opts.sha = value;
        break;
      case '--workflow':
        opts.workflow = value;
        break;
      case '--branch':
        opts.branch = value;
        break;
      case '--required-jobs':
        opts.requiredJobs = value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      default: {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0) {
          throw new Error(`Valor numerico invalido para ${flag}: ${value}`);
        }
        if (flag === '--timeout-sec') opts.timeoutSec = n;
        else if (flag === '--no-run-grace-sec') opts.noRunGraceSec = n;
        else opts.intervalSec = n;
      }
    }
  }
  if (!opts.sha) throw new Error('--sha e obrigatorio');
  if (!opts.repo) throw new Error('--repo ou GITHUB_REPOSITORY e obrigatorio');
  if (opts.requiredJobs.length === 0) throw new Error('--required-jobs vazio');
  return opts;
}

export function isContainedStatus(status) {
  return status === 'identical' || status === 'ahead';
}

// runs: [{ run, jobs }] onde run e o objeto da API (workflow run) e jobs e a
// lista `jobs` de `filter=latest`. Retorna { state, passed?, details }.
export function evaluateRuns(entries, { requiredJobs, repo, branch = 'main' }) {
  const qualified = (entries || []).filter(({ run }) => {
    if (!run) return false;
    if (run.event !== 'push') return false;
    if (run.head_branch !== branch) return false;
    const full = run.head_repository && run.head_repository.full_name;
    return !repo || (full || '').toLowerCase() === repo.toLowerCase();
  });

  if (qualified.length === 0) {
    return {
      state: 'none',
      details: [],
      message: `Nenhum run qualificado (evento push, branch ${branch}) do CI para este commit.`,
    };
  }

  const details = [];
  let passed = null;
  let pendingRuns = [];
  for (const { run, jobs } of qualified) {
    const jobList = jobs || [];
    const missing = [];
    const notSuccess = [];
    for (const name of requiredJobs) {
      const job = jobList.find((j) => j.name === name);
      if (!job) missing.push(name);
      else if (job.conclusion !== 'success') {
        notSuccess.push(`${name}=${job.conclusion || job.status}`);
      }
    }
    const info = {
      id: run.id,
      attempt: run.run_attempt,
      status: run.status,
      conclusion: run.conclusion,
      url: run.html_url,
      missing,
      notSuccess,
    };
    details.push(info);
    if (
      run.status === 'completed' &&
      run.conclusion === 'success' &&
      missing.length === 0 &&
      notSuccess.length === 0
    ) {
      if (!passed) passed = info;
    } else if (run.status !== 'completed') {
      pendingRuns.push(info);
    }
  }

  if (passed) {
    return { state: 'success', passed, details, message: `CI verde no run ${passed.id}.` };
  }
  if (pendingRuns.length > 0) {
    return {
      state: 'pending',
      details,
      pendingRuns,
      message: `CI ainda em andamento (${PENDING_STATUSES_DESC}): ${pendingRuns
        .map((r) => `${r.id} ${r.status} ${r.url}`)
        .join('; ')}`,
    };
  }
  const lines = details.map((d) => {
    const extra = [];
    if (d.missing.length) extra.push(`job(s) exigido(s) ausente(s): ${d.missing.join(', ')}`);
    if (d.notSuccess.length) extra.push(`job(s) sem sucesso: ${d.notSuccess.join(', ')}`);
    return `  - run ${d.id} (attempt ${d.attempt}) ${d.status}/${d.conclusion} ${d.url}${
      extra.length ? ` [${extra.join('; ')}]` : ''
    }`;
  });
  const first = details[0];
  const hint = details.some((d) => d.conclusion === 'cancelled')
    ? `gh run rerun ${first.id}`
    : `gh run rerun ${first.id} --failed`;
  return {
    state: 'failure',
    details,
    message:
      `CI nao esta verde para este commit:\n${lines.join('\n')}\n` +
      `Corrija/re-execute o CI (${hint}) e depois re-execute o run de deploy.`,
  };
}

class HttpError extends Error {
  constructor(status, url, body) {
    super(`HTTP ${status} em ${url}`);
    this.status = status;
    this.body = body;
  }
}

function makeApi({ token, baseUrl }) {
  return async function api(path) {
    const url = `${baseUrl}${path}`;
    const res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'wait-ci-green',
      },
    });
    if (!res.ok) {
      let body = '';
      try {
        body = (await res.text()).slice(0, 300);
      } catch {
        /* ignore */
      }
      throw new HttpError(res.status, url, body);
    }
    return res.json();
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function summary(lines) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  try {
    appendFileSync(file, `${lines.join('\n')}\n`);
  } catch {
    /* ignore */
  }
}

function fail(msg) {
  console.error(`::error::${msg}`);
}

function permissionMessage(err) {
  return (
    `${err.message}. Verifique as permissoes do job (actions: read, contents: read) ` +
    `e se o repo/ref existem. ${err.body || ''}`.trim()
  );
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const token = env.GITHUB_TOKEN || env.GH_TOKEN;
  if (!token) {
    console.error('::error::GITHUB_TOKEN/GH_TOKEN ausente');
    return 2;
  }
  let opts;
  try {
    opts = parseArgs(argv, env);
  } catch (err) {
    console.error(`::error::${err.message}`);
    return 2;
  }
  const baseUrl = (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
  const api = makeApi({ token, baseUrl });
  const repoPath = `/repos/${opts.repo}`;

  let sha;
  try {
    const commit = await api(`${repoPath}/commits/${encodeURIComponent(opts.sha)}`);
    sha = commit.sha;
    console.log(`Commit avaliado: ${sha} (entrada: ${opts.sha})`);
    const cmp = await api(
      `${repoPath}/compare/${sha}...${encodeURIComponent(opts.branch)}`,
    );
    if (!isContainedStatus(cmp.status)) {
      fail(
        `Commit ${sha} nao contido na ${opts.branch} (compare = ${cmp.status}). ` +
          `Faca merge na ${opts.branch} e aguarde o CI antes de taguear/deployar.`,
      );
      return 1;
    }
    console.log(`Commit contido na ${opts.branch} (compare = ${cmp.status}).`);
  } catch (err) {
    if (err instanceof HttpError) {
      fail(permissionMessage(err));
    } else {
      fail(`Falha de rede ao resolver o commit: ${err.message}`);
    }
    return 1;
  }

  const started = Date.now();
  const elapsed = () => Math.round((Date.now() - started) / 1000);

  for (;;) {
    let result;
    try {
      const list = await api(
        `${repoPath}/actions/workflows/${encodeURIComponent(opts.workflow)}/runs` +
          `?head_sha=${sha}&branch=${encodeURIComponent(opts.branch)}&event=push&per_page=100`,
      );
      const entries = [];
      for (const run of list.workflow_runs || []) {
        const jobsRes = await api(
          `${repoPath}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`,
        );
        entries.push({ run, jobs: jobsRes.jobs || [] });
      }
      result = evaluateRuns(entries, {
        requiredJobs: opts.requiredJobs,
        repo: opts.repo,
        branch: opts.branch,
      });
    } catch (err) {
      if (err instanceof HttpError && [401, 403, 404].includes(err.status)) {
        fail(permissionMessage(err));
        return 1;
      }
      console.warn(`::warning::Erro transitorio na consulta (${err.message}); tentando de novo.`);
      result = null;
    }

    if (result) {
      console.log(`[${elapsed()}s] estado=${result.state} runs=${result.details.length}`);
      if (result.state === 'success') {
        const p = result.passed;
        console.log(`CI verde: run ${p.id} (attempt ${p.attempt}) ${p.url}`);
        summary([
          '### Gate de CI: verde',
          `- Commit: \`${sha}\``,
          `- Run de CI: ${p.url} (attempt ${p.attempt})`,
        ]);
        return 0;
      }
      if (result.state === 'failure') {
        fail(result.message);
        return 1;
      }
      if (result.state === 'none' && elapsed() >= opts.noRunGraceSec) {
        fail(
          `Nenhum run de CI (push na ${opts.branch}) para ${sha} apos ${elapsed()}s. ` +
            `O commit pode nao ter disparado CI (push com varios commits?) ou so tem run de pull_request.`,
        );
        return 1;
      }
      if (result.state === 'pending') console.log(result.message);
    }

    if (elapsed() >= opts.timeoutSec) {
      fail(
        `Timeout de ${opts.timeoutSec}s aguardando o CI de ${sha}.` +
          (result && result.state === 'pending' ? ` ${result.message}` : '') +
          ' Cancele/re-execute o CI e depois o run de deploy.',
      );
      return 1;
    }
    await sleep(opts.intervalSec * 1000);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(`::error::${err.stack || err.message}`);
      process.exitCode = 1;
    },
  );
}
