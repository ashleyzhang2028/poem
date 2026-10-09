# 云托管运行时镜像
#
# 这个仓库「一个进程跑全」：scripts/serve.js 同时伺服静态站（index.html、
# js/、css/、fonts/、各目录的页面）和 api/ 下那套 Vercel 风格 handler，
# 所以**一个容器就够**，不需要拆前后端。
#
# ⚠️ 别把 image/Dockerfile 和这一份搞混：
#   image/Dockerfile 是 **CI 构建环境**（跑 test/run.sh 用的 Node 20），
#   这一份是 **线上运行时** —— 两者目标不同，别合并，也别互相 COPY。
#
# 云托管要的端口由平台注入的 PORT 决定。serve.js 读 process.env.PORT，
# 默认 8080；这里设 8080 是为了「本机 docker run 不改任何东西也能起来」。
FROM node:20-alpine

# 先把 /app 建好并交给 node 用户，再切过去 —— 顺序不能反：
# WORKDIR 建出来的目录归 root，要是先 USER node 再 npm ci，装依赖那步
# 会因为写不进 /app 直接 EACCES 失败。
WORKDIR /app
RUN chown node:node /app
USER node

# 先只拷依赖清单再 npm ci —— 让这一层进 Docker 缓存：
# 以后改业务代码（下面 COPY . . 那层变）不会连带重装依赖。
COPY --chown=node:node package.json package-lock.json ./
# npm ci 认 lockfile，装出来就是 package-lock.json 里钉死的那版；
# --omit=dev 略过 devDependencies（本仓库 devDeps 为空，写出来是防以后加）。
RUN npm ci --omit=dev --no-audit --no-fund

COPY --chown=node:node . .

# 全程非 root：node:20-alpine 自带 uid 1000 的 node 用户，安装与运行都用它，
# 应用层被攻破时容器里拿到的不是 uid 0。
# 代价是**不能监听 80**（<1024 的端口要 root）——所以走 8080，
# 绑定 80 那步交给云托管 / 外层反代。
# COPY 一律带 --chown，而不是 COPY 完再 chown -R：
#   后者会把整个 /app 再复制一份进新层，镜像白胖一圈。
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# /api/diag 是现成的探活口：缺 SESSION_SECRET 时它照样 200，把「缺哪个密钥」
# 写在 body 里（本站设计成「密钥没配也能离线用」）。
# ⚠️ 这里**不拿 HTTP 状态码当健康判据** —— 密钥没配时服务本来就能跑，
#    该报的错由它自己的 body 说；健康检查只判「进程还在不在应答」。
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/diag',r=>{r.resume();process.exit(r.statusCode<500?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "scripts/serve.js"]
