/**
 * 昭明文选（/zhaoming/ · 三十九类文体 · 480 篇）
 * ==========================================================================
 * 这个文件与小古文的 js/classic.js、唐诗的 js/tangshi.js、宋词的 js/songci.js、
 * 古文观止的 js/guwen.js 一样薄：它只做三件事 ——
 *   1. 把《昭明文选》这**一部集子**的配置交给 js/reader-core.js 的
 *      ReaderEngine.mount()：数据、文体顺序、文案、已读存的键名。
 *   2. 「已读」进度由引擎统一维护；本页不再自己管 localStorage。
 *   3. 分类靠 gradeGroup 字段（赋 · 京都上、诗 · 赠答二、书、表……）。
 *
 * ⚠️ 这一部的分类与别的集子不是一回事：
 *    唐诗按「卷次」（卷一 五言古诗……）、宋词按「词牌」、古文观止按「卷次」，
 *    而《昭明文选》按**文体**分三十九类 —— 赋、诗、骚、七、诏、册、令、教、
 *    文、表、上书、启、弹事、笺、奏记、书、檄、对问、设论、辞、序、颂、赞、
 *    符命、史论、史述赞、论、连珠、箴、铭、诔、哀、碑文、墓志、行状、吊文、祭文。
 *    「赋」下再分京都、郊祀、畋猎、纪行、游览、宫殿、江海、物色、鸟兽、志、
 *    哀伤、论文、音乐等小类；「诗」下再分补亡、述德、劝励、献诗、公宴、祖饯、
 *    咏史、游仙、招隐、游览、咏怀、赠答、行旅、乐府、杂歌、杂诗、杂拟等小类。
 *    所以分组名形如「赋 · 京都上」「诗 · 赠答二」，无小类的文体只写文体名。
 *
 * ⚠️ 文体顺序是**按原书次第**排的（赋在最前、祭文在最后），不是按笔画或拼音：
 *    这样用户翻页时的顺序才与手里的选本对得上。顺序写在这里而不是让引擎按
 *    数据出场顺序推，是为了日后增删篇目时分组不乱。
 *
 * ⚠️ 昭明文选与小古文、唐诗、宋词、古文观止**各存各的已读**
 *    （poem_zhaoming_read_v1 / poem_classic_read_v1 / poem_tangshi_read_v1 /
 *     poem_songci_read_v1 / poem_guwen_read_v1）：读文选点亮的「已读」不该混进
 *    别的集子。字号与对齐则是全站共用的一份阅读偏好 —— 这一条由引擎负责，
 *    见 js/reader-core.js。
 */
(function () {
  "use strict";

  /** 文体顺序：按《昭明文选》原书次第（赋 → 诗 → 骚 → 七 → 诏 → … → 祭文）。
      放在 window 上，是为了让 data/group-order.js（作品主表读它排合并后的组序）
      与这一页共用同一份顺序 —— 顺序只写一处，两边不会各改各的。 */
  var GROUP_ORDER = window.ZHAOMING_GROUP_ORDER = [
    "赋 · 京都上", "赋 · 京都中", "赋 · 京都下", "赋 · 郊祀",
    "赋 · 耕藉", "赋 · 畋猎", "赋", "赋 · 纪行上",
    "赋 · 纪行下", "赋 · 游览", "赋 · 宫殿", "赋 · 江海",
    "赋 · 物色", "赋 · 鸟兽", "赋 · 鸟兽下", "赋 · 志上",
    "赋 · 志中", "赋 · 志下", "赋 · 哀伤", "赋 · 论文",
    "赋 · 音乐上", "赋 · 音乐下", "赋 · 情", "诗 · 补亡",
    "诗 · 述德", "诗 · 劝励", "诗 · 献诗", "诗 · 公䜩",
    "诗 · 祖饯", "诗 · 咏史", "诗 · 百一", "诗 · 游仙",
    "诗 · 招隐", "诗 · 反招隐", "诗 · 游览", "诗 · 咏怀",
    "诗 · 临终", "诗 · 哀伤", "诗 · 赠答一", "诗 · 赠答二",
    "诗 · 赠答三", "诗 · 赠答四", "诗 · 行旅上", "诗 · 行旅下",
    "诗 · 军戎", "诗 · 郊庙", "诗 · 乐府上", "诗 · 乐府下",
    "诗 · 杂歌", "诗 · 杂诗上", "诗 · 杂诗下", "诗 · 杂拟上",
    "诗 · 杂拟下", "骚", "七", "诏",
    "册", "令", "教", "文",
    "表", "上书", "启", "弹事",
    "笺", "奏记", "书", "檄",
    "对问", "设论", "辞", "序",
    "颂", "赞", "符命", "史论",
    "史述赞", "论 · 论一", "论 · 论二", "论 · 论三",
    "论 · 论四", "连珠 · 论五", "箴", "铭",
    "诔", "哀", "碑文", "墓志",
    "行状", "吊文", "祭文"
  ];

  function boot() {
    if (!window.ReaderEngine) return;
    var all = window.POEMS_ZHAOMING || window.ZHAOMING_ALL || [];
    if (!all.length) {
      var listEl = document.querySelector('[data-gw="list"]');
      if (listEl) listEl.innerHTML = '<div class="empty">昭明文选数据加载失败</div>';
      return;
    }

    window.ReaderEngine.mount({
      id: "zhaoming",
      items: all,
      root: "[data-gw-root]",
      reader: "#gw-reader",
      groupOrder: GROUP_ORDER,
      pageTitle: "昭明文选",
      pageSub: "六十卷 · 三十九类文体 · 想读哪篇点哪篇",
      words: {
        list: "文章",
        unit: "篇",
        loadingFailed: "昭明文选数据加载失败",
        empty: "没有匹配的文章",
        matchGroup: "昭明文选",
        backToList: "返回文选列表",
        // 目录里的篇目**原文全已收录**；白话译文尚在整理中的那些，
        // 点开是明确说明而不是白屏（见 data/poems-zhaoming.js 的文件头）
        pendingText: "本篇原文尚在整理中",
        pendingTranslation: "本篇白话译文尚在整理中",
        readStore: "poem_zhaoming_read_v1",
        playerTitle: "文选朗读",
        searchPlaceholder: "搜索篇名 / 作者 / 文体"
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
