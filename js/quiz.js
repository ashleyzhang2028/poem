/**
 * 试题模拟 · 出题内核（纯逻辑，零 DOM、零网络）
 * ==========================================================================
 * 这一份只管**出题与判分**，不管界面、不写存储、不调接口。
 * 三件东西都从它上面长出来：
 *
 *   飞花令      —— 给一个令字，从全站篇目里给出所有带这个字的句子
 *   题库复习    —— 从一份题库里按掌握度抽题（题干 + 四个选项 + 答案）
 *   试题模拟    —— 按份数抽一套题，当场判分（Max）
 *
 * 为什么出题要收口到一处：
 *   三件事都要回答同一个问题 ——「哪一句 / 哪一个字才算数」。
 *   散在三个文件里写，就会出现「飞花令认这个字、题库不认」这类分叉，
 *   而分叉的症状是「我明明想到了，它说我不对」—— 用户没法自查。
 *
 * ## 三条口径（与全站同源）
 *
 *   1. **题与答案一起出** —— 抽题时就把答案定下来，判分只做比对。
 *      界面上「先藏答案、再刮开」靠的是 CSS 遮住，不是不生成答案；
 *      答案本来就在浏览器里，这一点界面必须如实说（不许说成「防作弊」）。
 *   2. **一份题库就是全站篇目，不另造语料** —— 题干、句子的唯一来源是
 *      各集子自己的数据文件（课内 261 首 + 六部集子）。
 *      另造一份题库的下场是「题库里有的、正文里搜不到」。
 *   3. **判分是纯函数** —— 同样输入同样输出，不读时钟、不读存储。
 *      于是它可以被逐条断言，也才能在服务端与客户端各跑一次还对得上。
 *
 * 用法（全部是纯函数）：
 *   Quiz.lines(poems)                     → 全部句子（含出处）的数组
 *   Quiz.flyFlower({ poems, char, limit })→ { char, byPoem:[], count }
 *   Quiz.candidates(poems, n)             → 这一份语料里适合出题的「令字」候选
 *   Quiz.buildBank(poems, opt)            → 题库（每篇一条或多条）
 *   Quiz.grade(question, answer)          → { ok, why }
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Quiz = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ------------------------------------------------------------------ 分词 */

  /** 标点与空白：断句用 */
  var PUNCT = /[。！？；，、：·…—～「」『』（）《》〈〉“”‘’"'()\[\]【】!?;:,.]/;

  function isPunct(ch) { return PUNCT.test(ch); }

  /**
   * 把一篇的正文切成句子。
   *
   * 口径：**以句号 / 问号 / 感叹号 / 换行为界**再切逗号，
   * 切完把两端空白去掉、空句丢掉。切出来的每一段都带得回原篇的出处。
   * ⚠️ 不切分号以内的顿号 —— 「东临碣石，以观沧海」是一句，
   *    再切下去就只剩两三个字，飞花令里没法看。
   */
  function splitLines(text) {
    var src = String(text == null ? "" : text);
    var out = [];
    // 先按「大停顿」切（句号问号感叹号换行），再按「小停顿」切（逗号顿号冒号）
    src.split(/[。！？\n]+/).forEach(function (big) {
      big.split(/[，、：;；]+/).forEach(function (small) {
        var s = small.replace(/[「」『』“”‘’"'()（）《》〈〉\[\]【】]/g, "").trim();
        if (s) out.push(s);
      });
    });
    return out;
  }

  /** 句子里的汉字（去标点、去空白）—— 飞花令只看字，不看标点 */
  function hanOf(s) {
    return String(s == null ? "" : s).split("").filter(function (ch) {
      return isHan(ch);
    });
  }

  function isHan(ch) {
    var c = String(ch || "").charCodeAt(0);
    return c >= 0x3400 && c <= 0x9fff;
  }

  /**
   * 一篇作品的「出处短名」——列表与结果里那一行小字。
   * 课内写册次（「一年级上」），集子写集子名 + 卷次 / 词牌（若有）。
   */
  function sourceOf(p) {
    var bits = [];
    if (p && p.gradeGroup) bits.push(p.gradeGroup);
    else if (p && p.selection) bits.push(p.selection);
    else if (p && p.book) bits.push(p.book);
    if (p && p.dynasty) bits.push(p.dynasty);
    if (p && p.author) bits.push(p.author);
    return bits.filter(Boolean).join(" · ");
  }

  /* -------------------------------------------------------------- 一、句子表 */

  /**
   * 把一份语料摊成句子表。每一行：
   *   { id, title, author, dynasty, text, source }
   * 同一篇里的重复句子（《江南》那种「鱼戏莲叶东/西/南/北」）**各留一行** ——
   * 飞花令里它们是不同的句子，合并会少给人看几行。
   * 但「同一篇里一字不差的两行」只留一行（数据录入留下的重复）。
   */
  function lines(poems) {
    var out = [];
    (poems || []).forEach(function (p) {
      if (!p || !p.id) return;
      var seen = {};
      splitLines(p.text).forEach(function (s) {
        if (seen[s]) return;
        seen[s] = 1;
        out.push({
          id: p.id,
          title: p.title || "",
          author: p.author || "",
          dynasty: p.dynasty || "",
          text: s,
          source: sourceOf(p)
        });
      });
    });
    return out;
  }

  /* -------------------------------------------------------- 二、飞花令（令字） */

  /**
   * 这一份语料里**适合当令字**的字，按「能凑出的句子条数」从多到少。
   *
   * 规则只有两条，都是为了让「飞花令」这件事成立：
   *   · 至少要能凑出 `min` 条不同的句子（凑不出来的令字一开局就无解）
   *   · 出现在**至少两篇**里（都在同一篇里，等于考背诵而不是考联想）
   *
   * ⚠️ 这里**不认识常用字表** —— 挑令字只看「能不能凑出句子」。
   *    生僻字也能当令字（「鹧鸪」也是正经的令字），
   *    注音由 js/pinyin.js 那一层负责，两件事不混。
   */
  function candidates(poems, opt) {
    var o = opt || {};
    var min = o.min == null ? 6 : o.min;
    var rows = lines(poems);
    var freq = {};     // 字 → 句子条数
    var poemsOf = {};  // 字 → 出现过的篇 id
    rows.forEach(function (r) {
      var seen = {};
      hanOf(r.text).forEach(function (ch) {
        if (seen[ch]) return;
        seen[ch] = 1;
        freq[ch] = (freq[ch] || 0) + 1;
        (poemsOf[ch] || (poemsOf[ch] = {}))[r.id] = 1;
      });
    });
    return Object.keys(freq).filter(function (ch) {
      return freq[ch] >= min && Object.keys(poemsOf[ch]).length >= 2;
    }).sort(function (a, b) {
      return freq[b] - freq[a] || (a < b ? -1 : 1);   // 条数相同按字序，结果可复现
    });
  }

  /**
   * 飞花令：给一个（或几个）令字，列出所有带它的句子。
   *
   * @param {Object} o { poems, char | chars, limit, exclude:[id] }
   * @returns {Object} { chars:[], rows:[{id,title,text,source,hit:[]}], count, byChar:{} }
   *
   * `hit` 是这一行里命中的令字（去重、按字序）—— 界面上要把它们标出来，
   * 所以由内核给出，界面不自己再扫一遍（两处扫法必然分叉）。
   */
  function flyFlower(o) {
    var opt = o || {};
    var chars = (opt.chars || [opt.char]).filter(Boolean).map(String);
    var excl = {};
    (opt.exclude || []).forEach(function (id) { excl[id] = 1; });
    var limit = opt.limit == null ? 0 : Number(opt.limit);

    var byChar = {};
    chars.forEach(function (c) { byChar[c] = 0; });

    var rows = [];
    lines(opt.poems).forEach(function (r) {
      if (excl[r.id]) return;
      var hit = chars.filter(function (c) { return r.text.indexOf(c) >= 0; });
      if (!hit.length) return;
      hit.forEach(function (c) { byChar[c] += 1; });
      rows.push({
        id: r.id, title: r.title, author: r.author, dynasty: r.dynasty,
        text: r.text, source: r.source, hit: hit
      });
    });
    // 命中令字多的在前，其次句子短的在前（先看见好记的）
    rows.sort(function (a, b) {
      return b.hit.length - a.hit.length || a.text.length - b.text.length ||
        (a.id < b.id ? -1 : 1);
    });
    var count = rows.length;
    if (limit > 0) rows = rows.slice(0, limit);
    return { chars: chars, rows: rows, count: count, byChar: byChar };
  }

  /* ------------------------------------------------------------ 三、题库复习 */

  /**
   * 造题库：**一篇一条**，题型是「给上句，选下句」。
   *
   * 为什么是这个题型：
   *   · 它不需要任何额外语料 —— 上下句都在正文里；
   *   · 干扰项也能从语料里取（别人的句子），不必手编四个选项；
   *   · 判分是「选中的那一条 id 对不对」，不涉及模糊匹配，
   *     于是客户端与服务端各跑一次必然同答案。
   *
   * 一道题只在「这一篇至少有两句」时才有意义（只有一句的篇目没有上下句）。
   * 每题带 `stem`（上句）、`answer`（下句）、`options[]`（四条，含答案）、
   * `answerIndex`（答案在 options 里的位置）——**位置每次现算**，
   * 免得题库里那一条永远是对的、背答案的位置就能全对。
   *
   * @param {Array} poems
   * @param {Object} o { perPoem:1, options:4, seed:"" }
   */
  function buildBank(poems, o) {
    var opt = o || {};
    var perPoem = opt.perPoem == null ? 1 : Number(opt.perPoem);
    var bank = [];
    (poems || []).forEach(function (p) {
      if (!p || !p.id) return;
      var ss = splitLines(p.text);
      if (ss.length < 2) return;

      /* 从「相邻且不相同的两句」里挑题干 —— 这一步**不是过滤器，是正确性**：
         《咏鹅》开头的「鹅，鹅，鹅」三句一字不差，拿它出的题
         （题干「鹅」、答案「鹅」）连题目本身都读不通，
         而四个选项里只要还有一个「鹅」，这道题就**没有正确答案可言**。
         数据里这样的篇目真有一篇（xx1-01），所以它必须在**出题**这一层挡掉，
         不能指望每个调用方自己去查。 */
      var pairs = [];
      for (var i = 0; i < ss.length - 1; i += 1) {
        if (ss[i] !== ss[i + 1]) pairs.push(i);
      }
      if (!pairs.length) return;
      var n = Math.min(perPoem, pairs.length);
      for (var k = 0; k < n; k += 1) {
        var at = pairs[k];
        bank.push({
          id: p.id + "#" + k,
          poemId: p.id,
          title: p.title || "",
          author: p.author || "",
          dynasty: p.dynasty || "",
          source: sourceOf(p),
          stem: ss[at],
          answer: ss[at + 1]
        });
      }
    });
    return bank;
  }

  /**
   * 从题库里抽一道题，并当场配好干扰项。
   *
   * @param {Object} o { bank, at | id, options:4, avoid:[poemId] }
   * @returns {Object|null}
   *   { id, poemId, title, source, stem, options:[], answerIndex, answer }
   *
   * 干扰项的三条规矩：
   *   ① 与答案**长度档**相近（差 4 字以内）—— 一眼看出「只有这条长」等于送分
   *   ② 不与答案重字过半 —— 长诗里两句共用词是常态，干扰项与答案太像就成了两个都对
   *   ③ 不与本题同一篇 —— 同一篇的下一句是唯一的正确答案，别的句子拿来当干扰
   *      会让人以为「这篇里还有另一处能接上」
   */
  function pick(o) {
    var opt = o || {};
    var bank = opt.bank || [];
    if (!bank.length) return null;
    var want = opt.options == null ? 4 : Number(opt.options);

    var q = null;
    if (opt.id != null) {
      for (var i = 0; i < bank.length; i++) if (bank[i].id === opt.id) { q = bank[i]; break; }
    } else {
      var at = Number(opt.at == null ? 0 : opt.at) % bank.length;
      q = bank[at];
    }
    if (!q) return null;

    var avoid = {};
    (opt.avoid || []).forEach(function (pid) { avoid[pid] = 1; });
    avoid[q.poemId] = 1;

    var answer = q.answer;
    var pool = bank.filter(function (x) {
      if (x.poemId === q.poemId) return false;
      if (avoid[x.poemId]) return false;
      if (x.answer === answer) return false;
      if (Math.abs(x.answer.length - answer.length) > (opt.tolerance == null ? 4 : Number(opt.tolerance))) return false;
      if (overlap(x.answer, answer) > 0.5) return false;
      return true;
    });

    // 抽不到就放宽「长度档」，但**不放宽前两条**（不放宽长度的代价是送分，
    // 放宽重字的代价是出现两个都对 —— 后者更糟）。
    if (pool.length < want - 1) {
      pool = pool.concat(bank.filter(function (x) {
        if (x.poemId === q.poemId || avoid[x.poemId]) return false;
        if (x.answer === answer) return false;
        return overlap(x.answer, answer) <= 0.5 && !pool.some(function (y) { return y.id === x.id; });
      }));
    }

    // 去重（同一句可能来自很多篇）、再按种子打散取前 want-1 条
    var seen = {};
    seen[answer] = 1;
    var bag = [];
    pool.forEach(function (x) {
      if (seen[x.answer]) return;
      seen[x.answer] = 1;
      bag.push(x.answer);
    });
    bag = shuffle(bag, String(opt.seed == null ? q.id : opt.seed));

    var options = bag.slice(0, Math.max(0, want - 1));
    options.push(answer);
    options = shuffle(options, String(opt.seed == null ? q.id : opt.seed) + "|opt");

    return {
      id: q.id,
      poemId: q.poemId,
      title: q.title,
      author: q.author,
      dynasty: q.dynasty,
      source: q.source,
      stem: q.stem,
      options: options,
      answerIndex: options.indexOf(answer),
      answer: answer
    };
  }

  /** 两句里重字占比（分母取短的那么长）—— 用来挡「干扰项与答案太像」 */
  function overlap(a, b) {
    var A = hanOf(a), B = hanOf(b);
    if (!A.length || !B.length) return 0;
    var set = {};
    B.forEach(function (c) { set[c] = 1; });
    var same = 0;
    var mark = {};
    A.forEach(function (c) { if (set[c] && !mark[c]) { mark[c] = 1; same += 1; } });
    return same / Math.min(A.length, B.length);
  }

  /**
   * 可复现的打散：同一个种子永远得到同一个顺序。
   * 用不到 Math.random —— 判分要能逐条断言，抽题也得能。
   */
  function shuffle(arr, seed) {
    var out = arr.slice();
    var s = 2166136261;
    String(seed == null ? "" : seed).split("").forEach(function (ch) {
      s ^= ch.charCodeAt(0);
      s = (s * 16777619) >>> 0;
    });
    for (var i = out.length - 1; i > 0; i -= 1) {
      s = (s * 1103515245 + 12345) >>> 0;
      var j = s % (i + 1);
      var t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
  }

  /**
   * 抽一整套卷子。
   *
   * @param {Object} o { bank, size:5, seed:"" }
   * 同一套卷子里**不重复同一篇**（连着两道题问同一首诗，等于只考了一首）。
   */
  function paper(o) {
    var opt = o || {};
    var size = Math.max(1, Number(opt.size == null ? 5 : opt.size));
    var bank = shuffle(opt.bank || [], String(opt.seed == null ? "paper" : opt.seed));
    var out = [];
    var used = {};
    for (var i = 0; i < bank.length && out.length < size; i += 1) {
      if (used[bank[i].poemId]) continue;
      var q = pick({
        bank: opt.bank || [],
        id: bank[i].id,
        options: opt.options,
        avoid: Object.keys(used),
        seed: String(opt.seed == null ? "paper" : opt.seed) + "#" + out.length
      });
      if (!q || q.answerIndex < 0) continue;
      used[bank[i].poemId] = 1;
      out.push(q);
    }
    return out;
  }

  /* -------------------------------------------------------------- 四、判分 */

  /**
   * 判一道题。**纯比对，不接受任何模糊** —— 选项是四个句子，
   * 判「用户点的那一条是不是答案」就够了，不需要自然语言理解。
   *
   * @returns {Object} { ok, why }
   *   why: "ok" | "wrong" | "empty" | "noAnswer"
   *
   * 判分在**服务端也跑同一份**（/api/game/answer 用它），
   * 所以这里不许读时钟、不许读存储、不许依赖浏览器 API。
   */
  function grade(q, chosen) {
    if (!q) return { ok: false, why: "noAnswer" };
    var pick = chosen == null ? "" : String(chosen);
    if (!pick) return { ok: false, why: "empty" };
    return { ok: pick === String(q.answer), why: pick === String(q.answer) ? "ok" : "wrong" };
  }

  /* ------------------------------------------------------ 五、令字的出处说明 */

  /**
   * 从一份语料里取「令字候选」的说明行 —— 结果页顶上那句「这一个字能对上 N 句」。
   * 只报事实，不做「你太厉害了」这类评价（与全站文案口径一致）。
   */
  function charSummary(poems, chars) {
    var ff = flyFlower({ poems: poems, chars: chars });
    var parts = chars.map(function (c) {
      return c + " " + (ff.byChar[c] || 0) + " 句";
    });
    return { total: ff.count, byChar: ff.byChar, text: parts.join(" · ") };
  }

  return {
    splitLines: splitLines,
    hanOf: hanOf,
    isHan: isHan,
    lines: lines,
    candidates: candidates,
    flyFlower: flyFlower,
    buildBank: buildBank,
    pick: pick,
    paper: paper,
    grade: grade,
    overlap: overlap,
    shuffle: shuffle,
    charSummary: charSummary,
    sourceOf: sourceOf
  };
});
