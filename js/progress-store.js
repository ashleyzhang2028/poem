(function () {
  "use strict";

  var KEYS = {
    progress: "poem_recite_progress_v1",
    settings: "poem_recite_settings_v1",
    profile: "poem_profile_v1",
    device: "poem_device_prefs_v1",
    search: "poem_search_kw_v1",
    premerge: "poem_pre_merge_backup_v1",

    dailyExtra: "poem_daily_extra_v1",

    collections: "poem_recite_collections_v1",

    pinyinFix: "poem_pinyin_fix_v1",

    reads: "poem_poems_read_v1"
  };

  var READ_SCOPE_KEY = "poem_reads:*";

  var FIELDS = {
    settings: ["grade", "term", "scope", "dailyCount", "algo"],
    device: ["helper"]
  };

  var DEFAULTS = {
    grade: 1,
    term: 1,
    dailyCount: 5,

    scope: "upto",
    algo: "ebbinghaus"
  };
  var DEVICE_DEFAULT = { helper: "on" };

  var HELPER_ON = "on";
  var HELPER_OFF = "off";

  var backing = null;
  try {
    backing = typeof window !== "undefined" ? window.localStorage : null;
  } catch (e) {
    backing = null;
  }

  function raw(key) {
    if (!backing) return null;
    try {
      return backing.getItem(kk(key));
    } catch (e) {
      return null;
    }
  }

  function physKey(key) {
    return kk(key);
  }

  function put(key, text) {
    if (!backing) return false;
    try {
      backing.setItem(physKey(key), text);
      return true;
    } catch (e) {
      return false;
    }
  }

  function drop(key) {
    if (!backing) return false;
    try {
      backing.removeItem(physKey(key));
      return true;
    } catch (e) {
      return false;
    }
  }

  function familyMod() {
    return typeof window !== "undefined" && window.Family ? window.Family : null;
  }

  function childId() {
    var F = familyMod();
    if (!F || !F.currentId) return "";
    try { return String(F.currentId({ backing: backing }) || ""); } catch (e) { return ""; }
  }

  function kk(key) {
    var F = familyMod();
    var pid = childId();
    if (!F || !F.keyFor || !pid) return key;
    try { return F.keyFor(key, pid); } catch (e) { return key; }
  }

  function perChild(key) {
    var F = familyMod();
    if (!F || !F.isPerChild) return key === KEYS.progress || key === KEYS.settings;
    try { return !!F.isPerChild(key); } catch (e) { return false; }
  }

  function parse(text, fallback) {
    if (typeof text !== "string") return fallback;
    try {
      var v = JSON.parse(text);
      return v === null || v === undefined ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function readObject(key) {
    var v = parse(raw(key), {});
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  }

  function pick(src, fields, defaults, project) {
    var out = {};
    fields.forEach(function (k) {
      var v = (src || {})[k];
      out[k] = project ? project(k, v) : v;
    });
    Object.keys(defaults || {}).forEach(function (k) {
      if (out[k] === undefined || out[k] === null || out[k] === "") out[k] = defaults[k];
    });
    return out;
  }

  function allProgress() {
    return readObject(KEYS.progress);
  }

  function saveProgress(map) {
    return put(KEYS.progress, JSON.stringify(map || {}));
  }

  function pruneUnknown(knownIds) {

    if (!knownIds || !knownIds.length) return [];
    var known = {};
    knownIds.forEach(function (id) { known[id] = true; });
    var all = allProgress();
    var gone = Object.keys(all).filter(function (id) { return !known[id]; });
    if (!gone.length) return [];
    gone.forEach(function (id) { delete all[id]; });
    saveProgress(all);
    return gone;
  }

  function settings() {

    var stored = readObject(KEYS.settings);
    if (!Object.keys(stored).length) stored = readObject(KEYS.settings);
    var out = pick(stored, FIELDS.settings, DEFAULTS);

    if (typeof stored.username === "string") out.username = stored.username;
    return out;
  }

  function saveSettings(s) {
    var clean = pick(s, FIELDS.settings, DEFAULTS);
    if (s && typeof s.username === "string") clean.username = s.username;
    if (s && (s.helper === HELPER_ON || s.helper === HELPER_OFF)) {
      clean.helper = s.helper;
      put(KEYS.device, JSON.stringify({ v: 1, helper: s.helper }));
    }
    return put(KEYS.settings, JSON.stringify(clean));
  }

  function patchSettings(patch) {
    var next = settings();
    Object.keys(patch || {}).forEach(function (k) { next[k] = patch[k]; });
    return saveSettings(next) ? settings() : null;
  }

  function saveUsername(name) {
    var v = String(name == null ? "" : name).trim().slice(0, 12);
    var r = patchSettings({ username: v });
    if (r) return r;
    try {
      var cur = parse(raw(KEYS.settings), null);
      var next = (cur && typeof cur === "object" && !Array.isArray(cur)) ? cur : {};
      next.username = v;
      put(KEYS.settings, JSON.stringify(next));
    } catch (e) {  }
    return settings();
  }

  function helper() {
    var stored = raw(KEYS.device);
    var fromNew = parse(stored, null);
    if (fromNew && typeof fromNew === "object" && !Array.isArray(fromNew) &&
        (fromNew.helper === HELPER_ON || fromNew.helper === HELPER_OFF)) {
      return fromNew.helper;
    }
    if (stored === HELPER_ON || stored === HELPER_OFF) return stored;
    var legacy = readObject(KEYS.settings).helper;
    if (legacy === HELPER_ON || legacy === HELPER_OFF) return legacy;
    return DEVICE_DEFAULT.helper;
  }

  function setHelper(on) {
    var v = on ? HELPER_ON : HELPER_OFF;
    var ok = put(KEYS.device, JSON.stringify({ v: 1, helper: v }));

    var legacy = readObject(KEYS.settings);
    legacy.helper = v;
    put(KEYS.settings, JSON.stringify(legacy));
    return ok;
  }

  function searchKeyword() {
    var v = raw(KEYS.search);
    return typeof v === "string" ? v : "";
  }

  function setSearchKeyword(v) {
    var t = String(v == null ? "" : v);
    return t ? put(KEYS.search, t) : drop(KEYS.search);
  }

  function device() {
    return { helper: helper(), searchKeyword: searchKeyword() };
  }

  function exportJSON() {
    var s = settings();
    s.helper = helper();
    var out = {
      progress: allProgress(),
      settings: s,
      exportedAt: new Date().toISOString()
    };

    var F = familyMod();
    if (F) {
      try {
        // ⚠️ 这里原来读的是 `Family.read()`，而它**只返回当前那一个孩子** ——
        //    于是备份里那份「名册」永远只有一条，另外几个孩子一导入就不见了
        //    （`test/family.test.js` 七之二量的是这件事）。名册要的是**整份**。
        var fam = F.read;
        if (!fam || typeof F.list !== "function") fam = null;
        out.family = fam ? { v: 1, at: String(F.currentId({ backing: backing }) || ""), profiles: F.list({ backing: backing }) } : null;
        if (out.family && !out.family.profiles.length) delete out.family;
      } catch (e) {  }
    }
    if (window.Avatar && window.Avatar.exportLocal) {
      try {
        var av = window.Avatar.exportLocal({ backing: backing });
        if (av && Object.keys(av).length) out.avatarLocal = av;
      } catch (e) {  }
    }
    return JSON.stringify(out, null, 2);
  }

  function importJSON(text) {
    var data = parse(text, null);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("备份文件格式不正确");
    }

    var F = familyMod();
    if (F && data.family && typeof data.family === "object" && Array.isArray(data.family.profiles)) {
      try { F.write(data.family, { backing: backing }); } catch (e) {  }
    }
    if (data.progress && typeof data.progress === "object" && !Array.isArray(data.progress)) {
      saveProgress(data.progress);
    }
    if (data.settings && typeof data.settings === "object") {
      saveSettings(data.settings);
      if (data.settings.helper === HELPER_ON || data.settings.helper === HELPER_OFF) {
        setHelper(data.settings.helper === HELPER_ON);
      }
    }
    if (data.device && typeof data.device === "object" &&
        (data.device.helper === HELPER_ON || data.device.helper === HELPER_OFF)) {
      setHelper(data.device.helper === HELPER_ON);
    }
    // 本机那份头像字节（Issue #320 起按子用户分家）：它一起进备份、一起回填。
    if (window.Avatar && typeof window.Avatar.importLocal === "function" && data.avatarLocal) {
      try { window.Avatar.importLocal(data.avatarLocal, { backing: backing }); } catch (e) {  }
    }
    return true;
  }

  function scopes() {
    return [
      { key: KEYS.progress, domain: "progress", local: false, perChild: true },
      { key: KEYS.settings, domain: "account", local: false, perChild: true },

      { key: KEYS.profile, domain: "account", local: false, perChild: false },

      { key: KEYS.dailyExtra, domain: "progress", local: false, perChild: true },

      { key: KEYS.collections, domain: "account", local: false, perChild: false },

      { key: KEYS.pinyinFix, domain: "progress", local: false, perChild: true },

      { key: READ_SCOPE_KEY, domain: "progress", local: false, perChild: true, readKey: true },
      { key: KEYS.device, domain: "device", local: true, perChild: false },
      { key: KEYS.search, domain: "device", local: true, perChild: false },
      { key: KEYS.premerge, domain: "backup", local: true, perChild: false }
    ];
  }

  function clearProgress() {
    return drop(KEYS.progress);
  }

  window.ProgressStore = {
    KEYS: KEYS,
    FIELDS: FIELDS,
    DEFAULTS: DEFAULTS,
    DEVICE_DEFAULT: DEVICE_DEFAULT,

    get: function (id) { return allProgress()[id] || null; },

    set: function (id, rec) { var m = allProgress(); m[id] = rec; return saveProgress(m); },
    setMany: function (list) {
      var m = allProgress();
      (list || []).forEach(function (it) { m[it.id] = it.rec; });
      return saveProgress(m);
    },
    all: allProgress,
    remove: function (id) { var m = allProgress(); delete m[id]; return saveProgress(m); },

    replaceAll: saveProgress,
    pruneUnknown: pruneUnknown,
    clearProgress: clearProgress,

    settings: settings,
    saveSettings: saveSettings,
    patch: patchSettings,
    saveUsername: saveUsername,

    device: device,
    helper: helper,
    setHelper: setHelper,
    searchKeyword: searchKeyword,
    setSearchKeyword: setSearchKeyword,

    readMap: function (key) { return readObject(key); },

    setReadMap: function (key, map) { return put(key, JSON.stringify(map || {})); },
    setRead: function (key, id, val) {
      var m = readObject(key);
      if (val) m[id] = true; else delete m[id];
      return put(key, JSON.stringify(m));
    },

    exportJSON: exportJSON,
    importJSON: importJSON,

    physKey: physKey,

    useStore: function (store) { backing = store || null; },
    reset: function () {
      try { backing = typeof window !== "undefined" ? window.localStorage : null; } catch (e) { backing = null; }
    },

    store: function () { return backing; },

    childId: childId,
    keyFor: kk,
    isPerChild: perChild,

    childProgressKey: function () { return kk(KEYS.progress); },

    scopes: scopes,

    isReadKey: function (key) {
      return /^poem_[a-z0-9_]*_read_v1$/.test(String(key == null ? "" : key));
    },

    isLocalKey: function (key) {
      var k = String(key == null ? "" : key);
      if (window.ProgressStore.isReadKey(k)) return false;
      var hit = scopes().filter(function (s) { return s.key === k; })[0];
      return hit ? hit.local : true;
    }
  };
})();

if (typeof module === "object" && module.exports) module.exports = window.ProgressStore;
