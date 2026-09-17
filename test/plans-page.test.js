/**
 * 层级对比页专项测试（Issue #132 · /plans/）
 * ==========================================================================
 * 用户提的：「像其他网站那样，最左边是对比项，右边几列是不同角色，
 * 下面用打钩打叉」。落地为四列：游客 / Free / Pro / Max。
 *
 * Issue #163（用户 2026-09-18）又在这一页上提了一串「说得更短、看得更全」：
 *   · 第一列改称「游客」，角标「你现在在这」→「现在」；
 *   · 功能列收窄一半，右侧四列尽量都进屏幕；
 *   · 能力名逐个收短（额度数字从名字里搬到**各列**上，见 CAPS 的 `quotas`）；
 *   · 表尾「能用」→「合计」。
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
/** 只剥注释的原文（有些断言要看注释里记的来龙去脉） */
const plansCommentOnly = pageJs;

/* ============ 一、表格如实：每格都等于 can() 的答案 ============ */
{
  const cmp = Ent.compare({});
  chk(cmp.cols.length === 4, '对比表有四列（未登录 / Free / Pro / Max）');
  chk(cmp.cols.map(c => c.id).join(',') === 'guest,free,pro,max',
    '四列的顺序是 未登录 → Free → Pro → Max（从低到高，最左是最弱的身份）');
  chk(cmp.cols.map(c => c.label).join(',') === '游客,Free,Pro,Max',
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

  // 钩的形态：能用 = 打钩（+ 有额度就写数字）、不能用 = 打叉 + 一句门槛
  chk(cmp.rows.every(r => r.cells.every(c => c.ok ? true : !!c.hint)),
    '不能用的格子一定有门槛文案（「登录可用」/「Pro 起」）');
  /* Issue #163：额度数字**长在格子上**（用户原话「直接在各列列出数字」）——
     自选清单 10 / 100 / 5000、家庭档案 1 / 3 / 180、课内诗词导出 261 首。
     这一条把「数字在表里真的看得见」钉住：改回「都塞进功能名」就红。 */
  const capRow = n => cmp.rows.find(r => r.cap === n);
  chk(capRow('collections.many').cells[1].quota === 10 &&
      capRow('collections.many').cells[2].quota === 100 &&
      capRow('collections.many').cells[3].quota === 5000,
    '自选清单三档额度在**格子上**：Free 10 / Pro 100 / Max 5000');
  chk(capRow('profile.family').cells[1].quota === 1 &&
      capRow('profile.family').cells[2].quota === 3 &&
      capRow('profile.family').cells[3].quota === 180,
    '家庭档案三档在格子上：1 / 3 / 180');
  chk(capRow('export.all').cells[2].quota === 261 && capRow('export.all').cells[3].quota === 261,
    '课内诗词导出：Pro / Max 两列都列出 261 首');
  chk(capRow('export.all').cells[2].hint === '261 个',
    '能用的格子里带额度数字（不只是打钩，用户点名要「直接列出数字」）：' + capRow('export.all').cells[2].hint);
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
  /* Issue #163：用户点的就是「对比项也不够精简」。分组注解原先三组各一句
     （「免费且不缩水 —— 课内 261 首、六部集子…一件都不收回」之类），
     现在只留 max 那一句还有信息量的。判据取**长度**，不取措辞。 */
  const notes = cmp.groups.map(g => g.note || '');
  chk(notes.every(n => n.length <= 20),
    '分组注解不超过一句 20 字（实际：' + notes.map(n => n.length).join(' / ') + '）');
  chk(cmp.groups[0].note == null && cmp.groups[1].note == null,
    '「所有版本都有」「Pro 起」两组不再挂一句解释（组名自己已经说完）');

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

/* ============ 三之二、Issue #163：名字收短 / 两行那句话 / 表尾改称「合计」 ============ */
{
  const cmp = Ent.compare({});
  /* 能力名逐个收短（用户点名的十二处）。判据是**内核里的名字**，
     不是页面画出来的字 —— 名字只有一个来源，页面只是把它画出来。 */
  const want = {
    'recite.basic': '每日背诵', 'library.all': '课外阅读', 'read.aloud': '语音朗读',
    'pinyin.helper': '阅读辅助', 'export.progress': '进度导出',
    'collections.many': '自选清单', 'sync.multiDevice': '设备同步',
    'export.paper': 'PDF / 打印', 'profile.family': '家庭档案',
    'quiz.review': '题库', 'export.all': '课内诗词导出',
    'exam.gathering': '古诗词大会', 'exam.paper': '试题模拟'
  };
  Object.keys(want).forEach(k => {
    const row = cmp.rows.find(r => r.cap === k);
    chk(row && row.name === want[k], k + ' 的名字是「' + want[k] + '」（实际 ' +
      (row ? row.name : '(缺这一行)') + '）');
  });
  /* ⚠️ 2026-09-19（Issue #163 末条）：用户把「分两行」那个折中**否掉了** ——
     「是要拆成两个表格行，不是换行 这是两个功能，一个是古诗词大会的集子的
      访问权限，一个是在线试题模拟的权限」。
     所以现在判的是**两行、两个钩叉**（不是一个格子里两行字）：
       · `exam.gathering` →「古诗词大会」—— 那条**集子**的访问权限
       · `exam.paper`     →「试题模拟」—— 在线出题 · 判分
     反面判据：页面里不许再有那个「一个格子写两件事」的写法。 */
  const gRow = cmp.rows.find(r => r.cap === 'exam.gathering');
  const pRow = cmp.rows.find(r => r.cap === 'exam.paper');
  chk(!!gRow && !!pRow, '对比表上是**两行**：exam.gathering 与 exam.paper');
  chk(!/TWO_LINE/.test(PAGE), 'js/plans.js 里不再有「一个格子分两行」的写法（TWO_LINE 已撤）');
  chk(!/plans-cap-line/.test(PAGE) && !/plans-cap-line/.test(css),
    '那个只为分两行而生的样式也一并撤了（不留死样式）');
  chk(gRow.name !== pRow.name, '两行的名字各自独立：「' + gRow.name + '」/「' + pRow.name + '」');
  /* ⚠️ 拆的是**能力**：`exam.paper` 这个键名一个字都没动（服务端 featuresFor 对拍）。 */
  chk(!!Ent.cap('exam.paper'), 'exam.paper 键名照旧（拆的是能力，不是键名）');
  /* 表尾改称「合计」：这一格不再借「能用」那个词表态。 */
  chk(/合计/.test(PAGE), '表尾那一格写作「合计」（Issue #163：能用 → 合计）');
  chk(!/['"]能用['"]/.test(PAGE), 'js/plans.js 里不再出现「能用」这个表尾词');
  /* 那两行的**渲染结果**：各是一行，各有自己的钩叉格子（判的是画出来的东西，
     不是「源码里有这个词」）。compare() 给的分组里逐行找。 */
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
  chk(/你现在在这/.test(plansCommentOnly), '注释里留了改名的来龙去脉（「你现在这」是从哪来的）');
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
  /* Issue #163：顶上那张「免费版不缩水：全部篇目、每日排程、注音、进度导出
     一件不少。Pro / Max 只加能力」的卡**删了** —— 那是把表第一组又说一遍
     （分组名「所有版本都有」+ 每格打钩就是那句证据）。所以断言从
     「页面里必须有这句话」翻成「不许再有这句替表说话的话」。 */
  chk(!/免费版不缩水|一件都不少|只加能力/.test(visible),
    '页面不再替表说一遍「免费不缩水」（分组名与打钩本身就是证据）');
}

/* ====== 五之二、2.1：层级**是谁定的** —— 两种状态各说各的实话 ====== */
{
  /* 判据只有一个：id.tierSource（服务端判定的唯一凭据）。
     这一节不看页面画出来的字（那要 jsdom），而是直接对着那段源码判：
     两种状态各说各的实话，且都是一句。 */
  const rb = pageJs.slice(pageJs.indexOf('function renderAbout'), pageJs.indexOf('function renderAbout') + 1400);
  chk(!!rb, 'js/plans.js 里有 renderAbout()（那一段的渲染入口）');
  chk(/tierSource === "server"/.test(rb),
    'renderAbout() 按 tierSource 分叉（不自己猜、不自己比 tier）');
  chk(/由服务器判定/.test(rb), '服务端那份：页面上说明层级「由服务器判定」');
  chk(/本机登记/.test(rb), '本机那份：页面上说明层级是「本机登记」');
  /* Issue #163 翻面：原先两种状态后面还各接一句「本站无收款、无支付入口，
     层级不是付费凭据」—— 用户点名的就是这种「说了等于没说」的话。
     现在**不许**再出现：那一页要回答的是「这些层级是什么」，不是「本站卖不卖东西」。 */
  chk(!/无收款|不是付费凭据/.test(rb),
    '页面不再替本站解释「不收款、不是付费凭据」（层级是什么才是这一页的问题）');
  /* 只留一句：那一段的每个分支都不许出现第二个句号（不许一句接一句） */
  const aboutBranches = rb.match(/"[^"]*。"/g) || [];
  chk(aboutBranches.every(b => (b.match(/。/g) || []).length === 1),
    '两种状态各只留一句（实际：' + aboutBranches.join(' / ') + '）');
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
  /* Issue #163 第三轮：「权限」那一节整节撤掉，进表的那颗键并进「关于」卡
     底下那一行（与「同步设置」「管理后台」同类：都是「去别处」）。 */
  chk(/btn-go-plans/.test(profileHtml), '个人中心有进对比页的按钮（现在在「关于」卡那一行里）');
  chk(/class="account-actions"[\s\S]{0,400}?btn-go-plans/.test(profileHtml),
    '它与「同步设置」并排在同一行操作键里');
  chk(/btn-go-plans/.test(profileJs), '那颗按钮真的绑了跳转（不是摆着不动的）');
  chk(/location\.href = "\/plans\/"/.test(profileJs), '按钮跳到 /plans/');
  // 两边同源：个人中心的清单与对比页同走 Entitlement
  /* Issue #163：个人中心**不再自己画一份清单** —— 能力清单只有 /plans/ 一处，
     两边就不再是「各抄一份」的关系了。判据从「两边同源」翻成「只有一处」。 */
  chk(/Ent\.compare\(/.test(PAGE), '对比表一律由 compare() 生成（清单的唯一一处）');
  chk(!/Ent\.matrix\(/.test(profileJs),
    '个人中心不再自己画一遍能力清单（同一件事只在一页说）');
  chk(/权限对比/.test(stripHtml(profileHtml)),
    '按钮文案说清它去哪（「权限对比」—— 这一节的去处只有它）');
}

/* ============ 九、离线：页面与脚本都进预缓存，版本号跟着提 ============ */
{
  chk(sw.indexOf('"./plans/"') >= 0, 'sw.js 预缓存里有 ./plans/（断网也进得去）');
  chk(sw.indexOf('"./js/plans.js"') >= 0, 'sw.js 预缓存里有 js/plans.js');
  const ver = parseInt((sw.match(/poem-app-v(\d+)/) || [0, '0'])[1], 10);
  chk(ver >= 132, '缓存版本已跟着提（本轮 Issue #163 改了本页 / 内核 / 数据层，实际 v' + ver + '）');
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
  /* ---------- Issue #163：功能列收窄一半、四列尽量都进屏幕 ----------
     用户原话：「功能列，减少一半的宽度，让右侧四列尽可能多的显示进屏幕」。
     落地靠三件事（缺一不可）：功能列收窄、四列各有最小宽、默认不再靠总宽顶。
     判据全部对着 **css/account.css** 的数值判 —— 这几条数值之间是绑死的，
     改一条忘了另几条，症状就是「四列又被挤出去了」。 */
  chk(/\.plans-th-cap \{[\s\S]{0,400}?max-width: 132px/.test(css),
    '功能列收窄（max-width: 132px，原先 150px 起步 + 表格总宽 468px 顶着）');
  chk(/\.plans-cell \{[\s\S]{0,300}?min-width: 42px/.test(css),
    '四列各有最小宽（42px + 左右 padding = 50px 一格 \(五位数额度也放得下\)）');
  /* ⚠️ 反向那条最要紧：`.plans-table` 的 `min-width` 只要大于四列之和，
     四列就必然被挤出屏幕（这正是 #163 之前的样子：468px）。 */
  chk(/\.plans-table \{[\s\S]{0,400}?min-width: 0/.test(css),
    '\.plans-table 不再声明一个「放不下就横滚」的总宽（宽度交给四列的最小宽回答）');
  chk(!/min-width: 4[0-9][0-9]px/.test(css.slice(css.indexOf('.plans-scroll'))),
    '对比表这一节里没有 4xx px 那种老总宽残留（四列进不进屏不再被一个总数挡住）');
  // 两档收边：窄机收功能列（四列仍然进屏）、平板放宽功能列（长名不折两行）
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
