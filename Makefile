gh-pages: build
	/bin/bash build_gh_pages.sh
build: setup
	/usr/bin/yarn run update
setup:
	/usr/bin/yarn
	mkdir -p data/dist
	touch data/dist/index.htm
	echo '<h1>404 Not Found!</h1>' > data/dist/index.htm
	echo '[Subscribe](https://etng.github.io/fanxinzhui_feed/fanxinzhui.rss)' > data/dist/README.md
