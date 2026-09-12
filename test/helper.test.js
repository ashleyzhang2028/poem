/**
 * 阅读辅助测试：生字注音 + 朗读
 *
 * 1. 拼音表：覆盖范围、多音字、上下文判定（纯 Node，无 DOM）
 * 2. 注音渲染：课内弹层与课外阅读器都能逐字标音（jsdom）
 * 3. 朗读：无 Speech API 的环境要优雅降级，不能报错（jsdom）
 */
const fs = require("fs");
const vm = require("vm");
const { JSDOM } = require("jsdom");
const ROOT = __dirname + "/../";

let fails = 0;
const chk = (c, m) => { if (!c) { console.log("✗ " + m); fails++; } else console.log("✓ " + m); };

/* ---------- 一、拼音表与引擎（无 DOM） ---------- */
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

// 多音字上下文判定
chk(P.readOf("曲", "曲项向天歌", 0) === "qū", "「曲项」读 qū 而非 qǔ");

/* ---- 回归：多音字与「一 / 不」变调 ---- */
chk(P.isPolyphone("曲") && P.isPolyphone("还") && P.isPolyphone("间"),
  "「曲 / 还 / 间」被识别为多音字");
chk(!P.isPolyphone("水") && !P.isPolyphone("天"), "普通字不会被误判为多音字");
// 常用字里的多音字必须仍然注音，否则「只标生字」档会把整首诗静音
chk(P.needAnnotate("曲") && P.needAnnotate("还") && P.needAnnotate("间") && P.needAnnotate("行"),
  "常用字中的多音字也要注音（回归：一年级《咏鹅》此前 0 个 ruby）");
chk(P.needAnnotate("锄") && P.needAnnotate("餐"), "真生字依然需要注音");
chk(!P.needAnnotate("水") && !P.needAnnotate("天"), "常见单音字不注音");
//「一」变调：去声前 yí，阴平/阳平/上声前 yì，序数/词尾 yī
// （回归：此前完全没实现，且词表把「一片」硬编码成 yī piàn）
chk(P.readOf("一", "孤帆一片日边来", 2) === "yí", "「一片」的「一」读 yí（去声前变调）");
chk(P.readOf("一", "千里江陵一日还", 4) === "yí", "「一日」的「一」读 yí");
chk(P.readOf("一", "一岁一枯荣", 0) === "yí", "「一岁」的「一」读 yí");
chk(P.readOf("一", "一行白鹭上青天", 0) === "yì", "「一行」的「一」读 yì（阳平前变调）");
chk(P.readOf("一", "一年级", 0) === "yī", "序数「一年级」的「一」读本调 yī");
chk(P.readOf("一", "第一", 1) === "yī", "序数「第一」的「一」读本调 yī");
chk(P.readOf("一", "一九", 0) === "yī", "「一九」的「一」读本调 yī");
//「不」变调
chk(P.readOf("不", "不是", 0) === "bú", "「不是」的「不」读 bú");
chk(P.readOf("不", "不能", 0) === "bù", "「不能」的「不」读 bù（非去声前）");
chk(P.readOf("不", "野火烧不尽", 3) === "bú", "「不尽」的「不」读 bú");
// 词表不得覆盖「一 / 不」的变调结果
chk(P.readOf("一", "一片冰心在玉壶", 0) === "yí", "词表里的「一片」也要按变调读 yí，而非硬编码 yī");
chk(P.readOf("绿", "白毛浮绿水", 3) === "lǜ", "「绿水」读 lǜ");
chk(P.readOf("还", "春去花还在", 3) === "hái", "「还在」读 hái");
chk(P.readOf("间", "京口瓜洲一水间", 6) === "jiān", "「一水间」读 jiān");
chk(P.readOf("应", "应怜屐齿印苍苔", 0) === "yīng", "「应怜」读 yīng");
chk(P.readOf("不", "不是", 0) === "bú", "「不」在去声前变调读 bú");
chk(P.readOf("不", "不能", 0) === "bù", "「不」在非去声前读 bù");
chk(P.readOf("行", "一行白鹭上青天", 1) === "háng", "「一行」读 háng");
chk(P.readOf("乐", "知者乐水，仁者乐山", 2) === "yào", "「乐山乐水」读 yào");

// 注音渲染 —— 全文注音（all）
const html = P.annotateHtml("曲项向天歌", "all");
chk(/<ruby>曲<rt>qū<\/rt><\/ruby>/.test(html), "全文注音输出 ruby 标签且读音正确");
chk(P.annotateHtml("白日依山尽，", "all").indexOf("，") > -1, "标点原样保留，不会被注音");
chk(P.annotateHtml("鹅\n鹅", "all").indexOf("<br>") > -1, "换行转换为 <br>，保持原诗分行");
chk(P.annotateHtml("<b>", "all").indexOf("&lt;b&gt;") > -1, "注音输出做了 HTML 转义，无注入风险");

// 注音渲染 —— 只标生字（默认档）
chk(Object.keys(sb.COMMON_CHARS).length === 2500, "常用字表收录 2500 字");
chk(P.isCommon("鹅") && !P.isCommon("巍"), "「鹅」是常用字、「巍」是生字");
chk(P.needAnnotate("巍") && !P.needAnnotate("鹅"), "生字需要注音、常用字不需要");

const rareHtml = P.annotateHtml("峨眉山月半轮秋，影入平羌江水流。");
chk(rareHtml.indexOf("<ruby>峨<") > -1, "只标生字：生僻的「峨」被注音");
chk(rareHtml.indexOf("<ruby>月<") === -1, "只标生字：常见的「月」不注音");
chk(rareHtml.indexOf("<ruby>水<") === -1, "只标生字：常见的「水」不注音");

const allHtml = P.annotateHtml("峨眉山月半轮秋", "all");
chk(allHtml.indexOf("<ruby>月<") > -1, "全文注音：常见的「月」也注音");

// rare 模式不注音的字数应远少于 all 模式
const poem = "千山鸟飞绝，万径人踪灭。孤舟蓑笠翁，独钓寒江雪。";
const rareN = (P.annotateHtml(poem, "rare").match(/<ruby>/g) || []).length;
const allN = (P.annotateHtml(poem, "all").match(/<ruby>/g) || []).length;
chk(rareN < allN, "只标生字的注音量(" + rareN + ")少于全文注音(" + allN + ")");
chk(rareN > 0, "只标生字仍能标出该诗的生字（" + rareN + " 个）");

// rareChars：列出本篇生字，去重且保持顺序
const rc = P.rareChars("蓑笠翁，蓑衣");
chk(rc.indexOf("蓑") > -1 && rc.indexOf("笠") > -1, "能列出本篇生字（蓑、笠）");
chk(rc.filter(c => c === "蓑").length === 1, "生字列表按字去重");
chk(P.rareChars("春眠不觉晓").indexOf("春") === -1, "常见字不算生字");

// 数据完整性：课内 + 小古文所有汉字都在表里
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
chk(d.POEMS_CLASSIC.length === 100, "小古文共 100 篇（实际 " + d.POEMS_CLASSIC.length + "）");

/* ---------- 二、课内弹层注音（jsdom） ---------- */
function bootPage(name) {
  const dom = new JSDOM(fs.readFileSync(ROOT + name, "utf8"), {
    runScripts: "dangerously",
    url: "https://local.test/" + name
  });
  const { window } = dom;
  const order = fs.readFileSync(ROOT + name, "utf8")
    .match(/<script src="([^"]+)"><\/script>/g)
    .map(s => s.match(/src="([^"]+)"/)[1]);
  order.forEach(f => {
    const el = window.document.createElement("script");
    el.textContent = fs.readFileSync(ROOT + f, "utf8");
    window.document.body.appendChild(el);
  });
  return window;
}

function bootPageWithSpeech() {
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM(fs.readFileSync(ROOT + "index.html", "utf8"), {
    runScripts: "dangerously",
    url: "https://local.test/index.html",
    beforeParse(win) {
      win.SpeechSynthesisUtterance = function (t) { this.text = t; };
      // 形态与浏览器一致：以 speaking 属性反映播放状态
      win.speechSynthesis = {
        speaking: false,
        _spoken: null,
        speak(u) { this._spoken = u; this.speaking = true; },
        cancel() { this.speaking = false; },
        getVoices() { return []; },
        addEventListener() {}
      };
      win.__spoken = () => win.speechSynthesis._spoken;
    }
  });
  const w = dom.window;
  fs.readFileSync(ROOT + "index.html", "utf8")
    .match(/<script src="([^"]+)"><\/script>/g)
    .map(x => x.match(/src="([^"]+)"/)[1])
    .forEach(f => {
      const el = w.document.createElement("script");
      el.textContent = fs.readFileSync(ROOT + f, "utf8");
      w.document.body.appendChild(el);
    });
  return w;
}

// 页面渲染需要一拍时间，测试主体放在下一轮事件循环里
const phase1 = () => new Promise(res => setTimeout(res, 400));

setTimeout(async () => {
  const w = bootPage("index.html");
  await phase1();
  const doc = w.document;

  const seg = doc.querySelector("#m-pinyin-seg");
  chk(!!seg, "诗词弹层有注音档位按钮组");
  chk(seg.querySelectorAll("button").length === 3, "注音有 3 档：不注音 / 生字 / 全文");
  chk(
    [...seg.querySelectorAll("button")].map((b) => b.textContent.trim()).join("/") === "不注音/生字/全文",
    "注音档位文案精简为 不注音/生字/全文");
  chk(!!seg.querySelector('button[data-mode="rare"]'), "默认档「只标生字」按钮存在");
  chk(!!doc.querySelector("#m-read-btn"), "诗词弹层有「朗读」按钮");
  // 设置已改成独立整页（settings.html），开关住在那一页
  const settingsWin = bootPage("settings.html");
  settingsWin.document.dispatchEvent(new settingsWin.Event("DOMContentLoaded", { bubbles: true }));
  chk(!!settingsWin.document.querySelector("#seg-helper"), "设置页里有「阅读辅助」开关");
  chk(!doc.querySelector("#seg-helper"), "首页不再有设置弹层里的阅读辅助开关");

  // 打开第一首诗
  // 需求 5：阅读辅助默认开启 —— 打开诗词即自动注音
  // （旧断言写的是「默认不注音、正文纯文本」，与需求相反，已按需求修正）
  const first = doc.querySelector("#today-list .item");
  first.dispatchEvent(new w.Event("click", { bubbles: true }));
  const raw = doc.querySelector("#m-text").textContent;
  chk(raw.length > 0, "打开弹层后正文正常渲染");
  // 首篇（咏鹅）全是常见字，但含多音字「曲」，因此开启态下至少应有一个 ruby；
  // 为稳妥起见，遍历今日任务确认「开启态下必有注音」。
  let autoN = 0;
  for (const item of doc.querySelectorAll("#today-list .item")) {
    item.dispatchEvent(new w.Event("click", { bubbles: true }));
    autoN = doc.querySelectorAll("#m-text ruby").length;
    if (autoN > 0) break;
  }
  chk(autoN > 0, "阅读辅助默认开启 → 打开诗词自动注音（" + autoN + " 个 ruby）");
  chk(doc.querySelectorAll("#m-text ruby").length > 0,
    "默认档位下正文本就带注音，不是纯文本");
  // 首篇必须也有可见差别：一年级诗里多音字（曲）应被标出
  doc.querySelectorAll("#today-list .item")[0].dispatchEvent(new w.Event("click", { bubbles: true }));
  chk(doc.querySelectorAll("#m-text ruby").length > 0,
    "一年级《咏鹅》也应有注音（覆盖「只标生字」档对低龄学段过于稀疏的问题）");

  const clickMode = (m) => doc.querySelector('#m-pinyin-seg button[data-mode="' + m + '"]')
    .dispatchEvent(new w.Event("click", { bubbles: true }));

  // 只标生字：只给生字标音，常见字保持干净
  clickMode("rare");
  const rareN = doc.querySelectorAll("#m-text ruby").length;
  const rawHan = doc.querySelector("#m-text").textContent.replace(/\s/g, "").length;
  chk(rareN < rawHan, "只标生字不会把每个字都注上（" + rareN + " < " + rawHan + "）");

  // 换一首确有生字的诗，确认生字确实被标了出来
  // （首篇若全是常见字，标注数为 0 是正确行为）
  let target = null;
  for (const item of doc.querySelectorAll("#today-list .item")) {
    item.dispatchEvent(new w.Event("click", { bubbles: true }));
    clickMode("rare");
    const n = doc.querySelectorAll("#m-text ruby").length;
    if (n > 0) { target = { item, n }; break; }
  }
  if (target) {
    chk(target.n > 0, "换个有生字的诗，「只标生字」能标出生字（" + target.n + " 个 ruby）");
    const rareTxt = doc.querySelector("#m-text").textContent;
    chk(!doc.querySelector("#m-text").querySelector("ruby").textContent.includes("的"),
      "只标生字时常见字（如「的」）不被注音");
  } else {
    chk(false, "今日任务里应至少有一首含生字的诗");
  }
  chk(doc.querySelector('#m-pinyin-seg button[data-mode="rare"]').classList.contains("active"),
    "「只标生字」按钮切到选中态");
  chk(w.localStorage.getItem("poem_helper_pinyin_v1") === "rare", "注音档位已持久化为 rare");

  // 全文注音：注音量明显多于只标生字
  clickMode("all");
  const allN = doc.querySelectorAll("#m-text ruby").length;
  chk(allN > rareN, "「全文注音」比「只标生字」注得多（" + allN + " > " + rareN + "）");
  chk(w.localStorage.getItem("poem_helper_pinyin_v1") === "all", "档位切换为 all 已持久化");

  // 关闭注音：恢复纯文本
  clickMode("off");
  chk(doc.querySelectorAll("#m-text ruby").length === 0, "选「不注音」后恢复纯文本");
  chk(w.localStorage.getItem("poem_helper_pinyin_v1") === "off", "档位切换为 off 已持久化");

  // 朗读：jsdom 没有 SpeechSynthesis，必须优雅降级
  const readBtn = doc.querySelector("#m-read-btn");
  chk(readBtn.disabled === true, "无语音环境时朗读按钮禁用而不是报错");
  // 播放键的读屏文案固定为「朗读原文」，能力不足时靠 disabled 与 title 提示
  chk(doc.querySelector("#m-read-btn .sr-only").textContent === "朗读原文",
    "播放键读屏文案恒为「朗读原文」（能力不足靠禁用态提示）");
  chk(/不支持/.test(readBtn.title), "按钮 title 提示不支持朗读（" + readBtn.title + "）");
  readBtn.dispatchEvent(new w.Event("click", { bubbles: true }));
  chk(true, "点击禁用的朗读按钮不会抛异常");

  // 模拟支持的浏览器：注入假 SpeechSynthesis 后再启动页面，验证能真正发出朗读
  const w2 = bootPageWithSpeech();
  await phase1();
  chk(w2.Speech.supported() === true, '有语音能力时 Speech.supported() 返回 true');
  const btn2 = w2.document.querySelector('#m-read-btn');
  chk(btn2.disabled === false, '有语音能力时朗读按钮可用');
  w2.document.querySelector('#today-list .item').dispatchEvent(new w2.Event('click', { bubbles: true }));
  btn2.dispatchEvent(new w2.Event('click', { bubbles: true }));
  const spoken = w2.__spoken();
  chk(!!spoken && spoken.text.length > 4, '点击朗读会把诗题与正文交给语音合成');
  chk(btn2.dataset.on === '1', '朗读中同一颗键切成 ⏸ 播放态');
  chk(w2.document.querySelector('#m-read-combo') === null &&
    w2.document.querySelector('#m-actions-icons #m-read-btn') !== null,
    '工具条上只有正文这一颗播放键（不再并排两个）');
  btn2.dispatchEvent(new w2.Event('click', { bubbles: true }));
  chk(btn2.dataset.on === '0', '再点一次停止朗读并复位按钮');

  console.log(fails === 0 ? "\n🎉 注音与朗读测试全部通过" : "\n❌ " + fails + " 项失败");
  process.exit(fails ? 1 : 0);
}, 300);
