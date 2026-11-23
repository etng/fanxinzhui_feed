# FanXinZhui Feed

[![pages-build-deployment](https://github.com/etng/fanxinzhui_feed/actions/workflows/pages/pages-build-deployment/badge.svg)](https://github.com/etng/fanxinzhui_feed/actions/workflows/pages/pages-build-deployment)

for self usage only, please do not spread it, thanks!

## changelog 
* 2026-11-23 crawl upstream over https with browser headers (Cloudflare returned 403 otherwise), fail the build on fetch/parse errors instead of silently producing nothing, and re-enable the scheduled workflows
* 2024-04-18 updated actions to use [actions/checkout@v4](https://github.com/actions/checkout)