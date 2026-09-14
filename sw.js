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
 */

const CACHE_NAME = "poem-app-v48";

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
  "./js/scheduler.js",
  "./js/app.js",
  "./js/chrome.js",
  "./js/classic.js",
  // 古籍阅读库：索引页 + 详情页的引擎（小古文 / 唐诗 / 宋词 / 古文观止 共用）
  "./js/reader-core.js",
  "./data/site-index.js",
  // 作品主表 + 同篇对照表（自选集合 PR，Issue #69 收尾）：
  // 判重「这篇是不是已经在别处背过了」，搜索去重、加自选集合、排每日任务都读它
  "./data/works-map.js",
  "./data/works-index.js",
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
