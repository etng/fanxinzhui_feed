const superagent = require("superagent");
const { JSDOM } = require("jsdom");
const dayjs = require("dayjs");
const { Feed } = require("feed");
const fs = require("fs");
var customParseFormat = require("dayjs/plugin/customParseFormat");
var utc = require("dayjs/plugin/utc");
dayjs.extend(utc);
dayjs.extend(customParseFormat);
require("superagent-cache")(superagent);
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
const BASE = "https://www.fanxinzhui.com";
const OUT_DIR = "data/dist";
fs.mkdirSync(OUT_DIR, { recursive: true });

const fail = (err) => {
  console.error(err);
  process.exit(1);
};

const fetchPage = async (url) => {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await superagent
        .get(url)
        .set("User-Agent", UA)
        .set(
          "Accept",
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        )
        .set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        .set("Referer", BASE + "/list");
    } catch (err) {
      lastErr = err;
      console.error("fetch attempt " + attempt + " failed: " + url);
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
      }
    }
  }
  throw lastErr;
};

const writeOut = (name, contents) =>
  fs.writeFileSync(OUT_DIR + "/" + name, contents);

const CRAWL_CONCURRENCY = 4;

async function crawlAll(metas) {
  const updates = [];
  for (let i = 0; i < metas.length; i += CRAWL_CONCURRENCY) {
    const batch = metas.slice(i, i + CRAWL_CONCURRENCY);
    updates.push(...(await Promise.all(batch.map(crawlDrama))));
  }
  return updates;
}

fetchPage(BASE + "/lastest")
  .then(
    (res) => {
      const { document } = new JSDOM(res.text).window;
      var metas = [];
      document
        .querySelectorAll(".lastest_update div.list a.la")
        .forEach((a) => {
          var url = a.href;

          if (url.indexOf("//") == -1) {
            url = BASE + url;
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
      if (metas.length === 0) {
        return fail("no entries parsed from " + BASE + "/lastest");
      }
      crawlAll(metas)
        .then((updates) => {
          if (updates.length === 0) {
            return fail("no feed items built from " + metas.length + " entries");
          }
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
          // RSS 2.0
          writeOut("fanxinzhui.rss", feed.rss2());
          //  Atom 1.0
          writeOut("fanxinzhui.atom", feed.atom1());
          // JSON Feed 1.0
          writeOut("fanxinzhui.json", feed.json1());
          writeOut("index.htm", "<h1>404 Not Found!</h1>");
          writeOut(
            "README.md",
            "[Subscribe](https://etng.github.io/fanxinzhui_feed/fanxinzhui.rss)"
          );
          console.log("wrote " + updates.length + " items to " + OUT_DIR);
        })
        .catch(fail);
    },
    fail
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
    fetchPage(meta.url)
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
                var passwordHref = span.querySelector("a:nth-child(2)");
                ep.links.push({
                  url: span.querySelector("a").getAttribute("href"),
                  password: passwordHref ? passwordHref.textContent : "",
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
