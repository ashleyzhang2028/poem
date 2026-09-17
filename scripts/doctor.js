#!/usr/bin/env node

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

process.exit(r0 ? 0 : 1);
