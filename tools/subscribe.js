#!/usr/bin/env node
'use strict';

// Subscribe to fanxinzhui_feed, route entries to named rules from a YAML
// config, pull the Baidu Pan share links out of them and hand each one to a
// local BaiduPCS-Go binary: transfer (转存) into the account, then download to
// the rule's local directory.
//
// BaiduPCS-Go exits 0 even when a command fails, so every step below checks the
// process output instead of the exit code.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const yaml = require('js-yaml');

const DEFAULT_FEED = 'https://etng.github.io/fanxinzhui_feed/fanxinzhui.json';
const DEFAULT_CONFIG = path.join(os.homedir(), '.config/fanxinzhui.yaml');
const DEFAULT_STATE = path.join(os.homedir(), '.local/state/fanxinzhui/subscribed.json');
const DEFAULT_LOCAL_DIR = path.join(os.homedir(), 'Downloads/fanxinzhui');
const DEFAULT_REMOTE_DIR = '/fanxinzhui';
const LOCK_STALE_MS = 6 * 60 * 60 * 1000;

function usage() {
  console.log(`usage: node tools/subscribe.js [options]

rules come from ${DEFAULT_CONFIG} (or --config), e.g.:

  defaults:
    local_dir: ~/Downloads/fanxinzhui
    remote_dir: /fanxinzhui
    since: 2026-11-01
  rules:
    - name: 绑架游戏
      include: ['绑架游戏']
      local_dir: ~/Downloads/绑架游戏
    - name: 1080p
      include: ['1080', '2160']
      since: 2026-11-20
      download: false

options:
  --config <file>      rule file (default ${DEFAULT_CONFIG})
  --rule <name>        run only the named rule (repeatable)
  --include <regex>    extra cli rule, appended after config rules (repeatable)
  --exclude <regex>    exclude pattern for the cli rule (repeatable)
  --all                cli rule without keyword filter
  --feed <url|file>    feed to read (default ${DEFAULT_FEED})
  --save-dir <path>    remote dir of the cli rule (default ${DEFAULT_REMOTE_DIR})
  --local-dir <path>   local dir of the cli rule (default ${DEFAULT_LOCAL_DIR})
  --since <date>       since date of the cli rule (YYYY-MM-DD[THH:MM])
  --limit <n>          stop after n new shares of the cli rule
  --state <path>       state file (default ${DEFAULT_STATE})
  --bin <path>         BaiduPCS-Go binary (default $BAIDUPCS or "BaiduPCS-Go")
  --dry-run            only print what would be transferred
  --no-download        transfer into the account but do not download
  --verbose            echo every BaiduPCS-Go call
  --help               this text
`);
}

function die(msg) {
  console.error('error: ' + msg);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = {
    config: DEFAULT_CONFIG,
    configExplicit: false,
    onlyRules: [],
    feed: DEFAULT_FEED,
    state: DEFAULT_STATE,
    bin: process.env.BAIDUPCS || 'BaiduPCS-Go',
    dryRun: false,
    verbose: false,
    cli: {
      include: [],
      exclude: [],
      all: false,
      remoteDir: DEFAULT_REMOTE_DIR,
      localDir: DEFAULT_LOCAL_DIR,
      since: null,
      limit: 0,
      download: true,
      given: false,
    },
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) die(arg + ' needs a value');
      return argv[++i];
    };
    switch (arg) {
      case '--config': opts.config = value(); opts.configExplicit = true; break;
      case '--rule': opts.onlyRules.push(value()); break;
      case '--include': opts.cli.include.push(value()); opts.cli.given = true; break;
      case '--exclude': opts.cli.exclude.push(value()); opts.cli.given = true; break;
      case '--all': opts.cli.all = true; opts.cli.given = true; break;
      case '--feed': opts.feed = value(); break;
      case '--state': opts.state = value(); break;
      case '--bin': opts.bin = value(); break;
      case '--save-dir': opts.cli.remoteDir = value(); opts.cli.given = true; break;
      case '--local-dir': opts.cli.localDir = value(); opts.cli.given = true; break;
      case '--since': opts.cli.since = parseSince(value(), '--since'); opts.cli.given = true; break;
      case '--limit': opts.cli.limit = value(); opts.cli.given = true; break;
      case '--no-download': opts.cli.download = false; opts.cli.given = true; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--verbose': opts.verbose = true; break;
      case '--help':
      case '-h': usage(); process.exit(0); break;
      default: die('unknown option ' + arg);
    }
  }
  return opts;
}

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function stripAnsi(s) {
  return s.replace(/\r/g, '\n').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

function stripTags(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ');
}

// One share per anchor. The feed puts the extraction code both in the href
// (?pwd=xxxx) and in a span right after the link, so try both.
function extractShares(html) {
  const shares = [];
  const seen = new Set();
  const anchor = /<a\b[^>]*\bhref="([^"]+)"[^>]*>[\s\S]*?<\/a>/gi;
  let m;
  while ((m = anchor.exec(html))) {
    const href = m[1]
      .replace(/&amp;/g, '&')
      .replace(/#.*$/, '');
    if (!/pan\.baidu\.com\//i.test(href)) continue;
    if (!/(\/s\/|surl=|share\/init)/i.test(href)) continue;
    let pwd = '';
    try {
      pwd = new URL(href).searchParams.get('pwd') || '';
    } catch (e) {
      const q = href.match(/[?&]pwd=([^&]+)/);
      pwd = q ? q[1] : '';
    }
    if (!pwd) {
      const nextAnchor = html.indexOf('<a', anchor.lastIndex);
      const tail = html.slice(anchor.lastIndex, nextAnchor === -1 ? anchor.lastIndex + 400 : nextAnchor);
      const span = tail.match(/密码[:：]?\s*(?:&nbsp;)*\s*<span[^>]*>\s*([A-Za-z0-9]{4,8})\s*<\/span>/i);
      const plain = tail.match(/密码[:：]\s*([A-Za-z0-9]{4,8})\b/);
      pwd = (span && span[1]) || (plain && plain[1]) || '';
    }
    const key = href.replace(/\?pwd=$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    shares.push({ link: href, pwd });
  }
  return shares;
}

async function loadFeed(src) {
  if (/^https?:/i.test(src)) {
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(src, {
          headers: { 'user-agent': 'fanxinzhui-subscribe' },
          signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.json();
      } catch (e) {
        lastErr = e;
        if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 3000));
      }
    }
    throw new Error('feed fetch failed after 3 attempts: ' + (lastErr && lastErr.message));
  }
  return JSON.parse(fs.readFileSync(src, 'utf8'));
}

/* ------------------------------- rules ---------------------------------- */

function expandHome(p) {
  const s = String(p);
  if (s === '~' || s.startsWith('~/')) return path.join(os.homedir(), s.slice(1));
  if (s === '$HOME' || s.startsWith('$HOME/')) return path.join(os.homedir(), s.slice(5));
  return s;
}

function toArray(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flat().filter((v) => v != null && v !== '');
  return [value];
}

function compileAll(value, where) {
  return toArray(value).map((v) => {
    try {
      return new RegExp(String(v), 'i');
    } catch (e) {
      die(where + ': invalid regular expression /' + v + '/: ' + e.message);
    }
  });
}

function parseSince(value, where) {
  if (value == null || value === '') return null;
  const when = value instanceof Date ? value : new Date(String(value));
  if (isNaN(when.getTime())) die(where + ': invalid date ' + value);
  return when;
}

function normalizeRemoteDir(value) {
  let dir = String(value).trim();
  if (!dir.startsWith('/')) dir = '/' + dir;
  dir = dir.replace(/\/+/g, '/');
  return dir.length > 1 ? dir.replace(/\/$/, '') : dir;
}

function normalizeRule(raw, defaults, index, source) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    die(`rules[${index}] must be a mapping with at least name and include`);
  }
  const name = String(raw.name || `rule-${index + 1}`);
  const include = toArray(
    raw.include != null ? raw.include : raw.keywords != null ? raw.keywords : raw.match != null ? raw.match : defaults.include
  );
  const all = raw.all != null ? !!raw.all : defaults.all != null ? !!defaults.all : false;
  if (include.length === 0 && !all) die(`rule "${name}": include/keywords is required`);

  const localDir = expandHome(
    raw.local_dir != null ? raw.local_dir : raw.download_to != null ? raw.download_to : defaults.local_dir != null ? defaults.local_dir : DEFAULT_LOCAL_DIR
  );
  const remoteDir = normalizeRemoteDir(
    raw.remote_dir != null ? raw.remote_dir : raw.save_dir != null ? raw.save_dir : defaults.remote_dir != null ? defaults.remote_dir : DEFAULT_REMOTE_DIR
  );
  const limitRaw = raw.limit != null ? raw.limit : defaults.limit;
  const limit = limitRaw == null || limitRaw === '' ? 0 : parseInt(limitRaw, 10);
  if (isNaN(limit) || limit < 0) die(`rule "${name}": limit must be a non-negative integer`);

  return {
    name,
    source,
    include: compileAll(include, `rule "${name}" include`),
    exclude: compileAll(raw.exclude != null ? raw.exclude : defaults.exclude, `rule "${name}" exclude`),
    all,
    localDir: path.resolve(localDir),
    remoteDir,
    since: parseSince(raw.since != null ? raw.since : defaults.since, `rule "${name}" since`),
    limit,
    download: raw.download != null ? !!raw.download : defaults.download != null ? !!defaults.download : true,
  };
}

function loadRules(opts) {
  const configPath = expandHome(opts.config);
  const exists = fs.existsSync(configPath);
  if (!exists && opts.configExplicit) die('config not found: ' + configPath);

  let config = { rules: [] };
  if (exists) {
    try {
      config = yaml.load(fs.readFileSync(configPath, 'utf8')) || {};
    } catch (e) {
      die('cannot parse ' + configPath + ': ' + e.message);
    }
    if (typeof config !== 'object' || Array.isArray(config)) die(configPath + ': top level must be a mapping');
  }

  const defaults = config.defaults && typeof config.defaults === 'object' ? config.defaults : {};
  const rawRules = config.rules == null ? [] : config.rules;
  if (!Array.isArray(rawRules)) die(configPath + ': rules must be a list');

  let rules = rawRules.map((raw, i) => normalizeRule(raw, defaults, i, configPath));

  if (opts.cli.given) {
    const cliDefaults = {
      include: opts.cli.include,
      exclude: opts.cli.exclude,
      all: opts.cli.all,
      local_dir: opts.cli.localDir,
      remote_dir: opts.cli.remoteDir,
      since: opts.cli.since,
      limit: opts.cli.limit,
      download: opts.cli.download,
    };
    rules.push(
      normalizeRule(
        {
          name: 'cli',
          include: cliDefaults.include,
          exclude: cliDefaults.exclude,
          all: cliDefaults.all,
          local_dir: cliDefaults.local_dir,
          remote_dir: cliDefaults.remote_dir,
          since: cliDefaults.since,
          limit: cliDefaults.limit,
          download: cliDefaults.download,
        },
        {},
        rules.length,
        'cli'
      )
    );
  }

  if (rules.length === 0) {
    die('no rules: write ' + configPath + ' or pass --include/--all');
  }

  if (opts.onlyRules.length) {
    const known = new Set(rules.map((r) => r.name));
    for (const wanted of opts.onlyRules) {
      if (!known.has(wanted)) die('unknown rule "' + wanted + '", known: ' + [...known].join(', '));
    }
    rules = rules.filter((r) => opts.onlyRules.includes(r.name));
  }

  const names = new Set();
  for (const rule of rules) {
    if (names.has(rule.name)) die('duplicate rule name "' + rule.name + '"');
    names.add(rule.name);
  }
  log('rules:', rules.map((r) => r.name).join(', '), 'from', exists ? configPath : '(cli only)');
  return rules;
}

function ruleMatches(rule, item) {
  const haystack = item.title + ' ' + stripTags(item.description) + ' ' + stripTags(item.content_html);
  if (rule.exclude.some((re) => re.test(haystack))) return false;
  if (rule.all && rule.include.length === 0) return true;
  return rule.include.some((re) => re.test(haystack));
}

function itemDate(item) {
  return new Date(item.date_modified || item.date_published || 0);
}

/* ------------------------------- state ---------------------------------- */

function loadState(file) {
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!state.items) state.items = {};
    return state;
  } catch (e) {
    if (e.code === 'ENOENT') return { version: 1, items: {} };
    throw e;
  }
}

function saveState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
}

function acquireLock(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, String(process.pid), { flag: 'wx' });
    return true;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    let age = 0;
    try {
      age = Date.now() - fs.statSync(file).mtimeMs;
    } catch (err) {}
    if (age > LOCK_STALE_MS) {
      fs.unlinkSync(file);
      fs.writeFileSync(file, String(process.pid), { flag: 'wx' });
      return true;
    }
    return false;
  }
}

/* ---------------------------- BaiduPCS-Go -------------------------------- */

function run(bin, args, verbose) {
  return new Promise((resolve) => {
    if (verbose) log('$', bin, args.join(' '));
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', (err) => resolve({ code: -1, out: String(err.message) }));
    child.on('close', (code) => resolve({ code, out: stripAnsi(out) }));
  });
}

const posixJoin = (...parts) => parts.join('/').replace(/\/+/g, '/').replace(/\/$/, '');

function firstMatch(text, re) {
  const m = text.match(re);
  return m ? m[1] : '';
}

async function ensureRemoteDir(pcs, dir) {
  const segments = dir.split('/').filter(Boolean);
  let current = '';
  for (const seg of segments) {
    current += '/' + seg;
    // mkdir reports "already exists" as a failure text, that is fine.
    await pcs(['mkdir', current]);
  }
  const cd = await pcs(['cd', dir]);
  if (!/改变工作目录/.test(cd.out)) {
    throw new Error('cd ' + dir + ' failed: ' + (cd.out.trim() || 'no output'));
  }
}

/* -------------------------------- main ----------------------------------- */

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const rules = loadRules(opts);
  const lockFile = opts.state + '.lock';
  if (!acquireLock(lockFile)) {
    log('another run holds ' + lockFile + ', exiting');
    return 0;
  }
  let exitCode = 0;
  let workDirChanged = false;
  try {
    const state = loadState(opts.state);
    const feed = await loadFeed(opts.feed);
    const items = feed.items || [];

    const claimed = new Set();
    const jobs = [];
    for (const rule of rules) {
      let matched = 0;
      for (const item of items) {
        if (claimed.has(item.id)) continue;
        if (rule.since && !(itemDate(item) >= rule.since)) continue;
        if (!ruleMatches(rule, item)) continue;
        matched++;
        claimed.add(item.id);
        for (const share of extractShares(item.content_html || '')) {
          const key = rule.name + '|' + item.id + '|' + share.link;
          let known = state.items[key];
          if (known && known.localDir && known.localDir !== rule.localDir) {
            // destination changed: keep the transfer, redo the download
            known = { ...known, status: 'transferred', localDir: rule.localDir };
          }
          if (known && (known.status === 'done' || (!rule.download && known.status === 'transferred'))) continue;
          jobs.push({ rule, key, item, share, known });
        }
      }
      log(`rule "${rule.name}": matched ${matched} entries`);
    }
    log('pending shares:', jobs.length);

    if (jobs.length === 0) {
      log('nothing to do');
      return 0;
    }

    if (opts.dryRun) {
      for (const job of jobs) {
        console.log(
          '[' + job.rule.name + '] ' +
            (job.known ? '[' + job.known.status + '] ' : '[new] ') +
            job.item.title + ' — ' + job.share.link +
            (job.share.pwd ? ' pwd=' + job.share.pwd : ' (no code)') +
            ' → ' + job.rule.localDir
        );
      }
      return 0;
    }

    const pcs = (args) => run(opts.bin, args, opts.verbose);
    const originalPwd = firstMatch((await pcs(['pwd'])).out, /^\s*(\/[^\n]*)$/m) || '/';
    log('remote work dir:', originalPwd);

    const processed = new Map();
    for (const job of jobs) {
      const { rule } = job;
      const done = processed.get(rule.name) || 0;
      if (rule.limit && done >= rule.limit) continue;
      const label = `[${rule.name}] ${job.item.title} — ${job.share.link}`;
      try {
        if (!workDirChanged) {
          await ensureRemoteDir(pcs, rule.remoteDir);
          workDirChanged = true;
        } else {
          const cd = await pcs(['cd', rule.remoteDir]);
          if (!/改变工作目录/.test(cd.out)) {
            await ensureRemoteDir(pcs, rule.remoteDir);
          }
        }

        let remotePath = job.known && job.known.remotePath;
        if (!remotePath) {
          const args = ['transfer', job.share.link];
          if (job.share.pwd && !/[?&]pwd=/.test(job.share.link)) args.push(job.share.pwd);
          const res = await pcs(args);
          const saved = firstMatch(res.out, /转存成功,\s*保存了(.+?)到当前目录/);
          if (!saved) {
            throw new Error('transfer failed: ' + res.out.trim().split('\n').filter(Boolean).pop());
          }
          remotePath = posixJoin(rule.remoteDir, saved.trim());
          state.items[job.key] = {
            rule: rule.name,
            title: job.item.title,
            link: job.share.link,
            pwd: job.share.pwd,
            remotePath,
            localDir: rule.localDir,
            status: 'transferred',
            at: new Date().toISOString(),
          };
          saveState(opts.state, state);
          log(`[${rule.name}] transferred:`, remotePath);
        } else {
          if (state.items[job.key].localDir !== rule.localDir) {
            state.items[job.key].localDir = rule.localDir;
            saveState(opts.state, state);
          }
          log(`[${rule.name}] already transferred:`, remotePath);
        }

        if (rule.download) {
          fs.mkdirSync(rule.localDir, { recursive: true });
          const res = await pcs(['download', '--saveto', rule.localDir, remotePath]);
          if (!/下载结束/.test(res.out) || /以下文件下载失败/.test(res.out)) {
            throw new Error('download failed: ' + res.out.trim().split('\n').filter(Boolean).pop());
          }
          state.items[job.key].status = 'done';
          state.items[job.key].localDir = rule.localDir;
          state.items[job.key].downloadedAt = new Date().toISOString();
          saveState(opts.state, state);
          log(`[${rule.name}] downloaded:`, remotePath, '→', rule.localDir);
        }
        processed.set(rule.name, done + 1);
      } catch (e) {
        exitCode = 1;
        console.error(new Date().toISOString(), 'FAILED', label, '-', e.message);
      }
    }

    if (workDirChanged) {
      const back = await pcs(['cd', originalPwd]);
      if (!/改变工作目录/.test(back.out)) log('warning: could not restore remote work dir to', originalPwd);
    }
    log('done, processed:', [...processed].map(([k, v]) => k + '=' + v).join(' ') || '0');
  } finally {
    try {
      fs.unlinkSync(lockFile);
    } catch (e) {}
  }
  return exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('fatal:', err.stack || err.message || err);
    process.exit(1);
  });
