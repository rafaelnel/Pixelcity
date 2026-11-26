/**
 * Procedural Pixel-Art Textures, Dithering, Architectural Micro-Details,
 * Organic Vegetation, Street Furniture, Pedestrians & Atmospheric Lighting
 * for Pixópolis (64-bit HD Isometric Renderer).
 */

import type { SeasonId, WeatherKind } from './types';

export type TimeOfDayMode = 'auto' | 'day' | 'dusk' | 'night';

export type TreeSpecies =
  | 'oak'
  | 'lime'
  | 'pine'
  | 'cypress'
  | 'palm'
  | 'ipe_gold'
  | 'ipe_pink'
  | 'autumn';

export type FacadeMaterial =
  | 'brick'
  | 'plaster'
  | 'stone'
  | 'concrete'
  | 'wood'
  | 'glass';

export type RoofStyle =
  | 'gable'
  | 'hip'
  | 'flat_parapet'
  | 'terrace'
  | 'mansard'
  | 'skylight';

export type VehicleKind =
  | 'sedan'
  | 'hatch'
  | 'suv'
  | 'van'
  | 'bus'
  | 'truck'
  | 'police'
  | 'fire';

export interface LightingState {
  /** 0 = bright day, 1 = deep night */
  nightFactor: number;
  /** 0 = no sunset glow, 1 = peak golden-hour / dusk */
  duskFactor: number;
  /** 0..1 intensity of lit windows, streetlamp halos, headlights & neon */
  glowStrength: number;
  /** Label in Portuguese for UI indicator */
  phaseLabel: 'Dia' | 'Entardecer' | 'Noite';
  skyTop: string;
  skyMid: string;
  skyBot: string;
  /** Subtle ambient shadow veil applied before emissive glow pass */
  ambientVeil: string;
  /** Warm golden sun rim overlay during dusk */
  warmRimVeil: string;
}

/**
 * Fast, deterministic 32-bit coordinate hash so every tile (x, y) has a unique,
 * repeatable architectural/organic visual seed without mutating CityState.
 */
export function hashCoord(x: number, y: number, salt: number = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return h >>> 0;
}

/** Pick deterministic float in [0, 1) from integer hash */
export function hashFloat(h: number): number {
  return (h & 0xffff) / 65536;
}

/** Determine vehicle class deterministically from entity index & fleet slot */
export function getVehicleKind(variantIdx: number): VehicleKind {
  const m = ((variantIdx % 16) + 16) % 16;
  if (m === 15) return 'fire';
  if (m === 14) return 'police';
  if (m === 13) return 'bus';
  if (m === 11 || m === 12) return 'truck';
  if (m === 9 || m === 10) return 'van';
  if (m === 6 || m === 7 || m === 8) return 'suv';
  if (m === 3 || m === 4 || m === 5) return 'hatch';
  return 'sedan';
}

export const VEHICLE_HIDE_ZOOM_THRESHOLD = 0.705;

/** Hide moving vehicles (cars, boats, planes, helicopters) when zoomed out to 70% or further */
export function shouldHideVehiclesAtZoom(zoom: number): boolean {
  return zoom <= VEHICLE_HIDE_ZOOM_THRESHOLD;
}

export function getSeasonForMonth(month: number): SeasonId {
  const m = ((((month - 1) % 12) + 12) % 12) + 1;
  if (m === 12 || m === 1 || m === 2) return 'summer';
  if (m >= 3 && m <= 5) return 'autumn';
  if (m >= 6 && m <= 8) return 'winter';
  return 'spring';
}

export function getSeasonLabel(season: SeasonId): string {
  switch (season) {
    case 'summer':
      return 'Verão';
    case 'autumn':
      return 'Outono';
    case 'winter':
      return 'Inverno';
    case 'spring':
      return 'Primavera';
  }
}

export function getWeatherLabel(kind: WeatherKind): string {
  switch (kind) {
    case 'clear':
      return 'Céu Limpo';
    case 'partly_cloudy':
      return 'Parcialmente Nublado';
    case 'rain':
      return 'Chuva';
    case 'storm':
      return 'Tempestade';
    case 'snow':
      return 'Neve';
  }
}

/**
 * Compute continuous atmospheric lighting state for Day / Dusk / Night
 * harmonized with active Season (Verão, Outono, Inverno, Primavera) and Weather.
 */
export function getLightingState(
  mode: TimeOfDayMode,
  timeSeconds: number,
  season: SeasonId = 'summer',
  weatherKind: WeatherKind = 'clear',
  weatherIntensity: number = 0.5
): LightingState {
  let nightFactor = 0;
  let duskFactor = 0;

  if (mode === 'day') {
    nightFactor = 0;
    duskFactor = 0.08;
  } else if (mode === 'dusk') {
    nightFactor = 0.38;
    duskFactor = 0.95;
  } else if (mode === 'night') {
    nightFactor = 0.92;
    duskFactor = 0.14;
  } else {
    // Auto scenic cycle (96s): 0..0.44 Day, 0.44..0.64 Dusk, 0.64..0.86 Night, 0.86..1.0 Dawn
    const cycle = ((timeSeconds / 96) % 1 + 1) % 1;
    if (cycle < 0.44) {
      nightFactor = 0;
      duskFactor = 0.08 + Math.max(0, (cycle - 0.32) / 0.12) * 0.35;
    } else if (cycle < 0.64) {
      const t = (cycle - 0.44) / 0.2;
      nightFactor = t * 0.88;
      duskFactor = Math.sin(t * Math.PI);
    } else if (cycle < 0.86) {
      nightFactor = 0.88;
      duskFactor = 0.12;
    } else {
      const t = (cycle - 0.86) / 0.14;
      nightFactor = (1 - t) * 0.88;
      duskFactor = Math.sin(t * Math.PI) * 0.72;
    }
  }

  const overcastFactor =
    weatherKind === 'storm'
      ? 0.62 * Math.max(0.45, weatherIntensity)
      : weatherKind === 'rain'
        ? 0.40 * Math.max(0.4, weatherIntensity)
        : weatherKind === 'snow'
          ? 0.34 * Math.max(0.4, weatherIntensity)
          : weatherKind === 'partly_cloudy'
            ? 0.16 * Math.max(0.4, weatherIntensity)
            : 0;

  const glowStrength = Math.max(
    0,
    Math.min(1, nightFactor * 0.95 + duskFactor * 0.55 + overcastFactor * 0.38)
  );
  const phaseLabel: LightingState['phaseLabel'] =
    nightFactor >= 0.58 ? 'Noite' : duskFactor >= 0.48 ? 'Entardecer' : 'Dia';

  const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
  const rgb = (r: number, g: number, b: number) => `rgb(${r},${g},${b})`;

  // Seasonal clear-day sky tint baseline
  const seasonBase =
    season === 'autumn'
      ? { top: [34, 48, 76], mid: [28, 38, 58], bot: [19, 25, 40] }
      : season === 'winter'
        ? { top: [26, 46, 74], mid: [24, 40, 62], bot: [16, 28, 46] }
        : season === 'spring'
          ? { top: [26, 54, 90], mid: [22, 42, 70], bot: [14, 27, 46] }
          : { top: [28, 48, 82], mid: [20, 34, 60], bot: [13, 22, 38] };

  // Day -> Dusk -> Night sky colors
  let topR = lerp(lerp(seasonBase.top[0], 72, duskFactor), 9, nightFactor);
  let topG = lerp(lerp(seasonBase.top[1], 42, duskFactor), 14, nightFactor);
  let topB = lerp(lerp(seasonBase.top[2], 76, duskFactor), 30, nightFactor);

  let midR = lerp(lerp(seasonBase.mid[0], 118, duskFactor), 12, nightFactor);
  let midG = lerp(lerp(seasonBase.mid[1], 58, duskFactor), 20, nightFactor);
  let midB = lerp(lerp(seasonBase.mid[2], 68, duskFactor), 42, nightFactor);

  let botR = lerp(lerp(seasonBase.bot[0], 62, duskFactor), 7, nightFactor);
  let botG = lerp(lerp(seasonBase.bot[1], 32, duskFactor), 11, nightFactor);
  let botB = lerp(lerp(seasonBase.bot[2], 46, duskFactor), 24, nightFactor);

  if (overcastFactor > 0.01) {
    const cloudTarget =
      weatherKind === 'snow'
        ? [52, 66, 86]
        : weatherKind === 'storm'
          ? [18, 26, 40]
          : [34, 45, 62];
    const cloudBlend = overcastFactor * (1 - nightFactor * 0.55);
    topR = lerp(topR, cloudTarget[0], cloudBlend);
    topG = lerp(topG, cloudTarget[1], cloudBlend);
    topB = lerp(topB, cloudTarget[2], cloudBlend);
    midR = lerp(midR, cloudTarget[0] + 6, cloudBlend);
    midG = lerp(midG, cloudTarget[1] + 6, cloudBlend);
    midB = lerp(midB, cloudTarget[2] + 8, cloudBlend);
    botR = lerp(botR, Math.max(8, cloudTarget[0] - 8), cloudBlend);
    botG = lerp(botG, Math.max(12, cloudTarget[1] - 8), cloudBlend);
    botB = lerp(botB, Math.max(20, cloudTarget[2] - 8), cloudBlend);
  }

  const ambientAlpha = Math.min(0.62, nightFactor * 0.46 + duskFactor * 0.11 + overcastFactor * 0.18);
  const seasonAmbientR = season === 'winter' ? 28 : season === 'autumn' ? 32 : 24;
  const seasonAmbientG = season === 'winter' ? 36 : season === 'autumn' ? 24 : 22;
  const seasonAmbientB = season === 'winter' ? 56 : season === 'autumn' ? 34 : 46;
  const ambientVeil =
    ambientAlpha > 0.01
      ? `rgba(${lerp(seasonAmbientR, 10, nightFactor)}, ${lerp(seasonAmbientG, 18, nightFactor)}, ${lerp(seasonAmbientB, 52, nightFactor)}, ${ambientAlpha.toFixed(3)})`
      : 'rgba(0,0,0,0)';

  const seasonDuskBoost = season === 'autumn' ? 1.18 : season === 'winter' ? 0.72 : 1.0;
  const warmAlpha =
    duskFactor * (1 - nightFactor * 0.6) * (1 - overcastFactor * 0.75) * 0.18 * seasonDuskBoost;
  const warmRimVeil =
    warmAlpha > 0.01
      ? `rgba(255, 148, 72, ${warmAlpha.toFixed(3)})`
      : 'rgba(0,0,0,0)';

  return {
    nightFactor,
    duskFactor,
    glowStrength,
    phaseLabel,
    skyTop: rgb(topR, topG, topB),
    skyMid: rgb(midR, midG, midB),
    skyBot: rgb(botR, botG, botB),
    ambientVeil,
    warmRimVeil,
  };
}

// ============================================================================
// Rich Organic Architectural Color Palettes (16+ per zone — Zero Repetition!)
// ============================================================================

export interface FacadePalette {
  material: FacadeMaterial;
  top: string;
  topHi: string;
  left: string;
  leftBot: string;
  right: string;
  rightBot: string;
  trim: string;
  roofHi: string;
  roofMid: string;
  roofSh: string;
  accent: string;
}

/** 16 Rich, Organic Residential Palettes (Terracotta, Ochre, Sandstone, Pastels, Stone, Timber, Modern) */
export const RESIDENTIAL_PALETTES: readonly FacadePalette[] = [
  // 0: Warm Terracotta Brick + Clay Tiles
  {
    material: 'brick',
    top: '#9c523c', topHi: '#ba684e',
    left: '#cf7457', leftBot: '#a8553d',
    right: '#8c4734', rightBot: '#693224',
    trim: '#f5e6d3', roofHi: '#d96443', roofMid: '#b54a2d', roofSh: '#7d2f1a',
    accent: '#2e6f56',
  },
  // 1: Colonial Cream Stucco + Terracotta Shingles
  {
    material: 'plaster',
    top: '#a86048', topHi: '#c4755a',
    left: '#f4e8d1', leftBot: '#d9c8aa',
    right: '#bfa98a', rightBot: '#998468',
    trim: '#fff9ed', roofHi: '#cc5c3d', roofMid: '#a64328', roofSh: '#702a17',
    accent: '#3b6ea5',
  },
  // 2: Tuscan Ochre Plaster + Slate Roof
  {
    material: 'plaster',
    top: '#6b7887', topHi: '#8a98a8',
    left: '#e6b86a', leftBot: '#c7974a',
    right: '#a87d39', rightBot: '#825d24',
    trim: '#faecd2', roofHi: '#62768c', roofMid: '#48596b', roofSh: '#2e3b4a',
    accent: '#9c3d35',
  },
  // 3: Sage Pastel Heritage + Warm Cedar Roof
  {
    material: 'plaster',
    top: '#8c6244', topHi: '#ab7c59',
    left: '#c8d9c3', leftBot: '#a4ba9e',
    right: '#869c81', rightBot: '#657a61',
    trim: '#f2f7ef', roofHi: '#a86b42', roofMid: '#85502d', roofSh: '#59331a',
    accent: '#4f7a53',
  },
  // 4: Dusty Rose Historic Brick + Copper Slate
  {
    material: 'brick',
    top: '#527870', topHi: '#6d998f',
    left: '#d9a098', leftBot: '#b87c74',
    right: '#945f59', rightBot: '#6e423d',
    trim: '#fae8e6', roofHi: '#5a8f82', roofMid: '#3f6e62', roofSh: '#274a41',
    accent: '#c98842',
  },
  // 5: Limestone Ashlar + Deep Navy Roof
  {
    material: 'stone',
    top: '#536880', topHi: '#7189a6',
    left: '#ded9cc', leftBot: '#bfb8a8',
    right: '#9e9788', rightBot: '#7a7466',
    trim: '#f7f4ec', roofHi: '#4f6d91', roofMid: '#395270', roofSh: '#24364d',
    accent: '#b85042',
  },
  // 6: Coastal Pastel Blue + Warm Clay
  {
    material: 'wood',
    top: '#b3664c', topHi: '#cf7e63',
    left: '#bdd6e6', leftBot: '#98b6c9',
    right: '#7695aa', rightBot: '#577387',
    trim: '#f2f9fc', roofHi: '#cf6846', roofMid: '#a84d30', roofSh: '#73311c',
    accent: '#d99838',
  },
  // 7: Warm Cedar Timber Cabin / Chalet
  {
    material: 'wood',
    top: '#5e4b3c', topHi: '#7d6654',
    left: '#c99363', leftBot: '#a67449',
    right: '#855a35', rightBot: '#613f22',
    trim: '#f5e1c9', roofHi: '#6b5545', roofMid: '#4f3d30', roofSh: '#33261d',
    accent: '#3e7850',
  },
  // 8: Modernist White Concrete + Charcoal Parapet
  {
    material: 'concrete',
    top: '#7d8896', topHi: '#9da9b8',
    left: '#eef2f5', leftBot: '#d3dce3',
    right: '#aeb9c4', rightBot: '#8894a1',
    trim: '#ffffff', roofHi: '#5c6978', roofMid: '#434e5c', roofSh: '#2b333d',
    accent: '#d97736',
  },
  // 9: Buttercream Colonial + Emerald Roof
  {
    material: 'plaster',
    top: '#44755c', topHi: '#5e967a',
    left: '#f5e2a8', leftBot: '#d9c382',
    right: '#b8a265', rightBot: '#917d47',
    trim: '#fff9e6', roofHi: '#4a8565', roofMid: '#33634a', roofSh: '#1f422f',
    accent: '#8c3f38',
  },
  // 10: Burnt Sienna Brick + Iron Gray
  {
    material: 'brick',
    top: '#616975', topHi: '#808a99',
    left: '#b85c42', leftBot: '#94432d',
    right: '#783322', rightBot: '#572215',
    trim: '#ebd5c7', roofHi: '#646e7d', roofMid: '#4a525e', roofSh: '#313740',
    accent: '#e0a943',
  },
  // 11: Warm Taupe Concrete + Glass Balconies
  {
    material: 'concrete',
    top: '#8a8278', topHi: '#aba398',
    left: '#d4cabd', leftBot: '#b5aa9c',
    right: '#91877b', rightBot: '#6e655b',
    trim: '#f2ece4', roofHi: '#787168', roofMid: '#5c564f', roofSh: '#3d3934',
    accent: '#2f82a8',
  },
  // 12: Soft Lavender-Gray Stone + Plum Slate
  {
    material: 'stone',
    top: '#6e637d', topHi: '#8d809e',
    left: '#dad4e3', leftBot: '#bab2c7',
    right: '#968da3', rightBot: '#72697d',
    trim: '#f5f2fa', roofHi: '#75668a', roofMid: '#594b6b', roofSh: '#3b304a',
    accent: '#d48b48',
  },
  // 13: Contemporary Glass & Sandstone Tower
  {
    material: 'glass',
    top: '#6c8ea3', topHi: '#93b6cc',
    left: '#cadbe6', leftBot: '#a3bcc9',
    right: '#728fa1', rightBot: '#506a7a',
    trim: '#eef7fc', roofHi: '#5b8299', roofMid: '#3f6278', roofSh: '#284254',
    accent: '#e6a83c',
  },
  // 14: Sunbaked Adobe Peach + Terracotta
  {
    material: 'plaster',
    top: '#a3563e', topHi: '#c46f54',
    left: '#ebb99b', leftBot: '#cc9778',
    right: '#a8765b', rightBot: '#825740',
    trim: '#fceee6', roofHi: '#cc603d', roofMid: '#a34629', roofSh: '#702d18',
    accent: '#347d78',
  },
  // 15: Dark Slate & Warm Brick Loft
  {
    material: 'brick',
    top: '#4e5866', topHi: '#6b778a',
    left: '#9e5347', leftBot: '#7d3b31',
    right: '#632c24', rightBot: '#451d17',
    trim: '#d9e0e8', roofHi: '#525e6e', roofMid: '#3b4452', roofSh: '#242b36',
    accent: '#f0b849',
  },
];

/** 12 Rich Commercial & Historic Mixed-Use Palettes */
export const COMMERCIAL_PALETTES: readonly FacadePalette[] = [
  {
    material: 'brick',
    top: '#7d8794', topHi: '#9ea9b8',
    left: '#c96d53', leftBot: '#a35039',
    right: '#853e2b', rightBot: '#612a1c',
    trim: '#f7e7d4', roofHi: '#858f9c', roofMid: '#68717d', roofSh: '#474e57',
    accent: '#d94848',
  },
  {
    material: 'stone',
    top: '#8c949e', topHi: '#adb6c2',
    left: '#e6dcc8', leftBot: '#c7bba3',
    right: '#a39782', rightBot: '#7d7260',
    trim: '#faf6ed', roofHi: '#6c7c8c', roofMid: '#51606e', roofSh: '#36414d',
    accent: '#2878b5',
  },
  {
    material: 'plaster',
    top: '#788491', topHi: '#98a6b5',
    left: '#e6c583', leftBot: '#c7a461',
    right: '#a18248', rightBot: '#7a6031',
    trim: '#fcf3dc', roofHi: '#788696', roofMid: '#596675', roofSh: '#3c4552',
    accent: '#2b8a57',
  },
  {
    material: 'glass',
    top: '#6098ba', topHi: '#8dc4e6',
    left: '#3b82b8', leftBot: '#245c8a',
    right: '#1e4b73', rightBot: '#12314f',
    trim: '#d4f0ff', roofHi: '#62a4cc', roofMid: '#437da1', roofSh: '#28526e',
    accent: '#f59e0b',
  },
  {
    material: 'concrete',
    top: '#8a919c', topHi: '#abb4c2',
    left: '#cfd6df', leftBot: '#aeb7c4',
    right: '#848e9e', rightBot: '#616a78',
    trim: '#f2f6fa', roofHi: '#798391', roofMid: '#5c6573', roofSh: '#3e4552',
    accent: '#e05a3a',
  },
  {
    material: 'glass',
    top: '#529c8b', topHi: '#7ec9b8',
    left: '#2f8274', leftBot: '#1d5c52',
    right: '#174740', rightBot: '#0d2e29',
    trim: '#c9faef', roofHi: '#55ab99', roofMid: '#377d6f', roofSh: '#205248',
    accent: '#f0b849',
  },
  {
    material: 'stone',
    top: '#8c7e70', topHi: '#ad9d8e',
    left: '#d9c2ab', leftBot: '#ba9f86',
    right: '#947c66', rightBot: '#705c4a',
    trim: '#f7ece1', roofHi: '#7a6e63', roofMid: '#5c5249', roofSh: '#3d362f',
    accent: '#8a489e',
  },
  {
    material: 'glass',
    top: '#a89268', topHi: '#d4be92',
    left: '#8c7250', leftBot: '#665035',
    right: '#523e27', rightBot: '#362717',
    trim: '#fff0d1', roofHi: '#b0996d', roofMid: '#87724d', roofSh: '#5c4c31',
    accent: '#38bdf8',
  },
  {
    material: 'plaster',
    top: '#75828c', topHi: '#96a5b0',
    left: '#c5d9cc', leftBot: '#9eb8a7',
    right: '#7a9483', rightBot: '#597061',
    trim: '#eef7f1', roofHi: '#6b7e87', roofMid: '#4f6069', roofSh: '#35424a',
    accent: '#c95342',
  },
  {
    material: 'glass',
    top: '#6e7b94', topHi: '#96a6c4',
    left: '#495f82', leftBot: '#2e415e',
    right: '#25354f', rightBot: '#172236',
    trim: '#dbe7fa', roofHi: '#6a7d9e', roofMid: '#4b5d7a', roofSh: '#2f3c52',
    accent: '#ec4899',
  },
  {
    material: 'brick',
    top: '#6e737a', topHi: '#8c939c',
    left: '#a8644f', leftBot: '#854937',
    right: '#693728', rightBot: '#4a2419',
    trim: '#f0dfd5', roofHi: '#68707a', roofMid: '#4e545c', roofSh: '#343940',
    accent: '#14b8a6',
  },
  {
    material: 'concrete',
    top: '#6b7482', topHi: '#8e99ab',
    left: '#7c8899', leftBot: '#5b6675',
    right: '#47515e', rightBot: '#303742',
    trim: '#e2e8f0', roofHi: '#646f80', roofMid: '#495261', roofSh: '#2e3440',
    accent: '#f5b73b',
  },
];

// ============================================================================
// Pixel-Art Texture, Dithering & Isometric Facade Helpers
// ============================================================================

/**
 * Draw pixel-crisp 2×2 / checkerboard Bayer dithering dots inside a clipped region
 * to create rich hand-pixeled tonal transitions on roofs, walls, lawns & asphalt.
 */
export function stampPixelDither(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  step: number = 3,
  seed: number = 0,
  threshold: number = 0.45
): void {
  ctx.fillStyle = color;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.ceil(x + w);
  const y1 = Math.ceil(y + h);
  for (let py = y0; py < y1; py += step) {
    const rowOff = ((py / step) & 1) * Math.floor(step * 0.5);
    for (let px = x0 + rowOff; px < x1; px += step) {
      const hVal = ((px * 31 + py * 17 + seed * 13) & 31) / 32;
      if (hVal < threshold) {
        ctx.fillRect(px, py, 1.2, 1.2);
      }
    }
  }
}

/**
 * Render tactile pixel-art material textures (brick courses, stone blocks, plaster speckle,
 * wood siding, concrete slabs, or glass curtain reflections) skewed cleanly onto both
 * isometric walls of a prism!
 */
export function drawFacadeMaterialTexture(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  halfW: number,
  height: number,
  material: FacadeMaterial,
  seed: number
): void {
  const halfH = halfW / 2;
  ctx.save();

  const clipLeftWall = () => {
    ctx.beginPath();
    ctx.moveTo(cx - halfW, cy - height);
    ctx.lineTo(cx, cy + halfH - height);
    ctx.lineTo(cx, cy + halfH);
    ctx.lineTo(cx - halfW, cy);
    ctx.closePath();
    ctx.clip();
  };

  const clipRightWall = () => {
    ctx.beginPath();
    ctx.moveTo(cx, cy + halfH - height);
    ctx.lineTo(cx + halfW, cy - height);
    ctx.lineTo(cx + halfW, cy);
    ctx.lineTo(cx, cy + halfH);
    ctx.closePath();
    ctx.clip();
  };

  const drawWallSide = (isLeft: boolean) => {
    ctx.save();
    if (isLeft) clipLeftWall();
    else clipRightWall();

    const slope = isLeft ? 0.5 : -0.5;
    const xStart = isLeft ? cx - halfW : cx;
    const yBaseAtStart = isLeft ? cy - height : cy + halfH - height;

    if (material === 'brick') {
      // Staggered isometric brick courses + weathered darker/lighter individual bricks
      const courseH = 3.2;
      const courses = Math.max(2, Math.floor(height / courseH));
      ctx.strokeStyle = isLeft ? 'rgba(40, 18, 12, 0.22)' : 'rgba(20, 8, 6, 0.30)';
      ctx.lineWidth = 0.65;
      for (let r = 1; r < courses; r++) {
        const yOff = r * courseH;
        ctx.beginPath();
        ctx.moveTo(xStart, yBaseAtStart + yOff);
        ctx.lineTo(xStart + halfW, yBaseAtStart + yOff + halfW * slope);
        ctx.stroke();

        // Individual brick color imperfections (organic non-uniform masonry)
        const stagger = (r & 1) * 3;
        for (let bx = 2 + stagger; bx < halfW - 2; bx += 5.5) {
          const bh = hashCoord(r, Math.floor(bx), seed + (isLeft ? 1 : 9));
          const mod = bh % 7;
          if (mod === 0 || mod === 1) {
            ctx.fillStyle =
              mod === 0
                ? isLeft
                  ? 'rgba(255, 220, 190, 0.17)'
                  : 'rgba(255, 200, 170, 0.08)'
                : 'rgba(32, 12, 8, 0.20)';
            const px = xStart + bx;
            const py = yBaseAtStart + yOff - courseH + bx * slope + 0.5;
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(px + 3.6, py + 3.6 * slope);
            ctx.lineTo(px + 3.6, py + 3.6 * slope + courseH - 0.8);
            ctx.lineTo(px, py + courseH - 0.8);
            ctx.closePath();
            ctx.fill();
          }
        }
      }
    } else if (material === 'stone') {
      // Ashlar stone blocks + subtle cornice shadow
      const rowH = 5;
      const rows = Math.max(2, Math.floor(height / rowH));
      ctx.strokeStyle = isLeft ? 'rgba(55, 50, 42, 0.22)' : 'rgba(20, 22, 30, 0.28)';
      ctx.lineWidth = 0.7;
      for (let r = 1; r < rows; r++) {
        const yOff = r * rowH;
        ctx.beginPath();
        ctx.moveTo(xStart, yBaseAtStart + yOff);
        ctx.lineTo(xStart + halfW, yBaseAtStart + yOff + halfW * slope);
        ctx.stroke();
        // Vertical ashlar joints
        const off = (r & 1) * 4;
        for (let vx = 4 + off; vx < halfW - 2; vx += 8) {
          const px = xStart + vx;
          const py = yBaseAtStart + yOff + vx * slope;
          ctx.beginPath();
          ctx.moveTo(px, py - rowH);
          ctx.lineTo(px, py);
          ctx.stroke();
        }
      }
    } else if (material === 'wood') {
      // Horizontal timber clapboard planks
      const plankH = 2.6;
      ctx.strokeStyle = isLeft ? 'rgba(58, 34, 16, 0.24)' : 'rgba(28, 16, 8, 0.30)';
      ctx.lineWidth = 0.65;
      for (let yOff = plankH; yOff < height - 1; yOff += plankH) {
        ctx.beginPath();
        ctx.moveTo(xStart, yBaseAtStart + yOff);
        ctx.lineTo(xStart + halfW, yBaseAtStart + yOff + halfW * slope);
        ctx.stroke();
      }
    } else if (material === 'concrete') {
      // Architectural floor slab seams + vertical concrete ribs + subtle pixel dithering
      const slabH = 8;
      ctx.strokeStyle = isLeft ? 'rgba(30, 40, 56, 0.18)' : 'rgba(12, 18, 30, 0.26)';
      ctx.lineWidth = 0.8;
      for (let yOff = slabH; yOff < height - 2; yOff += slabH) {
        ctx.beginPath();
        ctx.moveTo(xStart, yBaseAtStart + yOff);
        ctx.lineTo(xStart + halfW, yBaseAtStart + yOff + halfW * slope);
        ctx.stroke();
      }
      stampPixelDither(
        ctx,
        xStart,
        yBaseAtStart - halfH,
        halfW,
        height + halfH * 2,
        isLeft ? 'rgba(255,255,255,0.09)' : 'rgba(10,16,28,0.12)',
        3,
        seed + (isLeft ? 3 : 11),
        0.35
      );
    } else if (material === 'glass') {
      // Diagonal sky & horizon reflection streaks on modern curtain-wall facades
      ctx.strokeStyle = isLeft
        ? 'rgba(224, 248, 255, 0.28)'
        : 'rgba(165, 224, 255, 0.14)';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(xStart + halfW * 0.15, yBaseAtStart + 4);
      ctx.lineTo(xStart + halfW * 0.85, yBaseAtStart + Math.min(height - 3, 28));
      ctx.stroke();

      ctx.strokeStyle = isLeft
        ? 'rgba(255, 255, 255, 0.18)'
        : 'rgba(125, 200, 245, 0.10)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(xStart + halfW * 0.05, yBaseAtStart + 14);
      ctx.lineTo(xStart + halfW * 0.58, yBaseAtStart + Math.min(height - 2, 36));
      ctx.stroke();
    } else {
      // Plaster / stucco pixel-dither texture + subtle under-eave shadow
      stampPixelDither(
        ctx,
        xStart,
        yBaseAtStart - halfH,
        halfW,
        height + halfH * 2,
        isLeft ? 'rgba(255, 250, 235, 0.13)' : 'rgba(24, 18, 14, 0.14)',
        3,
        seed + (isLeft ? 5 : 19),
        0.38
      );
    }

    // Subtle under-roof eave cast shadow strip on every facade (adds tremendous 3D depth!)
    ctx.strokeStyle = 'rgba(10, 14, 24, 0.24)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(xStart, yBaseAtStart + 0.9);
    ctx.lineTo(xStart + halfW, yBaseAtStart + 0.9 + halfW * slope);
    ctx.stroke();

    ctx.restore();
  };

  drawWallSide(true);
  drawWallSide(false);
  ctx.restore();
}

/**
 * Draw a detailed pitched isometric roof (gable / duas águas OR hip / 4 águas)
 * with pixel tile courses, sunlit ridge cap, and optional brick chimney!
 */
export function drawPitchedRoof64(
  ctx: CanvasRenderingContext2D,
  cx: number,
  roofBaseY: number,
  halfW: number,
  peakH: number,
  colors: { hi: string; mid: string; sh: string },
  style: 'hip' | 'gable_ne' | 'gable_nw',
  seed: number,
  withChimney: boolean = false
): void {
  const halfH = halfW / 2;
  const apexY = roofBaseY - peakH;

  ctx.save();
  if (style === 'hip') {
    // 4-sided hipped roof with overhanging eaves
    const ov = 1.2;
    const hw = halfW + ov;
    const hh = halfH + ov * 0.5;

    // Back-left slope
    ctx.fillStyle = colors.mid;
    ctx.beginPath();
    ctx.moveTo(cx - hw, roofBaseY);
    ctx.lineTo(cx, roofBaseY - hh);
    ctx.lineTo(cx, apexY);
    ctx.closePath();
    ctx.fill();

    // Back-right slope
    ctx.fillStyle = colors.sh;
    ctx.beginPath();
    ctx.moveTo(cx, roofBaseY - hh);
    ctx.lineTo(cx + hw, roofBaseY);
    ctx.lineTo(cx, apexY);
    ctx.closePath();
    ctx.fill();

    // Front-left sunlit slope
    ctx.fillStyle = colors.hi;
    ctx.beginPath();
    ctx.moveTo(cx - hw, roofBaseY);
    ctx.lineTo(cx, roofBaseY + hh);
    ctx.lineTo(cx, apexY);
    ctx.closePath();
    ctx.fill();

    // Front-right shaded slope
    ctx.fillStyle = colors.sh;
    ctx.beginPath();
    ctx.moveTo(cx, roofBaseY + hh);
    ctx.lineTo(cx + hw, roofBaseY);
    ctx.lineTo(cx, apexY);
    ctx.closePath();
    ctx.fill();

    // Shingle/tile horizontal course lines on sunlit front-left slope
    ctx.strokeStyle = 'rgba(28, 12, 8, 0.25)';
    ctx.lineWidth = 0.7;
    for (let t = 0.28; t <= 0.82; t += 0.26) {
      const lx = cx - hw * t;
      const ly = apexY + (roofBaseY - apexY) * t;
      const mx = cx;
      const my = apexY + (roofBaseY + hh - apexY) * t;
      const rx = cx + hw * t;
      const ry = ly;
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(mx, my);
      ctx.lineTo(rx, ry);
      ctx.stroke();
    }

    // Crisp sunlit ridge highlight
    ctx.strokeStyle = 'rgba(255, 245, 225, 0.45)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(cx - hw * 0.9, roofBaseY);
    ctx.lineTo(cx, apexY);
    ctx.lineTo(cx, roofBaseY + hh * 0.92);
    ctx.stroke();
  } else {
    // True Gable Roof (Duas Águas) aligned along NE-SW or NW-SE ridge!
    const ov = 1.3;
    const hw = halfW + ov;
    const hh = halfH + ov * 0.5;
    const flip = style === 'gable_nw';
    const r0x = flip ? cx - hw * 0.5 : cx + hw * 0.5;
    const r0y = apexY - hh * 0.5;
    const r1x = flip ? cx + hw * 0.5 : cx - hw * 0.5;
    const r1y = apexY + hh * 0.5;

    if (!flip) {
      // Ridge runs NE (top-right) to SW (bottom-left)
      // Back slope
      ctx.fillStyle = colors.mid;
      ctx.beginPath();
      ctx.moveTo(cx - hw, roofBaseY);
      ctx.lineTo(cx, roofBaseY - hh);
      ctx.lineTo(r0x, r0y);
      ctx.lineTo(r1x, r1y);
      ctx.closePath();
      ctx.fill();

      // Front sunlit/shaded slope facing SE
      ctx.fillStyle = colors.sh;
      ctx.beginPath();
      ctx.moveTo(cx, roofBaseY + hh);
      ctx.lineTo(cx + hw, roofBaseY);
      ctx.lineTo(r0x, r0y);
      ctx.lineTo(r1x, r1y);
      ctx.closePath();
      ctx.fill();

      // Front-left triangular gable pediment wall
      ctx.fillStyle = colors.hi;
      ctx.beginPath();
      ctx.moveTo(cx - hw, roofBaseY);
      ctx.lineTo(cx, roofBaseY + hh);
      ctx.lineTo(r1x, r1y);
      ctx.closePath();
      ctx.fill();
    } else {
      // Ridge runs NW (top-left) to SE (bottom-right)
      // Sunlit SW slope
      ctx.fillStyle = colors.hi;
      ctx.beginPath();
      ctx.moveTo(cx - hw, roofBaseY);
      ctx.lineTo(cx, roofBaseY + hh);
      ctx.lineTo(r1x, r1y);
      ctx.lineTo(r0x, r0y);
      ctx.closePath();
      ctx.fill();

      // Shaded NE slope
      ctx.fillStyle = colors.mid;
      ctx.beginPath();
      ctx.moveTo(cx, roofBaseY - hh);
      ctx.lineTo(cx + hw, roofBaseY);
      ctx.lineTo(r1x, r1y);
      ctx.lineTo(r0x, r0y);
      ctx.closePath();
      ctx.fill();

      // Front-right gable triangle
      ctx.fillStyle = colors.sh;
      ctx.beginPath();
      ctx.moveTo(cx, roofBaseY + hh);
      ctx.lineTo(cx + hw, roofBaseY);
      ctx.lineTo(r1x, r1y);
      ctx.closePath();
      ctx.fill();
    }

    // Tile course striping along ridge
    ctx.strokeStyle = 'rgba(20, 10, 8, 0.25)';
    ctx.lineWidth = 0.7;
    for (let s = 1; s <= 3; s++) {
      const f = s / 4;
      const sx = r0x + (r1x - r0x) * f;
      const sy = r0y + (r1y - r0y) * f;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + (flip ? -hw * 0.45 : hw * 0.45), sy + peakH * 0.72);
      ctx.stroke();
    }

    // Ridge beam highlight
    ctx.strokeStyle = 'rgba(255, 245, 220, 0.55)';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(r0x, r0y);
    ctx.lineTo(r1x, r1y);
    ctx.stroke();
  }

  // Optional pixel-art brick chimney with subtle soot cap
  if (withChimney) {
    const chX = cx + ((seed % 2 === 0) ? 4.5 : -5.5);
    const chY = apexY + 4;
    ctx.fillStyle = '#8c4234';
    ctx.fillRect(chX - 2, chY - 6, 2.2, 7);
    ctx.fillStyle = '#5c281f';
    ctx.fillRect(chX + 0.2, chY - 6, 2, 7);
    ctx.fillStyle = '#2d323b';
    ctx.fillRect(chX - 2.3, chY - 7, 4.8, 1.4);
  }
  ctx.restore();
}

/**
 * Draw authentic urban rooftop micro-clutter (blue polyethylene water tanks,
 * HVAC chiller fans, skylights, solar arrays, stairwell bulkheads, TV/radio masts,
 * and rooftop garden pergolas).
 */
export function drawRooftopProps64(
  ctx: CanvasRenderingContext2D,
  cx: number,
  roofY: number,
  halfW: number,
  seed: number,
  tier: 'low' | 'mid' | 'high' | 'commercial' | 'industrial'
): void {
  const r0 = seed % 5;
  const r1 = (seed >> 3) % 4;
  ctx.save();

  // 1. Rooftop Stairwell Bulkhead / Elevator Penthouse (mid & high rise)
  if (tier === 'mid' || tier === 'high' || tier === 'commercial') {
    const bx = cx + (r0 - 2) * 2.2;
    const by = roofY - 1 + ((r1 % 2) ? -1.5 : 1);
    const bw = Math.min(7.5, halfW * 0.34);
    const bh = tier === 'high' ? 8 : 5.5;
    // Cast shadow on roof
    ctx.fillStyle = 'rgba(12, 18, 30, 0.28)';
    ctx.beginPath();
    ctx.moveTo(bx, by + bw * 0.5);
    ctx.lineTo(bx + bw, by);
    ctx.lineTo(bx + bw + 4, by - 1.5);
    ctx.lineTo(bx + 4, by + bw * 0.5 - 1.5);
    ctx.closePath();
    ctx.fill();

    // Sunlit left & shaded right walls
    ctx.fillStyle = '#cfd8e3';
    ctx.beginPath();
    ctx.moveTo(bx - bw, by - bh);
    ctx.lineTo(bx, by + bw * 0.5 - bh);
    ctx.lineTo(bx, by + bw * 0.5);
    ctx.lineTo(bx - bw, by);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#8b97a8';
    ctx.beginPath();
    ctx.moveTo(bx, by + bw * 0.5 - bh);
    ctx.lineTo(bx + bw, by - bh);
    ctx.lineTo(bx + bw, by);
    ctx.lineTo(bx, by + bw * 0.5);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#e6edf5';
    ctx.beginPath();
    ctx.moveTo(bx, by - bh - bw * 0.5);
    ctx.lineTo(bx + bw, by - bh);
    ctx.lineTo(bx, by - bh + bw * 0.5);
    ctx.lineTo(bx - bw, by - bh);
    ctx.closePath();
    ctx.fill();
  }

  // 2. Iconic Brazilian Blue Water Tank (Caixa d'Água) or Wooden Water Tower
  if ((tier === 'low' || tier === 'mid') && r0 <= 2) {
    const wx = cx + (r1 % 2 === 0 ? 7 : -7);
    const wy = roofY - 1.5;
    // Shadow
    ctx.fillStyle = 'rgba(10, 16, 26, 0.32)';
    ctx.beginPath();
    ctx.ellipse(wx + 1.5, wy + 1, 3.6, 1.8, 0, 0, Math.PI * 2);
    ctx.fill();
    // Blue tank body
    ctx.fillStyle = r0 === 0 ? '#1d75b8' : '#268bd2';
    ctx.fillRect(wx - 2.8, wy - 4.2, 5.6, 4.4);
    ctx.fillStyle = '#15548a';
    ctx.fillRect(wx + 0.2, wy - 4.2, 2.6, 4.4);
    // Tank lid
    ctx.fillStyle = '#4fb3f5';
    ctx.beginPath();
    ctx.ellipse(wx, wy - 4.2, 3.0, 1.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 3. Rooftop HVAC / Air-Conditioning Condenser Units
  if (r1 !== 3 && halfW >= 14) {
    const count = tier === 'high' || tier === 'commercial' ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const ax = cx - 8 + i * 6.5 + (r0 % 2) * 2;
      const ay = roofY + 2 - i * 2.5;
      ctx.fillStyle = 'rgba(10, 15, 25, 0.28)';
      ctx.fillRect(ax - 1, ay - 0.5, 5, 2.5);
      ctx.fillStyle = '#dce3ec';
      ctx.fillRect(ax - 2, ay - 3, 4.2, 3);
      ctx.fillStyle = '#9aa5b5';
      ctx.fillRect(ax + 0.2, ay - 3, 2, 3);
      // Dark fan grille dot
      ctx.fillStyle = '#2d3748';
      ctx.fillRect(ax - 1.2, ay - 2.3, 1.6, 1.4);
    }
  }

  // 4. Glass Skylight (Claraboia) OR Solar Panels
  if (r0 === 3 && halfW >= 15) {
    // Glass skylight dome/ridge
    ctx.fillStyle = '#7dd3fc';
    ctx.beginPath();
    ctx.moveTo(cx, roofY - 4);
    ctx.lineTo(cx + 6, roofY - 1);
    ctx.lineTo(cx, roofY + 2);
    ctx.lineTo(cx - 6, roofY - 1);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#e0f2fe';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  } else if (r0 === 4 && halfW >= 16) {
    // Tilted photovoltaic solar panel array
    for (let s = 0; s < 2; s++) {
      const sx = cx - 9 + s * 7;
      const sy = roofY - 1 + s * 2;
      ctx.fillStyle = '#1e3a6e';
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + 5.5, sy - 2.8);
      ctx.lineTo(sx + 8.5, sy - 1.2);
      ctx.lineTo(sx + 3, sy + 1.6);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#93c5fd';
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
  }

  // 5. TV / Radio Antenna Mast
  if ((seed & 7) === 1 || (seed & 7) === 6) {
    const mx = cx + (r1 % 2 === 0 ? -4 : 5);
    const my = roofY - 3;
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(mx, my);
    ctx.lineTo(mx, my - 10);
    ctx.moveTo(mx - 3, my - 7.5);
    ctx.lineTo(mx + 3, my - 8.5);
    ctx.moveTo(mx - 2, my - 5.5);
    ctx.lineTo(mx + 2, my - 6.2);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Draw facade-attached micro-details: balconies with lush potted plants (`varandas`),
 * wall-mounted AC units (`ar-condicionado`), colorful striped shop awnings (`toldos`),
 * and glowing neon/storefront signs (`letreiros`) + entrance marquees (`marquises`).
 */
export function drawFacadeMicroDetails64(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  halfW: number,
  height: number,
  seed: number,
  opts: {
    hasBalconies?: boolean;
    hasAwning?: boolean;
    awningColor?: string;
    hasMarquee?: boolean;
    hasWallAC?: boolean;
    hasSign?: boolean;
    signColor?: string;
  }
): void {
  const halfH = halfW / 2;
  ctx.save();

  // 1. Cantilevered Balconies with Potted Plants on Sunlit Left & Shaded Right Facades
  if (opts.hasBalconies && height >= 22) {
    const tiers = height >= 50 ? 3 : 2;
    for (let t = 1; t <= tiers; t++) {
      const fy = cy - height + (t * height) / (tiers + 1) + 2;
      // Left balcony slab + iron railing + tiny green planters
      const lx0 = cx - halfW * 0.72;
      const ly0 = fy + halfH * 0.28;
      const lx1 = cx - halfW * 0.22;
      const ly1 = fy + halfH * 0.78;
      // Under-balcony shadow
      ctx.strokeStyle = 'rgba(10, 15, 26, 0.36)';
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(lx0, ly0 + 1.8);
      ctx.lineTo(lx1, ly1 + 1.8);
      ctx.stroke();
      // Balcony slab & railing
      ctx.strokeStyle = '#e8edf5';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(lx0, ly0);
      ctx.lineTo(lx1, ly1);
      ctx.stroke();
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 0.85;
      ctx.beginPath();
      ctx.moveTo(lx0, ly0 - 2.2);
      ctx.lineTo(lx1, ly1 - 2.2);
      ctx.stroke();
      // Lush green potted plant & tiny bloom pixel on balcony!
      if ((seed + t) % 2 === 0) {
        const px = (lx0 + lx1) * 0.5;
        const py = (ly0 + ly1) * 0.5 - 2.1;
        ctx.fillStyle = '#389948';
        ctx.beginPath();
        ctx.arc(px, py, 1.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = (seed + t) % 4 === 0 ? '#ff8ec7' : '#8ae068';
        ctx.fillRect(px - 0.8, py - 1.1, 1.4, 1.2);
      }
    }
  }

  // 2. Wall-Mounted Split Air-Conditioner Boxes
  if (opts.hasWallAC && height >= 16) {
    const acCount = height >= 36 ? 2 : 1;
    for (let i = 0; i < acCount; i++) {
      const frac = 0.35 + i * 0.32;
      const ax = cx + halfW * (0.28 + ((seed + i) % 3) * 0.16);
      const ay = cy - height * frac + halfH * (1 - (ax - cx) / halfW);
      ctx.fillStyle = '#cfd8e3';
      ctx.fillRect(ax - 1.5, ay - 1.5, 3.0, 2.2);
      ctx.fillStyle = '#475569';
      ctx.fillRect(ax - 0.9, ay - 1.0, 1.2, 1.2);
    }
  }

  // 3. Striped Fabric Storefront Awning (Toldo) on Left Sunlit Street Wall
  if (opts.hasAwning) {
    const col = opts.awningColor ?? '#d94848';
    const stripes = 6;
    const x0 = cx - halfW * 0.86;
    const y0 = cy - 6.5 + halfH * 0.14;
    const dx = (halfW * 0.72) / stripes;
    const dy = (halfH * 0.72) / stripes;
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = i % 2 === 0 ? col : '#f8fafc';
      ctx.beginPath();
      ctx.moveTo(x0 + i * dx, y0 + i * dy);
      ctx.lineTo(x0 + (i + 1) * dx, y0 + (i + 1) * dy);
      ctx.lineTo(x0 + (i + 1) * dx - 2.2, y0 + (i + 1) * dy + 3.2);
      ctx.lineTo(x0 + i * dx - 2.2, y0 + i * dy + 3.2);
      ctx.closePath();
      ctx.fill();
    }
    // Awning shadow onto storefront window
    ctx.strokeStyle = 'rgba(10, 14, 24, 0.34)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x0 - 1.5, y0 + 4);
    ctx.lineTo(x0 + stripes * dx - 1.5, y0 + stripes * dy + 4);
    ctx.stroke();
  }

  // 4. Entrance Marquee Canopy (Marquise)
  if (opts.hasMarquee) {
    const mx = cx - halfW * 0.42;
    const my = cy - 4 + halfH * 0.58;
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.moveTo(mx - 5, my - 2.5);
    ctx.lineTo(mx + 4, my + 2);
    ctx.lineTo(mx + 1, my + 4.2);
    ctx.lineTo(mx - 8, my - 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#ffe082';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  // 5. Projecting Illuminated Wall Signboard (Letreiro)
  if (opts.hasSign && height >= 18) {
    const sCol = opts.signColor ?? '#f59e0b';
    const sx = cx - halfW * 0.14;
    const sy = cy - Math.min(height * 0.52, 22) + halfH * 0.86;
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(sx - 2.5, sy - 6, 4.5, 9);
    ctx.fillStyle = sCol;
    ctx.fillRect(sx - 1.9, sy - 5.2, 3.3, 7.4);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx - 1.2, sy - 3.6, 1.8, 1.2);
    ctx.fillRect(sx - 1.2, sy - 1.2, 1.8, 1.2);
  }

  ctx.restore();
}

// ============================================================================
// Organic Multi-Species Pixel-Art Trees, Bushes, Flower Beds & Street Furniture
// ============================================================================

/**
 * Render 8 distinct pixel-art tree species with directional sunlight,
 * pixel-dithered leaf clusters, bark highlights & cast ground shadow!
 */
export function drawSpeciesTree64(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  species: TreeSpecies,
  scale: number = 1.0,
  seed: number = 0,
  season: SeasonId = 'summer'
): void {
  const r = 7.2 * scale;
  ctx.save();

  // Directional cast shadow on ground (bottom-right offset matching building shadows)
  ctx.fillStyle = 'rgba(10, 22, 16, 0.36)';
  ctx.beginPath();
  ctx.ellipse(
    x + 3.0 * scale,
    y + 0.6 * scale,
    r * (species === 'cypress' ? 0.85 : 1.15),
    r * 0.48,
    0,
    0,
    Math.PI * 2
  );
  ctx.fill();

  if (species === 'palm') {
    // Curved tropical palm trunk + radiating pixel fronds
    const h = 15 * scale;
    const bend = (seed % 2 === 0 ? 1 : -1) * 3.2 * scale;
    ctx.strokeStyle = '#6e4e34';
    ctx.lineWidth = Math.max(1.8, 2.5 * scale);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + bend * 0.6, y - h * 0.55, x + bend, y - h);
    ctx.stroke();
    ctx.strokeStyle = '#9c7350';
    ctx.lineWidth = Math.max(0.8, 1.0 * scale);
    ctx.beginPath();
    ctx.moveTo(x - 0.5, y);
    ctx.quadraticCurveTo(x + bend * 0.6 - 0.5, y - h * 0.55, x + bend - 0.5, y - h);
    ctx.stroke();

    const topX = x + bend;
    const topY = y - h;
    const fronds = [
      [-8.5, -1.5, '#46a84c'],
      [-6.5, -5.0, '#6ed463'],
      [0.5, -6.5, '#8ee878'],
      [7.5, -4.5, '#52b856'],
      [9.0, -0.5, '#2e7a37'],
      [-4.0, 2.5, '#26692f'],
      [5.0, 2.2, '#225e2a'],
    ] as const;
    for (const [fx, fy, col] of fronds) {
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1.5, 2.1 * scale);
      ctx.beginPath();
      ctx.moveTo(topX, topY);
      ctx.quadraticCurveTo(
        topX + fx * 0.55 * scale,
        topY + (fy - 2.2) * scale,
        topX + fx * scale,
        topY + (fy + 2.5) * scale
      );
      ctx.stroke();
    }
    // Coconuts cluster
    ctx.fillStyle = '#5c3b20';
    ctx.fillRect(topX - 1.2, topY + 0.5, 1.8, 1.8);
    ctx.fillRect(topX + 0.5, topY + 1.0, 1.6, 1.6);
    ctx.restore();
    return;
  }

  if (species === 'cypress') {
    // Tall slender Mediterranean cypress
    const trunkH = 3.5 * scale;
    ctx.fillStyle = '#543926';
    ctx.fillRect(x - 1.1 * scale, y - trunkH, 2.2 * scale, trunkH);

    const h = 17.5 * scale;
    const w = 3.8 * scale;
    const grad = ctx.createLinearGradient(x - w, y - h, x + w, y - trunkH);
    grad.addColorStop(0, '#4f9c54');
    grad.addColorStop(0.55, '#286936');
    grad.addColorStop(1, '#143d20');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x, y - trunkH - h);
    ctx.quadraticCurveTo(x + w * 1.25, y - trunkH - h * 0.35, x + w * 0.8, y - trunkH);
    ctx.lineTo(x - w * 0.8, y - trunkH);
    ctx.quadraticCurveTo(x - w * 1.25, y - trunkH - h * 0.35, x, y - trunkH - h);
    ctx.closePath();
    ctx.fill();
    // Sunlit pixel leaves on left edge
    ctx.fillStyle = '#84cf78';
    ctx.fillRect(x - w * 0.45, y - trunkH - h * 0.65, 1.4, 1.6);
    ctx.fillRect(x - w * 0.55, y - trunkH - h * 0.4, 1.4, 1.6);
    ctx.restore();
    return;
  }

  // Standard trunk
  const trunkW = Math.max(1.8, 2.7 * scale);
  const trunkH = 6.2 * scale;
  ctx.fillStyle = '#4f3724';
  ctx.fillRect(x - trunkW / 2, y - trunkH, trunkW, trunkH);
  ctx.fillStyle = '#855f40';
  ctx.fillRect(x - trunkW / 2, y - trunkH, trunkW * 0.45, trunkH - 0.8);

  const pal =
    season === 'winter'
      ? species === 'pine'
        ? { dark: '#1a3c38', mid: '#2f5f58', light: '#99c4d6', hi: '#eef7ff' }
        : { dark: '#54697d', mid: '#849db3', light: '#c9ddec', hi: '#f4f9ff' }
      : season === 'autumn' && (species === 'oak' || species === 'lime' || species === 'ipe_gold' || species === 'ipe_pink')
        ? seed % 3 === 0
          ? { dark: '#7c2d12', mid: '#c2410c', light: '#f97316', hi: '#fed7aa' }
          : seed % 3 === 1
            ? { dark: '#78350f', mid: '#b45309', light: '#f59e0b', hi: '#fde68a' }
            : { dark: '#7f1d1d', mid: '#b91c1c', light: '#ef4444', hi: '#fca5a5' }
        : season === 'spring' && species === 'oak' && seed % 4 === 0
          ? { dark: '#8c345a', mid: '#d96294', light: '#faa5c8', hi: '#ffe3f0' }
          : species === 'ipe_pink'
            ? { dark: '#8c345a', mid: '#d96294', light: '#faa5c8', hi: '#ffe3f0' }
            : species === 'ipe_gold'
              ? { dark: '#9c6514', mid: '#e0a524', light: '#ffd447', hi: '#fff4ad' }
              : species === 'autumn'
                ? { dark: '#7d2f1a', mid: '#c7592a', light: '#eb9042', hi: '#ffd080' }
                : species === 'lime'
                  ? { dark: '#215726', mid: '#44963c', light: '#82d95b', hi: '#c9f799' }
                  : species === 'pine'
                    ? { dark: '#123624', mid: '#1f5e3a', light: '#3b8c58', hi: '#78c488' }
                    : { dark: '#174223', mid: '#2d7539', light: '#58b850', hi: '#a3eb81' };

  if (species === 'pine') {
    const tiers = [
      { ty: y - trunkH - 0.5, w: r * 1.05, h: r * 1.05 },
      { ty: y - trunkH - r * 0.68, w: r * 0.84, h: r * 1.0 },
      { ty: y - trunkH - r * 1.32, w: r * 0.58, h: r * 0.9 },
    ];
    for (const t of tiers) {
      const grad = ctx.createLinearGradient(x - t.w, t.ty - t.h, x + t.w, t.ty);
      grad.addColorStop(0, pal.light);
      grad.addColorStop(0.55, pal.mid);
      grad.addColorStop(1, pal.dark);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(x, t.ty - t.h);
      ctx.lineTo(x + t.w, t.ty);
      ctx.lineTo(x - t.w, t.ty);
      ctx.closePath();
      ctx.fill();
      if (season === 'winter') {
        // Crisp snow cap resting on upper pine boughs
        ctx.fillStyle = '#f0f7ff';
        ctx.beginPath();
        ctx.moveTo(x, t.ty - t.h);
        ctx.lineTo(x + t.w * 0.55, t.ty - t.h * 0.44);
        ctx.lineTo(x - t.w * 0.62, t.ty - t.h * 0.38);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = pal.hi;
        ctx.fillRect(x - t.w * 0.35, t.ty - t.h * 0.45, 1.4, 1.3);
      }
    }
    ctx.restore();
    return;
  }

  // Broadleaf volumetric canopy with pixel-art leaf-cluster stippling!
  const baseCy = y - trunkH - r * 0.62;
  const lobes: Array<[number, number, number]> = [
    [x + r * 0.36, baseCy + r * 0.14, r * 0.78],
    [x - r * 0.42, baseCy + r * 0.1, r * 0.75],
    [x, baseCy - r * 0.28, r * 0.88],
    [x - r * 0.22, baseCy - r * 0.44, r * 0.54],
  ];
  for (let i = 0; i < lobes.length; i++) {
    const [lx, ly, lr] = lobes[i];
    const grad = ctx.createRadialGradient(
      lx - lr * 0.35,
      ly - lr * 0.35,
      lr * 0.08,
      lx,
      ly,
      lr
    );
    grad.addColorStop(0, i >= 2 ? pal.hi : pal.light);
    grad.addColorStop(0.52, pal.mid);
    grad.addColorStop(1, pal.dark);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(lx, ly, lr, 0, Math.PI * 2);
    ctx.fill();
  }

  // Crisp pixel-art leaf dither flecks on sunlit top-left & shaded bottom-right
  ctx.fillStyle = pal.hi;
  ctx.fillRect(x - r * 0.5, baseCy - r * 0.6, 1.5, 1.5);
  ctx.fillRect(x - r * 0.15, baseCy - r * 0.85, 1.5, 1.5);
  ctx.fillRect(x - r * 0.72, baseCy - r * 0.15, 1.4, 1.4);
  ctx.fillStyle = pal.dark;
  ctx.fillRect(x + r * 0.35, baseCy + r * 0.3, 1.5, 1.5);
  ctx.fillRect(x + r * 0.58, baseCy + r * 0.05, 1.4, 1.4);

  ctx.restore();
}

/** Small blooming flowerbed or clipped shrub with pixel texture */
export function drawBushOrFlowerbed64(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  seed: number,
  withFlowers: boolean = true
): void {
  ctx.save();
  ctx.fillStyle = 'rgba(10, 24, 14, 0.30)';
  ctx.beginPath();
  ctx.ellipse(x + 1, y + 1, 4.2, 2.0, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#256930';
  ctx.beginPath();
  ctx.arc(x - 1.5, y - 0.5, 2.5, 0, Math.PI * 2);
  ctx.arc(x + 1.5, y - 0.2, 2.3, 0, Math.PI * 2);
  ctx.arc(x, y - 1.6, 2.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#68c95b';
  ctx.fillRect(x - 2.1, y - 2.6, 1.5, 1.4);
  ctx.fillRect(x + 0.3, y - 2.9, 1.4, 1.4);

  if (withFlowers) {
    const flCols = ['#ff7eb6', '#ffe066', '#ff8c42', '#e0b0ff', '#fff8e0'];
    ctx.fillStyle = flCols[seed % flCols.length];
    ctx.fillRect(x - 1.8, y - 1.6, 1.4, 1.4);
    ctx.fillRect(x + 1.1, y - 1.8, 1.3, 1.3);
    ctx.fillStyle = flCols[(seed + 2) % flCols.length];
    ctx.fillRect(x - 0.2, y - 0.6, 1.3, 1.3);
  }
  ctx.restore();
}

/** Street furniture micro-props: fire hydrant, trash bin, wooden bench, or vintage lamp */
export function drawStreetProp64(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  kind: 'hydrant' | 'trash' | 'bench' | 'lamp' | 'planter'
): void {
  ctx.save();
  if (kind === 'hydrant') {
    ctx.fillStyle = 'rgba(10,14,22,0.32)';
    ctx.fillRect(x - 0.5, y, 3.2, 1.4);
    ctx.fillStyle = '#c92a2a';
    ctx.fillRect(x - 1.1, y - 3.6, 2.2, 3.8);
    ctx.fillStyle = '#ff6b6b';
    ctx.fillRect(x - 1.1, y - 3.6, 1.0, 3.2);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(x - 1.6, y - 2.8, 3.2, 0.9);
  } else if (kind === 'trash') {
    ctx.fillStyle = 'rgba(10,14,22,0.30)';
    ctx.fillRect(x - 0.8, y, 3.4, 1.4);
    ctx.fillStyle = '#2d6a4f';
    ctx.fillRect(x - 1.4, y - 3.5, 2.8, 3.6);
    ctx.fillStyle = '#52b788';
    ctx.fillRect(x - 1.4, y - 3.5, 1.2, 3.4);
    ctx.fillStyle = '#1b4332';
    ctx.fillRect(x - 1.6, y - 4.0, 3.2, 1.0);
  } else if (kind === 'bench') {
    ctx.fillStyle = 'rgba(10,14,22,0.32)';
    ctx.fillRect(x - 3.2, y + 0.5, 7.2, 2.0);
    // Cast-iron legs
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(x - 3.0, y - 1.5, 1.0, 2.5);
    ctx.fillRect(x + 2.2, y - 1.5, 1.0, 2.5);
    // Warm cedar slats
    ctx.fillStyle = '#9c5d33';
    ctx.fillRect(x - 3.4, y - 2.4, 7.0, 1.4);
    ctx.fillStyle = '#c47b47';
    ctx.fillRect(x - 3.4, y - 3.8, 7.0, 1.2);
  } else if (kind === 'planter') {
    ctx.fillStyle = '#9e533b';
    ctx.fillRect(x - 2.2, y - 2.2, 4.4, 2.5);
    ctx.fillStyle = '#389948';
    ctx.beginPath();
    ctx.arc(x, y - 3.0, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffe066';
    ctx.fillRect(x - 1.0, y - 3.6, 1.2, 1.2);
  } else {
    // Slim wrought-iron streetlamp
    ctx.fillStyle = 'rgba(10,14,22,0.32)';
    ctx.fillRect(x - 0.5, y, 4.5, 1.2);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - 9.5);
    ctx.lineTo(x + 2.2, y - 10.2);
    ctx.stroke();
    ctx.fillStyle = '#fff3b0';
    ctx.fillRect(x + 1.2, y - 10.6, 2.0, 1.6);
  }
  ctx.restore();
}

// ============================================================================
// Subtle Living Pedestrians on Urban Sidewalks & Plazas (Zero-GC!)
// ============================================================================

const PEDESTRIAN_COLORS = [
  '#e05252',
  '#3b82f6',
  '#f59e0b',
  '#10b981',
  '#f8fafc',
  '#a855f7',
  '#ec4899',
  '#d97706',
];

/**
 * Draw 1–2 tiny animated isometric pixel pedestrians strolling along a road sidewalk
 * or park plaza tile. Purely deterministic from (tx, ty, timeSeconds) so zero GC!
 */
export function drawTilePedestrians(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  tileKind: 'road' | 'park' | 'plaza',
  zoom: number,
  timeSeconds: number
): void {
  if (zoom < 0.78) return;
  const h = hashCoord(tx, ty, 911);
  // Only populate ~38% of urban tiles so streets feel lively without clutter
  if (tileKind === 'road' && h % 5 > 1) return;
  const count = tileKind === 'park' || tileKind === 'plaza' ? 2 : 1;
  const s = Math.max(0.75, zoom);

  for (let i = 0; i < count; i++) {
    const ph = hashCoord(tx, ty, 947 + i * 31);
    const speed = 0.24 + (ph % 5) * 0.04;
    const phase = (timeSeconds * speed + (ph % 100) / 100) % 2;
    // Smooth back-and-forth sidewalk stroll (-1 .. +1)
    const t = phase <= 1 ? phase * 2 - 1 : (2 - phase) * 2 - 1;
    const alongNE = (ph & 1) === 0;
    const side = (ph & 2) === 0 ? 1 : -1;

    let ox: number;
    let oy: number;
    if (tileKind === 'road') {
      // Walk strictly on the outer sidewalk curb, never in the asphalt lanes!
      const curbOff = 10.5 * side;
      if (alongNE) {
        ox = t * 7.5 + curbOff * 0.72;
        oy = -t * 3.75 + curbOff * 0.36;
      } else {
        ox = t * 7.5 - curbOff * 0.72;
        oy = t * 3.75 + curbOff * 0.36;
      }
    } else {
      // Stroll gently around park/plaza footpaths
      const angle = timeSeconds * speed * 1.4 + (ph % 628) / 100;
      ox = Math.cos(angle) * 7.5;
      oy = Math.sin(angle) * 3.6;
    }

    const px = sx + ox * zoom;
    const py = sy + oy * zoom;
    const bob = Math.abs(Math.sin(timeSeconds * 7.5 + ph)) * 0.85 * s;

    // Ground shadow
    ctx.fillStyle = 'rgba(8, 12, 20, 0.38)';
    ctx.fillRect(px - 1.0 * s, py + 0.1 * s, 2.2 * s, 0.9 * s);
    // Legs
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(px - 0.65 * s, py - 1.5 * s, 1.3 * s, 1.6 * s);
    // Shirt / Coat
    ctx.fillStyle = PEDESTRIAN_COLORS[ph % PEDESTRIAN_COLORS.length];
    ctx.fillRect(px - 0.9 * s, py - 3.3 * s - bob, 1.8 * s, 2.0 * s);
    // Head
    ctx.fillStyle = (ph & 4) ? '#f2c8a2' : '#c98e63';
    ctx.fillRect(px - 0.65 * s, py - 4.5 * s - bob, 1.3 * s, 1.2 * s);
  }
}

// ============================================================================
// Dynamic Dusk/Night Emissive Illumination Helpers (Lit Windows, Halos, Water)
// ============================================================================

/**
 * Render warm/cool glowing window dots, storefront light spill, streetlamp halos,
 * and sparkling river reflections in screen space during dusk & night.
 */
export function drawTileNightGlow(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  tileType: string,
  level: number,
  zoom: number,
  glowStrength: number,
  timeSeconds: number,
  hasEstablishment: boolean,
  isLotOrigin: boolean = true
): void {
  if (glowStrength < 0.06) return;
  const h = hashCoord(tx, ty, 521);

  if (tileType === 'road') {
    const lv = level || 1;
    // Soft golden streetlamp pools spaced cleanly along avenues, expressways & streets
    if (lv >= 2 || h % 3 === 0) {
      const r = (lv >= 4 ? 11.5 : lv >= 2 ? 9.2 : 7.4) * zoom;
      const ly = sy - (lv >= 3 ? 5.5 : 3.2) * zoom;
      const lx = sx + ((h % 2 === 0 ? -4.5 : 4.5) * zoom);
      const grad = ctx.createRadialGradient(lx, ly, 0.4, lx, ly, r);
      const alpha = (lv >= 2 ? 0.34 : 0.24) * glowStrength;
      grad.addColorStop(0, `rgba(255, 232, 148, ${alpha.toFixed(3)})`);
      grad.addColorStop(0.45, `rgba(255, 184, 82, ${(alpha * 0.42).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(255, 170, 60, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(lx, ly, r, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }

  if (tileType === 'bridge') {
    const r = 10.5 * zoom;
    const grad = ctx.createRadialGradient(sx, sy - 6 * zoom, 0.5, sx, sy - 6 * zoom, r);
    const a = 0.36 * glowStrength;
    grad.addColorStop(
      0,
      level >= 3
        ? `rgba(110, 220, 255, ${a.toFixed(3)})`
        : `rgba(255, 224, 128, ${a.toFixed(3)})`
    );
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(sx, sy - 6 * zoom, r, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  if (tileType === 'water') {
    // Shimmering reflected city lights on river water
    if (h % 4 === 0) {
      const shimmer = 0.55 + 0.45 * Math.sin(timeSeconds * 3.1 + h);
      const a = 0.32 * glowStrength * shimmer;
      ctx.fillStyle =
        h % 8 === 0
          ? `rgba(255, 214, 120, ${a.toFixed(3)})`
          : `rgba(130, 225, 255, ${(a * 0.85).toFixed(3)})`;
      ctx.fillRect(
        sx - 4 * zoom,
        sy + ((h % 3) - 1) * 2 * zoom,
        7.5 * zoom,
        Math.max(1, 1.2 * zoom)
      );
    }
    return;
  }

  if (tileType === 'park') {
    const r = 8.5 * zoom;
    const grad = ctx.createRadialGradient(sx - 4 * zoom, sy - 3 * zoom, 0.4, sx - 4 * zoom, sy - 3 * zoom, r);
    grad.addColorStop(0, `rgba(255, 226, 140, ${(0.30 * glowStrength).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(255, 200, 90, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(sx - 4 * zoom, sy - 3 * zoom, r, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  if (tileType === 'airport') {
    // Glowing runway edge lights (cyan/amber) & red aviation obstruction beacons
    if (h % 2 === 0) {
      const pulse = 0.7 + 0.3 * Math.sin(timeSeconds * 4.5 + h);
      const r = 5.5 * zoom;
      const grad = ctx.createRadialGradient(sx, sy - 2 * zoom, 0.4, sx, sy - 2 * zoom, r);
      const col = h % 6 === 0 ? '56, 189, 248' : '255, 224, 115';
      grad.addColorStop(0, `rgba(${col}, ${(0.36 * glowStrength * pulse).toFixed(3)})`);
      grad.addColorStop(1, `rgba(${col}, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(sx, sy - 2 * zoom, r, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }

  if (tileType === 'stadium') {
    // Crisp stadium floodlight towers only on origin/spaced perimeter tiles (never blows out the green pitch!)
    if (isLotOrigin || h % 4 === 0) {
      const r = 10 * zoom;
      const grad = ctx.createRadialGradient(sx, sy - 10 * zoom, 0.5, sx, sy - 10 * zoom, r);
      grad.addColorStop(0, `rgba(225, 246, 255, ${(0.22 * glowStrength).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(180, 230, 255, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(sx, sy - 10 * zoom, r, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }

  if (
    tileType === 'residential' ||
    tileType === 'commercial' ||
    tileType === 'industrial' ||
    tileType === 'port' ||
    hasEstablishment
  ) {
    // Varied warm (amber/gold/peach) & cool (office cyan/daylight) illuminated windows
    // strictly aligned inside each building's isometric walls!
    const lv = Math.max(1, level || 1);
    const maxH =
      tileType === 'commercial'
        ? lv === 3 ? 34 : lv === 2 ? 18 : 8
        : tileType === 'residential'
          ? lv === 3 ? 30 : lv === 2 ? 16 : 7
          : 11;
    const winCount =
      hasEstablishment
        ? isLotOrigin ? 4 : 2
        : lv === 3
          ? 6
          : lv === 2
            ? 4
            : 2;

    const warmColors = [
      '255, 226, 130', // warm tungsten
      '255, 196, 98',  // amber cozy lamp
      '255, 240, 182', // soft cream
    ];
    const coolColors = [
      '175, 234, 255', // cool office LED
      '215, 240, 255', // crisp fluorescent
    ];

    for (let i = 0; i < winCount; i++) {
      const wh = hashCoord(tx, ty, 701 + i * 29);
      if ((wh & 7) === 0) continue;
      const onLeft = (wh & 1) === 0;
      const fx = 0.14 + (((wh >> 2) % 7) / 10); // 0.14..0.74 tightly within facade width
      const fy = 0.12 + (((wh >> 6) % 8) / 10); // 0.12..0.82 tightly within facade height
      const horiz = (1.4 + fx * 5.2) * zoom;
      const wx = sx + (onLeft ? -horiz : horiz);
      // Respect isometric wall baseline slope (+0.5 inward toward center corner)
      const slopeRise = (1 - fx) * 2.2 * zoom;
      const wy = sy + slopeRise - (2.8 + fy * maxH) * zoom;

      const isCool =
        tileType === 'commercial'
          ? (wh % 3) === 0
          : tileType === 'industrial'
            ? (wh % 2) === 0
            : (wh % 6) === 0;
      const rgbStr = isCool
        ? coolColors[wh % coolColors.length]
        : warmColors[wh % warmColors.length];

      const wW = Math.max(1.0, 1.35 * zoom);
      const wH = Math.max(1.0, 1.2 * zoom);
      ctx.fillStyle = `rgba(${rgbStr}, ${(0.72 * glowStrength).toFixed(3)})`;
      ctx.fillRect(wx - wW * 0.5, wy - wH * 0.5, wW, wH);
    }

    // Subtle storefront / neon sign spill halo (only on origin tile for multi-tile landmarks!)
    if ((tileType === 'commercial' || hasEstablishment) && isLotOrigin) {
      const haloR = (lv >= 3 ? 11 : 7.5) * zoom;
      const hy = sy - (lv >= 3 ? 9 : 3.5) * zoom;
      const grad = ctx.createRadialGradient(sx, hy, 0.4, sx, hy, haloR);
      const neonPalette = [
        '255, 212, 118',
        '110, 224, 255',
        '255, 138, 178',
        '145, 250, 195',
      ];
      const rgbStr = neonPalette[h % neonPalette.length];
      grad.addColorStop(0, `rgba(${rgbStr}, ${(0.20 * glowStrength).toFixed(3)})`);
      grad.addColorStop(1, `rgba(${rgbStr}, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(sx, hy, haloR, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ============================================================================
// 3-Stage Construction / Renovation Animation & Subtle Organic Evolution Glow
// ============================================================================

export type ConstructionStage = 0 | 1 | 2 | 3;

export const CONSTRUCTION_TOTAL_DURATION = 1.75;

/** Check whether a tile type represents a constructible or renovatable zone/building */
export function isConstructibleBuildingType(tileType: string): boolean {
  return (
    tileType === 'rural' ||
    tileType === 'residential' ||
    tileType === 'commercial' ||
    tileType === 'industrial' ||
    tileType === 'park' ||
    tileType === 'port' ||
    tileType === 'airport' ||
    tileType === 'stadium'
  );
}

/**
 * Map a tile's remaining `evolveFlash` timer (counting down from ~1.75s to 0)
 * into a 3-stage construction/renovation sequence:
 * - Stage 1 (Terraplanagem & Fundação / Canteiro): evolveFlash > 1.25
 * - Stage 2 (Estrutura & Andaimes / Guindaste):    0.80 < evolveFlash <= 1.25
 * - Stage 3 (Acabamento & Fachada):               0.36 < evolveFlash <= 0.80
 * - Stage 0 (Concluído + Brilho Sutil Orgânico):  0 <= evolveFlash <= 0.36 (or non-building)
 */
export function getTileConstructionStage(
  evolveFlash: number,
  tileType: string
): ConstructionStage {
  if (evolveFlash <= 0.36 || !isConstructibleBuildingType(tileType)) {
    return 0;
  }
  if (evolveFlash > 1.25) return 1;
  if (evolveFlash > 0.80) return 2;
  return 3;
}

/** Portuguese label for the current construction/renovation stage */
export function getConstructionStageLabel(stage: ConstructionStage): string | null {
  switch (stage) {
    case 1:
      return 'Em Obras — Etapa 1/3 (Fundação)';
    case 2:
      return 'Em Obras — Etapa 2/3 (Estrutura & Andaimes)';
    case 3:
      return 'Em Obras — Etapa 3/3 (Acabamento)';
    default:
      return null;
  }
}

/**
 * Render the 3-stage isometric construction / renovation site for a tile:
 * - Stage 1: Excavated earth & concrete foundation pad, rebar grid, brick/timber pallets, orange-white barriers.
 * - Stage 2: Rising concrete/steel structural columns & floor slabs, full perimeter scaffolding grid, and animated tower crane jib.
 * - Stage 3: Drawn over the emerging building sprite — upper facade scaffolding wrap, protective mesh tarp, crane hook & finishing sparks.
 */
export function drawConstructionStage64(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  halfW: number,
  halfH: number,
  zoom: number,
  tileType: string,
  level: number,
  tx: number,
  ty: number,
  stage: 1 | 2 | 3,
  timeSeconds: number
): void {
  const seed = hashCoord(tx, ty, 811);
  const lv = Math.max(1, level || 1);
  const bw = halfW * 0.82;
  const bh = halfH * 0.82;

  ctx.save();

  if (stage === 1) {
    // --- ETAPA 1: TERRAPLANAGEM, FUNDAÇÃO & CANTEIRO DE OBRAS ---
    // Graded earth & gravel lot diamond
    ctx.fillStyle = '#6b533b';
    ctx.beginPath();
    ctx.moveTo(sx, sy - halfH * 0.94);
    ctx.lineTo(sx + halfW * 0.94, sy);
    ctx.lineTo(sx, sy + halfH * 0.94);
    ctx.lineTo(sx - halfW * 0.94, sy);
    ctx.closePath();
    ctx.fill();

    // Inner concrete foundation slab trench
    ctx.fillStyle = '#8b95a5';
    ctx.beginPath();
    ctx.moveTo(sx, sy - bh * 0.85);
    ctx.lineTo(sx + bw * 0.85, sy);
    ctx.lineTo(sx, sy + bh * 0.85);
    ctx.lineTo(sx - bw * 0.85, sy);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#475569';
    ctx.lineWidth = Math.max(0.8, 1.1 * zoom);
    ctx.stroke();

    // Isometric rebar grid lines & concrete footings inside foundation
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.45)';
    ctx.lineWidth = Math.max(0.6, 0.8 * zoom);
    ctx.beginPath();
    ctx.moveTo(sx - bw * 0.42, sy - bh * 0.42);
    ctx.lineTo(sx + bw * 0.42, sy + bh * 0.42);
    ctx.moveTo(sx + bw * 0.42, sy - bh * 0.42);
    ctx.lineTo(sx - bw * 0.42, sy + bh * 0.42);
    ctx.stroke();

    // Pallet of terracotta bricks & blue construction tarp
    const px = sx - bw * 0.28;
    const py = sy + bh * 0.12;
    ctx.fillStyle = '#b85c38';
    ctx.fillRect(px - 2.5 * zoom, py - 3.2 * zoom, 4.5 * zoom, 3.0 * zoom);
    ctx.fillStyle = '#e07a5f';
    ctx.fillRect(px - 2.5 * zoom, py - 3.2 * zoom, 4.5 * zoom, 1.1 * zoom);

    const txPos = sx + bw * 0.22;
    const tyPos = sy - bh * 0.08;
    ctx.fillStyle = '#2563eb';
    ctx.fillRect(txPos - 2.2 * zoom, tyPos - 2.4 * zoom, 4.2 * zoom, 2.5 * zoom);
    ctx.fillStyle = '#60a5fa';
    ctx.fillRect(txPos - 2.2 * zoom, tyPos - 2.4 * zoom, 4.2 * zoom, 0.9 * zoom);

    // Orange & white safety barriers (cavaletes de obra) at front edges
    const barrierPts: Array<[number, number]> = [
      [sx - bw * 0.62, sy + bh * 0.34],
      [sx + bw * 0.52, sy + bh * 0.38],
      [sx - bw * 0.52, sy - bh * 0.38],
    ];
    for (const [bx, by] of barrierPts) {
      ctx.fillStyle = '#f97316';
      ctx.fillRect(bx - 2.2 * zoom, by - 2.0 * zoom, 4.4 * zoom, 1.4 * zoom);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(bx - 0.6 * zoom, by - 2.0 * zoom, 1.4 * zoom, 1.4 * zoom);
    }

    ctx.restore();
    return;
  }

  // Target structural height in screen pixels for Stage 2 & Stage 3
  const baseStructH =
    (tileType === 'commercial' || tileType === 'residential'
      ? lv >= 4
        ? 38
        : lv === 3
          ? 26
          : lv === 2
            ? 17
            : 11
      : tileType === 'stadium' || tileType === 'airport' || tileType === 'port'
        ? 18
        : 13) * zoom;

  if (stage === 2) {
    // --- ETAPA 2: ESTRUTURA, LAJES, ANDAIMES & GUINDASTE ---
    const structH = baseStructH * 0.72;
    const sw = bw * 0.78;
    const sh = bh * 0.78;

    // Ground concrete plinth pad
    ctx.fillStyle = '#64748b';
    ctx.beginPath();
    ctx.moveTo(sx, sy - bh * 0.9);
    ctx.lineTo(sx + bw * 0.9, sy);
    ctx.lineTo(sx, sy + bh * 0.9);
    ctx.lineTo(sx - bw * 0.9, sy);
    ctx.closePath();
    ctx.fill();

    // Shaded inner structural core prism
    ctx.fillStyle = 'rgba(71, 85, 105, 0.86)';
    ctx.beginPath();
    ctx.moveTo(sx - sw, sy - structH);
    ctx.lineTo(sx, sy + sh - structH);
    ctx.lineTo(sx, sy + sh);
    ctx.lineTo(sx - sw, sy);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(51, 65, 85, 0.90)';
    ctx.beginPath();
    ctx.moveTo(sx, sy + sh - structH);
    ctx.lineTo(sx + sw, sy - structH);
    ctx.lineTo(sx + sw, sy);
    ctx.lineTo(sx, sy + sh);
    ctx.closePath();
    ctx.fill();

    // Protective green/teal construction safety netting on scaffolding
    ctx.fillStyle = 'rgba(20, 184, 166, 0.26)';
    ctx.beginPath();
    ctx.moveTo(sx - sw, sy - structH);
    ctx.lineTo(sx, sy + sh - structH);
    ctx.lineTo(sx + sw, sy - structH);
    ctx.lineTo(sx + sw, sy);
    ctx.lineTo(sx, sy + sh);
    ctx.lineTo(sx - sw, sy);
    ctx.closePath();
    ctx.fill();

    // Concrete floor slabs (lajes) & wooden scaffolding walkways
    const floors = Math.max(2, Math.min(5, lv + 1));
    for (let f = 1; f <= floors; f++) {
      const fy = sy - (structH * f) / floors;
      ctx.strokeStyle = f === floors ? '#cbd5e1' : '#d97706';
      ctx.lineWidth = Math.max(0.85, 1.15 * zoom);
      ctx.beginPath();
      ctx.moveTo(sx - sw, fy);
      ctx.lineTo(sx, fy + sh);
      ctx.lineTo(sx + sw, fy);
      ctx.stroke();
    }

    // Top unfinished concrete roof deck diamond
    ctx.fillStyle = '#94a3b8';
    ctx.beginPath();
    ctx.moveTo(sx, sy - structH - sh);
    ctx.lineTo(sx + sw, sy - structH);
    ctx.lineTo(sx, sy - structH + sh);
    ctx.lineTo(sx - sw, sy - structH);
    ctx.closePath();
    ctx.fill();

    // Vertical steel/timber scaffolding poles along left, center, and right edges
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = Math.max(0.8, 1.05 * zoom);
    const poleOffsets: Array<[number, number]> = [
      [-sw, 0],
      [-sw * 0.5, sh * 0.5],
      [0, sh],
      [sw * 0.5, sh * 0.5],
      [sw, 0],
    ];
    ctx.beginPath();
    for (const [ox, oy] of poleOffsets) {
      ctx.moveTo(sx + ox, sy + oy);
      ctx.lineTo(sx + ox, sy + oy - structH - 2 * zoom);
    }
    ctx.stroke();

    // Mini Yellow Tower Crane (Guindaste de Obra) pivoting gently on top
    const craneBaseX = sx + ((seed & 1) === 0 ? -2.2 : 2.2) * zoom;
    const craneBaseY = sy - structH;
    const mastH = (8.5 + lv * 2.2) * zoom;
    const swing = Math.sin(timeSeconds * 2.4 + seed) * 0.35;
    const boomDx = Math.cos(swing) * 9.5 * zoom * ((seed & 2) === 0 ? 1 : -1);
    const boomDy = Math.sin(swing) * 3.8 * zoom - 2.2 * zoom;

    // Crane mast
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = Math.max(1.1, 1.5 * zoom);
    ctx.beginPath();
    ctx.moveTo(craneBaseX, craneBaseY);
    ctx.lineTo(craneBaseX, craneBaseY - mastH);
    // Jib boom & counter-jib
    ctx.moveTo(craneBaseX - boomDx * 0.35, craneBaseY - mastH - boomDy * 0.35);
    ctx.lineTo(craneBaseX + boomDx, craneBaseY - mastH + boomDy);
    ctx.stroke();

    // Hanging hoist cable & load block
    const hookX = craneBaseX + boomDx * 0.78;
    const hookY = craneBaseY - mastH + boomDy * 0.78;
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = Math.max(0.7, 0.85 * zoom);
    ctx.beginPath();
    ctx.moveTo(hookX, hookY);
    ctx.lineTo(hookX, hookY + 5.2 * zoom);
    ctx.stroke();
    ctx.fillStyle = '#f97316';
    ctx.fillRect(hookX - 1.2 * zoom, hookY + 4.8 * zoom, 2.4 * zoom, 1.8 * zoom);

    ctx.restore();
    return;
  }

  // --- ETAPA 3: ACABAMENTO & FACHADA (Overlay on top of the emerging building sprite) ---
  const sw = bw * 0.82;
  const sh = bh * 0.82;
  const topY = sy - baseStructH * 0.86;
  const bandH = Math.max(6 * zoom, baseStructH * 0.42);

  // Translucent scaffolding safety mesh wrapping the upper stories during final facade work
  ctx.fillStyle = 'rgba(45, 212, 191, 0.18)';
  ctx.beginPath();
  ctx.moveTo(sx - sw, topY);
  ctx.lineTo(sx, topY + sh);
  ctx.lineTo(sx + sw, topY);
  ctx.lineTo(sx + sw, topY + bandH);
  ctx.lineTo(sx, topY + sh + bandH);
  ctx.lineTo(sx - sw, topY + bandH);
  ctx.closePath();
  ctx.fill();

  // Horizontal wooden scaffolding catwalks on upper section
  ctx.strokeStyle = 'rgba(245, 158, 11, 0.82)';
  ctx.lineWidth = Math.max(0.75, 1.0 * zoom);
  for (let r = 0; r <= 2; r++) {
    const ry = topY + (bandH * r) / 2;
    ctx.beginPath();
    ctx.moveTo(sx - sw, ry);
    ctx.lineTo(sx, ry + sh);
    ctx.lineTo(sx + sw, ry);
    ctx.stroke();
  }

  // Vertical scaffolding posts on upper stories
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.78)';
  ctx.beginPath();
  ctx.moveTo(sx - sw, topY);
  ctx.lineTo(sx - sw, topY + bandH);
  ctx.moveTo(sx, topY + sh);
  ctx.lineTo(sx, topY + sh + bandH);
  ctx.moveTo(sx + sw, topY);
  ctx.lineTo(sx + sw, topY + bandH);
  ctx.stroke();

  // Animated welding / facade finishing sparkle glints
  const glintPhase = (timeSeconds * 6 + (seed % 17)) % 3;
  const gx = sx + Math.sin(timeSeconds * 5 + seed) * sw * 0.45;
  const gy = topY + bandH * 0.5 + (glintPhase - 1) * 2.5 * zoom;
  ctx.fillStyle = '#fef08a';
  ctx.fillRect(gx - 1.2 * zoom, gy - 1.2 * zoom, 2.4 * zoom, 2.4 * zoom);

  ctx.restore();
}

/**
 * Render a subtle, organic growth & evolution highlight animation (soft glow + rising pixel sparkles)
 * over any cell that just evolved, upgraded, or had a new zone/road constructed.
 */
export function drawOrganicEvolutionGlow64(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  halfW: number,
  halfH: number,
  zoom: number,
  evolveFlash: number,
  tileType: string,
  level: number,
  tx: number,
  ty: number,
  timeSeconds: number
): void {
  if (evolveFlash <= 0) return;

  const isDecay = tileType === 'abandoned';
  const isHighTier =
    (level || 1) >= 3 ||
    tileType === 'port' ||
    tileType === 'stadium' ||
    tileType === 'airport';

  // Smooth bell-curve & breathing pulse so the highlight feels organic and gentle
  const norm = Math.min(1, evolveFlash / 1.4);
  const pulse = 0.78 + 0.22 * Math.sin(timeSeconds * 7.5 + tx * 1.7 + ty * 2.3);
  const baseAlpha = Math.min(0.44, norm * 0.36 * pulse);

  const rgb = isDecay
    ? '225, 78, 78'
    : isHighTier
      ? '255, 224, 102'
      : '114, 239, 221';

  ctx.save();

  // 1. Soft radial ground/rooftop halo
  const haloR = Math.max(6, halfW * 1.15);
  const haloY = sy - (isGroundOrRoadType(tileType) ? 1 : Math.min(18, (level || 1) * 5)) * zoom;
  const grad = ctx.createRadialGradient(sx, haloY, haloR * 0.08, sx, haloY, haloR);
  grad.addColorStop(0, `rgba(${rgb}, ${(baseAlpha * 0.85).toFixed(3)})`);
  grad.addColorStop(0.55, `rgba(${rgb}, ${(baseAlpha * 0.38).toFixed(3)})`);
  grad.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(sx, haloY, haloR, 0, Math.PI * 2);
  ctx.fill();

  // 2. Crisp luminous isometric cell border highlight
  ctx.strokeStyle = `rgba(${rgb}, ${Math.min(0.72, baseAlpha * 1.45).toFixed(3)})`;
  ctx.lineWidth = Math.max(1.0, 1.35 * zoom);
  ctx.beginPath();
  ctx.moveTo(sx, sy - halfH * 0.96);
  ctx.lineTo(sx + halfW * 0.96, sy);
  ctx.lineTo(sx, sy + halfH * 0.96);
  ctx.lineTo(sx - halfW * 0.96, sy);
  ctx.closePath();
  ctx.stroke();

  // 3. Subtle rising pixel-art sparkle motes (3 motes per evolving cell)
  if (!isDecay) {
    const seed = hashCoord(tx, ty, 337);
    const elapsed = Math.max(0, CONSTRUCTION_TOTAL_DURATION - evolveFlash);
    for (let i = 0; i < 3; i++) {
      const mSeed = seed + i * 73;
      const cycle = ((elapsed * 1.4 + (mSeed % 10) * 0.1) % 1 + 1) % 1;
      const mx = sx + (((mSeed % 13) - 6) / 6) * halfW * 0.62;
      const my = sy - cycle * (14 + (level || 1) * 4) * zoom - (i * 2.5) * zoom;
      const mAlpha = Math.sin(cycle * Math.PI) * Math.min(0.95, norm * 1.15);
      if (mAlpha <= 0.05) continue;

      const sSize = Math.max(1.3, (i === 0 ? 2.2 : 1.7) * zoom);
      ctx.fillStyle =
        i % 2 === 0
          ? `rgba(255, 244, 180, ${mAlpha.toFixed(3)})`
          : `rgba(${rgb}, ${mAlpha.toFixed(3)})`;
      ctx.fillRect(mx - sSize * 0.5, my - sSize * 0.5, sSize, sSize);
    }
  }

  ctx.restore();
}

function isGroundOrRoadType(tileType: string): boolean {
  return (
    tileType === 'grass' ||
    tileType === 'forest' ||
    tileType === 'water' ||
    tileType === 'road' ||
    tileType === 'bridge'
  );
}

