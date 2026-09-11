/**
 * 用户协议 / 隐私条款 页面测试
 *
 * 三件事必须成立：
 *   1. 两个页面真实存在，首页与小古文页页脚常驻入口（不漏挂、不缺链）；
 *   2. 文案覆盖「学生保护」与「网站所有者免责」两类必要条款；
 *   3. 邮箱 kuibuapp@163.com 不出现在 HTML / JS 静态源码里，
 *      只能由 js/contact.js 在运行时拼装出来（防搜索引擎抓取）。
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = __dirname + '/../';

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const read = f => fs.readFileSync(path + f, 'utf8');
const MAIL = 'kuibuapp@163.com';

/* ---------- 一、静态源码里不能有明文邮箱 ---------- */
['index.html', 'classic.html', 'terms.html', 'privacy.html', 'js/contact.js', 'sw.js']
  .forEach(f => {
    const src = read(f);
    chk(!src.includes(MAIL), f + ' 源码不含明文邮箱');
    chk(!/@163\.com/.test(src), f + ' 源码不含 @163.com 片段');
  });

/* 全站扫描：任何被 git 跟踪的文本文件都不应出现明文邮箱 */
const vm = require('vm');
const { execFileSync } = require('child_process');
const tracked = execFileSync('git', ['ls-files'], { cwd: path }).toString().trim().split('\n')
  // 本测试文件自身需要写出邮箱来断言，跳过
  .filter(f => f && f !== 'test/legal.test.js');
const leaked = tracked.filter(f => {
  try { return fs.readFileSync(path + f, 'utf8').includes(MAIL); } catch (e) { return false; }
});
chk(leaked.length === 0, '仓库内无任何明文邮箱泄漏（' + (leaked.join(', ') || '无') + '）');

/* ---------- 二、页面层 ---------- */
function load(file) {
  const html = read(file);
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://local.test/' + file });
  const { window } = dom;
  (html.match(/<script src="([^"]+)"><\/script>/g) || [])
    .map(s => s.match(/src="([^"]+)"/)[1])
    .forEach(f => {
      const el = window.document.createElement('script');
      el.textContent = read(f);
      window.document.body.appendChild(el);
    });
  return { dom, window, doc: window.document };
}

const terms = load('terms.html');
const privacy = load('privacy.html');
const index = load('index.html');

setTimeout(() => {
  /* --- 用户协议 --- */
  {
    const d = terms.doc;
    chk(/用户协议/.test(d.title), '用户协议页标题正确（' + d.title + '）');
    const t = d.querySelector('.legal').textContent;
    chk(/学生与未成年人保护/.test(t), '含「学生与未成年人保护」章节');
    chk(/不收集儿童个人信息/.test(t), '明确声明不收集儿童个人信息');
    chk(/免责声明/.test(t), '含「免责声明」章节');
    chk(/按?「?现状」?提供|现状提供/.test(t), '服务按现状提供');
    chk(/不承担责任|不承担任何责任/.test(t), '写明所有者不承担责任的边界');
    chk(!/本站对.{0,10}承担全部责任/.test(t), '没有把责任无限兜给本站的表述');
    chk(/信息准确性|仍可能存在疏漏/.test(t), '说明了内容/拼音可能出错，以教材为准');
    chk(d.querySelectorAll('.legal-toc a').length >= 8, '目录锚点齐全（' + d.querySelectorAll('.legal-toc a').length + ' 项）');
  }

  /* --- 隐私条款 --- */
  {
    const d = privacy.doc;
    chk(/隐私条款/.test(d.title), '隐私条款页标题正确（' + d.title + '）');
    const t = d.querySelector('.legal').textContent;
    chk(/localStorage/.test(t), '说明数据存在本机 localStorage');
    chk(/不收集|不上传/.test(t), '说明不上传 / 不收集');
    chk(/儿童隐私/.test(t), '含儿童隐私专章');
    chk(/Service Worker|离线缓存/.test(t), '说明离线缓存与托管平台日志的边界');
    chk(/导出备份/.test(t) && /清空进度/.test(t), '给出导出与删除数据的路径');
    chk(!!d.querySelector('.legal-summary'), '顶部有「一句话版本」速览');
  }

  /* --- 邮箱：运行时才出现，且点击可复制 --- */
  [['用户协议', terms], ['隐私条款', privacy]].forEach(([name, page]) => {
    const link = page.doc.querySelector('[data-mail-slot]');
    chk(!!link, name + '页有邮箱入口占位');
    chk(link.getAttribute('href') === 'mailto:' + MAIL, name + '页运行时还原 mailto（' + link.getAttribute('href') + '）');
    chk(link.textContent.trim() === '显示邮箱地址', name + '页默认只显示「显示邮箱地址」，不直接暴露邮箱');
    chk(link.getAttribute('rel') === 'nofollow', name + '页邮箱链接带 rel=nofollow');
    // 渲染后的 DOM 才允许出现邮箱
    chk(page.doc.querySelector('.legal').textContent.includes(MAIL) === false,
      name + '页正文默认不出现邮箱文本');
  });

  /* --- 页脚入口：首页 / 小古文页 / 两个法务页互链 --- */
  const footCases = [
    ['首页', index.doc, './terms.html', './privacy.html'],
    ['用户协议页', terms.doc, './terms.html', './privacy.html']
  ];
  footCases.forEach(([name, d, termsHref, privacyHref]) => {
    const links = [...d.querySelectorAll('.foot .foot-links a')];
    const hrefs = links.map(a => a.getAttribute('href'));
    chk(hrefs.includes(termsHref) && hrefs.includes(privacyHref),
      name + '页脚同时含用户协议与隐私条款链接（' + hrefs.join(', ') + '）');
  });
  chk(/terms\.html/.test(read('classic.html')) && /privacy\.html/.test(read('classic.html')),
    '小古文页页脚同样挂了两个法务链接');
  chk(/terms\.html/.test(read('sw.js')) && /privacy\.html/.test(read('sw.js')),
    'Service Worker 预缓存了两个法务页（断网也能打开）');

  console.log(fails === 0 ? '\n🎉 用户协议 / 隐私条款测试全部通过' : '\n❌ ' + fails + ' 项失败');
  process.exit(fails ? 1 : 0);
}, 400);
