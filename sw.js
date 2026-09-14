/**
 * Service Worker —— 让应用可安装、可离线使用
 *
 * 苹果手机说明：iOS Safari 不弹安装横幅，靠「分享 → 添加到主屏幕」安装；
 * 添加到主屏幕后本 SW 的缓存生效，断网也能正常背诵。
 *
 * ⚠️ 维护约定（很重要，曾因此踩坑）：
 *   下面的静态资源（css / js / 字体）一律「缓存优先」——命中缓存就直接返回，
 *   不会回源比对。所以**只要改了 css/ 或 js/ 里的任何文件，就必须把
 *   CACHE_NAME 的版本号 +1**，否则老用户会一直拿着旧副本：
 *   表现为「明明改了样式，刷新后还是老样子」，改多少遍都不生效。
 *   （`activate` 里会删掉所有非当前版本的缓存，升版本即完成替换。）
 *
 *   改了哪些文件就升一次，宁可多升，不要漏升。
 *   版本回滚同理：版本号只能往上走，不要改回旧号，否则老缓存会被复用。
 *
 *   ⚠️ 同时有几个 PR 在改 css/ 或 js/ 时，**每次 +5、不要只 +1**：
 *   大家各自从同一个基线 +1，撞在同一个版本号上，先合的那个把版本号占了，
 *   后面的每个 PR 都得回来解一次冲突。+5 留出余量，各自落在不同号段上。
 *   （号段之间留空不碍事：版本号只用来区分新旧，不要求连续。）
 *
 * 版本历史：
 *   v45  新增《昭明文选》集子（Issue #69 后续）：/zhaoming/ 索引页 + 详情页，
 *        六十卷 480 篇，按**文体**分三十九类（赋 / 诗 / 骚 / 七 / 诏 / 册 …），
 *        数据 data/poems-zhaoming.js（原文全收，29 篇名篇带白话译文，其余标待补），
 *        挂载脚本 js/zhaoming.js，已读键 poem_zhaoming_read_v1；
 *        课外阅读入口页由「四部」改为「五部」，站点总索引与搜索页随之
 *        「五部 → 六部」
 *        （zhaoming/index.html、js/zhaoming.js、data/poems-zhaoming.js、
 *          data/site-index.js、js/chrome.js、js/library.js、js/search.js、
 *          library/index.html、search/index.html、test/run.sh）
 *   v19  全站 URL 目录化（/settings/ 等，不再带 .html）
 *   v20  （跳过）目录化之后又改了 css/style.css、css/classic.css、js/chrome.js
 *   v21  设置页分组标题降级为辅助标签（字号 / 字重 / 颜色三重降级）
 *   v22  全站 UI 走查：阅读器顶栏并入全站顶栏、详情页工具条改换行、
 *        播放栏出现时页签让路、法务页底部留白、iOS 输入框防缩放真正生效、
 *        圆角与宽度收敛到变量（css/style.css、css/classic.css、
 *        css/legal.css、js/chrome.js、js/classic.js、classic/index.html）
 *   v23  小古文连读改用圆形播放键：工具栏「连读」与各分组右侧的
 *        「随机连读」都换成与首页今日条同款的圆键（一大一小两档），
 *        ▶ / ⏸ 同键两态、不再有随状态改写的可见文字
 *        （classic/index.html、css/classic.css、js/classic.js）
 *   v24  字号在最细处再补一档 13px（Issue #55）：默认档仍是 17px 不变，
 *        A－ 在 15px 之下还能再多点一次（js/app.js、js/classic.js）；
 *        小古文页首收紧：搜索框与第一个分组标题之间的空档由 28px 收到 18px
 *        （.toolbar 的 margin-bottom 与 .group-head 的上内边距各让一点）
 *   v25  小古文条目短竖条透明度降到 55%；卡头下内边距 8px、首条不再画分隔线
 *        （卡头与圆键离开那条线）；序号圆挪进标题行、直径与字号同高（.item-num
 *        取代 .item-index），列表每行文字多出 40 余像素
 *        （css/style.css、css/classic.css、js/app.js、js/classic.js）
 *   v26  小古文搜索框提示字与「全部 / 未读」同字号（Issue #55）：
 *        只压 ::placeholder 到 12.5px，输入的文字仍是 16px（iOS 聚焦不缩放），
 *        并把「输入框字号」这条写在 classic.css 自己末尾、不再只靠 style.css
 *        （css/classic.css）
 *   v27  首页今日条两颗圆的直径真正对齐（Issue #55）：
 *        圆环与左侧播放键同读 --today-btn-size（46px），真机量得 46×46 相等、
 *        中线齐平；不给描边做补偿（svg overflow: hidden 会把描边裁进盒内，
 *        盒子即最大外径）—— 见 css/style.css 里那条路标注释（css/style.css）；
 *        序号圆与下方正文左对齐（Issue #55 后续）：标题行收掉 -12px 负外边距，
 *        圆周左缘 = 篇名 = 元信息，三者同一条左基准线；
 *        列表序号圆去掉淡绿底，改为与序号同色的 1px 圆形描边（空心圆），
 *        数字水平 + 垂直居中；圆外径仍是 16.5px（border-box，描边不撑大圆），
 *        与「圆 / 篇名 / 元信息同一条左基准线」并存 —— 描边不改变圆的占位宽度；
 *        小古文卡片：左侧短竖条整体隐藏、条目左右内边距收成对称的 8px
 *        （圆左内缘 = 箭头右内缘）；搜索框提示字用 translateY(-2.25px)
 *        上抬回水平中轴（输入文字 16px 本来居中，不动输入框本体）
 *        （css/style.css、css/classic.css）
 *   v28  首页今日条两颗圆的直径再收 4px（46 → 42，Issue #55 后续）：
 *        播放键与 0/5 进度环同读 --today-btn-size，一起缩小、外径仍逐位相等，
 *        中线齐平；SVG 图标尺寸不动（css/style.css）
 *   v29  小古文索引页列表内容与卡片左缘的间距 +2px（Issue #55 后续）：
 *        条目左内边距 8 → 10px，右侧仍是 8px、不动 ——
 *        用户明确要求「只加左侧」（css/classic.css）
 *   v30  小古文条目的播放键左侧间距再减 12px（Issue #55 后续）：
 *        卡内 gap 清零，改由两颗图标各自给外边距 —— 圆键左缘贴内容块右缘
 *        （12 - 12 = 0），与箭头之间仍是 6px（css/classic.css）
 *   v31  小古文条目的正文宽度放开（Issue #55 后续）：
 *        去掉播放键的 margin-left:-12px（负外边距只会把圆键压到正文上，
 *        正文一个字都不会变长）；内容块由 flex: 1 1 0% 改成 flex: 0 1 auto，
 *        宽屏下按内容取宽、摘要在自身宽度用完处结束，正文一路排到播放键跟前；
 *        窄屏下圆键左缘与正文那一行的可用宽度分毫不动（css/classic.css）
 *   v32  首页今日条播放键的「内径」收 4px（Issue #55 后续）：
 *        外径 42px 不动，只把里面的 ▶ / ⏸ 图形从 19px 图标框收到 14px ——
 *        内径另起一个唯一来源 --today-btn-inner（与 --today-btn-size 分开），
 *        ▶ / ⏸ 同框，两态切换不会忽大忽小（css/style.css）
 *   v35  小古文索引页卡片的左内边距再放一档（Issue #55 后续）：
 *        卡内条目左内边距 10 → 12px（右侧仍是 8px，只加左边）；
 *        卡头那一行左内边距 8 → 12px（比上一轮多 4px，右 / 上 / 下不动）。
 *        两处都写四值 padding，防对称写法把右侧也推走。
 *        与 main 上「卡片左内边距 2px」的改动合并后是**两层叠加**：
 *        文字距卡片左缘 = 卡片 2px + 自身 12px = 14px（卡头 / 条目同值，
 *        两条左基准线仍严格对齐）—— 卡头的 +4px 就是相对上一轮的 8px 而言。
 *        另删掉 .group-card 里那条会静默覆盖左内边距的 `padding-left: 0`
 *        （css/classic.css）
 *   v36  古籍阅读库（基础架构变更，Issue #69）：
 *        索引页 + 详情页从 js/classic.js 里整体提成可挂载的引擎
 *        js/reader-core.js（ReaderEngine.mount），小古文只是它的第一个挂载点；
 *        页面改用 data-gw-* 标记对接，js/classic.js 收成「这一部是什么」的配置；
 *        新增站点篇目总索引 data/site-index.js（供全站搜索用，
 *        window.SITE_INDEX / window.buildSiteIndex）
 *        （js/reader-core.js、js/classic.js、classic/index.html、
 *          data/site-index.js、sw.js）
 *   v37  唐诗三百首（内容 PR，Issue #69）：
 *        新增 /tangshi/ 索引页（301 首，按卷一至卷八分组），
 *        数据 data/poems-tangshi.js，挂载脚本 js/tangshi.js；
 *        与《课外必背小古文》共用 reader-core.js 引擎，
 *        已读各存各的（poem_tangshi_read_v1）
 *        （data/poems-tangshi.js、js/tangshi.js、tangshi/index.html、
 *          js/chrome.js、data/site-index.js、sw.js）
 *   v38  新增《古文观止》集子（Issue #69 内容 PR）：/guwen/ 索引页 + 详情页，
 *        与《课外必背小古文》《唐诗三百首》共用 js/reader-core.js 引擎；
 *        首篇收入韩愈《送孟东野序》（卷八 唐文），已读键 poem_guwen_read_v1
 *        （guwen/index.html、js/guwen.js、data/poems-guwen.js、
 *          js/chrome.js、sw.js）
 *   v40  宋词三百首 + 古文观止（内容 PR，Issue #69）：
 *        新增 /songci/ 索引页（255 首，按词牌分组），数据 data/poems-songci.js，
 *        挂载脚本 js/songci.js，已读键 poem_songci_read_v1；
 *        《古文观止》按十二卷补齐为 155 篇目录（本轮收入 21 篇有正文译文的
 *        名篇，其余保留「待补」条目，点开有明确提示而不是白屏）；
 *        列表里的正文摘句改为读数据自带的 p.excerpt（不再截正文前 16 字）——
 *        宋词、古文篇幅长，截头几字认不出是哪一篇
 *        （data/poems-songci.js、js/songci.js、songci/index.html、
 *          data/poems-guwen.js、js/guwen.js、data/site-index.js、
 *          js/reader-core.js、js/chrome.js、sw.js）
 *   v41  《古文观止》十二卷 155 篇补齐 + 搜索页 + 导航栏变更（Issue #69 收尾）：
 *        ① 古文观止其余 134 篇的原文与白话译文全部补上（本集已无「待补」条目）；
 *        ② 新增 /search/ 全站搜索页：一次搜遍五部集子的篇名 / 作者 /
 *           朝代 / 出处 / 正文与译文，输入即出候选（键盘上下键 + 回车进结果）；
 *           集子筛选药丸实时算篇数；搜索页**不写任何一部的已读键**；
 *        ③ 底部页签由三格改成四格并改名：背诵（原「古诗词」，它只管课内背诵）/
 *           课外（新增，四部集子的入口页 /library/）/ 搜索 / 设置 ——
 *           此前唐诗、宋词、古文观止做完却没有入口，只能手敲地址；
 *        ④ 页面标题措辞调整：「XX的古诗词」→「XX的背诵」，
 *           <title> 统一成「页面名 · 跬步」（原先同一句里会出现两次「背诵」）
 *        （data/poems-guwen.js、search/、js/search.js、library/、
 *          js/library.js、js/chrome.js、js/reader-core.js、js/app.js、
 *          js/settings.js、css/style.css、css/classic.css、fonts/、
 *          index.html、manifest.webmanifest、sw.js）
 *   v43  课外阅读入口页副标题 + 详情页长标题 + 列表图标右侧对齐（Issue #69 后续）：
 *        ① /library/ 的说明改走顶栏第二行（body 的 data-sub），
 *           并删掉正文里那段与顶栏重复的「课本之外的经典……白话译文。」；
 *        ② 详情页标题（.reader-body h2）允许逐字符断行 —— 《唐诗三百首》里
 *           有一首题目长达 150 字，块级 h2 不折行就会溢出定宽正文列，
 *           手机上表现为正文横向滚动、右端被裁（用户反馈「详情页把页面撑出去了」）；
 *        ③ 列表条目的两颗图标钉在右缘：内容块改为按内容取宽之后，
 *           播放键与箭头仍跟在内容块后面，于是停在条目中间、右端留白 ——
 *           给 .item-arrow 加 margin-left: auto 把它顶到右缘；
 *           同时把「内容块按内容取宽」那句的选择器由 `#gw-list .group-card .item-main`
 *           放宽为 `#gw-list .item .item-main`（搜索页的条目不分卷次、不套卡片，
 *           原选择器在那里命中不到，图标同样不贴右缘），
 *           并把搜索页条目的右内边距收成与集子页同值的 8px
 *        （library/index.html、css/classic.css、js/reader-core.js、
 *          test/classic.test.js、test/tangshi.test.js、test/pwa.test.js、sw.js）
 *   v42  搜索页只留一个搜索框（Issue #69 后续）：
 *        ① 删掉「全部 / 未读」组合按钮与集子筛选药丸两栏 ——
 *           前者筛的是已读，而搜索页根本不写已读；后者默认就是「全部」，
 *           多一步「先选一部再搜」的前置操作；
 *        ② **没输入关键词时不再铺出全部篇目**：原先首屏要一次渲染上千条
 *           条目（用户反馈的「加载有性能问题」），现在输入几个字才列命中的
 *           篇目，字越多命中越少；空列表给的是「敲几个字就能搜」的引导语，
 *           不是「没有找到匹配的篇目」；
 *        ③ 搜索框整块在标题栏下方垂直 + 水平居中，页面只有它一个控件；
 *        ④ 引擎 mount() 新增 allowEmpty：搜索页在敲字之前的空集合是
 *           「对的样子」，不该被当成数据没加载上而拒挂
 *        （search/index.html、js/search.js、js/reader-core.js、
 *          css/classic.css、sw.js）
 *
 *        同一轮里还删掉了「一次搜遍课内诗词……也搜正文与译文里的字句」那段说明
 *        文字（连同只服务它的 #search-hint 显隐逻辑与 .search-hint 样式）：
 *        搜索页的取舍已经写在文件头与上方注释里，页面上不必再向用户解释一遍
 *        （css/classic.css、js/search.js、search/index.html）
 *   v43  修回小古文 / 唐诗列表里丢掉的正文摘句：
 *        摘句改成只认数据自带的 p.excerpt 时，忘了「小古文与唐诗的数据里
 *        根本没有这个字段」—— 于是这两部的列表条目只剩「朝代 · 作者 · 出处」，
 *        而卡内 .item-main 是按内容取宽的（flex: 0 1 auto），内容块随之从
 *        283px 塌到 141px / 167px，条目右半边空出一大片（Issue #55 要消灭的
 *        正是这种「文字没占满、右边空一截」）。现在没有 excerpt 的集子回落到
 *        「原文前 16 字 + 省略号」，即这两部集子一直用的口径。
 *        （js/reader-core.js、sw.js）
 *
 *   v42  集子「出处」修正（Issue #69 收尾）：
 *        《古文观止》155 篇的 source 原先一律写成选本名《古文观止》，
 *        列表与阅读器里看到的「出处」因此全是同一句，认不出这一篇真正
 *        出自哪部书。现改为：source = 真实出处（《左传》《国语》《战国策》
 *        《史记》《震川先生集》《李太白集》……，即用户清单里那一列），
 *        selection = 选本名《古文观止》（列表淡色括注、阅读器淡色标签）。
 *        引擎的 haystack 与搜索页的 matchScore 一并纳入 selection，
 *        搜「古文观止」仍能命中全部 155 篇。
 *        （data/poems-guwen.js、data/site-index.js、js/reader-core.js、
 *          js/search.js、css/classic.css、sw.js）
 *
 *   v43  《宋词三百首》《古文观止》篇目补齐（Issue #69 收尾）：
 *        · 宋词三百首与通篇本目录逐条比对后补入 29 首，255 → 284 首；
 *          并订正五处「篇名张冠李戴 + 正文重复」的错配
 *          （sc-84 秦观《踏莎行》、sc-93 秦观《江城子》、
 *           sc-134 贺铸《蝶恋花·改徐冠卿词》、sc-181 辛弃疾《贺新郎·赋琵琶》）；
 *          同作者同词牌且无法用「其一 / 其二」分辨的两首，副题取首句。
 *        · 古文观止补齐卷三漏收的 11 篇（公羊传 / 谷梁传 / 礼记 / 孟子），
 *          155 → 166 篇，全十二卷收齐。
 *        · 页顶进度牌、列表分组顺序（js/songci.js 的 GROUP_ORDER 增补六个词牌）
 *          与 README 一并更新。
 *        （data/poems-songci.js、data/poems-guwen.js、js/songci.js、
 *          songci/index.html、guwen/index.html、library/index.html、
 *          test/songci.test.js、test/guwen.test.js、README.md、sw.js）
 *   v44  搜索页在机上的可用性（Issue #69）：
 *        用户在手机上反馈三件事，一起修：
 *        ① 键盘一弹，候选下拉就被键盘盖住 —— 软键盘是盖在页面上的浮层，
 *           不改窗口高度，而搜索框又在视口居中处。现在用 visualViewport
 *           实测键盘高度：整块贴到顶栏下方、候选下拉按「可视区 − 键盘」限高，
 *           永远整条落在键盘上方；键盘收起后自动回到居中。
 *        ② 候选下拉离搜索框太远 —— 间隙收到 5px，并且换成不透明底色
 *           （原先是 90% 不透明的卡片色，下层结果列表会透上来）。
 *        ③ 这一页以搜索为主角，搜索框该更高 —— 视觉高度 40 → 52px
 *           （只做在绘制层，hero 的居中 / 贴顶算式算的仍是 40px）。
 *        顺带：进页即聚焦搜索框（少点一次）、空态与结果列表左对齐、
 *        候选行抬高到 44px（iOS 建议的最小可点面积）。
 *        （search/index.html、js/search.js、css/classic.css、sw.js）
 *   v45  详情页对齐组合去掉「右对齐」：
 *        所有文章一律横排，右对齐没有使用场景 —— 六个页面（首页诗词详情、
 *        小古文、唐诗、宋词、古文观止、搜索页）的对齐组合都只剩 左 / 中 两档，
 *        JS 的 ALIGNS 与 CSS 的 [data-align="right"] 规则一并删除。
 *        （index.html、classic|guwen|tangshi|songci|search/index.html、
 *          js/app.js、js/reader-core.js、css/style.css、css/classic.css、sw.js）
 *   v46  自选集合（Issue #69 收尾）：作品主表 + 同篇对照表（data/works-map.js /
 *        data/works-index.js）、js/collections.js；阅读器列表与详情页加「加入背诵」，
 *        首页加「自选背诵」折叠卡；首页排程纳入自选篇目
 *        （data/works-map.js、data/works-index.js、js/collections.js、
 *         js/reader-core.js、js/scheduler.js、js/app.js、index.html、
 *         classic|tangshi|songci|guwen|zhaoming|search 六个页面的 index.html、
 *         css/style.css、css/classic.css、sw.js）
 *   v47  课内自身重复去重 + 《静夜思》教材文本（Issue #69 收尾）：
 *        12 组在两个年级各存一份的课内篇目**以低年级版本为准**各删一条
 *        （绝句 / 望洞庭 / 四时田园杂兴（其二）/ 天净沙·秋思 / 师说 / 静女 /
 *         书愤 / 临安春雨初霁 / 李凭箜篌引 / 登高 / 念奴娇·赤壁怀古 /
 *         永遇乐·京口北固亭怀古），课内条目 273 → 261，作品主表 66 → 57 组；
 *        《静夜思》以教材文本「床前明月光」为准（与唐诗三百首那条合并为同一篇）；
 *        顺带修好上一版遗留的注释块未闭合 —— 那是个真 bug：sw.js 整份
 *        解析报 SyntaxError，Service Worker 从不注册，离线能力静默失效
 *        （data/poems-3|4|5|7|11|12.js、data/works-map.js、data/works-index.js、
 *         test/dedup.test.js、sw.js）
 *   v48  昭明文选「赋批」内容补齐（Issue #69 后续）：49 篇赋的白话译文
 *        补入 data/poems-zhaoming.js（赋类 56 篇至此全部有译文，全书译文
 *        29 → 78 篇，「待补」由 451 → 402）；站点总索引、README 与
 *        相关测试的计数随之更新
 *        （data/poems-zhaoming.js、data/site-index.js、README.md、
 *         test/zhaoming.test.js、sw.js）
 *   v49  昭明文选「诗批」内容补齐（Issue #69 后续）：251 篇诗的白话译文
 *        补入 data/poems-zhaoming.js（诗类 252 篇至此全部有译文，全书译文
 *        78 → 329 篇，「待补」由 402 → 151）；字体按新语料补字（四款各补 4 字，
 *        余 27 个 Noto CJK 本身无字形的极生僻字回落系统字体）；
 *        站点总索引、README 与相关测试的计数随之更新
 *        （data/poems-zhaoming.js、data/site-index.js、fonts/*.woff2、
 *         README.md、js/library.js、test/zhaoming.test.js、sw.js）
 *   v50  昭明文选「余类批」内容补齐（Issue #69 后续）：騷、七、诏、册、令、教、
 *        文、表、上书、启、弹事、笺、奏记、书、檄、对问、设论、辞、序、颂、
 *        赞、符命、史论、史述赞、论、连珠、箴、铭、诔、哀、碑文、墓志、行状、
 *        吊文、祭文共 151 篇的白话译文补入 data/poems-zhaoming.js ——
 *        **昭明文选全书 480 篇至此原文与译文齐备**，列表里不再有「待补」
 *        （全书译文 329 → 480 篇，「待补」由 151 → 0）；字体按新语料补字
 *        （四款各补 32 字，余 28 个 Noto CJK 本身无字形的极生僻字回落系统字体）；
 *        站点总索引、README 与相关测试的计数随之更新
 *        （data/poems-zhaoming.js、data/site-index.js、fonts/*.woff2、
 *         README.md、js/library.js、test/zhaoming.test.js、sw.js）
 *   v51  收尾一轮（Issue #69 剩余项）：
 *        ① 缓存键不再「只在监听得到事件的入口失效」—— js/app.js 把
 *           collectionsKey()（自选集合的版本）编进今日计划缓存键：
 *           在集子页加完篇目后**直接刷新首页**，刚加的那篇当天也会出现；
 *        ② 自选快照的来路标出来：js/collections.js 新增 markStale()，
 *           首页启动时标「快照待刷新」，进集子页 / 搜索页刷新后清标记；
 *        ③ 全站空态文案「搜遍全站」改为「搜遍六部集子」（与六部口径一致）；
 *        ④ 数据注释里的语料覆盖范围与体积口径复核
 *           （data/pinyin-table.js、data/common-chars.js、js/app.js、
 *            js/collections.js）
 *        （js/app.js、js/collections.js、js/search.js、js/reader-core.js、
 *         data/pinyin-table.js、data/common-chars.js、README.md、
 *         test/collections.test.js、test/search.test.js、sw.js）
 *   v52  正文收归主表 + 孤儿进度清理（Issue #69 收尾）：
 *        ① 同一篇作品在几部集子里各存一份正文时，只用**主条目**那一份
 *           （课内优先）：新增 data/canonical-texts.js（16 条正文、
 *           57 条译文改用主条目）与 scripts/build-canonical-texts.js；
 *           js/reader-core.js 在 mount 时按裁定表换正文 / 译文 ——
 *           《桃花源记》《陋室铭》《凉州词》等不再出现两种写法；
 *        ② 分组顺序收归一处：新增 data/group-order.js（页面与作品主表共用），
 *           js/songci.js / js/zhaoming.js 把词牌表与文体表挂上 window；
 *        ③ 课内自身重复去重后遗留的孤儿背诵进度清掉：js/storage.js 新增
 *           pruneUnknown()，首页启动时按当前语料清一次（不猜、不合流）；
 *        ④ 课外阅读入口页第一张卡指回课内诗词（/library/ 成完整的六部目录）
 *        （data/canonical-texts.js、data/group-order.js、
 *         scripts/build-canonical-texts.js、js/reader-core.js、js/storage.js、
 *         js/app.js、js/library.js、index.html 与六个集子页的 index.html、sw.js）
 *   v53  弹层不再被底部页签压住（Issue #69 跟进）：
 *        「加入背诵」弹框的集合列表与新建输入框原先会被底部导航栏横切一刀 ——
 *        点下去命中的其实是页签。根因是 .modal 的 z-index 为 50，
 *        低于底部页签（65）与底部播放栏（70）；给弹层垫 62px 内边距只是把内容
 *        顶开，遮罩与弹层边框仍被页签切开。现把弹层抬到 80：
 *        引导条 40 < 页签 65 < 播放栏 70 < 弹层 80 < toast 99
 *        （css/style.css、test/theme.test.js、test/collections.test.js）
 *   v54  弹层避让改用实测的 --nav-h（Issue #69 跟进·续）：
 *        上一条把层级抬到 80，解决了「点不到」；但避让仍写死 62px
 *        （默认字号下页签的高度），换字号 / 横屏 / PWA 就失准，
 *        弹层下缘仍会与页签图标叠成一团。现在三处避让统一用 --nav-h
 *        （js/pwa.js 实测的底部导航高度）：小弹层的下内边距与下外边距、
 *        大弹层的 max-height，都不再写死像素
 *        （css/style.css、test/layout.test.js、test/theme.test.js、test/run.sh）
 *   v55  自选集合的排序 / 整组移出 / 导入导出 + 篇名去编号（Issue #69 后续）：
 *        集合的顺序就是数组顺序，条目上给 ↑↓ 两颗键（不另存排序字段，
 *        免得两份顺序各说各话）；同一部集子 / 同一个卷次文体可「整组移出」；
 *        一整个集合能导出成**纯文本**（一颗条目 id 一行，`#` 是说明行），
 *        家长之间可互传清单，导入总是新建一个集合、认不出的行如实报数；
 *        自选篇目显示的篇名去掉语料内部用来区分的「其一 / 其二 / 其三」
 *        （只改显示，存的仍是完整 id）
 *        （js/collections.js、js/app.js、index.html、css/style.css、
 *          test/collections.test.js）
 *   v56  背诵进度总览（/progress/）—— 到期日历 + 掌握度分布（Issue #69 后续）：
 *        原先「第几轮 / 掌握度 / 下次复习」只在**单篇**的详情弹层里看得到，
 *        看不出「接下来哪天要复习几篇」。新页把全量摊成三张图：未来 14 天的
 *        到期日历（逾期并进「今天」那一格，逾期一周以上单列）、掌握度五档、
 *        记忆阶段十档。这一页**只读**：不改任何一篇的进度、不写已读、不排任务。
 *        聚合口径在 js/scheduler.js 的 overview() / daysUntilDue()
 *        （js/scheduler.js、js/progress.js、progress/index.html、css/classic.css、
 *          js/chrome.js、settings/index.html、sw.js、test/progress.test.js）
 *   v57  首页快照与语料订正的漂移自动刷新（Issue #69 后续）：
 *        上一轮只做到「首页启动刷一次 + 课外那些标 stale 等下次进集子页」——
 *        而用户在首页停留的整个会话里都不会经过集子页，那一篇可能连着好几天
 *        显示旧题名。现在首页**按需把那一部集子的数据文件拉回来**刷新快照：
 *        一部都不涉及就不发请求，一次只拉一部，拉不到就留着 stale 下次再试。
 *        顺带补上一处真缺口：首页原先**没加载 data/site-index.js**，
 *        app.js 里那一串 `window.SITE_INDEX || []` 于是静默为空
 *        （表现为「自选那一篇在首页显示不出来」，而不是报错）。
 *        另：《昭明文选》正文里 218 处 markdown 图片占位（生僻字的 SVG 图）
 *        按用户要求全部清理（data/poems-zhaoming.js）
 *        （js/app.js、js/collections.js、index.html、data/poems-zhaoming.js、
 *          test/progress.test.js、test/zhaoming.test.js）
 *   v58  昭明文选生僻字补全（Issue #69 跟进·续）：
 *        正文里那批 markdown 图片占位符 `![&#x247E2;](images/247E2.svg)`
 *        换回**真字**；字形从花園明朝（HanaMin，公开领域）逐字取轮廓补进
 *        四款字体子集，全站用字**零缺字**。
 *        同时修掉两处「只扫 BMP、看不见扩展区」的隐藏漏洞：
 *        scripts/supplement-fonts.py 的扫描口径，以及 test/theme.test.js
 *        里那段 python 的扫描正则（JS 模板字符串把 `\U` 吃掉，
 *        导致扩展区一个字也扫不到、「缺 28 字」空转了整整一轮）
 *        （data/poems-zhaoming.js、fonts/*.woff2、
 *          scripts/supplement-fonts.py、test/theme.test.js、test/zhaoming.test.js）
 *   v59  「其N」编号核对与订正（Issue #69 跟进）：课内有两组同题诗在小批次补录时
 *        自拟了「其一 / 其二」的序号，与传世全集里的篇次对不上 ——
 *        卢纶《塞下曲》「月黑雁飞高」标成其一（实为其三）、「野幕敞琼筵」
 *        标成其二（实为其四）；杜甫《江畔独步寻花》「黄四娘家花满蹊」标成
 *        其一（实为其六）、「黄师塔前江水东」标成其二（实为其五）。现已按真实
 *        篇次订正，并把 17 条带「其N」的课内标题逐条对正文写进测试
 *        （data/poems-4.js、data/poems-6.js、test/title-seq.test.js、
 *          test/scheduler.test.js、test/run.sh）
 *   v59  正文收归主表的**存储层**（Issue #69 收尾）：
 *        此前 data/canonical-texts.js 只做到「显示时把正文换成主条目那一份」——
 *        磁盘上同一篇正文仍各存一份。这一轮把它收到**存储层**：
 *        同一篇作品的正文 / 译文只落一份（data/text-master.js，由
 *        scripts/build-text-master.js 算出），其余集子的条目退化成只存归属
 *        （条目上留 textRef 指过来，text / translation 三行摘掉）。
 *        正文由 js/reader-core.js 按 textRef 取回，对列表 / 阅读器 / 朗读 /
 *        排程 / 搜索完全透明。共 114 条条目收归，57 篇作品的正文自此只有一份。
 *        显示层的 data/canonical-texts.js 因此收敛为空表（异文既已不存在，
 *        就不必再替换）；机制保留，给日后真出现异文时用。
 *        （data/text-master.js、data/poems-*.js、data/index.js、
 *          data/site-index.js、data/canonical-texts.js、js/reader-core.js、
 *          scripts/build-text-master.js、scripts/apply-text-master.js、
 *          test/master-env.js、test/*.test.js、七处页面 HTML）
 *   v60  搜索页的四条体验修正（Issue #69 后续·再续）：
 *        ① 搜索框「增高」改走**真实高度**（52px），不再用 transform: scaleY(1.3)
 *           把 40px 拉到视觉 52px —— 那会把 12px 的圆角纵向拉伸成椭圆角、
 *           把 placeholder 的字形压扁（用户反馈的「四个圆角不太正常、
 *           placeholder 有点压扁」正是这一处）；配套把 hero 的 --hero-box-h
 *           由 40px 改成 52px（居中的中线）、.search-wrap 的位移由 6px 收到 2px、
 *           候选下拉的 top 由 5px 改 4px；
 *        ② 没输入关键词时那段说明（「输入篇名、作者或诗句，即可搜遍六部集子」）
 *           整段撤掉：空列表就是空列表，只留一小段留白（桌面 44px / 手机 8px），
 *           节点仍留着并被标成 data-empty="idle"（读屏与「没找到」那一支仍可用）；
 *        ③ 候选下拉限高改成三项取最小：400px（8 条的上限）、可视区的四成
 *           （手机；桌面六成）—— 给下方结果卡片留出可见的一片、
 *           可视区 − 键盘 − 86px（硬边界，绝不伸进键盘底下）；
 *           每换一次关键词把下拉滚回顶部；
 *        ④ 补两条「把下拉收起来」的路：滚结果列表即收（140ms 延迟越过手指抖动）、
 *           候选挂着时点结果区先收那一下且不穿过浮层开篇（关键词与结果都留着）
 *        （js/search.js、css/classic.css、test/search.test.js、
 *          test/pwa.test.js、README.md、sw.js）
 *   v61  近重复合并（Issue #69 收尾最后一轮）：
 *        上一轮把「一字之差」的那些登记成 WORKS_NEAR_DUP / TEXT_NEAR_DUP、
 *        **并列而不合并**（选本原貌 vs 教材 / 通行字，谁对谁错没人能裁）。
 *        这一轮用户给了裁定口径：「合并，以教材为准，没有教材的，以简体字为准，
 *        无法裁决的，自行判断并合并」——
 *          · 《黄鹤楼送孟浩然之广陵》 唯见 / 惟见 → 取教材「唯」
 *          · 《夜上受降城闻笛》       回乐烽 / 回乐峰 → 取教材「烽」
 *          · 《将进酒》               不愿醒 / 不复醒（另有顿号 / 逗号）→ 取教材
 *          · 《蝶恋花》               白苹 / 白蘋 → 没教材，取简体「苹」
 *        四组并成三篇（《将进酒》与另两组是「课内 ↔ 唐诗三百首」，
 *        《蝶恋花》两条同在宋词三百首，并成一条、删掉自拟编号的那条）。
 *        用字统一后按同一篇收归主表：搜索只出一条、自选加不进第二遍、
 *        排程只排一次，学生也不再读到与课本不一样的那一份。
 *        裁定表与依据在 scripts/near-dup-merge.js（逐组写明「以谁为准」）。
 *        （data/poems-4.js、data/poems-7.js、data/poems-11.js、
 *          data/poems-tangshi.js、data/poems-songci.js、data/text-master.js、
 *          data/works-map.js、scripts/near-dup-merge.js、
 *          test/dedup.test.js、test/canonical.test.js、test/collections.test.js）
 *   v62  补回被整篇丢掉的《送孟东野序》（Issue #69 收尾）：
 *        #73 补录这篇时把 source 写成选本名《古文观止》；随后 #74「补齐十二卷
 *        目录」把 data/poems-guwen.js 整个重写了一遍，这篇因为「出处 = 选本名」
 *        这个特征列不进任何一卷的真实来源清单，便被静默丢掉 —— 目录、分组、
 *        计数、搜索全都不报错，只是少了一篇。
 *        现按现行体例放回「卷八 唐文」（韩愈，《昌黎先生集》），
 *        并给 test/guwen.test.js 加了防线：出处必须是真实来源书、卷八名篇点名核对。
 *        （data/poems-guwen.js、data/site-index.js、README.md、test/guwen.test.js、sw.js）
 *   v63  撤掉自拟编号、补出来的信息一律留空（Issue #69 · 收尾最后一轮）：
 *        ① 宋词 20 条「其一 / 其二 / 其三」是整理者为分辨同名条目**自拟**的，
 *           不是选本原名 —— 全部改为**首句副题**
 *           （浣溪沙·一曲新词酒一杯、木兰花·燕鸿过后莺归去、蝶恋花·庭院深深深几许…）；
 *        ② 《昭明文选》145 条本来填着「东汉 / 西晋」这类朝代，那是按人名表
 *           推出来的、诸家题署里**没有**的信息 —— 一律留空。
 *           划线口径是「题署与常用姓名是否同形」：同形 = 选本只给了字 → 留空；
 *           不同形 = 选本自己给了本名 / 帝号 → 朝代照录（「汉高祖」记西汉）。
 *           顺带把 data/poems-zhaoming.js 里三处「选本署字、却把字写成本名」
 *           的题署订正回选本原样（贾谊 → 贾长沙、荆轲 → 荆卿）。
 *        ③ 查看器 / 列表 / 搜索 / 收藏四处都改成「有哪栏排哪栏」，
 *           朝代一空不再渲染出「 · 徐陵」这种以分隔符开头的残句。
 *        （data/poems-songci.js、data/poems-zhaoming.js、js/app.js、js/search.js、
 *          test/songci.test.js、test/zhaoming.test.js、test/search.test.js、
 *          test/collections.test.js、README.md）
 *   v64  昭明文选 480 篇正文收归存储主表（Issue #69 · 按部推进第 1 部）：
 *        同一篇作品的正文 / 译文全站只落一份（data/text-master.js），
 *        集子条目退化成只存归属（textRef），正文由引擎按主表取回。
 *        本轮收第一部《昭明文选》480 篇；data/poems-zhaoming.js 2.1MB → 154KB。
 *        页面可见文本零变化。
 *        （data/text-master.js、data/poems-zhaoming.js、
 *          scripts/build-text-master.js、scripts/apply-text-master.js、测试）
 *   v66  搜索页搜索框的机上位置与描边（Issue #69 · 用户机上反馈）：
 *        ① 聚焦 / 键盘弹着 / 有搜索内容 → 搜索框连同候选下拉一起**升到标题栏下方**
 *           （position: sticky + top: 0，滚动看结果时框一直看得见）；
 *           清空内容且不在焦点上 → 回到页面垂直居中（用户原话的四条要求）；
 *        ② 搜索框到结果列表的留白一律 8px，js/search.js 不再往 hero 上行内写
 *           paddingBottom —— 一设一撤会让列表整块挪 4px；
 *        ③ 聚焦描边不再是浏览器默认那支近黑的 ring：改成天青主色 + 纸色底，
 *           并给键盘操作留一圈 focus-visible 描边；
 *        ④ 宋词三百首 283 篇正文收归存储主表（Issue #69 · 按部推进第 3 部）：
 *           FULL_BOOKS 清单加 `songci`，主表 705 → 977 条，
 *           data/poems-songci.js 283 条摘掉内联正文、改留 textRef
 *           （275KB → 76KB，-72%）。页面可见文本零变化：列表 283 条、
 *           逐条打开取出的标题 / 元信息 / 正文 / 译文逐字节一致。
 *        （css/classic.css、js/search.js、data/text-master.js、data/poems-songci.js、
 *          scripts/build-text-master.js、README.md、测试）
 *   v67  朗读播放档位搬到设置页，与圆键菜单同源（Issue #69 后续）：
 *        五档连读方式原先只在「分类卡右侧圆键的长按 / 右键菜单」里，
 *        界面上没有任何提示、设置页也没有入口。现在：
 *          · 新增 js/play-modes.js —— 五档模式 / 存储键 / 出厂档的**唯一一份**定义，
 *            js/reader-core.js 与 js/settings.js 都读它（原先两份各写一遍，字或 id
 *            一改就会错开：设置里选中的和实际连读的不是同一档）；
 *          · 设置页新增「朗读播放」分组：五档单选项 + 一行说明「圆键长按 / 右键也能调」；
 *          · 两个入口读写同一份 poem_play_mode_v1，换标签页时靠 storage 事件同步。
 *        （js/play-modes.js、js/reader-core.js、js/settings.js、
 *          settings/index.html、css/style.css、sw.js、测试）
 *   v65  古文观止 167 篇正文收归存储主表（Issue #69 · 按部推进第 2 部）：
 *        FULL_BOOKS 清单加 `guwen`，主表 540 → 705 条，
 *        data/poems-guwen.js 167 条摘掉内联正文、改留 textRef。
 *        页面可见文本零变化（逐条比对正文 / 译文字节一致）。
 *        顺带修两处**吞条目**的静默故障：
 *          ① scripts/apply-text-master.js 的条目切块正则把缩进写死成两格，
 *             而《齐桓晋文之事》那一条的 `{` 是顶格的 —— 该条一直没被处理；
 *          ② 同文件按 id 认条目用的正则漏了多行标志 `m`，
 *             导致 `{` 与 `id:` 不同行的条目（改了排版后是绝大多数）
 *             一个都匹配不上、id 取成空串，同样静默漏摘。
 *        另修 data/poems-guwen.js 的 getGuwenById()：条目只剩 textRef 后
 *        直接返回原始条目会让 `getGuwenById(id).text` 变成 undefined。
 *        （data/text-master.js、data/poems-guwen.js、
 *          scripts/build-text-master.js、scripts/apply-text-master.js、测试）
 *   v68  搜索框「该待在哪儿」三态 + 点空白收下拉 + 结果贴近搜索框
 *        （Issue #69 · 再续）：
 *        ① 搜索框三种摆法（.search-hero 的两个类，js/search.js 的 syncHeroState）——
 *           居中（默认）/ 贴顶（.search-active：有焦点**或**有内容）/
 *           键盘弹着（.kb-open，落位同贴顶，另把列表上方留白收掉）。
 *           聚焦即贴到标题栏下方，候选下拉跟着上去；有内容时失焦**仍停在页顶**；
 *           清空内容且没焦点才回到页面中心。
 *        ② 点页面任何一处空白 → 候选下拉消失（挂在 document 的 capture 阶段，
 *           判据只有一条「落点在搜索区之外」，只收下拉、不阻断事件）。
 *        ③ 「框 → 结果列表」的间距收成正常间隔：贴顶时紧跟着（0），
 *           居中时留一小段（--search-list-gap: 12px）；空态留白 44px → 4px。
 *        ④ 焦点描边不再是浏览器给的黑线：border-color 落到天青 + outline: none +
 *           一圈极淡天青光晕（真机上量到过：那一圈黑是 UA 的 focus ring）。
 *        ⑤ 候选下拉限高收到 380px / 可视区四成 / (可视区−键盘) 六成 ——
 *           上一版 60% 在手机上太松，候选铺到可视区下沿前 30px，
 *           「给结果卡片留一片」等于没留。比例与硬边界都算在 JS 实测的
 *           --kb-visible 上（svh 不认软键盘）。
 *        ⑥ 修两处层级 / 取值 bug（真机与无头浏览器都复现过）：
 *           · hero 的 z-index: 0 会新建层叠上下文，把候选下拉关在里头 ——
 *             结果列表在 hero 外面、DOM 里更靠后，于是整个 hero 压不过它，
 *             候选与结果卡片叠成一团（现已撤掉 hero 的 z-index，
 *             只留 .search-toolbar 的 z-index: 1 当唯一的层级来源）；
 *           · --kb-space / --kb-visible 只写在 hero 上时，键盘弹起后 .suggest
 *             的继承值不会重算，下拉照旧按「没有键盘」的高度铺下来 ——
 *             现在 hero 与 .suggest 各写一遍。
 *        （css/classic.css、js/search.js、test/search.test.js、
 *          test/pwa.test.js、README.md）
 *   v73  唐诗三百首 301 首正文收归存储主表（Issue #69 · 按部推进第 4 部）：
 *        FULL_BOOKS 清单加 `tangshi`，主表 977 → 1232 条，
 *        data/poems-tangshi.js 301 条摘掉内联正文、改留 textRef
 *        （236KB → 64KB，-73%）。页面可见文本零变化：
 *           · 255 条单篇（唐诗独有）的标题 / 元信息 / 正文 / 译文逐字节一致；
 *           · 46 条与课内同篇的（如 ts-231《夜思》↔ poems-xx1-09《静夜思》、
 *             ts-6《望岳》↔ poems-cz7-19）正文 / 译文改取主条目那一份 ——
 *             这正是收归前 canonical-texts.js 在显示层做的事，
 *             存储层收归后「本来就只有一份」，显示结果不变。
 *        版本号按「并行 PR 一律 +5」的口径从 v68 起落到 v73。
 *        （data/text-master.js、data/poems-tangshi.js、
 *          scripts/build-text-master.js、test/canonical.test.js、
 *          test/dedup.test.js、README.md）
 *   v78  小古文 99 篇正文收归存储主表（Issue #69 · 按部推进第 5 部）：
 *        FULL_BOOKS 清单加 `classic`，主表 1232 → 1331 条，
 *        data/poems-classic.js 99 条摘掉内联正文、改留 textRef
 *        （90KB → 30KB，-67%）。页面可见文本零变化：
 *           · 99 条（小古文独有）的标题 / 元信息 / 正文 / 译文逐字节一致；
 *           · 剩下 1 条《答谢中书书》（gw-60）与课内八年级上同篇，
 *             早在前几轮就由判重表收归（主条目 poems-cz8-02），
 *             这一条的正文 / 译文 / 来源本轮起也就显式走主表那一份
 *             —— 收归前 canonical-texts.js 在显示层做的就是这件事。
 *        至此五部集子全部收归完毕（小古文是最后一部）。
 *        版本号按「并行 PR 一律 +5」的口径从 v73 起落到 v78。
 *        （data/text-master.js、data/poems-classic.js、
 *          scripts/build-text-master.js、test/canonical.test.js、
 *          test/dedup.test.js、README.md）
 *   v83  背诵进度总览补上「全部到期篇目」+ 正文收归的三件收尾（Issue #69 收尾），
 *        与搜索页三态 / 聚焦描边的收尾（Issue #69 · 用户机上反馈 · 收口）撞在
 *        同一个版本号上，故合记为一版：
 *
 *        【一】背诵进度总览补上「全部到期篇目」+ 正文收归的三件收尾：
 *        ① /progress/ 原先只有到期日历（哪天几篇）与两张分布图，
 *           日历上那一格点不进去、也不知道「周三那 5 篇是哪 5 篇」。
 *           本轮补上**全部到期篇目**：日历那一格摊开成篇名清单，
 *           每篇带阶段 / 掌握度 / 「逾期 N 天」或「还有 N 天」，
 *           点日历格子滚到那一天那一档，篇名指回首页去背（这一页仍只读）。
 *           清单与日历**同一本账**：逐档的篇数与日历逐格的数必须相同，
 *           逾期超过一周的另挂一截「逾期超过一周 · N 篇」（与 overview 的
 *           overdue 一样是另计，不并进「今天」的天数，两处数才逐格对得上）。
 *           口径在 js/scheduler.js 新增的 dueList()：overview() 出「形状」、
 *           dueList() 出「名册」，两者共用同一套归档规则。
 *        ② 收尾清扫：README 两处口径数字漂了（正文收归 1402 → **1391**、
 *           只存归属 765 → **1391**），逐条数回来；
 *           scripts/build-text-master.js 的 FULL_BOOKS 清单从「收谁不收谁」
 *           降为**历史声明**（五部已收齐，现在凡在册且带正文的一律全收）。
 *        ③ 清单制收口：脚本与 test/canonical.test.js 各自多一条**终态断言** ——
 *           清单点名的部里「有正文」的条目一条都不许漏、语料里「带 textRef
 *           却还内联正文」的副本一律亮红（同一个脚本里两处点名）。
 *        （js/scheduler.js、js/progress.js、progress/index.html、css/classic.css、
 *          settings/index.html、scripts/build-text-master.js、data/text-master.js、
 *          test/progress.test.js、test/canonical.test.js、README.md）
 *
 *        【二】搜索页三态与聚焦描边的收尾，并统一聚焦光晕的写法：
 *        在 v66 / v68 那条线上补齐三处：
 *        ① 贴顶那一块合成**一处**写清（原先 .search-hero 下另有一份
 *           「交出高度 + --hero-top」的规则，与 .search-active / .kb-open
 *           那份重复；同一件事两处写就是下次「改一处忘一处」的种子）。
 *           现在同一块同时交代竖位、整行绝对定位改普通流、以及 sticky。
 *        ② 候选下拉限高的**硬边界**改按 (可视区 − 键盘) × 六成算 ——
 *           原先只写「可视区 × 六成」，把键盘遮住的那半也算成了能放候选的地方。
 *           限高的三个数仍是 380px（手机 320px）/ 可视区四成 / 那一项。
 *        ③ 聚焦描边这条 CI 红过的坑写进注释与防线：`:focus` 与 `:focus-visible`
 *           特异性相同（都是 0,4,1），各写一条时后者必把前者的 outline: none
 *           盖回去（真机上量到 outline 仍是 2px solid，黑框等于没修）——
 *           两支选择器必须共用一条规则，只留 box-shadow 那圈淡天青光晕。
 *        ⚠️ 与 v66 / v68 是同一条线上的接力，不是推翻：v66 把「贴顶」找回来、
 *           把描边从 UA 黑框换成本站天青，v68 把贴顶做成三态（一个出口）、
 *           改用 sticky、并补上「点空白收下拉」。
 *        （css/classic.css、js/search.js、test/search.test.js、
 *          test/pwa.test.js、README.md）
 *
 *        【三】光晕色值不再被误填成不透明填充色：
 *        body[data-nav="search"] .search-hero .search-input:focus 的 box-shadow
 *        曾被写成 --green-light（#dbe9e2，不透明的浅底**填充色**），
 *        于是聚焦时搜索框外围画出一圈实心粉绿框，与全站 .search-input:focus
 *        那圈半透明淡光（rgba(47, 96, 85, .10)）不是一回事 —— 同一枚控件两副面孔。
 *        现已改回与全站同值；test/pwa.test.js 拿真浏览器量光晕色相，
 *        test/theme.test.js 另补一条纯源码断言（缺 puppeteer 时也能守住）。
 *        （css/classic.css、test/theme.test.js）
 *
 *        版本号按「并行 PR 一律 +5」的口径从 v78 起落到 v83。
 *
 *   v88  课内诗词补上索引页（Issue #114 第一条）：课外阅读入口页（/library/）
 *        摆着六张卡，另外五张都指各自的索引页（/classic/、/tangshi/……），
 *        只有「课内诗词」那张指回首页（/）—— 而首页是**今日背诵**：
 *        一进去就是按遗忘曲线排的今天那几首。同一个动作在这张卡上得到了
 *        与其余五张不同的结果。
 *        现在新增 /poems/ 课内诗词索引页（挂载脚本 js/poems.js），
 *        与五部集子共用同一套引擎（js/reader-core.js）：按**教材册次**
 *        分 24 组（一年级上 → 高三下），261 首一首不少，点进去是同一个
 *        整页详情（注音 / 朗读 / 白话译文 / 上一篇下一篇）。
 *        gradeGroup 由 js/poems.js 挂载前现算，**不改数据文件**。
 *        「已读」是新键 poem_poems_read_v1：与首页的背诵进度
 *        （poem_recite_progress_v1，记的是遗忘曲线）分开存 ——
 *        在这儿翻一首不该被记成一笔复习。
 *        首页那一套（今日背诵 + 遗忘曲线 + 自选排程）一个字不动。
 *        列表上不挂「加入背诵」圆键（reciteList: false）：那 261 首本来
 *        就在每日任务里，再挂一枚会让人以为「不点它就不会被排上」。
 *        页签归属：/poems/ 算「课外」这一格（用户是从那一页点进来的）。
 *        （poems/index.html、js/poems.js、js/chrome.js、js/library.js、
 *          js/reader-core.js、library/index.html、sw.js、测试）
 *
 *        版本号按「并行 PR 一律 +5」的口径从 v93 起落到 v98（main 那笔已占 v93，本条再 +5）。
 */
const CACHE_NAME = "poem-app-v98";

/* 需要在首次访问时预缓存的核心资源 */
const PRECACHE = [
  "./",
  "./manifest.webmanifest",
  "./css/style.css",
  "./css/classic.css",
  "./fonts/NotoSerifSC-400.woff2",
  "./fonts/NotoSerifSC-600.woff2",
  "./fonts/NotoSansSC-400.woff2",
  "./fonts/NotoSansSC-600.woff2",
  "./classic/",
  "./settings/",
  "./js/settings.js",
  // 朗读播放档位：五档模式 / 存储键 / 出厂档的唯一一份定义，
  // 阅读器与设置页共用（顺序须在两者之前）
  "./js/play-modes.js",
  "./terms/",
  "./privacy/",
  "./css/legal.css",
  "./js/contact.js",
  "./data/pinyin-table.js",
  "./data/common-chars.js",
  "./js/pinyin.js",
  "./js/speech.js",
  "./js/reader.js",
  "./js/storage.js",
  // 复习调度算法（可切换）：遗忘曲线 / Leitner / SM-2 / FSRS 简化版。
  // ⚠️ 须排在 scheduler.js 之前 —— scheduler.review() 一进来就转交给它。
  "./js/review-models.js",
  "./js/scheduler.js",
  "./js/app.js",
  "./js/chrome.js",
  "./js/classic.js",
  // 古籍阅读库：索引页 + 详情页的引擎（小古文 / 唐诗 / 宋词 / 古文观止 共用）
  "./js/reader-core.js",
  "./data/site-index.js",
  // 背诵进度总览（/progress/）：到期日历 + 掌握度分布，只读本机进度
  "./progress/",
  "./js/progress.js",
  // 作品主表 + 同篇对照表（自选集合 PR，Issue #69 收尾）：
  // 判重「这篇是不是已经在别处背过了」，搜索去重、加自选集合、排每日任务都读它
  "./data/works-map.js",
  "./data/works-index.js",
  // 正文存储主表（Issue #69 收尾）：同一篇作品的正文 / 译文只落一份，
  // 各集子条目退化成只存归属（textRef），正文由引擎按它取回。
  // ⚠️ 须与页面 <script> 顺序一致：排在 site-index.js / canonical-texts.js 之前。
  "./data/text-master.js",
  // 显示层裁定表（Issue #69 收尾）：存储层收归后已收敛为空表，
  // 保留机制给日后真出现异文时用。
  "./data/canonical-texts.js",
  // 分组顺序总表（卷次 / 词牌 / 文体）：页面与作品主表共用
  "./data/group-order.js",
  // 自选集合（除教材之外，用户自己加进来要背的篇目）
  "./js/collections.js",
  "./js/manifest-loader.js",
  "./data/poems-1.js",
  "./data/poems-2.js",
  "./data/poems-3.js",
  "./data/poems-4.js",
  "./data/poems-5.js",
  "./data/poems-6.js",
  "./data/poems-7.js",
  "./data/poems-8.js",
  "./data/poems-9.js",
  "./data/poems-10.js",
  "./data/poems-11.js",
  "./data/poems-12.js",
  "./data/index.js",
  // 课内诗词索引页（/poems/）：与五部集子同一套索引页 + 详情页，
  // 数据就是上面那 12 册 + data/index.js（已缓存），这里只多一页 + 一个挂载脚本
  "./poems/",
  "./js/poems.js",
  "./data/poems-classic.js",
  // 唐诗三百首（内容 PR，Issue #69）：索引页 + 数据 + 挂载脚本
  "./tangshi/",
  "./data/poems-tangshi.js",
  "./js/tangshi.js",
  // 宋词三百首（内容 PR，Issue #69）：索引页 + 数据 + 挂载脚本
  "./songci/",
  "./data/poems-songci.js",
  "./js/songci.js",
  // 古文观止（内容 PR，Issue #69）：索引页 + 数据 + 挂载脚本
  "./guwen/",
  "./data/poems-guwen.js",
  "./js/guwen.js",
  "./zhaoming/",
  "./js/zhaoming.js",
  "./data/poems-zhaoming.js",
  // 课外阅读入口页 + 全站搜索页（搜索页 + 导航栏变更 PR，Issue #69）
  "./library/",
  "./js/library.js",
  "./search/",
  "./js/search.js",
  "./icons/icon-120.png",
  "./icons/icon-152.png",
  "./icons/icon-167.png",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-256.png",
  "./icons/icon-384.png",
  "./icons/icon-512.png",
  "./icons/icon.svg"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // 单个资源失败不应让整次安装失败，用 allSettled 兜底
      return Promise.allSettled(PRECACHE.map(function (url) {
        return cache.add(new Request(url, { cache: "reload" }));
      }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE_NAME ? null : caches.delete(k);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  const req = event.request;

  // 只处理同源 GET
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 页面导航：网络优先（顺手更新该页缓存）；离线时先回退到「同一页面」的缓存，
  // 再回退到首页 —— 直接回退首页会让断网下的设置页、法务页莫名回到列表页
  if (req.mode === "navigate") {
    const pageUrl = req.url.split("#")[0].split("?")[0];
    event.respondWith(
      fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(function (c) { c.put(pageUrl, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(pageUrl).then(function (hit) {
          if (hit) return hit;
          // 首页现在的 URL 就是 "./"（目录化路由，不再有 index.html）
          return caches.match("./");
        });
      })
    );
    return;
  }

  // 其余静态资源：缓存优先，回源后写入缓存
  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
