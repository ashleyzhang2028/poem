#!/usr/bin/env bash
# 运行全部测试
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
# 需要真实浏览器（puppeteer）。未安装则自动跳过，不阻塞默认流程。
if node -e "require.resolve('puppeteer')" 2>/dev/null; then
  # 起一个临时静态服务，测完关掉
  node scripts/serve.js > /dev/null 2>&1 &
  SERVE_PID=$!
  trap 'kill $SERVE_PID 2>/dev/null || true' EXIT
  sleep 1.5
  node test/pwa.test.js
else
  echo "(未安装 puppeteer，跳过 PWA 测试。启用：npm i -D puppeteer)"
fi
