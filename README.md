# FanXinZhui Feed

[![pages-build-deployment](https://github.com/etng/fanxinzhui_feed/actions/workflows/pages/pages-build-deployment/badge.svg)](https://github.com/etng/fanxinzhui_feed/actions/workflows/pages/pages-build-deployment)

for self usage only, please do not spread it, thanks!

Requires `curl` on PATH: upstream sits behind Cloudflare, which rejects node's
TLS fingerprint but serves curl normally.

## changelog 
* 2026-11-23 fetch upstream through curl (Cloudflare 403s node's TLS fingerprint), fail the build on fetch/parse errors instead of silently publishing nothing, and re-enable the scheduled workflows
* 2024-04-18 updated actions to use [actions/checkout@v4](https://github.com/actions/checkout)