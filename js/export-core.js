/**
 * 导出内核（纯逻辑，零 DOM、零网络、零存储）
 * ==========================================================================
 * 回答**一个**问题：把一份篇目导出成「给人读」的文本，长什么样。
 *
 * ## 它为什么存在
 *
 * `/plans/` 的对比表上一直写着「全站批量导出（Max）」，而代码里一行没有 ——
 * 那一行是**假话**（`docs/architecture.md` §1 第 3 条「不假装配齐了」）。
 * 本文件是把它做真。但做真的过程中，**口径被用户改了一次**（2026-09-16，
 * Issue #159 原话）：
 *
 *   「为啥要有全站批量导出功能？这不是这个网站的核心资产吗？
 *     顶多支持学校课本部分的全部导出。这个 pro 用户就行。」
 *
 * 于是**能力名与门槛跟着改**（不是只改文案）：
 *
 *   `export.all`  原先「全站批量导出（Max = 课内 261 + 六部集子 1592 篇）」
 *                 → 改成「**全站课内诗词批量导出（Pro = 课内 261 首）**」，
 *                   门槛从 **Max 降到 Pro**。
 *
 * 为什么连门槛一起降、而不是「留着 `export.all` 的名字但内容缩水」：
 * 能力表上的名字与服务端下发的 features 是**同一张表**（有逐字对拍断言），
 * 名字里写着「全站」而实际只给课内，那条断言与用户看到的对比表都会开始说谎。
 * 所以名字、门槛、内容三处一起改，改完仍然与代码逐字一致。
 *
 * ## 两条不许含糊的口径
 *
 * 1. **「全站」指全站课内，不是全站**。课内 261 首是教材篇目（谁都可以拿
 *    一本语文书抄下来），**可以给到用户手里**；六部集子是本站整理、全文收录的
 *    选本，一次性整本导出等于把站点的内容资产拷走 —— 用户点名不要这件事。
 *    这层判断写在**导出范围表**（`SCOPES`）里，不是写在界面上：
 *    界面上少一颗按钮拦不住 `exportText()` 被直接调用。
 * 2. **导出的是文本，不是 PDF**。这里只产出纯文本（可直接存 .txt、可打印、
 *    可粘进任何文档）；「打印 / 存 PDF」是浏览器的打印对话框那件事。
 *    所以界面上写「导出 / 存 PDF」，但**承落一个文本文件**，不假装生成 PDF。
 *
 * ## 与 js/print-core.js 的分工（打印页内核）
 *
 * 打印页（篇目 PDF / 打印页，`export.paper`）解决的是「**排进几页纸**」，
 * 所以它算版面（每页多少行、卡片跨不跨栏）；本文件解决的是「**整份抄走**」，
 * 所以它只算「按什么顺序、写哪些字段」。两者共用同一份站点索引，不共享版面。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ExportCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /**
   * 导出范围表 —— **唯一一处**回答「这份导出包含哪些篇目」。
   *
   * ⚠️ 六部集子（classic / tangshi / songci / guwen / zhaoming）**刻意不在表里**。
   *    它们不是「还没做」，是**不做**：全站批量导出会把站点整理的内容资产
   *    整本拷走（用户 2026-09-16 的裁决）。日后谁想把它们加进来，
   *    先改这条注释与 docs/architecture.md §5.2，再改这张表 ——
   *    顺序反过来（先加表、再补说明）就是在悄悄放宽一次口径。
   */
  var SCOPES = {
    /* 用户的「自选清单」：跟着遗忘曲线背的那些篇目，导出成同一份文本 */
    custom: {
      id: "custom",
      name: "自选清单",
      unit: "篇",
      /* 自选清单是用户自己挑的（可能含集子篇目）—— 它导的是**清单成员**，
         不是某部集子的全文，所以不受上面那条「不整本拷走」的限制。 */
      books: null
    },
    /* 课内诗词：一年级至高三，共 261 首 —— 这就是本期「全站批量导出」的全部内容 */
    poems: {
      id: "poems",
      name: "课内诗词",
      unit: "首",
      books: ["poems"]
    }
  };

  var GRADE_NAMES = {
    1: "一年级", 2: "二年级", 3: "三年级", 4: "四年级",
    5: "五年级", 6: "六年级", 7: "七年级", 8: "八年级",
    9: "九年级", 10: "高一", 11: "高二", 12: "高三"
  };

  function gradeName(g) {
    return GRADE_NAMES[Number(g)] || (g ? g + "年级" : "");
  }

  function termName(t) {
    return Number(t) === 2 ? "下" : "上";
  }

  /** 册次分组名（与 /poems/ 列表页、设置里的学段三档说的是同一件事） */
  function volumeOf(p) {
    if (!p || p.grade == null) return "";
    return gradeName(p.grade) + termName(p.term);
  }

  /** 可选的范围清单（供界面渲染；顺序即界面上出现的顺序） */
  function scopes() {
    return Object.keys(SCOPES).map(function (k) {
      var s = SCOPES[k];
      return { id: s.id, name: s.name, unit: s.unit };
    });
  }

  function scopeInfo(id) {
    return SCOPES[id] || null;
  }

  /**
   * 按范围筛出篇目。
   *
   * @param {Array} index  站点索引（`window.SITE_INDEX`）
   * @param {string} scope 见 SCOPES；认不出来 → 空数组（**不抛、也不偷偷换成别的范围**）
   * @returns {Array} 篇目（保持索引里的原始顺序）
   */
  function pick(index, scope) {
    var s = SCOPES[scope];
    if (!s || !Array.isArray(index)) return [];
    return index.filter(function (p) {
      if (!p || p.isBook) return false;              // 集子自身那一条不是篇目
      if (s.books) return s.books.indexOf(p.book) >= 0;
      return !!p.id;                                  // custom：调用方已把清单展开成条目
    });
  }

  /**
   * 把篇目排成「册次顺序」。
   *
   * 课内这一部的天然分法就是**教材册次**（一年级上 → …… → 高三下，共 24 册），
   * 与 `/poems/` 列表页、设置里「学段 / 年级 / 学期」说的是同一件事。
   * 数据文件里的出场顺序不该被当成「导出顺序」——那是**列表页的顺序**，
   * 日后重排数据就会连带改掉用户手里的导出文件。
   *
   * 没有 grade 的篇目（自选清单里的集子篇目）排在最后，彼此保持传入顺序。
   */
  function order(list, scope) {
    var arr = (list || []).slice();
    if (scope !== "poems") return arr;
    var rank = {};
    for (var g = 1; g <= 12; g += 1) {
      rank[volumeOf({ grade: g, term: 1 })] = (g - 1) * 2;
      rank[volumeOf({ grade: g, term: 2 })] = (g - 1) * 2 + 1;
    }
    var pos = {};
    arr.forEach(function (p, i) { pos[p && p.id] = i; });
    arr.sort(function (a, b) {
      var ra = volumeOf(a) in rank ? rank[volumeOf(a)] : 99;
      var rb = volumeOf(b) in rank ? rank[volumeOf(b)] : 99;
      if (ra !== rb) return ra - rb;
      return (pos[a.id] || 0) - (pos[b.id] || 0);
    });
    return arr;
  }

  /** 一行题头：「咏鹅　骆宾王（唐）」—— 作者与朝代缺哪个就少哪一段，不留空括号 */
  function headLine(p) {
    var title = String((p && p.title) || "").trim();
    var author = String((p && p.author) || "").trim();
    var dynasty = String((p && p.dynasty) || "").trim();
    var tail = author || dynasty
      ? "　" + author + (dynasty ? "（" + dynasty + "）" : "")
      : "";
    return title + tail;
  }

  /** 正文：把行尾空白去掉，但**不动断句与标点**（这份纸的用处之一正是拿去抄） */
  function bodyLines(p) {
    return String((p && p.text) || "")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map(function (l) { return l.replace(/\s+$/, ""); });
  }

  /**
   * 生成导出文本。
   *
   * @param {Object} o
   *   · items  —— 篇目数组（调用方负责按 pick()/order() 备好）
   *   · scope  —— 范围 id（决定分组的写法）
   *   · title  —— 文件头第一行（缺省按范围建）
   *   · withTranslation —— 是否附白话译文（默认 false：导出是为了「抄」）
   *   · now    —— 导出时间（Date 或毫秒；不传就不写时间行 —— 测试要可复现）
   * @returns {{text, count, skipped, groups}}
   *   count   写进文件的篇数
   *   skipped 有篇目但**没有正文**的篇数（如实报出来，不悄悄少一篇）
   *   groups  分组数（册次）
   */
  function build(o) {
    var opt = o || {};
    var s = SCOPES[opt.scope] || SCOPES.poems;
    var list = Array.isArray(opt.items) ? opt.items.slice() : [];

    var out = [];
    var title = String(opt.title || (s.name + "（跬步导出）")).trim();
    out.push(title);
    out.push("共 " + list.length + " " + s.unit + " · 跬步 kuibu.app");
    if (opt.now) {
      var d = opt.now instanceof Date ? opt.now : new Date(opt.now);
      if (!isNaN(d.getTime())) {
        out.push("导出于 " + d.getFullYear() + "-" +
          ("0" + (d.getMonth() + 1)).slice(-2) + "-" +
          ("0" + d.getDate()).slice(-2));
      }
    }
    out.push("");

    var groups = 0;
    var written = 0;
    var skipped = 0;
    var lastGroup = null;

    list.forEach(function (p) {
      if (!p || !p.id) return;
      var g = s.id === "poems" ? volumeOf(p) : "";
      if (g && g !== lastGroup) {
        lastGroup = g;
        groups += 1;
        out.push("");
        out.push("【" + g + "】");
        out.push("");
      }
      var lines = bodyLines(p);
      var hasBody = lines.some(function (l) { return l.trim() !== ""; });
      if (!hasBody) {
        /* 没有正文的篇目**不写成一条空条**：写出去是一行只有题名的东西，
           读的人会以为「这篇就是这样」。如实计数，由界面说清有几篇没排进来。 */
        skipped += 1;
        return;
      }
      written += 1;
      out.push(headLine(p));
      lines.forEach(function (l) { if (l.trim() !== "") out.push(l); });
      if (opt.withTranslation && p.translation) {
        out.push("");
        out.push("白话译文：" + String(p.translation).replace(/\s+/g, " ").trim());
      }
      out.push("");
    });

    /* 末尾只留一个换行：文件尾多出一堆空行，粘进文档就是一堆空段落 */
    var text = out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "") + "\n";
    return { text: text, count: written, skipped: skipped, groups: groups };
  }

  /** 文件名：`跬步-课内诗词-2026-09-16.txt`（同一天导出两次会重名，浏览器自己加 (1)） */
  function fileName(scope, now) {
    var s = SCOPES[scope] || SCOPES.poems;
    var d = now instanceof Date ? now : new Date(now || Date.now());
    var stamp = !isNaN(d.getTime())
      ? d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2)
      : "";
    return "跬步-" + s.name + (stamp ? "-" + stamp : "") + ".txt";
  }

  return {
    SCOPES: SCOPES,
    scopes: scopes,
    scopeInfo: scopeInfo,
    pick: pick,
    order: order,
    volumeOf: volumeOf,
    headLine: headLine,
    build: build,
    fileName: fileName
  };
});
