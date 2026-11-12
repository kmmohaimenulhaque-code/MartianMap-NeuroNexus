import L from "leaflet";

/*
 * Leaflet 1.9 schedules a 250 ms fallback timer for every animated zoom (Map._animateZoom) and a
 * requestAnimationFrame to start it (Map._tryAnimatedZoom); Map.remove() cancels neither. When a map unmounts
 * inside that window (switching GLOBAL CONSOLE -> MARSWALK right after a zoom or the opening fly-in, or MARSWALK
 * replacing its site map), the late callback runs on a removed map whose _mapPane was deleted and throws
 * "Cannot read properties of undefined (reading '_leaflet_pos')". These guards make those late callbacks no-ops.
 */
const proto = L.Map.prototype;

if (!proto._nnRemovalGuards) {
  proto._nnRemovalGuards = true;

  const onZoomTransitionEnd = proto._onZoomTransitionEnd;
  proto._onZoomTransitionEnd = function guardedOnZoomTransitionEnd(...args) {
    if (!this._mapPane) {
      this._animatingZoom = false;
      return undefined;
    }
    return onZoomTransitionEnd.apply(this, args);
  };

  const moveStart = proto._moveStart;
  proto._moveStart = function guardedMoveStart(...args) {
    return this._mapPane ? moveStart.apply(this, args) : this;
  };

  const move = proto._move;
  proto._move = function guardedMove(...args) {
    return this._mapPane ? move.apply(this, args) : this;
  };
}

export const leafletGuardsInstalled = () => Boolean(proto._nnRemovalGuards);
