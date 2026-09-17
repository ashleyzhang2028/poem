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
