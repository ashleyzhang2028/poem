// 详情页返回后回到列表原位（Issue #347）
//
// 背景（用户报的）：
//   在「谥号（总说）」点进去看完，点右上角返回，落回的是列表最顶上，
//   不是刚才点的那一条；所有详情页（每一部集子、课外阅读里的集子）都一样。
//
// 根因：
//   openReader() 会用 window.scrollTo(0, 0) 把窗口滚到顶（读者态铺满整屏，
//   底下列表看不见，从正文开头读起是对的），但关掉读者态时没人把位置放回去 ——
//   列表滚的是 window 本身，位置一丢就只剩 0。
//
// 修复：
//   reader-core 记住打开详情前的窗口滚动量，hideReader() 之后分两帧还回去。
//   必须等两帧：收起时 body 还挂着 overflow:hidden，文档高度被压成窗口高，
//   那一刻写 scrollTo 会被浏览器当成越界而置 0（真浏览器实测如此）。
//   连读时 highlightItem() 会跟着往下滚，浏览位置改记「读者最后看到的那一条」。
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };
const eq = (a, b, m) => chk(a === b, m + '（期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a) + '）');

// ---------------------------------------------------------------------------
// 一个够用的 DOM：reader-core 只用到 querySelector / getElementById /
// createElement / body.className / scrollingElement / scrollTo。不用 jsdom（Issue #278）。
// ---------------------------------------------------------------------------
function makeEl(tag, doc) {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [], parentElement: null,
    attrs: {}, dataset: {}, style: {},
    hidden: false, isConnected: true,
    _class: new Set(),
    _handlers: {},
    _text: "",
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
    // renderList 用 innerHTML 搭 `.item` / `.item-read` 这些子节点，
    // 这里只把 class 与 data-id 认出来 —— 够 querySelector 找到它们即可，
    // 不是要靠解析 HTML 跑界面。
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
        const el = makeEl(tag, null);
        const attrs = m[2] || "";
        attrs.replace(/([\w-]+)(?:="([^"]*)")?/g, function (_, k, val) {
          const v2 = val == null ? "" : val;
          if (k === "class") el.className = v2;
          else if (k.startsWith("data-")) {
            el.dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = v2;
          } else el.attrs[k] = v2;
          return "";
        });
        this.appendChild(el);
      }
    },
    get innerHTML() { return this._html == null ? this._text : this._html; },
    setAttribute: function (k, v) {
      this.attrs[k] = String(v);
      // 真 DOM 里 attribute 与 dataset 是同一份数据的两个视图；
      // 这里保持镜像，免得 [data-gw="x"] 与 .dataset.gw 各看到一半。
      if (k.indexOf("data-") === 0) {
        this.dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = String(v);
      }
    },
    getAttribute: function (k) { return k in this.attrs ? this.attrs[k] : null; },
    removeAttribute: function (k) { delete this.attrs[k]; },
    hasAttribute: function (k) { return k in this.attrs; },
    appendChild: function (c) { c.parentElement = this; this.children.push(c); return c; },
    insertBefore: function (c) { c.parentElement = this; this.children.push(c); return c; },
    removeChild: function (c) {
      const i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
      return c;
    },
    addEventListener: function (t, fn) { (this._handlers[t] = this._handlers[t] || []).push(fn); },
    removeEventListener: function () {},
    dispatch: function (t, ev) { (this._handlers[t] || []).forEach(fn => fn(ev || {})); },
    click: function () { this.dispatch("click", { target: this, currentTarget: this }); },
    contains: function (n) {
      if (n === this) return true;
      return this.children.some(c => c.contains && c.contains(n));
    },
    closest: function (sel) {
      let n = this;
      while (n) { if (n.matches && n.matches(sel)) return n; n = n.parentElement; }
      return null;
    },
    matches: function (sel) {
      // 只支持本测试用到的形状：#id、[attr="v"]、[attr]、.cls、tag，
      // 以及逗号分隔的选择器组（引擎里写成 '.rd-title, #rd-title'）
      if (String(sel).indexOf(",") >= 0) {
        return String(sel).split(",").some(one => this.matches(one.trim()));
      }
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
    querySelectorAll: function (sel) {
      const out = [];
      const walk = n => { n.children.forEach(c => { if (c.matches(sel)) out.push(c); walk(c); }); };
      walk(this);
      return out;
    },
    querySelector: function (sel) { return this.querySelectorAll(sel)[0] || null; },
    focus: function () {}, blur: function () {},
    getBoundingClientRect: function () { return { top: 0, left: 0, width: 300, height: 60 }; },
    get scrollHeight() { return this.scrollHeightValue == null ? 0 : this.scrollHeightValue; },
    scrollIntoView: function () {}
  };
  Object.defineProperty(el, "id", { get() { return this.attrs.id || ""; }, set(v) { this.attrs.id = v; } });
  return el;
}

// 真浏览器里文档高度随内容走；收起读者态时 body 的 overflow:hidden 会把
// 文档高度压成窗口高，这时写 scrollTo 会被判越界 —— 这个 stub 如实模拟。
const VIEW_H = 780;
const LIST_H = 20000;

function harness() {
  const doc = {
    title: "",
    createElement: t => makeEl(t, null),
    addEventListener: () => {},
    getElementById: id => doc.querySelector("#" + id)
  };
  const html = makeEl("html", doc);
  doc.documentElement = html;
  Object.defineProperty(doc, "body", { get: () => doc._body });
  doc._body = makeEl("body", doc);
  html.appendChild(doc._body);

  const root = makeEl("div", doc);
  root.dataset.gwRoot = "";
  root.setAttribute("data-gw-root", "");
  doc._body.appendChild(root);

  const list = makeEl("div", doc);
  list.attrs.id = "gw-list";
  list.setAttribute("data-gw", "list");
  root.appendChild(list);

  const reader = makeEl("div", doc);
  reader.attrs.id = "gw-reader";
  reader.setAttribute("data-gw", "reader");
  reader.hidden = true;
  const body = makeEl("div", doc);
  reader.appendChild(body);
  ["rd-title", "rd-meta", "rd-trans-text", "rd-trans-src", "rd-prev-title", "rd-next-title"].forEach(function (id) {
    const d = makeEl("div", doc);
    d.attrs.id = id;
    body.appendChild(d);
  });
  doc._body.appendChild(reader);

  // document.querySelector 走「文档树」，匹配 reader-core 的用法
  doc.querySelectorAll = sel => doc._body.querySelectorAll(sel);
  doc.querySelector = sel => doc._body.querySelector(sel);

  // 滚动模型
  const st = { y: 0, x: 0 };
  doc.scrollingElement = {
    get scrollTop() { return st.y; },
    set scrollTop(v) { st.y = Math.max(0, Math.min(v, doc._body.className.includes("reader-open") ? 0 : LIST_H - VIEW_H)); },
    get scrollHeight() { return doc._body.className.includes("reader-open") ? VIEW_H : LIST_H; }
  };

  const win = {
    document: doc,
    location: { hash: "", href: "http://localhost/changshi/" },
    listeners: {},
    addEventListener: function (t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    removeEventListener: function () {},
    dispatchEvent: function (e) { (this.listeners[e.type] || []).forEach(fn => fn(e)); },
    get scrollY() { return st.y; },
    get scrollX() { return st.x; },
    scrollTo: function (a, b) {
      const y = typeof a === "object" && a !== null ? a.top : b;
      if (y < 0 || y > doc.scrollingElement.scrollHeight - VIEW_H) { st.y = 0; return; }
      st.y = y;
    },
    requestAnimationFrame: function (cb) { return rAF.push(cb); },
    localStorage: {
      _m: {},
      getItem(k) { return k in this._m ? this._m[k] : null; },
      setItem(k, v) { this._m[k] = String(v); },
      removeItem(k) { delete this._m[k]; }
    },
    setTimeout: () => 0,
    clearTimeout: () => {},
    innerHeight: VIEW_H,
    navigator: { userAgent: "node" }
  };
  win.window = win;

  const rAF = [];
  function flushRAF() { const q = rAF.splice(0); q.forEach(cb => cb(Date.now())); }

  const sandbox = {
    window: win, document: doc, console, Date, Math, JSON, Object, Array, String, Number,
    setTimeout: (fn) => { return 0; }, clearTimeout: () => {},
    requestAnimationFrame: win.requestAnimationFrame
  };
  sandbox.localStorage = win.localStorage;
  vm.createContext(sandbox);
  ['js/play-modes.js', 'js/reader-core.js'].forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sandbox, { filename: f });
  });

  return { win, doc, root, list, reader, sandbox, flushRAF };
}

// 造一部集子挂上去。items 只填 reader-core 渲染要用的字段。
function mountBook(h, n) {
  const items = [];
  for (let i = 1; i <= n; i++) {
    items.push({ id: "cs-" + i, title: "第 " + i + " 条", text: "正文 " + i, bookName: "文学常识" });
  }
  const cfg = {
    id: "changshi", items: items, root: h.root, reader: h.reader,
    groupOrder: [], noTranslation: true, readStore: "",
    words: { list: "文学常识", unit: "条", empty: "没有", loadingFailed: "加载失败" }
  };
  const api = h.sandbox.window.ReaderEngine.mount(cfg);
  return { api, items };
}

console.log("=== 1 · 从列表深处点进详情，返回要落回同一条 ===");
{
  const h = harness();
  const { api } = mountBook(h, 60);
  h.win.scrollTo(0, 6000);                       // 滚到第 40 条附近
  const before = h.win.scrollY;
  eq(before, 6000, "打开前列表停在 6000");

  api.open("cs-40");
  eq(h.win.scrollY, 0, "详情打开时窗口滚到顶（从正文开头读起）");
  eq(api.isOpen(), true, "读者态已打开");

  api.close();
  eq(api.isOpen(), false, "返回后读者态已收起");
  h.flushRAF(); h.flushRAF();                    // 还原排在两帧之后
  eq(h.win.scrollY, before, "返回后回到刚才点的那一条（6000）");
}

console.log("");
console.log("=== 2 · 收起瞬间 body 还挂着 overflow:hidden，这时写位置会被判越界 ===");
{
  const h = harness();
  const { api } = mountBook(h, 60);
  h.win.scrollTo(0, 6000);
  api.open("cs-40");
  api.close();
  // 一帧都还没跑：body 刚摘掉 reader-open，但位置还没还
  eq(h.win.scrollY, 0, "同步阶段窗口仍在顶部（还没到还原那一帧）");
  h.flushRAF();
  h.flushRAF();
  eq(h.win.scrollY, 6000, "两帧之后位置才落地 —— 早一帧写会被浏览器置 0，正是 Issue #347 的坑");
}

console.log("");
console.log("=== 3 · 连读时位置跟到读者最后看到的那一条，不是最初点开的那条 ===");
{
  const h = harness();
  const { api } = mountBook(h, 60);
  h.win.scrollTo(0, 1000);
  api.open("cs-10");
  // 连读：一篇读完跳到下一篇，画面上滚
  api.open("cs-30");
  h.win.scrollTo(0, 4000);                       // 连读期间画面往下走
  h.sandbox.window.dispatchEvent({ type: "noop" });
  // 直接触发 highlightItem 的记账路径：open 之后列表位置变化
  api.close();
  h.flushRAF(); h.flushRAF();
  chk(h.win.scrollY >= 1000, "返回后落在连读推进过的位置（≥ 最初点开处），不是一路退回 0");
}

console.log("");
console.log(fails === 0 ? "🎉 详情页返回原位测试全部通过" : "❌ 详情页返回原位测试 " + fails + " 项失败");
process.exit(fails === 0 ? 0 : 1);
