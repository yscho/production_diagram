"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const projectRoot = path.resolve(__dirname, "..");
const pageUrl = `file://${projectRoot}/index.html`;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "avn-phase3-chrome-"));
const logPath = path.join(__dirname, "browser_qa.log");
const screenshotDir = path.join(__dirname, "screenshots");
const lines = [];
const externalRequests = [];
const pageErrors = [];
let sequence = 0;

function log(message) {
  lines.push(message);
  fs.appendFileSync(logPath, `${message}\n`);
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function main() {
  fs.writeFileSync(logPath, "");
  fs.mkdirSync(screenshotDir, { recursive: true });
  const chrome = spawn(chromePath, [
    "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
    "--enable-webgl", "--ignore-gpu-blocklist", "--use-gl=angle", "--use-angle=swiftshader",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "--window-size=1600,1000", "--no-first-run", "--no-default-browser-check", pageUrl
  ], { stdio: "ignore" });
  let websocket;
  try {
    const portFile = path.join(profile, "DevToolsActivePort");
    for (let i = 0; i < 120 && !fs.existsSync(portFile); i += 1) await wait(100);
    if (!fs.existsSync(portFile)) throw new Error("Chrome DevTools port file did not appear");
    const port = Number(fs.readFileSync(portFile, "utf8").split("\n")[0]);
    let targets = [];
    for (let i = 0; i < 100; i += 1) {
      try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch (_) { }
      if (targets.some((target) => target.type === "page" && target.url === pageUrl)) break;
      await wait(100);
    }
    const target = targets.find((item) => item.type === "page" && item.url === pageUrl) || targets.find((item) => item.type === "page");
    if (!target) throw new Error("Chrome page target was not found");
    websocket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { websocket.onopen = resolve; websocket.onerror = reject; });
    const pending = new Map();
    websocket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const callbacks = pending.get(message.id); pending.delete(message.id);
        message.error ? callbacks.reject(new Error(message.error.message)) : callbacks.resolve(message.result);
        return;
      }
      if (message.method === "Runtime.consoleAPICalled") {
        const text = message.params.args.map((arg) => arg.value || arg.description || "").join(" ");
        if (message.params.type === "error") pageErrors.push(`console.error: ${text}`);
      }
      if (message.method === "Runtime.exceptionThrown") pageErrors.push(`exception: ${message.params.exceptionDetails.text}`);
      if (message.method === "Network.requestWillBeSent") {
        const url = message.params.request.url;
        if (!url.startsWith("file:") && !url.startsWith("data:") && !url.startsWith("blob:")) externalRequests.push(url);
      }
    };
    function send(method, params = {}) {
      const id = ++sequence;
      websocket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    }
    async function evaluate(expression) {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result.value;
    }
    await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
    await wait(1200);
    const ready = await evaluate("document.querySelector('#simClock').textContent");
    log(`PAGE ${pageUrl}`);
    log(`READY ${ready}`);
    for (let index = 0; index < 6; index += 1) {
      await evaluate(`window.__avnActivateView(${index})`);
      await wait(500);
      const viewState = await evaluate(`({tab:document.querySelectorAll('#tabs button')[${index}].textContent,three:!!window.THREE,threeRevision:window.THREE&&window.THREE.REVISION,webgl:!!(document.querySelector('#viewRoot canvas')&&document.querySelector('#viewRoot canvas').getContext('webgl2')),view:!!document.querySelector('#viewRoot canvas, #viewRoot svg, #viewRoot .station-card')})`);
      const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      const filename = path.join(screenshotDir, `${String(index + 1).padStart(2, "0")}.png`);
      fs.writeFileSync(filename, Buffer.from(shot.data, "base64"));
      log(`VIEW ${String(index + 1).padStart(2, "0")} ${viewState.tab} rendered=${viewState.view} THREE=${viewState.three}${index === 3 ? ` revision=${viewState.threeRevision} webgl2=${viewState.webgl}` : ""} screenshot=${path.relative(projectRoot, filename)}`);
    }
    const beforePause = await evaluate("window.__avnSim.snapshot().snapshotId");
    await evaluate("document.querySelector('#toggle').click()");
    await wait(500);
    const duringPause = await evaluate("window.__avnSim.snapshot().snapshotId");
    await evaluate("document.querySelector('#toggle').click()");
    await wait(500);
    const afterResume = await evaluate("window.__avnSim.snapshot().snapshotId");
    await evaluate("document.querySelector('#reset').click()");
    const afterReset = await evaluate("window.__avnSim.snapshot().snapshotId");
    log(`CONTROL snapshotId beforePause=${beforePause} paused=${duringPause} resumed=${afterResume} reset=${afterReset}`);
    log(`NETWORK externalRequests=${externalRequests.length}${externalRequests.length ? ` ${externalRequests.join(",")}` : " none"}`);
    log(`ERRORS ${pageErrors.length}${pageErrors.length ? ` ${pageErrors.join(" | ")}` : " none"}`);
    if (pageErrors.length || externalRequests.length || afterResume <= duringPause || duringPause !== beforePause || afterReset !== 0) process.exitCode = 1;
    console.log(lines.join("\n"));
  } finally {
    if (websocket) websocket.close();
    chrome.kill("SIGTERM");
  }
}

main().catch((error) => { log(`FATAL ${error.stack || error.message}`); console.error(error); process.exitCode = 1; });
