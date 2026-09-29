/* ==========================================================================
   历代名家 · 正文装机（脚本）
   --------------------------------------------------------------------------
   Issue #381 第四轮。用户原话：

     「唐宋名家远远不止这些吧，只加了 9 个人？？？还有其他朝代。
       画家呢？书法家？史学家？
       外国名人真的要扩充 10 倍了，各行各业，数学家，物理学家，化学家，
       生物学家，科学家，天文学家，文学家，艺术家，画家，雕刻」

   上一轮 135 位（文学家 43 / 史学家 6 / 思想家 11 / 哲学家 13 / 军事家 10 /
   科学家 9 / 医学家 6 / 音乐家 7 / 建筑家 8 / 戏曲家 8 / 外国名人 14）
   这一轮扩到 649 位，并把「外国名人」这一个筐按学科拆成十组：

     中国（十四组）文学家 / 史学家 / 思想家 / 哲学家 / 书法家 / 画家 /
       军事家 / 科学家 / 医学家 / 音乐家 / 建筑家 / 戏曲家 / 天文学家 / 生物学家
     外国（十组）  哲学家 / 数学家 / 物理学家 / 化学家 / 生物学家 /
       天文学家 / 医学家 / 文学家 / 艺术家 / 建筑家

   ## 一台三层
     ① id 台账   scripts/data/mingren-legacy.js   已有的 135 位（号不能动）
     ② 素材       scripts/data/mingren-rows-*.js  姓名 / 时代 / 字 / 生卒 / 籍贯 / 家世
                  scripts/data/mingren-text-*.js  生平 / 风格 / 流派 / 作品 / 意义
     ③ 本脚本     CATS 归类 + 正文装配 + 硬阈值守卫 + 写回两处数据文件

   ## id 的规矩
     已上线的 135 位**沿用旧号**（mr-01 … mr-176，号段里有跳号，那是上一轮补人
     留下的）。新人为 mr-177 起续编。已读记录（poem_mingren_read_v1）、搜索索引、
     自选集合快照、外链全挂在旧号上，号一挪用户的已读就串了。

   ## 一人一处
     中国部分的 14 组是「行当」，同一个人往往跨行当。归类尺子是**世所公认的第
     一身份**，写在 CATS 里逐条列出：
       · 王维（诗人 / 画家）→ 文学家；沈括（科学家 / 天文学家）→ 科学家
       · 张衡（天文学家 / 文学家）→ 沿用旧号所在的组
     这样每一组都互斥，列表页上不会同一个人出现两次。

   用法：
     node scripts/build-mingren.js --check     # 只校验素材与阈值
     node scripts/build-mingren.js             # 出壳 data/poems-mingren.js
     node scripts/build-mingren.js --master    # 同时改写 data/text-master.js
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const T = require('./lib/table.js');
const M = require('./data/mingren-corpus.js');
const LEGACY_SHELL_ROWS = require('./data/mingren-legacy-shell.js').LEGACY_SHELL;

const ROOT = path.join(__dirname, '..');
const PEOPLE = M.PEOPLE;
const LEGACY = M.LEGACY;

const argv = process.argv.slice(2);
const WANT_MASTER = argv.indexOf('--master') >= 0;
const CHECK_ONLY = argv.indexOf('--check') >= 0;
const STRICT = argv.indexOf('--strict') >= 0;

/* ── 一、归类：每一位归到哪个「家」─────────────────────────────────────── */
/* 十四组中国 + 十组外国。命中顺序即优先级：一个人只进第一处命中的组。
   表里列的是「按第一身份应当归入」的名家 —— 与 CATS 的组名一一对应。 */
const CN_CATS = [
  ['书法家', ['李斯', '王羲之', '王献之', '王珣', '智永', '欧阳询', '虞世南',
    '褚遂良', '颜真卿', '柳公权', '张旭', '怀素', '孙过庭', '李阳冰', '蔡襄',
    '米芾', '赵孟頫', '鲜于枢', '康有为']],
  ['画家', ['顾恺之', '陆探微', '张僧繇', '展子虔', '阎立本', '吴道子', '李思训',
    '韩幹', '韩滉', '周昉', '顾闳中', '范宽', '郭熙', '张择端', '赵佶', '郭忠恕',
    '李唐', '马远', '夏圭', '黄公望', '吴镇', '倪瓒', '沈周', '文徵明', '唐寅',
    '仇英', '董其昌', '陈洪绶', '朱耷', '石涛', '郑燮', '金农', '郎世宁', '任颐',
    '吴昌硕', '齐白石', '黄宾虹', '徐悲鸿', '潘天寿', '张大千', '傅抱石', '林风眠']],
  ['天文学家（中国）', ['甘德', '石申', '落下闳', '一行', '苏颂', '李善兰', '张钰哲', '南仁东']],
  ['生物学家（中国）', ['贾思勰', '王祯', '徐霞客', '秉志', '胡先骕', '童第周', '谈家桢', '钟扬']],
  ['史学家', ['杜佑', '刘知几', '司马光', '郑樵', '马端临', '谈迁', '钱大昕',
    '王鸣盛', '赵翼', '翁同龢', '王国维', '吕思勉', '陈垣', '陈寅恪', '钱穆',
    '翦伯赞', '吴晗']],
  ['建筑家', []],
  ['思想家', ['管仲', '管子', '晏婴', '玄奘', '慧能', '程颢', '程颐', '陆九渊', '李贽',
    '戴震', '魏源', '章太炎', '胡适', '冯友兰', '梁漱溟', '蔡元培',
    '顾准', '焦循', '阮元', '陶弘景']],
  ['戏曲家', ['马致远', '白朴', '郑光祖', '乔吉', '张养浩', '睢景臣', '高明']],
  ['文学家', ['宋玉', '贾谊', '枚乘', '司马相如', '东方朔', '蔡邕', '蔡琰', '孔融',
    '施耐庵', '曹丕', '曹植', '王粲', '阮籍', '左思', '潘岳', '陆机', '张协', '郭璞', '干宝',
    '刘义庆', '刘勰', '钟嵘', '鲍照', '谢朓', '江淹', '庾信',
    '卢照邻', '骆宾王', '杨炯', '宋之问', '沈佺期', '张若虚', '张九龄', '王翰',
    '刘长卿', '韦应物', '李益', '张籍', '王建', '刘禹锡', '元稹', '温庭筠', '韦庄',
    '晏殊', '晏几道', '柳永', '范仲淹', '曾巩', '苏洵', '苏辙', '王安石',
    '黄庭坚', '秦观', '周邦彦', '贺铸', '范成大', '杨万里', '姜夔', '文天祥',
    '归有光', '袁宏道', '徐渭', '冯梦龙', '凌濛初', '李渔', '纳兰性德', '袁枚',
    '龚自珍', '黄遵宪', '李宝嘉', '吴趼人', '刘鹗',
    '张爱玲', '钱锺书', '杨绛', '汪曾祺', '孙犁', '赵树理', '艾青', '徐志摩',
    '闻一多', '戴望舒', '萧红', '郁达夫', '丁玲', '沈从文', '穆旦', '余华', '莫言',
    '贾平凹', '路遥', '阿城', '苏童', '王安忆', '海子', '北岛', '顾城', '舒婷',
    '刘慈欣', '曹文轩', '高晓声', '王朔', '迟子建',
    // 第五轮从并行那一轮并入的：汉赋、唐宋诗人、元明清小说家与现当代
    '扬雄', '贺知章', '崔颢', '元好问', '吴敬梓', '姚雪垠', '徐怀中',
    '金庸', '梁羽生', '王蒙', '陈忠实']],
  ['科学家', ['李政道', '邓稼先', '钱三强', '何泽慧', '华罗庚', '陈景润', '苏步青',
    '王选', '黄旭华', '竺可桢']]
];

/* 外国：按学科分组。命中顺序即优先级。 */
const WORLD_CATS = [
  ['外国数学家', ['毕达哥拉斯', '阿波罗尼奥斯', '丢番图', '斐波那契', '卡尔达诺',
    '韦达', '费马', '帕斯卡', '拉格朗日', '拉普拉斯', '勒让德', '柯西', '阿贝尔',
    '伽罗瓦', '黎曼', '康托尔', '庞加莱', '希尔伯特', '拉马努金', '诺特',
    '冯·诺依曼', '纳什', '陈省身', '陶哲轩']],
  ['外国物理学家', ['伽利略', '开普勒', '惠更斯', '胡克', '焦耳', '开尔文', '麦克斯韦',
    '卢瑟福', '普朗克', '玻尔', '德布罗意', '薛定谔', '海森堡', '狄拉克', '费米',
    '费曼', '朗道', '杨振宁', '吴健雄', '丁肇中', '莱特兄弟', '莫尔斯', '贝尔']],
  ['外国化学家', ['波义耳', '舍勒', '拉瓦锡', '道尔顿', '阿伏伽德罗', '门捷列夫',
    '本生', '基尔霍夫', '凯库勒', '诺贝尔', '范特霍夫', '阿伦尼乌斯', '鲍林',
    '霍奇金', '哈伯', '居里奥·居里', '侯德榜', '李远哲']],
  ['外国生物学家', ['维萨里', '林奈', '布丰', '拉马克', '居维叶', '华莱士', '孟德尔',
    '摩尔根', '巴甫洛夫', '弗莱明', '沃森', '克里克', '富兰克林', '威尔逊', '古尔德',
    '道金斯']],
  ['外国天文学家', ['托勒密', '第谷·布拉赫', '哈雷', '赫歇尔', '勒维耶', '哈勃',
    '勒梅特', '霍金', '萨根']],
  ['外国医学家', ['希波克拉底', '盖伦', '阿维森纳', '帕拉塞尔苏斯', '詹纳', '科赫',
    '南丁格尔', '哈维', '塞尔曼·瓦克斯曼', '班廷', '索尔克']],
  ['哲学家', ['赫拉克利特', '苏格拉底', '德谟克利特', '伊壁鸠鲁', '芝诺', '塞内加',
    '马可·奥勒留', '奥古斯丁', '托马斯·阿奎那', '培根', '笛卡尔', '斯宾诺莎',
    '洛克', '休谟', '卢梭', '狄德罗', '黑格尔', '叔本华', '克尔凯郭尔', '马克思',
    '加缪', '海德格尔', '维特根斯坦', '波普尔', '阿伦特', '福柯', '乔姆斯基',
    '弗洛伊德', '胡塞尔', '波伏娃', '哈耶克', '罗尔斯', '亚当·斯密']],
  ['外国文学家', ['荷马', '埃斯库罗斯', '索福克勒斯', '欧里庇得斯', '阿里斯托芬',
    '维吉尔', '奥维德', '贺拉斯', '但丁', '彼特拉克', '薄伽丘', '乔叟', '拉伯雷',
    '蒙田', '塞万提斯', '莎士比亚', '密尔顿', '莫里哀', '拉辛', '笛福', '斯威夫特',
    '菲尔丁', '歌德', '席勒', '华兹华斯', '柯勒律治', '拜伦', '雪莱', '济慈',
    '简·奥斯汀', '司汤达', '巴尔扎克', '雨果', '大仲马', '乔治·桑', '波德莱尔',
    '福楼拜', '狄更斯', '夏洛蒂·勃朗特', '艾米莉·勃朗特', '艾略特', '哈代',
    '王尔德', '肖伯纳', '叶芝', '乔伊斯', '贝克特', '普希金', '果戈理', '莱蒙托夫',
    '屠格涅夫', '陀思妥耶夫斯基', '托尔斯泰', '契诃夫', '高尔基', '马雅可夫斯基',
    '帕斯捷尔纳克', '阿赫玛托娃', '卡夫卡', '里尔克', '茨威格', '托马斯·曼',
    '黑塞', '布莱希特', '安徒生', '易卜生', '斯特林堡', '拉格洛夫', '显克微支',
    '米兰·昆德拉', '裴多菲', '洛尔迦', '佩索阿', '马克·吐温', '惠特曼', '狄金森',
    '爱伦·坡', '梅尔维尔', '詹姆斯', '海明威', '菲茨杰拉德', '福克纳', '斯坦贝克',
    '奥威尔', '伍尔夫', '劳伦斯', '聂鲁达', '博尔赫斯', '马尔克斯', '略萨',
    '川端康成', '夏目漱石', '芥川龙之介', '三岛由纪夫', '泰戈尔']],
  ['外国艺术家', ['乔托', '波提切利', '达·芬奇', '米开朗琪罗', '拉斐尔', '提香',
    '乔尔乔内', '丁托列托', '丢勒', '博斯', '勃鲁盖尔', '伦勃朗', '维米尔',
    '鲁本斯', '凡·戴克', '委拉斯开兹', '戈雅', '格列柯', '大卫', '安格尔',
    '德拉克洛瓦', '库尔贝', '米勒', '马奈', '莫奈', '雷诺阿', '德加', '塞尚',
    '高更', '梵高', '修拉', '马蒂斯', '毕加索', '布拉克', '蒙克', '克里姆特',
    '康定斯基', '蒙德里安', '马列维奇', '夏加尔', '达利', '米罗', '欧姬芙',
    '霍珀', '波洛克', '沃霍尔', '米隆', '菲迪亚斯', '波留克列特斯', '罗丹',
    '布朗库西', '亨利·摩尔', '巴赫', '亨德尔', '海顿', '莫扎特', '贝多芬',
    '舒伯特', '肖邦', '舒曼', '李斯特', '瓦格纳', '威尔第', '柴可夫斯基',
    '德沃夏克', '马勒', '德彪西', '拉赫玛尼诺夫', '斯特拉文斯基', '勋伯格',
    '肖斯塔科维奇', '乔治·格什温', '布鲁克纳']],
  ['外国建筑家', ['布鲁内莱斯基', '阿尔伯蒂', '帕拉第奥', '高迪', '赖特', '柯布西耶',
    '密斯·凡·德·罗', '格罗皮乌斯', '埃菲尔', '贝聿铭']]
];

/* 把「姓名 → 组」建成表。同一人出现在多个组里 → 报错（宁可报错也不默取第一个）。 */
const CAT = {};
const DUP = [];
function assign(list, name, group) {
  if (CAT[name]) DUP.push(name + '（' + CAT[name] + ' 与 ' + group + '）');
  else CAT[name] = group;
  void list;
}
CN_CATS.forEach(function (pair) {
  pair[1].forEach(function (n) { assign(pair[0], n, pair[0]); });
});
WORLD_CATS.forEach(function (pair) {
  pair[1].forEach(function (n) { assign(pair[0], n, pair[0]); });
});

/* 已上线的 135 位：中文那 121 位沿用上一轮所在的分组（组名不动，用户已经
   认得了）。上一轮那 14 位「外国名人」是挤在一个筐里的 —— 用户这次点名
   「各行各业」，于是把他们按学科分到新的组里去，这是唯一会挪组的 14 位。 */
const LEGACY_REGROUP = {
  '阿基米德': '外国物理学家', '欧几里得': '外国数学家', '哥白尼': '外国天文学家',
  '伽利略': '外国物理学家', '牛顿': '外国物理学家', '欧拉': '外国数学家', '高斯': '外国数学家',
  '法拉第': '外国物理学家', '达尔文': '外国生物学家', '巴斯德': '外国医学家',
  '伦琴': '外国物理学家', '居里夫人': '外国物理学家', '爱因斯坦': '外国物理学家', '图灵': '外国数学家'
};
const LEGACY_GROUP = {};
LEGACY.forEach(function (r) {
  LEGACY_GROUP[r[2]] = LEGACY_REGROUP[r[2]] || r[1];
});

/* ── 不许进册的：国共两党的政治 / 军事人物 + 明治维新以后的日本政治 / 军事人物 ──
   两条尺子，都来自 Issue #381，范围都只限本部集子。

   ① 国共两党（第五轮）。用户原话：「仅限历代名家集子，国共两党的政治，军事
      人物全删。其他名家例如文学家，作家等等保留。」
      尺子：凡身份落在「国共两党的政治人物 / 军事人物」上的，全删；本职是
      文学家、艺术家、学者、科学家的，一律保留 —— 哪怕他有政党或军政经历。
      所以蔡元培（教育家 / 北大校长）、聂耳（音乐家）、顾准（学者）、
      徐怀中（作家）都**留**，他们要是不明不白地被关键词扫掉，下一轮就得
      照着守卫再补回来。

   ② 明治维新以后的日本（第六轮）。用户原话：「轴心国除了日本的政治军事家，
      其他国家的政治，军事家可以添加，但是要从雅尔塔会议，开罗宣言以及二战
      后的国际秩序角度进行评价。帮我清理删除明治维新以后的日本的政治家军事
      家，如果有的话。」
      尺子：**明治维新（1868）以后**的日本**政治 / 军事人物**全删（含明治、
      大正、昭和三个时期）；文学家、艺术家、科学家照旧保留 —— 川端康成 /
      夏目漱石 / 芥川龙之介 / 三岛由纪夫是作家，留。
      收进来之前先过一遍这条尺子，别等收了再删（见 scripts/remove-mingren-jp.js）。

   台账里 3 位（毛泽东 / 刘伯承 / 李宗仁）走 LEGACY，从生成时直接跳过：
   id 号段不补不回填，后面的号一个不改（已读记录 / 搜索索引都挂在号上）。 */
const BANNED = {
  '李宗仁': '国民党桂系首领、代总统、战区司令长官',
  '毛泽东': '中共领袖、人民军队缔造者',
  '刘伯承': '中共元帅、军事家',
  '陈独秀': '中共首任总书记',
  '李大钊': '中共创始人、早期马克思主义者'
};

/* 明治维新（1868）以后的日本政治 / 军事人物 —— 目前在册一位都没有，
   名单留空，尺子留着（收人时先过一遍这里）。 */
const MEIJI = 1868;
function isPostMeijiJapanPolitical(p) {
  if (!/日本/.test(p.era || '')) return false;
  if (!/(政治|军事)/.test(CAT[p.name] || '')) return false;
  const m = (p.life || '').match(/(\d{3,4})/);
  return m ? parseInt(m[1], 10) >= MEIJI : true;
}

/* ── 二、正文装配 ─────────────────────────────────────────────────────── */
const FIELDS = [
  ['姓名', 'name'], ['朝代 / 国别', 'era'],
  ['字 / 号', 'zi'], ['生卒', 'life'], ['籍贯', 'origin'], ['家世亲属', 'family'],
  ['生平', 'bio'], ['作品风格', 'style'], ['流派', 'school'],
  ['主要作品 / 贡献', 'works'], ['特殊意义', 'worth']
];

function bodyOf(p) {
  const rows = FIELDS.map(function (f) {
    return [f[0], p[f[1]]];
  });
  return T.box(rows) + '\n\n【一句话】' + p.tag;
}

/* 已上线那 135 位的正文从主表原样取出（一个字不重写），只按新字段口径核一遍。 */
function legacyBodies() {
  const fs2 = require('fs');
  const vm = require('vm');
  const sandbox = { window: {}, console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs2.readFileSync(path.join(ROOT, 'data/text-master.js'), 'utf8'),
    sandbox, { filename: 'data/text-master.js' });
  const out = {};
  (sandbox.TEXT_MASTER || []).forEach(function (m) {
    if (m && m.id && m.id.indexOf('mingren-') === 0) out[m.id] = m;
  });
  return out;
}

const LEGACY_MASTER = legacyBodies();

/* 旧条目的列表页字段（朝代 / 出处 / 摘句）—— 主表只存正文，这三个不在里面，
   从 mingren-legacy-shell.js 按 id 取回（那份是上一轮旧壳的抄本）。 */
const LEGACY_SHELL = {};
LEGACY_SHELL_ROWS.forEach(function (r) { LEGACY_SHELL[r[0]] = r; });

/* ── 三、组装 ─────────────────────────────────────────────────────────── */
const items = [];
const problems = [];

/* 3a. 已上线的：id 与正文照旧 */
LEGACY.forEach(function (row) {
  const id = row[0], name = row[2];
  if (BANNED[name]) return; // 用户点名要删的，不生成
  const group = LEGACY_GROUP[name];
  const m = LEGACY_MASTER['mingren-' + id];
  const sh = LEGACY_SHELL[id];
  if (!m) { problems.push('主表里找不到 ' + id + '（' + name + '）'); return; }
  if (!sh) { problems.push('旧壳字段表里找不到 ' + id + '（' + name + '）'); return; }
  items.push({
    id: id, group: group, name: name, era: sh[2] || '', tag: '',
    source: sh[3] || '', excerpt: sh[4] || name, keep: true,
    text: m.text
  });
});

/* 3b. 新加的：归类 + 出正文 */
let nextAuto = 1 + Math.max.apply(null, LEGACY.map(function (r) {
  return parseInt(r[0].slice(3), 10);
}));

const TAG_OF = {};
PEOPLE.forEach(function (p) { TAG_OF[p.name] = p.tag; });

PEOPLE.forEach(function (p) {
  if (BANNED[p.name]) return; // 用户点名要删的，不生成
  if (isPostMeijiJapanPolitical(p)) return; // 明治维新以后的日本政治 / 军事人物
  const group = CAT[p.name];
  if (!group) { problems.push('没归类：' + p.name); return; }
  const id = 'mr-' + String(nextAuto).padStart(2, '0');
  nextAuto += 1;
  const row = {
    name: p.name, era: p.era, zi: p.zi, life: p.life, origin: p.origin,
    family: p.family, bio: p.bio, style: p.style, school: p.school,
    works: p.works, worth: p.worth, tag: p.tag
  };
  items.push({
    id: id, group: group, name: p.name, era: p.era, tag: p.tag,
    source: '《' + p.name + '》· ' + p.life,
    excerpt: p.tag, keep: false, text: bodyOf(row)
  });
});

/* ── 四、守卫：条数 / 分组 / 字段 / 净字数 ─────────────────────────────── */
const PUNCT = /[\s·，。、；：「」『』（）()《》〈〉—…？！“”‘’\-－/、]+/g;
function nchars(s) { return String(s == null ? '' : s).replace(PUNCT, '').length; }

const MIN_TOTAL = 180; // 每位正文净字数下限（表格线不计）

const countOf = {};
items.forEach(function (it) {
  countOf[it.group] = (countOf[it.group] || 0) + 1;
  if (nchars(it.text) < MIN_TOTAL) problems.push(it.name + ' 正文过短 ' + nchars(it.text));
  if (it.keep) return;
  FIELDS.forEach(function (f) {
    if (!it.text || it.text.indexOf('│ ' + f[0]) < 0) problems.push(it.name + ' 缺字段 ' + f[0]);
  });
});

const GROUPS_EXPECT = CN_CATS.concat(WORLD_CATS).map(function (p) { return p[0]; });
GROUPS_EXPECT.forEach(function (g) {
  if (!countOf[g]) problems.push('分组为空：' + g);
});

console.log('历代名家：共 ' + items.length + ' 位（已上线 ' + LEGACY.length +
  ' 位 + 新增 ' + PEOPLE.length + ' 位）');
console.log('分组：' + GROUPS_EXPECT.map(function (g) {
  return g + ' ' + (countOf[g] || 0);
}).join(' · '));
if (DUP.length) { console.log('✗ 一人归了两组：' + DUP.join('、')); problems.push('归类重复'); }
if (problems.length) {
  console.log('✗ 异常 ' + problems.length + ' 项（前 25）：');
  console.log(problems.slice(0, 25).join('\n'));
}

const totals = items.map(function (x) { return nchars(x.text); });
console.log('正文净字数：min ' + Math.min.apply(null, totals) +
  ' / avg ' + Math.round(totals.reduce(function (a, b) { return a + b; }, 0) / totals.length) +
  ' / max ' + Math.max.apply(null, totals));

if (CHECK_ONLY) process.exit(problems.length ? 1 : 0);
if (problems.length && STRICT) { console.error('✗ --strict 下不放过'); process.exit(1); }
if (!items.length) { console.error('✗ 一条都没有'); process.exit(1); }

/* ── 五、出壳文件（按分组顺序排，组内按 id 号排）────────────────────── */
const GROUP_ORDER = GROUPS_EXPECT;
items.sort(function (a, b) {
  const ga = GROUP_ORDER.indexOf(a.group);
  const gb = GROUP_ORDER.indexOf(b.group);
  if (ga !== gb) return ga - gb;
  return parseInt(a.id.slice(3), 10) - parseInt(b.id.slice(3), 10);
});

const lines = [];
lines.push('window.POEMS_MINGREN = [');
items.forEach(function (it) {
  lines.push('  {');
  lines.push('    textRef: ' + JSON.stringify('mingren-' + it.id) + ',');
  lines.push('    id: ' + JSON.stringify(it.id) + ',');
  lines.push('    title: ' + JSON.stringify(it.name) + ',');
  lines.push('    group: ' + JSON.stringify(it.group) + ',');
  lines.push('    gradeGroup: ' + JSON.stringify(it.group) + ',');
  lines.push('    dynasty: ' + JSON.stringify(it.era) + ',');
  lines.push('    author: ' + JSON.stringify(it.name) + ',');
  lines.push('    source: ' + JSON.stringify(it.source) + ',');
  lines.push('    excerpt: ' + JSON.stringify(it.excerpt));
  lines.push('  },');
});
lines.push('];');
fs.writeFileSync(path.join(ROOT, 'data/poems-mingren.js'), lines.join('\n') + '\n', 'utf8');
console.log('✓ data/poems-mingren.js 已写出，共 ' + items.length + ' 条');

/* ── 六、写回主表（只改新人；旧条目一个字不动）──────────────────────── */
if (WANT_MASTER) {
  const P = require('./lib/entry-patch.js');

  // ① 先追加新人（主表里还没有的那些）
  const fresh = [];
  items.forEach(function (it) {
    if (it.keep) return;
    fresh.push({
      id: 'mingren-' + it.id, title: it.name, text: it.text,
      translation: '', translationSource: ''
    });
  });
  const ins = P.insertAll(fresh);
  console.log('✓ data/text-master.js 新增 ' + ins.added.length + ' 条' +
    (ins.exists.length ? '（已有 ' + ins.exists.length + ' 条）' : ''));
  P.write(ins.src);
}
