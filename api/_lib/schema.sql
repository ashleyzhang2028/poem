-- 跬步 · 1 期数据库（Supabase / Postgres）
-- ==========================================================================
-- 四张表，与 docs/architecture.md §2.1 逐字对应。
-- 在 Supabase 控制台的 SQL Editor 里整段执行即可。
--
-- 三条口径：
--   1. **不存明文邮箱** —— accounts 只有 email_hash（SHA-256 + 服务端 pepper）
--      与 email_mask（a***@b.com，供界面回显）
--   2. **RLS 全部开启且不给任何策略** —— 所有访问都走服务端的 service key；
--      anon key 即便泄露也读不到一行（默认拒绝）
--   3. 索引按「查询一定会用到的那一列」建：email_hash 唯一、
--      progress(uid, poem_id) 唯一（upsert 靠它）
-- ==========================================================================

-- ---------------------------------------------------------------- accounts
create table if not exists public.accounts (
  uid           text primary key,
  email_hash    text        not null,
  email_mask    text        not null,
  nickname      text        not null default '',
  plan          text        not null default 'free',
  plan_until    bigint,
  role          text        not null default 'user',
  created_at    bigint      not null,
  last_login_at bigint      not null,
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
