(function (root) {
  "use strict";

  const DT = 0.25;
  const VALID_SCENARIOS = ["single_line", "multi_line_example"];

  function createSim(factoryData, scenarioId) {
    let sim = {
      data: factoryData,
      scenarioId: scenarioId || "single_line",
      capacity: factoryData.capacityDefaults.default,
      capacityOverride: false,
      speed: factoryData.simulation.speed,
      paused: false,
      time: 0,
      accumulator: 0,
      snapshotId: 0,
      nextArrival: 0,
      nextProductId: 1,
      rng: null,
      products: [],
      stations: [],
      robots: [],
      passed: 0,
      failed: 0,
      listeners: new Set()
    };

    function event(type, message) {
      sim.events.unshift({ time: sim.time, type, message });
      if (sim.events.length > 80) sim.events.pop();
    }
    sim.inspectionStart = (station, pc, product) => {
      pc.startedAt = sim.time;
      pc.inspectionId = ++sim.inspectionSequence;
      sim.inspections.push({ id: pc.inspectionId, stationId: station.id, pcId: pc.id, productId: product.id,
        start: sim.time, end: null, plannedEnd: pc.completesAt, result: null, retest: product.retries || 0 });
      if (sim.inspections.length > 3000) {
        const index = sim.inspections.findIndex(record => record.end !== null);
        if (index >= 0) sim.inspections.splice(index, 1);
      }
    };
    sim.inspectionFinish = (station, pc, passed) => {
      const record = sim.inspections.find(item => item.id === pc.inspectionId);
      if (record) { record.end = sim.time; record.result = passed ? 'pass' : 'fail'; }
      station.completed += passed ? 1 : 0;
      station.failed += passed ? 0 : 1;
      event(passed ? 'pass' : 'fail', `${pc.productId} · ${station.name} ${passed ? '검사 통과' : '검사 불량'}`);
      pc.inspectionId = null;
    };
    const multiFlow = root.AVNMultiFlow.createFlow(sim, factoryData);

    function stationCapacity(definition) {
      return sim.capacityOverride ? sim.capacity : (definition.defaultCapacity || sim.capacity);
    }

    function definitions() {
      return sim.scenarioId === "single_line"
        ? factoryData.stages.map((stage) => ({
            id: String(stage.id), code: stage.code, name: stage.name,
            cycleTimeSec: stage.cycleTimeSec, failRate: stage.failRate,
            palletSlots: stage.palletSlots, testPcs: stage.testPcs
          }))
        : factoryData.multiLineExample.stations.map((station) => ({
            id: station.id, code: station.id, name: station.name,
            cycleTimeSec: station.cycleTimeSec, failRate: 0,
            palletSlots: station.defaultCapacity || sim.capacity,
            defaultCapacity: station.defaultCapacity, parallelInspection: station.parallelInspection,
            capacitySource: station.capacitySource, testPcs: station.parallelInspection ? (station.defaultCapacity || sim.capacity) : 2
          }));
    }

    function reset() {
      sim.time = 0;
      sim.paused = false;
      sim.accumulator = 0;
      sim.snapshotId = 0;
      sim.nextArrival = 0;
      sim.nextProductId = 1;
      sim.rng = root.AVNRng.mulberry32(factoryData.simulation.randomSeed);
      sim.products = [];
      sim.inspections = [];
      sim.inspectionSequence = 0;
      sim.events = [];
      sim.metrics = [{ time: 0, uph: 0, wip: 0 }];
      sim.lastSample = 0;
      sim.passed = 0;
      sim.failed = 0;
      sim.robots = sim.scenarioId === "multi_line_example"
        ? factoryData.robots.map((robot) => ({ id: robot.id, state: "idle", productId: null, target: null }))
        : [];
      sim.stations = definitions().map((definition) => ({
        ...definition,
        completed: 0, failed: 0, busyTime: 0, pcTime: 0,
        capacity: stationCapacity(definition),
        slots: Array.from({ length: stationCapacity(definition) }, () => ({ productId: null, reservedProductId: null })),
        pcs: Array.from({ length: definition.parallelInspection ? stationCapacity(definition) : definition.testPcs }, (_, index) => ({
          id: `${definition.id}-PC${index + 1}`, state: "idle", productId: null, completesAt: 0
        })),
        queue: []
      }));
      emit();
    }

    function makeProduct() {
      const id = `PLT-${String(sim.nextProductId++).padStart(4, "0")}`;
      return { id, stageIndex: 0, stageId: sim.stations[0].id, state: "queued", retries: 0, arrivedAt: sim.time };
    }

    function freeSlot(station) {
      return station.slots.findIndex((slot) => slot.productId === null);
    }

    function acquireStation(product, stationIndex) {
      const station = sim.stations[stationIndex];
      const slotIndex = freeSlot(station);
      if (slotIndex < 0) return false;
      station.slots[slotIndex].productId = product.id;
      product.stageIndex = stationIndex;
      product.stageId = station.id;
      product.state = "processing";
      product.slotIndex = slotIndex;
      return true;
    }

    function completeProduct(product, passed) {
      const station = sim.stations[product.stageIndex];
      if (station && product.slotIndex != null) station.slots[product.slotIndex].productId = null;
      product.slotIndex = null;
      if (!passed && factoryData.simulation.retestOnFail && product.retries < factoryData.simulation.maxRetest) {
        product.retries += 1;
        product.state = "queued";
        station.queue.unshift(product.id);
        return;
      }
      if (passed) sim.passed += 1;
      else sim.failed += 1;
      product.state = passed ? "passed" : "failed";
    }

    function advanceSingleStage(station, stationIndex) {
      station.pcs.forEach((pc) => {
        if (pc.state === "busy" && sim.time >= pc.completesAt) {
          const product = sim.products.find((item) => item.id === pc.productId);
          const passed = sim.rng() >= station.failRate;
          sim.inspectionFinish(station, pc, passed);
          pc.state = "idle";
          pc.productId = null;
          if (product) {
            const slotIndex = product.slotIndex;
            station.slots[slotIndex].productId = null;
            product.slotIndex = null;
            if (!passed && factoryData.simulation.retestOnFail && product.retries < factoryData.simulation.maxRetest) {
              product.retries += 1;
              product.state = "queued";
              product.stageIndex = stationIndex;
              station.queue.unshift(product.id);
            } else if (!passed) {
              sim.failed += 1;
              product.state = "failed";
            } else if (stationIndex === sim.stations.length - 1) {
              sim.passed += 1;
              product.state = "passed";
            } else {
              product.state = "conveyor";
              product.transfer = { from: station.id, to: sim.stations[stationIndex + 1].id,
                startedAt: sim.time, completesAt: sim.time + factoryData.simulation.conveyorTransferSec };
              product.stageIndex = stationIndex + 1;
              product.stageId = sim.stations[stationIndex + 1].id;
            }
          }
        }
      });

      station.queue = station.queue.filter((id) => sim.products.some((product) => product.id === id && product.state === "queued"));
      while (station.queue.length && freeSlot(station) >= 0) {
        const id = station.queue.shift();
        const product = sim.products.find((item) => item.id === id);
        if (product) acquireStation(product, stationIndex);
      }
      station.pcs.forEach((pc) => {
        if (pc.state !== "idle") return;
        const slot = station.slots.find((item) => item.productId && station.pcs.every((other) => other.productId !== item.productId));
        if (!slot) return;
        const product = sim.products.find((item) => item.id === slot.productId);
        if (!product) return;
        pc.state = "busy";
        pc.productId = product.id;
        pc.completesAt = sim.time + station.cycleTimeSec * (0.9 + sim.rng() * 0.2);
        sim.inspectionStart(station, pc, product);
      });
    }


    function step(seconds) {
      const duration = seconds == null ? DT : seconds;
      if (sim.paused) return snapshot();
      sim.stations.forEach(station => {
        station.busyTime += duration * station.pcs.filter(pc => pc.state === 'busy').length;
        station.pcTime += duration * station.pcs.length;
      });
      sim.time += duration;
      if (sim.scenarioId === 'single_line') sim.products.forEach(product => {
        if (product.state === 'conveyor' && product.transfer && sim.time >= product.transfer.completesAt) {
          product.state = 'queued'; product.transfer = null;
          sim.stations[product.stageIndex].queue.push(product.id);
        }
      });
      while (sim.time >= sim.nextArrival && sim.products.filter((product) => !["passed", "failed"].includes(product.state)).length < factoryData.simulation.palletCount) {
        const product = makeProduct();
        sim.products.push(product);
        event("entry", `${product.id} · 제품 투입`);
        if (sim.scenarioId === "single_line") sim.stations[0].queue.push(product.id);
        else multiFlow.spawn(product);
        sim.nextArrival += sim.scenarioId === "single_line" ? factoryData.simulation.arrivalIntervalSec : factoryData.multiLineExample.arrivalIntervalSec;
      }
      if (sim.scenarioId === "single_line") sim.stations.forEach(advanceSingleStage);
      else multiFlow.advance();
      sim.products = sim.products.filter((product) => !["passed", "failed"].includes(product.state));
      sim.snapshotId += 1;
      if (sim.time - sim.lastSample >= 5) {
        sim.metrics.push({ time: sim.time, uph: sim.passed * 3600 / sim.time, wip: sim.products.length });
        if (sim.metrics.length > 361) sim.metrics.shift();
        sim.lastSample = sim.time;
      }
      emit();
      return snapshot();
    }

    function tick(realSeconds) {
      if (sim.paused) return snapshot();
      sim.accumulator += (realSeconds == null ? DT : realSeconds) * sim.speed;
      while (sim.accumulator >= DT) {
        sim.accumulator -= DT;
        step(DT);
      }
      return snapshot();
    }

    function snapshot() {
      const stations = sim.stations.map((station) => ({
        id: station.id, code: station.code, name: station.name,
        capacity: station.capacity,
        completed: station.completed, failed: station.failed,
        utilization: station.pcTime ? Math.min(1, station.busyTime / station.pcTime) : 0,
        capacitySource: station.capacitySource,
        cycleTimeSec: station.cycleTimeSec,
        slots: station.slots.map((slot) => ({ productId: slot.productId, reservedProductId: slot.reservedProductId || null })),
        pcs: station.pcs.map((pc) => ({ ...pc })),
        queue: sim.scenarioId === 'single_line' ? station.queue.map((id) => ({ id })) : sim.products.filter(product => {
          // Inbound belt queues are derived from the same runtime, not a view-local copy.
          if (station.id === 'A') return product.state === 'waiting_pickup' && product.nextAction === 'intake1';
          if (station.id === 'C') return product.state === 'waiting_pickup' && product.nextAction === 'intake2';
          const action = station.id === 'VISION' ? 'vision' : station.id === 'LABEL' ? 'label' : null;
          return action && product.state === 'conveyor' && product.nextAction === action && product.conveyor.completesAt <= sim.time;
        }).map(product => ({ id: product.id }))
      }));
      const products = sim.products.map((product) => JSON.parse(JSON.stringify(product)));
      const wip = products.length;
      const kpis = { passed: sim.passed, failed: sim.failed, wip, uph: sim.time > 0 ? sim.passed * 3600 / sim.time : 0 };
      const state = {
        snapshotId: sim.snapshotId,
        simTimeSec: sim.time,
        scenarioId: sim.scenarioId,
        paused: sim.paused,
        capacity: sim.capacity,
        capacityMode: sim.capacityOverride ? "override" : "default",
        speed: sim.speed,
        assumptionLabel: factoryData.capacityAssumptionLabel,
        stages: stations,
        stations,
        pcs: stations.flatMap((station) => station.pcs),
        robots: sim.robots.map((robot) => JSON.parse(JSON.stringify(robot))),
        pallets: products,
        products,
        kpis,
        inspections: sim.inspections.map(record => ({ ...record })),
        metrics: sim.metrics.map(record => ({ ...record })),
        events: sim.events.map(record => ({ ...record }))
      };
      state.occupancyHash = root.AVNModel.occupancyHash(state);
      return state;
    }

    function emit() {
      const state = snapshot();
      sim.listeners.forEach((listener) => listener(state));
    }

    function pause() { sim.paused = true; emit(); }
    function resume() { sim.paused = false; emit(); }
    function setSpeed(speed) {
      if (!Number.isFinite(speed) || speed <= 0) throw new RangeError("speed must be a positive finite number");
      sim.speed = speed;
      emit();
    }
    function setCapacity(capacity) {
      const useDefaults = capacity == null;
      if (!useDefaults && !factoryData.capacityDefaults.options.includes(capacity)) throw new RangeError("capacity must be 10 or 20");
      const plans = sim.stations.map(station => {
        const size = useDefaults ? (station.defaultCapacity || factoryData.capacityDefaults.default) : capacity;
        const occupied = station.slots.filter(slot => slot.productId || slot.reservedProductId);
        if (occupied.length > size) throw new Error(`${station.name}: 점유/이송 예약 ${occupied.length}개가 있어 용량 ${size}로 줄일 수 없습니다.`);
        return { station, size, occupied };
      });
      // Validate every station before changing any shared runtime state.
      sim.capacityOverride = !useDefaults;
      sim.capacity = useDefaults ? factoryData.capacityDefaults.default : capacity;
      plans.forEach(({ station, size, occupied }) => {
        station.slots = Array.from({ length: size }, (_, index) => occupied[index] || { productId: null, reservedProductId: null });
        station.capacity = size;
        station.slots.forEach((slot, index) => {
          const product = sim.products.find(item => item.id === slot.productId);
          if (product) product.slotIndex = index;
          const robot = sim.robots.find(item => item.productId === slot.reservedProductId && item.to && item.to.stationId === station.id);
          if (robot) robot.to.slotIndex = index;
        });
        if (station.parallelInspection) {
          const busy = station.pcs.filter(pc => pc.state === 'busy');
          station.pcs = Array.from({ length: size }, (_, index) => {
            const pc = { ...(busy[index] || { state: 'idle', productId: null, completesAt: 0 }), id: `${station.id}-PC${index + 1}` };
            const record = sim.inspections.find(item => item.id === pc.inspectionId && item.end === null);
            if (record) record.pcId = pc.id;
            return pc;
          });
        }
      });
      sim.snapshotId += 1;
      emit();
    }
    function setScenario(id) {
      if (!VALID_SCENARIOS.includes(id) || !factoryData.scenarios[id]) throw new RangeError(`Unknown scenario: ${id}`);
      sim.scenarioId = id;
      sim.capacityOverride = false;
      sim.capacity = factoryData.capacityDefaults.default;
      reset();
    }
    function subscribe(listener) { sim.listeners.add(listener); return () => sim.listeners.delete(listener); }

    reset();
    return { step, tick, pause, resume, reset, setSpeed, setCapacity, setScenario, snapshot, subscribe, getRenderTime: () => sim.time + sim.accumulator };
  }

  root.AVNSim = { createSim };
})(typeof window === "undefined" ? globalThis : window);
