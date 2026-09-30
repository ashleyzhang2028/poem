/* ==========================================================================
   名著导读 · 正文素材库
   --------------------------------------------------------------------------
   这一份只放「每部书自己的素材」：写作背景、情节梗概的六个字块、
   主要人物、主旨、名句、文学地位。骨架（六段怎么排、表格怎么画、
   段落怎么分段）在 scripts/build-mingshu.js 里，不在这。

   ⚠️ 为什么素材与骨架要分开：
      · 骨架要统一 —— 四百多部书读起来得像同一本书的不同条目；
      · 素材必须各自不同 —— 梗概写成可替换的一段话，学生翻开第二本就看出来了。
      上一轮那 36 部的梗概是手写的；这一轮要做到「每部梗概 ≥ 现在的 5 倍」，
      等于要求每部 1000 字以上的实质内容 —— 只有分工能撑住：

        scripts/data/mingshu-books.js    书名 / 作者 / 国别 / 摘句（564 部）
        scripts/data/mingshu-corpus.js   每部的六段素材（本文件）
        scripts/build-mingshu.js         把素材装进壳、写进正文主表

   ## 素材字段
     era    写作背景：时代 + 作者处境 + 这部书写给什么（≥ 220 字）
     plot   情节梗概，六个字块（合计 ≥ 900 字）
              start   缘起 —— 开局的地理、人物、最初的处境
              main    主线推进 —— 读到一半时读者跟着谁在走
              turn    转折 —— 事情朝另一个方向拐的那一下
              climax  高潮 —— 全书最紧的那一处
              end     收束 —— 最后一章落在哪里
              frame   结构与视角 —— 叙述怎么组织的、为什么这样组织
     cast   主要人物：≥ 15 位。每一位 [姓名, 别号/身份, 一句到三句]
     theme  主旨（≥ 110 字）
     lines  名句（2—4 句，引原文）
     rank   文学地位（≥ 200 字：体裁史位置 + 影响 + 争议/边界）

   ## 写作口径
     · 只写「有定论的」：生卒、情节、人物关系取通行本与学界通说；
       有异说的（如《红楼梦》后四十回作者）在文里如实标出「一作」「多以为」。
     · 人名、书名、篇名一律用规范写法，不用网名或影视译名。
     · 情节写到「能让人复述出来」的密度，不写成一句主题概括。
   ========================================================================== */
'use strict';

/** 把「一部一对象」的素材按书名索引，供 build-mingshu.js 取用。 */
let CORPUS = {};
function add(c) { Object.keys(c).forEach(function (k) { CORPUS[k] = c[k]; }); }

/* ── 一、上一轮那 36 部的正文重写（梗概 ×5、人物 ×5） ─────────────────── */
// 上一轮的 36 部是手写的，这一轮统一重写成同一套六块结构，
// 顺带把当时「一段话可替换」的地方改成各自的具体内容。
add(require('./mingshu-corpus-old36.js'));

/* ── 二、Issue #381 第五轮：书目表 800 部里接着填素材 ─────────────────
   分册装，一个行当（或一批）一个文件，避免单文件过大。
   本批交付 43 部：中国古典小说已齐（6/6）、中国现代小说 25/61、
   中国现代散文 8/52。其余各组按批次继续填。 */
add(require('./corpus/fill-modern-novels-1.js'));
add(require('./corpus/fill-modern-novels-2.js'));
add(require('./corpus/fill-essays-1.js'));

/* ── 四、Issue #381 第十二轮（批次一）：中国现代小说补齐 ─────────────────
   用户原话「按 1 2 3 4 顺序来，可能要创建多个 PR」——第 1 步是「中国现代
   小说余下 35 部」。这一批把书目表里「中国现代小说」组的 61 部全部写完，
   列表页由 47 部到 82 部。分十二册装（一册 2—4 部），便于分批校读。 */
add(require('./corpus/fill-modern-novels-3.js'));
add(require('./corpus/fill-modern-novels-4.js'));
add(require('./corpus/fill-modern-novels-5.js'));
add(require('./corpus/fill-modern-novels-6.js'));
add(require('./corpus/fill-modern-novels-7.js'));
add(require('./corpus/fill-modern-novels-8.js'));
add(require('./corpus/fill-modern-novels-9.js'));
add(require('./corpus/fill-modern-novels-10.js'));
add(require('./corpus/fill-modern-novels-11.js'));
add(require('./corpus/fill-modern-novels-12.js'));
add(require('./corpus/fill-modern-novels-13.js'));
add(require('./corpus/fill-modern-novels-14.js'));

/* ── 五、Issue #381 第十二轮（批次二）：中国现代散文补齐 ─────────────────
   用户原话「按 1 2 3 4 顺序来」的第 2 步是「中国现代散文余下 43 部」。
   这一批把书目表里「中国现代散文」组的 52 部全部写完，列表页由 98 部到
   141 部。分十九册装（一册 2—3 部），便于分批校读。 */
add(require('./corpus/fill-essays-2.js'));
add(require('./corpus/fill-essays-3.js'));
add(require('./corpus/fill-essays-4.js'));
add(require('./corpus/fill-essays-5.js'));
add(require('./corpus/fill-essays-6.js'));
add(require('./corpus/fill-essays-7.js'));
add(require('./corpus/fill-essays-8.js'));
add(require('./corpus/fill-essays-9.js'));
add(require('./corpus/fill-essays-10.js'));
add(require('./corpus/fill-essays-11.js'));
add(require('./corpus/fill-essays-12.js'));
add(require('./corpus/fill-essays-13.js'));
add(require('./corpus/fill-essays-14.js'));
add(require('./corpus/fill-essays-15.js'));
add(require('./corpus/fill-essays-16.js'));
add(require('./corpus/fill-essays-17.js'));
add(require('./corpus/fill-essays-18.js'));
add(require('./corpus/fill-essays-19.js'));
add(require('./corpus/fill-essays-21.js'));
add(require('./corpus/fill-essays-22.js'));

/* ── 六、Issue #381 第十二轮（批次三）：中国当代小说（分批）────────────
   用户原话「按 1 2 3 4 顺序来」的第 3 步是「中国当代小说 118 /
   现当代诗歌 68 / 现代戏剧 44」。这一组量最大，分批往上填。 */
add(require('./corpus/fill-contemporary-novels-1.js'));
add(require('./corpus/fill-contemporary-novels-2.js'));
add(require('./corpus/fill-contemporary-novels-3.js'));
add(require('./corpus/fill-contemporary-novels-4.js'));
add(require('./corpus/fill-contemporary-novels-5.js'));
add(require('./corpus/fill-contemporary-novels-6.js'));
add(require('./corpus/fill-contemporary-novels-7.js'));
add(require('./corpus/fill-contemporary-novels-8.js'));
add(require('./corpus/fill-contemporary-novels-9.js'));

/* ── Issue #381 第十三轮（批次一）· 中国当代小说续填 ────────────────────
   用户原话「每批 200 部，提交全部 pr 直至全部完成」。这一批 200 部里
   当代小说占 87 部，按每册 6 部往下填。 */
add(require('./corpus/fill-contemporary-novels-10.js'));
add(require('./corpus/fill-contemporary-novels-11.js'));
add(require('./corpus/fill-contemporary-novels-12.js'));
add(require('./corpus/fill-contemporary-novels-13.js'));
add(require('./corpus/fill-contemporary-novels-14.js'));

/* ── Issue #381 第十四轮（批次二·续一）· 中国当代小说续填 ────────────────
   用户原话「继续按计划完成」。这一步接着把「中国当代小说」这一组填满
   （书目表 121 部里还缺 59 部），然后依次是诗歌、戏剧、外国文学。
   本册 6 部：棋王 / 树王 / 孩子王 / 北方的河 / 黑骏马（张承志） / 心灵史 */
add(require('./corpus/fill-contemporary-novels-15.js'));
add(require('./corpus/fill-contemporary-novels-16.js'));
add(require('./corpus/fill-contemporary-novels-17.js'));
add(require('./corpus/fill-contemporary-novels-18.js'));
add(require('./corpus/fill-contemporary-novels-19.js'));
add(require('./corpus/fill-contemporary-novels-20.js'));
add(require('./corpus/fill-contemporary-novels-21.js'));
add(require('./corpus/fill-contemporary-novels-22.js'));
add(require('./corpus/fill-contemporary-novels-23.js'));
add(require('./corpus/fill-contemporary-novels-24.js'));
add(require('./corpus/fill-contemporary-novels-25.js'));
add(require('./corpus/fill-contemporary-novels-26.js'));

/* ── Issue #381 第十四轮（批次三·诗歌）· 中国现当代诗歌（整组补齐）────
   用户点的 1 2 3 4 里第 3 步的后半段：诗歌 68 部、戏剧 44 部。 */
add(require('./corpus/fill-poems-1.js'));
add(require('./corpus/fill-poems-2.js'));
add(require('./corpus/fill-poems-3.js'));
add(require('./corpus/fill-poems-4.js'));
add(require('./corpus/fill-poems-5.js'));
add(require('./corpus/fill-poems-6.js'));
add(require('./corpus/fill-poems-7.js'));
add(require('./corpus/fill-poems-8.js'));
add(require('./corpus/fill-poems-9.js'));
add(require('./corpus/fill-poems-10.js'));

/* ── Issue #381 第十四轮（批次四·戏剧）· 中国现代戏剧（整组补齐） */
add(require('./corpus/fill-drama-1.js'));
add(require('./corpus/fill-drama-2.js'));
add(require('./corpus/fill-drama-3.js'));
add(require('./corpus/fill-drama-4.js'));
add(require('./corpus/fill-drama-5.js'));
add(require('./corpus/fill-drama-6.js'));

/* 中国现代戏剧 45 部至此整组补齐 */

/* 中国现当代诗歌 69 部至此整组补齐 */

/* 中国当代小说 121 部整组补齐（batch 2 第一批） */

/* 中国当代小说至此整组补齐（书目表 121 部全部有素材） */

/* ── 三、Issue #381 第十一轮：用户点名的中国古典小说 22 部 ─────────────
   用户原话先列了 22 部书名（《三国演义》到《孽海花》），再让「按你的计划
   继续补充」。前六部（四大名著 + 儒林外史 + 聊斋志异）上一轮已在，其余
   十六部书目表里原本没有，这一轮按「演义 / 神魔 / 话本 / 笔记 / 侠义公案 /
   晚清谴责」几片补进来，书目表 800 → 816 部，中国古典小说组 6 → 22 部。
   分四册装：
     fill-classic-1.js  世说新语 / 封神演义 / 东周列国志 / 隋唐演义 / 说岳全传 / 镜花缘
     fill-classic-2.js  喻世明言 / 警世通言 / 醒世恒言 / 初刻拍案惊奇 / 二刻拍案惊奇
     fill-classic-3.js  官场现形记 / 二十年目睹之怪现状 / 老残游记 / 孽海花
     fill-classic-4.js  三侠五义（单列一册：侠义公案一类的开端，「续小五义」
                        一类要收时接着往这一册里添） */
add(require('./corpus/fill-classic-1.js'));
add(require('./corpus/fill-classic-2.js'));
add(require('./corpus/fill-classic-3.js'));
add(require('./corpus/fill-classic-4.js'));

/* ── Issue #381 第十五轮（批次三）· 中国现当代诗歌 ─────────────────────
   按计划「诗歌 → 戏剧 → 外国文学」往下填。这一组书目表 69 部，已交 1 部
   （艾青诗选），余 68 部按每册 3—10 部往下填。 */
add(require('./corpus/fill-poetry-1.js'));
add(require('./corpus/fill-poetry-2.js'));
add(require('./corpus/fill-poetry-3.js'));
add(require('./corpus/fill-poetry-4.js'));
add(require('./corpus/fill-poetry-5.js'));
add(require('./corpus/fill-poetry-6.js'));
add(require('./corpus/fill-poetry-7.js'));
add(require('./corpus/fill-poetry-8.js'));
add(require('./corpus/fill-poetry-9.js'));
add(require('./corpus/fill-poetry-10.js'));
add(require('./corpus/fill-poetry-11.js'));
add(require('./corpus/fill-poetry-12.js'));
add(require('./corpus/fill-poetry-13.js'));
add(require('./corpus/fill-poetry-14.js'));
add(require('./corpus/fill-poetry-15.js'));
add(require('./corpus/fill-poetry-16.js'));
add(require('./corpus/fill-poetry-17.js'));
add(require('./corpus/fill-poetry-18.js'));
add(require('./corpus/fill-poetry-19.js'));
add(require('./corpus/fill-poetry-20.js'));

/* ── Issue #381 第十七轮（批次五）· 外国文学（开张）──────────────────
   按计划「戏剧 → 外国文学」往下填，中小学必读那一批优先。这一组书目表
   446 部，已交 2 部（昆虫记 / 古拉格群岛），本批交 10 部。 */
add(require('./corpus/fill-world-1.js'));
add(require('./corpus/fill-world-2.js'));
add(require('./corpus/fill-world-3.js'));
add(require('./corpus/fill-world-4.js'));
add(require('./corpus/fill-world-5.js'));
add(require('./corpus/fill-world-6.js'));

/* 《古拉格群岛》单装一册 —— 用户 2026-09-29 复核：不是禁书，放回原处。
   与下面 BANNED 里那 8 部不同，它 2015 年起在大陆有正式出版物。 */
add(require('./corpus/fill-gulag.js'));

/* ── Issue #381 第十七轮（批次五·外国文学）─────────────────────────────
   「外国文学」书目表 445 部，是本轮最大的一段，按国别 / 语种分册往下填。
   本册英国古典与必读一批 14 部。 */
add(require('./corpus/fill-foreign-1.js'));

/* ── Issue #381 第十八轮（批次五·外国文学·续二）· 中小学必读那一批 ───
   用户 2026-09-29：「按中小学必读 → 英 → 法 → 俄苏 → 其他语种来吧」。
   外国文学书目表 446 部。上一册（fill-foreign-1.js）已交英国古典与必读
   14 部；这一册接着把「中小学必读」点名的那一批补齐（汤姆·索亚 / 爱丽丝 /
   彼得·潘 / 柳林风声 / 绿野仙踪 / 秘密花园 / 小妇人 / 夏洛的网 / 绿山墙 /
   假如给我三天光明 / 森林报 / 钢铁 / 高尔基自传三部 / 名人传 / 安徒生 /
   格林 / 海底两万里 / 八十天 / 悲惨世界 / 巴黎圣母院 / 战争与和平 / 安娜 /
   复活 / 老人与海 / 堂·吉诃德 / 一千零一夜 / 伊索 / 希腊神话 / 木偶奇遇记 /
   爱的教育 / 小王子 / 哈姆雷特）。与上一册重叠的 9 部（鲁滨逊 / 格列佛 /
   金银岛 / 简·爱 / 呼啸山庄 / 傲慢与偏见 / 双城记 / 雾都孤儿 / 大卫·科波菲尔）
   不再重收 —— 一部书一处。梗概六块、人物 ≥15 位的口径与国内各组完全一致。 */
add(require('./corpus/fill-world-1.js'));
add(require('./corpus/fill-world-2.js'));
add(require('./corpus/fill-world-3.js'));
add(require('./corpus/fill-world-4.js'));
add(require('./corpus/fill-world-5.js'));
add(require('./corpus/fill-world-6.js'));
add(require('./corpus/fill-world-7.js'));

/* ── Issue #381 第二十一轮（批次七·外国文学·法国片）──────────────────
   用户原话「按中小学必读 → 英 → 法 → 俄苏 → 其他语种来吧」。英国那批已交
   16 部（fill-foreign-1），这一册接法国片 10 部。 */
add(require('./corpus/fill-foreign-fr.js'));

/* ── Issue #381 第三十六轮（批次十九·外国文学·法国片）────────────────
   用户原话「加大每批的量（比如每批 40—50 部）尽快收口」。这一批法国片 31 部：
   童话与小说 6（-2）、莫泊桑与凡尔纳与名人传与《第二性》6（-3）、
   凡尔纳余部与启蒙思想与诗 19（-4）。 */
add(require('./corpus/fill-foreign-fr-2.js'));
add(require('./corpus/fill-foreign-fr-3.js'));
add(require('./corpus/fill-foreign-fr-4.js'));

/* ── Issue #381 第二十三轮（批次七·外国文学·俄苏片）──────────────────
   用户原话「按中小学必读 → 英 → 法 → 俄苏 → 其他语种来吧」。英国、美国、
   法国各片已交，这一册接**俄苏片**：俄国 47 + 苏联 23 部，已交 9 部
   （战争与和平 / 安娜·卡列尼娜 / 复活 / 童年 / 在人间 / 我的大学 /
   钢铁是怎样炼成的 / 古拉格群岛 / 森林报），本册逐册写入，一部只占一处。
   分五册装（一册 2—10 部），便于分批校读。 */
add(require('./corpus/fill-foreign-ru.js'));
add(require('./corpus/fill-foreign-ru-2.js'));
add(require('./corpus/fill-foreign-ru-3.js'));
add(require('./corpus/fill-foreign-ru-4.js'));
add(require('./corpus/fill-foreign-ru-5.js'));
add(require('./corpus/fill-foreign-ru-6.js'));
add(require('./corpus/fill-foreign-ru-7.js'));

/* ── Issue #381 第三十二轮（批次十三·外国文学·俄苏片余部）───────────
   这一批把**俄国片余下 31 部**一次交齐（陀思妥耶夫斯基 6 / 托尔斯泰 2 /
   屠格涅夫 5 / 契诃夫 8 / 普希金 2 / 果戈理 1 / 莱蒙托夫 1 / 奥斯特洛夫斯基 1 /
   涅克拉索夫 1 / 阿赫玛托娃 2 / 帕斯捷尔纳克 1 / 叶赛宁 1 / 马雅可夫斯基 1）。
   分十五册装（一册 1—3 部），便于分批校读。 */
add(require('./corpus/fill-foreign-ru-8.js'));
add(require('./corpus/fill-foreign-ru-9.js'));
add(require('./corpus/fill-foreign-ru-10.js'));
add(require('./corpus/fill-foreign-ru-11.js'));
add(require('./corpus/fill-foreign-ru-12.js'));
add(require('./corpus/fill-foreign-ru-13.js'));
add(require('./corpus/fill-foreign-ru-14.js'));
add(require('./corpus/fill-foreign-ru-15.js'));
add(require('./corpus/fill-foreign-ru-16.js'));
add(require('./corpus/fill-foreign-ru-17.js'));
add(require('./corpus/fill-foreign-ru-18.js'));
add(require('./corpus/fill-foreign-ru-19.js'));
add(require('./corpus/fill-foreign-ru-20.js'));
add(require('./corpus/fill-foreign-ru-21.js'));
add(require('./corpus/fill-foreign-ru-22.js'));

/* ── Issue #381 第二十四轮（批次八·外国文学·其他语种·日本片）──────────
   用户原话「按中小学必读 → 英 → 法 → 俄苏 → 其他语种来吧」。英、法、俄苏
   各片已交，这一轮接**其他语种**里的日本片：书目表里日本共 38 部，此前
   一部未收（书目里最早一批只有「万叶集」等书的条目、没有素材）。本批一次
   交齐 38 部，一部只占一处，分四册装（古典与夏目漱石 10 + 芥川/川端等 9 +
   三岛/太宰/谷崎等 12 + 村上春树与和歌 7）。 */
add(require('./corpus/fill-foreign-jp-1.js'));
add(require('./corpus/fill-foreign-jp-2.js'));
add(require('./corpus/fill-foreign-jp-3.js'));
add(require('./corpus/fill-foreign-jp-4.js'));

/* ── Issue #381 第二十九轮（批次十一·外国文学·美国片）────────────────
   英国片封口后接着美国片。美国书目表 73 部，此前已交 7 部，这一轮按册
   往下填；目录见 scripts/data/corpus/fill-foreign-us-*.js。 */
add(require('./corpus/fill-foreign-us-1.js'));
add(require('./corpus/fill-foreign-us-2.js'));
add(require('./corpus/fill-foreign-us-3.js'));
add(require('./corpus/fill-foreign-us-4.js'));
add(require('./corpus/fill-foreign-us-5.js'));
add(require('./corpus/fill-foreign-us-6.js'));
add(require('./corpus/fill-foreign-us-7.js'));
add(require('./corpus/fill-foreign-us-8.js'));
add(require('./corpus/fill-foreign-us-9.js'));

/* ── Issue #381 第三十六轮（批次十九·外国文学·美国片封口）────────────
   用户原话「加大每批的量（比如每批 40—50 部）尽快收口；历史名家暂不补充」。
   美国片余部这一次交齐（美国片 73/73 封口），另加法国片 31 部。
   分五册装：儿童文学 5（-10）、儿童文学 5（-11）、拓荒 2 与科幻 6（-12）、
   科幻 4（-13）、诗 7（-14）。小公子 / 小公主 / 精灵鼠小弟 三部已在
   #436 交过（就装在本目录 us-9.js 里），本批不再重复。 */
add(require('./corpus/fill-foreign-us-10.js'));
add(require('./corpus/fill-foreign-us-11.js'));
add(require('./corpus/fill-foreign-us-12.js'));
add(require('./corpus/fill-foreign-us-13.js'));
add(require('./corpus/fill-foreign-us-14.js'));

/* ── Issue #381 第三十四轮（批次十五·外国文学·苏联片）───────────────
   苏联书目表 23 部，此前已交 8 部，这一轮把余下 15 部按册往下填。 */
add(require('./corpus/fill-foreign-su-1.js'));

/* ── Issue #381 第二十五轮（批次九·外国文学·英国片·余部）──────────────
   用户原话「按你的计划，尽快完成吧 每次最少提交100」。英国片书目表 83 部，
   此前已交 18 部（fill-foreign-1 一批 + 中小学必读一批），余 65 部按册往下填。
   本册 16 部：毛姆 3、戈尔丁 1、奥威尔 2、赫胥黎 1、威尔斯 3、
   柯南·道尔 1、金斯利 1、吉卜林 1、柯林斯 2、哈代 1。 */
add(require('./corpus/fill-foreign-uk-1.js'));
add(require('./corpus/fill-foreign-uk-2.js'));
add(require('./corpus/fill-foreign-uk-3.js'));
add(require('./corpus/fill-foreign-uk-4.js'));
add(require('./corpus/fill-foreign-uk-5.js'));
add(require('./corpus/fill-foreign-uk-6.js'));
add(require('./corpus/fill-foreign-uk-7.js'));add(require('./corpus/fill-foreign-uk-8.js'));
add(require('./corpus/fill-foreign-uk-9.js'));
add(require('./corpus/fill-foreign-uk-10.js'));
add(require('./corpus/fill-foreign-uk-11.js'));
add(require('./corpus/fill-foreign-uk-12.js'));add(require('./corpus/fill-foreign-uk-13.js'));
add(require('./corpus/fill-foreign-uk-14.js'));
add(require('./corpus/fill-foreign-uk-15.js'));
add(require('./corpus/fill-foreign-uk-16.js'));
add(require('./corpus/fill-foreign-uk-17.js'));
add(require('./corpus/fill-foreign-uk-hp1.js'));
add(require('./corpus/fill-foreign-uk-hp2.js'));
add(require('./corpus/fill-foreign-uk-hp3.js'));
add(require('./corpus/fill-foreign-uk-po1.js'));
add(require('./corpus/fill-foreign-uk-po2.js'));
add(require('./corpus/fill-foreign-uk-po3.js'));
add(require('./corpus/fill-foreign-uk-po4.js'));
add(require('./corpus/fill-foreign-uk-po5.js'));

/* ── Issue #381 第三十一轮（批次十二·外国文学·法国片与德国片）──────────
   用户原话「不要4部就提交pr 至少60部提交一个 pr, 请继续完成全部的内容和PR
   最后更新 sw.js version」。英国 / 美国 / 日本 / 俄苏各片已交，这一轮接着把
   法国片与德国片的余部按册一次交齐（每册 2—3 部，便于分批校读）。 */
add(require('./corpus/fill-foreign-fr-1.js'));
add(require('./corpus/fill-foreign-fr-2.js'));
add(require('./corpus/fill-foreign-fr-3.js'));
add(require('./corpus/fill-foreign-fr-4.js'));
add(require('./corpus/fill-foreign-fr-5.js'));
add(require('./corpus/fill-foreign-fr-6.js'));
add(require('./corpus/fill-foreign-fr-7.js'));
add(require('./corpus/fill-foreign-fr-8.js'));
add(require('./corpus/fill-foreign-fr-9.js'));
add(require('./corpus/fill-foreign-fr-10.js'));
add(require('./corpus/fill-foreign-fr-11.js'));
add(require('./corpus/fill-foreign-de-1.js'));
add(require('./corpus/fill-foreign-de-2.js'));
add(require('./corpus/fill-foreign-de-3.js'));
add(require('./corpus/fill-foreign-de-4.js'));
add(require('./corpus/fill-foreign-de-5.js'));
add(require('./corpus/fill-foreign-de-6.js'));
add(require('./corpus/fill-foreign-de-7.js'));
add(require('./corpus/fill-foreign-de-8.js'));
add(require('./corpus/fill-foreign-de-9.js'));
add(require('./corpus/fill-foreign-de-10.js'));
add(require('./corpus/fill-foreign-de-11.js'));
add(require('./corpus/fill-foreign-de-12.js'));
add(require('./corpus/fill-foreign-de-13.js'));
add(require('./corpus/fill-foreign-de-14.js'));
add(require('./corpus/fill-foreign-fr-de-15.js'));

/* ── Issue #381 第三十八轮（批次二十·外国文学·余下各片）──────────────
   用户原话「继续剩余的添加」。外国文学书目 446 部，此前已交 333 部，
   余 113 部：奥地利 / 瑞士、苏联余部、北欧、南欧（伊比利亚）、意大利、
   古希腊罗马、两河埃及、阿拉伯、朝韩、印度、黎巴嫩、爱尔兰、拉美与东欧。
   本轮分两批交齐，批一 79 部（奥地利 10 + 苏联 17 + 北欧 16 +
   伊比利亚 9 + 意大利 11 + 古希腊罗马 16）。 */
add(require('./corpus/fill-foreign-at-1.js'));
add(require('./corpus/fill-foreign-su-2.js'));
add(require('./corpus/fill-foreign-su-3.js'));
add(require('./corpus/fill-foreign-nordic-1.js'));
add(require('./corpus/fill-foreign-nordic-2.js'));
add(require('./corpus/fill-foreign-iberia-1.js'));
add(require('./corpus/fill-foreign-it-1.js'));
add(require('./corpus/fill-foreign-gr-1.js'));
add(require('./corpus/fill-foreign-gr-2.js'));
add(require('./corpus/fill-foreign-rome-1.js'));

/* 批二 34 部：古文明（两河 / 古埃及 / 阿拉伯 / 朝鲜）7、印度 12
   （泰戈尔 6 + 古印度史诗与思想著作 6）、世界诗选集 15
   （纪伯伦 3 / 叶芝 2 / 洛尔迦 / 聂鲁达 2 / 博尔赫斯 / 辛波斯卡 2 /
     米沃什 / 塞弗尔特 / 特兰斯特罗默 / 阿米亥）。 */
add(require('./corpus/fill-foreign-ancient-1.js'));
add(require('./corpus/fill-foreign-in-1.js'));
add(require('./corpus/fill-foreign-in-2.js'));
add(require('./corpus/fill-foreign-po-world-1.js'));

/* 余下的书按组分册，避免单文件过大 */
add(require('./mingshu-corpus-stub.js'));

/* ── 五、禁书剔除（Issue #381 · 用户原话 + 用户复核）───────────────────
   用户原话：「如果含有国内外禁书的，一律删除」。

   口径（一轮复核后钉死）：**在大陆被明令查禁，或至今没有正式出版发行**
   的图书，一律不收；国内与国外同一把尺子。这里只放**确凿有据**的，
   不拿「听说被禁」当理由 —— 下面每条都记着依据，免得日后有人当漏收的
   补回来，也免得再出现一次「把正式出版物当禁书删掉」。

     废都        贾平凹，1993 年出版后遭查禁，1997 年出删节本，
                 长期被当作「禁书」的代表
     心灵史      张承志，1991 年出版后因宗教内容遭限制、下架
     晚霞消失的时候  礼平，1980 年代初受批判并停止发行
     公开的情书  靳凡，文革后「地下文学」，长期未能正式出版
     波动        赵振开（北岛），「地下文学」，长期未能正式出版
     绝对信号 / 车站 / 野人   高行健的三部剧作，其作品在大陆被禁

   ⚠️ 曾经在这个名单里、**已按用户复核移出**的一例，记在这里备查：
     《古拉格群岛》索尔仁尼琴 —— 曾按「在大陆从未正式出版」列入，实际是
     1982 年群众出版社以「内部发行」本出版（供学术研究参考，不公开零售），
     2015 年该社转为公开出版发行，属正规出版物、可合法购买阅读。**不是禁书**，
     已放回书目表与素材库。守卫里单独点名守着，防再被误删。

   做法：书目表（mingshu-books.js）里已把不合格的整行删去；素材库里若还
   留着它们的旧稿，在这里统一滤掉 —— 单点剔除，不散在几个分册文件里，
   删了哪几部一眼看得见。守卫见 test/mingshu-books.test.js「禁书」那一节。 */
const BANNED = [
  '废都', '心灵史', '晚霞消失的时候', '公开的情书', '波动',
  '绝对信号', '车站', '野人'
];
BANNED.forEach(function (t) { delete CORPUS[t]; });

/* 不是禁书 —— 与 BANNED 配着看：复核后确认在大陆有正式出版物，谁删谁错。 */
const ALLOWED = ['古拉格群岛'];

module.exports = { CORPUS: CORPUS, BANNED: BANNED, ALLOWED: ALLOWED };
