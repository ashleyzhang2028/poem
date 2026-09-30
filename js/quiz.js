(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Quiz = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var PUNCT = /[。！？；，、：·…—～「」『』（）《》〈〉“”‘’"'()\[\]【】!?;:,.]/;

  function isPunct(ch) { return PUNCT.test(ch); }

  function splitLines(text) {
    var src = String(text == null ? "" : text);
    var out = [];

    src.split(/[。！？\n]+/).forEach(function (big) {
      big.split(/[，、：;；]+/).forEach(function (small) {
        var s = small.replace(/[「」『』“”‘’"'()（）《》〈〉\[\]【】]/g, "").trim();
        if (s) out.push(s);
      });
    });
    return out;
  }

  function hanOf(s) {
    return String(s == null ? "" : s).split("").filter(function (ch) {
      return isHan(ch);
    });
  }

  function isHan(ch) {
    var c = String(ch || "").charCodeAt(0);
    return c >= 0x3400 && c <= 0x9fff;
  }

  function sourceOf(p) {
    var bits = [];
    if (p && p.gradeGroup) bits.push(p.gradeGroup);
    else if (p && p.selection) bits.push(p.selection);
    else if (p && p.book) bits.push(p.book);
    if (p && p.dynasty) bits.push(p.dynasty);
    if (p && p.author) bits.push(p.author);
    return bits.filter(Boolean).join(" · ");
  }

  var SPLIT_CACHE = {};

  function splitCached(text) {
    var key = String(text == null ? "" : text);
    var hit = SPLIT_CACHE[key];
    if (hit) return hit;

    hit = splitLines(key);

    SPLIT_CACHE[key] = hit;
    return hit;
  }

  var LINES_CACHE = [];

  function linesFingerprint(poems) {
    var src = poems || [];
    var s = "";
    for (var i = 0; i < src.length; i++) {
      var p = src[i];
      s += (p && p.id ? p.id : "") + "\u0001" +
        (p && p.text ? p.text : "") + "\u0002";
    }
    return src.length + ":" + s;
  }

  function lines(poems) {
    var fp = linesFingerprint(poems);
    for (var c = 0; c < LINES_CACHE.length; c++) {
      if (LINES_CACHE[c].fp === fp) return LINES_CACHE[c].rows;
    }
    var rows = buildLines(poems);
    LINES_CACHE.push({ fp: fp, rows: rows });

    if (LINES_CACHE.length > 4) LINES_CACHE.shift();
    return rows;
  }

  function buildLines(poems) {
    var out = [];
    (poems || []).forEach(function (p) {
      if (!p || !p.id) return;
      var seen = {};
      splitCached(p.text).forEach(function (s) {
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

  function candidates(poems, opt) {
    var o = opt || {};
    var min = o.min == null ? 6 : o.min;
    var rows = lines(poems);
    var freq = {};
    var poemsOf = {};
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
      return freq[b] - freq[a] || (a < b ? -1 : 1);
    });
  }

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

    rows.sort(function (a, b) {
      return b.hit.length - a.hit.length || a.text.length - b.text.length ||
        (a.id < b.id ? -1 : 1);
    });
    var count = rows.length;
    if (limit > 0) rows = rows.slice(0, limit);
    return { chars: chars, rows: rows, count: count, byChar: byChar };
  }

  function buildBank(poems, o) {
    var opt = o || {};
    var perPoem = opt.perPoem == null ? 1 : Number(opt.perPoem);
    var bank = [];
    (poems || []).forEach(function (p) {
      if (!p || !p.id) return;
      var ss = splitCached(p.text);
      if (ss.length < 2) return;

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

    if (pool.length < want - 1) {
      pool = pool.concat(bank.filter(function (x) {
        if (x.poemId === q.poemId || avoid[x.poemId]) return false;
        if (x.answer === answer) return false;
        return overlap(x.answer, answer) <= 0.5 && !pool.some(function (y) { return y.id === x.id; });
      }));
    }

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

  function grade(q, chosen) {
    if (!q) return { ok: false, why: "noAnswer" };
    var pick = chosen == null ? "" : String(chosen);
    if (!pick) return { ok: false, why: "empty" };
    return { ok: pick === String(q.answer), why: pick === String(q.answer) ? "ok" : "wrong" };
  }

  // ——— 飞花令「闯关」的判分内核（Issue #356 P4）———————————————
  //
  // 为什么判分放这里、不塞在 game.js 的渲染里：
  //   · 闯关的「答对了」= 这一句**一字不差地存在语料里**，且**带着令字**；
  //   · 句子本身与「拿掉了令字还认得出是同一句」这两件事都是语料问题，
  //     与谁在屏幕上敲的字无关 —— 放纯逻辑层才能不起浏览器就测（界面测试层
  //     已按 Issue #278 删掉）。
  //
  // 用户 2026-09-30 的原话是「要求用户主动在『自己写一句』框里作答」。
  // 所以宽严都往「鼓励」那一边靠：整句照抄最稳，只写其中一段也算 ——
  // 只要那一段是语料里真实存在、且含令字的一段。不认识的句子才判错。

  // 取出一句里「连着的汉字」，标点与空白都丢掉 —— 用户敲字时不会把逗号也敲上。
  function hanRuns(text) {
    var runs = [];
    var cur = "";
    String(text == null ? "" : text).split("").forEach(function (ch) {
      if (isHan(ch)) { cur += ch; return; }
      if (cur) { runs.push(cur); cur = ""; }
    });
    if (cur) runs.push(cur);
    return runs;
  }

  // 一句够不够「写过一句」：至少 4 个连着的汉字，免得「日」这种单字蒙对。
  // 这个数是**门槛**也是**筛子** —— levelChars() 挑句库时要用同一个值把
  // 「水」「水长流」这类短短的一段滤掉，否则句库里躺着一条永远判不过的句子，
  // 用户照着它抄反而被判「太短，写整一点」。
  var MIN_SAY_HAN = 4;

  function saidRuns(said) {
    return hanRuns(said).filter(function (r) { return r.length >= MIN_SAY_HAN; });
  }

  // 这一句本身够不够当一关里的例句：它自己得先过 saidRuns 那道门槛。
  function passable(text) {
    return saidRuns(text).length > 0;
  }

  // 判一条作答。返回 { ok, why, row }：
  //   ok —— 算不算过关；why —— ok / empty / short / nochar / notfound
  //   row —— 命中的那一条句（有的话，用来回显「在合集里对上了：……」）
  function judgeSetLine(o) {
    var opt = o || {};
    var chars = (opt.chars || [opt.char]).filter(Boolean).map(String);
    var said = String(opt.said == null ? "" : opt.said).trim();
    if (!said) return { ok: false, why: "empty" };

    var runs = saidRuns(said);
    if (!runs.length) return { ok: false, why: "short" };

    var scored = runs.filter(function (r) {
      return chars.some(function (c) { return r.indexOf(c) >= 0; });
    });
    if (!scored.length) return { ok: false, why: "nochar" };

    var rows = lines(opt.poems);
    // 整句照抄优先：语料里那一句去掉标点后与作答完全一致，先认这一条。
    var exact = null;
    var partial = null;
    rows.forEach(function (r) {
      if (exact && partial) return;
      var have = hanRuns(r.text);
      var joined = have.join("");
      if (joined === runs.join("")) exact = exact || r;
      // 只写了一段：那一段必须是语料里**连着**的一段（不是跨句拼出来的）。
      if (!partial) {
        for (var i = 0; i < scored.length && !partial; i += 1) {
          if (have.indexOf(scored[i]) >= 0) partial = r;
        }
      }
    });

    var row = exact || partial;
    if (!row) return { ok: false, why: "notfound" };
    return { ok: true, why: "ok", row: row };
  }

  // 关卡：一关 = 一个令字。每个令字给出「够写几行」的储备（语料里带它的句数），
  // 取法完全照抄 pickChars 的种子写法（令字 + 池长 + 轮次），
  // 所以同一个范围同一轮，前后端算出来的关卡是同一关。
  function levelChars(poems, o) {
    var opt = o || {};
    var rows = lines(poems);
    var chars = (opt.chars || []).filter(Boolean).map(String);
    var per = Math.max(1, Number(opt.per == null ? 1 : opt.per));
    var min = Math.max(1, Number(opt.min == null ? 3 : opt.min));
    var seed = String(opt.seed == null ? "" : opt.seed);

    var picks = [];
    var level = 0;
    chars.forEach(function (c, ci) {
      if (picks.length >= per) return;
      var hit = rows.filter(function (r) {
        return r.text.indexOf(c) >= 0 && passable(r.text);
      });
      if (hit.length < min) return;
      // 同一关内的句子也要有次序：按「句子短 → 长」摆，先短后长，
      // 让用户一关比一关有底气，而不是一上来就撞上最长的两句。
      var pool = hit.slice().sort(function (a, b) {
        return a.text.length - b.text.length || (a.id < b.id ? -1 : 1);
      });
      // 逐关错开起点，免得每次进闯关第一关都是同一句。
      var off = pool.length ? (ci + seed.length) % pool.length : 0;
      pool = pool.slice(off).concat(pool.slice(0, off));
      picks.push({ char: c, at: level, pool: pool.map(function (r) { return r.text; }) });
      level += 1;
    });
    return {
      levels: picks.map(function (p) {
        return { char: p.char, at: p.at, pool: p.pool };
      }),
      chars: picks.map(function (p) { return p.char; })
    };
  }

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
    judgeSetLine: judgeSetLine,
    passable: passable,
    levelChars: levelChars,
    sourceOf: sourceOf
  };
});
