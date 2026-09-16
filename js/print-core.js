/**
 * 篇目 PDF / 打印页 · 版面内核（纯逻辑，零 DOM、零网络、零存储）
 * ==========================================================================
 * 这一份只做一件事：**把一批篇目排成一页能打印的纸**，并算出它有几页。
 *
 *   一份篇目打印页 = 若干「块」（篇目正文 / 拼音行 / 译文 / 注释格线）
 *   一个块 = 若干「行」（每一行都在纸上占一个固定的格数）
 *
 * 为什么要把「排成几行」这件事从界面里拿出来：
 *   「这一份打出来是几页」是**用户在点打印之前就该看到的信息** ——
 *   家长要挑「够一张 A4 的两面」的量，而不是打印出来才发现多出一页。
 *   把它写进页面里，就只能等浏览器排版完才知道；写在这里，点之前就说得出来，
 *   而且能被逐条断言（同样输入同样输出，不读时钟、不读宽度、不读字体）。
 *
 * ## 三条口径
 *
 * 1. **不猜字体宽度** —— 每行的格数是**给定的参数**，不按字号算术。
 *    真正的字形宽度只有渲染时才定得下来（不同设备的中文字体差得很远），
 *    这里算的是一个**版面预案**：它管「打几页」，不管「好不好看」。
 *    所以界面上写的是「约 N 页」，不是「正好 N 页」——见 js/print.js 的口径。
 *
 * 2. **标点照排** —— 正文按**原样**断行，不重排、不改字。
 *    打印出来的东西要能拿去抄、拿去读，不是又一份转写版。
 *    只有两种行会被合并：一行里只有标点（输入的换行留下的）、空行。
 *
 * 3. **一行也不许凭空加** —— 没有拼音、没有译文、没有注释格的时候，
 *    它们**不出现在纸上**（不是打一段空白）。这直接决定了页数，
 *    也决定了「免费用户看到的那一份」与「Pro 那一份」差在哪里。
 *
 * 用法（全部是纯函数）：
 *   PrintCore.PAPER          → 三种纸的版面参数（A4 / A4 横向 / 半张）
 *   PrintCore.layout(poems, opt) → { sheets, blocks, columns, ... }
 *   PrintCore.options(poem)  → 这一篇**能**带哪几种块（有拼音吗 / 有译文吗）
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PrintCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* --------------------------------------------------------------- 版面参数 */

  /**
   * 三种纸。数值是**版面预案**（不是物理保证）：
   *   cards  一页能放几张卡片（每张卡片最少 6 行正文 + 1 行标题）
   *   lines  每一栏的总行数 —— 卡片之间的间距先换算成行，再统一算
   *
   * ⚠️ 这些数字**只有一份**（就在这里）。页面与打印样式表都读它，
   *    不许在 CSS 里再写一遍「一页 A4 放 4 张」——两处各写一份的下场是
   *    「预览说 2 页、打出来 3 页」，而用户只会在浪费了两张纸之后才发现。
   */
  var PAPER = {
    a4:      { id: "a4",      name: "A4 纵向", columns: 1, rows: 52, isDefault: true },
    a4wide:  { id: "a4wide",  name: "A4 横向", columns: 2, rows: 34 },
    half:    { id: "half",    name: "半张（A5）", columns: 1, rows: 34 }
  };

  var ORDER = ["a4", "a4wide", "half"];

  /** 一栏里留多少行给「页眉与页脚」——不算内容，但真的占位置 */
  var HEADER_ROWS = 2;

  /** 卡片之间的间距，换算成行 —— 一张卡片前后各留一点，读起来才不糊成一片 */
  var GAP_ROWS = 1;

  function paperOf(id) {
    return PAPER[id] || PAPER.a4;
  }

  /* ----------------------------------------------------------------- 分块 */

  /**
   * 断行。**标点照排**，只做三件事：
   *   · 按 `\n` 切开（原文里的换行就是作者给的断行）；
   *   · 丢掉「只有标点 / 只有空白」的行；
   *   · 丢掉空行。
   *
   * ⚠️ **不按字数重排**。「七言绝句排成两行」这类做法在纸面上好看，
   *    但会把原文改动一次，而这份纸的用处之一正是「拿去抄」。
   *    原文怎么断，纸面上就怎么断。
   */
  function linesOf(text) {
    return String(text == null ? "" : text)
      .split(/\r?\n/)
      .map(function (s) { return s.replace(/[ \t\u3000]+$/g, ""); })
      .filter(function (s) {
        /* 去掉两种行：只有空白 / 只有标点。
           ⚠️ 判据是「这一行里**有没有一个汉字或数字字母**」——
              原先写成「去掉空白之后还含汉字或全角标点」，结果一行「，」
              自己就是全角标点，照样通过 —— 那种行会占掉纸上一整行，
              而它上面什么都没有。 */
        return /[\u3400-\u9fff0-9a-zA-Z]/.test(s);
      });
  }

  /** 这一篇能带哪几种块（按它手上**真有**的数据说话，不按层级） */
  function options(poem) {
    var p = poem || {};
    return {
      title: true,
      pinyin: !!p.pinyin,
      translation: !!p.translation,
      blank: false        // 注释格线是**选项**，不是有数据才有
    };
  }

  /**
   * 一个「块」= 打印纸上一张卡片。
   *
   * @param {Object} poem
   * @param {Object} o { pinyin, translation, blank, blankLines, title, number }
   * @returns {Object} { id, title, meta, lines:[{text, kind, n}], rows, kinds }
   */
  function blockOf(poem, o) {
    var p = poem || {};
    var opt = o || {};
    var rows = [];
    var kinds = {};

    /**
     * 一行正文 / 拼音 / 译文 / 格线。
     * `n` 是**这一行占的格数**（一行正文 = 1，拼音行 = 1，译文按它自己的行数）。
     */
    function push(text, kind) {
      var s = String(text == null ? "" : text);
      /* ⚠️ 空文本只对**格线**放行：格线本来就是空行（它是「留位置写注释」，
         文字为空正是它的意思）。其余三种块空着就是没内容，不上纸 ——
         空行照样占位置，悄悄多一行会让「约几张」算少。 */
      if (!s && kind !== "blank") return;
      kinds[kind] = (kinds[kind] || 0) + 1;
      rows.push({ text: s, kind: kind });
    }

    var body = linesOf(p.text);
    var py = opt.pinyin && p.pinyin ? linesOf(p.pinyin) : [];
    var tr = opt.translation && p.translation ? linesOf(p.translation) : [];

    /* 拼音与正文**逐行配对**：数据里两份是按同一个换行写的。
       行数对不上时按行号取（多余的拼音行丢掉，多出来的正文行不带拼音）——
       「错位一行」的症状是把上一篇的拼音贴到下一句上，比不带拼音更糟。 */
    var bodyFrom = opt.number === false ? 0 : 0;
    body.forEach(function (t, i) {
      if (opt.pinyin && py[i]) push(py[i], "pinyin");
      push(t, "text");
      /* 译文插在**整篇之后**（不是逐句对照）：多一句一行的对照会把纸面撑成两倍厚，
         而这份纸的用途是「背」与「抄」，逐句对照反而是另一件事。 */
      void bodyFrom;
    });
    if (tr.length) {
      tr.forEach(function (t) { push(t, "translation"); });
    }

    /* 注释格线：给「自己写注释」留的位置。它是**真的空白行**（行高与正文同），
       不是一条下划线 —— 一条线只有 1px 高，一行手写要 3~4 倍。
       ⚠️ 它进 `rows`，所以它真的会算进页数（不诚实的地方就在这里）。 */
    if (opt.blank) {
      var n = opt.blankLines == null ? 3 : Math.max(0, Number(opt.blankLines));
      for (var i = 0; i < n; i += 1) push("", "blank");
    }

    var title = opt.title === false ? "" : String(p.title || "") +
      (p.author ? "　" + p.author : "");
    var meta = [p.dynasty, p.gradeGroup || p.selection || p.book, p.source]
      .filter(Boolean).join(" · ");

    return {
      id: p.id || "",
      title: title.trim(),
      /* 出处那一行：**缺哪一样就不写哪一样**，不拿「未知」占位
         （纸面上写「未知」比空着更难看，而且它什么也没说） */
      meta: meta,
      rows: rows,
      kinds: kinds,
      /* 一张卡片占的行数 = 标题 1（有的话）+ 出处 1（有的话）+ 正文那些行
         + 上下的间距。**卡片高度是算出来的**，不是估的。 */
      height: rows.length +
        (title ? 1 : 0) + (meta ? 1 : 0) + GAP_ROWS
    };
  }

  /* ----------------------------------------------------------------- 排版 */

  /**
   * 把一批篇目排成纸。
   *
   * @param {Array} poems 篇目（每个都要有 id / title / text）
   * @param {Object} o {
   *   paper: "a4" | "a4wide" | "half",
   *   pinyin / translation / blank: 三个块开关,
   *   blankLines: 格线行数,
   *   title: 稿头标题（可省）,
   *   note: 稿头下面那一行小字（可省）
   * }
   * @returns {Object} {
   *   paper, sheets, perSheet, columns, rows, used, blocks, empty
   * }
   *
   * `sheets` = 需要几张纸。**只报这一个数**，不报「正好几页」——
   * 见文件头第 1 条口径。
   */
  function layout(poems, o) {
    var opt = o || {};
    var paper = paperOf(opt.paper);

    var list = (poems || []).filter(function (p) { return p && p.id; });
    var blank = opt.blank ? { blank: true, blankLines: opt.blankLines } : {};

    var blocks = list.map(function (p) {
      return blockOf(p, {
        pinyin: !!opt.pinyin,
        translation: !!opt.translation,
        blank: !!opt.blank,
        blankLines: opt.blankLines
      });
    }).filter(function (b) {
      /* **正文一行都没有**的篇目不出现在纸上，也不占位置。
         它会数进 `empty`，界面据此如实说「另有 N 篇没有正文，没有排进来」——
         悄悄少一篇比多打一张纸更难发现。
         ⚠️ 判据是「有没有正文行」，**不是「有没有标题」**：只有标题的空壳
            排上去就是一页纸上一个孤零零的篇名，那比少一篇更奇怪。
         ⚠️ 格线行不算正文 —— 一篇空篇目开了格线也不该因此排上纸。 */
      return b.rows.some(function (r) { return r.kind === "text"; });
    });

    var empty = list.length - blocks.length;

    /* 每一栏的可用行数：总行数减掉页眉页脚那一块 */
    var perColumn = Math.max(1, paper.rows - HEADER_ROWS);
    var perSheet = perColumn * paper.columns;

    /* 排：一张卡片**不跨栏**（跨栏的卡片会被撕成两半，读者要来回看）。
       一张比一整栏还高的卡片照样放，只是它自己占掉一栏，
       并在 `oversize` 里报出来 —— 界面要如实说「有一篇太长，这一栏放不下第二篇」。 */
    var sheets = 1;          // 有内容就至少是一张纸（下面按「换了几张」累加）
    var used = 0;            // 当前这一栏已经用掉的行
    var column = 0;          // 当前排到第几栏（0 ≤ column < columns）
    var oversize = [];
    var placed = [];

    /**
     * 换到下一栏。跨过最后一栏就是**换一张纸**（sheets 加一）。
     *
     * ⚠️ 这一步必须是**唯一的换栏入口**。原先的写法是「先把 column 加一，
     *    再在末尾判 column ≥ columns 才 sheets++」—— 那个判断在**放不下而跳过**
     *    的那条路上会漏掉：卡片放不下时 column 加了、`used` 清零，
     *    但「跨过一栏」这件事没算进 sheets，于是三篇各占一栏被算成**一张纸**
     *    （实测：应当 2 张，报 1 张）。页数算少的症状是用户打出来才发现多一张纸，
     *    而这一层的存在理由正是「点打印之前就说得准」。
     */
    function nextColumn() {
      if (column + 1 >= paper.columns) { column = 0; sheets += 1; }
      else column += 1;
      used = 0;
    }

    if (!blocks.length) sheets = 0;       // 一篇都没有 = 不报「一张纸」
    blocks.forEach(function (b) {
      if (b.height > perColumn) {
        /* 长到超过一整栏：它自己占掉一栏。当前栏若已经写了东西，
           先换一栏再放它（不硬塞进剩下的那几行里）。 */
        oversize.push(b.id);
        if (used > 0) nextColumn();
      } else if (used + b.height > perColumn) {
        nextColumn();
      }
      placed.push({ block: b, column: column });
      used += b.height;
    });

    return {
      paper: paper.id,
      paperName: paper.name,
      sheets: sheets,
      columns: paper.columns,
      rows: paper.rows,
      perSheet: perSheet,
      used: blocks.reduce(function (n, b) { return n + b.height; }, 0),
      blocks: blocks,
      placed: placed,
      oversize: oversize,
      empty: empty,
      count: blocks.length
    };
  }

  /**
   * 「这一份打出来大概几张纸」——一句话说清，界面直接用。
   *
   * ⚠️ 措辞是**「约」**，不是「正好」：`layout()` 算的是版面预案，
   *    真正的字形宽度只有渲染时才知道（不同设备的中文字体差得很远）。
   *    把「约」去掉就是一句早晚会变假的话。
   */
  function summary(lay) {
    if (!lay || !lay.count) return "这一份里还没有篇目。";
    return "约 " + lay.sheets + " 张" + lay.paperName + "（" + lay.count + " 篇" +
      (lay.empty ? "，另有 " + lay.empty + " 篇没有正文、没有排进来" : "") + "）";
  }

  return {
    PAPER: PAPER,
    ORDER: ORDER,
    HEADER_ROWS: HEADER_ROWS,
    GAP_ROWS: GAP_ROWS,
    paperOf: paperOf,
    linesOf: linesOf,
    options: options,
    blockOf: blockOf,
    layout: layout,
    summary: summary
  };
});
