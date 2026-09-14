/**
 * 全站搜索（/search/ · 六部集子一次搜遍：课内诗词 + 五部选集）
 * ==========================================================================
 * 这一页与 js/classic.js / js/tangshi.js / js/songci.js / js/guwen.js 同族，
 * 但有三处根本差别：
 *
 *   一、**数据来源**：其余几页各取自己那一部的 window.POEMS_*；
 *       这一页取 data/site-index.js 的 window.SITE_INDEX ——
 *       那张表本来就是「全站篇目汇总」，搜索要的正是它。
 *       在页面里再拼一次六部，日后加第七部就会漏一处。
 *
 *   二、**搜什么**：集子索引页只在「篇名 / 作者 / 朝代 / 出处」里找；
 *       搜索页还要搜**正文与译文**（extraFields: text / translation）。
 *       用户记不住篇名的时候，往往只记得住一句话 ——
 *       「先天下之忧而忧」要能搜到《岳阳楼记》，这是搜索页存在的理由。
 *
 *   三、**什么时候列**：没输入关键词时**一条都不列**（列表区为空），
 *       输入之后才列出命中的篇目，且字数越多命中越少。
 *       这一页是「查东西」的地方，不是「读东西」的地方：
 *       把上千篇一次性铺出来，既没有人会从头翻，首屏还要为它渲染上千个
 *       DOM 节点（用户反馈的「加载有性能问题」就是这里）。
 *
 * 每条结果的 id 带集子前缀（`tangshi-ts-12`）：六部的原 id 各自从 1 排起，
 * 必然撞在一起；带前缀才是全站唯一键，也顺带说明了「这一条出自哪一部」。
 *
 *   四、**移动端**（见下面的「屏幕键盘」一节）：软键盘是浮在页面上的，
 *       它不会改变窗口高度，搜索框又在视口中央 —— 一动键盘，
 *       候选下拉正好落在键盘底下。这里把整个搜索区顶到键盘上方，
 *       并在键盘弹出时压掉搜索框下方的留白：候选贴着框、结果紧跟着出现在第一屏。
 *
 *   五、**搜索框该待在哪儿**（用户这一轮的三条要求）：
 *       ① 聚焦在搜索框 → 框挪到标题栏下方，候选下拉跟着上去；
 *       ② 有搜索内容 → 框停在页面顶部（失焦也不回去）；
 *       ③ 清了内容、也没有焦点 → 框回到页面中心。
 *       三条合起来就是 .search-hero 的两个类（见 syncHeroState 与
 *       css/classic.css 的「搜索框的三种摆法」）：焦点与内容合成一个
 *       search-active（两者的落位一模一样），键盘弹着时再叠一个 kb-open。
 *       焦点在框里时那圈边框也不再是浏览器给的黑线（见 css 的 :focus 那条）。
 *
 *   六、**点空白处收下拉**（同一轮）：
 *       用户在页面上任何一处空白点一下（结果卡片、列表下方、页面两侧……），
 *       候选下拉就收起来。判据只有一条：落点在搜索区（输入框 + 下拉）之外。
 *       挂在 document 的 capture 阶段，只收下拉、不阻断事件 ——
 *       点卡片该开篇还是开篇。
 *
 *   七、**候选下拉的分寸**（上一轮的三条反馈）：
 *       ① 下面几条被键盘盖住 → 下拉的 max-height 里带一项
 *          「可视区 − 键盘 − 框下沿到页顶」，键盘弹着时它最小，下拉自然收在键盘上方；
 *       ② 要能关掉下拉再去点结果卡片 → 下拉的高度同时受「可视区的四成」约束，
 *          绝不铺满键盘上方那片地方，底下始终留着可见的结果区（点它即收起下拉）；
 *       ③ 没输入时的引导语（「输入篇名、作者或诗句，即可搜遍六部集子」）整段撤掉：
 *          空列表就是空列表，只留一段留白（见 css/classic.css 的 #gw-list .empty）。
 *       此外「框 → 结果列表」的间距收成正常间隔：框贴顶时列表紧跟着它，
 *       只有框还浮在页面中间时才留一小段（见 #gw-list 的 padding-top）。
 *
 * 已读存储：搜索页**不写任何已读键**（readStore 为空字符串）。
 *   「已读」是每一部自己的进度（poem_classic_read_v1 等），
 *   在搜索页点一下不该改动任何一部的进度 —— 用户是来查东西的，不是来读书的。
 *   阅读器里的「标记已读」按钮因此整颗隐藏（见 reader-core.js 的 hasReadStore）。
 *
 * 筛选：本页**不做任何筛选**。「全部」就是默认且唯一的口径 ——
 *   原先那两栏（「全部 / 未读」组合按钮、集子药丸）都撤了：
 *   前者筛的是「已读」，而这一页根本不写已读，键名一直是空的；
 *   后者是「先选一部再搜」，多一步前置操作，却没有任何人会先想好搜哪一部。
 */

(function () {
  "use strict";

  /** 候选下拉最多几条：够用即可，多了挡住结果列表 */
  var SUGGEST_MAX = 8;

  /** 屏幕键盘的余量：iOS 的键盘高度系统不给，只能自己按可视区反推。
      键盘上方那一片可视区（visualViewport.height）再减掉：
        · 搜索框自身（hero 里的 52px，框高即布局高度 —— 见 css/classic.css）
        · 顶栏与它下面那一点点留白（约 30px）
      剩下的就是「下拉可以占的高度 + 下拉下面那片留给结果的空间」。
      这个值只用来写 --kb-space，下拉用它算 max-height 的硬上限 ——
      宁可按「键盘比实际更高」估，也不能伸到键盘底下。
      要注意它是**上边界**而不是「下拉就该占满」：下拉实际高度还受
      min() 里那两项（400px、40%/60% 可视区）约束，
      所以手机上剩下的那几成可视区，正是用户能点到的结果卡片。 */
  var KB_CHROME = 86;

  /** 软键盘弹起后，视觉视口比布局视口矮多少才算「键盘真的出来了」。
      安卓上地址栏收起 / 展开、iOS 上底部横条都会带来几十像素的抖动，
      120px 这个门槛越过了全部这些抖动，只有真正的键盘（>= 216px）才算数。 */
  var KB_MIN = 120;

  /** 得到焦点后，等多久再让输入框贴上顶栏。
      刚聚焦就把整块顶上去的话，用户看着内容先跳一下、键盘才滑出来，
      像是点错了地方；等键盘开始滑（约 250ms）后再动，跳变与键盘同时发生，
      读起来就是「搜索框跟着键盘一起上来」。 */
  var FOCUS_LIFT_DELAY = 250;

  /** 失焦后收回的延迟：比 suggest 的 180ms 略长，
      免得「点候选 → 那 180ms 的收纳定时器」与收回撞在一起、
      整块在候选被点中的同一帧里又滑回去。 */
  var BLUR_SETTLE_DELAY = 220;

  /** 失焦后延迟收起候选下拉的时间。
      必须给这一段：鼠标点候选时先触发 blur，立刻收起就点不到了
      （click 会落在已经消失的按钮上）。180ms 够指针完成这一下，
      又短到用户感觉不出「点了以后还赖着」。 */
  var SUGGEST_BLUR_DELAY = 180;

  /** 用户开始滚动**结果列表**多久之后收起候选下拉。
      滚结果意味着用户已经在看下面的内容了，下拉还挂在框底下就是挡住视线的一块浮层 ——
      「要看下面那几条结果，得先想办法把下拉关掉」正是用户反馈的下一半。
      ⚠️ 这里用「延迟」而不是「滚一下立刻收」：触屏滑动开头那几像素
        常是手指落下的抖动，立刻收会让下拉在用户还没决定要滚的时候先消失。
        140ms 够越过这段抖动，又短到与滑动同时发生（不是滚完才收）。 */
  var SCROLL_HIDE_DELAY = 140;

  /** 空态里的两句话，一处给出（syncEmptyState 与 mountCfg 都读它）。
      · EMPTY_IDLE —— 没输入关键词时的那一句。**视觉上已经不再显示**：
        用户要求删掉「输入篇名、作者或诗句，即可搜遍六部集子」这段文字，
        空列表就是空列表（见 css/classic.css 里 `#gw-list .empty` 那一条：
        字号归零、只留一段留白）。这里仍把这句话写在**节点的文本里**，
        是因为它同时是两个东西的出口：
          a) 读屏软件读到它，才知道「这一页能搜什么」——纯空白对无障碍是黑盒；
          b) test/search.test.js 用它在源码 / DOM 层面确认「空态给的是引导语，
             不是『没有找到匹配的篇目』」这条口径没有丢。
        日后若要恢复文案，把 CSS 里的字号改回去即可，逻辑一行不用动。
      · EMPTY_MISS —— 输入之后没命中的那一句，照常显示。 */
  var EMPTY_IDLE = "输入篇名、作者或诗句，即可搜遍六部集子";
  var EMPTY_MISS = "没有找到匹配的篇目";

  var api = null;
  var suggestIndex = -1;   // 键盘上下键当前选中的候选序号

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------------- 篇目集合 ---------------- */

  /**
   * 真正的「篇目」：总索引里除了每一部自己的条目，还各挂一条
   * 「集子自身」（isBook，用来搜「唐诗三百首」四个字直接进那一页）。
   * 计数要把它排除掉 —— 否则「共 N 篇」「唐诗 302 首」都会比实际多一条，
   * 读起来就是错的。集子条目仍留在候选与结果里（搜集子名要能命中它）。
   */
  function allItems() {
    var list = (window.SITE_INDEX || []).filter(function (p) { return !p.isBook; });
    // 同一篇作品只留一条：课内《静夜思》与唐诗《夜思》正文一致、是同一篇，
    // 不该在结果里出现两条（点哪一条都是同一篇，用户还得猜哪个是「对」的）。
    // 判重走 data/works-index.js 的主表口径（正文去标点后一致即同一篇）；
    // 留下的那一条优先取**课内**条目 —— 教材是主线，课内条目还带着年级学期。
    // 没有主表时原样返回（搜索页加载了 works-index，理论不会发生），不去猜。
    if (!window.WorksIndex) return list;

    var out = [];
    var slotOf = {};   // wid → out 里的下标
    list.forEach(function (p) {
      var wid = window.WorksIndex.widOf(p.id);
      var rep = window.WorksIndex.repOf(p.id);
      if (slotOf[wid] === undefined) {
        slotOf[wid] = out.length;
        out.push(p);
        return;
      }
      // 已经有一条：若这一条才是这一篇的代表条目（课内那一条），就替换上去
      if (rep === p.id) out[slotOf[wid]] = p;
    });
    return out;
  }

  /* ---------------- 候选下拉 ---------------- */

  function suggestBox() { return document.getElementById("search-suggest"); }

  /**
   * 命中权重：篇名命中最高，作者 / 出处次之，正文 / 译文最低。
   * 返回 0 表示不命中。与引擎的 haystack 同一组字段
   * （见 mountCfg 的 extraFields），只是再排一下序 ——
   * 输入「月」，用户要找的是《静夜思》《水调歌头·明月几时有》这类
   * 篇名里带「月」的，而不是正文里偶有「月」字的长篇。
   */
  function matchScore(p, q) {
    var title = String(p.title || "").toLowerCase();
    var author = String(p.author || "").toLowerCase();
    var rest = [p.bookName, p.source, p.selection, p.dynasty, p.gradeGroup, p.authorName].join(" ").toLowerCase();
    var body = [p.text, p.translation].join(" ").toLowerCase();
    if (title.indexOf(q) >= 0) return 4;
    if (author.indexOf(q) >= 0) return 3;
    if (rest.indexOf(q) >= 0) return 2;
    if (body.indexOf(q) >= 0) return 1;
    return 0;
  }

  /** 候选：走与结果列表同一套匹配（同一组字段），只取前 SUGGEST_MAX 条 */
  function suggestItems(kw) {
    var q = String(kw || "").trim().toLowerCase();
    if (!q) return [];
    var hit = allItems().filter(function (p) { return matchScore(p, q) > 0; });
    hit.sort(function (a, b) {
      var sa = matchScore(a, q);
      var sb = matchScore(b, q);
      if (sa !== sb) return sb - sa;
      return String(a.title).length - String(b.title).length;
    });
    return hit.slice(0, SUGGEST_MAX);
  }

  /**
   * 候选右侧那行「朝代 · 作者 · 集子名」。
   * ⚠️ 每一栏都可能为空：《昭明文选》里选本只题作者的字，朝代是后人不补的
   *    （见 data/poems-zhaoming.js 文件头「补出来的信息一律留空」），
   *    所以这里按**有哪栏排哪栏**拼，不写死位置 ——
   *    早前写死了「朝代 · 作者」，朝代一空就会渲染出「 · 徐陵」这种以分隔符开头的残句。
   */
  function suggestMeta(p) {
    var parts = [];
    if (p.dynasty) parts.push(p.dynasty);
    if (p.author) parts.push(p.author);
    var left = parts.length ? esc(parts.join(" · ")) : "";
    if (!p.bookName) return left;
    return left + (left ? " · " : "") + "<em>" + esc(p.bookName) + "</em>";
  }

  function renderSuggest(kw) {
    var box = suggestBox();
    if (!box) return;
    var list = suggestItems(kw);
    suggestIndex = -1;
    if (!list.length) {
      box.hidden = true;
      box.innerHTML = "";
      box.dataset.items = "";
      setExpanded(false);
      return;
    }
    box.innerHTML = list.map(function (p, i) {
      return '<button type="button" class="suggest-item" role="option" data-suggest="' + i + '"' +
        ' aria-selected="false">' +
        '<span class="suggest-title">' + esc(p.title) + "</span>" +
        '<span class="suggest-meta">' + suggestMeta(p) + "</span></button>";
    }).join("");
    box.dataset.items = JSON.stringify(list.map(function (p) { return p.id; }));
    // 每换一次候选都回到列表顶部：下拉是**可滚动**的（高度受限，见 CSS 的 min()），
    // 上一次往下翻过之后，新关键词的第一条会停在中间 —— 用户看到的不是「最匹配的那条」。
    box.scrollTop = 0;
    box.hidden = false;
    setExpanded(true);
  }

  function setExpanded(on) {
    var input = document.getElementById("gw-search");
    if (input) input.setAttribute("aria-expanded", on ? "true" : "false");
  }

  function hideSuggest() {
    var box = suggestBox();
    if (!box) return;
    box.hidden = true;
    suggestIndex = -1;
    setExpanded(false);
  }

  /** 键盘上下键移动候选高亮（到底回头，不卡住） */
  function moveSuggest(dir) {
    var box = suggestBox();
    if (!box || box.hidden) return false;
    var items = box.querySelectorAll(".suggest-item");
    if (!items.length) return false;
    suggestIndex += dir;
    if (suggestIndex < 0) suggestIndex = items.length - 1;
    if (suggestIndex >= items.length) suggestIndex = 0;
    for (var i = 0; i < items.length; i++) {
      var on = i === suggestIndex;
      items[i].classList.toggle("active", on);
      items[i].setAttribute("aria-selected", on ? "true" : "false");
    }
    return true;
  }

  function suggestIds() {
    var box = suggestBox();
    if (!box || !box.dataset.items) return [];
    try { return JSON.parse(box.dataset.items) || []; } catch (e) { return []; }
  }

  /** 选中一条候选：打开详情页 —— 与点结果列表走的是同一条路径 */
  function pickSuggest(i) {
    var ids = suggestIds();
    if (i < 0 || i >= ids.length) return false;
    if (api) api.open(ids[i]);
    hideSuggest();
    return true;
  }

  /* ---------------- 结果列表 ---------------- */

  /**
   * 没输入关键词时列表为空，输入之后才交给引擎筛。
   *
   * 这里把「要不要展示」的决定权收在这一层，而不是靠引擎的 filterGroup：
   * 引擎的 visibleItems() 在没有关键词时**返回全部**（那是集子索引页要的行为），
   * 搜索页反过来 —— 空关键词就是没有结果。所以空输入时给引擎一份空集合。
   */
  function renderBody() {
    var input = document.getElementById("gw-search");
    var kw = input ? input.value : "";
    var q = String(kw == null ? "" : kw).trim();
    // 框里有内容 → 搜索框停在页顶（见 syncHeroState）。
    // ⚠️ 这里**不再写行内 padding-bottom**：那 8px 是上一版给候选下拉留的缝，
    //    现在「框 → 列表」的间距已经由 CSS 按状态给（#gw-list 的 padding-top），
    //    JS 只负责说清「现在是哪种状态」，样式一律归样式表。
    syncHeroState();
    if (api) {
      // 空关键词：先换掉篇目再设关键词（setItems 会重排一次列表，此时它还是空的）
      api.setItems(q ? allItems() : []);
      api.setKeyword(q);
    }
    annotateMatches(q);
    syncEmptyState(q);
  }

  /**
   * 空态文案：没输入时说的是「敲几个字就能搜」（**视觉上不显示**，见 EMPTY_IDLE），
   * 输入后没命中才说「没找到」。两句话必须分开 —— 不然刚进这一页就写着
   * 「没有找到匹配的篇目」，像这一页坏了。
   */
  function syncEmptyState(q) {
    var listEl = document.querySelector("#gw-list");
    if (!listEl) return;
    var empty = listEl.querySelector(".empty");
    if (!empty) return;
    // 没输入时**不写任何文字**：那一句「输入篇名、作者或诗句……」已按用户要求撤掉，
    // 空列表就是空的（CSS 里把它画成一段留白）。节点仍在、仍带 .search-empty，
    // 但它不再有可读的内容 —— 读屏软件读到一片空白，好过读到一句已经不在界面上的话。
    empty.textContent = q ? EMPTY_MISS : "";
    // 刚写进列表区的这一段由引擎生成，样式也归这一页管：
    // 它要跟搜索框、结果条目在同一条左侧基准线上（见 alignEmptyState）
    alignEmptyState(true);
    syncEmptySpacer(empty, !!q);
  }

  /**
   * 空列表那段留白由 CSS 给（见 css/classic.css 的 `#gw-list .empty`）。
   * 这里只做一件事：把**状态**写到节点上，让 CSS 的三条分支各就各位 ——
   *   data-empty="idle"  → 没输入：留一小段高度，页面下半截不塌
   *   data-empty="miss"  → 输入了但没命中：正常显示「没有找到匹配的篇目」
   * ⚠️ 走属性而不是在这里写行内样式：高度是版式的事，归样式表；
   *    JS 只负责说清「现在是哪种空」。
   */
  function syncEmptySpacer(empty, q) {
    if (!empty || !empty.dataset) return;
    empty.dataset.empty = q ? "miss" : "idle";
  }

  /**
   * 给每条「正文 / 译文命中」的结果补一句命中上下文。
   * 否则用户看到「《岳阳楼记》」会想「我搜的句子在哪儿」——
   * 摘出前后各 12 字，答案就在眼前。
   * 数据自带 excerpt（名句摘句）时不覆盖：摘句比机器截的更能认出作品。
   */
  function annotateMatches(kw) {
    var q = String(kw || "").trim();
    var listEl = document.querySelector("#gw-list");
    if (!listEl || !q) return;
    listEl.querySelectorAll(".item").forEach(function (el) {
      var id = el.dataset.id;
      var p = allItems().filter(function (x) { return x.id === id; })[0];
      if (!p) return;
      var ctx = matchContext(p, q);
      if (!ctx) return;
      var meta = el.querySelector(".item-meta");
      if (!meta) return;
      var old = meta.querySelector(".item-hit");
      if (old) old.parentNode.removeChild(old);
      meta.insertAdjacentHTML("beforeend", '<span class="item-hit">…' + esc(ctx) + "…</span>");
    });
  }

  /** 从正文 / 译文里截出关键词前后各 12 字的上下文 */
  function matchContext(p, q) {
    var i = String(p.text || "").toLowerCase().indexOf(q.toLowerCase());
    var src = p.text || "";
    if (i < 0) {
      src = p.translation || "";
      i = String(src).toLowerCase().indexOf(q.toLowerCase());
    }
    if (i < 0) return "";
    var a = Math.max(0, i - 12);
    var b = Math.min(src.length, i + q.length + 12);
    return src.slice(a, b).replace(/\s/g, "");
  }

  /* ---------------- 屏幕键盘与聚焦 ----------------
   *
   * 这一段只做一件事：**让搜索框（以及它下面的候选）永远待在键盘上方**。
   *
   * 为什么需要它：iOS / 安卓的软件键盘是覆盖在页面上的浮层，
   * 它**不改变** window.innerHeight —— 页面以为自己还是 852px 高，
   * 而用户实际只看得到上面 500 多像素。搜索框又正好在视口垂直居中处：
   * 键盘一弹，框自身只剩一半，候选下拉更是整块落在键盘底下。
   *
   * visualViewport 是唯一能拿到「键盘占了多少」的入口：
   *   layoutH（window.innerHeight，不变）- visualH（真正可见的那片）= 键盘高度
   * 拿它写进 --kb-space，CSS 侧的下拉就能只在键盘上方这片地方滚动。
   *
   * 代码里两处操作 DOM 类名的地方都包了 try：老浏览器没有 visualViewport，
   * 那时退化成「键盘弹出时整块贴顶」这一半（仍然可用，只是下拉的
   * max-height 上限仍按视口的 60% 算）。
   */

  /** 键盘挡住的高度（没有键盘、或浏览器不支持时返回 0） */
  function keyboardSpace() {
    var vv = window.visualViewport;
    if (!vv) return 0;
    var layoutH = window.innerHeight || vv.height;
    var space = layoutH - vv.height - (vv.offsetTop || 0);
    return space > KB_MIN ? Math.round(space) : 0;
  }

  function heroEl() { return document.getElementById("search-hero"); }

  /** 输入框里有没有内容（只看非空白字符，与结果 / 候选判空同一口径） */
  function hasKeyword() {
    var input = document.getElementById("gw-search");
    return !!input && !!String(input.value || "").trim();
  }

  /**
   * 搜索框该待在哪儿（Issue #69 后续·再续）
   * --------------------------------------------------------------------------
   * 用户这一轮给的是三句话，其实是同一个问题的三个状态：
   *   · 聚焦在搜索框 → 框挪到标题栏下方（候选下拉跟着上去）；
   *   · 有搜索内容     → 框停在页顶（不因为失焦又跳回页面中间）；
   *   · 清了内容、也没焦点 → 框回到页面中心。
   *
   * 所以只需两个类，由这一处**唯一**写进去（其余地方一律调它）：
   *   · search-active → 有焦点 **或** 有内容：贴顶栏下方（CSS 见 .search-hero.search-active）
   *   · kb-open       → 软键盘弹出来了：同样贴顶，另把列表上方的留白收掉
   * 两个都不在时是默认态：框压在这一段的垂直中线上（页面中心）。
   *
   * ⚠️ 焦点与内容合成一个类：两者的落位一模一样，分成两个类就要把同一组
   *    数值写两遍；「有内容但没焦点」正是用户说的「搜索框停留在页面顶部」。
   * ⚠️ --kb-space 也在这里写：候选下拉的 max-height 读它（键盘实测高度）。
   */
  function syncHeroState() {
    var hero = heroEl();
    if (!hero) return;
    var input = document.getElementById("gw-search");
    var focused = !!input && document.activeElement === input;
    var space = keyboardSpace();
    var lifted = focused || space > 0;   // 键盘弹着时也按「有焦点」算 —— 焦点掉了、键盘还在
    try {
      hero.classList.toggle("search-active", hasKeyword() || lifted);
      hero.classList.toggle("kb-open", lifted);
    } catch (e) { /* 极老的浏览器：没有 classList 就退化成「始终居中」，仍可用 */ }
    // 键盘高度只在这一处写（CSS 的下拉 max-height 读它）。
    // ⚠️ 两处都写：hero 与候选下拉自己。
    //    候选的 max-height 里有「可视区 − 键盘 − 80」，而它落在 .suggest 上；
    //    键盘弹起会让 .search-toolbar 重排，那条链上的**继承值**不会因此重算 ——
    //    只写 hero 的话，下拉会照旧按「没有键盘」的高度铺下来，伸到键盘底下。
    hero.style.setProperty("--kb-space", space + "px");
    var box = suggestBox();
    if (box) box.style.setProperty("--kb-space", space + "px");
    // 空格列表（引擎写进列表区的 .empty）跟着一起左对齐。
    // ⚠️ 传的是「框贴不贴顶」而不是「键盘弹没弹」：居中的框下面那段空白里
    //    不该多出一行提示，贴顶的框下面才需要它与结果同一左对齐。
    alignEmptyState(hasKeyword() || lifted);
  }

  /**
   * 空格列表（引擎写进列表区的 .empty）挂上 .search-empty。
   * 引擎那一句是全站通用的居中一段（见 css/style.css），在集子索引页里居中好看，
   * 在搜索页里却离左侧的搜索框、左侧的结果条目都不在一条竖线上 ——
   * 这一页的空态是「结果区里的一行提示」，不是页面中间的一句话。
   * ⚠️ 现在这一行**不显示文字**（用户要求撤掉那段引导语），
   *    .search-empty 只负责把它画成一段不占地方的留白；
   *    类名与节点都留着，是为了日后要恢复文案时不必改 JS。
   */
  function alignEmptyState(on) {
    var empty = document.querySelector("#gw-list .empty");
    if (!empty) return;
    try { empty.classList.toggle("search-empty", on); } catch (e) { /* 同上 */ }
  }

  /**
   * 让「输入框被聚焦」这件事在键盘弹出前后都是稳定的。
   *
   * 做法：聚焦到一个 1×1、透明的替身输入框（#search-hero-focus），
   * 它一直待在 hero 的最顶上。理由：
   *   · iOS 键盘弹出时会自动把**聚焦的那个输入框**滚进视野。若聚焦的是搜索框本体
   *     （在 hero 里垂直居中），浏览器会为了「让它可见」而滚动页面 ——
   *     我们同时又把 hero 顶到顶上，两次滚动相叠，框会跳一下。
   *   · 聚焦替身时，浏览器只保证「hero 顶部可见」，正是我们想要的位置。
   * 替身没有实际用途（readonly 语义上由 aria-hidden + tabindex=-1 排除在
   * 可访问性树之外），载入后立刻归还焦点给真输入框。
   */
  function focusInput(input) {
    var hero = heroEl();
    var ghost = document.getElementById("search-hero-focus");
    if (!hero || !ghost) return;
    try { ghost.focus({ preventScroll: true }); } catch (e) { /* 老浏览器忽略可选项 */ }
    // 先进「有焦点」这一态（贴顶），再刷一次键盘实测值 ——
    // 顺序要紧：syncHeroState 会把 search-active 与 kb-open 一起算出来，
    // 不先置焦点态的话，第 80ms 那次 focus 之前框会先按「居中」摆一下。
    hero.classList.add("search-active");
    syncHeroState();
    setTimeout(function () {
      try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
      syncHeroState();
    }, 80);
  }

  /**
   * 挂上键盘 / 聚焦的监听。
   * 三个来源都要听：
   *   · visualViewport 的 resize / scroll —— 键盘弹出、收起、切换输入法的唯一信号
   *   · window 的 resize / orientationchange —— 横竖屏切换、桌面窗口缩放
   *   · 输入框自身的 focus / blur —— 键盘弹出前那一瞬间（iOS 上 visualViewport
   *     要等键盘开始滑动才动，这段空档里整块先贴顶，用户看不到跳动）
   */
  function bindKeyboardWatchers() {
    var input = document.getElementById("gw-search");
    var hero = heroEl();
    if (hero && input) {
      input.addEventListener("focus", function () {
        hero.classList.add("search-active");
        syncHeroState();
        // 等键盘真正开始滑，再让 kb-open 生效（见 FOCUS_LIFT_DELAY）：
        // 刚聚焦就动的话，用户看着内容先跳一下、键盘才滑出来，像是点错了地方
        setTimeout(function () {
          if (document.activeElement === input || hero.classList.contains("kb-open")) {
            hero.classList.add("kb-open");
            syncHeroState();
          }
        }, FOCUS_LIFT_DELAY);
      });
      input.addEventListener("blur", function () {
        // 延迟一拍再算：点候选时 blur 先到，立刻收会让 click 落空
        // （见 BLUR_SETTLE_DELAY）；这一拍里若焦点又回到输入框，就什么都不做。
        setTimeout(function () {
          if (document.activeElement === input) return;
          if (keyboardSpace() === 0) hero.classList.remove("kb-open");
          // ⚠️ search-active 不在这里一并摘掉 —— 交给 syncHeroState：
          //    有内容时它仍要留着（用户说的「有搜索内容时，搜索框停留在页面顶部」），
          //    只有「清了内容 + 没了焦点」才真的回到页面中心。
          syncHeroState();
        }, BLUR_SETTLE_DELAY);
      });
    }

    var vv = window.visualViewport;
    if (vv) {
      vv.addEventListener("resize", syncHeroState);
      vv.addEventListener("scroll", syncHeroState);
    }
    window.addEventListener("resize", syncHeroState);
    window.addEventListener("orientationchange", function () {
      // 旋屏时先让布局落定，再量一次
      setTimeout(syncHeroState, 300);
    });
  }

  /* ---------------- 启动 ---------------- */

  /**
   * 一次 mount 用到的全部配置。
   *
   * extraFields 是引擎自带的「关键词还该在哪些字段里找」：
   *   · text / translation —— 搜索页与其余各页最大的不同就在这：
   *     在集子索引页里搜「先天下之忧而忧」毫无意义（那一页只搜本集的题名作者），
   *     但搜索页必须能搜到 —— 用户记不住篇名，只记得住一句话。
   *   · bookName / gradeGroup —— 搜「唐诗三百首」要列出那一部的全部篇目，
   *     搜「卷一 周文」也要能筛出《古文观止》第一卷。
   *
   * items 一开始是**空数组**：这一页在用户敲字之前不列任何篇目
   * （见文件头第三条）。关键词一进来，renderBody 用 setItems 换上全量。
   * 也因此这里必须带 allowEmpty —— 引擎默认拒收空集合（那多半是数据没加载上），
   * 而搜索页的「空」是它本来的样子。
   */
  function mountCfg() {
    return {
      id: "search",
      items: [],
      allowEmpty: true,
      root: "[data-gw-root]",
      reader: "#gw-reader",
      // 空数组：搜索结果不按卷次 / 词牌 / 文体重排，按总索引的顺序（课内在前、五部在后）
      groupOrder: [],
      pageTitle: "搜索",
      pageSub: "全站篇目，一搜就到",
      extraFields: ["text", "translation", "bookName", "gradeGroup"],
      words: {
        list: "篇目",
        unit: "篇",
        loadingFailed: "全站篇目索引加载失败",
        // 引擎在空集合时写进列表区的文案；输入之后没命中的那句由
        // syncEmptyState 换成 EMPTY_MISS（两句话的语义完全不同）
        empty: EMPTY_IDLE,
        matchGroup: "",
        backToList: "返回搜索结果",
        // 空关键词时列表里什么都没有，空态由 syncEmptyState 按「有没有输入」写，
        // 引擎那句加载失败文案只在索引真的空掉时用得上
        countInvalid: "全站篇目索引加载失败",
        // 搜索页不碰任何一部的已读 —— 空键名即「本页不提供标记已读」
        readStore: "",
        playerTitle: "朗读",
        searchPlaceholder: "搜索篇名 / 作者 / 诗句（全站）"
      }
    };
  }

  function boot() {
    if (!window.ReaderEngine) return;
    var all = allItems();
    var listEl = document.querySelector('[data-gw="list"]');
    if (!all.length) {
      if (listEl) listEl.innerHTML = '<div class="empty">全站篇目索引加载失败</div>';
      return;
    }

    api = window.ReaderEngine.mount(mountCfg());
    if (!api) return;

    var input = document.getElementById("gw-search");
    if (input) {
      input.addEventListener("input", function () {
        // renderBody 会先按「有没有内容」重算框的位置（贴顶 / 回中心），
        // 再列出结果；renderSuggest 跟着换候选。清空输入时 renderSuggest
        // 得到的空关键词没有候选，下拉自然收掉。
        renderBody();
        renderSuggest(input.value);
      });
      input.addEventListener("focus", function () {
        if (input.value.trim()) renderSuggest(input.value);
      });
      input.addEventListener("keydown", function (e) {
        if (e.key === "ArrowDown") {
          if (moveSuggest(1)) e.preventDefault();
        } else if (e.key === "ArrowUp") {
          if (moveSuggest(-1)) e.preventDefault();
        } else if (e.key === "Enter") {
          if (suggestIndex >= 0 && pickSuggest(suggestIndex)) e.preventDefault();
          else hideSuggest();
        } else if (e.key === "Escape") {
          hideSuggest();
        }
      });
      input.addEventListener("blur", function () {
        // 延迟收起：鼠标点候选时先触发 blur，立刻收起就点不到了
        setTimeout(hideSuggest, SUGGEST_BLUR_DELAY);
      });
    }

    // 进这一页就是为了搜东西：把输入框的焦点占上（键盘由系统决定弹不弹）。
    // 焦点走替身输入框，键盘弹出时 iOS 不会为了「看见输入框」而自己滚一屏
    // （见 focusInput 的注释）。
    focusInput(input);
    bindKeyboardWatchers();

    var box = suggestBox();
    if (box) {
      box.addEventListener("mousedown", function (e) {
        // mousedown 而不是 click：blur 抢在 click 之前，
        // 点下去时那 SUGGEST_BLUR_DELAY（180ms）的收起定时器还没到，click 会被吃掉
        var btn = e.target.closest ? e.target.closest("[data-suggest]") : null;
        if (!btn) return;
        e.preventDefault();
        pickSuggest(parseInt(btn.getAttribute("data-suggest"), 10));
      });
    }

    bindSuggestDismiss();

    renderBody();
  }

  /* ---------------- 怎么把候选收起来 ----------------
   *
   * 用户这一轮的第二句话是「也需要预留空间让用户关闭下拉框，然后去点击搜索到的卡片列表」。
   * 上一版只做到了一半：靠 CSS 把下拉限高、给它留出下方可视区
   * （见 css/classic.css 的 .suggest 那条）—— 但**怎么关**只留了三条容易落空的路：
   *   ① 敲 Escape（触屏上没有键盘）
   *   ② 退掉输入（用户其实想保留关键词接着看结果）
   *   ③ 点别处触发 blur（候选是浮层，手指总落在它自己身上，不会 blur）
   * 于是「下拉挡住了结果卡片、却关不掉」就成立 —— 明明下面就有位置，手指够不着。
   *
   * 这里补三条**看得见也摸得着**的路：
   *   · 手指开始滚动结果列表 → 收起（滚 = 用户已经在看下面的东西）
   *   · 点一下结果列表（空白处 / 卡片 / 卡片里的字）→ 收起而不是「穿过浮层点开一篇」
   *     ⚠️ 必须**先收不先开**：候选还挂着时点结果区，用户看到的那一条正是被
   *        浮层压住半截的，先开阅读器会让人觉得「我点的是候选，怎么开了别的篇」。
   *        收起之后关键词仍在、结果还在原位，再点一下才进正文 —— 两下，但每一下
   *        与用户看到的画面一致。
   *   · **点页面任何一处空白** → 收起（用户这一轮的原话：「当用户点击空白地方时，
   *     下拉列表消失」）。前面两条只管结果列表那一片，页面上的空白不止它：
   *     搜索框左右的空当、列表下方的空白、顶栏留白 —— 全都算「别处」。
   * 三条都不动关键词、不动结果 —— 只把那一层浮层收掉
   * （点空白还会顺带收掉键盘，那是浏览器的默认行为，也正是用户要的）。
   */
  function bindSuggestDismiss() {
    var listEl = document.querySelector("#gw-list");
    if (listEl) {
      var timer = 0;
      listEl.addEventListener("scroll", function () {
        var box = suggestBox();
        if (!box || box.hidden) return;
        clearTimeout(timer);
        timer = setTimeout(hideSuggest, SCROLL_HIDE_DELAY);
      }, { passive: true });
      // 点结果区：capture 阶段先收下拉，并**吃掉这一下**（不让它开阅读器）。
      // 只有在候选真的挂着时才拦 —— 平时点卡片仍是「一下就进」，
      // 不能因为这条防线把搜索页最常用的动作变成两下。
      listEl.addEventListener("click", function (e) {
        var box = suggestBox();
        if (!box || box.hidden) return;
        hideSuggest();
        e.stopPropagation();
        e.preventDefault();
      }, true);
    }
    bindBlankTapDismiss();
  }

  /**
   * 点页面上的空白地方 → 收起候选下拉（用户这一轮点名要的那条）。
   *
   * 「空白」= 落在搜索区（.search-wrap：输入框 + 候选下拉）之外的一切地方，
   * 含搜索结果列表、列表下方的空白、顶栏、页面两侧的空当。
   *
   * 为什么挂在 document 上而不是挑几个元素挂：
   *   页面上「能点的地方」是数不完的（结果卡片、卡片里的每一个 span、
   *   候选、页脚……），挑着挂必然漏掉一处，而漏掉的那处正是用户会点的那处。
   *   挂在 document 上再排除搜索区，就与「除了搜索框和下拉，点哪儿都算点空白」
   *   这句话一一对应 —— 判据只有一条，日后也不用维护一张名单。
   *
   * ⚠️ 用 mousedown / touchstart 的 capture 阶段，而不是 click：
   *    ① 候选下拉的收起有自己的节拍（blur 后 180ms，见 SUGGEST_BLUR_DELAY），
   *       等 click 到 document 时，点结果卡片那一下已经被列表自己的监听拦掉了；
   *    ② capture 阶段先于一切 click 处理，判据最干净。
   *    这里只**收下拉**，不阻断事件：点卡片该开篇还是开篇，
   *    点别处该干嘛干嘛（点空白收起下拉不该顺带把别的动作吃掉）。
   *
   * ⚠️ 点搜索区里（输入框 / 候选 / 框四周的 padding）一律不动：
   *    在框里调整光标位置、点候选、点下拉里的空白，都不是「点别处」。
   */
  function bindBlankTapDismiss() {
    function onTap(e) {
      var box = suggestBox();
      if (!box || box.hidden) return;
      var wrap = document.getElementById("site-search-wrap");
      var t = e.target;
      // 搜索区之内的：不是「点空白」
      if (wrap && t && (t === wrap || wrap.contains(t))) return;
      // 候选下拉虽然也挂在 .search-wrap 里，但为稳妥再排一次它自己
      if (t && t.closest && t.closest("#search-suggest")) return;
      hideSuggest();
    }
    document.addEventListener("mousedown", onTap, true);
    document.addEventListener("touchstart", onTap, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  /** 供测试与宿主页面调用 */
  window.SiteSearch = {
    items: function () { return allItems(); },
    suggest: function (kw) { return suggestItems(kw); },
    /** 输入框里的关键词（结果列表与候选都按它算） */
    keyword: function () {
      var input = document.getElementById("gw-search");
      return input ? input.value : "";
    }
  };
})();
