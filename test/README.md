# 测试目录说明（Issue #278 起）

## 一句话

**只留功能验证。** 界面相关的测试整层删除。

用户 2026-09-25 的原话：

> 「所有测试文件，除了功能验证的测试之外，删除尽可能多的其他测试，
> 特别是界面相关的测试，**我的目的是构建时间变短**。」

## 跑法

```bash
bash test/run.sh      # 等价于 npm test，本机约 6.6 秒
```

**一个依赖都不用装** —— 这里全是纯 Node + `vm` 沙盒。
`jsdom` / `puppeteer` / `playwright` 都已从 `package.json` 与 CI（`.cnb.yml`）
里去掉。

## 删掉了什么

| 类别 | 原先的文件（已删） |
|---|---|
| 真浏览器 | `pwa.test.js`、`auth-browser.test.js`、`pwa-env.js` |
| UI / 响应式 / 布局 | `ui.test.js`、`ui-consistency.test.js`、`layout.test.js` |
| 页面结构 | `mine-page` / `settings-nav` / `plans-page` / `print-page` / `poems-page` / `library-nav` / `game-page` / `account-pages` / `account-bind` / `account-entry` |
| 文案 / 删除守卫 / 样式 | `page-copy` / `profile-removed` / `theme` / `legal` |
| 组件层 | `print` / `self-check` / `turnstile-slot` / `register-legacy-db` |
| 其余纯界面 | `daily-extra` / `auto-read` / `avatar-upload` / `username` / `title-seq` / `truncation` |

留下的文件里原先夹着的**页面段**也一并摘掉（`classic` / `engine` /
`collections` / `canonical` / `progress` / `review-models` / `search` /
`sync` / `cross-device` / `entitlement` / `family` / `helper` / `pinyin-fix`
与七部集子那几层）。

⚠️ 摘页面段时不是简单「删掉结尾」：有几处（`collections` / `canonical`）
本来靠 jsdom 只是要一个 `window` + `localStorage`，正文里跑的全是数据层断言。
这些换成了 `vm` 沙盒 —— 断言一条不减，只是不再起 DOM。

## 界面回归改由谁盯

**人点一遍**（`npm start` 起本地服务），或者真机验收。

不再由构建时间替我们盯 —— 那一层慢（起 jsdom 几百毫秒、起 Chrome 几分钟）、
脆（挪一处入口、换一句文案就红），而红的往往不是功能，是「界面跟上次长得不一样」。

## 想捡回某一层

```bash
git log --diff-filter=D --name-only -- test/ | head
git show <那个 commit>^:test/pwa.test.js > /tmp/pwa.test.js
```

⚠️ 别顺手把 CI 里的 `install-deps`（`npm i jsdom@^26 puppeteer`）也捡回来，
除非真的重新引界面测试。已知的一个代价：原先 `pwa.test.js` 顶出来过一条**真 bug**
（`::placeholder` 的 computed style / 滑块几何，jsdom 量不到 `::after`）——
相应的样式口径仍写在 `css/` 的注释里，只是不再由测试看着了。
