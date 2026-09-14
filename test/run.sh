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
#   3h. 自选集合测试     —— jsdom + vm，作品主表判重 + 自选集合增删改查 + 排进遗忘曲线
#   3i. 课内去重测试     —— jsdom + vm，12 组自身重复按低年级版本去重 + 《静夜思》教材文本
#   3j. 正文收归主表     —— jsdom + vm，同一篇只用主条目那一份正文 / 译文 + 孤儿进度清理
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
echo "=== 自选集合 + 作品主表（Issue #69 收尾）==="
node test/collections.test.js

echo ""
echo "=== 课内自身重复去重 / 《静夜思》教材文本（Issue #69 收尾）==="
node test/dedup.test.js

echo ""
echo "=== 正文收归主表 / 孤儿进度清理（Issue #69 收尾）==="
node test/canonical.test.js

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
