(function () {
  "use strict";

  /* ==========================================================================
     帝王「中国」/「外国」（Issue #407）
     --------------------------------------------------------------------------
     与 js/mingren.js 同一套「两卷一个引擎」的形状：
       · 两份壳（data/poems-emperor-cn.js / -waiguo.js）、两个 url
         （/dwang/ 与 /dwang-waiguo/），共用这一个挂载点；
       · 「哪一卷」认 url 或显式给的 bookId，**不按脚本加载顺序判**；
       · 分组是**分期**（夏 / 商 / 西周 … 与 上古东方 / 希腊与罗马 …），
         列表页的索引卡按它分段。
     ========================================================================== */

  /* 与中国卷的 GROUP_ORDER_CN 一字不差（scripts/build-emperor.js 同一份口径）。
     ⚠️ 首段「传说时代」是 Issue #407 追问之后加的：三皇五帝与同时诸家
     另立一段，不混进「夏」（见 scripts/data/emperor/facts-legend.js 的抬头）。 */
  var GROUPS_CN = window.DWANG_GROUP_ORDER = [
    "传说时代",
    "夏", "商", "西周", "东周（春秋）", "东周（战国）", "秦",
    "西汉", "新", "东汉", "三国", "西晋", "东晋", "十六国", "南北朝",
    "隋", "唐", "五代十国", "辽", "北宋", "西夏", "金", "南宋",
    "元", "明", "清"
  ];
  var GROUPS_FOREIGN = window.DWANG_WAIGUO_GROUP_ORDER = [
    "上古东方", "希腊与罗马", "中世纪与伊斯兰", "近代欧洲", "现代"
  ];

  var VOLUMES = {
    cn: {
      key: "cn",
      bookId: "dwang",
      title: "帝王「中国」",
      varName: "POEMS_EMPEROR_CN",
      page: "/dwang/",
      readStore: "poem_dwang_cn_read_v1",
      groupOrder: GROUPS_CN,
      pageSub: "传说时代（三皇五帝）与夏商周至清末 · 按在位先后排 · 每位给姓名 / 年号 / 在位 / 谥号 / 庙号 / 谱系与六维评价"
    },
    foreign: {
      key: "foreign",
      bookId: "dwang-waiguo",
      title: "帝王「外国」",
      varName: "POEMS_EMPEROR_FOREIGN",
      page: "/dwang-waiguo/",
      readStore: "poem_dwang_foreign_read_v1",
      groupOrder: GROUPS_FOREIGN,
      pageSub: "教科书点名的各国君主 · 分五个时期 · 按在位先后排 · 每位给姓名 / 在位 / 尊号 / 王统与六维评价"
    }
  };

  function volume(bookId) {
    if (bookId === VOLUMES.foreign.bookId) return VOLUMES.foreign;
    if (bookId === VOLUMES.cn.bookId) return VOLUMES.cn;
    var href = (window.location && window.location.pathname) || "";
    if (/^\/dwang-waiguo(\/|$)/.test(href)) return VOLUMES.foreign;
    return VOLUMES.cn;
  }

  function itemsOf(v) {
    var all = window[v.varName] || [];
    return all.filter(function (p) {
      return !p.country || p.country === (v.key === "foreign" ? "外国" : "中国");
    });
  }

  function bookConfig(v) {
    return {
      id: v.bookId,
      groupOrder: v.groupOrder,
      pageTitle: v.title,
      pageSub: v.pageSub,
      // 词条式：正文即词条表，本来就没有白话译文
      noTranslation: true,
      words: {
        list: v.title,
        unit: "位",
        loadingFailed: v.title + "数据加载失败",
        empty: "没有匹配的帝王",
        matchGroup: v.title,
        backToList: "返回" + v.title + "列表",
        readStore: v.readStore,
        playerTitle: "帝王朗读",
        searchPlaceholder: "搜索皇号 / 姓名 / 年号 / 朝代 / 分期"
      }
    };
  }

  function boot() {
    if (!window.ReaderEngine) return;
    var v = volume(window.DWANG_BOOK_ID);
    var all = itemsOf(v);
    if (!all.length) {
      var listEl = document.querySelector('[data-gw="list"]');
      if (listEl) listEl.innerHTML = '<div class="empty">' + v.title + '数据加载失败</div>';
      return;
    }

    var cfg = bookConfig(v);
    cfg.items = all;
    cfg.root = "[data-gw-root]";
    cfg.reader = "#gw-reader";
    window.ReaderEngine.mount(cfg);
  }

  window.DwangBook = {
    volume: volume,
    config: function (bookId) { return bookConfig(volume(bookId)); },
    items: function (bookId) { return itemsOf(volume(bookId)); }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
