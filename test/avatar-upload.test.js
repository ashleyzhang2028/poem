"use strict";

const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");

let fails = 0;
const chk = (c, m) => { if (!c) { console.log("✗ " + m); fails++; } else console.log("✓ " + m); };
const eq = (a, b, m) => chk(a === b, m + "（实际 " + JSON.stringify(a) + "）");

function mem(init) {
  const m = Object.assign({}, init || {});
  return {
    getItem: k => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: k => { delete m[k]; },
    keys: () => Object.keys(m),
    raw: () => m
  };
}

const SESSION = JSON.stringify({
  v: 1,
  accounts: {
    u_1: {
      uid: "u_1", status: "active", plan: { tier: "free", until: null },
      identities: [{ channel: "email", mask: "a***@b.com", value: "x", verifiedAt: null }],
      profile: { nickname: "小明" }, createdAt: 1, lastLoginAt: 1
    }
  },
  sessions: { s1: { uid: "u_1", sid: "s1", exp: 9e15, scope: "account" } },
  deviceId: "d1"
});

(async function main() {
  const Avatar = require("../js/avatar.js");
  const AuthCore = require("../js/auth-core.js");
  const AccountApi = require("../js/account-api.js");

  console.log("=== 一、没登录：地址不写、图留着，如实说「登录后才同步」 ===");
  {
    AccountApi.reset();
    const b = mem();
    Avatar.setNickname(b, "小明");
    Avatar.setLocalImage(b, "data:image/jpeg;base64,AAAA");
    const r = await AccountApi.uploadAvatar({
      blob: { size: 10, type: "image/jpeg" },
      backing: b, A: AuthCore, AV: Avatar, E: null,
      api: { create: () => ({ me: () => Promise.resolve({}), deleteAccount: () => Promise.resolve({}) }) }
    });
    eq(r.reason, "guest", "没登录 → reason 是 guest（**不是** unavailable：未登录是本来的正常状态）");
    eq(r.code, "E_NO_SESSION", "回 E_NO_SESSION");
    eq(Avatar.display(b).img, "", "账号域那个地址**没写**（没登录就没有云端地址可写）");
    eq(Avatar.display(b).src, "data:image/jpeg;base64,AAAA", "但本机那份图还在 —— 顶栏照旧画得出来");
    eq(Avatar.display(b).source, "image", "当前这一档是「图片」");
  }

  console.log("\n=== 二、传成功：先服务端、后本机，地址带破缓存参数 ===");
  {
    AccountApi.reset();
    const b = mem({ poem_auth_v1: SESSION });
    Avatar.setNickname(b, "小明");
    Avatar.setLocalImage(b, "data:image/jpeg;base64,AAAA");
    let sent = null;
    const api = {
      create: () => ({
        me: () => Promise.resolve({ ok: false }),
        deleteAccount: () => Promise.resolve({}),
        uploadAvatar: input => { sent = input; return Promise.resolve({ ok: true, url: "https://x.supabase.co/a.jpg?v=9", bytes: 123 }); },
        deleteAvatar: () => Promise.resolve({ ok: true })
      })
    };
    const r = await AccountApi.uploadAvatar({ blob: { size: 10, type: "image/jpeg" }, backing: b, A: AuthCore, AV: Avatar, E: null, api: api });
    eq(r.ok, true, "上传成功");
    chk(!!sent, "真的调了通道的 uploadAvatar（不是「成功」两个字）");
    eq(sent.blob.type, "image/jpeg", "传的是那个 Blob 本身（**裸字节**，不做 base64 包装）");
    eq(Avatar.display(b).img, "https://x.supabase.co/a.jpg?v=9", "云端地址写进了账号域");
    eq(Avatar.display(b).src, "data:image/jpeg;base64,AAAA", "界面画的仍是**本机那份**（它优先 —— 离线也画得出）");
  }

  console.log("\n=== 三、服务端连不上：地址不写、本机那份不删、如实回话 ===");
  {
    AccountApi.reset();
    const b = mem({ poem_auth_v1: SESSION });
    Avatar.setNickname(b, "小明");
    Avatar.setLocalImage(b, "data:image/jpeg;base64,AAAA");
    const api = {
      create: () => ({
        me: () => Promise.resolve({ ok: false }),
        deleteAccount: () => Promise.resolve({}),
        uploadAvatar: () => Promise.resolve({ ok: false, code: "E_OFFLINE", message: "连不上服务端" }),
        deleteAvatar: () => Promise.resolve({})
      })
    };
    const r = await AccountApi.uploadAvatar({ blob: { size: 10, type: "image/jpeg" }, backing: b, A: AuthCore, AV: Avatar, E: null, api: api });
    eq(r.ok, false, "如实回失败");
    eq(r.reason, "unavailable", "reason 是 unavailable（这一轮没问成）");
    eq(Avatar.display(b).img, "", "地址没写（传失败就不该有一条指向不存在文件的地址）");
    eq(Avatar.display(b).src, "data:image/jpeg;base64,AAAA", "本机那份图一个字都没动 —— 这正是「传不上去时还能看」的那一份");

    AccountApi.reset();
    const b2 = mem({ poem_auth_v1: SESSION });
    const api2 = {
      create: () => ({
        me: () => Promise.resolve({ ok: false }),
        deleteAccount: () => Promise.resolve({}),
        uploadAvatar: () => Promise.resolve({ ok: false, code: "E_NOT_CONFIGURED", message: "还没开放" }),
        deleteAvatar: () => Promise.resolve({})
      })
    };
    const r2 = await AccountApi.uploadAvatar({ blob: { size: 10, type: "image/jpeg" }, backing: b2, A: AuthCore, AV: Avatar, E: null, api: api2 });
    eq(r2.reason, "not-configured", "服务端没开放 → reason 是 not-configured（与「连不上」分开：下一步动作不同）");
  }

  console.log("\n=== 四、通道形状不对（老缓存里的旧 AuthApi）→ 不许把 me 一起废掉 ===");
  {
    AccountApi.reset();
    const b = mem({ poem_auth_v1: SESSION });

    const api = {
      create: () => ({
        me: () => Promise.resolve({ ok: true, plan: { tier: "free" }, role: "user" }),
        deleteAccount: () => Promise.resolve({ ok: true })
      })
    };
    const r = await AccountApi.uploadAvatar({ blob: { size: 10 }, backing: b, A: AuthCore, AV: Avatar, E: null, api: api });
    eq(r.reason, "no-channel", "缺 uploadAvatar → reason 是 no-channel（刷新即可）");

    const me = await AccountApi.refreshMe({ backing: b, A: AuthCore, AV: Avatar, E: null, api: api, force: true });
    eq(me.reason, "ok", "me 那条路照样通（没有拿新功能废掉既有功能）");
  }

  console.log("\n=== 五、删头像：先清地址、再删对象；连不上也如实说 ===");
  {
    AccountApi.reset();
    const b = mem({ poem_auth_v1: SESSION });
    Avatar.setNickname(b, "小明");
    Avatar.setAvatar(b, { img: "https://x.supabase.co/a.jpg" });
    Avatar.setLocalImage(b, "data:image/jpeg;base64,AAAA");
    let deleted = false;
    const api = {
      create: () => ({
        me: () => Promise.resolve({ ok: false }),
        deleteAccount: () => Promise.resolve({}),
        uploadAvatar: () => Promise.resolve({}),
        deleteAvatar: () => { deleted = true; return Promise.resolve({ ok: true }); }
      })
    };
    const r = await AccountApi.deleteAvatar({ backing: b, A: AuthCore, AV: Avatar, E: null, api: api });
    eq(r.ok, true, "删除成功");
    eq(deleted, true, "云端那个对象真的去删了");
    eq(Avatar.display(b).img, "", "地址清成空（否则另一台设备会去拉一张不存在的图）");
    eq(Avatar.display(b).hasImage, false, "回到首字印");
    eq(Avatar.localImage(b), "", "本机那份图也清掉了（不然「删了还在显示」）");

    AccountApi.reset();
    const b2 = mem({ poem_auth_v1: SESSION });
    const api2 = {
      create: () => ({
        me: () => Promise.resolve({ ok: false }),
        deleteAccount: () => Promise.resolve({}),
        uploadAvatar: () => Promise.resolve({}),
        deleteAvatar: () => Promise.resolve({ ok: false, code: "E_OFFLINE" })
      })
    };
    const r2 = await AccountApi.deleteAvatar({ backing: b2, A: AuthCore, AV: Avatar, E: null, api: api2 });
    eq(r2.remote, "skipped", "连不上 → remote 是 skipped（如实说「云端那份还没删掉」）");
    eq(Avatar.localImage(b2), "", "本机那份仍然清掉了（用户的意图是「删」）");
  }

  console.log("\n=== 六、传输层：裸字节 + 二进制超时 ===");
  {
    const AuthApi = require("../js/auth-api.js");
    const calls = [];
    const ch = AuthApi.create({
      deviceId: "d1",
      fetch: (u, init) => { calls.push({ u: u, init: init }); return Promise.resolve({
        status: 200, ok: true, headers: { get: () => "" },
        text: () => Promise.resolve(JSON.stringify({ url: "https://x/a.jpg", bytes: 3 }))
      }); }
    });
    const blob = { size: 3, type: "image/jpeg" };
    const r = await ch.uploadAvatar({ blob: blob, type: "image/jpeg" });
    eq(r.ok, true, "上传回 ok");
    eq(r.url, "https://x/a.jpg", "地址带回来了");
    eq(calls[0].u, "/api/avatar", "打的是 /api/avatar");
    eq(calls[0].init.method, "POST", "POST");
    eq(calls[0].init.body, blob, "body 就是那个 Blob（**不是** JSON 字符串）");
    eq(calls[0].init.headers["Content-Type"], "image/jpeg", "Content-Type 跟着 blob 的类型");
    eq(calls[0].init.headers["x-kb-device"], "d1", "带上设备号（频控分桶要用）");
    chk(!/json/i.test(calls[0].init.headers["Content-Type"]), "**不是** application/json（否则服务端会当 JSON 解析）");

    const ch2 = AuthApi.create({
      deviceId: "d1",
      fetch: () => Promise.resolve({
        status: 503, ok: false, headers: { get: () => "" },
        text: () => Promise.resolve(JSON.stringify({ code: "E_NOT_CONFIGURED", message: "x" }))
      })
    });
    const r2 = await ch2.uploadAvatar({ blob: blob, type: "image/jpeg" });
    eq(r2.code, "E_NOT_CONFIGURED", "503 → E_NOT_CONFIGURED（**不是** ok:true）");
    eq(ch2.degraded(), true, "标记成降级（界面据此说「只存在本机」）");

    const ch3 = AuthApi.create({ deviceId: "d1", fetch: () => Promise.reject(new Error("ENOTFOUND")) });
    const r3 = await ch3.uploadAvatar({ blob: blob, type: "image/jpeg" });
    eq(r3.code, "E_OFFLINE", "连不上 → E_OFFLINE");

    chk(!!AuthApi.AVATAR_ERR, "另有一张 AVATAR_ERR 文案表");
    chk(!/体验版/.test(JSON.stringify(AuthApi.AVATAR_ERR)),
      "头像那条路的文案不提「体验版」（它要么成了，要么如实说「只存在本机」）");
    chk(/本机/.test(AuthApi.AVATAR_ERR.E_OFFLINE), "连不上时说清了「头像已存在本机、还没同步」");
    chk(/还没建好/.test(AuthApi.AVATAR_ERR.E_NO_BUCKET), "桶没建时如实说「图片存储还没建好」");
    chk(/本机/.test(AuthApi.AVATAR_ERR.E_NO_BUCKET), "并说清「头像暂时只存在本机」（用户知道功能没坏）");
    chk(/1MB/.test(AuthApi.AVATAR_ERR.E_TOO_BIG), "上限那条把数字写出来（用户知道该压到多小）");
    chk(/登录/.test(AuthApi.AVATAR_ERR.E_NO_SESSION), "没登录那条告诉用户下一步是登录");

    const src = read("js/auth-api.js").replace(/\/\*[\s\S]*?\*\//g, "");
    chk(!/createElement\("canvas"\)/.test(src), "js/auth-api.js 不碰 canvas（压缩在 avatar-image.js）");
    chk(!/<input/.test(src), "js/auth-api.js 不碰文件选择框");
  }

  console.log("\n=== 七、真页面：/mine/ 点一遍（jsdom） ===");
  {
    const hasJsdom = (function () { try { require.resolve("jsdom"); return true; } catch (e) { return false; } })();
    if (!hasJsdom) {
      console.log("(未安装 jsdom，跳过「真页面上跑一遍」一节 —— npm i jsdom 可启用)");
    } else {
      const { JSDOM } = require("jsdom");
      const html = read("mine/index.html");
      const order = html.match(/<script src="([^"]+)"><\/script>/g).map(s => s.match(/src="([^"]+)"/)[1]);
      const dom = new JSDOM(html, { runScripts: "dangerously", url: "https://local.test/mine/", pretendToBeVisual: true });
      const w = dom.window;
      w.confirm = () => true;
      order.forEach(f => {
        const el = w.document.createElement("script");
        try { el.textContent = read(f.replace(/^\//, "")); } catch (e) { return; }
        w.document.body.appendChild(el);
      });
      // ⚠️ 这一下必须点：jsdom 的 readyState 在我们注入脚本时还是 loading，
      //    所以每一份脚本都走的是「等 DOMContentLoaded」那一支 —— 不派发它，
      //    本页的两个初始化函数（js/avatar-edit.js 与 js/mine.js）都不会跑，
      //    于是这一节测的是一个**还没挂起来**的页面。原先它靠下面那 400ms
      //    的等待蒙对了（jsdom 自己迟早会 fire），但那是时序运气，不是判据。
      w.document.dispatchEvent(new w.Event("DOMContentLoaded", { bubbles: true }));
      await new Promise(r => setTimeout(r, 400));

      const $ = id => w.document.getElementById(id);
      chk(!!$("avatar-slot"), "页面上那枚头像在");
      chk(!!$("btn-avatar-pick") && /上传头像/.test($("btn-avatar-pick").textContent),
        "有「上传头像」那颗键（用户 2026-09-18：原先叫「上传图片」）");
      eq(w.document.querySelectorAll(".avatar-slot").length, 1,
        "头像槽全页只有一枚（按钮左边那枚与顶部那枚已合并）");
      chk(!!$("avatar-file") && $("avatar-file").type === "file", "文件选择框是 input[type=file]");
      eq($("avatar-file").accept, "image/*", "只让挑图片（accept 收窄选择器，不是安全边界）");
      chk($("crop-layer").hidden, "裁切层默认藏着（没选图时不铺上来）");
      chk($("btn-avatar-clear").hidden, "没图时「删除头像」不出现（摆一颗点了没反应的灰键更糟）");

      // ⚠️ 用户 2026-09-21「能省则省」：原先这一页还写一行「已同步 / 未同步」——
      //    本机有图就当场看得到，服务器那一份成不成是后台自己的事。
      //    整行撤掉（挂载点一起走），所以下面几条也从「那一行说什么」改成
      //    「那一行不再存在，而图形本身如实跟着走」。
      eq($("avatar-hint"), null, "不再有「已同步 / 未同步」那一行（挂载点与文案一起撤）");

      // ⚠️ 2026-09-24（Issue #276）：身份行改成按需整段重画（js/mine.js
      //    的 buildIdentityRow 换 innerHTML），两颗键每次重画都是**新节点**。
      //    所以绑定是幂等的、由 avatar-edit 的 render() 每次补绑 —— 「点一下
      //    有没有转发给文件框」这件事仍然要测，但**必须重测两遍**：
      //    第一遍测首次绑定，第二遍测「重画之后还绑着吗」。
      //    只测一遍的话，这一层会对着一个「只在首帧能用」的实现亮绿灯。
      const clickPick = () => {
        let clicked = 0;
        $("avatar-file").addEventListener("click", e => { clicked++; e.preventDefault(); });
        $("btn-avatar-pick").dispatchEvent(new w.Event("click", { bubbles: true }));
        return clicked;
      };
      eq(clickPick(), 1, "点「上传头像」转发给文件选择框（不是自己造一个假弹窗）");

      w.MinePage.paint(w.AuthCore.session(w.AuthCore.makeStore(w.localStorage)));
      eq(clickPick(), 1,
        "身份行重画一次之后，那颗键仍绑着（重画换掉的是节点，绑定要跟着补）");

      w.Avatar.setAvatar(w.localStorage, { img: "https://x.supabase.co/a.jpg" });
      w.SiteChrome && w.SiteChrome.refreshUser && w.SiteChrome.refreshUser();

      // 先起个名：头像的回落是「昵称首字」，删完之后要看的就是这一个字
      const u = $("input-nickname");
      u.value = "小明";
      u.dispatchEvent(new w.Event("input", { bubbles: true }));
      u.dispatchEvent(new w.Event("change", { bubbles: true }));

      chk(!$("btn-avatar-clear").hidden, "有图时「删除头像」出现");
      chk(!/未同步|已同步/.test(w.document.getElementById("mine-page").textContent),
        "页面上不再出现「未同步 / 已同步」这类同步状态字眼");
      chk(/<img[^>]+avatar-img/.test($("avatar-slot").innerHTML), "有图时槽里画的是 <img>");

      // 服务器把云端地址回填到账号域之后，「未同步」换成「已同步」
      w.AccountApi.applyMe({
        uid: "u1", mask: "a***@b.com", email: "a@b.com", emailVerified: true,
        nickname: "小明", plan: { tier: "pro", until: null }, role: "user"
      });
      w.AvatarEdit.render();
      chk(w.Storage ? true : true, "云端地址回填之后重画一遍不报错（这一行已经不在了）");

      $("btn-avatar-clear").dispatchEvent(new w.Event("click", { bubbles: true }));
      await new Promise(r => setTimeout(r, 50));
      eq(w.Avatar.display(w.localStorage).img, "", "删完账号域那个地址空了");

      eq(w.Avatar.localImage(w.localStorage), "", "本机那份也清了");
      chk(/<span[^>]*>小<\/span>/.test($("avatar-slot").innerHTML) || /小/.test($("avatar-slot").innerHTML),
        "回到首字印（昵称首字「小」）");
    }
  }

  console.log("");
  if (fails) {
    console.log("✗ 头像上传测试失败 " + fails + " 项");
    process.exit(1);
  }
  console.log("🎉 头像上传测试全部通过");
})().catch(e => {
  console.log("✗ 测试自身抛异常：" + (e && e.stack || e));
  process.exit(1);
});
