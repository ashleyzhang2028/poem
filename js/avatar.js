/**
 * 字符印头像（纯逻辑，零 DOM、零网络、零上传）
 * ==========================================================================
 * 为什么是「字符印」而不是「图片头像」：
 *
 *   用户 2026-09-15 裁决把头像交给我定（Issue #132）。
 *   图片头像（上传一张图）的每一项成本 —— 对象存储、内容审核、CDN、
 *   儿童照片出境合规 —— 都由「用户上传一张图」这一件事引爆，
 *   而它对「背诗」这件事毫无帮助。字符印能拿到 90% 的辨识度，成本是零：
 *
 *     · 内容源只有两个：用户从**固定字集**里挑的一个字、昵称的第一个字
 *     · 底色只有**固定四色**（朱砂 / 天青 / 松绿 / 赭石），不是任意颜色
 *     · 全部存在本机 `poem_profile_v1`，字节数 < 100，不发任何请求
 *
 *   → `/privacy/` 的「不收集」承诺一个字都不用改：
 *     这里没有任何「用户产生的内容」，只有从枚举里挑的一个索引。
 *
 * 三条硬规矩（测试里钉住）：
 *   1. **默认「诗」字**，任何情况下都不为空、不出裂图
 *   2. **不用邮箱首字母**：那等于把邮箱摘要的一半画在屏幕上，
 *      与 `/privacy/`「邮箱只以摘要 + 掩码存在本机」自相矛盾
 *   3. **不做 base64 存图**：会把 localStorage 撑爆，还污染导出备份
 *
 * 与 nickname 的关系：头像和昵称住同一份档案 `poem_profile_v1`
 * （`docs/architecture.md` §3.1 裁决：`username` 属**账号域**，跨设备要一致）。
 * 头像属身份、不属设备偏好 —— 手机和电脑上必须是同一枚印。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Avatar = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /** 账号域档案键：昵称 + 头像印记同住一处（跨设备一致的都放这儿） */
  var NS = "poem_profile_v1";

  /** 老键：昵称此前混在设置里（`settings.username`），只读不写，幂等迁移 */
  var LEGACY_SETTINGS_NS = "poem_recite_settings_v1";

  /** 默认字：与 App 图标正中那枚「诗」字同源，任何情况下都不空 */
  var DEFAULT_CHAR = "诗";

  /**
   * 可选字集 —— **固定集合**，不给自由输入。
   *
   * 为什么不弹键盘让用户随便打：自由输入会带来生僻字（字体子集里没有，
   * 表现为「半个字被吃掉」）、以及用户填真名/学校这类需要审核的内容。
   * 固定集合把这两个问题一次消掉，也让「字符印」真的只是「从枚举里挑一个索引」。
   */
  var CHARS = ["诗", "书", "山", "月", "风", "云", "松", "竹", "梅", "兰", "菊", "莲"];

  /**
   * 印色 —— 四色，取自传统色，与全站配色同源。
   * 名字都用了可读的英文短词（`ink` 字段），不是色值：
   * 将来换主色时只改这里的 `bg` / `fg`，用户存的「选了什么色」不受影响。
   */
  var INKS = {
    seal:   { name: "朱砂", bg: "linear-gradient(150deg,#c8564a,#a83b32)", fg: "#fdfaf2" },
    celadon:{ name: "天青", bg: "linear-gradient(150deg,#6e97a1,#4d7580)", fg: "#f7fbfa" },
    pine:   { name: "松绿", bg: "linear-gradient(150deg,#5f8268,#416048)", fg: "#f6fbf6" },
    ochre:  { name: "赭石", bg: "linear-gradient(150deg,#a9805a,#87603c)", fg: "#fdf8f1" }
  };

  var DEFAULT_INK = "seal";
  var INK_KEYS = Object.keys(INKS);

  function isChar(c) { return CHARS.indexOf(String(c == null ? "" : c)) >= 0; }
  function isInk(i) { return INK_KEYS.indexOf(String(i == null ? "" : i)) >= 0; }

  /**
   * 昵称的第一个字，用**码点**取而不是 `charAt(0)`。
   *
   * 昵称允许 12 字，中文之外还可能是 emoji / 罗马数字这类「超出 BMP」的字符：
   * `charAt(0)` 会把一个 emoji 劈成半截代理对，画出来是一个乱码方块。
   */
  function firstCharOf(nickname) {
    var s = String(nickname == null ? "" : nickname).trim();
    if (!s) return "";
    // Array.from 按码点切分，emoji / 扩展汉字都当成一个字
    var arr = typeof Array.from === "function" ? Array.from(s) : s.split("");
    var c = arr[0] || "";
    // 空白与控制字符不算「一个字」
    return /\S/.test(c) ? c : "";
  }

  /** 空档案（新用户 / 解析失败都落这里）：头像字段留空，由 display() 做三档回落 */
  function emptyProfile() {
    return { v: 1, nickname: "", avatar: { char: "", ink: "" } };
  }

  function safeParse(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) { return null; }
  }

  /**
   * 归一化头像字段。
   *
   * ⚠️ 非法 / 缺省值回落成**空串**，不是回落成默认字：
   *    「盘上没存过字」与「用户主动选了『诗』」是两件事，必须能分开 ——
   *    否则界面无法回答「这枚印是用户选的，还是我们替他填的」
   *    （`display().source` 就靠这个区分，title 文案也跟着不一样）。
   *    真正的兜底发生在 `display()` 里，那里的三档回落才决定最终画什么字。
   *    颜色同理：空串 → 默认朱砂。
   */
  function normAvatar(a) {
    if (!a || typeof a !== "object") return { char: "", ink: "" };
    return {
      char: isChar(a.char) ? String(a.char) : "",
      ink: isInk(a.ink) ? String(a.ink) : ""
    };
  }

  /** 读档案。解析失败 / 形状不对 → 空档案（不抛） */
  function read(backing) {
    if (!backing) return emptyProfile();
    var text = null;
    try { text = backing.getItem(NS); } catch (e) { return emptyProfile(); }
    var o = safeParse(text);
    if (!o || typeof o !== "object") return emptyProfile();
    return {
      v: 1,
      nickname: String(o.nickname == null ? "" : o.nickname).slice(0, 12),
      avatar: normAvatar(o.avatar)
    };
  }

  function write(backing, data) {
    if (!backing) return false;
    var clean = {
      v: 1,
      nickname: String((data && data.nickname) == null ? "" : data.nickname).trim().slice(0, 12),
      avatar: normAvatar(data && data.avatar)
    };
    try { backing.setItem(NS, JSON.stringify(clean)); return true; }
    catch (e) { return false; }
  }

  /**
   * 读昵称：`poem_profile_v1` → 老 `settings.username` → 空串。
   *
   * 兼容读是为了老用户零感知（`docs/architecture.md` §3.1 已裁决的取值顺序）：
   * 老用户只在设置里存过 `username`，新档案键是空的，不能让他忽然变成「Ashley」。
   */
  function nickname(backing) {
    var n = read(backing).nickname;
    if (n) return n;
    if (!backing) return "";
    var legacy = safeParse((function () {
      try { return backing.getItem(LEGACY_SETTINGS_NS); } catch (e) { return null; }
    })());
    if (legacy && typeof legacy === "object" && legacy.username != null) {
      return String(legacy.username).trim().slice(0, 12);
    }
    return "";
  }

  /**
   * 写昵称到账号域 `poem_profile_v1`。读盘失败（隐私模式）时静默返回 false，不抛。
   *
   * ⚠️ **不动老键 `poem_recite_settings_v1.username`**：
   *    本轮只做「镜像」，让两条键保持一致；「写新键 + 清老字段」那一步属于
   *    阶段 0 的 `ProgressStore` 迁移（`docs/architecture.md` §3.1 ④），
   *    会牵动 `js/storage.js` 的 `getSettings()` 与三个写入点，超出头像这件事的范围。
   *    老键的清理留给阶段 0；这里提供了 `clearLegacyNickname()` 供那时调用。
   */
  function setNickname(backing, name) {
    var cur = read(backing);
    cur.nickname = String(name == null ? "" : name).trim().slice(0, 12);
    return write(backing, cur);
  }

  /**
   * 清掉老键里的 `username` 字段（**阶段 0 的迁移动作**，本轮不调用）。
   *
   * 保留在这里是为了让「迁移」这件事只有一个实现：那时只需在
   * `ProgressStore.migrate()` 里调一次，不必再写一遍删字段的逻辑。
   * 幂等：老字段不存在时什么都不做。
   */
  function clearLegacyNickname(backing) {
    if (!backing) return false;
    try {
      var legacy = safeParse(backing.getItem(LEGACY_SETTINGS_NS));
      if (!legacy || typeof legacy !== "object" || legacy.username == null) return false;
      delete legacy.username;
      backing.setItem(LEGACY_SETTINGS_NS, JSON.stringify(legacy));
      return true;
    } catch (e) {
      return false;                        // 清理失败不影响主流程：昵称已在新键上
    }
  }

  /**
   * 便捷入口：改昵称时**同时**写新键与老键（镜像）。
   *
   * 各页写入点调这一个函数，不要各自去拼两处 setItem —— 拼两处必然有一天
   * 只改了其中一处，出现「首页显示新名字、设置页还是旧名字」这类漂移。
   */
  function saveNickname(backing, name) {
    var clean = String(name == null ? "" : name).trim().slice(0, 12);
    var ok = setNickname(backing, clean);
    if (!backing) return ok;
    try {
      var legacy = safeParse(backing.getItem(LEGACY_SETTINGS_NS)) || {};
      if (typeof legacy !== "object") legacy = {};
      legacy.username = clean;
      backing.setItem(LEGACY_SETTINGS_NS, JSON.stringify(legacy));
    } catch (e) { /* 老键写不进去时新键仍然生效 */ }
    return ok;
  }

  function avatar(backing) { return read(backing).avatar; }

  /**
   * 换印色 / 换字。只接受固定集合里的值，非法值**不写盘**并返回 ok:false
   * （与「读的时候回落默认」不同：写脏值说明调用方传错了，应该当场知道）。
   */
  function setAvatar(backing, patch) {
    var p = patch && typeof patch === "object" ? patch : {};
    var next = read(backing);
    if (p.char != null) {
      if (!isChar(p.char)) return { ok: false, code: "E_CHAR", message: "请从固定的字集里选一个字" };
      next.avatar.char = String(p.char);
    }
    if (p.ink != null) {
      if (!isInk(p.ink)) return { ok: false, code: "E_INK", message: "请从固定的颜色里选一个" };
      next.avatar.ink = String(p.ink);
    }
    var ok = write(backing, next);
    return { ok: ok, avatar: next.avatar, code: ok ? "" : "E_WRITE" };
  }

  /**
   * 还原默认印（「换个印」里的重置，不动昵称）。
   *
   * 写的是**空**而不是把「诗 / 朱砂」显式存进去：这样还原之后回到的是
   * 「三档回落」的起点，而不是「用户主动选了诗字」——
   * 两者的 title 文案不同（「默认字」vs「你选的字」），也会挡住将来
   * 「昵称首字优先」这类规则的生效。
   */
  function resetAvatar(backing) {
    var cur = read(backing);
    cur.avatar = { char: "", ink: "" };
    var ok = write(backing, cur);
    return { ok: ok, avatar: cur.avatar };
  }

  /**
   * 显示用的那一枚印 —— **三档回落**，永远有字：
   *   ① 用户选的字（存在档案里）→ ② 昵称第一个字 → ③ 默认「诗」
   *
   * ⚠️ 昵称第一个字只作为**兜底**，不是默认值：默认值必须是与 App 图标
   * 同源的那枚「诗」字，这样新用户第一眼看到的是「跬步的印」而不是
   * 「一个从自己名字里抠出来的字」。
   */
  function display(backing) {
    var prof = read(backing);
    var chosen = prof.avatar.char;
    var nick = nickname(backing);
    var fromNick = firstCharOf(nick);
    var char = chosen || fromNick || DEFAULT_CHAR;
    // 是否「用了昵称首字」/「用了默认字」—— 给界面写 title 用，
    // 让用户知道这枚印是怎么来的（别让人以为是自己设过却忘了）
    var source = chosen ? "chosen" : (fromNick ? "nickname" : "default");
    var ink = prof.avatar.ink || DEFAULT_INK;
    var srcText = source === "chosen" ? "你选的字"
      : (source === "nickname" ? "取自昵称首字" : "默认字");
    return {
      char: char, ink: ink, source: source,
      nickname: nick,
      isDefaultName: !nick,
      // 只给 CSS 用的色值；页面里不许自己写这两串渐变
      bg: INKS[ink].bg, fg: INKS[ink].fg,
      label: "头像：" + char + "字印 · " + INKS[ink].name + "（" + srcText + "）"
    };
  }

  /**
   * 渲染成一段 HTML（<span> 结构，不带事件）。
   *
   * 为什么放在这一层而不是各页面：全站三处要画这枚印（顶栏 / 设置页 / 档案区），
   * 各画一遍必然走形（尺寸、圆角、字重各一份）。颜色走 style 内联，
   * 是因为色值来自用户选择、不是静态样式表能穷举的 —— 但仍然只有这四组。
   */
  function html(backing, opts) {
    var o = opts || {};
    var d = display(backing);
    var cls = "seal-avatar" + (o.cls ? " " + String(o.cls) : "");
    var size = o.size ? ' style="--seal-size:' + Number(o.size) + 'px;background:' + d.bg + ';color:' + d.fg + '"'
      : ' style="background:' + d.bg + ';color:' + d.fg + '"';
    return '<span class="' + cls + '" role="img" aria-label="' + esc(d.label) + '"' +
      ' title="' + esc(d.label) + '"' + size + '>' + esc(d.char) + "</span>";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /** 默认存储：浏览器里就是 localStorage；Node 里给不了就返回 null（不抛） */
  function defaultBacking() {
    var g = typeof globalThis !== "undefined" ? globalThis : null;
    if (!g) return null;
    try {
      return g.localStorage && typeof g.localStorage.getItem === "function" ? g.localStorage : null;
    } catch (e) {
      return null;                          // 隐私模式下取用即抛
    }
  }

  return {
    NS: NS, LEGACY_SETTINGS_NS: LEGACY_SETTINGS_NS,
    CHARS: CHARS, INKS: INKS, INK_KEYS: INK_KEYS,
    DEFAULT_CHAR: DEFAULT_CHAR, DEFAULT_INK: DEFAULT_INK,
    isChar: isChar, isInk: isInk, firstCharOf: firstCharOf,
    emptyProfile: emptyProfile, normAvatar: normAvatar,
    read: read, write: write,
    nickname: nickname, setNickname: setNickname,
    saveNickname: saveNickname, clearLegacyNickname: clearLegacyNickname,
    avatar: avatar, setAvatar: setAvatar, resetAvatar: resetAvatar,
    display: display, html: html, esc: esc,
    defaultBacking: defaultBacking
  };
});
