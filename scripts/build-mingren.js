/* ==========================================================================
   历代名家 · 装机（脚本）
   --------------------------------------------------------------------------
   两件事：**改正文主表**（增 / 删 / 重编 id）与**出壳文件**
   （两份壳 data/poems-mingren-cn.js / -foreign.js）。壳文件不再是手改的 —— 由主表生成。

   ## 为什么这样改（Issue #381 第六轮的教训）
   前五轮这个脚本是「只增不改」的：它把新名单往主表末尾追加，再照着
   「壳里已有哪些人」算新号。第六轮要**删条目**，一删，后面所有号都要
   重编，而「壳里已有哪些人」这件事就不足为凭 —— 壳正是要重写的东西。

   于是反过来：**data/text-master.js 是唯一真相来源**。
     · 已在主表里的条目：title / 正文 从主表读，一个字段都不动；
     · 要删的：从主表整条摘掉（真删，不是标注「未收录」）；
     · 新增的：算好正文后定点插进主表；
     · 号段：按 GROUP_ORDER + 旧号次序重排，从 mr-01 起连续给号，
       再按「旧号 → 新号」对照表重写主表里那一段的 id / work / entries。
       对照表**不落盘**，每次现算 —— 落了盘，下一次运行就会把过期的
       对照当成既成事实（上一轮真踩过这个坑）。

   ## 分组从哪来（merge origin/main 之后的新口径）
   主表条目不带分组。分组的唯一出处是**壳里已记的组 + 本轮名单**：
     · 主表现存的每一条，分组从壳读回来（`p.title → p.group`）——
       所以 PR #388 刚落的十四组中国 + 九组外国原样保留，不动一格；
     · 本轮名单（politics / military / mingren-new / mingren-corpus）
       给的行可以**重给分组**，这是「换组」的唯一入口，按名字认、不按 id 认。
   历史上这里还跑过一份 `CN_CATS / WORLD_CATS` 归类表 —— 那是 #388 那一支
   自己造号时用的，与本支的「重编号」叠着用会被覆盖掉，已删。

   ## 第十三轮（Issue #399）：真拆两部
   用户原话：「课外阅读历代名家还是重新拆分成 历代名家「中国」/ 历代名家
   「外国」两个集子。」

   于是本脚本从**一份壳**变成**两份壳**：
     · 国别：每条的国别（中国 / 外国）由 `isForeignEntry()` 判出 ——
       原来那套靠分组名 + 人名白名单 + 朝代栏国别词的猜测**保留但下沉**，
       它现在只负责**落字段**；字段一旦落下，页面与断言都认字段，不再猜。
     · 号段：两卷各自从 01 起（中国 mr-c-01…、外国 mr-w-01…）—— 「拆」之后
       两卷是两个独立集子，卷一第 3 位不必叫「mr-03」以外的号。
       ⚠️ 跨卷的**一人一处**仍是主表那一份（title 唯一），只是 id 各卷各排。
     · 正文位置：两卷条目仍混排在主表同一段（主表按 title 索引，不分卷），
       所以 `masterTextOf` 的查找不用改；**阅读进度**按 url 各自的
       `poem_mingren_cn_read_v1` / `poem_mingren_foreign_read_v1` 分家，
       老键 `poem_mingren_read_v1` 的 171 条已读记录由 js/mingren.js 迁移过去。

   用具：
     node scripts/build-mingren.js             # 只出壳（不动主表）
     node scripts/build-mingren.js --master    # 同时改写 data/text-master.js
     node scripts/build-mingren.js --check     # 只校验，不写盘
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const T = require('./lib/table.js');
const P = require('./lib/entry-patch.js');
const LY = require('./lib/life-year.js');
const M = require('./data/mingren-corpus.js');
const LEGACY_SHELL_ROWS = require('./data/mingren-legacy-shell.js').LEGACY_SHELL;

const ROOT = path.join(__dirname, '..');
const MASTER_FILE = path.join(ROOT, 'data/text-master.js');
const SHELL_CN = path.join(ROOT, 'data/poems-mingren-cn.js');
const SHELL_FOREIGN = path.join(ROOT, 'data/poems-mingren-foreign.js');


/* ── 名单来源 ────────────────────────────────────────────────────────── */
const LEGACY = M.LEGACY;                     // 已上线的 135 位（id 台账）
const PEOPLE = M.PEOPLE;                     // 第四轮起的素材总表（真源）
const ROUND5   = require('./data/mingren-round5.js');    // 第六轮：要删的
const POL      = require('./data/mingren-politics.js');  // 第六轮：政治家 中外
const MIL      = require('./data/mingren-military.js');  // 第六轮：军事家 中外
const OLD      = require('./data/mingren-new.js');       // 第四轮：文学 / 思想 / 哲学
const AXIS     = require('./data/mingren-axis.js');      // 第七轮：德 / 意 政治与军事
const R9       = require('./data/mingren-round9.js');    // 第九轮：补齐行当 + 归位
const R10      = require('./data/mingren-round10.js');   // 第十轮：并组 + 补美术 / 音乐 / 经济
const R11      = require('./data/mingren-round11.js');   // 第十一轮：帝王归位（Issue #407）

/* ── 分组：十五个行当，不分中国 / 外国两类 ──────────────────────────────
   用户原话（Issue #381 · 本轮）：「将外国和中国的各个家合并，不区分中国
   外国两大类，按时间顺序排列。」

   所以上一版那二十五组（中国十五 + 外国十）并成十五组：组就是**行当**，
   中外一位同组。原来那几个「外国 ××家」组改回通用组名，中国那几组的
   「（中国）」括注也一并去掉 —— 名字里不该再带国别。

   组与组的先后只是**版面上**的次序（列表页一段一段摊开），一位归哪一组
   看的是「世所公认的第一身份」；**整个册子的次序是出生时间**，不是组。 */
const GROUP_ORDER = [
  /* 第十轮：把散格并回主干（用户原话「水利家和茶学家合并到农学家」「考古
     合并到 历史学家」「法学家合并到政治家」「翻译家合并到语言文字学家」
     「外交家合并到政治家」「画家要改成美术家」「建筑家合并到美术家」
     「水利 / 农学 / 工艺 / 教育 / 考古按合适的类别合并」）。
     二十六组 → 十七组：美术家（画家 + 建筑家）、历史学家（史学家 + 考古）、
     农学家（+ 水利 / 茶学）、政治家（+ 法学 / 外交）、语言文字学家（+ 翻译）、
     思想家（+ 教育）；工艺家按类拆（造器物 → 科学家、营造与工艺美术 → 美术家）。 */
  '政治家', '文学家', '历史学家', '思想家', '哲学家', '军事家',
  '科学家', '医学家', '农学家', '天文地理学家', '生物学家',
  '美术家', '书法家', '戏曲家', '音乐家',
  '语言文字学家', '经济学家'
];

/* 组名映射：上一版的分组 → 本轮的分组（合并中外，去「外国」「（中国）」前缀）。
   只在**能唯一定位**时才映射；映射表管不到的（「外国名人」）由下面的
   SCIENCE_OF_NAME 按人名认回各科。 */
const GROUP_MERGE = {
  '外国数学家': '科学家',
  '外国物理学家': '科学家',
  '外国化学家': '科学家',
  '外国生物学家': '生物学家',
  '外国天文学家': '天文地理学家',
  '外国医学家': '医学家',
  '外国文学家': '文学家',
  '外国艺术家': '美术家',
  '外国建筑家': '美术家',

  /* 第十轮：组名归并（上一版 → 本版）。组不按人删，只按名字并 ——
     一位归哪一组看的是「世所公认的第一身份」。 */
  '画家': '美术家',          // 改名（不只是绘画，含雕塑等造型艺术）
  '建筑家': '美术家',        // 用户：「建筑家合并到美术家」
  '史学家': '历史学家',      // 改名（用户：「考古 合并到 历史学家」）
  '考古学家': '历史学家',    // 用户：「考古 合并到 历史学家」
  '水利家': '农学家',        // 用户：「水利家和茶学家合并到农学家」
  '茶学家': '农学家',
  '法学家': '政治家',        // 用户：「法学家合并到政治家」
  '外交家': '政治家',        // 用户：「外交家合并到政治家」
  '翻译家': '语言文字学家',  // 用户：「翻译家合并到语言文字学家」
  '教育家': '思想家'         // 用户：「教育…按合适的类别合并」
};

/* 「外国名人」拆回各科：这一组是上一轮留下的筐（数学 / 物理 / 化学 / 生物 /
   天文 / 医学 / 工程各科的人都在里面）。合并中外时按人名一一认回各科 ——
   认的是「他的第一身份是哪一科」，写在下面这张表里，而不是按朝代栏猜。
   不在表里的（真·跨行业的名人）落「科学家」。 */
const SCIENCE_OF_NAME = {
  // 数学家
  '欧拉': '科学家', '高斯': '科学家',
  // 物理学家
  '牛顿': '科学家', '法拉第': '科学家', '焦耳': '科学家', '开尔文': '科学家',
  '麦克斯韦': '科学家', '伦琴': '科学家', '普朗克': '科学家', '爱因斯坦': '科学家',
  '玻尔': '科学家', '费米': '科学家', '图灵': '科学家', '杨振宁': '科学家', '霍金': '科学家',
  // 化学家
  '道尔顿': '科学家', '拉瓦锡': '科学家', '门捷列夫': '科学家', '居里夫人': '科学家',
  // 生物学家
  '达尔文': '生物学家', '孟德尔': '生物学家', '巴斯德': '生物学家', '林奈': '生物学家',
  '哈维': '生物学家', '波特': '生物学家',
  // 医学家
  '盖伦': '医学家',
  // 发明家 / 工程
  '富兰克林': '科学家', '莫尔斯': '科学家', '诺贝尔': '科学家',
  '贝尔': '科学家', '莱特兄弟': '科学家', '冯·诺依曼': '科学家'
};

/* 本轮名单：分组 → 行。同一名字出现两次即报错（一人一处）。
   ⚠️ 本轮起「组内次序」不再由这张表决定 —— 整个册子按出生时间排
   （见下面的 sortByBirth）。这里给的组名仍有效：它是新开条归哪一组、
   以及换组的唯一入口。 */
const PLAN = [
  { group: '政治家', rows: POL.TP_CN },
  { group: '政治家', rows: POL.TP_WORLD },
  { group: '政治家', rows: AXIS.TP_AXIS },
  { group: '军事家', rows: MIL.TB_CN },
  { group: '军事家', rows: MIL.TB_WORLD },
  { group: '军事家', rows: AXIS.TB_AXIS },
  /* 第四轮的名单仍要过一遍：它们大多已在册（按旧号排），少数几条
     （#388 之后新落的素材）会在这里第一次开条。 */
  { group: '文学家', rows: OLD.TY },
  { group: '思想家', rows: OLD.TZ },
  { group: '哲学家', rows: OLD.TW },
  { group: '外国名人', rows: OLD.TA }
].concat(R9.PLAN, R10.PLAN).map(function (plan) {
  /* 第九 / 第十轮的名单里还写着**上一版**的组名（工艺家、考古学家、
     水利家……）。第十轮把那些格并掉了，所以这里统一过一次 groupOf，
     让「并组」这件事对名单同样生效 —— 名单是入册的入口，不是例外。 */
  return { group: groupOf(plan.group, plan.rows[0] && plan.rows[0][0]), rows: plan.rows };
});

/* 本轮要删的（先算出来，PLAN 校验与装配都要用） */
const DROP_EARLY = ROUND5.DROP;
const dropSetEarly = {};
DROP_EARLY.forEach(function (t) { dropSetEarly[t] = true; });

/* 第九轮：合并同人两条（DEDUPE）的「要删名单」。
   上一轮收了两条的同一个人（塞内加 / 塞涅卡、阿奎那 / 托马斯·阿奎那、
   笛卡尔 / 笛卡儿、吴趼人 / 吴沃尧），本轮把「次的那条」整条删掉，
   正文留 keep 那一条。这份名单必须**在这里**算出来（PLAN 之前）：
   前几轮的名单（mingren-new.js 的 PLAN）里还点着塞涅卡、笛卡儿、吴沃尧，
   不先挡住，PLAN 会把他们再开一条。 */
const DEDUPE_DROP = R9.DEDUPE.map(function (d) { return d.drop; });
DEDUPE_DROP.forEach(function (t) { dropSetEarly[t] = true; });
/* 第十轮：请回来的两位（聂耳 / 冼星海，见 mingren-round10.js 的 REINSTATE）——
   上一轮把他们列进了要删名单，这一轮点名要收，所以从「要删」里撤出来，
   随 PLAN 正常入册。 */
(R10.REINSTATE || []).forEach(function (t) { delete dropSetEarly[t]; });

/* ── 不许进册的 · 明治维新以后的日本政治 / 军事人物 ─────────────────────
   用户原话（Issue #381）：「轴心国除了日本的政治军事家，其他国家的政治，
   军事家可以添加，但是要从雅尔塔会议，开罗宣言以及二战后的国际秩序角度
   进行评价。帮我清理删除明治维新以后的日本的政治家军事家，如果有的话」

   尺子一条：**明治维新（1868）以后**的日本**政治 / 军事人物**全删
   （含明治、大正、昭和三个时期）；文学家、艺术家、科学家照旧保留 ——
   川端康成 / 夏目漱石 / 芥川龙之介 / 三岛由纪夫是作家，留。
   收进来之前先过一遍这条尺子，别等收了再删（另见 scripts/remove-mingren-jp.js：
   那一份负责排查「已在壳里的」，这一道闸负责拦截「还没进册的」）。

   判据是「分组 + 国别 + 生卒」三件套，两个坑写在下面。 */
/* 判据三件套：① 身份落在政治 / 军事两组；② 朝代 / 国别栏是日本；
   ③ **活在明治维新（1868）以后**。三条同时成立才拦。

   ③ 这条为什么不用「生于 1868 以后」：
   明治维新的主角大多**生在 1868 以前** —— 伊藤博文（1841—1909）、
   大久保利通（1830—1878）、山县有朋（1838—1922）、东乡平八郎（1848—1934）
   都是幕末出生、明治当政。按生年卡，这几位会一个个从尺子里漏过去，
   而用户点名的正是他们。所以判的是**卒年**：卒于 1868 年以后的，
   说明他的政治 / 军事生涯横跨明治维新之后，拦下。

   ⚠️ 另两个坑（也都真踩过）：
   · **不能只看年代**：丘吉尔（1874—1965）、戴高乐（1890—1970）、
     甘地（1869—1948）卒年都在 1868 之后 —— 只看年份会把上一轮刚收的
     外国政治家一并误杀。国别那一栏是必须的。
   · **不能只看国别**：在册的 4 位日本文学家（川端康成 / 夏目漱石 /
     芥川龙之介 / 三岛由纪夫）朝代栏写的正是「日本」，但那一条靠
     「分组不是政治 / 军事」留下来 —— 文学家、艺术家、科学家照旧保留。 */
const MEIJI = 1868;
function isPostMeijiJapanPolitical(group, dynasty, life) {
  if (group !== '政治家' && group !== '军事家') return false;
  if (!/日本/.test(String(dynasty || ''))) return false;
  /* 生卒栏形如「1841—1909」「1890—1970」「1841—（在世）」「？—1945」。
     取**最后一个** 3—4 位数字当卒年（在世 / 卒年不详 → 当作活到 1868 之后）。
     带「前」的（公元前）一律不算明治以后。 */
  const t = String(life || '');
  if (/前s*\d/.test(t)) return false;
  const ys = t.match(/\d{3,4}/g);
  if (!ys) return true;
  return parseInt(ys[ys.length - 1], 10) >= MEIJI;
}

/* ── 国别：拆两部的落点（Issue #399）────────────────────────────────────
   判定与 test/mingren-guard.test.js 那套**同源**（那里本是唯一的一份），
   这里搬过来做落字段用 —— 一份判据两处用，不能各说各话。 */
const FOREIGN_MARK = ['古希腊', '古罗马', '古马其顿', '东罗马', '迦太基', '英国', '法国',
  '美国', '南非', '印度', '意大利', '普鲁士', '德国', '瑞典', '俄罗斯', '苏联', '埃及',
  '中亚', '蒙古', '波兰', '奥地利', '荷兰', '西班牙', '葡萄牙', '日本', '伊朗', '波斯',
  '以色列', '土耳其', '捷克', '匈牙利', '丹麦', '挪威', '瑞士', '比利时', '希腊', '罗马',
  /* 第十三轮：两部真拆之后，这一路要靠字段兜住，补上原先漏掉的国别词 ——
     漏掉的会落错卷（这一条比「守边界」那一条更要紧）。 */
  '阿拉伯', '伊拉克', '叙利亚', '黎巴嫩', '巴勒斯坦', '以色列', '阿富汗',
  '朝鲜', '韩国', '越南', '泰国', '缅甸', '马来', '菲律宾', '印尼', '印度尼西亚',
  '澳大利亚', '新西兰', '加拿大', '墨西哥', '巴西', '阿根廷', '智利', '秘鲁',
  '爱尔兰', '苏格兰', '威尔士', '芬兰', '冰岛', '塞尔维亚', '克罗地亚', '斯洛文尼亚',
  '保加利亚', '罗马尼亚', '乌克兰', '白俄罗斯', '格鲁吉亚', '亚美尼亚', '阿塞拜疆',
  '乌兹别克', '哈萨克', '吉尔吉斯', '塔吉克', '巴基斯坦', '孟加拉', '斯里兰卡',
  '尼泊尔', '不丹', '沙特', '约旦', '也门', '阿曼', '卡塔尔', '科威特', '摩洛哥',
  '突尼斯', '利比亚', '苏丹', '埃塞俄比亚', '肯尼亚', '尼日利亚', '加纳', '刚果',
  '安哥拉', '赞比亚', '津巴布韦', '坦桑尼亚', '乌干达', '塞内加尔', '马里',
  '塞尔柱', '奥斯曼', '拜占庭', '安纳托利亚',
  /* 第十四轮：正则修好后，仍有一批沙俄人物只写「俄国」（词表里只有
     「俄罗斯」），一并补齐变体 —— 漏一个词就落错卷（普希金、托尔斯泰这
     一批就是这么进的「中国」卷）。 */
  '俄国', '沙俄', '沙皇', '拜占廷', '鄂图曼', '大食', '天竺', '罗刹'];
const FOREIGN_NAME = [
  '波普尔', '阿伦特', '乔姆斯基', '纳什', '陈省身', '陶哲轩',
  '海森堡', '狄拉克', '费曼', '朗道', '吴健雄', '丁肇中',
  '鲍林', '霍奇金', '李远哲', '沃森', '克里克', '威尔逊', '古尔德', '道金斯',
  '萨根', '索尔克', '贝克特', '米兰·昆德拉', '斯坦贝克', '奥威尔', '聂鲁达',
  '马尔克斯', '略萨', '三岛由纪夫', '达利', '波洛克', '沃霍尔',
  '肖斯塔科维奇', '贝聿铭'
];

/* 一位是外国还是中国：① 白名单点名；② 正文「朝代」那一栏里的国别词。
   组名那一路（「外国 ××家」）已经并掉了，不再作为判据 —— 中外的界限
   现在落在**字段**上，不再靠组名暗示。 */
function isForeignEntry(title, text) {
  if (FOREIGN_NAME.indexOf(title) >= 0) return true;
  /* ⚠️ 正文「朝代」那一栏现在写的是「│ 朝代 / 国别 │」（自 Issue #381 起），
     早先那条 `│ 朝代 *│` 认不出它 —— 于是国别整路落空、全册回落到「中国」，
     贝多芬就这样进了中国卷（Issue #399 用户点名）。与下面的 dynastyOf() 对齐。 */
  const dyn = (String(text || '').match(/│ 朝代(?: \/ 国别)? *│([^│]*)│/) || ['', ''])[1];
  return FOREIGN_MARK.some(function (k) { return dyn.indexOf(k) >= 0; });
}

const FIELDS = ['姓名', '朝代', '字 / 号', '生卒', '籍贯', '家世亲属',
  '生平', '作品风格', '流派', '主要作品 / 作为', '特殊意义'];

/* ── 身份：该是什么家写清是什么家（Issue #381 · 第十轮 用户原话）─────────
   正文「流派」一行，开头补一个具体身份词（数学家 / 物理学家 / 雕塑家 /
   建筑家 / 作曲家……），而不是笼统的组名。合并过的组尤其需要 ——
   「科学家」里是数学 / 物理 / 化学各科，「美术家」里是画家 / 雕塑家 /
   建筑家 / 工艺美术家。身份来源：R10.IDENTITY 按人给，取不到就用组名。 */
const GROUP_ROLE = {
  '政治家': '政治家', '文学家': '文学家', '历史学家': '历史学家',
  '思想家': '思想家', '哲学家': '哲学家', '军事家': '军事家',
  '科学家': '科学家', '医学家': '医学家', '农学家': '农学家',
  '天文地理学家': '天文学家', '生物学家': '生物学家', '美术家': '美术家',
  '书法家': '书法家', '戏曲家': '戏曲家', '音乐家': '音乐家',
  '语言文字学家': '语言文字学家', '经济学家': '经济学家'
};
function roleOf(group, name) {
  return (R10.IDENTITY && R10.IDENTITY[name]) || GROUP_ROLE[group] || group;
}
/* 把身份写进「流派」单元格：本来就写了的不重复（如「音乐家」条目、
   或身份词已在前缀里的）。 */
function withIdentity(text, group, name) {
  if (!text) return text;
  const role = roleOf(group, name);
  const m = String(text).match(/^(│ 流派 *│)([^│]*)(│.*)$/m);
  if (!m) return text;
  const cell = m[2].trim();
  if (cell.indexOf(role) >= 0) return text;
  return String(text).replace(/^(│ 流派 *│)([^│]*)(│.*)$/m,
    function (all, pre, val, post) {
      return pre + ' ' + role + ' ·' + val + post;
    });
}
/* 标签归一：第 11 个字段的旧名「主要作品 / 贡献」换成中性的「主要作品 / 作为」。
   这一部里收着希特勒、墨索里尼这一类人，「贡献：第二次世界大战、犹太人大屠杀」
   是荒谬的 —— 「贡献」预设了正面价值。「作为」只陈述一个人做过什么，好坏留给
   「特殊意义」那一栏去评。两个标签的显示宽度都是 15，替换不动表格框线。
   只改标签，不动任何条目的内容（axis 里那一条的措辞另作中性化处理）。 */
function neutralizeLabel(t) {
  return String(t || '').split('主要作品 / 贡献').join('主要作品 / 作为');
}

const MIN_TOTAL = 400;   // 正文净字数下限（表格线不计）

const problems = [];     // 校验积攒下来的问题，有一条就不写盘

/* 正文净字数：表格线与标点都不算 */
const PUNCT = /[\s·，。、；：「」『』（）()《》〈〉—…？！“”‘’\-－/、]+/g;
function nchars(s) { return String(s == null ? '' : s).replace(PUNCT, '').length; }

/* ── 正文：十一行表 + 一句话。与前几轮同一种形状 ──────────────────────── */
function bodyOf(r) {
  const rows = FIELDS.map(function (label, i) { return [label, r[i]]; });
  return [T.box(rows), '', '【一句话】' + r[r.length - 1]].join('\n');
}


/* ── 主表：唯一真相来源 ─────────────────────────────────────────────── */
let SRC = fs.readFileSync(MASTER_FILE, 'utf8');
const MASTER = (function () {
  const s = { window: {}, console };
  s.window = s;
  vm.createContext(s);
  vm.runInContext(SRC, s, { filename: MASTER_FILE });
  return s.TEXT_MASTER || [];
})();
/* 主表里历代名家那一段。Issue #399 拆两部之后号是 mingren-mr-c-xx /
   mingren-mr-w-xx；**重跑时也要认新号**，否则第二次跑会把两卷的条目
   当成「不在主表里」（幂等性就断在这里）。 */
const mrOf = MASTER.filter(function (m) {
  return /^mingren-mr-(?:[cw]-)?\d+$/.test(String(m.id));
});

/* 在册条目的当前分组：从壳文件读回来。壳是上一轮的产物，但**分组信息只在它
   里面** —— 本轮名单里重给的行会覆盖它，这就是「换组」的入口。 */
const SHELL_GROUP = (function () {
  const s = { window: {}, console };
  s.window = s;
  vm.createContext(s);
  /* 读回**两份**壳（拆两部之后上一轮的产物；第一次跑时两份都还没有，
     分组则全部由名单给出）—— 两卷合起来看，分组信息不分卷。 */
  [SHELL_CN, SHELL_FOREIGN].forEach(function (f) {
    if (!fs.existsSync(f)) return;
    vm.runInContext(fs.readFileSync(f, 'utf8'), s, { filename: f });
  });
  const map = {};
  ['POEMS_MINGREN_CN', 'POEMS_MINGREN_FOREIGN'].forEach(function (v) {
    (s[v] || []).forEach(function (p) { map[p.title] = p.group; });
  });
  return map;
})();

const byTitle = {};
mrOf.forEach(function (m) { byTitle[m.title] = m; });

/* ── 校验名单 ────────────────────────────────────────────────────────── */
const seenName = {};
const added = [];
PLAN.forEach(function (plan) {
  /* PLAN 里给的组名是**上一版**的叫法（「外国名人」等），合并映射之后
     才能对 GROUP_ORDER 比对 —— 认的仍是这一张表，不另开一份名单。 */
  if (GROUP_ORDER.indexOf(groupOf(plan.group, plan.rows[0] && plan.rows[0][0])) < 0) {
    problems.push('分组不在 GROUP_ORDER：' + plan.group);
    return;
  }
  plan.rows.forEach(function (r) {
    if (r.length !== FIELDS.length + 1) {
      problems.push((r[0] || '?') + ' 字段数 ' + r.length + '（应为 ' + (FIELDS.length + 1) + '）');
      return;
    }
    FIELDS.forEach(function (f, i) {
      if (!String(r[i] || '').trim()) problems.push((r[0] || '?') + ' 缺' + f);
    });
    if (nchars(bodyOf(r)) < MIN_TOTAL) {
      problems.push(r[0] + ' 正文 ' + nchars(bodyOf(r)) + ' 字（下限 ' + MIN_TOTAL + '）');
    }
    /* 前几轮的名单里可能有本轮要删的人（名单是累积的）—— 删的优先级最高 */
    if (dropSetEarly[r[0]]) return;
    /* 明治维新以后的日本政治 / 军事人物：名单里有也直接跳过，不进册 */
    if (isPostMeijiJapanPolitical(plan.group, r[1], r[3])) {
      problems.push('明治维新以后的日本政治 / 军事人物不得入册：' + r[0]);
      return;
    }
    if (seenName[r[0]]) { problems.push('名单里出现两次：' + r[0]); return; }
    seenName[r[0]] = true;
    added.push({ group: plan.group, row: r });
  });
});

/* ── 删除：按名字从主表摘掉 ─────────────────────────────────────────── */
/* 第十一轮（Issue #407）：帝王归位 —— 本身即为君主 / 执政元首的那几位
   从历代名家摘掉，正文由帝王两卷各出专条。名单见 mingren-round11.js。 */
const DROP_RULERS = R11.DROP_RULERS || [];
const DROP = DROP_EARLY.slice().concat(DEDUPE_DROP).concat(DROP_RULERS)
  .filter(function (t) { return (R10.REINSTATE || []).indexOf(t) < 0; });
/* 要删的条目主表里没有 → **不算错**：上一轮已经删过，本次是重跑。
   名单本身就是「哪些人该在 / 不该在」的落点（不是差量），
   所以每次运行都拿它当全集衡量，而不是拿「上次删了什么」。 */
const dropGone = DROP.filter(function (t) { return !byTitle[t]; });
if (dropGone.length) console.log('（其中 ' + dropGone.length + ' 位早已不在主表：' +
  dropGone.slice(0, 6).join('、') + (dropGone.length > 6 ? ' …' : '') + '）');
const dropSet = {};
DROP.forEach(function (t) { dropSet[t] = true; });

/* ── 第九轮的归位（MOVE）──────────────────────────────────────────────
   已在册的人**只改组**，正文一个字不动。挪组就是改 NAME_GROUP，
   与 PLAN 那条路同一个出口 —— 所以「一人一处」的规矩不会被绕开。 */
const R9_MOVE_NAMES = Object.keys(R9.MOVE);
R9_MOVE_NAMES.forEach(function (n) {
  if (!byTitle[n]) problems.push('第九轮要归位的 ' + n + ' 不在主表里');
  const g = groupOf(R9.MOVE[n], n);
  if (GROUP_ORDER.indexOf(g) < 0) problems.push('第九轮归位组不在 GROUP_ORDER：' + n + ' → ' + g);
});
R9.DEDUPE.forEach(function (d) {
  if (!byTitle[d.keep]) problems.push('第九轮要保留的 ' + d.keep + ' 不在主表里');
});

/* ── 第十轮的归位（MOVE）──────────────────────────────────────────────
   与第九轮同一条路：已在册的人只改组，正文不动。这一轮它办两件事 ——
     · 21 位西洋音乐家从「画家」挪回「音乐家」（上一轮并「外国艺术家」
       时一并带进来的，见 mingren-round10.js 的说明）；
     · 「工艺家」按类拆开：造器物的归「科学家」，营造与工艺美术的归
       「美术家」。 */
const R10_MOVE_NAMES = Object.keys(R10.MOVE);
R10_MOVE_NAMES.forEach(function (n) {
  if (!byTitle[n]) problems.push('第十轮要归位的 ' + n + ' 不在主表里');
  const g = groupOf(R10.MOVE[n], n);
  if (GROUP_ORDER.indexOf(g) < 0) problems.push('第十轮归位组不在 GROUP_ORDER：' + n + ' → ' + g);
});

/* ── 组装最终名册 ───────────────────────────────────────────────────── */
/* PLAN 里给过的行：按名字建 index（换组也走这里） */
const REPLAN = {};
added.forEach(function (a) { REPLAN[a.row[0]] = a; });

/* 一人一处：姓名 → PLAN 给的组，本轮的名单优先于壳里记的组 */
const NAME_GROUP = {};
Object.keys(SHELL_GROUP).forEach(function (t) { NAME_GROUP[t] = SHELL_GROUP[t]; });
/* ① 本轮名单（PLAN）里给过的行：组以名单为准 */
added.forEach(function (a) { NAME_GROUP[a.row[0]] = a.group; });
/* ② 第九轮的归位**最后落** —— 它要压过两处旧口径：
     壳里记的旧组（SHELL_GROUP），与前几轮 PLAN 里重新点过的组
     （徐光启在 mingren-new.js 的 TZ 里、子产 / 商鞅在 politics 里、
      韩非在 TZ 里、玄奘在 TZ 里）。用户这一轮点的就是「谁属于哪一家」，
      所以归位的优先级最高。 */
R9_MOVE_NAMES.forEach(function (n) { NAME_GROUP[n] = groupOf(R9.MOVE[n], n); });
/* ③ 第十轮的归位 —— 也压过壳里记的旧组（音乐家原本写在「画家」里、
     蔡伦们原本写在「工艺家」里）。 */
R10_MOVE_NAMES.forEach(function (n) { NAME_GROUP[n] = groupOf(R10.MOVE[n], n); });

const ROSTER = [];
/* ① 在册未删的：正文与 title 从主表来，分组从名单 / 壳来。
      排序先按**组**、再按**旧号** —— 组内次序即老名次，一点不乱。 */
const kept = [];
mrOf.forEach(function (m) {
  if (dropSet[m.title]) return;
  const a = REPLAN[m.title];
  const group = groupOf(NAME_GROUP[m.title], m.title);
  if (!group) { problems.push(m.title + ' 没有分组（壳里也没记）'); return; }
  if (isPostMeijiJapanPolitical(group, dynastyOf(m.text), lifeOf(m.text))) return;
  kept.push({
    title: m.title, group: group, oldId: m.id,
    /* 名单里重给过的，正文一并换新（名单是更新的一份）；
       不论新旧，正文的「流派」一行都补上身份词（该是什么家写清是什么家）。 */
    text: withIdentity(neutralizeLabel(a ? bodyOf(a.row) : m.text), group, m.title),
    row: a ? a.row : null,
    replace: !!a,
    /* 原正文：用来判断这一条到底改没改（第十轮的身份词是原地改，不是换整条） */
    origText: m.text
  });
});
kept.sort(function (a, b) {
  const ga = GROUP_ORDER.indexOf(a.group), gb = GROUP_ORDER.indexOf(b.group);
  if (ga !== gb) return ga - gb;
  return parseInt(a.oldId.slice(3), 10) - parseInt(b.oldId.slice(3), 10);
});
kept.forEach(function (r) { ROSTER.push(r); });

/* 分组归一：中国那几组「（中国）」括注去掉之后与通用组同名；
   外国那几组按 GROUP_MERGE 并回行当组。
   —— 这是「合并中外」这件事的**落点**，见上面的 GROUP_ORDER 说明。 */
function groupOf(g, name) {
  if (!g) return g;
  if (GROUP_MERGE[g]) return GROUP_MERGE[g];
  if (GROUP_ORDER.indexOf(g) >= 0) return g;
  /* 「外国名人」这一组里是数学 / 物理 / 化学 / 生物 / 天文 / 医学各科的人，
     拆回各科要按人名一一认（认的是「第一身份是哪一科」），认不出的按「科学家」。
     表见上面的 SCIENCE_OF_NAME。 */
  if (g === '外国名人') return SCIENCE_OF_NAME[name] || '科学家';
  /* 「工艺家」没有单一归处（用户：「工艺…按合适的类别合并」），按人名拆：
     造器物的归「科学家」，营造与工艺美术的归「美术家」。名单里点到的
     蔡伦 / 毕昇 / 马钧 / 黄道婆 / 沈寿 等，逐个在 R10.MOVE 里有落点。 */
  if (g === '工艺家') return R10.MOVE[name] || '科学家';
  return g;
}

/* ② 本轮新开条的：正文算出来，次序照 PLAN 给的 */
const FRESH = [];
added.forEach(function (a) {
  const n = a.row[0];
  if (byTitle[n]) return;                 // 已在册，上面处理过了（含换组与换正文）
  /* ⚠️ 名单里点过、但主表里已被删的人（#407 归位到帝王两卷的 6 位君主等），
     不能再当「新开条」补回来 —— 少了这一道，`--master` 重跑一次就把它们
     从名单里复活（主表里没有 → 走 FRESH 分支），与 #407 的口径相抵。 */
  if (dropSet[n]) return;
  if (isPostMeijiJapanPolitical(a.group, a.row[1], a.row[3])) return;
  const rec = { title: n, group: a.group, text: withIdentity(bodyOf(a.row), a.group, n), row: a.row, replace: false };
  ROSTER.push(rec);
  FRESH.push(rec);
});

/* ③ 素材总表（mingren-corpus）里的人：本轮名单没点名、主表里也没有的，
      按 PEOPLE 里记的组补开条 —— 只在 #388 落过素材、且本轮名单未收时才走到。 */
const ROSTER_NAME = {};
ROSTER.forEach(function (r) { ROSTER_NAME[r.title] = true; });
PEOPLE.forEach(function (p) {
  if (ROSTER_NAME[p.name] || dropSetEarly[p.name]) return;
  const group = groupOf(p.group || GROUP_ORDER[1], p.name);
  if (GROUP_ORDER.indexOf(group) < 0) {
    problems.push('素材表的 ' + p.name + ' 分组不在 GROUP_ORDER：' + group);
    return;
  }
  if (isPostMeijiJapanPolitical(group, p.era, p.life)) return;
  const rec = {
    title: p.name, group: group,
    text: withIdentity(bodyOf2(p), group, p.name), row: null, replace: false
  };
  ROSTER.push(rec);
  FRESH.push(rec);
  ROSTER_NAME[p.name] = true;
});

/* 素材对象 ⇄ 行 两种输入，正文同一个出法 */
function bodyOf2(p) {
  const r = [p.name, p.era, p.zi, p.life, p.origin, p.family,
    p.bio, p.style, p.school, p.works, p.worth, p.tag];
  return bodyOf(r);
}

/* ── 按出生时间排（Issue #381 · 本轮用户原话）──────────────────────────
   「将外国和中国的各个家合并，不区分中国外国两大类，按时间顺序排列。」

   上一版是「先分组、组内按生年」—— 那还是把中外分成两摞（中国十五组
   在前、外国十组在后），一位唐代诗人与一位同时期的外国诗人隔着几百行。
   本轮**整个册子一条时间线**：梭伦挨着管仲，康德挨着戴震，谁生在先谁在前。

   生年取主表正文的「生卒」行，交给 scripts/lib/life-year.js 出一个可比较
   的数值键（生年不详的用卒年回推 / 世纪折中）。键相同的（如王翦与廉颇同记
   「约前 3 世纪」）按上一版的名次定序 —— 不随机、每次跑出来一样。 */
const PREV_RANK = {};
mrOf.forEach(function (m, i) { PREV_RANK[m.title] = i; });

(function sortByBirth() {
  const birthOf = {};
  ROSTER.forEach(function (rec, i) {
    const life = rec.row ? rec.row[3] : lifeOf(rec.text);
    birthOf[rec.title] = LY.birthYearOf(life);
    if (PREV_RANK[rec.title] == null) PREV_RANK[rec.title] = 10000 + i;
  });
  ROSTER.sort(function (a, b) {
    const c = LY.compareBirth(birthOf[a.title], birthOf[b.title]);
    if (c) return c;
    /* 同年（或同年粗估）的：组名先排（版面上同类相邻），再按上一版名次 */
    const ga = GROUP_ORDER.indexOf(a.group), gb = GROUP_ORDER.indexOf(b.group);
    if (ga !== gb) return ga - gb;
    return PREV_RANK[a.title] - PREV_RANK[b.title];
  });
})();

/* ── 四、守卫：条数 / 分组 / 字段 / 净字数 ─────────────────────────────── */
const countOf = {};
ROSTER.forEach(function (rec) { countOf[rec.group] = (countOf[rec.group] || 0) + 1; });

console.log('主表在册 ' + mrOf.length + ' 位');
console.log('删除 ' + DROP.length + ' 位' +
  (dropGone.length ? '（其中 ' + dropGone.length + ' 位早已不在主表）' : '') +
  '：' + DROP.join('、'));
console.log('名单 ' + added.length + ' 位：已在册 ' + (added.length - FRESH.length > 0 ? added.length - FRESH.length : 0) +
  ' 位、本轮新开条 ' + FRESH.length + ' 位');
const BODY_COUNT = {};
Object.keys(countOf).forEach(function (g) { BODY_COUNT[g] = countOf[g]; });
console.log('名册共 ' + ROSTER.length + ' 位，号段 mr-01 … mr-' +
  String(ROSTER.length).padStart(2, '0'));
console.log('分组：' + GROUP_ORDER.map(function (g) {
  return g + ' ' + (countOf[g] || 0);
}).join(' · '));

const bodySeen = {};
FRESH.forEach(function (rec) {
  const n = nchars(rec.text);
  if (n < MIN_TOTAL) problems.push(rec.title + ' 正文 ' + n + ' 字（下限 ' + MIN_TOTAL + '）');
  bodySeen[rec.title] = true;
});

/* ── 号段：两卷各自从 01 起（Issue #399）─────────────────────────────────
   拆成两部之后，两卷是两个独立集子 —— 中国卷 mr-c-01…、外国卷 mr-w-01…。
   顺序**不动**：各自仍按全册那条出生时间线走（第 i 位在卷内还是第 i 位）。
   ⚠️ 两卷的 textRef 不同（mingren-mr-c-01 / mingren-mr-w-01），所以
      「一人在一册里只占一行」这条规矩由主表那一份管（title 唯一）；
      两卷不会出现同一个人 —— 判国别是**二值**的，没有第三个去处。 */
const RENUMBER = {};
const counting = { cn: 0, foreign: 0 };
ROSTER.forEach(function (rec) {
  rec.foreign = isForeignEntry(rec.title, rec.text);
  rec.volume = rec.foreign ? 'foreign' : 'cn';
  counting[rec.volume] += 1;
  const newId = (rec.foreign ? 'mr-w-' : 'mr-c-') + String(counting[rec.volume]).padStart(2, '0');
  if (rec.oldId) RENUMBER[rec.oldId] = newId;
  rec.newId = newId;
});
const CN_ROSTER = ROSTER.filter(function (r) { return !r.foreign; });
const FOREIGN_ROSTER = ROSTER.filter(function (r) { return r.foreign; });
console.log('拆两部：历代名家「中国」' + CN_ROSTER.length + ' 家 · 历代名家「外国」' +
  FOREIGN_ROSTER.length + ' 家（全册仍按出生时间一条线）');

if (problems.length) {
  console.error('✗ 有 ' + problems.length + ' 项不合规（前 20）：' +
    problems.slice(0, 20).join('、'));
  process.exit(1);
}


/* ── 写主表 ──────────────────────────────────────────────────────────── */
if (process.argv.indexOf('--check') >= 0) process.exit(problems.length ? 1 : 0);

if (process.argv.indexOf('--master') >= 0) {
  /* ① 删：整条摘掉（含 ② 之后的重编号，所以这里只删不改号） */
  let removed = 0;
  DROP.forEach(function (t) {
    const m = byTitle[t];
    if (!m) return;
    SRC = removeEntry(SRC, m.id);
    removed += 1;
  });

  /* ② 已在册但正文要换新的：定点改写 text */
  let refreshed = 0;
  ROSTER.forEach(function (rec) {
    /* 判据是「正文真的变了」—— 两种情况都算：
       · 名单里重给过正文的（replace，正文换成新写的一份）；
       · 第十轮在原地补「身份词」的（正文只多了一行身份）。
       所以不再单看 `replace`，也不因为 `rec.row` 有值就跳过。 */
    if (!rec.oldId) return;
    if (rec.origText == null || rec.origText === rec.text) return;
    const id = rec.oldId;
    const at = SRC.indexOf('    id: ' + JSON.stringify(id) + ',');
    if (at < 0) throw new Error('找不到 ' + id);
    const from = SRC.indexOf('    text: ', at);
    const lineEnd = SRC.indexOf('\n', from);
    SRC = SRC.slice(0, from) + '    text: ' + JSON.stringify(rec.text) + ',' + SRC.slice(lineEnd);
    refreshed += 1;
  });

  /* ③ 新开条：先用临时 id 插进主表，转圈后再统一编号 */
  const tmpIds = [];
  FRESH.forEach(function (rec) {
    const tmp = 'mingren-TMP' + String(tmpIds.length).padStart(4, '0');
    SRC = insertEntry(SRC, tmp, rec.title, rec.text);
    tmpIds.push({ tmp: tmp, rec: rec });
  });

  /* ④ 重编号：把 mr-* 与 TMP* 一起编成连续号。
       做法：把 mingren-* 那一段整体抽出来按 ROSTER 的次序重排，
       id / work / entries 一起换。 */
  SRC = rebuildBlock(SRC, ROSTER, tmpIds);

  /* ⑤ Issue #399（真拆两部）：把 mingren 那一段的**主表 id** 也重编成两卷号
        （mingren-mr-c-xx / mingren-mr-w-xx）。
        ⚠️ 为什么必须动主表：主表按 id 索引，壳按 textRef 去查；两卷的号与
           老号不同位（中国卷第 1 位不是主表第 1 位），不重编就得靠对应表
           现算 —— 那等于把「哪一份正文是谁的」这件事藏在运行期里。
           重编是**幂等**的：已是新号的条目按 title 认，再跑不重复改。 */
  SRC = rekeyMasterForVolumes(SRC, ROSTER);

  fs.writeFileSync(MASTER_FILE, SRC, 'utf8');
  console.log('✓ data/text-master.js：删除 ' + removed + ' 条、改写 ' + refreshed +
    ' 条正文、新增 ' + FRESH.length + ' 条、全段已重编号');
}

/* ── 出壳：两部各出一份（Issue #399 真拆两部）────────────────────────────
   两条壳的**形状完全一样**（textRef / id / title / group / gradeGroup /
   dynasty / author / source / excerpt），只多一个 country 字段 —— 拆两部
   这件事落在数据上就是这一个字段，页面、搜索、断言以后都认它，不再猜。 */
function shellOf(rec) {
  const life = rec.row ? rec.row[3] : lifeOf(rec.text);
  const one = rec.row ? rec.row[rec.row.length - 1] : tailOf(rec.text);
  return {
    id: rec.newId,
    /* 主表里这一条正文的 id（= 上一轮的老号）。两卷各出一份壳，正文仍只有
       一份 —— 这条线就是「哪一份正文」的明写落点，不靠号段对齐去猜。 */
    masterRef: rec.oldId || rec.newId,
    title: rec.title,
    group: rec.group,
    country: rec.foreign ? '外国' : '中国',
    dynasty: rec.row ? rec.row[1] : (dynastyOf(rec.text) || '—'),
    source: '《' + rec.title + '》·' + (life || '生卒不详'),
    excerpt: one || ''
  };
}

function writeShell(file, varName, roster, label) {
  const lines = [];
  lines.push('window.' + varName + ' = [');
  roster.forEach(function (rec) {
    const sh = shellOf(rec);
    lines.push('  {');
    /* masterRef 指向主表里那一份正文（拆两部后两卷 id 段不同，正文仍只有一份）。
       页面按 textRef 去主表取；取不到时按 masterRef 兜底 —— 一条明写的线，
       不靠「编号恰巧相等」。 */
    lines.push('    textRef: ' + JSON.stringify('mingren-' + sh.id) + ',');
    lines.push('    masterRef: ' + JSON.stringify(sh.masterRef) + ',');
    lines.push('    id: ' + JSON.stringify(sh.id) + ',');
    lines.push('    title: ' + JSON.stringify(sh.title) + ',');
    lines.push('    group: ' + JSON.stringify(sh.group) + ',');
    lines.push('    gradeGroup: ' + JSON.stringify(sh.group) + ',');
    lines.push('    country: ' + JSON.stringify(sh.country) + ',');
    lines.push('    dynasty: ' + JSON.stringify(sh.dynasty) + ',');
    lines.push('    author: ' + JSON.stringify(sh.title) + ',');
    lines.push('    source: ' + JSON.stringify(sh.source) + ',');
    lines.push('    excerpt: ' + JSON.stringify(sh.excerpt));
    lines.push('  },');
  });
  lines.push('];');
  lines.push('');
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  console.log('✓ ' + path.relative(ROOT, file) + ' 已写出，' + label + ' ' + roster.length + ' 位');
}

writeShell(SHELL_CN, 'POEMS_MINGREN_CN', CN_ROSTER, '历代名家「中国」');
writeShell(SHELL_FOREIGN, 'POEMS_MINGREN_FOREIGN', FOREIGN_ROSTER, '历代名家「外国」');

/* ── 小工具 ──────────────────────────────────────────────────────────── */

/* 从主表的正文里取「一句话」（末段 '【一句话】…'） */
function tailOf(text) {
  const m = String(text).match(/【一句话】(.+)\s*$/);
  return m ? m[1].trim() : '';
}
/* 取「生卒」一行的值 */
function lifeOf(text) {
  const m = String(text).match(/│ 生卒 *│([^│]*)│/);
  return m ? m[1].trim() : '';
}
function dynastyOf(text) {
  const m = String(text).match(/│ 朝代(?: \/ 国别)? *│([^│]*)│/);
  return m ? m[1].trim() : '';
}
/* 整条删除 */
function removeEntry(src, id) {
  const marker = '    id: ' + JSON.stringify(id) + ',';
  const at = src.indexOf(marker);
  if (at < 0) throw new Error('主表里找不到 ' + id);
  const start = src.lastIndexOf('\n  {', at);
  const end = src.indexOf('\n  },', at) + 5;
  return src.slice(0, start) + src.slice(end);
}
/* 定点插入一条（在 mingren-mr-* 段的末尾之后） */
function insertEntry(src, id, title, text) {
  let h = 5381;
  const raw = [text, '', ''].join('\u0001');
  for (let i = 0; i < raw.length; i += 1) h = ((h * 33) ^ raw.charCodeAt(i)) >>> 0;
  const version = h.toString(36);
  const block = [
    '  {',
    '    work: ' + JSON.stringify('w-' + id) + ',',
    '    id: ' + JSON.stringify(id) + ',',
    '    title: ' + JSON.stringify(title) + ',',
    '    entries: [' + JSON.stringify(id) + '],',
    '    text: ' + JSON.stringify(text) + ',',
    '    translation: "",',
    '    translationSource: "",',
    '    version: ' + JSON.stringify(version),
    '  },'
  ].join('\n');
  const lastAt = src.lastIndexOf('    id: "mingren-');
  if (lastAt < 0) throw new Error('主表里没有 mingren-* 那一段');
  const end = src.indexOf('\n  },', lastAt) + 5;
  return src.slice(0, end) + '\n' + block + src.slice(end);
}
/* ── 主表里的两卷号（Issue #399）──────────────────────────────────────
   主表按 id 索引，壳的 textRef 要按新号查得到那一条。拆两部换号之后，
   主表里 mingren 那一段的 id / work / entries 也得跟着换 —— 换的是**键**，
   正文逐字不动。

   幂等：先按 title 收齐主表里 mingren 那一段（不管它是老号还是新号），
   再按 ROSTER 的次序（= 号段次序）重写每一块的 id / work / entries。 */
function rekeyMasterForVolumes(src, roster) {
  const firstAt = src.indexOf('    id: "mingren-');
  if (firstAt < 0) return src;
  const lastAt = src.lastIndexOf('    id: "mingren-');
  const start = src.lastIndexOf('\n  {', firstAt);
  const end = src.indexOf('\n  },', lastAt) + 5;

  const parts = [];
  let i = start;
  while (true) {
    const s0 = src.indexOf('\n  {', i);
    if (s0 < 0 || s0 >= end) break;
    const e0 = src.indexOf('\n  },', s0);
    if (e0 < 0) break;
    parts.push(src.slice(s0, e0 + 5));
    i = e0 + 5;
  }

  const byTitle = {};
  parts.forEach(function (b) {
    const m = b.match(/^    title: "((?:[^"\\]|\\.)*)",$/m);
    if (m) byTitle[JSON.parse('"' + m[1] + '"')] = b;
  });

  const out = [];
  roster.forEach(function (rec) {
    const b = byTitle[rec.title];
    if (!b) throw new Error('主表里找不到 ' + rec.title + '（拆两部换号）');
    const newRef = 'mingren-' + rec.newId;
    out.push(b
      .replace(/^    work: "w-[^"]*",$/m, '    work: "w-' + newRef + '",')
      .replace(/^    id: "[^"]*",$/m, '    id: "' + newRef + '",')
      .replace(/^    entries: \["[^"]*"\],$/m, '    entries: ["' + newRef + '"],'));
  });
  /* 主表里 mingren 那一段必须与名册条数相等 —— 不等说明有人漏在主表外 */
  if (parts.length !== roster.length) {
    throw new Error('主表 mingren 段 ' + parts.length + ' 条、名册 ' + roster.length +
      ' 位 —— 不相等，不敢重编号');
  }
  return src.slice(0, start) + out.join('\n') + src.slice(end);
}

/* 重排 mingren-* 那一段：按 ROSTER 的次序、按新号换 id / work / entries */
function rebuildBlock(src, roster, tmpIds) {
  const tmpMap = {};
  tmpIds.forEach(function (t) { tmpMap[t.rec] = t.tmp; });

  const firstAt = src.indexOf('    id: "mingren-');
  const lastAt = src.lastIndexOf('    id: "mingren-');
  const start = src.lastIndexOf('\n  {', firstAt);
  const end = src.indexOf('\n  },', lastAt) + 5;

  const parts = [];
  let i = start;
  while (true) {
    const s = src.indexOf('\n  {', i);
    if (s < 0 || s >= end) break;
    const e = src.indexOf('\n  },', s);
    if (e < 0) break;
    parts.push(src.slice(s, e + 5));
    i = e + 5;
  }
  const byKey = {};
  parts.forEach(function (b) {
    const m = b.match(/^    title: "((?:[^"\\]|\\.)*)",$/m);
    const t = m ? JSON.parse('"' + m[1] + '"') : null;
    byKey[t] = b;
  });

  const out = [];
  roster.forEach(function (rec, idx) {
    const newId = 'mr-' + String(idx + 1).padStart(2, '0');
    let b = byKey[rec.title];
    if (!b) {
      const tmp = tmpMap[rec];
      const at = src.indexOf('    id: ' + JSON.stringify(tmp) + ',');
      if (at < 0) throw new Error('找不到新条目 ' + rec.title);
      const s = src.lastIndexOf('\n  {', at);
      const e = src.indexOf('\n  },', at);
      b = src.slice(s, e + 5);
      byKey[rec.title] = b;
    }
    out.push(b
      .replace(/^    work: "w-[^"]*",$/m, '    work: "w-mingren-' + newId + '",')
      .replace(/^    id: "[^"]*",$/m, '    id: "mingren-' + newId + '",')
      .replace(/^    entries: \["[^"]*"\],$/m, '    entries: ["mingren-' + newId + '"],'));
  });
  return src.slice(0, start) + out.join('\n') + src.slice(end);
}
