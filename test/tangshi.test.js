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
loadData(sandbox, ['data/poems-classic.js', 'data/poems-tangshi.js', 'data/site-index.js']);

const TS = resolve(sandbox, sandbox.POEMS_TANGSHI, 'tangshi');
chk(Array.isArray(TS) && TS.length === 317,
  '唐诗三百首 301 首 + 校外补充 17 首 = 317（实际 ' + (TS ? TS.length : 'undefined') + '）');

const ids = new Set();
let dup = 0;
TS.forEach(p => { if (ids.has(p.id)) dup++; ids.add(p.id); });
chk(dup === 0, '唐诗 id 无重复（重复 ' + dup + ' 个）');

chk(TS.every(p => p.title && p.source && p.dynasty && p.author && p.text && p.translation),
  '每首都有 标题/出处/朝代/作者/原文/译文');

const TS_SRC_OK = ['public-domain', 'school', 'academic', 'modern'];
chk(TS.every(p => TS_SRC_OK.indexOf(p.translationSource) >= 0),
  '317 首唐诗都标了译文来源且取值在允许范围（异常 ' +
  TS.filter(p => TS_SRC_OK.indexOf(p.translationSource) < 0).length + ' 首）');
chk(TS.filter(p => p.translationSource === 'public-domain').length >= 250,
  '绝大多数标 public-domain（与课内同篇的数首取课本口径，标 school）');
chk(TS.every(p => p.source === '《唐诗三百首》'), '出处统一为《唐诗三百首》');
chk(TS.every(p => p.dynasty === '唐'), '朝代统一为唐');
chk(TS.some(p => p.text.length > 200), '含长篇（>200 字）唐诗，验证长文场景');

const groups = sandbox.getTangshiGroups();
chk(groups.length === 8, '按卷次聚合出 8 组（实际 ' + groups.length + '）');
chk(groups.reduce((n, g) => n + g.items.length, 0) === 317, '各组篇目合计 317');
const want = {
  '卷一 五言古诗': 33, '卷二 七言古诗': 27, '卷三 五言乐府': 13, '卷四 七言乐府': 25,
  '卷五 五言律诗': 78, '卷六 七言律诗': 49, '卷七 五言绝句': 33, '卷八 七言绝句': 59
};
const got = {};
groups.forEach(g => { got[g.name] = g.items.length; });
chk(Object.keys(want).every(k => got[k] === want[k]),
  '八卷篇数与选本一致（' + JSON.stringify(got) + '）');

const need = ['感遇·其一', '月下独酌', '望岳', '梦游天姥吟留别', '将进酒', '蜀道难', '长恨歌',
  '琵琶行·并序', '游子吟', '山居秋暝', '春望', '登高', '黄鹤楼', '锦瑟', '江雪', '寻隐者不遇',
  '登鹳雀楼', '春晓', '夜思', '早发白帝城', '枫桥夜泊', '赤壁', '泊秦淮', '夜雨寄北', '九月九日忆山东兄弟',
  '前出塞九首·其二', '秋浦歌十七首·其十五', '从军行七首·其四', '采莲曲二首·其二', '登乐游原', '七步诗',
  '于易水送人', '遗爱寺', '逢雪宿芙蓉山主人', '百忧集行', '菊花', '题都城南庄', '赠花卿', '闻雁',
  '竹枝词', '忆江南·其一', '渔歌子·西塞山前白鹭飞'];
const titles = TS.map(p => p.title);
const missing = need.filter(t => !titles.includes(t));
chk(missing.length === 0, '需求清单名篇齐备（缺 ' + missing.join('/') + '）');

chk(sandbox.POEMS_ALL === undefined, '唐诗不写入 POEMS_ALL，不影响每日计划');

const IDX = sandbox.SITE_INDEX;
chk(IDX.some(x => x.book === 'tangshi' && x.id === 'tangshi-ts-1'),
  '站点总索引已含唐诗（带 tangshi- 前缀）');
chk(IDX.some(x => x.book === 'tangshi' && x.isBook && x.page === '/tangshi/'),
  '总索引里唐诗集子自身指向 /tangshi/');
chk(IDX.every(x => x.id !== 'ts-1' || x.book), '唐诗条目都带集子归属');

const html = fs.readFileSync(path + 'tangshi/index.html', 'utf8');
chk(html.indexOf('/tangshi/ 里') >= 0 || html.indexOf('tangshi') >= 0, '页面标注了 /tangshi/ 目录');
const scriptOrder = html.match(/<script src="([^"]+)"><\/script>/g).map(s => s.match(/src="([^"]+)"/)[1]);
chk(scriptOrder.indexOf('data/poems-tangshi.js') >= 0, '页面引用了唐诗数据');
chk(scriptOrder.indexOf('js/reader-core.js') >= 0, '页面加载了 js/reader-core.js 引擎');
chk(scriptOrder.indexOf('js/reader-core.js') < scriptOrder.indexOf('js/tangshi.js'),
  '引擎排在挂载脚本 js/tangshi.js 之前');

const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://local.test/tangshi/', base: 'https://local.test/tangshi/' });
const w = dom.window;
w.scrollTo = function () {};
scriptOrder.forEach(f => {
  const el = w.document.createElement('script');
  el.textContent = fs.readFileSync(path + f, 'utf8');
  w.document.body.appendChild(el);
});

setTimeout(() => {
  const d = w.document;

  ['tangshi/index.html', 'classic/index.html'].forEach(f => {
    const doc = new JSDOM(fs.readFileSync(path + f, 'utf8')).window.document;
    const seen = {};
    const dups = [];
    doc.querySelectorAll('[id]').forEach(el => {
      if (seen[el.id]) { if (dups.indexOf(el.id) < 0) dups.push(el.id); } else seen[el.id] = 1;
    });
    chk(dups.length === 0, f + ' 无重复 id（重复：' + dups.join(', ') + '）');
  });

  chk(d.querySelectorAll('#gw-list .item').length === 317,
    '列表渲染 317 首（实际 ' + d.querySelectorAll('#gw-list .item').length + '）');
  chk(d.querySelector('#gw-count') === null,
    '页顶那一行不再挂已读进度牌（Issue #147：读数已撤，页顶与详情页都没有）');

  const api = w.ReaderEngine.current;
  chk(!!api, '引擎挂上了唐诗实例');
  chk(api.total() === 317, '实例 total() 为 317');

  const tsrc = fs.readFileSync(path + 'js/tangshi.js', 'utf8');
  chk(/readStore:\s*"poem_tangshi_read_v1"/.test(tsrc),
    '唐诗用独立的已读键 poem_tangshi_read_v1');
  const tsReadKey = (tsrc.match(/readStore:\s*"([^"]+)"/) || [])[1];
  chk(tsReadKey === 'poem_tangshi_read_v1',
    '唐诗挂载时只设自己的已读键（实际 ' + tsReadKey + '）');

  chk(/卷一 五言古诗/.test(tsrc) && /卷八 七言绝句/.test(tsrc),
    '挂载脚本给出了卷一至卷八的卷次顺序');

  api.open('ts-6');
  const title = d.querySelector('#rd-title').textContent;
  chk(title === '望岳', '可打开指定篇目（ts-6 → ' + title + '）');
  chk(/杜甫/.test(d.querySelector('#rd-meta').textContent), '阅读器展示了作者');
  chk(/岱宗夫/.test(d.querySelector('#rd-text').textContent) &&
    /齐鲁青未了/.test(d.querySelector('#rd-text').textContent), '正文已写入阅读器');
  chk(/泰山/.test(d.querySelector('#rd-trans-text').textContent), '白话译文已写入阅读器');

  api.setKeyword('李白');
  const nLi = d.querySelectorAll('#gw-list .item').length;
  chk(nLi > 0 && nLi < 317, '按作者「李白」搜索得到子集（' + nLi + ' 首）');

  api.open('ts-212');
  const longTitle = d.querySelector('#rd-title').textContent;
  chk(longTitle === '自河南经乱关内阻饥兄弟离散各在一处因望月有感聊书所怀寄上浮梁大兄於潜七兄乌江十五兄兼示符离及下邽弟妹',
    '长标题篇目（ts-212，' + longTitle.length + ' 字）可打开');
  const cssText = fs.readFileSync(path + 'css/classic.css', 'utf8');
  const h2 = /(^|\n)\.reader-body h2 \{([\s\S]*?)\}/.exec(cssText);
  const h2decl = h2 ? h2[2].replace(/\/\*[\s\S]*?\*\//g, ' ') : '';
  chk(/overflow-wrap:\s*anywhere;/.test(h2decl),
    '详情页标题允许逐字符断行（落进定宽正文列，不把页面撑出横向滚动）');
  chk(/word-break:\s*normal;/.test(h2decl),
    '详情页标题不用 break-all（英文单词不会被从中间劈开）');

  console.log('');
  console.log(fails === 0 ? '🎉 唐诗三百首测试全部通过' : '❌ 唐诗三百首测试 ' + fails + ' 项失败');
  process.exit(fails === 0 ? 0 : 1);
}, 120);
