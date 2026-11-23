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

### actions (after the download)

Named post-download operations, e.g. a NAS sync and a notification. The action
**name** is the identity: the same operation runs once per entry+share and is
then recorded in the state file, so editing the command (mail → Telegram, new
rsync flags) does not run it again. Add a new name when you want a new run.

```yaml
defaults:
  actions:
    rsync: rsync -a "{file}" nas:/volume1/anime/    # map form: name: command

rules:
  - name: 绑架游戏
    actions:
      - name: notify                                # overrides defaults.notify
        command: ~/bin/notify-tg "{title}" "{file}"
        timeout: 60                                 # optional seconds
      - name: notify-mail
        command: printf '%s\n' "{title}" | mail -s "fanxinzhui" me@example.com
```

- placeholders: `{file}` local path (absolute), `{dir}` local dir, `{remote}`
  Pan path, `{title}`, `{rule}`, `{link}`, `{pwd}`; the same values are exported
  as `FANXINZHUI_FILE`, `_DIR`, `_REMOTE`, `_TITLE`, `_RULE`, `_LINK`, `_PWD`.
- commands run with `/bin/sh -c` after the download succeeds; rules with
  `download: false` skip them; `--dry-run` prints the pending names.
- rule `actions` are merged over `defaults.actions` by name (rule wins, order
  keeps defaults first).
- a failing action leaves the exit code at 1, is not recorded, and is retried
  on the next run; successful ones are not repeated.
- changing `local_dir` re-downloads into the new folder but does not re-run an
  action that already ran; rename the action if it must run again.
- `state.actions` holds `entry|share|action` → timestamp/exit, so the key never
  contains the command text.

### copying to a NAS

`tools/push-to-nas.sh <local file|dir> <remote dir>` streams over plain ssh:
`cat` for a file (written as `.<name>.part`, renamed after a size check) and
`tar` for a folder. It is the fallback for boxes whose sftp-server is chrooted
(rclone/sftp cannot see the target path) and whose rsync receiver is broken:

```yaml
rules:
  - name: 绑架游戏
    actions:
      sync: /path/to/repo/tools/push-to-nas.sh "{file}" "/volume1/incoming/Show Name"
```

`NAS_HOST` overrides the ssh alias (default `nas166`).

```sh
node tools/subscribe.js --dry-run          # what would run, touches nothing
node tools/subscribe.js                    # all rules
node tools/subscribe.js --rule 绑架游戏     # one rule
```

State lives in `~/.local/state/fanxinzhui/subscribed.json`, keyed by
`rule|entry|share`: a transferred share is only downloaded again (e.g. after
changing `local_dir`), never re-transferred; `done` entries are skipped unless
an action is still pending. A lock file keeps overlapping runs out, and every
run restores your previous BaiduPCS-Go work directory.

### schedule on macOS

cron works, but a job whose minute passes while the Mac is asleep is simply
skipped, `cron`'s environment/PATH is bare, and reaching `~/Downloads` or an
external volume needs the cron binary added to Full Disk Access. A LaunchAgent
is the supported route and catches up on wake:

```sh
sh tools/install-launchd.sh print      # show the plist, touch nothing
sh tools/install-launchd.sh install    # write + load it and run once
sh tools/install-launchd.sh uninstall
INTERVAL=900 sh tools/install-launchd.sh install   # every 15 min
```

It runs `tools/subscribe.js` with `RunAtLoad` + `StartInterval` (default 1800s),
a PATH that contains your node and `/usr/local/bin`, and logs to
`~/Library/Logs/fanxinzhui-subscribe.log{,.err.log}`. If you prefer cron:

```sh
*/30 * * * * cd $HOME/Bodev/fanxinzhui_feed && $HOME/.local/share/mise/shims/node tools/subscribe.js --bin /usr/local/bin/BaiduPCS-Go >> $HOME/Library/Logs/fanxinzhui-subscribe.log 2>&1
```

## changelog
* 2026-11-23 add `tools/push-to-nas.sh` (ssh `cat`/`tar` + size check) for NAS boxes that chroot sftp and ship a broken rsync
* 2026-11-23 named post-download actions keyed by action name (rsync/notify/...), launchd installer for macOS scheduling
* 2026-11-23 `tools/subscribe.js` takes named YAML rules from `~/.config/fanxinzhui.yaml` (keywords, destination, since/last N) instead of only CLI flags
* 2026-11-23 add `tools/subscribe.js`: keyword-filtered Baidu Pan share extraction with BaiduPCS-Go transfer/download and state-based dedupe
* 2026-11-23 rebase gh-pages on a single fresh commit on every publish (it only ever holds generated files)
* 2026-11-23 upgrade to actions/checkout@v7 / actions/setup-node@v7 on node 24 and publish gh-pages with plain git (the node-20-only action is gone), serialize publishes with a concurrency group
* 2026-11-23 fetch upstream through curl (Cloudflare 403s node's TLS fingerprint), fail the build on fetch/parse errors instead of silently publishing nothing, and re-enable the scheduled workflows; publish commits as the configured user
* 2024-04-18 updated actions to use [actions/checkout@v4](https://github.com/actions/checkout)