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
