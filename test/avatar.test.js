const fs = require('fs');
const A = require('../js/avatar.js');
const AI = require('../js/avatar-image.js');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };
const eq = (a, b, m) => chk(a === b, m + '（实际 ' + JSON.stringify(a) + '）');

function mem(init) {
  const m = Object.assign({}, init || {});
  return {
    getItem: k => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: k => { delete m[k]; },
    keys: () => Object.keys(m),
    raw: () => m
  };
}

console.log('=== 一、首字印：昵称的第一个字母 / 汉字，永远画得出来 ===');
{
  const b = mem();
  let d = A.display(b);
  eq(d.char, '诗', '没昵称 → 默认「诗」字');
  eq(d.source, 'default', '来源如实标为默认');
  eq(d.hasImage, false, '没有图');

  A.setNickname(b, '玥玥');
  eq(A.display(b).char, '玥', '中文取第一个汉字');
  eq(A.display(b).source, 'nickname', '来源如实标为「用户名首字」');

  A.setNickname(b, 'ashley');
  eq(A.display(b).char, 'A', '拉丁字母取首字母并大写');

  A.setNickname(b, '🐟鱼');
  eq(A.display(b).char, '🐟', 'emoji 整个取出（charAt(0) 会劈成半个代理对）');

  A.setNickname(b, '   ');
  eq(A.display(b).char, '诗', '全是空白 → 回落到默认字');
}

console.log('\n=== 二、上一版那套「固定字 + 固定四色」真的删干净了 ===');
{
  const src = fs.readFileSync('js/avatar.js', 'utf8');
  ['CHARS', 'INKS', 'INK_KEYS', 'isChar', 'isInk', 'DEFAULT_INK'].forEach(function (k) {
    chk(!new RegExp(k).test(src), 'js/avatar.js 里不再有 ' + k + '（用户点名删掉的那套）');
  });
  chk(typeof A.CHARS === 'undefined' && typeof A.INKS === 'undefined',
    '模块出口也不再有字集 / 印色');
  chk(!/seal/i.test(src), '源码里不再出现 seal 字样');

  ['settings/general/index.html', 'css/style.css', 'js/settings.js'].forEach(function (f) {
    const t = fs.readFileSync(f, 'utf8');
    chk(!/seal-chars|seal-inks|seal-chip|seal-ink|btn-seal-reset/.test(t),
      f + ' 里没有留下那四个色点 / 字集的残骸');
  });
}

console.log('\n=== 三、图片地址：白名单，不是黑名单 ===');
{
  chk(A.isImgUrl('https://x.supabase.co/storage/v1/object/public/avatars/ab/abc/avatar.jpg'),
    'https 的 Storage 公开地址放行');
  chk(A.isImgUrl('https://x.supabase.co/a.jpg?v=123'), '带破缓存参数的 https 放行');
  chk(A.isImgUrl('/api/avatar/u/avatar.jpg'), '本站自己的头像口放行');
  chk(A.isImgUrl('data:image/jpeg;base64,AAAA'), '导入备份里的 data URL 放行');
  chk(!A.isImgUrl('javascript:alert(1)'), 'javascript: 拒收（这是 XSS 口子，不是「图不显示」）');
  chk(!A.isImgUrl('data:text/html;base64,AAAA'), 'data:text/html 拒收（同一条 XSS 口子）');
  chk(!A.isImgUrl('http://evil.test/a.jpg'), '明文 http 拒收');
  chk(!A.isImgUrl('blob:https://x/abc'), 'blob: 拒收（它只在这一台设备上有效）');
  chk(!A.isImgUrl(''), '空串拒收');
  chk(!A.isImgUrl('https://x/' + 'a'.repeat(600)), '超长地址拒收（不许撑爆存储）');
  eq(A.normAvatar({ img: 'javascript:alert(1)' }).img, '', '归一化时脏地址落空');
  eq(A.normAvatar({ char: '梅', ink: 'pine' }).img, '', '上一版的 char/ink 形状归一化后是空（它们不再是头像）');
}

console.log('\n=== 四、写脏值当场回绝，写不进去不抛 ===');
{
  const b = mem();
  const r = A.setAvatar(b, { img: 'javascript:alert(1)' });
  eq(r.ok, false, '脏地址拒收（不写盘）');
  eq(r.code, 'E_IMG', '给出可读的错误码');
  eq(A.display(b).img, '', '拒收后盘上仍是空');

  const ok = A.setAvatar(b, { img: 'https://x.supabase.co/a.jpg' });
  eq(ok.ok, true, '合法地址写成功');
  eq(A.display(b).source, 'image', '有图就是图片那一档');
  eq(A.display(b).img, 'https://x.supabase.co/a.jpg', '地址读得回来');

  A.resetAvatar(b);
  eq(A.display(b).hasImage, false, '重置之后回到首字印');
  eq(A.setAvatar(null, { img: 'https://x/a.jpg' }).ok, false, '没有存储时 ok:false，不抛');

  const throwing = {
    getItem: () => { throw new Error('隐私模式'); },
    setItem: () => { throw new Error('QuotaExceeded'); },
    removeItem: () => { throw new Error('nope'); }
  };
  eq(A.display(throwing).char, '诗', '取用即抛的存储 → 仍回落默认印，不抛');
  eq(A.setAvatar(throwing, { img: 'javascript:x' }).code, 'E_IMG', '脏值优先于写失败被拒（顺序稳定）');
}

console.log('\n=== 五、分域：地址进账号域，**本机那份图**进设备域 ===');
{
  const b = mem();
  A.setNickname(b, '小明');
  A.setAvatar(b, { img: 'https://x.supabase.co/a.jpg' });
  A.setLocalImage(b, 'data:image/jpeg;base64,AAAA');
  const keys = b.keys();
  chk(keys.indexOf(A.NS) >= 0, '云端地址写进了账号域 ' + A.NS);
  chk(keys.indexOf(A.LOCAL_NS) >= 0, '本机那份图写进了设备域 ' + A.LOCAL_NS);
  eq(keys.indexOf('poem_recite_progress_v1'), -1, '没碰进度域');
  eq(keys.indexOf('poem_plan_grant_v1'), -1, '没碰发放名单');

  const stored = b.raw()[A.NS];
  chk(stored.length < 700, '账号域那一份很小（只有地址，实际 ' + stored.length + ' 字节）');
  chk(!/base64/.test(stored), '账号域里绝不存 base64（它要被同步与导出）');
  chk(/base64/.test(A.localImage(b)), '本机那份是 data URL（断网时照旧画得出来）');

  eq(A.display(b).src, 'data:image/jpeg;base64,AAAA', '本机那份优先（离线也画得出）');
  A.clearLocalImage(b);
  eq(A.display(b).src, 'https://x.supabase.co/a.jpg', '本机那份没了就回落到云端地址');

  A.setLocalImage(b, 'data:image/jpeg;base64,CCCC');
  A.setAvatar(b, { img: '' });
  eq(A.localImage(b), 'data:image/jpeg;base64,CCCC', '写空地址**不清**本机那份（那是「上传还没回来」，不是「删除」）');
  eq(A.display(b).source, 'image', '于是刚裁完时界面立刻就是新图（不用等网络）');

  A.setAvatar(b, { img: 'https://x.supabase.co/a.jpg' });
  A.setLocalImage(b, 'data:image/jpeg;base64,BBBB');
  A.resetAvatar(b);
  eq(A.localImage(b), '', '删头像（resetAvatar）顺手清掉本机那份（不然「删了还显示」）');
  eq(A.display(b).source, 'nickname', '删完回到首字印');
}

console.log('\n=== 六、渲染：图片走 <img>，首字走文字，两档都不带外链脚本 ===');
{
  const b = mem();
  A.setNickname(b, '玥玥');
  const h1 = A.html(b);
  chk(/class="avatar"/.test(h1), '带统一的类名（几处显示共用一套样式）');
  eq(h1.indexOf('玥') >= 0, true, '没图时画的是首字');
  chk(!/<img/i.test(h1), '没图时不画 <img>（断网也画得出）');
  chk(/aria-label="头像：玥/.test(h1), '带可读的无障碍标签（读屏软件念得出）');

  A.setAvatar(b, { img: 'https://x.supabase.co/a.jpg?v=1' });
  const h2 = A.html(b);
  chk(/<img[^>]+class="avatar-img"/.test(h2), '有图时画的是 <img>');
  chk(/loading="lazy"/.test(h2), '图片带 lazy（子用户名册一次画好几枚）');
  chk(/referrerpolicy="no-referrer"/.test(h2), '跨域图不带 referrer（别把本站地址送出去）');
  chk(/alt=""/.test(h2), '图片本身 alt 空（外层 role=img 已经说了「这是谁的头像」）');
  chk(!/onerror|onload=/i.test(h2), '不带任何内联事件');

  const h3 = A.html(b, { size: 52 });
  chk(/--avatar-size:52px/.test(h3), '显式传 size 时才内联那一个值');
  chk(!/--avatar-size/.test(A.html(mem())), '不传 size 时由 CSS 兜底');

  const p1 = A.displayOf({ nickname: '小明', avatar: { img: '' } });
  const p2 = A.displayOf({ nickname: '小红', avatar: { img: 'https://x/a.jpg' } });
  eq(p1.char, '小', '指定档案取它自己的首字');
  eq(p2.source, 'image', '指定档案有它自己的图');
  chk(A.htmlFor({ nickname: '小明' }).indexOf('小') >= 0, 'htmlFor 画的是那一份档案');
}

console.log('\n=== 七、本地压缩 + 方形裁切的几何（纯函数，不依赖 canvas） ===');
{

  let r = AI.cropRect(4000, 3000, 1, 0.5, 0.5);
  eq(r.sw, 3000, '不放大时框取短边');
  eq(r.sh, 3000, '框是正方形');
  eq(r.sx, 500, '居中（4000 宽里取中间 3000）');
  eq(r.sy, 0, '纵向顶到边');

  r = AI.cropRect(4000, 3000, 2, 0.5, 0.5);
  eq(r.sw, 1500, '放大 2 倍 → 框边长减半（看到的细节更多）');
  eq(r.sx, 1250, '放大后仍居中');

  r = AI.cropRect(4000, 3000, 1, 0, 0);
  eq(r.sx, 0, '中心点拉到左上角 → 框贴左上（不越界）');
  eq(r.sy, 0, '同一件事在纵向也成立');

  r = AI.cropRect(4000, 3000, 1, 1, 1);
  eq(r.sx, 1000, '中心点拉到右下角 → 框贴右下');
  eq(r.sy, 0, '纵向已经贴边（短边撑满）');

  r = AI.cropRect(3000, 4000, 1, 0.5, 0.5);
  eq(r.sw, 3000, '竖图仍取短边（宽）');
  eq(r.sy, 500, '竖图纵向居中');

  r = AI.cropRect(1, 1, 1, 0.5, 0.5);
  chk(r.sw >= 1 && r.sh >= 1, '1×1 的图也画得出（不会 0 尺寸）');
  r = AI.cropRect(0, 0, 0, 0, 0);
  chk(r.sw >= 1 && r.sh >= 1, '全是脏值也不出 0 尺寸');
  r = AI.cropRect(100, 100, 1e9, 0.5, 0.5);
  chk(r.sw >= 1, '放大到离谱也不出 0 尺寸');

  const zr = AI.zoomRange(4000, 3000);
  eq(zr.min, 1, '缩放下限是 1（小于 1 就是「把图缩小、方框里露纸底」，不是裁切）');
  eq(zr.max, 3000 / 32, '上限按「框不小于 32 原图像素」推');
  eq(AI.clampZoom(4000, 3000, 0.2), 1, 'zoom 小于下限 → 夹到 1');
  eq(AI.clampZoom(4000, 3000, 1e9), zr.max, 'zoom 大于上限 → 夹到上限');
  eq(AI.clampZoom(4000, 3000, NaN), 1, 'NaN → 1（不抛）');

  let o = AI.clampOffset(4000, 3000, 1, 0, 0);
  eq(o.ox, 0.375, '横向能拖的范围是 [0.375, 0.625]');
  eq(o.oy, 0.5, '纵向短边撑满 → 只能居中');
  o = AI.clampOffset(4000, 3000, 1, 5, -5);
  eq(o.ox, 0.625, '超出的 ox 夹回上界');
  eq(o.oy, 0.5, '超出的 oy 夹回居中');
  o = AI.clampOffset(100, 100, 1, 0.5, 0.5);
  eq(o.ox, 0.5, '正方形图只能居中（没有可拖的余地）');

  chk(AI.wantsPng('image/png'), 'PNG 原图要存 PNG（透明不能被填成黑边）');
  chk(AI.wantsPng('image/webp'), 'WebP 原图同上');
  chk(!AI.wantsPng('image/jpeg'), 'JPEG 原图存 JPEG（照片存 PNG 会大 5~10 倍）');

  eq(AI.checkFile(null).code, 'E_NO_FILE', '没选文件');
  eq(AI.checkFile({ type: 'image/heic', size: 10 }).code, 'E_TYPE', '不支持的格式（按 MIME 判，不按扩展名）');
  eq(AI.checkFile({ type: 'image/jpeg', size: 99 * 1024 * 1024 }).code, 'E_TOO_BIG', '太大');
  eq(AI.checkFile({ type: 'image/jpeg', size: 1024 }).ok, true, '正常文件放行');
  eq(AI.OUT_SIZE, 256, '输出是 256×256（顶栏画 42px，视网膜 2x 也只到 84）');
}

console.log('\n=== 八、老数据零感知：上一版的 char / ink 不会让它炸 ===');
{
  const b = mem({
    poem_profile_v1: JSON.stringify({
      v: 1, nickname: '小明', avatar: { char: '梅', ink: 'pine' }
    })
  });
  const d = A.display(b);
  eq(d.char, '小', '老用户的字印自然回到「昵称首字」');
  eq(d.hasImage, false, '老数据没有图');
  eq(d.nickname, '小明', '昵称一个字都没丢');
  eq(A.nickname(b), '小明', '读得回来');

  eq(A.display(mem({ poem_profile_v1: 'not-json' })).char, '诗', '档案不是 JSON → 回落默认');
  eq(A.display(mem({ poem_profile_v1: '[1,2]' })).char, '诗', '档案不是对象 → 回落默认');
  eq(A.display(null).char, '诗', '没有存储 → 默认印');

  const dirty = mem({ poem_profile_v1: JSON.stringify({ nickname: 42, avatar: { img: 42 } }) });
  eq(A.display(dirty).char, '4', '脏昵称也能画出首字（不裂图）');
  eq(A.display(dirty).hasImage, false, '脏图片地址一律当没有');
  eq(A.display(mem({ poem_profile_v1: JSON.stringify({ nickname: '', avatar: null }) })).char, '诗',
    '空昵称 → 回落默认字');
  chk(!/base64/.test(mem({ poem_avatar_local_v1: '{"img":"https://evil/a.jpg"}' }).raw()[A.LOCAL_NS] || ''),
    '本机那份只认 data:image（脏值当没有）');
  eq(A.localImage(mem({ poem_avatar_local_v1: '{"img":"https://evil/a.jpg"}' })), '',
    '本机那份里混进 https 地址 → 当没有（它本来就不该存地址）');
}

console.log('\n=== 九、不用邮箱首字母（与 /privacy/ 的口径一致） ===');
{
  const b = mem({ poem_auth_v1: JSON.stringify({ profile: { nickname: '' } }) });
  eq(A.display(b).char, '诗', '没有昵称时不会去抠邮箱首字母，而是回默认字');
  const src = fs.readFileSync('js/avatar.js', 'utf8');
  chk(!/email|mail/i.test(src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, '')),
    'js/avatar.js 的实现里根本读不到邮箱');
}

console.log('\n=== 十、每张加载了顶栏的页面都加载了 js/avatar.js ===');
{
  const path = require('path');
  const pages = ['index.html'].concat(
    fs.readdirSync('.').filter(function (f) {
      try { return fs.statSync(path.join(f, 'index.html')).isFile(); } catch (e) { return false; }
    }).map(function (d) { return d + '/index.html'; })
  );
  const withChrome = pages.filter(function (f) {
    return /<script src="\/?js\/chrome\.js"><\/script>/.test(fs.readFileSync(f, 'utf8'));
  });
  chk(withChrome.length >= 13, '找到全部加载顶栏的页面（实际 ' + withChrome.length + ' 张）');
  withChrome.forEach(function (f) {
    const src = fs.readFileSync(f, 'utf8');
    chk(/<script src="\/?js\/avatar\.js"><\/script>/.test(src), f + ' 加载了 js/avatar.js');
    const atAvatar = src.indexOf('<script src="js/avatar.js"></script>') >= 0
      ? src.indexOf('<script src="js/avatar.js"></script>')
      : src.indexOf('<script src="/js/avatar.js"></script>');
    const atChrome = src.indexOf('<script src="js/chrome.js"></script>') >= 0
      ? src.indexOf('<script src="js/chrome.js"></script>')
      : src.indexOf('<script src="/js/chrome.js"></script>');
    chk(atAvatar >= 0 && atChrome >= 0 && atAvatar < atChrome,
      f + ' 里 js/avatar.js 的 <script> 排在 js/chrome.js 之前（顶栏渲染时它得先就位）');
  });
}

console.log('\n=== 十之一、顶栏右端：没有头像，只有一颗裸箭头（Issue #209 第二轮）===');
{

  const css = fs.readFileSync('css/style.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
  const chrome = fs.readFileSync('js/chrome.js', 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');

  chk(!/\.top-user\s*[,{]/.test(css),
    '样式表里不再留 .top-user 规则（顶栏那一枚头像已删）');
  chk(!/--top-slot/.test(css) && !/\.top-slot\s*[,{]/.test(css),
    '--top-slot 与 .top-slot（头像的直径 / 圆槽）也一并删了');
  chk(!/--user-size/.test(css),
    '--user-size（顶栏头像专用的尺寸来源）也删了 —— 顶栏没有头像了');
  chk(!/\.top-act-spacer\s*[,{]/.test(css),
    '阅读器里那枚「不可见占位」也删了（它占的是头像的像素位）');
  chk(!/class="avatar-top"|avatar-top/.test(fs.readFileSync('js/chrome.js', 'utf8')),
    'js/chrome.js 不再画顶栏那一档头像（avatar-top 的渲染调用整条撤掉）');
  chk(!/userAvatarHtml|userHref|__AVATAR_PAGE__/.test(chrome),
    '画顶栏头像与它的落点那两件事整件删掉（连带 __AVATAR_PAGE__ 覆盖口）');
  chk(!/size:\s*\d+/.test(chrome),
    'js/chrome.js 里没有任何写死的头像尺寸（顶栏不再画头像）');

  const cssRule = (function (sel) {
    const flat = css.replace(/@media[^{]+\{/g, '{');
    let acc = '';
    const re = /([^{}]+)\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(flat))) {
      if (m[1].split(',').map(x => x.trim()).includes(sel)) acc += ';' + m[2];
    }
    return acc;
  });
  chk(/object-fit:\s*cover/.test(cssRule('.avatar-img')), '头像本体仍是「图片铺满整圆且不变胖」');
  chk(/border-radius:\s*50%/.test(cssRule('.avatar')), '头像本体仍是整圆（只是不再出现在顶栏）');
}

console.log('\n=== 十之二、本机那份字节跟着子用户走（Issue #320）===');
{
  // 用户报的：Pro / Max 建了两个以上子用户，切子用户时**昵称换了、头像没换**
  // —— 顶栏与底栏「我的」那颗都是上一个孩子那张脸。
  //
  // 根因是分域：`poem_avatar_local_v1` 从前按**设备域**处理（`Family.isPerChild`
  // 对它说 false），于是它是「这台设备上最后裁的那张图」。这一节钉的就是
  // 「它现在按子用户分家，而且切过去看到的是**那个孩子**的图」。
  const F = require('../js/family.js');
  global.window = global;
  global.Family = F;
  delete require.cache[require.resolve('../js/avatar.js')];
  global.Avatar = require('../js/avatar.js');

  const b = mem();
  F.ensure({ backing: b });
  const a = F.list({ backing: b })[0];
  F.rename(a.id, '小明', { backing: b });
  const rb = F.create('小红', { backing: b });

  const IMG_A = 'data:image/jpeg;base64,AAAA';
  const IMG_B = 'data:image/jpeg;base64,BBBB';

  F.select(a.id, { backing: b });
  A.saveNickname(b, '小明');
  A.setAvatar(b, { img: 'https://x.supabase.co/a.jpg' });
  A.setLocalImage(b, IMG_A);

  F.select(rb.profile.id, { backing: b });
  A.saveNickname(b, '小红');
  A.setAvatar(rb.profile.id, { img: 'https://x.supabase.co/b.jpg' }, { backing: b });
  A.setLocalImage(b, IMG_B);

  F.select(a.id, { backing: b });
  eq(A.display(b).nickname, '小明', '切回小明：昵称是小明的');
  eq(A.display(b).src, IMG_A, '切回小明：**头像也是小明的**（这就是用户报的那一条）');

  F.select(rb.profile.id, { backing: b });
  eq(A.display(b).src, IMG_B, '切到小红：头像是小红的');
  eq(A.display(b).nickname, '小红', '昵称也跟着换');

  chk(Object.keys(b.raw()).some(k => k === A.LOCAL_NS + '::' + a.id),
    '本机那份字节按子用户分家（键名带 id 后缀）');
  chk(Object.keys(b.raw()).some(k => k === A.LOCAL_NS + '::' + rb.profile.id),
    '另一个孩子也有自己那一把');
  chk(!(A.LOCAL_NS in b.raw()),
    '不再往不分家的老键上写（同一份字节留两处就是第二份真相）');
  eq(F.isPerChild(A.LOCAL_NS), true, '分域表：本机那份字节算「分家」');
  eq(F.isPerChild(A.LOCAL_NS + '::' + a.id), true, '带后缀那一把也认得出是分家的');

  A.clearLocalImage(b);
  eq(A.localImage(b), '', '清掉之后当前这个孩子没有本机那份字节了');
  F.select(a.id, { backing: b });
  eq(A.localImage(b), IMG_A, '**清的是当前那个孩子那份**（另一个孩子一根毫毛没动）');
}

console.log('\n=== 十之三、老用户那份字节不会丢，也不会串到别人头上 ===');
{
  const F = require('../js/family.js');
  global.window = global;
  global.Family = F;
  delete require.cache[require.resolve('../js/avatar.js')];
  global.Avatar = require('../js/avatar.js');
  const A2 = global.Avatar;

  // 老设备：老档案 + 老键（不分家）上那一张图。
  const b = mem({
    poem_profile_v1: JSON.stringify({ v: 1, nickname: '小明', avatar: { img: 'https://x.supabase.co/a.jpg' } }),
    poem_avatar_local_v1: JSON.stringify({ v: 1, img: 'data:image/jpeg;base64,OLD1' })
  });
  const d = F.ensureDetailed({ backing: b });
  const first = d.data.profiles[0].id;
  eq(A2.localImage(b), 'data:image/jpeg;base64,OLD1', '认领之后那张图照旧画得出来');
  eq(A2.display(b).src, 'data:image/jpeg;base64,OLD1', '显示仍以本机那份优先');
  chk(!('poem_avatar_local_v1' in b.raw()), '老键搬完就删掉（不让它成为第二份真相）');
  chk(!!b.raw()['poem_avatar_local_v1::' + first], '那张图落在**第一个孩子**名下');

  // 第二个孩子：本机一个字节都没有 → 不是「顶着别人那张脸」，而是回到自己的首字。
  const rb = F.create('小红', { backing: b });
  F.select(rb.profile.id, { backing: b });
  eq(A2.localImage(b), '', '新孩子本机没有字节');
  eq(A2.display(b).hasImage, false, '于是它画自己的首字印（不是小明那张图）');
  eq(A2.display(b).char, '小', '首字仍是自己的昵称');

  // 搬一次之后再 ensure 幂等。
  const before = JSON.stringify(Object.keys(b.raw()).sort());
  F.ensure({ backing: b });
  eq(JSON.stringify(Object.keys(b.raw()).sort()), before, '认领幂等：第二次不再动盘上任何一个键');
}

console.log('\n=== 十之四、备份带走本机那份字节，导入回填到对的孩子 ===');
{
  const F = require('../js/family.js');
  global.window = global;
  global.Family = F;
  delete require.cache[require.resolve('../js/avatar.js')];
  global.Avatar = require('../js/avatar.js');
  const A3 = global.Avatar;

  const b = mem();
  F.ensure({ backing: b });
  const a = F.list({ backing: b })[0];
  const rb = F.create('小红', { backing: b });
  F.select(a.id, { backing: b });
  A3.setLocalImage(b, 'data:image/jpeg;base64,AAAA');
  F.select(rb.profile.id, { backing: b });
  A3.setLocalImage(b, 'data:image/jpeg;base64,BBBB');

  const dump = A3.exportLocal({ backing: b });
  eq(dump[a.id], 'data:image/jpeg;base64,AAAA', '导出里有两个孩子的字节（第一个）');
  eq(dump[rb.profile.id], 'data:image/jpeg;base64,BBBB', '导出里有两个孩子的字节（第二个）');
  chk(!('' in dump), '老键上没有东西就不写它那一格');

  const b2 = mem();
  F.ensure({ backing: b2 });
  const ids2 = F.list({ backing: b2 }).map(p => p.id);
  eq(ids2.join(',') !== [a.id, rb.profile.id].join(','), true,
    '（对照）新设备上的名册 id 与旧的不同 —— 所以按 id 回填本来就不该指望');

  // 老键那一格：备份里带回来的东西，在**没有 Family** 的页面上仍读得到
  // （0 期形状一字不动）。
  const b3 = mem();
  A3.importLocal({ '': 'data:image/jpeg;base64,CCCC' }, { backing: b3 });
  eq(b3.raw()[A3.LOCAL_NS], JSON.stringify({ v: 1, img: 'data:image/jpeg;base64,CCCC' }),
    '老键那一格落在不分家的键上（导入要先走这一格，Family 现取）');
  eq(A3.localImage(b3), 'data:image/jpeg;base64,CCCC', '读得回来');

  // 名册先落地、再导入 → 每个孩子拿到自己那张。
  const b4 = mem();
  F.restore({ v: 1, at: a.id, profiles: [
    { id: a.id, nickname: '小明', avatar: { img: '' }, createdAt: 1 },
    { id: rb.profile.id, nickname: '小红', avatar: { img: '' }, createdAt: 2 }
  ] }, { backing: b4 });
  A3.importLocal(dump, { backing: b4 });
  F.select(a.id, { backing: b4 });
  eq(A3.localImage(b4), 'data:image/jpeg;base64,AAAA', '同一份名册 + 导入：小明的图回到小明名下');
  F.select(rb.profile.id, { backing: b4 });
  eq(A3.localImage(b4), 'data:image/jpeg;base64,BBBB', '小红的图回到小红名下（没有串）');

  eq(A3.importLocal({ 'f-x': 'https://evil/a.jpg' }, { backing: mem() }), false,
    '导入里混进地址 → 一格都不写（本机那份只认 data:image）');

}

console.log('\n=== 十一、源码扫描：页面不许自己拼一份头像 ===');
{

  const files = ['js/chrome.js', 'js/app.js', 'js/settings.js', 'js/reader-core.js', 'js/mine.js'];
  files.forEach(function (f) {
    const src = fs.readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    chk(!/class="avatar"/.test(src), f + ' 没自己拼一份头像 HTML（一律走 Avatar.html / htmlFor）');
    chk(!/linear-gradient\(150deg/.test(src), f + ' 没自己复制一份头像底色');
  });
  const html = A.html(mem());
  chk(/linear-gradient/.test(fs.readFileSync('css/style.css', 'utf8')),
    '底色只由样式表给（头像没有颜色可选了）');
}

console.log('');
if (fails) {
  console.log('✗ 头像测试失败 ' + fails + ' 项');
  process.exit(1);
}
console.log('🎉 头像测试全部通过');
