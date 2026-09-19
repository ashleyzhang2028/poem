// 「今日加背」（Issue #243）：小朋友今天主动多背的那几篇。
//
// 守的是用户 2026-09-19 那一段原话里的每一条：
//   ① 今日背诵页顶上有个搜索下拉，下拉里带「加入今日背诵」——
//      点一下，5 首变 6 首；
//   ② 集子页与搜索页的列表、详情页都要有同一颗圆钮，
//      详情页那一颗**插在译文与加入背诵之间**；
//   ③ 加进来的篇目照常走遗忘曲线（有进度、有下次复习时间），
//      但它**不属于**自选集合 —— 所以设置页要单独有一处能看见、能删（多选）；
//   ④ 它是「今天」的东西：跨过 0 点自动归零，不留垃圾。
//
// 数据层与三层界面（首页 / 集子页 / 设置页）分节测：数据层的口径一变，
// 上面三层的断言会跟着一起红 —— 这正是要的。

const { JSDOM } = require('jsdom');
const fs = require('fs');
const vm = require('vm');
const path = __dirname + '/../';
const read = f => fs.readFileSync(path + f, 'utf8');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };
const eq = (a, b, m) => chk(a === b, m + '（实际 ' + JSON.stringify(a) + '）');

const sleep = ms => new Promise(r => setTimeout(r, ms));

const DATA = [
  'data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js', 'data/poems-5.js',
  'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js', 'data/poems-9.js', 'data/poems-10.js',
  'data/poems-11.js', 'data/poems-12.js', 'data/index.js', 'data/poems-classic.js',
  'data/poems-tangshi.js', 'data/poems-songci.js', 'data/poems-guwen.js', 'data/poems-zhaoming.js',
  'data/site-index.js', 'data/works-map.js', 'data/works-index.js'
];

function boot(file, url, seed) {
  const html = read(file);
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://local.test' + url,
    base: 'https://local.test' + url
  });
  const w = dom.window;
  // 三张纸手动塞进 head：jsdom 不会自己去取 <link>，不塞的话
  // 「.today-search 里到底挂了哪几个类」这类断言量不到真类名与真规则。
  ['css/style.css', 'css/classic.css', 'css/account.css'].forEach(f => {
    const st = w.document.createElement('style');
    st.textContent = read(f);
    w.document.head.appendChild(st);
  });
  if (seed) Object.keys(seed).forEach(k => w.localStorage.setItem(k, seed[k]));
  w.scrollTo = function () {};
  const scripts = html.match(/<script src="([^"]+)"><\/script>/g)
    .map(s => s.match(/src="([^"]+)"/)[1]);
  const ready = new Promise(resolve => {
    if (w.document.readyState !== 'loading') return resolve();
    w.document.addEventListener('DOMContentLoaded', () => resolve());
  });
  w.__ready = ready.then(() => {
    scripts.forEach(f => {
      try {
        const el = w.document.createElement('script');
        el.textContent = read(f.replace(/^\//, '').replace(/^\.\//, ''));
        w.document.body.appendChild(el);
      } catch (e) {
        console.log('✗ 脚本执行失败 ' + f + '：' + e.message);
        fails++;
      }
    });
  });
  return w;
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

(async () => {

console.log('=== 一、数据层：一份数据只属于「今天」 ===');
{
  const sb = { window: {}, console, localStorage: null };
  sb.window = sb;
  vm.createContext(sb);
  const mem = {};
  sb.localStorage = {
    getItem: k => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: k => { delete mem[k]; }
  };
  ['js/progress-store.js', 'js/daily-extra.js'].forEach(f => {
    vm.runInContext(read(f), sb, { filename: f });
  });
  const D = sb.DailyExtra;

  eq(D.count(), 0, '刚开始一篇都没有');
  eq(D.add({ id: 'a-1', title: '甲' }).added, true, '加第一篇：added');
  eq(D.add({ id: 'a-1', title: '甲' }).added, false, '同一篇再加一次：added=false（不重复）');
  eq(D.count(), 1, '还是只有一篇');
  eq(D.has({ id: 'a-1' }), true, 'has() 认得出来');
  eq(D.has('a-1'), true, 'has() 收 id 字符串也认');
  eq(D.has({ id: 'b-2' }), false, '没加过的就是 false');

  D.add({ id: 'b-2', title: '乙', text: '正文', bookName: '唐诗三百首' });
  const poems = D.poems();
  eq(poems.length, 2, 'poems() 给出两篇');
  eq(poems[0].custom, true, 'poems() 出来的一律 custom=true（首页据此换副标题）');
  eq(poems[1].bookName, '唐诗三百首', '出处跟着快照走');
  eq(poems[1].text, '正文', '正文也存了快照（明天不用再联网取）');

  eq(D.ids().join(','), 'a-1,b-2', 'ids() 按加入顺序');
  eq(D.remove('a-1'), true, 'remove() 删得掉');
  eq(D.remove('a-1'), false, '删第二次就是 false（不假装删过）');
  eq(D.removeMany(['b-2', 'c-3']), 1, 'removeMany 只数真的删掉的那几篇');
  eq(D.count(), 0, '删空了');
  eq(mem['poem_daily_extra_v1'], undefined, '删空之后盘上那把键也清掉了（不留空壳）');

  // 上限
  const N = D.MAX;
  for (let i = 0; i < N + 3; i += 1) D.add({ id: 'x-' + i, title: '第' + i });
  eq(D.count(), N, '加到上限就停（' + N + ' 篇）');
  const over = D.add({ id: 'over', title: '再多' });
  eq(over.ok, false, '越限时 ok:false');
  eq(over.code, 'E_LIMIT', '越限的理由是 E_LIMIT');
  eq(over.limit, N, '回执里带上是哪个上限拦的');
  D.clear();
  eq(D.count(), 0, 'clear() 清空');
}

console.log('\n=== 二、跨过 0 点：旧的那一份作废，且不留垃圾 ===');
{
  const sb = { window: {}, console, localStorage: null };
  sb.window = sb;
  vm.createContext(sb);
  const mem = { poem_daily_extra_v1: JSON.stringify({ v: 1, date: '2000-1-1', items: [{ id: 'old', wid: 'old' }] }) };
  sb.localStorage = {
    getItem: k => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: k => { delete mem[k]; }
  };
  ['js/progress-store.js', 'js/daily-extra.js'].forEach(f => {
    vm.runInContext(read(f), sb, { filename: f });
  });
  const D = sb.DailyExtra;
  eq(D.count(), 0, '昨天的加背读出来是空的（自动归零）');
  eq(mem['poem_daily_extra_v1'], undefined, '顺手把那条旧数据清掉（不然会越攒越多）');
  eq(D.today(), todayStr(), 'today() 的判据与首页那份计划同源（本地时间的年-月-日）');
}

console.log('\n=== 三、首页：顶上的「我要加背」，点一下 5 首变 6 首 ===');
{
  const w = boot('index.html', '/');
  await w.__ready;
  await sleep(250);
  const d = w.document;

  chk(!!d.querySelector('#today-search'), '今日背诵卡与列表之间有「我要加背」那个输入框');
  chk(!!d.querySelector('#today-suggest'), '有候选下拉容器');
  chk(!!d.querySelector('#today-suggest').closest('.search-wrap'),
    '下拉挂在自己的输入框上（与搜索页同一套 .suggest）');
  chk(!!w.DailyExtra && !!w.DailyExtraUI, '数据层与控件层都加载了');
  const homeHtml = read('index.html');
  chk(homeHtml.indexOf('css/classic.css') >= 0,
    '首页也加载 css/classic.css（搜索框 / 候选下拉的样式只有那一份，不另抄一套）');
  chk(/id="today-search-hero"[\s\S]*id="today-suggest"[\s\S]*id="today-list"/.test(homeHtml),
    '三者的先后：搜索条 → 下拉 → 今日列表');

  // ---- Issue #229：它**不是**搜索页那一枚 hero ------------------------------
  // 用户原话：「首页今日加背搜索框上下空那么大没必要了吧，又不是搜索页，
  // 那个是仿谷歌设计才那么做的。首页今日加背搜索框按正常卡片间间距排版。」
  //
  // ⚠️ jsdom 不做 var() 代换（`height: var(--toolbar-h)` 原样吐回来），
  // 所以这里量不了「画出来多高」。能真量的是两件事：
  //   ① 类名与结构 —— hero 那套是靠 .search-hero / .search-toolbar 两个类挂上去的，
  //      没有这两个类，就没有「一屏高度 + 居中 + 绝对定位」；
  //   ② 规则本身 —— 把两条规则的声明文字直接对比（不含 var 的）：
  //      margin-top 是不是 0、margin-bottom 是不是等于卡片自己的块距。
  chk(!/class="[^"]*search-hero/.test(homeHtml),
    '首页那一条**不挂** .search-hero（整屏居中 + 聚焦上浮是搜索页专属）');
  const hero = d.querySelector('#today-search-hero');
  chk(hero && !hero.classList.contains('search-hero'),
    'DOM 上也没有 .search-hero 这个类');
  chk(!!hero.querySelector('.toolbar') &&
    !hero.querySelector('.toolbar').classList.contains('search-toolbar'),
    '里头用的是通版 .toolbar，不是搜索页专属的 .search-toolbar（绝对定位那个）');

  {
    const cssText = read('css/style.css');
    // 取出 .today-search 那一条（到下一个选择器为止）
    const block = cssText.slice(cssText.indexOf('.today-search {'));
    const heroBlock = block.slice(0, block.indexOf('}'));
    chk(!/height\s*:\s*[^;]*vh/.test(heroBlock) && !/min-height\s*:\s*[^;]*vh/.test(heroBlock),
      '这一条的高度里没有 vh 算式（hero 那套的高度才是「一屏减去 chrome」）');
    chk(/height\s*:\s*auto/.test(heroBlock), '高度由内容定（height: auto）');
    chk(/margin\s*:\s*0\s+0\s+var\(--block-gap/.test(heroBlock),
      '上下不留额外空白：上边距归零，下边距就是那一个通版块距');
    chk(!/\.today-search\s+\.search-toolbar/.test(cssText) &&
      !/\.search-toolbar\s*\{[^}]*position:\s*static/.test(cssText),
      '不再靠「把 .search-toolbar 的绝对定位复位回去」来收场 —— 那个类压根不用了');
  }

  {
    // 高度这一条：hero 的 52px 与首页通版的 40px 是两个数，
    // 钉住本页用的是后者 —— 它比搜索页矮一号，不是那一页的主角。
    const rules = read('css/style.css');
    const m = /[^}]*\.today-search \.toolbar \{[^}]*--toolbar-h:\s*([^;]+);/.exec(rules);
    chk(!!m && m[1].trim() === '40px',
      '工具条高度就是通版的 40px（不是搜索页 hero 的 52px）');
    chk(/\.toolbar \{\s*\n\s*--toolbar-h:\s*40px/.test(rules),
      '40px 这个数是 .toolbar 的默认值同款（不是这里另写一个数）');
  }

  // ---- Issue #229：文案改成「我要加背」 ------------------------------------
  eq(d.querySelector('#today-search').placeholder, '我要加背',
    '搜索框的提示语是「我要加背」（不再是「再找一首，加进今天要背的」）');
  chk(homeHtml.indexOf('再找一首') < 0, '首页源码里不再留「再找一首」');
  const cssText = read('css/style.css');
  chk(cssText.indexOf('再找一首') < 0,
    'css 注释里那处旧文案也一并换掉（注释里的名字错了，下一个人就会照错的理解改）');

  const before = d.querySelectorAll('#today-list .item').length;
  eq(before, 5, '默认今日背诵 5 首');

  const input = d.querySelector('#today-search');
  input.value = '静夜思';
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  await sleep(40);
  const box = d.querySelector('#today-suggest');
  chk(box.hidden === false, '输入后下拉出现');
  const rows = [...box.querySelectorAll('.suggest-row')];
  chk(rows.length > 0, '有候选（' + rows.length + ' 条）');
  chk(rows.every(r => r.querySelector('.suggest-title') && r.querySelector('.suggest-meta')),
    '每条候选都有篇名与「朝代 · 作者 · 集子」（与搜索页同一套）');
  chk(rows.every(r => r.querySelector('.suggest-add')),
    '每条候选左边都有一颗「＋」（搜索页没有这一颗 —— 这就是本页的差别）');
  chk(rows.every(r => r.querySelector('.suggest-add').dataset.on === '0'),
    '还没加时是「未选中」态');

  rows[0].querySelector('.suggest-add').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await sleep(60);
  eq(d.querySelectorAll('#today-list .item').length, before + 1, '点「＋」之后 5 首变 6 首');
  const pinned = [...d.querySelectorAll('#today-list .item.pinned')];
  eq(pinned.length, 1, '多出来的那一条带 pinned 标记');
  chk(/今日加背/.test(pinned[0].textContent), '那一条的标签写「今日加背」');
  chk(/加背 1/.test(d.querySelector('#today-sub').textContent),
    '副标题如实报出加背数（' + d.querySelector('#today-sub').textContent + '）');
  chk(pinned[0].querySelector('.item-read'), '加背那一条照样能朗读');
  eq(pinned[0].querySelectorAll('.item-daily').length, 0,
    '今日列表里不再挂一颗「＋」（它已经在列表里了）');

  const onBtn = d.querySelector('#today-suggest .suggest-add[data-on="1"]');
  chk(!!onBtn, '加进去之后下拉里那一颗变成选中态');
  onBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await sleep(60);
  eq(d.querySelectorAll('#today-list .item').length, before, '再点一次 = 移出，回到 5 首');
  eq(d.querySelectorAll('#today-list .item.pinned').length, 0, '列表里那条也没了');
}

console.log('\n=== 四、加背那几篇照常走遗忘曲线 ===');
{
  const w = boot('index.html', '/');
  await w.__ready;
  await sleep(250);
  const d = w.document;

  w.DailyExtra.add({ id: 'tangshi-ts-1', title: '感遇', dynasty: '唐', author: '张九龄',
    bookName: '唐诗三百首', text: '兰叶春葳蕤，桂华秋皎洁。', translation: '兰叶逢春长得茂盛…' });
  await sleep(60);
  const pin = [...d.querySelectorAll('#today-list .item.pinned')];
  eq(pin.length, 1, '加背那一条进了今日列表');

  pin[0].querySelector('.item-main').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await sleep(60);
  eq(d.querySelector('#m-title').textContent, '感遇', '点开的是那一篇');
  chk(d.querySelector('#m-text').textContent.indexOf('葳蕤') >= 0,
    '正文来自加入时的快照（明天断网也读得到）');
  chk(/唐诗三百首/.test(d.querySelector('#m-grade').textContent),
    '出处写集子名，不写成「undefined年级 undefined学期」');
  chk(/遗忘曲线/.test(d.querySelector('#m-hint').textContent),
    '提示如实说它按当前算法排下次（' + d.querySelector('#m-hint').textContent + '）');

  d.querySelector('.actions .btn.good').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await sleep(60);
  const rec = w.Storage.get('tangshi-ts-1');
  chk(!!rec, '背完真的写进了进度（不是只加进列表就算完）');
  eq(rec.reviewCount, 1, '复习次数记上了');
  chk(rec.nextReviewAt > Date.now(), '按算法排了下次复习时间');
  eq(rec.level, 1, '阶段推进了一级（与课内篇目同一套算法）');

  const pin2 = d.querySelector('#today-list .item.pinned');
  chk(!!pin2 && !!pin2.querySelector('.mbar'),
    '列表里那一行出现掌握度条（与课内篇目同一套显示）');

  chk(w.DailyExtra.count() === 1, '它**不在**任何自选集合里（集合是另一份数据）');
  chk(!w.ReciteCollections.has('tangshi-ts-1'),
    '确认：加背不写进自选集合（两件事不混）');
}

console.log('\n=== 五、集子页：列表每一行都有，详情页插在译文与加入背诵之间 ===');
{
  const w = boot('classic/index.html', '/classic/');
  await w.__ready;
  await sleep(250);
  const d = w.document;

  const rows = [...d.querySelectorAll('#gw-list .item')];
  chk(rows.length > 50, '小古文列表有内容（' + rows.length + ' 行）');
  chk(rows.every(r => r.querySelector('.item-daily')), '每一行都有一颗「＋」');
  chk(rows.every(r => r.querySelector('.item-recite')), '每一行原有的「加入背诵」也都还在');

  const kids = [...rows[0].children].map(e => (e.className || '').split(' ')[0]);
  chk(kids.indexOf('item-main') < kids.indexOf('item-daily') &&
      kids.indexOf('item-daily') < kids.indexOf('item-recite'),
    '「＋」在正文右边、加入背诵**左边**（用户点名的位置；实际 ' + kids.join(',') + '）');

  const id = rows[0].dataset.id;
  const btn = rows[0].querySelector('.item-daily');
  btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await sleep(50);
  chk(w.DailyExtra.has(id), '点列表里的「＋」真的加进去了');
  eq(btn.dataset.on, '1', '按钮进入选中态');
  chk(!w.ReciteCollections.has(id), '点这一颗**不会**顺手加进自选集合');

  rows[0].querySelector('.item-main').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await sleep(60);
  chk(d.querySelector('#gw-reader').hidden === false, '点开详情页');
  const detail = d.querySelector('#gw-daily');
  chk(!!detail, '详情页有「加入今日背诵」那一颗');
  eq(detail.dataset.on, '1', '详情页那一颗与列表同步（都是选中态）');

  const icons = [...d.querySelector('#rd-actions-icons').children].map(e => e.id);
  chk(icons.indexOf('rd-trans-toggle') < icons.indexOf('gw-daily') &&
      icons.indexOf('gw-daily') < icons.indexOf('gw-recite'),
    '详情页那一颗插在译文与加入背诵之间（实际 ' + icons.join(',') + '）');

  detail.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await sleep(50);
  chk(!w.DailyExtra.has(id), '详情页那一颗点一下是移出');
  eq(rows[0].querySelector('.item-daily').dataset.on, '0', '列表里那一颗跟着复位');
}

console.log('\n=== 六、搜索页：结果列表与详情页同样两颗 ===');
{
  const w = boot('search/index.html', '/search/');
  await w.__ready;
  await sleep(250);
  const d = w.document;

  const input = d.querySelector('#gw-search');
  input.value = '月';
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  await sleep(60);
  const hits = [...d.querySelectorAll('#gw-list .item')];
  chk(hits.length > 0, '搜「月」有结果（' + hits.length + ' 条）');
  chk(hits.every(h => h.querySelector('.item-daily')), '搜索结果每一行也有「＋」');
  chk(hits.every(h => h.querySelector('.item-recite')), '原本的「加入背诵」也都在');

  const id = hits[0].dataset.id;
  const btn = hits[0].querySelector('.item-daily');
  btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await sleep(50);
  chk(w.DailyExtra.has(id), '搜索结果里点「＋」加得进去');

  // 候选下拉开着时，点结果行的第一下是「收起下拉」（搜索页原本的手感：
  // 下拉浮在列表上面，第一下不该穿过去）。行里那几颗圆钮是例外 —— 上面那一段
  // 已经证明「＋」一下就生效了。
  hits[0].querySelector('.item-main').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await sleep(60);
  chk(d.querySelector('#search-suggest').hidden === true, '点结果行第一下先收起候选下拉');
  hits[0].querySelector('.item-main').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await sleep(60);
  chk(d.querySelector('#gw-reader').hidden === false, '再点一下打开搜索结果详情页');
  eq(d.querySelector('#gw-daily').dataset.on, '1', '详情页那一颗同步为选中');
  const icons = [...d.querySelector('#rd-actions-icons').children].map(e => e.id);
  chk(icons.indexOf('gw-daily') > icons.indexOf('rd-trans-toggle') &&
      icons.indexOf('gw-daily') < icons.indexOf('gw-recite'),
    '同样是译文与加入背诵之间（实际 ' + icons.join(',') + '）');

  // 搜索页自己的候选下拉**不该**长出「＋」（那是今日背诵页那一处的差别）
  input.value = '月';
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  await sleep(40);
  const sug = d.querySelector('#search-suggest');
  chk(sug.hidden === false, '搜索页自己的候选下拉照旧出现');
  eq(sug.querySelectorAll('.suggest-add').length, 0,
    '搜索页的候选里没有「＋」（用户要的是列表与详情页上那一颗，不是这里）');
}

console.log('\n=== 七、设置页：单独一处能看见、能多选删 ===');
{
  const seed = {
    poem_daily_extra_v1: JSON.stringify({ v: 1, date: todayStr(), items: [
      { id: 'classic-gw-1', wid: 'classic-gw-1', entryId: 'classic-gw-1',
        snap: { title: '人之初', dynasty: '', author: '', bookName: '课外必背小古文' }, at: 1 },
      { id: 'tangshi-ts-1', wid: 'tangshi-ts-1', entryId: 'tangshi-ts-1',
        snap: { title: '感遇', dynasty: '唐', author: '张九龄', bookName: '唐诗三百首' }, at: 2 },
      { id: 'songci-sc-1', wid: 'songci-sc-1', entryId: 'songci-sc-1',
        snap: { title: '宴山亭', dynasty: '宋', author: '赵佶', bookName: '宋词三百首' }, at: 3 }
    ] })
  };
  const w = boot('settings/recite/index.html', '/settings/recite/', seed);
  await w.__ready;
  await sleep(250);
  const d = w.document;

  chk(!!d.querySelector('#daily-panel'), '「背诵」页上有今日加背那一块');
  const rows = [...d.querySelectorAll('#daily-list .daily-row')];
  eq(rows.length, 3, '今天加背的三篇都列出来了');
  chk(rows.every(r => r.querySelector('.daily-pick')), '每一行都有勾选框（多选）');
  const text = d.querySelector('#daily-list').textContent;
  chk(/人之初/.test(text) && /感遇/.test(text) && /宴山亭/.test(text), '三篇篇名都在');
  chk(/唐诗三百首/.test(text) && /张九龄/.test(text), '出处与作者都在');
  chk(!d.querySelector('#daily-tip') || d.querySelector('#daily-tip').hidden === true,
    '有内容时不显示空提示');

  const picks = [...d.querySelectorAll('.daily-pick')];
  picks[0].checked = true;
  picks[1].checked = true;
  d.querySelector('#daily-remove-picked').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await sleep(50);
  eq(w.DailyExtra.count(), 1, '「移出选中的」按勾选删掉了两篇');
  eq(d.querySelectorAll('#daily-list .daily-row').length, 1, '界面跟着只剩一行');

  d.querySelector('#daily-pick-all').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  chk([...d.querySelectorAll('.daily-pick')].every(p => p.checked), '「全选」把剩下的勾上');
  d.querySelector('#daily-pick-none').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  chk([...d.querySelectorAll('.daily-pick')].every(p => !p.checked), '「取消全选」都取消');

  w.confirm = () => true;
  d.querySelector('#daily-clear').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await sleep(50);
  eq(w.DailyExtra.count(), 0, '「全部清空」清干净了');
  eq(d.querySelectorAll('#daily-list .daily-row').length, 0, '列表空了');
  eq(d.querySelector('#daily-tip').hidden, false, '空的时候提示又出现（告诉人去哪儿加）');
  chk(/＋/.test(d.querySelector('#daily-tip').textContent),
    '提示里说清了「去哪儿加」（' + d.querySelector('#daily-tip').textContent.slice(0, 22) + '…）');

  const page = read('settings/recite/index.html');
  chk(/今日加背/.test(page), '这一块有自己的小标题');
  chk(/不上云/.test(page), '如实写明本机保存、不上云（换设备不跟过去）');
}

console.log('\n=== 八、三处口径（源码级守卫）===');
{
  const data = read('js/daily-extra.js');
  const ui = read('js/daily-extra-ui.js');
  const core = read('js/reader-core.js');
  const app = read('js/app.js');
  const sw = read('sw.js');

  chk(/poem_daily_extra_v1/.test(data), '键名是 poem_daily_extra_v1');
  chk(/keyFor/.test(data) && !/["']::["']/.test(data),
    '子用户后缀走 ProgressStore.keyFor（不自己拼 :: —— 拼法只有 family.js 一处）');
  chk(/daily-extra-change/.test(data), '它改了就广播 daily-extra-change（三处界面据此同步）');

  chk(/function itemBtn/.test(ui) && /function detailBtn/.test(ui) && /function bindSuggest/.test(ui),
    '图形与文案只有一份（itemBtn / detailBtn / bindSuggest 全在这一处）');
  chk(!/item-daily/.test(core) || /dailyItemBtn/.test(core),
    '阅读器引擎走 dailyItemBtn()，不自己拼一遍那颗钮');
  chk(!/de-plus/.test(core), '连「＋」那枚 SVG 也不在别处抄第二份');

  chk(/DailyExtra\.today\(\)/.test(app), '首页的缓存指纹带上「今天」（跨 0 点自动换键）');
  chk(/function withTodayExtra/.test(app) && /reason: "pinned"/.test(app),
    '加背那几篇在计划生成**之后**并上去（不被 dailyCount 裁掉）');
  chk(app.indexOf('withTodayExtra(Scheduler.generateDailyPlan') > 0,
    '是「先生成再并」，不是「并进候选池」—— 池子里的会被数量裁掉');
  chk(!/extraPoems: todayExtraPoems\(\)/.test(app),
    '加背**不**混进 extraPoems（那一条进的是会被裁的候选池）');
  chk(/todayExtraPoems\(\)\.forEach/.test(app),
    '会话缓存恢复时也把加背那几篇补进映射（否则恢复出来看不到）');

  const recReset = app.slice(app.indexOf('btnReset'), app.indexOf('btnReset') + 400);
  chk(/DailyExtra\.clear\(\)/.test(recReset),
    '「清空全部背诵进度」也顺手清掉今天的加背（不留一条指向已清进度的幽灵）');

  chk(/\.\/js\/daily-extra\.js/.test(sw) && /\.\/js\/daily-extra-ui\.js/.test(sw),
    '两个新脚本都在预缓存清单里（断网也加得进）');
  const ver = parseInt((sw.match(/poem-app-v(\d+)/) || [0, '0'])[1], 10);
  chk(ver >= 164, '缓存版本跟着提了（改了 css / js / 页面，实际 v' + ver + '）');

  const pages = ['index.html', 'search/index.html', 'library/index.html', 'classic/index.html',
    'tangshi/index.html', 'songci/index.html', 'guwen/index.html', 'zhaoming/index.html',
    'poems/index.html'];
  const missing = pages.filter(f => read(f).indexOf('js/daily-extra.js') < 0);
  chk(missing.length === 0,
    '所有带今日背诵按钮的页面都加载了数据层（缺：' + (missing.join(',') || '无') + '）');

  // 每一张带详情页的页面都要有那一颗，且位置一致
  const detailPages = pages.filter(f => /id="gw-recite"/.test(read(f)) || /lib-gw-recite/.test(read(f)));
  const badOrder = detailPages.filter(f => {
    const html = read(f);
    const at = s => html.indexOf(s);
    return !(at('rd-trans-toggle') < at('gw-daily') && at('gw-daily') < at('gw-recite'));
  });
  chk(badOrder.length === 0,
    '每一张详情页那一颗都在译文与加入背诵之间（不对的：' + (badOrder.join(',') || '无') + '）');
}

console.log(fails ? ('\n❌ ' + fails + ' 项失败') : '\n全部通过');

// jsdom 里挂在 window 上的定时器（搜索页刚性的候选收起延时之类）不会自己停，
// 不显式退出的话这一层会吊着不退（CI 上表现为「这一步一直不结束」）。
process.exit(fails ? 1 : 0);
})();
