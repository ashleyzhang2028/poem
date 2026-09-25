# CI 构建环境
#
# Issue #278 之前，这里装了一整套 Chrome 运行所需的系统库
# （libnspr4 / libnss3 / libgbm / libasound2 等）—— 那是给 puppeteer 用的：
# 没有这些库时，容器里的 Chrome 会以状态码 127 退出
# （error while loading shared libraries: libnspr4.so），PWA 测试因此失败。
#
# 那一层**真浏览器测试**（test/pwa.test.js）是界面测试，已按 Issue #278 整层
# 删除（用户 2026-09-25：「删除尽可能多的其他测试，特别是界面相关的测试，
# 我的目的是构建时间变短」）。test/run.sh 现在全是纯 Node + vm 沙盒，
# 不需要浏览器、不需要 jsdom、一个依赖都不装。
#
# 所以这一份镜像回到「就是 Node 20」，不再预装任何浏览器依赖：
# 构建时少一层 apt-get（冷启动时要联网拉几十兆包），缓存也干净。
FROM node:20

WORKDIR /workspace
