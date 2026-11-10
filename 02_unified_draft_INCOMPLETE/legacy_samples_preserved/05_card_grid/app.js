(function () {
  'use strict';
  var D = window.LINE_DATA;
  if (!D) { document.body.textContent = 'LINE_DATA 로드 실패: ../data/line.js 를 확인하세요.'; return; }

  var SIM = D.simulation, LINE = D.line, STAGES = D.stages, COL = D.statusColors;
  var DT = 0.5;            // 고정 시뮬레이션 스텝(초) — 배속과 무관하게 결과 재현
  var FLASH_PASS = 1.5, FLASH_FAIL = 2.5, FLASH_RETEST = 1.5;
  var UPH_WINDOW = 900;    // UPH 계산 구간(시뮬 초)
  var SHIFT_START = 8 * 3600;

  // ---------- 색상 CSS 변수 ----------
  var root = document.documentElement;
  Object.keys(COL).forEach(function (k) { root.style.setProperty('--' + k, COL[k]); });

  // ---------- 유틸 ----------
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function pad(n, w) { n = String(n); while (n.length < (w || 2)) n = '0' + n; return n; }
  function hms(sec) { sec = Math.floor(sec); return pad(Math.floor(sec / 3600) % 24) + ':' + pad(Math.floor(sec / 60) % 60) + ':' + pad(sec % 60); }
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  // DOM 갱신 캐시: 값이 바뀔 때만 적용
  function setText(e, v) { v = String(v); if (e._t !== v) { e._t = v; e.textContent = v; } }
  function setAttr(e, k, v) { if (e['_a' + k] !== v) { e['_a' + k] = v; e.setAttribute(k, v); } }
  function setCls(e, c, on) { if (e['_c' + c] !== on) { e['_c' + c] = on; e.classList.toggle(c, on); } }

  // ---------- 시뮬레이션 상태 ----------
  var S;
  function reset() {
    S = {
      rng: mulberry32(SIM.randomSeed >>> 0),
      t: 0, acc: 0, nextArrival: 0, seq: 0, serial: 1000,
      pool: [], entry: [], inSystem: 0,
      pass: 0, fail: 0, passTimes: [], stages: [], alarms: [], events: []
    };
    for (var i = 1; i <= SIM.palletCount; i++) S.pool.push(i);
    STAGES.forEach(function (st) {
      var o = { slots: [], pcs: [], att: 0, ok: 0, durSum: 0, durN: 0, blocked: 0 };
      for (var i = 0; i < st.palletSlots; i++) o.slots.push({ s: 'empty', p: null, until: 0, blocked: false });
      for (var j = 0; j < st.testPcs; j++) o.pcs.push({ s: 'idle', slot: null, start: 0, until: 0, dur: 0, retest: false });
      S.stages.push(o);
    });
  }

  function logEv(cls, msg) {
    S.events.unshift({ c: cls, m: hms(SHIFT_START + S.t) + ' ' + msg });
    if (S.events.length > 12) S.events.pop();
    S.evDirty = true;
  }
  function freeSlot(stage) {
    for (var i = 0; i < stage.slots.length; i++) if (stage.slots[i].s === 'empty') return stage.slots[i];
    return null;
  }
  function release(p) { S.pool.push(p.id); S.inSystem--; }

  function step() {
    var t = (S.t += DT), rng = S.rng, n = STAGES.length, k, i;

    // 1) 팔레트 투입
    if (t >= S.nextArrival) {
      S.nextArrival += SIM.arrivalIntervalSec;
      if (S.pool.length) {
        S.serial++; S.seq++;
        S.entry.push({ id: S.pool.shift(), serial: 'AVN-' + pad(S.serial, 6), retry: 0, seq: S.seq });
        S.inSystem++;
      }
    }

    // 2) 하류 → 상류 순으로 처리
    for (k = n - 1; k >= 0; k--) {
      var cfg = STAGES[k], st = S.stages[k];
      // 슬롯
      for (i = 0; i < st.slots.length; i++) {
        var sl = st.slots[i];
        if (sl.s === 'transit' && t >= sl.until) sl.s = 'wait';
        else if (sl.s === 'pass' && t >= sl.until) {
          if (k === n - 1) {
            S.pass++; S.passTimes.push(t); release(sl.p); logEv('p', sl.p.serial + ' 최종 통과');
            sl.s = 'empty'; sl.p = null; sl.blocked = false;
          } else {
            var dst = freeSlot(S.stages[k + 1]);
            if (dst) {
              dst.s = 'transit'; dst.p = sl.p; dst.until = t + SIM.conveyorTransferSec; dst.blocked = false;
              sl.s = 'empty'; sl.p = null; sl.blocked = false;
            } else sl.blocked = true;
          }
        } else if (sl.s === 'fail' && sl.final && t >= sl.until) {
          S.fail++; release(sl.p); logEv('f', sl.p.serial + ' ' + cfg.code + ' 불량 배출');
          sl.s = 'empty'; sl.p = null; sl.final = false; sl.blocked = false;
        }
      }
      // PC
      for (i = 0; i < st.pcs.length; i++) {
        var pc = st.pcs[i];
        if (pc.s === 'busy' && t >= pc.until) {
          var slot = pc.slot, failed = rng() < cfg.failRate;
          st.att++; st.durSum += pc.dur; st.durN++;
          if (failed) {
            var canRetest = SIM.retestOnFail && slot.p.retry < SIM.maxRetest;
            pc.s = 'fail'; slot.s = 'fail'; slot.final = !canRetest; pc.retest = canRetest;
            pc.until = slot.until = t + (canRetest ? FLASH_RETEST : FLASH_FAIL);
            logEv(canRetest ? 'w' : 'f', slot.p.serial + ' ' + cfg.code + (canRetest ? ' 불량 → 재검사' : ' 최종 불량'));
          } else {
            st.ok++; pc.s = 'pass'; slot.s = 'pass'; pc.retest = false;
            pc.until = slot.until = t + FLASH_PASS;
          }
        } else if ((pc.s === 'pass' || pc.s === 'fail') && t >= pc.until) {
          if (pc.retest) {
            pc.slot.p.retry++; pc.retest = false;
            pc.s = 'busy'; pc.slot.s = 'busy'; pc.start = t;
            pc.dur = cfg.cycleTimeSec * (0.9 + 0.2 * rng()); pc.until = t + pc.dur;
          } else { pc.s = 'idle'; pc.slot = null; }
        }
        if (pc.s === 'idle') {
          var best = null;
          for (var j = 0; j < st.slots.length; j++) {
            var c = st.slots[j];
            if (c.s === 'wait' && (!best || c.p.seq < best.p.seq)) best = c;
          }
          if (best) {
            best.s = 'busy'; pc.slot = best; pc.s = 'busy'; pc.start = t;
            pc.dur = cfg.cycleTimeSec * (0.9 + 0.2 * rng()); pc.until = t + pc.dur;
          }
        }
      }
    }
    // 3) 입구 대기열 → 1단계
    while (S.entry.length) {
      var d0 = freeSlot(S.stages[0]);
      if (!d0) break;
      d0.s = 'transit'; d0.p = S.entry.shift(); d0.until = t + SIM.conveyorTransferSec; d0.blocked = false;
    }
    // UPH 이력 정리
    while (S.passTimes.length && S.passTimes[0] < t - UPH_WINDOW) S.passTimes.shift();
  }

  // ---------- 파생 지표 ----------
  function queueOf(k) {
    if (k === 0) return S.entry.length;
    var c = 0, sl = S.stages[k - 1].slots;
    for (var i = 0; i < sl.length; i++) if (sl[i].s === 'pass' && sl[i].blocked) c++;
    return c;
  }
  function stageYield(k) { var st = S.stages[k]; return st.att ? st.ok / st.att : null; }
  function currentUph() {
    var w = Math.min(S.t, UPH_WINDOW);
    return w < 60 ? 0 : S.passTimes.length * 3600 / w;
  }

  // ---------- DOM 구성 ----------
  var cards = [];
  var STATE_KO = { idle: '대기', busy: '검사중', pass: '통과', fail: '불량' };
  var SLOT_KO = { empty: '빈칸', transit: '이동', wait: '대기', busy: '검사', pass: '통과', fail: '불량' };

  function build() {
    var board = $('board'); board.textContent = '';
    cards = STAGES.map(function (cfg, k) {
      var card = el('section', 'card'); card.dataset.s = 'ok';
      var h = el('div', 'card-h');
      h.appendChild(el('div', 'no', cfg.id));
      var nm = el('div', 'nm'); nm.appendChild(el('b', '', cfg.name)); nm.appendChild(el('small', '', cfg.nameEn || ''));
      h.appendChild(nm); h.appendChild(el('span', 'code', cfg.code));
      card.appendChild(h);

      var chips = el('div', 'chips');
      (cfg.items || []).forEach(function (it) { chips.appendChild(el('span', 'chip', it)); });
      card.appendChild(chips);

      var sw = el('div'); var sh = el('div', 'sec'); sh.appendChild(el('span', '', '팔레트 슬롯 ' + cfg.palletSlots + '개'));
      var sCnt = el('span', '', ''); sh.appendChild(sCnt); sw.appendChild(sh);
      var sg = el('div', 'slots'); var slotEls = [];
      for (var i = 0; i < cfg.palletSlots; i++) {
        var c = el('div', 'slot'); c.dataset.s = 'empty';
        var b = el('b', '', ''); var sm = el('span', '', '빈칸'); c.appendChild(b); c.appendChild(sm);
        sg.appendChild(c); slotEls.push({ e: c, b: b, s: sm });
      }
      sw.appendChild(sg); card.appendChild(sw);

      var pw = el('div'); var ph = el('div', 'sec'); ph.appendChild(el('span', '', '검사 PC ' + cfg.testPcs + '대'));
      var pCnt = el('span', '', ''); ph.appendChild(pCnt); pw.appendChild(ph);
      var pg = el('div', 'pcs'); var pcEls = [];
      for (var j = 0; j < cfg.testPcs; j++) {
        var p = el('div', 'pc'); p.dataset.s = 'idle';
        var tt = el('div', 'pc-t'); tt.appendChild(el('span', '', cfg.code + '-PC' + (j + 1)));
        var em = el('em', '', '대기'); tt.appendChild(em);
        var sn = el('div', 'pc-sn', '—');
        var bar = el('div', 'bar'); var u = el('u'); bar.appendChild(u);
        p.appendChild(tt); p.appendChild(sn); p.appendChild(bar);
        pg.appendChild(p); pcEls.push({ e: p, em: em, sn: sn, u: u });
      }
      pw.appendChild(pg); card.appendChild(pw);

      var stats = el('div', 'stats');
      function stat(label) {
        var d = el('div', 'st'); d.appendChild(el('span', '', label));
        var v = el('b', '', '-'); var sub = el('small', '', ''); d.appendChild(v); d.appendChild(sub); stats.appendChild(d);
        return { d: d, v: v, sub: sub };
      }
      var sY = stat('단계 수율'), sQ = stat('대기열'), sC = stat('평균 사이클');
      card.appendChild(stats);
      board.appendChild(card);
      return { card: card, slots: slotEls, pcs: pcEls, sCnt: sCnt, pCnt: pCnt, y: sY, q: sQ, c: sC };
    });

    var lg = $('legend'); lg.textContent = '';
    [['idle', '대기/빈칸'], ['busy', '검사중'], ['pass', '통과'], ['fail', '불량'], ['waiting', '대기열·이동']].forEach(function (a) {
      var s = el('span'); var i = el('i'); i.style.background = COL[a[0]]; s.appendChild(i); s.appendChild(document.createTextNode(a[1])); lg.appendChild(s);
    });

    $('lineName').textContent = LINE.name;
    $('lineSub').textContent = LINE.product + ' · ' + LINE.shift + ' · Takt ' + LINE.taktTimeSec + 's · ' + STAGES.length + '단계';
    $('uphT').textContent = LINE.targetUph;
    $('seedInfo').textContent = 'seed ' + SIM.randomSeed + ' · 기본 ×' + SIM.speed;
  }

  // ---------- 렌더 ----------
  var lastPass = -1, lastFail = -1;
  function bump(e) { e.classList.remove('flash'); void e.offsetWidth; e.classList.add('flash'); }

  function render() {
    var k, i, a, worst = 'ok', alarms = [];
    for (k = 0; k < STAGES.length; k++) {
      var cfg = STAGES[k], st = S.stages[k], cd = cards[k], busyN = 0, used = 0;
      for (i = 0; i < st.slots.length; i++) {
        var sl = st.slots[i], ce = cd.slots[i];
        setAttr(ce.e, 'data-s', sl.s);
        setText(ce.b, sl.p ? 'P' + pad(sl.p.id) : '');
        setText(ce.s, SLOT_KO[sl.s]);
        setCls(ce.e, 'blocked', !!sl.blocked);
        ce.e.title = sl.p ? sl.p.serial : '';
        if (sl.s !== 'empty') used++;
      }
      for (i = 0; i < st.pcs.length; i++) {
        var pc = st.pcs[i], pe = cd.pcs[i];
        setAttr(pe.e, 'data-s', pc.s);
        setText(pe.em, STATE_KO[pc.s] + (pc.s === 'busy' ? ' ' + Math.max(0, Math.ceil(pc.until - S.t)) + 's' : '') + (pc.s === 'fail' && pc.retest ? ' · 재검사' : ''));
        setText(pe.sn, pc.slot && pc.slot.p ? pc.slot.p.serial + (pc.slot.p.retry ? ' (재)' : '') : '—');
        var prog = pc.s === 'busy' ? Math.min(1, (S.t - pc.start) / pc.dur) : (pc.s === 'idle' ? 0 : 1);
        var pv = 'scaleX(' + prog.toFixed(3) + ')'; if (pe.u._p !== pv) { pe.u._p = pv; pe.u.style.transform = pv; }
        if (pc.s === 'busy') busyN++;
      }
      setText(cd.sCnt, '사용 ' + used + '/' + st.slots.length);
      setText(cd.pCnt, '가동 ' + busyN + '/' + st.pcs.length);
      var y = stageYield(k), q = queueOf(k), avg = st.durN ? st.durSum / st.durN : null;
      setText(cd.y.v, y == null ? '-' : (y * 100).toFixed(1) + '%');
      setText(cd.y.sub, st.att + '회 검사 · 불량 ' + (st.att - st.ok));
      setText(cd.q.v, q); setText(cd.q.sub, q ? '대기 팔레트' : '적체 없음');
      setText(cd.c.v, avg == null ? '-' : avg.toFixed(1) + 's'); setText(cd.c.sub, '기준 ' + cfg.cycleTimeSec + 's');
      var yBad = y != null && st.att >= 6 && y < 0.9, yWarn = y != null && st.att >= 6 && y < 0.95;
      setCls(cd.y.d, 'lo', yBad); setCls(cd.y.d, 'mid', !yBad && yWarn);
      setCls(cd.q.d, 'lo', q >= 3); setCls(cd.q.d, 'mid', q === 2);
      var lvl = 'ok';
      if (yBad || q >= 3) lvl = 'alarm'; else if (yWarn || q >= 2) lvl = 'warn';
      setAttr(cd.card, 'data-s', lvl);
      if (yBad) alarms.push(cfg.code + ' 수율 저하 ' + (y * 100).toFixed(0) + '%');
      if (q >= 3) alarms.push(cfg.code + ' 대기열 ' + q);
      else if (q === 2) alarms.push(cfg.code + ' 대기 주의');
      if (lvl === 'alarm') worst = 'alarm'; else if (lvl === 'warn' && worst !== 'alarm') worst = 'warn';
    }
    var uph = currentUph();
    var uphLow = S.t > 1200 && uph < LINE.targetUph * 0.85;
    if (uphLow) { alarms.push('UPH 목표 미달'); if (worst === 'ok') worst = 'warn'; }

    // 헤더
    var now = new Date();
    setText($('clock'), pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds()));
    setText($('simclock'), '시뮬 ' + hms(SHIFT_START + S.t) + ' (경과 ' + hms(S.t) + ')');
    setText($('uph'), Math.round(uph));
    var ub = $('uphBar'), pct = Math.min(100, uph / LINE.targetUph * 100).toFixed(0) + '%';
    if (ub._w !== pct) { ub._w = pct; ub.style.width = pct; }
    ub.style.background = uph >= LINE.targetUph * 0.95 ? COL.pass : (uph >= LINE.targetUph * 0.85 ? COL.waiting : COL.fail);
    var tot = S.pass + S.fail;
    setText($('yield'), tot ? (S.pass / tot * 100).toFixed(1) + '%' : '-');
    setText($('yieldSub'), '통과 ' + S.pass + ' / 종료 ' + tot);
    setText($('cPass'), S.pass); setText($('cFail'), S.fail);
    if (S.pass !== lastPass) { if (lastPass >= 0) bump($('cPass')); lastPass = S.pass; }
    if (S.fail !== lastFail) { if (lastFail >= 0) bump($('cFail')); lastFail = S.fail; }
    setText($('wip'), S.inSystem); setText($('wipSub'), '입구 대기 ' + S.entry.length + ' / 총 ' + SIM.palletCount);
    var ab = $('alarmBox');
    setText($('alarmN'), alarms.length);
    setText($('alarmTxt'), alarms.length ? alarms.slice(0, 2).join(', ') + (alarms.length > 2 ? ' 외 ' + (alarms.length - 2) : '') : '정상');
    setCls(ab, 'warn', worst === 'warn'); setCls(ab, 'bad', worst === 'alarm');
    var lamp = $('lamp'); setCls(lamp, 'warn', worst === 'warn'); setCls(lamp, 'alarm', worst === 'alarm');

    if (S.evDirty) {
      S.evDirty = false;
      var ul = $('events'); ul.textContent = '';
      S.events.forEach(function (ev) { ul.appendChild(el('li', ev.c, ev.m)); });
    }
  }

  // ---------- 루프/컨트롤 ----------
  var playing = true, speed = SIM.speed, last = null;
  function frame(ts) {
    if (last == null) last = ts;
    var dtReal = Math.min(0.25, (ts - last) / 1000); last = ts;
    if (playing) {
      S.acc += dtReal * speed;
      var guard = 0;
      while (S.acc >= DT && guard++ < 2000) { step(); S.acc -= DT; }
      if (S.acc > DT * 2000) S.acc = 0;
    }
    render();
    requestAnimationFrame(frame);
  }

  function initControls() {
    var sel = $('selSpeed'), opts = [1, 2, 5, 10, 20, 50];
    if (opts.indexOf(SIM.speed) < 0) { opts.push(SIM.speed); opts.sort(function (a, b) { return a - b; }); }
    opts.forEach(function (v) { var o = el('option', '', '×' + v); o.value = v; if (v === SIM.speed) o.selected = true; sel.appendChild(o); });
    sel.addEventListener('change', function () { speed = parseFloat(sel.value); });
    $('btnPlay').addEventListener('click', function () {
      playing = !playing; this.textContent = playing ? '⏸ 일시정지' : '▶ 재생';
    });
    $('btnReset').addEventListener('click', function () { reset(); lastPass = lastFail = -1; S.evDirty = true; });
  }

  reset(); build(); initControls();
  requestAnimationFrame(frame);
})();
