/**
 * 本地持久化：进度与复习记录（**薄转发层**）
 * ==========================================================================
 * 实现已经搬进 `js/progress-store.js`（Issue #132 阶段 0 的「分域」引擎）——
 * 这一层保留下来只为**一个签名都不改**：`app.js` / `scheduler.js` /
 * `progress.js` / `settings.js` 里那 500 行调用点一处不用动，
 * 改动面被压在引擎层（`docs/architecture.md` §3.1 ①）。
 *
 * ⚠️ 加载顺序：**必须先加载 `js/progress-store.js`**。
 * 缺了它时下面的 `PS()` 返回 null，各方法安静地退化成「读刚写下的原始值」——
 * 页面照常能打开（不让整站白屏），但设置里那几个**有默认值兜底**的字段
 * 会退回出厂默认（见 getSettings）。`test/progress-store.test.js` 有一条
 * 断言逐页核对「加载了 storage.js 的页面都加载了 progress-store.js」。
 *
 * 语法：与 `progress-store.js` 同一档（只用 var + function）—— 这一层是
 * 全站最先被解析的脚本之一，首行 SyntaxError 会让整站白屏而不是功能降级。
 */
(function () {
  "use strict";

  var SETTINGS_KEY = "poem_recite_settings_v1";
  /* 与 progress-store.js 的 KEYS.search 是同一把键（那一份是唯一出处） */
  var SEARCH_KEY = "poem_search_kw_v1";

  /** 取引擎。**每次现取**而不是启动时存一份 —— 页面里脚本顺序可能与预期不同 */
  function PS() {
    return typeof window !== "undefined" ? window.ProgressStore : null;
  }

  /**
   * 取同步层（1B）。缺席时返回 null，`set` 就走 0 期的老路 ——
   * 老缓存里的旧页面（没加载 sync-store.js）照样能正常背书。
   */
  function Sync() {
    return typeof window !== "undefined" && window.SyncStore && window.SyncStore.touch
      ? window.SyncStore : null;
  }

  /** 引擎缺席时的兜底：读一个原始值 */
  function read(key, fallback) {
    try {
      var v = JSON.parse(localStorage.getItem(key) || "null");
      return v === null || v === undefined ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  window.Storage = {
    /** 读取单首诗进度 */
    get: function (id) {
      var ps = PS();
      return ps ? ps.get(id) : (read("poem_recite_progress_v1", {})[id] || null);
    },

    /**
     * 写入单首诗进度。
     *
     * ⚠️ 这里调的是 `SyncStore.touch()`（同步开着时）——**它会顺手盖 `updatedAt`**，
     *    那是跨设备同步唯一的记账字段。收在这一层而不是各调用点：
     *    写进度的路径有首页答题、自选集合、集子页已读三类，
     *    分别打标必然漏一处，而漏的那一处表现是「那一篇永远同步不上去」——
     *    不报错、只是安静地不同步，最难查。
     *    同步**关着**时 `touch` 原样落盘、一个字段都不多 ——
     *    盘上形状与 0 期逐字一致（契约见 progress-store.js），
     *    于是「我不开同步」这件事在数据上也是干净的。
     */
    set: function (id, rec) {
      var sy = Sync();
      if (sy) return sy.touch(id, rec);        // touch 内部按开关判：关着就原样落盘
      var ps = PS();
      if (ps) return ps.set(id, rec);
      var all = read("poem_recite_progress_v1", {});
      all[id] = rec;
      localStorage.setItem("poem_recite_progress_v1", JSON.stringify(all));
    },

    /** 批量写入 */
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

    /** 清空所有进度（**只清进度域**，绝不动账号域 / 设备域） */
    clear: function () {
      var ps = PS();
      if (ps) return ps.clearProgress();
      localStorage.removeItem("poem_recite_progress_v1");
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

    /** 导出备份 */
    exportJSON: function () {
      var ps = PS();
      if (ps) return ps.exportJSON();
      return JSON.stringify(
        { progress: read("poem_recite_progress_v1", {}), settings: this.getSettings(), exportedAt: new Date().toISOString() },
        null, 2
      );
    },

    /** 导入备份 */
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

    /** 读取设置（对外仍是**同一个扁平对象**，键名一个不少） */
    getSettings: function () {
      var ps = PS();
      if (ps) return ps.settings();
      /* 兜底路径：引擎缺席（脚本顺序不对 / 老缓存里的旧页面）。
         这里只保住**有默认值兜底**的那几个字段 —— 完整字段表在引擎里一份，
         不在这里再抄一遍（抄两份迟早有一天只改了一处）。 */
      var raw = read(SETTINGS_KEY, {}) || {};
      var out = { grade: 1, term: 1, dailyCount: 5, scope: "term", algo: "ebbinghaus", helper: "on" };
      Object.keys(raw).forEach(function (k) { out[k] = raw[k]; });
      Object.keys(out).forEach(function (k) {
        if (out[k] === undefined || out[k] === null || out[k] === "") {
          out[k] = { grade: 1, term: 1, dailyCount: 5, scope: "term", algo: "ebbinghaus", helper: "on" }[k];
        }
      });
      return out;
    },

    /** 写设置（只落账号域白名单字段；`helper` 归设备域，见 progress-store.js） */
    saveSettings: function (s) {
      var ps = PS();
      if (ps) return ps.saveSettings(s);
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    },

    /**
     * 搜索页「上次搜的词」（Issue #163）。
     *
     * 它是**设备域**的一件阅读偏好（本机、不上云），所以不走 getSettings ——
     * 那份是账号域的对象，混进去会让它跟着账号上传到别的设备上，
     * 而「上次在这台机器上搜了什么」换台机器看是没有意义的。
     *
     * 兜底路径（引擎缺席）直接读写本机那一把键：
     * 搜索页的这条功能不值得为了脚本顺序而整页失效，退化成老写法仍可用。
     */
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
      } catch (e) { /* 隐私模式 / 配额满：搜索本身照常 */ }
      return true;
    },
  };
})();
