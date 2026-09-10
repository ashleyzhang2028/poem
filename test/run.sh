#!/usr/bin/env bash
# 运行全部测试
#
# 分三层，逐层递进：
#   1. 调度算法单元测试  —— 纯 Node，无外部依赖
#   2. UI 集成测试       —— jsdom，缺少则临时安装
#   3. PWA / iOS 兼容测试 —— 真实浏览器（puppeteer），缺少依赖则跳过
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
