SHELL:=/bin/bash
build: setup
	yarn run update
setup:
	yarn
	mkdir -p data/dist
	touch data/dist/index.htm
gh-pages:
	(shell build_gh_pages.sh)