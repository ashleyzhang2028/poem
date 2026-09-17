(function () {
  "use strict";

  var SETTINGS_KEY = "poem_recite_settings_v1";

  var SEARCH_KEY = "poem_search_kw_v1";

  function PS() {
    return typeof window !== "undefined" ? window.ProgressStore : null;
  }

  function Sync() {
    return typeof window !== "undefined" && window.SyncStore && window.SyncStore.touch
      ? window.SyncStore : null;
  }

  function read(key, fallback) {
    try {
      var v = JSON.parse(localStorage.getItem(key) || "null");
      return v === null || v === undefined ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  window.Storage = {

    get: function (id) {
      var ps = PS();
      return ps ? ps.get(id) : (read("poem_recite_progress_v1", {})[id] || null);
    },

    set: function (id, rec) {
      var sy = Sync();
      if (sy) return sy.touch(id, rec);
      var ps = PS();
      if (ps) return ps.set(id, rec);
      var all = read("poem_recite_progress_v1", {});
      all[id] = rec;
      localStorage.setItem("poem_recite_progress_v1", JSON.stringify(all));
    },

    setMany: function (list) {
      var sy = Sync();
      if (sy) {
        var okAll = true;
        (list || []).forEach(function (item) { okAll = sy.touch(item.id, item.rec) && okAll; });
        return okAll;
      }
      var ps = PS();
      if (ps) return ps.setMany(list);
      var all = read("poem_recite_progress_v1", {});
      (list || []).forEach(function (item) { all[item.id] = item.rec; });
      localStorage.setItem("poem_recite_progress_v1", JSON.stringify(all));
    },

    all: function () {
      var ps = PS();
      return ps ? ps.all() : read("poem_recite_progress_v1", {});
    },

    clear: function () {
      var ps = PS();
      if (ps) return ps.clearProgress();
      localStorage.removeItem("poem_recite_progress_v1");
    },

    pruneUnknown: function (knownIds) {
      var ps = PS();
      if (ps) return ps.pruneUnknown(knownIds);
      if (!knownIds || !knownIds.length) return [];
      var known = {};
      knownIds.forEach(function (id) { known[id] = true; });
      var all = read("poem_recite_progress_v1", {});
      var gone = Object.keys(all).filter(function (id) { return !known[id]; });
      if (!gone.length) return [];
      gone.forEach(function (id) { delete all[id]; });
      localStorage.setItem("poem_recite_progress_v1", JSON.stringify(all));
      return gone;
    },

    exportJSON: function () {
      var ps = PS();
      if (ps) return ps.exportJSON();
      return JSON.stringify(
        { progress: read("poem_recite_progress_v1", {}), settings: this.getSettings(), exportedAt: new Date().toISOString() },
        null, 2
      );
    },

    importJSON: function (text) {
      var ps = PS();
      if (ps) return ps.importJSON(text);
      var data = null;
      try { data = JSON.parse(text); } catch (e) { data = null; }
      if (!data || typeof data !== "object") throw new Error("备份文件格式不正确");
      if (data.progress) localStorage.setItem("poem_recite_progress_v1", JSON.stringify(data.progress));
      if (data.settings) this.saveSettings(data.settings);
      return true;
    },

    getSettings: function () {
      var ps = PS();
      if (ps) return ps.settings();

      var raw = read(SETTINGS_KEY, {}) || {};

      var out = { grade: 1, term: 1, dailyCount: 5, scope: "upto", algo: "ebbinghaus", helper: "on" };
      Object.keys(raw).forEach(function (k) { out[k] = raw[k]; });
      Object.keys(out).forEach(function (k) {
        if (out[k] === undefined || out[k] === null || out[k] === "") {
          out[k] = { grade: 1, term: 1, dailyCount: 5, scope: "upto", algo: "ebbinghaus", helper: "on" }[k];
        }
      });
      return out;
    },

    saveSettings: function (s) {
      var ps = PS();
      if (ps) return ps.saveSettings(s);
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    },

    getSearchKeyword: function () {
      var ps = PS();
      if (ps) return ps.searchKeyword();
      try { return localStorage.getItem(SEARCH_KEY) || ""; } catch (e) { return ""; }
    },
    setSearchKeyword: function (v) {
      var ps = PS();
      var t = String(v == null ? "" : v);
      if (ps) return ps.setSearchKeyword(t);
      try {
        if (t) localStorage.setItem(SEARCH_KEY, t);
        else localStorage.removeItem(SEARCH_KEY);
      } catch (e) {  }
      return true;
    },
  };
})();
