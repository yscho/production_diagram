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
    for (let index = 0; index < 7; index += 1) {
      await evaluate(`window.__avnActivateView(${index})`);
      await wait(500);
      const viewState = await evaluate(`({tab:document.querySelectorAll('#tabs button')[${index}].textContent,three:!!window.THREE,threeRevision:window.THREE&&window.THREE.REVISION,webgl:!!(document.querySelector('#viewRoot canvas')&&document.querySelector('#viewRoot canvas').getContext('webgl2')),view:!!document.querySelector('#viewRoot canvas, #viewRoot svg, #viewRoot .andon-card')})`);
      if (!viewState.view) throw new Error(`View ${index + 1} has no rendered surface`);
      const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      const filename = path.join(screenshotDir, `${String(index + 1).padStart(2, "0")}.png`);
      fs.writeFileSync(filename, Buffer.from(shot.data, "base64"));
      log(`VIEW ${String(index + 1).padStart(2, "0")} ${viewState.tab} rendered=${viewState.view} THREE=${viewState.three}${index === 3 ? ` revision=${viewState.threeRevision} webgl2=${viewState.webgl}` : ""} screenshot=${path.relative(projectRoot, filename)}`);
    }
    // Robot-cell regression: all products must pass through both robot cells.
    const setup = await evaluate(`(() => {
      const sim = window.__avnSim;
      window.__qaEngineReference = sim;
      sim.setScenario('multi_line_example');
      let state;
      for (let i = 0; i < 2000; i += 1) {
        sim.step(); state = sim.snapshot();
        if (state.simTimeSec > 320 && state.kpis.passed > 0 && state.robots.every(robot => robot.state === 'moving') && ['A','B','C','D'].every(id => state.stations.find(station => station.id === id).slots.some(slot => slot.productId))) break;
      }
      sim.pause();
      return { time: state.simTimeSec, capacities: state.stations.map(station => station.id + ':' + station.capacity), robots: state.robots.map(robot => robot.id + ':' + robot.target), passed: state.kpis.passed };
    })()`);
    await wait(300);
    log('ROBOT_LAYOUT ' + JSON.stringify(setup));
    const frozenId = await evaluate('window.__avnSim.snapshot().snapshotId');
    const frozenArm = await evaluate("document.querySelector('#viewRoot canvas').dataset.robot1");
    await wait(300);
    if (await evaluate('window.__avnSim.snapshot().snapshotId') !== frozenId) throw new Error('Paused robot engine advanced');
    if (await evaluate("document.querySelector('#viewRoot canvas').dataset.robot1") !== frozenArm) throw new Error('Paused robot arm moved');
    const robotShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(screenshotDir, '07.png'), Buffer.from(robotShot.data, 'base64'));
    log('ROBOT_SCREENSHOT qa/screenshots/07.png (multi-line, both robot cells occupied)');
    const cameraBefore = await evaluate("document.querySelector('#viewRoot canvas').dataset.camera");
    const bounds = await evaluate("(() => { const r=document.querySelector('#viewRoot canvas').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()");
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: bounds.x, y: bounds.y, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: bounds.x + 110, y: bounds.y + 35, button: 'left', buttons: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bounds.x + 110, y: bounds.y + 35, button: 'left', buttons: 0, clickCount: 1 });
    await wait(150);
    const cameraOrbit = await evaluate("document.querySelector('#viewRoot canvas').dataset.camera");
    if (cameraOrbit === cameraBefore) throw new Error('Camera orbit did not move');
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: bounds.x, y: bounds.y, deltaX: 0, deltaY: -180 });
    await wait(150);
    const cameraZoom = await evaluate("document.querySelector('#viewRoot canvas').dataset.camera");
    if (cameraZoom === cameraOrbit) throw new Error('Camera zoom did not move');
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: bounds.x, y: bounds.y, button: 'right', buttons: 2, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: bounds.x + 60, y: bounds.y, button: 'right', buttons: 2 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bounds.x + 60, y: bounds.y, button: 'right', buttons: 0, clickCount: 1 });
    await wait(150);
    const cameraPan = await evaluate("document.querySelector('#viewRoot canvas').dataset.camera");
    if (cameraPan === cameraZoom) throw new Error('Camera pan did not move');
    await evaluate('window.__avnSim.resume(); for (let i=0;i<6;i++) window.__avnSim.step(); window.__avnSim.pause();');
    await wait(150);
    const armAfter = await evaluate("document.querySelector('#viewRoot canvas').dataset.robot1");
    const stableCamera = await evaluate("document.querySelector('#viewRoot canvas').dataset.camera");
    if (armAfter === frozenArm) throw new Error('Robot arm did not animate after progress');
    if (stableCamera !== cameraPan) throw new Error('Simulation changed camera pose');
    log('ROBOT_CAMERA orbit=PASS zoom=PASS pan=PASS cameraPersists=PASS armAnimation=PASS pause=PASS');
    await evaluate("document.querySelector('[data-camera=robot1]').click()");
    await wait(150);
    const closeShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(screenshotDir, '07_robot1.png'), Buffer.from(closeShot.data, 'base64'));
    const beforeSwitch = await evaluate('JSON.stringify(window.__avnSim.snapshot())');
    await evaluate('window.__avnActivateView(0); window.__avnActivateView(6);');
    const afterSwitch = await evaluate('JSON.stringify(window.__avnSim.snapshot())');
    if (beforeSwitch !== afterSwitch || !await evaluate('window.__qaEngineReference === window.__avnSim')) throw new Error('View switch changed shared runtime');
    log('ROBOT_SWITCH identical snapshotId/time/occupancy and same engine instance=PASS');
    // Resume for the common controls regression below.
    await evaluate('window.__avnSim.resume()');
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
    await send('Page.navigate', { url: `file://${projectRoot}/robot_line_3d.html` });
    await wait(1200);
    const entry = await evaluate(`({url:location.href,view:document.querySelector('#tabs .active').textContent,scenario:window.__avnSim.snapshot().scenarioId,speed:window.__avnSim.snapshot().speed})`);
    if (!entry.url.includes('view=07') || entry.scenario !== 'multi_line_example' || entry.speed !== 2) throw new Error('Robot direct entry failed');
    log('ROBOT_DIRECT_ENTRY view07/multi-line/speed2=PASS');
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
