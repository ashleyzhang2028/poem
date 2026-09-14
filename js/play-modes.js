/**
 * 朗读播放档位（全站唯一一份定义）
 * ==========================================================================
 * 为什么单独一个文件：
 *   这五个模式原先只写在 js/reader-core.js 里 —— 也就是只有「集子索引页」
 *   认得它们。用户想改档位，**只能找到分类卡右侧那颗圆键、长按（手机）
 *   或右键（桌面）**，而界面上没有任何一处提示这件事，设置页里也没有
 *   任何一条。结果是第 N 次有人问「这几个选项在哪里调」。
 *
 *   本文件把「有哪五档、存哪个键、出厂是哪一档」抽出来做成**唯一一份**：
 *   阅读器（js/reader-core.js）与设置页（js/settings.js）都读它。
 *   原先两份各写一遍的模式名，只要有一处改了字或改了 id，两边就会
 *   悄悄错开（设置里选中的和实际连读的不是同一档），所以必须同源。
 *
 * 用法：
 *   PlayModes.LIST        // 五个模式，顺序即菜单与设置页里的顺序
 *   PlayModes.KEY         // localStorage 键名
 *   PlayModes.DEFAULT     // 出厂档位 id
 *   PlayModes.of(id)      // id → 模式对象（不认识的值返回 null）
 *   PlayModes.read()      // 本机存下的档位 id（没存过 / 存了不认识的值 → 出厂档）
 *   PlayModes.write(id)   // 写入档位，返回是否写入成功（不认识的 id 不写）
 *   PlayModes.subscribe(fn) // 档位变化通知；返回退订函数
 *   PlayModes.emit(id)    // 由「真正改档位的那一方」调用，通知同页订阅者
 *
 * 关于「双向同步」到底怎么做的：
 *   设置页与集子页是**两张不同的页面**，不是一个页面里的两块 DOM，
 *   不存在「同一个变量改两处」的问题。真正的同步点是 localStorage
 *   加上浏览器自带的 storage 事件：
 *     · 在本页改 → 立即写 localStorage，并 emit 一次（同页若有别的订阅者）
 *     · 在另一个标签页改 → 本页收到 window 的 storage 事件（见各页面自己订阅）
 *   设置页离开后再回集子页，读到的是新值；集子页改完再进设置页同理。
 *   这样不会出现「设置页单选项」与「圆键菜单」各自维护一份内存状态、
 *   谁先改谁后改对不上的情况。
 */
(function (root) {
  "use strict";

  /** 存储键：与字号 / 对齐一样是**全站一份**（在小古文里选了白话，翻到宋词不该变回去） */
  var KEY = "poem_play_mode_v1";

  /**
   * 五档：听什么（source） × 怎么排（order）。
   *
   * label 是给用户看的全名（菜单项、设置页单选项），
   * short 是状态短名（播放栏、圆键的 aria / title），
   * note 是「选它会发生什么」的一句补充（无译文跳过等）。
   */
  var LIST = [
    {
      id: "seq-origin",
      source: "原文",
      order: "seq",
      label: "连续播放原文",
      short: "原文 · 顺序"
    },
    {
      id: "seq-trans",
      source: "译文",
      order: "seq",
      label: "连续播放白话译文",
      short: "白话 · 顺序",
      note: "无译文的篇目自动跳过"
    },
    {
      id: "seq-both",
      source: "原文+译文",
      order: "seq",
      label: "原文白话顺序播放",
      short: "原文 + 白话 · 顺序",
      note: "每篇先读原文，再读白话，然后下一篇"
    },
    {
      id: "shuffle-origin",
      source: "原文",
      order: "shuffle",
      label: "随机播放原文",
      short: "原文 · 随机",
      note: "打乱后一篇接一篇"
    },
    {
      id: "shuffle-trans",
      source: "译文",
      order: "shuffle",
      label: "随机播放白话译文",
      short: "白话 · 随机",
      note: "打乱后一篇接一篇，无译文的篇目自动跳过"
    }
  ];

  /** 出厂档位：原文 · 顺序 */
  var DEFAULT = "seq-origin";

  function of(id) {
    for (var i = 0; i < LIST.length; i++) {
      if (LIST[i].id === id) return LIST[i];
    }
    return null;
  }

  /** 本机存下的档位；没存过 / 存了不认识的值 → 出厂档（不猜） */
  function read() {
    try {
      var m = of(localStorage.getItem(KEY));
      return m ? m.id : DEFAULT;
    } catch (e) {
      return DEFAULT;
    }
  }

  /** 写入档位；不认识的 id 一律不写（宁可保持原样，也不能把本机值改成野值） */
  function write(id) {
    if (!of(id)) return false;
    try {
      localStorage.setItem(KEY, id);
    } catch (e) {
      return false;
    }
    return true;
  }

  /* 同页订阅：设置页与阅读器不会在同一页同时存在，但保留这一层，
     让「同一页里两处都显示当前档位」时不会各示各的。 */
  var subs = [];
  function subscribe(fn) {
    if (typeof fn !== "function") return function () {};
    subs.push(fn);
    return function () {
      var i = subs.indexOf(fn);
      if (i > -1) subs.splice(i, 1);
    };
  }
  function emit(id) {
    subs.slice().forEach(function (fn) {
      try {
        fn(id);
      } catch (e) {
        /* 一个订阅者出错不该带塌其余的 */
      }
    });
  }

  root.PlayModes = {
    KEY: KEY,
    DEFAULT: DEFAULT,
    LIST: LIST,
    of: of,
    read: read,
    write: write,
    subscribe: subscribe,
    emit: emit
  };
})(typeof window !== "undefined" ? window : this);
