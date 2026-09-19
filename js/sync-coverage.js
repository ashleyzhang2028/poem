(function () {
  "use strict";

  // 同步边界总表（Issue #243 后续）——「哪些本机数据上云」的**唯一**一份定义。
  //
  // 用户 2026-09-19 的口径：
  //   「既然有云同步功能，应该尽量保持账号内设备间和服务器的各项同步，
  //     除非有云端存储过大和服务器限制。」
  //
  // 所以这一张表把每一把本机键逐条摊开，写清三件事：
  //   ① 上不上云；② 上云的话云端那一行的 `poem_id` 是什么；③ 为什么。
  //
  // 它是**运行时**的表，不是文档里抄的第二份 —— `test/sync-coverage.test.js`
  // 拿源码扫描本仓库所有 `poem_*` 字面量，逐个来这张表里查；
  // 有任何一把键不在表里，测试直接红。这是唯一能挡住「下次又漏一个」的机制。
  //
  // 分域（`js/progress-store.js` 的 `scopes()`）与这张表必须一致：
  // 表里说上云的，那边必须 `local:false`。同一条测试守着。

  // 不上云的三类理由（每组一句话，别处引用它，不各写一份）：
  var WHY = {
    device: "设备偏好：字号 / 对齐 / 注音档 / 连读档说的是「这台设备长什么样」，" +
            "不是「这个账号学到哪」。手机上调小字、平板调大字本来就是两回事，同步过去反而要每次重调。",
    account: "会话与层级：它们**本来就是服务端下发**的（/api/me），本机那一份是缓存，" +
             "不是数据源。缓存上云等于把「服务端的答案」再送回服务端一次。",
    sync: "同步层自己的状态（开关、游标、记账、合并前的后悔药）：" +
          "它们是「这台设备同步到哪了」，跨设备同步过去没有意义，还会互相打架。",
    trans: "一次操作的临时态（搜索框里那个词）：换设备接着搜同一句的期望很弱，" +
           "而它随时会被下一次输入覆盖。"
  };

  // rows: 每一次「一把本机键」的判定。
  //   key    本机键（`*` 结尾表示一族）
  //   sync   上不上云
  //   row    云端那一行在 progress 表里的 poem_id（不上云时为 ""）
  //   merge  多设备怎么合（不上云时为 ""）
  //   cap    体积 / 条数上界（不上云时写「为什么不上云」的那一类）
  //   why    一句话
  var ROWS = [
    {
      key: "poem_recite_progress_v1", sync: true, row: "每篇一行（poem_id = 篇 id）",
      merge: "谁最后改谁赢（updatedAt 大的胜）",
      cap: "每篇约 120 B；history 尾部 200 条封顶",
      why: "背到哪一步了 —— 换设备接着背，这个最不能少。"
    },
    {
      key: "poem_recite_settings_v1", sync: true, row: "settings:v1",
      merge: "谁最后改谁赢",
      cap: "约 1 KB",
      why: "账号域的设置（学段 / 年级 / 学期 / 范围 / 每日数量 / 算法）是「这个账号怎么背」。"
    },
    {
      key: "poem_profile_v1", sync: true, row: "family:v1（放在名册里，不单独一行）",
      merge: "名册整体",
      cap: "≤ 200 人",
      why: "昵称与头像地址是「你是谁」，与学段设置同属账号域。"
    },
    {
      key: "poem_family_v1", sync: true, row: "family:v1",
      merge: "名册整体（本地更新则本机胜，见 applyRemoteFamily）",
      cap: "≤ 200 人",
      why: "一个家长几个孩子，换台设备得还认得出来。"
    },
    {
      key: "poem_recite_collections_v1", sync: true, row: "collections:v1",
      merge: "谁最后改谁赢；**首次合并要用户裁决**（两端结构不同，按篇并会得到一份谁也不认识的东西）",
      cap: "集合 ≤ 5000、每集合 ≤ 500 篇、每篇快照正文各截 20000 字",
      why: "「我要背的」是长期清单 —— Issue #243 本次补上（原先漏在表外）。"
    },
    {
      key: "poem_poems_read_v1", sync: true, row: "reads:poem_poems_read_v1",
      merge: "**并集**（读过就是读过，哪一端都不该被抹掉）",
      cap: "每行 ≤ 2000 篇；只带读过的（稀疏）",
      why: "课内目录的已读标记 —— Issue #243 本次补上。"
    },
    {
      key: "poem_classic_read_v1", sync: true, row: "reads:poem_classic_read_v1",
      merge: "并集", cap: "每行 ≤ 2000 篇",
      why: "小古文已读 —— Issue #243 本次补上。"
    },
    {
      key: "poem_tangshi_read_v1", sync: true, row: "reads:poem_tangshi_read_v1",
      merge: "并集", cap: "每行 ≤ 2000 篇",
      why: "唐诗三百首已读 —— Issue #243 本次补上。"
    },
    {
      key: "poem_songci_read_v1", sync: true, row: "reads:poem_songci_read_v1",
      merge: "并集", cap: "每行 ≤ 2000 篇",
      why: "宋词三百首已读 —— Issue #243 本次补上。"
    },
    {
      key: "poem_guwen_read_v1", sync: true, row: "reads:poem_guwen_read_v1",
      merge: "并集", cap: "每行 ≤ 2000 篇",
      why: "古文观止已读 —— Issue #243 本次补上。"
    },
    {
      key: "poem_zhaoming_read_v1", sync: true, row: "reads:poem_zhaoming_read_v1",
      merge: "并集", cap: "每行 ≤ 2000 篇",
      why: "昭明文选已读 —— Issue #243 本次补上。"
    },
    {
      key: "poem_yuanqu_read_v1", sync: true, row: "reads:poem_yuanqu_read_v1",
      merge: "并集", cap: "每行 ≤ 2000 篇",
      why: "元曲三百首已读 —— 与其余六部同一族（Issue #243 本次补上整族）。"
    },
    {
      key: "poem_pinyin_fix_v1", sync: true, row: "pinyin_fix:v1",
      merge: "谁最后改谁赢（整份一份表，按条并会得到一份「一半是本机编的」的表）",
      cap: "≤ 500 条、每句 ≤ 120 字；**只有条目，不存正文** —— 体积天然很小",
      why: "注音勘误（Issue #243）：某篇某句某字读什么。它必须上云 —— " +
           "用户在「滕王阁序」里改对的那一处，换台设备、换个浏览器也该是对的。"
    },
    {
      key: "poem_daily_extra_v1", sync: true, row: "daily_extra:v1",
      merge: "**按天并集**（日期相同才并；日期不同听本机的）",
      cap: "≤ 20 篇、每篇快照正文各截 20000 字",
      why: "今天临时多背的那几首 —— 2026-09-19 用户当面改的口径（§4.32）。"
    },
    {
      key: "poem_avatar_local_v1", sync: true, row: "avatar:v1（**字节不进 payload**，走 Storage 桶）",
      merge: "谁最后改谁赢（上传成功即写账号域的公开地址）",
      cap: "≤ 1 MB（AVATAR_MAX_BYTES），且**这是唯一一处「体积太大」**：",
      why: "头像图片的字节 —— 一张 400 KB 的 data URL 塞进 progress 会撑爆 jsonb，" +
           "所以走已有的 Storage 通路，不走同步载荷。断网 / 未登录时它仍然只在本机（这是事实）。"
    },
    {
      key: "poem_font_v1", sync: false, row: "", merge: "", cap: WHY.device,
      why: "首页正文的字号档。"
    },
    {
      key: "poem_align_v1", sync: false, row: "", merge: "", cap: WHY.device,
      why: "首页正文的对齐档。"
    },
    {
      key: "poem_classic_font_v1", sync: false, row: "", merge: "", cap: WHY.device,
      why: "集子阅读器的字号档。"
    },
    {
      key: "poem_classic_align_v1", sync: false, row: "", merge: "", cap: WHY.device,
      why: "集子阅读器的对齐档。"
    },
    {
      key: "poem_helper_pinyin_v1", sync: false, row: "", merge: "", cap: WHY.device,
      why: "注音档（关 / 生字 / 全文）。"
    },
    {
      key: "poem_play_mode_v1", sync: false, row: "", merge: "", cap: WHY.device,
      why: "连读方式档（原文 / 白话 / 随机那五档）。"
    },
    {
      key: "poem_device_prefs_v1", sync: false, row: "", merge: "", cap: WHY.device,
      why: "设备域的收纳盒（`helper` 住这里）——「阅读辅助」总开关。"
    },
    {
      key: "poem_search_kw_v1", sync: false, row: "", merge: "", cap: WHY.trans,
      why: "搜索框里最后那个词。"
    },
    {
      key: "poem_sync_pref_v1", sync: false, row: "", merge: "", cap: WHY.sync,
      why: "同步开关（出厂关着）。"
    },
    {
      key: "poem_sync_seen_v1", sync: false, row: "", merge: "", cap: WHY.sync,
      why: "记账表（每个云端行号同步到哪了）+ 已读那一族的时间戳也借住在这里。"
    },
    {
      key: "poem_pre_merge_backup_v1", sync: false, row: "", merge: "", cap: WHY.sync,
      why: "合并冲突前留的快照 —— 「保住本机那一份」用的后悔药。"
    },
    {
      key: "poem_plan_", sync: false, row: "", merge: "", cap: WHY.trans,
      why: "今日计划在 **sessionStorage** 里的缓存（`poem_plan_<日期>_<年级>…`）：" +
           "它是一份**算出来的**结果，不是数据 —— 换台设备重算一次就有，推上去纯属浪费。" +
           "本机内容变了就删掉重算（键里带着年级 / 范围 / 数量 / 集合 / 算法那几个维度）。"
    },
    {
      key: "poem_classic_words_", sync: false, row: "", merge: "", cap: WHY.device,
      why: "集子「生词表」的版本号（`poem_classic_words_<版本>` = \"1\"）：" +
           "它记的是「这台设备看过哪一版生词表」，属于设备缓存，与学到哪无关。"
    },
    {
      key: "poem_auth_v1", sync: false, row: "", merge: "", cap: WHY.account,
      why: "本机会话（服务端签发，本机只存一份凭据）。"
    },
    {
      key: "poem_plan_v1", sync: false, row: "", merge: "", cap: WHY.account,
      why: "本机会话里的层级缓存 —— 权威答案在 /api/me。"
    },
    {
      key: "poem_plan_grant_v1", sync: false, row: "", merge: "", cap: WHY.account,
      why: "本机发放台账（离线时的层级来源，服务端也有台账）。"
    },
    {
      key: "poem_owner_v1", sync: false, row: "", merge: "", cap: WHY.account,
      why: "这台设备是不是站点所有者（管理员用）。"
    }
  ];

  function table() { return ROWS.slice(); }

  function row(key) {
    var k = String(key == null ? "" : key);
    for (var i = 0; i < ROWS.length; i++) {
      if (ROWS[i].key === k) return ROWS[i];
    }
    return null;
  }

  function known(key) { return !!row(key); }

  function synced(key) {
    var r = row(key);
    return !!(r && r.sync);
  }

  // 上云的键（含那些「一行装一族」的行号规则）。
  function syncedKeys() {
    return ROWS.filter(function (r) { return r.sync; }).map(function (r) { return r.key; });
  }

  function localKeys() {
    return ROWS.filter(function (r) { return !r.sync; }).map(function (r) { return r.key; });
  }

  window.SyncCoverage = {
    WHY: WHY,
    rows: table,
    row: row,
    known: known,
    synced: synced,
    syncedKeys: syncedKeys,
    localKeys: localKeys
  };
})();

if (typeof module === "object" && module.exports) module.exports = (typeof window !== "undefined" ? window.SyncCoverage : null);
