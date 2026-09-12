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
 *   10. 小古文默认字号降一级，A－ 可再降两级
 *   12. 小古文详情页有上一篇 / 下一篇，无需回索引页
 *   13. 白话译文可单独朗读
 *   15. 今日任务可连读（标题 + 朝代 + 作者 + 正文），单首也可朗读，
 *       小古文索引页可随机连读、读完自动跳下一篇，全程可暂停 / 停止
 *
 * 运行：node test/auto-read.test.js
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const ROOT = __dirname + '/../';

/** 启动一个页面（可选注入假 SpeechSynthesis / 初始 localStorage） */
function boot(file, seed, withSpeech) {
  const html = fs.readFileSync(ROOT + file, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://local.test/' + file,
    beforeParse(win) {
      // jsdom 没有 window.scrollTo，补一个空实现避免噪音日志
      win.scrollTo = function () {};
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
  if (seed) for (const k in seed) w.localStorage.setItem(k, seed[k]);
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
    const readBtn = d4.querySelector('#m-read-btn');
    chk(!!readBtn.querySelector('svg'), '详情页朗读按钮仍是「小喇叭」图标');
    chk(d4.querySelector('#m-read-text').textContent === '朗读', '详情页朗读按钮仍带「朗读」文字');
    d4.querySelector('#today-list .item').dispatchEvent(new w4.Event('click', { bubbles: true }));
    readBtn.dispatchEvent(new w4.Event('click', { bubbles: true }));
    await sleep(30);
    chk(w4.speechSynthesis.speaking === true, '详情页朗读按钮照常发声');
    chk(d4.querySelector('#m-read-text').textContent === '停止朗读', '朗读中按钮文案为「停止朗读」');
    readBtn.dispatchEvent(new w4.Event('click', { bubbles: true }));
    await sleep(30);
    chk(d4.querySelector('#m-read-text').textContent === '朗读', '再点一次停止并恢复「朗读」');
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
  // 开启（默认「只标生字」）→ 打开诗词自动注音；关闭 → 纯文本，需要时手动切档位
  const clickHelper = (v) => {
    d.querySelector('.dock-item[data-nav-go="settings"]').dispatchEvent(new w.Event('click', { bubbles: true }));
    [...d.querySelectorAll('#seg-helper button')].find(b => b.dataset.helper === v)
      .dispatchEvent(new w.Event('click', { bubbles: true }));
    d.querySelector('#settings-modal').hidden = true;
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
  const w2 = boot('classic.html', null, true);
  await sleep(400);
  const c = w2.document;
  chk(!!c.querySelector('#gw-random-read'), '索引页有「连读」按钮');
  chk(!!c.querySelector('#rd-prev') && !!c.querySelector('#rd-next'), '阅读器有上一篇/下一篇');
  c.querySelector('#gw-list .item').dispatchEvent(new w2.Event('click', { bubbles: true }));
  await sleep(20);
  chk(c.querySelector('#rd-read-btn').disabled === false, '有语音环境时「朗读」可用');
  chk(c.querySelector('#rd-trans-read').disabled === false, '译文朗读按钮可用');
  c.querySelector('#rd-next').dispatchEvent(new w2.Event('click', { bubbles: true }));
  await sleep(20);
  chk(c.querySelector('#gw-progress').textContent.indexOf('第 2') === 0, '下一篇跳到第 2 篇：' + c.querySelector('#gw-progress').textContent);
  c.querySelector('#rd-prev').dispatchEvent(new w2.Event('click', { bubbles: true }));
  await sleep(20);
  chk(c.querySelector('#gw-progress').textContent.indexOf('第 1') === 0, '上一篇回到第 1 篇');
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
  await sleep(80);
  chk(c.querySelector('#gw-random-read').dataset.on === '0', '停止后随机连读按钮复位');
  chk(c.querySelector('#gw-random-read-text').textContent === '连读', '按钮文案回到「连读」');

  /* ---- 回归：阅读辅助工具条不得再丢（曾因合并把整条工具条丢了）---- */
  const rowMain = c.querySelector('#rd-actions-main');
  const rowIcons = c.querySelector('#rd-actions-icons');
  chk(!!rowMain && rowMain.children.length === 3, '上一行：对齐 / 字号 / 注音 三组按钮都在');
  chk(!!c.querySelector('#rd-font-down') && !!c.querySelector('#rd-font-up'),
    'A－ / A＋ 字号按钮还在（此前被合并丢掉）');
  chk(!!c.querySelector('#rd-align-seg'), '正文对齐组合按钮在');
  chk(!!rowIcons && rowIcons.children.length === 3, '下一行：朗读组合键 / 译文开关 / 标记已读 三组都在（实际 ' + (rowIcons ? rowIcons.children.length : 0) + '）');
  chk(!!c.querySelector('#rd-read-combo'), '原文与译文朗读合并成一个组合键（不再两个独立播放键）');
  chk(c.querySelectorAll('#rd-read-combo .combo-seg').length === 2,
    '组合键正好两段：原文 / 译文');
  chk(!!c.querySelector('#rd-trans-read') && !c.querySelector('#rd-trans-read').disabled,
    '组合键右段「译文」在有语音环境时可用');
  // 固定打开第一篇（人之初），避免受「随机连读」停留位置影响
  w2.Speech.stop();
  c.querySelector('#gw-back').dispatchEvent(new w2.Event('click', { bubbles: true }));
  await sleep(20);
  c.querySelector('#gw-list .item').dispatchEvent(new w2.Event('click', { bubbles: true }));
  await sleep(30);
  chk(c.querySelector('#rd-title').textContent === '人之初', '回到第一篇「人之初」再验证组合键');
  // 点右段应只读译文，并把译文框自动展开
  c.querySelector('#rd-trans-read').dispatchEvent(new w2.Event('click', { bubbles: true }));
  await sleep(30);
  chk(!/人之初/.test(w2.speechSynthesis._spoken.text), '点「译文」只读译文，不读原文');
  chk(c.querySelector('#rd-trans').hidden === false, '点「译文」会自动展开译文框');
  chk(c.querySelector('#rd-trans-read').dataset.on === '1' && c.querySelector('#rd-read-btn').dataset.on === '0',
    '正在读译文 → 只有右段点亮');
  w2.Speech.stop();
  await sleep(30);
  c.querySelector('#rd-read-btn').dispatchEvent(new w2.Event('click', { bubbles: true }));
  await sleep(30);
  chk(/人之初/.test(w2.speechSynthesis._spoken.text), '点「原文」读的是原文');
  chk(c.querySelector('#rd-read-btn').dataset.on === '1' && c.querySelector('#rd-trans-read').dataset.on === '0',
    '正在读原文 → 只有左段点亮');
  w2.Speech.stop();
  await sleep(30);
  chk(!c.querySelector('#rd-trans .trans-read'), '译文区里不再重复放朗读按钮');
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
  chk(d3.querySelector('#seg-helper button[data-helper="on"]').classList.contains('active'),
    '设置面板里的开关 UI 同步为「开启」');
  d3.querySelector('#modal').hidden = true;
  // 反向：设置里关掉 → 弹层应为纯文本
  d3.querySelector('.dock-item[data-nav-go="settings"]').dispatchEvent(new w3.Event('click', { bubbles: true }));
  [...d3.querySelectorAll('#seg-helper button')].find(b => b.dataset.helper === 'off')
    .dispatchEvent(new w3.Event('click', { bubbles: true }));
  d3.querySelector('#settings-modal').hidden = true;
  openPoemIn(d3, 3);
  await sleep(40);
  chk(d3.querySelectorAll('#m-text ruby').length === 0, '设置里关掉后打开诗词恢复纯文本');
  d3.querySelector('#modal').hidden = true;

  // 场景 2：小古文页的注音也要受总开关约束（修复前 init 只看一次 PinyinKey 是否为 null）
  const w4 = boot('classic.html', {
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

  console.log(fails ? '\n❌ ' + fails + ' 项失败' : '\n🎉 自动朗读 / 阅读辅助测试全部通过');
  process.exit(fails ? 1 : 0);
})();
