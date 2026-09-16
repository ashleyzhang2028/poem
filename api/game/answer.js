/**
 * POST /api/game/answer —— **古诗词大会的判分口**（3 期 · 不花钱的那一层）
 *
 * req  { kind:"fly" | "paper", question, chosen, charge:false }
 * res  200 { ok, why, plan, counted, note }
 *     400 { code:"E_KIND" | "E_BODY" }
 *     401 { code:"E_NO_SESSION" }
 *     403 { code:"E_TIER" }              ← 有会话但层级不够（该能力要求 Pro / Max）
 *     429 { code:"E_RATE_DEVICE", retryAfter }
 *     503 { code:"E_NOT_CONFIGURED" }
 *
 * ## 这一条为什么现在就做
 *
 * 上一轮（Issue #159）的结论是「3 期不该开工，因为 AI 是真花钱的」。
 * 本接口**一分钱都不花**：
 *   · 不调任何 AI 商，不引入任何第三方依赖；
 *   · 判分用的是**同一个仓库里的纯函数**（`js/quiz.js` 的 `grade()`）——
 *     客户端与服务端跑的是同一份代码，不是两套规则。
 *   · 命中 0 条、答错、没登录，都如实回话，不假装。
 *
 * 于是「额度层」的形状可以在**有真实调用**的前提下定下来：
 * 计费开关 `charge` 默认 false（3 期还没有定价），但它**真的会算**——
 * 什么时候把 AI 接上、定价定下来，把 `charge` 打开就是真计数。
 * 在那之前它只如实回 `counted:false`，不假装扣了费。
 *
 * ## 三条口径
 *
 * 1. **能力闸在服务端** —— `Entitlement.can()` 的同一张能力表（`featuresFor`）
 *    在这里再判一次。客户端的置灰**不是**安全边界：直接的 HTTP 请求照样打得到。
 *    `kind: "fly"`（飞花令）与 `kind: "paper"`（现场考试）都要求 **max**，
 *    与用户 2026-09-17 的裁决一致（「现场考试和飞花令归 max 所有，题库归 pro」）。
 * 2. **判分不接受客户端给的答案** —— 请求里只有题目 id 与用户选的那一条。
 *    题目本身由服务端从**自己的语料**重建（`api/_lib/game.js`），
 *    客户端传上来的 `answer` 一律忽略 —— 否则改一行请求体就能全对。
 * 3. **不假装计数** —— `charge:false` 时回 `counted:false` 并说明原因；
 *    没有定价就没有额度，这一条不许含糊成「已计入」。
 *
 * Ref: docs/architecture.md §5.0、docs/auth-design.md §3.5
 */
"use strict";

var handler = require("../_lib/handler");

module.exports = handler.make("game.answer", ["POST"], function (d, body) {
  if (d.cfg && !d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }
  return handler.core.gameAnswer(d, body || {}, { game: handler.game });
});
