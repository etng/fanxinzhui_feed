#!/bin/bash

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"  # This loads nvm

/usr/bin/yarn
mkdir -p data/dist
touch data/dist/index.htm
echo '<h1>404 Not Found!</h1>' > data/dist/index.htm
echo '[Subscribe](https://etng.github.io/fanxinzhui_feed/fanxinzhui.rss)' > data/dist/README.md

/usr/bin/yarn run update

/bin/bash build_gh_pages.sh