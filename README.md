# FanXinZhui Feed

[![pages-build-deployment](https://github.com/etng/fanxinzhui_feed/actions/workflows/pages/pages-build-deployment/badge.svg)](https://github.com/etng/fanxinzhui_feed/actions/workflows/pages/pages-build-deployment)

for self usage only, please do not spread it, thanks!

Requires `curl` on PATH: upstream sits behind Cloudflare, which rejects node's
TLS fingerprint but serves curl normally.

## local subscription (Baidu Pan)

`tools/subscribe.js` reads the published JSON feed, routes entries to named
rules from `~/.config/fanxinzhui.yaml`, pulls every `pan.baidu.com` link (plus
its extraction code) out of them, and drives a local
[BaiduPCS-Go](https://github.com/qjfoidnh/BaiduPCS-Go): `transfer` into the
rule's remote folder, then `download` into the rule's local folder.

Requires a logged-in BaiduPCS-Go (`BaiduPCS-Go who`).

### rules

```yaml
# ~/.config/fanxinzhui.yaml
defaults:
  local_dir: ~/Downloads/fanxinzhui
  remote_dir: /fanxinzhui
  since: 2026-11-01          # only entries modified at/after this date

rules:
  - name: 绑架游戏
    include: ['绑架游戏']     # case-insensitive regex, title + description + content
    local_dir: ~/Downloads/绑架游戏
    since: 2026-11-20
    limit: 2                 # shares per run
  - name: 4k
    include: ['2160', '4K']
    exclude: ['预告']
    download: false          # transfer into the account only
```

- rule fields: `name`, `include` (alias `keywords`/`match`), `exclude`,
  `local_dir` (alias `download_to`), `remote_dir` (alias `save_dir`), `since`,
  `limit`, `download`, `all`; `defaults` supplies whatever a rule leaves out.
- the first matching rule wins, so an entry is transferred/downloaded once.
- `since` compares against the feed's `date_modified` (YAML date or any
  `Date`-parseable string).
- `--rule <name>` runs a subset; `--include/--exclude` without a config entry
  build an extra `cli` rule appended after the config rules.

```sh
node tools/subscribe.js --dry-run          # what would run, touches nothing
node tools/subscribe.js                    # all rules
node tools/subscribe.js --rule 绑架游戏     # one rule
```

State lives in `~/.local/state/fanxinzhui/subscribed.json`, keyed by
`rule|entry|share`: a transferred share is only downloaded again (e.g. after
changing `local_dir`), never re-transferred; `done` entries are skipped. A lock
file keeps overlapping cron runs out, and every run restores your previous
BaiduPCS-Go work directory.

Run it on a schedule (cron example, every 30 min). cron's PATH is just
`/usr/bin:/bin`, so point it at the real binaries — the mise node shim and
BaiduPCS-Go are not on it:

```sh
crontab -e
*/30 * * * * cd $HOME/Bodev/fanxinzhui_feed && $HOME/.local/share/mise/shims/node tools/subscribe.js --bin /usr/local/bin/BaiduPCS-Go >> $HOME/Library/Logs/fanxinzhui-subscribe.log 2>&1
```

## changelog 
* 2026-11-23 `tools/subscribe.js` takes named YAML rules from `~/.config/fanxinzhui.yaml` (keywords, destination, since/last N) instead of only CLI flags
* 2026-11-23 add `tools/subscribe.js`: keyword-filtered Baidu Pan share extraction with BaiduPCS-Go transfer/download and state-based dedupe
* 2026-11-23 rebase gh-pages on a single fresh commit on every publish (it only ever holds generated files)
* 2026-11-23 upgrade to actions/checkout@v7 / actions/setup-node@v7 on node 24 and publish gh-pages with plain git (the node-20-only action is gone), serialize publishes with a concurrency group
* 2026-11-23 fetch upstream through curl (Cloudflare 403s node's TLS fingerprint), fail the build on fetch/parse errors instead of silently publishing nothing, and re-enable the scheduled workflows; publish commits as the configured user
* 2024-04-18 updated actions to use [actions/checkout@v4](https://github.com/actions/checkout)