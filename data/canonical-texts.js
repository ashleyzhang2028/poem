/* ==========================================================================
   正文收归主表（主表裁定规则的静态成果）
   --------------------------------------------------------------------------
   由 scripts/build-canonical-texts.js 离线算出。

   ⚠️ 这是**生成文件**，改动请改 scripts/build-canonical-texts.js 后重跑，
      不要手改这里 —— 下次重新生成会把手工改动覆盖掉。

   ## 它解决什么

   同一篇作品在几部集子里各存一份正文时（《桃花源记》课内八年级下 +
   古文观止卷六、《登高》课内高一上 + 唐诗卷五……），两份的断行、标点
   甚至个别字会不一样。学生背的是课本上那一篇，读到另一部里同一篇时
   却看到另一种写法，只会来问「到底哪个对」。

   裁定一句话：**课内以教材为准，正文只留一份 —— 用主条目（课内条目）那一份**；
   译文同理（同一篇给学生读两段不同的白话，是同一个问题）。

   ## 与 data/works-map.js 的分工

     works-map.js        哪些条目是**同一篇作品**（判重、搜索去重、排程合流）
     canonical-texts.js  同一篇作品**用哪一份正文**（本文件）
   两张表都由同一套口径算出，一起重跑。

   ## 字段

     id           站点条目 id（与 data/site-index.js 同口径，带集子前缀）
     of           取哪一条的正文，记的是**集子内 id**（`gw-60` / `cz8-14`）——
                  集子页里的条目 id 本来就不带前缀，这样两类页面都能命中
     ofEntry      同一条的站点索引 id（`classic-gw-60` / `poems-cz8-02`），供核对
     text         true = 正文改用主条目那一份
     translation  true = 译文改用主条目那一份（见 js/reader-core.js 的
                  canonicalTextOf —— 正文与译文各自判、各自换）

   本表共 57 条：正文有出入的 16 条、只有译文不同的 41 条。
   正文逐字相同的那些重复条目**不必登记** —— 用谁的都一样，
   登记进来只会让表变长，却说明不了任何事。
   ========================================================================== */
window.CANONICAL_TEXTS = [
  { id: "classic-gw-60", of: "cz8-02", ofEntry: "poems-cz8-02", text: false, translation: true },
  { id: "guwen-gwj-88", of: "cz8-14", ofEntry: "poems-cz8-14", text: true, translation: true },
  { id: "guwen-gwj-97", of: "cz7-23", ofEntry: "poems-cz7-23", text: true, translation: true },
  { id: "songci-sc-147", of: "cz9-23", ofEntry: "poems-cz9-23", text: false, translation: true },
  { id: "songci-sc-173", of: "cz8-29", ofEntry: "poems-cz8-29", text: false, translation: true },
  { id: "songci-sc-183", of: "gz10-08", ofEntry: "poems-gz10-08", text: true, translation: true },
  { id: "songci-sc-192", of: "gz11-19", ofEntry: "poems-gz11-19", text: true, translation: true },
  { id: "songci-sc-249", of: "gz10-09", ofEntry: "poems-gz10-09", text: true, translation: true },
  { id: "songci-sc-47", of: "gz10-18", ofEntry: "poems-gz10-18", text: true, translation: true },
  { id: "songci-sc-5", of: "cz9-18", ofEntry: "poems-cz9-18", text: true, translation: true },
  { id: "songci-sc-67", of: "gz10-07", ofEntry: "poems-gz10-07", text: true, translation: true },
  { id: "songci-sc-70", of: "cz8-28", ofEntry: "poems-cz8-28", text: false, translation: true },
  { id: "songci-sc-75", of: "gz11-07", ofEntry: "poems-gz11-07", text: false, translation: true },
  { id: "songci-sc-80", of: "xx6-14", ofEntry: "poems-xx6-14", text: false, translation: true },
  { id: "tangshi-ts-102", of: "cz7-03", ofEntry: "poems-cz7-03", text: true, translation: true },
  { id: "tangshi-ts-106", of: "cz8-08", ofEntry: "poems-cz8-08", text: false, translation: true },
  { id: "tangshi-ts-107", of: "cz8-27", ofEntry: "poems-cz8-27", text: false, translation: true },
  { id: "tangshi-ts-114", of: "cz9-10", ofEntry: "poems-cz9-10", text: false, translation: true },
  { id: "tangshi-ts-119", of: "gz10-21", ofEntry: "poems-gz10-21", text: false, translation: true },
  { id: "tangshi-ts-121", of: "xx5-06", ofEntry: "poems-xx5-06", text: false, translation: true },
  { id: "tangshi-ts-128", of: "cz8-22", ofEntry: "poems-cz8-22", text: false, translation: true },
  { id: "tangshi-ts-132", of: "xx6-17", ofEntry: "poems-xx6-17", text: false, translation: true },
  { id: "tangshi-ts-156", of: "xx2-10", ofEntry: "poems-xx2-10", text: false, translation: true },
  { id: "tangshi-ts-173", of: "cz8-06", ofEntry: "poems-cz8-06", text: true, translation: true },
  { id: "tangshi-ts-187", of: "gz11-20", ofEntry: "poems-gz11-20", text: false, translation: true },
  { id: "tangshi-ts-189", of: "xx5-16", ofEntry: "poems-xx5-16", text: false, translation: true },
  { id: "tangshi-ts-190", of: "gz10-05", ofEntry: "poems-gz10-05", text: false, translation: true },
  { id: "tangshi-ts-200", of: "cz9-11", ofEntry: "poems-cz9-11", text: true, translation: true },
  { id: "tangshi-ts-213", of: "gz11-12", ofEntry: "poems-gz11-12", text: true, translation: true },
  { id: "tangshi-ts-222", of: "xx4-17", ofEntry: "poems-xx4-17", text: false, translation: true },
  { id: "tangshi-ts-223", of: "cz7-14", ofEntry: "poems-cz7-14", text: false, translation: true },
  { id: "tangshi-ts-229", of: "xx6-01", ofEntry: "poems-xx6-01", text: false, translation: true },
  { id: "tangshi-ts-230", of: "xx1-07", ofEntry: "poems-xx1-07", text: false, translation: true },
  { id: "tangshi-ts-231", of: "xx1-09", ofEntry: "poems-xx1-09", text: false, translation: true },
  { id: "tangshi-ts-234", of: "xx2-03", ofEntry: "poems-xx2-03", text: false, translation: true },
  { id: "tangshi-ts-242", of: "xx2-05", ofEntry: "poems-xx2-05", text: false, translation: true },
  { id: "tangshi-ts-247", of: "xx1-10", ofEntry: "poems-xx1-10", text: false, translation: true },
  { id: "tangshi-ts-251", of: "xx6-07", ofEntry: "poems-xx6-07", text: false, translation: true },
  { id: "tangshi-ts-254", of: "xx3-16", ofEntry: "poems-xx3-16", text: false, translation: true },
  { id: "tangshi-ts-255", of: "xx4-20", ofEntry: "poems-xx4-20", text: false, translation: true },
  { id: "tangshi-ts-258", of: "xx4-05", ofEntry: "poems-xx4-05", text: true, translation: true },
  { id: "tangshi-ts-260", of: "xx3-08", ofEntry: "poems-xx3-08", text: false, translation: true },
  { id: "tangshi-ts-261", of: "cz7-16", ofEntry: "poems-cz7-16", text: false, translation: true },
  { id: "tangshi-ts-262", of: "cz7-06", ofEntry: "poems-cz7-06", text: false, translation: true },
  { id: "tangshi-ts-263", of: "xx3-17", ofEntry: "poems-xx3-17", text: false, translation: true },
  { id: "tangshi-ts-264", of: "xx5-07", ofEntry: "poems-xx5-07", text: false, translation: true },
  { id: "tangshi-ts-265", of: "xx6-08", ofEntry: "poems-xx6-08", text: false, translation: true },
  { id: "tangshi-ts-295", of: "cz7-10", ofEntry: "poems-cz7-10", text: false, translation: true },
  { id: "tangshi-ts-300", of: "xx4-18", ofEntry: "poems-xx4-18", text: false, translation: true },
  { id: "tangshi-ts-34", of: "cz7-18", ofEntry: "poems-cz7-18", text: true, translation: true },
  { id: "tangshi-ts-6", of: "cz7-19", ofEntry: "poems-cz7-19", text: true, translation: true },
  { id: "tangshi-ts-67", of: "xx5-12", ofEntry: "poems-xx5-12", text: false, translation: true },
  { id: "tangshi-ts-77", of: "cz9-07", ofEntry: "poems-cz9-07", text: true, translation: true },
  { id: "tangshi-ts-86", of: "xx5-23", ofEntry: "poems-xx5-23", text: false, translation: true },
  { id: "tangshi-ts-88", of: "xx4-04", ofEntry: "poems-xx4-04", text: false, translation: true },
  { id: "tangshi-ts-89", of: "xx3-09", ofEntry: "poems-xx3-09", text: false, translation: true },
  { id: "tangshi-ts-97", of: "cz8-21", ofEntry: "poems-cz8-21", text: false, translation: true }
];
