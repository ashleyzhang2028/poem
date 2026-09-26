#!/usr/bin/env node
/* 把「第一档 · 义务教育教材常用成语」追加进 data/poems-chengyu.js
   数据的真身在 scripts/chengyu-tier1.js；落库规则见 chengyu-append.js。 */
const append = require('./chengyu-append.js').append;
append(require('./chengyu-tier1.js').ENTRIES, '第一档');
