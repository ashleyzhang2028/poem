-- 跬步 · 数据库（Supabase / Postgres）
-- ==========================================================================
-- 四张基表 + 两段迁移，与 docs/architecture.md §2.1 逐字对应。
-- 在 Supabase 控制台的 SQL Editor 里**整段**执行即可（幂等，可重复跑）。
--
-- ⚠️ 本文件是**累计**的：下面的第 5、6 节是后续迁移，会改掉上面建表时的形状。
--    「口径」以最后落定的那一条为准 —— 这里先说结论，正文各节再展开为什么。
--
-- 三条口径（**以第 6 节为准**）：
--   1. **不存明文口令** —— 库里只有 `scrypt$N$r$p$salt$hash`，参数写在串里
--      （参数不写进串的下场是「将来调 N 值，老用户全部登不上」）。
--      ⚠️ **邮箱明文是落库的**（`accounts.email`，第 6 节 ①）—— 这一条**推翻了**
--      Issue #132 时「只存摘要 + 掩码」的老口径（用户裁「邮箱必须记录到数据库」）。
--      登录查找仍走 `email_hash`（输入继续小写归一化，历史行为不变）；
--      明文只用来**显示与认人**，只下发给「你自己」与管理员。
--      ⚠️ **`email_mask` 那一列整个删掉了**（第 8 节，Issue #320）——
--      掩码只活在界面上（「点一下才显示」那个临时状态），不再落库、不再下发。
--   2. **RLS 全部开启且不给任何策略** —— 所有访问都走服务端的 service key；
--      anon key 即便泄露也读不到一行（默认拒绝）
--   3. 索引按「查询一定会用到的那一列」建：`email_hash` 唯一（登录查找）、
--      `progress(uid, child_id, poem_id)` 唯一（条件 upsert 靠它，见第 5 节）
-- ==========================================================================

-- ---------------------------------------------------------------- accounts
create table if not exists public.accounts (
  uid           text primary key,
  email_hash    text        not null,
  nickname      text        not null default '',
  plan          text        not null default 'free',
  plan_until    bigint,
  role          text        not null default 'user',
  created_at    bigint      not null,
  last_login_at bigint      not null,
  -- 「这个人以前登录过没有」的**唯一判据**（Issue #276 后续）。
  --   ⚠️ 别拿 `last_login_at` 与 `created_at` 比大小去猜：注册与第一次登录
  --      可能落在**同一毫秒**（测试里就是这么跑的，本地服务也常见），
  --      那时两列相等 —— 与「从没登录过」完全分不开。
  --   这一列只增不减：每成功签发一次会话 +1。0 = 还没登录过。
  login_count   int         not null default 0,
  status        text        not null default 'active'
);
create unique index if not exists accounts_email_hash_key on public.accounts (email_hash);
-- 管理员名单：查 role 用到
create index if not exists accounts_role_idx on public.accounts (role) where role <> 'user';

-- ------------------------------------------------------------------- codes
create table if not exists public.codes (
  code_id     text primary key,
  uid         text   not null references public.accounts(uid) on delete cascade,
  purpose     text   not null,
  channel     text   not null default 'email',
  sent_to     text   not null,
  code_hash   text   not null,
  salt        text   not null,
  issued_at   bigint not null,
  expires_at  bigint not null,
  attempts    int    not null default 0,
  consumed_at bigint
);
create index if not exists codes_uid_purpose_idx on public.codes (uid, purpose);
-- 顺手清过期码用
create index if not exists codes_expires_idx on public.codes (expires_at);

-- ---------------------------------------------------------------- sessions
create table if not exists public.sessions (
  sid     text primary key,
  uid     text   not null references public.accounts(uid) on delete cascade,
  iat     bigint not null,
  exp     bigint not null,
  revoked int    not null default 0,
  device  text
);
create index if not exists sessions_uid_idx on public.sessions (uid);

-- ---------------------------------------------------------------- progress
create table if not exists public.progress (
  uid        text   not null references public.accounts(uid) on delete cascade,
  poem_id    text   not null,
  payload    jsonb  not null default '{}'::jsonb,
  updated_at bigint not null,
  deleted    int    not null default 0,
  primary key (uid, poem_id)
);
-- pull 的游标就是 updated_at
create index if not exists progress_uid_updated_idx on public.progress (uid, updated_at);

-- -------------------------------------------------------------------- RLS
-- 全部开启、**不给任何策略** = 默认拒绝。
-- 服务端用 service key（绕过 RLS）访问；anon key 什么都读不到。
alter table public.accounts enable row level security;
alter table public.codes    enable row level security;
alter table public.sessions enable row level security;
alter table public.progress enable row level security;

-- ---------------------------------------------------------------- 条件 upsert
-- 为什么不能用 PostgREST 的 on_conflict=merge-duplicates
-- --------------------------------------------------------------------------
-- merge-duplicates 展开成的是**无条件**的
--   `ON CONFLICT ... DO UPDATE SET ...`，
-- 于是「按条覆盖」这条会退化成「谁最后写谁赢」。
-- 而同步的到达顺序**本来就不保证**：手机在电梯里断网攒了一批，
-- 出电梯才推上来 —— 那一批的 updated_at 比服务器上的旧，
-- 无条件 upsert 就会把用户在网页上刚背完的进度**回退**成三天前的。
-- 测试里那条「老时间戳盖不掉新值」在 memoryStore 上是过的，
-- 在真库上会是红的 —— 所以这条约束必须落在数据库里，不能只写在 JS 里。
-- --------------------------------------------------------------------------
create or replace function public.kb_upsert_progress(rows jsonb)
returns void
language sql
security definer
as $$
  insert into public.progress (uid, poem_id, payload, updated_at, deleted)
  select r->>'uid',
         r->>'poem_id',
         coalesce(r->'payload', '{}'::jsonb),
         (r->>'updated_at')::bigint,
         coalesce((r->>'deleted')::int, 0)
    from jsonb_array_elements(rows) as r
  on conflict (uid, poem_id) do update
     set payload    = excluded.payload,
         updated_at = excluded.updated_at,
         deleted    = excluded.deleted
   where excluded.updated_at >= public.progress.updated_at;
$$;

-- ==========================================================================
-- 5.3 跨设备分档案（Issue #159 · todo.md 第 4 条落地）
-- ==========================================================================
-- 一个账号下可以有几个孩子（`docs/auth-design.md` §2.1：孩子**不建独立账号**，
-- 只是账号下的一个展示名 + 一份自己的进度）。本机那一半早就落地了（`js/family.js`），
-- 这一节补的是**云端那一半**：进度按孩子分家。
--
-- 三条口径（改了就有一层测试直接红）：
--
--   1. **第一个孩子的 `child_id` 是空串，不是 `::p1`** —— 与 `js/family.js`
--      的键映射**逐字同源**：分家前那份数据住在**无后缀的老键**上，
--      所以它的云端那一份也必须住在 `child_id = ''` 那一行。
--      给它编个新 id 就得写「搬一半时断电」的恢复逻辑，而搬的是用户唯一的进度。
--   2. **`kb_upsert_progress()` 的 where 一个字都不许省** —— 见上面那一大段。
--      主键换了、那条 where 没换，症状是「谁最后写谁赢」，而且**只在真库上出现**。
--   3. **一个账号一行的「名册」也落在 progress 里，不新开表** —— 与 2.2
--      （`game-quota:` 那一条）同源：新开一张表就要再写一套 memory / supabase
--      两个实现，而「两个实现键集合不一致 → 静默失效」是反复踩过的坑。
--      名册是**账号级**的（`child_id = ''`、`poem_id = 'family:v1'`）。
-- --------------------------------------------------------------------------

-- ① 加列：默认空串 = 「第一个孩子那一份」（现有所有行都落在这一档）
alter table public.progress add column if not exists child_id text not null default '';

-- ② 主键换掉。**先建新索引再换主键** —— 中途失败也不会出现「两个主键都在」或
--    「一个都没有」的中间态：换主键那一步只是把约束指过去。
alter table public.progress drop constraint if exists progress_pkey;
alter table public.progress add primary key (uid, child_id, poem_id);

-- ③ 拉取索引跟着换成三列（pull 的游标仍是 updated_at）
drop index if exists public.progress_uid_updated_idx;
create index if not exists progress_uid_child_updated_idx
  on public.progress (uid, child_id, updated_at);

-- ④ 条件 upsert 加上 child_id。**整段重写**，因为 `on conflict` 那两列
--    必须与上一步的主键逐字一致 —— 不一致的报错是运行时的
--    「there is no unique or exclusion constraint matching the ON CONFLICT
--    specification」，只在真库上出现，memoryStore 全绿。
create or replace function public.kb_upsert_progress(rows jsonb)
returns void
language sql
security definer
as $$
  insert into public.progress (uid, child_id, poem_id, payload, updated_at, deleted)
  select r->>'uid',
         coalesce(r->>'child_id', ''),
         r->>'poem_id',
         coalesce(r->'payload', '{}'::jsonb),
         (r->>'updated_at')::bigint,
         coalesce((r->>'deleted')::int, 0)
    from jsonb_array_elements(rows) as r
  on conflict (uid, child_id, poem_id) do update
     set payload    = excluded.payload,
         updated_at = excluded.updated_at,
         deleted    = excluded.deleted
   where excluded.updated_at >= public.progress.updated_at;
$$;

-- ==========================================================================
-- 6. 完整登录流程（Issue #197 · 注册 / 确认邮件 / 登录 / 忘记密码 / 重设密码）
-- ==========================================================================
-- 用户原话：
--
--   「我要求重新设计用户的整个登录流程。使用邮箱注册，注册邮件确认，登录，
--     忘记密码，重设密码，再加一个发送随机码快捷登录，要求用户邮箱必须
--     记录到数据库，用户名等也要。以及 profile 信息等等。」
--
-- 这一段是**真的数据库迁移**，所以逐条写清「改了什么、为什么、加错了会怎样」。
-- 另外三条口径先说在前面：
--
--   · **口令不是替换随机码**，是加出来的一条路。所以 `codes` 表一个字没改
--     （`sendCode` / `verifyCode` 那两条路照旧跑）。
--   · **明文口令永远不落库**。库里只有 `scrypt$N$r$p$salt$hash`，
--     参数写在串里 —— 参数不写进串的下场是「将来调 N 值，老用户全部登不上」，
--     而那时没有任何办法区分「口令错」与「参数变了」。
--   · **邮箱明文也落库**（这一条推翻了 Issue #132 时「只存摘要 + 掩码」的口径）。
--     登录仍走 `email_hash`（它的输入继续做小写归一化，所以历史行为不变）；
--     明文只用来**显示与认人**。
--   · **`email_verified_at` 为空就登不进去**（Issue #197 后半段，用户裁决）。
--     这一列因此不是一个「参考字段」，而是**登录闸**：`core.emailGate()`
--     读它，读不到就不签发会话。老行（这一列还没写过值）按同一口径处理 ——
--     在**注册路径**上补一封确认信，而不是在登录时静默放行。
-- ==========================================================================

-- ① 明文邮箱 + 确认时刻 + 口令摘要（三列，都可为空 —— 老行不必回填就能继续登录）
--
--    为什么 `email` 允许为空：Issue #197 之前建的账号压根没有这一列的值。
--    把它设成 NOT NULL 要么让迁移失败，要么得编一个假的默认值 ——
--    而「编一个假的」正是本项目最恨的那件事。
--    空值由 `store.js` 如实回空串，界面如实留白，**不假装有明文**。
alter table public.accounts add column if not exists email              text not null default '';
alter table public.accounts add column if not exists email_verified_at  bigint;
alter table public.accounts add column if not exists password_hash      text not null default '';
alter table public.accounts add column if not exists password_salt      text not null default '';

-- 按明文邮箱查找（管理后台的账号名录走它；登录**不走**这一列）
create index if not exists accounts_email_idx on public.accounts (lower(email)) where email <> '';

-- ② 邮箱确认（与调用方约定 `purpose` 固定为 verify）
--
--    ⚠️ **它不能并进 `codes` 表**。两者是两种完全不同的凭据：
--       一个是 6 位数字（空间 1e6，靠失败上限与短 TTL 防猜），
--       一个是 64 位 hex（空间 2^256，靠 TTL 与「用过一次」防重放）。
--       合成一张表的下场是 TTL、失败上限、作废规则互相污染 ——
--       而症状是「确认链接十分钟就过期了」（被码的 TTL 带上）这种
--       谁也查不出原因的怪事。
create table if not exists public.verifications (
  vid         text primary key,
  uid         text   not null references public.accounts(uid) on delete cascade,
  email_hash  text   not null,
  token_hash  text   not null,
  salt        text   not null,
  issued_at   bigint not null,
  expires_at  bigint not null,
  attempts    int    not null default 0,
  consumed_at bigint
);
create index if not exists verifications_uid_idx on public.verifications (uid);
create index if not exists verifications_expires_idx on public.verifications (expires_at);

-- ③ 重设口令（与调用方约定 `purpose` 固定为 reset）
create table if not exists public.resets (
  rid         text primary key,
  uid         text   not null references public.accounts(uid) on delete cascade,
  email       text   not null default '',
  token_hash  text   not null,
  salt        text   not null,
  issued_at   bigint not null,
  expires_at  bigint not null,
  attempts    int    not null default 0,
  consumed_at bigint
);
create index if not exists resets_uid_idx on public.resets (uid);
create index if not exists resets_expires_idx on public.resets (expires_at);

-- ④ RLS：与其余四张表同一条口径 —— 全部开启、**不给任何策略**（默认拒绝）。
--    新增两张表如果忘了这一段，症状是「anon key 能读别人邮箱的确认令牌摘要」。
alter table public.verifications enable row level security;
alter table public.resets        enable row level security;

-- ⑤ 顺手清过期记录用的函数（与 codes 同一条：留着只会让表一直涨）
create or replace function public.kb_purge_expired(now_ms bigint)
returns void
language sql
security definer
as $$
  delete from public.codes         where expires_at < now_ms;
  delete from public.verifications where expires_at < now_ms;
  delete from public.resets        where expires_at < now_ms;
$$;

-- ==========================================================================
-- 7. 用户报告 / 勘误（Issue #243 第四轮 · 用户原话）
-- ==========================================================================
-- 用户原话（2026-09-19）：
--
--   「同样允许用户报告错误，勘误，我觉得可以发送到 supabase 数据库，
--     然后我作为管理员能在管理员看到并纠正，你看看如何设计用户报告错误的
--     界面，入口，交互等等」
--
-- 三件事先说清楚，因为它们是这张表存在的理由：
--
--   · **它是一张新表，不是 progress 里的一行**。progress 那一张是
--     「这个账号学到哪」的**私有**数据，按 uid + child_id 分区、只在本人
--     设备之间同步。报告是**写给管理员看**的：不分区（与孩子无关）、
--     不参与同步（用户改了本机那份不该改到管理员的收件箱）、
--     而且要能按状态检索与回写（progress 的载荷是黑盒 jsonb）。
--     硬塞进 progress 的下场是「管理员要看报告，得先把全站账号的
--     progress 全拉下来」。
--   · **正文与译文的原文一起存**（`quote` / `context`）。用户标的那一段
--     可能只有两个字（「长」），半年后光看这两个字谁也不知道在说哪一句。
--     所以落库时带上前后的那一整句 —— 与 `daily_extra` 存快照同一条理由：
--     「只存 id，打开是空的」。
--   · **状态机在服务端**（new → accepted → fixed / rejected）。用户端只读，
--     写状态只走管理端那条闸（`accounts.role` 是 owner / admin）。
--     用户端能改状态的下场是「报告自己把自己标成已修复」。
--
-- 另外两条口径与既有表逐字一致：
--   · RLS 全开、**不给任何策略**（默认拒绝）—— 漏掉这一段不会报错，
--     症状是 anon key 能读别人报的错与他的邮箱掩码。
--   · 「谁报的」用 uid 外键 + 邮箱快照两样都留：uid 用来防刷与回信，
--     快照用来在账号被注销之后，管理员仍然认得出这条报告是谁提的。
--     ⚠️ 快照落的是**明文邮箱**（第 8 节，Issue #320）：从前的掩码
--     `b***@163.com` 认不出是谁，而它又不可逆 —— 账号注销之后就成了一条
--     谁也认不出的记录。
-- ==========================================================================

create table if not exists public.reports (
  rid          text primary key,
  uid          text   not null references public.accounts(uid) on delete cascade,
  email        text   not null default '',
  nickname     text   not null default '',
  kind         text   not null default 'other',
  status       text   not null default 'new',
  poem_id      text   not null default '',
  poem_title   text   not null default '',
  book         text   not null default '',
  quote        text   not null default '',
  context      text   not null default '',
  note         text   not null default '',
  suggestion   text   not null default '',
  device       text   not null default '',
  ua           text   not null default '',
  created_at   bigint not null,
  updated_at   bigint not null,
  handled_at   bigint,
  handled_by   text   not null default '',
  reply        text   not null default ''
);

-- 管理端默认按「新到旧 + 只看新的」翻，所以这一列建索引
create index if not exists reports_status_created_idx on public.reports (status, created_at);
create index if not exists reports_created_idx on public.reports (created_at);
-- 「这一篇被报过几次」用得到
create index if not exists reports_poem_idx on public.reports (poem_id) where poem_id <> '';
-- 按人翻（防刷与水印）
create index if not exists reports_uid_idx on public.reports (uid);

alter table public.reports enable row level security;

-- 顺手清过期记录那一条也把报告带上？**不带**，并且这不是遗漏。
-- 报告是**人工处理**的台账：自动删掉一条「用户报的错」就等于把一条
-- 还没看的反馈丢掉，而它体积很小（每条几 KB 上界，见 core.reportCreate 的截断）。
-- 留着它，管理端才可能「翻半年前谁报过同一处」。

-- ==========================================================================
-- 8. 去掉掩码邮箱（Issue #320 · 用户原话）
-- ==========================================================================
-- 用户原话（2026-09-25）：
--
--   「去掉整个app中关于掩码邮箱的设计，数据库也不需要这一列。
--     b***@163.com 我的那里将掩码邮箱换成 真实邮箱，但用户需要点击
--     我的邮箱 按钮才显示」
--
-- 掩码（`b***@163.com`）当年是「不存明文」那个口径的产物：因为库里没有
-- 明文可显示，界面只能显示掩成一串的那一份。Issue #197 用户裁「邮箱必须
-- 记录到数据库」之后，明文 `accounts.email` **已经落库**（第 6 节 ①），
-- 掩码这一列就只剩一个用处：把**自己看得见**的邮箱对自己的界面掩起来。
-- 那不是保护，是给用户添了一次点击。
--
-- 所以这一节把设计整块撤掉，三条一起：
--   ① `accounts.email_mask` **删列**。它没有第二个读者 —— 界面回显、
--      管理端认人两件事现在都读 `accounts.email`（明文）。
--   ② `reports.email_mask` **改名成 `email`**，内容从掩码换成**快照明文**。
--      这一列从来不参与任何判定，只用来「账号注销之后还认得出这条报告
--      是谁提的」—— 而掩码不可逆，认不出是谁，等于没有快照。
--      改名而不是新加一列：留着旧列就是留一列永远没人读、也说不清是什么
--      形状的幽灵字段（`degrade()` 那套「缺列就退让」的机器更会把它兜住，
--      于是它会在库里躺很多年）。
--   ③ 报文里的 `emailMask` 字段**一并撤掉**（`codes.sent_to` 落明文、
--      `emailGate()` / 注册 / 重发 / 重设的响应回 `email`）。
--      要认人看 `email`，要 uid 看 `uid`。
--
-- ⚠️ **本机那一份不受影响**：`poem_auth_v1` 里的 `accounts[uid].identities[]
--     .mask` 是**本机体验版**（没有服务器时）唯一的记法，它有独立的键名、
--     自己的摘要，和数据库这一列不是一件事。`service` 那一侧的掩码只剩
--     手机号的（`maskPhone`，短信通道预留），没有邮箱掩码。
-- --------------------------------------------------------------------------

-- ① accounts 去掉 email_mask。
--    先 drop index 再 drop column？没有为这一列建过索引，直接删列即可。
alter table public.accounts drop column if exists email_mask;

-- ② reports：把掩码那一列改名成明文快照，并把已有的掩码清空。
--    ⚠️ **没有回填** —— 掩码不可逆，`b***@163.com` 还原不出真实邮箱。
--       已有的那些行如实留空（界面遇到空值直接不显示「谁报的」那一小段），
--       比编一个出来强。新报告从这一版起落明文快照。
alter table public.reports rename column email_mask to email;
update public.reports set email = '' where email like '%*%';

-- ③ 老库如果还留着 `email_hash`（登录查找用得到）就**不要动它** ——
--    它跟掩码不是一回事，登录查找一直走它，且它不可逆（那是它的本意）。
