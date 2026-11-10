(function (root) {
  "use strict";

  const DT = 0.25;
  const VALID_SCENARIOS = ["single_line", "multi_line_example"];

  function createSim(factoryData, scenarioId) {
    let sim = {
      data: factoryData,
      scenarioId: scenarioId || "single_line",
      capacity: factoryData.capacityDefaults.default,
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
            palletSlots: sim.capacity, testPcs: 1
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
      sim.passed = 0;
      sim.failed = 0;
      sim.robots = sim.scenarioId === "multi_line_example"
        ? factoryData.robots.map((robot) => ({ id: robot.id, state: "idle", productId: null, target: null }))
        : [];
      sim.stations = definitions().map((definition) => ({
        ...definition,
        capacity: sim.capacity,
        slots: Array.from({ length: sim.capacity }, () => ({ productId: null })),
        pcs: Array.from({ length: definition.testPcs }, (_, index) => ({
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
              product.state = "queued";
              product.stageIndex = stationIndex + 1;
              product.stageId = sim.stations[stationIndex + 1].id;
              sim.stations[stationIndex + 1].queue.push(product.id);
            }
          }
        }
      });

      station.queue = station.queue.filter((id) => sim.products.some((product) => product.id === id && product.state === "queued"));
      while (station.queue.length && freeSlot(station) >= 0) {
        const product = sim.products.find((item) => item.id === station.queue.shift());
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
      });
    }

    function advanceMulti() {
      const routes = [["A", "B"], ["C", "D", "VISION", "LABEL"]];
      sim.stations.forEach((station) => {
        station.pcs.forEach((pc) => {
          if (pc.state !== "busy" || sim.time < pc.completesAt) return;
          const product = sim.products.find((item) => item.id === pc.productId);
          pc.state = "idle";
          pc.productId = null;
          if (!product) return;
          product.routePosition = (product.routePosition || 0) + 1;
          station.slots[product.slotIndex].productId = null;
          product.slotIndex = null;
          product.state = "ready_for_robot";
        });
      });
      sim.robots.forEach((robot) => {
        if (robot.state === "moving" && sim.time >= robot.completesAt) {
          const product = sim.products.find((item) => item.id === robot.productId);
          const targetIndex = sim.stations.findIndex((station) => station.id === robot.target);
          robot.state = "idle";
          robot.productId = null;
          robot.target = null;
          if (product && targetIndex >= 0) {
            if (acquireStation(product, targetIndex)) product.state = "processing";
            else product.state = "queued";
          } else if (product) {
            product.routePosition += 1;
            if (product.routePosition >= product.route.length) {
              product.state = "passed";
              sim.passed += 1;
            } else product.state = "ready_for_robot";
          }
        }
      });
      sim.products.forEach((product) => {
        if (product.state !== "ready_for_robot") return;
        if (!product.route) product.assignedRobotId = Number(product.id.slice(-1)) % 2 === 0 ? "R2" : "R1";
        const robot = sim.robots.find((item) => item.id === product.assignedRobotId && item.state === "idle");
        if (!robot) return;
        const route = routes[robot.id === "R1" ? 0 : 1];
        if (!product.route) {
          product.route = route;
          product.routePosition = 0;
        }
        const target = product.route[product.routePosition];
        if (!target) {
          product.state = "passed";
          sim.passed += 1;
          return;
        }
        const station = sim.stations.find((item) => item.id === target);
        if (station && freeSlot(station) < 0) return;
        robot.state = "moving";
        robot.productId = product.id;
        robot.target = target;
        robot.completesAt = sim.time + factoryData.simulation.conveyorTransferSec;
        product.state = "robot_transfer";
      });
      sim.stations.forEach((station) => {
        station.pcs.forEach((pc) => {
          if (pc.state !== "idle") return;
          const slot = station.slots.find((item) => item.productId && station.pcs.every((other) => other.productId !== item.productId));
          if (!slot) return;
          const product = sim.products.find((item) => item.id === slot.productId);
          if (!product) return;
          pc.state = "busy";
          pc.productId = product.id;
          pc.completesAt = sim.time + station.cycleTimeSec;
        });
      });
    }

    function step(seconds) {
      const duration = seconds == null ? DT : seconds;
      if (sim.paused) return snapshot();
      sim.time += duration;
      while (sim.time >= sim.nextArrival && sim.products.filter((product) => !["passed", "failed"].includes(product.state)).length < factoryData.simulation.palletCount) {
        const product = makeProduct();
        sim.products.push(product);
        if (sim.scenarioId === "single_line") sim.stations[0].queue.push(product.id);
        else product.state = "ready_for_robot";
        sim.nextArrival += factoryData.simulation.arrivalIntervalSec;
      }
      if (sim.scenarioId === "single_line") sim.stations.forEach(advanceSingleStage);
      else advanceMulti();
      sim.products = sim.products.filter((product) => !["passed", "failed"].includes(product.state));
      sim.snapshotId += 1;
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
        slots: station.slots.map((slot) => ({ productId: slot.productId })),
        pcs: station.pcs.map((pc) => ({ ...pc })),
        queue: station.queue.map((id) => ({ id }))
      }));
      const products = sim.products.map((product) => ({ ...product }));
      const wip = products.length;
      const kpis = { passed: sim.passed, failed: sim.failed, wip, uph: sim.time > 0 ? sim.passed * 3600 / sim.time : 0 };
      const state = {
        snapshotId: sim.snapshotId,
        simTimeSec: sim.time,
        scenarioId: sim.scenarioId,
        paused: sim.paused,
        capacity: sim.capacity,
        assumptionLabel: factoryData.capacityAssumptionLabel,
        stages: stations,
        stations,
        pcs: stations.flatMap((station) => station.pcs),
        robots: sim.robots.map((robot) => ({ ...robot })),
        pallets: products,
        products,
        kpis
      };
      state.occupancyHash = root.AVNModel.occupancyHash(state);
      return state;
    }

    function emit() {
      const state = snapshot();
      sim.listeners.forEach((listener) => listener(state));
    }

    function pause() { sim.paused = true; }
    function resume() { sim.paused = false; }
    function setSpeed(speed) {
      if (!Number.isFinite(speed) || speed <= 0) throw new RangeError("speed must be a positive finite number");
      sim.speed = speed;
    }
    function setCapacity(capacity) {
      if (!factoryData.capacityDefaults.options.includes(capacity)) throw new RangeError("capacity must be 10 or 20");
      sim.capacity = capacity;
      sim.stations.forEach((station) => {
        if (capacity < station.slots.length && station.slots.slice(capacity).some((slot) => slot.productId !== null)) {
          throw new Error("Cannot reduce capacity while truncated slots are occupied");
        }
        station.slots.length = capacity;
        while (station.slots.length < capacity) station.slots.push({ productId: null });
        station.capacity = capacity;
      });
      emit();
    }
    function setScenario(id) {
      if (!VALID_SCENARIOS.includes(id) || !factoryData.scenarios[id]) throw new RangeError(`Unknown scenario: ${id}`);
      sim.scenarioId = id;
      reset();
    }
    function subscribe(listener) { sim.listeners.add(listener); return () => sim.listeners.delete(listener); }

    reset();
    return { step, tick, pause, resume, reset, setSpeed, setCapacity, setScenario, snapshot, subscribe };
  }

  root.AVNSim = { createSim };
})(typeof window === "undefined" ? globalThis : window);
