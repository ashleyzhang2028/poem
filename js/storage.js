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

    /**
     * 清理「已删条目」留下的孤儿进度（Issue #69 收尾）。
     *
     * 背景：课内数据里原有 12 组篇目在**两个年级**各存一份（正文一字不差），
     * 属于逐页录入留下的自身重复，已按「低年级版本为准」各删一条。
     * 学生若曾在被删的高年级那一条上留下过背诵进度，那些键就成了孤儿：
     * 不影响功能，但导出备份、本地排查时看着像「有 12 首诗不见了」。
     *
     * 裁定（用户原话「合并进度，暂时用户极少，可以删掉进度，清理无效数据」）：
     * **删掉孤儿键**，不做合流 —— 合流要猜「这一篇的进度算谁的」，
     * 而这一批重复本就是同一份教材内容存了两遍，留着只会让老用户在某一天
     * 莫名看到「第 4 轮」的复习任务。删掉之后，这一篇按未学过排进每日新学，
     * 学生照常背，行为与「从没背过」完全一致。
     *
     * ⚠️ 只删**确认已不在语料里**的键，且只在有课内数据时动手：
     *    拿不到语料（页面没加载 data/index.js）时一个键都不删 ——
     *    宁可留着孤儿，也不能误删一篇真实篇目的进度。
     *
     * @param {Array<string>} knownIds 当前语料里全部合法条目 id
     * @returns {Array<string>} 被清掉的 id
     */
    pruneUnknown: function (knownIds) {
      if (!knownIds || !knownIds.length) return [];
      var known = {};
      knownIds.forEach(function (id) { known[id] = true; });
      var all = readAll();
      var gone = Object.keys(all).filter(function (id) { return !known[id]; });
      if (!gone.length) return [];
      gone.forEach(function (id) { delete all[id]; });
      saveAll(all);
      return gone;
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
