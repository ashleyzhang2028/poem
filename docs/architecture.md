# 跬步 · 最终架构与 0/1 期实施方案

> 状态：**定稿待评审**。本文是 Issue #132 全部讨论的收敛稿：
> 把「登录 / 账号 / 权益 / 数据同步 / 部署 / 发信」这些散落在一轮轮讨论里的
> 结论压成**一张架构图 + 一份排期表 + 一组不可退让的边界**。
>
> ## 这份文件写什么、不写什么（2026-09-26 定，Issue #347）
>
> **写**：架构与排期 —— 前后端形状、数据分域、接口契约、合并规则、
> 权益与边界、不可退让的纪律、验收判据。
>
> **不写**：界面显示。某一页的文案、字号、留白、卡片怎么摆、圆键画几颗、
> 弹层长得什么样 —— 一律不写在这里。理由是这份文件**每个 PR 都要动一行**
> （写当轮的落地记录），几条分支并行时按行合并，越写越长、越容易撞车；
> 而撞的往往是「这一页长什么样」这种**改完就过期**的记录。
>
> 界面怎么改、验收怎么盯，看**代码与 README**（`README.md` 的「界面主题」
> 与「详情页里的表格」两节，以及 `css/` 里的令牌）；真机点一遍比写在文档里准。
>
> ⚠️ **新写的小节按这个尺子卡**：只写「改了哪一处形状、依据是什么、
> 怎么验证」，不写「界面看起来如何」。**同一件事不再写第二遍** ——
> 上一轮写过的口径不在这里复述。

> ⚠️ **界面流水账已整段清掉**（2026-09-26，Issue #369）：本文曾逐轮追加
> 「某一页长什么样」的落地记录（§4.72~§4.80 一族与多轮并流回执），
> 本轮整段删除；`docs/auth-design.md` 曾**整份重复过一遍**，同期去重。
>
> 关联：Issue #132、`docs/auth-design.md`（账号与邮箱登录，细节不在此重复）。
> 当前 SW 缓存版本：见 `sw.js` 的 `CACHE_NAME`（不在本文里抄一份 —— 抄了必然过期）。
> **「现在不做、以后做」的条目另有一份**：[`docs/todo.md`](todo.md) ——
> 那是唯一一处（短信登录真开通、微信小程序版、微信登录、
> 国内 CDN、额度真限额）。本文写的是**已排期**的顺序，两者别混。
> ⚠️ 「跨设备分档案」原来也在这张名单里，**2026-09-18 已落地**（§5.5），
> 按 todo.md 那条纪律（做完一件就搬走一件）从名单里拿掉了。
> ⚠️ 「头像上云」同样已落地 —— **2026-09-19 用户裁决真做**（Issue #163），
> 见 **§4.21**：上一版那套「固定字集 + 固定四色」整块删掉，改成
> 「用户名首字 + 可上传图片（本地压缩 + 方形裁切 → Supabase Storage）」。
>
> 本文只回答三件事：
> 1. 免费版 supabase 能不能不休眠，值不值得为它做
> 2. 最终架构是什么（前端 / 后端 / 账号 / 发信 / 存储）
> 3. 0 期与 1 期具体做什么、怎么验收

---

## 0. 一句话结论

**用 Supabase，免费版不休眠，但它只当「账号目录」和「跨设备进度库」；
发信不走 Supabase，走自己的 `/api` 云函数（**主 Resend**；SendGrid 已转向收费，见 §2.5）；
前端不上 Next.js，继续静态站；后端**每个业务需求一个函数**，不合并成框架。**

> ⚠️ **原始口径是「不超过 6 个 Serverless 函数」**，2.2（权威发放）把它变成 **9 个**，
> 3 期 P0（古诗词大会判分）再加 1 个，Issue #197（完整登录流程）再 +7，
> Issue #163（头像上云）再 +1 —— 业务上是 **19 条路由**。
> 这条改动是有意的，理由不是「想要更多」，而是**原来那 6 个里没有一处能写
> `accounts.plan`** —— 于是「权益由服务端判定」（§2.4 第 8 条）这句话在代码里
> 一直是一条断链：库里所有账号的 `plan` 永远是 `free`，只有手改库才发得动。
> 见 §4.14。**「不超过 6 个」要守的是「不引入框架 / 不引入微服务」那条纪律，
> 不是这个数字本身** —— 所以现在写成「每个业务需求一个函数」，并逐条列出
> 「为什么不能更少」（§2.2）。
>
> ⚠️⚠️ **Issue #205：Vercel Hobby 档一个部署最多 12 个 Serverless 函数。**
> 19 条路由按「一个文件 = 一个函数」数就是 19 个，构建**直接失败**：
> `No more than 12 serverless functions can be added to a deployment on the
> hobby plan`。所以「每个业务一个文件」这条纪律**保留**，但部署时收口成
> **一个函数**（§2.2 末尾那张「函数数」表）：
>
> - 19 个实现文件放在 `api/_routes/`（`_` 开局 = Vercel 不当函数）；
> - `api/handler.js` 是**唯一那个函数**（固定路径），按
>   `api/_lib/routes.js` 那张**唯一的路由表**把请求交给 handler；
> - `vercel.json` 里**一条 rewrite**（`/api/:path*` → `/api/handler?__path=:path*`）
>   把外部地址接进去。
>
> **外部 URL 一个都没变。** 档位若不是 Hobby，把 `api/_routes/*.js`
> 挪回 `api/*.js` 即可，一行代码不用改。
>
> ⚠️ **收口必须是「固定函数 + 一条携带原路径的 rewrite」。** `index.js`
> 目录兜底和 `[...path].js` 动态入口都曾在线上返回平台层 404。详见 §2.2.1.1。

```
浏览器（静态 PWA，Vercel 托管，kuibu.app）
  │  js/auth-core.js            ← 已有，纯逻辑，零 DOM
  │  js/sync-store.js           ← 新增，ProgressStore 的远端实现
  ▼
api（同一个 Vercel 项目里的 /api/*，19 条路由 · 部署时收口成 1 个函数，见 §2.2）
  ├─ /api/send-code      → Resend 主（不花钱；SendGrid 已收费，见 §2.5）
  ├─ /api/verify-code    → 校验 → 签发会话（HttpOnly Cookie）
  ├─ /api/me             → {uid, plan, features[]}   ← Pro/Max 唯一合法挂载点
  ├─ /api/sync/pull      → 拉服务端进度（增量）
  ├─ /api/sync/push      → 推本机进度（增量、按条覆盖）
  ├─ /api/account        → DELETE 注销（含数据导出）
  ├─ /api/admin/grant    → POST 发放 / DELETE 收回（2.2 权威名单，服务端角色闸）
  ├─ /api/admin/grants   → POST 看名单（uid + 明文邮箱，只列发过层级的那几条）
  └─ /api/game/answer    → POST 判分（3 期 · **不花钱**：用仓库里的 js/quiz.js，不接 AI 商）
  ▼
Supabase（免费版，Postgres + 一张 accounts 表 + 一张 progress 表）
  └─ 由 GitHub Actions 定时唤醒（见 §1）
```

**三条不可退让的边界（沿用 `docs/auth-design.md` §1）：**
1. **不注册也能用全部功能** —— 登录只增加「数据不丢 + 跨设备」，不拿任何现有功能当人质
2. **打开即用、可离线** —— 首屏不许因为有了后端而变慢；断网照常背
3. **不假装配齐了** —— 代码实现到哪一步，`/privacy/` 与 `/terms/` 就如实写到哪一步

---

## 1. supabase 免费版不休眠：可行，但必须认清代价

### 1.1 为什么它会休眠（官方口径）

Supabase 免费档（Free plan）的官方规则：

| 项 | 免费档 |
|---|---|
| 活跃项目数 | 2 个 |
| 数据库 | 500 MB |
| 月活用户（MAU） | 50,000 |
| 出口流量 | 5 GB / 月 |
| **空闲暂停** | **项目连续 7 天没有任何请求 → 自动暂停（paused）** |
| 唤醒方式 | 到控制台手工点，或发一个能打到数据库的请求让它自动恢复 |

暂停不是「睡一会儿」，是**整个项目停机**：数据库不可连、Auth 不可用、
REST API 全部返回错误。对用户的表现是「打不开了」，而不是「有点慢」。

> ⚠️ 这条是本方案里**唯一一个会直接砸在用户身上**的平台限制。
> 用户背了一个月，第 8 天打开发现进度拉不下来 —— 这是产品级事故，必须在架构里消掉。

### 1.2 让它不休眠的四种办法（按推荐度排序）

#### 办法 A：GitHub Actions 定时探活（**推荐，零成本，唯一真解**）

原理：暂停的判定是「7 天内没有任何请求」。那么**每 5 天发一个真请求**即可。

本项目现成的条件：代码已经在 GitHub（`ashleyzhang2028/poem`），
`.github/workflows/` 加一个 cron 就完事，**不引入任何新服务、不需要服务器**。

```yaml
# .github/workflows/keepalive.yml
name: supabase-keepalive
on:
  schedule:
    - cron: '0 3 */5 * *'      # 每 5 天一次，留 2 天缓冲
  workflow_dispatch:           # 也留一个手动按钮
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - name: ping supabase
        run: |
          curl -sS -o /dev/null -w '%{http_code}\n' \
            "${{ secrets.SUPABASE_URL }}/rest/v1/accounts?select=uid&limit=1" \
            -H "apikey: ${{ secrets.SUPABASE_ANON_KEY }}" \
            -H "Authorization: Bearer ${{ secrets.SUPABASE_SERVICE_KEY }}"
```

**四个必须做对的地方，否则探活本身会失效：**

1. **必须打到数据库**，不能只 ping 域名或健康检查页 —— Supabase 的状态页
   与根路径不触发数据库活动，只有 PostgREST / Auth 的真实查询算「活动」。
2. **必须每 5 天，不能每 7 天** —— GitHub 的 `schedule` 在高负载时可能延迟数小时，
   偶尔会跳过（官方文档明确：「可能延迟、在高负载时可能被丢弃」）。
   每 5 天一次，即使偶尔跳过一次也仍在 7 天窗口内。
3. **GitHub Actions 对 60 天无提交的仓库会停掉定时任务** —— 本项目天天在改，不成问题；
   但要在 workflow 里留 `workflow_dispatch` 手动口，万一停了能一键补上。
4. **探活失败必须能被发现** —— curl 的非 2xx 要让它红，否则「探活挂了 3 个月」
   会以「某天用户突然登不上」的形式暴露出来。上面的 `-w '%{http_code}\n'`
   配合 `-f` 或后续断言即可。

**这条办法的真实成本：** 每 5 天一次请求，一个月 6 次。
免费档流量 5 GB/月，这个量级可以忽略。

#### 办法 B：把邀请来的「每日真实访问」当探活（**不推荐作为唯一手段**）

有真实用户访问就是真请求，理论上不需要额外探活。**但不能靠它**：
- 跬步现在「打开即用、未登录不用后端」，绝大多数访问**根本不碰 supabase**
- 一旦连续 7 天没人发起登录/同步请求（比如一个寒假），项目就暂停，
  而**第一个想登录的用户恰好撞上暂停**——最坏的时机

所以 B 只能当 A 的补充，不能替代 A。

#### 办法 C：UptimeRobot / cron-job.org 之类的免费监控（**备选**）

可以，但它是**多一个第三方**：多一个能访问你数据库的账号、多一条要写进隐私条款的
数据处理者。既然 GitHub Actions 已经现成，没有理由再引一个。

#### 办法 D：升级 Pro（$25/月）（**现阶段不做**）

这是唯一「官方保证不休眠」的办法，也是唯一能拿到：
- 不暂停的 SLA
- 每日自动备份 + 7 天 PITR
- 可自选区域

**判断：现阶段不做。** 理由不是钱，是**顺序错了** ——
一个还没有一个付费用户的产品，先付每月 175 元保「后端不睡」，
而它的核心问题（没有主体资质、收不了钱）一点没解决。
（顺带：用户 2026-09-17 已决定**不做收费**，「收不了钱」这件事从「还没做到」
变成了「不做」—— §5.0。所以这里更没有必要为「后端不睡」付月费。）
探活方案在工程上等价，只在「忽然被 DDoS / 数据库爆掉」这类场景有差别，
而那时你早就该升级了。

### 1.3 但请记住：探活只是「可用性兜底」，不是「可靠性方案」

即使不休眠，免费档还有几条**探活解决不了**的限制：

| 限制 | 影响 | 应对 |
|---|---|---|
| **没有自动备份**（免费档无 PITR） | 误删数据 = 数据永久消失 | 每周一次 `pg_dump`（同样用 GitHub Actions）导出到仓库 artifact |
| 数据固定在美国 / 新加坡等共享区域，**不能自选** | 机房位置不可控 | 与合规无关（本站不以「国内项目」为前提，见 §4.2）；只按「最小化上传」设计 |
| 出口流量 5 GB/月 | 大文件不能走它 | 进度数据是 KB 级，不会触到 |
| 无 99.9% SLA | 平台故障只能等 | **进度数据必须本机也是完整副本**（见 §3.2 的「本机优先」） |

**最后这条最重要，它决定了整个同步架构的形状：**
> **supabase 里的进度永远不是唯一副本。本机 localStorage 始终是完整、可用的那一份。**
> 后端挂了、暂停了、欠费了，用户照样能背，只是不同步而已。

---

## 2. 最终架构

### 2.1 全景图

```
┌──────────────────────────────────────────────────────────────────┐
│  浏览器（静态 PWA · kuibu.app · Vercel）                          │
│                                                                  │
│  ┌─ 视图层（14 个 index.html，不动）────────────────────────┐    │
│  │  首页 /poems/ /library/ 八部集子 /search/ /progress/ /mine/      │
│  │  设置整页 /settings/，再拆二级页 /settings/{general,          │
│  │  recite,lists,reader}/（入口是 /mine/ 右上角那颗齿轮）        │
│  └────────────────────────┬───────────────────────────────┘    │
│                           │ 只认 window.ProgressStore            │
│  ┌─ 存储层（0 期新增 js/progress-store.js）─────────────────┐    │
│  │  ProgressStore.scope() → 'local' | 'account'             │    │
│  │     ├─ local   ：LocalAdapter（localStorage，与今天逐字一致）│   │
│  │     └─ account ：SyncAdapter（本地写 + 后台增量推）        │    │
│  └────────────────────────┬───────────────────────────────┘    │
│                           │                                      │
│  ┌─ 认证层（已有 js/auth-core.js + 新增 js/auth-api.js）────┐    │
│  │  AuthCore（纯逻辑、零网络） + transport（可替换实现）      │    │
│  │     本期 transport = local（mailto 已废弃，见 auth §7.1）  │    │
│  │     1 期 transport = fetch('/api/...')                    │    │
│  └────────────────────────┬───────────────────────────────┘    │
└───────────────────────────┼──────────────────────────────────────┘
                            │ fetch（同源，无 CORS）
┌───────────────────────────▼──────────────────────────────────────┐
│  Vercel Serverless Functions（同一项目的 /api/*，Node 20）         │
│                                                                  │
│  /api/send-code   POST  身份归一化 → 频控 → 生成码 → 发信 → 存哈希  │
│  /api/verify-code POST  校验码 → 建/取账号 → 签发会话 → Set-Cookie │
│  /api/me          GET   读会话 → {uid, email, plan, features[]}   │
│  /api/sync/pull   POST  {since} → 增量进度                        │
│  /api/sync/push   POST  {recs[]} → 按条合并写回                    │
│  /api/account     DELETE 注销（先导出、再删行）                    │
│  /api/avatar      POST   头像上传（裸字节 → Supabase Storage）  ← #163│
│  /api/avatar      DELETE 删掉云端那张（回到首字印）             ← #163│
│                                                                  │
│  ── Issue #197：完整登录流程 ──                                    │
│  /api/register           POST 邮箱 + 密码 → 建号(待确认) + 发确认信 │
│  /api/login              POST 邮箱 + 密码 → 同一枚会话             │
│  /api/verify-email       POST 确认邮件里那条链接（不需登录）        │
│  /api/resend-verification POST 重发确认邮件（要登录）              │
│  /api/resend-verification-by-email POST 同上，**匿名**（登不进来   │
│                          的人正是最需要那封信的人）                │
│  /api/reset-request      POST 忘记密码 → 发重设邮件（不泄露存在性）  │
│  /api/reset-confirm      POST 新密码 + 吊销全部会话                │
│  /api/admin/accounts     POST 账号名录（含明文邮箱，只读，管理员）   │
│  /api/diag               GET  自助排查：会话 / 库读 / 库写逐条判据   │
│                          （**只报形状与 HTTP 状态，永不回密钥**）← #225│
│                                                                  │
│  发信适配层（transport，可替换）                                   │
│    ├─ resend.js     主选（100 封/天、3000/月；数据落美国）          │
│    └─ sendgrid.js   备选（已转向收费 —— 只有付费账号才配，见 §2.5） │
└───────────────────────────┬──────────────────────────────────────┘
                            │ supabase-js（service key，仅服务端）
┌───────────────────────────▼──────────────────────────────────────┐
│  Supabase（免费档，探活见 §1.2 A）                                 │
│    accounts      (uid, email, email_hash, login_count,            │
│                   password_hash, password_salt, email_verified_at,│
│                   plan, created_at…)                              │
│    codes         (code_id, uid, purpose, code_hash, salt, expires…)│
│    verifications (vid, uid, token_hash, salt, expires…)   ← #197  │
│    resets        (rid, uid, token_hash, salt, expires…)   ← #197  │
│    progress      (uid, child_id, poem_id, payload jsonb, …)       │
│    sessions      (sid, uid, exp, revoked)                         │
└──────────────────────────────────────────────────────────────────┘
```

### 2.3 前端为什么**不**上 Next.js

这是本轮最该说清的一条，因为它是你最初的问题之一。

**Next.js 能带来的东西，这个项目一个都不需要：**

| Next.js 的能力 | 跬步需要吗 | 为什么 |
|---|---|---|
| SSR / ISR（服务端渲染） | ❌ | 内容全在客户端、本地生成，**没有任何一页的内容依赖服务端** |
| 路由框架 | ❌ | 13 个静态页面已经跑通，URL 约定（目录化、无 `.html`）是刻意的 |
| API Routes | ⚠️ 部分需要 | 但 Vercel 的 `/api/*` **原生就支持**，不需要 Next.js |
| React 组件化 | ❌ | 现在 25 个模块全是 IIFE + `window`，逻辑层 0 行 DOM（见下） |
| 图片优化 / 字体优化 | ❌ | 字体已**手工子集化**自托管（11 MB，比 Next.js 的自动优化更可控） |
| 打包器 / tree-shaking | ⚠️ 想要 | 但可以用 **不带框架的 Vite/Rollup 单独解决**，成本远低于上 Next.js |

**上 Next.js 的代价（真实存在，不是理论风险）：**

1. **26 个测试文件、12730 行测试几乎全部返工** —— 它们是 jsdom（加载真实 HTML）+
   源码扫描 + puppeteer。改成 React 后 HTML 是运行时生成的，
   「页面加载 js/storage.js」这类断言的对象不复存在
2. **`sw.js` 的缓存策略要重做** —— 现在是「静态资源缓存优先 + 导航在线优先」，
   写得很清楚（`README.md` 的 Service Worker 约定）。Next.js 的资源指纹变了，
   那套约定要重新推一遍
3. **首屏会变慢** —— 现在是「一个 HTML + 4 个字体 + 按需数据」，秒开。
   Next.js 客户端组件 + hydration 至少要加一个 runtime chunk，
   而**离线优先是跬步最硬的产品特性**，不能拿它换架构先进性
4. **PWA 离线承诺要重新验证** —— app shell 预缓存的清单会变（`PRECACHE` 现在是手写的，
   这恰恰是它的优点：改了什么、缓存什么，一眼看得见）

**判断：不迁移。** 如果你想要打包器，正确做法是
**只把 `js/` 那 25 个模块换成 ES modules + Rollup，页面保持静态 HTML 不动** ——
这是 0 期顺带能做的事（见 §3.1），成本约 2 人日，收益是 tree-shaking + 依赖显式化，
且**不需要动任何一页 HTML 的结构**。

#### 还剩多少（实话）

| 未做 | 部数 |
|---|---|
| 外国文学 | 113（书目 446，已交 333） |
| 其中：苏联 12 · 古希腊 15 · 意大利 11 · 奥地利 9 · 西班牙 9 · 瑞典 6 · 古罗马 6 · 印度 6 · 古印度 6 · 挪威 4 · 丹麦 3 · 芬兰 3 · 阿拉伯 3 · 黎巴嫩 3 · 波兰 3 · 朝韩 2 · 爱尔兰 2 · 智利 2 · 其余各 1 |

`sw.js` 未动（按前例，留给这一组的最后一个 PR）。

### 4.117 古诗词大会返工 P0/P1：三个具体 bug + 「正式考试」改名「考试」（2026-09-30 · 用户反馈）

用户原话：飞花令看不懂是不是按飞花令玩法做的、范围选了「小学」答案却还是全部、
点「看答案」下面某一篇直接跳回 `/poems/` 首页、有的页面两个「换范围」按钮；
并要求把「正式考试」改名「考试」，「玩法」统一叫「题型」。全套计划先写在
`docs/dahui-redesign-plan.md`，本节只记 P0（三个 bug）与 P1（改名）这两步落地。

#### P0：三个 bug 的根因，都在 `js/game.js`

| 症状 | 根因 |
|---|---|
| 选了「小学」，飞花令「看答案」仍混全部范围 | `renderFly()` 一直用未过滤的 `corpus()`，`state.setup.scope` 从没读过 |
| 点「看答案」下面某一句，整页跳回 `/poems/` | `openPoem()` 的 `hasReader()` 判据在独立页 `/dahui/`（没有阅读器挂载点）恒为假，退路是 `location.href` 整页跳走，答题进度全丢 |
| 两个「换范围」按钮 | `renderSetup()` 的「卷面设置」屏，`.game-head` 与「考什么范围」两张卡各放了一颗，同一件事两处入口 |

**改法**：新增 `scopedCorpus()`（`corpus()` 经 `Ex.select()` 按当前 scope 过滤），
`renderFly()` / `startFly()` / `checkSaid()` 三处都改用它；`openPoem()` 在没有
阅读器时改为原地弹一张只读原文卡（复用 `css/style.css` 现成的 `.modal` 系样式，
新增 `renderPoemOverlay()`，`Esc` / 点遮罩 / 点 × 都能关，不清空答题状态）；
「考什么范围」整张卡删掉（只剩一颗按钮的卡没必要单开一张），范围信息折进
`.game-head` 卡的提示行，跟着卡内唯一的「换一个题型」走。

**顺带修的一个关联 bug**：修 P0 时发现飞花令屏的返回按钮（`data-game-back`）
点了之后会把 `state.mode` 设成 `"setup"`，但飞花令从没写过 `state.pending`——
落进 `renderSetup()` 判 `!m || !v` 直接返回空字符串，页面一片空白。改法：
飞花令没有「卷面设置」这一层，它的返回按钮直接回首页（`state.mode = ""`），
不经过 `setup`。

#### P1：「正式考试」→「考试」，「玩法」→「题型」

键名不改（`exam.formal` 原样），只改显示名，逐点过 `docs/dahui-redesign-plan.md`
§四的表：`js/exam.js` VARIANTS、`js/entitlement.js` CAPS、`js/game.js`（页头
`setSub()` 与三处「换一个题型」按钮文案）、`dahui/index.html` 与 `poems/index.html`
的说明文案、`README.md`、`docs/auth-design.md` 的能力对比表、
`test/entitlement.test.js` 的断言文案。**历史决策记录里旧的「正式考试」
「玩法卡」措辞不回改**（那是当时的既成事实，改了等于篡改记录）——
新决策只在这里、往后的新文案里生效。

**验证**：`test/entitlement.test.js` 等 26 层全绿；真机核过飞花令范围过滤
（选「小学」→ 19 句，逐句核对全在 119 篇范围内）、原文卡原地弹出不跳页、
「换一个题型」从飞花令屏正确回首页。`sw.js` v306 → **v307**（`js/` 改过）。

#### P2：考试历史上服务器（只记「考试」，不含模拟考试）

新表 `public.exam_records`（`eid/uid/scope_id/scope_label/size/score/total/
duration_sec/items/created_at`，`items` 是 jsonb 存逐题对错），行级安全全开、
无策略，走服务端 service key（与 `reports`/`feedback_*` 同一套规矩）。三个
接口收在一条路由上：`GET /exam/records`（拉自己的历史）、
`POST /exam/records`（`op:"create"` 交卷即写一条 / `op:"delete"` 删自己那条，
删别人的 404，不是 403——不透露「这条属于谁」）。写入前查 `exam.formal`
门槛（Max），题量为 0 拒收；`items` 截到 60 条、`scopeLabel` 截到 40 字，
超限**截断不是拒绝**（卷子本身仍然存得下）。

`js/game.js` 的 `submit()` 在 `state.mode === "formal"` 时，本机 `Ex.saveRecord()`
之外**追加**一次 `AccountApi.examRecordCreate()`（异步、失败不挡渲染，只是
`state.graded.cloudSaved` 拿不到 true）；`mock`/`practice` 两种形态不动，
仍然只落本机 `poem_exam_v1`。首页新增「考试记录」入口（登录后可见），
掀出的历史屏复用「飞花令没有卷面设置」那条返回逻辑（直接回首页，不经过
`setup`），列表每行「分数 · 范围 · 时间」+ 一颗删除键（`window.confirm` 二次确认，
与 `js/family-ui.js` 等处同一条纪律）。

**验证**：新增 `test/exam-records.test.js`（21 条：门槛 / 写入 / 按账号隔离 /
删除权限 / 字段截断 / 前端接线），`bash test/run.sh` 27 层全绿。
`sw.js` v307 → **v308**。

⚠️ **手动过服务端联调前先看这条**：本机 `node scripts/serve.js` 接的是
`.env` 里的真 Supabase，不是 `memoryStore`；`exam_records` 这张新表要先在
Supabase 控制台跑一遍 `api/_lib/schema.sql`（或至少这一节新增的那一段），
否则浏览器手测会看到 404 "missing_table"——自动化测试用 `memoryStore`，
不受这个影响，照样全绿。

#### P3：游戏感——倒计时条、答题音效、动画反馈、每次交卷都有的成绩横幅

按用户澄清（不是「90 分才特殊」，是**每一次交卷都要有醒目横幅**）落地：

- **成绩横幅**：`renderPaper()` 在 `state.graded` 有值时于卷面**最上方**插入
  `renderScoreBanner()`，按百分制三档配色——`≥90` 金（`--gold`，「太棒了！」）/
  `60~89` 绿（「不错，继续加油！」）/ `<60` 蓝（「再练一次，会更好」），**没有一档
  是警示色**，不做「不及格」的否定字眼。数字从 0 用 `requestAnimationFrame`
  三次方缓出滚到目标值（`animateScoreBanner()`），`state.gradedAnimated` 挡
  重复播放——`submit()` 交卷后为了推送「考试」记录到服务器会异步再 `render()`
  一次，若不挡这一位，数字会从 0 再滚一遍。
- **倒计时可视化**：`formal`（考试）原本只有纯文字「剩余 mm:ss」，加一条
  `.game-timer-bar`（`startTimer()` 每秒之外顺手更新 `width` 与 `.warn` 类），
  剩余 ≤60 秒变红并配一个透明度呼吸动画，不是干巴巴一行字。
- **答题音效**：`js/game.js` 用 Web Audio 振荡器**现场合成**（不带音频文件，
  离线仍可用）——答对是上扬双音（880→1318.5Hz），答错是低沉单音（220Hz）。
  只在 `judge !== "after"` 的即时判分题型（题库 / 模拟考试）触发，**考试
  交卷前不给对错**这条老规矩不受影响（没有「声音提前泄题」这回事）。
  开关 `poem_sound_v1`（默认开），登在 `settings/reader/index.html`
  「答题音效」胶囊开关，与 `js/sync-coverage.js` 的设备域一类
  （跟设备走，不跟账号走——换一台没插耳机的设备不该被迫继承静音）。
- **动画反馈**：选中选项那一刻，`flashOption()` 找到刚渲染出的那颗按钮，
  答对是缩放+绿色描边一闪（`gameOptFlashOk`），答错是左右轻抖
  （`gameOptFlashBad`），`animationend` 一次性收尾，不残留常驻类名。

**验证**：真机核过（Chromium + CDP）——`小学` 范围下答题触发 `game-opt-flash-bad`
类名、交卷后 `.game-score-banner` 按分数出正确档位（0 分→蓝、90 分→金，
逐字核对文案与数字），`bash test/run.sh` 27 层全绿。`sw.js` v308 → **v309**。

### 4.118 补回被误删的同步边界总表：`pinyin_fix:v1` 与 `poem_pinyin_global_v1`（2026-09-30）

**问题**：`test/pinyin-fix.test.js` 有一条断言「架构文档里记了这一条（设计记录）」——
注音勘误层的设计记录必须在文档里留着一份。这条断言从 2026-09-19 起一直在守，
但 §4.33「同步边界总表」与那一节在 `docs/architecture.md` 的几轮「只留架构、
删界面流水账」里被整节删掉了，断言于是变红 —— 这正是它该有的反应：
**删掉的不是界面文案，而是一条数据分域的落地依据**。

**这不是「模板里少了两个字」**：`js/sync-coverage.js` 里那两行（个人勘误
`poem_pinyin_fix_v1` 上云、全站勘误缓存 `poem_pinyin_global_v1` 不上云）是
成对的口径 —— 只留一行会看不出「为什么一个上云、另一个不上」。所以本节把
被删的那两条口径按现在的代码复核后重记一次，不是把旧文本抄回来。

#### 一、个人勘误（`poem_pinyin_fix_v1`）：上云，一行 progress

| | |
|---|---|
| 本机键 | `poem_pinyin_fix_v1`（按子用户分家 —— 兄弟姐妹可以各有各的勘误口径） |
| 云端行号 | `pinyin_fix:v1`（progress 里的一行，**不新开表**） |
| 合并规则 | **谁最后改谁赢**（整份一份表；与自选集合、每日加背同源） |
| 冲突裁决 | **不进** —— 它是「一个确定结果」的表，按时间戳判新旧就够 |
| 上限 | 客户端 500 条；服务端 `api/_lib/core.js` 的 `sanitizePinyinFix()` 逐字段截断（句 120 字、读音 12、那个字 1） |
| 为什么上云 | 用户在《滕王阁序》里核对过的那一处，换台设备、换个浏览器也该是对的 |

服务端白名单是第三条守卫：**半条勘误整条丢掉** —— 缺篇 / 缺句 / 缺读音的条目
收下也不会生效，收下只会让用户以为「钉过了」。

#### 二、全站勘误缓存（`poem_pinyin_global_v1`）：**不上云**

权威那一份在服务端 `public.pinyin_proposals`（`status=approved`），
客户端这把键只是 `GET /api/pinyin-fixes`（公开、不认登录）应答的**只读缓存**，
几小时 TTL 后台自动刷新。参与同步的下场是「一台设备批准的东西，**靠同步而不是
靠服务端审核**就传到了别的设备」—— 绕开了审核这道闸。个人勘误是本机 / 本账号
自己核对的那一份，与它是两回事。

#### 三、守卫

- `test/sync-coverage.test.js`：扫 `js/` 下所有 `poem_*` 字面量对表 ——
  漏登记一把键直接红；并校「表里说上云的，`ProgressStore.scopes()` 必须
  `local:false`」与「两端行号逐字一致」。
- `test/pinyin-fix.test.js`：数据层 / 引擎层 / 页面层 / 同步层 / 服务端逐层守，
  外加本节这条「文档里记着」——它守的是**口径有没有落地记录**，
  不是某一句话的措辞。

**验证**：`bash test/run.sh` 全绿。
