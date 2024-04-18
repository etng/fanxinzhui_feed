const superagent = require("superagent");
const { JSDOM } = require("jsdom");
const dayjs = require("dayjs");
const { Feed } = require("feed");
const fs = require("fs");
var expandTilde = require("expand-tilde");
var customParseFormat = require("dayjs/plugin/customParseFormat");
var utc = require("dayjs/plugin/utc");
dayjs.extend(utc);
dayjs.extend(customParseFormat);
require("superagent-cache")(superagent);
const showError = (e) => {
  if (e) {
    console.error(e);
  }
};
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";
superagent
  .get("http://www.fanxinzhui.com/lastest")
  .set("User-Agent", UA)
  .set("Referer", "https://www.fanxinzhui.com/list")
  .then(
    (res) => {
      const { document } = new JSDOM(res.text).window;
      var metas = [];
      document
        .querySelectorAll(".lastest_update div.list a.la")
        .forEach((a) => {
          var url = a.href;

          if (url.indexOf("//") == -1) {
            url = "http://www.fanxinzhui.com" + url;
          }
          metas.push({
            url: url,
            season: a.querySelector(".season").textContent,
            name: a.querySelector(".name").textContent,
            time: dayjs
              .utc(a.querySelector(".time").textContent, "YYYY-MM-DD HH:mm")
              .toDate(),
          });
        });
      Promise.all(metas.map(crawlDrama))
        .then((updates) => {
          console.log("all done");
          const author = {
            name: "追新番",
            link: "http://www.fanxinzhui.com/",
            email: "zhuixinfan@qq.com",
          };
          const feed = new Feed({
            title: "追新番",
            description: "追新番最新更新",
            id: "http://www.fanxinzhui.com/",
            link: "http://www.fanxinzhui.com/",
            image: "http://www.fanxinzhui.com/res/logo.png",
            generator: "Zhuixinfan updater",
            feedLinks: {
              json: "https://etng.github.io/fanxinzhui_feed/fanxinzhui.json",
              atom: "https://etng.github.io/fanxinzhui_feed/fanxinzhui.atom",
              rss: "https://etng.github.io/fanxinzhui_feed/fanxinzhui.rss",
            },
            author: author,
          });
          updates.forEach((post) => {
            feed.addItem({
              title: post.title,
              id: post.url,
              link: post.url,
              description: post.description,
              content: post.content,
              author: [author],
              contributor: [author],
              date: post.date,
              image: post.image,
            });
          });

          feed.addCategory("TV");
          feed.addCategory("Jpanese");
          feed.addContributor(author);
          fs.mkdirSync(expandTilde("data/dist/"), {
            recursive: true,
          });
          // RSS 2.0
          fs.writeFile(
            expandTilde("data/dist/fanxinzhui.rss"),
            feed.rss2(),
            showError
          );
          //  Atom 1.0
          fs.writeFile(
            expandTilde("data/dist/fanxinzhui.atom"),
            feed.atom1(),
            showError
          );
          // JSON Feed 1.0
          fs.writeFile(
            expandTilde("data/dist/fanxinzhui.json"),
            feed.json1(),
            showError
          );

          fs.writeFile(
            expandTilde("data/dist/index.htm"),
            "<h1>404 Not Found!</h1>",
            showError
          );
          fs.writeFile(
            expandTilde("data/dist/README.md"),
            "[Subscribe](https://etng.github.io/fanxinzhui_feed/fanxinzhui.rss)",
            showError
          );
        })
        .catch((failed_items) => {
          console.log("some faileds", failed_items);
        });
    },
    (err) => {
      console.error(err);
    }
  );

function nl2p(lines) {
  return (
    "<p>" +
    lines
      .trim()
      .replace(/\n{2,}/g, "</p><p>")
      .replace(/\n/g, "<br>") +
    "</p>"
  );
}

function crawlDrama(meta) {
  return new Promise((resolve, reject) => {
    superagent
      .get(meta.url)
      .set("User-Agent", UA)
      .then(
        (res) => {
          const { document } = new JSDOM(res.text).window;
          var drama = {
            title: document.querySelector(".resource_title h2").textContent,
            cover: document
              .querySelector(".resource_content div.image a")
              .getAttribute("href"),
            meta: {},
            intro: document.querySelector(".resource_intro .intro_text")
              .textContent,
            episodes: [],
          };

          document
            .querySelectorAll(".resource_content div.info ul li")
            .forEach((li) => {
              var mtm = li.querySelector("span");
              var mt = "cast";
              if (mtm) {
                mt = mtm.textContent;
                mtm.remove();
              }
              mt = mt.replace(/:+$/g, "");

              drama.meta[mt] = li.textContent;
            });
          var metaLines = Object.keys(drama.meta).map((k) => {
            return `${k}: ${drama.meta[k]}`;
          });
          metaLines.push(drama.intro);
          var description = nl2p(metaLines.join("\n\n"));
          document
            .querySelectorAll(".resource_item ul.item_list li")
            .forEach((item) => {
              var ep = { links: [] };
              var p = item.querySelector("p:first-child");
              ep.id = p.querySelector(".season").textContent;
              ep.title = p.querySelector(".item").textContent;
              item.querySelectorAll("p.way span").forEach((span) => {
                ep.links.push({
                  url: span.querySelector("a").getAttribute("href"),
                  password: span.querySelector("a:nth-child(2)").textContent,
                });
              });
              if (meta.season == ep.id && meta.name == ep.title) {
                ep.time = meta.time;
                ep.url = meta.url;
                var contentLines = ep.links.map((line) => {
                  var l = "";
                  var href = line.url;
                  if (
                    line.url.indexOf("pan.baidu.com") > 0 &&
                    line.url.indexOf("?pwd=") < 0
                  ) {
                    if (line.password) {
                      href = line.url + "?pwd=" + line.password;
                    }
                  }
                  if (line.url) {
                    l += `<a href="${href}" target="_blank">${line.url}</a>\r\n`;
                  }
                  if (line.password) {
                    l += `<span>&nbsp;密码:&nbsp;</span><span>${line.password}</span>`;
                  }
                  return l;
                });
                contentLines.push("\n\n\n\n" + description);
                // contentLines.push("generated by FanXinZhui updater")
                var img = "";
                if (drama.cover) {
                  img = `<img src="${drama.cover}" referrerpolicy="no-referrer" />`;
                }
                resolve({
                  title: `${drama.title} ${meta.season}`,
                  date: meta.time,
                  url: `${meta.url}#${meta.season}`,
                  description: description,
                  image: drama.cover,
                  content: img + nl2p(contentLines.join("\r\n").trim()),
                });
              }
              drama.episodes.push(ep);
            });
        },
        (err) => {
          reject(err);
        }
      );
  });
}
