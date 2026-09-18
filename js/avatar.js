(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Avatar = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var NS = "poem_profile_v1";

  var LOCAL_NS = "poem_avatar_local_v1";

  var LEGACY_SETTINGS_NS = "poem_recite_settings_v1";

  var DEFAULT_CHAR = "诗";

  var URL_MAX = 512;

  var MAX_PX = 512;

  var IMG_ATTRS =
    'loading="lazy" decoding="async" referrerpolicy="no-referrer" ' +
    'width="26" height="26"';

  function familyMod() {
    var g = typeof globalThis !== "undefined" ? globalThis : null;
    return g && g.Family ? g.Family : null;
  }

  function currentChild(backing) {
    var F = familyMod();
    if (!F || !F.current) return null;
    try { return F.current({ backing: backing }); } catch (e) { return null; }
  }

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

  function firstCharOf(nickname) {
    var s = String(nickname == null ? "" : nickname).trim();
    if (!s) return "";
    var arr = typeof Array.from === "function" ? Array.from(s) : s.split("");
    var c = arr[0] || "";
    if (!/\S/.test(c)) return "";

    if (c.length === 1 && c >= "a" && c <= "z") c = c.toUpperCase();
    return c;
  }

  function isImgUrl(u) {
    var s = String(u == null ? "" : u).trim();
    if (!s || s.length > URL_MAX) return false;
    if (/^https:\/\/[^\s"'<>]+$/i.test(s)) return true;
    if (s.indexOf("/api/avatar/") === 0 && !/[\s"'<>]/.test(s)) return true;
    if (/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/i.test(s)) return true;
    return false;
  }

  function normAvatar(a) {
    if (!a || typeof a !== "object") return { img: "" };
    return { img: isImgUrl(a.img) ? String(a.img).trim() : "" };
  }

  function emptyProfile() {
    return { v: 1, nickname: "", avatar: { img: "" } };
  }

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

  function nickname(backing) {
    var n = read(backing).nickname;
    if (n) return n;
    var legacy = safeParse(safeGet(backing, LEGACY_SETTINGS_NS));
    if (legacy && typeof legacy === "object" && legacy.username != null) {
      return String(legacy.username).trim().slice(0, 12);
    }
    return "";
  }

  function setNickname(backing, name) {
    var cur = read(backing);
    cur.nickname = String(name == null ? "" : name).trim().slice(0, 12);
    return write(backing, cur);
  }

  function clearLegacyNickname(backing) {
    if (!backing) return false;
    var legacy = safeParse(safeGet(backing, LEGACY_SETTINGS_NS));
    if (!legacy || typeof legacy !== "object" || legacy.username == null) return false;
    delete legacy.username;
    return safePut(backing, LEGACY_SETTINGS_NS, JSON.stringify(legacy));
  }

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

  function resetAvatar(backing) {
    var cur = read(backing);
    cur.avatar = { img: "" };
    var ok = write(backing, cur);
    if (ok) clearLocalImage(backing);
    return { ok: ok, avatar: cur.avatar };
  }

  function localImage(backing) {
    var o = safeParse(safeGet(backing, LOCAL_NS));
    var v = o && typeof o === "object" ? String(o.img == null ? "" : o.img) : "";
    return /^data:image\//.test(v) ? v : "";
  }

  function setLocalImage(backing, dataUrl) {
    var v = String(dataUrl == null ? "" : dataUrl);
    if (!/^data:image\//.test(v)) return false;
    if (v.length > 400 * 1024) return false;
    return safePut(backing, LOCAL_NS, JSON.stringify({ v: 1, img: v }));
  }

  function clearLocalImage(backing) {
    if (!backing) return false;
    try { backing.removeItem(LOCAL_NS); return true; } catch (e) { return false; }
  }

  function display(backing) {
    var prof = read(backing);
    var nick = nickname(backing);
    var fromNick = firstCharOf(nick);
    var img = prof.avatar.img;

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

    if (o.dock) {
      var dockBody = d.hasImage
        ? '<img class="avatar-img" src="' + esc(d.src) + '" alt="" ' + IMG_ATTRS + " />"
        : esc(d.char);
      return '<span class="avatar avatar-dock" role="img" aria-label="' + esc(d.label) + '"' +
        ' title="' + esc(d.label) + '">' + dockBody + "</span>";
    }
    var body = d.hasImage
      ? '<img class="avatar-img" src="' + esc(d.src) + '" alt="" loading="lazy" ' +
        'decoding="async" referrerpolicy="no-referrer" />'
      : esc(d.char);
    return '<span class="' + cls + '" role="img" aria-label="' + esc(d.label) + '"' +
      ' title="' + esc(d.label) + '"' + style + ">" + body + "</span>";
  }

  function defaultBacking() {
    var g = typeof globalThis !== "undefined" ? globalThis : null;
    if (!g) return null;
    try {
      return g.localStorage && typeof g.localStorage.getItem === "function" ? g.localStorage : null;
    } catch (e) {
      return null;
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
