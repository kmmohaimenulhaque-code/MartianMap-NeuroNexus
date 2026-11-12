export interface TerrainData {
  width: number;
  height: number;
  elevation: Float32Array; // 1D flattened grid row-major
  slope: Float32Array;     // Slope in degrees
  roughness: Float32Array; // Normalized roughness [0, 1]
  minElevation: number;
  maxElevation: number;
}

export interface LineSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  level: number;
}

export interface FeatureMarker {
  id: string;
  name: string;
  lat: number;
  lon: number;
  x: number; // Grid coordinate X
  y: number; // Grid coordinate Y
  elevation: number;
  type: 'crater' | 'outflow' | 'landing_site' | 'usgs_feature';
}

/**
 * Generates procedural Martian terrain grid modeling Jezero/Gusev crater topography.
 */
export function generateMarsTerrain(width: number, height: number): TerrainData {
  const elevation = new Float32Array(width * height);
  const slope = new Float32Array(width * height);
  const roughness = new Float32Array(width * height);

  let minElevation = Infinity;
  let maxElevation = -Infinity;

  // 1. Generate multi-frequency elevation heightfield
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = x / width - 0.5;
      const ny = y / height - 0.5;
      const idx = y * width + x;

      // Base regional incline & basin rim
      const distFromCenter = Math.sqrt(nx * nx + ny * ny);
      let e = -4000 - distFromCenter * 3500;

      // Impact Craters
      const crater1 = Math.exp(-((nx - 0.1) ** 2 + (ny + 0.1) ** 2) / 0.03) * 3200;
      const crater2 = Math.exp(-((nx + 0.25) ** 2 + (ny - 0.2) ** 2) / 0.012) * 2100;
      const rim = Math.sin(distFromCenter * 18) * 800 * Math.exp(-distFromCenter * 2);

      // Outflow Channel Delta Ridge
      const channel = Math.sin(nx * 12 + ny * 8) * 650;
      const microRoughness = Math.sin(x * 0.25) * Math.cos(y * 0.25) * 180;

      const totalElev = e + crater1 - crater2 + rim + channel + microRoughness;
      elevation[idx] = totalElev;

      if (totalElev < minElevation) minElevation = totalElev;
      if (totalElev > maxElevation) maxElevation = totalElev;
    }
  }

  // 2. Derive spatial gradients for Slope and Surface Roughness
  const cellMeters = 50.0; // 50m spatial resolution per pixel

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;

      const xLeft = x > 0 ? x - 1 : x;
      const xRight = x < width - 1 ? x + 1 : x;
      const yUp = y > 0 ? y - 1 : y;
      const yDown = y < height - 1 ? y + 1 : y;

      const dzdx = (elevation[y * width + xRight] - elevation[y * width + xLeft]) / ((xRight - xLeft) * cellMeters);
      const dzdy = (elevation[yDown * width + x] - elevation[yUp * width + x]) / ((yDown - yUp) * cellMeters);

      const slopeRad = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
      slope[idx] = (slopeRad * 180) / Math.PI;

      // Local 3x3 variance for surface roughness
      let localMin = Infinity;
      let localMax = -Infinity;
      for (let ry = -1; ry <= 1; ry++) {
        for (let rx = -1; rx <= 1; rx++) {
          const cy = Math.min(height - 1, Math.max(0, y + ry));
          const cx = Math.min(width - 1, Math.max(0, x + rx));
          const val = elevation[cy * width + cx];
          if (val < localMin) localMin = val;
          if (val > localMax) localMax = val;
        }
      }
      roughness[idx] = Math.min(1.0, (localMax - localMin) / 400.0);
    }
  }

  return { width, height, elevation, slope, roughness, minElevation, maxElevation };
}

/**
 * Computes solar illumination intensity using solar azimuth and elevation angles.
 */
export function computeSolarHillshade(
  terrain: TerrainData,
  azimuthDeg: number,
  solarElevDeg: number
): Float32Array {
  const { width, height, elevation } = terrain;
  const hillshade = new Float32Array(width * height);

  const azRad = (azimuthDeg * Math.PI) / 180;
  const altRad = (solarElevDeg * Math.PI) / 180;

  const zenRad = Math.PI / 2 - altRad;
  const cellMeters = 50.0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;

      const xLeft = x > 0 ? x - 1 : x;
      const xRight = x < width - 1 ? x + 1 : x;
      const yUp = y > 0 ? y - 1 : y;
      const yDown = y < height - 1 ? y + 1 : y;

      const dzdx = (elevation[y * width + xRight] - elevation[y * width + xLeft]) / ((xRight - xLeft) * cellMeters);
      const dzdy = (elevation[yDown * width + x] - elevation[yUp * width + x]) / ((yDown - yUp) * cellMeters);

      const slopeRad = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
      let aspectRad = Math.atan2(dzdy, -dzdx);
      if (aspectRad < 0) aspectRad += 2 * Math.PI;

      const incidence =
        Math.cos(zenRad) * Math.cos(slopeRad) +
        Math.sin(zenRad) * Math.sin(slopeRad) * Math.cos(azRad - aspectRad);

      hillshade[idx] = Math.max(0.0, Math.min(1.0, incidence));
    }
  }

  return hillshade;
}

/**
 * Extracts contour isolines across the elevation field via Marching Squares.
 */
export function generateContourLines(
  terrain: TerrainData,
  intervalMeters: number
): LineSegment[] {
  const { width, height, elevation, minElevation, maxElevation } = terrain;
  const lines: LineSegment[] = [];

  const startLevel = Math.ceil(minElevation / intervalMeters) * intervalMeters;

  for (let level = startLevel; level <= maxElevation; level += intervalMeters) {
    for (let y = 0; y < height - 1; y++) {
      for (let x = 0; x < width - 1; x++) {
        const v0 = elevation[y * width + x];
        const v1 = elevation[y * width + (x + 1)];
        const v2 = elevation[(y + 1) * width + (x + 1)];
        const v3 = elevation[(y + 1) * width + x];

        let squareIndex = 0;
        if (v0 >= level) squareIndex |= 1;
        if (v1 >= level) squareIndex |= 2;
        if (v2 >= level) squareIndex |= 4;
        if (v3 >= level) squareIndex |= 8;

        if (squareIndex === 0 || squareIndex === 15) continue;

        // Cell edge midpoint interpolation helper
        const interp = (valA: number, valB: number, pA: number, pB: number) => {
          if (Math.abs(valB - valA) < 1e-5) return (pA + pB) / 2;
          return pA + ((level - valA) / (valB - valA)) * (pB - pA);
        };

        const top = { x: interp(v0, v1, x, x + 1), y: y };
        const right = { x: x + 1, y: interp(v1, v2, y, y + 1) };
        const bottom = { x: interp(v3, v2, x, x + 1), y: y + 1 };
        const left = { x: x, y: interp(v0, v3, y, y + 1) };

        switch (squareIndex) {
          case 1: case 14: lines.push({ x1: left.x, y1: left.y, x2: top.x, y2: top.y, level }); break;
          case 2: case 13: lines.push({ x1: top.x, y1: top.y, x2: right.x, y2: right.y, level }); break;
          case 3: case 12: lines.push({ x1: left.x, y1: left.y, x2: right.x, y2: right.y, level }); break;
          case 4: case 11: lines.push({ x1: right.x, y1: right.y, x2: bottom.x, y2: bottom.y, level }); break;
          case 5:
            lines.push({ x1: left.x, y1: left.y, x2: top.x, y2: top.y, level });
            lines.push({ x1: right.x, y1: right.y, x2: bottom.x, y2: bottom.y, level });
            break;
          case 6: case 9: lines.push({ x1: top.x, y1: top.y, x2: bottom.x, y2: bottom.y, level }); break;
          case 7: case 8: lines.push({ x1: left.x, y1: left.y, x2: bottom.x, y2: bottom.y, level }); break;
          case 10:
            lines.push({ x1: top.x, y1: top.y, x2: right.x, y2: right.y, level });
            lines.push({ x1: left.x, y1: left.y, x2: bottom.x, y2: bottom.y, level });
            break;
        }
      }
    }
  }

  return lines;
}
