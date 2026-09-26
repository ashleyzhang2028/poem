/* ===========================================================================
   译文来源注脚（Issue #329）
   ---------------------------------------------------------------------------
   用户 2026-09-26 报：
     「很多译文后面的这段英文字母是什么意思？我看到好几处了
       需要保留吗，还是直接删除」

   那段「英文数字」是正文主表里的**版次**（`version`，内容短摘要，
   `data/text-master.js`，例如 `k3f9a2`）。阅读器原先把它缀在译文来源那一行
   末尾（「……依据公认注本与通行译注 · 17o09ty」），本意是「底本改过看得见」，
   实际只有程序用得上 —— 用户读到的是一句乱码。

   这一层钉住三件事：
     ① 阅读器那一行**只剩来源口径**，不再带版次；
     ② 版次本身不删（快照刷新靠它），`textVersionOf` 照旧取得到；
     ③ 首页详情页与各部集子详情页两处都不带。

   纯 Node + 手搓 DOM（与 test/reader-back.test.js 同一套做法，Issue #278 之后
   不再依赖 jsdom）。
   ========================================================================== */

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

// ── 一个够用的 DOM ─────────────────────────────────────────────────
function makeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [], parentElement: null,
    attrs: {}, style: {}, hidden: false, isConnected: true,
    _class: new Set(), _handlers: {}, _text: "",
    get className() { return Array.from(this._class).join(" "); },
    set className(v) { this._class = new Set(String(v).split(/\s+/).filter(Boolean)); },
    get classList() {
      const self = this;
      return {
        add: (...c) => c.forEach(x => self._class.add(x)),
        remove: (...c) => c.forEach(x => self._class.delete(x)),
        contains: c => self._class.has(c),
        toggle: (c, on) => { if (on) self._class.add(c); else self._class.delete(c); }
      };
    },
    set textContent(v) { this._text = String(v); },
    get textContent() { return this._text; },
    set dataset(v) { this._dataset = v; },
    get dataset() { return this._dataset || (this._dataset = {}); },
    // renderList 用 innerHTML 搭出 .item-* 这些子节点，引擎随后要 querySelector
    // 到它们才挂得上事件；这里只把 class / id / data-* 认出来 —— 够用即可。
    set innerHTML(v) {
      this._html = String(v);
      this._text = this._html.replace(/<[^>]*>/g, "");
      this.children = [];
      const SKIP = new Set(["br", "path", "circle", "rect", "svg"]);
      const re = /<([a-zA-Z][\w-]*)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*\/?>/g;
      let m;
      while ((m = re.exec(this._html))) {
        const tag = m[1].toLowerCase();
        if (SKIP.has(tag)) continue;
        const child = makeEl(tag);
        const attrs = m[2] || "";
        attrs.replace(/([\w-]+)(?:="([^"]*)")?/g, function (_, k, val) {
          const v2 = val == null ? "" : val;
          if (k === "class") child.className = v2;
          else if (k.startsWith("data-")) {
            child.dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = v2;
          } else child.attrs[k] = v2;
          return "";
        });
        this.appendChild(child);
      }
    },
    get innerHTML() { return this._html == null ? this._text : this._html; },
    setAttribute: function (k, v) { this.attrs[k] = String(v); },
    getAttribute: function (k) { return k in this.attrs ? this.attrs[k] : null; },
    removeAttribute: function (k) { delete this.attrs[k]; },
    hasAttribute: function (k) { return k in this.attrs; },
    appendChild: function (c) { c.parentElement = this; this.children.push(c); return c; },
    insertBefore: function (c) { c.parentElement = this; this.children.push(c); return c; },
    removeChild: function (c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    addEventListener: function (t, fn) { (this._handlers[t] = this._handlers[t] || []).push(fn); },
    removeEventListener: function () {},
    dispatch: function (t, ev) { (this._handlers[t] || []).forEach(fn => fn(ev || {})); },
    click: function () { this.dispatch("click", { target: this, currentTarget: this }); },
    contains: function (n) { return n === this || this.children.some(c => c.contains && c.contains(n)); },
    closest: function (sel) { let n = this; while (n) { if (n.matches && n.matches(sel)) return n; n = n.parentElement; } return null; },
    matches: function (sel) {
      if (String(sel).indexOf(",") >= 0) return String(sel).split(",").some(one => this.matches(one.trim()));
      if (sel.startsWith("#")) return this.attrs.id === sel.slice(1);
      if (sel.startsWith(".")) return this._class.has(sel.slice(1));
      if (sel.startsWith("[")) {
        const m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel);
        return !!m && (m[2] === undefined ? (m[1] in this.attrs) : this.attrs[m[1]] === m[2]);
      }
      return this.tagName === String(sel).toUpperCase();
    },
    querySelectorAll: function (sel) {
      const out = [];
      (function walk(n) { n.children.forEach(c => { if (c.matches(sel)) out.push(c); walk(c); }); })(this);
      return out;
    },
    querySelector: function (sel) { return this.querySelectorAll(sel)[0] || null; }
  };
  return el;
}

function harness() {
  const doc = {
    title: "",
    createElement: t => makeEl(t),
    addEventListener: () => {},
    getElementById: id => doc.querySelector("#" + id)
  };
  const html = makeEl("html");
  doc.documentElement = html;
  doc._body = makeEl("body");
  Object.defineProperty(doc, "body", { get: () => doc._body });
  html.appendChild(doc._body);

  const root = makeEl("div");
  root.setAttribute("data-gw-root", "");
  doc._body.appendChild(root);

  const list = makeEl("div");
  list.attrs.id = "gw-list";
  list.setAttribute("data-gw", "list");
  root.appendChild(list);

  const reader = makeEl("div");
  reader.attrs.id = "gw-reader";
  reader.setAttribute("data-gw", "reader");
  reader.hidden = true;
  const body = makeEl("div");
  reader.appendChild(body);
  ["rd-title", "rd-meta", "rd-trans-text", "rd-trans-src"].forEach(function (id) {
    const d = makeEl("div"); d.attrs.id = id; body.appendChild(d);
  });
  doc._body.appendChild(reader);

  doc.querySelectorAll = sel => doc._body.querySelectorAll(sel);
  doc.querySelector = sel => doc._body.querySelector(sel);

  const win = {
    document: doc,
    location: { hash: "", href: "http://localhost/changshi/" },
    listeners: {},
    addEventListener: function (t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    removeEventListener: function () {},
    dispatchEvent: function (e) { (this.listeners[e.type] || []).forEach(fn => fn(e)); },
    scrollY: 0, innerHeight: 800,
    scrollTo: function () {},
    requestAnimationFrame: function (cb) { return 0; },
    setTimeout: () => 0, clearTimeout: () => {},
    localStorage: { _m: {}, getItem(k) { return k in this._m ? this._m[k] : null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } },
    navigator: { userAgent: "node" }
  };
  win.window = win;

  const sandbox = {
    window: win, document: doc, console, Date, Math, JSON, Object, Array, String, Number,
    setTimeout: () => 0, clearTimeout: () => {}
  };
  sandbox.localStorage = win.localStorage;
  vm.createContext(sandbox);
  ['js/play-modes.js', 'js/reader-core.js'].forEach(function (f) {
    vm.runInContext(read(f), sandbox, { filename: f });
  });
  return { win, doc, root, reader, sandbox };
}

// ── ① 文案表与版次各自还在（版次没被误删） ──────────────────────
console.log("=== 1 · 口径文案与版次各自都还在 ===");
const idx = { window: {}, console };
idx.window = idx;
vm.createContext(idx);
vm.runInContext(read('data/index.js'), idx, { filename: 'data/index.js' });
chk(idx.TRANSLATION_SOURCES && idx.TRANSLATION_SOURCES.school === '依据统编版教材与教师用书课后释义',
  '四类口径文案齐备（school 一条与用户引的一字不差）');

const ms = { window: {}, console };
ms.window = ms;
vm.createContext(ms);
vm.runInContext(read('data/text-master.js'), ms, { filename: 'data/text-master.js' });
const withVer = (ms.TEXT_MASTER || []).filter(m => m.version);
chk(withVer.length >= 2000, '主表里 ' + withVer.length + ' 条带版次（版次是快照比对的依据，不删）');
const sample = withVer.filter(m => m.text && m.translation)[0];
chk(sample && /^[0-9a-z]+$/.test(sample.version),
  '版次形如 ' + (sample && sample.version) + ' —— 就是用户看到的那串「英文字母」');

// ── ② 阅读器那一行只剩来源口径 ──────────────────────────────────
console.log("");
console.log("=== 2 · 部集子详情页：来源那一行不再带版次 ===");
{
  const h = harness();
  const item = {
    id: "cs-1", title: "试条", text: "正文", translation: "白话译文。",
    translationSource: "school", bookName: "文学常识"
  };
  // 阅读器取口径文案要 data/index.js 的 TRANSLATION_SOURCES，
  // 真实页面里它由 data/index.js 提供 —— 沙盒里补上同一份（不另写一份文案）
  h.sandbox.window.translationSourceText = idx.translationSourceText;
  const api = h.sandbox.window.ReaderEngine.mount({
    id: "changshi", items: [item], root: h.root, reader: h.reader, groupOrders: [],
    words: { list: "文学常识", unit: "条" }
  });
  api.open("cs-1");
  const srcEl = h.doc.querySelector("#rd-trans-src");
  chk(!!srcEl, "阅读器里有来源注脚元素");
  chk(srcEl.textContent === "依据统编版教材与教师用书课后释义",
    "注脚只说口径：" + JSON.stringify(srcEl.textContent));
  chk(!/k3f9a2|17o09ty|\s·\s[a-z0-9]{5,}/.test(srcEl.textContent),
    "注脚里没有版次号（不再出现「 · 一串字母数字」）");

  // 反例：没有口径的条目注脚留空，而不是退化成光秃秃一个版次号
  const h2 = harness();
  h2.sandbox.window.translationSourceText = idx.translationSourceText;
  const api2 = h2.sandbox.window.ReaderEngine.mount({
    id: "changshi", items: [{ id: "cs-9", title: "无标注", text: "正文", translation: "白话。" }],
    root: h2.root, reader: h2.reader, groupOrders: [], words: { list: "常识", unit: "条" }
  });
  api2.open("cs-9");
  chk(h2.doc.querySelector("#rd-trans-src").textContent === "",
    "没有口径标注的条目注脚是空串（.trans-src:empty 自然不占位）");

  // 引擎里不许再出现「取版次往注脚里拼」那段
  const core = read('js/reader-core.js');
  chk(core.indexOf('17o09ty') < 0 && !/ver \? srcText \+ " · " \+ ver/.test(core),
    'js/reader-core.js 已不再把版次拼进注脚');
  chk(/textVersionOf/.test(read('js/collections.js')),
    '取版次的入口 textVersionOf 仍被快照层引用（版次没被整段删掉）');
}

// ── ③ 首页详情页那一行 ──────────────────────────────────────────
console.log("");
console.log("=== 3 · 首页详情页同理 ===");
{
  const app = read('js/app.js');
  const seg = app.slice(app.indexOf('m-trans-src') - 400, app.indexOf('m-trans-src') + 400);
  chk(seg.indexOf('translationSourceText') >= 0, '首页详情页取的仍是口径文案');
  chk(seg.indexOf('textVersionOf') < 0, '首页详情页从来就没拼过版次（这里钉住别再有人加回来）');

  const src = read('index.html');
  chk(src.indexOf('id="m-trans-src"') >= 0, '首页详情页有 #m-trans-src 注脚元素');
  const rd = read('poems/index.html');
  chk(rd.indexOf('id="rd-trans-src"') >= 0, '诗词页详情页有 #rd-trans-src 注脚元素');
}

// ── ④ 版次仍然看得见的地方：通知与提示（不动） ──────────────────
console.log("");
console.log("=== 4 · 版次只用在程序该用的地方 ===");
{
  const coll = read('js/collections.js');
  chk(/version: versionOfEntry/.test(coll), '本机快照里照旧存着版次（存下之后改过能比出来）');
  const appSrc = read('js/app.js');
  chk(/refreshSnapshotsForBooks/.test(appSrc), '启动时照旧按集子刷新用到的快照');
}

console.log("");
if (fails) { console.log("❌ 译文来源注脚测试 " + fails + " 项失败"); process.exit(1); }
console.log("🎉 译文来源注脚测试全部通过");
