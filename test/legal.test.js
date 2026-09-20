const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = __dirname + '/../';

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const read = f => fs.readFileSync(path + f, 'utf8');
const MAIL = 'kuibuapp@163.com';

// 「关于」里那几个入口是一行一条 kvRow(link(href, 文案), '')，直接看源码里有没有这行。
const kvLinkHref = (src, href) =>
  new RegExp('kvRow\\(link\\(\\s*"' + href.replace(/\//g, '\\/') + '"').test(src);

['index.html', 'classic/index.html', 'settings/index.html', 'settings/general/index.html',
 'settings/recite/index.html', 'settings/lists/index.html', 'settings/reader/index.html',
 'terms/index.html', 'privacy/index.html', 'js/contact.js', 'js/chrome.js', 'js/settings-nav.js', 'js/settings.js', 'sw.js']
  .forEach(f => {
    const src = read(f);
    chk(!src.includes(MAIL), f + ' 源码不含明文邮箱');
    chk(!/@163\.com/.test(src), f + ' 源码不含 @163.com 片段');
  });

const vm = require('vm');
const { execFileSync } = require('child_process');
const tracked = execFileSync('git', ['ls-files'], { cwd: path }).toString().trim().split('\n')

  .filter(f => f && f !== 'test/legal.test.js');
const leaked = tracked.filter(f => {
  try { return fs.readFileSync(path + f, 'utf8').includes(MAIL); } catch (e) { return false; }
});
chk(leaked.length === 0, '仓库内无任何明文邮箱泄漏（' + (leaked.join(', ') || '无') + '）');

function load(file, urlPath) {
  const html = read(file);
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://local.test/' + (urlPath || file) });
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

const terms = load('terms/index.html', 'terms/');
const privacy = load('privacy/index.html', 'privacy/');
const index = load('index.html');

const settingsPages = ['settings/index.html', 'settings/general/index.html',
  'settings/recite/index.html', 'settings/lists/index.html', 'settings/reader/index.html']
  .map(f => Object.assign({ f: f }, load(f, f.replace(/index\.html$/, ''))));

setTimeout(() => {

  {
    const d = terms.doc;
    chk(/用户协议/.test(d.title), '用户协议页标题正确（' + d.title + '）');
    const t = d.querySelector('.legal').textContent;
    chk(/学生与未成年人/.test(t), '含「学生与未成年人」章节');
    chk(/不收集儿童个人信息/.test(t), '明确声明不收集儿童个人信息');
    chk(/免责与变更/.test(t), '含「免责与变更」章节');
    chk(/按?「?现状」?提供|现状提供/.test(t), '服务按现状提供');
    chk(/不承担责任|不承担任何责任/.test(t), '写明所有者不承担责任的边界');
    chk(!/本站对.{0,10}承担全部责任/.test(t), '没有把责任无限兜给本站的表述');
    chk(/仍可能有疏漏|仍可能存在疏漏/.test(t) && /以孩子学校所用教材/.test(t),
      '说明了内容/拼音可能出错，以教材为准');

    chk(/设备系统自带|系统自带/.test(t), '朗读说明写明由设备系统自带的语音合成完成');
    chk(/音色/.test(t) && /断句/.test(t), '朗读说明写明音色与断句由系统决定');
    chk(/不(存储|保存)(任何)?音频文件/.test(t), '明确声明不存储任何音频文件');
    chk(/多音字/.test(t) && /（难免|可能|难免会）读错/.test(t),
      '多音字朗读可能读错有明示（机器朗读难免读错）');
    chk(/机器朗读/.test(t) && /仅作参考/.test(t), '机器朗读结果声明仅作参考');
    chk(/以语文教材|教材/.test(t) && /老师/.test(t), '读音以教材与老师所教为准');
    chk(!/绝对正确|保证读|不会读错/.test(t), '没有「朗读绝对正确」这类过度承诺');
    chk(d.querySelectorAll('.legal-toc a').length >= 4, '目录锚点齐全（' + d.querySelectorAll('.legal-toc a').length + ' 项）');

    chk(/账号/.test(t) && /注销/.test(t), '协议写明了账号与注销');
    chk(/不删(本机)?(背诵)?进度|都不会删掉背诵进度/.test(t),
      '写明退出/注销不删本机背诵进度（进度与账号是两回事）');

    chk(/注销[^。]{0,40}(删除|一起删)/.test(t) && /导给你|导出/.test(t),
      '写明注销会删除服务器上的数据、并把云端那一份导出给用户');
    chk(/不是付费凭据/.test(t), '写明本机层级**不是付费凭据**（不许让它看起来像收费凭据）');
    chk(/不收款|无支付入口|没有任何支付入口/.test(t), '写明本应用不收款、无支付入口');

    chk(t.length < 1700, '用户协议精简到一屏可读完（' + t.length + ' 字）');

    chk(d.querySelector('.legal-summary') === null, '顶部已移除「一句话版本」速览块');

    chk(d.querySelector('.legal-foot') === null, '用户协议页已移除「相关文件」行');

    chk(!/或权利主张/.test(t), '用户协议页不再出现「或权利主张」');
    chk(/疑问、纠错，欢迎发邮件/.test(t), '保留「疑问、纠错，欢迎发邮件」');

    const up = d.querySelector('#terms-updated');
    chk(!!up, '用户协议页有更新时间元素');
    chk(/^2026 年 \d{1,2} 月 \d{1,2} 日$/.test(up.textContent.trim()),
      '更新时间精确到月日：' + up.textContent.trim());
    chk(/^\d{4}-\d{2}-\d{2}$/.test(up.getAttribute('datetime')),
      '<time datetime> 为机器可读的完整日期：' + up.getAttribute('datetime'));
    chk(!/更新于 2026 年$/.test(d.querySelector('.brand-sub').textContent),
      '页首不再只写「更新于 2026 年」');

    chk(!/访问统计|匿名访问|匿名编号/.test(t), '用户协议不再出现访问统计相关描述');

    chk(/不注册也能使用|不注册即可使用|无需注册/.test(t), '用户协议写明「不注册也能使用」');

    chk(/默认只存本机/.test(t), '用户协议如实写明「进度默认只存本机」');
    chk(/开启云端同步|云端同步开启|保持云端同步开启/.test(t),
      '用户协议如实写明「开启云端同步时才上传」（不许笼统写「不上传」）');
    chk(/关掉|关闭/.test(t), '用户协议写明云端同步可以关掉（用户有权拒绝上传）');
    chk(!/不上传、不云同步/.test(t),
      '用户协议不再出现「不上传、不云同步」（代码已经不这么做了）');
    chk(d.title === '跬步 · 用户协议', '用户协议页标题为「跬步 · 用户协议」（实际 ' + d.title + '）');
  }

  {
    const d = privacy.doc;
    chk(/隐私条款/.test(d.title), '隐私条款页标题正确（' + d.title + '）');
    const t = d.querySelector('.legal').textContent;
    chk(/localStorage/.test(t), '说明数据存在本机 localStorage');

    chk(!/不上传、不云同步/.test(t), '不再出现「不上传、不云同步」（代码已经不这么做）');
    chk(!/无服务器/.test(t) && !/没有任何服务端/.test(t),
      '不再出现「无服务器」（代码已经有服务端了）');
    chk(/默认|本机/.test(t) && /云端同步/.test(t),
      '如实写明「默认只存本机 + 开关云端同步」这层结构');
    chk(/关掉|关闭/.test(t), '写明云端同步可以关掉');
    chk(/注销即删除/.test(t), '写明注销即删除服务器上的数据');
    chk(/Supabase/.test(t) && /Resend/.test(t),
      '列明实际的数据处理者（数据库与发信服务）');

    chk(!/SendGrid/.test(t),
      '条款里不再出现 SendGrid（已停用，写了就是假的第三方处理者）');
    chk(!/出境|跨境|数据跨境/.test(t), '全篇不出现「出境 / 跨境」字样（本站不以国内限定为前提）');

    chk(/不注册也能用|无需注册/.test(t), '如实写明「不注册也能用」');
    chk(/账号/.test(t), '如实写明「可选建账号」');

    chk(/邮箱/.test(t) && /保存到服务器/.test(t),
      '如实写明「邮箱会保存到服务器」（Issue #197 起明文确实落库）');
    chk(!/明文不离开设备/.test(t),
      '不再写「明文不离开设备」（那句在 Issue #197 之后已经不成立）');
    chk(/不会保存明文/.test(t) && /摘要/.test(t),
      '如实写明「密码不会保存明文，只存单向摘要」');
    chk(/确认邮件/.test(t), '如实写明注册后的确认邮件这一步');
    chk(/全部退出/.test(t), '如实写明「改完密码，其它设备上的登录会全部退出」');
    chk(/邮箱/.test(t) && /本机/.test(t), '邮箱的收集范围与存放位置写清楚');
    chk(!/不需要注册，不收集手机号、邮箱/.test(t), '不再宣称「不收集邮箱」（已不准确）');
    chk(/儿童隐私/.test(t), '含儿童隐私专章');
    chk(!/已(经)?(接入|部署)服务器|云同步已(上线|可用)/.test(t),
      '条款不含尚未实现的说法（文案不许跑在代码前面）');
    chk(/Service Worker|离线缓存/.test(t), '说明离线缓存与托管平台日志的边界');
    chk(/导出备份/.test(t) && /清空进度/.test(t), '给出导出与删除数据的路径');

    chk(/朗读/.test(t) && /设备系统自带|系统自带/.test(t), '朗读说明写明系统自带语音合成');
    chk(/不(会)?(存储|保存)[^；。]{0,6}音频文件/.test(t), '明确不保存任何音频文件');
    chk(d.querySelector('.legal-summary') === null, '顶部已移除「一句话版本」速览块');
    chk(d.querySelector('.legal-foot') === null, '隐私条款页已移除「相关文件」行');
    chk(!/相关文件/.test(t), '隐私条款页正文不再出现「相关文件」');

    chk(t.length < 2400, '隐私条款精简到可读完的一屏多一点（' + t.length + ' 字）');

    chk(/层级|名额/.test(t), '隐私条款提到了层级/名额（新增了订阅层级这件事）');
    chk(/服务器/.test(t) && !/层级[^。]{0,60}只存在本机/.test(t),
      '层级的存放位置如实写（建账号后由服务器下发，不再宣称「只在本机」）');
    chk(/没有任何收款能力|不收款|没有任何支付/.test(t),
      '写明目前没有任何收款能力（免得层级被当成「已经能买」）');

    const up = d.querySelector('#privacy-updated');
    chk(!!up && /^2026 年 \d{1,2} 月 \d{1,2} 日$/.test(up.textContent.trim()),
      '隐私条款更新精确到月日：' + (up ? up.textContent.trim() : '缺失'));
    chk(!!up && /^\d{4}-\d{2}-\d{2}$/.test(up.getAttribute('datetime')),
      '隐私条款 <time datetime> 完整');

    chk(!/访问统计|匿名访问|匿名编号|统计存放/.test(t), '隐私条款不再出现访问统计相关描述');
    chk(/无统计脚本/.test(t), '明确声明无统计脚本');
    chk(d.title === '跬步 · 隐私条款', '隐私条款页标题为「跬步 · 隐私条款」（实际 ' + d.title + '）');
  }

  [['用户协议', terms], ['隐私条款', privacy]].forEach(([name, page]) => {
    const link = page.doc.querySelector('[data-mail-slot]');
    chk(!!link, name + '页有邮箱入口占位');
    chk(link.getAttribute('href') === 'mailto:' + MAIL, name + '页运行时还原 mailto（' + link.getAttribute('href') + '）');
    chk(link.textContent.trim() === '显示邮箱地址', name + '页默认只显示「显示邮箱地址」，不直接暴露邮箱');
    chk(link.getAttribute('rel') === 'nofollow', name + '页邮箱链接带 rel=nofollow');

    chk(page.doc.querySelector('.legal').textContent.includes(MAIL) === false,
      name + '页正文默认不出现邮箱文本');
  });

  // 页底整块（©2026 kuibu.app + 用户协议 · 隐私条款）已全站删除：
  // 这是个装在手机上的应用，不是网页 —— 法务入口只在设置「关于」里留一份。
  const noFootPages = [...new Set(['index.html', 'terms/index.html', 'privacy/index.html',
    'login/index.html', 'mine/index.html', 'admin/index.html',
    'plans/index.html', 'self-check/index.html', 'reset/index.html', 'verify/index.html']
    .concat(settingsPages.map(sp => sp.f)))];
  noFootPages.forEach(f => {
    chk(!/class="foot/.test(read(f)), f + ' 没有页底页脚（版权 + 法务链接整块已删）');
  });
  chk(!index.doc.querySelector('.foot'), '首页不挂页脚');
  chk(!terms.doc.querySelector('.foot') && !privacy.doc.querySelector('.foot'),
    '法务两页也不挂页脚（正文读完即止）');

  {
    // 法务入口没有消失，只是收敛：设置「关于」里各留一行。
    const nav = read('js/settings-nav.js');
    chk(kvLinkHref(nav, '/terms/') && kvLinkHref(nav, '/privacy/'),
      '设置「关于」里仍保留用户协议与隐私条款两个入口');
    chk(!/kuibu\.app/.test(nav.slice(nav.indexOf('renderAbout'), nav.indexOf('function kvRow'))),
      '「关于」里不再重复印一行 ©2026 kuibu.app（版权文案随页脚一起删）');
  }

  {

    const code = read('js/chrome.js')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    chk(!/["'`]\.?\/([\w-]+\.html)["'`]/.test(code),
      '导航脚本里不再出现页面 .html 地址（目录化路由）');
    chk(/"\/classic\/"/.test(read('js/chrome.js')) && /"\/settings\/"/.test(read('js/chrome.js')) &&
      /start_url/.test('start_url') && /"start_url": "\.\/"/.test(read('manifest.webmanifest')),
      '页签地址与 PWA start_url 均为目录化路径');
  }

  chk(!/class="foot/.test(read('classic/index.html')), '小古文页已移除页底页脚（版权 + 法务链接）');
  chk(/\/terms\//.test(read('sw.js')) && /\/privacy\//.test(read('sw.js')),
    'Service Worker 预缓存了两个法务页（断网也能打开）');
  chk(/\/settings\//.test(read('sw.js')) && /js\/settings\.js/.test(read('sw.js')),
    'Service Worker 也预缓存了设置整页（断网也能改设置）');

  {
    ['admin.html', 'js/admin.js', 'js/stats.js', 'css/admin.css', 'data/visits.json']
      .forEach(f => chk(!fs.existsSync(path + f), '访问统计相关文件已删除：' + f));
    ['index.html', 'classic/index.html', 'terms/index.html', 'privacy/index.html', 'sw.js'].forEach(f => {
      chk(!/stats\.js|admin\.html|visits\.json/.test(read(f)), f + ' 不再引用被删除的统计文件');
    });
  }

  console.log(fails === 0 ? '\n🎉 用户协议 / 隐私条款测试全部通过' : '\n❌ ' + fails + ' 项失败');
  process.exit(fails ? 1 : 0);
}, 400);
