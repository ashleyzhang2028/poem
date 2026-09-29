'use strict';
/* ==========================================================================
   历代名家 · 正文素材总装
   --------------------------------------------------------------------------
   Issue #381 第四轮。把四份数据合成「一位名家一条素材」：

     mingren-legacy.js     已上线的 135 位（id 台账，扩表时不许动号）
     mingren-rows-cn.js    中国部分：姓名 / 时代 / 一句话 + 字 / 生卒 / 籍贯 / 家世
     mingren-rows-world.js 外国部分：同上（按学科分组）
     mingren-text-cn*.js   中国部分的余下五段（生平 / 风格 / 流派 / 作品 / 意义）
     mingren-text-world*.js 外国部分同上

   装配时对每一位**逐字段查缺**：五个正文字段少一个就报错点名，
   不静默生成一条半成品（「列表里有、点进去空白」是上一轮明确要避免的）。
   ========================================================================== */
'use strict';

const { LEGACY } = require('./mingren-legacy.js');
const { CN_ROWS } = require('./mingren-rows-cn.js');
const { WORLD_ROWS } = require('./mingren-rows-world.js');
const { CN_TEXT_1 } = require('./mingren-text-cn.js');
const { CN_TEXT_2 } = require('./mingren-text-cn2.js');
const { CN_TEXT_3 } = require('./mingren-text-cn3.js');
const { CN_TEXT_4 } = require('./mingren-text-cn4.js');
const { CN_TEXT_5 } = require('./mingren-text-cn5.js');
const { CN_TEXT_6 } = require('./mingren-text-cn6.js');
const { CN_TEXT_7 } = require('./mingren-text-cn7.js');
const { CN_TEXT_8 } = require('./mingren-text-cn8.js');
const { WORLD_TEXT_1 } = require('./mingren-text-world1.js');
const { WORLD_TEXT_2 } = require('./mingren-text-world2.js');
const { WORLD_TEXT_3 } = require('./mingren-text-world3.js');
const { WORLD_TEXT_4 } = require('./mingren-text-world4.js');

const TEXT = {};
[CN_TEXT_1, CN_TEXT_2, CN_TEXT_3, CN_TEXT_4, CN_TEXT_5, CN_TEXT_6, CN_TEXT_7, CN_TEXT_8,
  WORLD_TEXT_1, WORLD_TEXT_2, WORLD_TEXT_3, WORLD_TEXT_4].forEach(function (m) {
  Object.keys(m).forEach(function (k) { TEXT[k] = m[k]; });
});

const LEGACY_SET = {};
LEGACY.forEach(function (r) { LEGACY_SET[r[2]] = r[0]; });

/** 一位名家的完整素材：{ name, era, tag, fields: {zi, life, ...} } */
const PEOPLE = [];

function push(name, era, tag, small, fromWorld) {
  if (LEGACY_SET[name]) return; // 已上线的，id 与正文都不动
  const t = TEXT[name];
  if (!t) return { name: name, why: '正文素材缺' };
  const miss = ['bio', 'style', 'school', 'works', 'worth'].filter(function (k) { return !t[k]; });
  if (miss.length) return { name: name, why: '正文缺 ' + miss.join('/') };
  if (!small.zi || !small.life || !small.origin || !small.family) {
    return { name: name, why: '小字段缺' };
  }
  PEOPLE.push({
    name: name, era: era, tag: tag, world: !!fromWorld,
    zi: small.zi, life: small.life, origin: small.origin, family: small.family,
    bio: t.bio, style: t.style, school: t.school, works: t.works, worth: t.worth
  });
  return null;
}

const MISSING = [];
CN_ROWS.forEach(function (r) {
  const bad = push(r[0], r[1], r[2], r[3], false);
  if (bad) MISSING.push(bad.name + '（' + bad.why + '）');
});
WORLD_ROWS.forEach(function (r) {
  const bad = push(r[0], r[1], r[2], r[3], true);
  if (bad) MISSING.push(bad.name + '（' + bad.why + '）');
});

module.exports = { PEOPLE: PEOPLE, MISSING: MISSING, LEGACY: LEGACY, LEGACY_SET: LEGACY_SET };
