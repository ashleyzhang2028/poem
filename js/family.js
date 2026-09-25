(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Family = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var NS = "poem_family_v1";

  var LEGACY_PROFILE_NS = "poem_profile_v1";

  // 本机那份头像字节（Issue #320 起跟着子用户走）。真名归 `Avatar.LOCAL_NS`，
  // 这里只借它判「是不是这一族」——写死一份字面量就会有两份真相。
  function avatarLocalNS() {
    var g = typeof globalThis !== "undefined" ? globalThis : null;
    var A = g && g.Avatar;
    return (A && A.LOCAL_NS) || "poem_avatar_local_v1";
  }

  var NAME_MAX = 12;

  var FALLBACK = { free: 1, pro: 3, max: 180 };

  function safeGet(backing, key) {
    if (!backing) return null;
    try { return backing.getItem(key); } catch (e) { return null; }
  }

  function safeParse(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) { return null; }
  }

  function safePut(backing, key, text) {
    if (!backing) return false;
    try { backing.setItem(key, text); return true; } catch (e) { return false; }
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

  function now() { return Date.now(); }

  function uid() {
    return "f-" + now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
  }

  function cleanName(name) {
    return String(name == null ? "" : name).trim().replace(/\s+/g, " ").slice(0, NAME_MAX);
  }

  function normAvatar(a) {
    if (!a || typeof a !== "object") return { img: "" };
    return { img: typeof a.img === "string" ? a.img : "" };
  }

  function normProfile(p) {
    if (!p || typeof p !== "object") return null;
    var id = String(p.id == null ? "" : p.id).trim();
    return {
      id: id || uid(),
      nickname: cleanName(p.nickname),
      avatar: normAvatar(p.avatar),
      createdAt: Number(p.createdAt) > 0 ? Number(p.createdAt) : now()
    };
  }

  function read(backing) {
    var b = backing === undefined ? defaultBacking() : backing;
    var o = safeParse(safeGet(b, NS));
    if (!o || typeof o !== "object" || !Array.isArray(o.profiles)) {
      return { v: 1, at: "", profiles: [] };
    }
    var list = o.profiles.map(normProfile).filter(function (p) { return !!p; });

    var seen = {};
    list = list.filter(function (p) {
      if (seen[p.id]) return false;
      seen[p.id] = true;
      return true;
    });
    var at = String(o.at == null ? "" : o.at);
    if (!at || !seen[at]) at = list.length ? list[0].id : "";
    return { v: 1, at: at, profiles: list };
  }

  function write(backing, data) {
    var b = backing === undefined ? defaultBacking() : backing;
    var clean = {
      v: 1,
      at: String((data && data.at) || ""),
      profiles: ((data && data.profiles) || []).map(normProfile).filter(function (p) { return !!p; })
    };
    return safePut(b, NS, JSON.stringify(clean));
  }

  function storeKeys(b) {
    if (!b) return [];
    try {
      if (typeof b.length === "number" && typeof b.key === "function") {
        var out = [];
        for (var i = 0; i < b.length; i++) {
          var k = b.key(i);
          if (k) out.push(k);
        }
        return out;
      }
    } catch (e) {  }
    try {
      if (typeof b.raw === "function") return Object.keys(b.raw() || {});
    } catch (e) {  }
    if (b.__keys && typeof b.__keys === "object") return Object.keys(b.__keys);
    return [];
  }

  function legacyProfile(backing) {
    var b = backing === undefined ? defaultBacking() : backing;
    var o = safeParse(safeGet(b, LEGACY_PROFILE_NS));
    if (!o || typeof o !== "object" || Array.isArray(o)) return null;
    if (!o.nickname && !o.avatar) return null;
    return { nickname: cleanName(o.nickname), avatar: normAvatar(o.avatar) };
  }

  function ensure(backing) {
    var b = backing === undefined ? defaultBacking() : backing;
    var data = read(b);
    if (data.profiles.length) return { created: 0, data: data };

    var A = (typeof globalThis !== "undefined" && globalThis.Avatar) || null;
    var legacy = legacyProfile(b);
    var nickname = legacy ? legacy.nickname : "";
    var avatar = legacy ? legacy.avatar : { img: "" };

    if (!nickname && A && A.nickname) {
      try { nickname = cleanName(A.nickname(b)); } catch (e) { nickname = ""; }
    }

    var first = normProfile({ id: uid(), nickname: nickname, avatar: avatar, createdAt: now() });
    var next = { v: 1, at: first.id, profiles: [first] };
    var ok = write(b, next);
    if (ok) {
      adoptLegacyData(b, first.id);
      adoptLegacyAvatarBytes(b, first.id);
    }
    return { created: ok ? 1 : 0, data: read(b), adopted: ok ? first.id : "" };
  }

  function restore(cloud, opt) {
    var o = opt || {};
    var backing = o.backing === undefined ? defaultBacking() : o.backing;
    var raw = cloud && typeof cloud === "object" ? cloud : null;
    if (!raw || !Array.isArray(raw.profiles) || !raw.profiles.length) {
      return { ok: false, code: "E_EMPTY" };
    }
    var clean = raw.profiles.map(normProfile).filter(function (p) { return !!p; });
    var seen = {};
    clean = clean.filter(function (p) {
      if (seen[p.id]) return false;
      seen[p.id] = true;
      return true;
    });
    if (!clean.length) return { ok: false, code: "E_EMPTY" };
    var at = String(raw.at == null ? "" : raw.at);
    if (!seen[at]) at = clean[0].id;
    var next = { v: 1, at: at, profiles: clean };
    if (!write(backing, next)) return { ok: false, code: "E_WRITE" };
    return { ok: true, data: read(backing) };
  }

  function adoptLegacyData(b, profileId) {
    if (!b || !profileId) return [];
    var moved = [];
    var keysNow = sharedKeys();
    var perChild = [keysNow.progress, keysNow.settings];

    try {
      var names = storeKeys(b);
      names.forEach(function (k) {
        if (k && /^poem_.*_read_v1$/.test(k)) perChild.push(k);
      });
    } catch (e) {  }

    perChild.forEach(function (key) {
      var text = safeGet(b, key);
      if (!text) return;
      var target = keyFor(key, profileId);
      if (target === key) return;
      if (safeGet(b, target)) return;
      if (!safePut(b, target, text)) return;
      try { b.removeItem(key); } catch (e) {  }
      moved.push(key);
    });
    return moved;
  }

  // 把「不分家那份头像字节」搬到第一个子用户名下（Issue #320）。
  //
  // 老用户第一次升级到这里时发生一次（`ensure()` 末尾）：
  // 老键上那一张图归**第一个孩子**，然后老键本身撤掉 ——
  // 同一份字节留两处就是第二份真相，而下一回「切孩子」还会按老键画错一次。
  //
  // `adoptAvatarBytes()`（模块出口那一个）是另一件事：它给「另外几个孩子
  // 一个字节都没有」的那些设备用 —— 老键只能搬一次，搬不到第二个孩子头上，
  // 与其让他们顶着别人那张脸，不如回到自己的首字印。
  //
  // ⚠️ 搬完就把老键删掉。
  function moveAvatarBytes(b, fromKey, toKey) {
    if (!b || !fromKey || !toKey || fromKey === toKey) return false;
    var text = safeGet(b, fromKey);
    if (!text) return false;
    if (safeGet(b, toKey)) return false;
    if (!safePut(b, toKey, text)) return false;
    try { b.removeItem(fromKey); } catch (e) {  }
    return true;
  }

  function adoptLegacyAvatarBytes(b, profileId) {
    if (!b || !profileId) return "";
    var base = avatarLocalNS();
    if (moveAvatarBytes(b, base, keyFor(base, profileId))) return profileId;
    return "";
  }

  function limit(opt) {
    var o = opt || {};
    var g = typeof globalThis !== "undefined" ? globalThis : null;
    var E = o.E || (g && g.Entitlement) || null;
    var backing = o.backing === undefined ? defaultBacking() : o.backing;

    if (!E || !E.identity) return Infinity;
    var id = null;
    try { id = E.identity({ backing: backing }); } catch (e) { id = null; }
    if (!id) return Infinity;

    var n = null;
    if (typeof E.quotaFor === "function" && E.CAPS) {
      n = E.quotaFor(E.CAPS["profile.family"], id.tier);
    }
    if (typeof n !== "number") n = FALLBACK[id.tier];
    return typeof n === "number" ? n : FALLBACK.free;
  }

  function remaining(opt) {
    var o = opt || {};
    var backing = o.backing === undefined ? defaultBacking() : o.backing;
    return Math.max(0, limit(o) - read(backing).profiles.length);
  }

  function create(name, opt) {
    var o = opt || {};
    var backing = o.backing === undefined ? defaultBacking() : o.backing;
    var data = ensure(backing).data;
    var lim = limit({ backing: backing, E: o.E });
    if (data.profiles.length >= lim) {
      return { ok: false, code: "E_LIMIT", limit: lim, count: data.profiles.length };
    }
    var p = normProfile({ id: uid(), nickname: name, avatar: o.avatar, createdAt: now() });
    data.profiles.push(p);
    if (!write(backing, data)) return { ok: false, code: "E_WRITE" };
    return { ok: true, profile: p, data: read(backing) };
  }

  function rename(profileId, name, opt) {
    var o = opt || {};
    var backing = o.backing === undefined ? defaultBacking() : o.backing;
    var data = read(backing);
    var hit = null;
    data.profiles.forEach(function (p) { if (p.id === profileId) hit = p; });
    if (!hit) return { ok: false, code: "E_NOT_FOUND" };
    hit.nickname = cleanName(name);
    if (!write(backing, data)) return { ok: false, code: "E_WRITE" };
    return { ok: true, profile: hit };
  }

  function setAvatar(profileId, patch, opt) {
    var o = opt || {};
    var backing = o.backing === undefined ? defaultBacking() : o.backing;
    var data = read(backing);
    var hit = null;
    data.profiles.forEach(function (p) { if (p.id === profileId) hit = p; });
    if (!hit) return { ok: false, code: "E_NOT_FOUND" };
    var p = patch && typeof patch === "object" ? patch : {};
    var A = (typeof globalThis !== "undefined" && globalThis.Avatar) || null;
    if (p.img != null) {
      var v = typeof p.img === "string" ? p.img.trim() : "";

      if (v && A && A.isImgUrl && !A.isImgUrl(v)) return { ok: false, code: "E_IMG" };
      hit.avatar.img = v;
    }
    if (!write(backing, data)) return { ok: false, code: "E_WRITE" };
    return { ok: true, profile: hit };
  }

  function remove(profileId, opt) {
    var o = opt || {};
    var backing = o.backing === undefined ? defaultBacking() : o.backing;
    var data = read(backing);
    if (data.profiles.length <= 1) return { ok: false, code: "E_LAST" };
    var before = data.profiles.length;
    data.profiles = data.profiles.filter(function (p) { return p.id !== profileId; });
    if (data.profiles.length === before) return { ok: false, code: "E_NOT_FOUND" };
    if (data.at === profileId) data.at = data.profiles[0].id;
    if (!write(backing, data)) return { ok: false, code: "E_WRITE" };
    return { ok: true, data: read(backing) };
  }

  function select(profileId, opt) {
    var o = opt || {};
    var backing = o.backing === undefined ? defaultBacking() : o.backing;
    var data = read(backing);
    var hit = false;
    data.profiles.forEach(function (p) { if (p.id === profileId) hit = true; });
    if (!hit) return { ok: false, code: "E_NOT_FOUND" };
    data.at = profileId;
    if (!write(backing, data)) return { ok: false, code: "E_WRITE" };
    return { ok: true, data: read(backing) };
  }

  function currentId(opt) {
    var o = opt || {};
    var backing = o.backing === undefined ? defaultBacking() : o.backing;
    return read(backing).at;
  }

  function current(opt) {
    var o = opt || {};
    var backing = o.backing === undefined ? defaultBacking() : o.backing;
    var data = read(backing);
    var hit = null;
    data.profiles.forEach(function (p) { if (p.id === data.at) hit = p; });
    return hit;
  }

  function list(opt) {
    var o = opt || {};
    var backing = o.backing === undefined ? defaultBacking() : o.backing;
    return read(backing).profiles;
  }

  function count(opt) {
    return list(opt).length;
  }

  function sharedKeys() {
    var g = typeof globalThis !== "undefined" ? globalThis : null;
    var PS = g && g.ProgressStore;
    var K = PS && PS.KEYS ? PS.KEYS : {};
    return {
      progress: K.progress || "poem_recite_progress_v1",
      settings: K.settings || "poem_recite_settings_v1",
      profile: K.profile || "poem_profile_v1",
      device: K.device || "poem_device_prefs_v1"
    };
  }

  function isPerChild(key) {
    var k = String(key == null ? "" : key);
    var K = sharedKeys();

    var g0 = typeof globalThis !== "undefined" ? globalThis : null;

    var SS = g0 && g0.SyncStore;
    if (SS && typeof SS.perChildKey === "function") {
      var ans = null;
      try { ans = SS.perChildKey(k); } catch (e) { ans = null; }
      if (ans !== null && ans !== undefined) return !!ans;
    }

    var PS0 = g0 && g0.ProgressStore;
    if (PS0 && PS0.scopes) {
      var hit = null;
      try {
        hit = (PS0.scopes() || []).filter(function (sc) { return sc.key === k; })[0] || null;
      } catch (e) { hit = null; }
      if (!hit && PS0.isReadKey && PS0.isReadKey(k)) return true;
      if (hit) return !!hit.perChild;
    }

    if (k === K.progress || k === K.settings) return true;
    if (k === K.profile) return false;
    if (k === K.device) return false;

    // 本机那份头像字节（Issue #320）：它画的是「这个孩子长什么样」，
    // 与昵称同属「你是谁」。从前它按设备域不分家 —— 于是切了子用户，
    // 昵称换了、头像还是上一个孩子那张脸（用户报的就是这个）。
    // ⚠️ 它同时是同步域里唯一一份「按子用户分家」的（见 sync-store.perChildKey）。
    if (k === avatarLocalNS() || k.indexOf(avatarLocalNS() + "::") === 0) return true;

    if (/^poem_.*_read_v1$/.test(k)) return true;

    if (/^poem_(font|align|reader|ios_|play)/.test(k)) return false;

    return true;
  }

  function keyFor(key, profileId) {
    var pid = String(profileId == null ? "" : profileId);
    if (!pid) return key;
    if (!isPerChild(key)) return key;
    return key + "::" + pid;
  }

  function keyMap(opt) {
    var o = opt || {};
    var backing = o.backing === undefined ? defaultBacking() : o.backing;
    var pid = o.profileId === undefined ? currentId({ backing: backing }) : String(o.profileId || "");
    var K = o.keys || sharedKeys();
    var out = {};
    Object.keys(K).forEach(function (name) { out[name] = keyFor(K[name], pid); });
    return { profileId: pid, keys: out, perChild: !!pid };
  }

  function backingOf(opt) {
    var o = opt || {};
    return o.backing === undefined ? defaultBacking() : o.backing;
  }

  return {
    NS: NS,
    LEGACY_PROFILE_NS: LEGACY_PROFILE_NS,
    NAME_MAX: NAME_MAX,

    FREE_PROFILES: FALLBACK.free,
    PRO_PROFILES: FALLBACK.pro,
    MAX_PROFILES: FALLBACK.max,
    FALLBACK: FALLBACK,

    cleanName: cleanName,
    normAvatar: normAvatar,
    normProfile: normProfile,

    read: function (opt) { return read(backingOf(opt)); },
    write: function (data, opt) { return write(backingOf(opt), data); },
    ensure: function (opt) {
      var r = ensure(backingOf(opt));
      return r.data;
    },
    ensureDetailed: function (opt) { return ensure(backingOf(opt)); },
    adoptLegacyData: function (profileId, opt) { return adoptLegacyData(backingOf(opt), profileId); },

    limit: function (opt) { return limit(opt); },
    remaining: function (opt) { return remaining(opt); },

    create: function (name, opt) { return create(name, opt); },
    rename: function (id, name, opt) { return rename(id, name, opt); },
    setAvatar: function (id, patch, opt) { return setAvatar(id, patch, opt); },
    remove: function (id, opt) { return remove(id, opt); },
    select: function (id, opt) { return select(id, opt); },

    restore: function (cloud, opt) { return restore(cloud, opt); },

    list: function (opt) { return list(opt); },
    count: function (opt) { return count(opt); },
    currentId: function (opt) { return currentId(opt); },
    current: function (opt) { return current(opt); },

    adoptAvatarBytes: function (profileId, opt) {
      return adoptLegacyAvatarBytes(backingOf(opt), profileId);
    },

    sharedKeys: sharedKeys,
    isPerChild: isPerChild,
    keyFor: keyFor,
    keyMap: keyMap,
    defaultBacking: defaultBacking,
    storeKeys: storeKeys
  };
});
