#!/usr/bin/env bash
# 运行全部测试
#
# 分八层，逐层递进：
#   1. 调度算法单元测试  —— 纯 Node，无外部依赖
#   2. UI 集成测试       —— jsdom，缺少则临时安装
#   3. 小古文学习库测试  —— jsdom，100 篇数据 + 阅读器 + 已读标记
#   4. 用户名设置测试    —— jsdom，带初始 localStorage 重启应用
#   5. 用户协议/隐私条款  —— jsdom + 源码扫描：页脚入口、学生保护、邮箱防爬
#   6. 注音与朗读测试    —— 拼音表/多音字（纯 Node）+ 注音渲染与朗读降级（jsdom）
#   7. 主题专项测试      —— 纯 Node，文案 / Web Font / 传统色 / favicon
#   8. 自动朗读测试      —— jsdom + 假语音引擎：朗读全部 / 单首 / 随机连读 / 暂停停止
#   9. 匿名访问统计      —— jsdom：管理页可见性、匿名记录字段、防刷量、法务披露
#   9. PWA / iOS 兼容测试 —— 真实浏览器（puppeteer），缺少依赖则跳过
#   8. PWA / iOS 兼容测试 —— 真实浏览器（puppeteer），缺少依赖则跳过
set -e
cd "$(dirname "$0")/.."

echo "=== 调度算法单元测试 ==="
node test/scheduler.test.js

echo ""
echo "=== UI 集成测试 ==="
if node -e "require.resolve('jsdom')" 2>/dev/null; then
  node test/ui.test.js
else
  echo "(未安装 jsdom，尝试临时安装...)"
  TMP=$(mktemp -d)
  (cd "$TMP" && npm i jsdom --silent --no-fund --no-audit >/dev/null 2>&1) || { echo "跳过 UI 测试（无法安装 jsdom）"; exit 0; }
  NODE_PATH="$TMP/node_modules" node test/ui.test.js
fi

echo ""
echo "=== 课外必背小古文测试 ==="
if node -e "require.resolve('jsdom')" 2>/dev/null; then
  node test/classic.test.js
else
  TMP=$(mktemp -d)
  (cd "$TMP" && npm i jsdom --silent --no-fund --no-audit >/dev/null 2>&1) || { echo "跳过小古文测试（无法安装 jsdom）"; exit 0; }
  NODE_PATH="$TMP/node_modules" node test/classic.test.js
fi

echo ""
echo "=== 用户名设置测试 ==="
if node -e "require.resolve('jsdom')" 2>/dev/null; then
  node test/username.test.js
else
  TMP=$(mktemp -d)
  (cd "$TMP" && npm i jsdom --silent --no-fund --no-audit >/dev/null 2>&1) || { echo "跳过用户名测试（无法安装 jsdom）"; exit 0; }
  NODE_PATH="$TMP/node_modules" node test/username.test.js
fi

echo ""
echo "=== 用户协议 / 隐私条款测试 ==="
if node -e "require.resolve('jsdom')" 2>/dev/null; then
  node test/legal.test.js
else
  TMP=$(mktemp -d)
  (cd "$TMP" && npm i jsdom --silent --no-fund --no-audit >/dev/null 2>&1) || { echo "跳过法务页测试（无法安装 jsdom）"; exit 0; }
  NODE_PATH="$TMP/node_modules" node test/legal.test.js
fi

echo ""
echo "=== 注音与朗读测试 ==="
if node -e "require.resolve('jsdom')" 2>/dev/null; then
  node test/helper.test.js
else
  TMP=$(mktemp -d)
  (cd "$TMP" && npm i jsdom --silent --no-fund --no-audit >/dev/null 2>&1) || { echo "跳过注音朗读测试（无法安装 jsdom）"; exit 0; }
  NODE_PATH="$TMP/node_modules" node test/helper.test.js
fi

echo ""
echo "=== 匿名访问统计 / 管理页测试 ==="
if node -e "require.resolve('jsdom')" 2>/dev/null; then
  node test/stats.test.js
else
  TMP=$(mktemp -d)
  (cd "$TMP" && npm i jsdom --silent --no-fund --no-audit >/dev/null 2>&1) || { echo "跳过统计测试（无法安装 jsdom）"; exit 0; }
  NODE_PATH="$TMP/node_modules" node test/stats.test.js
fi

echo ""
echo "=== 主题专项测试（文案 / 字体 / 配色 / 图标）==="
node test/theme.test.js

echo ""
echo "=== 自动朗读 / 阅读辅助测试 ==="
if node -e "require.resolve('jsdom')" 2>/dev/null; then
  node test/auto-read.test.js
else
  TMP=$(mktemp -d)
  (cd "$TMP" && npm i jsdom --silent --no-fund --no-audit >/dev/null 2>&1) || { echo "跳过自动朗读测试（无法安装 jsdom）"; exit 0; }
  NODE_PATH="$TMP/node_modules" node test/auto-read.test.js
fi

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
