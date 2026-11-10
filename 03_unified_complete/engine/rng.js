(function (root) {
  "use strict";

  function mulberry32(seed) {
    let value = seed >>> 0;
    return function nextRandom() {
      value = (value + 0x6D2B79F5) | 0;
      let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
      mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
      return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
  }

  root.AVNRng = { mulberry32 };
})(typeof window === "undefined" ? globalThis : window);
