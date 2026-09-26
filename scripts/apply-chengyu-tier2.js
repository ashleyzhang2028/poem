#!/usr/bin/env node
/* 把「第二至五档 · 补齐成语集缺的那几类」追加进 data/poems-chengyu.js
   数据的真身在 scripts/chengyu-tier2.js；落库规则见 chengyu-append.js。 */
const append = require('./chengyu-append.js').append;
append(require('./chengyu-tier2.js').ENTRIES, '第二至五档');
