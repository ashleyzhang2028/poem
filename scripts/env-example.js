#!/usr/bin/env node
/**
 * 生成 `.env.example`（**唯一来源**，不要手抄）
 * ==========================================================================
 * 为什么要有这一条生成命令，而不是直接手写一个 .env.example 文件：
 *   手抄的那一份迟早与代码分叉 —— 某天加了一个变量，模板还是老样子，
 *   用户照着模板配完发现「还是不对」，而模板看起来完全正确。
 *   本项目里这种「文档与代码各说各的」已经出现过多次（见 docs 里那些
 *   「已落地 / 未落地」的标注），所以这一处**直接由清单生成**。
 *
 * 清单本身在 `api/_lib/ops.js` 的 ENTRY 里 —— 自检（scripts/doctor.js）
 * 与这份模板读的是**同一份数据**，因此「文档说缺 X、程序说缺 Y」不可能发生。
 *
 * 用法：node scripts/env-example.js > .env.example
 */
"use strict";

var path = require("path");
var ops = require(path.join(__dirname, "..", "api/_lib/ops.js"));
process.stdout.write(ops.envExample());
