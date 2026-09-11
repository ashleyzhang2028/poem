/**
 * 自动朗读 / 阅读辅助 / 小古文导航 专项测试
 *
 * 覆盖 Issue #1 的需求：
 *   5. 「阅读辅助」开关必须有可见差别（开启 → 打开诗词自动注音）
 *   10. 小古文默认字号降一级，A－ 可再降两级
 *   12. 小古文详情页有上一篇 / 下一篇，无需回索引页
 *   13. 白话译文可单独朗读
 *   15. 今日任务可「朗读全部」（标题 + 朝代 + 作者 + 正文），单首也可朗读，
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
  btn.dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(50);
  const spoken = w.speechSynthesis._spoken;
  chk(!!spoken, '点朗读全部后发出语音');
  chk(/咏鹅|江南|画/.test(spoken.text) && spoken.text.includes('。'), '第一条朗读内容含诗题与正文');
  chk(d.querySelector('#reader-player').hidden === false, '弹出自动朗读控制条');
  chk(/正在朗读/.test(d.querySelector('#rp-label').textContent), '控制条显示正在朗读：' + d.querySelector('#rp-label').textContent);
  chk(d.querySelectorAll('#today-list .item.reading').length === 1, '当前朗诵的诗被高亮');
  // 暂停
  d.querySelector('#rp-toggle').dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(30);
  chk(w.Speech.paused() === true, '可以暂停');
  chk(d.querySelector('#rp-toggle').textContent === '继续', '暂停后按钮变「继续」');
  chk(/已暂停/.test(d.querySelector('#rp-label').textContent), '控制条显示已暂停');
  d.querySelector('#rp-toggle').dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(30);
  chk(w.Speech.paused() === false, '可以继续');
  // 下一篇
  d.querySelector('#rp-next').dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(30);
  chk(w.Speech.index() === 1, '「下一篇」跳到第 2 首（index=' + w.Speech.index() + '）');
  // 停止
  d.querySelector('#rp-stop').dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(30);
  chk(d.querySelector('#reader-player').hidden === true, '停止后控制条收起');
  chk(d.querySelectorAll('#today-list .item.reading').length === 0, '停止后取消高亮');

  // 单首朗读
  const one = d.querySelector('#today-list .item-read');
  one.dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(30);
  chk(/咏鹅/.test(w.speechSynthesis._spoken.text), '点单首朗读会读这一首');
  chk(d.querySelectorAll('#today-list .item-read[data-on="1"]').length === 5, '朗读中列表朗读按钮高亮');
  one.dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(30);
  chk(w.speechSynthesis.speaking === false, '再点一次停止单首朗读');
  // 单首朗读不应打开弹层
  chk(d.querySelector('#modal').hidden === true, '点朗读按钮不会误开诗词弹层');

  // ---- 阅读辅助开关的可见差别 ----
  d.querySelector('#btn-settings').dispatchEvent(new w.Event('click', { bubbles: true }));
  const helperOff = [...d.querySelectorAll('#seg-helper button')].find(b => b.dataset.helper === 'off');
  helperOff.dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(20);
  d.querySelector('#settings-modal').hidden = true;
  d.querySelector('#today-list .item').dispatchEvent(new w.Event('click', { bubbles: true }));
  chk(d.querySelectorAll('#m-text ruby').length === 0, '阅读辅助关闭 → 打开诗词是纯文本');
  d.querySelector('#modal').hidden = true;
  d.querySelector('#btn-settings').dispatchEvent(new w.Event('click', { bubbles: true }));
  const helperOn = [...d.querySelectorAll('#seg-helper button')].find(b => b.dataset.helper === 'on');
  helperOn.dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(20);
  d.querySelector('#settings-modal').hidden = true;
  d.querySelector('#today-list .item').dispatchEvent(new w.Event('click', { bubbles: true }));
  chk(d.querySelectorAll('#m-text ruby').length > 5, '阅读辅助开启 → 打开诗词自动注音（开关差别可见）');

  // ---- 小古文：随机连读 / 上一篇下一篇 / 译文朗读 ----
  const w2 = boot('classic.html', null, true);
  await sleep(400);
  const c = w2.document;
  chk(!!c.querySelector('#gw-random-read'), '索引页有「随机连读」');
  chk(!!c.querySelector('#rd-prev') && !!c.querySelector('#rd-next'), '阅读器有上一篇/下一篇');
  c.querySelector('#gw-list .item').dispatchEvent(new w2.Event('click', { bubbles: true }));
  await sleep(20);
  chk(c.querySelector('#rd-read-btn').disabled === false, '有语音环境时「朗读全文」可用');
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
  chk(c.querySelector('#reader-player').hidden === false, '随机连读弹出控制条');
  chk(c.querySelector('#gw-reader').hidden === false, '随机连读会自动打开阅读器');
  const firstId = c.querySelector('#rd-title').textContent;
  // 等第一条读完 → 自动跳下一篇
  w2.speechSynthesis._spoken.onend && w2.speechSynthesis._spoken.onend();
  await sleep(60);
  chk(c.querySelector('#rd-title').textContent !== firstId, '读完自动跳到下一篇（' + firstId + ' → ' + c.querySelector('#rd-title').textContent + '）');
  w2.Speech.stop();
  await sleep(80);
  chk(c.querySelector('#gw-random-read').dataset.on === '0', '停止后随机连读按钮复位');
  chk(c.querySelector('#gw-random-read-text').textContent === '随机连读', '按钮文案回到「随机连读」');

  console.log(fails ? '\n❌ ' + fails + ' 项失败' : '\n🎉 自动朗读 / 阅读辅助测试全部通过');
  process.exit(fails ? 1 : 0);
})();
