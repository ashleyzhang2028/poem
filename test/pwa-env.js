/**
 * 探测当前环境能否启动 puppeteer 的 Chrome。
 *
 * 用来把「环境缺库」和「功能回归」区分开：
 *   - CI 未预装 Chrome 系统依赖（node:20 自带 Debian 缺 libnspr4 / libatk 等）
 *     → Chrome 进程以 127 退出，属于环境问题，应跳过而不是报错
 *   - 代码真的写坏了 → 正常断言失败，必须让 CI 红
 */
const { execFileSync } = require("child_process");
const { existsSync } = require("fs");

async function resolveChromePath() {
  let puppeteer;
  try {
    puppeteer = require("puppeteer");
  } catch (e) {
    return null;
  }
  try {
    // puppeteer >= 22 的 executablePath() 返回 Promise，旧版返回字符串
    const p = puppeteer.executablePath();
    const resolved = p && typeof p.then === "function" ? await p : p;
    return typeof resolved === "string" ? resolved : null;
  } catch (e) {
    return null;
  }
}

async function browserAvailable() {
  const executablePath = await resolveChromePath();
  if (!executablePath || !existsSync(executablePath)) return false;

  // Chrome 自带 --version，能在不启动完整浏览器的情况下验证动态库是否齐全。
  // 缺库时返回码为 127，stderr 类似 "error while loading shared libraries"。
  try {
    execFileSync(executablePath, ["--version"], {
      stdio: ["ignore", "ignore", "ignore"],
      timeout: 20000
    });
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = { browserAvailable, resolveChromePath };

if (require.main === module) {
  browserAvailable().then((ok) => {
    console.log(ok ? "browser-available" : "browser-unavailable");
    process.exit(ok ? 0 : 1);
  });
}
