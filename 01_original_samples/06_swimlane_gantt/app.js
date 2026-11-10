(function () {
'use strict';
var D = window.LINE_DATA;
if (!D) { document.body.innerHTML = '<p style="padding:20px">../data/line.js 를 불러오지 못했습니다.</p>'; return; }
var SIM = D.simulation, ST = D.stages, C = D.statusColors;
var $ = function (id) { return document.getElementById(id); };
var DT = 0.5; // 고정 시뮬레이션 스텝(초)

// ---------- 의사난수 ----------
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---------- UI 상태 ----------
var playing = true, speed = SIM.speed, winMin = 15, selected = null, viewEnd = null, hover = null, lastTs = null;

// ---------- 시뮬레이션 ----------
var S;
function reset() {
  var rnd = mulberry32(SIM.randomSeed);
  S = { t: 0, rnd: rnd, seq: 0, nextArr: 0, bars: [], units: [], freePallets: [], inflight: 0,
        arrived: 0, pass: 0, reject: 0, failEvents: 0, doneTimes: [],
        stages: ST.map(function (s) {
          var pcs = []; for (var i = 0; i < s.testPcs; i++) pcs.push({ unit: null, bar: null, endAt: 0, flash: null, flashUntil: 0 });
          return { queue: [], occ: [], pcs: pcs };
        }) };
  for (var p = 1; p <= SIM.palletCount; p++) S.freePallets.push(p);
  selected = null; viewEnd = null; updatePath();
}
function serialOf(n) { return 'AVN' + String(n).padStart(4, '0'); }

function enterQueue(u, si, front) {
  u.stage = si; u.phase = 'queue';
  if (front) S.stages[si].queue.unshift(u); else S.stages[si].queue.push(u);
}
function step() {
  var t = S.t, rnd = S.rnd, i, si;
  if (t >= S.nextArr) {
    S.nextArr += SIM.arrivalIntervalSec;
    if (S.freePallets.length) {
      var u = { id: ++S.seq, serial: serialOf(S.seq), pallet: S.freePallets.shift(), bars: [], retries: [], phase: 'queue', stage: 0, result: null };
      S.units.push(u); S.arrived++; S.inflight++;
      enterQueue(u, 0, false);
    }
  }
  for (si = 0; si < ST.length; si++) {
    var sg = S.stages[si], def = ST[si];
    for (i = 0; i < sg.pcs.length; i++) {
      var pc = sg.pcs[i];
      if (pc.unit && t >= pc.endAt) {
        var un = pc.unit, b = pc.bar, failed = rnd() < def.failRate;
        b.end = pc.endAt; b.result = failed ? 'fail' : 'pass';
        pc.flash = b.result; pc.flashUntil = t + 4; pc.unit = null; pc.bar = null;
        sg.occ.splice(sg.occ.indexOf(un), 1);
        if (failed) {
          S.failEvents++;
          var n = (un.retries[si] || 0);
          if (SIM.retestOnFail && n < SIM.maxRetest) { un.retries[si] = n + 1; enterQueue(un, si, true); }
          else finish(un, 'fail');
        } else if (si + 1 < ST.length) enterQueue(un, si + 1, false);
        else finish(un, 'pass');
      }
    }
    while (sg.queue.length && sg.occ.length < def.palletSlots) {
      var q = sg.queue.shift(); q.phase = 'moving'; q.readyAt = t + SIM.conveyorTransferSec; sg.occ.push(q);
    }
    for (var k = 0; k < sg.occ.length; k++) {
      var o = sg.occ[k];
      if (o.phase === 'moving' && t >= o.readyAt) o.phase = 'ready';
      if (o.phase === 'ready') {
        for (i = 0; i < sg.pcs.length; i++) if (!sg.pcs[i].unit) {
          var dur = def.cycleTimeSec * (0.85 + 0.3 * rnd());
          var bar = { unit: o, stage: si, pc: i, start: t, end: null, result: null, retest: (o.retries[si] || 0) };
          o.bars.push(bar); S.bars.push(bar); o.phase = 'testing';
          sg.pcs[i].unit = o; sg.pcs[i].bar = bar; sg.pcs[i].endAt = t + dur; break;
        }
      }
    }
  }
  S.t += DT;
}
function finish(u, res) {
  u.phase = 'done'; u.result = res; S.inflight--;
  S.freePallets.push(u.pallet);
  if (res === 'pass') { S.pass++; S.doneTimes.push(S.t); } else S.reject++;
}
function advance(simSec) { var target = S.t + simSec; while (S.t < target) step(); }

// ---------- 레이아웃 ----------
var cv = $('cv'), g = cv.getContext('2d');
var HEAD_W = 270, AXIS_H = 30, ROW_H = 28, GAP = 5, W = 800, H = 600, dpr = 1;
var layout = [];
function computeLayout() {
  var y = AXIS_H; layout = [];
  ST.forEach(function (s) { var h = Math.max(s.testPcs * ROW_H, 3 * 16 + 8); layout.push({ y0: y, y1: y + h, rowH: h / s.testPcs }); y += h + GAP; });
  H = y;
}
function resize() {
  dpr = window.devicePixelRatio || 1; W = $('wrap').clientWidth; computeLayout();
  cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
}
function pad(n) { return String(n).padStart(2, '0'); }
function fmtClock(t) { var s = Math.floor(t) + 8 * 3600; return pad(Math.floor(s / 3600) % 24) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60); }
function mmss(sec) { sec = Math.max(0, Math.round(sec)); return pad(Math.floor(sec / 60)) + ':' + pad(sec % 60); }

function viewRange() {
  var span = winMin * 60, end = viewEnd === null ? S.t + span * 0.04 : viewEnd;
  return { t0: end - span, t1: end, span: span };
}
function tx(t, r) { return HEAD_W + (t - r.t0) / r.span * (W - HEAD_W - 8); }
function barColor(b) { return b.result === 'pass' ? C.pass : b.result === 'fail' ? C.fail : C.busy; }
function rr(x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function barRect(b, r) {
  var L = layout[b.stage], x0 = tx(b.start, r), x1 = tx(b.end === null ? S.t : b.end, r);
  return { x: x0, y: L.y0 + b.pc * L.rowH + 3, w: Math.max(2, x1 - x0), h: L.rowH - 6 };
}

// ---------- 그리기 ----------
function draw() {
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#0d1219'; g.fillRect(0, 0, W, H);
  var r = viewRange(), i, si;
  for (si = 0; si < ST.length; si++) {
    var L = layout[si];
    g.fillStyle = si % 2 ? '#111823' : '#0f1520'; g.fillRect(0, L.y0, W, L.y1 - L.y0);
    for (i = 1; i < ST[si].testPcs; i++) {
      var yy = L.y0 + i * L.rowH;
      g.strokeStyle = '#1b2533'; g.beginPath(); g.moveTo(HEAD_W - 56, yy + .5); g.lineTo(W, yy + .5); g.stroke();
    }
  }
  var steps = [10, 30, 60, 120, 300, 600], tick = 60;
  for (i = 0; i < steps.length; i++) { tick = steps[i]; if (r.span / tick <= 14) break; }
  g.font = '11px sans-serif'; g.textBaseline = 'middle';
  for (var tt = Math.ceil(r.t0 / tick) * tick; tt <= r.t1; tt += tick) {
    var x = tx(tt, r); if (x < HEAD_W) continue;
    g.strokeStyle = '#1f2b3b'; g.beginPath(); g.moveTo(x + .5, AXIS_H - 6); g.lineTo(x + .5, H); g.stroke();
    g.fillStyle = '#7f8ea2'; g.textAlign = 'center'; g.fillText(fmtClock(tt), x, AXIS_H / 2 - 2);
  }
  var xn = tx(S.t, r);
  if (xn >= HEAD_W && xn <= W) {
    g.strokeStyle = '#f2c94c'; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(xn + .5, AXIS_H - 8); g.lineTo(xn + .5, H); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#f2c94c'; g.textAlign = 'left'; g.fillText('NOW', xn + 4, AXIS_H - 10);
  }
  g.save(); g.beginPath(); g.rect(HEAD_W, 0, W - HEAD_W, H); g.clip();
  var sel = selected, dim = !!sel;
  for (i = 0; i < S.bars.length; i++) {
    var b = S.bars[i], e = b.end === null ? S.t : b.end;
    if (e < r.t0 || b.start > r.t1) continue;
    var R = barRect(b, r), isSel = sel && b.unit === sel;
    g.globalAlpha = dim && !isSel ? 0.18 : 1;
    g.fillStyle = barColor(b); rr(R.x, R.y, R.w, R.h, 3); g.fill();
    if (b.retest) { g.strokeStyle = '#ffffffaa'; g.lineWidth = 1; g.setLineDash([3, 2]); g.stroke(); g.setLineDash([]); }
    if (isSel) { g.strokeStyle = '#fff'; g.lineWidth = 2; rr(R.x, R.y, R.w, R.h, 3); g.stroke(); g.lineWidth = 1; }
    if (hover === b && !isSel) { g.strokeStyle = '#fff'; rr(R.x, R.y, R.w, R.h, 3); g.stroke(); }
    if (R.w > 26) {
      g.fillStyle = '#fff'; g.textAlign = 'left'; g.font = '10px sans-serif';
      var lab = R.w > 62 ? b.unit.serial : b.unit.serial.slice(-4);
      g.save(); g.beginPath(); g.rect(R.x, R.y, R.w, R.h); g.clip(); g.fillText(lab, R.x + 4, R.y + R.h / 2 + .5); g.restore();
    }
  }
  g.globalAlpha = 1;
  if (sel) {
    var bs = sel.bars; g.lineWidth = 2; g.strokeStyle = '#fff'; g.fillStyle = '#fff';
    for (i = 0; i + 1 < bs.length; i++) {
      if (bs[i].end === null) break;
      var A = barRect(bs[i], r), B = barRect(bs[i + 1], r);
      var ax = A.x + A.w, ay = A.y + A.h / 2, bx = B.x, by = B.y + B.h / 2, mx = (ax + bx) / 2;
      g.beginPath(); g.moveTo(ax, ay); g.bezierCurveTo(mx, ay, mx, by, bx, by); g.stroke();
      g.beginPath(); g.moveTo(bx, by); g.lineTo(bx - 6, by - 4); g.lineTo(bx - 6, by + 4); g.fill();
    }
    g.lineWidth = 1;
  }
  g.restore();
  g.fillStyle = '#131b26'; g.fillRect(0, 0, HEAD_W, H);
  g.fillStyle = '#7f8ea2'; g.font = '11px sans-serif'; g.textAlign = 'left'; g.fillText('단계 / 슬롯 점유 / 대기열', 10, AXIS_H / 2);
  g.textAlign = 'right'; g.fillText('PC', HEAD_W - 8, AXIS_H / 2);
  for (si = 0; si < ST.length; si++) drawHeader(si);
  g.strokeStyle = '#2a384b'; g.beginPath(); g.moveTo(HEAD_W + .5, 0); g.lineTo(HEAD_W + .5, H); g.stroke();
}
function drawHeader(si) {
  var L = layout[si], s = ST[si], sg = S.stages[si], i, y = L.y0;
  g.strokeStyle = '#2a384b'; g.beginPath(); g.moveTo(0, y + .5); g.lineTo(HEAD_W, y + .5); g.stroke();
  g.textAlign = 'left'; g.fillStyle = '#e8eef6'; g.font = 'bold 12px sans-serif';
  g.fillText(s.id + '. ' + s.name, 10, y + 11);
  g.fillStyle = '#7f8ea2'; g.font = '10px sans-serif';
  g.fillText(s.code + ' · ' + s.cycleTimeSec + '초 · 슬롯 ' + s.palletSlots + ' · PC ' + s.testPcs, 10, y + 25);
  var cw = Math.min(20, 150 / s.palletSlots), gy = y + 32;
  for (i = 0; i < s.palletSlots; i++) {
    var o = sg.occ[i], col = '#1d2938';
    if (o) col = o.phase === 'testing' ? C.busy : C.waiting;
    g.fillStyle = col; rr(10 + i * (cw + 2), gy, cw, 12, 2); g.fill();
    if (o && o === selected) { g.strokeStyle = '#fff'; g.stroke(); }
  }
  g.fillStyle = '#9aa8ba'; g.font = '10px sans-serif';
  g.fillText(sg.occ.length + '/' + s.palletSlots, 14 + s.palletSlots * (cw + 2), gy + 7);
  var qy = gy + 19, qn = sg.queue.length;
  g.fillStyle = qn ? C.waiting : '#5b6a7d'; g.fillText('대기 ' + qn, 10, qy + 5);
  for (i = 0; i < Math.min(qn, 14); i++) { g.fillStyle = sg.queue[i] === selected ? '#fff' : C.waiting; g.fillRect(52 + i * 8, qy, 6, 10); }
  if (qn > 14) { g.fillStyle = C.waiting; g.fillText('+' + (qn - 14), 52 + 14 * 8 + 2, qy + 5); }
  for (i = 0; i < s.testPcs; i++) {
    var pc = sg.pcs[i], cy = y + i * L.rowH + L.rowH / 2, st = 'idle';
    if (pc.unit) st = 'busy'; else if (pc.flash && S.t < pc.flashUntil) st = pc.flash;
    g.fillStyle = C[st]; g.beginPath(); g.arc(HEAD_W - 44, cy, 5, 0, 7); g.fill();
    g.fillStyle = '#c3cedb'; g.textAlign = 'left'; g.font = '11px sans-serif'; g.fillText('PC' + (i + 1), HEAD_W - 34, cy);
  }
}

// ---------- KPI / 경로 패널 ----------
var kpiEls = {};
function kpi(key, label, val) {
  var e = kpiEls[key];
  if (!e) { var d = document.createElement('div'); d.className = 'kpi'; d.innerHTML = '<b></b><span>' + label + '</span>'; $('kpis').appendChild(d); e = kpiEls[key] = d.firstChild; }
  e.textContent = val;
}
function updateKpi() {
  var win = Math.max(120, Math.min(S.t, 1800)), cut = S.t - win, n = 0;
  for (var i = S.doneTimes.length - 1; i >= 0 && S.doneTimes[i] >= cut; i--) n++;
  var uph = S.t < 60 ? 0 : Math.round(n * 3600 / win), tot = S.pass + S.reject;
  var wip = 0; S.stages.forEach(function (s) { wip += s.occ.length + s.queue.length; });
  kpi('t', '시뮬레이션 시각', fmtClock(S.t)); kpi('in', '투입', S.arrived); kpi('wip', '라인 내 WIP', wip);
  kpi('p', '누적 통과', S.pass); kpi('f', '누적 불량', S.reject); kpi('fe', '검사 NG 횟수', S.failEvents);
  kpi('y', '직행률', tot ? (S.pass / tot * 100).toFixed(1) + '%' : '-');
  kpi('u', 'UPH (목표 ' + D.line.targetUph + ')', uph);
}
var pathTick = 0;
function updatePath() {
  var el = $('path');
  if (!selected) { el.textContent = '팔레트를 선택하지 않았습니다. 막대를 클릭하면 해당 시리얼의 전 단계 경로가 표시됩니다.'; return; }
  var u = selected, h = '<b style="color:#fff">' + u.serial + '</b> (팔레트 P' + pad(u.pallet) + ') · ' +
    (u.phase === 'done' ? (u.result === 'pass' ? '최종 통과' : '불량 확정') : '진행중: ' + ST[u.stage].name) + '<br>';
  u.bars.forEach(function (b) {
    var dur = (b.end === null ? S.t : b.end) - b.start;
    h += '<span class="step" style="background:' + barColor(b) + '">' + ST[b.stage].code + ' PC' + (b.pc + 1) + (b.retest ? ' 재검' : '') + ' · ' + fmtClock(b.start) + ' · ' + mmss(dur) + '</span>';
  });
  el.innerHTML = h;
}

// ---------- 상호작용 ----------
function pos(e) { var b = cv.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; }
function hit(mx, my) {
  if (mx < HEAD_W) return null; var r = viewRange();
  for (var i = S.bars.length - 1; i >= 0; i--) { var b = S.bars[i], R = barRect(b, r); if (mx >= R.x && mx <= R.x + R.w && my >= R.y && my <= R.y + R.h) return b; }
  return null;
}
function setViewEnd(v) {
  var span = winMin * 60, live = S.t + span * 0.04;
  v = Math.max(span * 0.2, v);
  viewEnd = v >= live ? null : v;
}
var drag = null;
cv.addEventListener('mousedown', function (e) { drag = { x: e.clientX, moved: false, end: viewRange().t1 }; cv.style.cursor = 'grabbing'; });
window.addEventListener('mouseup', function (e) {
  cv.style.cursor = 'grab';
  if (drag && !drag.moved) {
    var p = pos(e), b = hit(p.x, p.y); selected = b ? b.unit : null; updatePath();
  }
  drag = null;
});
window.addEventListener('mousemove', function (e) {
  if (!drag) return;
  var dx = e.clientX - drag.x;
  if (Math.abs(dx) > 4) drag.moved = true;
  if (drag.moved) { var r = viewRange(); setViewEnd(drag.end - dx / (W - HEAD_W) * r.span); }
});
cv.addEventListener('mousemove', function (e) {
  var p = pos(e), b = drag && drag.moved ? null : hit(p.x, p.y), tip = $('tip'); hover = b;
  if (!b) { tip.style.display = 'none'; return; }
  var dur = (b.end === null ? S.t : b.end) - b.start;
  tip.innerHTML = '<b>' + b.unit.serial + '</b> · 팔레트 P' + pad(b.unit.pallet) + '<br>' + ST[b.stage].name + ' · PC' + (b.pc + 1) + (b.retest ? ' (재검사)' : '') +
    '<br>' + fmtClock(b.start) + ' ~ ' + (b.end === null ? '진행중' : fmtClock(b.end)) + ' (' + mmss(dur) + ')<br>결과: ' + (b.result === 'pass' ? '통과' : b.result === 'fail' ? '불량' : '진행중');
  tip.style.display = 'block'; tip.style.left = Math.min(p.x + 14, W - 200) + 'px'; tip.style.top = (p.y + 14) + 'px';
});
cv.addEventListener('mouseleave', function () { hover = null; $('tip').style.display = 'none'; });
cv.addEventListener('wheel', function (e) {
  e.preventDefault(); var r = viewRange(), d = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY);
  setViewEnd(r.t1 + d / (W - HEAD_W) * r.span);
}, { passive: false });

// ---------- 컨트롤 ----------
var spd = [1, 2, 5, 10, 20, 30, 60];
if (spd.indexOf(SIM.speed) < 0) spd.push(SIM.speed);
spd.sort(function (a, b) { return a - b; }).forEach(function (v) {
  var o = document.createElement('option'); o.value = v; o.textContent = v + '배속' + (v === SIM.speed ? ' (기본)' : ''); if (v === SIM.speed) o.selected = true; $('selSpeed').appendChild(o);
});
[5, 10, 15, 20, 30].forEach(function (v) { var o = document.createElement('option'); o.value = v; o.textContent = '최근 ' + v + '분'; if (v === winMin) o.selected = true; $('selWin').appendChild(o); });
$('selSpeed').onchange = function () { speed = +this.value; };
$('selWin').onchange = function () { winMin = +this.value; viewEnd = null; };
$('btnPlay').onclick = function () { playing = !playing; this.textContent = playing ? '⏸ 일시정지' : '▶ 재생'; };
$('btnLive').onclick = function () { viewEnd = null; };
$('btnReset').onclick = function () { reset(); };
$('ttl').textContent = D.line.name;
$('sub').textContent = D.line.product + ' · ' + D.line.shift + ' · 단계 ' + ST.length + ' · 팔레트 ' + SIM.palletCount + '개 · seed ' + SIM.randomSeed;
[['busy', '검사중'], ['pass', '통과'], ['fail', '불량'], ['waiting', '슬롯 이동·대기/대기열']].forEach(function (a) {
  var s = document.createElement('span'); s.innerHTML = '<i style="background:' + C[a[0]] + '"></i>' + a[1]; $('legend').appendChild(s);
});
window.addEventListener('resize', resize);

function frame(ts) {
  if (lastTs === null) lastTs = ts;
  var dt = Math.min(0.1, (ts - lastTs) / 1000); lastTs = ts;
  if (playing) advance(dt * speed);
  draw(); updateKpi();
  if (selected && selected.phase !== 'done' && (++pathTick % 15 === 0)) updatePath();
  requestAnimationFrame(frame);
}
reset(); resize(); requestAnimationFrame(frame);
})();
