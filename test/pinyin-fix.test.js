"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..") + "/";

let fails = 0;
const chk = (c, m) => { if (!c) { console.log("✗ " + m); fails++; } else console.log("✓ " + m); };

const POEM_WID = "book-tengwangge";
const LINE = "落霞与孤鹜齐飞，秋水共长天一色。";

const FIX_LINE = "长风破浪会有时";
const P1 = "长洲";

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

chk(/长<rt>cháng<\/rt>/.test(P.annotatePoem("", LINE, "all")),
  "词表补了「长天」→「秋水共长天一色」默认读 cháng（本条 Issue 的那一处已正本清源）");
chk(/长<rt>cháng<\/rt>/.test(P.annotateHtml("长空万里", "all")),
  "「长空」也补进来了（同一族的词，一次补清）");
chk(/长<rt>zhǎng<\/rt>/.test(P.annotateHtml("长大", "all")),
  "补词没有连累别的：「长大」照旧读 zhǎng dà");

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

const TWO = "长风与长洲";
chk(P.annotatePoem(POEM_WID, TWO, "all").match(/长<rt>[^<]*<\/rt>/g).join("|") === "长<rt>zhǎng</rt>|长<rt>zhǎng</rt>",
  "一句里两个「长」默认都读 zhǎng（未钉时）");
F.add({ wid: POEM_WID, line: TWO, at: 2, ch: "长", py: "cháng" });
const two = P.annotatePoem(POEM_WID, TWO, "all").match(/长<rt>[^<]*<\/rt>/g).join("|");
chk(two === "长<rt>zhǎng</rt>|长<rt>cháng</rt>",
  "只钉「第 2 个长」时第一个不动（按位移定位，不是全文替换）");

F.add({ wid: POEM_WID, line: "白日依山尽", at: 1, ch: "白", py: "bó" });
chk(P.annotatePoem(POEM_WID, "白日依山尽", "all").indexOf("bó") === -1,
  "**单音字不查勘误**（「白」怎么钉都读 bái —— 勘误是给多音字用的）");

F.add({ wid: POEM_WID, line: "长大", at: 1, ch: "长", py: "cháng" });
chk(/长<rt>cháng<\/rt>/.test(P.annotatePoem(POEM_WID, "长大", "all")),
  "勘误**优先于词表**（词表说「长大」读 zhǎng dà，勘误说 cháng 就听勘误的）");
chk(/长<rt>zhǎng<\/rt>/.test(P.annotateHtml("长大", "all")),
  "不传 wid 时词表照旧生效（勘误不参与）");

chk(P.annotatePoemText(POEM_WID, FIX_LINE).indexOf("长(cháng)") > -1,
  "纯文本注音（打印稿那一档）同样走勘误");

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

let many = [];
for (let i = 0; i < F.MAX + 10; i++) many.push({ wid: "w" + i, line: "l" + i, at: 1, ch: "长", py: "cháng" });
const cur = F.list().concat(many);

F.clear();
chk(F.count() === 0, "清空之后 0 条");

F.applyCloud({ id: "pinyin_fix:v1", deleted: false, updatedAt: Date.now() + 1000,
  payload: { fixes: Array.from({ length: F.MAX }, (_, i) =>
    ({ wid: "w" + i, line: "l" + i, at: 1, ch: "长", py: "cháng" })) } }, {});
chk(F.count() === F.MAX, "恰好堆到上限（" + F.MAX + " 条）");
const capped = F.add({ wid: "overflow", line: "l", at: 1, ch: "长", py: "cháng" });
chk(capped && !capped.ok && capped.reason === "full", "超上限那一条**不收**（reason=full），不是悄悄丢掉");
F.clear();

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

function src(p) { return fs.readFileSync(ROOT + p, "utf8"); }

const appSrc = src("js/app.js");
chk(/window\.Pinyin\.annotatePoem/.test(appSrc),
  "首页弹层走 annotatePoem（不传 wid 的话勘误永远命中不了）");
chk(/pinyinWidOf/.test(appSrc) && /WorksIndex\.widOf/.test(appSrc),
  "首页用 WorksIndex 归并后的 wid 绑勘误（同一篇在几部集子里共用一处勘误）");

const rdSrc = src("js/reader-core.js");

/* 阅读器的注音**只有一个出口**（Issue #347 起）：
   正文要把「表格」与「注音」一起渲染，三个调用点各写一遍迟早有一处漏掉，
   所以收成一个 `annotateLine(wid, line, mode)` —— 正文、打印、逐句都从它走。
   判据也跟着改：认「出口只有一个」，而不是数调用点有几次。 */
chk(/function annotateLine\(wid, line, mode\)/.test(rdSrc),
  "集子阅读器的注音收成一个出口 annotateLine（wid / 行 / 模式）");
chk(/window\.Pinyin\.annotatePoem/.test(rdSrc), "那个出口走 annotatePoem（传 wid，勘误才命中）");
chk((rdSrc.match(/annotateLine\(/g) || []).length >= 3,
  "正文 / 打印 / 逐句三处都经 annotateLine（不再各写一遍）");
chk(!/annotateHtml\(current/.test(rdSrc),
  "页面层不再直接把整篇丢给 annotateHtml（那样表格画不出来）");

const syncSrc = src("js/sync-store.js");
chk(/PINYIN_FIX_ROW_ID\s*=\s*"pinyin_fix:v1"/.test(syncSrc), "同步层认识 pinyin_fix:v1 这一行");
chk(/applyRemotePinyinFix/.test(syncSrc), "拉取时并入（applyRemotePinyinFix）");
chk(/if \(pfix\) headRecs\.push\(pfix\)/.test(syncSrc), "推送时带上这一行");
chk(/if \(id === PINYIN_FIX_ROW_ID\) return false;/.test(syncSrc),
  "**不进冲突裁决**（整份一份表，按时间戳判新旧就够）");

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

const core = require(ROOT + "api/_lib/core.js");
const clean = core.sanitizePayloadForTest
  ? null
  : null;

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

const swSrc = src("sw.js");
chk(/\.\/js\/pinyin-edit\.js/.test(swSrc), "新脚本进了 SW 预缓存清单（离线也读得到勘误）");

const ver = parseInt((swSrc.match(/poem-app-v(\d+)/) || [0, "0"])[1], 10);
chk(ver >= 187, "缓存版本号已往上推（改动才会真的下发，实际 v" + ver + "）");

const arch = src("docs/architecture.md");
chk(/注音勘误/.test(arch), "架构文档里记了这一条（设计记录）");

const sc = src("js/sync-coverage.js");
chk(/poem_pinyin_fix_v1/.test(sc), "同步边界总表里登记了这把键（漏一把测试直接红）");
const pstore = src("js/progress-store.js");
chk(/pinyinFix: "poem_pinyin_fix_v1"/.test(pstore), "ProgressStore 的 KEYS 里有它");
chk(/\{ key: KEYS\.pinyinFix, domain: "progress", local: false, perChild: true \}/.test(pstore),
  "分域表写的是「上云 + 跟孩子走」");

console.log(fails === 0 ? "\n🎉 注音勘误测试全部通过" : "\n❌ " + fails + " 项失败");
process.exit(fails ? 1 : 0);
