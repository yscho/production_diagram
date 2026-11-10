(function () {
  'use strict';

  const data = window.LINE_DATA;
  if (!data || !Array.isArray(data.stages) || data.stages.length === 0) {
    throw new Error('검사라인 데이터가 없거나 공정 목록이 비어 있습니다.');
  }

  const svg = document.getElementById('factoryMap');
  const svgNS = 'http://www.w3.org/2000/svg';
  const stages = data.stages;
  const colors = data.statusColors;
  const positions = [];
  const pallets = [];
  const stageStats = stages.map(function () { return { pass: 0, fail: 0 }; });
  const rejectSlots = [];
  let seed = Number(data.simulation.randomSeed) >>> 0;
  let passed = 0;
  let failed = 0;
  let simulatedSeconds = 0;
  let running = true;
  let previousFrame = performance.now();

  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  }

  function addSvg(tag, attributes, parent) {
    const node = document.createElementNS(svgNS, tag);
    Object.keys(attributes || {}).forEach(function (key) {
      node.setAttribute(key, attributes[key]);
    });
    (parent || svg).appendChild(node);
    return node;
  }

  function drawFactory() {
    addSvg('rect', { x: 14, y: 14, width: 972, height: 622, rx: 18, class: 'floor' });
    addSvg('path', { d: 'M55 48 H945 V590 H55 Z', class: 'belt' });
    addSvg('path', { d: 'M55 48 H945 V590 H55 Z', class: 'belt-dash' });
    addSvg('path', { d: 'M500 590 V620 H940', class: 'reject-lane' });
    for (let index = 0; index < 12; index += 1) {
      const slot = addSvg('rect', { x: 520 + index * 34, y: 611, width: 28, height: 16, rx: 2, class: 'reject-slot' });
      rejectSlots.push(slot);
    }
    const rejectText = addSvg('text', { x: 770, y: 627, class: 'route-label' });
    rejectText.textContent = 'REJECT LANE';

    const columns = Math.min(4, Math.ceil(Math.sqrt(stages.length)));
    const rows = Math.ceil(stages.length / columns);
    const cellWidth = 900 / columns;
    const cellHeight = 440 / rows;
    const startX = 50;
    const startY = 82;

    stages.forEach(function (stage, index) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = startX + column * cellWidth;
      const y = startY + row * cellHeight;
      const group = addSvg('g', {});
      positions.push({ x: x, y: y, width: cellWidth - 18, height: cellHeight - 18 });
      addSvg('rect', { x: x, y: y, width: cellWidth - 18, height: cellHeight - 18, rx: 9, class: 'stage-box' }, group);

      const title = addSvg('text', { x: x + 10, y: y + 19, class: 'stage-name' }, group);
      title.textContent = String(stage.id).padStart(2, '0') + '  ' + stage.name;
      const meta = addSvg('text', { x: x + 10, y: y + 35, class: 'stage-meta' }, group);
      meta.textContent = stage.code + ' · ' + stage.cycleTimeSec + '초 · 불량 ' + (stage.failRate * 100).toFixed(0) + '%';

      for (let slot = 0; slot < stage.palletSlots; slot += 1) {
        const slotX = x + 10 + (slot % 4) * 17;
        const slotY = y + 48 + Math.floor(slot / 4) * 17;
        const slotNode = addSvg('rect', { x: slotX, y: slotY, width: 14, height: 12, rx: 2, class: 'slot' }, group);
        slotNode.setAttribute('data-stage', index);
        slotNode.setAttribute('data-slot', slot);
      }
      for (let pc = 0; pc < stage.testPcs; pc += 1) {
        const pcX = x + cellWidth - 72 - (pc % 2) * 32;
        const pcY = y + 49 + Math.floor(pc / 2) * 35;
        addSvg('rect', { x: pcX - 7, y: pcY + 14, width: 25, height: 4, rx: 2, class: 'desk' }, group);
        addSvg('rect', { x: pcX, y: pcY, width: 13, height: 10, rx: 2, class: 'desk' }, group);
        addSvg('rect', { x: pcX + 2, y: pcY + 2, width: 9, height: 5, rx: 1, class: 'monitor' }, group);
        const label = addSvg('text', { x: pcX - 3, y: pcY + 28, class: 'pc-label' }, group);
        label.textContent = 'PC' + (pc + 1);
      }
    });
  }

  function createPallets() {
    const count = Math.max(1, Number(data.simulation.palletCount) || 1);
    for (let i = 0; i < count; i += 1) {
      const location = positions[i % positions.length];
      const group = addSvg('g', {});
      addSvg('rect', { width: 18, height: 13, rx: 2, class: 'pallet' }, group);
      const serial = addSvg('text', { x: 1, y: 9, class: 'serial' }, group);
      serial.textContent = 'P' + String(i + 1).padStart(3, '0');
      const stageIndex = i % stages.length;
      const slotIndex = Math.floor(i / stages.length);
      const queued = slotIndex >= stages[stageIndex].palletSlots;
      pallets.push({ group: group, id: i, stage: stageIndex, slot: slotIndex, elapsed: 0, reject: false, queued: queued });
      placePallet(pallets[pallets.length - 1], location, 0);
    }
  }

  function placePallet(pallet, location, progress) {
    const stage = stages[pallet.stage];
    const slot = Math.min(pallet.slot, stage.palletSlots - 1);
    const laneX = location.x + 10 + (slot % 4) * 17;
    const laneY = location.y + 48 + Math.floor(slot / 4) * 17;
    pallet.group.setAttribute('transform', 'translate(' + (location.x + (pallet.queued ? 12 + (pallet.id % 4) * 21 : 10 + (slot % 4) * 17)) + ' ' + (pallet.queued ? location.y + location.height - 20 : laneY) + ')');
    pallet.group.style.opacity = pallet.queued ? '0.8' : '1';
    pallet.group.querySelector('rect').setAttribute('width', pallet.queued ? 16 : 14);
    pallet.group.querySelector('text').setAttribute('x', pallet.queued ? 0 : 0);
    if (!pallet.queued && progress > 0) {
      pallet.group.setAttribute('transform', 'translate(' + laneX + ' ' + (laneY + progress * 3) + ')');
    }
  }

  function drawStageList() {
    const list = document.getElementById('stageList');
    stages.forEach(function (stage, index) {
      const row = document.createElement('div');
      row.className = 'stage-row';
      const label = document.createElement('span');
      label.textContent = stage.id + '. ' + stage.name + ' · ' + stage.palletSlots + ' 슬롯 · ' + stage.testPcs + ' PC';
      const state = document.createElement('span');
      state.className = 'status';
      state.id = 'stageState' + index;
      state.textContent = '대기';
      state.style.color = colors.idle;
      const totals = document.createElement('span');
      totals.className = 'stage-counts';
      totals.id = 'stageCounts' + index;
      totals.textContent = '통과 0 · 불량 0';
      row.append(label, totals, state);
      list.appendChild(row);
    });
  }

  function update(frameTime) {
    const delta = Math.min((frameTime - previousFrame) / 1000, 1);
    previousFrame = frameTime;
    const speed = Number(document.getElementById('speedSelect').value);
    if (running) {
      simulatedSeconds += delta * speed;
      pallets.forEach(function (pallet) {
        const stage = stages[pallet.stage];
        pallet.elapsed += delta * speed;
        if (pallet.elapsed >= stage.cycleTimeSec) {
          pallet.elapsed = 0;
          if (random() < stage.failRate) {
            failed += 1;
            stageStats[pallet.stage].fail += 1;
            pallet.reject = true;
            pallet.group.querySelector('rect').setAttribute('class', 'pallet fail');
            const rejectIndex = rejectSlots.findIndex(function (slot) { return slot.getAttribute('class') === 'reject-slot'; });
            if (rejectIndex >= 0) {
              const slot = rejectSlots[rejectIndex];
              slot.setAttribute('class', 'reject-slot occupied');
              pallet.group.setAttribute('transform', 'translate(' + (Number(slot.getAttribute('x')) + 5) + ' ' + (Number(slot.getAttribute('y')) + 2) + ')');
            } else {
              pallet.group.style.display = 'none';
            }
          } else {
            if (pallet.stage === stages.length - 1) passed += 1;
            stageStats[pallet.stage].pass += 1;
            pallet.reject = false;
            pallet.group.querySelector('rect').setAttribute('class', 'pallet');
            pallet.stage = (pallet.stage + 1) % stages.length;
            pallet.slot = 0;
            pallet.queued = false;
          }
        }
        if (!pallet.reject) {
          const current = stages[pallet.stage];
          placePallet(pallet, positions[pallet.stage], pallet.elapsed / current.cycleTimeSec);
        }
      });
    }
    document.getElementById('passCount').textContent = passed;
    document.getElementById('failCount').textContent = failed;
    document.getElementById('uphValue').textContent = simulatedSeconds > 0 ? Math.round(passed * 3600 / simulatedSeconds) : 0;
    stages.forEach(function (stage, index) {
      const busy = pallets.some(function (pallet) { return pallet.stage === index && !pallet.reject && pallet.elapsed > 0; });
      const state = document.getElementById('stageState' + index);
      state.textContent = busy ? '검사 중' : '대기';
      state.style.color = busy ? colors.busy : colors.idle;
      document.getElementById('stageCounts' + index).textContent = '통과 ' + stageStats[index].pass + ' · 불량 ' + stageStats[index].fail;
    });
    window.requestAnimationFrame(update);
  }

  document.getElementById('lineTitle').textContent = data.line.name;
  document.getElementById('lineSub').textContent = data.line.product + ' · ' + data.line.shift;
  document.getElementById('shiftName').textContent = data.line.shift;
  document.getElementById('taktValue').textContent = data.line.taktTimeSec + '초 / ' + data.line.targetUph + ' UPH';
  document.getElementById('speedSelect').value = String(data.simulation.speed);
  document.getElementById('toggleButton').addEventListener('click', function (event) {
    running = !running;
    event.currentTarget.textContent = running ? 'Ⅱ 일시정지' : '▶ 재생';
  });

  drawFactory();
  createPallets();
  drawStageList();
  window.requestAnimationFrame(update);
}());
