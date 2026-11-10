(function (root) {
  "use strict";

  function occupancyHash(state) {
    const stations = state.stations.map((station) => ({
      id: station.id,
      slots: station.slots.map((slot) => slot.productId),
      queue: station.queue.map((product) => product.id)
    }));
    const robots = state.robots.map((robot) => [robot.id, robot.state, robot.productId, robot.target]);
    const products = state.products.map((product) => [product.id, product.stageId, product.state]);
    return JSON.stringify({ stations, robots, products });
  }

  function validateNoDoubleOccupancy(state) {
    const errors = [];
    const slotOwners = new Map();
    const robotOwners = new Map();
    state.stations.forEach((station) => {
      if (station.slots.length > station.capacity) {
        errors.push(`${station.id}: slot count exceeds capacity`);
      }
      station.slots.forEach((slot, index) => {
        if (slot.productId == null) return;
        if (slotOwners.has(slot.productId)) {
          errors.push(`${slot.productId}: occupied by multiple slots`);
        }
        slotOwners.set(slot.productId, `${station.id}:${index}`);
      });
    });
    state.robots.forEach((robot) => {
      if (robot.productId == null) return;
      if (robotOwners.has(robot.productId) || slotOwners.has(robot.productId)) {
        errors.push(`${robot.productId}: robot/slot duplicate occupancy`);
      }
      robotOwners.set(robot.productId, robot.id);
    });
    state.kpis && Object.entries(state.kpis).forEach(([key, value]) => {
      if (!Number.isFinite(value) || value < 0) errors.push(`kpi ${key} is invalid`);
    });
    return { valid: errors.length === 0, errors };
  }

  root.AVNModel = { occupancyHash, validateNoDoubleOccupancy };
})(typeof window === "undefined" ? globalThis : window);
