#!/usr/bin/env node
/**
 * 开通自检（`npm run doctor` / `bash scripts/doctor.sh`）
 * ==========================================================================
 * 回答一个问题：**「现在这套配置，缺什么、缺了会怎样、怎么补」**
 * —— 在**不部署**的情况下就能问出来。
 *
 * 这是 2C 的产出。2D（配置与真开通）在本项目里是唯一「没有业务代码可写」的一步，
 * 而「没有代码可写」不等于「没有东西可做」：这一步的产出就是
 * **一份可执行的清单 + 一台能问的自检**，让那件事从「照着一篇文档手工核对」
 * 变成「跑一条命令，照着它说的补」。
 *
 * ⚠️ 输出里**绝不出现任何密钥的值**（连长度都不报）—— 这段文字是可以
 *    直接贴进 Issue 的，这条规矩就是为那件事定的。
 * ⚠️ 用户明确要求 **sw.js 里一个注释都不许有**，但这里没有这个限制；
 *    本文件不是被浏览器加载的，只在 Node 里跑。
 *
 * 2D 又补了一条出口：`--steps`。自检回答「现在缺哪个」，而「按什么顺序补齐、
 * 每一步在哪配、做完了怎么知道成了」原本散在文档 / 模板 / 注释三处 ——
 * 现在与清单同源（`api/_lib/ops.js` 的 STEPS），一条命令打完。
 *
 * 用法：
 *   node scripts/doctor.js            # 读当前进程的环境变量
 *   node scripts/doctor.js --json     # 给程序看的形状（CI / 别的脚本用）
 *   node scripts/doctor.js --example  # 打印 .env.example 的内容
 *   node scripts/doctor.js --steps    # 2D 的五个步骤（配 Supabase / 发信商 / 探活）该怎么走
 *   node scripts/doctor.js --steps --check   # 同上，外加「据当前环境变量，走到第几步了」
 *
 * ⚠️ 四个出口都**只报缺、不报值**（连密钥长度都不报）—— 这段文字是给人贴进 Issue 的。
 */
"use strict";

var path = require("path");
var ROOT = path.join(__dirname, "..");
var ops = require(path.join(ROOT, "api/_lib/ops.js"));
var CONFIG = require(path.join(ROOT, "api/_lib/config.js"));

var argv = process.argv.slice(2);

if (argv.indexOf("--example") >= 0) {
  process.stdout.write(ops.envExample());
  process.exit(0);
}

/* 2D：五个步骤。`--check` 只是把「现在到哪一步」那一段加上 ——
   上一步的判据与自检是**同一个函数**（ops.check），不在这里重算一遍。 */
if (argv.indexOf("--steps") >= 0) {
  process.stdout.write(ops.stepsReport(CONFIG) + "\n");
  if (argv.indexOf("--check") >= 0) {
    var v1 = ops.check(CONFIG);
    console.log("");
    console.log(v1.ok ? "自检结论：最低线已过（A / B 步成了）。" : "自检结论：还没到最低线，先做 A、B 两步。");
    process.exit(v1.ok ? 0 : 1);
  }
  process.exit(0);
}

if (argv.indexOf("--json") >= 0) {
  var r = ops.check(CONFIG);
  process.stdout.write(JSON.stringify({
    ok: r.ok,
    hasSession: r.hasSession,
    hasDb: r.hasDb,
    mail: r.mail,
    smsReady: r.smsReady,
    missing: r.missing.map(function (i) { return { key: i.key, level: i.level, group: i.group }; }),
    blocking: r.blocking.map(function (i) { return i.key; }),
    notes: r.notes
  }, null, 2) + "\n");
  process.exit(r.ok ? 0 : 1);
}

var verdict = ops.check(CONFIG);
var r0 = verdict.ok;

console.log("跬步 · 开通自检（服务端环境变量）");
console.log("=".repeat(60));
console.log(ops.report(CONFIG));
console.log("");
console.log("=".repeat(60));
console.log("补完上面「未设置」里标着【必须】的那几项（会话密钥 + 数据库那一对），");
console.log("服务端就真的跑起来了 —— 业务代码一行都不用改。");
console.log("生成一份可直接粘贴的模板： node scripts/doctor.js --example > .env.example");

/* ⚠️ 退出码 = 体检结论（`--json` 那一支同理）：没到最低线就退 1。
   这样它可以被 CI / 部署前检查直接当门用（`npm run doctor && …`），
   而不是「打了一堆字但谁也没看见」。**这是「如实」那条纪律在脚本上的样子**：
   没配齐就是没配齐，不许用一个 0 把红的说成绿的。 */
process.exit(r0 ? 0 : 1);
