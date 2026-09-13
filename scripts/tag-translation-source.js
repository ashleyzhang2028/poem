#!/usr/bin/env node
/**
 * 译文来源标注工具（可重复执行 / 幂等）
 *
 * 背景：白话译诗没有法定教科书版本，本库译文是「自拟白话直译」。
 * 与其含糊宣称「以教师用书为准」（不可验证），不如逐首标出可考证的真实来源，
 * 让用户知道自己在看什么：是公共注本口径、教材篇目口径，还是现代作品。
 *
 * 字段：`translationSource`，取值四类（文案见 data/index.js 的 TRANSLATION_SOURCES）
 *
 *   academic       学术工具书，据《唐诗鉴赏辞典》《宋词鉴赏辞典》等通行讲法
 *   school          课内篇目，据统编版教材与教师用书课后释义自拟直译
 *   public-domain  公有领域，据公认注本与通行译注文字自拟直译
 *   modern          现代作品，据现行通用选本与通行讲法自拟直译
 *
 * 已有的标注一律保留，不覆盖 —— 只补缺的，所以可以直接反复跑。
 *
 * 用法：
 *   node scripts/tag-translation-source.js --dry     # 只看会改哪些，不落盘
 *   node scripts/tag-translation-source.js           # 写回数据文件
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DRY = process.argv.includes('--dry');

const SOURCE_ACADEMIC = 'academic';
const SOURCE_SCHOOL = 'school';
const SOURCE_PUBLIC = 'public-domain';
const SOURCE_MODERN = 'modern';

/** 鉴赏辞典类工具书收录的名家名篇：译注主要参考这两部书的通行讲法 */
const ACADEMIC_TITLES = new Set([
  '短歌行', '观沧海', '龟虽寿', '归园田居（其一）', '饮酒（其五）',
  '蜀道难', '梦游天姥吟留别', '将进酒', '行路难（其一）', '春夜洛城闻笛',
  '望庐山瀑布', '望天门山', '早发白帝城', '独坐敬亭山', '静夜思',
  '春江花月夜', '登幽州台歌', '燕歌行并序', '燕歌行',
  '春望', '登高', '望岳', '石壕吏', '茅屋为秋风所破歌', '月夜忆舍弟',
  '登岳阳楼', '客至', '闻官军收河南河北', '江南逢李龟年',
  '黄鹤楼', '题破山寺后禅院', '白雪歌送武判官归京',
  '山居秋暝', '使至塞上', '汉江临泛', '鹿柴', '竹里馆', '送友人',
  '琵琶行并序', '琵琶行', '钱塘湖春行', '卖炭翁', '赋得古原草送别',
  '雁门太守行', '李凭箜篌引', '马诗',
  '泊秦淮', '江南春', '赤壁', '乌衣巷',
  '锦瑟', '无题', '夜雨寄北', '嫦娥',
  '念奴娇·赤壁怀古', '水调歌头·明月几时有', '定风波·莫听穿林打叶声',
  '江城子·密州出猎', '江城子·乙卯正月二十日夜记梦', '卜算子·黄州定慧院寓居作',
  '临江仙·夜登小阁忆洛中旧游', '青玉案·元夕', '破阵子·为陈同甫赋壮词以寄之',
  '永遇乐·京口北固亭怀古', '丑奴儿·书博山道中壁', '菩萨蛮·书江西造口壁',
  '太常引·建康中秋夜为吕叔潜赋',
  '声声慢·寻寻觅觅', '扬州慢·淮左名都', '望海潮·东南形胜',
  '鹊桥仙·纤云弄巧', '满江红·小住京华',
  '山坡羊·骊山怀古', '天净沙·秋思', '朝天子·咏喇叭'
]);

/**
 * 在 JS 数组字面量里补字段：逐行扫描，认出每个条目的 `id` / `title` /
 * `dynasty` / `translation`，在该条目的 translation 之后插入 `translationSource`。
 * 不做整体重新序列化，原有换行、缩进、注释一个字不动。
 */
/**
 * 在一行式条目里，把 `translationSource` 插到 `translation: "..."` 那个字符串之后。
 * `translation` 的值里可能带转义引号（如 \"），所以逐字符找真正的收尾引号，
 * 不能简单 indexOf('",')。返回新行；定位不到时返回 null（由调用方记账，不静默丢）。
 */
function insertAfterTranslation(line, source) {
  const at = line.indexOf('translation:');
  if (at < 0) return null;
  const q = line.indexOf('"', at + 'translation:'.length);
  if (q < 0) return null;
  let end = -1;
  for (let i = q + 1; i < line.length; i++) {
    if (line[i] !== '"') continue;
    let bs = 0;
    for (let j = i - 1; j >= 0 && line[j] === '\\'; j--) bs++;
    if (bs % 2 === 1) continue; // 被转义的反斜杠，不是收尾引号
    end = i;                     // 真正的收尾引号
    break;
  }
  if (end < 0) return null;
  const head = line.slice(0, end + 1);   // ...translation: "译文"
  const tail = line.slice(end + 1);      // 剩下的 , } 等
  // head 后面补逗号，再插字段；tail 原样保留（它自己那逗号还在）
  const needsComma = !/^\s*,/.test(tail);
  return head + (needsComma ? ',' : '') + ' translationSource: "' + source + '"' + tail;
}

function tagFile(file, resolveSource, idRe) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const out = [];
  const skipped = [];
  let cur = null; // 当前条目
  let kept = 0;

  const flush = () => {
    if (!cur || !cur.source || cur.translationEndIdx == null) { cur = null; return; }
    const idx = cur.translationEndIdx;
    // 旧行结尾可能已经带逗号（多行译文那一支），带就带，不带我们补上；
    // 新插进去的 translationSource 后面必须跟逗号，否则下一条目语法就断了
    if (!/,\s*$/.test(out[idx])) out[idx] = out[idx] + ',';
    out.splice(idx + 1, 0, '    translationSource: "' + cur.source + '"' + ',');
    cur = null;
  };

  lines.forEach(line => {
    // --- 单行写法 ---
    // `{ id: "xx1-98", title: "…", …, translation: "…" },` 整条挤在一行。
    // poems-1..6 是一行一字段，poems-7..12 与用户手加的简写都是这种写法，必须支持，
    // 否则会出现「有的条目悄悄没标注」——比报错更难发现。
    const rawId = (line.match(/\bid:\s*"([^"]+)"/) || [])[1];
    if (rawId && idRe.test(rawId) && /\btranslation:/.test(line) && !/\btranslationSource:/.test(line)) {
      const title = (line.match(/\btitle:\s*"([^"]+)"/) || [])[1] || '';
      const dynasty = (line.match(/\bdynasty:\s*"([^"]+)"/) || [])[1] || '';
      const source = resolveSource({ id: rawId, title, dynasty });
      const inserted = insertAfterTranslation(line, source);
      out.push(inserted == null ? line : inserted);
      if (inserted == null) skipped.push(rawId + '（单行条目定位译文失败，请手工加）');
      cur = null;
      return;
    }

    // id 可能单起一行，也可能与 title/author 挤在同一行，所以不锚行首
    const idM = line.match(/\bid:\s*"([^"]+)"/);
    if (idM && idRe.test(idM[1])) {
      flush();
      cur = {
        id: idM[1],
        title: (line.match(/\btitle:\s*"([^"]+)"/) || [])[1] || '',
        dynasty: (line.match(/\bdynasty:\s*"([^"]+)"/) || [])[1] || '',
        source: null,
        translationEndIdx: null
      };
      cur.source = resolveSource(cur);
      out.push(line);
      return;
    }
    if (cur) {
      const tM = line.match(/\btitle:\s*"([^"]+)"/);
      if (tM && !/\bid:/.test(line)) cur.title = tM[1];
      if (/\btranslationSource:/.test(line)) { kept++; cur = null; out.push(line); return; }
      if (/\btranslation:/.test(line)) {
        // 译文可能跨多行：收尾那一行才带引号闭合
        cur.translationEndIdx = /",?\s*$/.test(line) ? out.length : null;
      } else if (cur.source && cur.translationEndIdx == null) {
        if (/",?\s*$/.test(line)) cur.translationEndIdx = out.length;
      }
    }
    out.push(line);
  });
  flush();

  if (skipped.length) {
    console.log('  ⚠ ' + path.relative(ROOT, file) + ' 有 ' + skipped.length +
      ' 条没能自动加标注：' + skipped.join('、'));
  }
  const next = out.join('\n');
  const before = (src.match(/\btranslationSource:/g) || []).length;
  const after = (next.match(/\btranslationSource:/g) || []).length;
  const added = after - before;

  if (!DRY && added > 0) fs.writeFileSync(file, next);
  console.log('  ' + (DRY ? '[dry] ' : '') + path.relative(ROOT, file) +
    '：新增 ' + added + '，保留已有 ' + kept);
  return added;
}

/** 小学课内的毛泽东诗词（卜算子·咏梅 / 七律·长征）：译文只讲字面，
    不涉及创作背景与评价，与小学课本口径一致，所以按课内标 school；
    初高中那几首才需要通行的创作背景与讲法，标 modern。 */
const MODERN_TITLES = new Set(['沁园春·雪', '我爱这土地', '乡愁', '沁园春·长沙']);

const poemSource = p => {
  if (p.dynasty === '现代') return MODERN_TITLES.has(p.title) ? SOURCE_MODERN : SOURCE_SCHOOL;
  if (ACADEMIC_TITLES.has(p.title)) return SOURCE_ACADEMIC;
  return SOURCE_SCHOOL;
};

console.log('诗词（data/poems-1..12.js，共 273 首）');
let total = 0;
for (let i = 1; i <= 12; i++) {
  total += tagFile(path.join(ROOT, 'data', `poems-${i}.js`), poemSource, /^(xx|cz|gz)\d+-\d+$/);
}
console.log('小古文（data/poems-classic.js，共 100 篇，出处多为先秦诸子与史传，属公有领域）');
total += tagFile(path.join(ROOT, 'data', 'poems-classic.js'), () => SOURCE_PUBLIC, /^gw-\d+$/);

console.log('');
console.log((DRY ? '（dry-run，未落盘）' : '完成') + '：本次新增标注 ' + total + ' 条');
