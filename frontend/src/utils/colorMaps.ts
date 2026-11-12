export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface ColorStop {
  val: number; // Normalized [0, 1] or absolute value
  color: RGB;
}

// NASA MOLA Elevation Palette (-8,000m to +12,000m)
export const MOLA_ELEVATION_STOPS: ColorStop[] = [
  { val: -8000, color: { r: 15, g: 10, b: 75 } },    // Deep Hellas Basin Blue
  { val: -4000, color: { r: 30, g: 80, b: 180 } },   // Lowland Cyan/Blue
  { val: -1000, color: { r: 40, g: 160, b: 150 } },  // Coastal Green-Blue
  { val: 0,     color: { r: 90, g: 180, b: 90 } },   // Datum Level Green
  { val: 2000,  color: { r: 210, g: 200, b: 80 } },  // Plateau Yellow
  { val: 5000,  color: { r: 200, g: 120, b: 50 } },  // Highland Ochre/Brown
  { val: 8000,  color: { r: 160, g: 60, b: 30 } },   // Volcanic Red
  { val: 12000, color: { r: 255, g: 245, b: 240 } }, // Olympus/Tharsis Summit White
];

// Slope Hazard Palette (0° to 30°+)
export const SLOPE_HAZARD_STOPS: ColorStop[] = [
  { val: 0,  color: { r: 34, g: 197, b: 94 } },   // Safe (<5°) Green
  { val: 5,  color: { r: 134, g: 239, b: 172 } }, // Gentle Slope Light Green
  { val: 10, color: { r: 250, g: 204, b: 21 } },  // Moderate (5-15°) Yellow
  { val: 15, color: { r: 249, g: 115, b: 22 } },  // Warning Amber
  { val: 25, color: { r: 239, g: 68, b: 68 } },   // High Hazard (>15°) Red
  { val: 40, color: { r: 153, g: 27, b: 27 } },   // Critical Cliff Dark Red
];

// Surface Roughness Palette (0.0 to 1.0)
export const ROUGHNESS_STOPS: ColorStop[] = [
  { val: 0.0, color: { r: 15, g: 23, b: 42 } },   // Smooth Regolith Dark Blue
  { val: 0.2, color: { r: 56, g: 189, b: 248 } },  // Low Roughness Light Blue
  { val: 0.5, color: { r: 168, g: 85, b: 247 } },  // Medium Boulder Field Purple
  { val: 0.8, color: { r: 244, g: 63, b: 94 } },   // High Ejecta / Bedrock Pink
  { val: 1.0, color: { r: 254, g: 240, b: 138 } }, // Extreme Ruggedness Yellow
];

/**
 * Interpolates an RGB color from an array of color stops.
 */
export function getColorFromStops(value: number, stops: ColorStop[]): RGB {
  if (value <= stops[0].val) return { ...stops[0].color };
  if (value >= stops[stops.length - 1].val) return { ...stops[stops.length - 1].color };

  for (let i = 0; i < stops.length - 1; i++) {
    const s1 = stops[i];
    const s2 = stops[i + 1];
    if (value >= s1.val && value <= s2.val) {
      const t = (value - s1.val) / (s2.val - s1.val);
      return {
        r: Math.round(s1.color.r + t * (s2.color.r - s1.color.r)),
        g: Math.round(s1.color.g + t * (s2.color.g - s1.color.g)),
        b: Math.round(s1.color.b + t * (s2.color.b - s1.color.b)),
      };
    }
  }

  return { ...stops[stops.length - 1].color };
}
