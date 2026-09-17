/**
 * 头像（纯逻辑，零 DOM、零网络）
 * ==========================================================================
 * 两档（用户 2026-09-19 裁决，Issue #163）：
 *
 *   ① **首字印**（默认，一定画得出来）：昵称的第一个字母 / 汉字。
 *      昵称为空时回落到默认字「诗」（与 App 图标正中那枚同源）。
 *   ② **图片头像**（可选）：用户自己上传一张图，上传前在**本地**压成
 *      256×256 的方图，再上传到 Supabase Storage。
 *
 * ## 用户为什么否掉了上一版（「字符印」）
 *
 *   上一版是「固定 12 个字 + 固定四色」，理由写得很足（不收集、不存图、
 *   儿童照片不上云）。用户 2026-09-19 的原话：
 *
 *     「头像印记设置和传统用户头像流程不符，让人困惑，直接删除这个功能，
 *       四个颜色背景选择全部删除。直接用用户名的第一个字母或者汉字显示在头像里。
 *       允许用户上传图片作为头像，在上传前进行本地压缩，支持用户进行方形裁切，
 *       放大缩小裁切，然后再上传裁切后的图片作为头像到 supabase 的文件或者图像存储。」
 *
 *   两条都成立：**字集与四色是自造的一套流程**（别处见不到，所以困惑），
 *   而**上传头像**是用户到处都见过的流程。上一版把「不收集」当成了不做的理由，
 *   但那条承诺属于 `/privacy/`，改条款即可 —— 不该拿它绑住一个正常功能。
 *   → 现在：选字、选色、那四枚色点、那个「用默认印」按钮**全部删掉**；
 *     没传图就是昵称首字，传了图就是那张图。
 *
 * ## 盘上形状（两处，各有各的域）
 *
 * ```
 * poem_profile_v1       = { v:1, nickname, avatar: { img: "https://…" | "" } }   ← 账号域
 * poem_family_v1        = { v:1, at, profiles: [{ id, nickname, avatar:{ img }, createdAt }] }
 * poem_avatar_local_v1  = { img: "data:image/jpeg;base64,…" }                    ← **设备域**
 * ```
 *
 * ⚠️ **本机那一条是设备域的，刻意不上云**（`docs/architecture.md` §3.1 的分域裁决）：
 *    头像地址（URL）跟着账号走，因为它是「我是谁」；而**那张图的字节**留在本机，
 *    因为离线时它必须还画得出来（`<img src>` 指着一个连不上的地址就是一枚裂图）。
 *    所以 `display()` 是**两档回落**：有效图片 → 本机那份图 → 昵称首字。
 *
 * ## 三条不许破的规矩（测试里钉着）
 *
 *   1. **永不空**：昵称为空、图片裂了、盘上全是脏值，也要有一枚印（首字 / 「诗」）
 *   2. **不用邮箱首字母**：那等于把邮箱摘要的一半画在屏幕上，与 `/privacy/`
 *      「邮箱只以摘要 + 掩码存在本机」自相矛盾
 *   3. **不把 base64 塞进账号域**：账号域那份要被同步与导出（`js/export-core.js`），
 *      一张 256×256 的图 base64 有几十 KB，塞进去会把 localStorage 与云端的
 *      每一份进度记录都撑大（进度是逐条推送的）
 *
 * ## 历史兼容（老用户一个字节都不丢）
 *
 *   上一版存的是 `avatar: { char: "梅", ink: "pine" }`。读的时候**只认 `img`**，
 *   于是老用户那枚「字印」自然回到首字印（`nickname` 的第一个字）；
 *   `char` / `ink` 两个字段**不再写、不再读、也不再校验** ——
 *   它们是那一版的自造流程，用户已经点名删掉。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Avatar = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /** 账号域档案键：昵称 + 头像地址同住一处（跨设备一致的都放这儿） */
  var NS = "poem_profile_v1";

  /**
   * 设备域：本机那份图片字节（data URL）。
   *
   * 为什么不放账号域：它要被导出（`export-core.js`）与同步（`sync-store.js`），
   * 而这条基线在 `docs/architecture.md` §1.3 写着 ——「supabase 里的进度
   * 永远不是唯一副本」。几十 KB 的 base64 混进进度记录里，
   * 每一台设备拉一次就是几十 KB × 篇数。
   */
  var LOCAL_NS = "poem_avatar_local_v1";

  /** 老键：昵称此前混在设置里（`settings.username`），只读不写，幂等迁移 */
  var LEGACY_SETTINGS_NS = "poem_recite_settings_v1";

  /** 默认字：与 App 图标正中那枚「诗」字同源，任何情况下都不空 */
  var DEFAULT_CHAR = "诗";

  /** 头像地址长度上限（脏值 / 恶意长串不许进盘，免得撑爆 localStorage） */
  var URL_MAX = 512;

  /** 图片边长上限（本地压缩的目标尺寸；data URL 的检查也用它，留一倍余量） */
  var MAX_PX = 512;

  /* --------------------------------------------------------- 家庭子用户接线
     3 期 P1：有了名册之后，**昵称与头像跟着当前孩子走**。全站几处画这枚印，
     各自去问一次「现在是谁」的话，早晚有一处忘了问 —— 症状是
     「顶栏是小明的印、设置页是小红的」。这一层只提供**一个**答案。
     `Family` 缺席（脚本顺序不对 / 老缓存）时一律走老路径：读 `poem_profile_v1` 本身。 */

  function familyMod() {
    var g = typeof globalThis !== "undefined" ? globalThis : null;
    return g && g.Family ? g.Family : null;
  }

  /** 当前子用户（没有 Family / 名册为空 → null）。任何异常都当「没有」 */
  function currentChild(backing) {
    var F = familyMod();
    if (!F || !F.current) return null;
    try { return F.current({ backing: backing }); } catch (e) { return null; }
  }

  /** 取「这一份档案」的读写目标（有当前子用户就是它，否则是老的那整份） */
  function target(backing) {
    var p = currentChild(backing);
    if (!p) return null;
    return {
      v: 1,
      nickname: String(p.nickname == null ? "" : p.nickname).slice(0, 12),
      avatar: normAvatar(p.avatar)
    };
  }

  function saveToChild(backing, data) {
    var F = familyMod();
    if (!F) return false;
    var p = currentChild(backing);
    if (!p) return false;
    var r1 = F.rename(p.id, data.nickname, { backing: backing });
    var r2 = F.setAvatar(p.id, normAvatar(data.avatar), { backing: backing });
    return !!(r1 && r1.ok) || !!(r2 && r2.ok);
  }

  /* ------------------------------------------------------------- 基础工具 */

  function safeParse(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) { return null; }
  }

  function safeGet(backing, key) {
    if (!backing) return null;
    try { return backing.getItem(key); } catch (e) { return null; }
  }

  function safePut(backing, key, text) {
    if (!backing) return false;
    try { backing.setItem(key, text); return true; } catch (e) { return false; }
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /**
   * 昵称的第一个「字」，按**码点**取而不是 `charAt(0)`。
   *
   * 昵称允许 12 字，中文之外还可能是 emoji / 罗马数字这类「超出 BMP」的字符：
   * `charAt(0)` 会把一个 emoji 劈成半截代理对，画出来是一个乱码方块。
   * 中文取整个汉字（用户口径：「第一个字母或者汉字」），英文取首字母并大写。
   */
  function firstCharOf(nickname) {
    var s = String(nickname == null ? "" : nickname).trim();
    if (!s) return "";
    var arr = typeof Array.from === "function" ? Array.from(s) : s.split("");
    var c = arr[0] || "";
    if (!/\S/.test(c)) return "";                    // 空白与控制字符不算「一个字」
    /* 拉丁字母统一大写：`ashley` 与 `Ashley` 画出来该是同一枚印 */
    if (c.length === 1 && c >= "a" && c <= "z") c = c.toUpperCase();
    return c;
  }

  /* ------------------------------------------------------------ 图片地址 */

  /**
   * 头像地址合法性 —— **白名单，不是黑名单**。
   *
   * 只有三种放行：
   *   · `https://…`  —— Supabase Storage 的公开地址
   *   · `/api/avatar/…` —— 本站自己的图片下载口（云端图在本机的缓存地址）
   *   · `data:image/<png|jpeg|webp>;base64,…` —— **只可能来自导入的备份**
   *     （正常路径一律上传到 Storage，不落 base64；见文件头第 3 条规矩）
   *
   * ⚠️ 刻意**不认** `javascript:` / `blob:` / 任意 `http:`：
   *    地址是用户可控的字符串，`<img src>` 与将来的链接都吃它。
   *    放行 `javascript:` 的后果不是「图不显示」，是**一个 XSS 口子**。
   */
  function isImgUrl(u) {
    var s = String(u == null ? "" : u).trim();
    if (!s || s.length > URL_MAX) return false;
    if (/^https:\/\/[^\s"'<>]+$/i.test(s)) return true;
    if (s.indexOf("/api/avatar/") === 0 && !/[\s"'<>]/.test(s)) return true;
    if (/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/i.test(s)) return true;
    return false;
  }

  /** 归一化头像字段：**只有 `img` 一个键**，非法 / 缺省一律空串 */
  function normAvatar(a) {
    if (!a || typeof a !== "object") return { img: "" };
    return { img: isImgUrl(a.img) ? String(a.img).trim() : "" };
  }

  /* -------------------------------------------------------------- 档案读写 */

  /** 空档案（新用户 / 解析失败都落这里）：头像留空，由 display() 回落到首字印 */
  function emptyProfile() {
    return { v: 1, nickname: "", avatar: { img: "" } };
  }

  /** 读档案。解析失败 / 形状不对 → 空档案（不抛） */
  function read(backing) {
    var child = target(backing);
    if (child) return child;
    var o = safeParse(safeGet(backing, NS));
    if (!o || typeof o !== "object") return emptyProfile();
    return {
      v: 1,
      nickname: String(o.nickname == null ? "" : o.nickname).slice(0, 12),
      avatar: normAvatar(o.avatar)
    };
  }

  function write(backing, data) {
    /* 名册在场时写回**当前子用户**（昵称 + 头像都属孩子）。
       ⚠️ 先试子用户、写不进去才落老键 —— 反过来会让同一个昵称有两份，
          而「两份」的症状是「顶栏一个名字、设置页另一个」。 */
    if (backing && currentChild(backing)) {
      var okChild = saveToChild(backing, {
        nickname: String((data && data.nickname) == null ? "" : data.nickname).trim().slice(0, 12),
        avatar: normAvatar(data && data.avatar)
      });
      if (okChild) return true;
    }
    if (!backing) return false;
    var clean = {
      v: 1,
      nickname: String((data && data.nickname) == null ? "" : data.nickname).trim().slice(0, 12),
      avatar: normAvatar(data && data.avatar)
    };
    return safePut(backing, NS, JSON.stringify(clean));
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
    var legacy = safeParse(safeGet(backing, LEGACY_SETTINGS_NS));
    if (legacy && typeof legacy === "object" && legacy.username != null) {
      return String(legacy.username).trim().slice(0, 12);
    }
    return "";
  }

  /**
   * 写昵称到账号域 `poem_profile_v1`。读盘失败（隐私模式）时静默返回 false，不抛。
   * ⚠️ **不动老键 `poem_recite_settings_v1.username`** —— 镜像写由 `saveNickname` 做。
   */
  function setNickname(backing, name) {
    var cur = read(backing);
    cur.nickname = String(name == null ? "" : name).trim().slice(0, 12);
    return write(backing, cur);
  }

  /**
   * 清掉老键里的 `username` 字段（**阶段 0 的迁移动作**，本轮不调用）。
   * 保留在这里是为了让「迁移」这件事只有一个实现。幂等。
   */
  function clearLegacyNickname(backing) {
    if (!backing) return false;
    var legacy = safeParse(safeGet(backing, LEGACY_SETTINGS_NS));
    if (!legacy || typeof legacy !== "object" || legacy.username == null) return false;
    delete legacy.username;
    return safePut(backing, LEGACY_SETTINGS_NS, JSON.stringify(legacy));
  }

  /**
   * 便捷入口：改昵称时**同时**写新键与老键（镜像）。
   * 各页写入点调这一个函数，不要各自去拼两处 setItem —— 拼两处必然有一天
   * 只改了其中一处，出现「首页显示新名字、设置页还是旧名字」这类漂移。
   */
  function saveNickname(backing, name) {
    var clean = String(name == null ? "" : name).trim().slice(0, 12);
    var ok = setNickname(backing, clean);
    if (!backing) return ok;
    var legacy = safeParse(safeGet(backing, LEGACY_SETTINGS_NS));
    if (!legacy || typeof legacy !== "object") legacy = {};
    legacy.username = clean;
    safePut(backing, LEGACY_SETTINGS_NS, JSON.stringify(legacy));
    return ok;
  }

  function avatar(backing) { return read(backing).avatar; }

  /**
   * 设头像地址。
   *
   * ⚠️ **这里不删本机那份图**，哪怕传的是空串。理由：`{ img: "" }` 有两种情形，
   *    而它们要做的事完全不同 ——
   *      · **上传那条路**：本机那份刚写好、云端地址还没回来 → 空串是「暂时还没有」，
   *        这时把本机那份清掉，用户刚裁完的图当场消失（看着像「点了没反应」）
   *      · **删除那条路**：用户点了删除 → 走下面的 `resetAvatar()`，它才清
   *    两份语义合成一处，必然有一边是错的。所以「删」只认 `resetAvatar()`。
   *
   * ⚠️ 非法地址**不写盘**并返回 `ok:false`（与「读的时候回落」不同：
   *    写脏值说明调用方传错了，应该当场知道）。
   */
  function setAvatar(backing, patch) {
    var p = patch && typeof patch === "object" ? patch : {};
    var next = read(backing);
    if (p.img != null) {
      var v = String(p.img).trim();
      if (v && !isImgUrl(v)) return { ok: false, code: "E_IMG", message: "这个图片地址不能用" };
      next.avatar.img = v;
    }
    var ok = write(backing, next);
    return { ok: ok, avatar: next.avatar, code: ok ? "" : "E_WRITE" };
  }

  /** 删掉头像（回到首字印），不动昵称 */
  function resetAvatar(backing) {
    var cur = read(backing);
    cur.avatar = { img: "" };
    var ok = write(backing, cur);
    if (ok) clearLocalImage(backing);
    return { ok: ok, avatar: cur.avatar };
  }

  /* ------------------------------------------------- 本机那份图（设备域） */

  /** 读本机那份图的 data URL（没有 → 空串）。**只认 data:image**，别的都是脏值 */
  function localImage(backing) {
    var o = safeParse(safeGet(backing, LOCAL_NS));
    var v = o && typeof o === "object" ? String(o.img == null ? "" : o.img) : "";
    return /^data:image\//.test(v) ? v : "";
  }

  /**
   * 存本机那份图。
   *
   * ⚠️ **写不进去不是错误**：localStorage 通常只有 5MB，一张 256×256 的
   *    JPEG 大约 10~20KB，正常情况下绰绰有余，但别人家的站点数据可能已经
   *    把配额吃满（QuotaExceeded）。这时**静默降级**：云端地址已经存好了，
   *    在线时画得出来、离线时回落到首字印 —— 比弹一个错误框好得多。
   */
  function setLocalImage(backing, dataUrl) {
    var v = String(dataUrl == null ? "" : dataUrl);
    if (!/^data:image\//.test(v)) return false;
    if (v.length > 400 * 1024) return false;         // 超大的直接不存（不是错误，是拒绝）
    return safePut(backing, LOCAL_NS, JSON.stringify({ v: 1, img: v }));
  }

  function clearLocalImage(backing) {
    if (!backing) return false;
    try { backing.removeItem(LOCAL_NS); return true; } catch (e) { return false; }
  }

  /* ---------------------------------------------------------------- 显示 */

  /**
   * 显示用的那一枚 —— **两档回落**，永远有东西可画：
   *   ① 图片（本机那份字节，或云端地址）→ ② 昵称第一个字 / 字母
   *   → ③ 默认「诗」（昵称为空时）
   *
   * ⚠️ `img` 与 `src` 是两件事，界面**不许把它们混起来用**：
   *    · `img` 是账号域那个地址（上传成功之后才有，跟着同步与导出走）
   *    · `src` 是**现在这一台设备上真能画出来的那个地址** —— 本机那份
   *      data URL 优先于 `img`（离线也画得出；且刚裁完还没传上去的那几秒里，
   *      用户看到的立刻就是自己刚选的那张，不用等网络）
   *    · `hasImage` 是「这一档是图片不是首字」，两处都看它
   */
  function display(backing) {
    var prof = read(backing);
    var nick = nickname(backing);
    var fromNick = firstCharOf(nick);
    var img = prof.avatar.img;
    /* ⚠️ 本机那份图**不依赖**云端地址是否在：它就是「这台设备上用户选的那张图」。
       刚裁完还没传上去的那几秒、以及「传失败了但用户明明选过」这两种情况下，
       `img` 还是空的 —— 而用户要看到的是自己刚选的那张，不是用户名首字。
       （`avatar.localImage` 只可能是我们自己写进去的 data URL，见 setLocalImage。） */
    var local = localImage(backing);
    var src = local || img;
    var char = fromNick || DEFAULT_CHAR;
    var source = src ? "image" : (fromNick ? "nickname" : "default");
    var name = nick || "Ashley";
    var label = source === "image" ? (name + "的头像")
      : ("头像：" + char + "（" + (source === "nickname" ? "用户名首字" : "默认") + "）");
    return {
      char: char,
      img: img,
      src: src,
      source: source,
      hasImage: !!src,
      nickname: nick,
      name: name,
      isDefaultName: !nick,
      label: label
    };
  }

  /** 画**指定一份**档案的印（不是盘上那一份）—— 子用户名册要一次画 N 枚 */
  function displayOf(prof) {
    var p = prof && typeof prof === "object" ? prof : {};
    var av = normAvatar(p.avatar);
    var nick = String(p.nickname == null ? "" : p.nickname).trim().slice(0, 12);
    var fromNick = firstCharOf(nick);
    var img = av.img;
    var char = fromNick || DEFAULT_CHAR;
    var source = img ? "image" : (fromNick ? "nickname" : "default");
    var name = nick || "Ashley";
    return {
      char: char, img: img, src: img, source: source, hasImage: !!img,
      nickname: nick, name: name, isDefaultName: !nick,
      label: source === "image" ? (name + "的头像")
        : ("头像：" + char + "（" + (source === "nickname" ? "用户名首字" : "默认") + "）")
    };
  }

  /**
   * 渲染成一段 HTML（不带事件）。
   *
   * 为什么放在这一层而不是各页面：全站几处要画这枚印（顶栏 / 设置页 / 个人中心 /
   * 子用户名册），各画一遍必然走形（尺寸、圆角、字重各一份）。
   *
   * ⚠️ 图片那一档**必带 `loading="lazy"` 与 `referrerpolicy`**：
   *    前者是因为首页/集子里一次可能画好几枚（子用户名册），
   *    后者是因为 Storage 地址是跨域资源，不该把本站地址带过去。
   * ⚠️ `alt` 用「某某的头像」而不是空串：读屏软件对空 alt 直接跳过，
   *    而这一枚恰恰是「我是谁」的锚点（与上一版 aria-label 同一条口径）。
   */
  function html(backing, opts) {
    var o = opts || {};
    return renderHtml(display(backing), o);
  }

  function htmlFor(prof, opts) {
    var o = opts || {};
    return renderHtml(displayOf(prof), o);
  }

  function renderHtml(d, o) {
    var cls = "avatar" + (o.cls ? " " + String(o.cls) : "");
    var style = o.size ? ' style="--avatar-size:' + Number(o.size) + 'px"' : "";
    var body = d.hasImage
      ? '<img class="avatar-img" src="' + esc(d.src) + '" alt="" loading="lazy" ' +
        'decoding="async" referrerpolicy="no-referrer" />'
      : esc(d.char);
    return '<span class="' + cls + '" role="img" aria-label="' + esc(d.label) + '"' +
      ' title="' + esc(d.label) + '"' + style + ">" + body + "</span>";
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
    NS: NS, LOCAL_NS: LOCAL_NS, LEGACY_SETTINGS_NS: LEGACY_SETTINGS_NS,
    DEFAULT_CHAR: DEFAULT_CHAR, URL_MAX: URL_MAX, MAX_PX: MAX_PX,
    firstCharOf: firstCharOf, isImgUrl: isImgUrl, normAvatar: normAvatar,
    emptyProfile: emptyProfile,
    read: read, write: write,
    nickname: nickname, setNickname: setNickname,
    saveNickname: saveNickname, clearLegacyNickname: clearLegacyNickname,
    avatar: avatar, setAvatar: setAvatar, resetAvatar: resetAvatar,
    localImage: localImage, setLocalImage: setLocalImage, clearLocalImage: clearLocalImage,
    display: display, displayOf: displayOf, html: html, htmlFor: htmlFor, esc: esc,
    defaultBacking: defaultBacking
  };
});
