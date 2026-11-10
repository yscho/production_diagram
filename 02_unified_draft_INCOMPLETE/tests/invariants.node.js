"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const context = { window: {} };
vm.createContext(context);
for (const file of ["data/factory.js", "engine/rng.js", "engine/model.js", "engine/sim.js"]) {
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
