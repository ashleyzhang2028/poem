// 集子列表页顶上的**索引卡片**（Issue #370）
//
// 用户：「课外阅读具体某个集子列表页（例如课内诗词列表页，乐府集列表页，
// 古文观止列表页），各自在顶部添加一个索引卡片（像古诗词大会首页顶部范围
// 的双列展示的卡片类似），基本以各自分类为索引，用户点击后，直接转到分类
// 所在的卡片。例如课内古诗词，点击索引卡片里的「五年级上 11」，直接跳到
// 五年级上。」
//
// 这一层只钉**功能**（Issue #278 之后界面层已删）：卡片有没有按分类摊开、
// 数对不对、点一下有没有落到那一段、搜索 / 筛选时收不收起来、分类太多会不会
// 先折起来。用测试里自带的一个小 DOM 跑 reader-core，不装 jsdom。
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };
const eq = (a, b, m) => chk(a === b, m + '（期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a) + '）');

// ---------------------------------------------------------------------------
// 一个够用的小 DOM（与 test/reader-back.test.js 同一份口径，只留本测试要的）
// ---------------------------------------------------------------------------
function makeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [], parentElement: null,
    attrs: {}, style: {},
    hidden: false, isConnected: true,
    _class: new Set(), _handlers: {}, _text: "", _scrolled: null,
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
    // 一个**会嵌套**的小 HTML 解析器：够把 renderList 摆的那个结构还原成
    // 一棵树（button > span 这种父子关系不能丢，否则 querySelector 找不到
    // 里层的名字 / 数字），也认标签之间的纯文本（`.group-index-name` 里那两个字）。
    set innerHTML(v) {
      this._html = String(v);
      this.children = [];
      const SKIP = new Set(["br", "path", "circle", "rect", "svg"]);
      const stack = [this];
      const re = /<\/?([a-zA-Z][\w-]*)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
      let m;
      while ((m = re.exec(this._html))) {
        const host = stack[stack.length - 1];
        if (m[4] != null) {           // 纯文本 → 归当时的栈顶
          if (host !== this) host._text += m[4];
          continue;
        }
        const tag = m[1].toLowerCase();
        if (SKIP.has(tag)) continue;
        if (this._html[m.index + 1] === "/") { if (stack.length > 1) stack.pop(); continue; }
        const child = makeEl(tag);
        (m[2] || "").replace(/([\w-]+)(?:="([^"]*)")?/g, function (_, k, val) {
          const v2 = val == null ? "" : val;
          if (k === "class") child.className = v2;
          else child.attrs[k] = v2;
          return "";
        });
        host.appendChild(child);
        if (!m[3]) stack.push(child);   // 不是自闭合 → 后续内容归它
      }
      this._text = this._html.replace(/<[^>]*>/g, "");
    },
    get innerHTML() { return this._html == null ? this._text : this._html; },
    setAttribute: function (k, v) {
      this.attrs[k] = String(v);
      if (k.indexOf("data-") === 0) this.dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = String(v);
    },
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
    contains: function (n) { if (n === this) return true; return this.children.some(c => c.contains && c.contains(n)); },
    closest: function (sel) { let n = this; while (n) { if (n.matches && n.matches(sel)) return n; n = n.parentElement; } return null; },
    matches: function (sel) {
      if (String(sel).indexOf(",") >= 0) return String(sel).split(",").some(one => this.matches(one.trim()));
      if (sel.startsWith("#")) return this.attrs.id === sel.slice(1);
      if (sel.startsWith(".")) return this._class.has(sel.slice(1));
      const attr = sel.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
      if (attr) {
        const k = attr[1];
        const v = k.startsWith("data-") ? this.dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] : this.attrs[k];
        return attr[2] === undefined ? v !== undefined : v === attr[2];
      }
      return this.tagName === sel.toUpperCase();
    },
    querySelectorAll: function (sel) { const out = []; const walk = n => { n.children.forEach(c => { if (c.matches(sel)) out.push(c); walk(c); }); }; walk(this); return out; },
    querySelector: function (sel) { return this.querySelectorAll(sel)[0] || null; },
    focus: function () {}, blur: function () {},
    getBoundingClientRect: function () { return { top: 0, left: 0, width: 300, height: 60, bottom: 60, right: 300 }; },
    scrollIntoView: function () { this._scrolled = true; },
    get offsetWidth() { return 300; }
  };
  Object.defineProperty(el, "id", { get() { return this.attrs.id || ""; }, set(v) { this.attrs.id = v; } });
  // dataset 与 attribute 是同一份数据的两个视图（真 DOM 如此）：
  // reader-core 一边用 dataset.group 写、一边用 getAttribute("data-group") 读。
  el.dataset = new Proxy({}, {
    get: (_, k) => el.attrs["data-" + String(k).replace(/[A-Z]/g, c => "-" + c.toLowerCase())],
    set: (_, k, v) => { el.attrs["data-" + String(k).replace(/[A-Z]/g, c => "-" + c.toLowerCase())] = String(v); return true; },
    has: (_, k) => ("data-" + String(k).replace(/[A-Z]/g, c => "-" + c.toLowerCase())) in el.attrs
  });
  return el;
}

function harness() {
  const doc = { title: "", createElement: t => makeEl(t), addEventListener: () => {}, getElementById: id => doc.querySelector("#" + id) };
  const html = makeEl("html");
  doc.documentElement = html;
  doc._body = makeEl("body");
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
  const rbody = makeEl("div");
  reader.appendChild(rbody);
  ["rd-title", "rd-meta", "rd-trans-text", "rd-trans-src", "rd-prev-title", "rd-next-title"].forEach(function (id) {
    const d = makeEl("div"); d.attrs.id = id; rbody.appendChild(d);
  });
  doc._body.appendChild(reader);

  doc.querySelectorAll = sel => doc._body.querySelectorAll(sel);
  doc.querySelector = sel => doc._body.querySelector(sel);

  const win = {
    document: doc,
    location: { hash: "", href: "http://localhost/poems/" },
    listeners: {},
    addEventListener: function (t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    removeEventListener: function () {},
    dispatchEvent: function (e) { (this.listeners[e.type] || []).forEach(fn => fn(e)); },
    scrollY: 0, scrollX: 0, scrollTo: function () {},
    requestAnimationFrame: function (cb) { return rAF.push(cb); },
    localStorage: { _m: {}, getItem(k) { return k in this._m ? this._m[k] : null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } },
    setTimeout: () => 0, clearTimeout: () => {}, innerHeight: 780,
    navigator: { userAgent: "node" }
  };
  win.window = win;
  const rAF = [];
  function flushRAF() { const q = rAF.splice(0); q.forEach(cb => cb(Date.now())); }

  const sandbox = {
    window: win, document: doc, console, Date, Math, JSON, Object, Array, String, Number,
    setTimeout: () => 0, clearTimeout: () => {}, requestAnimationFrame: win.requestAnimationFrame
  };
  sandbox.localStorage = win.localStorage;
  vm.createContext(sandbox);
  ['js/play-modes.js', 'js/reader-core.js'].forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sandbox, { filename: f });
  });
  return { win, doc, root, list, reader, sandbox, flushRAF };
}

// 造一部集子：分组名 + 每组几条。
function mountBook(h, groups, unit) {
  const items = [];
  groups.forEach(function (g) {
    const n = Array.isArray(g) ? g[1] : 2;
    const name = Array.isArray(g) ? g[0] : g;
    for (let i = 1; i <= n; i++) {
      items.push({ id: name + "-" + i, title: name + " 第 " + i + " 首", text: "正文", translation: "译文", gradeGroup: name });
    }
  });
  const order = groups.map(g => Array.isArray(g) ? g[0] : g);
  const api = h.sandbox.window.ReaderEngine.mount({
    id: "x", items: items, root: h.root, reader: h.reader,
    groupOrder: order, readStore: "",
    words: { list: "诗词", unit: unit || "首", empty: "没有", loadingFailed: "加载失败" }
  });
  return { api, items };
}

const cardOf = h => h.list.querySelector("[data-index-card]");
const picksOf = h => h.list.querySelectorAll("[data-index-group]");
const nameOf = b => b.querySelector(".group-index-name").textContent;
const numOf = b => b.querySelector(".group-index-num").textContent;

console.log("=== 1 · 各分类按序摊在顶上，名与数都对 ===");
{
  const h = harness();
  mountBook(h, [["一年级上", 5], ["一年级下", 8], ["五年级上", 11]], "首");
  const card = cardOf(h);
  chk(!!card, "列表顶上出现了索引卡片");
  chk(h.list.children[0] === card, "它就是列表的第一张卡（在正文各段之前）");
  const picks = picksOf(h);
  eq(picks.length, 3, "三个分类摊成三格");
  eq(picks.map(nameOf).join("|"), "一年级上|一年级下|五年级上", "分类次序按 groupOrder");
  eq(numOf(picks[2]), "11 首", "「五年级上」那格写着 11 首 —— 正是用户举的那一项");
}

console.log("");
console.log("=== 2 · 点一格，就地滚到那一段 ===");
{
  const h = harness();
  mountBook(h, [["一年级上", 2], ["一年级下", 2], ["五年级上", 2]]);
  const btn = picksOf(h).find(b => b.getAttribute("data-index-group") === "五年级上");
  chk(!!btn, "找得到「五年级上」那一格");
  // 经由列表的事件委托点它（真实点击路径）
  h.list.dispatch("click", { target: btn, stopPropagation() {}, preventDefault() {} });
  const target = h.list.querySelectorAll(".group-card").find(c => c.getAttribute("data-group") === "五年级上");
  chk(!!target, "列表里真有「五年级上」那一段");
  chk(!!target._scrolled, "点一下滚到了那一段（scrollIntoView 被调到）");
  chk(target.classList.contains("flash"), "落点起了高亮，让人一眼认出");
}

console.log("");
console.log("=== 3 · 只有一段分类时不摆索引（摆了也没得跳） ===");
{
  const h = harness();
  mountBook(h, [["卷一", 3]]);
  chk(!cardOf(h), "单段的集子不出索引卡");
}

console.log("");
console.log("=== 4 · 搜索 / 未读筛选时收起来 ===");
{
  const h = harness();
  const { api } = mountBook(h, [["一年级上", 2], ["一年级下", 2]]);
  chk(!!cardOf(h), "平时在");
  api.setKeyword("一年级上");
  chk(!cardOf(h), "搜索时收起来（搜出来是一小撮，全局分类表对不上）");
  api.setKeyword("");
  chk(!!cardOf(h), "清空搜索又回来");
  // 未读筛选同理：筛出来的是「还没读的那几条」，不是「整段」
  const unread = h.list.querySelector('[data-filter="unread"]');
  if (unread) {
    unread.dispatch("click", { target: unread, stopPropagation() {}, preventDefault() {} });
    chk(!cardOf(h), "「未读」筛选下也收起来");
    const all = h.list.querySelector('[data-filter="all"]');
    all.dispatch("click", { target: all, stopPropagation() {}, preventDefault() {} });
    chk(!!cardOf(h), "切回「全部」又回来");
  }
}

console.log("");
console.log("=== 5 · 分类一多先折起来，一颗「展开」放全表 ===");
{
  const h = harness();
  const many = [];
  for (let i = 1; i <= 20; i++) many.push(["词牌 · 第" + i + "调", 1]);
  mountBook(h, many);
  const card = cardOf(h);
  chk(!!card, "20 段也照摆");
  const listEl = card.querySelector(".group-index-list");
  eq(listEl.getAttribute("data-folded"), "1", "超过 12 段先折起来（否则整张表比整页还长）");
  const btn = card.querySelector("[data-index-all]");
  eq(btn.textContent, "展开", "卡头那颗键写着「展开」");
  h.list.dispatch("click", { target: btn, stopPropagation() {}, preventDefault() {} });
  eq(listEl.getAttribute("data-folded"), null, "点一下全表放出来");
  eq(btn.textContent, "收起", "那颗键改成「收起」");
  h.list.dispatch("click", { target: btn, stopPropagation() {}, preventDefault() {} });
  eq(listEl.getAttribute("data-folded"), "1", "再点一下又折回去");
}

console.log("");
console.log(fails === 0 ? "🎉 索引卡片测试全部通过" : "❌ 索引卡片测试 " + fails + " 项失败");
process.exit(fails === 0 ? 0 : 1);
