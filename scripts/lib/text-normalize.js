/* ==========================================================================
   正文素材的「清洗」小工具
   --------------------------------------------------------------------------
   Issue #381 · 用户原话：

     「我发现 基督山伯爵 文章里有一些句子重复，例如
       这一段是全书的骨。这一段是全书的骨
       不止一处重复，请查看所有文章是否有类似问题
       而有很多文章 不能换行，显示 \n」

   两处都是**素材写坏了**，不是显示层的问题，所以在装配前统一洗一遍：
   洗在 build-mingshu.js 里 —— 往后再添素材，写歪了也会当场洗掉。

   ## 一、重复句
   素材里出现过这种写法（多半是「先写一句，再补一句带冒号的解释」时
   把前一句漏成了两句）：

     主线……成为基督山伯爵。这一段是全书的骨。这一段是全书的骨：一章一个转身……

   人读起来就是同一句话说两遍。判据要窄 —— 只抓「紧挨着的两句，后一句
   以同一串字开头」，且后面多出来的是「：」「，」这类引出语气的标点。
   修辞性的复沓（如「呜呼哀哉！」连用、名句里的叠句）不是紧挨着的
   同文重复，不会被误伤。

   ## 二、字面 \n
   素材里的 `lines` 等字段误写成了 `\\n`（反斜杠 + n，两个字符），
   渲染层按真换行 `\n` 切段，于是页面上原样显示出「\n」。统一换回真换行。
   ========================================================================== */
'use strict';

/* 把字面「\n」（反斜杠 + n）换成真换行。已经是真的换行不动。 */
function fixLiteralNewlines(s) {
  return String(s == null ? '' : s).replace(/\\n/g, '\n').replace(/\\r/g, '\r');
}

/* 去掉「紧挨着、后句以同串开头」的机械重复。
   只在**同一段内**判定，且要后句多出「：，；。」里的一个 —— 保守，
   免得把名句里的叠句当重复删掉。 */
function dedupeSentences(s) {
  let t = String(s == null ? '' : s);
  /* 按「。！？」断句，保留标点；空串与其他分隔符（\n、——）不参与配对。 */
  let prev = true;
  while (prev) {
    prev = false;
    const m = t.split(/(?<=[。！？])/);
    for (let i = 0; i < m.length - 1; i++) {
      const a = m[i].trim();
      const b = m[i + 1].trim();
      if (!a || !b) continue;
      if (a[0] === '／' || b[0] === '／') continue;   // 名句引用行，不动
      const core = a.replace(/[。！？]$/, '');
      if (core.length < 8) continue;
      if (!b.startsWith(core)) continue;
      const rest = b.slice(core.length);
      if (rest === '' || '：，。；'.indexOf(rest[0]) >= 0) {
        /* 把前一句（重复的那句）连它的标点一起删掉 */
        const idx = t.indexOf(m[i]);
        if (idx < 0) continue;
        t = t.slice(0, idx) + t.slice(idx + m[i].length);
        prev = true;
        break;
      }
    }
  }
  return t;
}

/* 一条素材的整体清洗：先修换行，再去重复。 */
function clean(s) {
  return dedupeSentences(fixLiteralNewlines(s));
}

/* 就地洗一份 spec（不改原对象，返回新对象）。 */
function cleanSpec(spec) {
  const out = {};
  Object.keys(spec || {}).forEach(function (k) {
    const v = spec[k];
    if (typeof v === 'string') out[k] = clean(v);
    else if (Array.isArray(v)) out[k] = v.map(function (x) {
      return Array.isArray(x) ? x.map(clean) : (typeof x === 'string' ? clean(x) : x);
    });
    else if (v && typeof v === 'object') {
      const o = {};
      Object.keys(v).forEach(function (k2) { o[k2] = clean(v[k2]); });
      out[k] = o;
    } else out[k] = v;
  });
  return out;
}

module.exports = {
  fixLiteralNewlines: fixLiteralNewlines,
  dedupeSentences: dedupeSentences,
  clean: clean,
  cleanSpec: cleanSpec
};
