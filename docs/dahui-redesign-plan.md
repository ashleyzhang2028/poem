# 古诗词大会重做计划（2026-09-30 立项）

> 本文只是**计划**，尚未实施。按用户要求分阶段落地，每阶段独立可测、可发布，
> 不在一个 PR 里混着改（参照 §4.66 的「推进顺序」纪律）。

## 一、用户诉求原文

1. 飞花令页面设计看不懂，不确定是否遵循飞花令玩法；范围选了「小学」，「看答案」
   里仍混着全部范围的句子；点「看答案」下面某一篇，直接跳回 `/poems/` 首页。
2. 有些页面有两个「换范围」按钮。
3. 全面梳理古诗词大会首页及四种题型页面，**把「玩法」统一叫「题型」**；
   **「正式考试」改名「考试」**；所有「考试」（不含「模拟考试」）的结果、
   逐题对错、历史记录，全部存服务器；用户可查看历史、可删除考试记录。
4. 四个题型页面缺练习/复习/考试的氛围：「考试」要不要倒计时、答对答错要不要
   音效（可在设置里关）、要不要动画、90 分以上是否在页面上部用绚丽大字显示分数……
   至少飞花令和「考试」要更生动活泼，像个游戏。

## 二、现状梳理（已读代码，不是猜的）

- 落点：`/dahui/` 独立页，挂 `js/quiz.js`（出题内核）+ `js/exam.js`（考试形态内核，
  纯逻辑无 DOM）+ `js/game.js`（渲染 + 交互，`PoemGame`）。
- 「玩法卡」目前是 4 张：`fly`（飞花令，`js/game.js` 自己实现）+ 3 种考试形态
  （`js/exam.js` 的 `VARIANTS`：`practice` 题库 / `mock` 模拟考试 / `formal` 正式考试）。
- 范围 `scope`：唯一来源 `SITE_BOOKS`，`Ex.scopes(corpus())` 算出「全部 / 单部集子 /
  小学·初中·高中」清单；用户在首页勾选，存 `state.scopes` → `state.setup.scope`。
- 考试记录：`formal`/`mock` 都有 `record: true`，但只存本机 `poem_exam_v1`
  （`js/exam.js` 的 `readRecords/saveRecord/clearRecords`），**不上云**，
  `js/sync-coverage.js` 里登记的理由是「设备域」。
- 门槛：`js/entitlement.js` CAPS 三键 `quiz.review`(Pro) / `exam.paper`(Max，模拟) /
  `exam.formal`(Max，正式) / `feihualing`(Max)，`api/_lib/core.js` 的
  `featuresFor()` 同步一份，`test/entitlement.test.js` 兜底。

## 三、三个具体 bug：根因定位

### 1. 飞花令「选了小学，答案仍是全部」

`js/game.js` 的 `renderFly()` 直接调用 `corpus()`（**全站语料，未按 scope 过滤**）
喂给 `Q.flyFlower({ poems: cps, chars: state.chars })`；`state.setup.scope` 在整个
`renderFly()` 里从未被读取。飞花令的「范围」勾选框只是摆设，从代码层面就没接线。

**修法**：`renderFly()` 里的 `cps` 改成 `Ex.select(corpus(), state.setup.scope)`
（与考试三形态共用同一个过滤器），并在飞花令这张卡上把当前范围显示出来
（复用 `scopePickLabel()`），不再是「选了但看不出选了什么」。

### 2. 「看答案」点某一句，直接跳回 `/poems/` 首页

`openPoem(id)` 里 `hasReader()` 检查页面上有没有 `[data-gw="reader"]` 这个阅读器
挂载点；`/dahui/index.html` 是纯净的独立页（没有诗词列表、没有阅读器），
于是恒定判 `false`，直接 `location.href = "/poems/?poem=" + id`——**整页跳走**，
飞花令/考试的进行状态（选的字、range、已答的题）全部丢失。用户在原地看到的是
「莫名其妙回到首页」，其实是「没有本地弹层可用，只能靠跳页面」这条兜底路径。

**修法（二选一，倾向 A）**：
- **A. 内嵌轻量原文弹层**：`/dahui/` 页面里加一个只读的「原文卡」浮层（复用
  `annotatePoem` 渲染正文即可，不需要整个阅读器），点条目就地弹出、不离开
  当前答题状态，关掉弹层继续答题。
- B. 退而求其次：`location.href` 改成新标签页打开（`target=_blank` 效果，
  即 `window.open`），至少不销毁当前页面的答题进度。

### 3. 「两个换范围按钮」

`renderSetup()`（考试的「卷面设置」页）里连续渲染了两处一模一样的按钮：
`.game-head` 区块头部一个「换范围」，「考什么范围」卡片里又放了一个「换范围」，
两个按钮 `data-game-back="1"` 完全同义、只是位置重复。

**修法**：只留卡片内那一个（离范围文案更近，语义更贴），头部区块的按钮改回
「换一个玩法」（与 `renderFly()`/`renderPaper()` 的头部按钮统一文案），
一处页面只有一颗「换范围」。

## 四、术语统一：「玩法」→「题型」，「正式考试」→「考试」

### 改名范围（全部要同步，逐一列出，避免漏改）

| 类别 | 位置 | 现状 | 改后 |
|---|---|---|---|
| 考试形态名 | `js/exam.js` VARIANTS `formal.name` | `正式考试` | `考试` |
| 能力表 | `js/entitlement.js` CAPS `exam.formal.name` | `正式考试` | `考试` |
| 服务端能力名 | `api/_lib/core.js` `featuresFor()` | 同步 | 同步 |
| 页面文案 | `dahui/index.html` `<meta description>` / `data-sub` | 「四种玩法」「正式考试」 | 「四种题型」「考试」 |
| 页面文案 | `poems/index.html` 大会入口说明 | 同上 | 同上 |
| 页面文案 | `js/game.js` `C.setSub(...)` | 同上 | 同上 |
| 文档 | `README.md`、`docs/architecture.md`、`docs/auth-design.md` | 「玩法卡」「正式考试」 | 「题型卡」「考试」 |
| 测试 | `test/entitlement.test.js` 等断言文案 | `正式考试` | `考试` |

⚠️ 能力键名 `exam.formal` **本身不改**（沿用 §4.66 定的规矩：「键名不改，
只改显示名」，避免牵连 `/plans/` 对比表与既有已购买用户的门槛记录）。

### 「玩法」→「题型」的措辞统一

当前四张卡在文案里混用「玩法」（`data-sub`、`README.md`、`architecture.md`）。
统一后文案一律用「题型」：飞花令、题库、模拟考试、考试——**四种题型**。
`js/game.js` 里 `modeOf()` 等函数名不必跟着改（内部实现细节，不是文案），
只改用户可见文案与文档措辞。

## 五、服务器端考试历史（只针对「考试」，不含「模拟考试」）

### 1. 范围界定

- **要上云**：`formal`（改名后的「考试」）——因为它有限时、交卷后统一判、
  且用户明确要「历史记录」「查看」「删除」这类跨设备语义。
- **不上云**：`mock`（模拟考试）、`practice`（题库）——保持本机 `poem_exam_v1`
  轻量记录即可，用户诉求原文是「所有考试（不含模拟考试）」。

### 2. 表设计（参照 `pinyin_proposals`/`feedback_threads` 的既有写法）

```sql
create table if not exists public.exam_records (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  scope_id      text not null,        -- 范围（"all" / "poems:primary" / "book:tangshi" ...）
  scope_label   text not null,        -- 当时的范围显示名（快照，范围名单以后会变）
  size          int  not null,        -- 题量
  score         int  not null,        -- 答对题数
  total         int  not null,        -- 总题数
  duration_sec  int,                  -- 实际用时（秒），到点自动交卷也记
  items         jsonb not null,       -- 逐题对错快照：[{stem, picked, answer, correct}]
  created_at    timestamptz not null default now()
);
create index if not exists exam_records_account_idx on public.exam_records(account_id, created_at desc);
```

- `items` 字段截断策略仿照 `pinyin_proposals`（服务端各字段设上限，防止超大 payload）。
- 行级安全：只有 `account_id` 本人可读/删，管理员不额外开后门（这是个人历史，
  不是待审核的公共数据，不需要 `pinyin_proposals` 那种审核流程）。

### 3. API

| 路由 | 作用 |
|---|---|
| `POST /api/exam/records` | 交卷后写入一条（服务端判分之后调用，`origin` 校验避免伪造分数） |
| `GET /api/exam/records` | 列出本账号历史（分页，最近在前） |
| `DELETE /api/exam/records/:id` | 删除一条（校验属于本账号） |

- 未登录 / 未接通服务端时的兜底：沿用现有「本机判分（服务端没接通）」提示，
  历史记录该次仅落本机 `poem_exam_v1`，不假装已上云。
- 需要一个「历史」入口页面/弹层：列出每条「日期 · 范围 · N/M 分」，点开看逐题
  对错详情，支持单条删除、支持清空。放在 `/dahui/` 内的一个子视图即可，
  不必新开路由（与「掀层不新开页」的既有惯例一致）。

### 4. 落地顺序（这一大项本身再拆三小步）

1. schema + 只读 API（写入 + 列表），先把「交卷后存一条、能拉出来看」跑通；
2. 历史列表 UI（`/dahui/` 内新增「考试记录」入口）；
3. 删除（单条 + 清空）+ 与本机 `poem_exam_v1` 的关系理清（云端为准，本机仅离线兜底）。

## 六、游戏感：飞花令 & 考试更「活」

逐条对应用户提到的点，标注建议落点，**不引入新依赖**（沿用站内已有的 CSS 变量
与 `Speech`/`Audio` 能力）：

| 诉求 | 建议做法 | 落点 |
|---|---|---|
| 考试倒计时 | `formal` 已有 `timed:true` 与 `timeLeftText()`，只是**纯文字**；改成醒目的
  倒计时条（进度条 + 数字，最后 60 秒变色/轻微跳动提示） | `js/game.js` `renderPaper()` + 新增少量 CSS |
| 答对/答错音效 | 新增极短音效（Web Audio 振荡器合成或极小 mp3），**默认开、设置里可关**，
  复用现有"设置"页模式（参照朗读开关的做法） | 新键 `poem_sound_v1`（登记进
  `js/sync-coverage.js` 的设备域一类）；开关放 `/settings/` |
| 动画反馈 | 答对：轻微缩放 + 绿色描边一闪；答错：轻微抖动 + 红色描边一闪
  （CSS `@keyframes`，不用 JS 动画库） | `css/style.css` 新增两个动效类 |
| 交卷结果要醒目 | 不是「90 分以上才特殊」——**每一次交卷都要有横幅**：页面顶部大字号 +
  强调色数字滚动计数（从 0 数到最终分），横幅按分数分档给不同的基调与用语
  （例如 ≥90 金色 + 「太棒了」、60~89 绿色 + 「不错」、<60 蓝色 + 「再练一次」），
  分档只换配色/文案/是否带彩带动效，**不做「失败感」处理**（哪一档都是鼓励口吻，
  不出现「不及格」这种否定字眼） | 交卷结果页顶部新增一个「成绩横幅」区块，
  三档共用同一套滚动计数逻辑 |
| 飞花令更像玩法 | 目前飞花令是「选字 → 一次性看全部命中句」，与真飞花令「轮流对句、
  说不出就输」的玩法有距离。建议加一个可选的「对战节奏」模式：出字后倒数
  几秒、要求用户主动在「自己写一句」框里作答，答对再翻下一个字，
  连对计数、断了给出提示——但**不改变现有「查一查」模式**，作为并列的
  「闯关模式」增量，不删旧功能 | `js/game.js` 新增一个飞花令子模式
  （P4 已落地，见 §七 第 5 条）|

⚠️ 这一大项建议放在**四个 bug 修完、术语统一完、服务器历史落地之后**再做，
因为游戏化是体验增强，不阻塞前面几项的正确性问题；但飞花令的「闯关模式」
和「倒计时/音效/动画」这几件事互相独立，可以拆更小的 PR 逐个上。

## 七、总推进顺序（每步独立可测、可发布）

1. **P0（已完成）**：修三个具体 bug——飞花令范围过滤失效、看答案跳页丢状态、
   重复的「换范围」按钮。风险最低、用户已明确指出，改动范围小。
2. **P1（已完成）**：术语统一——「正式考试」→「考试」、「玩法」→「题型」，按第四节
   表格逐点改，`bash test/run.sh` 兜底文案断言。
3. **P2（已完成）**：服务器端考试历史——schema → 写入/列表 API → 历史 UI → 删除。
   详见 `docs/architecture.md` §4.117「P2：考试历史上服务器」。
4. **P3（已完成）**：游戏化体验——倒计时可视化、音效开关、动画反馈、每次交卷都有
   的成绩横幅。详见 `docs/architecture.md` §4.117「P3：游戏感」。
   **第六轮返工（2026-09-30）**：音效第一版只在「逐题即时判分」那三行响过，
   考试（交卷后批）与交卷出分那一屏一行都没有 —— 用户的原话是「也没听到任何
   声音」。现在四种声音收在 `js/sfx.js` 一处、四个题型四个发声点、解锁改在用户
   手势里做。详见 `docs/architecture.md` §4.119。
5. **P4（已完成）**：飞花令「闯关模式」——与「查一查」并列的增量，旧路径一个字
   没改。判分内核放 `js/quiz.js`（`judgeSetLine` / `levelChars` / `passable`），
   一关一个令字、45 秒、写对翻下一个字、连对累计、卡住给提示不给答案；
   服务器判分跟着用户选的范围走（`checkFly` 认 `scopeId`，收窄不了就如实报
   `scopeExact: false`）。详见 `docs/architecture.md` §4.117「P4：飞花令闯关模式」。

不做（本轮明确排除，避免范围蔓延）：不改错题回流复习排期（`scheduler.js` 是
另一套纪律，历史记录只读不参与排期）；不给「模拟考试」上云；不引入 AI 判分。
