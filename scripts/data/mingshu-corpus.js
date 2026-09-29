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

/* 余下的书按组分册，避免单文件过大 */
add(require('./mingshu-corpus-stub.js'));

module.exports = { CORPUS: CORPUS };
