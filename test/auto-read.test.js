const { JSDOM } = require('jsdom');
const fs = require('fs');
const ROOT = __dirname + '/../';

const URL_OF = {
  'index.html': '/',
  'classic/index.html': '/classic/',
  'settings/index.html': '/settings/',

  'settings/reader/index.html': '/settings/reader/'
};

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

function boot(file, seed, withSpeech) {
  const html = fs.readFileSync(ROOT + file, 'utf8');
  const pageUrl = 'https://local.test' + (URL_OF[file] || '/' + file);
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: pageUrl,
    beforeParse(win) {

      win.scrollTo = function () {};

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

  const toggle = d.querySelector('#rp-toggle');
  ['#rp-prev', '#rp-toggle', '#rp-next', '#rp-stop'].forEach(sel => {
    const b = d.querySelector(sel);
    chk(!!b && !!b.querySelector('svg'), '播放栏 ' + sel + ' 用 SVG 图标');
    chk(!!b && b.textContent.trim() === '', '播放栏 ' + sel + ' 不含文字');
  });
  chk(w.Speech.supported() === true, '语音引擎在跑');

  toggle.dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(30);
  chk(w.Speech.paused() === true, '可以暂停');
  chk(!!d.querySelector('#rp-toggle .pb-play'), '暂停后主按钮换成 ▶ 播放图标（一眼看出能继续）');
  chk(bar.dataset.paused === '1', '播放栏标记为暂停态');
  toggle.dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(30);
  chk(w.Speech.paused() === false, '可以继续');

  d.querySelector('#rp-next').dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(30);
  chk(w.Speech.index() === 1, '「下一篇」跳到第 2 首（index=' + w.Speech.index() + '）');
  chk(d.querySelector('#rp-now').textContent !== nowTitle, '播放栏主信息跟着换成第 2 首');

  d.querySelector('#rp-stop').dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(30);
  chk(bar.hidden === true, '停止后播放栏收起');
  chk(w.speechSynthesis.speaking === false, '停止后语音引擎真的停了（不再有声音）');
  chk(d.querySelector('#today-read').dataset.on === '0', '停止后圆形播放键复位为 ▶');
  chk(d.querySelectorAll('#today-list .item.reading').length === 0, '停止后取消高亮');

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

    const itemRead = d3.querySelector('#today-list .item-read');
    itemRead.dispatchEvent(new w3.Event('click', { bubbles: true }));
    await sleep(30);
    chk(synth.speaking === true, '单首播放时发声');
    itemRead.dispatchEvent(new w3.Event('click', { bubbles: true }));
    await sleep(30);
    chk(synth.speaking === false, '单首再点一次停止，声音消失');
  }

  {
    const w4 = boot('index.html', null, true);
    await sleep(400);
    const d4 = w4.document;

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

  chk(d.querySelector('#modal').hidden === true, '点朗读按钮不会误开诗词弹层');

  const helperPage = boot('settings/reader/index.html', null, false);

  helperPage.document.dispatchEvent(new helperPage.Event('DOMContentLoaded', { bubbles: true }));
  const clickHelper = (v) => {
    [...helperPage.document.querySelectorAll('#seg-helper button')]
      .find(b => b.dataset.helper === v)
      .dispatchEvent(new w.Event('click', { bubbles: true }));
    w.localStorage.setItem('poem_recite_settings_v1', helperPage.localStorage.getItem('poem_recite_settings_v1'));

    w.localStorage.setItem('poem_device_prefs_v1', helperPage.localStorage.getItem('poem_device_prefs_v1'));

    w.PoemApp.reloadSettings();
  };

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

  setMode('all');
  const allN = d.querySelectorAll('#m-text ruby').length;
  chk(allN > rareN, '弹层可手动切「全文注音」（' + allN + ' > ' + rareN + '）');
  setMode('off');
  chk(d.querySelectorAll('#m-text ruby').length === 0, '弹层可手动关掉注音，恢复纯文本');
  d.querySelector('#modal').hidden = true;

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

  const prevBtn = c.querySelector('#rd-prev');
  chk(prevBtn.disabled === true, '第一篇时「上一篇」禁用');

  c.querySelector('#rd-trans-toggle').dispatchEvent(new w2.Event('click', { bubbles: true }));
  await sleep(20);
  c.querySelector('#rd-trans-read').dispatchEvent(new w2.Event('click', { bubbles: true }));
  await sleep(30);
  const ts = w2.speechSynthesis._spoken.text;
  chk(!/人之初/.test(ts), '译文朗读只读译文，不读原文');
  chk(ts.length > 20, '译文朗读内容正常（' + ts.slice(0, 20) + '…）');
  w2.Speech.stop();

  c.querySelector('#gw-random-read').dispatchEvent(new w2.Event('click', { bubbles: true }));
  await sleep(60);
  chk(c.querySelector('#reader-player').hidden === false, '随机连读弹出播放栏');
  chk(c.querySelector('#rp-now').textContent.length > 0, '播放栏显示当前连读的篇名：' + c.querySelector('#rp-now').textContent);
  chk(c.querySelector('#gw-reader').hidden === false, '随机连读会自动打开阅读器');
  const firstId = c.querySelector('#rd-title').textContent;

  w2.speechSynthesis._spoken.onend && w2.speechSynthesis._spoken.onend();
  await sleep(60);
  chk(c.querySelector('#rd-title').textContent !== firstId, '读完自动跳到下一篇（' + firstId + ' → ' + c.querySelector('#rd-title').textContent + '）');
  w2.Speech.stop();
  w2.ClassicProse.onSpeechStopped();
  await sleep(80);
  chk(c.querySelector('#gw-random-read').dataset.on === '0', '停止后随机连读圆键复位');
  chk(c.querySelector('#gw-random-read').getAttribute('aria-pressed') === 'false',
    '圆键的 aria-pressed 同步复位为 false');

  c.querySelector('#gw-random-read').dispatchEvent(new w2.Event('click', { bubbles: true }));
  await sleep(60);
  chk(c.querySelector('#gw-random-read').dataset.on === '1', '连读中圆键进入高亮态（data-on=1）');
  chk(c.querySelector('#gw-random-read').getAttribute('aria-pressed') === 'true',
    '连读中 aria-pressed 为 true（读屏也知道正在连读）');
  w2.Speech.stop();
  w2.ClassicProse.onSpeechStopped();
  await sleep(80);
  chk(c.querySelector('#gw-random-read').dataset.on === '0', '停止后圆键回到 ▶');

  const gBtn = c.querySelector('#gw-list .group-head .gw-play-sm');
  const gName = gBtn.dataset.randomGroup;
  gBtn.dispatchEvent(new w2.Event('click', { bubbles: true }));
  await sleep(60);
  chk(c.querySelector('#reader-player').hidden === false,
    '点分组圆键弹出播放栏（「' + gName + '」组内连读启动了）');
  chk(c.querySelector('#rp-now').textContent.length > 0,
    '播放栏显示当前连读的篇名：' + c.querySelector('#rp-now').textContent);

  const inGroup = (c.querySelector('#rd-meta').textContent || '').length > 0;
  chk(inGroup, '组内连读打开的是本组的一篇（' + c.querySelector('#rd-title').textContent + '）');
  w2.Speech.stop();
  w2.ClassicProse.onSpeechStopped();
  await sleep(80);

  const modeBtn = () => c.querySelector('#gw-list .group-head .gw-play-sm');

  const longPress = async () => {
    const press = new w2.Event('pointerdown', { bubbles: true });
    press.clientX = 10; press.clientY = 10;
    modeBtn().dispatchEvent(press);
    await sleep(560);
  };

  const pickMode = async (id) => {
    await longPress();
    modeBtn().querySelector('.gw-menu-item[data-mode="' + id + '"]')
      .dispatchEvent(new w2.Event('click', { bubbles: true }));
    await sleep(60);
  };
  const stopAll = async () => { w2.Speech.stop(); w2.ClassicProse.onSpeechStopped(); await sleep(60); };

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

  await pickMode('seq-both');
  const bothText = w2.speechSynthesis._spoken.text;
  chk(/人之初/.test(bothText) && bothText.length > 40,
    '「原文 + 白话」把一篇的原文与译文接在一起读（' + bothText.length + ' 字）');
  await stopAll();

  await pickMode('shuffle-origin');
  chk(c.querySelector('#reader-player').hidden === false, '随机模式同样能起播');
  chk(/随机/.test(c.querySelector('#rp-mode').textContent),
    '播放栏报出随机模式：' + c.querySelector('#rp-mode').textContent);
  await stopAll();

  await longPress();
  chk(modeBtn().querySelector('.gw-menu-item[data-mode="shuffle-origin"]').getAttribute('aria-checked') === 'true',
    '菜单里把「随机播放原文」标成当前选中项');
  chk(modeBtn().querySelectorAll('.gw-menu-item[aria-checked="true"]').length === 1,
    '五个模式里只有一个是选中态（互斥）');

  chk(modeBtn().dataset.menu === '1' && c.querySelector('#rp-mode').textContent.length > 0,
    '长按只弹菜单、不打断已停的那一轮（挑模式与开听是两件事）');

  c.querySelector('#gw-search').dispatchEvent(new w2.Event('click', { bubbles: true }));
  await sleep(20);
  chk(modeBtn().querySelector('.gw-menu').hidden === true, '点别处收起菜单');
  await stopAll();
  chk(w2.localStorage.getItem('poem_play_mode_v1') === 'shuffle-origin',
    '模式写进本机（poem_play_mode_v1），下次打开还是它');
  await pickMode('seq-origin');
  chk(w2.localStorage.getItem('poem_play_mode_v1') === 'seq-origin', '改回「连续播放原文」也持久化');
  await stopAll();

  const rowMain = c.querySelector('#rd-actions-main');
  const rowIcons = c.querySelector('#rd-actions-icons');
  chk(!!rowMain && rowMain.children.length === 3, '上一行：对齐 / 字号 / 注音 三组按钮都在');
  chk(!!c.querySelector('#rd-font-down') && !!c.querySelector('#rd-font-up'),
    'A－ / A＋ 字号按钮还在（此前被合并丢掉）');
  chk(!!c.querySelector('#rd-align-seg'), '正文对齐组合按钮在');
  chk(!!rowIcons && rowIcons.children.length === 6,
    '下一行：正文朗读键 / 译文开关 / 加入今日背诵 / 报告错误 / 加入背诵 / 标记已读 六组都在（实际 ' +
    (rowIcons ? rowIcons.children.length : 0) + '）');

  chk(c.querySelector('#rd-read-combo') === null, '不再有「原文 / 译文」并排的组合键');
  chk(c.querySelectorAll('#rd-actions-icons #rd-read-btn').length === 1 &&
    c.querySelectorAll('#rd-actions-icons #rd-trans-read').length === 0,
    '工具条上只有正文一颗播放键');
  chk(!!c.querySelector('#rd-read-btn .play-glyph') && !!c.querySelector('#rd-read-btn .pause-glyph'),
    '▶ 与 ⏸ 在同一颗键上互斥切换');
  chk(!!c.querySelector('#rd-trans #rd-trans-read'), '译文朗读键在译文框里（展开才出现）');

  w2.Speech.stop();
  c.querySelector('#gw-reader > .topbar #top-act').dispatchEvent(new w2.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(20);
  c.querySelector('#gw-list .item').dispatchEvent(new w2.Event('click', { bubbles: true }));
  await sleep(30);
  chk(c.querySelector('#rd-title').textContent === '人之初', '回到第一篇「人之初」再验证组合键');

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

  c.querySelector('#rd-align-seg button[data-align="left"]').dispatchEvent(new w2.Event('click', { bubbles: true }));
  await sleep(20);
  chk(c.querySelector('#rd-text').dataset.align === 'left', '点左对齐生效');
  c.querySelector('#rd-align-seg button[data-align="center"]').dispatchEvent(new w2.Event('click', { bubbles: true }));
  await sleep(20);
  chk(c.querySelector('#rd-text').dataset.align === 'center', '点居中对齐生效');

  const w3 = boot('index.html', {
    poem_recite_settings_v1: JSON.stringify({ grade: 1, term: 1, dailyCount: 5, scope: 'term', helper: 'off' })
  });
  await sleep(300);
  const d3 = w3.document;
  const openPoemIn = (dd, i) => dd.querySelectorAll('#today-list .item')[i]
    .dispatchEvent(new w3.Event('click', { bubbles: true }));
  openPoemIn(d3, 3);
  await sleep(40);
  chk(d3.querySelectorAll('#m-text ruby').length === 0,
    '阅读辅助=关闭 → 打开诗词为纯文本（总开关权威）');
  d3.querySelector('#modal').hidden = true;

  openPoemIn(d3, 3);
  await sleep(20);
  d3.querySelector('#m-pinyin-seg button[data-mode="rare"]')
    .dispatchEvent(new w3.Event('click', { bubbles: true }));
  await sleep(20);
  chk(d3.querySelectorAll('#m-text ruby').length > 0, '手动选「生字」后立刻出现拼音');
  chk(JSON.parse(w3.localStorage.getItem('poem_recite_settings_v1')).helper === 'on',
    '手动选「生字」会同步把「阅读辅助」打开（两处状态一致）');

  const helperPage3 = boot('settings/reader/index.html', {
    poem_recite_settings_v1: w3.localStorage.getItem('poem_recite_settings_v1'),
    poem_device_prefs_v1: w3.localStorage.getItem('poem_device_prefs_v1')
  });
  helperPage3.document.dispatchEvent(new helperPage3.Event('DOMContentLoaded', { bubbles: true }));
  await sleep(60);
  chk(helperPage3.document.querySelector('#seg-helper button[data-helper="on"]').classList.contains('active'),
    '设置页里的开关 UI 同步为「开启」');
  d3.querySelector('#modal').hidden = true;

  [...helperPage3.document.querySelectorAll('#seg-helper button')].find(b => b.dataset.helper === 'off')
    .dispatchEvent(new helperPage3.Event('click', { bubbles: true }));
  w3.localStorage.setItem('poem_recite_settings_v1', helperPage3.localStorage.getItem('poem_recite_settings_v1'));

  w3.localStorage.setItem('poem_device_prefs_v1', helperPage3.localStorage.getItem('poem_device_prefs_v1'));
  w3.PoemApp.reloadSettings();
  openPoemIn(d3, 3);
  await sleep(40);
  chk(d3.querySelectorAll('#m-text ruby').length === 0, '设置里关掉后打开诗词恢复纯文本');
  d3.querySelector('#modal').hidden = true;

  const w4 = boot('classic/index.html', {
    poem_recite_settings_v1: JSON.stringify({ grade: 1, term: 1, dailyCount: 5, scope: 'term', helper: 'off' }),
    poem_helper_pinyin_v1: 'all'
  });
  await sleep(300);
  const c4 = w4.document;
  c4.querySelector('#gw-list .item').dispatchEvent(new w4.Event('click', { bubbles: true }));
  await sleep(40);
  chk(c4.querySelectorAll('#rd-text ruby').length === 0,
    '总开关关闭时，小古文即使残留「全文注音」档位也不注音（总开关权威）');

  w4.localStorage.setItem('poem_recite_settings_v1',
    JSON.stringify({ grade: 1, term: 1, dailyCount: 5, scope: 'term', helper: 'on' }));
  w4.dispatchEvent(new w4.StorageEvent('storage', { key: 'poem_recite_settings_v1' }));
  await sleep(40);
  chk(c4.querySelectorAll('#rd-text ruby').length > 0, '总开关打开后小古文立即出现注音');

  c4.querySelector('#rd-pinyin-seg button[data-mode="off"]')
    .dispatchEvent(new w4.Event('click', { bubbles: true }));
  await sleep(30);
  chk(JSON.parse(w4.localStorage.getItem('poem_recite_settings_v1')).helper === 'off',
    '阅读器里选「不注音」会同步关掉「阅读辅助」（两处状态一致）');

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

    const itemBtn = d5.querySelector('#gw-list .item-read');
    itemBtn.dispatchEvent(new w5.Event('click', { bubbles: true }));
    await sleep(20);
    w5.Speech.pause();
    w5.speechSynthesis.speaking = false;
    log.length = 0;
    itemBtn.dispatchEvent(new w5.Event('click', { bubbles: true }));
    await sleep(20);
    chk(log.length === 0 && w5.Speech.active() === false, '列表播放键在暂停中再点 = 停止');

    d5.querySelector('#rd-read-btn').dispatchEvent(new w5.Event('click', { bubbles: true }));
    await sleep(30);
    let spoken = String(w5.speechSynthesis._spoken.text);
    chk(spoken.indexOf('人之初') === 0, '正在读译文时点正文键会切去读正文（实际 ' + spoken.slice(0, 12) + '…）');
    chk(d5.querySelector('#rd-read-btn').dataset.on === '1' && transBtn.dataset.on === '0',
      '切到正文后只有正文键是 ⏸，译文键复位');

    log.length = 0;
    d5.querySelector('#rd-read-btn').dispatchEvent(new w5.Event('click', { bubbles: true }));
    await sleep(30);
    chk(log.length === 0, '再点正文键 = 停下，不叠一层朗读');
  }

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

    chk(!sdoc.querySelector('#play-hint'),
      '档位下方不再回显「当前：…」那一行（选中态由 .active / aria-checked 表达）');

    sdoc.querySelector('.play-mode-opt[data-play-mode="shuffle-origin"]')
      .dispatchEvent(new sd.Event('click', { bubbles: true }));
    await sleep(60);
    chk(sd.localStorage.getItem('poem_play_mode_v1') === 'shuffle-origin',
      '设置页选档写进 poem_play_mode_v1（与圆键菜单同一个键）');
    chk(sdoc.querySelector('.play-mode-opt[data-play-mode="shuffle-origin"]').classList.contains('active') &&
      sdoc.querySelectorAll('#seg-play .play-mode-opt.active').length === 1,
      '选中态立刻跟着走，且仍只有一个');
    chk(!sdoc.querySelector('#play-hint'), '改档之后那一行也不会冒出来（它已经整行撤掉）');

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

    const sd3 = boot('settings/reader/index.html', { poem_play_mode_v1: 'no-such-mode' });
    await sleep(200);
    chk(sd3.document.querySelectorAll('#seg-play .play-mode-opt[aria-checked="true"]').length === 1 &&
      sd3.document.querySelector('#seg-play .play-mode-opt.active').dataset.playMode === 'seq-origin',
      '本机值不认识时选中项落在出厂档上（显示的就是引擎真正会用的那一档）');
    chk(![...sd3.document.querySelectorAll('#seg-play .play-mode-opt')].some(b => b.dataset.playMode === 'no-such-mode'),
      '那个野生值不会出现在选项里（它是本机脏数据，不是一档模式）');
    chk(!sd3.document.querySelector('#play-hint'),
      '本机值不认识时也没有那一行 —— 出厂档只由「选中项落在 seq-origin 上」表达');

    const readerHints = [...sdoc.querySelectorAll('#settings-page .settings-hint')]
      .map(el => el.textContent.trim());
    chk(readerHints.length <= 2,
      '「朗读」页的说明行不超过两条（实际 ' + readerHints.length + ' 句）');
    chk(!/长按|右键|半秒/.test(sdoc.querySelector('#settings-page').textContent),
      '设置页不再教别处的手势（长按 / 右键那半段整句撤掉，#163）');
    chk(readerHints.every(t => t.length <= 24),
      '每条说明控制在一句以内（最长 ' + (readerHints.length ? Math.max(...readerHints.map(t => t.length)) : 0) + ' 字）');

    chk(sd.PlayModes.LIST.map(m => m.id).join(',') === cwin.PlayModes.LIST.map(m => m.id).join(','),
      '两页面共用同一份模式表（js/play-modes.js），不存在两份各写各的');
    chk(sd.PlayModes.LIST.every(m => /^[a-z-]+$/.test(m.id)) && sd.PlayModes.DEFAULT === 'seq-origin',
      '出厂档仍是「原文 · 顺序」（seq-origin）');
  }

  console.log(fails ? '\n❌ ' + fails + ' 项失败' : '\n🎉 自动朗读 / 阅读辅助测试全部通过');
  process.exit(fails ? 1 : 0);
})();
