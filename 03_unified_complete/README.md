# Factory Inspection Line Simulator

Open [index.html](index.html) in a browser from a local copy of the repository. The simulator uses bundled scripts, styles, and assets, so it works offline. All seven views share one simulation and its current state.

## Scenarios and controls

- **Single line (`single_line`)** runs the original eight-stage inspection sequence.
- **Robot transfer line (`multi_line_example`)** runs two robot arms, stations A through D, a vision check, and labeling.
- Use the top controls to select a scenario, use its default capacity or set a capacity of 10 or 20, change the speed, pause or resume, and reset.
- Views 01 through 06 show the 2D floor plan, process flow, isometric layout, Three.js layout, Andon board, and inspection timeline by PC. View 07 shows robot transfers in 3D.
- The bundled classic build of Three.js r159 is distributed under the [MIT license](views/04_threejs_3d/vendor/three/LICENSE).

## Original and integrated 3D views

The original standalone Three.js sample shows eight stations along a straight conveyor and a separate reject lane. View 04 brings 3D inspection into the shared simulation. View 07 shows the two robot cells and their conveyor transfers. [Original 3D sample](../01_original_samples/04_threejs_3d/index.html) · [Screenshot gallery](../README.md#3d-views)

## Verification

```sh
node tests/invariants.node.js
sh qa/headless_qa.sh
```

The headless script uses Google Chrome on macOS to check all seven views, robot motion, camera input, and shared controls. It writes screenshots to `qa/screenshots/` and a log to `qa/browser_qa.log`.

## Simulation assumptions

The line, process times, products, and equipment are simulated. The application has no connection to production equipment, PLCs, or a manufacturing execution system. Capacity is configurable and has no fixed physical unit in the model. The example uses 12 concurrent inspections at station A. The other station capacities and process times are illustrative.
