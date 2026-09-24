"use strict";

var handler = require("../_lib/handler");

// `PATCH /api/me`：账号事实里**用户自己能改**的那几件（目前只有昵称）。
// 为什么不开一条 `/api/nickname`：它是账号同一个东西的一个字段，
// 分离出去之后「账号事实有几条接口」就成了一件要记的事。
// 口令 / 邮箱 / 角色都不在这个口上（各走各的路，谁也不许顺手改）。
module.exports = handler.make("me.patch", ["PATCH"], function (d, body) {
  if (!d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }
  return handler.core.nicknameSet(d, { nickname: body.nickname });
});
