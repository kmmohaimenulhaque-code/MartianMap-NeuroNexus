/*
 * USGS snapshot overlays (route lines, markers, labels) are drawn in image pixels and were sized for images up
 * to 900 px. Sharper snapshots can be up to 2,048 px, so marks scale by the same factor to keep their on-screen
 * size. Never below 1: small, upsampled snapshots keep the original sizes.
 */
export const SNAPSHOT_DESIGN_PX = 900;

export function snapshotMarkScale(width, height) {
  const side = Math.max(Number(width) || 0, Number(height) || 0);
  return Math.max(1, side / SNAPSHOT_DESIGN_PX);
}
