/* ==========================================================================
   生卒 → 排序年（历代名家 · 按出生时间排）
   --------------------------------------------------------------------------
   用户原话（Issue #381）：「所有类别的名家按出生时间顺序排序。」

   输入是主表正文里「生卒」那一行的字符串，形状有二十来种（见
   scripts/build-mingren.js 的统计），这里只做一件事：给一个 **可比较的
   数值键**（生年）。生年无从考时退到卒年、再退到世纪 / 活动年代的粗估，
   保证「古人在前、今人在后」这个大半不错，且同一批数据每次算出来一样。

   返回 { year, approximate }：
     · year        排序键（公元前为负，公元前 100 = -100；世纪粗估也折成负）
     · approximate true 表示生年不详、由卒年或世纪推得
   ========================================================================== */
'use strict';

/* 全角 / 半角数字一视同仁；「前」表示公元前 */
const CN = { '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4,
  '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };

function cnToNum(s) {
  s = String(s);
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (!s) return null;
  if (s === '十') return 10;
  let m = s.match(/^(.)?十(.)?$/);
  if (m) {
    const a = m[1] ? CN[m[1]] : 1;
    const b = m[2] ? CN[m[2]] : 0;
    return a * 10 + b;
  }
  if (CN[s] != null) return CN[s];
  return null;
}

/* 把一个「年」片段变成带符号的数：前 100 → -100；14 → 14；世纪折中点 */
function yearOf(frag, sign) {
  frag = String(frag || '');
  const century = frag.match(/^([一二三四五六七八九十]|\d+)\s*世纪/);
  if (century) {
    const n = cnToNum(century[1]);
    if (n == null) return null;
    // 「约前 6 世纪」≈ 前 600—前 501，取中点前 550；「13 世纪末」≈ 1270
    let base = (n - 1) * 100 + 50;
    if (/末/.test(frag)) base = (n - 1) * 100 + 70;
    else if (/初/.test(frag)) base = (n - 1) * 100 + 20;
    return sign < 0 ? -base : base;
  }
  const y = frag.match(/(\d{1,4})/);
  if (!y) return null;
  const n = parseInt(y[1], 10);
  return sign < 0 ? -n : n;
}

/* 抽出所有「[约]?[前]?年号」片段及符号 */
function scanYears(s) {
  const out = [];
  const re = /(约\s*)?(前\s*)?([一二三四五六七八九十]+世纪|\d{1,4}\s*世纪|\d{1,4})(?:\s*[年]?)/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const sign = m[2] ? -1 : 1;
    const v = yearOf(m[3], sign);
    if (v != null) out.push({ v: v, approx: !!m[1] });
  }
  return out;
}

function birthYearOf(life) {
  const t = String(life == null ? '' : life).trim();
  if (!t) return { year: null, approximate: true };
  /* 去掉括注里的「一说」「有争议」这类，保留主体 */
  const main = t.split(/（|\(/)[0].trim() || t;

  /* 主体里取第一段作为「生」，若主体只有一段（？—前 178）则生年不详 */
  const dash = main.split(/[—–\-~～]/);
  const living = /生卒不详|生卒年不详|生平不详|不详|无确考/.test(t);
  const hasQ = /[?？]/.test(main);

  /* ① 主体有「生—卒」两段：第一段即生年 */
  if (dash.length >= 2 && !hasQ) {
    const ys = scanYears(dash[0]);
    if (ys.length) return { year: ys[0].v, approximate: /约/.test(t) || living };
  }
  /* ② 生年不详（？—前 178 / 生卒不详（约前 6 世纪））：用卒年往回推 */
  const all = scanYears(t);
  if (all.length) {
    // 「约前 6 世纪」这种在 t 里只有一段，scanYears 得一个 → 直接用它当生年粗估
    if (all.length === 1 && dash.length < 2) {
      return { year: all[0].v, approximate: true };
    }
    // 取第二段作卒年，往回推 60 年（古人活动期粗估）
    const death = all[all.length - 1].v;
    return { year: death - 60, approximate: true };
  }
  return { year: null, approximate: true };
}

/* 组内排序比较器：生年在前的靠前；算不出的一律沉底（稳定保持原次序） */
function compareBirth(a, b) {
  const ya = a.year, yb = b.year;
  if (ya == null && yb == null) return 0;
  if (ya == null) return 1;
  if (yb == null) return -1;
  return ya - yb;
}

module.exports = { birthYearOf: birthYearOf, compareBirth: compareBirth };
