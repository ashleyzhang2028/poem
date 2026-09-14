/**
 * 生字注音
 * ---------------------------------------------------
 * 目标：小朋友遇到「媪、杵、鹄、巍」这类字不用停下来问大人。
 *
 * 两档模式（由调用方传入 mode）：
 * 1. "rare"（默认）—— 只标生字。常见字不注音，页面清爽，
 *    真正陌生的字才有拼音，符合「生僻字只标生字」的诉求。
 * 2. "all" —— 全文逐字注音。给刚识字、需要全量辅助的小朋友。
 *
 * 设计取舍：
 * 1. 不引入任何运行时第三方库。拼音表 data/pinyin-table.js 是构建期
 *    用 pinyin-pro 离线生成的，覆盖课内 261 首 + 课外 100 篇里的全部汉字；
 *    常用字表 data/common-chars.js 是构建期用 jieba 字频表导出的前 2500 字，
 *    表外即视为生字。两份表都是只读数据，运行时不联网、不依赖 CDN。
 * 2. 两档都是「要么全标、要么只标生字」，不做逐字随机掺半，
 *    避免孩子看到半注音半不注音的排版产生困惑。
 * 3. 多音字按上下文判定：
 *    - 先取该字在词语里的读音（内置一份常用词的读音表）
 *    - 其次看它在句中的位置与邻居（如「不」在去声前读 bú）
 *    - 都判定不了时取第一读音（也是现代最常用读音）
 */
(function () {
  "use strict";

  const TABLE = window.PINYIN_TABLE || {};
  // 常用字表：命中即「小朋友已认识」，只标生字模式下跳过注音
  const COMMON = window.COMMON_CHARS || {};

  // 去声声调符号（à 等）用于「不」「一」的变调判断
  const TONE4 = /[àèìòùǜ]/;

  /**
   * 上下文词组读音表：key 为词，value 为逐字读音数组。
   * 只收录真正的多音字词组，覆盖不到时按下面的规则/首读音兜底。
   */
  const WORDS = {
    // 常见古诗文多音字
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

  /** 取单字读音列表（多音字按 / 分割） */
  function readings(ch) {
    const raw = TABLE[ch];
    return raw ? raw.split("/") : [];
  }

  /** 是否为汉字 */
  function isHan(ch) {
    return /\p{Script=Han}/u.test(ch);
  }

  /**
   * 上下文判定多音字读音。
   * @param {string} ch   当前字
   * @param {string} text 全文
   * @param {number} i    当前字下标（按码点计）
   * @returns {string}
   */
  function readOf(ch, text, i) {
    const list = readings(ch);
    if (!list.length) return "";
    if (list.length === 1) return list[0];

    // 1) 词语表命中
    //    注意：「一」「不」的声调由变调规则统一裁决，词表命中也要再校正一次，
    //    否则会把「一片」写成 yī piàn 这类错调。
    const hit = wordAt(text, i);
    if (hit && ch !== "一" && ch !== "不") return hit;

    // 2) 「不 / 一」的变调（邻字按实际读音判定声调，不能只看首读音）
    const next = text[i + 1];
    if (ch === "不") {
      // 「不」本调 bù，后面跟去声时变 bú
      return next && isTone4(next, text, i + 1) ? pickTone(list, 2) : pickTone(list, 4);
    }
    if (ch === "一") {
      // 「一」本调 yī：去声前读 yí，阴平/阳平/上声前读 yì，序数/词尾仍读 yī
      if (!next || !isHan(next)) return pickTone(list, 1);
      if (isOrdinal(text, i)) return pickTone(list, 1);
      return isTone4(next, text, i + 1) ? pickTone(list, 2) : pickTone(list, 4);
    }

    // 3) 兜底：现代最常用读音（第一个）
    return list[0];
  }

  /** 声调符号表：按调号取拼音里的声调 */
  const TONE_MARK = { 1: /[āēīōūǖ]/, 2: /[áéíóúǘ]/, 3: /[ǎěǐǒǔǚ]/, 4: /[àèìòùǜ]/ };

  /**
   * 邻字是否为去声。
   * 取该字在本句中的**实际读音**判调，避免「一」+「行(háng)」这类被首读音误导。
   */
  function isTone4(ch, text, i) {
    const p = readOf(ch, text, i);
    if (!p) return false;
    if (TONE_MARK[4].test(p)) return true;
    // 多音候选里只要有一个去声读音，且当前读音也含轻声/无调号时，倾向判为去声
    return false;
  }

  /** 从候选读音里按调号挑选，挑不到就退回首读音 */
  function pickTone(list, tone) {
    const re = TONE_MARK[tone];
    if (re) {
      for (let i = 0; i < list.length; i++) if (re.test(list[i])) return list[i];
    }
    return list[0];
  }

  /**
   * 「一」是否读本调 yī（序数、概数开头、或「一」在词尾）。
   * 覆盖：一年级 / 一更 / 第一 / 一九 / 一、二等序数用法。
   */
  function isOrdinal(text, i) {
    const arr = Array.from(text);
    const prev = arr[i - 1];
    const next = arr[i + 1];
    const nnext = arr[i + 2];
    // 前接「第、初、十、百、千、万」等序数前缀 → 本调
    if (prev && /[第初十百千万]/.test(prev)) return true;
    // 后面跟数字（如「一二」「一九」「一二三」）→ 本调
    if (next && /[二三四五六七八九十百千万零两]/.test(next)) return true;
    // 「一 + 量词/名词」但整体为序数或计数单位（一年级、一九年、一小时）→ 本调
    // 判定：后一个字本身是数词单位，或再往后仍是数字（如「一 年 级」中的「级」）
    if (next && /[年月日班級级单元课课节册卷份号条只张本]/.test(next)) {
      // 「一年好景」这类不表示序数，靠后字是否为量词性结尾进一步区分：
      // 「一年级 / 一九年 / 一小时」后紧邻字为量词或数字时判本调
      if (nnext && /[级級班单元课节册卷班]/.test(nnext)) return true;
      if (nnext && /[二三四五六七八九十百千万零两]/.test(nnext)) return true;
    }
    return false;
  }

  /** 尝试在 i 处匹配词语表，返回当前字的读音 */
  function wordAt(text, i) {
    const keys = Object.keys(WORDS);
    for (let k = 0; k < keys.length; k++) {
      const w = keys[k];
      const arr = Array.from(w);
      // 词可能出现在当前位置之前（当前字在词中间），因此从 word 的每个偏移都试一次
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

  /** 是否为常见字（常用字表 2500 字内） */
  function isCommon(ch) {
    return !!COMMON[ch];
  }

  /**
   * 该字在「只标生字」模式下是否需要注音。
   *
   * 生字 = 有拼音可查，且满足下面任一条：
   *   1. 不在常用字表内（真生字，如「锄、餐、瑶」）
   *   2. 是多音字（如「曲、还、间、行、少」）—— 小朋友最容易读错，
   *      在常用字表里也照样要标，否则「只标生字」档会把它们全静音
   */
  function needAnnotate(ch) {
    if (!readings(ch).length) return false;
    return !isCommon(ch) || isPolyphone(ch);
  }

  /** 是否为多音字（拼音表里含 / 分隔的多个读音） */
  function isPolyphone(ch) {
    return readings(ch).length > 1;
  }

  /**
   * 逐字注音，返回 HTML 片段。
   * 非汉字字符原样输出，换行用 <br> 保留。
   *
   * @param {string} text 正文
   * @param {string} [mode] "rare" 只标生字（默认）｜"all" 全文注音
   */
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
      // 「只标生字」档统一走 needAnnotate：生字 + 多音字，避免整首静音
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

  /**
   * 只给出需要注音的字（去重），按出现顺序。
   * 供测试校验与「本篇生字」速览使用。
   */
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

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /** 纯文本形式：给出读音，便于测试与朗读。默认只标生字，传 "all" 则全文 */
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

  /** 某字的读音（对外暴露，供测试与朗读使用） */
  function read(ch) {
    const l = readings(ch);
    return l.length ? l[0] : "";
  }

  window.Pinyin = {
    annotateHtml: annotateHtml,
    annotateText: annotateText,
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
