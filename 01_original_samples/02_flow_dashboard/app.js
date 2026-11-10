(function () {
'use strict';
var D = window.LINE_DATA;
if (!D) { document.body.innerHTML = '<p style="padding:20px">../data/line.js 를 읽지 못했습니다.</p>'; return; }
var S = D.stages, N = S.length, SIM = D.simulation, LN = D.line, C = D.statusColors;
var NS = 'http://www.w3.org/2000/svg';
var DT = 0.25;            // 고정 시뮬레이션 스텝(초)
var FLASH = 2;            // PC 합격/불량 표시 시간(초)
var WIN = 600;            // 가동률·UPH 이동 창(초)
var SAMPLE = 5;           // 이력 샘플 간격(초)

// ---- CSS 색상 변수를 데이터의 statusColors 로 설정
Object.keys(C).forEach(function (k) { document.documentElement.style.setProperty('--' + k, C[k]); });

// ---- 유틸
function mulberry32(seed) {
  var a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function el(name, attrs, parent, text) {
  var e = document.createElementNS(NS, name);
  if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
function $(id) { return document.getElementById(id); }
function pad(n) { return (n < 10 ? '0' : '') + n; }
function fmtT(t) { t = Math.floor(t); return pad(Math.floor(t / 3600)) + ':' + pad(Math.floor(t / 60) % 60) + ':' + pad(t % 60); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// =====================================================================
//  시뮬레이션 (결정적: randomSeed + 고정 스텝)
// =====================================================================
function Sim() { this.reset(); }
Sim.prototype.reset = function () {
  this.t = 0;
  this.rand = mulberry32(SIM.randomSeed);
  this.nextId = 1;
  this.nextArrival = 0;
  this.spawned = 0; this.passed = 0; this.defects = 0; this.retests = 0;
  this.transit = [];
  this.stages = S.map(function (st) {
    var pcs = [];
    for (var i = 0; i < st.testPcs; i++) pcs.push({ state: 'idle', p: null, start: 0, end: 0, flashEnd: 0 });
    var slots = [];
    for (var j = 0; j < st.palletSlots; j++) slots.push(null);
    return { queue: [], slots: slots, pcs: pcs, busyAcc: 0, completed: 0, failed: 0 };
  });
  this.hist = [{ t: 0, passed: 0, busy: S.map(function () { return 0; }) }];
  this.uphSeries = [];
  this.lastSample = 0; this.lastUphSample = 0;
  this.log = []; this.logDirty = true;
  this.bottleneck = -1;
  this.addLog('info', '시뮬레이션 시작 (seed ' + SIM.randomSeed + ')');
};
Sim.prototype.addLog = function (type, msg) {
  this.log.unshift({ t: this.t, type: type, msg: msg });
  if (this.log.length > 60) this.log.pop();
  this.logDirty = true;
};
Sim.prototype.inflight = function () { return this.spawned - this.passed - this.defects; };
Sim.prototype.sendTo = function (p, to) {
  this.transit.push({ p: p, to: to, t0: this.t, t1: this.t + SIM.conveyorTransferSec });
};
Sim.prototype.step = function () {
  var dt = DT, i, st, k;
  this.t += dt;
  var t = this.t;
  // 투입
  while (t >= this.nextArrival) {
    if (this.inflight() < SIM.palletCount) {
      var p = { id: this.nextId++, retries: 0, slot: -1, state: 'transit' };
      this.spawned++;
      this.sendTo(p, 0);
      this.addLog('info', 'PLT-' + pad3(p.id) + ' 투입');
    }
    this.nextArrival += SIM.arrivalIntervalSec;
  }
  // 컨베이어 도착
  for (k = this.transit.length - 1; k >= 0; k--) {
    var tr = this.transit[k];
    if (t >= tr.t1) {
      this.transit.splice(k, 1);
      if (tr.to >= N) {
        this.passed++;
        this.addLog('pass', 'PLT-' + pad3(tr.p.id) + ' 최종 통과' + (tr.p.retries ? ' (재검 ' + tr.p.retries + '회)' : ''));
      } else {
        tr.p.state = 'queue';
        this.stages[tr.to].queue.push(tr.p);
      }
    }
  }
  // 단계 처리
  for (i = 0; i < N; i++) {
    st = this.stages[i];
    var cfg = S[i];
    // PC 완료 처리
    for (k = 0; k < st.pcs.length; k++) {
      var pc = st.pcs[k];
      if (pc.state === 'busy') {
        st.busyAcc += dt;
        if (t >= pc.end) {
          var pl = pc.p, failed = this.rand() < cfg.failRate;
          pc.p = null; pc.flashEnd = t + FLASH;
          if (!failed) {
            pc.state = 'pass'; st.completed++;
            st.slots[pl.slot] = null; pl.slot = -1;
            this.sendTo(pl, i + 1);
          } else {
            pc.state = 'fail'; st.failed++;
            if (SIM.retestOnFail && pl.retries < SIM.maxRetest) {
              pl.retries++; pl.state = 'wait'; this.retests++;
              this.addLog('retest', '[' + cfg.code + '] PLT-' + pad3(pl.id) + ' 불량 → 재검사');
            } else {
              st.slots[pl.slot] = null; pl.slot = -1; this.defects++;
              this.addLog('fail', '[' + cfg.code + '] PLT-' + pad3(pl.id) + ' 불량 확정 (배출)');
            }
          }
        }
      } else if ((pc.state === 'pass' || pc.state === 'fail') && t >= pc.flashEnd) {
        pc.state = 'idle';
      }
    }
    // 슬롯 채우기
    for (k = 0; k < st.slots.length && st.queue.length; k++) {
      if (!st.slots[k]) {
        var q = st.queue.shift();
        q.slot = k; q.state = 'wait'; st.slots[k] = q;
      }
    }
    // PC 배정 (오래 기다린 슬롯 순서로 단순 스캔)
    for (k = 0; k < st.pcs.length; k++) {
      var pc2 = st.pcs[k];
      if (pc2.state !== 'idle') continue;
      for (var s = 0; s < st.slots.length; s++) {
        var sp = st.slots[s];
        if (sp && sp.state === 'wait') {
          sp.state = 'test';
          pc2.state = 'busy'; pc2.p = sp; pc2.start = t;
          pc2.end = t + cfg.cycleTimeSec * (0.9 + 0.2 * this.rand());
          break;
        }
      }
    }
  }
  // 이력 샘플
  if (t - this.lastSample >= SAMPLE) {
    this.lastSample = t;
    this.hist.push({ t: t, passed: this.passed, busy: this.stages.map(function (x) { return x.busyAcc; }) });
    if (this.hist.length > 2000) this.hist.shift();
    this.updateBottleneck();
  }
  if (t - this.lastUphSample >= 30) {
    this.lastUphSample = t;
    this.uphSeries.push({ t: t, v: this.uph() });
    if (this.uphSeries.length > 120) this.uphSeries.shift();
  }
};
function pad3(n) { return n < 10 ? '00' + n : n < 100 ? '0' + n : '' + n; }
Sim.prototype.baseEntry = function () {
  var target = this.t - WIN, h = this.hist, i = 0;
  for (i = h.length - 1; i > 0; i--) if (h[i].t <= target) break;
  return h[i];
};
Sim.prototype.uph = function () {
  var b = this.baseEntry(), span = this.t - b.t;
  if (span < 60) return 0;
  return (this.passed - b.passed) / span * 3600;
};
Sim.prototype.util = function () {
  var b = this.baseEntry(), span = this.t - b.t, self = this;
  return S.map(function (cfg, i) {
    if (span < 1) return 0;
    return clamp((self.stages[i].busyAcc - b.busy[i]) / (span * cfg.testPcs), 0, 1);
  });
};
Sim.prototype.updateBottleneck = function () {
  if (this.t < 180) return;
  var u = this.util(), best = -1, bs = 0, i;
  for (i = 0; i < N; i++) {
    var sc = u[i] + 0.08 * this.stages[i].queue.length;
    if (sc > bs) { bs = sc; best = i; }
  }
  this.bnScore = bs;
  if (best !== this.bottleneck) {
    this.bottleneck = best;
    this.addLog('bnk', '병목 단계: ' + (best >= 0 ? S[best].id + '단계 ' + S[best].name : '없음'));
  }
};

// =====================================================================
//  흐름도 (SVG)
// =====================================================================
var NW = 150, NH = 190, GAP = 46, MX = 14, SRC = 50, SGAP = 40, NY = 22;
var sim = new Sim();
var svg = $('flowSvg');
var nodeX = function (i) { return MX + SRC + SGAP + i * (NW + GAP); };
var sinkX = nodeX(N - 1) + NW + SGAP;
var VW = sinkX + SRC + MX, VH = NY + NH + 16;
svg.setAttribute('viewBox', '0 0 ' + VW + ' ' + VH);
var cy = NY + 96;
function rightOf(k) { return k < 0 ? MX + SRC : nodeX(k) + NW; }
function leftOf(k) { return k >= N ? sinkX : nodeX(k); }

var gEdges = el('g', null, svg), gNodes = el('g', null, svg), gPal = el('g', null, svg);
var defs = el('defs', null, svg);
var mk = el('marker', { id: 'arr', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto' }, defs);
el('path', { d: 'M0,0 L10,5 L0,10 z', fill: '#5b6b82' }, mk);

// 입출구
function endcap(x, label, sub, color) {
  var g = el('g', null, gNodes);
  el('rect', { x: x, y: cy - 34, width: SRC, height: 68, rx: 10, fill: '#1d2633', stroke: color, 'stroke-width': 1.5 }, g);
  el('text', { x: x + SRC / 2, y: cy - 4, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 700 }, g, label);
  var t2 = el('text', { x: x + SRC / 2, y: cy + 14, 'text-anchor': 'middle', 'font-size': 11, fill: '#8b98a9' }, g, sub);
  t2.style.fill = '#8b98a9';
  return t2;
}
var srcSub = endcap(MX, '투입', '0', C.busy);
var sinkSub = endcap(sinkX, '출하', '0', C.pass);

for (var e = 0; e <= N; e++) {
  el('line', { x1: rightOf(e - 1) + 2, y1: cy, x2: leftOf(e) - 2, y2: cy, stroke: '#5b6b82', 'stroke-width': 2, 'stroke-dasharray': '6 4', 'class': 'flowline', 'marker-end': 'url(#arr)' }, gEdges);
}

var nodes = [];
S.forEach(function (cfg, i) {
  var x = nodeX(i), g = el('g', { transform: 'translate(' + x + ',' + NY + ')' }, gNodes), n = {};
  n.box = el('rect', { width: NW, height: NH, rx: 12, fill: '#1d2633', stroke: '#33425a', 'stroke-width': 1.5 }, g);
  el('circle', { cx: 19, cy: 20, r: 11, fill: '#2a3648' }, g);
  el('text', { x: 19, y: 24.5, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700 }, g, cfg.id);
  el('text', { x: 38, y: 25, 'font-size': 14, 'font-weight': 700 }, g, cfg.code);
  n.badge = el('text', { x: NW - 8, y: 24, 'text-anchor': 'end', 'font-size': 11, 'font-weight': 700, fill: C.fail }, g, '');
  n.badge.style.fill = C.fail;
  var nm = el('text', { x: 10, y: 50, 'font-size': 12 }, g, cfg.name);
  if (cfg.name.length > 9) { nm.setAttribute('textLength', NW - 20); nm.setAttribute('lengthAdjust', 'spacingAndGlyphs'); }
  // 슬롯
  n.slotLbl = el('text', { x: 10, y: 72, 'font-size': 11 }, g, '');
  n.slotLbl.style.fill = '#8b98a9';
  n.slots = [];
  var sw = (NW - 20 - (cfg.palletSlots - 1) * 3) / cfg.palletSlots;
  for (var s = 0; s < cfg.palletSlots; s++)
    n.slots.push(el('rect', { x: 10 + s * (sw + 3), y: 78, width: sw, height: 14, rx: 3, fill: '#2a3648' }, g));
  // PC
  n.pcLbl = el('text', { x: 10, y: 114, 'font-size': 11 }, g, '');
  n.pcLbl.style.fill = '#8b98a9';
  n.pcs = []; n.pbar = [];
  var ps = Math.min(30, (NW - 20 - (cfg.testPcs - 1) * 6) / cfg.testPcs);
  for (var k = 0; k < cfg.testPcs; k++) {
    var px = 10 + k * (ps + 6);
    n.pcs.push(el('rect', { x: px, y: 120, width: ps, height: ps - 4, rx: 4, fill: C.idle }, g));
    el('text', { x: px + ps / 2, y: 120 + (ps - 4) / 2 + 4, 'text-anchor': 'middle', 'font-size': 10, 'font-weight': 700, fill: '#0f141b' }, g, 'PC' + (k + 1)).style.fill = '#0f141b';
    el('rect', { x: px, y: 120 + ps - 1, width: ps, height: 4, rx: 2, fill: '#2a3648' }, g);
    n.pbar.push({ r: el('rect', { x: px, y: 120 + ps - 1, width: 0, height: 4, rx: 2, fill: C.busy }, g), w: ps });
  }
  // 대기열
  n.qLbl = el('text', { x: 10, y: 172, 'font-size': 12, 'font-weight': 600 }, g, '');
  n.qDots = [];
  for (var d = 0; d < 9; d++) n.qDots.push(el('rect', { x: 10 + d * 15, y: 178, width: 11, height: 8, rx: 2, fill: C.waiting, opacity: 0 }, g));
  nodes.push(n);
});

// 범례
$('legend').innerHTML = ['idle:대기', 'busy:검사중', 'pass:합격', 'fail:불량', 'waiting:대기열/슬롯 대기'].map(function (s) {
  var p = s.split(':'); return '<span><i style="background:' + C[p[0]] + '"></i>' + p[1] + '</span>';
}).join('') + '<span><i style="background:#e8eef5"></i>팔레트</span>';

var palEls = {};
function renderFlow(rt) {
  var i, k, n, st;
  var bn = sim.bottleneck;
  for (i = 0; i < N; i++) {
    n = nodes[i]; st = sim.stages[i];
    var occ = 0, busyPc = 0;
    for (k = 0; k < st.slots.length; k++) {
      var sp = st.slots[k];
      n.slots[k].setAttribute('fill', !sp ? '#2a3648' : sp.state === 'test' ? C.busy : C.waiting);
      if (sp) occ++;
    }
    n.slotLbl.textContent = '팔레트 슬롯 ' + occ + '/' + st.slots.length;
    for (k = 0; k < st.pcs.length; k++) {
      var pc = st.pcs[k], col = C[pc.state] || C.idle;
      n.pcs[k].setAttribute('fill', col);
      var pr = pc.state === 'busy' ? clamp((rt - pc.start) / (pc.end - pc.start), 0, 1) : 0;
      n.pbar[k].r.setAttribute('width', (pr * n.pbar[k].w).toFixed(1));
      if (pc.state === 'busy') busyPc++;
    }
    n.pcLbl.textContent = '검사 PC ' + st.pcs.length + '대 · 가동 ' + busyPc;
    var ql = st.queue.length;
    n.qLbl.textContent = '대기열 ' + ql;
    n.qLbl.style.fill = ql > 0 ? C.waiting : '#8b98a9';
    for (k = 0; k < n.qDots.length; k++) n.qDots[k].setAttribute('opacity', k < ql ? 1 : 0);
    var hot = i === bn;
    n.box.setAttribute('stroke', hot ? C.fail : '#33425a');
    n.box.setAttribute('stroke-width', hot ? 3 : 1.5);
    n.badge.textContent = hot ? '▲ 병목' : '';
  }
  // 이동 중 팔레트
  var seen = {};
  for (k = 0; k < sim.transit.length; k++) {
    var tr = sim.transit[k], f = clamp((rt - tr.t0) / (tr.t1 - tr.t0), 0, 1);
    var x0 = rightOf(tr.to - 1) , x1 = leftOf(tr.to);
    var x = x0 + (x1 - x0) * f;
    var r = palEls[tr.p.id];
    if (!r) r = palEls[tr.p.id] = el('rect', { width: 12, height: 12, rx: 3, y: cy - 6 }, gPal);
    r.setAttribute('x', (x - 6).toFixed(1));
    r.setAttribute('fill', tr.p.retries ? '#f2994a' : '#e8eef5');
    seen[tr.p.id] = 1;
  }
  for (var id in palEls) if (!seen[id]) { gPal.removeChild(palEls[id]); delete palEls[id]; }
  srcSub.textContent = sim.spawned; sinkSub.textContent = sim.passed;
}

// =====================================================================
//  대시보드
// =====================================================================
var kpiDefs = [
  ['spawned', '누적 투입'], ['passed', '누적 통과'], ['defects', '누적 불량'],
  ['yield', '수율'], ['uph', 'UPH'], ['wip', '라인 재공(WIP)'], ['retests', '재검사 횟수']
];
var kpiEls = {};
$('kpis').innerHTML = kpiDefs.map(function (d) {
  return '<div class="kpi"><div class="l">' + d[1] + '</div><div class="v" id="k_' + d[0] + '">0</div><div class="s" id="s_' + d[0] + '"></div>' +
    (d[0] === 'uph' || d[0] === 'yield' ? '<div class="bar"><b id="b_' + d[0] + '"></b></div>' : '') + '</div>';
}).join('');
kpiDefs.forEach(function (d) { kpiEls[d[0]] = { v: $('k_' + d[0]), s: $('s_' + d[0]), b: $('b_' + d[0]) }; });

// 가동률 막대차트
var us = $('utilSvg'), UW = 520, UH = 250, UL = 36, UR = 10, UT = 14, UB = 54;
var uPlotH = UH - UT - UB, uBw = (UW - UL - UR) / N;
[0, 0.25, 0.5, 0.75, 1].forEach(function (v) {
  var y = UT + uPlotH * (1 - v);
  el('line', { x1: UL, x2: UW - UR, y1: y, y2: y, stroke: '#273140' }, us);
  el('text', { x: UL - 6, y: y + 4, 'text-anchor': 'end', 'font-size': 10 }, us, Math.round(v * 100) + '%').style.fill = '#8b98a9';
});
var uBars = S.map(function (cfg, i) {
  var x = UL + i * uBw + uBw * 0.16, w = uBw * 0.68, o = {};
  o.bg = el('rect', { x: x, y: UT, width: w, height: uPlotH, rx: 3, fill: '#1c2531' }, us);
  o.r = el('rect', { x: x, y: UT + uPlotH, width: w, height: 0, rx: 3, fill: C.busy }, us);
  o.v = el('text', { x: x + w / 2, y: UT + uPlotH - 4, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700 }, us, '');
  el('text', { x: x + w / 2, y: UT + uPlotH + 16, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 600 }, us, cfg.code);
  el('text', { x: x + w / 2, y: UT + uPlotH + 30, 'text-anchor': 'middle', 'font-size': 10 }, us, cfg.id + '단계').style.fill = '#8b98a9';
  o.q = el('text', { x: x + w / 2, y: UT + uPlotH + 44, 'text-anchor': 'middle', 'font-size': 10 }, us, '');
  o.q.style.fill = '#8b98a9';
  o.x = x; o.w = w;
  return o;
});
function renderUtil() {
  var u = sim.util();
  for (var i = 0; i < N; i++) {
    var h = u[i] * uPlotH, o = uBars[i];
    o.r.setAttribute('y', UT + uPlotH - h); o.r.setAttribute('height', h);
    o.r.setAttribute('fill', i === sim.bottleneck ? C.fail : C.busy);
    o.v.textContent = Math.round(u[i] * 100) + '%';
    o.v.setAttribute('y', Math.min(UT + uPlotH - h - 4, UT + uPlotH - 4));
    o.q.textContent = '대기 ' + sim.stages[i].queue.length;
  }
}

// UPH 차트
var hs = $('uphSvg'), HL = 40, HR = 12, HT = 14, HB = 30, HW = 520, HH = 250;
var hPlotW = HW - HL - HR, hPlotH = HH - HT - HB;
var hGrid = el('g', null, hs);
var hArea = el('path', { fill: C.busy, 'fill-opacity': 0.18, stroke: 'none' }, hs);
var hLine = el('path', { fill: 'none', stroke: C.busy, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }, hs);
var hTarget = el('line', { stroke: C.waiting, 'stroke-width': 1.5, 'stroke-dasharray': '6 4' }, hs);
var hTargetLbl = el('text', { 'font-size': 11, 'font-weight': 700, 'text-anchor': 'end' }, hs, '');
hTargetLbl.style.fill = C.waiting;
var hDot = el('circle', { r: 4, fill: C.busy, stroke: '#fff', 'stroke-width': 1.5, opacity: 0 }, hs);
var hEmpty = el('text', { x: HL + hPlotW / 2, y: HT + hPlotH / 2, 'text-anchor': 'middle', 'font-size': 12 }, hs, '데이터 수집 중… (팔레트가 라인을 통과하면 표시)');
hEmpty.style.fill = '#8b98a9';
function renderUph() {
  var ser = sim.uphSeries, tgt = LN.targetUph, mx = tgt * 1.25, i;
  for (i = 0; i < ser.length; i++) mx = Math.max(mx, ser[i].v * 1.1);
  var step = mx > 200 ? 50 : mx > 100 ? 25 : 20;
  mx = Math.ceil(mx / step) * step;
  var gh = '';
  for (var v = 0; v <= mx; v += step) {
    var y = HT + hPlotH * (1 - v / mx);
    gh += '<line x1="' + HL + '" x2="' + (HW - HR) + '" y1="' + y + '" y2="' + y + '" stroke="#273140"/><text x="' + (HL - 6) + '" y="' + (y + 4) + '" text-anchor="end" font-size="10" fill="#8b98a9">' + v + '</text>';
  }
  var tEnd = Math.max(sim.t, 3600), tStart = tEnd - 3600;
  if (sim.t < 3600) { tStart = 0; tEnd = 3600; }
  else { tStart = sim.t - 3600; tEnd = sim.t; }
  // 시간축 라벨
  for (var m = 0; m <= 4; m++) {
    var tx = HL + hPlotW * m / 4;
    gh += '<text x="' + tx + '" y="' + (HH - 10) + '" text-anchor="' + (m === 0 ? 'start' : m === 4 ? 'end' : 'middle') + '" font-size="10" fill="#8b98a9">' + fmtT(tStart + (tEnd - tStart) * m / 4).slice(0, 5) + '</text>';
  }
  hGrid.innerHTML = gh;
  var ty = HT + hPlotH * (1 - tgt / mx);
  hTarget.setAttribute('x1', HL); hTarget.setAttribute('x2', HW - HR); hTarget.setAttribute('y1', ty); hTarget.setAttribute('y2', ty);
  hTargetLbl.setAttribute('x', HW - HR - 4); hTargetLbl.setAttribute('y', ty - 5); hTargetLbl.textContent = '목표 ' + tgt;
  var pts = ser.filter(function (p) { return p.v > 0; });
  hEmpty.setAttribute('opacity', pts.length > 1 ? 0 : 1);
  if (pts.length < 1) { hLine.setAttribute('d', ''); hArea.setAttribute('d', ''); hDot.setAttribute('opacity', 0); return; }
  var d = '', lx = 0, ly = 0;
  pts.forEach(function (p, j) {
    lx = HL + hPlotW * (p.t - tStart) / (tEnd - tStart); ly = HT + hPlotH * (1 - p.v / mx);
    d += (j ? 'L' : 'M') + lx.toFixed(1) + ',' + ly.toFixed(1);
  });
  var fx = HL + hPlotW * (pts[0].t - tStart) / (tEnd - tStart);
  hLine.setAttribute('d', d);
  hArea.setAttribute('d', d + 'L' + lx.toFixed(1) + ',' + (HT + hPlotH) + 'L' + fx.toFixed(1) + ',' + (HT + hPlotH) + 'Z');
  hDot.setAttribute('cx', lx); hDot.setAttribute('cy', ly); hDot.setAttribute('opacity', 1);
}

function renderKpi() {
  var done = sim.passed + sim.defects, uph = sim.uph(), tgt = LN.targetUph;
  kpiEls.spawned.v.textContent = sim.spawned;
  kpiEls.spawned.s.textContent = '투입 간격 ' + SIM.arrivalIntervalSec + '초';
  kpiEls.passed.v.textContent = sim.passed; kpiEls.passed.v.style.color = C.pass;
  kpiEls.passed.s.textContent = '최종 단계 통과';
  kpiEls.defects.v.textContent = sim.defects; kpiEls.defects.v.style.color = sim.defects ? C.fail : '';
  kpiEls.defects.s.textContent = '불량 확정(재검 후)';
  var y = done ? sim.passed / done * 100 : 100;
  kpiEls.yield.v.textContent = y.toFixed(1) + '%';
  kpiEls.yield.s.textContent = '통과 / (통과+불량)';
  kpiEls.yield.b.style.width = y + '%'; kpiEls.yield.b.style.background = y >= 95 ? C.pass : y >= 90 ? C.waiting : C.fail;
  kpiEls.uph.v.textContent = uph.toFixed(1);
  kpiEls.uph.v.style.color = sim.t < 120 ? '' : uph >= tgt ? C.pass : uph >= tgt * 0.9 ? C.waiting : C.fail;
  kpiEls.uph.s.textContent = '목표 ' + tgt + ' · ' + (tgt ? Math.round(uph / tgt * 100) : 0) + '%';
  kpiEls.uph.b.style.width = clamp(uph / tgt * 100, 0, 100) + '%';
  kpiEls.wip.v.textContent = sim.inflight();
  kpiEls.wip.s.textContent = '최대 ' + SIM.palletCount + '개';
  kpiEls.retests.v.textContent = sim.retests;
  kpiEls.retests.s.textContent = '최대 ' + SIM.maxRetest + '회/팔레트';
}
function renderBottleneck() {
  var b = $('bottleneck'), i = sim.bottleneck;
  if (i < 0) { b.className = 'bn'; b.textContent = sim.t < 180 ? '데이터 수집 중 (3분 이후 판정)' : '뚜렷한 병목 없음'; return; }
  var u = sim.util()[i], cfg = S[i];
  b.className = 'bn hot';
  b.innerHTML = '<b>' + cfg.id + '단계 · ' + cfg.name + '</b><br>가동률 ' + Math.round(u * 100) + '% · 대기열 ' + sim.stages[i].queue.length +
    '<br>이론 처리능력 ' + (cfg.testPcs * 3600 / cfg.cycleTimeSec).toFixed(0) + ' UPH (PC ' + cfg.testPcs + '대 / 사이클 ' + cfg.cycleTimeSec + '초)';
}
function renderLog() {
  if (!sim.logDirty) return;
  sim.logDirty = false;
  $('log').innerHTML = sim.log.map(function (l) {
    return '<li><time>' + fmtT(l.t) + '</time><span class="' + l.type + '">' + l.msg + '</span></li>';
  }).join('');
}
function renderDash() { renderKpi(); renderUtil(); renderUph(); renderBottleneck(); renderLog(); }

// =====================================================================
//  컨트롤 / 메인 루프
// =====================================================================
$('lineName').textContent = LN.name;
$('lineSub').textContent = LN.product + ' · ' + LN.shift + ' · 택타임 ' + LN.taktTimeSec + '초 · 목표 ' + LN.targetUph + ' UPH · 단계 ' + N + '개';
var speeds = [1, 2, 5, 10, 20, 50, 100];
if (speeds.indexOf(SIM.speed) < 0) { speeds.push(SIM.speed); speeds.sort(function (a, b) { return a - b; }); }
var selSpeed = $('selSpeed');
speeds.forEach(function (s) { var o = document.createElement('option'); o.value = s; o.textContent = '×' + s; selSpeed.appendChild(o); });
selSpeed.value = SIM.speed;
var speed = SIM.speed, playing = true, acc = 0, last = null, lastDash = 0;
selSpeed.onchange = function () { speed = +selSpeed.value; };
$('btnPlay').onclick = function () {
  playing = !playing;
  this.textContent = playing ? '⏸ 일시정지' : '▶ 재생';
  document.body.classList.toggle('paused', !playing);
};
$('btnReset').onclick = function () { sim.reset(); acc = 0; renderFlow(0); renderDash(); };

function frame(now) {
  if (last == null) last = now;
  var rd = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (playing) {
    acc += rd * speed;
    var guard = 4000;
    while (acc >= DT && guard--) { sim.step(); acc -= DT; }
    if (guard <= 0) acc = 0;
  }
  var rt = sim.t + (playing ? acc : 0);
  renderFlow(rt);
  $('clock').textContent = fmtT(sim.t);
  if (now - lastDash > 250) { lastDash = now; renderDash(); }
  requestAnimationFrame(frame);
}
renderFlow(0); renderDash();
requestAnimationFrame(frame);
})();
