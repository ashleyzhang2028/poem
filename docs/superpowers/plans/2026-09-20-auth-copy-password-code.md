# Auth Copy, Password Controls, and Code Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every password field an accessible SVG visibility control, make auth copy concise and professional, and refine the existing six-digit email-code entry.

**Architecture:** Keep the current login/reset page structure and state machines. Extend the existing `bindEye` behavior to all password fields, centralize the eye/eye-off SVG output in each page script, and preserve the six-input verification model while adding group semantics and concise labels. Update behavior and browser tests before each production change.

**Tech Stack:** Plain HTML/CSS/JavaScript, jsdom assertions, Playwright Chromium

---

### Task 1: Complete Password Visibility Controls

**Files:**
- Modify: `test/account-pages.test.js`
- Modify: `test/auth-browser.test.js`
- Modify: `login/index.html`
- Modify: `reset/index.html`
- Modify: `js/login.js`
- Modify: `js/reset.js`
- Modify: `css/account.css`

- [ ] **Step 1: Add failing structural and interaction assertions**

Require icon buttons beside `input-pw`, `input-reg-pw`, `input-reg-pw2`, `input-new-pw`, and `input-new-pw2`. Assert each button starts with `aria-label="显示密码"` and `aria-pressed="false"`. In Playwright, toggle each button and verify only its adjacent input changes type.

```js
const passwordControls = [
  ["btn-pw-eye", "input-pw"],
  ["btn-reg-eye", "input-reg-pw"],
  ["btn-reg-eye2", "input-reg-pw2"],
  ["btn-new-eye", "input-new-pw"],
  ["btn-new-eye2", "input-new-pw2"]
];
```

- [ ] **Step 2: Run the focused tests and observe failure**

Run:

```powershell
node test/account-pages.test.js
npm run test:auth-browser
```

Expected: missing confirmation-field controls and SVG/pressed-state assertions fail.

- [ ] **Step 3: Add the controls and shared state behavior**

Use an icon-only button adjacent to each password input:

```html
<button class="pw-eye" id="btn-reg-eye2" type="button"
        aria-label="显示密码" aria-pressed="false">
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.5" />
  </svg>
</button>
```

Update `bindEye` so it renders eye/eye-off SVG content and synchronizes `type`, `aria-label`, `title`, and `aria-pressed`. Bind both confirmation fields. Give `.pw-eye` a stable square target and size its SVG without changing the password-row width.

- [ ] **Step 4: Re-run focused tests**

Run:

```powershell
node test/account-pages.test.js
npm run test:auth-browser
```

Expected: all password controls toggle independently and both commands exit 0.

### Task 2: Tighten User-Facing Auth Copy

**Files:**
- Modify: `test/account-pages.test.js`
- Modify: `login/index.html`
- Modify: `reset/index.html`
- Modify: `js/login.js`
- Modify: `js/reset.js`
- Modify: `js/auth-api.js`

- [ ] **Step 1: Add failing copy assertions**

Assert normal auth UI no longer contains operational or conversational language:

```js
const authCopy = [LH, RH, LJS, RJS, read("js/auth-api.js")].join("\n");
["那颗", "console 通道", "npm run doctor", "SPF/DKIM/DMARC", "/api/diag", "被拦", "照旧"]
  .forEach(term => chk(!authCopy.includes(term), "账号文案不出现：" + term));
```

Assert the UI uses `确认密码`, `请再次输入相同密码`, `验证邮箱`, and concise connection errors.

- [ ] **Step 2: Run the account-page test and observe failure**

Run:

```powershell
node test/account-pages.test.js
```

Expected: assertions identify the existing long operational messages and inconsistent labels.

- [ ] **Step 3: Replace visible copy**

Apply these terminology and message rules:

```text
再填一次密码      -> 确认密码
两次要一样        -> 请再次输入相同密码
确认邮件/确认邮箱 -> 验证邮件/验证邮箱
确定              -> 验证并登录
请填满 6 位随机码 -> 请输入 6 位验证码。
重新发送（30s）   -> 重新发送（30 秒）
```

Replace internal configuration guidance with concise outcomes such as `验证邮件暂时无法发送，请稍后重试。` and `如问题持续，请联系管理员。` Keep diagnostics on `/self-check/`, not in normal auth messages. Preserve generic forgot-password success text and generic login failure text.

- [ ] **Step 4: Re-run focused tests**

Run:

```powershell
node test/account-pages.test.js
node test/turnstile-slot.test.js
```

Expected: concise-copy assertions pass without changing auth security behavior.

### Task 3: Refine Six-Digit Email Code Entry

**Files:**
- Modify: `test/account-pages.test.js`
- Modify: `test/auth-browser.test.js`
- Modify: `login/index.html`
- Modify: `js/login.js`

- [ ] **Step 1: Add failing semantic and countdown tests**

Require `#code-row` to expose one group label, six per-digit names, and Chinese countdown units. Browser assertions paste all six digits and verify every visual box receives one digit.

```js
chk(/id="code-row"[^>]*role="group"[^>]*aria-label="请输入 6 位验证码"/.test(LH),
  "验证码输入格有整体可访问名称");
chk(!/\d+s/.test(document.getElementById("btn-resend").textContent),
  "重发倒计时使用中文单位");
```

- [ ] **Step 2: Run tests and observe failure**

Run:

```powershell
node test/account-pages.test.js
npm run test:auth-browser
```

Expected: group semantics and Chinese countdown assertions fail.

- [ ] **Step 3: Implement concise code-entry semantics**

Add `role="group"` and `aria-label="请输入 6 位验证码"` to `#code-row`. Keep six numeric boxes, auto-advance, arrow/backspace navigation, and whole-code paste. Change per-digit labels from `随机码` to `验证码`, display the countdown as `剩余 M 分 SS 秒`, and render resend cooldown as `重新发送（N 秒）`.

- [ ] **Step 4: Run final verification**

Run:

```powershell
node test/account-pages.test.js
node test/turnstile-slot.test.js
node test/api.test.js
node test/self-check.test.js
node test/register-legacy-db.test.js
npm run test:auth-browser
git diff --check
```

Expected: every command exits 0 and `git diff --check` prints nothing.

No commit or push is performed; the working tree remains ready for the user to review and push.
