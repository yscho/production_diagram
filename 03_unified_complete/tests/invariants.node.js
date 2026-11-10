"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const context = { window: {} };
vm.createContext(context);
for (const file of ["data/factory.js", "engine/rng.js", "engine/model.js", "engine/multi-flow.js", "engine/sim.js"]) {
  vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
}

const factory = context.window.FACTORY_DATA;
assert.equal(factory.stages.length, 8);
assert.equal(JSON.stringify(factory.capacityDefaults.options), "[10,20]");
assert.equal(context.window.LINE_DATA.stages.length, 8);
const deterministicA = context.window.AVNSim.createSim(factory, "single_line");
const deterministicB = context.window.AVNSim.createSim(factory, "single_line");
for (let i = 0; i < 400; i += 1) {
  deterministicA.step();
  deterministicB.step();
}
assert.equal(deterministicA.snapshot().occupancyHash, deterministicB.snapshot().occupancyHash);

function verifyState(state) {
  const validation = context.window.AVNModel.validateNoDoubleOccupancy(state);
  assert.equal(validation.valid, true, validation.errors.join("; "));
  state.stations.forEach((station) => {
    assert.ok(station.slots.length <= station.capacity);
    assert.ok(station.slots.filter((slot) => slot.productId !== null).length <= station.capacity);
  });
  Object.values(state.kpis).forEach((value) => assert.ok(Number.isFinite(value) && value >= 0));
  assert.equal(state.occupancyHash, context.window.AVNModel.occupancyHash(state));
}

for (const scenarioId of ["single_line", "multi_line_example"]) {
  const sim = context.window.AVNSim.createSim(factory, scenarioId);
  for (let i = 0; i < 600; i += 1) {
    sim.step();
    verifyState(sim.snapshot());
  }

  const beforePause = sim.snapshot();
  sim.pause();
  sim.tick(20);
  assert.equal(sim.snapshot().simTimeSec, beforePause.simTimeSec);
  assert.equal(sim.snapshot().occupancyHash, beforePause.occupancyHash);
  sim.resume();
  sim.tick(1);
  assert.ok(sim.snapshot().simTimeSec > beforePause.simTimeSec);

  for (const capacity of [10, 20]) {
    sim.setCapacity(capacity);
    const state = sim.snapshot();
    assert.equal(state.capacity, capacity);
    assert.equal(state.assumptionLabel, factory.capacityAssumptionLabel);
    verifyState(state);
  }

  const sameSnapshot = sim.snapshot();
  const viewA = sim.snapshot();
  const viewB = sim.snapshot();
  assert.equal(viewA.snapshotId, viewB.snapshotId);
  assert.equal(viewA.simTimeSec, viewB.simTimeSec);
  assert.equal(viewA.occupancyHash, viewB.occupancyHash);
  assert.equal(JSON.stringify(viewA), JSON.stringify(sameSnapshot));

  sim.reset();
  assert.equal(sim.snapshot().simTimeSec, 0);
  assert.equal(sim.snapshot().snapshotId, 0);
  verifyState(sim.snapshot());
}

const multi = context.window.AVNSim.createSim(factory, "multi_line_example");
for (let i = 0; i < 1200; i += 1) multi.step();
const robots = multi.snapshot().robots;
assert.equal(robots.length, 2);
assert.ok(robots.every((robot) => ["idle", "moving"].includes(robot.state)));
assert.ok(new Set(robots.filter((robot) => robot.productId).map((robot) => robot.productId)).size === robots.filter((robot) => robot.productId).length);

console.log("PASS: canonical dataset and LINE_DATA compatibility alias");
console.log("PASS: deterministic engine, single-line and multi-line example scenarios");
console.log("PASS: slot/robot occupancy uniqueness, capacity bounds, finite non-negative KPIs");
console.log("PASS: pause/resume/reset and snapshot occupancy invariants");
console.log("PASS: configurable capacity 10/20 with assumption label");

// Every product must complete both robot cells in order, including the belt hand-offs.
const sequentialData = JSON.parse(JSON.stringify(factory));
sequentialData.multiLineExample.arrivalIntervalSec = .5;
sequentialData.multiLineExample.robotTransferSec = .5;
sequentialData.multiLineExample.conveyorTransferSec = .5;
sequentialData.multiLineExample.stations.forEach(station => { station.cycleTimeSec = 1; });
const sequential = context.window.AVNSim.createSim(sequentialData, 'multi_line_example');
const expectedRoute = ['A', 'B', 'C', 'D', 'VISION', 'LABEL'];
const transferPairs = new Set();
for (let step = 0; step < 1800; step += 1) {
  sequential.step();
  const state = sequential.snapshot();
  verifyState(state);
  state.products.forEach(product => {
    assert.equal(JSON.stringify(product.completedStages), JSON.stringify(expectedRoute.slice(0, product.completedStages.length)));
  });
  state.robots.forEach(robot => {
    if (robot.state !== 'moving') return;
    transferPairs.add(`${robot.id}:${robot.from.stationId || 'CONVEYOR'}>${robot.to.stationId || 'CONVEYOR'}`);
  });
}
assert.ok(sequential.snapshot().kpis.passed > 0, 'sequential multi-line must produce completed products');
for (const pair of ['R1:CONVEYOR>A', 'R1:A>B', 'R1:B>CONVEYOR', 'R2:CONVEYOR>C', 'R2:C>D', 'R2:D>CONVEYOR']) {
  assert.ok(transferPairs.has(pair), `missing transfer: ${pair}`);
}

// A can actually inspect twelve products concurrently, rather than queue twelve for one PC.
const capacityData = JSON.parse(JSON.stringify(sequentialData));
capacityData.multiLineExample.stations[0].cycleTimeSec = 600;
const twelve = context.window.AVNSim.createSim(capacityData, 'multi_line_example');
for (let step = 0; step < 400; step += 1) twelve.step();
const aStation = twelve.snapshot().stations.find(station => station.id === 'A');
assert.equal(aStation.capacity, 12);
assert.equal(aStation.pcs.filter(pc => pc.state === 'busy').length, 12);
verifyState(twelve.snapshot());
const beforeRejectedShrink = JSON.stringify(twelve.snapshot());
assert.throws(() => twelve.setCapacity(10));
assert.equal(JSON.stringify(twelve.snapshot()), beforeRejectedShrink, 'rejected capacity change must be atomic');
twelve.setCapacity(20);
verifyState(twelve.snapshot());
const mutableSnapshot = sequential.snapshot();
mutableSnapshot.products[0].completedStages.push('MUTATED');
assert.ok(!sequential.snapshot().products.some(product => product.completedStages.includes('MUTATED')));
console.log('PASS: sequential A→B→belt→C→D→vision→label, both robots and transfer reservations');
console.log('PASS: 12 simultaneous A inspections, atomic capacity rejection and snapshot isolation');

// Regression: shifting a queue inside Array.find used to strand every product after #1.
// Each live single-line product must have exactly one location, with completed output.
const production = context.window.AVNSim.createSim(factory, 'single_line');
let sawTransit = false, sawRetest = false;
for (let i = 0; i < 6000; i++) {
  const state = production.step();
  verifyState(state);
  state.products.forEach(product => {
    const queueCount = state.stations.reduce((n,station) => n + station.queue.filter(q => q.id === product.id).length, 0);
    const slotCount = state.stations.reduce((n,station) => n + station.slots.filter(slot => slot.productId === product.id).length, 0);
    if (product.state === 'queued') assert.equal(queueCount, 1, `orphaned queue product: ${product.id}`);
    else if (product.state === 'conveyor') {
      sawTransit = true;
      assert.ok(product.transfer.completesAt > state.simTimeSec);
      assert.equal(queueCount + slotCount, 0);
    } else assert.equal(slotCount, 1, `orphaned station product: ${product.id}`);
  });
  state.inspections.forEach(record => {
    assert.ok(Number.isFinite(record.start) && record.start >= 0);
    assert.ok(record.plannedEnd > record.start);
    assert.ok(record.end === null || record.end >= record.start);
    assert.ok(record.end === null || ['pass','fail'].includes(record.result));
    if (record.retest) sawRetest = true;
    if (record.end === null) assert.ok(state.pcs.some(pc => pc.productId === record.productId && pc.inspectionId === record.id));
  });
  state.stations.forEach(station => assert.ok(Number.isFinite(station.utilization) && station.utilization >= 0 && station.utilization <= 1));
}
const recorded = production.snapshot();
assert.ok(recorded.kpis.passed > 10, 'single-line must continuously produce completed output');
assert.ok(sawTransit && sawRetest, 'real conveyor transfers and retests must occur');
assert.ok(recorded.inspections.some(r => r.end !== null));
assert.ok(recorded.metrics.length > 1 && recorded.events.length > 0);
// Observation must neither advance time nor mutate the shared history.
assert.equal(JSON.stringify(production.snapshot()), JSON.stringify(recorded));
recorded.inspections[0].start = -100;
assert.ok(production.snapshot().inspections[0].start >= 0);
production.reset();
assert.equal(production.snapshot().inspections.length, 0);
assert.equal(production.snapshot().events.length, 0);
assert.equal(production.snapshot().metrics.length, 1);
console.log('PASS: continuous single-line output, no orphaned queue/slot products, real conveyor transfers and retests');
console.log('PASS: shared inspection/event/UPH history, finite PC utilization, snapshot isolation and reset');
