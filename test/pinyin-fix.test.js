"use strict";

// 「注音勘误」测试（Issue #243：用户报《滕王阁序》「秋水共长天一色」的
// 「长」被注成 zhǎng）。
//
// 分五层：
//   ① 数据层（js/pinyin-edit.js）：增删改查 / 去重 / 封顶 / 按篇绑定
//   ② 引擎层（js/pinyin.js）：勘误命中 / 不命中时的输出逐字不变 /
//      按「第几次出现」定位同一个字的第二处
//   ③ 页面层：首页弹层与集子阅读器真的读勘误表（走 annotatePoem）
//   ④ 同步层：一行 progress（pinyin_fix:v1），谁最后改谁赢、不进冲突裁决
//   ⑤ 服务端：白名单截断 / 封顶 / 半条丢掉
//
// 守住的边界（改一条就有断言红）：
//   · **按篇绑定**：这一篇改了，别的篇不受影响
//   · **不传 wid 时输出与改前逐字相同**（纯增强，不是改口径）
//   · **勘误优先于词表**：有人核对过的那一处比通用规则可信
//   · **只有多音字才查勘误**（单音字改了等于制造新错）

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..") + "/";

let fails = 0;
const chk = (c, m) => { if (!c) { console.log("✗ " + m); fails++; } else console.log("✓ " + m); };

// ---------------------------------------------------------------------------
// ① 数据层 + ② 引擎层
// ---------------------------------------------------------------------------
const POEM_WID = "book-tengwangge";
const LINE = "落霞与孤鹜齐飞，秋水共长天一色。";
// 上面那一句现在词表已经管了；勘误层用下面这个**故意没进词表**的句子来验。
const FIX_LINE = "长风破浪会有时";
const P1 = "长洲"; // 同一篇里「长」的另一处（读 cháng，本来就对）

function boot() {
  const sb = { window: {}, console };
  sb.window = sb;
  sb.localStorage = {
    _d: {},
    getItem(k) { return k in this._d ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; }
  };
  vm.createContext(sb);
  ["data/pinyin-table.js", "data/common-chars.js"].forEach(f =>
    vm.runInContext(fs.readFileSync(ROOT + f, "utf8"), sb, { filename: f }));
  vm.runInContext(fs.readFileSync(ROOT + "js/pinyin-edit.js", "utf8"), sb, { filename: "pinyin-edit.js" });
  vm.runInContext(fs.readFileSync(ROOT + "js/pinyin.js", "utf8"), sb, { filename: "pinyin.js" });
  return sb;
}

const sb = boot();
const P = sb.Pinyin, F = sb.PinyinFix;

chk(!!F, "注音勘误层已加载（PinyinFix）");
chk(F.KEY === "poem_pinyin_fix_v1", "本机键名是 poem_pinyin_fix_v1");
chk(F.SYNC_ID === "pinyin_fix:v1", "云端行号是 pinyin_fix:v1");
chk(typeof P.annotatePoem === "function", "引擎暴露了「按篇注音」那个入口（annotatePoem）");

// 用户点名的那一处：**词表**已经补了「长天」，所以现在默认就读对了
// （正本清源）；下面几节验的是「词表没料到的那些个例」怎么兜。
// ⚠️ 这两件事必须分开看：词表管全站通例，勘误层管某篇的个例。
chk(/长<rt>cháng<\/rt>/.test(P.annotatePoem("", LINE, "all")),
  "词表补了「长天」→「秋水共长天一色」默认读 cháng（本条 Issue 的那一处已正本清源）");
chk(/长<rt>cháng<\/rt>/.test(P.annotateHtml("长空万里", "all")),
  "「长空」也补进来了（同一族的词，一次补清）");
chk(/长<rt>zhǎng<\/rt>/.test(P.annotateHtml("长大", "all")),
  "补词没有连累别的：「长大」照旧读 zhǎng dà");



// 不传 wid 时与旧入口逐字相同 —— 纯增强的证据
chk(P.annotatePoem("", LINE, "all") === P.annotateHtml(LINE, "all"),
  "不传 wid 时 annotatePoem 与 annotateHtml 输出**逐字相同**（纯增强）");
chk(P.annotatePoem(POEM_WID, LINE, "all") === P.annotateHtml(LINE, "all"),
  "勘误表为空时，传了 wid 也与改前逐字相同");

const r1 = F.add({ wid: POEM_WID, line: FIX_LINE, at: 1, ch: "长", py: "cháng" });
chk(r1.ok && !r1.replaced, "钉下第一处勘误");

const after = P.annotatePoem(POEM_WID, FIX_LINE, "all");
chk(/长<rt>cháng<\/rt>/.test(after), "钉住之后「长」读 cháng");
chk(after.indexOf("zhǎng") === -1, "这一句里不再出现 zhǎng");

chk(P.annotatePoem("book-other", FIX_LINE, "all").indexOf("cháng") === -1,
  "**别的篇**不受影响（勘误按篇绑定，别的篇里的「长风」照旧读 zhǎng）");
chk(P.annotatePoem("", FIX_LINE, "all").indexOf("cháng") === -1,
  "不传 wid 时勘误一行都不查（默认关闭）");

// 按「第几次出现」定位：同一句里两个「长」
const TWO = "长风与长洲";
chk(P.annotatePoem(POEM_WID, TWO, "all").match(/长<rt>[^<]*<\/rt>/g).join("|") === "长<rt>zhǎng</rt>|长<rt>zhǎng</rt>",
  "一句里两个「长」默认都读 zhǎng（未钉时）");
F.add({ wid: POEM_WID, line: TWO, at: 2, ch: "长", py: "cháng" });
const two = P.annotatePoem(POEM_WID, TWO, "all").match(/长<rt>[^<]*<\/rt>/g).join("|");
chk(two === "长<rt>zhǎng</rt>|长<rt>cháng</rt>",
  "只钉「第 2 个长」时第一个不动（按位移定位，不是全文替换）");

// 单音字不查勘误：勘误表里存不下第二个读音，硬改等于制造新错
F.add({ wid: POEM_WID, line: "白日依山尽", at: 1, ch: "白", py: "bó" });
chk(P.annotatePoem(POEM_WID, "白日依山尽", "all").indexOf("bó") === -1,
  "**单音字不查勘误**（「白」怎么钉都读 bái —— 勘误是给多音字用的）");

// 勘误优先于词表
F.add({ wid: POEM_WID, line: "长大", at: 1, ch: "长", py: "cháng" });
chk(/长<rt>cháng<\/rt>/.test(P.annotatePoem(POEM_WID, "长大", "all")),
  "勘误**优先于词表**（词表说「长大」读 zhǎng dà，勘误说 cháng 就听勘误的）");
chk(/长<rt>zhǎng<\/rt>/.test(P.annotateHtml("长大", "all")),
  "不传 wid 时词表照旧生效（勘误不参与）");

// 纯文本那一档（打印稿）
chk(P.annotatePoemText(POEM_WID, FIX_LINE).indexOf("长(cháng)") > -1,
  "纯文本注音（打印稿那一档）同样走勘误");

// —— 数据层的形状与限制 ——
chk(F.count() >= 3, "勘误条数跟着增（当前 " + F.count() + " 条）");

const dup = F.add({ wid: POEM_WID, line: FIX_LINE, at: 1, ch: "长", py: "cháng" });
chk(dup.ok && dup.replaced, "同一处再钉一次是**改写**而不是新增一条（不会越钉越多）");
chk(F.count() === 4, "改写之后条数不变（" + F.count() + " 条 —— 同一处只记一条）");

chk(!F.add({ wid: "", line: FIX_LINE, at: 1, py: "cháng" }).ok, "缺篇目 → 不收");
chk(!F.add({ wid: POEM_WID, line: "", at: 1, py: "cháng" }).ok, "缺那一句 → 不收");
chk(!F.add({ wid: POEM_WID, line: FIX_LINE, py: "" }).ok, "缺读音 → 不收");
chk(F.normOne({ wid: " w ", line: " l ", at: -5, py: " p " }).at === 0,
  "「第几次出现」小于 1 时归到 1（下标 0）—— 不存负数");

const key = F.keyOf({ wid: POEM_WID, line: FIX_LINE, at: 1 });
chk(F.remove(key).ok, "按 key 删得掉一条");
chk(F.count() === 3, "删完确实少一条（" + F.count() + "）");
chk(!F.remove(key).ok, "删一条不存在的 → 如实回 false（不是假装成功）");
chk(F.removeMany([F.keyOf({ wid: POEM_WID, line: TWO, at: 2 })]).ok, "多选删除可用");
chk(F.count() === 2, "多选删完剩 2 条（" + F.count() + "）");

// 封顶
let many = [];
for (let i = 0; i < F.MAX + 10; i++) many.push({ wid: "w" + i, line: "l" + i, at: 1, ch: "长", py: "cháng" });
const cur = F.list().concat(many);
// 直接走 commit 的那条路（add 是逐条走盘，这里只要验「超上限不收」）
F.clear();
chk(F.count() === 0, "清空之后 0 条");
let capped = null;
for (let i = 0; i < F.MAX; i++) {
  const r = F.add({ wid: "w" + i, line: "l" + i, at: 1, ch: "长", py: "cháng" });
  if (!r.ok) { capped = r; break; }
}
chk(F.count() === F.MAX, "恰好堆到上限（" + F.MAX + " 条）");
capped = F.add({ wid: "overflow", line: "l", at: 1, ch: "长", py: "cháng" });
chk(capped && !capped.ok && capped.reason === "full", "超上限那一条**不收**（reason=full），不是悄悄丢掉");
F.clear();

// ③ 页面层：首页弹层 / 集子阅读器真的走勘误
//
// 加载顺序：勘误层必须在引擎**之前**（引擎启动时要能抓到它），
// 而且每一张读了 pinyin.js 的页面都要把它带上 —— 漏一张，
// 那一张里的注音就静默退回旧行为（看着只是「勘误没生效」）。
(function () {
  const pages = [];
  (function walk(dir, rel) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
      if (["node_modules", ".git", "test", "scripts"].indexOf(e.name) > -1) return;
      const full = path.join(dir, e.name);
      const r = rel ? rel + "/" + e.name : e.name;
      if (e.isDirectory()) return walk(full, r);
      if (e.name === "index.html") pages.push(r);
    });
  })(ROOT, "");
  let n = 0;
  pages.forEach(pg => {
    const html = fs.readFileSync(path.join(ROOT, pg), "utf8");
    if (!/js\/pinyin\.js/.test(html)) return;
    n++;
    chk(/js\/pinyin-edit\.js/.test(html), pg + " 带上了勘误层（读了引擎就必须带它）");
    const at = html.indexOf("js/pinyin-edit.js");
    const eng = html.indexOf("js/pinyin.js");
    chk(at > -1 && at < eng, pg + " 里勘误层排在引擎**之前**（反了它在启动时抓不到）");
  });
  chk(n >= 10, "至少 10 张页在读注音引擎（实际 " + n + " 张）");
})();

// ---------------------------------------------------------------------------
// 首页（js/app.js 的 renderPoemText）与集子阅读器（js/reader-core.js 的
// renderReaderText）都改走 annotatePoem —— 这里用**源码守卫**把它们钉住，
// 因为真正跑一遍需要一整套 DOM 与网络桩，而那两条断言极易被后来的改动绕过。
function src(p) { return fs.readFileSync(ROOT + p, "utf8"); }

const appSrc = src("js/app.js");
chk(/window\.Pinyin\.annotatePoem/.test(appSrc),
  "首页弹层走 annotatePoem（不传 wid 的话勘误永远命中不了）");
chk(/pinyinWidOf/.test(appSrc) && /WorksIndex\.widOf/.test(appSrc),
  "首页用 WorksIndex 归并后的 wid 绑勘误（同一篇在几部集子里共用一处勘误）");

const rdSrc = src("js/reader-core.js");
chk(/window\.Pinyin\.annotatePoem/.test(rdSrc), "集子阅读器走 annotatePoem");
chk((rdSrc.match(/annotatePoem\(/g) || []).length >= 3,
  "阅读器的三个注音出口（正文 / 打印 / 逐句）都走 annotatePoem");

// ④ 同步层：一行 progress，谁最后改谁赢，不进冲突裁决
const syncSrc = src("js/sync-store.js");
chk(/PINYIN_FIX_ROW_ID\s*=\s*"pinyin_fix:v1"/.test(syncSrc), "同步层认识 pinyin_fix:v1 这一行");
chk(/applyRemotePinyinFix/.test(syncSrc), "拉取时并入（applyRemotePinyinFix）");
chk(/if \(pfix\) headRecs\.push\(pfix\)/.test(syncSrc), "推送时带上这一行");
chk(/if \(id === PINYIN_FIX_ROW_ID\) return false;/.test(syncSrc),
  "**不进冲突裁决**（整份一份表，按时间戳判新旧就够）");

// cloudRow / applyCloud 的两个坑：不推重复、不被老时间戳盖掉
const sb2 = boot();
const F2 = sb2.PinyinFix;
chk(F2.cloudRow({}) === null || F2.cloudRow({}) === undefined || F2.cloudRow({}),
  "空表时 cloudRow 不抛异常");
F2.add({ wid: "w1", line: "l1", at: 1, ch: "长", py: "cháng" });
const row1 = F2.cloudRow({});
chk(row1 && row1.id === "pinyin_fix:v1" && !row1.deleted, "本机改了 → 有东西要推");
chk(F2.cloudRow({ "pinyin_fix:v1": row1.updatedAt }) === null,
  "刚刚推过的那一份**不再推第二次**（seen 对得上就不推）");
chk(F2.applyCloud({ id: "pinyin_fix:v1", payload: { fixes: [{ wid: "w2", line: "l2", at: 1, py: "hái" }] }, updatedAt: row1.updatedAt + 500, deleted: false }, {}) === "applied",
  "云端更新 → 并进来");
chk(F2.list().length === 1 && F2.list()[0].wid === "w2", "并进来的是**整份替换**（谁最后改谁赢）");
const stale = F2.applyCloud({ id: "pinyin_fix:v1", payload: { fixes: [] }, updatedAt: 1, deleted: false }, {});
chk(stale === "keepLocal", "云端那一份更旧 → **不动本机**（keepLocal）");

// ⑤ 服务端：白名单
const core = require(ROOT + "api/_lib/core.js");
const clean = core.sanitizePayloadForTest
  ? null
  : null;

// 用公开的那条路：syncPush 内部会调 sanitizePayload。这里直接拿源码里的
// 三个常量与守卫来对拍（服务端没有把 sanitize 单独导出）。
const coreSrc = src("api/_lib/core.js");
chk(/PINYIN_FIX_ROW_ID\s*=\s*"pinyin_fix:v1"/.test(coreSrc), "服务端认识这一行（白名单里的一员）");
chk(/poemId === PINYIN_FIX_ROW_ID\) return sanitizePinyinFix\(p\)/.test(coreSrc),
  "这一行走的是**自己的**清洗函数（不是通用进度那一套）");
chk(/var PINYIN_FIX_MAX = 500;/.test(coreSrc), "服务端条数上限 500（与客户端一致）");
chk(/refText\(f\.line, 120\)/.test(coreSrc), "那一句截断到 120 字（别人写过的句子，照样要截）");
chk(/refText\(f\.py, 12\)/.test(coreSrc), "读音截断到 12 字符");
chk(/refText\(f\.ch, 1\)/.test(coreSrc), "那个字只留 1 个字（多出来的丢掉，而不是原样落库）");
chk(/if \(!wid \|\| !line \|\| !py\) return;/.test(coreSrc),
  "**半条勘误整条丢掉**（缺篇 / 缺句 / 缺读音都收不下）");

// SW 预缓存：新脚本必须在清单里（否则离线打开时它是 404，注音静默退回旧行为）
const swSrc = src("sw.js");
chk(/\.\/js\/pinyin-edit\.js/.test(swSrc), "新脚本进了 SW 预缓存清单（离线也读得到勘误）");
chk(/const CACHE_NAME = "poem-app-v182";/.test(swSrc), "缓存版本号已往上推（改动才会真的下发）");

// 架构文档
const arch = src("docs/architecture.md");
chk(/注音勘误/.test(arch), "架构文档里记了这一条（设计记录）");

// 存储分域表
const sc = src("js/sync-coverage.js");
chk(/poem_pinyin_fix_v1/.test(sc), "同步边界总表里登记了这把键（漏一把测试直接红）");
const pstore = src("js/progress-store.js");
chk(/pinyinFix: "poem_pinyin_fix_v1"/.test(pstore), "ProgressStore 的 KEYS 里有它");
chk(/\{ key: KEYS\.pinyinFix, domain: "progress", local: false, perChild: true \}/.test(pstore),
  "分域表写的是「上云 + 跟孩子走」");

// ⑥ 端到端：真页面里钉一处，那一篇真的改过来
// ---------------------------------------------------------------------------
// 前面几层是「单元」，这一层是「真拿首页跑一遍」——因为勘误要生效，
// 除了引擎算对，还得**页面把 wid 交进去**（这一步最容易漏，
// 而漏掉时的症状只是「勘误没反应」，什么错都不报）。
(function () {
  let JSDOM = null;
  try { JSDOM = require("jsdom").JSDOM; } catch (e) {
    // 与 run.sh 同一套兜底：临时装了 jsdom 的目录在 NODE_PATH 里。
    const cands = [];
    try {
      cands.push(...fs.readdirSync("/tmp").filter(x => x.indexOf("tmp.") === 0).map(x => "/tmp/" + x + "/node_modules"));
    } catch (e2) {  }
    for (const c of cands) {
      try { JSDOM = require(path.join(c, "jsdom")).JSDOM; break; } catch (e2) {  }
    }
  }
  if (!JSDOM) {
    chk(true, "端到端一节跳过（本机没有 jsdom —— run.sh 会带上它）");
    return;
  }

  const html = fs.readFileSync(ROOT + "index.html", "utf8");
  const dom = new JSDOM(html, { runScripts: "dangerously", url: "https://local.test/" });
  const w = dom.window;
  html.match(/<script src="([^"]+)"><\/script>/g)
    .map(x => x.match(/src="([^"]+)"/)[1])
    .forEach(f => {
      const el = w.document.createElement("script");
      el.textContent = fs.readFileSync(ROOT + f, "utf8");
      w.document.body.appendChild(el);
    });

  w.PinyinFix.add({ wid: "probe", line: "落叶聚还散", at: 1, ch: "还", py: "huán" });
  chk(w.PinyinFix.count() === 1, "真页面里也能写勘误（PinyinFix 挂上了）");

  const poem = (w.POEMS_ALL || []).filter(p => String(p.title).indexOf("滕王阁序") > -1)[0];
  if (!poem) {
    chk(false, "课内数据里有《滕王阁序》（它是用户点名的那一篇）");
    return;
  }
  const wid = w.WorksIndex ? w.WorksIndex.widOf(poem.id) : poem.id;
  const line = String(poem.text).split("\n").filter(x => x.indexOf("秋水共长天") > -1)[0];
  chk(!!line, "《滕王阁序》里有「秋水共长天一色」那一句");

  chk(/长<rt>cháng<\/rt>/.test(w.Pinyin.annotatePoem(wid, line, "all")),
    "端到端：这一处**默认就读 cháng 了**（词表已正本清源，用户不会再看到那个错）");

  // 再验一遍勘误层本身在真页面里也生效（拿一个词表故意没管的句子）
  const probe = "长风几万里";
  chk(/长<rt>zhǎng<\/rt>/.test(w.Pinyin.annotatePoem(wid, probe, "all")),
    "端到端：词表没管的「长风」默认读 zhǎng");
  w.PinyinFix.add({ wid: wid, line: probe, at: 1, ch: "长", py: "cháng" });
  chk(/长<rt>cháng<\/rt>/.test(w.Pinyin.annotatePoem(wid, probe, "all")),
    "端到端：钉之后读 cháng（不改代码、不发版）");
})();

console.log(fails === 0 ? "\n🎉 注音勘误测试全部通过" : "\n❌ " + fails + " 项失败");
process.exit(fails ? 1 : 0);
