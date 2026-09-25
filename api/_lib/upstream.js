"use strict";

// ===========================================================================
// 「上游读不动」与「服务端出错了」**不是一件事**（Issue #276 · 线上实测）
// ===========================================================================
//
// 用户的现场：登录 / 注册 / 输完随机验证码之后，页面回一句
//   「服务暂时不可用，请稍后重试。」
// 而这句话在前端 `js/auth-api.js` 里只对应一个码 —— **HTTP 500 E_INTERNAL**。
//
// 线上实测（把服务端连到一台**读不动的数据库**上，逐条打）：
//
//   GET  /api/config        -> 200（这条不碰库，好的）
//   GET  /api/me            -> 401（未登录，在碰库之前就返回了）
//   POST /api/register      -> **500 E_INTERNAL**   ← 就是用户看到的那句话
//   POST /api/login         -> **500 E_INTERNAL**
//   POST /api/verify-code   -> **500 E_INTERNAL**
//   POST /api/send-code     -> 429（频控在碰库之前，挡住了）
//
// 而 `/api/diag` 与 `/self-check/` 那套设计（docs/architecture.md §4.20）
// 早就把口径定死了：同一个 500 背后有**四条互斥的原因**，而且**每一条都不一样**：
//
//   数据库不可连（项目被暂停 / URL 拼错）
//   表没建（schema.sql 没跑）
//   表是旧形状（缺列）
//   密钥不对（填了 anon）
//
// **这些都不是「服务端出了点问题」** —— 用户对着这句话唯一的动作就是
// 「稍后重试」，而免费档 Supabase 一旦暂停，重试一万次也还是这句。
// 于是「一个本可以如实说清楚的故障，被一句话说成了运气问题」。
//
// 这一层只做一件事：把 store 抛上来的错误**分类**，给每一类配一句
// **能指导下一步动作**的话。判据全部来自上游自己回的原文，不猜。
//
// ⚠️ 与 `store.js` 的关系：那边在抛 `supabase <status>: <body>` 时已经把
//    `err.status` 与 `err.upstream`（上游原话，截 300 字）挂上了。
//    这里只读这两个字段 + 网络错自身那几个（`fetch failed` / `ECONNRESET` …），
//    一行都不重新请求。

// 三类「上游读不动」的码，加上兜底那一类。
var E_DB_UNREACHABLE = "E_DB_UNREACHABLE";
var E_DB_MISSING_TABLE = "E_DB_MISSING_TABLE";
var E_DB_BAD_KEY = "E_DB_BAD_KEY";

// 上游错误原文里能认出「这条 SQL / 这个请求本身不对」的字样。
//
// ⚠️ 这一档**不能**归进「上游读不动」：它是**这一发请求**写坏了，
//    换个请求就好了 —— 说成「稍后重试」等于让用户等一件不会发生的事
//    （与 Issue #276 那条「400 不许说成 500」是同一条纪律）。
var BAD_REQUEST_SIGNS = [
  "42703",              // undefined_column：库是旧形状
  "PGRST204",           // PostgREST：请求里点了一列，表里没有
  "42P01",              // undefined_table：表还没建
  "23505",              // unique_violation：主键撞了
  "23503",              // foreign_key_violation
  "22P02"               // invalid_text_representation：参数形状不对
];

// 建表那一段没跑时，PostgREST 会把「没有这张表」原样说出来。
var MISSING_TABLE_SIGNS = [
  "42P01",
  "PGRST205",
  "relation", "does not exist"
];

var MISSING_TABLE_RE = /relation .* does not exist|Could not find the table|schema cache/i;

// 密钥不对：Supabase 对 anon key 打 RLS 全开的表就是 401/403，
// 且原文里往往带 JWT / 权限那几句。
var BAD_KEY_SIGNS = ["JWT", "Invalid API key", "invalid api key", "permission denied", "no suitable key"];

function textOf(err) {
  if (!err) return "";
  var up = String(err.upstream || "");
  var msg = String(err.message || "");
  return (up + " " + msg).slice(0, 600);
}

function hasAny(hay, needles) {
  var h = String(hay || "").toLowerCase();
  for (var i = 0; i < needles.length; i++) {
    if (h.indexOf(String(needles[i]).toLowerCase()) >= 0) return needles[i];
  }
  return null;
}

// 上游那一发到底是怎么坏的？回一个**有名字**的分类。
//
// 取值：
//   missing_table —— 表没建（schema.sql 没跑）
//   bad_key       —— 密钥不对（填了 anon / 被轮换）
//   bad_request   —— 这一发请求本身不合法（列名错、参数形状错）
//   unreachable   —— 连不上 / 上游 5xx / 回了非 JSON（多半是项目被暂停或网关挂）
//   null          —— 认不出，别乱归类
function classify(err) {
  if (!err) return null;

  var status = Number(err.status);
  var txt = textOf(err);

  // ① 连接层压根没成（DNS / TLS / 项目暂停后连接被拒 / 超时）
  if (!isFinite(status) || status === 0) {
    // ⚠️ `status === 0` 是 `store.js` **自己**打上去的「上游回了 200 但不是
    //    JSON」那个标记（`err.network = true`）—— 那是「读不动」，不是
    //    「我们写错了」，所以先认它。
    if (err.network === true) return "unreachable";
    if (err.name === "AbortError") return "unreachable";
    if (/fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network|timeout|aborted|not-json|不是 JSON|不是合法 JSON/i.test(txt)) {
      return "unreachable";
    }
    // ⚠️ 没状态码、也没网络字样：**不猜**。这是我们自己（或某个我们没见过的
    //    层）抛出来的编程错误 —— 归到「上游读不动」会把一个真 bug 说成
    //    「数据库被暂停了」，下次谁也别想找到它。宁可回落 E_INTERNAL。
    return null;
  }

  // ② 上游回的**不是 JSON**（Supabase 暂停时前面那层网关会回 HTML）
  //    —— `store.js` 在这条路上抛的 err 没有 upstream 原文，只有一句
  //    「supabase 200: ...」或干脆是 JSON.parse 抛的 SyntaxError。
  if (/Unexpected token|not valid JSON|is not valid JSON|SyntaxError/i.test(txt)) return "unreachable";

  // ③ 5xx：上游自己坏了 / 网关 502 503
  if (status >= 500) return "unreachable";

  // ④ 401 / 403：密钥不对（service key 配错或换成 anon）
  if (status === 401 || status === 403) return "bad_key";

  // ⑤ 404：表 / 路由不存在（PostgREST 对没建的 resource 回 404 的情况）
  if (status === 404) {
    if (MISSING_TABLE_RE.test(txt) || hasAny(txt, ["does not exist", "PGRST205"])) return "missing_table";
    return "bad_request";
  }

  // ⑥ 400：先认「表没建」，再认「密钥」，最后才是「这一发写坏了」
  if (status === 400) {
    if (MISSING_TABLE_RE.test(txt) || hasAny(txt, ["42P01", "PGRST205"])) return "missing_table";
    if (hasAny(txt, BAD_KEY_SIGNS)) return "bad_key";
    if (hasAny(txt, BAD_REQUEST_SIGNS)) return "bad_request";
    return "bad_request";
  }

  return null;
}

// 分类 -> 给用户看的那一句 + 一个码。
//
// ⚠️ 每一句都要能指导**下一步动作**（这是这一层存在的全部理由）。
//    「请稍后重试」这五个字在下面**一次都不出现** —— 它正是用户抱怨的那句话。
function verdict(kind, cfg) {
  var site = String((cfg && cfg.siteUrl) || "本站").replace(/\/+$/, "");
  void site;

  if (kind === "unreachable") {
    return {
      status: 503,
      body: {
        code: E_DB_UNREACHABLE,
        message: "账号服务器连不上（多半是数据库项目被暂停了）。云端登录 / 注册暂时用不了；" +
          "本站的背诵功能不受影响，进度一直存在这台设备上。稍后可在「设置 → 关于 → 自检」里看详情。",
        retryable: true
      }
    };
  }

  if (kind === "missing_table") {
    return {
      status: 503,
      body: {
        code: E_DB_MISSING_TABLE,
        message: "账号服务器上的表还没建好（缺 accounts 那几张表）。这不是你的问题，" +
          "请联系站点管理员跑一次 api/_lib/schema.sql。",
        retryable: false
      }
    };
  }

  if (kind === "bad_key") {
    return {
      status: 503,
      body: {
        code: E_DB_BAD_KEY,
        message: "账号服务器的密钥不对（多半是用了 anon key，或改完没重新部署）。" +
          "这不是你的问题，请联系站点管理员。",
        retryable: false
      }
    };
  }

  if (kind === "bad_request") {
    // ⚠️ 这一档**不按「上游坏了」回**：它是这一发请求写坏了，与服务端状态无关。
    //    回 400，前端那句「这一发请求没能被服务端读懂，请刷新页面重试。」
    //    正是给它准备的（与 Issue #276 那条「400 不许说成 500」同源）。
    return {
      status: 400,
      body: {
        code: "E_BAD_REQUEST",
        message: "这一发请求没能被服务端读懂，请刷新页面重试。",
        retryable: true
      }
    };
  }

  return null;
}

// 给 store 那一层用的包装：把 `call()` 的失败挂上分类所需的字段。
//
// ⚠️ 只**加字段**，不改 status（`store.js` 的 isMissingColumn 还在按 400 判）。
//    分类读的是 `err.kind`，谁都没被覆盖。
function tag(err) {
  try {
    if (err && !err.kind) err.kind = classify(err);
  } catch (e) { /* 分类本身不许把错误变多 */ }
  return err;
}

module.exports = {
  classify: classify,
  verdict: verdict,
  tag: tag,
  E_DB_UNREACHABLE: E_DB_UNREACHABLE,
  E_DB_MISSING_TABLE: E_DB_MISSING_TABLE,
  E_DB_BAD_KEY: E_DB_BAD_KEY,
  _textOf: textOf
};
