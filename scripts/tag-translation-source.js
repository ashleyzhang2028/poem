#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DRY = process.argv.includes('--dry');

const SOURCE_ACADEMIC = 'academic';
const SOURCE_SCHOOL = 'school';
const SOURCE_PUBLIC = 'public-domain';
const SOURCE_MODERN = 'modern';

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
    if (bs % 2 === 1) continue;
    end = i;
    break;
  }
  if (end < 0) return null;
  const head = line.slice(0, end + 1);
  const tail = line.slice(end + 1);

  const needsComma = !/^\s*,/.test(tail);
  return head + (needsComma ? ',' : '') + ' translationSource: "' + source + '"' + tail;
}

function tagFile(file, resolveSource, idRe) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const out = [];
  const skipped = [];
  let cur = null;
  let kept = 0;

  const flush = () => {
    if (!cur || !cur.source || cur.translationEndIdx == null) { cur = null; return; }
    const idx = cur.translationEndIdx;

    if (!/,\s*$/.test(out[idx])) out[idx] = out[idx] + ',';
    out.splice(idx + 1, 0, '    translationSource: "' + cur.source + '"' + ',');
    cur = null;
  };

  lines.forEach(line => {

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

const MODERN_TITLES = new Set(['沁园春·雪', '我爱这土地', '乡愁', '沁园春·长沙']);

const poemSource = p => {
  if (p.dynasty === '现代') return MODERN_TITLES.has(p.title) ? SOURCE_MODERN : SOURCE_SCHOOL;
  if (ACADEMIC_TITLES.has(p.title)) return SOURCE_ACADEMIC;
  return SOURCE_SCHOOL;
};

console.log('诗词（data/poems-1..12.js，共 261 首）');
let total = 0;
for (let i = 1; i <= 12; i++) {
  total += tagFile(path.join(ROOT, 'data', `poems-${i}.js`), poemSource, /^(xx|cz|gz)\d+-\d+$/);
}
console.log('小古文（data/poems-classic.js，共 100 篇，出处多为先秦诸子与史传，属公有领域）');
total += tagFile(path.join(ROOT, 'data', 'poems-classic.js'), () => SOURCE_PUBLIC, /^gw-\d+$/);

console.log('');
console.log((DRY ? '（dry-run，未落盘）' : '完成') + '：本次新增标注 ' + total + ' 条');
