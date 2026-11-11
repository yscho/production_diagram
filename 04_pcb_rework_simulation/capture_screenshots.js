const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const pageUrl = 'http://localhost:8080/index.html';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pcb-rework-chrome-'));
const outDir = path.join(__dirname, 'preview');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  const chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--window-size=1600,1000',
      '--no-first-run',
      '--no-default-browser-check',
      pageUrl
    ],
    { stdio: 'ignore' }
  );

  let websocket;
  let seq = 0;

  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 120 && !fs.existsSync(portFile); i++) await wait(100);
    if (!fs.existsSync(portFile)) throw new Error('DevToolsActivePort not found');

    const port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]);
    let targets = [];
    for (let i = 0; i < 100; i++) {
      try {
        targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      } catch (_) {}
      if (targets.some((t) => t.type === 'page' && t.url.includes('localhost:8080'))) break;
      await wait(100);
    }

    const target =
      targets.find((t) => t.type === 'page' && t.url.includes('localhost:8080')) ||
      targets.find((t) => t.type === 'page');
    if (!target) throw new Error('Chrome page target not found');

    websocket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      websocket.onopen = resolve;
      websocket.onerror = reject;
    });

    const pending = new Map();
    const pageErrors = [];

    websocket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const cb = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? cb.reject(new Error(msg.error.message)) : cb.resolve(msg.result);
        return;
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        pageErrors.push(msg.params.exceptionDetails.text);
      }
    };

    function send(method, params = {}) {
      const id = ++seq;
      websocket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    }

    async function evaluate(expression) {
      const res = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true
      });
      if (res.exceptionDetails) throw new Error(res.exceptionDetails.text);
      return res.result.value;
    }

    async function snap(filename) {
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const filePath = path.join(outDir, filename);
      fs.writeFileSync(filePath, Buffer.from(shot.data, 'base64'));
      console.log('Saved screenshot:', filePath);
    }

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1600,
      height: 980,
      deviceScaleFactor: 1,
      mobile: false
    });

    await wait(1800);

    // 1. Assembled state (Step 0: inside steel housing with X-ray transparency)
    await evaluate(`window.app.selectStep(0); window.app.sim3d.applyPreset('sw_error', true);`);
    await wait(900);
    await snap('01_assembled_xray.png');

    // 2. Step 1: Unscrew & Unbox Steel Housing
    await evaluate(`window.app.selectStep(1); window.app.sim3d.applyPreset('unbox', true);`);
    await wait(900);
    await snap('02_step1_unbox.png');

    // 3. Step 2: Top PCB (CPU/eMMC) & Bottom PCB (MCU) Split / Exploded View
    await evaluate(`window.app.selectStep(2); window.app.sim3d.applyPreset('pcb_split', true);`);
    await wait(900);
    await snap('03_step2_pcb_split.png');

    // 4. Step 3: Dev Bottom PCB (JTAG) Connected to Top PCB & SW Rework Update
    await evaluate(`window.app.selectStep(3); window.app.sim3d.applyPreset('dev_rework', true);`);
    await wait(900);
    await snap('04_step3_dev_rework.png');

    // 5. Full Diagram & Architecture Comparison Board
    await evaluate(`document.querySelector('[data-mode="diagram"]').click();`);
    await wait(600);
    await snap('05_diagram_board.png');

    if (pageErrors.length > 0) {
      console.warn('Page errors:', pageErrors);
    } else {
      console.log('All 5 screenshots captured with 0 runtime errors.');
    }
  } catch (innerErr) {
    console.error('Inner error:', innerErr);
    throw innerErr;
  } finally {
    if (websocket && websocket.readyState === WebSocket.OPEN) websocket.close();
    chrome.kill('SIGTERM');
    await wait(500);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
