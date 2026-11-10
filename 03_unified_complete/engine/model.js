(function (root) {
  "use strict";

  function occupancyHash(state) {
    const stations = state.stations.map((station) => ({
      id: station.id,
      slots: station.slots.map((slot) => [slot.productId, slot.reservedProductId || null]),
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
    const reservations = new Map();
    state.stations.forEach((station) => {
      if (station.slots.length > station.capacity) {
        errors.push(`${station.id}: slot count exceeds capacity`);
      }
      station.slots.forEach((slot, index) => {
        if (slot.reservedProductId) {
          if (slot.productId || reservations.has(slot.reservedProductId)) errors.push(`${slot.reservedProductId}: duplicate slot reservation`);
          reservations.set(slot.reservedProductId, { stationId: station.id, slotIndex: index });
        }
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
    reservations.forEach((reservation, productId) => {
      const robot = state.robots.find(item => item.productId === productId);
      if (!robot || !robot.to || robot.to.stationId !== reservation.stationId || robot.to.slotIndex !== reservation.slotIndex) {
        errors.push(`${productId}: reservation without matching robot transfer`);
      }
    });
    const pcOwners = new Set();
    state.stations.forEach(station => station.pcs.forEach(pc => {
      if (!pc.productId) return;
      if (pcOwners.has(pc.productId) || !station.slots.some(slot => slot.productId === pc.productId)) {
        errors.push(`${pc.productId}: invalid or duplicate inspection owner`);
      }
      pcOwners.add(pc.productId);
    }));
    state.kpis && Object.entries(state.kpis).forEach(([key, value]) => {
      if (!Number.isFinite(value) || value < 0) errors.push(`kpi ${key} is invalid`);
    });
    return { valid: errors.length === 0, errors };
  }

  root.AVNModel = { occupancyHash, validateNoDoubleOccupancy };
})(typeof window === "undefined" ? globalThis : window);
