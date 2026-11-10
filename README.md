# Factory Inspection Line Simulator

This repository contains six original visualization samples alongside an integrated simulator with seven views powered by one engine.

## Run the simulator

Download or clone the repository, then open `03_unified_complete/index.html` in a browser. The simulator runs offline using the bundled assets. [Setup and controls](03_unified_complete/README.md)

- **Single line** shows the original eight-stage inspection sequence.
- **Robot transfer line** adds two robot arms, stations A through D, a vision check, and labeling.

The scenarios use example data and simulated equipment. The repository also includes the original sample collection and its line data. [Original samples](01_original_samples/) · [Original line data](01_original_samples/data/line.json)

## 3D views

Click any screenshot to open the full-size image.

### Original standalone Three.js

The original 3D sample arranges all eight inspection stations along one straight conveyor. Pallets move between fixtures, and failed units leave on a separate reject lane. Drag to rotate the camera and scroll to zoom. [Original 3D sample](01_original_samples/04_threejs_3d/index.html)

[![Original Three.js view with eight stations along a straight conveyor](03_unified_complete/preview/original_threejs.png)](03_unified_complete/preview/original_threejs.png)

### 04 · Integrated Three.js

The integrated 3D view draws station occupancy and product movement from the same simulation as the other dashboard tabs. The camera stays in place as the simulation advances.

[![Integrated Three.js view of the inspection stations and conveyor](03_unified_complete/preview/04_threejs.png)](03_unified_complete/preview/04_threejs.png)

### 07 · Robot transfer line

Two robot arms move products between the conveyor and stations A through D. The view follows each transfer and includes camera presets for the full line and individual robot cells.

[![Two robot arms beside the conveyor and inspection stations](03_unified_complete/preview/07_robot_line.png)](03_unified_complete/preview/07_robot_line.png)

## Other dashboard views

### 01 · 2D floor plan

[![Top-down floor plan with inspection slots and line status](03_unified_complete/preview/01_topdown.png)](03_unified_complete/preview/01_topdown.png)

### 03 · Isometric layout

[![Isometric layout of the inspection cells and conveyor](03_unified_complete/preview/03_isometric.png)](03_unified_complete/preview/03_isometric.png)

### 06 · Inspection timeline

[![Gantt chart of inspection history by PC](03_unified_complete/preview/06_gantt.png)](03_unified_complete/preview/06_gantt.png)

## Verification

From `03_unified_complete/`, run `node tests/invariants.node.js` to check the simulation rules. Run `sh qa/headless_qa.sh` on macOS with Google Chrome to check the seven views and shared controls.
