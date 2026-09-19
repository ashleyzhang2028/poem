"use strict";

var handler = require("../../_lib/handler");

// 用户报告 / 勘误（Issue #243 第四轮）
//
// GET  —— 看自己报过的（会话里的 uid，不接受请求体里的 uid）
// POST —— 报一条
//
// 两条都**不要求** Pro / Max：勘误是所有人都该能做的一件事。
// 有层级门槛的下场是「小朋友发现注音错了，但他是 Free，只好不说」——
// 而错的那一条会一直错给所有人看。
module.exports = handler.make("report", ["GET", "POST"], function (d, body, req) {
  var method = String((req && req.method) || "GET").toUpperCase();
  if (method === "GET") {
    return handler.core.reportMine(d, { limit: body.limit });
  }
  return handler.core.reportCreate(d, {
    kind: body.kind,
    poemId: body.poemId,
    poemTitle: body.poemTitle,
    book: body.book,
    quote: body.quote,
    context: body.context,
    note: body.note,
    suggestion: body.suggestion,
    ua: body.ua,
    deviceId: body.deviceId || d.deviceId
  });
});
