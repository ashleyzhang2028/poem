(function (root) {
  "use strict";

  var KEY = "poem_play_mode_v1";

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

  var DEFAULT = "seq-origin";

  function of(id) {
    for (var i = 0; i < LIST.length; i++) {
      if (LIST[i].id === id) return LIST[i];
    }
    return null;
  }

  function read() {
    try {
      var m = of(localStorage.getItem(KEY));
      return m ? m.id : DEFAULT;
    } catch (e) {
      return DEFAULT;
    }
  }

  function write(id) {
    if (!of(id)) return false;
    try {
      localStorage.setItem(KEY, id);
    } catch (e) {
      return false;
    }
    return true;
  }

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
