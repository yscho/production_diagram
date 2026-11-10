/* AVN 검사라인 아이소메트릭 2.5D 뷰 — 라이브러리 없음, Canvas 2D, 클래식 스크립트 */
(function () {
  'use strict';

  var D = window.LINE_DATA;
  var errBox = document.getElementById('err');
  if (!D || !Array.isArray(D.stages) || !D.stages.length) {
    errBox.textContent = '데이터(../data/line.js)를 읽지 못했습니다. data/sync.sh 를 실행해 line.js 를 생성했는지 확인하세요.';
    errBox.hidden = false;
    return;
  }

  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ───────────── 데이터 정규화 ───────────── */
  var LINE = D.line || {};
  var SIMCFG = D.simulation || {};
  var SC = D.statusColors || {};
  var COL = {
    idle: SC.idle || '#9aa5b1', busy: SC.busy || '#2f80ed', pass: SC.pass || '#27ae60',
    fail: SC.fail || '#eb5757', waiting: SC.waiting || '#f2c94c', offline: SC.offline || '#4f4f4f'
  };
  var STATUS_LABEL = { idle: '유휴', busy: '검사 중', pass: '통과', fail: '불합격', waiting: '대기/정체', offline: '미배정' };

  var STAGES = D.stages.map(function (s, i) {
    return {
      id: s.id != null ? s.id : i + 1,
      code: s.code || '',
      name: s.name || ('단계 ' + (i + 1)),
      nameEn: s.nameEn || '',
      slots: Math.max(1, Math.round(num(s.palletSlots, 1))),
      pcs: Math.max(1, Math.round(num(s.testPcs, 1))),
      cycle: Math.max(0.5, num(s.cycleTimeSec, 30)),
      failRate: clamp(num(s.failRate, 0), 0, 1),
      items: Array.isArray(s.items) ? s.items : []
    };
  });
  var N = STAGES.length;
  var CFG = {
    speed: Math.max(0.1, num(SIMCFG.speed, 1)),
    palletCount: Math.max(1, Math.round(num(SIMCFG.palletCount, 20))),
    interval: Math.max(0.1, num(SIMCFG.arrivalIntervalSec, 45)),
    transfer: Math.max(0.1, num(SIMCFG.conveyorTransferSec, 6)),
    retestOn: SIMCFG.retestOnFail !== false,
    maxRetest: Math.max(0, Math.round(num(SIMCFG.maxRetest, 1))),
    seed: Math.round(num(SIMCFG.randomSeed, 1)) >>> 0,
    // 재검사 시 다시 불합격할 확률 (데이터에 없으면 모델 가정값 0.3)
    retestFailProb: clamp(num(SIMCFG.retestFailProb, 0.3), 0, 1),
    takt: num(LINE.taktTimeSec, 0),
    targetUph: num(LINE.targetUph, 0)
  };
  var HOLD = CFG.transfer * 0.5;     // 판정 표시·핸들링 시간(sim s)
  var LINGER = CFG.transfer * 2;     // 결과색 유지 후 유휴 전환까지(sim s)
  var DT = 0.025;                    // 고정 시뮬레이션 스텝(sim s) — 배속과 무관하게 결과 재현

  function hueOf(i) { return Math.round((200 + i * 360 / Math.max(1, N)) % 360); }

  /* ───────────── 의사난수 (mulberry32) ───────────── */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ───────────── 월드 레이아웃 (단위: 바닥 타일 1칸) ───────────── */
  var G = {
    SLOT_W: 1.3, SLOT_D: 1.3, SLOT_GAP: 0.35, SLOT_H: 0.35, SLOT_V: 0.35,
    PC_W: 0.95, PC_D: 0.75, PC_GAP: 0.55, PC_BACK: 0.45,
    NG_W: 0.9, NG_GAP: 0.45,
    PAD: 0.6, CELL_D: 4.3, CELL_GAP: 2.6,
    CONV_W: 1.3, CONV_Z: 0.35, CONV_OFF: 0.12, AISLE: 1.4,
    X_START: 0.8, CELL_X0: 3.2, TURN: 1.8, SP: 1.25
  };

  function makePath(pts) {
    var segs = [], s = 0;
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1];
      var dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      segs.push({ a: a, b: b, s0: s, len: len, ux: dx / len, uy: dy / len });
      s += len;
    }
    return { pts: pts, segs: segs, len: s };
  }
  function pathPoint(path, s) {
    var segs = path.segs;
    if (s <= 0) { var f = segs[0]; return [f.a[0] + f.ux * s, f.a[1] + f.uy * s]; }
    for (var i = 0; i < segs.length; i++) {
      var g = segs[i];
      if (s <= g.s0 + g.len || i === segs.length - 1) {
        var d = s - g.s0;
        return [g.a[0] + g.ux * d, g.a[1] + g.uy * d];
      }
    }
    return path.pts[path.pts.length - 1].slice();
  }

  function makeCell(i, x0, x1, dir, convMin, sAt) {
    var def = STAGES[i];
    var c = { i: i, def: def, dir: dir, x0: x0, x1: x1, y1: convMin - G.CONV_OFF, sAt: sAt, hue: hueOf(i) };
    c.y0 = c.y1 - G.CELL_D;
    c.cx = (x0 + x1) / 2; c.cy = (c.y0 + c.y1) / 2;
    function rect(u0, u1, v0, v1) {
      var r = dir > 0 ? { x0: x0 + u0, x1: x0 + u1 } : { x0: x1 - u1, x1: x1 - u0 };
      r.y0 = c.y1 - v1; r.y1 = c.y1 - v0;
      r.w = r.x1 - r.x0; r.d = r.y1 - r.y0;
      r.cx = (r.x0 + r.x1) / 2; r.cy = (r.y0 + r.y1) / 2;
      return r;
    }
    c.slots = [];
    for (var k = 0; k < def.slots; k++) {
      var u = G.PAD + k * (G.SLOT_W + G.SLOT_GAP);
      var r = rect(u, u + G.SLOT_W, G.SLOT_V, G.SLOT_V + G.SLOT_D);
      r.u = u + G.SLOT_W / 2;
      r.s = sAt(r.cx);
      r.pc = Math.min(def.pcs - 1, Math.floor(k * def.pcs / def.slots));
      c.slots.push(r);
    }
    c.pcs = [];
    for (var j = 0; j < def.pcs; j++) {
      var idx = [], usum = 0;
      c.slots.forEach(function (sl, kk) { if (sl.pc === j) { idx.push(kk); usum += sl.u; } });
      var uc = (def.pcs <= def.slots && idx.length) ? usum / idx.length
        : G.PAD + j * (G.PC_W + G.PC_GAP) + G.PC_W / 2;
      var pr = rect(uc - G.PC_W / 2, uc + G.PC_W / 2, G.CELL_D - G.PC_BACK - G.PC_D, G.CELL_D - G.PC_BACK);
      pr.slotIdx = idx;
      c.pcs.push(pr);
    }
    var slotsW = def.slots * (G.SLOT_W + G.SLOT_GAP) - G.SLOT_GAP;
    var nu = G.PAD + slotsW + G.NG_GAP;
    c.ng = rect(nu, nu + G.NG_W, G.SLOT_V + 0.2, G.SLOT_V + 0.2 + G.NG_W);
    c.ng.s = sAt(c.ng.cx);
    var sUp = sAt(dir > 0 ? x0 : x1), sDown = sAt(dir > 0 ? x1 : x0);
    c.sEntry = sUp + 0.6;
    c.sExit = sDown - 0.6;
    return c;
  }

  function buildLayout(mode) {
    var useU = mode === 'U' && N > 1;
    var widths = STAGES.map(function (s) {
      var slotsW = s.slots * (G.SLOT_W + G.SLOT_GAP) - G.SLOT_GAP;
      var pcsW = s.pcs * (G.PC_W + G.PC_GAP) - G.PC_GAP;
      return Math.max(slotsW + G.NG_GAP + G.NG_W, pcsW) + 2 * G.PAD;
    });
    var nA = useU ? Math.ceil(N / 2) : N;
    function rowLen(a, b) { var L = 0; for (var i = a; i < b; i++) L += widths[i] + (i > a ? G.CELL_GAP : 0); return L; }
    var lenA = rowLen(0, nA), lenB = rowLen(nA, N);
    var convA = 1 + G.CELL_D + G.CONV_OFF;
    var yA = convA + G.CONV_W / 2;
    var convB = convA + G.CONV_W + G.AISLE + G.CELL_D + G.CONV_OFF;
    var yB = convB + G.CONV_W / 2;
    var XS = G.X_START;
    var XR = G.CELL_X0 + Math.max(lenA, lenB) + G.TURN;
    var pts = useU ? [[XS, yA], [XR, yA], [XR, yB], [XS, yB]] : [[XS, yA], [XR, yA]];
    var path = makePath(pts);

    var cells = [], cur = G.CELL_X0, i;
    for (i = 0; i < nA; i++) {
      cells.push(makeCell(i, cur, cur + widths[i], 1, convA, function (x) { return x - XS; }));
      cur += widths[i] + G.CELL_GAP;
    }
    var baseB = (XR - XS) + (yB - yA);
    cur = XR - G.TURN;
    for (i = nA; i < N; i++) {
      cells.push(makeCell(i, cur - widths[i], cur, -1, convB, function (x) { return baseB + (XR - x); }));
      cur -= widths[i] + G.CELL_GAP;
    }
    cells.forEach(function (c, k) {
      var src = k === 0 ? 0 : cells[k - 1].sExit;
      c.maxQ = clamp(Math.floor((c.sEntry - src) / G.SP), 1, 4);
    });

    // 컨베이어 청크(깊이 정렬용 1칸 단위 조각)
    var chunks = [], hw = G.CONV_W / 2;
    function addChunk(ax, ay, bx, by, ux, uy, s0, len) {
      var px = -uy * hw, py = ux * hw;
      var xs = [ax + px, ax - px, bx + px, bx - px], ys = [ay + py, ay - py, by + py, by - py];
      var ch = {
        x0: Math.min.apply(null, xs), x1: Math.max.apply(null, xs),
        y0: Math.min.apply(null, ys), y1: Math.max.apply(null, ys),
        ax: ax, ay: ay, ux: ux, uy: uy, s0: s0, len: len, rails: len > 0
      };
      ch.cx = (ch.x0 + ch.x1) / 2; ch.cy = (ch.y0 + ch.y1) / 2;
      chunks.push(ch);
    }
    path.segs.forEach(function (g, gi) {
      var n = Math.max(1, Math.ceil(g.len));
      for (var k = 0; k < n; k++) {
        var a = g.len * k / n, b = g.len * (k + 1) / n;
        addChunk(g.a[0] + g.ux * a, g.a[1] + g.uy * a, g.a[0] + g.ux * b, g.a[1] + g.uy * b, g.ux, g.uy, g.s0 + a, b - a);
      }
      if (gi === 0) addChunk(g.a[0] - g.ux * 0.6, g.a[1] - g.uy * 0.6, g.a[0], g.a[1], g.ux, g.uy, -0.6, 0.6);
      if (gi === path.segs.length - 1) addChunk(g.b[0], g.b[1], g.b[0] + g.ux * 0.6, g.b[1] + g.uy * 0.6, g.ux, g.uy, path.len, 0.6);
      if (gi > 0) {
        var p = g.a;
        chunks.push({ x0: p[0] - hw, x1: p[0] + hw, y0: p[1] - hw, y1: p[1] + hw, cx: p[0], cy: p[1], rails: false, len: 0 });
      }
    });

    var start = path.pts[0], end = path.pts[path.pts.length - 1];
    var lastSeg = path.segs[path.segs.length - 1];
    var entryBox = { x0: start[0] - 2.4, x1: start[0] - 0.7, y0: start[1] - 0.85, y1: start[1] + 0.85, label: '투입', color: '#2b7a78' };
    var exitBox = lastSeg.ux < 0
      ? { x0: end[0] - 2.4, x1: end[0] - 0.7, y0: end[1] - 0.85, y1: end[1] + 0.85, label: '배출', color: '#6a4fa3' }
      : { x0: end[0] + 0.7, x1: end[0] + 2.4, y0: end[1] - 0.85, y1: end[1] + 0.85, label: '배출', color: '#6a4fa3' };

    var fx0 = Math.min(entryBox.x0, exitBox.x0) - 0.8;
    var fx1 = Math.max(XR + hw, exitBox.x1) + 1.0;
    var fy1 = (useU ? convB : convA) + G.CONV_W + 1.0;
    var floor = { x0: Math.floor(fx0), x1: Math.ceil(fx1), y0: 0, y1: Math.ceil(fy1) };

    return {
      mode: useU ? 'U' : 'line', cells: cells, path: path, chunks: chunks,
      entryBox: entryBox, exitBox: exitBox, floor: floor,
      vConv: path.len / (N + 1) / CFG.transfer
    };
  }

  /* ───────────── 시뮬레이션 ───────────── */
  var LY, S;
  var SLOT_KEY = {
    empty: null, loading: 'idle', waiting: 'waiting', testing: 'busy', pass: 'pass', done: 'pass',
    unloading: 'pass', blocked: 'waiting', failRetest: 'fail', failNg: 'fail', ngOut: 'fail'
  };

  function newSim() {
    S = {
      t: 0, rng: mulberry32(CFG.seed), nextArrival: 0, pallets: [], nextId: 1,
      input: 0, done: 0, ng: 0, retest: 0, failEvents: 0, fpyOk: 0, leadSum: 0, doneTimes: [],
      inputBlocked: false,
      st: LY.cells.map(function (c) {
        return {
          slots: c.slots.map(function () { return { state: 'empty', p: null, tReady: 0, since: 0 }; }),
          pcs: c.pcs.map(function (pr) {
            return { state: pr.slotIdx.length ? 'idle' : 'offline', slot: -1, tStart: 0, tEnd: 0, holdUntil: 0, busy: 0 };
          }),
          tested: 0, pass: 0, fail: 0, retest: 0, ng: 0, xfer: null
        };
      })
    };
  }

  function convPoint(s) { var p = pathPoint(LY.path, s); return [p[0], p[1], G.CONV_Z]; }
  function slotPoint(r) { return [r.cx, r.cy, G.SLOT_H]; }

  function startAnim(p, phase, pts, minDur) {
    var len = 0;
    for (var i = 1; i < pts.length; i++) {
      len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
    }
    p.phase = phase;
    p.anim = { pts: pts, len: len, t0: S.t, t1: S.t + Math.max(minDur || 0.6, len / LY.vConv) };
  }
  function animPos(a, t) {
    var f = clamp((t - a.t0) / (a.t1 - a.t0), 0, 1);
    var target = f * a.len, acc = 0, pts = a.pts;
    for (var i = 1; i < pts.length; i++) {
      var p = pts[i - 1], q = pts[i];
      var l = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
      if (acc + l >= target || i === pts.length - 1) {
        var g = l > 0 ? clamp((target - acc) / l, 0, 1) : 1;
        return [p[0] + (q[0] - p[0]) * g, p[1] + (q[1] - p[1]) * g, p[2] + (q[2] - p[2]) * g];
      }
      acc += l;
    }
    return pts[pts.length - 1];
  }

  function inboundCount(k) {
    var n = 0;
    for (var i = 0; i < S.pallets.length; i++) {
      var p = S.pallets[i];
      if (p.target === k && (p.phase === 'conv' || p.phase === 'toConv')) n++;
    }
    return n;
  }
  function convOccupied(a, b) {
    for (var i = 0; i < S.pallets.length; i++) {
      var p = S.pallets[i];
      if (p.phase === 'conv' && p.s >= a && p.s < b) return true;
    }
    return false;
  }
  function removePallet(p) {
    var i = S.pallets.indexOf(p);
    if (i >= 0) S.pallets.splice(i, 1);
  }

  function finishTest(i, j, t) {
    var st = S.st[i], def = LY.cells[i].def, pc = st.pcs[j], sl = st.slots[pc.slot], p = sl.p;
    var prob = p.stageRetest > 0 ? CFG.retestFailProb : def.failRate;
    var fail = S.rng() < prob;
    st.tested++;
    pc.state = fail ? 'fail' : 'pass';
    pc.holdUntil = t + HOLD;
    pc.slot = -1;
    sl.tReady = t + HOLD;
    if (!fail) { st.pass++; sl.state = 'pass'; p.last = 'pass'; return; }
    st.fail++; S.failEvents++; p.failCount++; p.last = 'fail';
    sl.state = (CFG.retestOn && p.stageRetest < CFG.maxRetest) ? 'failRetest' : 'failNg';
  }

  function step(dt) {
    var t = S.t, i, k, j, p;
    var cells = LY.cells, pallets = S.pallets;

    // 1) 투입
    S.inputBlocked = false;
    if (t >= S.nextArrival) {
      if (pallets.length < CFG.palletCount && inboundCount(0) < cells[0].maxQ && !convOccupied(-1, G.SP)) {
        pallets.push({ id: S.nextId++, phase: 'conv', target: 0, s: 0, tIn: t, failCount: 0, stageRetest: 0, last: null, stopped: false, anim: null, stage: -1, slot: -1 });
        S.input++;
        S.nextArrival = (t > S.nextArrival + dt ? t : S.nextArrival) + CFG.interval;
      } else {
        S.inputBlocked = true;
      }
    }

    // 2) 컨베이어 이동(대상 단계별 줄서기)
    var groups = [];
    for (k = 0; k <= N; k++) groups.push([]);
    for (i = 0; i < pallets.length; i++) if (pallets[i].phase === 'conv') groups[pallets[i].target].push(pallets[i]);
    for (k = 0; k <= N; k++) {
      var g = groups[k];
      if (!g.length) continue;
      g.sort(function (a, b) { return b.s - a.s; });
      var front = k < N ? cells[k].sEntry : LY.path.len;
      for (j = 0; j < g.length; j++) {
        p = g[j];
        var lim = front - j * G.SP;
        var ns = Math.min(p.s + LY.vConv * dt, lim);
        if (ns > p.s + 1e-9) { p.s = ns; p.stopped = false; } else { p.stopped = true; }
      }
      if (k === N) {
        for (j = 0; j < g.length; j++) {
          p = g[j];
          if (p.s >= LY.path.len - 1e-6) {
            removePallet(p);
            S.done++; S.leadSum += t - p.tIn; S.doneTimes.push(t);
            if (p.failCount === 0) S.fpyOk++;
          }
        }
      }
    }
    while (S.doneTimes.length && S.doneTimes[0] < t - 3600) S.doneTimes.shift();

    // 3) 이송 애니메이션 완료 처리
    for (i = pallets.length - 1; i >= 0; i--) {
      p = pallets[i];
      if (!p.anim || t < p.anim.t1) continue;
      var st = S.st[p.stage], sl = st.slots[p.slot];
      p.anim = null;
      if (p.phase === 'toSlot') {
        p.phase = 'slot'; sl.state = 'waiting'; sl.since = t; st.xfer = null;
      } else if (p.phase === 'toConv') {
        p.phase = 'conv'; p.s = cells[p.stage].sExit; p.stopped = false;
        sl.state = 'empty'; sl.p = null; st.xfer = null; p.stage = -1; p.slot = -1;
      } else if (p.phase === 'toNg') {
        sl.state = 'empty'; sl.p = null; st.xfer = null;
        st.ng++; S.ng++;
        pallets.splice(i, 1);
      }
    }

    // 4) 단계별 처리
    for (i = 0; i < N; i++) {
      var c = cells[i], S_ = S.st[i], def = c.def;

      for (j = 0; j < S_.pcs.length; j++) {
        var pc = S_.pcs[j];
        if (pc.state === 'busy') { pc.busy += dt; if (t >= pc.tEnd) finishTest(i, j, t); }
      }

      for (k = 0; k < S_.slots.length; k++) {
        var s1 = S_.slots[k];
        if (s1.state === 'pass' && t >= s1.tReady) { s1.state = 'done'; s1.since = t; }
        else if (s1.state === 'failRetest' && t >= s1.tReady) {
          s1.state = 'waiting'; s1.since = t; s1.p.stageRetest++; S_.retest++; S.retest++;
        } else if (s1.state === 'failNg' && t >= s1.tReady && !S_.xfer) {
          var r = c.slots[k];
          s1.state = 'ngOut'; S_.xfer = s1.p;
          startAnim(s1.p, 'toNg', [slotPoint(r), convPoint(r.s), convPoint(c.ng.s), [c.ng.cx, c.ng.cy, 0.62]], 1.0);
        }
      }

      for (j = 0; j < S_.pcs.length; j++) {
        var pc2 = S_.pcs[j];
        if (pc2.state === 'busy' || pc2.state === 'offline' || t < pc2.holdUntil) continue;
        var best = -1, grp = c.pcs[j].slotIdx;
        for (var q = 0; q < grp.length; q++) {
          var sq = S_.slots[grp[q]];
          if (sq.state === 'waiting' && (best < 0 || sq.since < S_.slots[best].since)) best = grp[q];
        }
        if (best >= 0) {
          S_.slots[best].state = 'testing';
          pc2.state = 'busy'; pc2.slot = best; pc2.tStart = t;
          pc2.tEnd = t + def.cycle * (0.9 + 0.2 * S.rng());
        } else if ((pc2.state === 'pass' || pc2.state === 'fail') && t >= pc2.holdUntil + LINGER) {
          pc2.state = 'idle';
        }
      }

      // 배출(다음 단계로)
      if (!S_.xfer) {
        var cand = -1;
        for (k = 0; k < S_.slots.length; k++) {
          var sd = S_.slots[k];
          if ((sd.state === 'done' || sd.state === 'blocked') && (cand < 0 || sd.since < S_.slots[cand].since)) cand = k;
        }
        if (cand >= 0) {
          var ok = (i === N - 1 || inboundCount(i + 1) < cells[i + 1].maxQ) &&
                   !convOccupied(c.sExit - G.SP * 0.5, c.sExit + G.SP);
          if (ok) {
            var sc = S_.slots[cand], rc = c.slots[cand];
            sc.state = 'unloading'; S_.xfer = sc.p;
            sc.p.target = i + 1;
            startAnim(sc.p, 'toConv', [slotPoint(rc), convPoint(rc.s), convPoint(c.sExit)]);
          } else {
            for (k = 0; k < S_.slots.length; k++) if (S_.slots[k].state === 'done') S_.slots[k].state = 'blocked';
          }
        }
      }

      // 적재(대기열 선두 → 빈 슬롯)
      if (!S_.xfer) {
        var head = null, gq = groups[i];
        for (k = 0; k < gq.length; k++) if (gq[k].phase === 'conv' && (!head || gq[k].s > head.s)) head = gq[k];
        if (head && head.s >= c.sEntry - 0.02) {
          var pick = -1, pickLoad = 1e9;
          for (k = 0; k < S_.slots.length; k++) {
            if (S_.slots[k].state !== 'empty') continue;
            var pcIdx = c.slots[k].pc, load = 0;
            for (var m = 0; m < S_.slots.length; m++) if (c.slots[m].pc === pcIdx && S_.slots[m].state !== 'empty') load++;
            if (load < pickLoad) { pickLoad = load; pick = k; }
          }
          if (pick >= 0) {
            var sp = S_.slots[pick], rp = c.slots[pick];
            sp.state = 'loading'; sp.p = head; S_.xfer = head;
            head.stage = i; head.slot = pick; head.stageRetest = 0;
            startAnim(head, 'toSlot', [convPoint(head.s), convPoint(rp.s), slotPoint(rp)]);
          }
        }
      }
    }

    S.t = t + dt;
  }

  function palletKey(p) {
    if (p.phase === 'conv') return p.stopped ? 'waiting' : (p.last === 'pass' ? 'pass' : 'idle');
    var sl = S.st[p.stage] && S.st[p.stage].slots[p.slot];
    return (sl && SLOT_KEY[sl.state]) || 'idle';
  }
  function palletPos(p) {
    if (p.anim) return animPos(p.anim, S.t);
    if (p.phase === 'slot') return slotPoint(LY.cells[p.stage].slots[p.slot]);
    return convPoint(p.s);
  }

  /* ───────────── 렌더링 ───────────── */
  var canvas = document.getElementById('view');
  var ctx = canvas.getContext('2d');
  var stageEl = document.getElementById('stage');
  var VW = 0, VH = 0, DPR = 1;
  var V = { u: 20, ox: 0, oy: 0 };
  var ZK = 1.2;
  var hover = -1, stripHover = -1;

  function P(x, y, z) { return [V.ox + (x - y) * V.u, V.oy + (x + y) * V.u * 0.5 - z * V.u * ZK]; }

  var shadeCache = {};
  function shade(hex, f) {
    var key = hex + f;
    if (shadeCache[key]) return shadeCache[key];
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
    function m(v) { return Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f)); }
    return (shadeCache[key] = 'rgb(' + m(r) + ',' + m(g) + ',' + m(b) + ')');
  }

  function poly(pts, fill, stroke, lw) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
  }
  function line3(a, b, col, lw) {
    var p = P(a[0], a[1], a[2]), q = P(b[0], b[1], b[2]);
    ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]);
    ctx.strokeStyle = col; ctx.lineWidth = lw || 1; ctx.stroke();
  }
  function topQuad(x0, y0, x1, y1, z) { return [P(x0, y0, z), P(x1, y0, z), P(x1, y1, z), P(x0, y1, z)]; }
  function faceY(x0, x1, y, z0, z1) { return [P(x0, y, z0), P(x1, y, z0), P(x1, y, z1), P(x0, y, z1)]; }
  function faceX(x, y0, y1, z0, z1) { return [P(x, y0, z0), P(x, y1, z0), P(x, y1, z1), P(x, y0, z1)]; }

  function box(x0, y0, z0, w, d, h, col, edge) {
    var x1 = x0 + w, y1 = y0 + d, z1 = z0 + h, e = edge === undefined ? 'rgba(0,0,0,0.35)' : edge;
    poly(faceY(x0, x1, y1, z0, z1), col, e, 0.6);
    poly(faceX(x1, y0, y1, z0, z1), shade(col, -0.28), e, 0.6);
    poly(topQuad(x0, y0, x1, y1, z1), shade(col, 0.14), e, 0.6);
  }

  function drawFloor() {
    var f = LY.floor;
    poly(topQuad(f.x0, f.y0, f.x1, f.y1, 0), '#152033', '#24324b', 1);
    for (var x = f.x0; x <= f.x1; x++) {
      line3([x, f.y0, 0], [x, f.y1, 0], x % 5 === 0 ? 'rgba(148,170,200,0.12)' : 'rgba(148,170,200,0.05)', 1);
    }
    for (var y = f.y0; y <= f.y1; y++) {
      line3([f.x0, y, 0], [f.x1, y, 0], y % 5 === 0 ? 'rgba(148,170,200,0.12)' : 'rgba(148,170,200,0.05)', 1);
    }
  }

  function drawPlate(c) {
    var hl = c.i === hover || c.i === stripHover;
    poly(topQuad(c.x0, c.y0, c.x1, c.y1, 0.01),
      'hsla(' + c.hue + ',40%,38%,' + (hl ? 0.42 : 0.22) + ')',
      'hsla(' + c.hue + ',60%,' + (hl ? '75%' : '55%') + ',' + (hl ? 1 : 0.55) + ')', hl ? 2 : 1);
    // 작업 영역 안전선
    poly(topQuad(c.x0 + 0.15, c.y1 - 0.12, c.x1 - 0.15, c.y1 - 0.05, 0.015), 'rgba(242,201,76,0.35)');
  }

  function drawCables(c) {
    var st = S.st[c.i];
    c.pcs.forEach(function (pr, j) {
      var key = st.pcs[j].state, col = key === 'busy' ? COL.busy : key === 'offline' ? COL.offline : 'rgba(150,170,195,0.35)';
      pr.slotIdx.forEach(function (k) {
        var sr = c.slots[k];
        line3([pr.cx, pr.y1, 0.02], [sr.cx, sr.y0, 0.02], col, key === 'busy' ? 1.6 : 1);
      });
    });
  }

  function drawChunk(ch) {
    box(ch.x0, ch.y0, 0, ch.x1 - ch.x0, ch.y1 - ch.y0, G.CONV_Z, '#2f3743', 'rgba(0,0,0,0.25)');
    var z = G.CONV_Z + 0.001;
    poly(topQuad(ch.x0 + 0.08, ch.y0 + 0.08, ch.x1 - 0.08, ch.y1 - 0.08, z), '#262c35');
    if (!ch.rails) return;
    var hw = G.CONV_W / 2 - 0.1, px = -ch.uy * hw, py = ch.ux * hw;
    var bx = ch.ax + ch.ux * ch.len, by = ch.ay + ch.uy * ch.len;
    // 움직이는 롤러 줄무늬(시뮬레이션 시간 기준)
    var STEP = 0.5, phase = (S.t * LY.vConv) % STEP;
    var d = ((phase - ch.s0) % STEP + STEP) % STEP;
    for (; d < ch.len; d += STEP) {
      var cx = ch.ax + ch.ux * d, cy = ch.ay + ch.uy * d;
      line3([cx + px, cy + py, z], [cx - px, cy - py, z], 'rgba(120,135,155,0.45)', 1);
    }
    line3([ch.ax + px, ch.ay + py, z + 0.03], [bx + px, by + py, z + 0.03], '#7b8796', 1.2);
    line3([ch.ax - px, ch.ay - py, z + 0.03], [bx - px, by - py, z + 0.03], '#7b8796', 1.2);
  }

  function drawSlot(c, k) {
    var r = c.slots[k], sl = S.st[c.i].slots[k];
    box(r.x0, r.y0, 0, r.w, r.d, G.SLOT_H, '#56637a');
    var key = SLOT_KEY[sl.state];
    var z = G.SLOT_H + 0.002;
    poly(topQuad(r.x0 + 0.09, r.y0 + 0.09, r.x1 - 0.09, r.y1 - 0.09, z), key ? null : 'rgba(20,28,40,0.35)', key ? COL[key] : 'rgba(160,175,195,0.35)', key ? 2 : 1);
    // 지그 핀
    poly(topQuad(r.x0 + 0.14, r.y0 + 0.14, r.x0 + 0.26, r.y0 + 0.26, z), '#c7cfdb');
    poly(topQuad(r.x1 - 0.26, r.y1 - 0.26, r.x1 - 0.14, r.y1 - 0.14, z), '#c7cfdb');
  }

  function drawPC(c, j) {
    var r = c.pcs[j], pc = S.st[c.i].pcs[j], key = pc.state;
    var colr = COL[key] || COL.idle;
    box(r.x0, r.y0, 0, r.w, r.d, 0.85, '#3a4352');
    poly(faceY(r.x0 + 0.12, r.x0 + 0.42, r.y1, 0.66, 0.74), colr);
    poly(faceY(r.x0 + 0.12, r.x1 - 0.12, r.y1, 0.2, 0.24), 'rgba(0,0,0,0.35)');
    poly(faceY(r.x0 + 0.12, r.x1 - 0.12, r.y1, 0.32, 0.36), 'rgba(0,0,0,0.35)');
    box(r.cx - 0.07, r.y1 - 0.32, 0.85, 0.14, 0.12, 0.18, '#242a33');
    var my0 = r.y1 - 0.24, my1 = r.y1 - 0.12, mz0 = 1.02, mz1 = 1.66;
    box(r.x0 + 0.03, my0, mz0, r.w - 0.06, my1 - my0, mz1 - mz0, '#1a1f27');
    var sx0 = r.x0 + 0.1, sx1 = r.x1 - 0.1, sz0 = mz0 + 0.07, sz1 = mz1 - 0.07;
    if (key === 'busy') {
      poly(faceY(sx0, sx1, my1 + 0.001, sz0, sz1), shade(COL.busy, -0.45));
      var f = clamp((S.t - pc.tStart) / Math.max(0.001, pc.tEnd - pc.tStart), 0, 1);
      poly(faceY(sx0, sx0 + (sx1 - sx0) * f, my1 + 0.002, sz0, sz0 + (sz1 - sz0) * 0.28), COL.busy);
      poly(faceY(sx0 + 0.06, sx1 - 0.06, my1 + 0.002, sz0 + (sz1 - sz0) * 0.45, sz1 - 0.06), shade(COL.busy, -0.15));
    } else if (key === 'idle' || key === 'offline') {
      poly(faceY(sx0, sx1, my1 + 0.001, sz0, sz1), shade(colr, -0.55));
    } else {
      poly(faceY(sx0, sx1, my1 + 0.001, sz0, sz1), colr);
    }
  }

  function drawNg(c) {
    var r = c.ng;
    box(r.x0, r.y0, 0, r.w, r.d, 0.55, '#7a2f37');
    poly(topQuad(r.x0 + 0.1, r.y0 + 0.1, r.x1 - 0.1, r.y1 - 0.1, 0.551), '#2a1216');
  }

  function drawPallet(p) {
    var pos = palletPos(p), x = pos[0], y = pos[1], z = pos[2];
    var key = palletKey(p);
    box(x - 0.5, y - 0.5, z, 1.0, 1.0, 0.12, '#8b7454');
    box(x - 0.38, y - 0.3, z + 0.12, 0.76, 0.6, 0.2, '#262b33');
    poly(topQuad(x - 0.32, y - 0.24, x + 0.32, y + 0.24, z + 0.321), COL[key] || COL.idle);
    if (p.failCount > 0) poly(topQuad(x + 0.2, y - 0.46, x + 0.44, y - 0.36, z + 0.121), COL.fail);
  }

  function drawStation(b) {
    box(b.x0, b.y0, 0, b.x1 - b.x0, b.y1 - b.y0, 0.75, b.color);
    poly(topQuad(b.x0 + 0.2, b.y0 + 0.2, b.x1 - 0.2, b.y1 - 0.2, 0.751), shade(b.color, -0.3));
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }

  var FONT = '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';
  function fs() { return clamp(V.u * 0.6, 11, 15); }
  function fs2() { return Math.max(10, fs() - 2); }

  function drawCellLabel(c) {
    var st = S.st[c.i], def = c.def, f = fs();
    var a = P(c.cx, c.y0 + 0.4, 2.35);
    var t1 = (def.code ? def.code + '  ' : '') + def.name;
    var used = st.slots.filter(function (s) { return s.state !== 'empty'; }).length;
    var busy = st.pcs.filter(function (s) { return s.state === 'busy'; }).length;
    var t2 = '슬롯 ' + used + '/' + def.slots + ' · PC ' + busy + '/' + def.pcs + ' · CT ' + def.cycle + 's';
    ctx.font = '700 ' + f + 'px ' + FONT;
    var w1 = ctx.measureText(t1).width;
    ctx.font = '500 ' + fs2() + 'px ' + FONT;
    var w2 = ctx.measureText(t2).width;
    var bd = f + 6, pad = 6;
    var w = Math.max(w1 + bd + 6, w2) + pad * 2, h = f * 2 + 12;
    var x = a[0] - w / 2, y = a[1] - h;
    var hl = c.i === hover || c.i === stripHover;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(a[0], a[1] + 8);
    ctx.strokeStyle = 'hsla(' + c.hue + ',60%,65%,0.7)'; ctx.lineWidth = 1; ctx.stroke();
    roundRect(x, y, w, h, 6);
    ctx.fillStyle = hl ? 'rgba(30,45,75,0.95)' : 'rgba(12,19,33,0.82)'; ctx.fill();
    ctx.strokeStyle = 'hsla(' + c.hue + ',60%,62%,' + (hl ? 1 : 0.7) + ')'; ctx.lineWidth = hl ? 2 : 1; ctx.stroke();
    ctx.beginPath(); ctx.arc(x + pad + bd / 2, y + 5 + f / 2 + 1, bd / 2, 0, Math.PI * 2);
    ctx.fillStyle = 'hsl(' + c.hue + ',65%,62%)'; ctx.fill();
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.fillStyle = '#0b1220'; ctx.font = '800 ' + (f - 1) + 'px ' + FONT;
    ctx.fillText(String(def.id), x + pad + bd / 2, y + 5 + f / 2 + 1);
    ctx.textAlign = 'left'; ctx.fillStyle = '#f1f5f9'; ctx.font = '700 ' + f + 'px ' + FONT;
    ctx.fillText(t1, x + pad + bd + 6, y + 5 + f / 2 + 1);
    ctx.fillStyle = '#9fb0c3'; ctx.font = '500 ' + fs2() + 'px ' + FONT;
    ctx.fillText(t2, x + pad, y + 8 + f * 1.5);

    if (st.ng > 0) {
      var b = P(c.ng.cx, c.ng.cy, 0.9);
      var tx = 'NG ' + st.ng;
      ctx.font = '700 ' + fs2() + 'px ' + FONT;
      var tw = ctx.measureText(tx).width + 8;
      roundRect(b[0] - tw / 2, b[1] - f / 2 - 2, tw, f + 2, 4);
      ctx.fillStyle = COL.fail; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
      ctx.fillText(tx, b[0], b[1]);
    }
  }

  function drawStationLabel(b, text2) {
    var f = fs();
    var a = P((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, 1.3);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '700 ' + f + 'px ' + FONT;
    ctx.fillStyle = '#e2e8f0'; ctx.fillText(b.label, a[0], a[1] - f * 0.6);
    ctx.font = '500 ' + fs2() + 'px ' + FONT;
    ctx.fillStyle = '#9fb0c3'; ctx.fillText(text2, a[0], a[1] + f * 0.6);
  }

  function computeHits() {
    LY.cells.forEach(function (c) {
      var h = 2.0;
      c.hit = [P(c.x0, c.y0, h), P(c.x1, c.y0, h), P(c.x1, c.y0, 0), P(c.x1, c.y1, 0), P(c.x0, c.y1, 0), P(c.x0, c.y1, h)];
    });
  }

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, VW, VH);
    var bg = ctx.createRadialGradient(VW / 2, VH * 0.4, 50, VW / 2, VH * 0.5, Math.max(VW, VH));
    bg.addColorStop(0, '#111c30'); bg.addColorStop(1, '#070d18');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, VW, VH);

    drawFloor();
    LY.cells.forEach(function (c) { drawPlate(c); drawCables(c); });

    var list = [];
    LY.chunks.forEach(function (ch) { list.push({ d: ch.cx + ch.cy, f: drawChunk, a: ch }); });
    LY.cells.forEach(function (c) {
      c.slots.forEach(function (r, k) { list.push({ d: r.cx + r.cy, f: drawSlot, a: c, b: k }); });
      c.pcs.forEach(function (r, j) { list.push({ d: r.cx + r.cy, f: drawPC, a: c, b: j }); });
      list.push({ d: c.ng.cx + c.ng.cy, f: drawNg, a: c });
    });
    [LY.entryBox, LY.exitBox].forEach(function (b) {
      list.push({ d: (b.x0 + b.x1) / 2 + (b.y0 + b.y1) / 2, f: drawStation, a: b });
    });
    S.pallets.forEach(function (p) {
      var pos = palletPos(p);
      list.push({ d: pos[0] + pos[1] + 1.05, f: drawPallet, a: p });
    });
    list.sort(function (a, b) { return a.d - b.d; });
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (it.b !== undefined) it.f(it.a, it.b); else it.f(it.a);
    }

    LY.cells.forEach(drawCellLabel);
    drawStationLabel(LY.entryBox, '팔레트 ' + S.pallets.length + '/' + CFG.palletCount + (S.inputBlocked && S.t > 0 ? ' · 대기' : ''));
    drawStationLabel(LY.exitBox, '양품 ' + S.done);
    computeHits();
  }

  /* ───────────── 뷰 맞춤/확대/이동 ───────────── */
  function fit() {
    var f = LY.floor, pts = [];
    [[f.x0, f.y0], [f.x1, f.y0], [f.x1, f.y1], [f.x0, f.y1]].forEach(function (q) {
      pts.push([q[0] - q[1], (q[0] + q[1]) * 0.5]);
      pts.push([q[0] - q[1], (q[0] + q[1]) * 0.5 - 3.2 * ZK]);
    });
    var minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    pts.forEach(function (p) { minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]); miny = Math.min(miny, p[1]); maxy = Math.max(maxy, p[1]); });
    var pad = 24;
    V.u = Math.max(2, Math.min((VW - pad * 2) / (maxx - minx), (VH - pad * 2) / (maxy - miny)));
    V.ox = (VW - (maxx - minx) * V.u) / 2 - minx * V.u;
    V.oy = (VH - (maxy - miny) * V.u) / 2 - miny * V.u;
  }

  function resize() {
    var r = stageEl.getBoundingClientRect();
    DPR = window.devicePixelRatio || 1;
    VW = Math.max(1, r.width); VH = Math.max(1, r.height);
    canvas.width = Math.round(VW * DPR); canvas.height = Math.round(VH * DPR);
    fit();
  }

  function pointInPoly(x, y, pts) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  var tip = document.getElementById('tip');
  var mouse = { x: 0, y: 0, down: false, lx: 0, ly: 0, moved: false };

  function hitTest(x, y) {
    if (!LY.cells[0].hit) return -1;
    var order = LY.cells.slice().sort(function (a, b) { return (b.cx + b.cy) - (a.cx + a.cy); });
    for (var i = 0; i < order.length; i++) if (pointInPoly(x, y, order[i].hit)) return order[i].i;
    return -1;
  }

  function fmtPct(v, d) { return (v * 100).toFixed(d == null ? 1 : d) + '%'; }
  function chip(key, text) {
    return '<span class="chip" style="background:' + (COL[key] || '#3a4352') + (key ? '' : ';color:#cbd5e1') + '">' + esc(text) + '</span>';
  }

  function tipHtml(i) {
    var c = LY.cells[i], def = c.def, st = S.st[i];
    var used = st.slots.filter(function (s) { return s.state !== 'empty'; }).length;
    var busy = st.pcs.filter(function (s) { return s.state === 'busy'; }).length;
    var queued = S.pallets.filter(function (p) { return p.phase === 'conv' && p.target === i; }).length;
    var busyT = st.pcs.reduce(function (a, p) { return a + p.busy; }, 0);
    var util = S.t > 0 ? busyT / (S.t * def.pcs) : 0;
    var cap = def.pcs * 3600 / def.cycle;
    var h = '';
    h += '<div class="tt-h"><span class="badge" style="background:hsl(' + c.hue + ',65%,62%)">' + esc(def.id) + '</span>' +
      esc(def.code) + ' · ' + esc(def.name) + '</div>';
    h += '<div class="tt-sub">' + esc(def.nameEn) + '</div>';
    h += '<table>';
    h += '<tr><td>사이클 타임</td><td>' + def.cycle + ' s' + (CFG.takt ? ' (택트 ' + CFG.takt + ' s)' : '') + '</td></tr>';
    h += '<tr><td>설정 불량률</td><td>' + fmtPct(def.failRate) + '</td></tr>';
    h += '<tr><td>팔레트 슬롯</td><td>' + def.slots + '개 (사용 ' + used + ')</td></tr>';
    h += '<tr><td>검사 PC</td><td>' + def.pcs + '대 (검사 중 ' + busy + ')</td></tr>';
    h += '<tr><td>이론 능력</td><td>' + cap.toFixed(1) + ' UPH</td></tr>';
    h += '<tr><td>컨베이어 대기</td><td>' + queued + ' / 최대 ' + c.maxQ + '</td></tr>';
    h += '<tr><td>검사 / 통과 / Fail</td><td>' + st.tested + ' / ' + st.pass + ' / ' + st.fail + '</td></tr>';
    h += '<tr><td>재검사 / 최종 NG</td><td>' + st.retest + ' / ' + st.ng + '</td></tr>';
    h += '<tr><td>PC 가동률</td><td>' + fmtPct(util) + '</td></tr>';
    h += '</table>';
    h += '<div class="tt-sec">슬롯 상태</div><div class="chips">' + st.slots.map(function (s, k) {
      var key = SLOT_KEY[s.state];
      return chip(key, 'S' + (k + 1) + '→PC' + (c.slots[k].pc + 1) + ' ' + (key ? STATUS_LABEL[key] : '비어있음'));
    }).join('') + '</div>';
    h += '<div class="tt-sec">PC 상태</div><div class="chips">' + st.pcs.map(function (p, j) {
      var extra = p.state === 'busy' ? ' ' + Math.round(clamp((S.t - p.tStart) / (p.tEnd - p.tStart), 0, 1) * 100) + '%' : '';
      return chip(p.state, 'PC' + (j + 1) + ' ' + STATUS_LABEL[p.state] + extra);
    }).join('') + '</div>';
    if (def.items.length) {
      h += '<div class="tt-sec">검사 항목</div><div class="chips">' + def.items.map(function (it) {
        return '<span class="item">' + esc(it) + '</span>';
      }).join('') + '</div>';
    }
    return h;
  }

  function placeTip() {
    if (hover < 0) { tip.hidden = true; return; }
    tip.innerHTML = tipHtml(hover);
    tip.hidden = false;
    var tw = tip.offsetWidth, th = tip.offsetHeight;
    var x = mouse.x + 16, y = mouse.y + 16;
    if (x + tw > VW - 6) x = mouse.x - tw - 16;
    if (y + th > VH - 6) y = VH - th - 6;
    tip.style.left = Math.max(6, x) + 'px';
    tip.style.top = Math.max(6, y) + 'px';
  }

  canvas.addEventListener('mousemove', function (e) {
    var r = canvas.getBoundingClientRect();
    mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
    if (mouse.down) {
      var dx = mouse.x - mouse.lx, dy = mouse.y - mouse.ly;
      if (Math.abs(dx) + Math.abs(dy) > 2) mouse.moved = true;
      V.ox += dx; V.oy += dy; mouse.lx = mouse.x; mouse.ly = mouse.y;
      hover = -1; placeTip();
      return;
    }
    hover = hitTest(mouse.x, mouse.y);
    canvas.classList.toggle('hovering', hover >= 0);
    placeTip();
  });
  canvas.addEventListener('mouseleave', function () { hover = -1; mouse.down = false; canvas.classList.remove('dragging'); placeTip(); });
  canvas.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    mouse.down = true; mouse.moved = false; mouse.lx = mouse.x; mouse.ly = mouse.y;
    canvas.classList.add('dragging');
  });
  window.addEventListener('mouseup', function () { mouse.down = false; canvas.classList.remove('dragging'); });
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    var r = canvas.getBoundingClientRect();
    var mx = e.clientX - r.left, my = e.clientY - r.top;
    var f = Math.exp(-e.deltaY * 0.0015);
    var nu = clamp(V.u * f, 2, 200);
    f = nu / V.u;
    V.ox = mx - (mx - V.ox) * f; V.oy = my - (my - V.oy) * f; V.u = nu;
    placeTip();
  }, { passive: false });
  canvas.addEventListener('dblclick', function () { fit(); });

  /* ───────────── UI: 헤더/컨트롤/KPI ───────────── */
  document.getElementById('lineName').textContent = (LINE.name || 'AVN 검사 라인') + ' · 아이소메트릭 2.5D';
  document.title = (LINE.name || 'AVN 검사 라인') + ' · 아이소메트릭';
  document.getElementById('lineMeta').textContent = [
    LINE.product, LINE.shift,
    CFG.takt ? '택트 ' + CFG.takt + 's' : null,
    CFG.targetUph ? '목표 ' + CFG.targetUph + ' UPH' : null,
    N + '개 공정', '시드 ' + CFG.seed
  ].filter(Boolean).join(' · ');

  var legend = document.getElementById('legend');
  ['idle', 'busy', 'pass', 'fail', 'waiting', 'offline'].forEach(function (k) {
    var s = document.createElement('span');
    s.innerHTML = '<i style="background:' + COL[k] + '"></i>' + STATUS_LABEL[k];
    legend.appendChild(s);
  });

  var playing = true, speed = CFG.speed;
  var btnPlay = document.getElementById('btnPlay');
  function setPlaying(v) { playing = v; btnPlay.textContent = v ? '⏸ 일시정지' : '▶ 재생'; }
  btnPlay.addEventListener('click', function () { setPlaying(!playing); });
  window.addEventListener('keydown', function (e) {
    if (e.code === 'Space' && e.target.tagName !== 'SELECT' && e.target.tagName !== 'BUTTON') { e.preventDefault(); setPlaying(!playing); }
  });

  var speedSel = document.getElementById('speed');
  var speeds = [1, 2, 5, 10, 20, 50, 100];
  if (speeds.indexOf(CFG.speed) < 0) speeds.push(CFG.speed);
  speeds.sort(function (a, b) { return a - b; }).forEach(function (v) {
    var o = document.createElement('option');
    o.value = String(v); o.textContent = v + '배속' + (v === CFG.speed ? ' (기본)' : '');
    if (v === CFG.speed) o.selected = true;
    speedSel.appendChild(o);
  });
  speedSel.addEventListener('change', function () { speed = parseFloat(speedSel.value) || CFG.speed; });

  var layoutSel = document.getElementById('layout');
  if (N < 2) layoutSel.disabled = true;
  layoutSel.addEventListener('change', function () { init(layoutSel.value); });
  document.getElementById('btnReset').addEventListener('click', function () { newSim(); acc = 0; updateKpi(true); });
  document.getElementById('btnFit').addEventListener('click', fit);

  var KPI_DEF = [
    ['time', '시뮬레이션 시간'], ['input', '투입'], ['done', '양품 완료'], ['ng', '불량(NG)'],
    ['retest', '재검사'], ['yield', '수율'], ['uph', 'UPH'], ['wip', 'WIP 팔레트'], ['lead', '평균 리드타임'], ['bn', '병목 공정']
  ];
  var kpiEls = {};
  var cardsEl = document.getElementById('kpiCards');
  KPI_DEF.forEach(function (d) {
    var el = document.createElement('div');
    el.className = 'kpi';
    el.innerHTML = '<div class="k">' + d[1] + '</div><div class="v">-</div><div class="s">&nbsp;</div>';
    cardsEl.appendChild(el);
    kpiEls[d[0]] = { root: el, v: el.querySelector('.v'), s: el.querySelector('.s') };
  });
  function setKpi(id, v, s, cls) {
    var e = kpiEls[id];
    e.v.textContent = v; e.s.textContent = s || '\u00a0';
    e.root.className = 'kpi' + (cls ? ' ' + cls : '');
  }

  var strip = document.getElementById('stageStrip');
  var stripEls = [];
  function buildStrip() {
    strip.innerHTML = '';
    stripEls = STAGES.map(function (def, i) {
      var el = document.createElement('div');
      el.className = 'st-item';
      el.innerHTML = '<div class="row"><span><b>' + esc(def.id) + '</b> ' + esc(def.code || def.name) + '</span><span class="u">0%</span></div>' +
        '<div class="bar"><i style="background:hsl(' + hueOf(i) + ',65%,60%)"></i></div>' +
        '<div class="row"><span class="sl">슬롯 0/' + def.slots + '</span><span class="ng">NG 0</span></div>';
      el.title = def.name;
      el.addEventListener('mouseenter', function () { stripHover = i; });
      el.addEventListener('mouseleave', function () { stripHover = -1; });
      strip.appendChild(el);
      return { root: el, u: el.querySelector('.u'), bar: el.querySelector('.bar > i'), sl: el.querySelector('.sl'), ng: el.querySelector('.ng') };
    });
  }

  function hms(t) {
    t = Math.floor(t);
    var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  var lastKpi = 0;
  function updateKpi(force) {
    var now = performance.now();
    if (!force && now - lastKpi < 200) return;
    lastKpi = now;
    var t = S.t;
    setKpi('time', hms(t), speed + '배속 · ' + (playing ? '재생 중' : '일시정지'));
    setKpi('input', String(S.input), '투입 간격 ' + CFG.interval + 's' + (S.inputBlocked && t > 0 ? ' · 투입 대기' : ''));
    setKpi('done', String(S.done), '누적 양품', 'good');
    setKpi('ng', String(S.ng), 'Fail 발생 ' + S.failEvents + '회', S.ng ? 'bad' : '');
    setKpi('retest', String(S.retest), CFG.retestOn ? '최대 ' + CFG.maxRetest + '회/공정' : '재검사 미사용');
    var fin = S.done + S.ng;
    setKpi('yield', fin ? fmtPct(S.done / fin) : '-', fin ? '직행률(FPY) ' + fmtPct(S.fpyOk / fin) : '완료 대기');
    var win = Math.min(t, 3600);
    var uphRecent = win > 60 ? S.doneTimes.length / (win / 3600) : 0;
    var uphCum = t > 60 ? S.done / (t / 3600) : 0;
    var cls = CFG.targetUph ? (uphRecent >= CFG.targetUph * 0.95 ? 'good' : uphRecent >= CFG.targetUph * 0.7 ? 'warn' : 'bad') : '';
    setKpi('uph', uphRecent.toFixed(1), '최근 1h · 누적 ' + uphCum.toFixed(1) + (CFG.targetUph ? ' / 목표 ' + CFG.targetUph : ''), S.done ? cls : '');
    setKpi('wip', S.pallets.length + ' / ' + CFG.palletCount, '라인 내 팔레트');
    setKpi('lead', S.done ? hms(S.leadSum / S.done) : '-', '투입→배출');

    var bn = -1, bnU = -1;
    var utils = S.st.map(function (st, i) {
      var u = t > 0 ? st.pcs.reduce(function (a, p) { return a + p.busy; }, 0) / (t * LY.cells[i].def.pcs) : 0;
      if (u > bnU) { bnU = u; bn = i; }
      return u;
    });
    if (bn >= 0 && t > 0) {
      var bd = LY.cells[bn].def;
      setKpi('bn', bd.id + ' ' + (bd.code || ''), bd.name + ' · 가동률 ' + fmtPct(bnU, 0), 'warn');
    } else setKpi('bn', '-', '');

    stripEls.forEach(function (e, i) {
      var st = S.st[i], def = LY.cells[i].def;
      var used = st.slots.filter(function (s) { return s.state !== 'empty'; }).length;
      e.u.textContent = fmtPct(utils[i], 0);
      e.bar.style.width = Math.round(utils[i] * 100) + '%';
      e.sl.textContent = '슬롯 ' + used + '/' + def.slots + ' · PC ' + def.pcs;
      e.ng.textContent = 'NG ' + st.ng;
      e.root.classList.toggle('hl', i === hover || i === stripHover);
      e.root.classList.toggle('bn', i === bn && t > 0);
    });
    if (hover >= 0) placeTip();
  }

  /* ───────────── 메인 루프 ───────────── */
  var acc = 0, last = 0;
  function frame(ts) {
    var real = last ? Math.min(0.1, (ts - last) / 1000) : 0;
    last = ts;
    if (playing) {
      acc += real * speed;
      var n = 0, MAX = 8000;
      while (acc >= DT && n < MAX) { step(DT); acc -= DT; n++; }
      if (n >= MAX) acc = 0;
    }
    render();
    updateKpi(false);
    requestAnimationFrame(frame);
  }

  function init(mode) {
    LY = buildLayout(mode);
    newSim();
    acc = 0;
    resize();
    updateKpi(true);
  }

  buildStrip();
  init('U');
  window.addEventListener('resize', resize);
  requestAnimationFrame(frame);

  // 콘솔 디버그용: __isoSim.run(초), __isoSim.state()
  window.__isoSim = {
    run: function (sec) { for (var n = Math.round(sec / DT); n > 0; n--) step(DT); return S.t; },
    state: function () { return S; },
    layout: function () { return LY; },
    init: init
  };
})();
