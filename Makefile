build: setup
	/usr/bin/yarn run update
setup:
	/usr/bin/yarn
	mkdir -p data/dist
	touch data/dist/index.htm
	echo '<h1>404 Not Found!</h1>' > data/dist/index.htm
gh-pages: build
	/bin/bash build_gh_pages.sh