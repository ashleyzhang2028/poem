const { JSDOM } = require('jsdom');
const fs = require('fs');
const vm = require('vm');
const path = __dirname + '/../';

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);

const { loadData, resolve } = require('./master-env');
loadData(sandbox, ['data/poems-classic.js', 'data/poems-yuanqu.js', 'data/site-index.js']);

const YQ = resolve(sandbox, sandbox.POEMS_YUANQU, 'yuanqu');
chk(Array.isArray(YQ) && YQ.length === 30,
  '元曲三百首共 30 首（实际 ' + (YQ ? YQ.length : 'undefined') + '）');

const ids = new Set();
let dup = 0;
YQ.forEach(p => { if (ids.has(p.id)) dup++; ids.add(p.id); });
chk(dup === 0, '元曲 id 无重复（重复 ' + dup + ' 个）');

chk(YQ.every(p => p.title && p.source && p.dynasty && p.author && p.text && p.translation),
  '每首都齐全：标题 / 出处 / 朝代 / 作者 / 原文 / 译文');
chk(YQ.every(p => p.excerpt), '每首都给了列表用摘句（excerpt）');

// 《山坡羊·骊山怀古》《朝天子·咏喇叭》两首课内已收，沿用课内那份译文口径（academic）。
const YQ_SRC_OK = ['public-domain', 'school', 'academic'];
chk(YQ.every(p => YQ_SRC_OK.indexOf(p.translationSource) >= 0),
  '30 首元曲都标了译文来源且取值在允许范围（异常 ' +
  YQ.filter(p => YQ_SRC_OK.indexOf(p.translationSource) < 0).length + ' 首）');
chk(YQ.every(p => p.source === '《全元散曲》'), '出处统一为《全元散曲》');
chk(YQ.every(p => p.dynasty === '元' || p.dynasty === '明'),
  '朝代只有「元」（28 首）与「明」（王磐《朝天子·咏喇叭》1 首）' +
  '（实际：' + [...new Set(YQ.map(p => p.dynasty))].join('/') + '）');

const DIAO = ['黄钟', '正宫', '中吕', '南吕', '双调', '越调'];
chk(YQ.every(p => /^(小令|套数) · /.test(p.gradeGroup || '')),
  '每首都归入某宫调（gradeGroup 形如「小令 · 越调」「套数 · 中吕」）');
chk(YQ.filter(p => /^小令 · /.test(p.gradeGroup)).length === 29,
  '小令 29 首（实际 ' + YQ.filter(p => /^小令 · /.test(p.gradeGroup)).length + '）');
chk(YQ.filter(p => /^套数 · /.test(p.gradeGroup)).length === 1,
  '套数 1 首（王实甫《十二月过尧民歌·别情》剪裁成一套）');

const groups = sandbox.getYuanquGroups();
const groupNames = groups.map(g => g.name);
chk(new Set(groupNames).size === groupNames.length, '宫调分组名不重复');
chk(groups.reduce((n, g) => n + g.items.length, 0) === 30, '各组篇目合计 30');
chk(groupNames.every(n => DIAO.some(d => n.indexOf(' · ' + d) >= 0)),
  '分组名都落在六大宫调里（' + groupNames.join(' / ') + '）');

const ysrc = fs.readFileSync(path + 'js/yuanqu.js', 'utf8');
const listed = JSON.parse('[' + ysrc.match(/var GROUP_ORDER = window\.YUANQU_GROUP_ORDER = \[([\s\S]*?)\];/)[1].replace(/,\s*$/, '') + ']');
chk(listed.length === groupNames.length,
  '挂载脚本的宫调顺序表条目数与实际分组一致（表 ' + listed.length + ' · 实际 ' + groupNames.length + '）');
chk(groupNames.every(g => listed.indexOf(g) >= 0),
  '每个实际宫调都在顺序表里（缺：' + groupNames.filter(g => listed.indexOf(g) < 0).join('/') + '）');
chk(listed.every(g => groupNames.indexOf(g) >= 0),
  '顺序表里没有多余的宫调（多：' + listed.filter(g => groupNames.indexOf(g) < 0).join('/') + '）');

const need = ['天净沙·秋思', '山坡羊·潼关怀古', '山坡羊·骊山怀古', '天净沙·秋', '天净沙·春',
  '天净沙·冬', '寿阳曲·江天暮雪', '寿阳曲·远浦帆归', '四块玉·别情', '醉太平·讥贪小利者',
  '朝天子·咏喇叭', '天净沙·即事', '满庭芳·渔父词', '十二月过尧民歌·别情', '阳春曲·知几',
  '水仙子·夜雨', '水仙子·寻梅', '殿前欢·客中', '折桂令·九日', '清江引·秋怀',
  '清江引·立春', '天净沙·春情', '天净沙·江上', '水仙子·咏雪', '水仙子·咏江南',
  '人月圆·山中书事', '小桃红·寄鉴湖诸友', '庆东原·京口夜泊', '金字经·春晚', '普天乐·秋江忆别'];
const titles = YQ.map(p => p.title);
chk(need.every(t => titles.indexOf(t) >= 0),
  '三十首曲一篇不少（缺：' + need.filter(t => titles.indexOf(t) < 0).join('/') + '）');

const IDX = sandbox.SITE_INDEX;
const yqIdx = IDX.filter(x => x.book === 'yuanqu' && !x.isBook);
chk(yqIdx.length === 30, '总索引收了全部 30 首（实际 ' + yqIdx.length + '）');
chk(yqIdx.every(x => x.text && x.translation), '进索引的每一首原文与译文齐备');
chk(IDX.some(x => x.book === 'yuanqu' && x.isBook),
  '「元曲三百首」本身也作为一条结果（搜集子名能直接进那一页）');

const dom = new JSDOM(fs.readFileSync(path + 'yuanqu/index.html', 'utf8'), {
  runScripts: 'dangerously',
  url: 'https://local.test/yuanqu/'
});
const w = dom.window;
w.scrollTo = function () {};
const html = fs.readFileSync(path + 'yuanqu/index.html', 'utf8');
const scripts = html.match(/<script src="([^"]+)"><\/script>/g)
  .map(s => s.match(/src="([^"]+)"/)[1]);

setTimeout(() => {
  for (const f of scripts) {
    try {
      const el = w.document.createElement('script');
      el.textContent = fs.readFileSync(path + f, 'utf8');
      w.document.body.appendChild(el);
    } catch (e) {
      console.log('✗ 脚本执行失败 ' + f + '：' + e.message);
      fails++;
    }
  }
  const d = w.document;

  chk(!!w.ReaderEngine, '阅读库引擎已加载');
  const items = d.querySelectorAll('#gw-list .item');
  chk(items.length === 30, '列表渲染出 30 条（实际 ' + items.length + '）');
  chk(/元曲三百首/.test(d.body.textContent), '页面出现「元曲三百首」');
  chk(/小令 · 越调/.test(d.body.textContent), '分组名「小令 · 越调」渲染到了页面上');
  chk(/小令 · 双调/.test(d.body.textContent), '分组名「小令 · 双调」渲染到了页面上');
  chk(!/\[object|undefined/.test(d.querySelector('#gw-list').textContent),
    '列表文案没有渲染异常（无 undefined / [object]）');

  const api = w.ReaderEngine.current;
  chk(!!api, '拿到 /yuanqu/ 页的挂载实例');
  if (api) {
    api.open('yq-16');
    const rd = d.querySelector('#gw-reader');
    chk(/水仙子·夜雨/.test(rd.querySelector('#rd-title').textContent),
      '点开《水仙子·夜雨》，标题对得上（实际 ' +
      rd.querySelector('#rd-title').textContent + '）');
    const strip2 = t => String(t || '').replace(/[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüńňǹ·\s]+/gi, '');
    chk(strip2(rd.querySelector('#rd-text').textContent).indexOf('一声梧叶一声秋') >= 0,
      '正文由 textRef 取回主表那一份（实际「' +
      strip2(rd.querySelector('#rd-text').textContent).slice(0, 12) + '…」）');
    chk(strip2(rd.querySelector('#rd-trans-text').textContent).indexOf('一声梧桐叶落') >= 0,
      '译文同样由主表取回');
  }

  const sw = fs.readFileSync(path + 'sw.js', 'utf8');
  chk(/\.\/yuanqu\//.test(sw) && /js\/yuanqu\.js/.test(sw) && /data\/poems-yuanqu\.js/.test(sw),
    '元曲页 / 脚本 / 数据都进了 Service Worker 预缓存（断网也能读）');

  console.log('');
  console.log(fails === 0 ? '🎉 元曲三百首测试全部通过' : '❌ 元曲三百首测试 ' + fails + ' 项失败');
  process.exit(fails === 0 ? 0 : 1);
}, 250);
