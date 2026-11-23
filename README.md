# FanXinZhui Feed

[![pages-build-deployment](https://github.com/etng/fanxinzhui_feed/actions/workflows/pages/pages-build-deployment/badge.svg)](https://github.com/etng/fanxinzhui_feed/actions/workflows/pages/pages-build-deployment)

for self usage only, please do not spread it, thanks!

Requires `curl` on PATH: upstream sits behind Cloudflare, which rejects node's
TLS fingerprint but serves curl normally.

## local subscription (Baidu Pan)

`tools/subscribe.js` reads the published JSON feed, keeps the entries matching
your keywords, pulls every `pan.baidu.com` link (plus its extraction code) out
of them, and drives a local [BaiduPCS-Go](https://github.com/qjfoidnh/BaiduPCS-Go):
`transfer` into a folder of your account, then `download` to a local directory.

Requires a logged-in BaiduPCS-Go (`BaiduPCS-Go who`) reachable on `PATH`, or
pass `--bin /usr/local/bin/BaiduPCS-Go`.

```sh
# show what would be picked, touches nothing
node tools/subscribe.js --include '绑架游戏' --dry-run

# transfer + download new shares only (state file dedupes)
node tools/subscribe.js --include '绑架游戏' --include '1080' --local-dir ~/Downloads/fanxinzhui

# transfer into the account but download later
node tools/subscribe.js --include '1080' --no-download
```

State lives in `~/.local/state/fanxinzhui/subscribed.json`: a share that has
been transferred is only downloaded again, never re-transferred; `done` entries
are skipped entirely. A lock file keeps overlapping cron runs out. Every run
restores your previous BaiduPCS-Go work directory.

Run it on a schedule (cron example, every 30 min):

```sh
crontab -e
*/30 * * * * cd ~/Bodev/fanxinzhui_feed && $(command -v node) tools/subscribe.js --include '关键词1' --include '关键词2' >> ~/Library/Logs/fanxinzhui-subscribe.log 2>&1
```

`--include`/`--exclude` take case-insensitive regular expressions matched
against the entry title and description; `--since`, `--limit`, `--feed`,
`--save-dir`, `--state` and `--verbose` cover the rest (`node tools/subscribe.js --help`).

## changelog 
* 2026-11-23 add `tools/subscribe.js`: keyword-filtered Baidu Pan share extraction with BaiduPCS-Go transfer/download and state-based dedupe
* 2026-11-23 rebase gh-pages on a single fresh commit on every publish (it only ever holds generated files)
* 2026-11-23 upgrade to actions/checkout@v7 / actions/setup-node@v7 on node 24 and publish gh-pages with plain git (the node-20-only action is gone), serialize publishes with a concurrency group
* 2026-11-23 fetch upstream through curl (Cloudflare 403s node's TLS fingerprint), fail the build on fetch/parse errors instead of silently publishing nothing, and re-enable the scheduled workflows; publish commits as the configured user
* 2024-04-18 updated actions to use [actions/checkout@v4](https://github.com/actions/checkout)