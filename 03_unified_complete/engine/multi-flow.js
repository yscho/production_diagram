(function (root) {
  'use strict';

  // This helper operates on the common engine runtime; it owns no clock or timer.
  function createFlow(sim, data) {
    const config = data.multiLineExample;
    const transferTime = config.robotTransferSec || 4;
    const beltTime = config.conveyorTransferSec || 6;
    const findProduct = id => sim.products.find(product => product.id === id);
    const findStation = id => sim.stations.find(station => station.id === id);
    const availableSlot = station => station.slots.findIndex(slot => !slot.productId && !slot.reservedProductId);

    function travel(product, from, to, nextAction) {
      product.state = 'conveyor';
      product.stageId = 'CONVEYOR';
      product.slotIndex = null;
      product.nextAction = nextAction;
      product.conveyor = { from, to, startedAt: sim.time, completesAt: sim.time + beltTime };
    }

    function spawn(product) {
      product.completedStages = [];
      travel(product, 'entry', 'pickup1', 'intake1');
    }

    function enterStation(product, station, slotIndex) {
      station.slots[slotIndex] = { productId: product.id, reservedProductId: null };
      product.stageId = station.id;
      product.stageIndex = sim.stations.indexOf(station);
      product.slotIndex = slotIndex;
      product.state = 'waiting_inspection';
      product.conveyor = null;
      product.inspectionStart = null;
      product.inspectionEnd = null;
    }

    function releaseStation(product) {
      const station = findStation(product.stageId);
      if (station && product.slotIndex != null) station.slots[product.slotIndex].productId = null;
      product.slotIndex = null;
    }

    function finishRobot(robot) {
      const product = findProduct(robot.productId);
      if (product) {
        if (robot.to.kind === 'station') {
          enterStation(product, findStation(robot.to.stationId), robot.to.slotIndex);
        } else {
          const first = robot.id === 'R1';
          travel(product, first ? 'return1' : 'return2', first ? 'pickup2' : 'VISION', first ? 'intake2' : 'vision');
        }
      }
      robot.state = 'idle';
      robot.productId = null;
      robot.target = null;
      robot.from = null;
      robot.to = null;
    }

    function beginRobot(robot, product, destinationId) {
      const destination = destinationId ? findStation(destinationId) : null;
      const destinationSlot = destination ? availableSlot(destination) : -1;
      if (destination && destinationSlot < 0) return false;
      const sourceStation = findStation(product.stageId);
      const from = sourceStation
        ? { kind: 'station', stationId: sourceStation.id, slotIndex: product.slotIndex }
        : { kind: 'conveyor', point: robot.id === 'R1' ? 'pickup1' : 'pickup2' };
      releaseStation(product);
      const to = destination
        ? { kind: 'station', stationId: destination.id, slotIndex: destinationSlot }
        : { kind: 'conveyor', point: robot.id === 'R1' ? 'return1' : 'return2' };
      if (destination) destination.slots[destinationSlot].reservedProductId = product.id;
      Object.assign(robot, {
        state: 'moving', productId: product.id, target: destinationId || 'CONVEYOR',
        from, to, startedAt: sim.time, completesAt: sim.time + transferTime
      });
      product.state = 'robot_transfer';
      product.conveyor = null;
      product.robotId = robot.id;
      return true;
    }

    function dispatchRobot(robot) {
      if (robot.state !== 'idle') return;
      const first = robot.id === 'R1';
      const input = first ? 'A' : 'C';
      const output = first ? 'B' : 'D';
      const finishedOutput = sim.products.find(product => product.stageId === output && product.state === 'inspection_complete');
      if (finishedOutput && beginRobot(robot, finishedOutput, null)) return;
      const finishedInput = sim.products.find(product => product.stageId === input && product.state === 'inspection_complete');
      if (finishedInput && beginRobot(robot, finishedInput, output)) return;
      const waiting = sim.products.find(product => product.state === 'waiting_pickup' && product.nextAction === (first ? 'intake1' : 'intake2'));
      if (waiting) beginRobot(robot, waiting, input);
    }

    function advance() {
      // Inspections retain slot ownership until the appropriate robot collects them.
      sim.stations.forEach(station => station.pcs.forEach(pc => {
        if (pc.state !== 'busy' || sim.time < pc.completesAt) return;
        const product = findProduct(pc.productId);
        sim.inspectionFinish(station, pc, true);
        pc.state = 'idle';
        pc.productId = null;
        if (!product) return;
        product.completedStages.push(station.id);
        product.state = 'inspection_complete';
        if (station.id === 'VISION' || station.id === 'LABEL') {
          releaseStation(product);
          travel(product, station.id, station.id === 'VISION' ? 'LABEL' : 'exit', station.id === 'VISION' ? 'label' : 'finish');
        }
      }));
      sim.robots.forEach(robot => {
        if (robot.state === 'moving' && sim.time >= robot.completesAt) finishRobot(robot);
      });
      sim.products.forEach(product => {
        if (product.state !== 'conveyor' || sim.time < product.conveyor.completesAt) return;
        if (product.nextAction === 'finish') {
          product.state = 'passed';
          sim.passed += 1;
        } else if (product.nextAction === 'vision' || product.nextAction === 'label') {
          const station = findStation(product.nextAction === 'vision' ? 'VISION' : 'LABEL');
          const slot = availableSlot(station);
          if (slot >= 0) enterStation(product, station, slot);
        } else {
          product.state = 'waiting_pickup';
        }
      });
      sim.robots.forEach(dispatchRobot);
      sim.stations.forEach(station => {
        station.pcs.forEach(pc => {
          if (pc.state !== 'idle') return;
          const product = sim.products.find(item => item.stageId === station.id && item.state === 'waiting_inspection');
          if (!product) return;
          pc.state = 'busy';
          pc.productId = product.id;
          pc.startedAt = sim.time;
          pc.completesAt = sim.time + station.cycleTimeSec;
          product.state = 'processing';
          product.inspectionStart = pc.startedAt;
          product.inspectionEnd = pc.completesAt;
          sim.inspectionStart(station, pc, product);
        });
        station.queue = sim.products.filter(product => product.stageId === station.id && product.state === 'waiting_inspection').map(product => product.id);
      });
    }

    return { spawn, advance };
  }

  root.AVNMultiFlow = { createFlow };
})(typeof window === 'undefined' ? globalThis : window);
