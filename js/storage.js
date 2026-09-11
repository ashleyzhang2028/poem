/**
 * 本地持久化：进度与复习记录
 * 使用 localStorage，无后端依赖。
 */
(function () {
  const KEY = "poem_recite_progress_v1";
  const SETTINGS_KEY = "poem_recite_settings_v1";

  function safeParse(str, fallback) {
    try {
      const v = JSON.parse(str);
      return v === null || v === undefined ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function readAll() {
    return safeParse(localStorage.getItem(KEY) || "{}", {});
  }

  function saveAll(data) {
    localStorage.setItem(KEY, JSON.stringify(data));
  }

  window.Storage = {
    /** 读取单首诗进度 */
    get: function (id) {
      const all = readAll();
      return all[id] || null;
    },

    /** 写入单首诗进度 */
    set: function (id, rec) {
      const all = readAll();
      all[id] = rec;
      saveAll(all);
    },

    /** 批量写入 */
    setMany: function (list) {
      const all = readAll();
      list.forEach(function (item) {
        all[item.id] = item.rec;
      });
      saveAll(all);
    },

    all: readAll,

    /** 清空所有进度 */
    clear: function () {
      localStorage.removeItem(KEY);
    },

    /** 导出备份 */
    exportJSON: function () {
      return JSON.stringify(
        { progress: readAll(), settings: this.getSettings(), exportedAt: new Date().toISOString() },
        null,
        2
      );
    },

    /** 导入备份 */
    importJSON: function (text) {
      const data = safeParse(text, null);
      if (!data || typeof data !== "object") throw new Error("备份文件格式不正确");
      if (data.progress) saveAll(data.progress);
      if (data.settings) this.saveSettings(data.settings);
      return true;
    },

    getSettings: function () {
      return safeParse(localStorage.getItem(SETTINGS_KEY) || "null", null) || {
        grade: 1,
        term: 1,
        dailyCount: 5,
        // 背诵范围，见 js/scheduler.js 的 SCOPES
        scope: "term"
      };
    },

    saveSettings: function (s) {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    }
  };
})();
