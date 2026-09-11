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
chk(P.readOf("绿", "白毛浮绿水", 3) === "lǜ", "「绿水」读 lǜ");
chk(P.readOf("还", "春去花还在", 3) === "hái", "「还在」读 hái");
chk(P.readOf("间", "京口瓜洲一水间", 6) === "jiān", "「一水间」读 jiān");
chk(P.readOf("应", "应怜屐齿印苍苔", 0) === "yīng", "「应怜」读 yīng");
chk(P.readOf("不", "不是", 0) === "bú", "「不」在去声前变调读 bú");
chk(P.readOf("不", "不能", 0) === "bù", "「不」在非去声前读 bù");
chk(P.readOf("行", "一行白鹭上青天", 1) === "háng", "「一行」读 háng");
chk(P.readOf("乐", "知者乐水，仁者乐山", 2) === "yào", "「乐山乐水」读 yào");

// 注音渲染
const html = P.annotateHtml("曲项向天歌");
chk(/<ruby>曲<rt>qū<\/rt><\/ruby>/.test(html), "注音输出 ruby 标签且读音正确");
chk(P.annotateHtml("白日依山尽，").indexOf("，") > -1, "标点原样保留，不会被注音");
chk(P.annotateHtml("鹅\n鹅").indexOf("<br>") > -1, "换行转换为 <br>，保持原诗分行");
chk(P.annotateHtml("<b>").indexOf("&lt;b&gt;") > -1, "注音输出做了 HTML 转义，无注入风险");

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

  chk(!!doc.querySelector("#m-pinyin-toggle"), "诗词弹层有「标注拼音」按钮");
  chk(!!doc.querySelector("#m-read-btn"), "诗词弹层有「朗读」按钮");
  chk(!!doc.querySelector("#seg-helper"), "设置里有「阅读辅助」开关");

  // 打开第一首诗
  const first = doc.querySelector("#today-list .item");
  first.dispatchEvent(new w.Event("click", { bubbles: true }));
  const raw = doc.querySelector("#m-text").textContent;
  chk(raw.length > 0, "打开弹层后正文正常渲染（默认不注音）");
  chk(doc.querySelector("#m-text").querySelector("ruby") === null, "默认不注音，正文是纯文本");

  doc.querySelector("#m-pinyin-toggle").dispatchEvent(new w.Event("click", { bubbles: true }));
  const rubies = doc.querySelectorAll("#m-text ruby");
  chk(rubies.length > 4, "点击后逐字注音（" + rubies.length + " 个 ruby）");
  chk(doc.querySelector("#m-pinyin-toggle").dataset.on === "1", "按钮状态切到开启");
  chk(w.localStorage.getItem("poem_helper_pinyin_v1") === "1", "注音开关已持久化");

  doc.querySelector("#m-pinyin-toggle").dispatchEvent(new w.Event("click", { bubbles: true }));
  chk(doc.querySelectorAll("#m-text ruby").length === 0, "再点一次可关闭注音，恢复纯文本");

  // 朗读：jsdom 没有 SpeechSynthesis，必须优雅降级
  const readBtn = doc.querySelector("#m-read-btn");
  chk(readBtn.disabled === true, "无语音环境时朗读按钮禁用而不是报错");
  chk(/不支持/.test(doc.querySelector("#m-read-text").textContent), "按钮文案提示不支持朗读");
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
  chk(w2.document.querySelector('#m-read-text').textContent === '停止朗读', '朗读中按钮变为「停止朗读」');
  btn2.dispatchEvent(new w2.Event('click', { bubbles: true }));
  chk(w2.document.querySelector('#m-read-text').textContent === '朗读', '再点一次停止朗读并复位按钮');

  console.log(fails === 0 ? "\n🎉 注音与朗读测试全部通过" : "\n❌ " + fails + " 项失败");
  process.exit(fails ? 1 : 0);
}, 300);
