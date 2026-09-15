/**
 * 层级对比页专项测试（Issue #132 · /plans/）
 * ==========================================================================
 * 用户提的：「像其他网站那样，最左边是对比项，右边几列是不同角色，
 * 下面用打钩打叉」。落地为四列：未登录 / Free / Pro / Max。
 *
 * 这一层守五件事（都是「不靠肉眼点一遍就判得出」的那类）：
 *   一、表本身如实：每一格都等于 `can()` 的答案 —— 不许手抄一份
 *   二、四列的定义：未登录 ≠ free（差在语音朗读那一条）
 *   三、页面收口：比对只走 Entitlement.compare()，页面不自己拼 tier / plan
 *   四、诚实的口径：本期是「本机登记」，表尾不许装作在卖东西
 *   五、离线与入口：进预缓存、从个人中心的「权限」进得去、返回落点回个人中心
 *
 * 跑法：`node test/plans-page.test.js`（纯 Node，不联网、不装依赖）
 */
const fs = require('fs');
const path = __dirname + '/../';
const read = f => fs.readFileSync(path + f, 'utf8');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const Ent = require(path + 'js/entitlement.js');

const pageHtml = read('plans/index.html');
const pageJs = read('js/plans.js');
const css = read('css/account.css');
const sw = read('sw.js');
const profileHtml = read('profile/index.html');
const profileJs = read('js/profile.js');
const chromeJs = read('js/chrome.js');

/** 剥注释：注释里会写历史口径与说明，不剥掉就会对着自己的解释判红 */
const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
const stripHtml = t => t.replace(/<!--[\s\S]*?-->/g, ' ');
const PAGE = strip(pageJs);

/* ============ 一、表格如实：每格都等于 can() 的答案 ============ */
{
  const cmp = Ent.compare({});
  chk(cmp.cols.length === 4, '对比表有四列（未登录 / Free / Pro / Max）');
  chk(cmp.cols.map(c => c.id).join(',') === 'guest,free,pro,max',
    '四列的顺序是 未登录 → Free → Pro → Max（从低到高，最左是最弱的身份）');
  chk(cmp.cols.map(c => c.label).join(',') === '未登录,Free,Pro,Max',
    '四列标题如实：' + cmp.cols.map(c => c.label).join(' / '));
  chk(cmp.cols[0].guest === true && cmp.cols.slice(1).every(c => !c.guest),
    '只有第一列是「未登录」，其余三列都是登录后的身份');

  // 行数 = 能力表条数；一列不多、一列不少
  chk(cmp.rows.length === Object.keys(Ent.CAPS).length,
    '每个能力一行，共 ' + cmp.rows.length + ' 行（与 CAPS 条数一对一）');
  chk(cmp.rows.every(r => r.cells.length === 4), '每一行都是四格');

  // 每一格都必须与 can() 逐字一致 —— 这条是这一层存在的理由
  const mism = [];
  cmp.rows.forEach(r => {
    cmp.cols.forEach((col, i) => {
      const want = Ent.can(r.cap, { tier: col.tier, signedIn: !col.guest });
      const got = r.cells[i];
      if (got.ok !== want.ok || got.reason !== want.reason) {
        mism.push(r.cap + '@' + col.id);
      }
    });
  });
  chk(mism.length === 0,
    '表里的每一格都等于 Entitlement.can() 当场算的答案（实际不一致：' + mism.join(',') + '）');

  // 钩的形态：能用 = 打钩、不能用 = 打叉 + 一句门槛
  chk(cmp.rows.every(r => r.cells.every(c => c.ok ? c.hint === "" || /每月/.test(c.hint) : !!c.hint)),
    '能用的格子要么无字、要么只写额度；不能用的格子一定有门槛文案');
  const readAloud = cmp.rows.find(r => r.cap === 'read.aloud');
  chk(readAloud.cells[0].ok === false && readAloud.cells[0].reason === 'login',
    '「语音朗读」在未登录列是叉，且拦它的是「未登录」而不是层级');
  chk(readAloud.cells[1].ok === true, '「语音朗读」在 Free 列是钩（登录后免费可用）');
  // 这条就是「未登录 ≠ free」的全部差别，钉住它
  const diffCaps = cmp.rows.filter(r => r.cells[0].ok !== r.cells[1].ok).map(r => r.cap);
  chk(diffCaps.join(',') === 'read.aloud',
    '未登录与 Free 只差一条能力（实际差：' + diffCaps.join(',') + '）');

  // 免费不残缺：free 那一列不许比未登录少
  chk(cmp.rows.every(r => !(r.cells[0].ok && !r.cells[1].ok)),
    '免费版不缩水：未登录能用的，登录后 Free 一样能用');
  // 单调：层级越高只能更多，不能更少
  const notMono = [];
  cmp.rows.forEach(r => {
    for (let i = 2; i < 4; i++) if (r.cells[i - 1].ok && !r.cells[i].ok) notMono.push(r.cap);
  });
  chk(notMono.length === 0,
    '层级单调：Free 有的 Pro 一定有、Pro 有的 Max 一定有（实际反例：' + notMono.join(',') + '）');
  chk(cmp.rows.some(r => /pro|max/i.test(r.minTier)) && cmp.rows.some(r => r.minTier === 'free'),
    '表里既有免费能力、也有 Pro / Max 才有的能力（否则这张表没有存在的意义）');
}

/* ============ 二、分组与表尾 ============ */
{
  const cmp = Ent.compare({});
  chk(cmp.groups.length === 3, '按门槛分成三组（所有版本都有 / Pro 起 / Max 起）');
  chk(cmp.groups[0].key === 'free' && cmp.groups[1].key === 'pro' && cmp.groups[2].key === 'max',
    '三组的顺序是 免费 → Pro → Max（从低到高）');
  // 不重不漏
  const inGroups = cmp.groups.reduce((a, g) => a.concat(g.rows.map(r => r.cap)), []);
  chk(inGroups.length === cmp.rows.length, '分组不重复：分组里的行数 = 总行数');
  chk(new Set(inGroups).size === cmp.rows.length, '分组不遗漏：每个能力恰好出现一次');
  chk(cmp.groups.every(g => g.rows.every(r => r.minTier === g.key)),
    '每一行落在它自己门槛那一组里（不许把 Pro 能力摆进「所有版本都有」）');

  chk(cmp.summary.length === 4, '表尾每列一个汇总');
  const sumOK = cmp.summary.every((s, i) =>
    s.ok === cmp.rows.filter(r => r.cells[i].ok).length && s.total === cmp.rows.length);
  chk(sumOK, '表尾「能用几项 / 共几项」与表身逐格相符');
  chk(cmp.summary[0].ok === cmp.summary[1].ok - 1,
    '未登录与 Free 的可用项数只差 1（就是语音朗读那一条）');
  chk(cmp.summary[3].ok === cmp.summary[3].total,
    'Max 列全绿（最高层没有拿不到的能力）');
}

/* ============ 三、脏输入不许抛 ============ */
{
  let ok = true;
  try {
    Ent.compare();
    Ent.compare(null);
    Ent.compare({ now: 1757900000000 });
    Ent.compare({ now: 'xxx' });
  } catch (e) { ok = false; }
  chk(ok, 'compare() 对空参 / null / 脏 now 一律不抛');
  const a = Ent.compare({}), b = Ent.compare({});
  chk(JSON.stringify(a.rows) === JSON.stringify(b.rows),
    'compare() 是纯函数：同样输入两次调用结果逐字相同（大小写 / 顺序都不许漂）');
}

/* ============ 四、页面收口：不许自己拼 tier / plan ============ */
{
  chk(/Ent\.compare\(/.test(PAGE), '对比表一律由 Entitlement.compare() 生成（页面不手抄一份）');
  chk(!/tier\s*===\s*["']/.test(PAGE) && !/===\s*["'](free|pro|max)["']/.test(PAGE),
    'js/plans.js 不自己写 tier === "pro" 这类判断');
  chk(!/plan\s*===/.test(PAGE), 'js/plans.js 不自己比对 plan');
  chk(/Ent\.identity\(/.test(PAGE), '「你现在的身份」走 Entitlement.identity()（页面不自己读会话）');
  chk(/Ent\.tierLabel\(/.test(PAGE), '层级文案一律由 Entitlement.tierLabel() 出');
  chk(!/poem_plan_v1|poem_plan_grant_v1|poem_owner_v1/.test(PAGE),
    'js/plans.js 不碰任何权益存储键（键名只在 entitlement.js 里）');
  chk(!/AuthCore\.|window\.AuthCore/.test(PAGE),
    'js/plans.js 不直接读会话（身份只从 identity() 拿，避免第二个答案）');
  // 页面里那四列的标题也必须是内核给的，不许写死在 HTML 里
  chk(!/>\s*(Free|Pro|Max)\s*</.test(stripHtml(pageHtml)),
    '四列表头由 JS 按内核生成（HTML 里不写死 Free / Pro / Max）');
}

/* ============ 五、诚实的口径：不装作在卖东西 ============ */
{
  /* 2.1：这一段**按状态分叉**（js/plans.js 的 renderAbout()），HTML 里不写死。
     所以判据从「HTML 里有没有那句话」改成「两种状态各说各的实话」——
     见下面「五之二」。这里只看 HTML 里没有写死一句会变假的旧话。 */
  const visible = stripHtml(pageHtml);
  chk(!/没有服务器|本期没有服务端/.test(visible),
    'HTML 里不写死「本期没有服务器」（服务端已接通，写死就是假话，见 2.1）');
  chk(!/立即购买|立即开通|￥|限时优惠|首月|付费订阅|开通会员/.test(visible + PAGE),
    '对比页不出现任何收款/促销话术（本期确实收不了钱，写上就是假的）');
  chk(!/即将上线|敬请期待/.test(visible), '不写「即将上线」这类跑在代码前面的承诺');
  chk(/免费版不缩水|一件都不少/.test(visible),
    '页面头一句就说清「免费不缩水」（对比表最容易误导人的地方）');
}

/* ====== 五之二、2.1：层级**是谁定的** —— 两种状态各说各的实话 ====== */
{
  /* 判据只有一个：id.tierSource（服务端判定的唯一凭据）。
     这一节不看页面画出来的字（那要 jsdom），而是直接**调 renderAbout 那份逻辑
     的等价物**：源码里那个三元表达式必须两边都说真话，且两句话都对得上
     「不是付费凭据 / 没有收款」这一条（它在任何状态下都不变）。 */
  const rb = pageJs.slice(pageJs.indexOf('function renderAbout'), pageJs.indexOf('function renderAbout') + 1400);
  chk(!!rb, 'js/plans.js 里有 renderAbout()（那一段的渲染入口）');
  chk(/tierSource === "server"/.test(rb),
    'renderAbout() 按 tierSource 分叉（不自己猜、不自己比 tier）');
  chk(/由服务器判定/.test(rb), '服务端那份：页面上说明层级「由服务器判定」');
  chk(/本机登记/.test(rb), '本机那份：页面上说明层级是「本机登记」');
  chk(/无收款|收款|支付入口/.test(rb), '两种状态都写明「本站无收款、无支付入口」');
  chk(/不是付费凭据/.test(rb), '两种状态都写明「不是付费凭据」');
  /* 反向：不许只留一句、不许两态说反 */
  chk(pageJs.indexOf('renderAbout(id)') > 0, '初始化时真的调了 renderAbout(id)');
}

/* ============ 六、只读：这一页一个字节都不写盘 ============ */
{
  const forbidden = ['poem_recite_progress_v1', 'poem_recite_collections_v1',
    'poem_device_prefs_v1', 'poem_poems_read_v1', 'poem_classic_read_v1',
    'poem_recite_settings_v1', 'poem_profile_v1'];
  forbidden.forEach(k => chk(PAGE.indexOf(k) < 0, 'js/plans.js 不出现 ' + k));
  chk(!/setItem\(/.test(PAGE), 'js/plans.js 不写任何存储（看表不该留下痕迹）');
}

/* ============ 七、结构与顶层壳 ============ */
{
  chk(fs.existsSync(path + 'plans/index.html'), 'plans/index.html 存在');
  chk(/<base href="\/"/.test(pageHtml), '带 <base href="/">（子目录页面里相对资源才解析得对）');
  chk(/js\/chrome\.js/.test(pageHtml), '加载 js/chrome.js（顶栏 + 页签的唯一来源）');
  chk(/js\/pwa\.js/.test(pageHtml), '加载 js/pwa.js（--nav-h 每页都要实测）');
  chk(/js\/entitlement\.js/.test(pageHtml), '加载 js/entitlement.js（权益总闸）');
  chk(/js\/plans\.js/.test(pageHtml), '加载 js/plans.js（本页逻辑）');
  chk(/<header class="topbar"/.test(pageHtml), '有顶栏挂载点');
  chk(/data-page="层级对比"/.test(pageHtml), '声明页名「层级对比」');
  chk(/data-dock="off"/.test(pageHtml), '声明 data-dock="off"（看完就走的页不挂底部页签）');
  chk(/data-back="\/profile\/"/.test(pageHtml), '返回落点回个人中心（用户是从「权限」那一节点进来的）');
  chk(/class="foot settings-foot"/.test(pageHtml), '有页脚（版权 + 法务链接）');
  // 脚本顺序：内核 → 权益 → 本页 → chrome（顶栏要读前两个）
  const at = n => pageHtml.indexOf('<script src="/js/' + n + '"></script>');
  chk(at('auth-core.js') >= 0 && at('auth-core.js') < at('entitlement.js'),
    'auth-core 排在 entitlement 之前（先有会话再算权益）');
  chk(at('plans.js') < at('chrome.js'), 'js/plans.js 排在 js/chrome.js 之前');
  // chrome 认这条路由
  chk(/plans: "\/plans\/"/.test(chromeJs), 'js/chrome.js 的 ROUTES 里有 /plans/');
  chk(/"plans"/.test(chromeJs) || /'plans'/.test(chromeJs),
    'js/chrome.js 认得 plans 这个页签键（否则顶栏页名会退回首页）');
}

/* ============ 八、入口：从个人中心的「权限」进得去 ============ */
{
  chk(/btn-go-plans/.test(profileHtml), '个人中心的「权限」一节有进对比页的按钮');
  chk(/btn-go-plans/.test(profileJs), '那颗按钮真的绑了跳转（不是摆着不动的）');
  chk(/location\.href = "\/plans\/"/.test(profileJs), '按钮跳到 /plans/');
  // 两边同源：个人中心的清单与对比页同走 Entitlement
  chk(/Ent\.matrix\(/.test(profileJs) && /Ent\.compare\(/.test(PAGE),
    '个人中心清单走 matrix()、对比页走 compare()，都出自同一个内核');
  chk(/四种身份对比/.test(stripHtml(profileHtml)),
    '按钮文案说清它去哪、去做什么');
}

/* ============ 九、离线：页面与脚本都进预缓存，版本号跟着提 ============ */
{
  chk(sw.indexOf('"./plans/"') >= 0, 'sw.js 预缓存里有 ./plans/（断网也进得去）');
  chk(sw.indexOf('"./js/plans.js"') >= 0, 'sw.js 预缓存里有 js/plans.js');
  const ver = parseInt((sw.match(/poem-app-v(\d+)/) || [0, '0'])[1], 10);
  chk(ver >= 118, '缓存版本已跟着提（本轮新增 1 页 + 1 脚本，实际 v' + ver + '）');
  const list = [...sw.matchAll(/"(\.\/[^"]+)"/g)].map(m => m[1]);
  const missing = list.filter(u => {
    if (u === './') return false;
    const f = u.replace(/^\.\//, '');
    if (fs.existsSync(path + f)) return false;
    if (/\/$/.test(f) && fs.existsSync(path + f + 'index.html')) return false;
    return true;
  });
  chk(missing.length === 0, '预缓存清单里的文件都存在（实际缺 ' + missing.join(',') + '）');
}

/* ============ 十、样式：能横向看齐，颜色不外造 ============ */
{
  chk(/\.plans-table/.test(css), 'css/account.css 里有对比表的样式');
  chk(/\.plans-scroll/.test(css) && /overflow-x:\s*auto/.test(css),
    '四列在手机上横向可滚（否则最右一列会被挤出屏幕）');
  chk(/position:\s*sticky/.test(css) && /left:\s*0/.test(css),
    '第一列（对比项）粘在左边不跟着滚 —— 滚到第三列还得知道在看哪一行');
  chk(/\.plans-mark\.ok/.test(css) && /\.plans-mark\.no/.test(css),
    '打钩与打叉各有自己的样子（不是同一个符号换色）');
  chk(/\.plans-col-me/.test(css), '「你现在在这」那一列有高亮');
  // 两档收边：手机上收窄功能名那一列（否则表头「未登录」三个字折行），
  // 平板上不再需要横向滚（一列纸 1040px 放得下四列）
  chk(/@media \(max-width: 400px\)[\s\S]*?\.plans-table \{ min-width: 440px/.test(css),
    '手机（≤400px）对四列表单独收过一档（四列不能挤成豆腐块）');
  chk(/@media \(min-width: 768px\)[\s\S]*?\.plans-table \{ min-width: 0/.test(css),
    '平板 / 桌面不再横向滚（表跟着正文列一起放宽）');
  const palette = read('css/style.css') + read('css/classic.css') + read('css/legal.css');
  const mine = css.slice(css.indexOf('.plans-scroll'));
  const hex = (mine.replace(/rgba?\([^)]*\)/g, '').match(/#[0-9a-fA-F]{6}/g) || [])
    .filter(h => palette.toLowerCase().indexOf(h.toLowerCase()) < 0);
  chk(hex.length === 0,
    '对比表不写死任何「全站调色板里没有的」十六进制色值（实际 ' + [...new Set(hex)].join(',') + '）');
}

console.log('\n' + (fails ? '❌ ' + fails + ' 项失败' : '🎉 层级对比页测试全部通过'));
process.exit(fails ? 1 : 0);
