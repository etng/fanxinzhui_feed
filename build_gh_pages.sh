#!/bin/bash
mkdir -p ../fanxinzhui_feed_gh_pages
cp -fr data/dist/* ../fanxinzhui_feed_gh_pages
pushd ../fanxinzhui_feed_gh_pages
rm -fr .git
git init .
git add .
git commit -m 'update gh-pages'
git remote add origin git@github.com:etng/fanxinzhui_feed.git
git checkout -b gh-pages
git push -u -f origin gh-pages
popd
rm -fr ../fanxinzhui_feed_gh_pages