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
loadData(sandbox, ['data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js',
  'data/poems-5.js', 'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js',
  'data/poems-9.js', 'data/poems-10.js', 'data/poems-11.js', 'data/poems-12.js',
  'data/index.js', 'data/poems-yuefu.js', 'data/poems-classic.js', 'data/site-index.js']);

const YF = resolve(sandbox, sandbox.POEMS_YUEFU, 'yuefu');
chk(Array.isArray(YF) && YF.length === 7,
  '乐府诗选共 7 首（实际 ' + (YF ? YF.length : 'undefined') + '）');

const ids = new Set();
let dup = 0;
YF.forEach(p => { if (ids.has(p.id)) dup++; ids.add(p.id); });
chk(dup === 0, '乐府 id 无重复（重复 ' + dup + ' 个）');

chk(YF.every(p => p.title && p.source && p.dynasty && p.author && p.text && p.translation),
  '每首都齐全：标题 / 出处 / 朝代 / 作者 / 原文 / 译文');
chk(YF.every(p => p.excerpt), '每首都给了列表用摘句（excerpt）');
chk(YF.every(p => p.source === '《乐府诗集》'), '出处统一为《乐府诗集》');
chk(['public-domain', 'school', 'academic'].indexOf(YF[0].translationSource) >= 0,
  '译文来源取值在允许范围内');

const GROUPS = ['诗 · 乐府 · 汉', '诗 · 乐府 · 南北朝', '诗 · 乐府 · 晋'];
chk(YF.every(p => GROUPS.indexOf(p.gradeGroup) >= 0),
  '每首都归入「诗 · 乐府 · 汉 / 南北朝 / 晋」之一');

const need = ['长歌行', '迢迢牵牛星', '观沧海', '短歌行', '木兰诗', '敕勒歌', '归园田居（其一）'];
const titles = YF.map(p => p.title);
chk(need.every(t => titles.indexOf(t) >= 0),
  '七首乐府一篇不少（缺：' + need.filter(t => titles.indexOf(t) < 0).join('/') + '）');

const IDX = sandbox.SITE_INDEX;
const yfIdx = IDX.filter(x => x.book === 'yuefu' && !x.isBook);
chk(yfIdx.length === 7, '总索引收了全部 7 首（实际 ' + yfIdx.length + '）');
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
  chk(items.length === 7, '列表渲染出 7 条（实际 ' + items.length + '）');
  chk(/乐府诗选/.test(d.body.textContent), '页面出现「乐府诗选」');
  chk(/诗 · 乐府 · 汉/.test(d.body.textContent), '分组名「诗 · 乐府 · 汉」渲染到了页面上');
  chk(!/\[object|undefined/.test(d.querySelector('#gw-list').textContent),
    '列表文案没有渲染异常（无 undefined / [object]）');

  const api = w.ReaderEngine.current;
  chk(!!api, '拿到 /yuefu/ 页的挂载实例');
  if (api) {
    api.open('yf-6');
    const rd = d.querySelector('#gw-reader');
    chk(/敕勒歌/.test(rd.querySelector('#rd-title').textContent),
      '点开《敕勒歌》，标题对得上（实际 ' + rd.querySelector('#rd-title').textContent + '）');
    const strip2 = t => String(t || '').replace(/[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüńňǹ·\s]+/gi, '');
    chk(strip2(rd.querySelector('#rd-text').textContent).indexOf('风吹草低见牛羊') >= 0,
      '正文由 textRef 取回主表那一份（教材那一份）');
    chk(strip2(rd.querySelector('#rd-trans-text').textContent).indexOf('吹低了草') >= 0,
      '译文同样由主表取回');
  }

  const sw = fs.readFileSync(path + 'sw.js', 'utf8');
  chk(/\.\/yuefu\//.test(sw) && /js\/yuefu\.js/.test(sw) && /data\/poems-yuefu\.js/.test(sw),
    '乐府页 / 脚本 / 数据都进了 Service Worker 预缓存（断网也能读）');

  console.log('');
  console.log(fails === 0 ? '🎉 乐府诗选测试全部通过' : '❌ 乐府诗选测试 ' + fails + ' 项失败');
  process.exit(fails === 0 ? 0 : 1);
}, 250);
