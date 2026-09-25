const fs = require("fs");
const vm = require("vm");
// Issue #278：页面层（jsdom 真跑首页 / 设置页）已删除，只留注音内核。
const ROOT = __dirname + "/../";

let fails = 0;
const chk = (c, m) => { if (!c) { console.log("✗ " + m); fails++; } else console.log("✓ " + m); };

const sb = { window: {}, console };
sb.window = sb;
vm.createContext(sb);
vm.runInContext(fs.readFileSync(ROOT + "data/pinyin-table.js", "utf8"), sb, { filename: "pinyin-table.js" });
vm.runInContext(fs.readFileSync(ROOT + "data/common-chars.js", "utf8"), sb, { filename: "common-chars.js" });
vm.runInContext(fs.readFileSync(ROOT + "js/pinyin.js", "utf8"), sb, { filename: "pinyin.js" });
const P = sb.Pinyin;
const TABLE = sb.PINYIN_TABLE;

chk(Object.keys(TABLE).length > 2200, "拼音表收录 " + Object.keys(TABLE).length + " 个汉字");
chk(P.has("曰") && P.read("曰") === "yuē", "「曰」注音为 yuē");
chk(P.read("媪") === "ǎo", "「媪」注音为 ǎo");
chk(P.read("杵") === "chǔ", "「杵」注音为 chǔ");
chk(P.read("鹄") === "hú", "「鹄」注音为 hú");
chk(P.read("汩") == null || true, "生僻字查不到时不抛异常");

chk(P.readOf("曲", "曲项向天歌", 0) === "qū", "「曲项」读 qū 而非 qǔ");

chk(P.isPolyphone("曲") && P.isPolyphone("还") && P.isPolyphone("间"),
  "「曲 / 还 / 间」被识别为多音字");
chk(!P.isPolyphone("水") && !P.isPolyphone("天"), "普通字不会被误判为多音字");

chk(P.needAnnotate("曲") && P.needAnnotate("还") && P.needAnnotate("间") && P.needAnnotate("行"),
  "常用字中的多音字也要注音（回归：一年级《咏鹅》此前 0 个 ruby）");
chk(P.needAnnotate("锄") && P.needAnnotate("餐"), "真生字依然需要注音");
chk(!P.needAnnotate("水") && !P.needAnnotate("天"), "常见单音字不注音");

chk(P.readOf("一", "孤帆一片日边来", 2) === "yí", "「一片」的「一」读 yí（去声前变调）");
chk(P.readOf("一", "千里江陵一日还", 4) === "yí", "「一日」的「一」读 yí");
chk(P.readOf("一", "一岁一枯荣", 0) === "yí", "「一岁」的「一」读 yí");
chk(P.readOf("一", "一行白鹭上青天", 0) === "yì", "「一行」的「一」读 yì（阳平前变调）");
chk(P.readOf("一", "一年级", 0) === "yī", "序数「一年级」的「一」读本调 yī");
chk(P.readOf("一", "第一", 1) === "yī", "序数「第一」的「一」读本调 yī");
chk(P.readOf("一", "一九", 0) === "yī", "「一九」的「一」读本调 yī");

chk(P.readOf("不", "不是", 0) === "bú", "「不是」的「不」读 bú");
chk(P.readOf("不", "不能", 0) === "bù", "「不能」的「不」读 bù（非去声前）");
chk(P.readOf("不", "野火烧不尽", 3) === "bú", "「不尽」的「不」读 bú");

chk(P.readOf("一", "一片冰心在玉壶", 0) === "yí", "词表里的「一片」也要按变调读 yí，而非硬编码 yī");
chk(P.readOf("绿", "白毛浮绿水", 3) === "lǜ", "「绿水」读 lǜ");
chk(P.readOf("还", "春去花还在", 3) === "hái", "「还在」读 hái");
chk(P.readOf("间", "京口瓜洲一水间", 6) === "jiān", "「一水间」读 jiān");
chk(P.readOf("应", "应怜屐齿印苍苔", 0) === "yīng", "「应怜」读 yīng");
chk(P.readOf("不", "不是", 0) === "bú", "「不」在去声前变调读 bú");
chk(P.readOf("不", "不能", 0) === "bù", "「不」在非去声前读 bù");
chk(P.readOf("行", "一行白鹭上青天", 1) === "háng", "「一行」读 háng");
chk(P.readOf("乐", "知者乐水，仁者乐山", 2) === "yào", "「乐山乐水」读 yào");

const html = P.annotateHtml("曲项向天歌", "all");
chk(/<ruby>曲<rt>qū<\/rt><\/ruby>/.test(html), "全文注音输出 ruby 标签且读音正确");
chk(P.annotateHtml("白日依山尽，", "all").indexOf("，") > -1, "标点原样保留，不会被注音");
chk(P.annotateHtml("鹅\n鹅", "all").indexOf("<br>") > -1, "换行转换为 <br>，保持原诗分行");
chk(P.annotateHtml("<b>", "all").indexOf("&lt;b&gt;") > -1, "注音输出做了 HTML 转义，无注入风险");

const COMMON_N = Object.keys(sb.COMMON_CHARS).length;
chk(COMMON_N >= 2500 && COMMON_N <= 3000,
  "常用字表仍在小学识字量的量级（2500~3000 字，实际 " + COMMON_N + "）");
chk(P.isCommon("鹅") && !P.isCommon("巍"), "「鹅」是常用字、「巍」是生字");
chk(P.needAnnotate("巍") && !P.needAnnotate("鹅"), "生字需要注音、常用字不需要");

const rareHtml = P.annotateHtml("峨眉山月半轮秋，影入平羌江水流。");
chk(rareHtml.indexOf("<ruby>峨<") > -1, "只标生字：生僻的「峨」被注音");
chk(rareHtml.indexOf("<ruby>月<") === -1, "只标生字：常见的「月」不注音");
chk(rareHtml.indexOf("<ruby>水<") === -1, "只标生字：常见的「水」不注音");

const allHtml = P.annotateHtml("峨眉山月半轮秋", "all");
chk(allHtml.indexOf("<ruby>月<") > -1, "全文注音：常见的「月」也注音");

const poem = "千山鸟飞绝，万径人踪灭。孤舟蓑笠翁，独钓寒江雪。";
const rareN = (P.annotateHtml(poem, "rare").match(/<ruby>/g) || []).length;
const allN = (P.annotateHtml(poem, "all").match(/<ruby>/g) || []).length;
chk(rareN < allN, "只标生字的注音量(" + rareN + ")少于全文注音(" + allN + ")");
chk(rareN > 0, "只标生字仍能标出该诗的生字（" + rareN + " 个）");

const rc = P.rareChars("蓑笠翁，蓑衣");
chk(rc.indexOf("蓑") > -1 && rc.indexOf("笠") > -1, "能列出本篇生字（蓑、笠）");
chk(rc.filter(c => c === "蓑").length === 1, "生字列表按字去重");
chk(P.rareChars("春眠不觉晓").indexOf("春") === -1, "常见字不算生字");

const d = { window: {}, console };
d.window = d;
vm.createContext(d);
["poems-1", "poems-2", "poems-3", "poems-4", "poems-5", "poems-6", "poems-7", "poems-8", "poems-9",
  "poems-10", "poems-11", "poems-12"].forEach(f =>
  vm.runInContext(fs.readFileSync(ROOT + "data/" + f + ".js", "utf8"), d, { filename: f }));
vm.runInContext(fs.readFileSync(ROOT + "data/index.js", "utf8"), d, { filename: "index.js" });
vm.runInContext(fs.readFileSync(ROOT + "data/poems-classic.js", "utf8"), d, { filename: "poems-classic.js" });

const allText = [...d.POEMS_ALL, ...d.POEMS_CLASSIC].map(p => p.text).join("");
const missing = [...new Set([...allText].filter(c => /\p{Script=Han}/u.test(c) && !P.has(c)))];
chk(missing.length === 0, "课内 + 小古文全部汉字都有注音（缺 " + missing.slice(0, 12).join("") + "）");
chk(d.POEMS_CLASSIC.length === 102, "小古文共 102 篇（实际 " + d.POEMS_CLASSIC.length + "）");

// ---------------------------------------------------------------------------
// Issue #278：这一层的**页面层**（jsdom 起首页 / 设置页、点弹层、切注音档、
// 朗读）整段删除 —— 那是界面测试。留下的是注音内核本身：拼音表 / 生字判定 /
// annotateHtml 的输出口径 / 全站汉字覆盖率。
// ---------------------------------------------------------------------------

console.log("");
console.log(fails ? "❌ " + fails + " 项失败" : "🎉 注音与朗读（内核）测试全部通过");
process.exit(fails ? 1 : 0);
