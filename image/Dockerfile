# CI 构建环境：Node 20 + Chromium 运行所需的系统库
#
# 为什么需要这个镜像：
#   node:20 基于 Debian，默认没有 Chrome 运行所需的系统库（libnspr4、libnss3、
#   libatk、libgbm、libasound2 等）。puppeteer 下载的 Chrome 在容器里会以
#   状态码 127 退出（error while loading shared libraries: libnspr4.so），
#   PWA 测试因此失败。这里把依赖预装进镜像，构建缓存后每次流水线秒过。
#
# 依赖清单与 puppeteer 官方文档一致：
#   https://pptr.dev/troubleshooting#chrome-doesnt-launch-on-linux

FROM node:20

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*

# 浏览器缓存放到工作目录下，便于 CNB 缓存 node_modules 时一并命中
ENV PUPPETEER_CACHE_DIR=/workspace/.cache/puppeteer

WORKDIR /workspace
