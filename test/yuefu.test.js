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
loadData(sandbox, ['data/poems-classic.js', 'data/poems-yuefu.js', 'data/site-index.js']);

const YF = resolve(sandbox, sandbox.POEMS_YUEFU, 'yuefu');
chk(Array.isArray(YF) && YF.length === 15,
  '乐府诗选共 15 首（实际 ' + (YF ? YF.length : 'undefined') + '）');

const ids = new Set();
let dup = 0;
YF.forEach(p => { if (ids.has(p.id)) dup++; ids.add(p.id); });
chk(dup === 0, '乐府 id 无重复（重复 ' + dup + ' 个）');

chk(YF.every(p => p.title && p.source && p.dynasty && p.author && p.text && p.translation),
  '每首都齐全：标题 / 出处 / 朝代 / 作者 / 原文 / 译文');
chk(YF.every(p => p.excerpt), '每首都给了列表用摘句（excerpt）');

// 与课内同篇的四首（长歌行 / 迢迢牵牛星 / 木兰诗 / 敕勒歌）沿用课本那份译文口径（school）。
const YF_SRC_OK = ['public-domain', 'school'];
chk(YF.every(p => YF_SRC_OK.indexOf(p.translationSource) >= 0),
  '15 首乐府都标了译文来源且取值在允许范围（异常 ' +
  YF.filter(p => YF_SRC_OK.indexOf(p.translationSource) < 0).length + ' 首）');
chk(YF.every(p => p.source === '《乐府诗集》'), '出处统一为《乐府诗集》');
chk(YF.every(p => p.dynasty === '汉' || p.dynasty === '南北朝'),
  '朝代只有「汉」与「南北朝」（实际：' + [...new Set(YF.map(p => p.dynasty))].join('/') + '）');

const GROUPS = ['汉乐府', '北朝乐府', '南朝乐府'];
chk(YF.every(p => GROUPS.indexOf(p.gradeGroup) >= 0),
  '每首都归入某一组（汉乐府 / 北朝乐府 / 南朝乐府）');
chk(YF.filter(p => p.gradeGroup === '汉乐府').length === 7,
  '汉乐府 7 首（实际 ' + YF.filter(p => p.gradeGroup === '汉乐府').length + '）');
chk(YF.filter(p => p.gradeGroup === '北朝乐府').length === 4,
  '北朝乐府 4 首（实际 ' + YF.filter(p => p.gradeGroup === '北朝乐府').length + '）');
chk(YF.filter(p => p.gradeGroup === '南朝乐府').length === 4,
  '南朝乐府 4 首（实际 ' + YF.filter(p => p.gradeGroup === '南朝乐府').length + '）');

const groups = sandbox.getYuefuGroups();
const groupNames = groups.map(g => g.name);
chk(new Set(groupNames).size === groupNames.length, '分组名不重复');
chk(groups.reduce((n, g) => n + g.items.length, 0) === 15, '各组篇目合计 15');

const ysrc = fs.readFileSync(path + 'js/yuefu.js', 'utf8');
const listed = JSON.parse('[' + ysrc.match(/var GROUP_ORDER = window\.YUEFU_GROUP_ORDER = \[([\s\S]*?)\];/)[1].replace(/,\s*$/, '') + ']');
chk(listed.length === groupNames.length,
  '挂载脚本的分组顺序表条目数与实际分组一致（表 ' + listed.length + ' · 实际 ' + groupNames.length + '）');
chk(groupNames.every(g => listed.indexOf(g) >= 0),
  '每个实际分组都在顺序表里（缺：' + groupNames.filter(g => listed.indexOf(g) < 0).join('/') + '）');
chk(listed.every(g => groupNames.indexOf(g) >= 0),
  '顺序表里没有多余的组（多：' + listed.filter(g => groupNames.indexOf(g) < 0).join('/') + '）');

const need = ['孔雀东南飞', '陌上桑', '长歌行', '十五从军征', '迢迢牵牛星', '上邪', '有所思',
  '木兰诗', '敕勒歌', '陇头歌辞', '折杨柳歌辞', '西洲曲', '子夜歌', '华山畿', '莫愁乐'];
const titles = YF.map(p => p.title);
chk(need.every(t => titles.indexOf(t) >= 0),
  '十五首乐府一篇不少（缺：' + need.filter(t => titles.indexOf(t) < 0).join('/') + '）');

const IDX = sandbox.SITE_INDEX;
const yfIdx = IDX.filter(x => x.book === 'yuefu' && !x.isBook);
chk(yfIdx.length === 15, '总索引收了全部 15 首（实际 ' + yfIdx.length + '）');
chk(yfIdx.every(x => x.text && x.translation), '进索引的每一首原文与译文齐备');
chk(IDX.some(x => x.book === 'yuefu' && x.isBook),
  '「乐府诗选」本身也作为一条结果（搜集子名能直接进那一页）');

const dom = new JSDOM(fs.readFileSync(path + 'yuefu/index.html', 'utf8'), {
  runScripts: 'dangerously',
  url: 'https://local.test/yuefu/'
});
const w = dom.window;
w.scrollTo = function () {};
const html = fs.readFileSync(path + 'yuefu/index.html', 'utf8');
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
  chk(items.length === 15, '列表渲染出 15 条（实际 ' + items.length + '）');
  chk(/乐府诗选/.test(d.body.textContent), '页面出现「乐府诗选」');
  chk(/汉乐府/.test(d.body.textContent), '分组名「汉乐府」渲染到了页面上');
  chk(/北朝乐府/.test(d.body.textContent), '分组名「北朝乐府」渲染到了页面上');
  chk(!/\[object|undefined/.test(d.querySelector('#gw-list').textContent),
    '列表文案没有渲染异常（无 undefined / [object]）');

  const api = w.ReaderEngine.current;
  chk(!!api, '拿到 /yuefu/ 页的挂载实例');
  if (api) {
    api.open('yf-6');
    const rd = d.querySelector('#gw-reader');
    chk(/上邪/.test(rd.querySelector('#rd-title').textContent),
      '点开《上邪》，标题对得上（实际 ' +
      rd.querySelector('#rd-title').textContent + '）');
    const strip2 = t => String(t || '').replace(/[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüńňǹ·\s]+/gi, '');
    chk(strip2(rd.querySelector('#rd-text').textContent).indexOf('山无陵') >= 0 &&
      strip2(rd.querySelector('#rd-text').textContent).indexOf('乃敢与君绝') >= 0,
      '正文由 textRef / 主表取回《上邪》全文（实际「' +
      strip2(rd.querySelector('#rd-text').textContent).slice(0, 12) + '…」）');
    if (api.close) api.close();
    api.open('yf-1');
    chk(/孔雀东南飞/.test(rd.querySelector('#rd-title').textContent),
      '长篇《孔雀东南飞》也能打开（实际 ' + rd.querySelector('#rd-title').textContent + '）');
  }

  console.log('');
  if (fails) { console.log('✗ 乐府诗选测试失败 ' + fails + ' 项'); process.exit(1); }
  console.log('🎉 乐府诗选测试全部通过');
}, 300);
