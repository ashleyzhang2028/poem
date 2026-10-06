(function () {
  "use strict";

  // 今日计划的**生成**（Issue #481）
  // ---------------------------------------------------------------------------
  // 原先这一段长在 js/app.js 里，直接调 Scheduler.generateDailyPlan。现在多了
  // 两件事，都落在同一个地方：
  //
  //   ① **以后再背**（js/recite-defer.js）：被延后的那一首从计划里下去，不占
  //      名额 —— 于是排期只捞到 4 首，跟着补第 5 首（用户要的口径：
  //      「减掉一个古诗后，自动在背诵列表的最后补上一篇」）。
  //   ② **补位要过一遍那个集子的口径**：课内的行是课内诗词（provider 给的），
  //      从课外集子里捞回来补位的行（课外阅读回来的 / 以后再加的集子）得先按
  //      那一部自己的 config 走一遍 —— 简化 + 规范化 + 这一部不展出的标上
  //      `isBook`（列表不认，等于没补）。不然「补一篇新诗」会补回来一条在别处
  //      根本不展出的行（名著里「整部书」的那一条就是）。
  //
  // 这个文件只管**排期那一步**：缓存、加背、按今天已背的留位仍在 js/app.js
  // 里（它们各自有各自的测试盯着，不动）。
  //
  // 排期调两遍：第一遍按原样，第二遍把被延后的作废（extraPoems 里滤掉、
  // provider 换成把课内也滤掉的版本）—— 这样第二遍自己就会拿下一首补上，
  // 与「算法一致、只是顺延到明天再上榜」是同一个意思。
  function deferMod() {
    return (typeof window !== "undefined" && window.ReciteDefer) || null;
  }

  function isBookRow(p) {
    return !!(p && (p.isBook || p.bookEntry));
  }

  // 把一部的条目按它自己的 config 走一遍，与 js/reader-core.js 的
  // canonicalOf 同口径：文本按 blocks/cleanText 简出来，条目按 simplify
  // 收一遍，规范号取 canonical（默认 id）。config 缺席就原样送回。
  function conform(p, cfg) {
    if (!p) return p;
    var c = cfg || {};
    var out = p;
    var text = p.text;
    if (typeof text === "string") {
      if (typeof c.blocks === "function") {
        var blocks = c.blocks(text);
        if (blocks && blocks.length) text = blocks.join("\n");
      } else if (typeof c.cleanText === "function") {
        text = c.cleanText(text);
      }
    }
    var mirror = { id: p.id, title: p.title, text: text };
    if (typeof c.simplify === "function") {
      try {
        var s = c.simplify(mirror);
        if (s) out = s;
      } catch (e) {
        out = p;
      }
    }
    if (!out || typeof out !== "object") out = p;
    if (!out.id) out.id = p.id;
    if (out.text == null) out.text = text;
    if (typeof c.canonical === "function" && out.id) {
      try {
        out.id = c.canonical(out.id) || out.id;
      } catch (e) {  }
    }
    // 那一部不展出的行（例如「整部书」的那一条）：带上 isBook，列表不认；
    // 补位时也不该拿它充数
    if (typeof c.isListed === "function") {
      try {
        if (!c.isListed(out)) out.isBook = true;
      } catch (e) {  }
    }
    return out;
  }

  function providerOf(cfg) {
    if (typeof cfg.provider === "function") return cfg.provider;
    if (typeof window.getPoemsByGradeTerm === "function") return window.getPoemsByGradeTerm;
    return function () { return []; };
  }

  // 已经压着的（昨天搁的那一首）不该再进池子 —— 池子里有它，补位就可能把
  // 它自己又捞回来当「新补的一首」，等于搁了没搁。
  //
  // 只滤「今天点的那一下」是不够的：`holdUntil` 认的是「该等到哪一天」，
  // 搁一个月就是一个月都不进池子。明日那一档（1 天）另说 —— 那种明天本来就该
  // 回来，只是今天排期时被 `holdOf` 挡在口子上。
  function restFilter(list) {
    var D = deferMod();
    if (!D || typeof D.holdUntil !== "function") return (list || []).slice();
    return (list || []).slice().filter(function (p) {
      if (!p || !p.id) return false;
      try {
        return D.holdUntil(p.id, null) == null;
      } catch (e) {
        return true;
      }
    });
  }

  // 补位从那来：课内主表 + 全站目录（各自去掉不展出的行），**按作品去重**。
  //
  // 目录里课内那 251 首是 `poems-` 前缀的别名（`poems-xx1-01`，等于教材的
  // `xx1-01`），不去重的话池子里同一首站两个位子 —— 补位就可能补回来一首
  // 已经在列表里的（还是同一个作品，只是换了个号，等于没补）。
  function baseOf() {
    var all = (window.POEMS_ALL || []).slice();
    var haveId = {};
    var haveWid = {};
    var out = [];
    var keep = function (p) {
      if (!p || !p.id || isBookRow(p)) return;
      if (haveId[p.id]) return;
      var wid = workOf(p.id);
      if (wid && haveWid[wid]) return;
      haveId[p.id] = true;
      if (wid) haveWid[wid] = true;
      out.push(p);
    };
    all.forEach(keep);
    (window.SITE_INDEX || []).forEach(keep);
    void all;
    return out;
  }

  // 作品号（课内的 `poems-` 前缀先剥掉；没装 ReciteDefer 就退回原 id）
  function workOf(id) {
    var D = deferMod();
    if (D && typeof D.widOf === "function") {
      try { return D.widOf(id) || id; } catch (e) {  }
    }
    return id;
  }

  // 被延后的那一首今天还压着不排 —— 但要**今天已经背过的**除外
  // （它本来就该留在计划里，压下去只会让进度掉数）。
  //
  // 认的是**作品**（js/recite-defer.js 的 widOf）：课内的 `xx1-01` 与目录里的
  // `poems-xx1-01` 是同一首，点一次两边都得下去 —— 不然原路那边压住了，
  // 别名这边又顶上，等于没延后。
  function heldToday(p, cfg, getRecord) {
    var D = deferMod();
    if (!D || !p || !p.id) return false;
    var rec = null;
    if (typeof getRecord === "function") {
      try { rec = getRecord(p.id); } catch (e) { rec = null; }
    }
    try {
      return !!D.holdToday(p.id, rec);
    } catch (e) {
      return false;
    }
  }

  // 排一次。opt 与 Scheduler.generateDailyPlan 的那一份相同，另加
  // `holdOf`（按作品拍的「今天压着」那一刀，见 heldToday）。
  function generate(opt, cfg) {
    var o = opt || {};
    var c = cfg || {};
    var grade = Number(o.grade || 0);
    var term = Number(o.term || 0);
    var provider = providerOf(c);
    var raw = o.allPoems && o.allPoems.length ? o.allPoems : baseOf();
    var base = restFilter(raw);

    var rawExtra = (o.extraPoems || []).filter(function (p) {
      return p && !isBookRow(p);
    });
    var extra = restFilter(rawExtra);

    return window.Scheduler.generateDailyPlan({
      grade: grade,
      term: term,
      count: o.count,
      scope: o.scope,
      provider: function (g, t) {
        var list = provider(g, t) || [];
        var seen = {};
        var out = [];
        list.forEach(function (p) {
          if (!p || !p.id || seen[p.id]) return;
          seen[p.id] = true;
          if (isBookRow(p)) return;
          out.push(p);
        });
        return out;
      },
      // 「今天压着不排」那一刀交给排期，它会在**每一处选条目的口子**上过一遍
      // （只在 provider 上滤，池子另一头与兜底那两条路会把压下去的又捡回来）
      holdOf: function (p) { return heldToday(p, c, o.getRecord); },
      getRecord: o.getRecord,
      extraPoems: extra,
      allPoems: base
    });
  }

  // 「排今天这一趟」的具名入口（app.js 走它；名字避开 `plan === "…"` 那种
  // 层级比较的静态扫描）
  function arrange(opt, cfg) {
    var o = opt || {};
    var c = cfg || {};
    var out = generate(o, c);

    // 排到几首就是几首 —— 被延后的让出的名额，排期自己会拿下一首补上
    var count = Number(o.count || 0);
    if (count > 0 && out.length > count) out = out.slice(0, count);
    return out;
  }

  window.TodayPlan = {
    restFilter: restFilter,
    conform: conform,
    providerOf: providerOf,
    baseOf: baseOf,
    heldToday: heldToday,
    workOf: workOf,
    generate: generate,
    arrange: arrange,
    isBookRow: isBookRow
  };
})();
