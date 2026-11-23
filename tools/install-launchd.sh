#!/usr/bin/env bash
# Run tools/subscribe.js on a timer through launchd, the supported scheduler on
# macOS: interval jobs missed while the Mac sleeps are coalesced and run on
# wake, and the job gets a fixed PATH/log instead of cron's bare environment.
#
#   sh tools/install-launchd.sh print      # print the plist, touch nothing
#   sh tools/install-launchd.sh install    # write + load + run once now
#   sh tools/install-launchd.sh uninstall  # unload + remove
#
# INTERVAL (seconds, default 1800), LABEL, NODE and BIN can be overridden.
set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
LABEL=${LABEL:-com.etng.fanxinzhui.subscribe}
INTERVAL=${INTERVAL:-1800}
NODE=${NODE:-$(command -v node || true)}
BIN=${BIN:-$(command -v BaiduPCS-Go || echo /usr/local/bin/BaiduPCS-Go)}
LOG_DIR=${LOG_DIR:-$HOME/Library/Logs}
PLIST=$HOME/Library/LaunchAgents/$LABEL.plist
NODE_BIN=${NODE:-/usr/bin/node}
NODE_DIR=$(dirname "$NODE_BIN")
PATH_DIRS="$NODE_DIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

usage() {
  cat <<EOF
usage: $0 [print|install|uninstall]

  print       print the LaunchAgent plist to stdout
  install     write $PLIST, bootstrap it and kickstart one run
  uninstall   bootout and delete the plist

env: INTERVAL=${INTERVAL}s LABEL=$LABEL NODE=$NODE BIN=$BIN
EOF
}

plist() {
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE</string>
        <string>$REPO/tools/subscribe.js</string>
        <string>--bin</string>
        <string>$BIN</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$REPO</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>$HOME</string>
        <key>PATH</key>
        <string>$PATH_DIRS</string>
    </dict>
    <key>StartInterval</key>
    <integer>$INTERVAL</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$LOG_DIR/fanxinzhui-subscribe.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/fanxinzhui-subscribe.err.log</string>
</dict>
</plist>
EOF
}

case "${1:-print}" in
  print) plist ;;
  install)
    [ -n "$NODE" ] || { echo "no node on PATH; set NODE=/path/to/node" >&2; exit 2; }
    [ -x "$NODE" ] || { echo "NODE=$NODE is not executable" >&2; exit 2; }
    mkdir -p "$(dirname "$PLIST")" "$LOG_DIR"
    plist > "$PLIST"
    plutil -lint "$PLIST" >/dev/null
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    launchctl kickstart -k "gui/$(id -u)/$LABEL"
    echo "installed $PLIST (every ${INTERVAL}s), logs: $LOG_DIR/fanxinzhui-subscribe.log"
    ;;
  uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "removed $LABEL"
    ;;
  -h|--help|help) usage ;;
  *) usage >&2; exit 2 ;;
esac
