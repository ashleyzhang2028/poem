'use strict';
/* 帝王「中国」· 生平与六维评价总装
   把 emperor-cn-facts.js 与 facts-a/b/c/d.js 合成一张「皇号 → 七段」的表。 */
const { FACTS_CN_1 } = require('./emperor-cn-facts.js');
const { FACTS_A } = require('./facts-a.js');
const { FACTS_B } = require('./facts-b.js');
const { FACTS_C } = require('./facts-c.js');
const { FACTS_D } = require('./facts-d.js');
const { FACTS_FOREIGN } = require('./facts-foreign.js');

const NOTE = {};
[FACTS_CN_1, FACTS_A, FACTS_B, FACTS_C, FACTS_D, FACTS_FOREIGN].forEach(function (m) {
  Object.keys(m).forEach(function (k) {
    if (NOTE[k]) throw new Error('六维素材重复：' + k);
    NOTE[k] = m[k];
  });
});
module.exports = { NOTE: NOTE };
