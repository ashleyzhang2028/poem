#!/usr/bin/env bash
# 运行全部测试
#
# 分四十几层，逐层递进（每层一个「为什么这么写」的说明在它自己上方）：
#   1. 调度算法单元测试  —— 纯 Node，无外部依赖
#   2. UI 集成测试       —— jsdom，缺少则一次性临时安装（见下方说明）
#   3. 小古文学习库测试  —— jsdom，100 篇数据 + 阅读器 + 已读标记
#   3b. 古籍阅读库测试   —— jsdom + vm，四部集子共用的索引页/详情页引擎
#   3c. 唐诗三百首测试   —— jsdom + vm，301 首数据 + 卷次分组 + 阅读器
#   3d. 宋词三百首测试   —— jsdom + vm，255 首数据 + 词牌分组 + 阅读器
#   3e. 古文观止测试     —— jsdom + vm，十二卷 166 篇全收 + 卷次分组 + 阅读器
#   3g. 昭明文选测试     —— jsdom + vm，六十卷 480 篇 + 三十九类文体分组 + 阅读器
#   3f. 搜索页与导航测试 —— jsdom，五部合一的索引 + 候选下拉 + 集子筛选 + 四格页签
#   3f2.课外阅读导航测试 —— jsdom，入口页「就地叠层」：点集子铺索引、
#                          点一篇开阅读器、返回键一层退一层（Issue #122）
#   3h. 自选集合测试     —— jsdom + vm，作品主表判重 + 自选集合增删改查 + 排进遗忘曲线
#   3h2.课内诗词索引页   —— jsdom，/poems/ 按教材册次分 24 组的目录页 +
#                          点一篇进详情（Issue #114 第一条）
#   3i. 课内去重测试     —— jsdom + vm，12 组自身重复按低年级版本去重 + 《静夜思》教材文本
#   3j. 正文收归主表     —— jsdom + vm，存储层同一篇只落一份正文 / 译文
#                          （各集子条目只存归属 textRef）+ 孤儿进度清理
#   3k. 布局避让测试     —— 纯 Node，弹层按 --nav-h 避让底部导航，不被页签 / 播放栏压住
#   3o. UI 一致性 / 响应式 —— 纯 Node，同一套组件的圆角 / 尺寸只有一个来源、
#                          「画出来的尺寸 = 声明的尺寸」、宽屏（平板 / 桌面）
#                          不许把页签 / 卡片 / 选项 / 日历拉变形（Issue #122）
#   3l. 背诵进度可视化   —— jsdom + vm，到期日历 / 掌握度分布，以及首页按需拉回
#                          集子数据刷新旧快照（Issue #69 后续）
#   3m. 「其N」编号核对  —— jsdom + vm，课内带「其N」的标题逐条对正文与真实篇次
#                          （卢纶《塞下曲》、杜甫《江畔独步寻花》原为自拟错标）
#   3n. 复习调度算法    —— jsdom + vm，四张模型（遗忘曲线 / Leitner / SM-2 /
#                          FSRS 简化版）的公式、换模型不清进度、设置页切换
#                          与首页副标题跟随（Issue #114 后续）
#   3o2.自助排查        —— 纯 Node + 本机 http，/self-check/ 与 GET /api/diag：
#                          缺密钥 / 缺库 / 连不上库三种情形给出互斥结论，
#                          报告里一个密钥都不出现（Issue #225）；
#                          并守着「平台层 404」与「本站 E_404」**分得开**
#                          —— 前者是函数没被调起来，后者才是路由表少一条
#                          （2026-09-18 那次整站 /api/* 404 就是前者）
#   3p. 账号与随机码认证 —— 纯 Node，邮箱归一化 / 发码频控 / 单次使用 /
#                          过期 / 锁定 / 时间倒退 / 退化随机源不死循环（Issue #132）
#   3v. 服务端账号接口  —— 纯 Node + 本机 http（不联网、不装新依赖）：1A 期的
#                          六个接口（send-code / verify-code / me / sync·pull /
#                          sync·push / account）与发信适配层。守的是 docs §4.3
#                          那份 checklist：明文码不进日志、权益只从 /api/me 来、
#                          写接口都有频控、响应不透露邮箱是否存在、会话是
#                          HttpOnly Cookie、注销即删除、sw.js 不缓存 /api/*。
#                          第廿二 / 廿三 / 廿四节是 Issue #197 的完整登录流程：
#                          注册 / 确认邮件 / 密码登录 / 忘记密码 / 重设密码 /
#                          随机码快捷登录六条路，逐条钉住「明文口令不落任何地方」
#                          「不泄露邮箱是否存在」「重设必须吊销全部会话」
#                          「发信是事实，不是尽力」；另有盘上形状与「不假装」的源码口径。
#                          第廿三节另守六个**真出现过**的洞：
#                          猜错封禁真的会锁（§5.5 原先只有文档）、锁定会到期、
#                          频控当场落账（并发下不是「不限」）、校验口有 IP 档、
#                          早退路径也落账、冒烟中转码不随 5xx 泄出、
#                          会话不再无上限滑动续期、隔离性如实自报；
#                          第廿四节是后半段那条口径的总闸 ——
#                          **邮箱没确认就不让登录**（两条登录路都拦、
#                          只拦一条等于没拦；老账号的出路是匿名重发；
#                          应急闸门 REQUIRE_EMAIL_VERIFIED=0 关得掉，
#                          而且关掉时界面看得出来）
#   3q. 权益分层与语音门 —— 纯 Node，free/pro/max 功能矩阵的唯一出口 can()、
#                          登录是语音播放的硬条件、放行后 stop/pause 不受门限制、
#                          页面上不许自己拼 plan（Issue #132）
#   3r. 头像            —— 纯 Node，两档（图片 / 昵称首字）、地址白名单
#                          （javascript: 与 data:text/html 一律拒收）、分域隔离
#                          （地址进账号域、字节进设备域）、方形裁切的纯几何、
#                          不用邮箱首字母（Issue #132 → #163 重裁）
#   3r2.头像上传        —— 纯 Node + jsdom，客户端那条线：先本机后服务端、
#                          裸字节上传、三种失败各说各的话、删头像先清地址（Issue #163）
#   3s. 二级设置页      —— 纯 Node，五张页（「我的」+ 四张二级页）的结构：
#                          四张页合起来仍是原来那六组、每件控件只在一页上、
#                          二级页的返回键回「我的」页、新页面都进了预缓存（Issue #132）；
#                          第七节守 Issue #209 那一轮改名：底部最后一格叫「我的」
#                          （图标是圆形用户头像 + 首字）、「关于」就地渲染、
#                          页面上那个版本号与 sw.js 的 CACHE_NAME 同一个数
#   3t2.账号入口动线    —— jsdom + 源码扫描，从一个「未登录的人」到 /login/ 的
#                          两条落点（「我的」页第一条、/profile/ → 账号入口）与
#                          返回落点（登录 → 个人中心 → 「我的」页）（Issue #132）；
#                          Issue #209 之后顶栏那枚印撤了，那一条路随之消失 ——
#                          所以剩下这两条更不能断（各由不同文件渲染）
#   3x. 账号接线        —— 纯 Node + 假 fetch，2 期「补洞 + 2A」接上的两根线：
#                          /api/me 下发的层级与角色真的落到权益层（服务端优先）、
#                          注销时「先服务端、后本机」且云端那一份导出给用户、
#                          四条边界（失败不打断 / 不假装 / 不清数据 / 不发无谓请求）
#   3t. 账号三页        —— 纯 Node + jsdom，/login/ /profile/ /admin/ 的结构与口径：
#                          权限判断只走 Entitlement、页面不自己拼 plan、
#                          如实标注「本地体验版」（不许假装有服务器）、
#                          退出只清会话 / 注销不删进度、三页都不写进度键（Issue #132）；
#                          第十三节**真的把 /login/ 点一遍**（Issue #197 的四屏切换）：
#                          服务端连不上时留在原地、口令那几条不说
#                          「已切回本机体验版」（那句是假话）
#   3w. 跨设备同步      —— 纯 Node，1B 期的同步层：开关出厂关着、认领本机进度、
#                          设备域一个字节都不上传、老时间戳盖不掉新值、删除是墓碑、
#                          冲突不自动合并（三种选法都有后悔药），以及**最重要的一条**：
#                          断网 / 超时 / 500 / 503 / 401 / 429 十种坏情况下，
#                          now() 永不抛、本机进度一字不动、背诵照常（docs §4.6 第 8）
#   0. ProgressStore   —— 纯 Node（**排在最前**）：进度 / 账号 / 设备三域的唯一一份定义、
#                          设置域按字段拆家（helper 归设备域）、清进度不删昵称与阅读偏好、
#                          老形状 / 老备份兼容读、加载了 storage.js 的页面都先加载引擎
#   3z. 家庭子用户       —— 纯 Node（3 期 P1）：一个家长多个小孩，各背各的；
#                          上限拦在数据层；老档案与老进度一并认领；
#                          设备域不分家（字号是设备的）
#   3y. 开通自检 / 配置清单 —— 纯 Node（2C）：清单与 config.js 同源、三档分得清、
#                          **只报缺不报值**（那段文字会被贴进 Issue）、
#                          .env.example 由清单生成、/api/me 如实自报开通状态；
#                          另守 3 期那三件的**设计口径**（§4.15：飞花令与现场考试
#                          归 Max、题库归 Pro）与**刹车**（口径改了，界面一个字
#                          都不提前渲染，js/ 下只有内核能力表提到它们）；
#                          末节另守**部署形态**：api/ 下只许有 1 个函数入口
#                          （api/[...path].js），vercel.json 那条 rewrite 的 destination
#                          必须逐字等于 routes.js 的 PREFIX，且按**用户地址**与按
#                          **rewrite 之后的地址**各真打一次、状态码必须一样
#                          （Issue #205 的第三次：前两次线上都 404）
#                          最后守 **docs/todo.md**（用户 2026-09-18：以后要做的都放那里）：
#                          短信登录 / 微信小程序版真的记着，且**不许被写成排期承诺**，
#                          已裁掉的事（收费 / AI 讲解 / 集子整本导出）不许搬进去
#   3u. 层级对比页      —— 纯 Node，四列（未登录 / Free / Pro / Max）横向对照：
#                          每格都等于 can() 的答案（不许手抄一份）、
#                          未登录与 Free 只差语音朗读那一条（那条差在哪写着：
#                          表上游客列那个叉，不经由「现在」卡再说一遍）、层级单调不回退、
#                          表尾「能用几项」与表身相符（Issue #132）
#   4. 用户名设置测试    —— jsdom，带初始 localStorage 重启应用
#   5. 用户协议/隐私条款  —— jsdom + 源码扫描：页脚入口、学生保护、邮箱防爬
#   6. 注音与朗读测试    —— 拼音表/多音字（纯 Node）+ 注音渲染与朗读降级（jsdom）
#   7. 主题专项测试      —— 纯 Node，文案 / Web Font / 传统色 / favicon
#   3z. 课内诗词整体导出  —— 纯 Node，只导课内 261 首（集子**不做**整本导出）、
#                          Pro 起、按教材 24 册排序、正文一字不改、
#                          没有正文的篇目如实计数（Issue #159）
#   8. 自动朗读测试      —— jsdom + 假语音引擎：朗读全部 / 单首 / 随机连读 / 暂停停止
#   9. PWA / iOS 兼容测试 —— 真实浏览器（puppeteer），缺少依赖则跳过
set -e
cd "$(dirname "$0")/.."

# ---------------------------------------------------------------------------
# jsdom 只装一次，后面各层共用
#
# 原先每一层各自判断 `require.resolve('jsdom')`，缺了就单独 `npm i` 一次。
# 问题是：CI 的 install-deps 用两条 `npm i` 分别装 jsdom 与 puppeteer，第二条会把
# 第一条的 jsdom 当「多余的包」清掉（见 .cnb.yml 的注释），于是这里每次都走进
# 「临时安装」分支，在临时目录里再装一份 —— 同一套测试在不同机器上可能解析到
# 不同版本的 jsdom，行为随之漂移（曾出现小古文层 `querySelector('#top-act')`
# 拿到 null、接着对 null 调 dispatchEvent，整层以 TypeError 崩掉）。
#
# 现在集中装一次，并且**装完先验证能 require 进来**：装上了但加载即报错（例如
# jsdom 新依赖与当前 Node 不兼容）时立刻停下说清原因，不再一路跑到某个
# 无关的断言上以 TypeError 收场 —— 那样报错指向的是测试代码，不是真正的病根。
# ---------------------------------------------------------------------------
JS_TMP=""
if node -e "require.resolve('jsdom')" 2>/dev/null; then
  # 已在 node_modules：确认能真正加载（存在但加载报错同样不能用）
  if ! node -e "require('jsdom')" 2>/dev/null; then
    echo "✗ 已安装的 jsdom 无法加载（可能存在与当前 Node 不兼容的依赖）。"
    echo "  请重新安装：npm i jsdom"
    exit 1
  fi
  echo "(jsdom 已就绪)"
else
  echo "(未安装 jsdom，一次性临时安装...)"
  JS_TMP=$(mktemp -d)
  (cd "$JS_TMP" && npm i "jsdom@^26" --silent --no-fund --no-audit >/dev/null 2>&1) || {
    echo "✗ 无法安装 jsdom，集成测试无法进行。"
    exit 1
  }
  NODE_PATH="$JS_TMP/node_modules" node -e "require('jsdom')" 2>/dev/null || {
    echo "✗ 临时安装的 jsdom 无法加载（通常是依赖与当前 Node 版本不兼容）。"
    exit 1
  }
  export NODE_PATH="$JS_TMP/node_modules"
fi

echo "=== ProgressStore 分域（Issue #132 阶段 0 · 进度 / 账号 / 设备三域，纯 Node）==="
node test/progress-store.test.js

echo ""
echo "=== 调度算法单元测试 ==="
node test/scheduler.test.js

echo ""
echo "=== UI 集成测试 ==="
node test/ui.test.js

echo ""
echo "=== 课外必背小古文测试 ==="
node test/classic.test.js

echo ""
echo "=== 古籍阅读库（基础架构变更，Issue #69）==="
node test/engine.test.js

echo ""
echo "=== 唐诗三百首（内容 PR，Issue #69）==="
node test/tangshi.test.js

echo ""
echo "=== 宋词三百首（内容 PR，Issue #69）==="
node test/songci.test.js

echo ""
echo "=== 古文观止（内容 PR，Issue #69）==="
node test/guwen.test.js

echo ""
echo "=== 昭明文选（内容 PR，Issue #69 后续）==="
node test/zhaoming.test.js

echo ""
echo "=== 元曲三百首（2026-09 · 课外阅读第七部集子）==="
echo "    三十首小令与套数，按宫调（黄钟 / 正宫 / 中吕 / 南吕 / 双调 / 越调）编排；"
echo "    与课内同篇的那三首（《天净沙·秋思》《山坡羊·骊山怀古》《朝天子·咏喇叭》）"
echo "    走同一条判重与正文收归的路，各背各的。"
node test/yuanqu.test.js

echo ""
echo "=== 全站搜索 / 课外阅读入口 / 底栏导航（搜索页 + 导航栏变更，Issue #69）==="
node test/search.test.js

echo ""
echo "=== 课外阅读「一层退一层」导航（Issue #122）==="
node test/library-nav.test.js

echo ""
echo "=== 自选集合 + 作品主表（Issue #69 收尾）==="
node test/collections.test.js

echo ""
echo "=== 课内诗词索引页（/poems/ · 按年级分册的目录，Issue #114）==="
node test/poems-page.test.js

echo ""
echo "=== 课内自身重复去重 / 《静夜思》教材文本（Issue #69 收尾）==="
node test/dedup.test.js

echo ""
echo "=== 正文收归主表 / 孤儿进度清理（Issue #69 收尾）==="
node test/canonical.test.js

echo ""
echo "=== 正文不许被截断（Issue #243）==="
echo "    用户报《滕王阁序》正文里夹着一串「……」，中段不见了 —— 查下来是"
echo "    初高中一部长篇当初只录了残篇。这一层守着：课内 + 七部集子的正文与"
echo "    译文里除「真的省略号」（《我爱这土地》原诗的省略号，逐条登记）外，"
echo "    一律不许出现「……」；课内每一条取回主表后都非空、有正文、有译文。"
node test/truncation.test.js

echo ""
echo "=== 布局避让（弹层不被底部导航压住）==="
node test/layout.test.js

echo ""
echo "=== 背诵进度总览（到期日历 / 掌握度分布，Issue #69 后续）==="
node test/progress.test.js

echo ""
echo "=== 全站 UI 一致性 / 响应式守卫（Issue #122）==="
node test/ui-consistency.test.js

echo ""
echo "=== 「其N」编号核对（人教版教材标题与内容一致）==="
node test/title-seq.test.js

echo ""
echo "=== 复习调度算法（可切换：遗忘曲线 / Leitner / SM-2 / FSRS，Issue #114 后续）==="
node test/review-models.test.js

echo ""
echo "=== 账号与邮箱随机码认证（Issue #132）==="
node test/auth.test.js

echo ""
echo "=== 权益分层与语音播放门（free/pro/max，Issue #132）==="
node test/entitlement.test.js

echo ""
echo "=== 服务端账号接口（/api/* · 发信适配层 · 1A 期，Issue #132）==="
node test/api.test.js

echo ""
echo "=== 跨设备同步（Issue #132 · 1B · 失败不打断背诵）==="
node test/sync.test.js

echo ""
echo "=== 字符印头像（Issue #132 · 三档回落 / 分域 / 合规）==="
node test/avatar.test.js

echo ""
echo "=== 头像上传（Issue #163 · 先本机后服务端 / 裸字节 / 删了不许留裂图）==="
echo "    客户端那条线：压缩完立刻存本机（界面马上是新图），上传成功才把云端"
echo "    地址写进账号域；没登录 / 服务器没开放 / 连不上三种**各说各的话**，"
echo "    且都不清掉本机那份（它正是「传不上去时还能看」的那一份）。"
node test/avatar-upload.test.js

echo ""
echo "=== 二级设置页（Issue #132 · 主页 + 四张二级页 / 返回上一层 / 离线）==="
node test/settings-nav.test.js

echo ""
echo "=== 「我的」页（Issue #205 · 头像 / 昵称 / 身份 / 本机数据 / 注销；齿轮去设置）==="
echo "    守四件事：这一页只回答「我是谁」（头像、昵称、身份行、本机数据、子用户、"
echo "    危险区都在这儿），设置整页只回答「怎么调机器」（四组入口一行不减）；"
echo "    齿轮那一颗由 body 上的 data-top-action 长出来（不给每页各写一遍顶栏）；"
echo "    头像那一套控件与昵称落盘只有一个来源（js/avatar-edit.js / ProgressStore.patch）。"
node test/mine-page.test.js

echo ""
echo "=== 账号接线（2 期「补洞 + 2A」：/api/me 下发 · 注销自助，Issue #132）==="
node test/account-bind.test.js

echo ""
echo "=== 账号三页（/login/ /profile/ /admin/，Issue #132 + #197 完整登录流程）==="
node test/account-pages.test.js

echo ""
echo "=== 层级对比页（四列对照 / 每格都来自 can()，Issue #132）==="
node test/plans-page.test.js

echo ""
echo "=== 账号入口动线（顶栏印 / 个人中心 / 设置主页那张卡，Issue #132）==="
node test/account-entry.test.js

echo ""
echo "=== 开通自检 / 配置清单（2C：2D 那一步做成可执行的，Issue #132）==="
echo "    兼守 docs/todo.md：那是「现在不做、以后做」的唯一一处"
echo "    （短信登录 / 微信小程序版记着；不许写成「即将上线」；已裁掉的不许搬进来）。"
node test/ops.test.js

echo ""
echo "=== 自助排查（Issue #225 · /self-check/ + GET /api/diag）==="
echo "    守的是「注册报 500 时用户能自己定位到哪一环」："
echo "    ① 页面打不开时页面上备着命令行判据（含「搜 api.error」）；"
echo "    ② 缺密钥 / 缺库 / 连不上库三种情形各自给出**互斥**的结论，且不假装绿；"
echo "    ③ 报告里一个密钥都不许出现（值不出现，形状才许出现）。"
node test/self-check.test.js

echo ""
echo "=== 旧形状库上的注册（Issue #225 · 不再 500，如实报降级）==="
echo "    守的是「用户什么配置都没错，只是库停在旧形状」这一档："
echo "    ① 建号时 `email_mask` 一定带上（老库那一列是 not null，留空 = 首次注册必炸）；"
echo "    ② 写账号缺迁移列（email / email_verified_at / password_hash / password_salt）"
echo "      时**降级重试**、把能写的写进去，绝不把 500 抛给用户；"
echo "    ③ 降级是**事实**：响应里如实点名哪几列没落库，不假装写成功；"
echo "    ④ 表是新的这一路一个字段都不许多（别修出个假告警）。"
node test/register-legacy-db.test.js

echo ""
echo "=== 家庭子用户（3 期 P1 · profile.family，纯 Node）==="
echo "    守四件事：名册（增/改名/删/切换/上限）拦在**数据层**；"
echo "    老用户零感知（昵称 + 印 + 进度/设置/已读一并认领）；"
echo "    分家的边界（进度/设置/已读跟着孩子走，设备域不跟）；"
echo "    上限与内核同源（Free 1 / Pro 3 / Max 180）。"
node test/family.test.js

echo ""
echo "=== 古诗词大会 · 出题内核（3 期：飞花令 / 题库 / 现场考试，纯 Node）==="
echo "    守的是三件事：断句与令字候选**从语料现算**（不写死字表）；"
echo "    干扰项的三条规矩（长度档 / 不重字过半 / 不同篇）；"
echo "    判分是纯比对（同样输入同样输出，客户端与服务端同源）。"
node test/game.test.js

echo ""
echo "=== 古诗词大会 · 页面层（3 期 · /poems/ 上就地叠层，jsdom）==="
echo "    入口挂在课内索引页上（底部四个页签一个都不加），"
echo "    未登录 / 层级不够时只显示「要哪一层」，"
echo "    飞花令的答案点开才生成（不是拿 CSS 遮住）。"
node test/game-page.test.js

echo ""
echo "=== 篇目打印页 · 版面内核（3 期 Pro：一组能打印的纸是几页，纯 Node）==="
echo "    守的是四件事：断行**标点照排**（原文怎么断、纸面上就怎么断）；"
echo "    拼音 / 译文 / 格线三个块关掉就真的不上纸，且改开关就改页数；"
echo "    卡片不跨栏、超长的单独占一栏并如实报出来；"
echo "    没有正文的篇目不占位置**且如实计数**（不悄悄少一篇）。"
node test/print.test.js

echo ""
echo "=== 篇目打印页 · 页面层（3 期 Pro · 就地叠层，jsdom）==="
echo "    入口在「我的清单」页与诗词详情页上（底部四个页签一个都不加）；"
echo "    未登录点入口**直接去登录页**（不摆「登录可用」的卡片、不摆注册按钮，"
echo "    跳转带上 ?next= 当前页，登录完回得来 —— Issue #229）；"
echo "    登录了但层级不够才出卡片，只如实说「要 Pro」；"
echo "    预览与纸面同一份内容，打印走浏览器对话框（不自己生成 PDF）。"
node test/print-page.test.js

echo ""
echo "=== 课内诗词整体导出（Issue #159 · 只导课内 261 首、Pro 起、纯文本）==="
echo "    守的是用户 2026-09-16 的口径：**六部集子不做一次性整本导出**"
echo "    （站点整理的内容资产）、门槛从 Max 降到 Pro、正文一字不改；"
echo "    排序按教材册次，不跟着数据文件的出场顺序走。"
node test/export-core.test.js

echo ""
echo "=== 跨设备分档案（Issue #159 · todo.md 第 4 条：一个孩子一份进度上云）==="
echo "    守的是：空串 = 第一个孩子那一份（与 family.js 的无后缀老键同源，"
echo "    老客户端行为一字不差）；A 孩子的进度不能被 B 孩子拉到（两端都挡）；"
echo "    两个孩子的 seen / 游标分家（串了的症状是「冲突弹的是别人家孩子的」）；"
echo "    名册 family:v1 落在账号那一档、且不被当成一篇「诗」；"
echo "    注销导出**所有**孩子（少导出一个就是永久丢失）。"
node test/cross-device.test.js

echo ""
echo "=== 今日加背（Issue #243 · 今日背诵页那一颗「＋」 · jsdom + vm）==="
echo "    守的是用户 2026-09-19 那段话里的每一条：今日背诵页顶上有搜索下拉、"
echo "    下拉里带「加入今日背诵」（点一下 5 首变 6 首）；集子页与搜索页的列表、"
echo "    详情页都有同一颗圆钮，详情页那一颗插在**译文与加入背诵之间**；"
echo "    加进来的照常走遗忘曲线（有进度、有下次复习时间），但**不进**自选集合，"
echo "    所以设置页单独有一处能看见、能多选删；它是「今天」的东西 ——"
echo "    跨过 0 点自动归零，不留垃圾。"
node test/daily-extra.test.js

echo ""
echo "=== 同步边界总表（Issue #243 后续 · 能上云的全上，上不了的逐条写清）==="
echo "    守的是「表是全的」：源码里每一把 poem_* 键都必须在 js/sync-coverage.js
    里有判定（本次就靠它发现自选集合与集子已读一直漏在表外）；
    表的分域与 ProgressStore.scopes() 不许打架；上云的行号两端逐字一致；
    服务端白名单真的在裁（封顶 / 截断 / 只留白名单字段）。"
node test/sync-coverage.test.js

echo ""
echo "=== 用户名设置测试 ==="
node test/username.test.js

echo ""
echo "=== 用户协议 / 隐私条款测试 ==="
node test/legal.test.js

echo ""
echo "=== 注音与朗读测试 ==="
node test/helper.test.js


echo ""
echo "=== 主题专项测试（文案 / 字体 / 配色 / 图标）==="
node test/theme.test.js

echo ""
echo "=== 自动朗读 / 阅读辅助测试 ==="
node test/auto-read.test.js

echo ""
echo "=== PWA / iOS 兼容测试 ==="
if ! node -e "require.resolve('puppeteer')" 2>/dev/null; then
  echo "(未安装 puppeteer，跳过 PWA 测试。启用：npm i -D puppeteer)"
  exit 0
fi

# pwa.test.js 自己负责判定「浏览器能否启动」：
# 启动不了浏览器时输出 SKIP 并以 0 退出（环境问题，不该判定为代码回归）。
if node test/pwa-env.js >/dev/null 2>&1; then
  # 起一个临时静态服务，测完关掉
  node scripts/serve.js > /dev/null 2>&1 &
  SERVE_PID=$!
  trap 'kill $SERVE_PID 2>/dev/null || true' EXIT
  sleep 1.5
  node test/pwa.test.js
else
  echo "(当前环境无法启动 Chrome，跳过 PWA 测试。)"
  echo "原因通常是缺少系统库（libnspr4 / libnss3 等）。"
  echo "CI 请用 image/Dockerfile 预装依赖；本地可执行 npx puppeteer browsers install chrome"
fi
