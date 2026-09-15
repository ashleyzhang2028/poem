#!/usr/bin/env bash
# 运行全部测试
#
# 分九层，逐层递进：
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
#   3p. 账号与随机码认证 —— 纯 Node，邮箱归一化 / 发码频控 / 单次使用 /
#                          过期 / 锁定 / 时间倒退 / 退化随机源不死循环（Issue #132）
#   3q. 权益分层与语音门 —— 纯 Node，free/pro/max 功能矩阵的唯一出口 can()、
#                          登录是语音播放的硬条件、放行后 stop/pause 不受门限制、
#                          页面上不许自己拼 plan（Issue #132）
#   3r. 字符印头像      —— 纯 Node，三档回落（选的字 / 昵称首字 / 默认诗字）、
#                          固定集合外的字与色一律拒收、分域隔离（只写账号域）、
#                          不存 base64、不用邮箱首字母（Issue #132）
#   4. 用户名设置测试    —— jsdom，带初始 localStorage 重启应用
#   5. 用户协议/隐私条款  —— jsdom + 源码扫描：页脚入口、学生保护、邮箱防爬
#   6. 注音与朗读测试    —— 拼音表/多音字（纯 Node）+ 注音渲染与朗读降级（jsdom）
#   7. 主题专项测试      —— 纯 Node，文案 / Web Font / 传统色 / favicon
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
echo "=== 字符印头像（Issue #132 · 三档回落 / 分域 / 合规）==="
node test/avatar.test.js

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
