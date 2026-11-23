# FanXinZhui Feed

[![pages-build-deployment](https://github.com/etng/fanxinzhui_feed/actions/workflows/pages/pages-build-deployment/badge.svg)](https://github.com/etng/fanxinzhui_feed/actions/workflows/pages/pages-build-deployment)

for self usage only, please do not spread it, thanks!

Requires `curl` on PATH: upstream sits behind Cloudflare, which rejects node's
TLS fingerprint but serves curl normally.

## changelog 
* 2026-11-23 upgrade to actions/checkout@v7 / actions/setup-node@v7 on node 24 and publish gh-pages with plain git (the node-20-only action is gone), serialize publishes with a concurrency group
* 2026-11-23 fetch upstream through curl (Cloudflare 403s node's TLS fingerprint), fail the build on fetch/parse errors instead of silently publishing nothing, and re-enable the scheduled workflows; publish commits as the configured user
* 2024-04-18 updated actions to use [actions/checkout@v4](https://github.com/actions/checkout)