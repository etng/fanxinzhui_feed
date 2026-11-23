#!/usr/bin/env node
'use strict';

// Subscribe to fanxinzhui_feed, filter entries by keyword, pull the Baidu Pan
// share links out of them and hand each one to a local BaiduPCS-Go binary:
// transfer (转存) into the account, then download to a local directory.
//
// BaiduPCS-Go exits 0 even when a command fails, so every step below checks the
// process output instead of the exit code.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_FEED = 'https://etng.github.io/fanxinzhui_feed/fanxinzhui.json';
const DEFAULT_STATE = path.join(os.homedir(), '.local/state/fanxinzhui/subscribed.json');
const DEFAULT_LOCAL_DIR = path.join(os.homedir(), 'Downloads/fanxinzhui');
const DEFAULT_REMOTE_DIR = '/fanxinzhui';
const LOCK_STALE_MS = 6 * 60 * 60 * 1000;

function usage() {
  console.log(`usage: node tools/subscribe.js [options]

  --include <regex>    keep entries whose title/description matches (repeatable)
  --exclude <regex>    drop entries whose title/description matches (repeatable)
  --all                do not filter by keyword (needs --include otherwise)
  --feed <url|file>    feed to read (default ${DEFAULT_FEED})
  --save-dir <path>    remote Baidu Pan directory to transfer into (default ${DEFAULT_REMOTE_DIR})
  --local-dir <path>   local download directory (default ${DEFAULT_LOCAL_DIR})
  --state <path>       state file (default ${DEFAULT_STATE})
  --bin <path>         BaiduPCS-Go binary (default $BAIDUPCS or "BaiduPCS-Go")
  --since <date>       only entries modified at/after this date (YYYY-MM-DD[THH:MM])
  --limit <n>          stop after n new shares
  --dry-run            only print what would be transferred
  --no-download        transfer into the account but do not download
  --verbose            echo every BaiduPCS-Go call
  --help               this text

example:
  node tools/subscribe.js --include '1080' --include '绑架游戏' --dry-run
`);
}

function die(msg) {
  console.error('error: ' + msg);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = {
    include: [],
    exclude: [],
    all: false,
    feed: DEFAULT_FEED,
    remoteDir: DEFAULT_REMOTE_DIR,
    localDir: DEFAULT_LOCAL_DIR,
    state: DEFAULT_STATE,
    bin: process.env.BAIDUPCS || 'BaiduPCS-Go',
    since: null,
    limit: 0,
    dryRun: false,
    download: true,
    verbose: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) die(arg + ' needs a value');
      return argv[++i];
    };
    const regex = () => {
      try {
        return new RegExp(value(), 'i');
      } catch (e) {
        die(arg + ': invalid regular expression: ' + e.message);
      }
    };
    switch (arg) {
      case '--include': opts.include.push(regex()); break;
      case '--exclude': opts.exclude.push(regex()); break;
      case '--all': opts.all = true; break;
      case '--feed': opts.feed = value(); break;
      case '--save-dir': opts.remoteDir = value(); break;
      case '--local-dir': opts.localDir = value(); break;
      case '--state': opts.state = value(); break;
      case '--bin': opts.bin = value(); break;
      case '--since': opts.since = new Date(value()); if (isNaN(opts.since)) die('--since: invalid date'); break;
      case '--limit': opts.limit = parseInt(value(), 10); if (!(opts.limit > 0)) die('--limit: positive integer expected'); break;
      case '--dry-run': opts.dryRun = true; break;
      case '--no-download': opts.download = false; break;
      case '--verbose': opts.verbose = true; break;
      case '--help':
      case '-h': usage(); process.exit(0); break;
      default: die('unknown option ' + arg);
    }
  }
  if (!opts.all && opts.include.length === 0) die('give at least one --include regex, or --all');
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
    const res = await fetch(src, { headers: { 'user-agent': 'fanxinzhui-subscribe' } });
    if (!res.ok) throw new Error('feed fetch failed: HTTP ' + res.status);
    return res.json();
  }
  return JSON.parse(fs.readFileSync(src, 'utf8'));
}

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

const posixJoin = (...parts) =>
  parts.join('/').replace(/\/+/g, '/').replace(/\/$/, '');

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

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const lockFile = opts.state + '.lock';
  if (!acquireLock(lockFile)) {
    log('another run holds ' + lockFile + ', exiting');
    return 0;
  }
  let exitCode = 0;
  try {
    const state = loadState(opts.state);
    const feed = await loadFeed(opts.feed);
    const items = (feed.items || []).filter((item) => {
      if (opts.since) {
        const when = new Date(item.date_modified || item.date_published || 0);
        if (!(when >= opts.since)) return false;
      }
      const haystack = item.title + ' ' + stripTags(item.description) + ' ' + stripTags(item.content_html);
      if (opts.exclude.some((re) => re.test(haystack))) return false;
      if (!opts.all && !opts.include.some((re) => re.test(haystack))) return false;
      return true;
    });

    const jobs = [];
    for (const item of items) {
      for (const share of extractShares(item.content_html || '')) {
        const key = item.id + '|' + share.link;
        const known = state.items[key];
        if (known && (known.status === 'done' || (!opts.download && known.status === 'transferred'))) continue;
        jobs.push({ key, item, share, known });
      }
    }
    log('feed entries matched:', items.length, 'pending shares:', jobs.length);

    if (jobs.length === 0) {
      log('nothing to do');
      return 0;
    }

    if (opts.dryRun) {
      for (const job of jobs) {
        console.log(
          (job.known ? '[' + job.known.status + '] ' : '[new] ') +
            job.item.title + ' — ' + job.share.link + (job.share.pwd ? ' pwd=' + job.share.pwd : ' (no code)')
        );
      }
      return 0;
    }

    const pcs = (args) => run(opts.bin, args, opts.verbose);
    const originalPwd = firstMatch((await pcs(['pwd'])).out, /^\s*(\/[^\n]*)$/m) || '/';
    log('remote work dir:', originalPwd, '→', opts.remoteDir);

    let processed = 0;
    for (const job of jobs) {
      if (opts.limit && processed >= opts.limit) break;
      const label = job.item.title + ' — ' + job.share.link;
      try {
        await ensureRemoteDir(pcs, opts.remoteDir);

        let remotePath = job.known && job.known.remotePath;
        if (!remotePath) {
          const args = ['transfer', job.share.link];
          if (job.share.pwd && !/[?&]pwd=/.test(job.share.link)) args.push(job.share.pwd);
          const res = await pcs(args);
          const saved = firstMatch(res.out, /转存成功,\s*保存了(.+?)到当前目录/);
          if (!saved) {
            throw new Error('transfer failed: ' + res.out.trim().split('\n').filter(Boolean).pop());
          }
          remotePath = posixJoin(opts.remoteDir, saved.trim());
          state.items[job.key] = {
            title: job.item.title,
            link: job.share.link,
            pwd: job.share.pwd,
            remotePath,
            status: 'transferred',
            at: new Date().toISOString(),
          };
          saveState(opts.state, state);
          log('transferred:', remotePath);
        } else {
          log('already transferred:', remotePath);
        }

        if (opts.download) {
          fs.mkdirSync(opts.localDir, { recursive: true });
          const res = await pcs(['download', '--saveto', opts.localDir, remotePath]);
          if (!/下载结束/.test(res.out) || /以下文件下载失败/.test(res.out)) {
            throw new Error('download failed: ' + res.out.trim().split('\n').filter(Boolean).pop());
          }
          state.items[job.key].status = 'done';
          state.items[job.key].downloadedAt = new Date().toISOString();
          saveState(opts.state, state);
          log('downloaded:', remotePath, '→', opts.localDir);
        }
        processed++;
      } catch (e) {
        exitCode = 1;
        console.error(new Date().toISOString(), 'FAILED', label, '-', e.message);
      }
    }

    if (!opts.dryRun) {
      const back = await pcs(['cd', originalPwd]);
      if (!/改变工作目录/.test(back.out)) log('warning: could not restore remote work dir to', originalPwd);
    }
    log('done, processed:', processed);
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
