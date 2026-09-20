"use strict";

const { chromium } = require("playwright");

process.env.SESSION_SECRET = "browser-test-secret-at-least-16-chars";
process.env.MAIL_TRANSPORT = "console";
process.env.ALLOW_CODE_ECHO = "1";
process.env.TURNSTILE_ENABLED = "1";
process.env.TURNSTILE_SITE_KEY = "1x00000000000000000000AA";
process.env.TURNSTILE_SECRET_KEY = "1x0000000000000000000000000000000AA";
process.env.TURNSTILE_BYPASS = "1";
process.env.REQUIRE_EMAIL_VERIFIED = "1";
process.env.RESEND_COOLDOWN_MS = "1000";

const { createServer } = require("../scripts/serve.js");
const config = require("../api/_lib/config.js");
const store = require("../api/_lib/store.js").getStore(config);

let failures = 0;
function check(condition, message) {
  if (condition) console.log("✓ " + message);
  else { console.log("✗ " + message); failures++; }
}

function listen(server) {
  return new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
}

function close(server) {
  return new Promise(resolve => server.close(resolve));
}

async function jsonPost(base, pathname, body) {
  const response = await fetch(base + pathname, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

async function preparePage(context, base, pageErrors) {
  const page = await context.newPage();
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.route("**/api/config", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      turnstile: { enabled: true, siteKey: "1x00000000000000000000AA" },
      mail: { delivered: false }
    })
  }));
  await page.route("https://challenges.cloudflare.com/**", route => route.fulfill({
    status: 200,
    contentType: "text/javascript",
    body: "(function(){var n=0,widgets={};window.turnstile={render:function(el,o){var id='local-widget-'+(++n);widgets[id]=o;el.dataset.browserTest='1';var frame=document.createElement('iframe');frame.style.width='300px';frame.style.height='65px';el.appendChild(frame);setTimeout(function(){o.callback('local-test-token');},0);return id;},reset:function(id){setTimeout(function(){if(widgets[id])widgets[id].callback('local-test-token');},0);},remove:function(id){delete widgets[id];}};}());"
  }));
  await page.goto(base + "/login/");
  return page;
}

async function waitForTurnstile(page) {
  await page.waitForFunction(() => window.Turnstile && window.Turnstile.token && window.Turnstile.token());
}

async function assertNoOverflow(page, label) {
  const size = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth
  }));
  check(size.scroll <= size.client, label + " 没有横向溢出（" + size.scroll + "/" + size.client + "）");
  if (size.scroll > size.client) {
    const offenders = await page.locator("body *").evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      return {
        tag: element.tagName, id: element.id, className: element.className,
        right: Math.round(rect.right), width: Math.round(rect.width),
        scroll: element.scrollWidth, client: element.clientWidth,
        overflow: getComputedStyle(element).overflowX,
        whiteSpace: getComputedStyle(element).whiteSpace,
        letterSpacing: getComputedStyle(element).letterSpacing,
        text: (element.textContent || "").slice(0, 80)
      };
    }).filter(item => item.right > document.documentElement.clientWidth + 1 || item.scroll > item.client + 1)
      .sort((a, b) => Math.max(b.right, b.scroll) - Math.max(a.right, a.scroll)).slice(0, 10));
    console.log("  overflow:", offenders);
  }
}

async function assertVisibleControlsNamed(page, label) {
  const unnamed = await page.locator("button:visible, input:visible").evaluateAll(elements => elements.filter(element => {
    const labelled = element.getAttribute("aria-label") || element.getAttribute("aria-labelledby") ||
      element.textContent.trim() || element.placeholder ||
      (element.id && document.querySelector('label[for="' + element.id + '"]'));
    return !labelled;
  }).map(element => element.id || element.tagName));
  check(unnamed.length === 0, label + " 的可见按钮和输入都有可访问名称");
}

async function assertPasswordToggle(page, buttonId, inputId, label) {
  const input = page.locator("#" + inputId);
  const button = page.locator("#" + buttonId);
  check(await input.getAttribute("type") === "password", label + " 默认隐藏");
  await button.click();
  check(await input.getAttribute("type") === "text" &&
    await button.getAttribute("aria-label") === "隐藏密码" &&
    await button.getAttribute("aria-pressed") === "true", label + " 可独立显示");
  await button.click();
  check(await input.getAttribute("type") === "password" &&
    await button.getAttribute("aria-pressed") === "false", label + " 可恢复隐藏");
}

async function main() {
  const server = createServer();
  await listen(server);
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({ headless: true });
  const pageErrors = [];

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
    const page = await preparePage(context, base, pageErrors);
    const email = "browser-" + Date.now() + "@example.com";
    const password = "hunter2hunter";
    const protectedRequests = [];
    page.on("request", request => {
      const pathname = new URL(request.url()).pathname;
      if (["/api/register", "/api/send-code", "/api/reset-request",
        "/api/resend-verification", "/api/resend-verification-by-email"].includes(pathname)) {
        protectedRequests.push({ pathname, body: request.postDataJSON() });
      }
    });

    await assertPasswordToggle(page, "btn-pw-eye", "input-pw", "登录密码");
    await page.fill("#input-pw-email", "bad");
    await page.fill("#input-pw", password);
    await page.click("#btn-login");
    check(/邮箱/.test(await page.textContent("#msg-pw")), "密码登录就地提示邮箱格式错误");

    await page.click("#btn-go-register");
    check(await page.evaluate(() => document.activeElement && document.activeElement.id) === "input-reg-email",
      "进入注册页后焦点落在邮箱");
    await waitForTurnstile(page);
    check(await page.getAttribute("#ts-reg", "data-browser-test") === "1", "注册页渲染 Turnstile");
    await assertPasswordToggle(page, "btn-reg-eye", "input-reg-pw", "注册密码");
    await assertPasswordToggle(page, "btn-reg-eye2", "input-reg-pw2", "注册确认密码");

    await page.fill("#input-reg-email", email);
    await page.fill("#input-reg-pw", password);
    await page.fill("#input-reg-pw2", password + "x");
    await page.click("#btn-register");
    check(/不一样/.test(await page.textContent("#msg-reg")), "注册页拦截两次密码不一致");

    await page.fill("#input-reg-pw2", password);
    let registerHits = 0;
    page.on("request", request => { if (new URL(request.url()).pathname === "/api/register") registerHits++; });
    const registerResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/register");
    const busy = await page.evaluate(() => {
      const button = document.getElementById("btn-register");
      button.click();
      button.click();
      return button.disabled && button.getAttribute("aria-busy") === "true";
    });
    const registered = await (await registerResponse).json();
    const verificationIds = Object.keys(store._db.verifications);
    const vid = verificationIds[verificationIds.length - 1];
    const verifyToken = registered.devVerifyToken;
    check(busy, "注册请求中按钮 disabled 且 aria-busy=true");
    check(registerHits === 1, "注册双击只发一个请求");
    check(await page.isVisible("#pane-verify"), "注册成功进入邮箱确认页");

    const resendEmail = "unverified-" + Date.now() + "@example.com";
    await jsonPost(base, "/api/register", { email: resendEmail, password });
    await page.click("#btn-back-login3");
    await page.fill("#input-pw-email", resendEmail);
    await page.fill("#input-pw", password);
    await page.click("#btn-login");
    await page.waitForSelector("#step-unverified:not([hidden])");
    check(await page.isVisible("#btn-unverified-resend"), "未确认登录提供重发确认邮件入口");
    await waitForTurnstile(page);
    const resendResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/resend-verification-by-email");
    await page.click("#btn-unverified-resend");
    await resendResponse;
    check((await page.textContent("#msg-unverified")).length > 0, "未确认重发显示结果");

    check(!!vid && !!verifyToken, "本地注册暴露仅测试环境使用的确认凭据");
    if (vid && verifyToken) {
      const verified = await jsonPost(base, "/api/verify-email", { vid, token: verifyToken });
      check(verified.status === 200, "确认链接可完成邮箱确认");
    }

    await page.click("#btn-unverified-back");
    await page.fill("#input-pw-email", email);
    await page.fill("#input-pw", "wrong-password");
    const wrongLoginResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/login");
    await page.click("#btn-login");
    await wrongLoginResponse;
    check(/邮箱或密码不对/.test(await page.textContent("#msg-pw")), "密码错误时显示不泄露账号状态的统一提示");

    await page.click("#btn-forgot");
    check(await page.evaluate(() => document.activeElement && document.activeElement.id) === "input-forgot-email",
      "进入忘记密码页后焦点落在邮箱");
    await waitForTurnstile(page);
    await page.fill("#input-forgot-email", "unknown@example.com");
    const forgotResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/reset-request");
    await page.click("#btn-forgot-send");
    await forgotResponse;
    check(!/未注册|不存在/.test(await page.textContent("#msg-forgot")), "忘记密码结果不泄露邮箱是否注册");

    await page.click("#btn-back-login2");
    await page.click("#tab-code");
    check(await page.evaluate(() => document.activeElement && document.activeElement.id) === "input-email",
      "进入快捷登录后焦点落在邮箱");
    await waitForTurnstile(page);
    await page.fill("#input-email", email);
    const codeResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/send-code");
    await page.click("#btn-send");
    let codeBody = await (await codeResponse).json();
    await page.waitForSelector("#step-code:not([hidden])");
    check(await page.isDisabled("#btn-resend"), "随机码发出后重发按钮进入冷却");
    check(!!codeBody.devCode && await page.isVisible("#code-tools"),
      "本地 API 回传测试码时显示复制工具");
    await page.waitForFunction(() => !document.getElementById("btn-resend").disabled &&
      window.Turnstile && window.Turnstile.token());
    let resendHits = 0;
    page.on("request", request => { if (new URL(request.url()).pathname === "/api/send-code") resendHits++; });
    const resendCodeResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/send-code");
    const resendBusy = await page.evaluate(() => {
      const button = document.getElementById("btn-resend");
      button.click();
      button.click();
      return button.disabled && button.getAttribute("aria-busy") === "true";
    });
    codeBody = await (await resendCodeResponse).json();
    check(resendBusy && resendHits === 1, "随机码重发双击只发一个请求");
    check(await page.isDisabled("#btn-resend"), "重发完成后继续保持冷却禁用");
    const boxes = page.locator("#code-row .code-box");
    check(await boxes.count() === 6, "随机码输入提供六个有名称的输入格");
    check(await page.getAttribute("#code-row", "role") === "group" &&
      await page.getAttribute("#code-row", "aria-label") === "请输入 6 位验证码",
      "验证码输入格有整体可访问名称");
    const codeLabels = await boxes.evaluateAll(inputs => inputs.map(input => input.getAttribute("aria-label")));
    check(codeLabels.every((label, index) => label === "第 " + (index + 1) + " 位验证码"),
      "六个验证码输入格各有准确名称");
    const countdownCopy = (await page.textContent("#code-timer")) + (await page.textContent("#btn-resend"));
    check(/秒/.test(countdownCopy) && !/\d+s/.test(countdownCopy), "验证码倒计时使用中文单位");
    if (codeBody.devCode) {
      await boxes.first().evaluate((input, code) => {
        const event = new Event("paste", { bubbles: true, cancelable: true });
        Object.defineProperty(event, "clipboardData", { value: { getData: () => code } });
        input.dispatchEvent(event);
      }, codeBody.devCode);
      check((await boxes.evaluateAll(inputs => inputs.map(input => input.value))).join("") === codeBody.devCode,
        "粘贴六位验证码会逐格填入");
      const verifyResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/verify-code");
      await page.click("#btn-verify");
      await verifyResponse;
      check(await page.isVisible("#step-done"), "正确随机码完成登录");
    } else {
      check(false, "本地随机码响应含测试码");
    }

    await assertNoOverflow(page, "桌面登录流程");
    await context.close();

    const resetRequest = await jsonPost(base, "/api/reset-request", { email });
    const resetIds = Object.keys(store._db.resets);
    const rid = resetIds[resetIds.length - 1];
    const resetToken = resetRequest.body.devResetToken;

    const resetContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
    const resetPage = await resetContext.newPage();
    resetPage.on("pageerror", error => pageErrors.push(error.message));
    await resetPage.goto(base + "/reset/");
    check(await resetPage.isVisible("#reset-none"), "不完整重设链接显示明确状态");
    await resetPage.goto(base + "/reset/?rid=bad&token=bad");
    await assertPasswordToggle(resetPage, "btn-new-eye", "input-new-pw", "新密码");
    await assertPasswordToggle(resetPage, "btn-new-eye2", "input-new-pw2", "确认新密码");
    await resetPage.fill("#input-new-pw", password);
    await resetPage.fill("#input-new-pw2", password + "x");
    await resetPage.click("#btn-reset-confirm");
    check(/不一样/.test(await resetPage.textContent("#msg-reset")), "重设页拦截两次密码不一致");
    await resetPage.fill("#input-new-pw2", password);
    await resetPage.click("#btn-reset-confirm");
    await resetPage.waitForSelector("#reset-bad:not([hidden])");
    check(await resetPage.isVisible("#reset-bad"), "无效重设令牌显示失效状态");

    check(!!rid && !!resetToken, "本地重设申请暴露仅测试环境使用的重设凭据");
    if (rid && resetToken) {
      await resetPage.goto(base + "/reset/?rid=" + encodeURIComponent(rid) + "&token=" + encodeURIComponent(resetToken));
      await resetPage.fill("#input-new-pw", password + "2");
      await resetPage.fill("#input-new-pw2", password + "2");
      let resetHits = 0;
      await resetPage.route("**/api/reset-confirm", async route => {
        resetHits++;
        await new Promise(resolve => setTimeout(resolve, 100));
        await route.continue();
      });
      const resetResponse = resetPage.waitForResponse(response => new URL(response.url()).pathname === "/api/reset-confirm");
      const resetBusy = await resetPage.evaluate(() => {
        const button = document.getElementById("btn-reset-confirm");
        button.click();
        button.click();
        return button.disabled && button.getAttribute("aria-busy") === "true";
      });
      await resetResponse;
      check(resetBusy, "重设请求中按钮不可重复提交");
      check(resetHits === 1, "重设确认双击只发一个请求");
      check(await resetPage.isVisible("#reset-ok"), "有效重设链接完成密码重设");
    }
    await assertNoOverflow(resetPage, "移动端重设流程");
    await resetContext.close();

    for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
      const responsive = await browser.newContext({ viewport, serviceWorkers: "block" });
      const responsivePage = await preparePage(responsive, base, pageErrors);
      await assertNoOverflow(responsivePage, viewport.width + "x" + viewport.height + " 密码登录");
      await responsivePage.click("#btn-go-register");
      await assertNoOverflow(responsivePage, viewport.width + "x" + viewport.height + " 注册");
      await assertVisibleControlsNamed(responsivePage, viewport.width + "x" + viewport.height + " 注册");
      await responsivePage.waitForSelector("#ts-reg iframe");
      const widgetFits = await responsivePage.locator("#ts-reg").evaluate(slot =>
        slot.querySelector("iframe").getBoundingClientRect().width <= slot.getBoundingClientRect().width);
      check(widgetFits, viewport.width + "x" + viewport.height + " Turnstile 方框不超出表单");
      const visiblePanels = await responsivePage.locator(".auth-pane, .account-step").evaluateAll(elements =>
        elements.filter(element => element.offsetParent !== null &&
          (element.classList.contains("auth-pane") || element.id === "step-unverified" || element.id === "step-done")).length);
      check(visiblePanels === 1, viewport.width + "x" + viewport.height + " 同时只显示一个主面板");
      await responsivePage.click("#btn-back-login");
      await responsivePage.click("#tab-code");
      await assertNoOverflow(responsivePage, viewport.width + "x" + viewport.height + " 快捷登录");
      await assertVisibleControlsNamed(responsivePage, viewport.width + "x" + viewport.height + " 快捷登录");
      await responsivePage.click("#tab-pw");
      await responsivePage.click("#btn-forgot");
      await assertNoOverflow(responsivePage, viewport.width + "x" + viewport.height + " 忘记密码");
      await assertVisibleControlsNamed(responsivePage, viewport.width + "x" + viewport.height + " 忘记密码");
      await responsivePage.goto(base + "/reset/");
      await assertNoOverflow(responsivePage, viewport.width + "x" + viewport.height + " 重设密码");
      await assertVisibleControlsNamed(responsivePage, viewport.width + "x" + viewport.height + " 重设密码");
      await responsive.close();
    }

    check(pageErrors.length === 0, "浏览器流程没有未处理的页面异常" + (pageErrors.length ? "：" + pageErrors.join(" / ") : ""));
    check(protectedRequests.length >= 4 && protectedRequests.every(item => item.body.turnstileToken === "local-test-token"),
      "所有受保护浏览器请求都携带当前 Turnstile token");
  } finally {
    await browser.close();
    await close(server);
  }

  console.log(failures ? "\n❌ " + failures + " 项浏览器检查失败" : "\n🎉 浏览器账号流程全部通过");
  process.exitCode = failures ? 1 : 0;
}

main().catch(error => {
  console.error("浏览器测试自身抛异常：", error);
  process.exitCode = 1;
});
