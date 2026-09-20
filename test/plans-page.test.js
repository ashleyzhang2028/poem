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
// ⚠️ 原先这一档读 profile/index.html 与 js/profile.js（个人中心）。
//    2026-09-20（Issue #244）那一页已删除，「层级对比」那一行搬到了
//    「我的」页的「关于」卡里 —— 守的还是同一条口径（它是一个 <a href="/plans/">）。
const mineHtml = read('mine/index.html');
const mineJs = read('js/mine.js');
const chromeJs = read('js/chrome.js');

const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
const stripHtml = t => t.replace(/<!--[\s\S]*?-->/g, ' ');
const PAGE = strip(pageJs);

const plansCommentOnly = pageJs;

{
  const cmp = Ent.compare({});
  chk(cmp.cols.length === 4, '对比表有四列（未登录 / Free / Pro / Max）');
  chk(cmp.cols.map(c => c.id).join(',') === 'guest,free,pro,max',
    '四列的顺序是 未登录 → Free → Pro → Max（从低到高，最左是最弱的身份）');
  chk(cmp.cols.map(c => c.label).join(',') === '游客,Free,Pro,Max',
    '四列标题如实：' + cmp.cols.map(c => c.label).join(' / '));
  chk(cmp.cols[0].guest === true && cmp.cols.slice(1).every(c => !c.guest),
    '只有第一列是「未登录」，其余三列都是登录后的身份');

  chk(cmp.rows.length === Object.keys(Ent.CAPS).length,
    '每个能力一行，共 ' + cmp.rows.length + ' 行（与 CAPS 条数一对一）');
  chk(cmp.rows.every(r => r.cells.length === 4), '每一行都是四格');

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

  chk(cmp.rows.every(r => r.cells.every(c => c.ok ? true : !!c.hint)),
    '不能用的格子一定有门槛文案（「登录可用」/「Pro 起」）');

  const capRow = n => cmp.rows.find(r => r.cap === n);
  chk(capRow('collections.many').cells[1].quota === 10 &&
      capRow('collections.many').cells[2].quota === 100 &&
      capRow('collections.many').cells[3].quota === 5000,
    '自选清单三档额度在**格子上**：Free 10 / Pro 100 / Max 5000');
  chk(capRow('profile.family').cells[1].quota === 1 &&
      capRow('profile.family').cells[2].quota === 3 &&
      capRow('profile.family').cells[3].quota === 180,
    '子用户三档在格子上：1 / 3 / 180');
  chk(capRow('export.all').cells[2].quota === 251 && capRow('export.all').cells[3].quota === 251,
    '课内诗词导出：Pro / Max 两列都列出 251 首');
  chk(capRow('export.all').cells[2].hint === '251 个',
    '能用的格子里带额度数字（不只是打钩，用户点名要「直接列出数字」）：' + capRow('export.all').cells[2].hint);
  const readAloud = cmp.rows.find(r => r.cap === 'read.aloud');
  chk(readAloud.cells[0].ok === false && readAloud.cells[0].reason === 'login',
    '「语音朗读」在未登录列是叉，且拦它的是「未登录」而不是层级');
  chk(readAloud.cells[1].ok === true, '「语音朗读」在 Free 列是钩（登录后免费可用）');

  // 未登录与 Free 差的是**登录取向**的那几件：语音朗读 + 进度导出
  // （Issue #229 第二轮）＋ 莱特纳盒（Issue #229 第四轮：算法按层级开放）。
  // 层级仍是 free，三件都只差登录。
  const diffCaps = cmp.rows.filter(r => r.cells[0].ok !== r.cells[1].ok).map(r => r.cap);
  chk(diffCaps.join(',') === 'read.aloud,export.progress,algo.leitner',
    '未登录与 Free 差的是登录取向的三件（实际差：' + diffCaps.join(',') + '）');
  chk(diffCaps.every(c => cmp.rows.find(r => r.cap === c).cells[0].reason === 'login'),
    '差的每一条拦它的理由都是「未登录」，不是层级');

  chk(cmp.rows.every(r => !(r.cells[0].ok && !r.cells[1].ok)),
    '免费版不缩水：未登录能用的，登录后 Free 一样能用');

  const notMono = [];
  cmp.rows.forEach(r => {
    for (let i = 2; i < 4; i++) if (r.cells[i - 1].ok && !r.cells[i].ok) notMono.push(r.cap);
  });
  chk(notMono.length === 0,
    '层级单调：Free 有的 Pro 一定有、Pro 有的 Max 一定有（实际反例：' + notMono.join(',') + '）');
  chk(cmp.rows.some(r => /pro|max/i.test(r.minTier)) && cmp.rows.some(r => r.minTier === 'free'),
    '表里既有免费能力、也有 Pro / Max 才有的能力（否则这张表没有存在的意义）');
}

{
  const cmp = Ent.compare({});
  chk(cmp.groups.length === 3, '按门槛分成三组（所有版本都有 / Pro 起 / Max 起）');
  chk(cmp.groups[0].key === 'free' && cmp.groups[1].key === 'pro' && cmp.groups[2].key === 'max',
    '三组的顺序是 免费 → Pro → Max（从低到高）');

  const inGroups = cmp.groups.reduce((a, g) => a.concat(g.rows.map(r => r.cap)), []);
  chk(inGroups.length === cmp.rows.length, '分组不重复：分组里的行数 = 总行数');
  chk(new Set(inGroups).size === cmp.rows.length, '分组不遗漏：每个能力恰好出现一次');
  chk(cmp.groups.every(g => g.rows.every(r => r.minTier === g.key)),
    '每一行落在它自己门槛那一组里（不许把 Pro 能力摆进「所有版本都有」）');

  const notes = cmp.groups.map(g => g.note || '');
  chk(notes.every(n => n.length <= 20),
    '分组注解不超过一句 20 字（实际：' + notes.map(n => n.length).join(' / ') + '）');
  chk(cmp.groups[0].note == null && cmp.groups[1].note == null,
    '「所有版本都有」「Pro 起」两组不再挂一句解释（组名自己已经说完）');

  chk(cmp.summary.length === 4, '表尾每列一个汇总');
  const sumOK = cmp.summary.every((s, i) =>
    s.ok === cmp.rows.filter(r => r.cells[i].ok).length && s.total === cmp.rows.length);
  chk(sumOK, '表尾「能用几项 / 共几项」与表身逐格相符');
  chk(cmp.summary[0].ok === cmp.summary[1].ok - 3,
    '未登录与 Free 的可用项数差 3（语音朗读 + 进度导出 + 莱特纳盒，都是登录才给）');
  chk(cmp.rows.filter(r => r.cells[0].ok && !r.cells[1].ok).length === 0,
    '没有「游客能用、登录后反而不能用」的（免费版不缩水仍成立）');
  chk(cmp.summary[3].ok === cmp.summary[3].total,
    'Max 列全绿（最高层没有拿不到的能力）');
}

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

{
  const cmp = Ent.compare({});

  // Issue #229 第五轮：三行改名的、以及折行点（breaks）都由内核说了算 ——
  // name 是台账里的**全名**（读屏 / 搜索都按整句），折行只是表上的一处排版。
  const want = {
    'recite.basic': '每日背诵', 'library.all': '课外阅读', 'read.aloud': '语音朗读',
    'pinyin.helper': '阅读辅助', 'export.progress': '进度导出',
    'collections.many': '自选清单', 'sync.multiDevice': '设备同步',
    'export.paper': 'PDF / 打印', 'profile.family': '子用户',
    'quiz.review': '题库', 'export.all': '课内诗词 导出',
    'exam.gathering': '古诗词 大会', 'exam.paper': '试题模拟'
  };
  Object.keys(want).forEach(k => {
    const row = cmp.rows.find(r => r.cap === k);
    chk(row && row.name === want[k], k + ' 的名字是「' + want[k] + '」（实际 ' +
      (row ? row.name : '(缺这一行)') + '）');
  });

  const gRow = cmp.rows.find(r => r.cap === 'exam.gathering');
  const pRow = cmp.rows.find(r => r.cap === 'exam.paper');
  chk(!!gRow && !!pRow, '对比表上是**两行**：exam.gathering 与 exam.paper');
  chk(!/TWO_LINE/.test(PAGE), 'js/plans.js 里不再有「一个格子分两行」的写法（TWO_LINE 已撤）');
  chk(!/plans-cap-line/.test(PAGE) && !/plans-cap-line/.test(css),
    '那个只为分两行而生的样式也一并撤了（不留死样式）');
  chk(gRow.name !== pRow.name, '两行的名字各自独立：「' + gRow.name + '」/「' + pRow.name + '」');

  chk(!!Ent.cap('exam.paper'), 'exam.paper 键名照旧（拆的是能力，不是键名）');

  chk(/合计/.test(PAGE), '表尾那一格写作「合计」（Issue #163：能用 → 合计）');

  // ---- Issue #229 第五轮：三行改名 + 折行 ----
  {
    const e = cmp.rows.find(r => r.cap === 'algo.ebbinghaus');
    chk(e.name === '艾宾浩斯遗忘曲线',
      '「遗忘曲线」那一行的全名是「艾宾浩斯遗忘曲线」（实际 ' + e.name + '）');
    chk(e.breaks && e.breaks[0] === '遗忘曲线',
      '它在「遗忘曲线」前折行 —— 后半截是整个算法名，第一行留「艾宾浩斯」');

    const x = cmp.rows.find(r => r.cap === 'export.all');
    chk(x.name === '课内诗词 导出',
      '导出那一行的名字是「课内诗词 导出」（实际 ' + x.name + '）');
    chk(x.breaks && x.breaks[0] === '导出', '「导出」被折到第二行');

    const g = cmp.rows.find(r => r.cap === 'exam.gathering');
    chk(g.name === '古诗词 大会', '大会那一行的名字是「古诗词 大会」（实际 ' + g.name + '）');
    chk(g.breaks && g.breaks[0] === '大会', '「大会」被折到第二行');

    // 折行点必须真在名字里，且不是名字的开头（否则第一行是空的）
    ['algo.ebbinghaus', 'export.all', 'exam.gathering'].forEach(cap => {
      const r = cmp.rows.find(z => z.cap === cap);
      const at = r.name.indexOf(r.breaks[0]);
      chk(at > 0 && at < r.name.length, cap + ' 的折行点落在名字中段（位置 ' + at + '）');
    });

    // 只是排版：读到的名字仍是一整句（少了字 / 多个空格都是改了名字，不是折行）
    chk(cmp.rows.every(r => !/\s{2,}/.test(r.name.trim()) || !!r.breaks),
      '只有带 breaks 的那几行名字里有断字空格 —— 其余的仍是整齐的单句');
  }
  chk(!/['"]能用['"]/.test(PAGE), 'js/plans.js 里不再出现「能用」这个表尾词');

  const rows = cmp.groups.reduce((acc, g) => acc.concat(g.rows.map(r => r.cap)), []);
  chk(rows.indexOf('exam.gathering') >= 0 && rows.indexOf('exam.paper') >= 0,
    '两行都在表身里（都参与分段排序）');
  const marks = r => (r.cells || []).map(c => (c.ok ? '✓' : '✕')).join(',');
  chk(marks(gRow).indexOf('✓') >= 0 && marks(pRow).indexOf('✓') >= 0,
    '两行各自有打钩的格子（Max 那两列）：' + marks(gRow) + ' / ' + marks(pRow));
  chk(gRow.cells && gRow.cells.length === cmp.cols.length,
    '「古诗词大会」那一行有自己的四个格子（不是一个格子里的两行字）');
  chk(pRow.cells && pRow.cells.length === cmp.cols.length,
    '「试题模拟」那一行也是自己的四个格子');
  chk(marks(gRow) === marks(pRow),
    '两行同档（都归 Max）—— 但它们是**两行两个钩叉**，各答各的问题');

  chk(/plans-you"?>现在</.test(plansCommentOnly) && !/你现在在这/.test(plansCommentOnly),
    '当前列角标已收成「现在」（旧的长句「你现在在这」不再出现）');
}

{
  chk(/Ent\.compare\(/.test(PAGE), '对比表一律由 Entitlement.compare() 生成（页面不手抄一份）');
  chk(!/tier\s*===\s*["']/.test(PAGE) && !/===\s*["'](free|pro|max)["']/.test(PAGE),
    'js/plans.js 不自己写 tier === "pro" 这类判断');
  chk(!/plan\s*===/.test(PAGE), 'js/plans.js 不自己比对 plan');
  chk(/Ent\.identity\(/.test(PAGE), '「你现在的身份」走 Entitlement.identity()（页面不自己读会话）');

  chk(/renderHead/.test(PAGE) && !/>\s*(Free|Pro|Max)\s*</.test(stripHtml(pageHtml)),
    '层级 / 列名一律由 Entitlement 出，js/plans.js 与 HTML 都不手写');
  chk(!/poem_plan_v1|poem_plan_grant_v1|poem_owner_v1/.test(PAGE),
    'js/plans.js 不碰任何权益存储键（键名只在 entitlement.js 里）');
  chk(!/AuthCore\.|window\.AuthCore/.test(PAGE),
    'js/plans.js 不直接读会话（身份只从 identity() 拿，避免第二个答案）');

  chk(!/>\s*(Free|Pro|Max)\s*</.test(stripHtml(pageHtml)),
    '四列表头由 JS 按内核生成（HTML 里不写死 Free / Pro / Max）');
}

{

  const visible = stripHtml(pageHtml);
  chk(!/没有服务器|本期没有服务端/.test(visible),
    'HTML 里不写死「本期没有服务器」（服务端已接通，写死就是假话，见 2.1）');
  chk(!/立即购买|立即开通|￥|限时优惠|首月|付费订阅|开通会员/.test(visible + PAGE),
    '对比页不出现任何收款/促销话术（本期确实收不了钱，写上就是假的）');
  chk(!/即将上线|敬请期待/.test(visible), '不写「即将上线」这类跑在代码前面的承诺');

  chk(!/免费版不缩水|一件都不少|只加能力/.test(visible),
    '页面不再替表说一遍「免费不缩水」（分组名与打钩本身就是证据）');
}

{

  chk(!/renderAbout\s*\(/.test(PAGE),
    'js/plans.js 不再有 renderAbout()（连定义带调用 —— 「层级谁定的」那两句整段撤了）');
  chk(pageJs.indexOf('tierSource') < 0,
    'js/plans.js 不再读 tierSource（那一段是它唯一的读者）');
  const clean = stripHtml(pageHtml);
  chk(!/层级本机登记/.test(clean) && !/层级由服务器判定/.test(clean),
    '页面可见文字里不再有「层级本机登记，改一行存储就能改。」/「层级由服务器判定，本机改不动。」');
  chk(!/改一行存储/.test(pageJs), 'js/plans.js 里那句文案也删干净了（不留只写在源码里的死话）');
}

{
  chk(!/plans-me\b/.test(pageHtml) && !/plans-me-hint/.test(pageHtml),
    '「现在」那张卡在 HTML 里没有残留挂点（#plans-me / #plans-me-hint 都不在）');
  chk(!/kv-list/.test(pageHtml), '那三行「身份 / 层级 / 落在哪一列」的容器也一并撤了');
  chk(!/plans-about/.test(pageHtml) && !/plans-about/.test(pageJs),
    '「关于这些层级」那张卡也整张撤了（挂点 + 渲染都不留）');
  chk((pageHtml.match(/class="account-card"/g) || []).length === 1,
    '这一页只剩对比表那一张卡（撤掉「现在」卡与「关于」卡之后不再有空壳）');
  chk(!/renderMe\s*\(/.test(PAGE), 'js/plans.js 不再有 renderMe()（连定义带调用）');
  chk(!/renderLoginHint\s*\(/.test(PAGE), 'js/plans.js 不再有 renderLoginHint()');
  chk(!/plans-me-hint/.test(PAGE) && !/plans-me\b/.test(PAGE),
    'js/plans.js 不再提那两个（已撤掉的）挂点');

  chk(!/只差这一条/.test(stripHtml(pageHtml)), '页面可见文字里不再有「只差这一条：登录可用」那句');
  chk(/plans-col-me/.test(PAGE) && /plans-col-me/.test(css),
    '「你在哪一格」仍有一处答案：对比表的列头角标（不是哪都没说）');
}

{
  const forbidden = ['poem_recite_progress_v1', 'poem_recite_collections_v1',
    'poem_device_prefs_v1', 'poem_poems_read_v1', 'poem_classic_read_v1',
    'poem_recite_settings_v1', 'poem_profile_v1'];
  forbidden.forEach(k => chk(PAGE.indexOf(k) < 0, 'js/plans.js 不出现 ' + k));
  chk(!/setItem\(/.test(PAGE), 'js/plans.js 不写任何存储（看表不该留下痕迹）');
}

{
  chk(fs.existsSync(path + 'plans/index.html'), 'plans/index.html 存在');
  chk(/<base href="\/"/.test(pageHtml), '带 <base href="/">（子目录页面里相对资源才解析得对）');
  chk(/js\/chrome\.js/.test(pageHtml), '加载 js/chrome.js（顶栏 + 页签的唯一来源）');
  chk(/js\/pwa\.js/.test(pageHtml), '加载 js/pwa.js（--nav-h 每页都要实测）');
  chk(/js\/entitlement\.js/.test(pageHtml), '加载 js/entitlement.js（权益总闸）');
  chk(/js\/plans\.js/.test(pageHtml), '加载 js/plans.js（本页逻辑）');
  chk(/<header class="topbar"/.test(pageHtml), '有顶栏挂载点');
  chk(/data-page="层级对比"/.test(pageHtml), '声明页名「层级对比」');

  // Issue #229 第五轮：卡片顶上那一行（caption）文案收成「功能对比」，
  // 并按卡片里其它小标题的样子显示（与 .account-card-title 同一套字号 / 字重 / 颜色）。
  {
    chk(/<caption class="plans-caption">功能对比<\/caption>/.test(pageHtml),
      'caption 文案是「功能对比」（不再写一长句「各身份可用功能对照」）');
    chk(!/各身份可用功能对照/.test(stripHtml(pageHtml)),
      '旧的长句在页面可见文字里不再出现');
    chk(/\.plans-caption \{[\s\S]{0,300}?font-size: 13px/.test(css) &&
        /\.plans-caption \{[\s\S]{0,300}?font-weight: 600/.test(css) &&
        /\.plans-caption \{[\s\S]{0,300}?letter-spacing: \.8px/.test(css),
      'caption 的字号 / 字重 / 字距与 .account-card-title 同一套（13px · 600 · .8px）');
    const title = (css.match(/\.account-card-title \{([\s\S]{0,300}?)\}/) || [0, ''])[1];
    const cap = (css.match(/\.plans-caption \{([\s\S]{0,300}?)\}/) || [0, ''])[1];
    ['font-size: 13px', 'font-weight: 600', 'letter-spacing: .8px', 'color: var(--ink-2)']
      .forEach(rule => {
        chk(title.indexOf(rule) >= 0 && cap.indexOf(rule) >= 0,
          'caption 与卡片小标题共用「' + rule + '」');
      });
    chk(!/11\.5px/.test(cap), 'caption 不再是 11.5px 的浅色小字');
  }
  chk(/data-dock="off"/.test(pageHtml), '声明 data-dock="off"（看完就走的页不挂底部页签）');
  chk(/data-back="\/settings\/"/.test(pageHtml),
    '返回落点回设置整页「关于」那一段（用户 2026-09-18：入口从「我的」页首卡改成「关于」里的一行链接）');
  chk(!/class="foot/.test(pageHtml), '没有页底页脚（版权 + 法务链接已删）');

  const at = n => pageHtml.indexOf('<script src="/js/' + n + '"></script>');
  chk(at('auth-core.js') >= 0 && at('auth-core.js') < at('entitlement.js'),
    'auth-core 排在 entitlement 之前（先有会话再算权益）');
  chk(at('plans.js') < at('chrome.js'), 'js/plans.js 排在 js/chrome.js 之前');

  chk(/plans: "\/plans\/"/.test(chromeJs), 'js/chrome.js 的 ROUTES 里有 /plans/');
  chk(/"plans"/.test(chromeJs) || /'plans'/.test(chromeJs),
    'js/chrome.js 认得 plans 这个页签键（否则顶栏页名会退回首页）');
}

{

  chk(/\/plans\//.test(mineHtml), '「我的」页有进对比页的入口（它在「关于」卡里）');
  chk(/id="about-card"[\s\S]{0,900}?href="\/plans\//.test(mineHtml),
    '那一行落在「关于」卡里（2026-09-20 随个人中心那张卡并进来）');

  // 用户 2026-09-18：这一颗改成链接。<a href="/plans/"> 自己带着地址 ——
  // 不点 JS、中键新开、键盘可达，还没跑脚本时也走得通。
  chk(/<a class="kv-link" href="\/plans\/">层级对比<\/a>/.test(mineHtml),
    '它是一个 <a href="/plans/"> 链接（用户 2026-09-18：这颗键改成链接）');
  chk(!/<button[^>]*href="\/plans\/"/.test(mineHtml) && !/btn-go-plans/.test(mineHtml),
    '它不再是一颗 <button>（那个 id 也不留了）');
  chk(!/location\.href = "\/plans\/"/.test(mineJs),
    'js/mine.js 不为它绑一段跳转（地址就写在 <a> 上）');

  chk(/Ent\.compare\(/.test(PAGE), '对比表一律由 compare() 生成（清单的唯一一处）');
  chk(!/Ent\.matrix\(/.test(mineJs),
    '「我的」页不自己画一遍能力清单（同一件事只在一页说）');
  chk(/层级对比/.test(stripHtml(mineHtml)),
    '那一行文案说清它去哪（「层级对比」—— 与页名同一个词，用户 2026-09-18 点名）');
}

{
  chk(sw.indexOf('"./plans/"') >= 0, 'sw.js 预缓存里有 ./plans/（断网也进得去）');
  chk(sw.indexOf('"./js/plans.js"') >= 0, 'sw.js 预缓存里有 js/plans.js');
  const ver = parseInt((sw.match(/poem-app-v(\d+)/) || [0, '0'])[1], 10);
  chk(ver >= 188, '缓存版本已跟着提（本轮 Issue #244 改了入口所在的那一页，实际 v' + ver + '）');
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

{
  chk(/\.plans-table/.test(css), 'css/account.css 里有对比表的样式');
  chk(/\.plans-scroll/.test(css) && /overflow-x:\s*auto/.test(css),
    '四列在手机上横向可滚（否则最右一列会被挤出屏幕）');
  chk(/position:\s*sticky/.test(css) && /left:\s*0/.test(css),
    '第一列（对比项）粘在左边不跟着滚 —— 滚到第三列还得知道在看哪一行');
  chk(/\.plans-mark\.ok/.test(css) && /\.plans-mark\.no/.test(css),
    '打钩与打叉各有自己的样子（不是同一个符号换色）');

  // 用户 2026-09-18（Issue #229 第二轮）：

  // 「绿色打钩的图标需要换一个很正的√，现在看上去有点手写的样子。」
  // 字体里的 ✓ 是各家字体的自由发挥、笔形带手写的歪劲，所以「可用」改用
  // 一枚 SVG 勾：两条线段按坐标落，任何机器上都是同一个形状。
  {
    const at = pageJs.indexOf('function markSvg(');
    chk(at >= 0, 'js/plans.js 里有一个画记号的 markSvg(path)（勾与叉共用）');
    const fn = at >= 0 ? pageJs.slice(at, pageJs.indexOf('function nameHtml', at)) : '';

    chk(/<svg/.test(fn), '那颗记号是一枚 <svg>（不是字体里的字符）');
    chk(/viewBox="0 0 24 24"/.test(fn),
      '带 viewBox \'0 0 24 24\'：坐标写在 24 的方格上，与字号 / 字体无关');
    chk(/stroke="currentColor"/.test(fn),
      '描边走 currentColor（颜色仍由 .plans-mark.ok / .no 给，不另写色值）');
    chk(/stroke-linecap="round"/.test(fn) && /stroke-linejoin="round"/.test(fn),
      '两个笔尖与折点都是圆的（与胶囊同一套收口，不是刀切的方头）');
    chk(/aria-hidden="true"/.test(fn) && /focusable="false"/.test(fn),
      '装饰性的记号不进无障碍树（可用不可用由格子的文案回答）');
    chk(!/stroke-width="1"/.test(fn), '有实际的笔画粗细（默认 1 太细，缩到 14px 就看不清）');

    // 两条调用各给一条路径：勾走 CHECK_PATH，叉走 CROSS_PATH
    chk(/function markOkSvg\(\) \{ return markSvg\(CHECK_PATH\); \}/.test(pageJs),
      'markOkSvg() 把 CHECK_PATH 套进模子');
    chk(/function markNoSvg\(\) \{ return markSvg\(CROSS_PATH\); \}/.test(pageJs),
      'markNoSvg() 把 CROSS_PATH 套进同一个模子');
    chk(!/MARK_NO\s*=/.test(pageJs), '那个字体里的 ✕（MARK_NO）已经交班给它自己的 SVG');

    // 路径写在一条具名常量里（表里 / 图例是同一份），markOkSvg() 只是把它套进 <svg>
    chk(fn.indexOf('CHECK_PATH') >= 0, 'd 取的是那条具名常量 CHECK_PATH（不在两处各写一遍坐标）');
    const path = (pageJs.match(/CHECK_PATH\s*=\s*"([^"]+)"/) || [0, ''])[1];
    chk(path.length > 0, '勾的路径写在代码里（实际 CHECK_PATH = "' + path + '"）');
    const nums = (path.match(/-?\d+(\.\d+)?/g) || []).map(Number);
    chk(nums.length === 6, '勾是**一条**折线：三个点（起笔 / 折点 / 收笔），共 6 个坐标');
    if (nums.length === 6) {
      const [x1, y1, x2, y2, x3, y3] = nums;
      chk(y2 > y1 && y2 > y3, '折点比两端都低 —— 它在下面，这是一个「勾」不是「∧」');
      chk(x1 < x2 && x2 < x3, '三个点从左到右（起笔在左、折点居中、收笔在右）');
      const short = Math.abs(x2 - x1), long = Math.abs(x3 - x2);
      chk(long > short * 1.2,
        '收笔那一笔明显比起笔长（实际 ' + long + ' : ' + short + '）——' +
        '两条等长的斜线拼出来就是手写样，左短右长才是印刷体的正勾');
      // 两笔大致是 45° 上下（斜率 ≈ 1）：左短笔略平、右长笔略陡，
      // 斜率飘到 1.5 以上就成了「一根竖线 + 一根斜线」，不是勾。
      const k1 = Math.abs((y2 - y1) / (x2 - x1));
      const k2 = Math.abs((y2 - y3) / (x3 - x2));
      chk(k1 > 0.5 && k1 < 1.4 && k2 > 0.5 && k2 < 1.4,
        '两笔都大致 45°（实际斜率 ' + k1.toFixed(2) + ' / ' + k2.toFixed(2) +
        '）—— 陡成一根竖线就不成勾了');
      chk(Math.min(x1, y1, x3, y3) >= 2 && Math.max(x2, y2, x3, y3) <= 22,
        '勾落在放大到 24 的方格里、四周留着余白（顶到圆边就贴死了）');
    }
  }

  // 反面：字体里的 ✓ / ✕ 不许再回来（写回字符串就是退回手写样 / 歪心样）
  chk(!/MARK_OK\s*=\s*["']✓["']/.test(pageJs),
    'js/plans.js 里不再有 MARK_OK = "✓"（那个字符正是手写观感的来源）');
  chk(!/>\s*✓\s*</.test(pageJs) && !/>\s*✓\s*</.test(stripHtml(pageHtml)),
    'JS 与 HTML 里都不再把 ✓ 直接写进标签里');
  chk(!/>\s*✕\s*</.test(pageJs) && !/>\s*✕\s*</.test(stripHtml(pageHtml)),
    'JS 与 HTML 里都不再把字体里的 ✕ 写进标签里（Issue #229 第五轮：它也换成了 SVG）');

  // 页底那行图例（「√ 可用 · ✕ 不可用」）整行删掉 —— 圆里的图形自己说得清。
  {
    const visible = stripHtml(pageHtml).replace(/\s+/g, ' ');
    chk(!/可用\s*·\s*不可用/.test(visible), '页底不再有「√ 可用 · ✕ 不可用」那行图例');
    chk(!/account-hint/.test(pageHtml), '图例那个容器（.account-hint）也一并撤了');
    chk(!/account-hint .plans-mark/.test(css), 'css 里为图例写的那一条（.account-hint .plans-mark）也撤了');
  }

  chk(/\.plans-mark-svg/.test(css), 'css 里那颗 SVG 有自己的一段（.plans-mark-svg）');
  chk(/\.plans-mark-svg \{[\s\S]{0,200}?width: 14px/.test(css) &&
      /\.plans-mark-svg \{[\s\S]{0,200}?height: 14px/.test(css),
    'SVG 是 14px 见方（略小于 18px 的圆，四周留出 2px 余白）');

  // Issue #229 第五轮：圆用 flex 居中 —— 圆心对圆心，不再各自带着字体墨迹盒碰运气。
  // 先量：✕ 这颗字符按基线坐，圆底要空出一块（用户点名「打叉图标…偏下」）。
  chk(/\.plans-mark \{[\s\S]{0,300}?display: inline-flex/.test(css) &&
      /\.plans-mark \{[\s\S]{0,300}?align-items: center/.test(css) &&
      /\.plans-mark \{[\s\S]{0,300}?justify-content: center/.test(css),
    '圆是 inline-flex + 双向居中：勾与叉都由圆心定位（不再靠 line-height）');
  chk(!/\.plans-mark \{[\s\S]{0,300}?line-height: 18px/.test(css),
    '那一条 line-height: 18px（字符记号的居中方式）已经撤了');

  // 两条路径的外接盒都居中在 24 的方格上 -> 圆里看着就是正的
  {
    const box = (p) => {
      const n = p.match(/-?\d+(\.\d+)?/g).map(Number);
      const xs = [], ys = [];
      for (let i = 0; i < n.length; i += 2) { xs.push(n[i]); ys.push(n[i + 1]); }
      return { x1: Math.min.apply(null, xs), x2: Math.max.apply(null, xs),
               y1: Math.min.apply(null, ys), y2: Math.max.apply(null, ys) };
    };
    [['CHECK_PATH', '勾'], ['CROSS_PATH', '叉']].forEach(([name, label]) => {
      const p = (pageJs.match(new RegExp(name + '\\s*=\\s*"([^"]+)"')) || [0, ''])[1];
      chk(p.length > 0, label + '的路径写在具名常量 ' + name + ' 里');
      if (!p.length) return;
      const b = box(p);
      chk(Math.abs((b.x1 + b.x2) / 2 - 12) < 0.01 && Math.abs((b.y1 + b.y2) / 2 - 12) < 0.01,
        label + '的外接盒中心 = (12,12)，正落在 24 方格的中央（圆里才不偏）');
      const w = b.x2 - b.x1, h = b.y2 - b.y1;
      chk(w <= 18 && h <= 18, label + '不顶到圆边（外接盒 ' + w.toFixed(1) + '×' + h.toFixed(1) + '）');
    });
    const cross = box((pageJs.match(/CROSS_PATH\s*=\s*"([^"]+)"/) || [0, ''])[1]);
    const crossNums = (pageJs.match(/CROSS_PATH\s*=\s*"([^"]+)"/) || [0, ''])[1]
      .match(/-?\d+(\.\d+)?/g).map(Number);
    chk(crossNums.length === 8, '叉是**两条**直线：四个端点，共 8 个坐标');
    chk(cross.x1 === cross.y1 && cross.x2 === cross.y2,
      '叉的两端在同一对角线上（x1=y1、x2=y2）—— 它才是个正叉，不是歪的');
  }
  chk(/\.plans-col-me/.test(css), '「你现在在这」那一列有高亮');

  chk(/\.plans-th-cap \{[\s\S]{0,400}?max-width: 132px/.test(css),
    '功能列收窄（max-width: 132px，原先 150px 起步 + 表格总宽 468px 顶着）');
  chk(/\.plans-cell \{[\s\S]{0,300}?min-width: 42px/.test(css),
    '四列各有最小宽（42px + 左右 padding = 50px 一格 \(五位数额度也放得下\)）');

  chk(/\.plans-table \{[\s\S]{0,400}?min-width: 0/.test(css),
    '\.plans-table 不再声明一个「放不下就横滚」的总宽（宽度交给四列的最小宽回答）');
  chk(!/min-width: 4[0-9][0-9]px/.test(css.slice(css.indexOf('.plans-scroll'))),
    '对比表这一节里没有 4xx px 那种老总宽残留（四列进不进屏不再被一个总数挡住）');

  chk(/@media \(max-width: 360px\)[\s\S]*?\.plans-cell \{ min-width: 38px/.test(css),
    '窄机（≤360px）再收一档：功能列与四列同时让一步，四列仍然进屏');
  chk(/@media \(min-width: 768px\)[\s\S]*?\.plans-th-cap \{ width: auto; max-width: 240px/.test(css),
    '平板 / 桌面把功能列放宽（长名一行放得下，不必折两行）');
  const palette = read('css/style.css') + read('css/classic.css') + read('css/legal.css');
  const mine = css.slice(css.indexOf('.plans-scroll'));
  const hex = (mine.replace(/rgba?\([^)]*\)/g, '').match(/#[0-9a-fA-F]{6}/g) || [])
    .filter(h => palette.toLowerCase().indexOf(h.toLowerCase()) < 0);
  chk(hex.length === 0,
    '对比表不写死任何「全站调色板里没有的」十六进制色值（实际 ' + [...new Set(hex)].join(',') + '）');
}

console.log('\n' + (fails ? '❌ ' + fails + ' 项失败' : '🎉 层级对比页测试全部通过'));
process.exit(fails ? 1 : 0);
