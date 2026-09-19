(function () {
  "use strict";

  const TABLE = window.PINYIN_TABLE || {};

  const COMMON = window.COMMON_CHARS || {};

  const TONE4 = /[àèìòùǜ]/;

  const WORDS = {

    "曲项": ["qū", "xiàng"],
    "绿水": ["lǜ", "shuǐ"],
    "荷叶": ["hé", "yè"],
    "莲叶": ["lián", "yè"],
    "叶公": ["shè", "gōng"],
    "间关": ["jiān", "guān"],
    "中间": ["zhōng", "jiān"],
    "之间": ["zhī", "jiān"],
    "还家": ["huán", "jiā"],
    "还有": ["hái", "yǒu"],
    "还是": ["hái", "shì"],
    "当午": ["dāng", "wǔ"],
    "当日": ["dāng", "rì"],
    "汗滴": ["hàn", "dī"],
    "盘中": ["pán", "zhōng"],
    "中庭": ["zhōng", "tíng"],
    "少小": ["shào", "xiǎo"],
    "多少": ["duō", "shǎo"],
    "少年": ["shào", "nián"],
    "少时": ["shào", "shí"],
    "行行": ["háng", "háng"],
    "道行": ["dào", "háng"],
    "银台": ["yín", "tái"],
    "台阁": ["tái", "gé"],
    "处处": ["chù", "chù"],
    "处士": ["chǔ", "shì"],
    "处理": ["chǔ", "lǐ"],
    "相处": ["xiāng", "chǔ"],
    "长啸": ["cháng", "xiào"],
    // 「长天」是《滕王阁序》「秋水共长天一色」那一处（Issue #243 用户点名）。
    // 词表是**通例**：补上它之后那一句在全站各处都对，而不只是那一篇；
    // 勘误层（js/pinyin-edit.js）管的是词表没料到的**个例**，两者不冲突。
    "长天": ["cháng", "tiān"],
    "长空": ["cháng", "kōng"],
    "长大": ["zhǎng", "dà"],
    "长得": ["zhǎng", "de"],
    "长相思": ["cháng", "xiāng", "sī"],
    "相思": ["xiāng", "sī"],
    "相看": ["xiāng", "kàn"],
    "相国": ["xiàng", "guó"],
    "应怜": ["yīng", "lián"],
    "应当": ["yīng", "dāng"],
    "应声": ["yìng", "shēng"],
    "答应": ["dā", "ying"],
    "为学": ["wéi", "xué"],
    "为人": ["wéi", "rén"],
    "为何": ["wèi", "hé"],
    "以为": ["yǐ", "wéi"],
    "因为": ["yīn", "wèi"],
    "重山": ["chóng", "shān"],
    "重复": ["chóng", "fù"],
    "重要": ["zhòng", "yào"],
    "万重": ["wàn", "chóng"],
    "燕山": ["yān", "shān"],
    "燕子": ["yàn", "zi"],
    "种豆": ["zhòng", "dòu"],
    "种子": ["zhǒng", "zi"],
    "一行": ["yī", "háng"],
    "挑促织": ["tiǎo", "cù", "zhī"],
    "挑灯": ["tiǎo", "dēng"],
    "好景": ["hǎo", "jǐng"],
    "好学": ["hào", "xué"],
    "好之": ["hào", "zhī"],
    "降于": ["jiàng", "yú"],
    "投降": ["tóu", "xiáng"],
    "乐山": ["yào", "shān"],
    "乐水": ["yào", "shuǐ"],
    "知者乐水": ["zhī", "zhě", "yào", "shuǐ"],
    "鲜有": ["xiǎn", "yǒu"],
    "鲜活": ["xiān", "huó"],
    "薄雾": ["bó", "wù"],
    "薄暮": ["bó", "mù"],
    "刻薄": ["kè", "bó"],
    "载重": ["zài", "zhòng"],
    "载入": ["zài", "rù"],
    "记载": ["jì", "zǎi"],
    "三年五载": ["sān", "nián", "wǔ", "zǎi"],
    "边塞": ["biān", "sài"],
    "塞外": ["sài", "wài"],
    "舍去": ["shě", "qù"],
    "屋舍": ["wū", "shè"],
    "参差": ["cēn", "cī"],
    "差池": ["cī", "chí"],
    "佛印": ["fó", "yìn"],
    "仿佛": ["fǎng", "fú"],
    "着地": ["zhuó", "dì"],
    "着力": ["zhuó", "lì"],
    "兴尽": ["xìng", "jìn"],
    "兴起": ["xīng", "qǐ"],
    "号呼": ["háo", "hū"],
    "号叫": ["háo", "jiào"],
    "号称": ["hào", "chēng"],
    "汤汤": ["shāng", "shāng"],
    "省亲": ["xǐng", "qīn"],
    "反省": ["fǎn", "xǐng"],
    "卷起": ["juǎn", "qǐ"],
    "卷帙": ["juàn", "zhì"],
    "手卷": ["shǒu", "juàn"],
    "脉搏": ["mài", "bó"],
    "脉脉": ["mò", "mò"],
    "宁可": ["nìng", "kě"],
    "宁死": ["nìng", "sǐ"],
    "安宁": ["ān", "níng"],
    "遗民": ["yí", "mín"],
    "遗之": ["wèi", "zhī"],
    "缥缈": ["piāo", "miǎo"],
    "发了": ["fā", "le"],
    "白发": ["bái", "fà"],
    "头发": ["tóu", "fa"],
    "云鬓": ["yún", "bìn"],
    "数重": ["shù", "chóng"],
    "数枝": ["shù", "zhī"],
    "可汗": ["kè", "hán"],
    "但使": ["dàn", "shǐ"],
    "度日": ["dù", "rì"],
    "扁舟": ["piān", "zhōu"],
    "小舟": ["xiǎo", "zhōu"],
    "恰好": ["qià", "hǎo"]
  };

  function readings(ch) {
    const raw = TABLE[ch];
    return raw ? raw.split("/") : [];
  }

  function isHan(ch) {
    return /\p{Script=Han}/u.test(ch);
  }

  // ---------------------------------------------------------------------------
  // 注音勘误层（Issue #243 · 《滕王阁序》「秋水共长天一色」的「长」）
  // ---------------------------------------------------------------------------
  // 上面那两个读音来源（表 + 词表）都是**通例**：表给一个字几个读音，词表
  // 给几个常见的词。可古文里总有表里没有、词表也想不到的组合（「长天」就是
  // 一个），逐词去补是补不完的，而且改一次要发一次版。
  //
  // 所以在这一层之上加一张**勘误表**（js/pinyin-edit.js，可在管理页面增删）：
  // 「某一篇 · 某一句 · 第几个字 → 读什么」。它只在一个前提下参与 ——
  // 调用方用 `begin()` 声明「现在注的是哪一篇、哪一句」，否则一行都不查。
  //
  //   · 只有**多音字**才查勘误：单音字本来就没错可勘（勘误表里也存不下
  //     第二个读音，硬改等于制造新错）。
  //   · 勘误**优先于词表**：有人当面核对过的那一处，比通用规则可信。
  //   · 勘误是「某篇某句第 N 个字」，不是「全文替换这个字」——
  //     「长」在《滕王阁序》里出现好几次，各读各的。

  var FIX_WID = "";
  var FIX_LINE = "";
  var FIX_MAP = null;

  function fixStore() {
    return typeof window !== "undefined" && window.PinyinFix ? window.PinyinFix : null;
  }

  // 声明「接下来这一句属于哪一篇」——`line` 为空即关闭勘误（默认状态）。
  function begin(wid, line) {
    FIX_WID = String(wid == null ? "" : wid);
    FIX_LINE = String(line == null ? "" : line).trim();
    FIX_MAP = null;
    if (!FIX_WID || !FIX_LINE) return;
    var F = fixStore();
    if (!F || typeof F.mapOf !== "function") return;
    try { FIX_MAP = F.mapOf(FIX_WID) || null; } catch (e) { FIX_MAP = null; }
  }

  function end() { begin("", ""); }

  // 这一句里第 i 个字符是同一个字的第几次出现（「长洲」与「长天」要靠它分开）。
  // 传进来的 `chars` 是**整句**的字符数组（不是整篇），所以下标从 0 起算。
  function nthIn(chars, i) {
    var ch = chars[i];
    var n = 0;
    for (var k = 0; k <= i; k++) if (chars[k] === ch) n++;
    return n;
  }

  function fixAt(ch, chars, i) {
    if (!FIX_MAP || !FIX_LINE) return "";
    if (!isPolyphone(ch)) return "";
    var key = FIX_LINE + "\u0000" + nthIn(chars, i);
    var v = FIX_MAP[key];
    return v ? String(v) : "";
  }

  function readOf(ch, text, i) {
    const list = readings(ch);
    if (!list.length) return "";
    if (list.length === 1) return list[0];

    // 勘误层（只在这一段被 begin() 声明过某篇某句时才可能命中）。
    const fixed = fixAt(ch, text, i);
    if (fixed) return fixed;

    const hit = wordAt(text, i);
    if (hit && ch !== "一" && ch !== "不") return hit;

    const next = text[i + 1];
    if (ch === "不") {

      return next && isTone4(next, text, i + 1) ? pickTone(list, 2) : pickTone(list, 4);
    }
    if (ch === "一") {

      if (!next || !isHan(next)) return pickTone(list, 1);
      if (isOrdinal(text, i)) return pickTone(list, 1);
      return isTone4(next, text, i + 1) ? pickTone(list, 2) : pickTone(list, 4);
    }

    return list[0];
  }

  const TONE_MARK = { 1: /[āēīōūǖ]/, 2: /[áéíóúǘ]/, 3: /[ǎěǐǒǔǚ]/, 4: /[àèìòùǜ]/ };

  function isTone4(ch, text, i) {
    const p = readOf(ch, text, i);
    if (!p) return false;
    if (TONE_MARK[4].test(p)) return true;

    return false;
  }

  function pickTone(list, tone) {
    const re = TONE_MARK[tone];
    if (re) {
      for (let i = 0; i < list.length; i++) if (re.test(list[i])) return list[i];
    }
    return list[0];
  }

  function isOrdinal(text, i) {
    const arr = Array.from(text);
    const prev = arr[i - 1];
    const next = arr[i + 1];
    const nnext = arr[i + 2];

    if (prev && /[第初十百千万]/.test(prev)) return true;

    if (next && /[二三四五六七八九十百千万零两]/.test(next)) return true;

    if (next && /[年月日班級级单元课课节册卷份号条只张本]/.test(next)) {

      if (nnext && /[级級班单元课节册卷班]/.test(nnext)) return true;
      if (nnext && /[二三四五六七八九十百千万零两]/.test(nnext)) return true;
    }
    return false;
  }

  function wordAt(text, i) {
    const keys = Object.keys(WORDS);
    for (let k = 0; k < keys.length; k++) {
      const w = keys[k];
      const arr = Array.from(w);

      for (let off = 0; off < arr.length; off++) {
        const start = i - off;
        if (start < 0) continue;
        let ok = true;
        for (let j = 0; j < arr.length; j++) {
          if (text[start + j] !== arr[j]) {
            ok = false;
            break;
          }
        }
        if (ok) return WORDS[w][off];
      }
    }
    return "";
  }

  function isCommon(ch) {
    return !!COMMON[ch];
  }

  function needAnnotate(ch) {
    if (!readings(ch).length) return false;
    return !isCommon(ch) || isPolyphone(ch);
  }

  function isPolyphone(ch) {
    return readings(ch).length > 1;
  }

  function annotateHtml(text, mode) {
    const rare = (mode || "rare") !== "all";
    const src = String(text == null ? "" : text);
    const chars = Array.from(src);
    let out = "";
    chars.forEach(function (ch, i) {
      if (!isHan(ch)) {
        out += ch === "\n" ? "<br>" : escapeHtml(ch);
        return;
      }

      if (rare && !needAnnotate(ch)) {
        out += escapeHtml(ch);
        return;
      }
      const p = readOf(ch, chars, i);
      if (!p) {
        out += escapeHtml(ch);
        return;
      }
      out += "<ruby>" + escapeHtml(ch) + "<rt>" + escapeHtml(p) + "</rt></ruby>";
    });
    return out;
  }

  function rareChars(text) {
    const seen = Object.create(null);
    const list = [];
    Array.from(String(text == null ? "" : text)).forEach(function (ch) {
      if (!isHan(ch) || seen[ch] || !needAnnotate(ch)) return;
      seen[ch] = 1;
      list.push(ch);
    });
    return list;
  }

  // 一篇的整体注音（**这是给页面用的那一个**）。
  //
  // 它比 annotateHtml 多做一件事：**逐句**声明「这一段属于哪一篇」，
  // 让勘误层有机会命中。分句的判据就是换行 —— 正文里本来就一行一句
  // （data/poems-*.js 的 text 用 \n 分行），所以行号与勘误表里存的那一句
  // 是同一个东西，不需要再猜标点。
  //
  // 不传 wid 时（或勘误表为空时）行为与 annotateHtml **逐字相同**：
  // 老调用点不改也不会变样。
  function annotatePoem(wid, text, mode) {
    const src = String(text == null ? "" : text);
    const w = String(wid == null ? "" : wid);
    const F = fixStore();
    const on = !!w && !!F && typeof F.mapOf === "function";
    const lines = src.split("\n");
    const out = lines.map(function (line) {
      if (!on) return annotateHtml(line, mode);
      begin(w, line.trim());
      try { return annotateHtml(line, mode); } finally { FIX_MAP = null; }
    });
    return out.join("<br>");
  }

  // 逐句注音（纯文本那一档，如打印稿）。同一套勘误，共用同一份分句逻辑。
  function annotatePoemText(wid, text, mode) {
    const src = String(text == null ? "" : text);
    const w = String(wid == null ? "" : wid);
    const F = fixStore();
    const on = !!w && !!F && typeof F.mapOf === "function";
    return src.split("\n").map(function (line) {
      if (!on) return annotateText(line, mode);
      begin(w, line.trim());
      try { return annotateText(line, mode); } finally { FIX_MAP = null; }
    }).join("\n");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function annotateText(text, mode) {
    const rare = (mode || "rare") !== "all";
    const src = String(text == null ? "" : text);
    const chars = Array.from(src);
    return chars.map(function (ch, i) {
      if (!isHan(ch)) return ch;
      if (rare && !needAnnotate(ch)) return ch;
      return ch + "(" + (readOf(ch, chars, i) || "") + ")";
    });
  }

  function read(ch) {
    const l = readings(ch);
    return l.length ? l[0] : "";
  }

  window.Pinyin = {
    annotateHtml: annotateHtml,
    annotateText: annotateText,
    annotatePoem: annotatePoem,
    annotatePoemText: annotatePoemText,
    begin: begin,
    end: end,
    rareChars: rareChars,
    isCommon: isCommon,
    needAnnotate: needAnnotate,
    isPolyphone: isPolyphone,
    readOf: function (ch, text, i) { return readOf(ch, text || ch, i || 0); },
    read: read,
    has: function (ch) { return !!TABLE[ch]; },
    size: function () { return Object.keys(TABLE).length; },
    commonSize: function () { return Object.keys(COMMON).length; },
    isHan: isHan
  };
})();
