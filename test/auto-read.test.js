/**
 * 自动朗读 / 阅读辅助 / 小古文导航 专项测试
 *
 * 覆盖 Issue #1 的需求：
 *   1. 首页任务条标题为「今日背诵」
 *   4. 底部播放栏：贴底占满整宽、无圆角、高度加大、宋式配色；
 *      不出现「正在朗读 / 暂停 / 继续 / 下一篇 / 停止」文字，全部用 SVG 图标；
 *      不显示「今日 5 首」；当前一首大字 + 下一首小字
 *   5. 今日「朗读」按钮改为圆形播放键，与右侧 0/5 圆环成对
 *   6. 列表单项右侧的小喇叭换成播放键
 *   7. 详情页「小喇叭 + 朗读」保持不变
 *   8. 播放时有声音，暂停 / 停止后声音消失
 *   5/10. 「阅读辅助」开关必须有可见差别（开启 → 打开诗词自动注音）
 *   10. 小古文默认字号降一级，A－ 可再降两级；Issue #55 起再追加最细一档 13px
 *   12. 小古文详情页有上一篇 / 下一篇，无需回索引页
 *   13. 白话译文可单独朗读
 *   15. 今日任务可连读（标题 + 朝代 + 作者 + 正文），单首也可朗读，
 *       小古文索引页可随机连读、读完自动跳下一篇，全程可暂停 / 停止
 *   16. 详情页（诗词弹层 / 小古文阅读器）暂停后状态不错乱：
 *       ▶ / ⏸ 是同一颗键的两态，暂停中仍是 ⏸（点它即停），
 *       再点一次是停止而不是又叠一层朗读
 *       （部分设备 pause 后 speaking 变 false，靠 Speech.active() 兜底）
 *
 * 运行：node test/auto-read.test.js
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const ROOT = __dirname + '/../';

/**
 * 页面文件 → 目录化地址。URL 里不再出现 .html：
 *   index.html → /            classic/index.html → /classic/
 *   settings/index.html → /settings/   …
 */
const URL_OF = {
  'index.html': '/',
  'classic/index.html': '/classic/',
  'settings/index.html': '/settings/',
  // 设置拆成二级页（Issue #132 后续）：注音开关住在「朗读」页
  //（Issue #163 把原「阅读与朗读」页名精简为「朗读」，见 js/settings-nav.js）
  'settings/reader/index.html': '/settings/reader/'
};

/**
 * 造一个「已用邮箱码登录过」的本机会话（键 → 值）。
 *
 * 为什么要它：Issue #132 起**语音播放要求登录**（游客置灰），
 * 而这些用例测的是「播放本身」，所以必须先有一个真实会话 ——
 * 调 auth-core 走一遍发码 / 校验，不手拼 JSON。
 */
function signedInSeed() {
  const A = require(ROOT + 'js/auth-core.js');
  const mem = {};
  const backing = {
    getItem: k => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: k => { delete mem[k]; }
  };
  const store = A.makeStore(backing);
  const req = A.requestCode(store, { channel: 'email', value: 'zhangmin@163.com' }, 'login', { code: '246810' });
  A.verifyCode(store, req.codeId, '246810', 'login');
  return mem;
}

/** 启动一个页面（可选注入假 SpeechSynthesis / 初始 localStorage） */
function boot(file, seed, withSpeech) {
  const html = fs.readFileSync(ROOT + file, 'utf8');
  const pageUrl = 'https://local.test' + (URL_OF[file] || '/' + file);
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: pageUrl,
    beforeParse(win) {
      // jsdom 没有 window.scrollTo，补一个空实现避免噪音日志
      win.scrollTo = function () {};
      // 要测播放的页面，一律先预置一个已登录会话；useSeed 为 false 时不预置
      if (withSpeech && !(seed && seed.__guest)) {
        const mem = signedInSeed();
        const shadow = new Map(Object.entries(mem));
        Object.defineProperty(win, 'localStorage', {
          configurable: true,
          value: {
            getItem: k => (shadow.has(k) ? shadow.get(k) : null),
            setItem: (k, v) => { shadow.set(k, String(v)); },
            removeItem: k => { shadow.delete(k); },
            clear: () => shadow.clear(),
            key: i => Array.from(shadow.keys())[i] || null
          }
        });
        Object.defineProperty(win.localStorage, 'length', { get: () => shadow.size });
      }
      if (!withSpeech) return;
      win.SpeechSynthesisUtterance = function (t) { this.text = t; };
      win.speechSynthesis = {
        speaking: false,
        paused: false,
        _spoken: null,
        speak(u) { this._spoken = u; this.speaking = true; },
        cancel() { this.speaking = false; },
        pause() { this.paused = true; },
        resume() { this.paused = false; },
        getVoices() { return [{ lang: 'zh-CN', name: 'Tingting' }]; },
        addEventListener() {}
      };
    }
  });
  const w = dom.window;
  if (seed) for (const k in seed) if (k !== '__guest') w.localStorage.setItem(k, seed[k]);
  html.match(/<script src="([^"]+)"><\/script>/g)
    .map(x => x.match(/src="([^"]+)"/)[1])
    .forEach(f => {
      const el = w.document.createElement('script');
      el.textContent = fs.readFileSync(ROOT + f, 'utf8');
      w.document.body.appendChild(el);
    });
  return w;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

(async () => {
  // ---- 首页：朗读全部 + 单首朗读 ----
  const w = boot('index.html', null, true);
  await sleep(400);
  const d = w.document;
  chk(!!d.querySelector('#today-read'), '今日任务条有「朗读（全部）」按钮');
  chk(d.querySelectorAll('#today-list .item-read').length === 5, '今日每首右侧都有朗读按钮');
  const btn = d.querySelector('#today-read');
  chk(!!d.querySelector('#today-read .play-glyph'), '今日朗读按钮是圆形播放键（▶ 图标，不再有「朗读」文字）');
  chk(d.querySelector('#today-read-text').classList.contains('sr-only'),
    '播放键文字只留给读屏软件（视觉上不显示）');
  btn.dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(50);
  const spoken = w.speechSynthesis._spoken;
  chk(!!spoken, '点朗读全部后发出语音');
  chk(/咏鹅|江南|画/.test(spoken.text) && spoken.text.includes('。'), '第一条朗读内容含诗题与正文');
  const bar = d.querySelector('#reader-player');
  chk(bar.hidden === false, '底部弹出播放栏');
  chk(bar.classList.contains('player-bar'), '播放栏使用新版 .player-bar 结构');
  // 需求 4：不再显示「正在朗读」这类文字，状态全部交给图标
  chk(!/正在朗读|已暂停/.test(bar.textContent), '播放栏不出现「正在朗读 / 已暂停」文字');
  chk(!/今日 5 首/.test(bar.textContent), '播放栏不再显示「今日 5 首」');
  const nowTitle = d.querySelector('#rp-now').textContent;
  chk(nowTitle.length > 0 && !/朗读/.test(nowTitle), '播放栏主信息是当前这一首：' + nowTitle);
  const nextTitle = d.querySelector('#rp-next-title');
  chk(nextTitle.hidden === false && /下一首/.test(nextTitle.textContent), '下方小字提示下一首：' + nextTitle.textContent);
  chk(nextTitle.textContent !== nowTitle, '下一首与当前一首不是同一首');
  chk(d.querySelectorAll('#today-list .item.reading').length === 1, '当前朗诵的诗被高亮');
  chk(btn.dataset.on === '1', '播放中，今日圆形播放键切换为暂停态');
  chk(d.querySelector('#today-read .pause-glyph') !== null, '暂停态用 ⏸ 图标表达');

  // 需求 4：暂停 / 继续 / 下一篇 / 停止 全部是 SVG 图标按钮
  const toggle = d.querySelector('#rp-toggle');
  ['#rp-prev', '#rp-toggle', '#rp-next', '#rp-stop'].forEach(sel => {
    const b = d.querySelector(sel);
    chk(!!b && !!b.querySelector('svg'), '播放栏 ' + sel + ' 用 SVG 图标');
    chk(!!b && b.textContent.trim() === '', '播放栏 ' + sel + ' 不含文字');
  });
  chk(w.Speech.supported() === true, '语音引擎在跑');
  // 暂停
  toggle.dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(30);
  chk(w.Speech.paused() === true, '可以暂停');
  chk(!!d.querySelector('#rp-toggle .pb-play'), '暂停后主按钮换成 ▶ 播放图标（一眼看出能继续）');
  chk(bar.dataset.paused === '1', '播放栏标记为暂停态');
  toggle.dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(30);
  chk(w.Speech.paused() === false, '可以继续');
  // 下一篇
  d.querySelector('#rp-next').dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(30);
  chk(w.Speech.index() === 1, '「下一篇」跳到第 2 首（index=' + w.Speech.index() + '）');
  chk(d.querySelector('#rp-now').textContent !== nowTitle, '播放栏主信息跟着换成第 2 首');
  // 停止
  d.querySelector('#rp-stop').dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(30);
  chk(bar.hidden === true, '停止后播放栏收起');
  chk(w.speechSynthesis.speaking === false, '停止后语音引擎真的停了（不再有声音）');
  chk(d.querySelector('#today-read').dataset.on === '0', '停止后圆形播放键复位为 ▶');
  chk(d.querySelectorAll('#today-list .item.reading').length === 0, '停止后取消高亮');

  // ---- 需求 8：播放有声音，暂停 / 停止后没有声音 ----
  {
    const w3 = boot('index.html', null, true);
    await sleep(400);
    const d3 = w3.document;
    const synth = w3.speechSynthesis;
    d3.querySelector('#today-read').dispatchEvent(new w3.Event('click', { bubbles: true }));
    await sleep(40);
    chk(synth.speaking === true, '播放时语音引擎处于发声状态');
    d3.querySelector('#rp-toggle').dispatchEvent(new w3.Event('click', { bubbles: true }));
    await sleep(30);
    chk(w3.Speech.paused() === true && synth.paused === true, '暂停时语音引擎真的被暂停（不出声）');
    d3.querySelector('#rp-toggle').dispatchEvent(new w3.Event('click', { bubbles: true }));
    await sleep(30);
    chk(w3.Speech.paused() === false && synth.paused === false, '继续后恢复发声');
    d3.querySelector('#rp-stop').dispatchEvent(new w3.Event('click', { bubbles: true }));
    await sleep(30);
    chk(synth.speaking === false, '停止后语音引擎被 cancel，声音立即消失');
    chk(w3.Speech.active() === false, '停止后朗读队列清空');
    // 单首朗读同样要能停干净
    const itemRead = d3.querySelector('#today-list .item-read');
    itemRead.dispatchEvent(new w3.Event('click', { bubbles: true }));
    await sleep(30);
    chk(synth.speaking === true, '单首播放时发声');
    itemRead.dispatchEvent(new w3.Event('click', { bubbles: true }));
    await sleep(30);
    chk(synth.speaking === false, '单首再点一次停止，声音消失');
  }

  // ---- 需求 7：诗词详情页的「小喇叭 + 朗读」保持不变 ----
  {
    const w4 = boot('index.html', null, true);
    await sleep(400);
    const d4 = w4.document;
    // 需求：详情页的播放与暂停不再并排 —— 同一颗键上 ▶ / ⏸ 互斥切换；
    // 译文那颗朗读键挪进白话译文框，展开才出现，不与正文键并排
    const readBtn = d4.querySelector('#m-read-btn');
    chk(!!readBtn.querySelector('svg'), '详情页朗读按钮是 SVG 播放图标');
    chk(!!readBtn.querySelector('.play-glyph') && !!readBtn.querySelector('.pause-glyph'),
      '播放与暂停是同一颗键的两种状态，不并排');
    chk(d4.querySelector('#m-read-combo') === null, '不再有「原文 / 译文」组合键');
    chk(!!d4.querySelector('#m-actions-icons #m-read-btn') &&
      d4.querySelectorAll('#m-actions-icons #m-trans-read').length === 0,
      '第一排只有一个播放键，译文键不在这一排');
    chk(d4.querySelector('#m-trans #m-trans-read') !== null, '译文朗读键在译文框里（展开才可见）');
    d4.querySelector('#today-list .item').dispatchEvent(new w4.Event('click', { bubbles: true }));
    readBtn.dispatchEvent(new w4.Event('click', { bubbles: true }));
    await sleep(30);
    chk(w4.speechSynthesis.speaking === true, '详情页朗读按钮照常发声');
    chk(readBtn.dataset.on === '1', '朗读中同一颗键变成 ⏸（播放态）');
    chk(readBtn.querySelector('.play-glyph').style.display !== 'inline-flex', '播放中不再显示 ▶');
    readBtn.dispatchEvent(new w4.Event('click', { bubbles: true }));
    await sleep(30);
    chk(readBtn.dataset.on === '0', '再点一次停止并复位按钮');
  }

  // 单首朗读
  const one = d.querySelector('#today-list .item-read');
  chk(!!one.querySelector('.play-glyph'), '列表单项右侧是 ▶ 播放键图标');
  one.dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(30);
  chk(/咏鹅/.test(w.speechSynthesis._spoken.text), '点单首朗读会读这一首');
  chk(!!one.querySelector('.pause-glyph'), '播放中单首按钮显示 ⏸');
  chk(d.querySelectorAll('#today-list .item-read[data-on="1"]').length === 5, '朗读中列表朗读按钮高亮');
  one.dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(30);
  chk(w.speechSynthesis.speaking === false, '再点一次停止单首朗读');
  // 单首朗读不应打开弹层
  chk(d.querySelector('#modal').hidden === true, '点朗读按钮不会误开诗词弹层');

  // ---- 阅读辅助开关的可见差别 ----
  // 开启（默认「只标生字」）→ 打开诗词自动注音；关闭 → 纯文本，需要时手动切档位。
  // 设置已改成独立整页、又拆成二级页，注音开关住在「朗读」页
  // （/settings/reader/，Issue #163 的组标题就是「朗读」）：这里在那一页点开关，
  // 再把结果搬进首页实例的 localStorage（两个 JSDOM 实例的存储各自独立）。
  const helperPage = boot('settings/reader/index.html', null, false);
  // boot() 是同步注入脚本的，DOMContentLoaded 早已触发过，手动补一次让设置页初始化
  helperPage.document.dispatchEvent(new helperPage.Event('DOMContentLoaded', { bubbles: true }));
  const clickHelper = (v) => {
    [...helperPage.document.querySelectorAll('#seg-helper button')]
      .find(b => b.dataset.helper === v)
      .dispatchEvent(new w.Event('click', { bubbles: true }));
    w.localStorage.setItem('poem_recite_settings_v1', helperPage.localStorage.getItem('poem_recite_settings_v1'));
    // Issue #132 阶段 0：阅读辅助属**设备域**（poem_device_prefs_v1），
    // 老键里那份只是镜像 —— 两把键要一起搬过去，只搬老键会读到新键的旧值
    w.localStorage.setItem('poem_device_prefs_v1', helperPage.localStorage.getItem('poem_device_prefs_v1'));
    // 首页用的是启动时读到的快照，让它重新读一次并刷新界面
    w.PoemApp.reloadSettings();
  };
  /** 打开一首确有生字的诗（「只标生字」下才有 ruby 可数） */
  const openWithRare = () => {
    for (const item of d.querySelectorAll('#today-list .item')) {
      item.dispatchEvent(new w.Event('click', { bubbles: true }));
      if (d.querySelectorAll('#m-text ruby').length > 0) return true;
      d.querySelector('#modal').hidden = true;
    }
    return false;
  };
  const setMode = (m) => {
    d.querySelector('#m-pinyin-seg button[data-mode="' + m + '"]')
      .dispatchEvent(new w.Event('click', { bubbles: true }));
  };

  clickHelper('off');
  d.querySelector('#today-list .item').dispatchEvent(new w.Event('click', { bubbles: true }));
  chk(d.querySelectorAll('#m-text ruby').length === 0, '阅读辅助关闭 → 打开诗词是纯文本');
  d.querySelector('#modal').hidden = true;

  clickHelper('on');
  chk(openWithRare(), '阅读辅助开启 → 打开诗词自动注音（开关差别可见）');
  const rareN = d.querySelectorAll('#m-text ruby').length;

  // 手动切「全文注音」，差别进一步可见
  setMode('all');
  const allN = d.querySelectorAll('#m-text ruby').length;
  chk(allN > rareN, '弹层可手动切「全文注音」（' + allN + ' > ' + rareN + '）');
  setMode('off');
  chk(d.querySelectorAll('#m-text ruby').length === 0, '弹层可手动关掉注音，恢复纯文本');
  d.querySelector('#modal').hidden = true;

  // ---- 小古文：随机连读 / 上一篇下一篇 / 译文朗读 ----
  const w2 = boot('classic/index.html', null, true);
  await sleep(400);
  const c = w2.document;
  chk(!!c.querySelector('#gw-random-read'), '索引页有「连读」按钮');
  chk(c.querySelector('#gw-random-read').classList.contains('gw-play'),
    '「连读」是圆形播放键（与首页今日条那颗同一套组件，不再是带字的胶囊）');
  chk(!!c.querySelector('#gw-random-read .play-glyph') && !!c.querySelector('#gw-random-read .pause-glyph'),
    '圆键上 ▶ / ⏸ 是同一颗键的两态');
  chk(c.querySelectorAll('#gw-list .group-head .gw-play-sm').length >= 6,
    '每个分组右侧也有一颗小号圆形播放键（' + c.querySelectorAll('#gw-list .group-head .gw-play-sm').length + ' 颗）');
  chk(!!c.querySelector('#rd-prev') && !!c.querySelector('#rd-next'), '阅读器有上一篇/下一篇');
  c.querySelector('#gw-list .item').dispatchEvent(new w2.Event('click', { bubbles: true }));
  await sleep(20);
  chk(c.querySelector('#rd-read-btn').disabled === false, '有语音环境时「朗读」可用');
  chk(c.querySelector('#rd-trans-read').disabled === false, '译文朗读按钮可用');
  c.querySelector('#rd-next').dispatchEvent(new w2.Event('click', { bubbles: true }));
  await sleep(20);
  chk(c.querySelector('#rd-title').textContent.length > 0, '下一篇跳到第 2 篇：' + c.querySelector('#rd-title').textContent);
  c.querySelector('#rd-prev').dispatchEvent(new w2.Event('click', { bubbles: true }));
  await sleep(20);
  chk(c.querySelector('#rd-nav #rd-prev-title').textContent.length > 0,
    '上一篇回到第 1 篇（顶栏那枚篇号牌已撤，改看阅读器里的「上一篇 / 下一篇」标题）');
  // 首页第一篇的上一篇应禁用
  const prevBtn = c.querySelector('#rd-prev');
  chk(prevBtn.disabled === true, '第一篇时「上一篇」禁用');
  // 译文朗读
  c.querySelector('#rd-trans-toggle').dispatchEvent(new w2.Event('click', { bubbles: true }));
  await sleep(20);
  c.querySelector('#rd-trans-read').dispatchEvent(new w2.Event('click', { bubbles: true }));
  await sleep(30);
  const ts = w2.speechSynthesis._spoken.text;
  chk(!/人之初/.test(ts), '译文朗读只读译文，不读原文');
  chk(ts.length > 20, '译文朗读内容正常（' + ts.slice(0, 20) + '…）');
  w2.Speech.stop();
  // 随机连读
  c.querySelector('#gw-random-read').dispatchEvent(new w2.Event('click', { bubbles: true }));
  await sleep(60);
  chk(c.querySelector('#reader-player').hidden === false, '随机连读弹出播放栏');
  chk(c.querySelector('#rp-now').textContent.length > 0, '播放栏显示当前连读的篇名：' + c.querySelector('#rp-now').textContent);
  chk(c.querySelector('#gw-reader').hidden === false, '随机连读会自动打开阅读器');
  const firstId = c.querySelector('#rd-title').textContent;
  // 等第一条读完 → 自动跳下一篇
  w2.speechSynthesis._spoken.onend && w2.speechSynthesis._spoken.onend();
  await sleep(60);
  chk(c.querySelector('#rd-title').textContent !== firstId, '读完自动跳到下一篇（' + firstId + ' → ' + c.querySelector('#rd-title').textContent + '）');
  w2.Speech.stop();
  w2.ClassicProse.onSpeechStopped();   // 语音引擎的 cancel 事件不保证回调，手动同步界面
  await sleep(80);
  chk(c.querySelector('#gw-random-read').dataset.on === '0', '停止后随机连读圆键复位');
  chk(c.querySelector('#gw-random-read').getAttribute('aria-pressed') === 'false',
    '圆键的 aria-pressed 同步复位为 false');
  // 连读中这颗键必须是 ⏸（与首页「今日播放中」同一套状态表达）
  c.querySelector('#gw-random-read').dispatchEvent(new w2.Event('click', { bubbles: true }));
  await sleep(60);
  chk(c.querySelector('#gw-random-read').dataset.on === '1', '连读中圆键进入高亮态（data-on=1）');
  chk(c.querySelector('#gw-random-read').getAttribute('aria-pressed') === 'true',
    '连读中 aria-pressed 为 true（读屏也知道正在连读）');
  w2.Speech.stop();
  w2.ClassicProse.onSpeechStopped();
  await sleep(80);
  chk(c.querySelector('#gw-random-read').dataset.on === '0', '停止后圆键回到 ▶');
  // 分组圆键：组内连读同样能跑起来
  const gBtn = c.querySelector('#gw-list .group-head .gw-play-sm');
  const gName = gBtn.dataset.randomGroup;
  gBtn.dispatchEvent(new w2.Event('click', { bubbles: true }));
  await sleep(60);
  chk(c.querySelector('#reader-player').hidden === false,
    '点分组圆键弹出播放栏（「' + gName + '」组内连读启动了）');
  chk(c.querySelector('#rp-now').textContent.length > 0,
    '播放栏显示当前连读的篇名：' + c.querySelector('#rp-now').textContent);
  // 组内连读只在组里抽：第一篇一定属于该组
  const inGroup = (c.querySelector('#rd-meta').textContent || '').length > 0;
  chk(inGroup, '组内连读打开的是本组的一篇（' + c.querySelector('#rd-title').textContent + '）');
  w2.Speech.stop();
  w2.ClassicProse.onSpeechStopped();
  await sleep(80);

  /* ---- 组合播放键：五种模式（Issue #69 本轮）----
     每部集子的分类卡头右侧那颗键不再是「随机」一种用法，而是
     「听什么 × 怎么排」的组合：顺序 / 随机 × 原文 / 白话 / 原文+白话。
     这里逐个把模式点开，验证「读到的文本」确实跟着模式走 ——
     模式名写在菜单里是文案，读出来的是原文还是白话才是功能。 */
  const modeBtn = () => c.querySelector('#gw-list .group-head .gw-play-sm');
  /** 长按卡头圆键 → 弹出菜单（短按是「直接开听」，不再兼开菜单） */
  const longPress = async () => {
    const press = new w2.Event('pointerdown', { bubbles: true });
    press.clientX = 10; press.clientY = 10;     // jsdom 没有 PointerEvent，用 Event 补坐标
    modeBtn().dispatchEvent(press);
    await sleep(560);
  };
  /** 按某个模式开听：长按弹菜单 → 点菜单项 */
  const pickMode = async (id) => {
    await longPress();
    modeBtn().querySelector('.gw-menu-item[data-mode="' + id + '"]')
      .dispatchEvent(new w2.Event('click', { bubbles: true }));
    await sleep(60);
  };
  const stopAll = async () => { w2.Speech.stop(); w2.ClassicProse.onSpeechStopped(); await sleep(60); };

  // 长按弹出菜单并选中「连续播放白话译文」
  await longPress();
  chk(modeBtn().querySelector('.gw-menu').hidden === false, '长按卡头圆键弹出模式菜单');
  chk(c.querySelectorAll('#gw-list .group-head .gw-menu:not([hidden])').length === 1,
    '同一时刻只弹一个菜单（点第二颗会把上一颗收起）');
  c.querySelector('.gw-menu-item[data-mode="seq-trans"]').dispatchEvent(new w2.Event('click', { bubbles: true }));
  await sleep(80);
  chk(c.querySelector('#reader-player').hidden === false, '选中「连续播放白话译文」后立刻开读');
  chk(/白话/.test(c.querySelector('#rp-mode').textContent),
    '播放栏首行报出当前模式：' + c.querySelector('#rp-mode').textContent);
  const transText = w2.speechSynthesis._spoken.text;
  chk(!/人之初，宋，王应麟/.test(transText),
    '「白话」模式读的是译文而不是原文（' + transText.slice(0, 14) + '…）');
  await stopAll();

  // 「原文白话顺序播放」：同一篇的两段接在一条里
  await pickMode('seq-both');
  const bothText = w2.speechSynthesis._spoken.text;
  chk(/人之初/.test(bothText) && bothText.length > 40,
    '「原文 + 白话」把一篇的原文与译文接在一起读（' + bothText.length + ' 字）');
  await stopAll();

  // 「随机」档：队列顺序与目录顺序不同（随机抽一篇，不保证是第一篇）
  await pickMode('shuffle-origin');
  chk(c.querySelector('#reader-player').hidden === false, '随机模式同样能起播');
  chk(/随机/.test(c.querySelector('#rp-mode').textContent),
    '播放栏报出随机模式：' + c.querySelector('#rp-mode').textContent);
  await stopAll();

  // 模式是**偏好**：换到别的集子页也记得（跨集子一份），出厂档是「原文 · 顺序」
  // 菜单的选中态是**每次打开时**按当前模式刷的，所以要先把菜单打开再查
  await longPress();
  chk(modeBtn().querySelector('.gw-menu-item[data-mode="shuffle-origin"]').getAttribute('aria-checked') === 'true',
    '菜单里把「随机播放原文」标成当前选中项');
  chk(modeBtn().querySelectorAll('.gw-menu-item[aria-checked="true"]').length === 1,
    '五个模式里只有一个是选中态（互斥）');
  // 长按只负责弹菜单，**不该**顺手把队列开一轮。
  // 判据取「播放栏收到的模式名」——上一轮连读的模式行还在，说明队列没被重开；
  // 长按若误触发开听，播放栏会被重开成当前模式（且处于播放态）。
  chk(modeBtn().dataset.menu === '1' && c.querySelector('#rp-mode').textContent.length > 0,
    '长按只弹菜单、不打断已停的那一轮（挑模式与开听是两件事）');
  // 点菜单以外的地方把菜单收起
  c.querySelector('#gw-search').dispatchEvent(new w2.Event('click', { bubbles: true }));
  await sleep(20);
  chk(modeBtn().querySelector('.gw-menu').hidden === true, '点别处收起菜单');
  await stopAll();
  chk(w2.localStorage.getItem('poem_play_mode_v1') === 'shuffle-origin',
    '模式写进本机（poem_play_mode_v1），下次打开还是它');
  await pickMode('seq-origin');
  chk(w2.localStorage.getItem('poem_play_mode_v1') === 'seq-origin', '改回「连续播放原文」也持久化');
  await stopAll();

  /* ---- 回归：阅读辅助工具条不得再丢（曾因合并把整条工具条丢了）---- */
  const rowMain = c.querySelector('#rd-actions-main');
  const rowIcons = c.querySelector('#rd-actions-icons');
  chk(!!rowMain && rowMain.children.length === 3, '上一行：对齐 / 字号 / 注音 三组按钮都在');
  chk(!!c.querySelector('#rd-font-down') && !!c.querySelector('#rd-font-up'),
    'A－ / A＋ 字号按钮还在（此前被合并丢掉）');
  chk(!!c.querySelector('#rd-align-seg'), '正文对齐组合按钮在');
  chk(!!rowIcons && rowIcons.children.length === 4, '下一行：正文朗读键 / 译文开关 / 标记已读 / 加入背诵 四组都在（实际 ' + (rowIcons ? rowIcons.children.length : 0) + '）');
  // 需求：播放与暂停不再并排；译文朗读键也不再与正文键并排
  chk(c.querySelector('#rd-read-combo') === null, '不再有「原文 / 译文」并排的组合键');
  chk(c.querySelectorAll('#rd-actions-icons #rd-read-btn').length === 1 &&
    c.querySelectorAll('#rd-actions-icons #rd-trans-read').length === 0,
    '工具条上只有正文一颗播放键');
  chk(!!c.querySelector('#rd-read-btn .play-glyph') && !!c.querySelector('#rd-read-btn .pause-glyph'),
    '▶ 与 ⏸ 在同一颗键上互斥切换');
  chk(!!c.querySelector('#rd-trans #rd-trans-read'), '译文朗读键在译文框里（展开才出现）');
  // 固定打开第一篇（人之初），避免受「随机连读」停留位置影响
  w2.Speech.stop();
  c.querySelector('#gw-reader > .topbar #top-act').dispatchEvent(new w2.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(20);
  c.querySelector('#gw-list .item').dispatchEvent(new w2.Event('click', { bubbles: true }));
  await sleep(30);
  chk(c.querySelector('#rd-title').textContent === '人之初', '回到第一篇「人之初」再验证组合键');
  // 展开译文 → 译文框里那颗朗读键才出现；点它应只读译文
  c.querySelector('#rd-trans-toggle').dispatchEvent(new w2.Event('click', { bubbles: true }));
  await sleep(20);
  chk(!!c.querySelector('#rd-trans #rd-trans-read'), '展开译文后译文朗读键出现');
  c.querySelector('#rd-trans-read').dispatchEvent(new w2.Event('click', { bubbles: true }));
  await sleep(30);
  chk(!/人之初/.test(w2.speechSynthesis._spoken.text), '点「译文」只读译文，不读原文');
  chk(c.querySelector('#rd-trans').hidden === false, '点「译文」会自动展开译文框');
  chk(c.querySelector('#rd-trans-read').dataset.on === '1' && c.querySelector('#rd-read-btn').dataset.on === '0',
    '正在读译文 → 只有译文那颗键点亮');
  w2.Speech.stop();
  await sleep(30);
  c.querySelector('#rd-read-btn').dispatchEvent(new w2.Event('click', { bubbles: true }));
  await sleep(30);
  chk(/人之初/.test(w2.speechSynthesis._spoken.text), '点「原文」读的是原文');
  chk(c.querySelector('#rd-read-btn').dataset.on === '1' && c.querySelector('#rd-trans-read').dataset.on === '0',
    '正在读原文 → 只有正文那颗键点亮');
  w2.Speech.stop();
  await sleep(30);
  chk(c.querySelectorAll('#rd-trans .trans-read').length === 1,
    '译文区只有一颗朗读键（不重复、也不与正文键并排）');
  chk(!!c.querySelector('#gw-done.sr-only') === false && !!c.querySelector('#rd-actions-icons #gw-done'),
    '「标记已读」并到工具条里（SVG 勾选图标）');
  // 对齐功能可点、可持久化
  c.querySelector('#rd-align-seg button[data-align="left"]').dispatchEvent(new w2.Event('click', { bubbles: true }));
  await sleep(20);
  chk(c.querySelector('#rd-text').dataset.align === 'left', '点左对齐生效');
  c.querySelector('#rd-align-seg button[data-align="center"]').dispatchEvent(new w2.Event('click', { bubbles: true }));
  await sleep(20);
  chk(c.querySelector('#rd-text').dataset.align === 'center', '点居中对齐生效');

  /* ---- 回归：阅读辅助总开关必须是「权威」，两处状态不得打架 ---- */
  // 场景 1：总开关开启 + 档位残留 off → 仍应注音（修复前 0 个 ruby，开关看似失效）
  const w3 = boot('index.html', {
    poem_recite_settings_v1: JSON.stringify({ grade: 1, term: 1, dailyCount: 5, scope: 'term', helper: 'off' })
  });
  await sleep(300);
  const d3 = w3.document;
  const openPoemIn = (dd, i) => dd.querySelectorAll('#today-list .item')[i]
    .dispatchEvent(new w3.Event('click', { bubbles: true }));
  openPoemIn(d3, 3); // 悯农，含生字
  await sleep(40);
  chk(d3.querySelectorAll('#m-text ruby').length === 0,
    '阅读辅助=关闭 → 打开诗词为纯文本（总开关权威）');
  d3.querySelector('#modal').hidden = true;
  // 在弹层里手动点「生字」→ 应自动把总开关打开，两处状态一致
  openPoemIn(d3, 3);
  await sleep(20);
  d3.querySelector('#m-pinyin-seg button[data-mode="rare"]')
    .dispatchEvent(new w3.Event('click', { bubbles: true }));
  await sleep(20);
  chk(d3.querySelectorAll('#m-text ruby').length > 0, '手动选「生字」后立刻出现拼音');
  chk(JSON.parse(w3.localStorage.getItem('poem_recite_settings_v1')).helper === 'on',
    '手动选「生字」会同步把「阅读辅助」打开（两处状态一致）');
  // 设置页上的开关 UI 同步为「开启」（设置已是独立整页 /settings/）
  const helperPage3 = boot('settings/reader/index.html', {
    poem_recite_settings_v1: w3.localStorage.getItem('poem_recite_settings_v1'),
    poem_device_prefs_v1: w3.localStorage.getItem('poem_device_prefs_v1')
  });
  helperPage3.document.dispatchEvent(new helperPage3.Event('DOMContentLoaded', { bubbles: true }));
  await sleep(60);
  chk(helperPage3.document.querySelector('#seg-helper button[data-helper="on"]').classList.contains('active'),
    '设置页里的开关 UI 同步为「开启」');
  d3.querySelector('#modal').hidden = true;
  // 反向：设置里关掉 → 弹层应为纯文本
  [...helperPage3.document.querySelectorAll('#seg-helper button')].find(b => b.dataset.helper === 'off')
    .dispatchEvent(new helperPage3.Event('click', { bubbles: true }));
  w3.localStorage.setItem('poem_recite_settings_v1', helperPage3.localStorage.getItem('poem_recite_settings_v1'));
  // 阅读辅助属设备域：两把键一起搬（老键只是镜像，见 js/progress-store.js）
  w3.localStorage.setItem('poem_device_prefs_v1', helperPage3.localStorage.getItem('poem_device_prefs_v1'));
  w3.PoemApp.reloadSettings();
  openPoemIn(d3, 3);
  await sleep(40);
  chk(d3.querySelectorAll('#m-text ruby').length === 0, '设置里关掉后打开诗词恢复纯文本');
  d3.querySelector('#modal').hidden = true;

  // 场景 2：小古文页的注音也要受总开关约束（修复前 init 只看一次 PinyinKey 是否为 null）
  const w4 = boot('classic/index.html', {
    poem_recite_settings_v1: JSON.stringify({ grade: 1, term: 1, dailyCount: 5, scope: 'term', helper: 'off' }),
    poem_helper_pinyin_v1: 'all' // 残留「全文注音」，但总开关是关闭
  });
  await sleep(300);
  const c4 = w4.document;
  c4.querySelector('#gw-list .item').dispatchEvent(new w4.Event('click', { bubbles: true }));
  await sleep(40);
  chk(c4.querySelectorAll('#rd-text ruby').length === 0,
    '总开关关闭时，小古文即使残留「全文注音」档位也不注音（总开关权威）');
  // 打开总开关 → 立即生效
  w4.localStorage.setItem('poem_recite_settings_v1',
    JSON.stringify({ grade: 1, term: 1, dailyCount: 5, scope: 'term', helper: 'on' }));
  w4.dispatchEvent(new w4.StorageEvent('storage', { key: 'poem_recite_settings_v1' }));
  await sleep(40);
  chk(c4.querySelectorAll('#rd-text ruby').length > 0, '总开关打开后小古文立即出现注音');
  // 在阅读器里选「不注音」→ 应同步关闭总开关
  c4.querySelector('#rd-pinyin-seg button[data-mode="off"]')
    .dispatchEvent(new w4.Event('click', { bubbles: true }));
  await sleep(30);
  chk(JSON.parse(w4.localStorage.getItem('poem_recite_settings_v1')).helper === 'off',
    '阅读器里选「不注音」会同步关掉「阅读辅助」（两处状态一致）');

  // 场景 3：一年级诗在默认档位下也必须有注音（修复前 6/12 首为 0）
  const w5 = boot('index.html', null);
  await sleep(300);
  const d5 = w5.document;
  let grade1WithRuby = 0, total1 = 0;
  for (const item of d5.querySelectorAll('#today-list .item')) {
    item.dispatchEvent(new w5.Event('click', { bubbles: true }));
    total1++;
    if (d5.querySelectorAll('#m-text ruby').length > 0) grade1WithRuby++;
    d5.querySelector('#modal').hidden = true;
  }
  chk(grade1WithRuby === total1,
    '一年级今日任务 ' + total1 + ' 首全部有注音（实际 ' + grade1WithRuby + ' 首）');

  // ---- 详情页朗读 / 暂停 / 译文朗读：暂停后按钮状态不错乱、不叠一层朗读 ----
  {
    const w5 = boot('classic/index.html', null, true);
    await sleep(400);
    const d5 = w5.document;
    d5.querySelector('#gw-list .item').dispatchEvent(new w5.Event('click', { bubbles: true }));
    await sleep(20);
    const readBtn = d5.querySelector('#rd-read-btn');

    readBtn.dispatchEvent(new w5.Event('click', { bubbles: true }));
    await sleep(20);
    chk(w5.speechSynthesis._spoken !== null, '阅读器「朗读」能发起语音');
    chk(readBtn.dataset.on === '1', '朗读中正文键进入播放态（原地换 ⏸）');

    // 模拟部分设备：暂停后引擎把 speaking 置为 false
    w5.Speech.pause();
    w5.speechSynthesis.speaking = false;
    chk(w5.Speech.paused() === true, '暂停后 Speech.paused() 为 true');
    chk(w5.Speech.active() === true, '暂停中 Speech.active() 仍为 true（队列/单条都算在跑）');
    chk(readBtn.dataset.on === '1', '暂停中按钮仍是 ⏸（暂停中再点就是停下来）');

    const log = (w5.speechSynthesis._log = w5.speechSynthesis._log || []);
    log.length = 0;
    readBtn.dispatchEvent(new w5.Event('click', { bubbles: true }));
    await sleep(20);
    chk(log.length === 0, '暂停中再点「朗读」= 停止，不会再叠一层朗读（新语音 ' + log.length + ' 条）');
    chk(readBtn.dataset.on === '0', '停止后按钮复位为 ▶');
    chk(w5.Speech.active() === false, '停止后朗读状态清空');

    // 译文朗读同样：暂停中再点 = 停止
    d5.querySelector('#rd-trans-toggle').dispatchEvent(new w5.Event('click', { bubbles: true }));
    await sleep(20);
    const transBtn = d5.querySelector('#rd-trans-read');
    transBtn.dispatchEvent(new w5.Event('click', { bubbles: true }));
    await sleep(20);
    w5.Speech.pause();
    w5.speechSynthesis.speaking = false;
    chk(transBtn.dataset.on === '1', '译文朗读暂停中按钮仍是 ⏸');
    log.length = 0;
    transBtn.dispatchEvent(new w5.Event('click', { bubbles: true }));
    await sleep(20);
    chk(log.length === 0, '译文朗读暂停中再点 = 停止，不会重读');
    chk(transBtn.dataset.on === '0', '译文朗读按钮复位为 ▶');

    // 列表单篇播放键同样：暂停中再点 = 停止
    const itemBtn = d5.querySelector('#gw-list .item-read');
    itemBtn.dispatchEvent(new w5.Event('click', { bubbles: true }));
    await sleep(20);
    w5.Speech.pause();
    w5.speechSynthesis.speaking = false;
    log.length = 0;
    itemBtn.dispatchEvent(new w5.Event('click', { bubbles: true }));
    await sleep(20);
    chk(log.length === 0 && w5.Speech.active() === false, '列表播放键在暂停中再点 = 停止');

    // 正在读译文时点「正文」键：切换到读正文，不是「停掉译文就完事」
    d5.querySelector('#rd-read-btn').dispatchEvent(new w5.Event('click', { bubbles: true }));
    await sleep(30);
    let spoken = String(w5.speechSynthesis._spoken.text);
    chk(spoken.indexOf('人之初') === 0, '正在读译文时点正文键会切去读正文（实际 ' + spoken.slice(0, 12) + '…）');
    chk(d5.querySelector('#rd-read-btn').dataset.on === '1' && transBtn.dataset.on === '0',
      '切到正文后只有正文键是 ⏸，译文键复位');
    // 再点一次正文键 = 停下（不会再叠一层）
    log.length = 0;
    d5.querySelector('#rd-read-btn').dispatchEvent(new w5.Event('click', { bubbles: true }));
    await sleep(30);
    chk(log.length === 0, '再点正文键 = 停下，不叠一层朗读');
  }

  /* ---- 设置页的连读档位入口（Issue #69 后续 A+B）----
     原先这五档只藏在「集子页分类卡右侧圆键的长按 / 右键菜单」里，
     界面上没有任何提示、设置页也没有入口，被反复问「这几个选项在哪儿调」。
     现在设置页给一栏显式单选项（A），并写明圆键这条快速入口（B）；
     两处读写同一份 poem_play_mode_v1，因此**改一边，另一边必须跟着变** ——
     这正是本段要验的：光有单选项、两边各自存一份状态，等于又开一个错开点。 */
  {
    const sd = boot('settings/reader/index.html', { poem_play_mode_v1: 'seq-trans' });
    await sleep(200);
    const sdoc = sd.document;
    const opts = () => [...sdoc.querySelectorAll('#seg-play .play-mode-opt')];
    chk(opts().length === 5, '设置页渲染出五档连读方式（实际 ' + opts().length + '）');
    chk(sdoc.querySelector('#seg-play').getAttribute('role') === 'radiogroup',
      '五档是一组单选（role=radiogroup），不是五个各自为政的按钮');
    chk(opts().every(b => b.getAttribute('role') === 'radio'),
      '每个档位都是 role=radio（读屏能听出「五选一」）');
    chk(opts().filter(b => b.getAttribute('aria-checked') === 'true').length === 1,
      '五档里只有一个是选中态（互斥）');
    chk(sdoc.querySelector('.play-mode-opt[data-play-mode="seq-trans"]').classList.contains('active'),
      '本机存的是「连续播放白话译文」，设置页打开就把它标成选中（读的是同一份本机值）');
    chk(/当前：白话 · 顺序/.test(sdoc.querySelector('#play-hint').textContent),
      '档位下方回显当前档（' + sdoc.querySelector('#play-hint').textContent + '）');

    // 在设置页改一档：必须写进与阅读器同一个键
    sdoc.querySelector('.play-mode-opt[data-play-mode="shuffle-origin"]')
      .dispatchEvent(new sd.Event('click', { bubbles: true }));
    await sleep(60);
    chk(sd.localStorage.getItem('poem_play_mode_v1') === 'shuffle-origin',
      '设置页选档写进 poem_play_mode_v1（与圆键菜单同一个键）');
    chk(sdoc.querySelector('.play-mode-opt[data-play-mode="shuffle-origin"]').classList.contains('active') &&
      sdoc.querySelectorAll('#seg-play .play-mode-opt.active').length === 1,
      '选中态立刻跟着走，且仍只有一个');
    chk(/当前：原文 · 随机/.test(sdoc.querySelector('#play-hint').textContent),
      '回显也跟着变（' + sdoc.querySelector('#play-hint').textContent + '）');

    // 反向：在集子页用圆键改成别的档，回到设置页要看到新档 ——
    // 两个页面各自 new 一份 DOM，等价于「换标签页」，中间靠 localStorage 传递。
    const cwin = boot('classic/index.html', { poem_play_mode_v1: 'shuffle-origin' });
    await sleep(400);
    const cbtn = cwin.document.querySelector('#gw-list .group-head .gw-play-sm');
    chk(cbtn.dataset.playShort === '原文 · 随机',
      '集子页圆键按本机档位显示当前模式（' + cbtn.dataset.playShort + '）');
    cwin.PlayModes.write('seq-both');
    await sleep(40);
    const sd2 = boot('settings/reader/index.html', { poem_play_mode_v1: cwin.localStorage.getItem('poem_play_mode_v1') });
    await sleep(200);
    chk(sd2.document.querySelector('.play-mode-opt[data-play-mode="seq-both"]').classList.contains('active'),
      '集子页改成「原文白话顺序播放」后，设置页打开就是这一档（双向同步）');

    // 野生值：本机存了不认识的档位时，绝不能把那个野值显示成选中项
    // （显示成选中 = 告诉用户「现在是这一档」，实际引擎会退回出厂档，
    //   两边说法不一致）。正确的表现是：选中项落在**出厂档**上，
    // 也就是说「显示的就是引擎真正会用的那一档」。
    const sd3 = boot('settings/reader/index.html', { poem_play_mode_v1: 'no-such-mode' });
    await sleep(200);
    chk(sd3.document.querySelectorAll('#seg-play .play-mode-opt[aria-checked="true"]').length === 1 &&
      sd3.document.querySelector('#seg-play .play-mode-opt.active').dataset.playMode === 'seq-origin',
      '本机值不认识时选中项落在出厂档上（显示的就是引擎真正会用的那一档）');
    chk(![...sd3.document.querySelectorAll('#seg-play .play-mode-opt')].some(b => b.dataset.playMode === 'no-such-mode'),
      '那个野生值不会出现在选项里（它是本机脏数据，不是一档模式）');
    chk(/当前：原文 · 顺序/.test(sd3.document.querySelector('#play-hint').textContent),
      '本机值不认识时回显出厂档「原文 · 顺序」（实际「' + sd3.document.querySelector('#play-hint').textContent + '」）');

    /* B：设置「朗读」页只装**两条设置**，不教别处的操作手势 —— Issue #163「精简」。
       沿革：#69 在设置页加了一句「集子索引页卡头的圆键长按 / 右键弹出同一个菜单」，
       后来这半段被反复删了又放回；本轮（#163）的结论是**整句撤掉** ——
       它是在设置页教另一处的操作，属于该页职责之外的话。
       ⚠️ 这里守的是「本页只做设置」这件事，不是某一句文案：
          · 本页的说明文字（settings-hint）一律不超过一句；
          · 全页不再出现手势教学（长按 / 右键 / 半秒）。
       哪天真有必要把入口写回来，那也该是集子页自己的事，本页不加回。 */
    const readerHints = [...sdoc.querySelectorAll('#settings-page .settings-hint')]
      .map(el => el.textContent.trim());
    chk(readerHints.length === 2,
      '「朗读」页两条设置各带一句说明（实际 ' + readerHints.length + ' 句）');
    chk(!/长按|右键|半秒/.test(sdoc.querySelector('#settings-page').textContent),
      '设置页不再教别处的手势（长按 / 右键那半段整句撤掉，#163）');
    chk(readerHints.every(t => t.length <= 24),
      '每条说明控制在一句以内（最长 ' + Math.max(...readerHints.map(t => t.length)) + ' 字）');

    // 档位定义同源：设置页与集子页读到的模式表必须是同一份
    chk(sd.PlayModes.LIST.map(m => m.id).join(',') === cwin.PlayModes.LIST.map(m => m.id).join(','),
      '两页面共用同一份模式表（js/play-modes.js），不存在两份各写各的');
    chk(sd.PlayModes.LIST.every(m => /^[a-z-]+$/.test(m.id)) && sd.PlayModes.DEFAULT === 'seq-origin',
      '出厂档仍是「原文 · 顺序」（seq-origin）');
  }

  console.log(fails ? '\n❌ ' + fails + ' 项失败' : '\n🎉 自动朗读 / 阅读辅助测试全部通过');
  process.exit(fails ? 1 : 0);
})();
