# Local Auth UX and Turnstile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every authentication journey testable on one local origin and align visible Turnstile challenges with the endpoints that enforce them.

**Architecture:** Keep the existing single-page login state machine and API modules. Remove false Turnstile gates from password login and reset confirmation, add request-pending protection to user actions, and extend the local server to dispatch `/api/*` through `api/handler.js`. Use existing jsdom tests for behavior and Playwright for real desktop/mobile rendering.

**Tech Stack:** Plain JavaScript, Node HTTP, jsdom, Playwright, Cloudflare Turnstile test configuration

---

### Task 1: Align Turnstile UI With Server Enforcement

**Files:**
- Modify: `test/account-pages.test.js`
- Modify: `test/turnstile-slot.test.js`
- Modify: `login/index.html`
- Modify: `reset/index.html`
- Modify: `js/login.js`
- Modify: `js/reset.js`

- [ ] **Step 1: Write failing contract assertions**

Assert that `login/index.html` has Turnstile slots only for `code`, `register`, `forgot`, `verify`, and `unverified`; that `reset/index.html` has no Turnstile slot or script; and that password login/reset confirmation do not call `turnstileBlocked`, `mountTurnstile`, or `TS.reset`.

```js
chk(!/id="ts-pw"/.test(LH), "密码登录不显示服务端不校验的 Turnstile");
chk(!/id="ts-reset"/.test(RH), "重设确认不显示服务端不校验的 Turnstile");
chk(!/turnstileBlocked\("msg-pw"\)/.test(LJS), "密码登录不做假前端闸");
chk(!/Turnstile|ts-reset/.test(RJS), "重设确认不加载 Turnstile");
```

- [ ] **Step 2: Verify the assertions fail**

Run: `node test/account-pages.test.js; node test/turnstile-slot.test.js`

Expected: failures identify `ts-pw`, `ts-reset`, and their client-side gates.

- [ ] **Step 3: Remove unsupported challenges**

Delete `#ts-pw`, `#ts-broken-ts-pw`, `#ts-reset`, and `#ts-broken-reset`; remove `pw` from `TS_SLOTS`; remove the password-login `turnstileBlocked` call and reset-page Turnstile configuration. Keep Turnstile token transport unchanged for protected methods in `js/auth-api.js`.

- [ ] **Step 4: Verify the focused tests pass**

Run: `node test/account-pages.test.js; node test/turnstile-slot.test.js`

Expected: both exit 0.

### Task 2: Prevent Duplicate Auth Submissions

**Files:**
- Modify: `test/account-pages.test.js`
- Modify: `js/login.js`
- Modify: `js/reset.js`
- Modify: `css/account.css`

- [ ] **Step 1: Add failing interaction tests**

Use a deferred fake API response, click each primary button twice, and assert only one request is issued while the button is disabled with `aria-busy="true"`. Cover login, registration, random-code send, forgot password, confirmation resend, and reset confirmation.

```js
button.click();
button.click();
chk(hits.filter(p => p === "/api/register").length === 1,
  "注册请求未完成时重复点击只发一次");
chk(button.disabled && button.getAttribute("aria-busy") === "true",
  "请求中按钮不可重复提交且向辅助技术报告忙碌");
```

- [ ] **Step 2: Verify duplicate requests fail the test**

Run: `node test/account-pages.test.js`

Expected: duplicate request count is 2 or buttons remain enabled.

- [ ] **Step 3: Add one pending helper per page**

Add a helper that stores the original button text, sets `disabled` and `aria-busy`, and restores state in both fulfillment and rejection paths.

```js
function pending(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.idleText = button.textContent;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    if (label) button.textContent = label;
  } else {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    if (button.dataset.idleText) button.textContent = button.dataset.idleText;
  }
}
```

Each submit function returns early while its button is disabled and restores state with a final Promise branch.

- [ ] **Step 4: Style native disabled state without layout shift**

```css
.account-btn:disabled {
  cursor: wait;
  opacity: .62;
}
```

- [ ] **Step 5: Verify interactions pass**

Run: `node test/account-pages.test.js`

Expected: exit 0 with one request per double click.

### Task 3: Serve Static UI and API on One Local Origin

**Files:**
- Modify: `test/api.test.js`
- Modify: `scripts/serve.js`
- Modify: `package.json`

- [ ] **Step 1: Add failing local-server integration test**

Export the server factory from `scripts/serve.js`, start it on an ephemeral port, and assert both `/login/` and `/api/config` respond successfully. Assert POST `/api/register` reaches the real handler and returns a structured validation response for an invalid email.

```js
const local = require("../scripts/serve.js").createServer();
await new Promise(resolve => local.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + local.address().port;
eq((await fetch(base + "/login/")).status, 200, "本地服务能打开登录页");
eq((await fetch(base + "/api/config")).status, 200, "本地服务同源挂载 API");
```

- [ ] **Step 2: Verify the integration test fails**

Run: `node test/api.test.js`

Expected: `/api/config` is 404 or `createServer` is unavailable.

- [ ] **Step 3: Extract and export `createServer`**

In `scripts/serve.js`, route any pathname beginning `/api/` to `require("../api/handler.js")`; otherwise retain existing static-file behavior. Start listening only under `if (require.main === module)` and export `{createServer, resolve}` for tests.

- [ ] **Step 4: Add a local auth command**

```json
"dev:auth": "node scripts/serve.js"
```

Document that local memory storage and console mail are expected unless environment variables are supplied.

- [ ] **Step 5: Verify same-origin integration passes**

Run: `node test/api.test.js`

Expected: exit 0 and both static/API probes pass.

### Task 4: Audit Complete Browser Journeys

**Files:**
- Create: `test/auth-browser.test.js`
- Modify: `package.json`
- Modify only if failures prove necessary: `login/index.html`, `reset/index.html`, `js/login.js`, `js/reset.js`, `css/account.css`

- [ ] **Step 1: Add a Playwright journey runner**

Start the exported local server with memory storage and console mail. In Playwright, intercept Cloudflare's script and expose a deterministic `turnstile.render` implementation that invokes the supplied callback with `local-test-token`.

Cover:

- Password login validation and wrong-password response
- Registration validation, matching-password requirement, Turnstile token transport, and confirmation handoff
- Random-code request, resend cooldown, edit-email, six-digit entry, and verification
- Forgot-password privacy-preserving success message
- Reset page missing-link, invalid token, password mismatch, and success states
- Unverified-login resend path

- [ ] **Step 2: Add responsive and accessibility checks**

Run each major screen at 1280x800, 390x844, and 320x568. Assert no horizontal overflow, one visible primary panel, visible inline messages, correct focused field after transitions, and buttons/inputs with accessible names.

```js
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
assert.equal(overflow, false);
```

- [ ] **Step 3: Run the browser test and record real failures**

Run: `node test/auth-browser.test.js`

Expected before repairs: any concrete layout, focus, loading, or transition defects fail with the affected journey name.

- [ ] **Step 4: Apply only evidence-backed UI repairs**

For each failure, add the narrowest assertion to `test/account-pages.test.js` or `test/auth-browser.test.js`, rerun to observe red, then update the owning HTML/JS/CSS. Do not alter unrelated visual language.

- [ ] **Step 5: Verify browser journeys pass**

Run: `node test/auth-browser.test.js`

Expected: all journeys and all three viewport sizes pass with no page errors or failed same-origin API requests.

### Task 6: Mount Turnstile Before Submit, Not On Submit (Issue #276)

**Files:**
- Modify: `test/turnstile-slot.test.js`
- Modify: `js/turnstile.js`
- Modify: `js/login.js`

- [x] **Step 1: Write failing assertions for the load-time order**

Boot `js/turnstile.js` in a VM with a *late* fake script (the sandbox only gets
`window.turnstile` when the fake `<script>` fires `onload`), mount while the script is
still on the wire, and assert: not `failed()`, `err === null`, no token yet, and that
`render()` really runs once the script arrives. Assert `js/login.js` mounts inside
`setMode()` (not only from a submit handler), calls `mountTurnstile(state.mode)` right
after `/api/config`, and that a URL-only shim (`configure()`), not Turnstile's real
script, is what gets loaded. Assert the panel swap does not wipe the token.

- [x] **Step 2: Verify the assertions fail**

Run: `node test/turnstile-slot.test.js` — the late-script case and the token-carry case
are red before the fix.

- [x] **Step 3: Make mount idempotent across panel swaps**

In `js/turnstile.js`, stop clearing `tokenValue` when the widget moves to another
container (expiry and post-submit `reset()` still own that), and re-render after the
script resolves when a widget already exists.

- [x] **Step 4: Move the mount point to page open and mode switch**

In `js/login.js`, add `preloadTurnstileScript()` at init (loads the Cloudflare script
while the user is still on the password screen) and keep `mountTurnstile(mode)` inside
`setMode()` so the box is already drawn when the user starts typing.

- [x] **Step 5: Verify**

Run: `node test/turnstile-slot.test.js; node test/account-pages.test.js` — both exit 0.

### Task 5: Final Verification

**Files:**
- Verify all modified files

- [ ] **Step 1: Run focused suites**

```powershell
node test/account-pages.test.js
node test/turnstile-slot.test.js
node test/api.test.js
node test/self-check.test.js
node test/register-legacy-db.test.js
node test/auth-browser.test.js
```

Expected: every command exits 0.

- [ ] **Step 2: Check diagnostics and formatting**

Run: `git diff --check`

Expected: no output and exit 0.

- [ ] **Step 3: Start the local server for user review**

Run: `$env:PORT=8080; npm run dev:auth`

Expected: server remains available at `http://localhost:8080/login/` and `/api/config` returns JSON.