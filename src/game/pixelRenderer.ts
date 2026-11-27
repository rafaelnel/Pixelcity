import {
  getRotatedGridDims,
  gridToScreen,
  ISO_TILE_H,
  ISO_TILE_W,
  rotateGridCoord,
  rotateRoadMask,
  unrotateGridCoord,
} from './isoMath';
import {
  getMetroNetworkStations,
  getSkyscraperRoofHeightHd,
  getSkyscraperStyleIdx,
  getTile,
  getTrafficSignalState,
  hasSkyscraperHelipad,
  isExternalBorderRoadTile,
  isRoadLike,
  isTollPlazaTile,
  isTrafficLightIntersection,
} from './cityEngine';
import {
  COMMERCIAL_PALETTES,
  drawBushOrFlowerbed64,
  drawConstructionStage64,
  drawFacadeMaterialTexture,
  drawFacadeMicroDetails64,
  drawOrganicEvolutionGlow64,
  drawPitchedRoof64,
  drawPublicWorkConstructionSite64,
  drawRooftopProps64,
  drawSpeciesTree64,
  drawStreetProp64,
  drawTileNightGlow,
  drawTilePedestrians,
  getLightingState,
  getSeasonForMonth,
  getTileConstructionStage,
  getVehicleKind,
  hashCoord,
  RESIDENTIAL_PALETTES,
  shouldHideVehiclesAtZoom,
  stampPixelDither,
  type FacadeMaterial,
  type TimeOfDayMode,
  type TreeSpecies,
  type VehicleKind,
} from './pixelArtHelpers';
import { SECONDS_PER_MONTH_1X } from './simulationConfig';
import type {
  BoatEntity,
  BoatKind,
  CameraRotation,
  CameraState,
  CarEntity,
  CityState,
  EstablishmentId,
  HelicopterEntity,
  MapFilter,
  ParticleEntity,
  PlaneEntity,
  SeasonId,
  Tile,
  WeatherKind,
} from './types';

/**
 * 100% Procedural 64-Bit HD Isometric Pixel-Art Renderer for Pixópolis.
 * Renders every terrain tile, planned road/highway/cloverleaf, evolutionary bridge,
 * textured & coordinate-seeded building, port, stadium, airport, 6-class vehicle fleet,
 * urban pedestrians, cargo vessels, commercial jetliners, and Day/Dusk/Night lighting
 * at 64×32 HD tile density (HD_SCALE = 2) with offscreen sprite caching.
 */

const HD_SCALE = 2; // 64x32 native pixels per isometric tile (4x pixel density over 32-bit)
const TILE_HW = (ISO_TILE_W / 2) * HD_SCALE; // 32
const TILE_HH = (ISO_TILE_H / 2) * HD_SCALE; // 16
const MAX_SPRITE_CACHE_ENTRIES = 4800;

interface CachedSprite {
  canvas: HTMLCanvasElement;
  anchorX: number;
  anchorY: number;
}

const spriteCache = new Map<string, CachedSprite>();

function createSpriteCanvas(
  w: number,
  h: number,
  anchorX: number,
  anchorY: number,
  draw: (ctx: CanvasRenderingContext2D, cx: number, cy: number) => void
): CachedSprite {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  draw(ctx, anchorX, anchorY);
  return { canvas, anchorX, anchorY };
}

function getOrCreateSprite(
  key: string,
  w: number,
  h: number,
  anchorX: number,
  anchorY: number,
  draw: (ctx: CanvasRenderingContext2D, cx: number, cy: number) => void
): CachedSprite {
  const hit = spriteCache.get(key);
  if (hit) return hit;
  if (spriteCache.size >= MAX_SPRITE_CACHE_ENTRIES) {
    // Evict oldest quarter of cached sprites to bound memory without stalling frames
    let removed = 0;
    const target = Math.floor(MAX_SPRITE_CACHE_ENTRIES * 0.25);
    for (const k of spriteCache.keys()) {
      spriteCache.delete(k);
      removed++;
      if (removed >= target) break;
    }
  }
  const created = createSpriteCanvas(w, h, anchorX, anchorY, draw);
  spriteCache.set(key, created);
  return created;
}

/** Transform lot coordinates `(lotDx, lotDy)` of a `lotW × lotH` footprint into active rotated camera space */
function getRotatedLotCoords(
  lotW: number,
  lotH: number,
  lotDx: number,
  lotDy: number,
  rotation: CameraRotation
): { rotW: number; rotH: number; rDx: number; rDy: number; isFrontCorner: boolean } {
  let rotW = lotW;
  let rotH = lotH;
  let rDx = lotDx;
  let rDy = lotDy;
  if (rotation === 1) {
    rotW = lotH;
    rotH = lotW;
    rDx = lotH - 1 - lotDy;
    rDy = lotDx;
  } else if (rotation === 2) {
    rDx = lotW - 1 - lotDx;
    rDy = lotH - 1 - lotDy;
  } else if (rotation === 3) {
    rotW = lotH;
    rotH = lotW;
    rDx = lotDy;
    rDy = lotW - 1 - lotDx;
  }
  return {
    rotW,
    rotH,
    rDx,
    rDy,
    isFrontCorner: rDx === rotW - 1 && rDy === rotH - 1,
  };
}

/** Determine which outer perimeter edges of a multi-tile Port touch river water in rotated camera space (N=1, E=2, S=4, W=8) */
function getPortWaterEdgeMask(state: CityState, tile: Tile, rotation: CameraRotation): number {
  const lotW = tile.lotWidth ?? 1;
  const lotH = tile.lotHeight ?? 1;
  const ax = tile.x - (tile.lotDx ?? 0);
  const ay = tile.y - (tile.lotDy ?? 0);
  let rawMask = 0;
  for (let dx = 0; dx < lotW; dx++) {
    if (getTile(state, ax + dx, ay - 1)?.type === 'water') rawMask |= 1; // North
    if (getTile(state, ax + dx, ay + lotH)?.type === 'water') rawMask |= 4; // South
  }
  for (let dy = 0; dy < lotH; dy++) {
    if (getTile(state, ax + lotW, ay + dy)?.type === 'water') rawMask |= 2; // East
    if (getTile(state, ax - 1, ay + dy)?.type === 'water') rawMask |= 8; // West
  }
  return rotateRoadMask(rawMask, rotation);
}

/** Draw a crisp 64-bit rooftop helipad ('H' pad with perimeter landing lights) */
function drawRooftopHelipad64(
  ctx: CanvasRenderingContext2D,
  hx: number,
  hy: number,
  rx: number = 14
): void {
  const ry = rx * 0.5;
  // Dark non-slip octagonal tarmac pad
  fillDiamond64(ctx, hx, hy, rx, ry, '#1e293b', '#475569', 1.2);
  // Crisp yellow circular safety ring
  ctx.save();
  ctx.strokeStyle = '#facc15';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.ellipse(hx, hy, rx * 0.66, ry * 0.66, 0, 0, Math.PI * 2);
  ctx.stroke();
  // Bold white/yellow isometric 'H' marking
  drawLine64(ctx, hx - rx * 0.25, hy - ry * 0.22, hx - rx * 0.04, hy + ry * 0.22, '#f8fafc', 2.0);
  drawLine64(ctx, hx + rx * 0.04, hy - ry * 0.22, hx + rx * 0.25, hy + ry * 0.22, '#f8fafc', 2.0);
  drawLine64(ctx, hx - rx * 0.14, hy, hx + rx * 0.14, hy, '#f8fafc', 1.8);
  // Corner perimeter amber/green guide beacons
  for (const [bx, by] of [
    [hx - rx * 0.72, hy],
    [hx + rx * 0.72, hy],
    [hx, hy - ry * 0.72],
    [hx, hy + ry * 0.72],
  ]) {
    ctx.fillStyle = '#4ade80';
    ctx.fillRect(bx - 1, by - 1, 2.2, 1.8);
  }
  ctx.restore();
}

// ============================================================================
// 64-Bit HD Isometric Vector & Pixel-Art Shading Primitives
// ============================================================================

/** Smooth 2:1 isometric diamond with optional gradient or stroke */
function fillDiamond64(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
  fill: string | CanvasGradient,
  stroke?: string,
  lineWidth: number = 1
): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - halfH);
  ctx.lineTo(cx + halfW, cy);
  ctx.lineTo(cx, cy + halfH);
  ctx.lineTo(cx - halfW, cy);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

/** Smooth line helper with crisp round caps for cables, trusses, lane markings */
function drawLine64(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  width: number = 1.4
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.restore();
}

/** Soft radial glow halo for streetlamps, beacons, headlights, and floodlights */
function drawGlow64(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  innerColor: string,
  outerColor: string = 'rgba(255, 230, 140, 0)'
): void {
  const grad = ctx.createRadialGradient(x, y, 0.5, x, y, radius);
  grad.addColorStop(0, innerColor);
  grad.addColorStop(1, outerColor);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * 64-Bit Detailed Isometric Architectural Prism:
 * Renders layered directional cast shadow, sunlit left wall gradient, cool shaded right wall,
 * authentic facade material texture (brick, plaster, stone, wood, concrete, glass),
 * base ambient occlusion, recessed roof parapet with pixel dithering, and sunlit corner ridge.
 */
function drawPrism64(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  halfW: number,
  height: number,
  colors: {
    top: string;
    topHi?: string;
    left: string;
    leftBot?: string;
    right: string;
    rightBot?: string;
  },
  opts?: {
    rimColor?: string;
    outlineColor?: string;
    castShadow?: boolean;
    parapet?: boolean;
    material?: FacadeMaterial;
    seed?: number;
  }
): void {
  const halfH = halfW / 2;

  // 1. Layered Directional Cast Shadow (consistent top-left sunlight -> bottom-right shadow)
  if (opts?.castShadow) {
    const shLen = Math.min(28, Math.max(7, height * 0.36));
    ctx.save();
    // Soft outer penumbra
    ctx.fillStyle = 'rgba(8, 13, 24, 0.22)';
    ctx.beginPath();
    ctx.moveTo(cx, cy + halfH + 0.6);
    ctx.lineTo(cx + halfW, cy + 0.4);
    ctx.lineTo(cx + halfW + shLen * 1.12, cy - shLen * 0.26);
    ctx.lineTo(cx + shLen * 1.12, cy + halfH - shLen * 0.26);
    ctx.closePath();
    ctx.fill();
    // Tighter darker umbra near building base
    ctx.fillStyle = 'rgba(6, 10, 20, 0.26)';
    ctx.beginPath();
    ctx.moveTo(cx, cy + halfH);
    ctx.lineTo(cx + halfW, cy);
    ctx.lineTo(cx + halfW + shLen * 0.62, cy - shLen * 0.16);
    ctx.lineTo(cx + shLen * 0.62, cy + halfH - shLen * 0.16);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // 2. Sunlit Left Facade (vertical gradient)
  const leftGrad = ctx.createLinearGradient(cx - halfW, cy - height, cx, cy + halfH);
  leftGrad.addColorStop(0, colors.left);
  leftGrad.addColorStop(1, colors.leftBot ?? colors.left);
  ctx.beginPath();
  ctx.moveTo(cx - halfW, cy - height);
  ctx.lineTo(cx, cy + halfH - height);
  ctx.lineTo(cx, cy + halfH);
  ctx.lineTo(cx - halfW, cy);
  ctx.closePath();
  ctx.fillStyle = leftGrad;
  ctx.fill();

  // 3. Cool Shaded Right Facade
  const rightGrad = ctx.createLinearGradient(cx, cy - height, cx + halfW, cy + halfH);
  rightGrad.addColorStop(0, colors.right);
  rightGrad.addColorStop(1, colors.rightBot ?? colors.right);
  ctx.beginPath();
  ctx.moveTo(cx, cy + halfH - height);
  ctx.lineTo(cx + halfW, cy - height);
  ctx.lineTo(cx + halfW, cy);
  ctx.lineTo(cx, cy + halfH);
  ctx.closePath();
  ctx.fillStyle = rightGrad;
  ctx.fill();

  // 3B. Procedural Pixel-Art Material Texture (brick / plaster / stone / wood / concrete / glass)
  if (opts?.material) {
    drawFacadeMaterialTexture(
      ctx,
      cx,
      cy,
      halfW,
      height,
      opts.material,
      opts.seed ?? 0
    );
  }

  // Subtle base contact ambient occlusion band + dark ground contact line
  const aoH = Math.min(4.5, height * 0.26);
  ctx.fillStyle = 'rgba(8, 12, 22, 0.24)';
  ctx.beginPath();
  ctx.moveTo(cx - halfW, cy - aoH);
  ctx.lineTo(cx, cy + halfH - aoH);
  ctx.lineTo(cx + halfW, cy - aoH);
  ctx.lineTo(cx + halfW, cy);
  ctx.lineTo(cx, cy + halfH);
  ctx.lineTo(cx - halfW, cy);
  ctx.closePath();
  ctx.fill();

  // Crisp 1px architectural outline along outer silhouette edges for pixel-art pop
  ctx.strokeStyle = 'rgba(12, 18, 30, 0.34)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(cx - halfW, cy - height);
  ctx.lineTo(cx - halfW, cy);
  ctx.lineTo(cx, cy + halfH);
  ctx.lineTo(cx + halfW, cy);
  ctx.lineTo(cx + halfW, cy - height);
  ctx.stroke();

  // 4. Sunlit Roof Diamond with directional gradient
  const roofGrad = ctx.createLinearGradient(
    cx - halfW,
    cy - height - halfH,
    cx + halfW,
    cy - height + halfH
  );
  roofGrad.addColorStop(0, colors.topHi ?? colors.top);
  roofGrad.addColorStop(1, colors.top);
  fillDiamond64(
    ctx,
    cx,
    cy - height,
    halfW,
    halfH,
    roofGrad,
    opts?.outlineColor,
    opts?.outlineColor ? 1.0 : 0
  );

  // Optional architectural recessed roof parapet + pixel-dithered gravel roof slab
  if (opts?.parapet && halfW >= 11) {
    const innerW = halfW - 2.4;
    const innerH = halfH - 1.2;
    fillDiamond64(ctx, cx, cy - height + 0.5, innerW, innerH, 'rgba(14, 22, 36, 0.18)');
    // Inner sunlit & shaded parapet lip edges for authentic roof depth
    drawLine64(
      ctx,
      cx - innerW,
      cy - height + 0.5,
      cx,
      cy - height - innerH + 0.5,
      'rgba(10, 16, 28, 0.36)',
      1.0
    );
    drawLine64(
      ctx,
      cx,
      cy - height - innerH + 0.5,
      cx + innerW,
      cy - height + 0.5,
      'rgba(10, 16, 28, 0.24)',
      1.0
    );
    drawLine64(
      ctx,
      cx - innerW,
      cy - height + 0.5,
      cx,
      cy - height + innerH + 0.5,
      'rgba(255, 255, 255, 0.28)',
      0.85
    );
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy - height - innerH + 0.5);
    ctx.lineTo(cx + innerW, cy - height + 0.5);
    ctx.lineTo(cx, cy - height + innerH + 0.5);
    ctx.lineTo(cx - innerW, cy - height + 0.5);
    ctx.closePath();
    ctx.clip();
    stampPixelDither(
      ctx,
      cx - innerW,
      cy - height - innerH,
      innerW * 2,
      innerH * 2,
      'rgba(255,255,255,0.12)',
      3,
      (opts.seed ?? 0) + 7,
      0.32
    );
    ctx.restore();
  }

  // 5. Crisp vertical specular corner highlight ridge along front spine
  if (opts?.rimColor) {
    drawLine64(ctx, cx, cy + halfH - height + 0.5, cx, cy + halfH - 0.5, opts.rimColor, 1.05);
  }
}

/**
 * 64-Bit Architectural Multi-Pane Windows on Both Facades:
 * Properly skewed along the 2:1 isometric wall planes with glass glints, sills,
 * and warm/cool interior lighting color diversity.
 */
function drawWindows64(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  halfW: number,
  height: number,
  floors: number,
  cols: number,
  opts: {
    litColor: string;
    litCoolColor?: string;
    glassLeft: string;
    glassRight: string;
    mullionColor?: string;
    seed: number;
    curtainWall?: boolean;
  }
): void {
  const halfH = halfW / 2;
  const topPad = 3.5;
  const botPad = 3.5;
  const usableH = Math.max(6, height - topPad - botPad);
  const floorStep = usableH / floors;
  const winH = Math.max(2.2, Math.min(floorStep * 0.62, 5.2));
  const colMargin = 2.3;
  const usableW = Math.max(4, halfW - colMargin * 2);
  const colStep = usableW / cols;
  const winW = opts.curtainWall ? colStep * 0.85 : colStep * 0.62;
  const warmAlt = '#ffd27a';
  const coolAlt = opts.litCoolColor ?? '#c4f1ff';

  for (let f = 0; f < floors; f++) {
    const fy = topPad + f * floorStep;
    for (let c = 0; c < cols; c++) {
      const hash = (opts.seed * 37 + f * 19 + c * 13) & 31;
      const u0 = colMargin + c * colStep;
      const u1 = u0 + winW;

      // Left sunlit wall window parallelogram
      const lx0 = cx - halfW + u0;
      const lx1 = cx - halfW + u1;
      const ly0 = cy - height + (u0 / halfW) * halfH + fy;
      const ly1 = cy - height + (u1 / halfW) * halfH + fy;

      const isLitL = hash < 8;
      const litLColor = hash === 2 ? coolAlt : hash < 4 ? opts.litColor : warmAlt;
      ctx.beginPath();
      ctx.moveTo(lx0, ly0);
      ctx.lineTo(lx1, ly1);
      ctx.lineTo(lx1, ly1 + winH);
      ctx.lineTo(lx0, ly0 + winH);
      ctx.closePath();
      ctx.fillStyle = isLitL ? litLColor : opts.glassLeft;
      ctx.fill();

      // Window sill highlight on non-curtain walls + specular glass reflection
      if (!opts.curtainWall) {
        ctx.strokeStyle = 'rgba(255, 250, 235, 0.35)';
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(lx0, ly0 + winH + 0.4);
        ctx.lineTo(lx1, ly1 + winH + 0.4);
        ctx.stroke();
      }
      if (!isLitL) {
        ctx.strokeStyle = 'rgba(224, 246, 255, 0.40)';
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(lx0 + 0.4, ly0 + 0.7);
        ctx.lineTo(lx1 - 0.4, ly1 + 0.7);
        ctx.stroke();
      }

      // Right shaded wall window parallelogram
      const rx0 = cx + u0;
      const rx1 = cx + u1;
      const ry0 = cy - height + halfH - (u0 / halfW) * halfH + fy;
      const ry1 = cy - height + halfH - (u1 / halfW) * halfH + fy;

      const isLitR = hash === 1 || hash === 9 || hash === 17 || hash === 25;
      const litRColor = hash === 9 ? coolAlt : hash === 1 ? opts.litColor : warmAlt;
      ctx.beginPath();
      ctx.moveTo(rx0, ry0);
      ctx.lineTo(rx1, ry1);
      ctx.lineTo(rx1, ry1 + winH);
      ctx.lineTo(rx0, ry0 + winH);
      ctx.closePath();
      ctx.fillStyle = isLitR ? litRColor : opts.glassRight;
      ctx.fill();

      if (opts.mullionColor) {
        ctx.strokeStyle = opts.mullionColor;
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
    }
  }
}

/** Volumetric pixel-art tree supporting legacy aliases + all 8 organic tree species */
function drawTree64(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  style: 'emerald' | 'lime' | 'blossom' | 'pine' | TreeSpecies,
  scale: number = 1.0,
  seed: number = 0
): void {
  const mapped: TreeSpecies =
    style === 'emerald'
      ? 'oak'
      : style === 'blossom'
        ? 'ipe_pink'
        : style;
  drawSpeciesTree64(ctx, x, y, mapped, scale, seed);
}

// ============================================================================
// Procedural 64-Bit HD Isometric Tile & Landmark Sprite Builders
// ============================================================================

function getGrassSprite(variant: number, season: SeasonId = 'summer'): CachedSprite {
  const v = ((variant % 8) + 8) % 8;
  return getOrCreateSprite(`grass64_v4_${season}_${v}`, 70, 44, 35, 23, (ctx, cx, cy) => {
    const seasonalCols: Record<SeasonId, string[]> = {
      summer: ['#51913e', '#539440', '#4f8e3c', '#549541', '#50903d', '#52933f', '#4f8f3d', '#549641'],
      spring: ['#5ca342', '#60a846', '#599f3f', '#62aa48', '#5ba241', '#5ea644', '#589e3e', '#61a947'],
      autumn: ['#797f3a', '#7d813d', '#757a37', '#81833f', '#787e39', '#7b803b', '#747936', '#80843e'],
      winter: ['#dbe8f5', '#dfebf7', '#d5e4f2', '#e2eef9', '#d8e6f4', '#ddeaf6', '#d4e3f1', '#e0edf8'],
    };
    const baseCol = seasonalCols[season][v];
    fillDiamond64(ctx, cx, cy, TILE_HW + 1.0, TILE_HH + 0.6, baseCol);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy - TILE_HH);
    ctx.lineTo(cx + TILE_HW, cy);
    ctx.lineTo(cx, cy + TILE_HH);
    ctx.lineTo(cx - TILE_HW, cy);
    ctx.closePath();
    ctx.clip();

    ctx.fillStyle =
      season === 'winter'
        ? 'rgba(155, 184, 214, 0.34)'
        : season === 'autumn'
          ? 'rgba(84, 62, 24, 0.22)'
          : 'rgba(34, 78, 26, 0.22)';
    ctx.beginPath();
    ctx.ellipse(cx - 10 + (v % 4) * 4, cy - 1 + (v % 2) * 2, 7.5, 3.0, 0.18, 0, Math.PI * 2);
    ctx.ellipse(cx + 9 - (v % 3) * 3, cy + 3, 6.5, 2.5, -0.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle =
      season === 'winter'
        ? 'rgba(255, 255, 255, 0.45)'
        : season === 'autumn'
          ? 'rgba(218, 168, 72, 0.24)'
          : 'rgba(136, 212, 98, 0.24)';
    ctx.beginPath();
    ctx.ellipse(cx - 4 + (v % 3) * 3, cy + 2, 5.5, 2.2, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + 8, cy - 4 + (v % 2) * 2, 4.8, 1.9, 0, 0, Math.PI * 2);
    ctx.fill();

    stampPixelDither(
      ctx,
      cx - 26,
      cy - 13,
      52,
      26,
      season === 'winter'
        ? 'rgba(255, 255, 255, 0.38)'
        : season === 'autumn'
          ? 'rgba(232, 164, 66, 0.28)'
          : 'rgba(165, 232, 118, 0.30)',
      4,
      v * 17,
      0.25
    );
    stampPixelDither(
      ctx,
      cx - 26,
      cy - 13,
      52,
      26,
      season === 'winter'
        ? 'rgba(130, 160, 194, 0.26)'
        : season === 'autumn'
          ? 'rgba(98, 60, 22, 0.24)'
          : 'rgba(26, 66, 22, 0.24)',
      4,
      v * 29 + 3,
      0.22
    );
    ctx.restore();

    if (season === 'winter') {
      if (v === 2 || v === 5) {
        ctx.fillStyle = '#9cb4cc';
        ctx.fillRect(cx + 5, cy + 1, 3.2, 1.8);
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(cx + 5, cy + 0.5, 2.5, 1.0);
      } else if (v === 3 || v === 7) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(cx - 9, cy + 2, 2.2, 1.4);
        ctx.fillRect(cx + 7, cy - 2, 2.0, 1.4);
      }
    } else if (season === 'autumn') {
      if (v === 2 || v === 6 || v === 3 || v === 7) {
        ctx.fillStyle = '#ea580c';
        ctx.fillRect(cx + 5, cy - 1, 1.8, 1.8);
        ctx.fillRect(cx - 9, cy + 3, 1.6, 1.6);
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(cx - 3, cy - 4, 1.6, 1.6);
        ctx.fillRect(cx + 9, cy + 2, 1.5, 1.5);
      } else if (v === 4) {
        ctx.fillStyle = '#7e8880';
        ctx.fillRect(cx + 6, cy + 2, 3.0, 1.8);
      }
    } else if (v === 2 || v === 6) {
      ctx.fillStyle = season === 'spring' ? '#fde047' : '#fae57c';
      ctx.fillRect(cx + 5, cy - 1, 1.8, 1.8);
      ctx.fillRect(cx - 9, cy + 3, 1.5, 1.5);
      ctx.fillStyle = season === 'spring' ? '#f472b6' : '#fff8dc';
      ctx.fillRect(cx - 3, cy - 4, 1.6, 1.6);
    } else if (v === 3 || v === 7) {
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(cx - 11, cy + 1, 1.7, 1.7);
      ctx.fillStyle = season === 'spring' ? '#ec4899' : '#ffa8cc';
      ctx.fillRect(cx + 8, cy - 3, 1.7, 1.7);
      ctx.fillRect(cx + 2, cy + 5, 1.5, 1.5);
    } else if (v === 5) {
      drawBushOrFlowerbed64(ctx, cx - 6, cy + 1, v, true);
    } else if (v === 4) {
      ctx.fillStyle = '#7e8880';
      ctx.fillRect(cx + 6, cy + 2, 3.0, 1.8);
      ctx.fillStyle = '#a3ada5';
      ctx.fillRect(cx + 6, cy + 1.5, 2.0, 1.0);
    }
  });
}

function getForestSprite(variant: number, season: SeasonId = 'summer'): CachedSprite {
  const v = ((variant % 8) + 8) % 8;
  return getOrCreateSprite(`forest64_v3_${season}_${v}`, 78, 70, 39, 48, (ctx, cx, cy) => {
    const floorCol =
      season === 'winter'
        ? '#cddded'
        : season === 'autumn'
          ? '#656930'
          : season === 'spring'
            ? '#4d8e39'
            : '#437e34';
    fillDiamond64(ctx, cx, cy, TILE_HW + 0.9, TILE_HH + 0.55, floorCol);
    ctx.fillStyle =
      season === 'winter' ? 'rgba(98, 128, 160, 0.28)' : 'rgba(22, 52, 20, 0.36)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 1, 22, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    fillDiamond64(
      ctx,
      cx,
      cy,
      TILE_HW * 0.78,
      TILE_HH * 0.78,
      season === 'winter' ? 'rgba(130, 158, 188, 0.22)' : 'rgba(18, 44, 20, 0.26)'
    );
    stampPixelDither(
      ctx,
      cx - 20,
      cy - 9,
      40,
      18,
      season === 'winter'
        ? 'rgba(248, 252, 255, 0.42)'
        : season === 'autumn'
          ? 'rgba(234, 128, 36, 0.30)'
          : 'rgba(105, 178, 82, 0.25)',
      3,
      v * 13,
      0.28
    );

    const groveRecipes: Array<Array<[number, number, TreeSpecies, number]>> = [
      [[-5, -6, 'pine', 0.96], [11, -2, 'lime', 0.90], [-13, 2, 'oak', 0.95], [2, 6, 'oak', 1.10]],
      [[6, -6, 'lime', 0.94], [-12, -2, 'oak', 0.92], [12, 3, 'pine', 0.96], [-2, 6, 'oak', 1.08]],
      [[-7, -5, 'cypress', 0.92], [9, -4, 'oak', 0.96], [-11, 4, 'lime', 0.90], [5, 5, 'pine', 1.04]],
      [[2, -7, 'ipe_gold', 0.92], [-13, -1, 'oak', 0.94], [11, 2, 'oak', 0.92], [-3, 6, 'lime', 1.04]],
      [[-8, -4, 'pine', 1.02], [8, -5, 'pine', 0.92], [-1, 2, 'cypress', 0.96], [9, 6, 'oak', 0.92]],
      [[5, -6, 'ipe_pink', 0.90], [-11, -2, 'lime', 0.94], [12, 3, 'oak', 0.92], [-3, 6, 'oak', 1.08]],
      [[-4, -6, 'autumn', 0.92], [11, -1, 'oak', 0.94], [-13, 3, 'pine', 0.94], [3, 6, 'lime', 1.04]],
      [[8, -5, 'oak', 0.98], [-9, -4, 'lime', 0.90], [-12, 4, 'oak', 0.92], [1, 6, 'pine', 1.08]],
    ];
    for (const [ox, oy, sp, sc] of groveRecipes[v]) {
      drawSpeciesTree64(ctx, cx + ox, cy + oy, sp, sc, v, season);
    }
    if (v % 3 === 0 && season !== 'winter') {
      drawBushOrFlowerbed64(ctx, cx - 15, cy + 5, v, season === 'spring');
    }
  });
}

function getWaterSprite(
  animFrame: number,
  bankMask: number,
  season: SeasonId = 'summer'
): CachedSprite {
  const f = animFrame % 4;
  return getOrCreateSprite(`water64_v3_${season}_${f}_${bankMask}`, 68, 50, 34, 20, (ctx, cx, cy) => {
    const wy = cy + 6;

    const wGrad = ctx.createLinearGradient(cx, wy - TILE_HH, cx, wy + TILE_HH);
    if (season === 'winter') {
      wGrad.addColorStop(0, '#1f6499');
      wGrad.addColorStop(0.5, '#195785');
      wGrad.addColorStop(1, '#144970');
    } else if (season === 'autumn') {
      wGrad.addColorStop(0, '#1f70a6');
      wGrad.addColorStop(0.5, '#196191');
      wGrad.addColorStop(1, '#15547d');
    } else {
      wGrad.addColorStop(0, '#247ec2');
      wGrad.addColorStop(0.5, '#1d70ad');
      wGrad.addColorStop(1, '#186399');
    }
    fillDiamond64(ctx, cx, wy, TILE_HW + 1.0, TILE_HH + 0.6, wGrad);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, wy - TILE_HH);
    ctx.lineTo(cx + TILE_HW, wy);
    ctx.lineTo(cx, wy + TILE_HH);
    ctx.lineTo(cx - TILE_HW, wy);
    ctx.closePath();
    ctx.clip();
    stampPixelDither(ctx, cx - 28, wy - 14, 56, 28, 'rgba(130, 218, 255, 0.16)', 5, f * 11, 0.22);
    stampPixelDither(ctx, cx - 28, wy - 14, 56, 28, 'rgba(10, 44, 78, 0.22)', 5, f * 7 + 5, 0.24);
    ctx.restore();

    const bankLipNE =
      season === 'winter'
        ? '#e2eef8'
        : season === 'autumn'
          ? '#7c7e3b'
          : season === 'spring'
            ? '#5ea646'
            : '#4e9141';
    const bankLipNW =
      season === 'winter'
        ? '#eef6ff'
        : season === 'autumn'
          ? '#8b8a42'
          : season === 'spring'
            ? '#6ab54e'
            : '#5ea84d';

    if (bankMask & 1) {
      const b1 = ctx.createLinearGradient(cx, cy - TILE_HH, cx + TILE_HW, wy);
      b1.addColorStop(0, '#7d684d');
      b1.addColorStop(1, '#524230');
      ctx.fillStyle = b1;
      ctx.beginPath();
      ctx.moveTo(cx, cy - TILE_HH);
      ctx.lineTo(cx + TILE_HW, cy);
      ctx.lineTo(cx + TILE_HW, wy);
      ctx.lineTo(cx, wy - TILE_HH);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(42, 32, 22, 0.45)';
      ctx.fillRect(cx + 8, cy - 9, 3, 2);
      ctx.fillRect(cx + 18, cy - 4, 3.5, 2);
      drawLine64(ctx, cx, cy - TILE_HH, cx + TILE_HW, cy, bankLipNE, 2.5);
      drawLine64(ctx, cx + 1, wy - TILE_HH + 1.5, cx + TILE_HW - 1, wy + 0.5, 'rgba(198, 242, 255, 0.62)', 1.6);
    }
    if (bankMask & 2) {
      const b2 = ctx.createLinearGradient(cx - TILE_HW, cy, cx, wy - TILE_HH);
      b2.addColorStop(0, '#968061');
      b2.addColorStop(1, '#685740');
      ctx.fillStyle = b2;
      ctx.beginPath();
      ctx.moveTo(cx - TILE_HW, cy);
      ctx.lineTo(cx, cy - TILE_HH);
      ctx.lineTo(cx, wy - TILE_HH);
      ctx.lineTo(cx - TILE_HW, wy);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(210, 192, 160, 0.32)';
      ctx.fillRect(cx - 18, cy - 5, 3.5, 1.8);
      ctx.fillRect(cx - 9, cy - 9.5, 3, 1.8);
      drawLine64(ctx, cx - TILE_HW, cy, cx, cy - TILE_HH, bankLipNW, 2.5);
      drawLine64(ctx, cx - TILE_HW + 1, wy + 0.5, cx - 1, wy - TILE_HH + 1.5, 'rgba(208, 246, 255, 0.66)', 1.6);
    }

    // Soft animated specular river ripples & wave crests
    const shift = f * 5;
    drawLine64(
      ctx,
      cx - 14 + ((shift + 4) % 20),
      wy - 4,
      cx - 5 + ((shift + 4) % 20),
      wy - 4,
      'rgba(180, 238, 255, 0.62)',
      1.3
    );
    drawLine64(
      ctx,
      cx - 8 + ((shift + 13) % 18),
      wy + 3,
      cx + 2 + ((shift + 13) % 18),
      wy + 3,
      'rgba(140, 220, 255, 0.48)',
      1.2
    );
    drawLine64(
      ctx,
      cx - 10 + ((shift + 9) % 16),
      wy + 7,
      cx - 2 + ((shift + 9) % 16),
      wy + 7,
      'rgba(10, 48, 86, 0.48)',
      1.4
    );
  });
}

function drawSidewalkPaving64(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  seed: number
): void {
  // Subtle isometric paving tile grid (ladrilhos) across sidewalk apron
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, cy - TILE_HH);
  ctx.lineTo(cx + TILE_HW, cy);
  ctx.lineTo(cx, cy + TILE_HH);
  ctx.lineTo(cx - TILE_HW, cy);
  ctx.closePath();
  ctx.clip();

  ctx.strokeStyle = 'rgba(56, 66, 84, 0.22)';
  ctx.lineWidth = 0.65;
  for (let i = -3; i <= 3; i++) {
    const off = i * 8;
    ctx.beginPath();
    ctx.moveTo(cx - 32 + off, cy + off * 0.5);
    ctx.lineTo(cx + off, cy - 16 + off * 0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + 32 - off, cy + off * 0.5);
    ctx.lineTo(cx - off, cy - 16 + off * 0.5);
    ctx.stroke();
  }
  // Subtle sidewalk stone speckle dithering
  stampPixelDither(ctx, cx - 30, cy - 15, 60, 30, 'rgba(255,255,255,0.16)', 4, seed + 3, 0.24);
  ctx.restore();
}

function drawAsphaltDetails64(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  styleSeed: number,
  isDarkHwy: boolean
): void {
  // Asphalt aggregate granulation dithering
  stampPixelDither(
    ctx,
    cx - 16,
    cy - 8,
    32,
    16,
    isDarkHwy ? 'rgba(255,255,255,0.08)' : 'rgba(220,230,245,0.10)',
    3,
    styleSeed * 19 + 5,
    0.26
  );
  stampPixelDither(
    ctx,
    cx - 16,
    cy - 8,
    32,
    16,
    'rgba(8, 12, 20, 0.28)',
    3,
    styleSeed * 23 + 11,
    0.24
  );

  // Occasional cast-iron street manhole (bueiro / tampa de esgoto)
  if (styleSeed % 3 === 1) {
    const mx = cx + (styleSeed % 2 === 0 ? 4 : -4.5);
    const my = cy + (styleSeed % 2 === 0 ? -1.5 : 1.5);
    ctx.fillStyle = '#202630';
    ctx.beginPath();
    ctx.ellipse(mx, my, 2.4, 1.25, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#687487';
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }

  // Subtle organic asphalt hairline crack or repair tar patch
  if (styleSeed === 2 || styleSeed === 5) {
    ctx.strokeStyle = 'rgba(14, 18, 26, 0.45)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy - 2);
    ctx.lineTo(cx - 1.5, cy - 0.5);
    ctx.lineTo(cx + 2, cy - 1.8);
    ctx.stroke();
  } else if (styleSeed === 4) {
    ctx.fillStyle = 'rgba(26, 30, 38, 0.48)';
    ctx.beginPath();
    ctx.ellipse(cx + 3, cy + 2, 3.8, 1.8, 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function getRoadSprite(
  rotMask: number,
  roadLevel: number = 1,
  variant: number = 0,
  coordStyle: number = 0
): CachedSprite {
  const lv = Math.max(1, Math.min(4, roadLevel || 1));
  const v = lv >= 4 ? (variant === 1 ? 1 : 0) : 0;
  const st = ((coordStyle % 6) + 6) % 6;

  // LEVEL 4 (variant 1): Monumental 64-Bit Bi-Level Highway Cloverleaf Interchange (Trevo Rodoviário)
  if (lv >= 4 && v === 1) {
    return getOrCreateSprite(`road64_trevo_hwy_${rotMask}`, 80, 74, 40, 46, (ctx, cx, cy) => {
      // Landscaped cloverleaf apron
      const grassGrad = ctx.createLinearGradient(cx - 32, cy - 16, cx + 32, cy + 16);
      grassGrad.addColorStop(0, '#4ca353');
      grassGrad.addColorStop(1, '#367d3d');
      fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, grassGrad);

      // Curved perimeter collector slip-ramps (alças)
      fillDiamond64(ctx, cx, cy, 28, 14, '#2d3442', '#7f8ca3', 1.0);

      // 4 sculpted emerald cloverleaf grass loops carved inside the ramps
      const loops: Array<[number, number]> = [
        [cx, cy - 8.5],
        [cx, cy + 8.5],
        [cx - 16.5, cy],
        [cx + 16.5, cy],
      ];
      for (const [lx, ly] of loops) {
        fillDiamond64(ctx, lx, ly, 8.2, 4.1, '#439c4d', '#7ee087', 0.7);
      }

      // Connecting ground-level highway arms
      const drawApproach = (dx: number, dy: number) => {
        for (let t = 1; t <= 8; t++) {
          const ax = cx + (dx * t) / 8;
          const ay = cy + (dy * t) / 8;
          fillDiamond64(ctx, ax, ay, 16, 8, '#232936');
        }
        drawLine64(ctx, cx + dx * 0.3, cy + dy * 0.3, cx + dx * 0.95, cy + dy * 0.95, '#ffca3a', 1.4);
      };
      if (rotMask & 1) drawApproach(16, -8);
      if (rotMask & 2) drawApproach(16, 8);
      if (rotMask & 4) drawApproach(-16, 8);
      if (rotMask & 8) drawApproach(-16, -8);

      // Lower NW-SE recessed expressway passing underneath
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx - 24, cy - 5);
      ctx.lineTo(cx - 8, cy - 13);
      ctx.lineTo(cx + 24, cy + 5);
      ctx.lineTo(cx + 8, cy + 13);
      ctx.closePath();
      ctx.fillStyle = '#1b212d';
      ctx.fill();
      ctx.restore();
      drawLine64(ctx, cx - 15, cy - 7.5, cx - 8, cy - 4, '#f5b73b', 1.2);
      drawLine64(ctx, cx + 8, cy + 4, cx + 15, cy + 7.5, '#f5b73b', 1.2);

      // Realistic cast shadow under elevated viaduct
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx - 22, cy + 7);
      ctx.lineTo(cx + 12, cy - 10);
      ctx.lineTo(cx + 22, cy - 5);
      ctx.lineTo(cx - 12, cy + 12);
      ctx.closePath();
      ctx.fillStyle = 'rgba(6, 10, 18, 0.56)';
      ctx.fill();
      ctx.restore();

      // Reinforced concrete support piers
      drawPrism64(ctx, cx - 10, cy + 5, 3, 11, {
        top: '#cbd5e1',
        left: '#aeb9cc',
        right: '#647087',
      });
      drawPrism64(ctx, cx + 9, cy - 4, 3, 11, {
        top: '#cbd5e1',
        left: '#aeb9cc',
        right: '#647087',
      });

      // Elevated NE-SW Overpass Viaduct Deck (lifted -11px in 64-bit 3D!)
      const lift = 11;
      ctx.beginPath();
      ctx.moveTo(cx - 24, cy + 5 - lift);
      ctx.lineTo(cx + 8, cy - 11 - lift);
      ctx.lineTo(cx + 24, cy - 3 - lift);
      ctx.lineTo(cx - 8, cy + 13 - lift);
      ctx.closePath();
      ctx.fillStyle = '#6f7c91';
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(cx - 24, cy + 2.5 - lift);
      ctx.lineTo(cx + 8, cy - 13.5 - lift);
      ctx.lineTo(cx + 24, cy - 5.5 - lift);
      ctx.lineTo(cx - 8, cy + 10.5 - lift);
      ctx.closePath();
      ctx.fillStyle = '#d6e0ee';
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(cx - 21, cy + 2.5 - lift);
      ctx.lineTo(cx + 8, cy - 12 - lift);
      ctx.lineTo(cx + 21, cy - 5.5 - lift);
      ctx.lineTo(cx - 8, cy + 9 - lift);
      ctx.closePath();
      ctx.fillStyle = '#252c3b';
      ctx.fill();

      drawLine64(ctx, cx - 15, cy + 5.5 - lift, cx + 15, cy - 9.5 - lift, '#ffd449', 1.3);
      ctx.fillStyle = '#ff842b';
      ctx.fillRect(cx - 12, cy + 7.2 - lift, 3, 1.5);
      ctx.fillRect(cx + 8, cy - 3 - lift, 3, 1.5);

      // Tall central highway twin-floodlight mast with warm glow halos
      drawLine64(ctx, cx, cy - lift, cx, cy - 31, '#a9b7cc', 2.0);
      drawLine64(ctx, cx - 5, cy - 31, cx + 5, cy - 31, '#e2eaf5', 1.8);
      drawGlow64(ctx, cx - 5, cy - 29.5, 5, 'rgba(255, 232, 130, 0.85)');
      drawGlow64(ctx, cx + 5, cy - 29.5, 5, 'rgba(255, 232, 130, 0.85)');
      ctx.fillStyle = '#fff6c2';
      ctx.fillRect(cx - 6, cy - 30.5, 2, 1.5);
      ctx.fillRect(cx + 4, cy - 30.5, 2, 1.5);
    });
  }

  // LEVEL 4 (variant 0): 64-Bit Landscaped Avenue Roundabout (Rotatória Paisagística)
  if (lv >= 4) {
    return getOrCreateSprite(`road64_trevo_ave_${rotMask}`, 74, 62, 37, 38, (ctx, cx, cy) => {
      const granite = ctx.createLinearGradient(cx - 32, cy - 16, cx + 32, cy + 16);
      granite.addColorStop(0, '#c6cfde');
      granite.addColorStop(1, '#98a3b5');
      fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, granite);
      drawSidewalkPaving64(ctx, cx, cy, rotMask);

      const drawArm = (dx: number, dy: number) => {
        for (let t = 2; t <= 8; t++) {
          fillDiamond64(ctx, cx + (dx * t) / 8, cy + (dy * t) / 8, 16, 8, '#323947');
        }
        const wx = cx + dx * 0.72;
        const wy = cy + dy * 0.72;
        drawLine64(ctx, wx - 3, wy - 1.5, wx + 3, wy + 1.5, '#eef4fc', 1.4);
      };
      if (rotMask & 1) drawArm(16, -8);
      if (rotMask & 2) drawArm(16, 8);
      if (rotMask & 4) drawArm(-16, 8);
      if (rotMask & 8) drawArm(-16, -8);

      ctx.save();
      ctx.fillStyle = '#323947';
      ctx.beginPath();
      ctx.ellipse(cx, cy, 26, 13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(230, 238, 248, 0.75)';
      ctx.lineWidth = 1.1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.ellipse(cx, cy, 19.5, 9.8, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Raised sandstone curb + landscaped emerald garden island
      ctx.fillStyle = '#d3dce8';
      ctx.beginPath();
      ctx.ellipse(cx, cy, 14, 7, 0, 0, Math.PI * 2);
      ctx.fill();

      const lawn = ctx.createRadialGradient(cx - 3, cy - 2, 1, cx, cy - 1, 12);
      lawn.addColorStop(0, '#6ed478');
      lawn.addColorStop(1, '#318a43');
      ctx.fillStyle = lawn;
      ctx.beginPath();
      ctx.ellipse(cx, cy - 1, 12.2, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ff8ec7';
      ctx.fillRect(cx - 7, cy - 1, 2, 1.5);
      ctx.fillRect(cx + 5, cy - 1, 2, 1.5);
      ctx.fillStyle = '#ffe066';
      ctx.fillRect(cx - 1, cy + 2.5, 2.2, 1.5);
      ctx.fillRect(cx - 1, cy - 4.5, 2.2, 1.5);

      ctx.fillStyle = '#62d4ff';
      ctx.beginPath();
      ctx.ellipse(cx, cy - 2.5, 6.2, 3.1, 0, 0, Math.PI * 2);
      ctx.fill();
      drawPrism64(ctx, cx, cy - 2, 2.5, 10, {
        top: '#f4f8fc',
        left: '#e2ebf5',
        right: '#9aa8bd',
      });
      drawGlow64(ctx, cx, cy - 13, 4.5, 'rgba(190, 245, 255, 0.85)', 'rgba(98, 212, 255, 0)');

      const lamps: Array<[number, number]> = [
        [cx - 22, cy - 5],
        [cx + 21, cy - 5],
        [cx - 22, cy + 5],
        [cx + 21, cy + 5],
      ];
      for (const [lx, ly] of lamps) {
        drawLine64(ctx, lx, ly, lx, ly - 8, '#465269', 1.4);
        drawGlow64(ctx, lx, ly - 9, 4.5, 'rgba(255, 232, 140, 0.8)');
        ctx.fillStyle = '#fff5bd';
        ctx.fillRect(lx - 1, ly - 9.5, 2, 1.6);
      }
    });
  }

  // LEVEL 3: 64-Bit High-Speed Highways
  // - variant 0: Rodovia de 2 Faixas (1 ida + 1 volta)
  // - variant 1: Rodovia de 4 Faixas (2 idas + 2 voltas) com canteiro central / mureta Jersey
  if (lv === 3) {
    const isFourLane = variant === 1;
    return getOrCreateSprite(
      `road64_hwy_v3_${isFourLane ? '4L' : '2L'}_${rotMask}_${st % 3}`,
      76,
      64,
      38,
      38,
      (ctx, cx, cy) => {
        fillDiamond64(ctx, cx, cy + 2.5, TILE_HW + 0.5, TILE_HH + 0.3, '#556070');
        fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, '#8a95a8');

        const oy = cy - 2;
        const deckHW = isFourLane ? 29.5 : 24.5;
        const deckHH = isFourLane ? 14.75 : 12.25;
        const armHW = isFourLane ? 22.0 : 17.2;
        const armHH = isFourLane ? 11.0 : 8.6;
        const asphaltColor = isFourLane ? '#1b212c' : '#232a36';

        fillDiamond64(ctx, cx, oy, deckHW, deckHH, asphaltColor);

        const drawHwyArm = (dx: number, dy: number) => {
          for (let t = 1; t <= 8; t++) {
            fillDiamond64(ctx, cx + (dx * t) / 8, oy + (dy * t) / 8, armHW, armHH, asphaltColor);
          }

          // Perpendicular screen unit offset across the carriageway
          const perpX = dy > 0 ? -1 : 1;
          const perpY = dx > 0 ? 0.5 : -0.5;

          if (isFourLane) {
            // 4-LANE DIVIDED HIGHWAY (2 idas + 2 voltas):
            // Central concrete Jersey barrier median separating opposing directions
            drawLine64(
              ctx,
              cx + dx * 0.12,
              oy + dy * 0.12,
              cx + dx * 0.98,
              oy + dy * 0.98,
              '#9aa6b8',
              2.8
            );
            drawLine64(
              ctx,
              cx + dx * 0.12,
              oy + dy * 0.12 - 0.8,
              cx + dx * 0.98,
              oy + dy * 0.98 - 0.8,
              '#e2e8f0',
              1.1
            );
            // Yellow inner shoulder lines hugging both sides of the central barrier
            const innerOff = 2.4;
            drawLine64(
              ctx,
              cx + dx * 0.16 + perpX * innerOff,
              oy + dy * 0.16 + perpY * innerOff,
              cx + dx * 0.96 + perpX * innerOff,
              oy + dy * 0.96 + perpY * innerOff,
              '#facc15',
              0.85
            );
            drawLine64(
              ctx,
              cx + dx * 0.16 - perpX * innerOff,
              oy + dy * 0.16 - perpY * innerOff,
              cx + dx * 0.96 - perpX * innerOff,
              oy + dy * 0.96 - perpY * innerOff,
              '#facc15',
              0.85
            );
            // Dashed white lane dividers splitting EACH direction into 2 lanes (2 outbound + 2 inbound)
            const laneOff = 6.2;
            for (const seg of [
              [0.24, 0.46],
              [0.64, 0.86],
            ]) {
              drawLine64(
                ctx,
                cx + dx * seg[0] + perpX * laneOff,
                oy + dy * seg[0] + perpY * laneOff,
                cx + dx * seg[1] + perpX * laneOff,
                oy + dy * seg[1] + perpY * laneOff,
                'rgba(241, 245, 249, 0.88)',
                1.0
              );
              drawLine64(
                ctx,
                cx + dx * seg[0] - perpX * laneOff,
                oy + dy * seg[0] - perpY * laneOff,
                cx + dx * seg[1] - perpX * laneOff,
                oy + dy * seg[1] - perpY * laneOff,
                'rgba(241, 245, 249, 0.88)',
                1.0
              );
            }
            // Crisp white outer shoulder lines
            const outerOff = 9.8;
            drawLine64(
              ctx,
              cx + dx * 0.2 + perpX * outerOff,
              oy + dy * 0.2 + perpY * outerOff,
              cx + dx * 0.95 + perpX * outerOff,
              oy + dy * 0.95 + perpY * outerOff,
              'rgba(226, 236, 248, 0.72)',
              0.9
            );
            drawLine64(
              ctx,
              cx + dx * 0.2 - perpX * outerOff,
              oy + dy * 0.2 - perpY * outerOff,
              cx + dx * 0.95 - perpX * outerOff,
              oy + dy * 0.95 - perpY * outerOff,
              'rgba(226, 236, 248, 0.72)',
              0.9
            );
          } else {
            // 2-LANE HIGHWAY (1 ida + 1 volta):
            // Double yellow centerline + outer white shoulder stripes
            drawLine64(
              ctx,
              cx + dx * 0.14 + perpX * 0.8,
              oy + dy * 0.14 + perpY * 0.8,
              cx + dx * 0.96 + perpX * 0.8,
              oy + dy * 0.96 + perpY * 0.8,
              '#ffca3a',
              1.05
            );
            drawLine64(
              ctx,
              cx + dx * 0.14 - perpX * 0.8,
              oy + dy * 0.14 - perpY * 0.8,
              cx + dx * 0.96 - perpX * 0.8,
              oy + dy * 0.96 - perpY * 0.8,
              '#ffca3a',
              1.05
            );
            const shoulderOff = 6.2;
            drawLine64(
              ctx,
              cx + dx * 0.35 + perpX * shoulderOff,
              oy + dy * 0.35 + perpY * shoulderOff,
              cx + dx * 0.88 + perpX * shoulderOff,
              oy + dy * 0.88 + perpY * shoulderOff,
              'rgba(226, 236, 248, 0.75)',
              1.0
            );
            drawLine64(
              ctx,
              cx + dx * 0.35 - perpX * shoulderOff,
              oy + dy * 0.35 - perpY * shoulderOff,
              cx + dx * 0.88 - perpX * shoulderOff,
              oy + dy * 0.88 - perpY * shoulderOff,
              'rgba(226, 236, 248, 0.75)',
              1.0
            );
          }
        };

        if (rotMask & 1) drawHwyArm(16, -8);
        if (rotMask & 2) drawHwyArm(16, 8);
        if (rotMask & 4) drawHwyArm(-16, 8);
        if (rotMask & 8) drawHwyArm(-16, -8);

        drawAsphaltDetails64(ctx, cx, oy, st, true);

        const isStraightNE = rotMask === (1 | 4);
        const isStraightNW = rotMask === (2 | 8);
        const railSpread = isFourLane ? 2.2 : 0;

        if (isStraightNE) {
          drawLine64(ctx, cx - 23 - railSpread, oy + 2 - railSpread * 0.5, cx + 4 - railSpread, oy - 11.5 - railSpread * 0.5, '#d3dce8', 1.8);
          drawLine64(ctx, cx - 4 + railSpread, oy + 11.5 + railSpread * 0.5, cx + 23 + railSpread, oy - 2 + railSpread * 0.5, '#d3dce8', 1.8);
          ctx.fillStyle = '#ff842b';
          ctx.fillRect(cx - 10, oy - 5.5, 3, 1.5);
          ctx.fillRect(cx + 8, oy + 4, 3, 1.5);

          if (st % 3 === 0) {
            const gOff = isFourLane ? 2.5 : 0;
            drawLine64(ctx, cx - 12 - gOff, oy - 1, cx - 12 - gOff, oy - 19, '#9aa8bd', 1.8);
            drawLine64(ctx, cx + 10 + gOff, oy + 9, cx + 10 + gOff, oy - 9, '#9aa8bd', 1.8);
            drawLine64(ctx, cx - 12 - gOff, oy - 19, cx + 10 + gOff, oy - 9, '#d6e0ee', 2.1);
            const signW = isFourLane ? 17 : 13;
            ctx.fillStyle = '#157a42';
            ctx.fillRect(cx - signW / 2, oy - 19, signW, 6.5);
            ctx.strokeStyle = '#e8f5ee';
            ctx.lineWidth = 0.8;
            ctx.strokeRect(cx - signW / 2, oy - 19, signW, 6.5);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(cx - signW / 2 + 2, oy - 17, signW - 4, 1.3);
            ctx.fillRect(cx - signW / 2 + 3, oy - 14.5, signW - 7, 1.1);
          } else {
            drawStreetProp64(ctx, cx - 13, oy - 2, 'lamp');
          }
        } else if (isStraightNW) {
          drawLine64(ctx, cx - 4 + railSpread, oy - 11.5 - railSpread * 0.5, cx + 23 + railSpread, oy + 2 - railSpread * 0.5, '#d3dce8', 1.8);
          drawLine64(ctx, cx - 23 - railSpread, oy - 2 + railSpread * 0.5, cx + 4 - railSpread, oy + 11.5 + railSpread * 0.5, '#d3dce8', 1.8);
          ctx.fillStyle = '#ff842b';
          ctx.fillRect(cx + 8, oy - 5.5, 3, 1.5);
          ctx.fillRect(cx - 11, oy + 4, 3, 1.5);

          if (st % 3 === 0) {
            const gOff = isFourLane ? 2.5 : 0;
            drawLine64(ctx, cx + 10 + gOff, oy - 1, cx + 10 + gOff, oy - 19, '#9aa8bd', 1.8);
            drawLine64(ctx, cx - 12 - gOff, oy + 9, cx - 12 - gOff, oy - 9, '#9aa8bd', 1.8);
            drawLine64(ctx, cx + 10 + gOff, oy - 19, cx - 12 - gOff, oy - 9, '#d6e0ee', 2.1);
            const signW = isFourLane ? 17 : 13;
            ctx.fillStyle = '#157a42';
            ctx.fillRect(cx - signW / 2, oy - 19, signW, 6.5);
            ctx.strokeStyle = '#e8f5ee';
            ctx.lineWidth = 0.8;
            ctx.strokeRect(cx - signW / 2, oy - 19, signW, 6.5);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(cx - signW / 2 + 2, oy - 17, signW - 4, 1.3);
            ctx.fillRect(cx - signW / 2 + 3, oy - 14.5, signW - 7, 1.1);
          } else {
            drawStreetProp64(ctx, cx + 11, oy - 2, 'lamp');
          }
        }
      }
    );
  }

  // LEVEL 2 (variant 2): 64-Bit 2×2 Wide Grand Boulevard (Avenida Larga 2×2 — required for Skyscrapers!)
  if (lv === 2 && variant === 2) {
    return getOrCreateSprite(`road64_wide_ave_v2_${rotMask}_${st % 4}`, 76, 66, 38, 40, (ctx, cx, cy) => {
      // Polished metropolitan granite sidewalk apron
      const curb = ctx.createLinearGradient(cx - 32, cy - 16, cx + 32, cy + 16);
      curb.addColorStop(0, '#d8e1ee');
      curb.addColorStop(1, '#9ea9bc');
      fillDiamond64(ctx, cx, cy, TILE_HW + 0.6, TILE_HH + 0.35, curb);

      // Extra-wide multi-lane dark metropolitan asphalt filling seamlessly into parallel twin tiles!
      const asphalt = '#252d3b';
      fillDiamond64(ctx, cx, cy, 30.2, 15.1, '#e2eaf5');
      fillDiamond64(ctx, cx, cy, 29.0, 14.5, asphalt);

      const drawWideArm = (dx: number, dy: number) => {
        for (let t = 1; t <= 8; t++) {
          fillDiamond64(ctx, cx + (dx * t) / 8, cy + (dy * t) / 8, 24.0, 12.0, asphalt);
        }
        const perpX = dy > 0 ? -1 : 1;
        const perpY = dx > 0 ? 0.5 : -0.5;
        // Dedicated BRT cyan-accent transit shoulder stripe + dashed crisp white lane dividers
        drawLine64(
          ctx,
          cx + dx * 0.16 + perpX * 8.2,
          cy + dy * 0.16 + perpY * 8.2,
          cx + dx * 0.94 + perpX * 8.2,
          cy + dy * 0.94 + perpY * 8.2,
          'rgba(56, 189, 248, 0.72)',
          1.15
        );
        // Double golden boulevard centerline
        drawLine64(
          ctx,
          cx + dx * 0.14 + perpX * 0.85,
          cy + dy * 0.14 + perpY * 0.85,
          cx + dx * 0.96 + perpX * 0.85,
          cy + dy * 0.96 + perpY * 0.85,
          '#facc15',
          1.05
        );
        drawLine64(
          ctx,
          cx + dx * 0.14 - perpX * 0.85,
          cy + dy * 0.14 - perpY * 0.85,
          cx + dx * 0.96 - perpX * 0.85,
          cy + dy * 0.96 - perpY * 0.85,
          '#facc15',
          1.05
        );
        // Dashed white fast-lane divider
        for (const seg of [
          [0.24, 0.48],
          [0.64, 0.88],
        ]) {
          drawLine64(
            ctx,
            cx + dx * seg[0] - perpX * 5.2,
            cy + dy * seg[0] - perpY * 5.2,
            cx + dx * seg[1] - perpX * 5.2,
            cy + dy * seg[1] - perpY * 5.2,
            'rgba(241, 245, 249, 0.90)',
            1.0
          );
          drawLine64(
            ctx,
            cx + dx * seg[0] + perpX * 4.8,
            cy + dy * seg[0] + perpY * 4.8,
            cx + dx * seg[1] + perpX * 4.8,
            cy + dy * seg[1] + perpY * 4.8,
            'rgba(241, 245, 249, 0.86)',
            1.0
          );
        }
      };

      if (rotMask & 1) drawWideArm(16, -8);
      if (rotMask & 2) drawWideArm(16, 8);
      if (rotMask & 4) drawWideArm(-16, 8);
      if (rotMask & 8) drawWideArm(-16, -8);

      drawAsphaltDetails64(ctx, cx, cy, st, false);

      // Sleek corner zebra stripes & architectural golden boulevard twin-lamps
      const bits =
        (rotMask & 1 ? 1 : 0) +
        (rotMask & 2 ? 1 : 0) +
        (rotMask & 4 ? 1 : 0) +
        (rotMask & 8 ? 1 : 0);
      if (bits >= 3) {
        for (let s = -1; s <= 1; s++) {
          drawLine64(
            ctx,
            cx - 4 + s * 2.4,
            cy - 8.2 + s * 0.4,
            cx + 2 + s * 2.4,
            cy - 5.6 + s * 0.4,
            'rgba(241, 245, 249, 0.85)',
            1.1
          );
        }
      }
      if (st % 2 === 0) {
        const lx = (rotMask & 2) && (rotMask & 8) ? cx + 19 : cx - 19;
        const ly = cy - 4;
        drawLine64(ctx, lx, ly, lx, ly - 11, '#475569', 1.6);
        drawLine64(ctx, lx - 2.5, ly - 11, lx + 2.5, ly - 11, '#cbd5e1', 1.2);
        drawGlow64(ctx, lx, ly - 11.5, 6, 'rgba(255, 232, 138, 0.88)');
        ctx.fillStyle = '#fff9c4';
        ctx.fillRect(lx - 2, ly - 12, 4, 1.5);
      }
    });
  }

  // LEVEL 2: 64-Bit Tree-Lined Urban Boulevard (Avenida Arborizada)
  if (lv === 2) {
    return getOrCreateSprite(`road64_ave_v2_${rotMask}_${st}`, 72, 60, 36, 36, (ctx, cx, cy) => {
      const curb = ctx.createLinearGradient(cx - 32, cy - 16, cx + 32, cy + 16);
      curb.addColorStop(0, '#d2dbe8');
      curb.addColorStop(1, '#9ca6b8');
      fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, curb);
      drawSidewalkPaving64(ctx, cx, cy, st);

      // Raised bevel curb outline (meio-fio)
      fillDiamond64(ctx, cx, cy, 24.4, 12.2, '#e2e8f2');
      fillDiamond64(ctx, cx, cy, 23, 11.5, '#303745');

      const drawAveArm = (dx: number, dy: number) => {
        for (let t = 1; t <= 8; t++) {
          fillDiamond64(ctx, cx + (dx * t) / 8, cy + (dy * t) / 8, 17.5, 8.75, '#dde5f0');
        }
        for (let t = 1; t <= 8; t++) {
          fillDiamond64(ctx, cx + (dx * t) / 8, cy + (dy * t) / 8, 16.2, 8.1, '#303745');
        }
        drawLine64(ctx, cx + dx * 0.25, cy + dy * 0.25, cx + dx * 0.92, cy + dy * 0.92, '#f7d154', 1.3);
      };
      if (rotMask & 1) drawAveArm(16, -8);
      if (rotMask & 2) drawAveArm(16, 8);
      if (rotMask & 4) drawAveArm(-16, 8);
      if (rotMask & 8) drawAveArm(-16, -8);

      drawAsphaltDetails64(ctx, cx, cy, st, false);

      const isStraightNE = rotMask === (1 | 4);
      const isStraightNW = rotMask === (2 | 8);
      const bits =
        (rotMask & 1 ? 1 : 0) +
        (rotMask & 2 ? 1 : 0) +
        (rotMask & 4 ? 1 : 0) +
        (rotMask & 8 ? 1 : 0);

      if (isStraightNE || isStraightNW) {
        // Landscaped emerald median strip + varied urban tree species + street furniture!
        if (isStraightNE) {
          drawLine64(ctx, cx - 10, cy + 4.5, cx + 10, cy - 5.5, '#2d7d3e', 3.4);
          drawLine64(ctx, cx - 9, cy + 3.5, cx + 9, cy - 5.5, '#68d174', 1.8);
        } else {
          drawLine64(ctx, cx - 10, cy - 5.5, cx + 10, cy + 4.5, '#2d7d3e', 3.4);
          drawLine64(ctx, cx - 9, cy - 5.5, cx + 9, cy + 3.5, '#68d174', 1.8);
        }

        const aveTrees: TreeSpecies[] = ['oak', 'palm', 'ipe_gold', 'lime', 'ipe_pink', 'cypress'];
        drawSpeciesTree64(ctx, cx, cy - 1, aveTrees[st], 0.64, st);

        const lx = isStraightNE ? cx - 18 : cx + 17;
        const ly = cy - 4;
        drawLine64(ctx, lx, ly, lx, ly - 9, '#465269', 1.5);
        drawGlow64(ctx, lx, ly - 10, 5.5, 'rgba(255, 232, 138, 0.85)');
        ctx.fillStyle = '#fff8c4';
        ctx.fillRect(lx - 1, ly - 10.5, 2, 1.5);

        // Opposite sidewalk organic prop (bench, trash bin, hydrant or planter)
        const px = isStraightNE ? cx + 16 : cx - 17;
        const py = cy + 4.5;
        if (st % 4 === 0) drawStreetProp64(ctx, px, py, 'bench');
        else if (st % 4 === 1) drawStreetProp64(ctx, px, py, 'trash');
        else if (st % 4 === 2) drawStreetProp64(ctx, px, py, 'hydrant');
        else drawStreetProp64(ctx, px, py, 'planter');
      } else if (bits >= 3) {
        // Multi-stripe crisp pedestrian zebra crossings (faixas de pedestres)
        for (let s = -1; s <= 1; s++) {
          drawLine64(ctx, cx - 5 + s * 2.2, cy - 7.5 + s * 0.4, cx + 1 + s * 2.2, cy - 5.2 + s * 0.4, '#eef4fc', 1.2);
          drawLine64(ctx, cx - 5 + s * 2.2, cy + 5.2 + s * 0.4, cx + 1 + s * 2.2, cy + 7.5 + s * 0.4, '#eef4fc', 1.2);
        }
        drawLine64(ctx, cx - 13, cy - 1.5, cx - 9, cy + 0.5, '#eef4fc', 1.6);
        drawLine64(ctx, cx + 9, cy - 1.5, cx + 13, cy + 0.5, '#eef4fc', 1.6);
      }
    });
  }

  // LEVEL 1: 64-Bit Neighborhood Local Street (Rua Local) with paving slabs, curbs, bueiros & props
  return getOrCreateSprite(`road64_local_v2_${rotMask}_${st}`, 70, 48, 35, 26, (ctx, cx, cy) => {
    const sidewalk = ctx.createLinearGradient(cx - 32, cy - 16, cx + 32, cy + 16);
    sidewalk.addColorStop(0, '#c6cedc');
    sidewalk.addColorStop(1, '#9ca6b6');
    fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, sidewalk);
    drawSidewalkPaving64(ctx, cx, cy, st);

    // Crisp beveled stone curb (meio-fio)
    fillDiamond64(ctx, cx, cy, 19.4, 9.7, '#dfe6f0');
    fillDiamond64(ctx, cx, cy, 18, 9, '#414957');

    const drawArm = (dx: number, dy: number) => {
      for (let t = 1; t <= 8; t++) {
        fillDiamond64(ctx, cx + (dx * t) / 8, cy + (dy * t) / 8, 15.2, 7.6, '#d9e1ed');
      }
      for (let t = 1; t <= 8; t++) {
        fillDiamond64(ctx, cx + (dx * t) / 8, cy + (dy * t) / 8, 13.9, 6.95, '#414957');
      }
      drawLine64(ctx, cx + dx * 0.34, cy + dy * 0.34, cx + dx * 0.8, cy + dy * 0.8, '#e8cf7a', 1.1);
    };
    if (rotMask & 1) drawArm(16, -8);
    if (rotMask & 2) drawArm(16, 8);
    if (rotMask & 4) drawArm(-16, 8);
    if (rotMask & 8) drawArm(-16, -8);

    drawAsphaltDetails64(ctx, cx, cy, st, false);

    const bits =
      (rotMask & 1 ? 1 : 0) +
      (rotMask & 2 ? 1 : 0) +
      (rotMask & 4 ? 1 : 0) +
      (rotMask & 8 ? 1 : 0);
    if (bits >= 3) {
      // Crisp crosswalk stripes on intersections
      for (let s = -1; s <= 1; s++) {
        drawLine64(ctx, cx - 3 + s * 2.2, cy - 5.5, cx - 1.2 + s * 2.2, cy - 4.5, '#eef4fc', 1.2);
        drawLine64(ctx, cx - 3 + s * 2.2, cy + 4.5, cx - 1.2 + s * 2.2, cy + 5.5, '#eef4fc', 1.2);
      }
    } else if (rotMask === (1 | 4) || rotMask === (2 | 8)) {
      // Sidewalk micro-life on straight neighborhood streets
      const isNE = rotMask === (1 | 4);
      const sx1 = isNE ? cx - 15 : cx + 14;
      const sy1 = cy - 4;
      const sx2 = isNE ? cx + 14 : cx - 15;
      const sy2 = cy + 4;
      if (st === 0 || st === 3) drawStreetProp64(ctx, sx1, sy1, 'lamp');
      if (st === 1) drawStreetProp64(ctx, sx2, sy2, 'hydrant');
      else if (st === 2) drawStreetProp64(ctx, sx2, sy2, 'trash');
      else if (st === 4) drawStreetProp64(ctx, sx2, sy2, 'planter');
      else if (st === 5) drawStreetProp64(ctx, sx1, sy1, 'bench');
    }
  });
}

/**
 * 64-Bit HD Evolutionary River Bridge Sprite (Elevated Superstructure Only — Transparent Water Base!):
 * Water is rendered separately beneath so small boats, medium boats, yachts & ships visibly pass UNDER bridges!
 * - variant 0: Ponte de 2 Faixas (pista simples ida/volta)
 * - variant 1: Ponte Dupla Desenvolvida (pista larga de duas/quatro faixas com canteiro central e pilares reforçados)
 * - Nv. 1: Ponte Histórica de Pedra & Madeira com arco elevado e lampiões dourados
 * - Nv. 2: Ponte de Arcos Metálicos Vermelhos com treliça dupla de aço e pista asfaltada
 * - Nv. 3: Ponte Estaiada Monumental com torres A-frame iluminadas, cabos tensores e farol aéreo
 * - Nv. 4: Megaponte Expressa de 2 Espaços de Largura (pista dupla contígua com torres gêmeas branco/ouro e estais dourados/ciano)
 */
type BridgeTwinSide = 'none' | 'back' | 'front';

function getBridgeSprite(
  rotMask: number,
  level: number,
  variant: number,
  isCenterSpan: boolean,
  animFrame: number,
  twinSide: BridgeTwinSide = 'none',
  forceAxis?: 'ew' | 'ns'
): CachedSprite {
  const f = animFrame % 4;
  const lv = Math.max(1, Math.min(4, level || 1));
  const isWide = variant === 1 || lv >= 2;
  const isEW =
    forceAxis !== undefined
      ? forceAxis === 'ew'
      : ((rotMask & 2) !== 0 || (rotMask & 8) !== 0) &&
        !((rotMask & 1) !== 0 && (rotMask & 4) !== 0);
  const axisKey = isEW ? 'ew' : 'ns';
  const spanKey = isCenterSpan ? 'mid' : 'edge';

  return getOrCreateSprite(
    `bridge64_over_${axisKey}_lv${lv}_w${isWide ? 1 : 0}_t${twinSide}_${spanKey}_${f}`,
    96,
    136,
    48,
    102,
    (ctx, cx, cy) => {
      const adx = 16;
      const ady = isEW ? 8 : -8;
      const sideScale = isWide ? 1.24 : 1.0;
      const sideX = (isEW ? 8 : -8) * sideScale;
      const sideY = -6 * sideScale;

      // Subtle translucent bridge shadow cast onto the water (leaving boats underneath fully visible!)
      fillDiamond64(ctx, cx + 2, cy + 10, isWide ? 29 : 25, isWide ? 13 : 11, 'rgba(6, 18, 36, 0.30)');

      // White river foam around bridge piers (leaving central navigation channel clear for boats!)
      const pierOff = isWide ? 14.5 : 12;
      drawLine64(ctx, cx - pierOff - 4, cy + 12, cx - pierOff + 3, cy + 12, 'rgba(195, 242, 255, 0.65)', 1.4);
      drawLine64(ctx, cx + pierOff - 3, cy + 13, cx + pierOff + 4, cy + 13, 'rgba(195, 242, 255, 0.65)', 1.4);

      // Elevated clearance height so boats cleanly pass underneath the deck span
      const dy = cy - (isWide ? 7 : 5.5);

      const drawDualLaneDeckMarkings = (outerDeckW: number, innerDeckW: number, roadCol: string, curbCol: string) => {
        for (let t = -8; t <= 8; t += 1) {
          const ax = cx + (adx * t) / 8;
          const ay = dy + (ady * t) / 8;
          fillDiamond64(ctx, ax, ay, outerDeckW, outerDeckW * 0.5, curbCol);
          fillDiamond64(ctx, ax, ay, innerDeckW, innerDeckW * 0.5, roadCol);
        }
        if (isWide) {
          // Central concrete divider separating opposing dual carriageways
          drawLine64(ctx, cx - adx * 0.92, dy - ady * 0.92, cx + adx * 0.92, dy + ady * 0.92, '#cbd5e1', 2.4);
          drawLine64(ctx, cx - adx * 0.92, dy - ady * 0.92 - 0.8, cx + adx * 0.92, dy + ady * 0.92 - 0.8, '#ffe066', 0.9);
          // Dashed lane lines on both sides of the central divider (2 lanes each way)
          const lox = sideX * 0.44;
          const loy = sideY * 0.44;
          for (const seg of [
            [-0.78, -0.34],
            [0.34, 0.78],
          ]) {
            drawLine64(
              ctx,
              cx + adx * seg[0] + lox,
              dy + ady * seg[0] + loy,
              cx + adx * seg[1] + lox,
              dy + ady * seg[1] + loy,
              'rgba(241, 245, 249, 0.82)',
              1.0
            );
            drawLine64(
              ctx,
              cx + adx * seg[0] - lox,
              dy + ady * seg[0] - loy,
              cx + adx * seg[1] - lox,
              dy + ady * seg[1] - loy,
              'rgba(241, 245, 249, 0.82)',
              1.0
            );
          }
        } else {
          drawLine64(ctx, cx - adx * 0.85, dy - ady * 0.85, cx + adx * 0.85, dy + ady * 0.85, '#ffe066', 1.4);
        }
      };

      if (lv === 1) {
        // LEVEL 1: Historic Carved Stone Arch Bridge (standard or wide dual-lane stone viaduct)
        drawPrism64(ctx, cx - pierOff, cy + 13, isWide ? 5.5 : 4.5, 16, {
          top: '#b8ae9c',
          left: '#9e9483',
          right: '#5f574c',
        });
        drawPrism64(ctx, cx + pierOff, cy + 13, isWide ? 5.5 : 4.5, 16, {
          top: '#b8ae9c',
          left: '#9e9483',
          right: '#5f574c',
        });

        // High carved stone arch rim (open clearance underneath for boats!)
        ctx.strokeStyle = '#6f6659';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.ellipse(cx, cy + 5, pierOff - 2, 6, 0, Math.PI, 0);
        ctx.stroke();

        // Warm stone curb & timber/cobble deck
        drawDualLaneDeckMarkings(isWide ? 19.5 : 16, isWide ? 15.5 : 12, '#756554', '#c7bda9');

        // Cobble cross joints
        for (let t = -6; t <= 6; t += 2) {
          const ax = cx + (adx * t) / 8;
          const ay = dy + (ady * t) / 8;
          drawLine64(ctx, ax - sideX * 0.65, ay - sideY * 0.65, ax + sideX * 0.65, ay + sideY * 0.65, 'rgba(196, 175, 148, 0.35)', 0.9);
        }

        // Carved stone parapets
        drawLine64(ctx, cx - adx + sideX, dy - ady + sideY - 3, cx + adx + sideX, dy + ady + sideY - 3, '#e3dac8', 2.4);
        drawLine64(ctx, cx - adx - sideX, dy - ady - sideY - 3, cx + adx - sideX, dy + ady - sideY - 3, '#cfc5b2', 2.4);

        const drawLantern = (lx: number, ly: number) => {
          drawLine64(ctx, lx, ly - 2, lx, ly - 12, '#2a303b', 1.6);
          drawGlow64(ctx, lx, ly - 14, 7, 'rgba(255, 224, 110, 0.85)', 'rgba(255, 180, 50, 0)');
          ctx.fillStyle = '#fff5bd';
          ctx.beginPath();
          ctx.arc(lx, ly - 14, 2.2, 0, Math.PI * 2);
          ctx.fill();
        };
        drawLantern(cx + sideX, dy + sideY);
        drawLantern(cx - sideX, dy - sideY);
      } else if (lv === 2) {
        // LEVEL 2: Larger Developed Crimson Riveted Steel Truss Dual-Lane Arch Bridge
        drawPrism64(ctx, cx - pierOff, cy + 13, 6, 17, {
          top: '#cbd5e1',
          left: '#a8b7cc',
          right: '#526075',
        });
        drawPrism64(ctx, cx + pierOff, cy + 13, 6, 17, {
          top: '#cbd5e1',
          left: '#a8b7cc',
          right: '#526075',
        });

        const archPeak = isCenterSpan ? 32 : 21;
        const drawSteelArch = (ox: number, oy: number, mainCol: string, hiCol: string) => {
          const steps = 12;
          let prevX = cx - adx + ox;
          let prevY = dy - ady + oy - 2;
          for (let s = 1; s <= steps; s++) {
            const t = -1 + (s / steps) * 2;
            const parabola = 1 - t * t;
            const x = cx + adx * t + ox;
            const deckY = dy + ady * t + oy;
            const y = deckY - 4 - parabola * archPeak;
            drawLine64(ctx, prevX, prevY, x, y, mainCol, 3.2);
            drawLine64(ctx, prevX, prevY - 1.2, x, y - 1.2, hiCol, 1.3);
            if (s % 2 === 0 && s < steps) {
              drawLine64(ctx, x, y, x, deckY, mainCol, 1.35);
            }
            prevX = x;
            prevY = y;
          }
        };

        // Back arch behind wider dual-lane roadway
        drawSteelArch(sideX, sideY, '#992626', '#d94848');

        // Wide developed dual-lane asphalt deck with central divider & lane stripes
        drawDualLaneDeckMarkings(21.0, 16.8, '#323a49', '#d2dce8');

        // Overhead steel cross-bracing struts
        for (const frac of [-0.5, 0, 0.5]) {
          const p = 1 - frac * frac;
          const bx = cx + adx * frac;
          const by = dy + ady * frac - 4 - p * archPeak;
          drawLine64(ctx, bx + sideX, by + sideY, bx - sideX, by - sideY, '#ff7d63', 1.8);
        }

        // Front sunlit crimson steel arch + warm deck lamps
        drawSteelArch(-sideX, -sideY, '#c93434', '#ff8066');
      } else {
        // LEVEL 3: Monumental Wide Dual-Carriageway Cable-Stayed Bridge (Ponte Estaiada de Duas Faixas)
        if (lv === 3) {
          drawPrism64(ctx, cx - pierOff, cy + 13, 6.2, 18, {
            top: '#f1f5f9',
            left: '#e2e8f0',
            right: '#8f9fb5',
          });
          drawPrism64(ctx, cx + pierOff, cy + 13, 6.2, 18, {
            top: '#f1f5f9',
            left: '#e2e8f0',
            right: '#8f9fb5',
          });

          const pylonH = 62;
          const pylonTopY = dy - pylonH;

          if (isCenterSpan) {
            // Back-side taut silver-cyan stay cables
            for (const frac of [-0.95, -0.7, -0.45, -0.22, 0.22, 0.45, 0.7, 0.95]) {
              const ax = cx + adx * frac + sideX;
              const ay = dy + ady * frac + sideY;
              drawLine64(ctx, cx, pylonTopY + 7, ax, ay, 'rgba(186, 230, 253, 0.85)', 1.05);
            }
          }

          // Wide illuminated modern dual-carriageway expressway deck
          drawDualLaneDeckMarkings(22.5, 18.2, '#272f3f', '#eef3f9');

          // Front architectural white parapet + cyan LED bridge edge lighting
          drawLine64(ctx, cx - adx - sideX, dy - ady - sideY - 2, cx + adx - sideX, dy + ady - sideY - 2, '#ffffff', 2.2);
          drawLine64(ctx, cx - adx - sideX, dy - ady - sideY - 0.4, cx + adx - sideX, dy + ady - sideY - 0.4, '#38bdf8', 1.2);

          if (isCenterSpan) {
            // Soaring sculptural White A-Frame Pylon Tower spanning the wider dual deck
            drawLine64(ctx, cx + sideX, dy + sideY, cx, pylonTopY, '#ffffff', 3.6);
            drawLine64(ctx, cx - sideX, dy - sideY, cx + 1, pylonTopY, '#94a3b8', 3.6);
            drawLine64(ctx, cx - sideX - 1, dy - sideY, cx, pylonTopY, '#e2e8f0', 2.0);

            // Upper cross-struts & glowing cyan LED architectural spine
            drawLine64(ctx, cx - 6, pylonTopY + 26, cx + 6, pylonTopY + 26, '#e2e8f0', 3.2);
            drawLine64(ctx, cx - 4, pylonTopY + 14, cx + 4, pylonTopY + 14, '#f8fafc', 2.8);
            drawLine64(ctx, cx, pylonTopY + 9, cx, pylonTopY + 38, '#38bdf8', 2.2);
            drawGlow64(ctx, cx, pylonTopY + 20, 10, 'rgba(56, 189, 248, 0.38)', 'rgba(56, 189, 248, 0)');

            // Spire + glowing red aviation warning beacon
            drawLine64(ctx, cx, pylonTopY, cx, pylonTopY - 9, '#f8fafc', 1.6);
            drawGlow64(ctx, cx, pylonTopY - 10, 6.5, 'rgba(255, 77, 77, 0.85)', 'rgba(255, 77, 77, 0)');
            ctx.fillStyle = '#ff6b6b';
            ctx.beginPath();
            ctx.arc(cx, pylonTopY - 10, 2.1, 0, Math.PI * 2);
            ctx.fill();

            // Front-side gleaming white tension cables (estais)
            for (const frac of [-0.95, -0.7, -0.45, -0.22, 0.22, 0.45, 0.7, 0.95]) {
              const ax = cx + adx * frac - sideX;
              const ay = dy + ady * frac - sideY - 2;
              drawLine64(ctx, cx, pylonTopY + 7, ax, ay, '#f8fafc', 1.2);
            }
          } else {
            // Approach span: sleek white bridge light masts + approach anchor cables
            for (const frac of [-0.45, 0.45]) {
              const lx = cx + adx * frac - sideX;
              const ly = dy + ady * frac - sideY;
              drawLine64(ctx, lx, ly, lx, ly - 16, '#cbd5e1', 1.6);
              drawGlow64(ctx, lx, ly - 17, 6, 'rgba(255, 240, 165, 0.85)', 'rgba(255, 240, 165, 0)');
              ctx.fillStyle = '#fff9d6';
              ctx.beginPath();
              ctx.arc(lx, ly - 17, 1.7, 0, Math.PI * 2);
              ctx.fill();
            }
            drawLine64(ctx, cx - adx - sideX, dy - ady - sideY - 2, cx, dy - 24, 'rgba(186, 230, 253, 0.72)', 1.05);
            drawLine64(ctx, cx + adx - sideX, dy + ady - sideY - 2, cx, dy - 24, 'rgba(186, 230, 253, 0.72)', 1.05);
          }
        } else {
          // LEVEL 4: Ultimate 2-Tile-Wide Twin-Deck Mega-Bridge (Megaponte Expressa de 2 Espaços)
          const isTwinBack = twinSide === 'back';
          const isTwinFront = twinSide === 'front';
          const isTwin = isTwinBack || isTwinFront;
          // Shift deck slightly toward the sibling deck so the 2 parallel bridge tiles fuse seamlessly over the river
          const seamBiasX = isTwinBack ? -sideX * 0.26 : isTwinFront ? sideX * 0.26 : 0;
          const seamBiasY = isTwinBack ? -sideY * 0.26 : isTwinFront ? sideY * 0.26 : 0;
          const dcx = cx + seamBiasX;
          const dcy = dy + seamBiasY;

          // Reinforced monumental river caissons with golden structural collar
          drawPrism64(ctx, cx - pierOff, cy + 13, 6.8, 19, {
            top: '#f8fafc',
            left: '#e2e8f0',
            right: '#64748b',
          });
          drawPrism64(ctx, cx + pierOff, cy + 13, 6.8, 19, {
            top: '#f8fafc',
            left: '#e2e8f0',
            right: '#64748b',
          });
          drawLine64(ctx, cx - pierOff - 3, cy + 6, cx - pierOff + 3, cy + 6, '#f5b73b', 1.4);
          drawLine64(ctx, cx + pierOff - 3, cy + 6, cx + pierOff + 3, cy + 6, '#f5b73b', 1.4);

          const pylonH = 72;
          const outerDir = isTwinBack ? 1 : -1;
          const outerEdgeX = dcx + sideX * outerDir;
          const outerEdgeY = dcy + sideY * outerDir;
          const pylonTipX = isTwin ? dcx + sideX * outerDir * 0.52 : cx;
          const pylonTipY = dcy - pylonH;

          // Back-side fan of gleaming golden & ice-cyan stay cables before deck
          if (isCenterSpan && (isTwinBack || !isTwin)) {
            for (const frac of [-0.96, -0.74, -0.52, -0.28, 0.28, 0.52, 0.74, 0.96]) {
              const ax = dcx + adx * frac + sideX;
              const ay = dcy + ady * frac + sideY - 1;
              drawLine64(ctx, pylonTipX, pylonTipY + 8, ax, ay, 'rgba(254, 240, 138, 0.85)', 1.1);
            }
          }

          // Extra-wide dark expressway asphalt deck spanning seamlessly across the 2-tile width
          const outerDeckW = isTwin ? 26.5 : 23.8;
          const innerDeckW = isTwin ? 22.8 : 19.6;
          for (let t = -8; t <= 8; t += 1) {
            const ax = dcx + (adx * t) / 8;
            const ay = dcy + (ady * t) / 8;
            fillDiamond64(ctx, ax, ay, outerDeckW, outerDeckW * 0.5, '#e2e8f0');
            fillDiamond64(ctx, ax, ay, innerDeckW, innerDeckW * 0.5, '#1e2636');
          }

          // Express multi-lane white dashed striping (2 full lanes per deck = 4+ lanes across 2 tiles)
          for (const laneFrac of [-0.36, 0.36]) {
            const lox = sideX * laneFrac;
            const loy = sideY * laneFrac;
            for (const seg of [
              [-0.84, -0.44],
              [-0.20, 0.20],
              [0.44, 0.84],
            ]) {
              drawLine64(
                ctx,
                dcx + adx * seg[0] + lox,
                dcy + ady * seg[0] + loy,
                dcx + adx * seg[1] + lox,
                dcy + ady * seg[1] + loy,
                'rgba(248, 250, 252, 0.86)',
                1.05
              );
            }
          }

          if (isTwin) {
            // Central luminous boulevard median right on the seam joining the 2 decks
            const seamDir = -outerDir;
            const sx1 = dcx - adx * 0.98 + sideX * seamDir * 0.92;
            const sy1 = dcy - ady * 0.98 + sideY * seamDir * 0.92;
            const sx2 = dcx + adx * 0.98 + sideX * seamDir * 0.92;
            const sy2 = dcy + ady * 0.98 + sideY * seamDir * 0.92;
            drawLine64(ctx, sx1, sy1, sx2, sy2, '#cbd5e1', 2.4);
            drawLine64(ctx, sx1, sy1 - 0.9, sx2, sy2 - 0.9, '#ffe066', 1.2);
            if (isTwinBack) {
              // Subtle central median LED beacon nodes along the seam
              for (const mf of [-0.55, 0, 0.55]) {
                const mx = dcx + adx * mf + sideX * seamDir * 0.92;
                const my = dcy + ady * mf + sideY * seamDir * 0.92 - 2;
                drawGlow64(ctx, mx, my, 4.5, 'rgba(56, 189, 248, 0.65)', 'rgba(56, 189, 248, 0)');
              }
            }
          } else {
            // Single-width Nv. 4 central golden-white express divider
            drawLine64(ctx, dcx - adx * 0.94, dcy - ady * 0.94, dcx + adx * 0.94, dcy + ady * 0.94, '#cbd5e1', 2.5);
            drawLine64(ctx, dcx - adx * 0.94, dcy - ady * 0.94 - 0.9, dcx + adx * 0.94, dcy + ady * 0.94 - 0.9, '#ffe066', 1.1);
          }

          // Outer architectural white/gold parapet + glowing cyan LED ribbon
          const drawOuterParapet = (dirSign: number) => {
            const px1 = dcx - adx + sideX * dirSign;
            const py1 = dcy - ady + sideY * dirSign;
            const px2 = dcx + adx + sideX * dirSign;
            const py2 = dcy + ady + sideY * dirSign;
            drawLine64(ctx, px1, py1 - 2.4, px2, py2 - 2.4, '#ffffff', 2.4);
            drawLine64(ctx, px1, py1 - 0.6, px2, py2 - 0.6, '#38bdf8', 1.4);
            drawLine64(ctx, px1, py1 - 3.6, px2, py2 - 3.6, '#f5b73b', 0.9);
          };
          if (isTwin) {
            drawOuterParapet(outerDir);
          } else {
            drawOuterParapet(1);
            drawOuterParapet(-1);
          }

          if (isCenterSpan) {
            // Soaring sculptural White & Gold Mega-Pylon Tower
            if (isTwin) {
              // Monumental twin-deck outer angled tower leg + golden-lit inner buttress
              drawLine64(ctx, outerEdgeX, outerEdgeY, pylonTipX, pylonTipY, '#ffffff', 4.2);
              drawLine64(ctx, outerEdgeX + 1.5, outerEdgeY, pylonTipX + 1.2, pylonTipY, '#94a3b8', 2.4);
              drawLine64(ctx, dcx, dcy, pylonTipX, pylonTipY + 18, '#e2e8f0', 2.6);
              // Golden architectural crown rings & cyan vertical LED spine
              drawLine64(ctx, pylonTipX - 4.5, pylonTipY + 26, pylonTipX + 4.5, pylonTipY + 26, '#f5b73b', 3.0);
              drawLine64(ctx, pylonTipX - 3.5, pylonTipY + 13, pylonTipX + 3.5, pylonTipY + 13, '#ffe066', 2.6);
              drawLine64(ctx, pylonTipX, pylonTipY + 8, pylonTipX, pylonTipY + 42, '#38bdf8', 2.4);
              drawGlow64(ctx, pylonTipX, pylonTipY + 22, 11, 'rgba(56, 189, 248, 0.42)', 'rgba(56, 189, 248, 0)');
            } else {
              drawLine64(ctx, dcx + sideX, dcy + sideY, pylonTipX, pylonTipY, '#ffffff', 4.0);
              drawLine64(ctx, dcx - sideX, dcy - sideY, pylonTipX + 1, pylonTipY, '#94a3b8', 4.0);
              drawLine64(ctx, dcx - sideX - 1, dcy - sideY, pylonTipX, pylonTipY, '#f8fafc', 2.2);
              drawLine64(ctx, pylonTipX - 6.5, pylonTipY + 28, pylonTipX + 6.5, pylonTipY + 28, '#f5b73b', 3.2);
              drawLine64(ctx, pylonTipX - 4.5, pylonTipY + 14, pylonTipX + 4.5, pylonTipY + 14, '#ffe066', 2.8);
              drawLine64(ctx, pylonTipX, pylonTipY + 8, pylonTipX, pylonTipY + 42, '#38bdf8', 2.4);
              drawGlow64(ctx, pylonTipX, pylonTipY + 22, 11, 'rgba(255, 224, 102, 0.36)', 'rgba(255, 224, 102, 0)');
            }

            // Tall golden spire + glowing aviation beacon
            drawLine64(ctx, pylonTipX, pylonTipY, pylonTipX, pylonTipY - 11, '#ffe066', 1.8);
            drawGlow64(ctx, pylonTipX, pylonTipY - 12, 7.5, 'rgba(255, 77, 77, 0.9)', 'rgba(255, 77, 77, 0)');
            ctx.fillStyle = '#ff6b6b';
            ctx.beginPath();
            ctx.arc(pylonTipX, pylonTipY - 12, 2.2, 0, Math.PI * 2);
            ctx.fill();

            // Front-side sweeping golden & cyan tension cables
            if (isTwinFront || !isTwin) {
              for (const frac of [-0.96, -0.74, -0.52, -0.28, 0.28, 0.52, 0.74, 0.96]) {
                const ax = dcx + adx * frac - sideX;
                const ay = dcy + ady * frac - sideY - 2;
                const col = Math.abs(frac) > 0.6 ? '#ffe066' : '#e0f2fe';
                drawLine64(ctx, pylonTipX, pylonTipY + 8, ax, ay, col, 1.25);
              }
            }
          } else {
            // Approach spans: sleek golden-trimmed expressway light masts along the outer parapet
            const mastDir = isTwin ? outerDir : -1;
            for (const frac of [-0.48, 0.48]) {
              const lx = dcx + adx * frac + sideX * mastDir;
              const ly = dcy + ady * frac + sideY * mastDir;
              drawLine64(ctx, lx, ly - 1, lx, ly - 18, '#e2e8f0', 1.8);
              drawLine64(ctx, lx, ly - 18, lx - sideX * mastDir * 0.22, ly - 19, '#f5b73b', 1.4);
              drawGlow64(ctx, lx, ly - 19, 6.5, 'rgba(255, 232, 138, 0.9)', 'rgba(255, 232, 138, 0)');
              ctx.fillStyle = '#fff9d6';
              ctx.beginPath();
              ctx.arc(lx, ly - 19, 1.8, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      }
    }
  );
}

/**
 * Determine exact crossing axis, center-pylon placement, and 2-tile-wide twin-deck side
 * in camera-rotated screen space so 1-tile and 2-tile-wide bridges render seamlessly across all 4 rotations.
 */
function getBridgeRenderTopology(
  state: CityState,
  tile: Tile,
  rotation: CameraRotation
): { isCenterSpan: boolean; twinSide: BridgeTwinSide; screenAxis: 'ew' | 'ns' } {
  let minY = tile.y;
  let maxY = tile.y;
  while (getTile(state, tile.x, minY - 1)?.type === 'bridge') minY--;
  while (getTile(state, tile.x, maxY + 1)?.type === 'bridge') maxY++;
  const lenNS = maxY - minY + 1;

  let minX = tile.x;
  let maxX = tile.x;
  while (getTile(state, minX - 1, tile.y)?.type === 'bridge') minX--;
  while (getTile(state, maxX + 1, tile.y)?.type === 'bridge') maxX++;
  const lenEW = maxX - minX + 1;

  let worldAxis: 'ew' | 'ns';
  if (lenEW > lenNS) {
    worldAxis = 'ew';
  } else if (lenNS > lenEW) {
    worldAxis = 'ns';
  } else {
    // Equal run (e.g., 1x1 or 2x2 over a narrow river): check which axis connects directly to riverbank roads
    const roadEW =
      (getTile(state, minX - 1, tile.y)?.type === 'road' ? 1 : 0) +
      (getTile(state, maxX + 1, tile.y)?.type === 'road' ? 1 : 0);
    const roadNS =
      (getTile(state, tile.x, minY - 1)?.type === 'road' ? 1 : 0) +
      (getTile(state, tile.x, maxY + 1)?.type === 'road' ? 1 : 0);
    worldAxis = roadEW >= roadNS ? 'ew' : 'ns';
  }

  const spanLen = worldAxis === 'ew' ? lenEW : lenNS;
  const spanIdx = worldAxis === 'ew' ? tile.x - minX : tile.y - minY;
  const isCenterSpan =
    spanLen <= 3
      ? spanIdx === Math.floor(spanLen / 2)
      : spanLen <= 5
        ? spanIdx === 1 || spanIdx === spanLen - 2
        : spanIdx === 2 || spanIdx === spanLen - 3;

  const screenAxis: 'ew' | 'ns' =
    rotation % 2 === 0 ? worldAxis : worldAxis === 'ew' ? 'ns' : 'ew';

  // Detect parallel sibling bridge tile perpendicular to the world crossing axis
  let sibWorldBit = 0;
  if (worldAxis === 'ew') {
    const hasS = getTile(state, tile.x, tile.y + 1)?.type === 'bridge';
    const hasN = getTile(state, tile.x, tile.y - 1)?.type === 'bridge';
    if (hasS && !hasN) sibWorldBit = 4; // South
    else if (hasN && !hasS) sibWorldBit = 1; // North
  } else {
    const hasE = getTile(state, tile.x + 1, tile.y)?.type === 'bridge';
    const hasW = getTile(state, tile.x - 1, tile.y)?.type === 'bridge';
    if (hasE && !hasW) sibWorldBit = 2; // East
    else if (hasW && !hasE) sibWorldBit = 8; // West
  }

  let twinSide: BridgeTwinSide = 'none';
  if (sibWorldBit !== 0) {
    const sibRotBit = rotateRoadMask(sibWorldBit, rotation);
    if (screenAxis === 'ew') {
      // S (4) is closer to camera (-side) => this tile is 'back'; N (1) is farther (+side) => this tile is 'front'
      twinSide = sibRotBit === 4 ? 'back' : sibRotBit === 1 ? 'front' : 'none';
    } else {
      // E (2) is closer to camera (-side) => this tile is 'back'; W (8) is farther (+side) => this tile is 'front'
      twinSide = sibRotBit === 2 ? 'back' : sibRotBit === 8 ? 'front' : 'none';
    }
  }

  return { isCenterSpan, twinSide, screenAxis };
}

/**
 * 64-Bit HD Isometric Rural Zone (Zona Rural):
 * 12 coordinate-seeded agricultural variants across 3 modernization levels with dithered soil/wheat,
 * gable farmhouses with chimneys, orchards, timber barns, silos, windmills, and glass greenhouses.
 */
function getRuralSprite(
  level: number,
  variant: number,
  lotDx: number = 0,
  lotDy: number = 0,
  coordSeed: number = 0
): CachedSprite {
  const lv = Math.max(1, Math.min(3, level || 1));
  const v = (((coordSeed || variant) + lotDx * 3 + lotDy * 5) % 12 + 12) % 12;
  return getOrCreateSprite(`rural64_v2_${lv}_${v}`, 78, 90, 39, 62, (ctx, cx, cy) => {
    const soilPalettes = [
      ['#7ea144', '#5c7a2e'],
      ['#8f6e46', '#6b4f2f'],
      ['#6f993e', '#4d7028'],
      ['#9c7d4e', '#755b36'],
    ][v % 4];
    const baseGrad = ctx.createLinearGradient(cx - 32, cy - 16, cx + 32, cy + 16);
    baseGrad.addColorStop(0, soilPalettes[0]);
    baseGrad.addColorStop(1, soilPalettes[1]);
    fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, baseGrad);
    stampPixelDither(ctx, cx - 22, cy - 10, 44, 20, 'rgba(32, 48, 16, 0.18)', 4, v * 13, 0.28);

    // Timber split-rail perimeter fence along back edges
    drawLine64(ctx, cx - 28, cy - 1, cx - 2, cy - 14, '#8c6239', 1.4);
    drawLine64(ctx, cx + 2, cy - 14, cx + 28, cy - 1, '#6e4b2a', 1.4);

    if (lv === 1) {
      if (v % 4 === 0) {
        // Golden Wheat Furrows + Terracotta Gable Farmhouse with Chimney
        fillDiamond64(ctx, cx + 5, cy + 3, 18, 9, '#d6b13c');
        for (let r = -10; r <= 10; r += 3.5) {
          drawLine64(ctx, cx - 5 + r, cy + 2 + r * 0.5, cx + 11 + r, cy - 6 + r * 0.5, '#fae078', 1.4);
        }
        stampPixelDither(ctx, cx - 8, cy - 4, 24, 13, 'rgba(138, 98, 22, 0.28)', 3, v, 0.35);
        drawPrism64(ctx, cx - 10, cy - 1, 9, 10, {
          top: '#a84a32', left: '#f2e3c6', leftBot: '#d9c6a3', right: '#c7b28f', rightBot: '#a6906d',
        }, { castShadow: true, material: 'plaster', seed: v });
        drawPitchedRoof64(ctx, cx - 10, cy - 11, 9, 7, { hi: '#d66040', mid: '#b0482c', sh: '#782c18' }, 'gable_ne', v, true);
      } else if (v % 4 === 1) {
        // Plowed Vegetable Rows & Country Windmill + Stone Well
        fillDiamond64(ctx, cx - 4, cy + 3, 19, 9.5, '#5c4028');
        for (let r = -10; r <= 10; r += 3.8) {
          drawLine64(ctx, cx - 14 + r, cy + 3 + r * 0.45, cx + 2 + r, cy - 5 + r * 0.45, '#52a846', 2.0);
          drawLine64(ctx, cx - 13 + r, cy + 2.5 + r * 0.45, cx + 1 + r, cy - 5 + r * 0.45, '#8ee06c', 0.8);
        }
        drawLine64(ctx, cx + 12, cy + 1, cx + 12, cy - 22, '#8c6239', 2.4);
        drawLine64(ctx, cx + 5, cy - 22, cx + 19, cy - 16, '#f1f5f9', 1.6);
        drawLine64(ctx, cx + 9, cy - 26, cx + 15, cy - 12, '#cbd5e1', 1.6);
        drawSpeciesTree64(ctx, cx - 15, cy - 4, 'oak', 0.68, v);
      } else if (v % 4 === 2) {
        // Lush Pasture, Hay Bales, Timber Shed & Cypress
        drawPrism64(ctx, cx - 8, cy - 2, 11, 10, {
          top: '#8c4b31', left: '#bd764a', leftBot: '#945733', right: '#7d4b2d', rightBot: '#59331d',
        }, { castShadow: true, material: 'wood', seed: v });
        drawPitchedRoof64(ctx, cx - 8, cy - 12, 11, 7, { hi: '#9c5c3c', mid: '#7d452a', sh: '#542c19' }, 'gable_nw', v, false);
        ctx.fillStyle = '#e8c14d';
        ctx.beginPath();
        ctx.arc(cx + 8, cy + 4, 3.2, 0, Math.PI * 2);
        ctx.arc(cx + 15, cy + 1, 3.2, 0, Math.PI * 2);
        ctx.arc(cx + 11, cy + 6.5, 2.8, 0, Math.PI * 2);
        ctx.fill();
        drawSpeciesTree64(ctx, cx + 14, cy - 5, 'cypress', 0.72, v);
      } else {
        // Family Vineyard / Coffee Rows & Rustic Terracotta Cottage
        for (let r = -9; r <= 9; r += 4) {
          drawLine64(ctx, cx - 12 + r, cy + 4 + r * 0.45, cx + 6 + r, cy - 5 + r * 0.45, '#3d853c', 2.2);
        }
        drawPrism64(ctx, cx + 9, cy - 2, 8.5, 9.5, {
          top: '#b3573b', left: '#edd4b2', right: '#b89f7d',
        }, { castShadow: true, material: 'brick', seed: v });
        drawPitchedRoof64(ctx, cx + 9, cy - 11.5, 8.5, 6.5, { hi: '#cf5d3e', mid: '#a3442a', sh: '#702a17' }, 'hip', v, true);
        drawBushOrFlowerbed64(ctx, cx - 11, cy + 5, v, true);
      }
    } else if (lv === 2) {
      if (v % 2 === 0) {
        // Classic Crimson Timber Barn & Galvanized Grain Silo
        drawPrism64(ctx, cx - 4, cy + 2, 15, 14, {
          top: '#7d2622', topHi: '#a63732', left: '#cc3d35', leftBot: '#a12a24', right: '#8a231e', rightBot: '#611612',
        }, { outlineColor: '#f8fafc', castShadow: true, material: 'wood', seed: v });
        drawPitchedRoof64(ctx, cx - 4, cy - 12, 15, 9, { hi: '#9c3630', mid: '#782420', sh: '#521512' }, 'gable_ne', v, false);
        ctx.strokeStyle = '#f8fafc';
        ctx.lineWidth = 1.1;
        ctx.strokeRect(cx - 14, cy - 7, 6, 7);
        drawLine64(ctx, cx - 14, cy - 7, cx - 8, cy, '#f8fafc', 0.8);
        drawLine64(ctx, cx - 8, cy - 7, cx - 14, cy, '#f8fafc', 0.8);
        drawPrism64(ctx, cx + 14, cy - 2, 5.5, 22, {
          top: '#f1f5f9', left: '#cbd5e1', right: '#64748b',
        }, { material: 'concrete', seed: v });
      } else {
        // Lush Fruit Orchard Grove (mixed lime, pink blossom, gold ipê) & Farmhouse
        drawSpeciesTree64(ctx, cx - 14, cy + 1, 'lime', 0.78, v);
        drawSpeciesTree64(ctx, cx - 2, cy - 5, 'oak', 0.8, v + 1);
        drawSpeciesTree64(ctx, cx + 11, cy + 1, v % 4 === 1 ? 'ipe_pink' : 'ipe_gold', 0.78, v + 2);
        drawSpeciesTree64(ctx, cx - 1, cy + 7, 'autumn', 0.76, v + 3);
        drawPrism64(ctx, cx + 10, cy - 4, 8, 10, {
          top: '#b55338', left: '#f5ebd6', right: '#c4b497',
        }, { castShadow: true, material: 'plaster', seed: v });
        drawPitchedRoof64(ctx, cx + 10, cy - 14, 8, 6, { hi: '#d45e3f', mid: '#a8442a', sh: '#732c19' }, 'hip', v, true);
      }
    } else {
      // Lv 3: High-Tech Glass Hydroponic Greenhouses & Twin Agro-Industrial Silos
      drawPrism64(ctx, cx - 7, cy + 3, 15, 13, {
        top: '#bae6fd', topHi: '#e0f2fe', left: 'rgba(186, 230, 253, 0.86)', right: 'rgba(56, 189, 248, 0.78)',
      }, { outlineColor: '#ffffff', castShadow: true, material: 'glass', seed: v });
      fillDiamond64(ctx, cx - 7, cy + 1, 11, 5.5, '#3da84a');
      drawPrism64(ctx, cx + 12, cy - 3, 5.5, 24, {
        top: '#ffffff', left: '#dbe4f0', right: '#7c8ba1',
      }, { material: 'concrete', seed: v });
      drawPrism64(ctx, cx + 19, cy + 1, 5, 20, {
        top: '#ffffff', left: '#dbe4f0', right: '#7c8ba1',
      }, { material: 'concrete', seed: v + 3 });
    }
  });
}

function getResidentialSprite(
  level: number,
  variant: number,
  wealthTier: 0 | 1 | 2 = 1,
  lotW: number = 1,
  lotH: number = 1,
  lotDx: number = 0,
  lotDy: number = 0,
  coordSeed: number = 0,
  rotation: CameraRotation = 0,
  hasHelipad: boolean = false,
  anchorXCoord: number = 0,
  anchorYCoord: number = 0
): CachedSprite {
  if (level >= 4 && lotW >= 2 && lotH >= 2) {
    const rotLot = getRotatedLotCoords(lotW, lotH, lotDx, lotDy, rotation);
    const archIdx = getSkyscraperStyleIdx(anchorXCoord, anchorYCoord, variant, 16);
    const pal = RESIDENTIAL_PALETTES[archIdx];
    const roofHd = 118 + (archIdx % 4) * 9;
    if (!rotLot.isFrontCorner) {
      return getOrCreateSprite(
        `res64_lv4_base_${archIdx}_${rotLot.rDx}${rotLot.rDy}`,
        84,
        144,
        42,
        114,
        (ctx, cx, cy) => {
          fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, '#cfd8e4');
          fillDiamond64(ctx, cx, cy, 29, 14.5, '#dce4ef');
          drawSidewalkPaving64(ctx, cx, cy, archIdx + rotLot.rDx);
          drawSpeciesTree64(ctx, cx - 18, cy + 2, 'ipe_gold', 0.62, archIdx + rotLot.rDy);
        }
      );
    }
    return getOrCreateSprite(
      `res64_lv4_hero_${archIdx}_hp${hasHelipad ? 1 : 0}`,
      168,
      258,
      84,
      206,
      (ctx, cx, cy) => {
        fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, '#cfd8e4');
        fillDiamond64(ctx, cx, cy, 29, 14.5, '#dce4ef');
        drawSidewalkPaving64(ctx, cx, cy, archIdx + 3);
        const mx = cx;
        const my = cy - TILE_HH; // Exact 2×2 center!

        // Grand 2×2 stone & marble urban podium base
        drawPrism64(
          ctx,
          mx,
          my + 3,
          47,
          20,
          { top: '#e2e8f0', topHi: '#ffffff', left: '#cbd5e1', leftBot: '#94a3b8', right: '#64748b', rightBot: '#475569' },
          { material: 'stone', seed: archIdx, castShadow: true, parapet: true }
        );
        // Landscaped terrace trees & shimmering courtyard pool on podium corners
        fillDiamond64(ctx, mx - 24, my - 5, 8.5, 4.2, '#38bdf8', '#e0f2fe', 0.9);
        drawSpeciesTree64(ctx, mx + 24, my - 4, 'ipe_pink', 0.6, archIdx);

        // Main monumental 2×2 residential supertall tower shaft
        const shaftH = roofHd - 26;
        drawPrism64(ctx, mx, my - 15, 36, shaftH, pal, {
          rimColor: '#ffffff',
          outlineColor: pal.trim,
          castShadow: true,
          parapet: true,
          material: pal.material === 'wood' ? 'glass' : pal.material,
          seed: archIdx,
        });
        drawWindows64(ctx, mx, my - 15, 36, shaftH, 10 + (archIdx % 3), 6, {
          litColor: '#ffe796',
          litCoolColor: '#c4f5ff',
          glassLeft: wealthTier === 2 ? '#2563eb' : '#355070',
          glassRight: wealthTier === 2 ? '#1e3a8a' : '#1d2d42',
          seed: archIdx + 23,
          curtainWall: true,
        });
        // Balconies & structural sky-belts
        for (const frac of [0.34, 0.68]) {
          const by = my - 15 - shaftH * frac;
          drawLine64(ctx, mx - 36, by, mx, by + 18, 'rgba(255,255,255,0.45)', 1.6);
          drawLine64(ctx, mx, by + 18, mx + 36, by, 'rgba(255,255,255,0.22)', 1.6);
        }

        // Upper stepped setback deck reaching exact `roofHd`
        drawPrism64(
          ctx,
          mx,
          my - 15 - shaftH,
          27,
          12,
          { top: pal.topHi, left: pal.left, right: pal.right },
          { rimColor: '#ffffff', parapet: true, material: pal.material, seed: archIdx + 5 }
        );

        const roofY = my - roofHd;
        if (hasHelipad) {
          // Penthouse mechanical core offset to rear edge so rooftop helipad sits crystal clear at center!
          drawPrism64(ctx, mx - 13, roofY - 4, 8, 9, {
            top: pal.topHi,
            left: pal.left,
            right: pal.right,
          });
          drawRooftopHelipad64(ctx, mx, roofY, 17);
        } else {
          // Sky-garden terrace + architectural crown & spire
          fillDiamond64(ctx, mx, roofY, 21, 10.5, '#48a359');
          drawSpeciesTree64(ctx, mx - 10, roofY + 1, 'lime', 0.45, archIdx);
          drawSpeciesTree64(ctx, mx + 10, roofY - 1, 'ipe_pink', 0.45, archIdx + 1);
          drawPrism64(ctx, mx, roofY, 13, 12, { top: pal.topHi, left: pal.left, right: pal.right }, { parapet: true });
          drawLine64(ctx, mx, roofY - 12, mx, roofY - 36, '#e2e8f0', 2.2);
          drawGlow64(ctx, mx, roofY - 37, 6, 'rgba(255, 82, 82, 0.92)', 'rgba(255, 82, 82, 0)');
          ctx.fillStyle = '#ff595e';
          ctx.fillRect(mx - 1.5, roofY - 38.5, 3, 3);
        }
      }
    );
  }

  const s = Math.abs((coordSeed || variant * 17) + lotDx * 7 + lotDy * 13);
  const archIdx = s % 16; // 16 rich organic architectural styles — zero neighboring repetition!
  const isCompound = lotW > 1 || lotH > 1;
  return getOrCreateSprite(
    `res64_v2_${level}_w${wealthTier}_a${archIdx}_c${isCompound ? 1 : 0}_${lotDx}${lotDy}`,
    84,
    144,
    42,
    114,
    (ctx, cx, cy) => {
      const pal = RESIDENTIAL_PALETTES[archIdx];
      const yardTrees: TreeSpecies[] = ['oak', 'lime', 'ipe_pink', 'ipe_gold', 'palm', 'cypress', 'autumn', 'pine'];
      const treeSp = yardTrees[(archIdx + wealthTier * 3) % yardTrees.length];

      // Landscaped lot base with pixel dithering & paving borders
      const lotGrad = ctx.createLinearGradient(cx - 32, cy - 16, cx + 32, cy + 16);
      if (wealthTier === 0) {
        lotGrad.addColorStop(0, '#6e8a54');
        lotGrad.addColorStop(1, '#4f663c');
      } else if (wealthTier === 2) {
        lotGrad.addColorStop(0, '#cfd9e6');
        lotGrad.addColorStop(1, '#98a6b8');
      } else if (level === 1) {
        lotGrad.addColorStop(0, '#62ab4c');
        lotGrad.addColorStop(1, '#478537');
      } else {
        lotGrad.addColorStop(0, '#a4afc0');
        lotGrad.addColorStop(1, '#7a8596');
      }
      fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, lotGrad);
      stampPixelDither(ctx, cx - 24, cy - 12, 48, 24, 'rgba(255,255,255,0.10)', 4, archIdx, 0.25);

      if (isCompound) {
        fillDiamond64(ctx, cx, cy, 27, 13.5, wealthTier === 2 ? '#e2e9f2' : '#8b97ab');
        if (wealthTier >= 1 && (lotDx + lotDy) % 2 === 1) {
          fillDiamond64(ctx, cx - 9, cy + 4, 9, 4.5, '#38bdf8', '#e0f2fe', 1.0);
        }
      }

      if (level === 1) {
        if (wealthTier === 0) {
          // Baixo Valor: Varied Worker Cottages, Brick Sobradinhos, Duplexes with Water Tanks & Gardens
          const ox = (archIdx % 3) - 1;
          const hw = 13 + (archIdx % 3);
          const hh = 11 + (archIdx % 4) * 2;
          // Cobble walkway
          fillDiamond64(ctx, cx - 7, cy + 6, 5.5, 2.8, '#9fa8b5');

          drawPrism64(
            ctx,
            cx + ox * 2,
            cy + 2,
            hw,
            hh,
            {
              top: pal.roofMid,
              topHi: pal.roofHi,
              left: pal.left,
              leftBot: pal.leftBot,
              right: pal.right,
              rightBot: pal.rightBot,
            },
            { castShadow: true, material: pal.material, seed: archIdx, parapet: archIdx % 4 === 3 }
          );

          if (archIdx % 4 === 3) {
            // Flat concrete slab (laje) with iconic blue water tank!
            drawRooftopProps64(ctx, cx + ox * 2, cy + 2 - hh, hw, archIdx, 'low');
          } else {
            const roofKind = archIdx % 3 === 0 ? 'gable_ne' : archIdx % 3 === 1 ? 'gable_nw' : 'hip';
            drawPitchedRoof64(
              ctx,
              cx + ox * 2,
              cy + 2 - hh,
              hw,
              8 + (archIdx % 3),
              { hi: pal.roofHi, mid: pal.roofMid, sh: pal.roofSh },
              roofKind,
              archIdx,
              archIdx % 5 === 0
            );
          }

          if (archIdx % 5 === 4) {
            // Secondary brick annex / backyard workshop
            drawPrism64(ctx, cx + 11, cy - 2, 7.5, 9, {
              top: pal.roofSh,
              left: pal.leftBot,
              right: pal.rightBot,
            }, { material: 'brick', seed: archIdx + 4 });
          } else {
            drawBushOrFlowerbed64(ctx, cx - 15, cy + 3, archIdx, archIdx % 2 === 0);
          }

          drawWindows64(ctx, cx + ox * 2, cy + 2, hw, hh, 1, 2, {
            litColor: '#ffe082',
            glassLeft: '#4a6b82',
            glassRight: '#2b4152',
            seed: archIdx + 2,
          });
        } else {
          // Médio & Alto Valor: 16 Distinct Villas, Colonial Houses, Chalets & Modernist Mansions
          fillDiamond64(ctx, cx - 9, cy + 5, 7.5, 3.8, '#c5cedb');
          if (wealthTier === 2) {
            // Private swimming pool + deck patio
            fillDiamond64(ctx, cx - 12, cy + 4, 8.8, 4.4, '#22d3ee', '#f8fafc', 0.95);
            drawLine64(ctx, cx - 15, cy + 3.5, cx - 9, cy + 4.5, 'rgba(255,255,255,0.55)', 1.0);
          } else if (archIdx % 2 === 0) {
            drawBushOrFlowerbed64(ctx, cx - 13, cy + 5, archIdx, true);
          }
          drawSpeciesTree64(ctx, cx - 19, cy + 1, treeSp, 0.72, archIdx);

          const hw = (wealthTier === 2 ? 17 : 15) + (archIdx % 3);
          const hh = (wealthTier === 2 ? 17 : 14) + (archIdx % 4) * 2;
          const ox = (archIdx % 2 === 0) ? 2 : 0;

          drawPrism64(
            ctx,
            cx + ox,
            cy + 2,
            hw,
            hh,
            {
              top: pal.top,
              topHi: pal.topHi,
              left: pal.left,
              leftBot: pal.leftBot,
              right: pal.right,
              rightBot: pal.rightBot,
            },
            {
              castShadow: true,
              rimColor: 'rgba(255,255,255,0.48)',
              material: pal.material,
              seed: archIdx,
              parapet: wealthTier === 2 && archIdx % 3 === 0,
            }
          );

          if (wealthTier === 2 && archIdx % 3 === 0) {
            // Modern Flat-Roof Cantilevered Luxury Villa with 2nd-story glass studio & rooftop garden
            drawPrism64(ctx, cx + ox + 2, cy + 2 - hh, 10.5, 9, {
              top: '#f8fafc', left: '#ffffff', leftBot: '#e2e8f0', right: '#cbd5e1', rightBot: '#94a3b8',
            }, { material: 'glass', seed: archIdx + 5, parapet: true });
            drawRooftopProps64(ctx, cx + ox + 2, cy + 2 - hh - 9, 10.5, archIdx, 'low');
          } else {
            const roofKind = archIdx % 3 === 0 ? 'gable_ne' : archIdx % 3 === 1 ? 'gable_nw' : 'hip';
            drawPitchedRoof64(
              ctx,
              cx + ox,
              cy + 2 - hh,
              hw,
              10 + (archIdx % 3),
              { hi: pal.roofHi, mid: pal.roofMid, sh: pal.roofSh },
              roofKind,
              archIdx,
              archIdx % 3 !== 2
            );
          }

          drawWindows64(ctx, cx + ox, cy + 2, hw, hh, wealthTier === 2 ? 2 : 1, 2 + (archIdx % 2), {
            litColor: '#ffe896',
            glassLeft: '#6dbbe6',
            glassRight: '#3c7ca6',
            seed: archIdx + 1,
          });
          drawFacadeMicroDetails64(ctx, cx + ox, cy + 2, hw, hh, archIdx, {
            hasWallAC: archIdx % 3 === 1,
            hasAwning: archIdx % 4 === 2,
            awningColor: pal.accent,
          });
        }
      } else if (level === 2) {
        // Level 2: 16 Distinct Mid-Rise Apartments, Historic Mixed-Use Walkups & Stepped Townhouses
        fillDiamond64(ctx, cx, cy, 30, 15, '#adb7c7');
        drawSidewalkPaving64(ctx, cx, cy, archIdx);

        const h = (wealthTier === 2 ? 38 : wealthTier === 0 ? 25 : 31) + (archIdx % 5) * 3.5;
        const hw = isCompound ? 24 : 20 + (archIdx % 4);
        const hasSetback = archIdx % 3 === 0;
        const mainH = hasSetback ? h * 0.72 : h;

        drawPrism64(ctx, cx, cy + 2, hw, mainH, pal, {
          rimColor: pal.trim,
          outlineColor: pal.trim,
          castShadow: true,
          parapet: true,
          material: pal.material,
          seed: archIdx,
        });

        drawWindows64(ctx, cx, cy + 2, hw, mainH, Math.max(2, Math.round(mainH / 9.5)), 3 + (archIdx % 2), {
          litColor: '#ffe796',
          glassLeft: wealthTier === 2 ? '#38bdf8' : '#435d7d',
          glassRight: wealthTier === 2 ? '#0284c7' : '#26364d',
          seed: archIdx + 5,
          curtainWall: wealthTier === 2 && pal.material === 'glass',
        });

        // Subtle architectural cornice trim lines
        for (let f = 1; f <= 2; f++) {
          const by = cy + 2 - mainH + (f * mainH) / 3;
          drawLine64(ctx, cx - hw, by, cx, by + hw * 0.5, 'rgba(255,255,255,0.34)', 1.0);
          drawLine64(ctx, cx, by + hw * 0.5, cx + hw, by, 'rgba(255,255,255,0.16)', 1.0);
        }

        // Stepped upper penthouse volume OR pitched mansard roof OR rooftop clutter
        if (hasSetback) {
          const upperH = h - mainH + 5;
          drawPrism64(ctx, cx + 1, cy + 2 - mainH, hw * 0.68, upperH, pal, {
            rimColor: pal.trim,
            outlineColor: pal.trim,
            parapet: true,
            material: pal.material,
            seed: archIdx + 9,
          });
          drawWindows64(ctx, cx + 1, cy + 2 - mainH, hw * 0.68, upperH, 1, 2, {
            litColor: '#ffe796',
            glassLeft: '#4e7399',
            glassRight: '#294059',
            seed: archIdx + 17,
          });
          drawRooftopProps64(ctx, cx + 1, cy + 2 - mainH - upperH, hw * 0.68, archIdx, 'mid');
        } else if (archIdx % 5 === 2) {
          drawPitchedRoof64(
            ctx,
            cx,
            cy + 2 - mainH,
            hw,
            9,
            { hi: pal.roofHi, mid: pal.roofMid, sh: pal.roofSh },
            'hip',
            archIdx,
            true
          );
        } else {
          drawRooftopProps64(ctx, cx, cy + 2 - mainH, hw, archIdx, 'mid');
        }

        // Facade balconies with plants, ground-floor shop awnings on historic mixed buildings, wall ACs
        drawFacadeMicroDetails64(ctx, cx, cy + 2, hw, mainH, archIdx, {
          hasBalconies: archIdx % 2 === 0,
          hasAwning: archIdx % 3 === 1,
          awningColor: pal.accent,
          hasWallAC: archIdx % 2 === 1,
          hasMarquee: archIdx % 5 === 0,
        });

        // Sidewalk planter or mini-tree on corner
        if (archIdx % 3 === 0) {
          drawSpeciesTree64(ctx, cx - 22, cy + 4, treeSp, 0.52, archIdx);
        } else {
          drawStreetProp64(ctx, cx - 22, cy + 5, archIdx % 2 === 0 ? 'planter' : 'bench');
        }
      } else {
        // Level 3: 16 Distinct High-Rise Towers (Stepped Penthouses, Sky-Gardens, Twin-Crown, Brise-Soleil)
        fillDiamond64(ctx, cx, cy, 30, 15, '#adb7c7');
        drawSidewalkPaving64(ctx, cx, cy, archIdx);

        const h = (wealthTier === 2 ? 70 : 58) + (archIdx % 5) * 5;
        const hw = isCompound ? 24 : 21 + (archIdx % 3);

        // Ground podium base for extra architectural depth
        drawPrism64(ctx, cx, cy + 2, Math.min(26, hw + 2), 11, {
          top: pal.top, left: pal.leftBot, right: pal.rightBot,
        }, { material: 'stone', seed: archIdx });

        drawPrism64(ctx, cx, cy + 2 - 7, hw, h - 7, pal, {
          rimColor: pal.trim,
          outlineColor: pal.trim,
          castShadow: true,
          parapet: true,
          material: pal.material,
          seed: archIdx,
        });

        drawWindows64(ctx, cx, cy + 2 - 7, hw, h - 7, 6 + (archIdx % 3), 4, {
          litColor: '#ffe999',
          glassLeft: wealthTier === 2 ? '#2563eb' : '#355070',
          glassRight: wealthTier === 2 ? '#1e3a8a' : '#1d2d42',
          seed: archIdx + 13,
          curtainWall: wealthTier === 2 || pal.material === 'glass',
        });

        drawFacadeMicroDetails64(ctx, cx, cy + 2 - 7, hw, h - 7, archIdx, {
          hasBalconies: archIdx % 2 === 0,
          hasWallAC: wealthTier < 2 && archIdx % 3 === 1,
          hasMarquee: true,
        });

        // Varied Rooftop Crown: Sky-garden terrace, twin penthouse, rooftop pool, or spire!
        const topY = cy + 2 - h;
        if (archIdx % 3 === 0) {
          // Lush sky-garden terrace with rooftop trees
          fillDiamond64(ctx, cx, topY, hw * 0.78, hw * 0.39, '#48a359');
          drawSpeciesTree64(ctx, cx - 7, topY + 1, 'lime', 0.45, archIdx);
          drawSpeciesTree64(ctx, cx + 6, topY - 1, 'ipe_pink', 0.42, archIdx + 2);
        } else if (archIdx % 3 === 1) {
          // Luxury rooftop turquoise lap pool
          fillDiamond64(ctx, cx - 2, topY + 1, 10, 5, '#38bdf8', '#e0f2fe', 0.9);
        }

        const crownW = 9 + (archIdx % 3) * 2;
        const crownH = 9 + (archIdx % 2) * 5;
        drawPrism64(
          ctx,
          cx + (archIdx % 2 === 0 ? 1 : -1),
          topY,
          crownW,
          crownH,
          { top: pal.topHi, left: pal.left, right: pal.right },
          { outlineColor: pal.trim, parapet: true, material: pal.material, seed: archIdx + 2 }
        );
        drawRooftopProps64(ctx, cx, topY - crownH, crownW, archIdx, 'high');

        // Aviation beacon on tallest towers
        drawGlow64(ctx, cx - 3, topY - crownH - 4, 4.5, 'rgba(255, 82, 82, 0.85)', 'rgba(255, 82, 82, 0)');
        ctx.fillStyle = '#ff595e';
        ctx.fillRect(cx - 4, topY - crownH - 5, 2, 2);
      }
    }
  );
}

function getCommercialSprite(
  level: number,
  variant: number,
  lotW: number = 1,
  lotH: number = 1,
  lotDx: number = 0,
  lotDy: number = 0,
  coordSeed: number = 0,
  rotation: CameraRotation = 0,
  hasHelipad: boolean = false,
  anchorXCoord: number = 0,
  anchorYCoord: number = 0
): CachedSprite {
  if (level >= 4 && lotW >= 2 && lotH >= 2) {
    const rotLot = getRotatedLotCoords(lotW, lotH, lotDx, lotDy, rotation);
    const archIdx = getSkyscraperStyleIdx(anchorXCoord, anchorYCoord, variant, 12);
    const pal = COMMERCIAL_PALETTES[archIdx];
    const roofHd = 126 + (archIdx % 4) * 10;
    if (!rotLot.isFrontCorner) {
      return getOrCreateSprite(
        `com64_lv4_base_${archIdx}_${rotLot.rDx}${rotLot.rDy}`,
        84,
        160,
        42,
        130,
        (ctx, cx, cy) => {
          fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, '#c8d4e3');
          fillDiamond64(ctx, cx, cy, 29, 14.5, '#dbe5f1');
          drawSidewalkPaving64(ctx, cx, cy, archIdx + rotLot.rDx + 4);
          drawStreetProp64(ctx, cx - 18, cy + 3, 'lamp');
        }
      );
    }
    return getOrCreateSprite(
      `com64_lv4_hero_${archIdx}_hp${hasHelipad ? 1 : 0}`,
      168,
      276,
      84,
      222,
      (ctx, cx, cy) => {
        fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, '#c8d4e3');
        fillDiamond64(ctx, cx, cy, 29, 14.5, '#dbe5f1');
        drawSidewalkPaving64(ctx, cx, cy, archIdx);
        const mx = cx;
        const my = cy - TILE_HH;

        // Corporate 2×2 glass atrium podium
        drawPrism64(
          ctx,
          mx,
          my + 3,
          48,
          22,
          { top: '#38bdf8', topHi: '#e0f2fe', left: '#bae6fd', leftBot: '#0284c7', right: '#0369a1', rightBot: '#0c4a6e' },
          { material: 'glass', seed: archIdx, castShadow: true, parapet: true }
        );
        drawGlow64(ctx, mx - 18, my + 8, 9, 'rgba(255, 224, 102, 0.75)', 'rgba(255, 224, 102, 0)');

        // Soaring 2×2 Corporate Supertall Curtain-Wall Tower
        const shaftH = roofHd - 26;
        drawPrism64(ctx, mx, my - 17, 38, shaftH, pal, {
          rimColor: '#ffffff',
          outlineColor: pal.trim,
          castShadow: true,
          parapet: true,
          material: 'glass',
          seed: archIdx,
        });
        drawWindows64(ctx, mx, my - 17, 38, shaftH, 12 + (archIdx % 3), 6, {
          litColor: '#ffe799',
          litCoolColor: '#c4f5ff',
          glassLeft: '#1e5b94',
          glassRight: '#0f2d4f',
          seed: archIdx + 31,
          curtainWall: true,
        });
        // Diagonal specular reflection sheen across glass facade
        ctx.save();
        ctx.strokeStyle = 'rgba(232, 249, 255, 0.36)';
        ctx.lineWidth = 5.5;
        ctx.beginPath();
        ctx.moveTo(mx - 33, my - 17 - shaftH + 14);
        ctx.lineTo(mx - 4, my - 17 - shaftH + 68);
        ctx.stroke();
        ctx.restore();

        // Upper architectural setback reaching `roofHd`
        drawPrism64(
          ctx,
          mx,
          my - 17 - shaftH,
          29,
          12,
          { top: pal.topHi, left: pal.left, right: pal.right },
          { rimColor: '#ffffff', parapet: true, material: 'glass', seed: archIdx + 7 }
        );

        const roofY = my - roofHd;
        if (hasHelipad) {
          drawPrism64(ctx, mx - 14, roofY - 4, 8, 10, {
            top: '#f8fafc',
            left: '#e2e8f0',
            right: '#64748b',
          });
          drawRooftopHelipad64(ctx, mx, roofY, 18);
        } else {
          drawPrism64(
            ctx,
            mx,
            roofY,
            15,
            15,
            { top: pal.topHi, left: pal.left, right: pal.right },
            { rimColor: '#ffffff', parapet: true, material: 'glass', seed: archIdx + 9 }
          );
          drawLine64(ctx, mx, roofY - 15, mx, roofY - 42, '#e8f6ff', 2.4);
          drawGlow64(ctx, mx, roofY - 43, 7, 'rgba(255, 82, 82, 0.94)', 'rgba(255, 82, 82, 0)');
          ctx.fillStyle = '#ff6b6b';
          ctx.beginPath();
          ctx.arc(mx, roofY - 43, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    );
  }

  const s = Math.abs((coordSeed || variant * 19) + lotDx * 5 + lotDy * 11);
  const archIdx = s % 12; // 12 distinct organic & modern commercial styles!
  const isCompound = lotW > 1 || lotH > 1;
  return getOrCreateSprite(
    `com64_v2_${level}_a${archIdx}_c${isCompound ? 1 : 0}_${lotDx}${lotDy}`,
    84,
    160,
    42,
    130,
    (ctx, cx, cy) => {
      const pal = COMMERCIAL_PALETTES[archIdx];
      const plaza = ctx.createLinearGradient(cx - 32, cy - 16, cx + 32, cy + 16);
      plaza.addColorStop(0, isCompound ? '#d2dce8' : '#bfc8d8');
      plaza.addColorStop(1, isCompound ? '#98a6b8' : '#909aad');
      fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, plaza);
      drawSidewalkPaving64(ctx, cx, cy, archIdx);

      if (level === 1) {
        // 12 Distinct Corner Cafés, Brick Boutiques, Bakeries, Bookshops & Galleries
        const hw = isCompound ? 23 : 18 + (archIdx % 4);
        const h = 16 + (archIdx % 4) * 3.5;

        drawPrism64(
          ctx,
          cx,
          cy + 2,
          hw,
          h,
          {
            top: isCompound ? '#7dd3fc' : pal.top,
            topHi: isCompound ? '#e0f2fe' : pal.topHi,
            left: pal.left,
            leftBot: pal.leftBot,
            right: pal.right,
            rightBot: pal.rightBot,
          },
          {
            outlineColor: pal.trim,
            castShadow: true,
            parapet: archIdx % 4 !== 3,
            material: pal.material,
            seed: archIdx,
          }
        );

        // Ground-floor glowing storefront display glass
        ctx.fillStyle = '#93e1ff';
        ctx.beginPath();
        ctx.moveTo(cx - hw * 0.85, cy - 3.5);
        ctx.lineTo(cx - hw * 0.16, cy + hw * 0.34 - 3.5);
        ctx.lineTo(cx - hw * 0.16, cy + hw * 0.34 + 2.2);
        ctx.lineTo(cx - hw * 0.85, cy + 2.2);
        ctx.closePath();
        ctx.fill();

        drawWindows64(ctx, cx, cy + 2, hw, Math.max(8, h - 6), 1, 3, {
          litColor: '#ffe796',
          glassLeft: '#4e96c7',
          glassRight: '#2c5f85',
          seed: archIdx + 3,
        });

        drawFacadeMicroDetails64(ctx, cx, cy + 2, hw, h, archIdx, {
          hasAwning: true,
          awningColor: pal.accent,
          hasSign: archIdx % 2 === 0,
          signColor: pal.accent,
          hasMarquee: archIdx % 3 === 0,
          hasWallAC: archIdx % 3 === 2,
        });

        if (archIdx % 4 === 3) {
          drawPitchedRoof64(
            ctx,
            cx,
            cy + 2 - h,
            hw,
            8,
            { hi: pal.roofHi, mid: pal.roofMid, sh: pal.roofSh },
            'gable_ne',
            archIdx,
            false
          );
        } else {
          drawRooftopProps64(ctx, cx, cy + 2 - h, hw, archIdx, 'low');
        }
        drawStreetProp64(ctx, cx - 22, cy + 4, archIdx % 2 === 0 ? 'planter' : 'bench');
      } else if (level === 2) {
        // 12 Distinct Mid-Rise Corporate Plazas, Historic Department Stores & Boutique Hotels
        const h = 34 + (archIdx % 5) * 4.5;
        const hw = isCompound ? 25 : 21 + (archIdx % 3);

        drawPrism64(ctx, cx, cy + 2, hw, h, pal, {
          rimColor: pal.trim,
          outlineColor: pal.trim,
          castShadow: true,
          parapet: true,
          material: pal.material,
          seed: archIdx,
        });

        drawWindows64(ctx, cx, cy + 2, hw, h, 4 + (archIdx % 2), 4, {
          litColor: '#ffe999',
          litCoolColor: '#b8f2ff',
          glassLeft: '#3a72a3',
          glassRight: '#1f4263',
          seed: archIdx + 7,
          curtainWall: pal.material === 'glass' || archIdx % 3 === 0,
        });

        drawFacadeMicroDetails64(ctx, cx, cy + 2, hw, h, archIdx, {
          hasAwning: archIdx % 2 === 0,
          awningColor: pal.accent,
          hasSign: true,
          signColor: pal.accent,
          hasMarquee: archIdx % 2 === 1,
          hasBalconies: archIdx % 4 === 1,
        });

        // Rooftop Illuminated Billboard OR Glass Skylight Atrium OR Rooftop HVAC/Antennas
        if (archIdx % 3 === 0) {
          drawLine64(ctx, cx - 10, cy - h, cx - 10, cy - h - 14, '#525c6e', 1.6);
          drawLine64(ctx, cx + 8, cy - h, cx + 8, cy - h - 14, '#525c6e', 1.6);
          ctx.fillStyle = '#f4f7fc';
          ctx.fillRect(cx - 12, cy - h - 16, 22, 10);
          ctx.fillStyle = pal.accent;
          ctx.fillRect(cx - 10.5, cy - h - 14.5, 19, 7);
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.fillRect(cx - 8, cy - h - 12, 14, 2);
        } else {
          drawRooftopProps64(ctx, cx, cy + 2 - h, hw, archIdx, 'commercial');
        }
      } else {
        // Level 3: 12 Distinct Corporate Skyscrapers (Stepped Art Deco, Reflective Glass, Bronze & Stone)
        const baseH = 72 + (archIdx % 5) * 6;
        const hw = isCompound ? 25 : 22 + (archIdx % 3);

        drawPrism64(ctx, cx, cy + 2, hw, baseH, pal, {
          rimColor: pal.trim,
          outlineColor: pal.trim,
          castShadow: true,
          parapet: true,
          material: pal.material,
          seed: archIdx,
        });

        drawWindows64(ctx, cx, cy + 2, hw, baseH, 8 + (archIdx % 2), 4, {
          litColor: '#ffe799',
          litCoolColor: '#c4f5ff',
          glassLeft: pal.material === 'glass' ? '#1e5b94' : '#355070',
          glassRight: pal.material === 'glass' ? '#103257' : '#1d2d42',
          seed: archIdx + 21,
          curtainWall: true,
        });

        // Diagonal specular sky glint across glass towers
        ctx.save();
        ctx.strokeStyle = 'rgba(232, 249, 255, 0.34)';
        ctx.lineWidth = 4.2;
        ctx.beginPath();
        ctx.moveTo(cx - hw + 3, cy - baseH + 12);
        ctx.lineTo(cx - 3, cy - baseH + 52);
        ctx.stroke();
        ctx.restore();

        // Stepped Architectural Crown + Spire / Helipad
        const crownW = 11 + (archIdx % 4) * 2;
        const crownH = 12 + (archIdx % 3) * 4;
        drawPrism64(
          ctx,
          cx,
          cy + 2 - baseH,
          crownW,
          crownH,
          { top: pal.topHi, left: pal.left, right: pal.right },
          { rimColor: '#ffffff', parapet: true, material: pal.material, seed: archIdx + 3 }
        );
        drawRooftopProps64(ctx, cx, cy + 2 - baseH - crownH, crownW, archIdx, 'high');

        // Glowing golden/cyan entrance lobby marquee
        drawGlow64(ctx, cx - 10, cy + 2, 7.5, 'rgba(255, 212, 92, 0.72)', 'rgba(255, 212, 92, 0)');
        ctx.fillStyle = pal.accent;
        ctx.fillRect(cx - 13, cy - 2, 8.5, 4.5);

        // Tall broadcast spire with glowing red aviation warning light
        drawLine64(ctx, cx, cy - baseH - crownH, cx, cy - baseH - crownH - 22, '#e8f6ff', 2.0);
        drawGlow64(ctx, cx, cy - baseH - crownH - 23, 6.5, 'rgba(255, 82, 82, 0.92)', 'rgba(255, 82, 82, 0)');
        ctx.fillStyle = '#ff6b6b';
        ctx.beginPath();
        ctx.arc(cx, cy - baseH - crownH - 23, 2.0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  );
}

function getIndustrialSprite(
  level: number = 1,
  variant: number = 0,
  lotW: number = 1,
  lotH: number = 1,
  lotDx: number = 0,
  lotDy: number = 0,
  coordSeed: number = 0
): CachedSprite {
  const lv = Math.max(1, Math.min(3, level || 1));
  const v = Math.abs((coordSeed || variant * 13) + lotDx * 3 + lotDy * 5) % 8;
  const isCompound = lotW > 1 || lotH > 1;
  return getOrCreateSprite(
    `ind64_v3_l${lv}_v${v}_c${isCompound ? 1 : 0}_${lotDx}${lotDy}`,
    82,
    114,
    41,
    82,
    (ctx, cx, cy) => {
      const yard = ctx.createLinearGradient(cx - 32, cy - 16, cx + 32, cy + 16);
      yard.addColorStop(0, '#7c848f');
      yard.addColorStop(1, '#58606b');
      fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, yard);
      // Weathered concrete yard grain & hazard loading stripe
      stampPixelDither(ctx, cx - 26, cy - 12, 52, 24, 'rgba(18, 22, 30, 0.25)', 4, v * 17, 0.28);
      drawLine64(ctx, cx - 18, cy + 9, cx + 2, cy + 14, '#e6b83c', 1.4);

      const hallWalls: Array<{
        mat: FacadeMaterial;
        top: string;
        topHi: string;
        left: string;
        leftBot: string;
        right: string;
        rightBot: string;
      }> = [
        { mat: 'brick', top: '#8c96a3', topHi: '#abb5c4', left: '#ad5e49', leftBot: '#854332', right: '#703b2e', rightBot: '#4f281f' },
        { mat: 'concrete', top: '#7f8c99', topHi: '#a3b1bf', left: '#6e8094', leftBot: '#505f70', right: '#485666', rightBot: '#313c47' },
        { mat: 'stone', top: '#948e82', topHi: '#b5ae9e', left: '#ba8c4a', leftBot: '#8f6932', right: '#805e2e', rightBot: '#5c421e' },
        { mat: 'concrete', top: '#829189', topHi: '#a5b5ad', left: '#567868', leftBot: '#3d594c', right: '#395246', rightBot: '#25382f' },
        { mat: 'brick', top: '#757d87', topHi: '#96a0ad', left: '#9e5347', leftBot: '#7a3c32', right: '#632e26', rightBot: '#451e19' },
        { mat: 'concrete', top: '#8a857e', topHi: '#aba59c', left: '#b8b1a6', leftBot: '#948d83', right: '#736d65', rightBot: '#524d47' },
        { mat: 'wood', top: '#7d8a96', topHi: '#a1b0bd', left: '#8c6b54', leftBot: '#694e3b', right: '#594232', rightBot: '#3d2c21' },
        { mat: 'concrete', top: '#687687', topHi: '#8a9aad', left: '#586e85', leftBot: '#3e4f61', right: '#384859', rightBot: '#242f3b' },
      ];
      const hwSpec = hallWalls[v];

      const hw = isCompound ? 23 : (lv === 1 ? 15.5 : lv === 2 ? 18.5 : 21) + (v % 3) * 1.2;
      const hh = (lv === 1 ? 15 : lv === 2 ? 21 : 27) + (v % 4) * 2.5;
      drawPrism64(ctx, cx - 3, cy + 4, hw, hh, hwSpec, {
        outlineColor: lv >= 3 ? '#cbe2ff' : '#b8c2cf',
        castShadow: true,
        material: hwSpec.mat,
        seed: v,
        parapet: lv >= 2 || v % 2 === 1,
      });

      // Sawtooth glass skylights OR solar panels on factory roof
      const skylightCount = lv >= 3 ? 3 : lv === 2 ? 2 : 1;
      for (let s = 0; s < skylightCount; s++) {
        const sx = cx - 15 + s * 7.5;
        const sy = cy + 2 - hh + s * 3.8;
        ctx.fillStyle = lv >= 3 || v >= 4 ? '#1e3a8a' : '#c4cedb';
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + 9, sy - 4.5);
        ctx.lineTo(sx + 9, sy - 0.5);
        ctx.lineTo(sx, sy + 4);
        ctx.closePath();
        ctx.fill();
        drawLine64(ctx, sx, sy, sx + 9, sy - 4.5, '#8bd4ff', 1.2);
      }

      // Warm industrial clerestory windows + dark corrugated loading bay door
      ctx.fillStyle = lv >= 3 ? '#7dd3fc' : '#ffbe30';
      ctx.fillRect(cx - 18, cy - 9, 4.5, 3.8);
      if (lv >= 2) {
        ctx.fillRect(cx - 10.5, cy - 5.5, 4.5, 3.8);
      }
      ctx.fillStyle = '#232833';
      ctx.fillRect(cx + 2, cy - 7, 8, 10);
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 0.7;
      for (let gy = cy - 5; gy <= cy + 1; gy += 2) {
        drawLine64(ctx, cx + 2.5, gy, cx + 9.5, gy, '#475569', 0.7);
      }

      // Wooden freight pallets / shipping crates in yard
      ctx.fillStyle = '#b5804a';
      ctx.fillRect(cx - 18, cy + 4, 4.5, 3.2);
      if (lv >= 2) {
        ctx.fillStyle = '#2a78b8';
        ctx.fillRect(cx - 13, cy + 6, 4.5, 3.0);
      }

      // Cylindrical storage tanks / silos with metallic highlight (Lv2+ gets twin silos / HVAC unit)
      if (lv >= 2) {
        drawPrism64(ctx, cx + 16, cy - 2, 6, 17 + (v % 3) * 3 + (lv === 3 ? 5 : 0), {
          top: '#e2e9f2', left: '#b8c3d4', right: '#737d8f',
        }, { material: 'concrete', seed: v + 1 });
      }
      if (lv >= 3) {
        drawPrism64(ctx, cx + 22, cy + 2, 5, 16 + (v % 2) * 3, {
          top: '#dbeafe', left: '#93c5fd', right: '#475569',
        }, { material: 'concrete', seed: v + 7 });
      }

      // Tall brick or striped smokestack on main anchor (scales height with level)
      if (!isCompound || (lotDx === 0 && lotDy === 0)) {
        const stackH = lv === 1 ? 26 : lv === 2 ? 35 : 42;
        drawPrism64(ctx, cx + 12, cy - 12, 4, stackH, {
          top: '#2e343d', left: '#949eae', right: '#545d6b',
        }, { material: 'brick', seed: v + 3 });
        const stripeY = cy - 12 - stackH + 4;
        ctx.fillStyle = '#d94848';
        ctx.fillRect(cx + 8, stripeY, 8, 4);
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(cx + 8, stripeY + 4, 8, 3);
      }
    }
  );
}

function getParkSprite(
  variant: number,
  animFrame: number,
  coordSeed: number = 0,
  season: SeasonId = 'summer'
): CachedSprite {
  const v = Math.abs(coordSeed || variant) % 8;
  const f = animFrame % 2;
  return getOrCreateSprite(`park64_v3_${season}_${v}_${f}`, 76, 68, 38, 46, (ctx, cx, cy) => {
    fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, season === 'winter' ? '#cbd5e1' : '#b5bfd0');
    drawSidewalkPaving64(ctx, cx, cy, v);

    const lawn = ctx.createLinearGradient(cx - 28, cy - 14, cx + 28, cy + 14);
    if (season === 'winter') {
      lawn.addColorStop(0, '#eef6ff');
      lawn.addColorStop(1, '#c8daed');
    } else if (season === 'autumn') {
      lawn.addColorStop(0, '#968b44');
      lawn.addColorStop(1, '#6f6731');
    } else if (season === 'spring') {
      lawn.addColorStop(0, '#72c95a');
      lawn.addColorStop(1, '#4ea33e');
    } else {
      lawn.addColorStop(0, '#66bd54');
      lawn.addColorStop(1, '#438f38');
    }
    fillDiamond64(ctx, cx, cy, 29, 14.5, lawn);
    stampPixelDither(
      ctx,
      cx - 24,
      cy - 11,
      48,
      22,
      season === 'winter'
        ? 'rgba(255, 255, 255, 0.42)'
        : season === 'autumn'
          ? 'rgba(234, 142, 46, 0.28)'
          : 'rgba(155, 232, 110, 0.25)',
      4,
      v * 11,
      0.26
    );

    drawLine64(ctx, cx - 22, cy - 11, cx + 22, cy + 11, season === 'winter' ? '#e2e8f0' : '#dfd6c3', 3.4);
    drawLine64(ctx, cx - 22, cy + 11, cx + 22, cy - 11, season === 'winter' ? '#e2e8f0' : '#dfd6c3', 3.4);

    if (v % 3 === 0) {
      fillDiamond64(ctx, cx + 6, cy + 3, 10, 5, '#d9e2ed');
      const waterGrad = ctx.createRadialGradient(cx + 6, cy + 2, 1, cx + 6, cy + 3, 9);
      waterGrad.addColorStop(0, season === 'winter' ? '#bae6fd' : '#7de0ff');
      waterGrad.addColorStop(1, season === 'winter' ? '#60a5fa' : '#207ab8');
      fillDiamond64(ctx, cx + 6, cy + 3, 8, 4, waterGrad);
      drawGlow64(ctx, cx + 6 + f, cy + 1, 4, 'rgba(220, 250, 255, 0.9)', 'rgba(125, 224, 255, 0)');
    } else if (v % 3 === 1) {
      fillDiamond64(ctx, cx + 4, cy + 2, 8.5, 4.2, '#e6dcc8');
      drawLine64(ctx, cx, cy + 1, cx, cy - 8, '#f8fafc', 1.2);
      drawLine64(ctx, cx + 8, cy + 1, cx + 8, cy - 8, '#f8fafc', 1.2);
      drawPitchedRoof64(
        ctx,
        cx + 4,
        cy - 7,
        9,
        7,
        season === 'winter'
          ? { hi: '#f1f5f9', mid: '#cbd5e1', sh: '#94a3b8' }
          : { hi: '#cf5e40', mid: '#a3442a', sh: '#702a18' },
        'hip',
        v,
        false
      );
    } else {
      if (season !== 'winter') {
        drawBushOrFlowerbed64(ctx, cx + 8, cy + 4, v, true);
        drawBushOrFlowerbed64(ctx, cx + 2, cy + 6, v + 2, true);
      }
      drawPrism64(ctx, cx + 6, cy + 1, 3, 12, { top: '#f8fafc', left: '#e2e8f0', right: '#94a3b8' });
    }

    drawStreetProp64(ctx, cx - 11, cy + 5, 'bench');
    drawStreetProp64(ctx, cx - 4, cy + 9, 'trash');
    drawStreetProp64(ctx, cx - 18, cy + 2, 'lamp');
    drawGlow64(ctx, cx - 16, cy - 8, 5, 'rgba(255, 232, 138, 0.8)');

    const parkSpecies: TreeSpecies[] = ['ipe_pink', 'ipe_gold', 'oak', 'lime', 'cypress', 'autumn', 'palm', 'oak'];
    drawSpeciesTree64(ctx, cx - 10, cy - 5, parkSpecies[v], 0.92, v, season);
    drawSpeciesTree64(ctx, cx + 10, cy - 6, parkSpecies[(v + 3) % 8], 0.92, v + 2, season);
    drawSpeciesTree64(ctx, cx - 2, cy + 8, parkSpecies[(v + 5) % 8], 0.68, v + 4, season);
  });
}

function getAbandonedSprite(variant: number, coordSeed: number = 0): CachedSprite {
  const v = Math.abs(coordSeed || variant) % 4;
  return getOrCreateSprite(`abn64_v2_${v}`, 76, 86, 38, 58, (ctx, cx, cy) => {
    fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, '#535c54');
    fillDiamond64(ctx, cx, cy, 28, 14, '#5e6561');
    stampPixelDither(ctx, cx - 22, cy - 10, 44, 20, 'rgba(20, 26, 22, 0.30)', 3, v * 13, 0.34);

    const h = 24 + (v % 3) * 8;
    drawPrism64(
      ctx,
      cx,
      cy + 2,
      21,
      h,
      {
        top: '#474c57',
        left: v % 2 === 0 ? '#6e6460' : '#636975',
        leftBot: '#4c515c',
        right: '#3f444f',
        rightBot: '#2e323b',
      },
      { castShadow: true, material: v % 2 === 0 ? 'brick' : 'concrete', seed: v, parapet: true }
    );
    drawWindows64(ctx, cx, cy + 2, 21, h, 3, 3, {
      litColor: '#7d5f44', // boarded timber
      glassLeft: '#1d2129',
      glassRight: '#14171f',
      seed: v + 7,
    });
    // Overgrown weeds & creeping vines
    drawBushOrFlowerbed64(ctx, cx - 17, cy + 4, v, false);
    drawBushOrFlowerbed64(ctx, cx + 14, cy + 2, v + 1, false);
  });
}

function drawPortBerthShape64(
  ctx: CanvasRenderingContext2D,
  mx: number,
  my: number,
  lv: number,
  v: number,
  rotW: number,
  rotH: number,
  berthDir: 'S' | 'E' | 'N' | 'W'
): void {
  const isSW = berthDir === 'S' || berthDir === 'N';
  const sign = berthDir === 'S' || berthDir === 'E' ? 1 : -1;
  const edgeTiles = isSW ? rotH : rotW;
  const edgeDist = edgeTiles * 0.5;
  const pierOut = edgeDist + (lv >= 3 ? 0.55 : 0.4);
  const pierSpan = lv >= 3 ? 40 : 24;
  const pierX =
    berthDir === 'S'
      ? mx - pierOut * TILE_HW
      : berthDir === 'E'
        ? mx + pierOut * TILE_HW
        : berthDir === 'N'
          ? mx + pierOut * TILE_HW
          : mx - pierOut * TILE_HW;
  const pierY =
    berthDir === 'S' || berthDir === 'E'
      ? my + pierOut * TILE_HH
      : my - pierOut * TILE_HH;

  const dx = isSW ? pierSpan : -pierSpan;
  const dy = pierSpan * 0.5;
  ctx.fillStyle = '#5e442e';
  ctx.beginPath();
  ctx.moveTo(pierX - dx, pierY - dy);
  ctx.lineTo(pierX + dx, pierY + dy);
  ctx.lineTo(pierX + dx, pierY + dy + 5);
  ctx.lineTo(pierX - dx, pierY - dy + 5);
  ctx.closePath();
  ctx.fill();
  drawLine64(ctx, pierX - dx, pierY - dy, pierX + dx, pierY + dy, '#d4a373', 5.8);

  drawLine64(ctx, mx - sign * 8, my - 4, pierX - 6, pierY - 5, '#e2e8f0', 2.6);
  drawLine64(ctx, mx + sign * 4, my, pierX + 8, pierY + 2, '#e2e8f0', 2.6);

  const shipX =
    pierX + (berthDir === 'S' ? -18 : berthDir === 'E' ? 18 : berthDir === 'N' ? 13 : -13);
  const shipY = pierY + (berthDir === 'S' || berthDir === 'E' ? 10 : -3);
  // Only Level 3 (2×4 International Cruise Terminal) berths giant Cruise Ships!
  drawShip64(
    ctx,
    shipX,
    shipY,
    isSW ? 24 : -24,
    12,
    lv >= 3 ? '#0f294a' : '#8f2929',
    lv >= 3 ? '#e11d48' : '#38bdf8',
    lv >= 3 ? 0.92 : 1.05,
    0,
    v,
    lv >= 3 ? 'cruise' : 'cargo',
    false
  );
}

function getPortBerthSprite(
  level: number,
  variant: number,
  rotW: number,
  rotH: number,
  berthDir: 'S' | 'E'
): CachedSprite {
  const lv = Math.max(1, Math.min(3, level || 1));
  const v = variant % 2;
  return getOrCreateSprite(
    `port64_berth_lv${lv}_${v}_w${rotW}h${rotH}_b${berthDir}`,
    340,
    290,
    170,
    196,
    (ctx, cx, cy) => {
      const dRx = -(rotW - 1) / 2;
      const dRy = -(rotH - 1) / 2;
      const mx = cx + (dRx - dRy) * TILE_HW;
      const my = cy + (dRx + dRy) * TILE_HH;
      drawPortBerthShape64(ctx, mx, my, lv, v, rotW, rotH, berthDir);
    }
  );
}

/**
 * 64-Bit HD Isometric Riverfront & Cruise Seaport (Supports 2×2 / 2×4 Cruise Terminals + 1×1 Preview):
 * Concrete quay, extended river cruise pier, moored multi-deck white Cruise Ship,
 * glass maritime cruise terminal with boarding bridges, ISO containers, lighthouse & gantry cranes.
 */
function getPortSprite(
  level: number,
  variant: number,
  lotW: number = 1,
  lotH: number = 1,
  lotDx: number = 0,
  lotDy: number = 0,
  rotation: CameraRotation = 0,
  waterMask: number = 2
): CachedSprite {
  const lv = Math.max(1, Math.min(3, level || 1));
  const v = variant % 2;

  if (lotW > 1 || lotH > 1) {
    const rotLot = getRotatedLotCoords(lotW, lotH, lotDx, lotDy, rotation);
    if (!rotLot.isFrontCorner) {
      return getOrCreateSprite(
        `port64_base_lv${lv}_${v}_w${rotLot.rotW}h${rotLot.rotH}_x${rotLot.rDx}y${rotLot.rDy}`,
        98,
        118,
        49,
        88,
        (ctx, cx, cy) => {
          fillDiamond64(ctx, cx, cy + 3, TILE_HW + 0.5, TILE_HH + 0.3, '#174d78');
          fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, '#6e553e');
          const quayGrad = ctx.createLinearGradient(cx - 30, cy - 15, cx + 30, cy + 15);
          quayGrad.addColorStop(0, '#c2ccdb');
          quayGrad.addColorStop(1, '#8f9cb0');
          fillDiamond64(ctx, cx, cy, 30.5, 15.2, quayGrad);
          drawLine64(ctx, cx - 18, cy, cx + 18, cy, '#94a3b8', 1.1);
          if ((rotLot.rDx + rotLot.rDy) % 2 === 0) {
            drawPrism64(ctx, cx - 10, cy - 1, 7, 6.5, {
              top: '#f57667',
              left: '#d94848',
              right: '#8f2929',
            });
            drawPrism64(ctx, cx + 8, cy - 3, 6.5, 6, {
              top: '#56c2ff',
              left: '#0284c7',
              right: '#0369a1',
            });
          } else {
            drawPrism64(ctx, cx - 6, cy + 1, 6.5, 6, {
              top: '#ffe478',
              left: '#d9a426',
              right: '#946d14',
            });
          }
        }
      );
    }

    const berthDir: 'S' | 'E' | 'N' | 'W' =
      (waterMask & 4) !== 0
        ? 'S'
        : (waterMask & 2) !== 0
          ? 'E'
          : (waterMask & 1) !== 0
            ? 'N'
            : (waterMask & 8) !== 0
              ? 'W'
              : 'S';

    return getOrCreateSprite(
      `port64_hero_lv${lv}_${v}_w${rotLot.rotW}h${rotLot.rotH}_b${berthDir}`,
      328,
      274,
      164,
      192,
      (ctx, cx, cy) => {
        fillDiamond64(ctx, cx, cy + 3, TILE_HW + 0.5, TILE_HH + 0.3, '#174d78');
        fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, '#6e553e');
        const quayGrad = ctx.createLinearGradient(cx - 30, cy - 15, cx + 30, cy + 15);
        quayGrad.addColorStop(0, '#c2ccdb');
        quayGrad.addColorStop(1, '#8f9cb0');
        fillDiamond64(ctx, cx, cy, 30.5, 15.2, quayGrad);

        const dRx = -(rotLot.rotW - 1) / 2;
        const dRy = -(rotLot.rotH - 1) / 2;
        const mx = cx + (dRx - dRy) * TILE_HW;
        const my = cy + (dRx + dRy) * TILE_HH;

        // Back-side berths ('N' | 'W') sit behind the port buildings; front-side berths ('S' | 'E') are rendered
        // via getPortBerthSprite after Pass 2A draws the river water tiles in front of the quay.
        if (berthDir === 'N' || berthDir === 'W') {
          drawPortBerthShape64(ctx, mx, my, lv, v, rotLot.rotW, rotLot.rotH, berthDir);
        }

        const termH = lv === 3 ? 30 : lv === 2 ? 22 : 18;
        drawPrism64(
          ctx,
          mx - 6,
          my - 4,
          lv >= 3 ? 28 : 24,
          termH,
          {
            top: '#38bdf8',
            topHi: '#e0f2fe',
            left: '#e2f1ff',
            leftBot: '#7dd3fc',
            right: '#0284c7',
            rightBot: '#0369a1',
          },
          { rimColor: '#ffffff', outlineColor: '#bae6fd', castShadow: true, material: 'glass', seed: v + 9 }
        );
        drawWindows64(ctx, mx - 6, my - 4, lv >= 3 ? 28 : 24, termH, 3 + lv, 3, {
          litColor: '#fff3b0',
          glassLeft: '#0369a1',
          glassRight: '#075985',
          seed: v + 7,
          curtainWall: true,
        });
        fillDiamond64(ctx, mx - 6, my - 4 - termH, lv >= 3 ? 23 : 20, lv >= 3 ? 11.5 : 10, '#f8fafc', '#94a3b8', 1.2);
        drawCrossEmblem64(ctx, mx - 6, my - 4 - termH, 3.2, '#0284c7', '#e0f2fe');

        drawPrism64(ctx, mx + 18, my - 10, 8, 28 + lv * 4, {
          top: '#f8fafc',
          left: '#e2e8f0',
          right: '#94a3b8',
        });
        ctx.fillStyle = '#e8eef5';
        ctx.fillRect(mx - 34, my - 26, 6, 24);
        ctx.fillStyle = '#e04848';
        ctx.fillRect(mx - 34, my - 21, 6, 4);
        ctx.fillRect(mx - 34, my - 12, 6, 4);
        drawGlow64(ctx, mx - 31, my - 28, 10, 'rgba(255, 240, 155, 0.92)', 'rgba(255, 240, 155, 0)');
        ctx.fillStyle = '#fff5bd';
        ctx.fillRect(mx - 34, my - 29, 6, 3.5);

        const craneOffsets = lv >= 2 ? [-10, 8, 22] : [-6, 12];
        for (let cIdx = 0; cIdx < craneOffsets.length; cIdx++) {
          const ox = mx + craneOffsets[cIdx];
          const oy = my - 4 + cIdx * 3;
          const h = lv === 3 ? 44 : 36;
          const colMain = cIdx % 2 === 0 ? '#f5b73b' : '#ff9f43';
          drawLine64(ctx, ox + 6, oy, ox + 6, oy - h, colMain, 3.0);
          drawLine64(ctx, ox + 10, oy + 2, ox + 10, oy + 2 - h, '#a86910', 2.2);
          drawLine64(ctx, ox - 12, oy - 2 - h, ox + 16, oy - 2 - h, '#ffe066', 3.0);
          drawLine64(ctx, ox + 8, oy - 9 - h, ox - 10, oy - 2 - h, '#d49419', 1.3);
          drawLine64(ctx, ox - 6, oy - 1 - h, ox - 6, oy + 10 - h, '#1e293b', 1.2);
          ctx.fillStyle = cIdx === 0 ? '#ff785a' : '#38bdf8';
          ctx.fillRect(ox - 10, oy + 10 - h, 8, 4.5);
        }
      }
    );
  }

  return getOrCreateSprite(`port64_lv${lv}_${v}`, 108, 126, 54, 92, (ctx, cx, cy) => {
    fillDiamond64(ctx, cx, cy + 3, TILE_HW + 0.5, TILE_HH + 0.3, '#174d78');
    fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, '#6e553e');
    const quayGrad = ctx.createLinearGradient(cx - 30, cy - 15, cx + 30, cy + 15);
    quayGrad.addColorStop(0, '#c2ccdb');
    quayGrad.addColorStop(1, '#8f9cb0');
    fillDiamond64(ctx, cx, cy, 30, 15, quayGrad);

    drawLine64(ctx, cx - 2, cy + 13, cx + 26, cy - 1, '#f5b73b', 2.0);

    ctx.fillStyle = '#5e442e';
    ctx.fillRect(cx + 6, cy + 8, 22, 6);
    ctx.fillStyle = '#c4986a';
    ctx.fillRect(cx + 8, cy + 6, 18, 4);
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(cx + 9, cy + 6.5, 2, 2);
    ctx.fillRect(cx + 22, cy + 6.5, 2, 2);

    if (lv === 3) {
      drawShip64(ctx, cx + 16, cy + 11, 20, -10, '#0f294a', '#e11d48', 0.55, 0, v, 'cruise', false);
    } else if (lv >= 2) {
      ctx.fillStyle = 'rgba(8, 24, 48, 0.52)';
      ctx.beginPath();
      ctx.ellipse(cx + 16, cy + 15, 16, 4.5, -0.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#9e2a2b';
      ctx.beginPath();
      ctx.moveTo(cx + 2, cy + 11);
      ctx.lineTo(cx + 8, cy + 7);
      ctx.lineTo(cx + 30, cy + 7);
      ctx.lineTo(cx + 30, cy + 13);
      ctx.lineTo(cx + 5, cy + 14);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#1d2d44';
      ctx.fillRect(cx + 5, cy + 12.5, 25, 2);

      drawPrism64(ctx, cx + 26, cy + 8, 4.5, 9, {
        top: '#ffffff',
        left: '#f1f5f9',
        right: '#94a3b8',
      });
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(cx + 23, cy + 1, 5, 2);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(cx + 8, cy + 2.5, 7, 4.5);
      ctx.fillStyle = '#ffe066';
      ctx.fillRect(cx + 15.5, cy + 2.5, 7, 4.5);
    }

    if (lv < 3) {
      drawPrism64(
        ctx,
        cx - 12,
        cy - 2,
        14,
        18 + lv * 4,
        {
          top: '#2b6cb0',
          topHi: '#4299e1',
          left: '#e2eaf2',
          leftBot: '#c4d1e0',
          right: '#849bb3',
          rightBot: '#62788f',
        },
        { outlineColor: '#bae6fd', castShadow: true }
      );
      drawWindows64(ctx, cx - 12, cy - 2, 14, 18 + lv * 4, 2, 2, {
        litColor: '#ffe066',
        glassLeft: '#243b53',
        glassRight: '#102a43',
        seed: v + 3,
      });
    } else {
      drawPrism64(
        ctx,
        cx - 14,
        cy - 2,
        14,
        40,
        {
          top: '#38bdf8',
          topHi: '#bae6fd',
          left: '#cdeeff',
          leftBot: '#7dd3fc',
          right: '#0284c7',
          rightBot: '#0369a1',
        },
        { rimColor: '#ffffff', outlineColor: '#e0f2fe', castShadow: true }
      );
      drawWindows64(ctx, cx - 14, cy - 2, 14, 40, 5, 2, {
        litColor: '#fff3b0',
        glassLeft: '#0369a1',
        glassRight: '#075985',
        seed: v + 5,
        curtainWall: true,
      });
      drawPrism64(ctx, cx - 2, cy - 10, 6, 20, {
        top: '#f8fafc',
        left: '#e2e8f0',
        right: '#94a3b8',
      });
    }

    drawPrism64(ctx, cx + 6, cy, 7.5, 7.5, { top: '#f57667', left: '#d94848', right: '#8f2929' });
    drawPrism64(ctx, cx + 4, cy - 7.5, 6, 6, { top: '#56c2ff', left: '#0284c7', right: '#0369a1' });
    drawPrism64(ctx, cx - 2, cy + 6, 6.5, 6, { top: '#ffe478', left: '#d9a426', right: '#946d14' });
    if (lv >= 2) {
      drawPrism64(ctx, cx + 7, cy - 8, 7.5, 7.5, { top: '#74e39a', left: '#2f9e44', right: '#1b5e20' });
    }

    ctx.fillStyle = '#e8eef5';
    ctx.fillRect(cx - 28, cy - 22, 6, 22);
    ctx.fillStyle = '#e04848';
    ctx.fillRect(cx - 28, cy - 18, 6, 4);
    ctx.fillRect(cx - 28, cy - 10, 6, 4);
    drawGlow64(ctx, cx - 25, cy - 25, 9, 'rgba(255, 240, 155, 0.9)', 'rgba(255, 240, 155, 0)');
    ctx.fillStyle = '#fff5bd';
    ctx.fillRect(cx - 28, cy - 26, 6, 4);
    ctx.fillStyle = '#d94848';
    ctx.beginPath();
    ctx.moveTo(cx - 30, cy - 26);
    ctx.lineTo(cx - 25, cy - 30);
    ctx.lineTo(cx - 20, cy - 26);
    ctx.closePath();
    ctx.fill();

    const craneOffsets = lv >= 2 ? [0, -12] : [0];
    for (let cIdx = 0; cIdx < craneOffsets.length; cIdx++) {
      const ox = craneOffsets[cIdx];
      const oy = cIdx * -6;
      const h = lv === 3 ? 44 : 36;
      const colMain = cIdx === 0 ? '#f5b73b' : '#ff9f43';
      const colDark = '#a86910';

      drawLine64(ctx, cx + 16 + ox, cy - 6 + oy, cx + 16 + ox, cy - 6 - h + oy, colMain, 3.2);
      drawLine64(ctx, cx + 20 + ox, cy - 4 + oy, cx + 20 + ox, cy - 4 - h + oy, colDark, 2.4);
      drawLine64(ctx, cx - 4 + ox, cy - 8 - h + oy, cx + 26 + ox, cy - 8 - h + oy, '#ffe066', 3.2);
      drawLine64(ctx, cx + 18 + ox, cy - 15 - h + oy, cx - 2 + ox, cy - 8 - h + oy, '#d49419', 1.4);
      drawLine64(ctx, cx + 2 + ox, cy - 7 - h + oy, cx + 2 + ox, cy + 5 - h + oy, '#1e293b', 1.2);
      ctx.fillStyle = cIdx === 0 ? '#ff785a' : '#38bdf8';
      ctx.fillRect(cx - 2 + ox, cy + 5 - h + oy, 8, 4.5);
    }
  });
}

/** 64-Bit HD Isometric Sports Stadium Arena with tension-membrane roof, pitch & 4 floodlights */
function drawSteppedBleacherStadium64(
  ctx: CanvasRenderingContext2D,
  mx: number,
  my: number,
  uSpan: number,
  vSpan: number,
  wallHeight: number,
  variant: number,
  withCanopy: boolean
): void {
  const v = ((variant % 3) + 3) % 3;
  const pt = (u: number, vCoord: number, z: number = 0): [number, number] => [
    mx + (u * uSpan - vCoord * vSpan) * TILE_HW,
    my + (u * uSpan + vCoord * vSpan) * TILE_HH - z,
  ];
  const poly = (pts: Array<[number, number]>, fill: string, stroke?: string) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }
  };

  const accentCol = v === 0 ? '#e11d48' : v === 1 ? '#2563eb' : '#16a34a';
  const crowdCols =
    v === 0
      ? ['#ef4444', '#ffe066', '#38bdf8', '#ffffff', '#22c55e']
      : v === 1
        ? ['#3b82f6', '#ffffff', '#fbbf24', '#60a5fa']
        : ['#22c55e', '#facc15', '#ef4444', '#ffffff'];

  poly([pt(-1, 1, 0), pt(1, 1, 0), pt(1, 1, wallHeight), pt(-1, 1, wallHeight)], '#cbd5e1', '#94a3b8');
  poly([pt(1, -1, 0), pt(1, 1, 0), pt(1, 1, wallHeight), pt(1, -1, wallHeight)], '#8d99ae', '#64748b');

  for (let b = -0.75; b <= 0.76; b += 0.375) {
    poly(
      [
        pt(b - 0.04, 1.01, 0),
        pt(b + 0.04, 1.01, 0),
        pt(b + 0.04, 1.01, wallHeight * 0.96),
        pt(b - 0.04, 1.01, wallHeight * 0.96),
      ],
      '#eef2f6'
    );
    poly(
      [
        pt(1.01, b - 0.04, 0),
        pt(1.01, b + 0.04, 0),
        pt(1.01, b + 0.04, wallHeight * 0.96),
        pt(1.01, b - 0.04, wallHeight * 0.96),
      ],
      '#6c788e'
    );
  }
  poly([pt(-0.18, 1.01, 0), pt(0.18, 1.01, 0), pt(0.18, 1.01, wallHeight * 0.42), pt(-0.18, 1.01, wallHeight * 0.42)], '#1e293b');
  poly([pt(-0.22, 1.01, wallHeight * 0.42), pt(0.22, 1.01, wallHeight * 0.42), pt(0.22, 1.01, wallHeight * 0.54), pt(-0.22, 1.01, wallHeight * 0.54)], accentCol);

  poly([pt(-1, -1, wallHeight), pt(1, -1, wallHeight), pt(1, 1, wallHeight), pt(-1, 1, wallHeight)], '#e2e8f0', '#ffffff');

  const tierCount = 5;
  const outerR = 0.93;
  const innerR = 0.47;
  const fieldZ = Math.max(2.5, wallHeight * 0.14);

  for (let t = 0; t < tierCount; t++) {
    const f0 = t / tierCount;
    const f1 = (t + 1) / tierCount;
    const rOuter = outerR - (outerR - innerR) * f0;
    const rInner = outerR - (outerR - innerR) * f1;
    const zTop = wallHeight - (wallHeight - fieldZ) * f0;
    const zBot = wallHeight - (wallHeight - fieldZ) * f1;

    poly(
      [
        pt(-rOuter, -rOuter, zTop),
        pt(rOuter, -rOuter, zTop),
        pt(rOuter, -rOuter, zBot),
        pt(-rOuter, -rOuter, zBot),
      ],
      t % 2 === 0 ? '#64748b' : '#475569'
    );
    poly(
      [
        pt(-rOuter, -rOuter, zTop),
        pt(-rOuter, rOuter, zTop),
        pt(-rOuter, rOuter, zBot),
        pt(-rOuter, -rOuter, zBot),
      ],
      t % 2 === 0 ? '#94a3b8' : '#7a8799'
    );

    const treadCol = t % 2 === 0 ? '#cbd5e1' : '#b4c0d1';
    poly(
      [
        pt(-rOuter, -rOuter, zBot),
        pt(rOuter, -rOuter, zBot),
        pt(rOuter, rOuter, zBot),
        pt(-rOuter, rOuter, zBot),
      ],
      treadCol,
      'rgba(51, 65, 85, 0.35)'
    );

    const rSeat = (rOuter + rInner) * 0.52;
    const [s0x, s0y] = pt(-rSeat, -rSeat, zBot);
    const [s1x, s1y] = pt(rSeat, -rSeat, zBot);
    const [s2x, s2y] = pt(rSeat, rSeat, zBot);
    const [s3x, s3y] = pt(-rSeat, rSeat, zBot);
    ctx.strokeStyle = t === 0 || t === 3 ? accentCol : '#3b4e6b';
    ctx.lineWidth = Math.max(1.2, uSpan * 0.9);
    ctx.beginPath();
    ctx.moveTo(s0x, s0y);
    ctx.lineTo(s1x, s1y);
    ctx.lineTo(s2x, s2y);
    ctx.lineTo(s3x, s3y);
    ctx.closePath();
    ctx.stroke();

    const seatsPerSide = Math.max(4, Math.round(uSpan * 4.5));
    for (let k = 0; k < seatsPerSide; k++) {
      const pFrac = -rSeat + ((k + 0.5) / seatsPerSide) * (rSeat * 2);
      const ptsCrowd: Array<[number, number]> = [
        pt(pFrac, -rSeat, zBot + 0.6),
        pt(pFrac, rSeat, zBot + 0.6),
        pt(-rSeat, pFrac, zBot + 0.6),
        pt(rSeat, pFrac, zBot + 0.6),
      ];
      for (let sideIdx = 0; sideIdx < ptsCrowd.length; sideIdx++) {
        if ((k + t + sideIdx) % 3 === 0) continue;
        const [cxC, cyC] = ptsCrowd[sideIdx];
        ctx.fillStyle = crowdCols[(k + t * 2 + sideIdx) % crowdCols.length];
        ctx.fillRect(cxC - 1.1, cyC - 1.4, 2.2, 1.8);
      }
    }
  }

  const stairFracs = uSpan >= 1.4 ? [-0.55, 0, 0.55] : [-0.45, 0.45];
  for (const sf of stairFracs) {
    const stairSides: Array<[number, number, number, number]> = [
      [sf, -outerR, sf, -innerR],
      [sf, outerR, sf, innerR],
      [-outerR, sf, -innerR, sf],
      [outerR, sf, innerR, sf],
    ];
    for (const [u0, v0, u1, v1] of stairSides) {
      for (let st = 0; st < tierCount; st++) {
        const fa = st / tierCount;
        const fb = (st + 1) / tierCount;
        const ua = u0 + (u1 - u0) * fa;
        const va = v0 + (v1 - v0) * fa;
        const ub = u0 + (u1 - u0) * fb;
        const vb = v0 + (v1 - v0) * fb;
        const za = wallHeight - (wallHeight - fieldZ) * fa;
        const zb = wallHeight - (wallHeight - fieldZ) * fb;
        const [sx0, sy0] = pt(ua, va, za);
        const [sx1, sy1] = pt(ub, vb, zb);
        drawLine64(ctx, sx0, sy0, sx1, sy1, '#f8fafc', Math.max(2.0, uSpan * 1.45));
        drawLine64(ctx, sx0, sy0 - 0.8, sx1, sy1 - 0.8, '#facc15', 0.85);
      }
    }
  }

  poly([pt(-innerR, -innerR, fieldZ), pt(innerR, -innerR, fieldZ), pt(innerR, innerR, fieldZ), pt(-innerR, innerR, fieldZ)], '#237a33');
  const pitchR = innerR * 0.9;
  const stripeCount = uSpan >= 1.4 ? 8 : 4;
  for (let sIdx = 0; sIdx < stripeCount; sIdx++) {
    const u0 = -pitchR + (sIdx / stripeCount) * (pitchR * 2);
    const u1 = -pitchR + ((sIdx + 1) / stripeCount) * (pitchR * 2);
    poly(
      [pt(u0, -pitchR, fieldZ), pt(u1, -pitchR, fieldZ), pt(u1, pitchR, fieldZ), pt(u0, pitchR, fieldZ)],
      sIdx % 2 === 0 ? '#2b9940' : '#3ec456'
    );
  }

  const [f0x, f0y] = pt(-pitchR * 0.92, -pitchR * 0.88, fieldZ);
  const [f1x, f1y] = pt(pitchR * 0.92, -pitchR * 0.88, fieldZ);
  const [f2x, f2y] = pt(pitchR * 0.92, pitchR * 0.88, fieldZ);
  const [f3x, f3y] = pt(-pitchR * 0.92, pitchR * 0.88, fieldZ);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.moveTo(f0x, f0y);
  ctx.lineTo(f1x, f1y);
  ctx.lineTo(f2x, f2y);
  ctx.lineTo(f3x, f3y);
  ctx.closePath();
  ctx.stroke();

  const [m0x, m0y] = pt(0, -pitchR * 0.88, fieldZ);
  const [m1x, m1y] = pt(0, pitchR * 0.88, fieldZ);
  drawLine64(ctx, m0x, m0y, m1x, m1y, '#ffffff', 1.15);

  const [pcx, pcy] = pt(0, 0, fieldZ);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.ellipse(pcx, pcy, Math.max(4, uSpan * 6.2), Math.max(2, uSpan * 3.1), 0, 0, Math.PI * 2);
  ctx.stroke();

  for (const endSign of [-1, 1]) {
    const xEnd = endSign * pitchR * 0.92;
    const xBox = endSign * pitchR * 0.62;
    const [b0x, b0y] = pt(xEnd, -pitchR * 0.44, fieldZ);
    const [b1x, b1y] = pt(xBox, -pitchR * 0.44, fieldZ);
    const [b2x, b2y] = pt(xBox, pitchR * 0.44, fieldZ);
    const [b3x, b3y] = pt(xEnd, pitchR * 0.44, fieldZ);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(b0x, b0y);
    ctx.lineTo(b1x, b1y);
    ctx.lineTo(b2x, b2y);
    ctx.lineTo(b3x, b3y);
    ctx.stroke();

    const [g0x, g0y] = pt(xEnd, -pitchR * 0.17, fieldZ);
    const [g1x, g1y] = pt(xEnd, pitchR * 0.17, fieldZ);
    const [g2x, g2y] = pt(xEnd, -pitchR * 0.17, fieldZ + 2.8);
    const [g3x, g3y] = pt(xEnd, pitchR * 0.17, fieldZ + 2.8);
    drawLine64(ctx, g0x, g0y, g2x, g2y, '#ffffff', 1.1);
    drawLine64(ctx, g1x, g1y, g3x, g3y, '#ffffff', 1.1);
    drawLine64(ctx, g2x, g2y, g3x, g3y, '#ffffff', 1.2);
  }

  if (withCanopy) {
    poly(
      [
        pt(-1.02, -1.02, wallHeight + 5),
        pt(1.02, -1.02, wallHeight + 5),
        pt(0.92, -0.78, wallHeight + 6),
        pt(-0.92, -0.78, wallHeight + 6),
      ],
      'rgba(248, 250, 252, 0.9)',
      accentCol
    );
    poly(
      [
        pt(-1.02, -1.02, wallHeight + 5),
        pt(-0.78, -0.92, wallHeight + 6),
        pt(-0.78, 0.92, wallHeight + 6),
        pt(-1.02, 1.02, wallHeight + 5),
      ],
      'rgba(241, 245, 249, 0.88)',
      accentCol
    );
    const [sb0x, sb0y] = pt(-0.22, -0.98, wallHeight + 2);
    const [sb1x, sb1y] = pt(0.22, -0.98, wallHeight + 2);
    drawLine64(ctx, sb0x, sb0y - 4, sb1x, sb1y - 4, '#0f172a', 5.5);
    drawLine64(ctx, sb0x + 2, sb0y - 4, sb1x - 2, sb1y - 4, '#38bdf8', 2.2);
  }

  const towerH = Math.max(16, wallHeight * 0.9);
  for (const [tu, tv] of [
    [-0.94, -0.94],
    [0.94, -0.94],
    [-0.94, 0.94],
    [0.94, 0.94],
  ]) {
    const [tx, ty] = pt(tu, tv, wallHeight);
    drawLine64(ctx, tx, ty, tx, ty - towerH, '#7c8ba3', 2.4);
    drawGlow64(ctx, tx, ty - towerH - 2, 10, 'rgba(255, 246, 176, 0.92)', 'rgba(255, 246, 176, 0)');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(tx - 4, ty - towerH - 4, 8, 3.8);
  }
}

function getStadiumSprite(variant: number): CachedSprite {
  const v = variant % 2;
  return getOrCreateSprite(`stadium64_v2_${v}`, 96, 118, 48, 86, (ctx, cx, cy) => {
    fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, '#9aa5b5');
    drawSteppedBleacherStadium64(ctx, cx, cy + 2, 0.88, 0.88, 17, v, false);
  });
}

/**
 * 64-Bit HD Isometric Airport (Evolves Nv. 1 -> Nv. 2 -> Nv. 3):
 * Supports the evolving multi-tile Airport Complex:
 * - Level 1 (4×10, 40 tiles): 10-tile Regional Landing Strip (Pista de Aterrissagem), parallel taxiway/apron,
 *   dual Aviation Hangars (Galpões), regional passenger terminal, fuel depot & ATC control tower.
 * - Level 2 & 3 (8×16, 128 tiles): Expanded 16-tile International Runway, rapid-exit taxiways,
 *   dual widebody Galpões, sweeping Glass International Terminal with jetbridges & monumental ATC tower.
 * Also supports legacy 6×12, 4×8, 2×2, and 1×1 compact preview cards.
 */
function getAirportSprite(
  level: number,
  variant: number,
  lotW: number = 1,
  lotH: number = 1,
  lotDx: number = 0,
  lotDy: number = 0
): CachedSprite {
  const lv = Math.max(1, Math.min(3, level || 1));
  const v = variant % 2;
  const isLargeComplex = lotW >= 4 && lotH >= 8;
  const is2x2 = lotW === 2 && lotH === 2;
  return getOrCreateSprite(
    `airport64_lv${lv}_${v}_w${lotW}h${lotH}_x${lotDx}y${lotDy}`,
    102,
    130,
    51,
    96,
    (ctx, cx, cy) => {
      // 1. Airfield turf perimeter & concrete tarmac apron
      fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, '#3c6343');
      const tarmac = ctx.createLinearGradient(cx - 30, cy - 15, cx + 30, cy + 15);
      tarmac.addColorStop(0, '#6a768a');
      tarmac.addColorStop(1, '#485263');
      fillDiamond64(ctx, cx, cy, 30, 15, tarmac);

      // Helper to draw a 3D isometric parked jet on the apron (oriented along runway/taxiway)
      const drawParkedJet = (px: number, py: number, s: number, tailColor: string) => {
        ctx.save();
        ctx.translate(px, py);
        ctx.fillStyle = 'rgba(8, 14, 24, 0.35)';
        ctx.beginPath();
        ctx.ellipse(1, 2.5, 9 * s, 2.5 * s, -0.42, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#dbe4f0';
        ctx.beginPath();
        ctx.moveTo(2 * s, 0);
        ctx.lineTo(-3 * s, -8 * s);
        ctx.lineTo(-5 * s, -8 * s);
        ctx.lineTo(-2 * s, 0);
        ctx.lineTo(-5 * s, 8 * s);
        ctx.lineTo(-3 * s, 8 * s);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(0, -1.2 * s, 9 * s, 2.2 * s, -0.42, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#94a3b8';
        ctx.beginPath();
        ctx.ellipse(0, 0, 9 * s, 1.6 * s, -0.42, 0, Math.PI);
        ctx.fill();
        ctx.fillStyle = tailColor;
        ctx.beginPath();
        ctx.moveTo(5 * s, -3.2 * s);
        ctx.lineTo(8.2 * s, -8.2 * s);
        ctx.lineTo(6.2 * s, -8.2 * s);
        ctx.lineTo(3.5 * s, -2.5 * s);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#1e3a5f';
        ctx.fillRect(-5.8 * s, 0.2 * s, 2.2 * s, 1.8 * s);
        ctx.restore();
      };

      // Helper to draw a vaulted steel Aviation Galpão (Hangar) module
      const drawHangarGalpao = (
        hx: number,
        hy: number,
        r: number,
        h: number,
        roofTint: string,
        hasOpenBay: boolean
      ) => {
        drawPrism64(
          ctx,
          hx,
          hy,
          r,
          h,
          {
            top: roofTint,
            topHi: '#e2e8f0',
            left: '#cbd5e1',
            leftBot: '#94a3b8',
            right: '#64748b',
            rightBot: '#475569',
          },
          { rimColor: '#f8fafc', outlineColor: '#cbd5e1', castShadow: true }
        );
        ctx.fillStyle = roofTint;
        ctx.beginPath();
        ctx.ellipse(hx, hy - h, r * 0.72, r * 0.36, 0, Math.PI, 0);
        ctx.fill();
        drawLine64(ctx, hx - r * 0.55, hy - h - 2, hx + r * 0.55, hy - h - 2, '#f8fafc', 1.2);
        if (hasOpenBay) {
          ctx.fillStyle = '#0f172a';
          ctx.beginPath();
          ctx.moveTo(hx + 2, hy - 1);
          ctx.lineTo(hx + r * 0.78, hy - r * 0.39 - 1);
          ctx.lineTo(hx + r * 0.78, hy - r * 0.39 - h * 0.65);
          ctx.lineTo(hx + 2, hy - h * 0.65);
          ctx.closePath();
          ctx.fill();
          drawLine64(
            ctx,
            hx + 3,
            hy - h * 0.62,
            hx + r * 0.74,
            hy - r * 0.37 - h * 0.62,
            '#fde047',
            1.5
          );
        }
      };

      if (isLargeComplex) {
        // 4×10 (Nv. 1) vs 8×16 (Nv. 2 & Nv. 3) vs legacy 6×12 / 4×8 layout along isometric axes:
        // Note: +lotDx moves down-right (+15, +7.5), +lotDy moves down-left (-15, +7.5)!
        const isExpanded = lotW >= 8 || lotH >= 16;
        const isMedium6x12 = !isExpanded && lotW >= 6 && lotH >= 12;
        const isCompact4x10 = !isExpanded && !isMedium6x12 && lotW === 4 && lotH >= 10;
        const apronStartCol = isExpanded ? 2 : 1;
        const runwayStartCol = isExpanded ? 4 : isMedium6x12 ? 3 : 2;
        const runwayEndCol = isExpanded ? 6 : isMedium6x12 ? 4 : 2;
        const centerRunwayCol = isExpanded ? 5 : isMedium6x12 ? 3 : 2;

        // ------------------------------------------------------------------
        // ZONE A: Outer Grass Safety Shoulder (lotDx > runwayEndCol)
        // ------------------------------------------------------------------
        if (lotDx > runwayEndCol) {
          fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, '#3c6343');
          fillDiamond64(ctx, cx, cy, 29, 14.5, '#4b7853');
          // Security fence along the runway edge
          drawLine64(ctx, cx + 14, cy - 7, cx - 14, cy + 7, '#94a3b8', 1.1);
          if (lotDy === 1 || lotDy === lotH - 2) {
            // Orange & white aviation windsock (biruta)
            drawLine64(ctx, cx + 2, cy, cx + 2, cy - 11, '#e2e8f0', 1.4);
            ctx.fillStyle = '#f97316';
            ctx.beginPath();
            ctx.moveTo(cx + 2, cy - 11);
            ctx.lineTo(cx + 10, cy - 9);
            ctx.lineTo(cx + 2, cy - 7.5);
            ctx.closePath();
            ctx.fill();
          } else if (lotDy % 3 === 0) {
            drawPrism64(ctx, cx + 2, cy + 1, 6, 5, {
              top: '#ef4444',
              left: '#f8fafc',
              right: '#dc2626',
            });
          }
          return;
        }

        // ------------------------------------------------------------------
        // ZONE B: Continuous Landing Strip (Pista de Aterrissagem along lotDy: NE -> SW)
        // ------------------------------------------------------------------
        if (lotDx >= runwayStartCol && lotDx <= runwayEndCol) {
          fillDiamond64(ctx, cx, cy, TILE_HW + 0.6, TILE_HH + 0.4, '#1b222e');
          fillDiamond64(ctx, cx, cy, 29.5, 14.8, '#232c3b');

          const isCenterCol = lotDx === centerRunwayCol;
          const isLeftEdge = lotDx === runwayStartCol;
          const isRightEdge = lotDx === runwayEndCol;

          const lightCol = lv === 3 ? '#38bdf8' : '#ffe066';
          // Runway edge lines running along lotDy (top-right edge -> bottom-left edge)
          if (isLeftEdge) {
            drawLine64(ctx, cx + 1, cy - 13.5, cx - 29, cy + 0.5, '#e2e8f0', 1.3);
            ctx.fillStyle = lightCol;
            ctx.fillRect(cx - 14, cy - 6.5, 2.2, 2.2);
          }
          if (isRightEdge) {
            drawLine64(ctx, cx + 29, cy - 0.5, cx + 1, cy + 13.5, '#e2e8f0', 1.3);
            ctx.fillStyle = lightCol;
            ctx.fillRect(cx + 14, cy + 6.5, 2.2, 2.2);
          }

          if (lotDy === 0 || lotDy === lotH - 1) {
            // Approach Lighting System (ALS) strobe crossbar across runway width (NW -> SE)
            if (isCenterCol) {
              drawLine64(ctx, cx - 14, cy - 7, cx + 14, cy + 7, '#475569', 2.4);
              for (let k = -10; k <= 10; k += 5) {
                drawGlow64(
                  ctx,
                  cx + k,
                  cy + k * 0.5,
                  4.2,
                  'rgba(255, 230, 102, 0.95)',
                  'rgba(255, 230, 102, 0)'
                );
              }
            }
          } else if (lotDy === 1 || lotDy === lotH - 2) {
            // Runway Threshold "Piano Keys" (Cabeceira da Pista) stripes aligned along lotDy
            if (isCenterCol || runwayEndCol > runwayStartCol) {
              for (let k = -10; k <= 10; k += 4) {
                drawLine64(
                  ctx,
                  cx + k + 5,
                  cy + k * 0.5 - 2.5,
                  cx + k - 5,
                  cy + k * 0.5 + 2.5,
                  '#f8fafc',
                  1.9
                );
              }
            }
          } else if (isCenterCol) {
            // Continuous white dashed runway centerline running along lotDy (NE -> SW)
            const ox = runwayEndCol - runwayStartCol === 1 ? 6 : 0;
            const oy = runwayEndCol - runwayStartCol === 1 ? 3 : 0;
            drawLine64(ctx, cx + 13 + ox, cy - 6.5 + oy, cx + 3 + ox, cy - 1.5 + oy, '#f8fafc', 2.2);
            drawLine64(ctx, cx - 3 + ox, cy + 1.5 + oy, cx - 13 + ox, cy + 6.5 + oy, '#f8fafc', 2.2);

            // Touchdown zone aiming bars
            if (lotDy === 2 || lotDy === lotH - 3) {
              drawLine64(ctx, cx - 9, cy - 2, cx - 3, cy + 1, '#f8fafc', 1.8);
              drawLine64(ctx, cx + 3, cy - 1, cx + 9, cy + 2, '#f8fafc', 1.8);
            }
          }
          return;
        }

        // ------------------------------------------------------------------
        // ZONE C: Parallel Taxiway & Aircraft Apron (apronStartCol <= lotDx < runwayStartCol)
        // ------------------------------------------------------------------
        if (lotDx >= apronStartCol && lotDx < runwayStartCol) {
          // Continuous yellow taxiway line running along lotDy (NE -> SW)
          drawLine64(ctx, cx + 15, cy - 7.5, cx - 15, cy + 7.5, '#f5b73b', 1.5);
          if (lotDy === 1 || lotDy === lotH - 2 || lotDy % 4 === 2) {
            // Cross-taxiway connector toward hangars/terminal & runway
            drawLine64(ctx, cx - 14, cy - 7, cx + 14, cy + 7, '#f5b73b', 1.3);
          }
          // Parked commercial & cargo jets at apron stands (runway stays clear for live landings/takeoffs!)
          const standMatch = isExpanded
            ? lotDx === apronStartCol && (lotDy === 3 || lotDy === 7 || lotDy === 11)
            : isMedium6x12
              ? lotDx === apronStartCol && (lotDy === 3 || lotDy === 6 || lotDy === 9)
              : isCompact4x10
                ? lotDy === 3 || lotDy === 6
                : lotDy === 2 || lotDy === 5;
          if (standMatch) {
            const tailColors = ['#38bdf8', '#ff785a', '#ffe066', '#22c55e'];
            drawParkedJet(
              cx - 1,
              cy + 1,
              isExpanded || isMedium6x12 ? 0.94 : 0.86,
              tailColors[(lotDy + v) % tailColors.length]
            );
          }
          return;
        }

        // ------------------------------------------------------------------
        // ZONE D: Landside Structures — Galpões (Hangars), Terminal, ATC Tower & Fuel Depot
        // ------------------------------------------------------------------
        const isApronFront = lotDx === apronStartCol - 1;

        // 1. North ATC Control Tower & Fuel Depot
        if ((isExpanded && lotDy >= 1 && lotDy <= 2) || (!isExpanded && lotDy === 1)) {
          if (lotDx === (isExpanded ? 1 : 0) && lotDy === 1) {
            const towerH = lv === 1 ? 38 : lv === 2 ? 48 : 60;
            drawPrism64(
              ctx,
              cx + 2,
              cy - 1,
              7.5,
              towerH,
              { top: '#f1f5f9', left: '#dbe3ee', right: '#6e7c91' },
              { outlineColor: '#ffffff', castShadow: true }
            );
            drawPrism64(
              ctx,
              cx + 2,
              cy - 1 - towerH,
              11.5,
              11,
              {
                top: '#e2e8f0',
                topHi: '#ffffff',
                left: '#56c2ff',
                leftBot: '#0284c7',
                right: '#0369a1',
                rightBot: '#0c4a6e',
              },
              { rimColor: '#ffffff', outlineColor: '#e0f7ff' }
            );
            const cabTopY = cy - 12 - towerH;
            ctx.fillStyle = '#f8fafc';
            ctx.beginPath();
            ctx.ellipse(cx + 2, cabTopY - 5, 5.8, 3.0, -0.3, 0, Math.PI * 2);
            ctx.fill();
            drawLine64(ctx, cx + 2, cabTopY, cx + 2, cabTopY - 12, '#cbd5e1', 1.6);
            drawGlow64(
              ctx,
              cx + 2,
              cabTopY - 13,
              6.5,
              'rgba(255, 77, 77, 0.9)',
              'rgba(255, 77, 77, 0)'
            );
          } else {
            drawPrism64(ctx, cx - 8, cy + 2, 8.5, 13, {
              top: '#f8fafc',
              left: '#e2e8f0',
              right: '#94a3b8',
            });
            drawPrism64(ctx, cx + 8, cy - 2, 7.5, 11, {
              top: '#f8fafc',
              left: '#cbd5e1',
              right: '#64748b',
            });
          }
          return;
        }

        // 2. Aviation Galpões (Hangars) — dual hangars for 4×10 (Nv. 1), 6×12 & 8×16 (Nv. 2/3)
        const inNorthGalpao = isExpanded
          ? lotDy >= 3 && lotDy <= 6
          : isMedium6x12
            ? lotDy >= 2 && lotDy <= 4
            : lotDy >= 2 && lotDy <= 4;
        const inSouthGalpao = isExpanded
          ? lotDy >= 11 && lotDy <= 14
          : isMedium6x12
            ? lotDy >= 8 && lotDy <= 10
            : isCompact4x10
              ? lotDy >= 7 && lotDy <= 8
              : false;

        if (inNorthGalpao || inSouthGalpao) {
          const roofCol = inSouthGalpao
            ? '#64748b'
            : lv === 1
              ? '#94a3b8'
              : '#7c8ba1';
          drawHangarGalpao(cx, cy + 2, 21, isExpanded ? 20 : 18, roofCol, isApronFront);
          return;
        }

        // 3. Passenger Terminal Concourse & Telescoping Boarding Jetbridges
        const inTerminal = isExpanded
          ? lotDy >= 7 && lotDy <= 10
          : isMedium6x12
            ? lotDy >= 5 && lotDy <= 7
            : lotDy >= 5 && lotDy <= 6;
        if (inTerminal) {
          const termH = lv === 1 ? 20 : lv === 2 ? 25 : 31;
          drawPrism64(
            ctx,
            cx - 2,
            cy + 2,
            22,
            termH,
            {
              top: lv === 3 ? '#38bdf8' : lv === 2 ? '#60a5fa' : '#93c5fd',
              topHi: '#e0f2fe',
              left: '#e0f2fe',
              leftBot: '#7dd3fc',
              right: '#0284c7',
              rightBot: '#0369a1',
            },
            { rimColor: '#ffffff', outlineColor: '#e0f2fe', castShadow: true, parapet: true }
          );
          drawWindows64(ctx, cx - 2, cy + 2, 22, termH, 3, 4, {
            litColor: '#ffe066',
            glassLeft: '#0369a1',
            glassRight: '#075985',
            seed: v + lotDy,
            curtainWall: true,
          });
          if (isApronFront) {
            drawLine64(ctx, cx + 6, cy + 3, cx + 22, cy + 11, '#cbd5e1', 3.8);
          }
          return;
        }

        // 4. Airfield Service Road, Fuel & Cargo Staging on edge rows
        drawLine64(ctx, cx + 15, cy - 7.5, cx - 15, cy + 7.5, '#334155', 5.0);
        drawPrism64(ctx, cx - 6, cy + 1, 8.5, 8, {
          top: '#cbd5e1',
          left: '#e2e8f0',
          right: '#64748b',
        });
        return;
      }

      if (is2x2) {
        // Specialized 2×2 Private Airport Complex Quadrants!
        if (lotDx === 0 && lotDy === 0) {
          // Quadrant (0,0): Grand Passenger Glass Terminal + VIP Sky-Concourse + Boarding Jetbridges
          const termH = lv === 1 ? 18 : lv === 2 ? 24 : 30;
          drawPrism64(
            ctx,
            cx - 4,
            cy + 2,
            22,
            termH,
            {
              top: lv === 3 ? '#38bdf8' : '#60a5fa',
              topHi: '#e0f2fe',
              left: '#e0f2fe',
              leftBot: '#7dd3fc',
              right: '#0284c7',
              rightBot: '#0369a1',
            },
            { rimColor: '#ffffff', outlineColor: '#e0f2fe', castShadow: true, parapet: true }
          );
          drawWindows64(ctx, cx - 4, cy + 2, 22, termH, 3, 4, {
            litColor: '#ffe066',
            glassLeft: '#0369a1',
            glassRight: '#075985',
            seed: v + 4,
            curtainWall: true,
          });
          // Dual telescoping boarding jetbridges extending toward the apron
          drawLine64(ctx, cx + 6, cy + 4, cx + 18, cy + 10, '#cbd5e1', 3.6);
          drawLine64(ctx, cx - 6, cy + 8, cx + 6, cy + 14, '#cbd5e1', 3.6);
        } else if (lotDx === 1 && lotDy === 0) {
          // Quadrant (1,0): Towering Air Traffic Control (ATC) Radar Center + Fuel Tanks & Helipad
          const towerH = lv === 1 ? 36 : lv === 2 ? 48 : 60;
          drawPrism64(
            ctx,
            cx + 4,
            cy - 2,
            7,
            towerH,
            { top: '#f1f5f9', left: '#dbe3ee', right: '#6e7c91' },
            { outlineColor: '#ffffff', castShadow: true }
          );
          drawPrism64(
            ctx,
            cx + 4,
            cy - 2 - towerH,
            11,
            11,
            {
              top: '#e2e8f0',
              topHi: '#ffffff',
              left: '#56c2ff',
              leftBot: '#0284c7',
              right: '#0369a1',
              rightBot: '#0c4a6e',
            },
            { rimColor: '#ffffff', outlineColor: '#e0f7ff' }
          );
          const cabTopY = cy - 13 - towerH;
          ctx.fillStyle = '#f8fafc';
          ctx.beginPath();
          ctx.ellipse(cx + 4, cabTopY - 5, 5.5, 2.8, -0.3, 0, Math.PI * 2);
          ctx.fill();
          drawLine64(ctx, cx + 4, cabTopY, cx + 4, cabTopY - 12, '#cbd5e1', 1.6);
          drawGlow64(ctx, cx + 4, cabTopY - 13, 6.5, 'rgba(255, 77, 77, 0.9)', 'rgba(255, 77, 77, 0)');
          // Aviation fuel storage spheres
          drawPrism64(ctx, cx - 12, cy + 4, 7, 13, {
            top: '#f8fafc',
            left: '#cbd5e1',
            right: '#64748b',
          });
        } else if (lotDx === 0 && lotDy === 1) {
          // Quadrant (0,1): Widebody Maintenance Hangar + Taxiway Apron + Parked Commercial Jets
          drawPrism64(
            ctx,
            cx - 12,
            cy - 2,
            13,
            17,
            { top: '#94a3b8', topHi: '#cbd5e1', left: '#e2e8f0', right: '#64748b' },
            { outlineColor: '#f8fafc', castShadow: true }
          );
          drawLine64(ctx, cx - 18, cy + 4, cx + 20, cy - 8, '#f5b73b', 1.4);
          drawParkedJet(cx + 5, cy + 4, 1.05, '#ff785a');
          if (lv >= 2) {
            drawParkedJet(cx + 14, cy - 3, 0.85, '#38bdf8');
          }
        } else {
          // Quadrant (1,1): Full High-Width Asphalt Runway Strip with Threshold Piano Keys & Approach Strobes
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(cx - 28, cy - 9);
          ctx.lineTo(cx - 16, cy - 15);
          ctx.lineTo(cx + 28, cy + 9);
          ctx.lineTo(cx + 16, cy + 15);
          ctx.closePath();
          ctx.fillStyle = '#1e2430';
          ctx.fill();
          ctx.restore();

          drawLine64(ctx, cx - 22, cy - 11, cx + 22, cy + 11, '#f8fafc', 1.6);
          const lightCol = lv === 3 ? '#38bdf8' : '#ffe066';
          for (let t = -20; t <= 20; t += 7) {
            const lx = cx + t;
            const ly = cy + t * 0.45;
            ctx.fillStyle = lightCol;
            ctx.fillRect(lx + 5, ly - 3.5, 2, 2);
            ctx.fillRect(lx - 5, ly + 3.5, 2, 2);
          }
          drawParkedJet(cx - 4, cy - 2, 0.95, '#ffe066');
        }
        return;
      }

      // Single-tile compact representation (used for preview cards and 1×1 fallback)
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx - 26, cy - 8);
      ctx.lineTo(cx - 18, cy - 12);
      ctx.lineTo(cx + 26, cy + 8);
      ctx.lineTo(cx + 18, cy + 12);
      ctx.closePath();
      ctx.fillStyle = '#1f2530';
      ctx.fill();
      ctx.restore();

      drawLine64(ctx, cx - 16, cy - 3, cx + 16, cy + 11, '#f5b73b', 1.2);
      ctx.save();
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(cx - 21, cy - 9.5);
      ctx.lineTo(cx + 21, cy + 9.5);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      if (lv >= 2) {
        const lightCol = lv === 3 ? '#38bdf8' : '#ffe066';
        for (let t = -20; t <= 20; t += 8) {
          const lx = cx + t;
          const ly = cy + t * 0.45;
          ctx.fillStyle = lightCol;
          ctx.fillRect(lx + 4, ly - 3, 1.8, 1.8);
          ctx.fillRect(lx - 4, ly + 3, 1.8, 1.8);
        }
      }

      if (lv === 1) {
        drawPrism64(
          ctx,
          cx - 12,
          cy - 4,
          12,
          14,
          { top: '#a8b5c7', left: '#d4dde8', right: '#6e7c91' },
          { outlineColor: '#e8eff7', castShadow: true }
        );
      } else {
        drawPrism64(
          ctx,
          cx - 13,
          cy - 4,
          15,
          lv === 3 ? 25 : 20,
          {
            top: '#38bdf8',
            topHi: '#e0f2fe',
            left: '#e0f2fe',
            leftBot: '#7dd3fc',
            right: '#0284c7',
            rightBot: '#0369a1',
          },
          { rimColor: '#ffffff', outlineColor: '#e0f2fe', castShadow: true }
        );
        drawWindows64(ctx, cx - 13, cy - 4, 15, lv === 3 ? 25 : 20, 3, 3, {
          litColor: '#ffe066',
          glassLeft: '#0369a1',
          glassRight: '#075985',
          seed: v + 4,
          curtainWall: true,
        });
      }

      const towerH = lv === 1 ? 30 : lv === 2 ? 42 : 54;
      drawPrism64(
        ctx,
        cx + 14,
        cy - 8,
        5.5,
        towerH,
        { top: '#f1f5f9', left: '#dbe3ee', right: '#6e7c91' },
        { outlineColor: '#ffffff', castShadow: true }
      );
      drawPrism64(
        ctx,
        cx + 14,
        cy - 8 - towerH,
        lv >= 2 ? 10 : 8,
        10,
        {
          top: '#e2e8f0',
          topHi: '#ffffff',
          left: '#56c2ff',
          leftBot: '#0284c7',
          right: '#0369a1',
          rightBot: '#0c4a6e',
        },
        { rimColor: '#ffffff', outlineColor: '#e0f7ff' }
      );
      const cabTopY = cy - 18 - towerH;
      drawLine64(ctx, cx + 14, cabTopY, cx + 14, cabTopY - 12, '#cbd5e1', 1.6);
      drawGlow64(ctx, cx + 14, cabTopY - 13, 6, 'rgba(255, 77, 77, 0.9)', 'rgba(255, 77, 77, 0)');

      drawParkedJet(cx - 4, cy + 5, lv >= 2 ? 1.0 : 0.78, lv === 3 ? '#ff785a' : '#38bdf8');
      if (lv === 3) {
        drawParkedJet(cx + 8, cy - 3, 0.78, '#ffe066');
      }
    }
  );
}

// ============================================================================
// 20 Iconic Establishments × 3 Visual Variations (Reference Sheet Fidelity)
// ============================================================================

/** Draw a miniature parked 3D isometric vehicle (ambulance, police cruiser, fire engine, school bus) */
function drawParkedMiniVehicle64(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  kind: 'ambulance' | 'police' | 'firetruck' | 'schoolbus',
  flip: boolean = false
): void {
  ctx.save();
  ctx.translate(x, y);
  if (flip) ctx.scale(-1, 1);

  // Ground shadow
  ctx.fillStyle = 'rgba(8, 14, 24, 0.36)';
  ctx.beginPath();
  ctx.ellipse(0, 2.2, 6.2, 3.0, -0.28, 0, Math.PI * 2);
  ctx.fill();

  if (kind === 'ambulance') {
    drawPrism64(ctx, 0, 1.5, 4.8, 4.6, {
      top: '#ffffff',
      left: '#f8fafc',
      right: '#cbd5e1',
    });
    // Red emergency stripe & medical cross
    ctx.fillStyle = '#e11d48';
    ctx.fillRect(-4.2, -1.2, 4.0, 1.3);
    ctx.fillRect(0.2, -1.2, 4.0, 1.3);
    ctx.fillRect(-0.8, -4.2, 1.6, 0.9);
    // Windshield
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(1.2, -2.4, 2.4, 1.4);
  } else if (kind === 'police') {
    drawPrism64(ctx, 0, 1.4, 4.4, 3.4, {
      top: '#f8fafc',
      left: '#1e293b',
      right: '#0f172a',
    });
    // White door panel
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(-2.0, -1.0, 2.2, 1.6);
    // Red/blue siren bar
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(-1.1, -3.2, 1.1, 0.9);
    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(0, -3.2, 1.1, 0.9);
  } else if (kind === 'firetruck') {
    drawPrism64(ctx, 0, 1.8, 6.0, 5.2, {
      top: '#ef4444',
      left: '#dc2626',
      right: '#991b1b',
    });
    // White turntable ladder on roof & chrome bumper
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(-4.2, -4.5, 7.6, 1.2);
    ctx.fillRect(-5.0, -0.8, 9.5, 0.9);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(1.8, -2.8, 2.8, 1.6);
  } else if (kind === 'schoolbus') {
    drawPrism64(ctx, 0, 1.8, 6.2, 4.8, {
      top: '#fbbf24',
      left: '#f59e0b',
      right: '#d97706',
    });
    // Black window band
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(-4.6, -1.8, 8.8, 1.4);
  }
  ctx.restore();
}

/** Draw a moored boat at the river marina ('yacht' | 'speedboat' | 'sailboat') */
function drawMooredMarinaBoat64(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  kind: 'yacht' | 'speedboat' | 'sailboat',
  accentColor: string = '#ef4444'
): void {
  ctx.save();
  ctx.translate(x, y);
  // Water reflection shadow
  ctx.fillStyle = 'rgba(6, 28, 52, 0.45)';
  ctx.beginPath();
  ctx.ellipse(0, 2.2, 7.5, 3.0, 0.35, 0, Math.PI * 2);
  ctx.fill();

  if (kind === 'yacht') {
    // Sleek white luxury yacht with blue cabin windows & upper flybridge
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.moveTo(-7.5, -1.5);
    ctx.lineTo(1.5, -4.2);
    ctx.lineTo(8.5, 1.2);
    ctx.lineTo(5.0, 3.8);
    ctx.lineTo(-6.5, 1.0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(-5.0, 0.2, 9.5, 1.5);
    drawPrism64(ctx, -0.5, -0.5, 4.2, 3.8, {
      top: '#ffffff',
      left: '#f1f5f9',
      right: '#94a3b8',
    });
    ctx.fillStyle = '#0284c7';
    ctx.fillRect(-3.5, -2.8, 6.0, 1.4);
  } else if (kind === 'speedboat') {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(-5.5, -1.0);
    ctx.lineTo(1.0, -2.8);
    ctx.lineTo(6.2, 1.0);
    ctx.lineTo(3.5, 2.8);
    ctx.lineTo(-4.8, 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = accentColor;
    ctx.fillRect(-3.8, -1.4, 6.5, 1.5);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(-1.0, -2.4, 2.8, 1.2);
  } else {
    // Classic wooden/white sailboat with tall mast
    ctx.fillStyle = '#d97706';
    ctx.beginPath();
    ctx.moveTo(-6.0, -1.0);
    ctx.lineTo(1.0, -3.0);
    ctx.lineTo(6.8, 1.0);
    ctx.lineTo(3.8, 2.8);
    ctx.lineTo(-5.2, 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fef3c7';
    ctx.fillRect(-3.5, -1.4, 6.2, 1.4);
    drawLine64(ctx, 0, -1.5, 0, -13.5, '#f8fafc', 1.3);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.beginPath();
    ctx.moveTo(0, -13);
    ctx.lineTo(5.5, -4);
    ctx.lineTo(0, -3.5);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Draw a medical or sheriff cross / star emblem */
function drawCrossEmblem64(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  bgColor?: string
): void {
  if (bgColor) {
    ctx.fillStyle = bgColor;
    ctx.beginPath();
    ctx.arc(x, y, r + 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  const arm = Math.max(1.4, r * 0.52);
  ctx.fillStyle = color;
  ctx.fillRect(x - arm / 2, y - r, arm, r * 2);
  ctx.fillRect(x - r, y - arm / 2, r * 2, arm);
}

/**
 * Render any of the 20 iconic establishments with 3 distinct visual variations (`v = variant % 3`),
 * strictly matching the reference image (`/public/assets/aistudio/image_ed4f1b1b.jpg`).
 */
function getEstablishmentSprite(
  estId: EstablishmentId,
  variant: number,
  animFrame: number,
  lotW: number = 1,
  lotH: number = 1,
  lotDx: number = 0,
  lotDy: number = 0,
  rotation: CameraRotation = 0
): CachedSprite {
  const v = ((variant % 3) + 3) % 3;
  const f = animFrame % 2;
  const isMulti = lotW > 1 || lotH > 1;

  // Multi-tile 4×3 Soccer Stadium Arena: seamless stepped bleacher amphitheater surrounding the emerald pitch
  if (estId === 'soccer_stadium' && lotW >= 3 && lotH >= 3) {
    const rotLot = getRotatedLotCoords(lotW, lotH, lotDx, lotDy, rotation);
    if (!rotLot.isFrontCorner) {
      return getOrCreateSprite(
        `est64_stadium_base_v${v}_w${rotLot.rotW}h${rotLot.rotH}_x${rotLot.rDx}y${rotLot.rDy}`,
        98,
        128,
        49,
        94,
        (ctx, cx, cy) => {
          fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, '#8c97a8');
          fillDiamond64(ctx, cx, cy, 29, 14.5, '#cbd5e1');
          drawSidewalkPaving64(ctx, cx, cy, rotLot.rDx + rotLot.rDy + v);
          if (rotLot.rDx === 0 || rotLot.rDy === 0) {
            drawStreetProp64(ctx, cx - 14, cy + 2, 'lamp');
          }
        }
      );
    }
    return getOrCreateSprite(
      `est64_stadium_hero_v${v}_w${rotLot.rotW}h${rotLot.rotH}`,
      300,
      250,
      150,
      180,
      (ctx, cx, cy) => {
        fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, '#8c97a8');
        fillDiamond64(ctx, cx, cy, 29, 14.5, '#cbd5e1');
        drawSidewalkPaving64(ctx, cx, cy, v + 2);
        const dRx = -(rotLot.rotW - 1) / 2;
        const dRy = -(rotLot.rotH - 1) / 2;
        const mx = cx + (dRx - dRy) * TILE_HW;
        const my = cy + (dRx + dRy) * TILE_HH;
        drawSteppedBleacherStadium64(
          ctx,
          mx,
          my + 3,
          rotLot.rotW * 0.46,
          rotLot.rotH * 0.46,
          26,
          v,
          true
        );
      }
    );
  }

  return getOrCreateSprite(
    `est64_${estId}_v${v}_f${f}_w${lotW}h${lotH}_x${lotDx}y${lotDy}`,
    98,
    128,
    49,
    94,
    (ctx, cx, cy) => {

      // For multi-tile establishments (2×1, 2×2, 3×2, 3×3), tile (0,0) renders the main hero building
      // and companion tiles (lotDx > 0 || lotDy > 0) render specialized campus wings, courtyards & vehicle bays
      if (isMulti && (lotDx > 0 || lotDy > 0)) {
        fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, '#8f9bad');
        fillDiamond64(ctx, cx, cy, 29.5, 14.8, '#cfd7e3');

        if (estId === 'municipal_school') {
          // 2×1 Companion: Fenced schoolyard sports court, playground & parked yellow school bus
          fillDiamond64(ctx, cx, cy, 26, 13, '#71b357');
          fillDiamond64(ctx, cx - 3, cy - 1, 14, 7, '#d97724', '#ffffff', 1.0);
          drawParkedMiniVehicle64(ctx, cx + 10, cy + 6, 'schoolbus', true);
          drawTree64(ctx, cx - 15, cy + 2, 'emerald', 0.9);
          return;
        }
        if (estId === 'police_station') {
          // 2×1 Companion: Police Motor-Pool Yard with patrol cruisers & dispatch communications mast
          fillDiamond64(ctx, cx, cy, 27, 13.5, '#475569');
          drawPrism64(ctx, cx - 8, cy - 2, 11, 11, {
            top: '#3b82f6',
            left: '#93c5fd',
            right: '#1d4ed8',
          });
          drawLine64(ctx, cx - 8, cy - 13, cx - 8, cy - 25, '#cbd5e1', 1.5);
          drawParkedMiniVehicle64(ctx, cx + 4, cy + 4, 'police', true);
          drawParkedMiniVehicle64(ctx, cx + 12, cy + 1, 'police', false);
          return;
        }
        if (estId === 'fire_station') {
          // 2×1 Companion: Emergency Drill Yard with Red Training Tower & parked Fire Engines
          fillDiamond64(ctx, cx, cy, 27, 13.5, '#64748b');
          drawPrism64(ctx, cx - 10, cy - 2, 9, 26, {
            top: '#991b1b',
            left: '#dc2626',
            right: '#7f1d1d',
          });
          drawParkedMiniVehicle64(ctx, cx + 5, cy + 4, 'firetruck', true);
          drawParkedMiniVehicle64(ctx, cx + 13, cy, 'firetruck', false);
          return;
        }
        if (estId === 'municipal_market') {
          // 2×2 Companion: Second covered market hall wing & open-air farmer's market plaza with striped stalls
          if (lotDx === 1 && lotDy === 0) {
            drawPrism64(ctx, cx, cy + 2, 20, 14, {
              top: v === 0 ? '#0f766e' : v === 1 ? '#166534' : '#b45309',
              left: '#f3e8d2',
              right: '#c4b393',
            });
            return;
          }
          fillDiamond64(ctx, cx, cy, 28, 14, '#d6c7b2');
          const stallCols = ['#ef4444', '#22c55e', '#f59e0b', '#3b82f6'];
          for (let s = 0; s < 4; s++) {
            const sx = cx - 12 + (s % 2) * 16;
            const sy = cy - 4 + Math.floor(s / 2) * 9;
            drawPrism64(ctx, sx, sy, 6.5, 6, {
              top: stallCols[(s + v) % stallCols.length],
              left: '#fef3c7',
              right: '#d97706',
            });
          }
          return;
        }
        if (estId === 'rooftop_hotel') {
          // 1×2 Companion: Luxury Resort Pool Terrace with turquoise swimming pool & palms
          fillDiamond64(ctx, cx, cy, 27, 13.5, '#e2d5be');
          fillDiamond64(ctx, cx, cy - 1, 17, 8.5, '#38bdf8', '#f8fafc', 1.4);
          drawTree64(ctx, cx - 16, cy - 2, 'lime', 0.9);
          drawTree64(ctx, cx + 16, cy + 2, 'emerald', 0.9);
          return;
        }
        if (estId === 'river_marina') {
          // 2×1 Companion: Extended Timber Yacht Pier with moored luxury yacht & sailboat
          const waterGrad = ctx.createLinearGradient(cx - 28, cy - 14, cx + 28, cy + 14);
          waterGrad.addColorStop(0, '#1d6fa5');
          waterGrad.addColorStop(1, '#124e78');
          fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, waterGrad);
          drawLine64(ctx, cx - 22, cy - 4, cx + 20, cy + 12, '#8b5a2b', 4.5);
          drawMooredMarinaBoat64(ctx, cx - 8, cy + 4, 'yacht');
          drawMooredMarinaBoat64(ctx, cx + 8, cy - 2, 'sailboat');
          return;
        }
        if (estId === 'general_hospital') {
          // 3×2 Medical Campus Wings: Surgical Wing, Diagnostic Atrium, ER Ambulance Bay & Helipad Plaza
          if (lotDy === 0) {
            drawPrism64(ctx, cx, cy + 2, 20, lotDx === 1 ? 24 : 19, {
              top: '#e2e8f0',
              left: '#f8fafc',
              right: '#cbd5e1',
            });
            drawCrossEmblem64(ctx, cx, cy - (lotDx === 1 ? 22 : 17), 4.2, '#ef4444', '#ffffff');
          } else if (lotDx === 0) {
            drawPrism64(ctx, cx - 4, cy, 15, 12, {
              top: '#38bdf8',
              left: '#f1f5f9',
              right: '#94a3b8',
            });
            drawParkedMiniVehicle64(ctx, cx + 6, cy + 5, 'ambulance', true);
            drawParkedMiniVehicle64(ctx, cx + 14, cy + 1, 'ambulance', false);
          } else if (lotDx === 1) {
            fillDiamond64(ctx, cx, cy, 25, 12.5, '#68b058');
            fillDiamond64(ctx, cx, cy, 12, 6, '#94a3b8');
            drawLine64(ctx, cx - 4, cy - 2, cx + 4, cy + 2, '#facc15', 1.8);
          } else {
            fillDiamond64(ctx, cx, cy, 26, 13, '#64748b');
            drawParkedMiniVehicle64(ctx, cx - 8, cy + 3, 'ambulance', true);
            drawTree64(ctx, cx + 12, cy - 1, 'emerald', 0.85);
          }
          return;
        }
        if (estId === 'botanical_garden') {
          // 3×2 Botanical Conservatory: Crystal Glass Greenhouse Wings + Ornamental Flower Parterres
          fillDiamond64(ctx, cx, cy, 28, 14, '#4d9e3f');
          if (lotDy === 0) {
            ctx.fillStyle = 'rgba(186, 230, 253, 0.85)';
            ctx.beginPath();
            ctx.arc(cx, cy - 3, lotDx === 1 ? 17 : 13, Math.PI, 0);
            ctx.closePath();
            ctx.fill();
            drawTree64(ctx, cx - 15, cy + 4, 'lime', 0.8);
          } else {
            fillDiamond64(ctx, cx - 8, cy, 9, 4.5, '#ec4899');
            fillDiamond64(ctx, cx + 8, cy, 9, 4.5, '#facc15');
            drawTree64(ctx, cx, cy - 5, 'blossom', 0.95);
          }
          return;
        }
        if (estId === 'amusement_park') {
          // 3×3 Theme Park Zones: Roller Coaster Hills, Big-Top Circus Tent & Carnival Midway
          fillDiamond64(ctx, cx, cy, 29, 14.5, '#e9d8a6');
          if (lotDy === 0) {
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 2.2;
            ctx.beginPath();
            ctx.moveTo(cx - 18, cy + 4);
            ctx.quadraticCurveTo(cx, cy - 22, cx + 18, cy + 4);
            ctx.stroke();
          } else if (lotDx === 2) {
            ctx.fillStyle = '#ec4899';
            ctx.beginPath();
            ctx.moveTo(cx - 14, cy + 6);
            ctx.lineTo(cx, cy - 14);
            ctx.lineTo(cx + 14, cy + 6);
            ctx.closePath();
            ctx.fill();
          } else {
            fillDiamond64(ctx, cx, cy, 14, 7, '#38bdf8', '#fde047', 1.4);
            drawTree64(ctx, cx - 14, cy + 2, 'emerald', 0.85);
            drawTree64(ctx, cx + 14, cy - 2, 'lime', 0.85);
          }
          return;
        }
        if (estId === 'tech_university') {
          // 3×3 University Campus: Solar Research Wings, Student Commons Quad & Engineering Pavilion
          if (lotDy === 0) {
            drawPrism64(ctx, cx, cy + 2, 19, 18 + lotDx * 3, {
              top: '#38bdf8',
              left: '#e0f2fe',
              right: '#0284c7',
            });
            fillDiamond64(ctx, cx, cy - 16 - lotDx * 3, 11, 5.5, '#1e3a8a', '#93c5fd', 0.9);
          } else if (lotDy === 2 && lotDx !== 1) {
            drawPrism64(ctx, cx, cy + 2, 17, 15, {
              top: '#93c5fd',
              left: '#f1f5f9',
              right: '#64748b',
            });
          } else {
            fillDiamond64(ctx, cx, cy, 25, 12.5, '#65b054');
            fillDiamond64(ctx, cx, cy, 12, 6, '#e2e8f0');
            drawTree64(ctx, cx - 13, cy + 1, 'emerald', 0.9);
            drawTree64(ctx, cx + 13, cy - 1, 'lime', 0.9);
          }
          return;
        }

        // General 2×2 Cultural / Civic Campus Annex & Landscaped Sculpture Forecourt
        if (lotDy === 0) {
          drawPrism64(ctx, cx, cy + 2, 18, 17, {
            top: '#cbd5e1',
            left: '#f1f5f9',
            right: '#94a3b8',
          });
        } else {
          fillDiamond64(ctx, cx, cy, 24, 12, '#62ad52');
          fillDiamond64(ctx, cx, cy, 12, 6, '#d6c7b0');
          drawTree64(ctx, cx - 13, cy + 1, 'emerald', 0.9);
          drawTree64(ctx, cx + 13, cy - 1, 'blossom', 0.9);
        }
        return;
      }

      switch (estId) {
      // ----------------------------------------------------------------------
      // 1. PRAÇA COM CHAFARIZ (Circular blue fountain / Square stone statue / Bandstand & flowers)
      // ----------------------------------------------------------------------
      case 'fountain_plaza': {
        fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, '#b8c1cf');
        const lawn = ctx.createLinearGradient(cx - 28, cy - 14, cx + 28, cy + 14);
        lawn.addColorStop(0, '#62b852');
        lawn.addColorStop(1, '#448f38');
        fillDiamond64(ctx, cx, cy, 29.5, 14.8, lawn);

        // Warm brick-stone diagonal footpaths & central plaza ring
        drawLine64(ctx, cx - 22, cy - 11, cx + 22, cy + 11, '#c9b89e', 4.0);
        drawLine64(ctx, cx - 22, cy + 11, cx + 22, cy - 11, '#c9b89e', 4.0);
        fillDiamond64(ctx, cx, cy, 13.5, 6.8, '#d6c7b0', '#a6967e', 1.0);

        if (v === 0) {
          // Var 1: Chafariz circular azul escalonado (fiel ao centro da imagem de referência)
          ctx.fillStyle = '#cbd5e1';
          ctx.beginPath();
          ctx.ellipse(cx, cy, 9.5, 5.2, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#38bdf8';
          ctx.beginPath();
          ctx.ellipse(cx, cy - 0.5, 8.0, 4.2, 0, 0, Math.PI * 2);
          ctx.fill();
          // Upper fountain tier & sparkling water plume
          ctx.fillStyle = '#e2e8f0';
          ctx.beginPath();
          ctx.ellipse(cx, cy - 4.2, 4.5, 2.4, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#7dd3fc';
          ctx.beginPath();
          ctx.ellipse(cx, cy - 4.5, 3.4, 1.8, 0, 0, Math.PI * 2);
          ctx.fill();
          drawLine64(ctx, cx, cy - 1.5, cx, cy - 10.5 - f, '#e0f2fe', 2.2);
          drawGlow64(ctx, cx, cy - 8, 6, 'rgba(186, 230, 253, 0.9)', 'rgba(56, 189, 248, 0)');
        } else if (v === 1) {
          // Var 2: Fonte quadrada de pedra com estátua clássica dourada
          drawPrism64(ctx, cx, cy + 1, 9.5, 3.5, {
            top: '#38bdf8',
            left: '#d6d3d1',
            right: '#a8a29e',
          });
          drawPrism64(ctx, cx, cy - 2, 3.2, 7.5, {
            top: '#e7e5e4',
            left: '#d6d3d1',
            right: '#78716c',
          });
          // Golden statue figure atop pedestal
          ctx.fillStyle = '#fbbf24';
          ctx.beginPath();
          ctx.arc(cx, cy - 12.5, 2.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillRect(cx - 1.4, cy - 11, 2.8, 4.5);
        } else {
          // Var 3: Coreto clássico com telhado terracota e flores sazonais
          drawPrism64(ctx, cx, cy + 1, 8.5, 3.5, {
            top: '#f5ebe0',
            left: '#d5bdaf',
            right: '#a98467',
          });
          for (const px of [-6, -2, 2, 6]) {
            drawLine64(ctx, cx + px, cy - 2, cx + px, cy - 10, '#f8fafc', 1.3);
          }
          // Pitched gazebo roof
          ctx.fillStyle = '#c85a32';
          ctx.beginPath();
          ctx.moveTo(cx - 10, cy - 10);
          ctx.lineTo(cx, cy - 17);
          ctx.lineTo(cx + 10, cy - 10);
          ctx.closePath();
          ctx.fill();
        }

        // Wooden park benches, warm lamp posts & lush trees at corners
        ctx.fillStyle = '#7c4a27';
        ctx.fillRect(cx - 13, cy + 3, 5, 2.2);
        ctx.fillRect(cx + 8, cy - 5, 5, 2.2);
        drawTree64(ctx, cx - 17, cy - 2, v === 2 ? 'blossom' : 'emerald', 0.92);
        drawTree64(ctx, cx + 17, cy - 2, 'lime', 0.92);
        drawTree64(ctx, cx, cy - 11, 'emerald', 0.85);
        drawTree64(ctx, cx, cy + 10, v === 1 ? 'blossom' : 'lime', 0.82);
        break;
      }

      // ----------------------------------------------------------------------
      // 2. POSTO DE SAÚDE (Aqua-green/white clinic, green health cross, parked ambulance)
      // ----------------------------------------------------------------------
      case 'health_clinic': {
        fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, '#9aa5b4');
        fillDiamond64(ctx, cx, cy, 29, 14.5, '#cbd5e1');

        // Front/side garden bed
        const gardenX = v === 1 ? cx + 12 : cx - 13;
        fillDiamond64(ctx, gardenX, cy + 5, 9, 4.5, '#52b788');

        const wallPal =
          v === 1
            ? { top: '#e2e8f0', topHi: '#ffffff', left: '#a7f3d0', right: '#6ee7b7' }
            : v === 2
              ? { top: '#2dd4bf', topHi: '#99f6e4', left: '#fef9c3', right: '#cbd5e1' }
              : { top: '#52b788', topHi: '#74c69d', left: '#f8fafc', right: '#cbd5e1' };

        drawPrism64(ctx, cx - 2, cy - 1, 16, 17, wallPal, {
          outlineColor: '#ffffff',
          castShadow: true,
          parapet: true,
        });

        // Turquoise clinic entrance canopy & glass doors
        ctx.fillStyle = '#0d9488';
        ctx.fillRect(cx - 13, cy - 5, 9, 2.5);
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(cx - 12, cy - 2.5, 7, 4.5);

        // Prominent green/red medical cross emblem on the front gable
        drawCrossEmblem64(
          ctx,
          cx - 8,
          cy - 12,
          3.4,
          v === 2 ? '#e11d48' : '#16a34a',
          '#ffffff'
        );

        // Ambulance parked on different sides per variation
        if (v === 0) {
          drawParkedMiniVehicle64(ctx, cx + 13, cy + 4, 'ambulance', false);
        } else if (v === 1) {
          drawParkedMiniVehicle64(ctx, cx - 12, cy + 5, 'ambulance', true);
        } else {
          drawParkedMiniVehicle64(ctx, cx + 11, cy + 5, 'ambulance', true);
        }
        break;
      }

      // ----------------------------------------------------------------------
      // 3. QUADRA POLIESPORTIVA (Orange basketball / Blue futsal / Green tennis + bleachers)
      // ----------------------------------------------------------------------
      case 'sports_court': {
        fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, '#8d99ae');
        const courtPal =
          v === 0
            ? { main: '#d97e4a', key: '#b53838' } // Basketball orange + crimson key (matches reference)
            : v === 1
              ? { main: '#2980b9', key: '#f39c12' } // Futsal blue + gold area
              : { main: '#2e8b57', key: '#52b788' }; // Tennis green

        fillDiamond64(ctx, cx, cy + 1, 27, 13.5, courtPal.main, '#ffffff', 1.2);
        // Inner painted keys / court zones
        fillDiamond64(ctx, cx - 12, cy + 1, 6, 3, courtPal.key, '#ffffff', 0.9);
        fillDiamond64(ctx, cx + 12, cy + 1, 6, 3, courtPal.key, '#ffffff', 0.9);
        // Center line & circle
        drawLine64(ctx, cx - 11, cy - 4.5, cx + 11, cy + 6.5, '#ffffff', 1.1);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.ellipse(cx, cy + 1, 4.2, 2.1, 0, 0, Math.PI * 2);
        ctx.stroke();

        // Perimeter chain-link fence posts along back edges
        for (let t = -24; t <= 24; t += 8) {
          drawLine64(ctx, cx + t, cy - 13 + Math.abs(t) * 0.48, cx + t, cy - 20 + Math.abs(t) * 0.48, '#64748b', 1.1);
        }

        if (v === 0) {
          // Basketball hoops at both ends
          drawLine64(ctx, cx - 20, cy + 1, cx - 20, cy - 8, '#e2e8f0', 1.5);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(cx - 22, cy - 10, 4, 3);
          drawLine64(ctx, cx + 20, cy + 1, cx + 20, cy - 8, '#e2e8f0', 1.5);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(cx + 18, cy - 10, 4, 3);
        } else if (v === 2) {
          // Tennis net across center
          drawLine64(ctx, cx - 12, cy - 6, cx + 12, cy + 6, '#f8fafc', 2.0);
        }

        // Side concrete bleachers (arquibancadas) on v === 0 and v === 1
        if (v !== 2) {
          drawPrism64(ctx, cx + 8, cy - 7, 11, 5.5, {
            top: '#e2e8f0',
            left: '#cbd5e1',
            right: '#94a3b8',
          });
          drawLine64(ctx, cx + 1, cy - 9, cx + 15, cy - 9, '#64748b', 1.1);
        }
        break;
      }

      // ----------------------------------------------------------------------
      // 4. ESCOLA MUNICIPAL (Rainbow or ceramic roof, courtyard playground, yellow school bus)
      // ----------------------------------------------------------------------
      case 'municipal_school': {
        fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, '#84a98c');
        // Fenced courtyard (pátio escolar)
        fillDiamond64(ctx, cx, cy + 2, 27, 13.5, '#cbd5e1', '#64748b', 1.0);

        // 2-story U/L-shaped warm yellow-cream school wings
        drawPrism64(
          ctx,
          cx - 5,
          cy - 3,
          17,
          18,
          {
            top: '#e9c46a',
            left: '#fae19c',
            leftBot: '#e9c46a',
            right: '#d4a359',
            rightBot: '#b5833d',
          },
          { castShadow: true }
        );
        drawWindows64(ctx, cx - 5, cy - 3, 17, 18, 2, 3, {
          litColor: '#fef08a',
          glassLeft: '#3b82f6',
          glassRight: '#1d4ed8',
          seed: v + 2,
        });

        // Pitched school roof: Rainbow stripes (v=0), Traditional terracotta (v=1), Sky-blue & gold (v=2)
        if (v === 0) {
          const rainbow = ['#ec4899', '#f97316', '#eab308', '#22c55e', '#3b82f6'];
          for (let r = 0; r < rainbow.length; r++) {
            ctx.fillStyle = rainbow[r];
            ctx.fillRect(cx - 20 + r * 6.5, cy - 25 + (r % 2), 6.8, 5.5);
          }
        } else if (v === 1) {
          fillDiamond64(ctx, cx - 5, cy - 22, 18, 9, '#c85a32', '#9a3412', 1.0);
        } else {
          fillDiamond64(ctx, cx - 5, cy - 22, 18, 9, '#0284c7', '#38bdf8', 1.0);
        }

        // Courtyard playground slide/swings or mini-court
        if (v === 1) {
          fillDiamond64(ctx, cx + 5, cy + 5, 8, 4, '#3b82f6', '#ffffff', 0.8);
        } else {
          // Colorful red/blue playground slide & climbing frame
          ctx.fillStyle = '#ef4444';
          ctx.fillRect(cx - 8, cy + 4, 4, 4);
          ctx.fillStyle = '#3b82f6';
          ctx.fillRect(cx - 3, cy + 5, 4, 3);
        }

        // Yellow school bus parked in front or side
        const busX = v === 1 ? cx - 13 : cx + 14;
        const busY = v === 1 ? cy + 7 : cy + 5;
        drawParkedMiniVehicle64(ctx, busX, busY, 'schoolbus', v === 1);
        drawTree64(ctx, cx + 17, cy - 3, 'emerald', 0.85);
        break;
      }

      // ----------------------------------------------------------------------
      // 5. BIBLIOTECA PÚBLICA (Classic brown brick / Beige stone / Modern + open-book roof emblem)
      // ----------------------------------------------------------------------
      case 'public_library': {
        fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, '#74a862');
        fillDiamond64(ctx, cx, cy, 28, 14, '#588157');

        const libPal =
          v === 0
            ? { top: '#7f4f24', topHi: '#936639', left: '#b07d4f', right: '#7f4f24' } // Classic brown brick (matches reference)
            : v === 1
              ? { top: '#4a5759', topHi: '#6b705c', left: '#edede9', right: '#d6ccc2' } // Beige classical stone
              : { top: '#1d3557', topHi: '#457b9d', left: '#e0fbfc', right: '#98c1d9' }; // Modern glass/concrete

        drawPrism64(ctx, cx, cy + 1, 21, 21, libPal, {
          outlineColor: '#f5ebe0',
          castShadow: true,
          parapet: true,
        });
        drawWindows64(ctx, cx, cy + 1, 21, 21, 2, 4, {
          litColor: '#fde68a',
          glassLeft: '#457b9d',
          glassRight: '#1d3557',
          seed: v + 4,
        });

        // Signature Open Book sculpture or Clock on the central roof gable (matches reference!)
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(cx - 6, cy - 26, 5.5, 6.5);
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(cx - 0.5, cy - 26, 5.5, 6.5);
        drawLine64(ctx, cx - 0.5, cy - 26, cx - 0.5, cy - 19.5, '#64748b', 1.2);
        if (v === 1) {
          // Golden facade clock
          ctx.fillStyle = '#fbbf24';
          ctx.beginPath();
          ctx.arc(cx, cy - 14, 2.6, 0, Math.PI * 2);
          ctx.fill();
        }

        // Reading garden benches & trees in front
        ctx.fillStyle = '#7c4a27';
        ctx.fillRect(cx - 10, cy + 7, 5, 2);
        drawTree64(ctx, cx - 18, cy + 3, 'emerald', 0.85);
        drawTree64(ctx, cx + 16, cy + 4, 'lime', 0.85);
        break;
      }

      // ----------------------------------------------------------------------
      // 6. DELEGACIA DE POLÍCIA (Blue/gray 2-story station, gold sheriff star, 2-4 police cruisers)
      // ----------------------------------------------------------------------
      case 'police_station': {
        fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, '#6c757d');
        fillDiamond64(ctx, cx, cy, 29.5, 14.8, '#adb5bd');

        const polPal =
          v === 1
            ? { top: '#64748b', topHi: '#94a3b8', left: '#94a3b8', right: '#475569' }
            : { top: '#4a78a8', topHi: '#739ecb', left: '#5b8cc0', right: '#355c87' };

        drawPrism64(ctx, cx - 2, cy, 21, 23, polPal, {
          outlineColor: '#e2e8f0',
          castShadow: true,
          parapet: true,
        });
        drawWindows64(ctx, cx - 2, cy, 21, 23, 2, 4, {
          litColor: '#bae6fd',
          glassLeft: '#1e3a8a',
          glassRight: '#172554',
          seed: v + 1,
        });

        // Central navy entrance projection with golden 6-point Sheriff Badge Star (matches top-left of reference!)
        drawPrism64(ctx, cx - 6, cy + 3, 7, 25, {
          top: '#1d3557',
          left: '#2b5082',
          right: '#172a45',
        });
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.arc(cx - 9, cy - 11, 3.6, 0, Math.PI * 2);
        ctx.fill();

        // Radio antenna or secondary rooftop helipad
        if (v === 1) {
          fillDiamond64(ctx, cx + 4, cy - 24, 6.5, 3.2, '#334155', '#facc15', 1.0);
        } else {
          drawLine64(ctx, cx + 6, cy - 24, cx + 6, cy - 37, '#cbd5e1', 1.5);
          drawGlow64(ctx, cx + 6, cy - 37, 4, 'rgba(59, 130, 246, 0.9)', 'rgba(59, 130, 246, 0)');
        }

        // 2 to 4 Parked Police Cruisers out front
        drawParkedMiniVehicle64(ctx, cx - 12, cy + 9, 'police', false);
        drawParkedMiniVehicle64(ctx, cx - 1, cy + 7, 'police', false);
        if (v !== 1) {
          drawParkedMiniVehicle64(ctx, cx + 10, cy + 4, 'police', false);
        }
        if (v === 2) {
          drawParkedMiniVehicle64(ctx, cx + 16, cy + 1, 'police', true);
        }
        break;
      }

      // ----------------------------------------------------------------------
      // 7. CORPO DE BOMBEIROS (Red brick station, 2-3 red garage bays, drill tower, fire trucks)
      // ----------------------------------------------------------------------
      case 'fire_station': {
        fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, '#6c757d');
        fillDiamond64(ctx, cx, cy, 29.5, 14.8, '#adb5bd');

        // Main 2-story red-brick firehouse with white cornice trim
        drawPrism64(
          ctx,
          cx - 3,
          cy,
          20,
          22,
          {
            top: '#ced4da',
            topHi: '#f8f9fa',
            left: '#c94242',
            leftBot: '#a83232',
            right: '#8f2828',
            rightBot: '#6e1d1d',
          },
          { outlineColor: '#ffffff', castShadow: true, parapet: true }
        );

        // 2 or 3 red roll-up apparatus garage doors along lower facade
        const bayCount = v === 1 ? 2 : 3;
        for (let b = 0; b < bayCount; b++) {
          const bx = cx - 18 + b * 6.2;
          const by = cy - 6 + b * 3.0;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(bx - 0.6, by - 0.6, 5.2, 7.2);
          ctx.fillStyle = '#ef4444';
          ctx.fillRect(bx, by, 4.0, 6.2);
        }

        // Tall Hose-Drying Training Tower on right (v=0,2) or left (v=1)
        const towerX = v === 1 ? cx - 17 : cx + 14;
        const towerY = v === 1 ? cy - 2 : cy - 1;
        drawPrism64(
          ctx,
          towerX,
          towerY,
          6.5,
          38,
          {
            top: '#343a40',
            left: '#b83333',
            right: '#7a1f1f',
          },
          { outlineColor: '#f8f9fa', castShadow: true }
        );

        // Parked red fire engines on apron
        drawParkedMiniVehicle64(ctx, cx - 13, cy + 7, 'firetruck', false);
        if (v === 0) {
          drawParkedMiniVehicle64(ctx, cx + 3, cy + 9, 'firetruck', false);
        } else if (v === 2) {
          drawParkedMiniVehicle64(ctx, cx + 8, cy + 6, 'firetruck', true);
        }
        break;
      }

      // ----------------------------------------------------------------------
      // 8. CINEMA RETRÔ (Dark Art Deco hall, stepped neon fin, glowing CINEMA RETRO marquee)
      // ----------------------------------------------------------------------
      case 'retro_cinema': {
        fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, '#495057');
        fillDiamond64(ctx, cx, cy, 29, 14.5, '#6c757d');

        // Dark charcoal Art Deco theater box
        drawPrism64(
          ctx,
          cx,
          cy + 2,
          21,
          25,
          {
            top: '#343a40',
            topHi: '#495057',
            left: '#495057',
            leftBot: '#343a40',
            right: '#212529',
            rightBot: '#16191d',
          },
          { outlineColor: '#adb5bd', castShadow: true, parapet: true }
        );

        const neonPal =
          v === 0
            ? { main: '#ef4444', trim: '#fbbf24', glow: 'rgba(239, 68, 68, 0.85)' } // Red & Gold (matches reference!)
            : v === 1
              ? { main: '#06b6d4', trim: '#ec4899', glow: 'rgba(6, 182, 212, 0.85)' } // Cyan & Pink
              : { main: '#a855f7', trim: '#f59e0b', glow: 'rgba(168, 85, 247, 0.85)' }; // Purple & Amber

        // Stepped vertical Art Deco neon fin above the marquee
        drawPrism64(ctx, cx + 6, cy - 19, 5.5, 14, {
          top: neonPal.trim,
          left: neonPal.main,
          right: '#7f1d1d',
        });

        // Glowing "CINEMA RETRO" Marquee on right-front entrance face
        ctx.fillStyle = neonPal.trim;
        ctx.fillRect(cx - 1, cy - 16, 19, 8);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(cx + 0.5, cy - 14.5, 16, 5);
        ctx.fillStyle = neonPal.main;
        ctx.fillRect(cx + 2, cy - 13, 13, 2.2);
        drawGlow64(ctx, cx + 8, cy - 12, 11, neonPal.glow, 'rgba(255, 200, 100, 0)');

        // Colorful framed vintage movie posters on the left wall
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(cx - 16, cy - 11, 5.5, 7.5);
        ctx.fillStyle = '#ec4899';
        ctx.fillRect(cx - 15, cy - 10, 3.5, 5.5);

        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(cx - 8, cy - 7, 5.5, 7.5);
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(cx - 7, cy - 6, 3.5, 5.5);
        break;
      }

      // ----------------------------------------------------------------------
      // 9. MERCADO MUNICIPAL (Long basilica hall, teal/green/terracota roof, striped street stalls)
      // ----------------------------------------------------------------------
      case 'municipal_market': {
        fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, '#8d99ae');
        fillDiamond64(ctx, cx, cy, 29.5, 14.8, '#cbd5e1');

        const roofCol =
          v === 0
            ? { top: '#2c5d72', hi: '#468199' } // Teal-blue steel roof (matches reference!)
            : v === 1
              ? { top: '#2d5a40', hi: '#407a57' } // Dark green roof
              : { top: '#a84a32', hi: '#c85a32' }; // Terracotta roof

        // Grand sandstone market hall with arched windows
        drawPrism64(
          ctx,
          cx - 1,
          cy,
          22,
          21,
          {
            top: roofCol.top,
            topHi: roofCol.hi,
            left: '#e6d5b8',
            leftBot: '#cbb592',
            right: '#bfa680',
            rightBot: '#9c8460',
          },
          { outlineColor: '#f5ebe0', castShadow: true }
        );

        // Elevated clerestory roof ridge along the center
        drawPrism64(ctx, cx - 1, cy - 20, 14, 5.5, {
          top: roofCol.hi,
          left: roofCol.top,
          right: '#1e3a4a',
        });

        // Tall arched cathedral-style windows & central portal
        for (let w = 0; w < 3; w++) {
          const wx = cx - 17 + w * 5.2;
          const wy = cy - 11 + w * 2.5;
          ctx.fillStyle = '#334155';
          ctx.fillRect(wx, wy, 3.4, 7.5);
        }
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(cx + 5, cy - 9, 6.5, 9.5);

        // Outdoor street market stalls with striped awnings along the sidewalk!
        const stallColors =
          v === 0
            ? ['#f97316', '#22c55e']
            : v === 1
              ? ['#ef4444', '#3b82f6']
              : ['#a855f7', '#eab308'];
        for (let s = 0; s < 2; s++) {
          const sx = cx + 1 + s * 10;
          const sy = cy + 6 - s * 4.5;
          ctx.fillStyle = '#9c6644';
          ctx.fillRect(sx, sy, 7.5, 3.5);
          ctx.fillStyle = stallColors[s];
          ctx.fillRect(sx - 0.5, sy - 3.5, 8.5, 2.8);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(sx + 2, sy - 3.5, 2.2, 2.8);
        }
        break;
      }

      // ----------------------------------------------------------------------
      // 10. HOTEL COM PISCINA NO TERRAÇO (Tall hotel tower, HOTEL sign, cyan pool & parasols)
      // ----------------------------------------------------------------------
      case 'rooftop_hotel': {
        fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, '#94a3b8');
        fillDiamond64(ctx, cx, cy, 29, 14.5, '#cbd5e1');

        const towerPal =
          v === 0
            ? { top: '#d6c29f', topHi: '#efe2c8', left: '#e8d7b9', right: '#baa37e' } // Warm beige (matches reference!)
            : v === 1
              ? { top: '#e2e8f0', topHi: '#ffffff', left: '#f8fafc', right: '#94a3b8' } // Crisp white tower
              : { top: '#38bdf8', topHi: '#bae6fd', left: '#60a5fa', right: '#1d4ed8' }; // Sapphire glass tower

        // 1. Mid-level sun-terrace podium with glowing cyan swimming pool & yellow parasols (matches reference!)
        drawPrism64(ctx, cx - 7, cy + 4, 15, 13, towerPal, {
          outlineColor: '#ffffff',
          castShadow: true,
        });
        fillDiamond64(ctx, cx - 7, cy - 9, 11.5, 5.8, '#38bdf8', '#e0f2fe', 1.2);
        // Yellow pool parasols & sun loungers
        ctx.fillStyle = '#facc15';
        ctx.beginPath();
        ctx.arc(cx - 14, cy - 11, 2.4, 0, Math.PI * 2);
        ctx.arc(cx - 2, cy - 5, 2.4, 0, Math.PI * 2);
        ctx.fill();

        // 2. Tall multi-story hotel tower rising behind/beside the pool terrace
        const towerH = 54;
        drawPrism64(ctx, cx + 6, cy - 2, 13.5, towerH, towerPal, {
          rimColor: '#ffffff',
          outlineColor: '#f8fafc',
          castShadow: true,
          parapet: true,
        });
        drawWindows64(ctx, cx + 6, cy - 2, 13.5, towerH, 7, 3, {
          litColor: '#fef08a',
          glassLeft: '#334155',
          glassRight: '#1e293b',
          seed: v + 9,
        });

        // Optional upper rooftop pool on v === 1
        if (v === 1) {
          fillDiamond64(ctx, cx + 6, cy - 2 - towerH, 9, 4.5, '#06b6d4', '#ffffff', 1.0);
        }

        // Bold "HOTEL" rooftop signboard
        const signCol = v === 0 ? '#f59e0b' : v === 1 ? '#ef4444' : '#22d3ee';
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(cx - 4, cy - towerH - 13, 16, 6.5);
        ctx.fillStyle = signCol;
        ctx.fillRect(cx - 2.5, cy - towerH - 11.5, 13, 3.5);
        drawGlow64(ctx, cx + 4, cy - towerH - 10, 9, 'rgba(251, 191, 36, 0.75)', 'rgba(251, 191, 36, 0)');
        break;
      }

      // ----------------------------------------------------------------------
      // 11. HOSPITAL GERAL (Multi-story white L/H tower, red cross, rooftop helipad + helicopter, ambulances)
      // ----------------------------------------------------------------------
      case 'general_hospital': {
        fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, '#94a3b8');
        fillDiamond64(ctx, cx, cy, 29.5, 14.8, '#cbd5e1');

        const hospH = 48;
        // Main white hospital tower with blue reflective glass curtain bands
        drawPrism64(
          ctx,
          cx + 1,
          cy + 1,
          21,
          hospH,
          {
            top: '#e2e8f0',
            topHi: '#ffffff',
            left: '#f8fafc',
            leftBot: '#e2e8f0',
            right: '#cbd5e1',
            rightBot: '#94a3b8',
          },
          { rimColor: '#ffffff', outlineColor: '#ffffff', castShadow: true, parapet: true }
        );
        drawWindows64(ctx, cx + 1, cy + 1, 21, hospH - 6, 6, 4, {
          litColor: '#e0f2fe',
          glassLeft: '#38bdf8',
          glassRight: '#0284c7',
          seed: v + 5,
          curtainWall: true,
        });

        // Emergency room ground canopy
        drawPrism64(ctx, cx - 10, cy + 5, 8.5, 8, {
          top: '#e2e8f0',
          left: '#f8fafc',
          right: '#94a3b8',
        });

        // Large Iconic Red Cross on the upper left facade AND rooftop helipad (matches reference!)
        drawCrossEmblem64(ctx, cx - 10, cy - hospH + 11, 4.8, '#ef4444', '#ffffff');
        fillDiamond64(ctx, cx - 3, cy - hospH, 8.5, 4.2, '#ffffff', '#ef4444', 1.2);
        drawCrossEmblem64(ctx, cx - 3, cy - hospH, 3.5, '#ef4444');

        // Rescue Helicopter landed on the roof on v === 0 and v === 2
        if (v !== 1) {
          const hx = cx + 8;
          const hy = cy - hospH - 2;
          ctx.fillStyle = v === 0 ? '#ef4444' : '#0284c7';
          ctx.beginPath();
          ctx.ellipse(hx, hy, 5.2, 2.8, -0.2, 0, Math.PI * 2);
          ctx.fill();
          drawLine64(ctx, hx, hy, hx + 8, hy - 3, '#ef4444', 1.6);
          drawLine64(ctx, hx - 7, hy - 4, hx + 7, hy - 4, '#1e293b', 1.2);
          drawLine64(ctx, hx - 2, hy - 7, hx + 2, hy - 1, '#1e293b', 1.2);
        }

        // Parked ambulances at emergency entrances
        drawParkedMiniVehicle64(ctx, cx - 16, cy + 7, 'ambulance', false);
        drawParkedMiniVehicle64(ctx, cx + 5, cy + 10, 'ambulance', true);
        break;
      }

      // ----------------------------------------------------------------------
      // 12. TEATRO MUNICIPAL (Art Deco beige / Neoclassical / Ornate dome + vertical stage banners)
      // ----------------------------------------------------------------------
      case 'municipal_theater': {
        fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, '#94a3b8');
        fillDiamond64(ctx, cx, cy, 29, 14.5, '#d6ccc2');

        const thPal =
          v === 0
            ? { top: '#7f5539', topHi: '#9c6644', left: '#ede0d4', right: '#ddb892' } // Art Deco beige + bronze barrel roof (matches reference!)
            : v === 1
              ? { top: '#6b705c', topHi: '#a5a58d', left: '#fefae0', right: '#e9edc9' }
              : { top: '#b08968', topHi: '#e6ccb2', left: '#f5ebe0', right: '#d5bdaf' };

        drawPrism64(ctx, cx + 1, cy + 1, 21, 27, thPal, {
          outlineColor: '#fff8f0',
          castShadow: true,
          parapet: true,
        });

        // Vaulted auditorium barrel roof or golden dome
        ctx.fillStyle = v === 2 ? '#d97706' : '#7f5539';
        ctx.beginPath();
        ctx.ellipse(cx + 2, cy - 26, 13, 6.5, -0.25, Math.PI, 0);
        ctx.fill();

        // Stepped Art Deco vertical central facade tower
        drawPrism64(ctx, cx - 8, cy + 3, 8.5, 33, {
          top: '#ede0d4',
          left: '#f5ebe0',
          right: '#d5bdaf',
        });

        // Grand entrance stone staircase
        ctx.fillStyle = '#e7e5e4';
        ctx.beginPath();
        ctx.moveTo(cx - 19, cy + 3);
        ctx.lineTo(cx - 9, cy + 8);
        ctx.lineTo(cx - 4, cy + 4);
        ctx.lineTo(cx - 14, cy - 1);
        ctx.closePath();
        ctx.fill();

        // Colorful vertical theater banners on the facade (purple/magenta/gold — matches reference!)
        const bannerA = v === 0 ? '#9333ea' : v === 1 ? '#2563eb' : '#e11d48';
        const bannerB = v === 0 ? '#ec4899' : v === 1 ? '#f59e0b' : '#10b981';
        ctx.fillStyle = bannerA;
        ctx.fillRect(cx - 15, cy - 15, 9, 5.5);
        ctx.fillStyle = bannerB;
        ctx.fillRect(cx - 2, cy - 12, 3.8, 9.5);
        break;
      }

      // ----------------------------------------------------------------------
      // 13. JARDIM BOTÂNICO (Barrel-vaulted cylindrical glass greenhouse + vibrant flowerbeds)
      // ----------------------------------------------------------------------
      case 'botanical_garden': {
        fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, '#52b788');
        fillDiamond64(ctx, cx, cy, 29.5, 14.8, '#40916c');

        // Lush indoor palms visible inside the glass conservatory
        drawTree64(ctx, cx - 8, cy - 7, 'emerald', 0.9);
        drawTree64(ctx, cx - 1, cy - 4, 'lime', 0.9);
        drawTree64(ctx, cx + 6, cy - 8, 'emerald', 0.85);

        if (v === 1) {
          // Variation 2: Central geodesic glass dome conservatory with side glass wings
          ctx.fillStyle = 'rgba(165, 243, 252, 0.72)';
          ctx.beginPath();
          ctx.arc(cx - 2, cy - 8, 15, Math.PI, 0);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.2;
          ctx.stroke();
        } else {
          // Variation 1 & 3: Long cylindrical vaulted glass greenhouse with white steel ribs (matches reference!)
          ctx.save();
          ctx.fillStyle = 'rgba(186, 230, 253, 0.68)';
          ctx.beginPath();
          ctx.moveTo(cx - 22, cy - 3);
          ctx.quadraticCurveTo(cx - 12, cy - 28, cx + 2, cy - 15);
          ctx.lineTo(cx + 15, cy - 6);
          ctx.quadraticCurveTo(cx + 4, cy + 4, cx - 22, cy - 3);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.3;
          ctx.stroke();
          // Curved white steel conservatory ribs
          for (let r = 0; r < 5; r++) {
            const rx = cx - 18 + r * 6;
            const ry = cy - 2 + r * 2.2;
            ctx.beginPath();
            ctx.arc(rx + 4, ry - 4, 9.5, Math.PI * 0.95, Math.PI * 1.95);
            ctx.stroke();
          }
          ctx.restore();
        }

        // Colorful striped rectangular flowerbeds in the front plaza (red, gold, purple, orange — matches reference!)
        const beds = ['#ef4444', '#facc15', '#a855f7', '#f97316', '#ec4899', '#38bdf8'];
        for (let b = 0; b < 4; b++) {
          const bx = cx - 8 + b * 5.8;
          const by = cy + 6 - b * 2.2;
          fillDiamond64(ctx, bx, by, 4.2, 2.2, beds[(b + v) % beds.length], '#d6d3d1', 0.7);
        }
        break;
      }

      // ----------------------------------------------------------------------
      // 14. MUSEU DE ARTE MODERNA (Asymmetric white angular blocks + colorful abstract sculptures)
      // ----------------------------------------------------------------------
      case 'modern_art_museum': {
        fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, '#74c69d');
        fillDiamond64(ctx, cx, cy, 29, 14.5, '#52b788');

        // Base gallery podium
        drawPrism64(
          ctx,
          cx - 4,
          cy + 1,
          17,
          15,
          {
            top: '#ffffff',
            topHi: '#ffffff',
            left: '#f8fafc',
            right: '#cbd5e1',
          },
          { outlineColor: '#e2e8f0', castShadow: true }
        );

        // Large panoramic dark-blue glass gallery window on left wing (matches reference!)
        ctx.fillStyle = '#1e3a8a';
        ctx.beginPath();
        ctx.moveTo(cx - 19, cy - 10);
        ctx.lineTo(cx - 6, cy - 3.5);
        ctx.lineTo(cx - 6, cy + 3.5);
        ctx.lineTo(cx - 19, cy - 3);
        ctx.closePath();
        ctx.fill();

        // Deconstructivist white angular cantilevered shards jutting upward
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(cx - 6, cy + 2);
        ctx.lineTo(cx + 2, cy - 26);
        ctx.lineTo(cx + 13, cy - 14);
        ctx.lineTo(cx + 4, cy + 4);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 1.0;
        ctx.stroke();

        // Colorful abstract outdoor sculptures in the sculpture courtyard
        // Sculpture 1: Green/red cactus/totem in front
        ctx.fillStyle = '#22c55e';
        ctx.fillRect(cx - 6, cy + 6, 2.8, 6.5);
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(cx - 3, cy + 9, 2.2, 0, Math.PI * 2);
        ctx.fill();
        // Sculpture 2: Tall blue/orange Flame/Spiral sculpture at back-right
        ctx.fillStyle = v === 1 ? '#ec4899' : '#f97316';
        ctx.beginPath();
        ctx.moveTo(cx + 15, cy - 2);
        ctx.lineTo(cx + 18, cy - 14);
        ctx.lineTo(cx + 21, cy - 2);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#3b82f6';
        ctx.beginPath();
        ctx.arc(cx + 17, cy - 8, 2.4, 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      // ----------------------------------------------------------------------
      // 15. PLANETÁRIO MUNICIPAL (White/silver/blue hemisphere dome + outdoor solar system planets & telescope)
      // ----------------------------------------------------------------------
      case 'municipal_planetarium': {
        fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, '#6c757d');
        fillDiamond64(ctx, cx, cy, 29.5, 14.8, '#495057');

        // Circular futuristic base ring
        drawPrism64(
          ctx,
          cx + 4,
          cy,
          16,
          9,
          {
            top: '#1d3557',
            left: '#e2e8f0',
            right: '#94a3b8',
          },
          { castShadow: true }
        );

        // Large Hemisphere Planetarium Dome (smooth white v=0, faceted light-blue v=1, silver v=2)
        const domeGrad = ctx.createRadialGradient(cx, cy - 18, 2, cx + 4, cy - 10, 17);
        if (v === 1) {
          domeGrad.addColorStop(0, '#e0f2fe');
          domeGrad.addColorStop(1, '#38bdf8');
        } else if (v === 2) {
          domeGrad.addColorStop(0, '#ffffff');
          domeGrad.addColorStop(1, '#94a3b8');
        } else {
          domeGrad.addColorStop(0, '#ffffff');
          domeGrad.addColorStop(1, '#cbd5e1');
        }
        ctx.fillStyle = domeGrad;
        ctx.beginPath();
        ctx.arc(cx + 4, cy - 7, 15.5, Math.PI, 0);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 1.1;
        ctx.stroke();

        // Outdoor Solar System Planet Models on pedestals (Saturn with ring, striped Jupiter, Mars, Earth — matches reference!)
        // Saturn with ring
        drawLine64(ctx, cx - 18, cy + 2, cx - 18, cy - 6, '#94a3b8', 1.2);
        ctx.strokeStyle = '#fde68a';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.ellipse(cx - 18, cy - 8, 6.2, 2.2, -0.3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#eab308';
        ctx.beginPath();
        ctx.arc(cx - 18, cy - 8, 3.4, 0, Math.PI * 2);
        ctx.fill();

        // Jupiter
        drawLine64(ctx, cx - 10, cy - 3, cx - 10, cy - 11, '#94a3b8', 1.2);
        ctx.fillStyle = '#f97316';
        ctx.beginPath();
        ctx.arc(cx - 10, cy - 13, 3.8, 0, Math.PI * 2);
        ctx.fill();

        // Earth / Mars & Outdoor Telescope on tripod in front
        drawLine64(ctx, cx - 4, cy + 10, cx - 2, cy + 4, '#cbd5e1', 1.4);
        drawLine64(ctx, cx - 5, cy + 3, cx + 1, cy + 6, '#f8fafc', 2.2);
        break;
      }

      // ----------------------------------------------------------------------
      // 16. TRIBUNAL DE JUSTIÇA (Classical temple with columns, slate-blue pediment roof, grand steps & statues)
      // ----------------------------------------------------------------------
      case 'court_of_justice': {
        fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, '#84a98c');
        fillDiamond64(ctx, cx, cy, 29, 14.5, '#cbd5e1');

        const roofColor = v === 1 ? '#5c6470' : v === 2 ? '#3d7068' : '#4a7c9b';

        // Classical sandstone main hall
        drawPrism64(
          ctx,
          cx + 2,
          cy,
          20,
          23,
          {
            top: roofColor,
            topHi: '#6b9ac4',
            left: '#e6ccb2',
            leftBot: '#ddb892',
            right: '#b08968',
            rightBot: '#9c6644',
          },
          { outlineColor: '#f5ebe0', castShadow: true }
        );

        // 4 Classical Fluted Columns along the front portico
        for (let c = 0; c < 4; c++) {
          const colX = cx - 14 + c * 4.4;
          const colY = cy - 4 + c * 2.2;
          ctx.fillStyle = '#f5ebe0';
          ctx.fillRect(colX, colY - 14, 2.4, 14);
        }

        // Triangular Classical Pediment (Frontão)
        ctx.fillStyle = '#ede0d4';
        ctx.beginPath();
        ctx.moveTo(cx - 17, cy - 18);
        ctx.lineTo(cx - 6, cy - 26);
        ctx.lineTo(cx + 4, cy - 11);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = roofColor;
        ctx.lineWidth = 1.4;
        ctx.stroke();

        // Grand stone entrance staircase & twin Lady Justice pedestal statues (matches top-right of reference!)
        ctx.fillStyle = '#d6d3d1';
        ctx.fillRect(cx - 21, cy - 3, 5, 8);
        ctx.fillRect(cx - 3, cy + 5, 5, 8);
        ctx.fillStyle = '#e7e5e4';
        ctx.beginPath();
        ctx.arc(cx - 18.5, cy - 6, 2.2, 0, Math.PI * 2);
        ctx.arc(cx - 0.5, cy + 2, 2.2, 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      // ----------------------------------------------------------------------
      // 17. UNIVERSIDADE TECNOLÓGICA (Mirrored blue glass wings, rooftop solar panels, satellite dish & plaza)
      // ----------------------------------------------------------------------
      case 'tech_university': {
        fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, '#94a3b8');
        // Bustling student courtyard plaza
        fillDiamond64(ctx, cx, cy + 1, 29.5, 14.8, '#cbd5e1');

        // Multi-wing modern glass & aluminum tech building
        drawPrism64(
          ctx,
          cx - 2,
          cy - 2,
          21,
          22,
          {
            top: '#dbeafe',
            topHi: '#ffffff',
            left: '#bfdbfe',
            leftBot: '#93c5fd',
            right: '#60a5fa',
            rightBot: '#3b82f6',
          },
          { rimColor: '#ffffff', outlineColor: '#eff6ff', castShadow: true, parapet: true }
        );
        drawWindows64(ctx, cx - 2, cy - 2, 21, 22, 3, 4, {
          litColor: '#e0f2fe',
          glassLeft: '#0284c7',
          glassRight: '#0369a1',
          seed: v + 6,
          curtainWall: true,
        });

        // Photovoltaic Blue Solar Panel Arrays on the roof (matches reference!)
        fillDiamond64(ctx, cx - 8, cy - 24, 6.5, 3.2, '#1e3a8a', '#93c5fd', 0.9);
        fillDiamond64(ctx, cx + 5, cy - 22, 6.5, 3.2, '#1e3a8a', '#93c5fd', 0.9);

        // White Parabolic Satellite Dish & Lattice Research Tower
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(cx - 16, cy - 24, 4.2, 2.6, -0.4, 0, Math.PI * 2);
        ctx.fill();
        drawLine64(ctx, cx, cy - 26, cx, cy - 39, '#64748b', 1.8);
        drawGlow64(ctx, cx, cy - 40, 4.5, 'rgba(56, 189, 248, 0.9)', 'rgba(56, 189, 248, 0)');

        // Tiny student figures in the front courtyard
        const studentCols = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6'];
        for (let s = 0; s < 4; s++) {
          ctx.fillStyle = studentCols[s];
          ctx.fillRect(cx - 8 + s * 5, cy + 5 + (s % 2) * 2, 2.0, 3.2);
        }
        break;
      }

      // ----------------------------------------------------------------------
      // 18. MARINA NA BEIRA DO RIO (Wooden boardwalk & piers over river water + yachts, speedboats, sailboats)
      // ----------------------------------------------------------------------
      case 'river_marina': {
        // Sparkling river water base & shoreline boardwalk
        const waterGrad = ctx.createLinearGradient(cx - 32, cy - 16, cx + 32, cy + 16);
        waterGrad.addColorStop(0, '#2b8cbe');
        waterGrad.addColorStop(1, '#165a8a');
        fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, waterGrad);

        const woodMain = v === 1 ? '#6f4e37' : '#a47148';
        const woodTrim = v === 1 ? '#4a3323' : '#7f5539';

        // Shoreline timber promenade deck along the upper-right bank
        ctx.fillStyle = woodMain;
        ctx.beginPath();
        ctx.moveTo(cx - 10, cy - 14);
        ctx.lineTo(cx + 28, cy + 4);
        ctx.lineTo(cx + 18, cy + 9);
        ctx.lineTo(cx - 20, cy - 9);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = woodTrim;
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Two wooden finger piers extending into the river channel
        drawLine64(ctx, cx - 8, cy - 4, cx - 20, cy + 3, woodMain, 4.2);
        drawLine64(ctx, cx + 8, cy + 3, cx - 4, cy + 10, woodMain, 4.2);

        // Moored watercraft variations (white yachts, sport speedboats, sailboats — matches bottom of reference!)
        if (v === 0) {
          drawMooredMarinaBoat64(ctx, cx - 15, cy - 1, 'yacht');
          drawMooredMarinaBoat64(ctx, cx - 4, cy + 4, 'speedboat', '#ef4444');
          drawMooredMarinaBoat64(ctx, cx + 8, cy + 9, 'yacht');
        } else if (v === 1) {
          drawMooredMarinaBoat64(ctx, cx - 15, cy - 1, 'sailboat');
          drawMooredMarinaBoat64(ctx, cx - 3, cy + 5, 'sailboat');
          drawMooredMarinaBoat64(ctx, cx + 8, cy + 9, 'speedboat', '#f59e0b');
        } else {
          drawMooredMarinaBoat64(ctx, cx - 14, cy - 1, 'yacht');
          drawMooredMarinaBoat64(ctx, cx - 2, cy + 5, 'sailboat');
          drawMooredMarinaBoat64(ctx, cx + 9, cy + 9, 'speedboat', '#38bdf8');
        }
        break;
      }

      // ----------------------------------------------------------------------
      // 19. PARQUE DE DIVERSÕES (Ferris wheel, carousel, roller coaster & striped circus tents)
      // ----------------------------------------------------------------------
      case 'amusement_park': {
        fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, '#8d99ae');
        fillDiamond64(ctx, cx, cy, 29.5, 14.8, '#e9d8a6');

        const wheelX = v === 1 ? cx + 12 : cx - 13;
        const coasterX = v === 1 ? cx - 11 : cx + 12;

        // 1. Giant Colorful Ferris Wheel (Roda-Gigante)
        drawLine64(ctx, wheelX - 5, cy + 1, wheelX, cy - 14, '#64748b', 1.8);
        drawLine64(ctx, wheelX + 5, cy + 1, wheelX, cy - 14, '#64748b', 1.8);
        ctx.strokeStyle = v === 1 ? '#06b6d4' : '#ec4899';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(wheelX, cy - 15, 11, 0, Math.PI * 2);
        ctx.stroke();
        const gondolaCols = ['#ef4444', '#facc15', '#3b82f6', '#22c55e', '#a855f7', '#f97316'];
        for (let g = 0; g < 8; g++) {
          const ang = (g / 8) * Math.PI * 2 + f * 0.25;
          const gx = wheelX + Math.cos(ang) * 11;
          const gy = cy - 15 + Math.sin(ang) * 11;
          ctx.fillStyle = gondolaCols[g % gondolaCols.length];
          ctx.fillRect(gx - 1.6, gy - 1.6, 3.2, 3.2);
        }

        // 2. Looping Roller Coaster Track (Montanha-Russa)
        ctx.strokeStyle = v === 1 ? '#2563eb' : '#dc2626';
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.moveTo(coasterX - 9, cy + 3);
        ctx.quadraticCurveTo(coasterX - 2, cy - 14, coasterX + 4, cy - 1);
        ctx.quadraticCurveTo(coasterX + 9, cy - 10, coasterX + 12, cy + 4);
        ctx.stroke();

        // 3. Classic Red & Yellow Carousel (Carrossel) & Pink/Purple Circus Tent
        ctx.fillStyle = '#fde68a';
        ctx.fillRect(cx - 4, cy - 6, 8, 5);
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.moveTo(cx - 6, cy - 6);
        ctx.lineTo(cx, cy - 12);
        ctx.lineTo(cx + 6, cy - 6);
        ctx.closePath();
        ctx.fill();

        // Striped Circus Tent in foreground
        ctx.fillStyle = v === 2 ? '#3b82f6' : '#ec4899';
        ctx.beginPath();
        ctx.moveTo(cx - 11, cy + 9);
        ctx.lineTo(cx - 5, cy + 1);
        ctx.lineTo(cx + 1, cy + 9);
        ctx.closePath();
        ctx.fill();
        break;
      }

      // ----------------------------------------------------------------------
      // 20. ESTÁDIO DE FUTEBOL (Stepped concentric bleachers & stairways around pitch)
      // ----------------------------------------------------------------------
      case 'soccer_stadium': {
        fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, '#9aa5b5');
        drawSteppedBleacherStadium64(ctx, cx, cy + 2, 0.88, 0.88, 17, v, false);
        break;
      }
    }
  });
}

// ============================================================================
// Tile Sprite Lookup & Offscreen 64-Bit World Cache
// ============================================================================

function getRawRoadMask(state: CityState, tx: number, ty: number): number {
  let mask = 0;
  const n = getTile(state, tx, ty - 1);
  const e = getTile(state, tx + 1, ty);
  const s = getTile(state, tx, ty + 1);
  const w = getTile(state, tx - 1, ty);
  if (n && isRoadLike(n.type)) mask |= 1;
  if (e && isRoadLike(e.type)) mask |= 2;
  if (s && isRoadLike(s.type)) mask |= 4;
  if (w && isRoadLike(w.type)) mask |= 8;
  return mask;
}

function getWaterBankMask(
  state: CityState,
  rx: number,
  ry: number,
  rotation: CameraRotation
): number {
  let mask = 0;
  const nCoord = unrotateGridCoord(rx, ry - 1, rotation, state.gridWidth, state.gridHeight);
  const wCoord = unrotateGridCoord(rx - 1, ry, rotation, state.gridWidth, state.gridHeight);
  const nt = getTile(state, nCoord.tx, nCoord.ty);
  const wt = getTile(state, wCoord.tx, wCoord.ty);
  if (nt && nt.type !== 'water' && nt.type !== 'bridge') mask |= 1;
  if (wt && wt.type !== 'water' && wt.type !== 'bridge') mask |= 2;
  return mask;
}

function getTileSprite(
  state: CityState,
  tile: Tile,
  rx: number,
  ry: number,
  rotation: CameraRotation,
  animFrame: number,
  season: SeasonId = 'summer'
): CachedSprite {
  const lotW = tile.lotWidth ?? 1;
  const lotH = tile.lotHeight ?? 1;
  const lotDx = tile.lotDx ?? 0;
  const lotDy = tile.lotDy ?? 0;
  const anchorXCoord = tile.x - lotDx;
  const anchorYCoord = tile.y - lotDy;
  const coordSeed = hashCoord(tile.x, tile.y, tile.variant);
  const lotSeed = hashCoord(anchorXCoord, anchorYCoord, tile.variant);

  if (tile.establishmentId) {
    return getEstablishmentSprite(
      tile.establishmentId,
      tile.variant,
      animFrame,
      lotW,
      lotH,
      lotDx,
      lotDy,
      rotation
    );
  }

  switch (tile.type) {
    case 'grass':
      return getGrassSprite(coordSeed, season);
    case 'forest':
      return getForestSprite(coordSeed, season);
    case 'water':
      return getWaterSprite(animFrame, getWaterBankMask(state, rx, ry, rotation), season);
    case 'road': {
      const rotMask = rotateRoadMask(getRawRoadMask(state, tile.x, tile.y), rotation);
      return getRoadSprite(rotMask, tile.level || 1, tile.variant || 0, coordSeed % 6);
    }
    case 'bridge': {
      const rotMask = rotateRoadMask(getRawRoadMask(state, tile.x, tile.y), rotation);
      const topo = getBridgeRenderTopology(state, tile, rotation);
      return getBridgeSprite(
        rotMask,
        tile.level || 1,
        tile.variant || 0,
        topo.isCenterSpan,
        animFrame,
        topo.twinSide,
        topo.screenAxis
      );
    }
    case 'rural':
      return getRuralSprite(tile.level || 1, tile.variant, lotDx, lotDy, lotSeed);
    case 'residential': {
      const wealthTier: 0 | 1 | 2 =
        tile.landValue >= 62 ? 2 : tile.landValue >= 38 ? 1 : 0;
      return getResidentialSprite(
        tile.level,
        tile.variant,
        wealthTier,
        lotW,
        lotH,
        lotDx,
        lotDy,
        lotSeed,
        rotation,
        hasSkyscraperHelipad(tile),
        anchorXCoord,
        anchorYCoord
      );
    }
    case 'commercial':
      return getCommercialSprite(
        tile.level,
        tile.variant,
        lotW,
        lotH,
        lotDx,
        lotDy,
        lotSeed,
        rotation,
        hasSkyscraperHelipad(tile),
        anchorXCoord,
        anchorYCoord
      );
    case 'industrial':
      return getIndustrialSprite(tile.level || 1, tile.variant, lotW, lotH, lotDx, lotDy, lotSeed);
    case 'park':
      return getParkSprite(tile.variant, animFrame, coordSeed, season);
    case 'abandoned':
      return getAbandonedSprite(tile.variant, coordSeed);
    case 'port':
      return getPortSprite(
        tile.level || 1,
        tile.variant,
        lotW,
        lotH,
        lotDx,
        lotDy,
        rotation,
        getPortWaterEdgeMask(state, tile, rotation)
      );
    case 'stadium':
      return getEstablishmentSprite(
        'soccer_stadium',
        tile.variant,
        animFrame,
        lotW,
        lotH,
        lotDx,
        lotDy,
        rotation
      );
    case 'airport':
      return getAirportSprite(tile.level || 1, tile.variant, lotW, lotH, lotDx, lotDy);
    case 'bus_station':
      return getBusStationSprite(tile.level || 1, tile.variant || 0);
    case 'metro_station':
      return getMetroStationSprite(tile.level || 1, tile.variant || 0);
    case 'shopping':
      return getShoppingMallSprite(tile.level || 1, tile.variant, lotW, lotH, lotDx, lotDy);
  }
}

/**
 * 64-Bit Architectural Shopping Mall Complex Sprite (3 Evolutionary Designs):
 * - Level 1 (Shopping Pequeno · 6×6): Galleria Regional em pedra creme/terracota com claraboia central, toldos coloridos e estacionamento arborizado.
 * - Level 2 (Shopping Médio · 8×8): Shopping Metropolitano em vidro safira e dourado com cúpula em cruz, cinema multiplex e boulevard iluminado.
 * - Level 3 (Shopping Grande · 9×9): Grand Lifestyle Megamall com domo geodésico de cristal, jardim suspenso no terraço, heliponto VIP e torres comerciais.
 */
function getShoppingMallSprite(
  level: number,
  variant: number,
  lotW: number = 1,
  lotH: number = 1,
  lotDx: number = 0,
  lotDy: number = 0
): CachedSprite {
  const lv = Math.max(1, Math.min(3, level || 1));
  const v = variant % 4;

  // Compact Diorama Sprite (used in Obras 64-bit preview card & 1×1 fallback)
  if (lotW <= 1 || lotH <= 1) {
    return getOrCreateSprite(`shopping64_single_lv${lv}_v${v}`, 96, 108, 48, 76, (ctx, cx, cy) => {
      // Ornamental plaza & parking base
      fillDiamond64(ctx, cx, cy, TILE_HW + 1, TILE_HH + 0.5, lv === 3 ? '#cbd5e1' : '#d6d3d1');
      fillDiamond64(ctx, cx, cy, 28, 14, lv === 3 ? '#94a3b8' : '#a8a29e');

      if (lv === 1) {
        // Level 1: Warm Terracotta & Cream Galleria Mall (6×6 design miniature)
        drawPrism64(ctx, cx, cy - 1, 22, 13, {
          top: '#f5ebe0',
          left: '#e3d5ca',
          right: '#c9ada7',
        });
        // Terracotta accent cornice band
        drawLine64(ctx, cx - 22, cy - 12, cx, cy - 1, '#e07a5f', 2.2);
        drawLine64(ctx, cx, cy - 1, cx + 22, cy - 12, '#c85a32', 2.2);
        // Glowing central glass skylight dome
        drawPrism64(ctx, cx, cy - 14, 11, 5.5, {
          top: '#7dd3fc',
          left: '#38bdf8',
          right: '#0284c7',
        });
        drawLine64(ctx, cx - 10, cy - 19.5, cx + 10, cy - 19.5, '#e0f2fe', 1.2);
        drawLine64(ctx, cx, cy - 25, cx, cy - 14, '#e0f2fe', 1.2);
        // Colorful storefront awnings
        drawLine64(ctx, cx - 18, cy - 3, cx - 4, cy + 4, '#ef4444', 2.4);
        drawLine64(ctx, cx + 4, cy + 4, cx + 18, cy - 3, '#f59e0b', 2.4);
      } else if (lv === 2) {
        // Level 2: Sapphire Glass & Gold Metropolitan Shopping Center (8×8 design miniature)
        drawPrism64(ctx, cx, cy - 1, 24, 18, {
          top: '#e2e8f0',
          left: '#1e3a8a',
          right: '#172554',
        });
        // Golden horizontal façade ribbons
        drawLine64(ctx, cx - 24, cy - 11, cx, cy + 1, '#fbbf24', 1.8);
        drawLine64(ctx, cx, cy + 1, cx + 24, cy - 11, '#d97706', 1.8);
        drawLine64(ctx, cx - 24, cy - 17, cx, cy - 5, '#f472b6', 1.6);
        drawLine64(ctx, cx, cy - 5, cx + 24, cy - 17, '#db2777', 1.6);
        // Cross-shaped vaulted skylight roof & cinema dome
        drawPrism64(ctx, cx, cy - 19, 14, 7, {
          top: '#bae6fd',
          left: '#38bdf8',
          right: '#0369a1',
        });
        drawGlow64(ctx, cx, cy - 24, 12, 'rgba(56, 189, 248, 0.55)');
      } else {
        // Level 3: Grand Lifestyle Megamall 9×9 with Crystal Geodesic Dome, Twin Towers & Helipad
        drawPrism64(ctx, cx, cy - 1, 25, 21, {
          top: '#f8fafc',
          left: '#312e81',
          right: '#1e1b4b',
        });
        // Luminous magenta-gold luxury façade bands
        for (const dy of [-7, -13, -19]) {
          drawLine64(ctx, cx - 25, cy + dy, cx, cy + dy + 12, '#f472b6', 1.5);
          drawLine64(ctx, cx, cy + dy + 12, cx + 25, cy + dy, '#fbbf24', 1.5);
        }
        // Soaring Crystal Geodesic Dome in the center
        drawPrism64(ctx, cx, cy - 22, 14, 10, {
          top: '#e0f2fe',
          left: '#38bdf8',
          right: '#0284c7',
        });
        drawPrism64(ctx, cx, cy - 32, 8, 6, {
          top: '#fef08a',
          left: '#7dd3fc',
          right: '#38bdf8',
        });
        drawGlow64(ctx, cx, cy - 34, 16, 'rgba(244, 114, 182, 0.65)');
      }
      drawTree64(ctx, cx - 20, cy + 5, 'emerald', 0.68);
      drawTree64(ctx, cx + 20, cy + 5, 'emerald', 0.68);
    });
  }

  // Multi-Tile Shopping Mall Compound (6×6 Lv.1, 8×8 Lv.2, 9×9 Lv.3)
  return getOrCreateSprite(
    `shopping64_compound_${lotW}x${lotH}_lv${lv}_v${v}_${lotDx}_${lotDy}`,
    88,
    120,
    44,
    84,
    (ctx, cx, cy) => {
      const midX = (lotW - 1) * 0.5;
      const midY = (lotH - 1) * 0.5;
      const distCenter = Math.max(Math.abs(lotDx - midX), Math.abs(lotDy - midY));
      const isPerimeter =
        lotDx === 0 || lotDy === 0 || lotDx === lotW - 1 || lotDy === lotH - 1;
      const isSouthFront = lotDy === lotH - 1 || (lotDx === 0 && lotDy >= lotH - 2);
      const isMainEntrance =
        (lotDy === lotH - 1 && Math.abs(lotDx - midX) <= 1.1) ||
        (lotDx === 0 && Math.abs(lotDy - midY) <= 1.1);
      const isAtriumCore = distCenter <= (lv === 3 ? 1.55 : 1.15);
      const isCrossSkylight =
        !isPerimeter && (Math.abs(lotDx - midX) <= 0.6 || Math.abs(lotDy - midY) <= 0.6);
      const isCornerAnchor =
        !isPerimeter &&
        (lotDx === 1 || lotDx === lotW - 2) &&
        (lotDy === 1 || lotDy === lotH - 2);

      // 1. Base Plaza / Granite Promenade Foundation
      const plazaColor =
        lv === 3
          ? (lotDx + lotDy) % 2 === 0
            ? '#e2e8f0'
            : '#cbd5e1'
          : lv === 2
            ? (lotDx + lotDy) % 2 === 0
              ? '#d6d3d1'
              : '#cbd5e1'
            : (lotDx + lotDy) % 2 === 0
              ? '#e7e5e4'
              : '#d6d3d1';
      fillDiamond64(ctx, cx, cy, TILE_HW + 0.6, TILE_HH + 0.4, plazaColor);

      // 2. Perimeter Parking Bays, Fountains & Landscaped Boulevard
      if (isPerimeter) {
        if (isMainEntrance) {
          // Grand Illuminated Entrance Plaza with Red/Gold Carpet & Fountain
          fillDiamond64(ctx, cx, cy, 25, 12.5, lv === 3 ? '#f472b6' : lv === 2 ? '#38bdf8' : '#f59e0b');
          fillDiamond64(ctx, cx, cy, 18, 9, '#fef3c7');
          drawPrism64(ctx, cx, cy - 1, 9, 4.5, {
            top: '#7dd3fc',
            left: '#cbd5e1',
            right: '#94a3b8',
          });
          drawGlow64(ctx, cx, cy - 6, 11, 'rgba(56, 189, 248, 0.75)');
          drawBushOrFlowerbed64(ctx, cx - 16, cy + 2, 1);
          drawBushOrFlowerbed64(ctx, cx + 16, cy + 2, 2);
        } else if (isSouthFront) {
          // Shopper Parking Lot Bays & Parked Pixel Cars
          fillDiamond64(ctx, cx, cy, 27, 13.5, '#334155');
          drawLine64(ctx, cx - 14, cy - 2, cx - 2, cy - 8, '#f8fafc', 1.0);
          drawLine64(ctx, cx - 4, cy + 3, cx + 8, cy - 3, '#f8fafc', 1.0);
          const carPalette = ['#ef4444', '#38bdf8', '#facc15', '#a855f7', '#22c55e', '#f97316'];
          const carCol1 = carPalette[(lotDx * 3 + lotDy + v) % carPalette.length];
          const carCol2 = carPalette[(lotDx + lotDy * 5 + v + 2) % carPalette.length];
          drawPrism64(ctx, cx - 6, cy - 1, 5.5, 3.2, {
            top: carCol1,
            left: '#1e293b',
            right: '#0f172a',
          });
          drawPrism64(ctx, cx + 6, cy + 2, 5.5, 3.2, {
            top: carCol2,
            left: '#1e293b',
            right: '#0f172a',
          });
          if ((lotDx + lotDy) % 2 === 0) {
            drawTree64(ctx, cx - 18, cy + 3, 'emerald', 0.65);
          }
        } else {
          // Landscaped perimeter retail promenade with boutique kiosks & trees
          fillDiamond64(ctx, cx, cy, 24, 12, '#94a3b8');
          drawPrism64(ctx, cx, cy - 1, 16, 8 + lv * 2, {
            top: lv === 3 ? '#f8fafc' : lv === 2 ? '#e2e8f0' : '#f5ebe0',
            left: lv === 3 ? '#4338ca' : lv === 2 ? '#1e40af' : '#d6ccc2',
            right: lv === 3 ? '#312e81' : lv === 2 ? '#1e3a8a' : '#b8a99a',
          });
          // Storefront awning & glowing display window
          const awningCol =
            (lotDx + lotDy) % 3 === 0 ? '#f43f5e' : (lotDx + lotDy) % 3 === 1 ? '#0ea5e9' : '#f59e0b';
          const awningSideCol =
            (lotDx + lotDy) % 3 === 0 ? '#be123c' : (lotDx + lotDy) % 3 === 1 ? '#0369a1' : '#b45309';
          drawLine64(ctx, cx - 15, cy - 3, cx, cy + 4.5, awningCol, 2.2);
          drawLine64(ctx, cx, cy + 4.5, cx + 15, cy - 3, awningSideCol, 2.2);
          drawTree64(ctx, cx + 17, cy + 4, 'emerald', 0.62);
        }
        return;
      }

      // 3. Central Skylight Atrium Dome Core
      if (isAtriumCore) {
        const baseH = lv === 3 ? 28 : lv === 2 ? 21 : 15;
        drawPrism64(ctx, cx, cy, 28, baseH, {
          top: lv === 3 ? '#e0f2fe' : lv === 2 ? '#bae6fd' : '#f5ebe0',
          left: lv === 3 ? '#312e81' : lv === 2 ? '#1e3a8a' : '#e3d5ca',
          right: lv === 3 ? '#1e1b4b' : lv === 2 ? '#172554' : '#c9ada7',
        });

        // Stepped Crystal Skylight Dome above the atrium
        const domeH = lv === 3 ? 16 : lv === 2 ? 11 : 7;
        drawPrism64(ctx, cx, cy - baseH, 22, domeH, {
          top: '#7dd3fc',
          left: '#38bdf8',
          right: '#0284c7',
        });
        // Geodesic glass ribs & golden crown on Level 2 & 3
        drawLine64(ctx, cx - 20, cy - baseH - domeH, cx + 20, cy - baseH - domeH, '#e0f2fe', 1.4);
        drawLine64(ctx, cx, cy - baseH - domeH - 10, cx, cy - baseH - domeH + 10, '#e0f2fe', 1.4);
        if (lv >= 2) {
          drawPrism64(ctx, cx, cy - baseH - domeH, 12, lv === 3 ? 9 : 5, {
            top: lv === 3 ? '#fef08a' : '#e0f2fe',
            left: lv === 3 ? '#f472b6' : '#7dd3fc',
            right: lv === 3 ? '#db2777' : '#0284c7',
          });
          drawGlow64(
            ctx,
            cx,
            cy - baseH - domeH - 5,
            lv === 3 ? 18 : 13,
            lv === 3 ? 'rgba(244, 114, 182, 0.7)' : 'rgba(56, 189, 248, 0.65)'
          );
        }
        return;
      }

      // 4. Interior Mall Wings, Anchor Department Stores, Sky-Garden & VIP Helipad
      const wingH = lv === 3 ? 25 : lv === 2 ? 19 : 14;
      const topCol =
        lv === 3
          ? isCrossSkylight
            ? '#bae6fd'
            : '#f1f5f9'
          : lv === 2
            ? isCrossSkylight
              ? '#7dd3fc'
              : '#e2e8f0'
            : isCrossSkylight
              ? '#bae6fd'
              : '#f5ebe0';
      const leftCol =
        lv === 3
          ? '#3730a3'
          : lv === 2
            ? '#1d4ed8'
            : '#d5bdaf';
      const rightCol =
        lv === 3
          ? '#1e1b4b'
          : lv === 2
            ? '#1e3a8a'
            : '#b0988a';

      drawPrism64(ctx, cx, cy, 27.5, wingH, {
        top: topCol,
        left: leftCol,
        right: rightCol,
      });

      // Illuminated ribbon windows & signage bands
      for (let wy = 5; wy < wingH - 2; wy += 6) {
        drawLine64(
          ctx,
          cx - 26,
          cy - wy,
          cx,
          cy - wy + 13,
          lv === 3 ? '#f472b6' : lv === 2 ? '#fbbf24' : '#e07a5f',
          1.5
        );
        drawLine64(
          ctx,
          cx,
          cy - wy + 13,
          cx + 26,
          cy - wy,
          lv === 3 ? '#38bdf8' : lv === 2 ? '#60a5fa' : '#f59e0b',
          1.5
        );
      }

      if (isCrossSkylight) {
        // Glass concourse skylight ridge connecting the wings to the central dome
        drawPrism64(ctx, cx, cy - wingH, 16, 4.5, {
          top: '#e0f2fe',
          left: '#38bdf8',
          right: '#0284c7',
        });
      } else if (lv === 3 && lotDx === lotW - 2 && lotDy === 1) {
        // Level 3 VIP Rooftop Helipad ("H") on the North-East Anchor Wing
        fillDiamond64(ctx, cx, cy - wingH, 16, 8, '#334155');
        fillDiamond64(ctx, cx, cy - wingH, 12, 6, '#1e293b');
        drawLine64(ctx, cx - 3, cy - wingH - 3, cx - 3, cy - wingH + 3, '#facc15', 1.6);
        drawLine64(ctx, cx + 3, cy - wingH - 3, cx + 3, cy - wingH + 3, '#facc15', 1.6);
        drawLine64(ctx, cx - 3, cy - wingH, cx + 3, cy - wingH, '#facc15', 1.6);
      } else if (lv >= 2 && lotDx === 1 && lotDy === 1) {
        // Rooftop Botanical Sky-Garden Terrace on North-West Anchor Wing
        fillDiamond64(ctx, cx, cy - wingH, 18, 9, '#22c55e');
        drawTree64(ctx, cx - 5, cy - wingH, 'emerald', 0.55);
        drawTree64(ctx, cx + 5, cy - wingH + 1, 'emerald', 0.55);
      } else if (isCornerAnchor) {
        // Anchor Store Tower / Multiplex Cinema Crown
        const towerH = lv === 3 ? 13 : lv === 2 ? 9 : 5;
        drawPrism64(ctx, cx, cy - wingH, 17, towerH, {
          top: lv === 3 ? '#fef08a' : lv === 2 ? '#f472b6' : '#e07a5f',
          left: lv === 3 ? '#db2777' : lv === 2 ? '#be185d' : '#c85a32',
          right: lv === 3 ? '#9d174d' : lv === 2 ? '#831843' : '#9c411f',
        });
      }
    }
  );
}

/** 64-Bit Architectural Municipal Bus Terminal / BRT Hub Sprite */
function getBusStationSprite(level: number, variant: number): CachedSprite {
  const lv = Math.max(1, Math.min(3, level || 1));
  const v = variant % 3;
  return getOrCreateSprite(`bus_station64_lv${lv}_v${v}`, 84, 88, 42, 60, (ctx, cx, cy) => {
    // Granite transit plaza foundation
    const baseGrad = ctx.createLinearGradient(cx - 32, cy - 16, cx + 32, cy + 16);
    baseGrad.addColorStop(0, '#cbd5e1');
    baseGrad.addColorStop(1, '#8d9bb0');
    fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, baseGrad);

    // Recessed dark asphalt boarding bay lane
    fillDiamond64(ctx, cx, cy, 26.5, 13.2, '#283140');
    // Dedicated cyan-blue BRT boarding zone marking
    drawLine64(ctx, cx - 17, cy + 1, cx + 5, cy - 10, '#38bdf8', 2.2);
    drawLine64(ctx, cx - 6, cy + 9, cx + 16, cy - 2, '#facc15', 1.4);

    // Raised concrete boarding platform island
    drawPrism64(ctx, cx - 3, cy - 2, 13, 3.5, {
      top: '#e2e8f0',
      left: '#cbd5e1',
      right: '#94a3b8',
    });
    // Yellow tactile platform edge stripe
    drawLine64(ctx, cx - 15, cy - 5, cx + 9, cy + 1, '#facc15', 1.0);

    // Parked isometric municipal bus at the loading bay!
    const bx = cx + 7;
    const by = cy + 3;
    drawPrism64(ctx, bx, by, 7.5, 6.2, {
      top: lv >= 3 ? '#f5b73b' : '#38bdf8',
      left: '#0284c7',
      right: '#0369a1',
    });
    // Bus panoramic windows & headlights
    drawLine64(ctx, bx - 6, by - 4.2, bx - 1, by - 1.6, '#bae6fd', 1.8);
    drawLine64(ctx, bx + 1, by - 1.6, bx + 6, by - 4.2, '#7dd3fc', 1.8);
    ctx.fillStyle = '#fef08a';
    ctx.fillRect(bx + 5.5, by - 1.2, 1.8, 1.4);

    // Architectural steel support pillars for the BRT canopy
    const canopyLift = lv >= 3 ? 16 : lv === 2 ? 14 : 12;
    const pillars: Array<[number, number]> = [
      [cx - 10, cy - 3],
      [cx + 3, cy - 8],
      [cx - 4, cy + 2],
    ];
    for (const [px, py] of pillars) {
      drawLine64(ctx, px, py - 2, px, py - canopyLift, '#64748b', 2.0);
    }

    // Sleek vaulted transit terminal canopy roof
    const roofTop = lv >= 3 ? '#06b6d4' : lv === 2 ? '#2563eb' : '#0ea5e9';
    const roofLeft = lv >= 3 ? '#0891b2' : lv === 2 ? '#1d4ed8' : '#0284c7';
    const roofRight = lv >= 3 ? '#0e7490' : lv === 2 ? '#1e40af' : '#0369a1';
    drawPrism64(ctx, cx - 3, cy - 2 - canopyLift, 15.5, 3.2, {
      top: roofTop,
      left: roofLeft,
      right: roofRight,
    });
    // Luminous skylight glass ribs across the canopy roof
    drawLine64(ctx, cx - 12, cy - 3 - canopyLift, cx + 6, cy - 11 - canopyLift, '#e0f2fe', 1.5);
    drawLine64(ctx, cx - 7, cy - 1 - canopyLift, cx + 11, cy - 9 - canopyLift, '#bae6fd', 1.3);
    if (lv >= 2) {
      // Secondary solar-glass wing & golden crown trim for Lv.2/3 BRT hubs
      drawPrism64(ctx, cx - 3, cy - 5 - canopyLift, 9, 2.2, {
        top: lv >= 3 ? '#fbbf24' : '#7dd3fc',
        left: '#38bdf8',
        right: '#0284c7',
      });
    }

    // Illuminated Municipal Bus Route Sign Totem + warm glow
    const tx = cx - 19;
    const ty = cy + 1;
    drawLine64(ctx, tx, ty, tx, ty - 16, '#334155', 2.1);
    ctx.fillStyle = '#0ea5e9';
    ctx.fillRect(tx - 4, ty - 19, 8, 6);
    ctx.strokeStyle = '#e0f2fe';
    ctx.lineWidth = 0.8;
    ctx.strokeRect(tx - 4, ty - 19, 8, 6);
    drawGlow64(ctx, tx, ty - 16, 7.5, 'rgba(56, 189, 248, 0.75)');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(tx - 2.2, ty - 17.2, 4.4, 2.4);

    // Waiting passengers & benches on the platform
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(cx - 10, cy - 6, 1.8, 3.0);
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(cx - 6, cy - 4.5, 1.8, 3.0);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(cx - 2, cy - 6.5, 1.8, 3.0);
  });
}

/** 64-Bit Metropolitan Underground Metro Station Entrance Sprite */
function getMetroStationSprite(level: number, variant: number): CachedSprite {
  const lv = Math.max(1, Math.min(3, level || 1));
  const v = variant % 3;
  return getOrCreateSprite(`metro_station64_lv${lv}_v${v}`, 84, 92, 42, 64, (ctx, cx, cy) => {
    // Sleek metropolitan charcoal-granite transit plaza
    const plazaGrad = ctx.createLinearGradient(cx - 32, cy - 16, cx + 32, cy + 16);
    plazaGrad.addColorStop(0, '#94a3b8');
    plazaGrad.addColorStop(1, '#5b677a');
    fillDiamond64(ctx, cx, cy, TILE_HW + 0.5, TILE_HH + 0.3, plazaGrad);
    fillDiamond64(ctx, cx, cy, 27, 13.5, '#cbd5e1');
    fillDiamond64(ctx, cx, cy, 24.5, 12.2, '#475569');

    // Deep illuminated subterranean stairwell descent opening
    fillDiamond64(ctx, cx + 1, cy + 1, 13.5, 6.8, '#0f172a');
    // Glowing recessed metro escalator steps descending underground
    for (let s = 0; s < 4; s++) {
      drawLine64(
        ctx,
        cx - 6 + s * 3.2,
        cy + 1.5 - s * 1.1,
        cx + 3 + s * 3.2,
        cy + 5.2 - s * 1.1,
        s % 2 === 0 ? '#38bdf8' : '#818cf8',
        1.15
      );
    }
    // Subtle subterranean concourse glow rising from the tunnel entrance
    drawGlow64(ctx, cx + 1, cy + 1, 11, 'rgba(99, 102, 241, 0.55)');

    // Glass-and-steel vaulted Metro pavilion dome rising over the entrance
    const domeH = lv >= 3 ? 20 : lv === 2 ? 16 : 13;
    const archTop = lv >= 3 ? '#c084fc' : lv === 2 ? '#818cf8' : '#38bdf8';
    const archLeft = lv >= 3 ? '#7c3aed' : lv === 2 ? '#4f46e5' : '#0284c7';
    const archRight = lv >= 3 ? '#5b21b6' : lv === 2 ? '#3730a3' : '#0369a1';

    // Side structural glass walls
    drawPrism64(ctx, cx - 2, cy - 2, 13.5, domeH * 0.55, {
      top: '#93c5fd',
      left: 'rgba(125, 211, 252, 0.82)',
      right: 'rgba(99, 102, 241, 0.82)',
    });
    // Vaulted metallic crown canopy
    drawPrism64(ctx, cx - 2, cy - 2 - domeH * 0.55, 14.5, 4.2, {
      top: archTop,
      left: archLeft,
      right: archRight,
    });
    // Ribbed architectural arches along the vault
    drawLine64(ctx, cx - 12, cy - 4 - domeH * 0.55, cx + 8, cy - 11 - domeH * 0.55, '#f8fafc', 1.4);
    drawLine64(ctx, cx - 7, cy - 1 - domeH * 0.55, cx + 12, cy - 8 - domeH * 0.55, '#e0e7ff', 1.2);

    if (lv >= 3) {
      // Grand Central Golden-Violet Spire Crown for Lv.3 Express Metro Hub
      drawPrism64(ctx, cx - 2, cy - 7 - domeH * 0.55, 8.2, 4.5, {
        top: '#fbbf24',
        left: '#a855f7',
        right: '#6d28d9',
      });
    }

    // Iconic Tall Illuminated "M" Metro Totem Pylon!
    const mx = cx + 18;
    const my = cy + 2;
    drawLine64(ctx, mx, my, mx, my - 21, '#334155', 2.4);
    drawGlow64(ctx, mx, my - 22, 10, lv >= 3 ? 'rgba(251, 191, 36, 0.85)' : 'rgba(139, 92, 246, 0.88)');
    ctx.fillStyle = lv >= 3 ? '#f59e0b' : '#6366f1';
    ctx.beginPath();
    ctx.arc(mx, my - 22, 6.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // Crisp white "M" glyph
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 8.5px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('M', mx, my - 21.5);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';

    // Landscaped corner planter accents
    drawBushOrFlowerbed64(ctx, cx - 19, cy + 1, 2.2, v % 2 === 0);
    drawBushOrFlowerbed64(ctx, cx - 16, cy - 6, 2.0, v % 2 === 1);
  });
}

function strokeOrFillScreenDiamond(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  halfW: number,
  halfH: number,
  fillStyle?: string,
  strokeStyle?: string,
  lineWidth: number = 1
): void {
  ctx.beginPath();
  ctx.moveTo(sx, sy - halfH);
  ctx.lineTo(sx + halfW, sy);
  ctx.lineTo(sx, sy + halfH);
  ctx.lineTo(sx - halfW, sy);
  ctx.closePath();
  if (fillStyle) {
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }
  if (strokeStyle) {
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

export interface RenderOptions {
  camera: CameraState;
  hoveredTile: { tx: number; ty: number } | null;
  mapFilter: MapFilter;
  timeSeconds: number;
  timeOfDay?: TimeOfDayMode;
  boats?: BoatEntity[];
  planes?: PlaneEntity[];
  helicopters?: HelicopterEntity[];
  /** Optional dynamic resolution scale (<1 when zoomed far out for smooth high FPS) */
  renderScale?: number;
  /** Logical viewport dimensions matching CSS pixels when renderScale !== 1 */
  logicalWidth?: number;
  logicalHeight?: number;
}

// ============================================================================
// 64-Bit True 3D Isometric Dynamic Entities: Cars, Buses, Boats & Airplanes
// ============================================================================

/** Lightweight isometric vehicle silhouette for zoomed-out / out-of-focus LOD */
function drawCarFast64(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  dirX: number,
  dirY: number,
  color: string,
  zoom: number,
  glowStrength: number,
  kind: VehicleKind = 'sedan',
  timeSeconds: number = 0
): void {
  const s = Math.max(0.55, zoom);
  const mag = Math.hypot(dirX, dirY) || 1;
  const ux = dirX / mag;
  const uy = dirY / mag;
  const vx = -uy * 1.3;
  const vy = ux * 0.65;
  const isFire = kind === 'fire';
  const isPolice = kind === 'police';
  const halfL = (isFire ? 4.8 : isPolice ? 3.8 : 3.5) * s;
  const halfW = (isFire ? 1.8 : 1.45) * s;
  const h = (isFire ? 3.2 : 2.4) * s;

  ctx.fillStyle = isFire ? '#dc2626' : isPolice ? '#0f172a' : color;
  ctx.beginPath();
  ctx.moveTo(sx - halfL * ux - halfW * vx, sy - halfL * uy - halfW * vy - h);
  ctx.lineTo(sx + halfL * ux - halfW * vx, sy + halfL * uy - halfW * vy - h);
  ctx.lineTo(sx + halfL * ux + halfW * vx, sy + halfL * uy + halfW * vy - h);
  ctx.lineTo(sx - halfL * ux + halfW * vx, sy - halfL * uy + halfW * vy - h);
  ctx.closePath();
  ctx.fill();

  if (isPolice || isFire) {
    const flash = Math.floor(timeSeconds * 7) % 2 === 0;
    ctx.fillStyle = isPolice ? (flash ? '#3b82f6' : '#ef4444') : (flash ? '#ef4444' : '#f59e0b');
    ctx.fillRect(sx - 1.5, sy - h - 1.5, 3, 2);
  } else if (glowStrength > 0.2) {
    ctx.fillStyle = uy >= 0 ? '#fff9c4' : '#ff5555';
    ctx.fillRect(sx + (uy >= 0 ? halfL : -halfL) * ux - 1, sy + (uy >= 0 ? halfL : -halfL) * uy - h * 0.5, 2, 2);
  }
}

/**
 * Draw a 64-Bit Vehicle (Sedan, Hatch, SUV, Van, Bus, Truck, Police Cruiser, or Fire Engine)
 * in TRUE 3D ISOMETRIC PERSPECTIVE with emergency lightbars & sirens for police and fire units!
 */
function drawCar64(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  dirX: number,
  dirY: number,
  color: string,
  zoom: number,
  variantIdx: number,
  glowStrength: number = 0,
  kindOverride?: VehicleKind,
  timeSeconds: number = 0
): void {
  const s = Math.max(0.62, zoom);
  const kind = kindOverride ?? getVehicleKind(variantIdx);
  const isPolice = kind === 'police';
  const isFire = kind === 'fire';
  const isBus = kind === 'bus';
  const isTruck = kind === 'truck';
  const isVan = kind === 'van';
  const isSuv = kind === 'suv';
  const isHatch = kind === 'hatch';

  // Normalize isometric screen direction vector (ux, uy)
  const mag = Math.hypot(dirX, dirY) || 1;
  const ux = dirX / mag;
  const uy = dirY / mag;
  // Isometric cross-axis vector perpendicular in the 2:1 ground plane
  const vx = -uy * 1.4;
  const vy = ux * 0.7;

  const halfL = (
    isBus ? 5.4 : isFire ? 5.05 : isTruck ? 4.9 : isVan ? 4.1 : isSuv ? 3.85 : isPolice ? 3.8 : isHatch ? 3.15 : 3.55
  ) * s;
  const halfW = (
    isBus ? 1.9 : isFire ? 1.85 : isTruck ? 1.8 : isVan ? 1.68 : isSuv ? 1.65 : 1.52
  ) * s;
  const bodyH = (
    isBus ? 2.65 : isFire ? 2.3 : isTruck ? 2.1 : isVan ? 2.05 : isSuv ? 1.9 : 1.62
  ) * s;
  const cabinH = (
    isBus ? 4.55 : isFire ? 4.1 : isTruck ? 4.35 : isVan ? 3.85 : isSuv ? 3.5 : isPolice ? 3.15 : isHatch ? 3.05 : 2.95
  ) * s;

  // Give commercial vans, buses, trucks, police, and fire engines authentic fleet liveries
  const bodyColor = isPolice
    ? '#0f172a'
    : isFire
      ? '#dc2626'
      : isVan
        ? ['#f1f5f9', '#dbeafe', '#fef3c7', '#e2e8f0'][variantIdx % 4]
        : isBus
          ? ['#2563eb', '#0d9488', '#d97706', '#dc2626'][variantIdx % 4]
          : isTruck
            ? ['#dc2626', '#2563eb', '#475569', '#d97706'][variantIdx % 4]
            : color;

  const cargoColor = isTruck
    ? ['#f8fafc', '#fef3c7', '#cbd5e1', '#bae6fd'][(variantIdx >> 1) % 4]
    : bodyColor;

  // Project local (l along travel, w across width, z vertical height) to screen (x, y)
  const pt = (l: number, w: number, z: number = 0): [number, number] => [
    sx + l * ux + w * vx,
    sy + l * uy + w * vy - z,
  ];

  const poly = (pts: Array<[number, number]>, fill: string, stroke?: string) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = Math.max(0.5, 0.45 * s);
      ctx.stroke();
    }
  };

  // 1. Grounded 3D isometric drop shadow on the asphalt
  poly(
    [
      pt(-halfL * 1.06, -halfW * 1.08, -0.35 * s),
      pt(halfL * 1.06, -halfW * 1.08, -0.35 * s),
      pt(halfL * 1.06, halfW * 1.08, -0.35 * s),
      pt(-halfL * 1.06, halfW * 1.08, -0.35 * s),
    ],
    'rgba(6, 10, 18, 0.48)'
  );

  // 2. Warm headlight beam cones projected onto the road surface ahead (intensify at dusk/night!)
  const beamAlpha = 0.18 + glowStrength * 0.46;
  const beamReach = 2.0 + glowStrength * 1.45;
  poly(
    [
      pt(halfL * 0.9, -halfW * 0.72, 0.25 * s),
      pt(halfL * beamReach, -halfW * (1.35 + glowStrength * 0.45), 0),
      pt(halfL * beamReach, halfW * (1.35 + glowStrength * 0.45), 0),
      pt(halfL * 0.9, halfW * 0.72, 0.25 * s),
    ],
    `rgba(255, 244, 178, ${beamAlpha.toFixed(3)})`
  );

  // Determine which lateral side (+halfW or -halfW) faces the isometric camera (higher screen Y)
  const posSideY = vy;
  const nearW = posSideY >= 0 ? halfW : -halfW;
  const farW = -nearW;
  // Determine if front (+halfL) or rear (-halfL) faces the camera (higher screen Y)
  const frontFacing = uy >= 0;
  const endL = frontFacing ? halfL : -halfL;

  // 3. 3D Wheels tucked under the camera-facing side fender
  const wheelR = (isBus || isTruck || isFire ? 1.08 : isSuv || isVan ? 0.96 : 0.85) * s;
  const wheelOffsets = isBus
    ? [-halfL * 0.62, halfL * 0.56]
    : isTruck || isFire
      ? [-halfL * 0.64, -halfL * 0.22, halfL * 0.62]
      : [-halfL * 0.56, halfL * 0.56];
  for (const wl of wheelOffsets) {
    const [wx, wy] = pt(wl, nearW * 0.98, wheelR * 0.45);
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.ellipse(wx, wy, wheelR * 1.05, wheelR * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#94a3b8';
    ctx.beginPath();
    ctx.arc(wx, wy, wheelR * 0.42, 0, Math.PI * 2);
    ctx.fill();
  }

  // 4. Lower 3D Chassis Body
  poly(
    [
      pt(-halfL, farW, 0.3 * s),
      pt(halfL, farW, 0.3 * s),
      pt(halfL, farW, bodyH),
      pt(-halfL, farW, bodyH),
    ],
    bodyColor
  );
  poly(
    [
      pt(-halfL, -halfW, bodyH),
      pt(halfL, -halfW, bodyH),
      pt(halfL, halfW, bodyH),
      pt(-halfL, halfW, bodyH),
    ],
    bodyColor,
    'rgba(15, 23, 42, 0.35)'
  );
  poly(
    [
      pt(-halfL, nearW, 0.35 * s),
      pt(halfL, nearW, 0.35 * s),
      pt(halfL, nearW, bodyH),
      pt(-halfL, nearW, bodyH),
    ],
    bodyColor,
    'rgba(15, 23, 42, 0.45)'
  );
  poly(
    [
      pt(-halfL, nearW, 0.35 * s),
      pt(halfL, nearW, 0.35 * s),
      pt(halfL, nearW, bodyH),
      pt(-halfL, nearW, bodyH),
    ],
    'rgba(0, 0, 0, 0.18)'
  );
  poly(
    [
      pt(endL, -halfW, 0.35 * s),
      pt(endL, halfW, 0.35 * s),
      pt(endL, halfW, bodyH),
      pt(endL, -halfW, bodyH),
    ],
    bodyColor,
    'rgba(15, 23, 42, 0.45)'
  );

  // Police white patrol doors & gold badge accent OR Fire white reflective stripe
  if (isPolice) {
    poly(
      [
        pt(-halfL * 0.36, nearW * 1.01, bodyH * 0.26),
        pt(halfL * 0.34, nearW * 1.01, bodyH * 0.26),
        pt(halfL * 0.34, nearW * 1.01, bodyH * 0.96),
        pt(-halfL * 0.36, nearW * 1.01, bodyH * 0.96),
      ],
      '#f8fafc'
    );
    poly(
      [
        pt(-halfL * 0.08, nearW * 1.02, bodyH * 0.50),
        pt(halfL * 0.10, nearW * 1.02, bodyH * 0.50),
        pt(halfL * 0.10, nearW * 1.02, bodyH * 0.78),
        pt(-halfL * 0.08, nearW * 1.02, bodyH * 0.78),
      ],
      '#facc15'
    );
  } else if (isFire) {
    poly(
      [
        pt(-halfL * 0.96, nearW * 1.01, bodyH * 0.46),
        pt(halfL * 0.96, nearW * 1.01, bodyH * 0.46),
        pt(halfL * 0.96, nearW * 1.01, bodyH * 0.72),
        pt(-halfL * 0.96, nearW * 1.01, bodyH * 0.72),
      ],
      '#fef08a'
    );
  } else if (isBus) {
    poly(
      [
        pt(-halfL * 0.96, nearW * 1.01, bodyH * 0.52),
        pt(halfL * 0.96, nearW * 1.01, bodyH * 0.52),
        pt(halfL * 0.96, nearW * 1.01, bodyH * 0.80),
        pt(-halfL * 0.96, nearW * 1.01, bodyH * 0.80),
      ],
      '#f8fafc'
    );
  }

  // 5. Elevated 3D Superstructure: Fire Engine / Truck / Cabin
  if (isFire) {
    // Fire engine pump/hose body rear + metallic silver equipment shutters
    const boxBack = -halfL * 0.96;
    const boxFront = halfL * 0.36;
    const boxW = halfW * 0.94;
    const nearBoxW = posSideY >= 0 ? boxW : -boxW;
    const boxH = cabinH * 0.96;

    poly(
      [
        pt(boxBack, nearBoxW, bodyH * 0.9),
        pt(boxFront, nearBoxW, bodyH * 0.9),
        pt(boxFront, nearBoxW, boxH),
        pt(boxBack, nearBoxW, boxH),
      ],
      '#b91c1c',
      'rgba(15, 23, 42, 0.38)'
    );
    // Two silver roll-up equipment bays
    for (const seg of [
      [-0.84, -0.30],
      [-0.18, 0.26],
    ]) {
      poly(
        [
          pt(halfL * seg[0], nearBoxW * 1.02, bodyH * 1.02),
          pt(halfL * seg[1], nearBoxW * 1.02, bodyH * 1.02),
          pt(halfL * seg[1], nearBoxW * 1.02, boxH * 0.90),
          pt(halfL * seg[0], nearBoxW * 1.02, boxH * 0.90),
        ],
        '#cbd5e1',
        '#64748b'
      );
    }
    poly(
      [
        pt(boxBack, -boxW, boxH),
        pt(boxFront, -boxW, boxH),
        pt(boxFront, boxW, boxH),
        pt(boxBack, boxW, boxH),
      ],
      '#ef4444',
      'rgba(255,255,255,0.4)'
    );
    // Silver aluminum extension ladder mounted atop the fire engine!
    poly(
      [
        pt(boxBack * 0.95, -boxW * 0.44, boxH + 0.3 * s),
        pt(halfL * 0.56, -boxW * 0.44, boxH + 0.55 * s),
        pt(halfL * 0.56, boxW * 0.44, boxH + 0.55 * s),
        pt(boxBack * 0.95, boxW * 0.44, boxH + 0.3 * s),
      ],
      '#e2e8f0',
      '#475569'
    );
    // Forward fire cab + windshield
    const cabBack = halfL * 0.38;
    const cabFront = halfL * 0.96;
    const cabW = halfW * 0.90;
    const nearCabW = posSideY >= 0 ? cabW : -cabW;
    poly(
      [
        pt(cabBack, nearCabW, bodyH),
        pt(cabFront, nearCabW, bodyH),
        pt(cabFront * 0.95, nearCabW, cabinH),
        pt(cabBack, nearCabW, cabinH),
      ],
      '#dc2626',
      'rgba(15,23,42,0.4)'
    );
    if (frontFacing) {
      poly(
        [
          pt(cabFront, -cabW, bodyH),
          pt(cabFront, cabW, bodyH),
          pt(cabFront * 0.95, cabW, cabinH * 0.95),
          pt(cabFront * 0.95, -cabW, cabinH * 0.95),
        ],
        '#38bdf8',
        '#e0f2fe'
      );
    }
    poly(
      [
        pt(cabBack, -cabW, cabinH),
        pt(cabFront * 0.95, -cabW, cabinH),
        pt(cabFront * 0.95, cabW, cabinH),
        pt(cabBack, cabW, cabinH),
      ],
      '#f8fafc',
      'rgba(255,255,255,0.6)'
    );
  } else if (isTruck) {
    // Tall enclosed freight cargo box behind the forward cab
    const boxBack = -halfL * 0.98;
    const boxFront = halfL * 0.32;
    const boxW = halfW * 0.96;
    const nearBoxW = posSideY >= 0 ? boxW : -boxW;
    const boxH = cabinH * 1.12;

    poly(
      [
        pt(boxBack, nearBoxW, bodyH * 0.92),
        pt(boxFront, nearBoxW, bodyH * 0.92),
        pt(boxFront, nearBoxW, boxH),
        pt(boxBack, nearBoxW, boxH),
      ],
      cargoColor,
      'rgba(15, 23, 42, 0.38)'
    );
    poly(
      [
        pt(boxBack, nearBoxW, bodyH * 0.92),
        pt(boxFront, nearBoxW, bodyH * 0.92),
        pt(boxFront, nearBoxW, boxH),
        pt(boxBack, nearBoxW, boxH),
      ],
      'rgba(15, 23, 42, 0.14)'
    );
    const boxEnd = frontFacing ? boxFront : boxBack;
    poly(
      [
        pt(boxEnd, -boxW, bodyH * 0.92),
        pt(boxEnd, boxW, bodyH * 0.92),
        pt(boxEnd, boxW, boxH),
        pt(boxEnd, -boxW, boxH),
      ],
      cargoColor,
      'rgba(15, 23, 42, 0.35)'
    );
    poly(
      [
        pt(boxBack, -boxW, boxH),
        pt(boxFront, -boxW, boxH),
        pt(boxFront, boxW, boxH),
        pt(boxBack, boxW, boxH),
      ],
      cargoColor,
      'rgba(255,255,255,0.6)'
    );

    const cabBack = halfL * 0.38;
    const cabFront = halfL * 0.96;
    const cabW = halfW * 0.88;
    const nearCabW = posSideY >= 0 ? cabW : -cabW;
    const cabTopH = cabinH * 0.94;
    poly(
      [
        pt(cabBack, nearCabW, bodyH),
        pt(cabFront, nearCabW, bodyH),
        pt(cabFront * 0.96, nearCabW, cabTopH),
        pt(cabBack, nearCabW, cabTopH),
      ],
      '#1e3a5f',
      'rgba(255,255,255,0.3)'
    );
    if (frontFacing) {
      poly(
        [
          pt(cabFront, -cabW, bodyH),
          pt(cabFront, cabW, bodyH),
          pt(cabFront * 0.96, cabW, cabTopH),
          pt(cabFront * 0.96, -cabW, cabTopH),
        ],
        '#38bdf8',
        '#e0f2fe'
      );
    }
    poly(
      [
        pt(cabBack, -cabW, cabTopH),
        pt(cabFront * 0.96, -cabW, cabTopH),
        pt(cabFront * 0.96, cabW, cabTopH),
        pt(cabBack, cabW, cabTopH),
      ],
      bodyColor,
      'rgba(255,255,255,0.45)'
    );
  } else {
    const cabBackBase = isBus
      ? -halfL * 0.94
      : isVan
        ? -halfL * 0.92
        : isSuv || isHatch
          ? -halfL * 0.82
          : -halfL * 0.56;
    const cabFrontBase = isBus
      ? halfL * 0.93
      : isVan
        ? halfL * 0.72
        : isSuv
          ? halfL * 0.48
          : halfL * 0.42;
    const cabBackTop = isBus
      ? -halfL * 0.88
      : isVan
        ? -halfL * 0.86
        : isSuv || isHatch
          ? -halfL * 0.68
          : -halfL * 0.36;
    const cabFrontTop = isBus
      ? halfL * 0.84
      : isVan
        ? halfL * 0.52
        : halfL * 0.18;
    const cabW = halfW * (isBus || isVan ? 0.92 : 0.85);
    const nearCabW = posSideY >= 0 ? cabW : -cabW;

    const winBackBase = isVan ? -halfL * 0.05 : cabBackBase;
    const winBackTop = isVan ? -halfL * 0.05 : cabBackTop;
    if (isVan) {
      poly(
        [
          pt(cabBackBase, nearCabW, bodyH),
          pt(winBackBase, nearCabW, bodyH),
          pt(winBackTop, nearCabW, cabinH),
          pt(cabBackTop, nearCabW, cabinH),
        ],
        bodyColor,
        'rgba(15, 23, 42, 0.32)'
      );
    }
    poly(
      [
        pt(winBackBase, nearCabW, bodyH),
        pt(cabFrontBase, nearCabW, bodyH),
        pt(cabFrontTop, nearCabW, cabinH),
        pt(winBackTop, nearCabW, cabinH),
      ],
      isBus && glowStrength > 0.25 ? '#fde68a' : '#1e3a5f',
      'rgba(255,255,255,0.35)'
    );

    if (frontFacing) {
      poly(
        [
          pt(cabFrontBase, -cabW, bodyH),
          pt(cabFrontBase, cabW, bodyH),
          pt(cabFrontTop, cabW, cabinH),
          pt(cabFrontTop, -cabW, cabinH),
        ],
        '#38bdf8',
        '#e0f2fe'
      );
    } else {
      poly(
        [
          pt(cabBackBase, -cabW, bodyH),
          pt(cabBackBase, cabW, bodyH),
          pt(cabBackTop, cabW, cabinH),
          pt(cabBackTop, -cabW, cabinH),
        ],
        isVan ? bodyColor : '#1e3a5f',
        '#94a3b8'
      );
    }

    // Sunlit elevated 3D cabin roof diamond (Police patrol cars have clean white roof)
    poly(
      [
        pt(cabBackTop, -cabW, cabinH),
        pt(cabFrontTop, -cabW, cabinH),
        pt(cabFrontTop, cabW, cabinH),
        pt(cabBackTop, cabW, cabinH),
      ],
      isBus || isPolice ? '#f8fafc' : bodyColor,
      'rgba(255,255,255,0.55)'
    );
    poly(
      [
        pt(cabBackTop, -cabW, cabinH),
        pt(cabFrontTop, -cabW, cabinH),
        pt(cabFrontTop, cabW, cabinH),
        pt(cabBackTop, cabW, cabinH),
      ],
      'rgba(255, 255, 255, 0.22)'
    );

    if (isBus) {
      poly(
        [
          pt(-halfL * 0.25, -cabW * 0.55, cabinH + 0.5 * s),
          pt(halfL * 0.28, -cabW * 0.55, cabinH + 0.5 * s),
          pt(halfL * 0.28, cabW * 0.55, cabinH + 0.5 * s),
          pt(-halfL * 0.25, cabW * 0.55, cabinH + 0.5 * s),
        ],
        '#cbd5e1',
        '#64748b'
      );
    }
  }

  // 5b. Animated Flashing Emergency Lightbars for Police & Fire Units
  if (isPolice || isFire) {
    const flash = Math.floor(timeSeconds * 7) % 2 === 0;
    const barL = isFire ? halfL * 0.66 : -halfL * 0.05;
    const barZ = cabinH + 0.45 * s;
    const [blx, bly] = pt(barL, -halfW * 0.42, barZ);
    const [brx, bry] = pt(barL, halfW * 0.42, barZ);
    const colA = isPolice ? (flash ? '#38bdf8' : '#ef4444') : (flash ? '#ef4444' : '#facc15');
    const colB = isPolice ? (flash ? '#ef4444' : '#38bdf8') : (flash ? '#facc15' : '#ef4444');

    ctx.fillStyle = colA === '#38bdf8' ? 'rgba(56, 189, 248, 0.34)' : colA === '#facc15' ? 'rgba(250, 204, 21, 0.34)' : 'rgba(239, 68, 68, 0.34)';
    ctx.beginPath();
    ctx.arc(blx, bly, 3.2 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = colB === '#38bdf8' ? 'rgba(56, 189, 248, 0.34)' : colB === '#facc15' ? 'rgba(250, 204, 21, 0.34)' : 'rgba(239, 68, 68, 0.34)';
    ctx.beginPath();
    ctx.arc(brx, bry, 3.2 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = colA;
    ctx.beginPath();
    ctx.arc(blx, bly, 1.1 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = colB;
    ctx.beginPath();
    ctx.arc(brx, bry, 1.1 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  // 6. Glowing 3D Headlights & Taillights on the vertical bumper planes
  const lightCol = frontFacing ? '#fff9c4' : '#ff4d4d';
  const lightR = Math.max(0.85, (0.76 + glowStrength * 0.42) * s);
  for (const lw of [-halfW * 0.62, halfW * 0.62]) {
    const [lx, ly] = pt(endL * 1.02, lw, bodyH * 0.62);
    if (glowStrength > 0.15) {
      ctx.fillStyle = frontFacing
        ? `rgba(255, 245, 180, ${(0.45 * glowStrength).toFixed(3)})`
        : `rgba(255, 70, 70, ${(0.48 * glowStrength).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(lx, ly, lightR * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = lightCol;
    ctx.beginPath();
    ctx.arc(lx, ly, lightR, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Draw a 64-Bit River Vessel in TRUE 3D ISOMETRIC PERSPECTIVE:
 * Supports distinct boat classes passing smoothly under bridges:
 * - 'small': Barco Pequeno / Lancha rápida (compact V-hull, windshield & outboard motor)
 * - 'medium': Barco Médio / Lancha de Passeio ou Barcaça (covered cabin, side glass & roof canopy)
 * - 'yacht': Iate de Luxo (sleek gleaming white hull, teak aft deck, panoramic dark saloon & flybridge)
 * - 'cargo': Navio Cargueiro (stacked ISO containers & bridge tower)
 * - 'cruise': Navio de Cruzeiro (grand white multi-deck liner, balcony cabin bands, pool deck & twin funnels)
 */
function drawShip64(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  dirX: number,
  dirY: number,
  hullColor: string,
  cargoColor: string,
  zoom: number,
  timeSec: number,
  idx: number,
  kind: BoatKind = 'medium',
  simplified: boolean = false
): void {
  const s = Math.max(0.62, zoom);
  const bob = simplified ? 0 : Math.sin(timeSec * 3.2 + idx * 1.7) * 0.75 * s;
  const cy = sy + 2.2 * s + bob;

  const mag = Math.hypot(dirX, dirY) || 1;
  const ux = dirX / mag;
  const uy = dirY / mag;
  const vx = -uy * 1.45;
  const vy = ux * 0.72;

  const isSmall = kind === 'small';
  const isMedium = kind === 'medium';
  const isYacht = kind === 'yacht';
  const isCruise = kind === 'cruise';

  // Giant Cruise Liners span up to ~2×3 tiles in isometric space (`halfL ~ 22.5 * zoom`, `halfW ~ 7.0 * zoom`)!
  const cruiseScale = isCruise ? (idx % 2 === 0 ? 1.0 : 0.86) : 1.0;
  const halfL = (isSmall ? 4.4 : isMedium ? 6.4 : isYacht ? 8.1 : isCruise ? 22.5 * cruiseScale : 9.2) * s;
  const halfW = (isSmall ? 1.55 : isMedium ? 2.15 : isYacht ? 2.45 : isCruise ? 6.8 * cruiseScale : 2.85) * s;
  const hullH = (isSmall ? 1.35 : isMedium ? 1.95 : isYacht ? 2.15 : isCruise ? 4.4 * cruiseScale : 2.7) * s;

  const pt = (l: number, w: number, z: number = 0): [number, number] => [
    sx + l * ux + w * vx,
    cy + l * uy + w * vy - z,
  ];

  const poly = (pts: Array<[number, number]>, fill: string, stroke?: string) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = Math.max(0.55, 0.5 * s);
      ctx.stroke();
    }
  };

  // 1. Foamy V-wake on water surface (skipped in zoomed-out simplified mode)
  if (!simplified) {
    const wakeAlpha = 0.36 + Math.sin(timeSec * 6 + idx) * 0.1;
    ctx.strokeStyle = `rgba(210, 245, 255, ${wakeAlpha.toFixed(2)})`;
    ctx.lineWidth = (isSmall ? 0.95 : isCruise ? 1.5 : 1.25) * s;
    ctx.beginPath();
    const [w0x, w0y] = pt(-halfL * 0.8, -halfW * 0.55, 0);
    const [w1x, w1y] = pt(-halfL * (isSmall ? 1.75 : 1.55), -halfW * 1.4, 0);
    const [w2x, w2y] = pt(-halfL * 0.8, halfW * 0.55, 0);
    const [w3x, w3y] = pt(-halfL * (isSmall ? 1.75 : 1.55), halfW * 1.4, 0);
    ctx.moveTo(w0x, w0y);
    ctx.lineTo(w1x, w1y);
    ctx.moveTo(w2x, w2y);
    ctx.lineTo(w3x, w3y);
    ctx.stroke();
  }

  // 2. Waterline shadow
  poly(
    [
      pt(-halfL * 0.94, -halfW * 1.05, 0),
      pt(halfL * 0.58, -halfW * 1.05, 0),
      pt(halfL * 1.14, 0, 0),
      pt(halfL * 0.58, halfW * 1.05, 0),
      pt(-halfL * 0.94, halfW * 1.05, 0),
    ],
    'rgba(6, 22, 44, 0.45)'
  );

  const nearW = vy >= 0 ? halfW : -halfW;

  // 3. 3D Elevated Ship Hull Side Wall (camera-facing gunwale)
  poly(
    [
      pt(-halfL * 0.9, nearW, 0),
      pt(halfL * 0.55, nearW, 0),
      pt(halfL * 1.08, 0, 0),
      pt(halfL * 1.16, 0, hullH),
      pt(halfL * 0.58, nearW, hullH),
      pt(-halfL * 0.9, nearW, hullH),
    ],
    isCruise ? '#0f294a' : hullColor,
    isYacht || isCruise ? '#94a3b8' : '#0f172a'
  );
  if (!isYacht && !isCruise) {
    poly(
      [
        pt(-halfL * 0.9, nearW, 0),
        pt(halfL * 0.55, nearW, 0),
        pt(halfL * 1.08, 0, 0),
        pt(halfL * 1.16, 0, hullH),
        pt(halfL * 0.58, nearW, hullH),
        pt(-halfL * 0.9, nearW, hullH),
      ],
      'rgba(0, 0, 0, 0.20)'
    );
  } else {
    // Sleek navy/crimson accent stripe along yacht & cruise liner hull
    poly(
      [
        pt(-halfL * 0.86, nearW * 1.01, hullH * 0.25),
        pt(halfL * 0.54, nearW * 1.01, hullH * 0.25),
        pt(halfL * 0.92, nearW * 0.28, hullH * 0.35),
        pt(halfL * 0.92, nearW * 0.28, hullH * 0.58),
        pt(halfL * 0.54, nearW * 1.01, hullH * 0.48),
        pt(-halfL * 0.86, nearW * 1.01, hullH * 0.48),
      ],
      isCruise ? '#f5b73b' : '#0284c7'
    );
  }

  // 4. 3D Upper Main Deck Plane
  const deckCol = isCruise
    ? '#f8fafc'
    : isYacht
      ? '#d6a46c'
      : isSmall
        ? '#e2e8f0'
        : isMedium
          ? '#cbd5e1'
          : '#334155';
  poly(
    [
      pt(-halfL * 0.9, -halfW, hullH),
      pt(halfL * 0.58, -halfW, hullH),
      pt(halfL * 1.16, 0, hullH),
      pt(halfL * 0.58, halfW, hullH),
      pt(-halfL * 0.9, halfW, hullH),
    ],
    deckCol,
    isCruise ? '#64748b' : hullColor
  );

  if (simplified) return;

  // 5. 3D Isometric Box Helper
  const drawIsoBox = (
    l0: number,
    l1: number,
    w0: number,
    w1: number,
    z0: number,
    z1: number,
    topCol: string,
    sideCol: string
  ) => {
    const nW = vy >= 0 ? w1 : w0;
    const eL = uy >= 0 ? l1 : l0;
    poly([pt(l0, nW, z0), pt(l1, nW, z0), pt(l1, nW, z1), pt(l0, nW, z1)], sideCol);
    poly([pt(eL, w0, z0), pt(eL, w1, z0), pt(eL, w1, z1), pt(eL, w0, z1)], sideCol);
    poly([pt(l0, w0, z1), pt(l1, w0, z1), pt(l1, w1, z1), pt(l0, w1, z1)], topCol, 'rgba(15,23,42,0.28)');
  };

  if (isSmall) {
    drawIsoBox(
      -halfL * 0.55,
      halfL * 0.15,
      -halfW * 0.62,
      halfW * 0.62,
      hullH,
      hullH + 0.85 * s,
      '#f8fafc',
      '#94a3b8'
    );
    drawIsoBox(
      halfL * 0.05,
      halfL * 0.34,
      -halfW * 0.65,
      halfW * 0.65,
      hullH,
      hullH + 1.35 * s,
      '#7dd3fc',
      '#0284c7'
    );
    drawIsoBox(
      -halfL * 0.98,
      -halfL * 0.72,
      -halfW * 0.26,
      halfW * 0.26,
      hullH * 0.7,
      hullH + 1.15 * s,
      '#334155',
      '#0f172a'
    );
    return;
  }

  if (isMedium) {
    drawIsoBox(
      -halfL * 0.65,
      halfL * 0.32,
      -halfW * 0.72,
      halfW * 0.72,
      hullH,
      hullH + 1.95 * s,
      '#f8fafc',
      '#1e3a5f'
    );
    drawIsoBox(
      -halfL * 0.72,
      halfL * 0.38,
      -halfW * 0.76,
      halfW * 0.76,
      hullH + 1.95 * s,
      hullH + 2.45 * s,
      '#ffffff',
      '#cbd5e1'
    );
    drawIsoBox(
      -halfL * 0.25,
      halfL * 0.05,
      -halfW * 0.35,
      halfW * 0.35,
      hullH + 2.45 * s,
      hullH + 2.95 * s,
      cargoColor,
      cargoColor
    );
    return;
  }

  if (isYacht) {
    poly(
      [
        pt(halfL * 0.15, -halfW * 0.78, hullH + 0.2 * s),
        pt(halfL * 0.56, -halfW * 0.78, hullH + 0.2 * s),
        pt(halfL * 1.02, 0, hullH + 0.2 * s),
        pt(halfL * 0.56, halfW * 0.78, hullH + 0.2 * s),
        pt(halfL * 0.15, halfW * 0.78, hullH + 0.2 * s),
      ],
      '#f8fafc'
    );
    drawIsoBox(
      -halfL * 0.58,
      halfL * 0.36,
      -halfW * 0.74,
      halfW * 0.74,
      hullH,
      hullH + 1.85 * s,
      '#ffffff',
      '#0f172a'
    );
    drawIsoBox(
      -halfL * 0.42,
      halfL * 0.22,
      -halfW * 0.60,
      halfW * 0.60,
      hullH + 1.85 * s,
      hullH + 3.05 * s,
      '#f8fafc',
      '#cbd5e1'
    );
    drawIsoBox(
      halfL * 0.06,
      halfL * 0.24,
      -halfW * 0.52,
      halfW * 0.52,
      hullH + 2.95 * s,
      hullH + 3.65 * s,
      '#38bdf8',
      '#0369a1'
    );
    drawIsoBox(
      -halfL * 0.34,
      -halfL * 0.16,
      -halfW * 0.55,
      halfW * 0.55,
      hullH + 3.05 * s,
      hullH + 4.05 * s,
      '#ffffff',
      '#e2e8f0'
    );
    return;
  }

  if (isCruise) {
    // Monumental ~2×3-tile Cruise Liner: Promenade, 3 balcony cabin tiers, lifeboats, Lido pool, twin funnels & bow helipad!
    const cs = cruiseScale * s;
    // Promenade Deck 1
    drawIsoBox(
      -halfL * 0.86,
      halfL * 0.62,
      -halfW * 0.84,
      halfW * 0.84,
      hullH,
      hullH + 2.6 * cs,
      '#ffffff',
      '#dbe4f0'
    );
    drawIsoBox(
      -halfL * 0.82,
      halfL * 0.58,
      -halfW * 0.86,
      halfW * 0.86,
      hullH + 0.55 * cs,
      hullH + 1.95 * cs,
      '#ffffff',
      '#1e3a5f'
    );
    // Deck 2 (balcony staterooms + navigation bridge wings)
    drawIsoBox(
      -halfL * 0.74,
      halfL * 0.50,
      -halfW * 0.72,
      halfW * 0.72,
      hullH + 2.6 * cs,
      hullH + 4.9 * cs,
      '#ffffff',
      '#e2e8f0'
    );
    drawIsoBox(
      -halfL * 0.70,
      halfL * 0.46,
      -halfW * 0.74,
      halfW * 0.74,
      hullH + 3.1 * cs,
      hullH + 4.3 * cs,
      '#ffffff',
      '#0f294a'
    );
    // Orange lifeboats along promenade deck
    for (const bx of [-0.52, -0.26, 0.0, 0.26]) {
      drawIsoBox(
        halfL * bx,
        halfL * (bx + 0.16),
        nearW * 0.78,
        nearW * 0.96,
        hullH + 0.1 * cs,
        hullH + 0.85 * cs,
        '#f97316',
        '#c2410c'
      );
    }
    // Deck 3 Upper Suites + Sun Lido Pool & Water Slide
    drawIsoBox(
      -halfL * 0.56,
      halfL * 0.36,
      -halfW * 0.56,
      halfW * 0.56,
      hullH + 4.9 * cs,
      hullH + 6.4 * cs,
      '#f8fafc',
      '#cbd5e1'
    );
    drawIsoBox(
      -halfL * 0.18,
      halfL * 0.18,
      -halfW * 0.34,
      halfW * 0.34,
      hullH + 6.35 * cs,
      hullH + 6.65 * cs,
      '#38bdf8',
      '#0284c7'
    );
    // Forward bow observation deck & radar dome
    drawIsoBox(
      halfL * 0.68,
      halfL * 0.88,
      -halfW * 0.30,
      halfW * 0.30,
      hullH,
      hullH + 0.65 * cs,
      '#38bdf8',
      '#e2e8f0'
    );
    // Twin Iconic Cruise Funnels aft
    drawIsoBox(
      -halfL * 0.54,
      -halfL * 0.36,
      -halfW * 0.24,
      halfW * 0.24,
      hullH + 6.4 * cs,
      hullH + 9.2 * cs,
      '#0f172a',
      cargoColor === '#38bdf8' ? '#e11d48' : cargoColor
    );
    drawIsoBox(
      -halfL * 0.28,
      -halfL * 0.12,
      -halfW * 0.22,
      halfW * 0.22,
      hullH + 6.4 * cs,
      hullH + 8.6 * cs,
      '#0f172a',
      cargoColor === '#38bdf8' ? '#e11d48' : cargoColor
    );
    return;
  }

  // 'cargo': Container Cargo Ship
  const drawCargo = () => {
    drawIsoBox(
      -halfL * 0.2,
      halfL * 0.48,
      -halfW * 0.72,
      halfW * 0.72,
      hullH,
      hullH + 2.3 * s,
      cargoColor,
      cargoColor
    );
    drawIsoBox(
      -halfL * 0.05,
      halfL * 0.35,
      -halfW * 0.62,
      halfW * 0.62,
      hullH + 2.3 * s,
      hullH + 4.1 * s,
      '#f5b73b',
      '#d99b26'
    );
  };

  const drawBridge = () => {
    drawIsoBox(
      -halfL * 0.82,
      -halfL * 0.32,
      -halfW * 0.76,
      halfW * 0.76,
      hullH,
      hullH + 3.8 * s,
      '#ffffff',
      '#cbd5e1'
    );
    drawIsoBox(
      -halfL * 0.75,
      -halfL * 0.52,
      -halfW * 0.3,
      halfW * 0.3,
      hullH + 3.8 * s,
      hullH + 5.4 * s,
      '#e05252',
      '#b83232'
    );
  };

  if (uy >= 0) {
    drawBridge();
    drawCargo();
  } else {
    drawCargo();
    drawBridge();
  }
}

/**
 * Draw a 64-Bit Urban Helicopter in TRUE 3D ISOMETRIC PERSPECTIVE:
 * Supports rooftop helipad shadow projection (`shadowAltPx` when landing/parked on a 2×2 skyscraper roof),
 * rounded glass cockpit canopy, tail boom, landing skids, navigation beacons & spinning main rotor.
 */
function drawHelicopter64(
  ctx: CanvasRenderingContext2D,
  groundX: number,
  groundY: number,
  altPx: number,
  shadowAltPx: number,
  dirX: number,
  dirY: number,
  accentColor: string,
  zoom: number,
  rotorAngle: number,
  blink: boolean
): void {
  const s = Math.max(0.75, zoom);
  const mag = Math.hypot(dirX, dirY) || 1;
  const ux = dirX / mag;
  const uy = dirY / mag;
  const vx = -uy * 1.4;
  const vy = ux * 0.72;

  const ptS = (l: number, w: number): [number, number] => [
    groundX + l * ux + w * vx,
    groundY - shadowAltPx + l * uy + w * vy,
  ];
  const ptA = (l: number, w: number, z: number = 0): [number, number] => [
    groundX + l * ux + w * vx,
    groundY - altPx + l * uy + w * vy - z,
  ];
  const poly = (pts: Array<[number, number]>, fill: string, stroke?: string) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }
  };

  // 1. Projected shadow on ground OR rooftop helipad surface
  const shadowAlpha = Math.max(0.16, 0.42 - Math.max(0, altPx - shadowAltPx) * 0.004);
  poly(
    [ptS(-6 * s, -1.6 * s), ptS(4.5 * s, -1.6 * s), ptS(5.8 * s, 0), ptS(4.5 * s, 1.6 * s), ptS(-6 * s, 1.6 * s)],
    `rgba(8, 14, 26, ${shadowAlpha.toFixed(2)})`
  );

  // 2. Landing Skids
  for (const sw of [-1.7 * s, 1.7 * s]) {
    const [k0x, k0y] = ptA(-2.2 * s, sw, 0);
    const [k1x, k1y] = ptA(3.4 * s, sw, 0);
    drawLine64(ctx, k0x, k0y, k1x, k1y, '#334155', 1.2 * s);
  }

  // 3. Tail Boom & Vertical Fin
  const [tb0x, tb0y] = ptA(-1.5 * s, 0, 2.2 * s);
  const [tb1x, tb1y] = ptA(-7.2 * s, 0, 2.7 * s);
  drawLine64(ctx, tb0x, tb0y, tb1x, tb1y, accentColor, 1.9 * s);
  poly(
    [
      ptA(-5.8 * s, 0, 2.5 * s),
      ptA(-7.6 * s, 0, 4.9 * s),
      ptA(-8.3 * s, 0, 4.9 * s),
      ptA(-7.2 * s, 0, 2.4 * s),
    ],
    accentColor
  );

  // 4. Sculpted Fuselage & Glass Cockpit Bubble
  poly(
    [
      ptA(-2.8 * s, -1.55 * s, 1.0 * s),
      ptA(2.6 * s, -1.55 * s, 1.0 * s),
      ptA(4.8 * s, 0, 1.4 * s),
      ptA(2.6 * s, 1.55 * s, 1.0 * s),
      ptA(-2.8 * s, 1.55 * s, 1.0 * s),
    ],
    '#e2e8f0',
    '#475569'
  );
  poly(
    [
      ptA(-2.6 * s, -1.45 * s, 3.2 * s),
      ptA(2.4 * s, -1.45 * s, 3.2 * s),
      ptA(4.7 * s, 0, 1.9 * s),
      ptA(2.4 * s, 1.45 * s, 3.2 * s),
      ptA(-2.6 * s, 1.45 * s, 3.2 * s),
    ],
    accentColor
  );
  // Tinted panoramic glass nose canopy
  poly(
    [
      ptA(1.6 * s, -1.25 * s, 3.1 * s),
      ptA(4.5 * s, 0, 2.0 * s),
      ptA(1.6 * s, 1.25 * s, 3.1 * s),
    ],
    '#38bdf8'
  );

  // 5. Spinning Main Rotor Hub, Translucent Rotor Blur Disc & Rotating Blades
  const [hubX, hubY] = ptA(-0.2 * s, 0, 4.3 * s);
  ctx.save();
  ctx.fillStyle = 'rgba(226, 232, 240, 0.22)';
  ctx.beginPath();
  ctx.ellipse(hubX, hubY, 8.2 * s, 4.1 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  const b1x = Math.cos(rotorAngle) * 8.2 * s;
  const b1y = Math.sin(rotorAngle) * 4.1 * s;
  const b2x = Math.cos(rotorAngle + Math.PI / 2) * 8.2 * s;
  const b2y = Math.sin(rotorAngle + Math.PI / 2) * 4.1 * s;
  drawLine64(ctx, hubX - b1x, hubY - b1y, hubX + b1x, hubY + b1y, '#1e293b', 1.5 * s);
  drawLine64(ctx, hubX - b2x, hubY - b2y, hubX + b2x, hubY + b2y, '#475569', 1.3 * s);
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.arc(hubX, hubY, 1.4 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (blink) {
    const [tailX, tailY] = ptA(-7.6 * s, 0, 5.1 * s);
    drawGlow64(ctx, tailX, tailY, 3.2 * s, 'rgba(255, 77, 77, 0.95)', 'rgba(255, 77, 77, 0)');
  }
}

/**
 * Draw a 64-Bit Widebody Commercial Jetliner in TRUE 3D ISOMETRIC PERSPECTIVE:
 * Features cylindrical 3D fuselage depth, under-wing 3D engine nacelles, swept wings,
 * and a tall vertical 3D tail fin extruded upward (-Z) in isometric space!
 */
function drawAirplane64(
  ctx: CanvasRenderingContext2D,
  groundX: number,
  groundY: number,
  altPx: number,
  dirX: number,
  dirY: number,
  accentColor: string,
  zoom: number,
  blink: boolean,
  pitch: number = 0
): void {
  const s = Math.max(0.75, zoom);
  const mag = Math.hypot(dirX, dirY) || 1;
  const ux = dirX / mag;
  const uy = dirY / mag;
  const vx = -uy * 1.4;
  const vy = ux * 0.75;

  const ptG = (l: number, w: number): [number, number] => [
    groundX + l * ux + w * vx,
    groundY + l * uy + w * vy,
  ];
  const ptA = (l: number, w: number, z: number = 0): [number, number] => [
    groundX + l * ux + w * vx,
    groundY - altPx + l * uy + w * vy - z - l * pitch * 0.55,
  ];

  const poly = (pts: Array<[number, number]>, fill: string) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };

  // 1. Grounded isometric silhouette drop shadow (darkens & tightens near runway during landing/takeoff)
  const shadowAlpha = altPx < 10 * zoom ? 0.4 : 0.22;
  poly(
    [ptG(-10 * s, -1.8 * s), ptG(10 * s, -1.8 * s), ptG(10 * s, 1.8 * s), ptG(-10 * s, 1.8 * s)],
    `rgba(8, 14, 26, ${shadowAlpha})`
  );
  poly(
    [
      ptG(2.5 * s, 0),
      ptG(-4 * s, -11 * s),
      ptG(-6.5 * s, -11 * s),
      ptG(-2 * s, 0),
      ptG(-6.5 * s, 11 * s),
      ptG(-4 * s, 11 * s),
    ],
    `rgba(8, 14, 26, ${shadowAlpha})`
  );

  // 2. Twin atmospheric jet contrails (only visible at high cruise/climb altitude, never on the runway)
  if (altPx > 26 * zoom) {
    for (const cw of [-4.8 * s, 4.8 * s]) {
      const [c0x, c0y] = ptA(-4 * s, cw, 0);
      const [c1x, c1y] = ptA(-28 * s, cw, 0);
      drawLine64(ctx, c0x, c0y, c1x, c1y, 'rgba(235, 248, 255, 0.34)', 1.6 * s);
    }
  }

  // 3. Swept 3D Isometric Main Wings & Tail Stabilizers
  poly(
    [
      ptA(3.5 * s, 0, 0.6 * s),
      ptA(-3.8 * s, -11.5 * s, 1.0 * s),
      ptA(-6.5 * s, -11.5 * s, 1.0 * s),
      ptA(-2.2 * s, 0, 0.6 * s),
      ptA(-6.5 * s, 11.5 * s, 1.0 * s),
      ptA(-3.8 * s, 11.5 * s, 1.0 * s),
    ],
    '#cbd5e1'
  );
  poly(
    [
      ptA(-7.2 * s, 0, 0.8 * s),
      ptA(-10.8 * s, -4.8 * s, 1.1 * s),
      ptA(-12.2 * s, -4.8 * s, 1.1 * s),
      ptA(-9.6 * s, 0, 0.8 * s),
      ptA(-12.2 * s, 4.8 * s, 1.1 * s),
      ptA(-10.8 * s, 4.8 * s, 1.1 * s),
    ],
    '#94a3b8'
  );

  // 4. Shaded 3D Lower Fuselage Belly & Sunlit Upper Cabin Crown (extruded in vertical Z!)
  poly(
    [
      ptA(-10.5 * s, -1.7 * s, 0),
      ptA(9.5 * s, -1.7 * s, 0),
      ptA(11.8 * s, 0, 0.8 * s),
      ptA(9.5 * s, 1.7 * s, 0),
      ptA(-10.5 * s, 1.7 * s, 0),
    ],
    '#94a3b8'
  );
  poly(
    [
      ptA(-10.5 * s, -1.6 * s, 2.2 * s),
      ptA(9.5 * s, -1.6 * s, 2.2 * s),
      ptA(12.0 * s, 0, 1.4 * s),
      ptA(9.5 * s, 1.6 * s, 2.2 * s),
      ptA(-10.5 * s, 1.6 * s, 2.2 * s),
    ],
    '#ffffff'
  );

  // Cockpit windshield & airline livery cheatline
  poly(
    [
      ptA(8.0 * s, -1.2 * s, 2.3 * s),
      ptA(10.4 * s, -0.7 * s, 1.7 * s),
      ptA(10.4 * s, 0.7 * s, 1.7 * s),
      ptA(8.0 * s, 1.2 * s, 2.3 * s),
    ],
    '#1e3a5f'
  );

  // 5. Tall Vertical 3D Isometric Tail Fin (extruded upward to z = +7.5*s!)
  poly(
    [
      ptA(-7.2 * s, 0, 2.1 * s),
      ptA(-10.6 * s, 0, 7.6 * s),
      ptA(-12.4 * s, 0, 7.6 * s),
      ptA(-11.2 * s, 0, 2.1 * s),
    ],
    accentColor
  );

  if (blink) {
    const [wlX, wlY] = ptA(-5.0 * s, -11.5 * s, 1.1 * s);
    const [wrX, wrY] = ptA(-5.0 * s, 11.5 * s, 1.1 * s);
    drawGlow64(ctx, wlX, wlY, 3.5 * s, 'rgba(255, 77, 77, 0.95)', 'rgba(255, 77, 77, 0)');
    drawGlow64(ctx, wrX, wrY, 3.5 * s, 'rgba(102, 217, 140, 0.95)', 'rgba(102, 217, 140, 0)');
  }
}

/**
 * Draw crisp 64-Bit Isometric Intersection Traffic Signals (`Sinaleiros`)
 * synchronized with `getTrafficSignalState` so N/S and E/W axes alternate cleanly.
 */
function drawTrafficLight64(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  rot: CameraRotation,
  tile: Tile,
  zoom: number,
  timeSeconds: number,
  glowStrength: number
): void {
  const sig = getTrafficSignalState(tile.x, tile.y, timeSeconds);
  const swapAxes = rot % 2 === 1;
  const visNsGreen = swapAxes ? sig.ewGreen : sig.nsGreen;
  const visNsYellow = swapAxes ? sig.ewYellow : sig.nsYellow;
  const visEwGreen = swapAxes ? sig.nsGreen : sig.ewGreen;
  const visEwYellow = swapAxes ? sig.nsYellow : sig.ewYellow;

  const nsColor = visNsGreen ? '#22c55e' : visNsYellow ? '#facc15' : '#ef4444';
  const ewColor = visEwGreen ? '#22c55e' : visEwYellow ? '#facc15' : '#ef4444';

  const drawSignalPost = (px: number, py: number, armX: number, armY: number, bulbCol: string) => {
    const poleH = 8.5 * zoom;
    const bx = px + armX;
    const by = py - poleH + armY;
    // Steel post & cantilevered arm
    drawLine64(ctx, px, py, px, py - poleH, '#334155', Math.max(1.1, 1.35 * zoom));
    drawLine64(ctx, px, py - poleH, bx, by, '#475569', Math.max(0.9, 1.05 * zoom));

    // Matte black signal housing
    const bw = Math.max(2.6, 3.2 * zoom);
    const bh = Math.max(4.6, 5.6 * zoom);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(bx - bw * 0.5, by - bh * 0.35, bw, bh);
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = Math.max(0.5, 0.55 * zoom);
    ctx.strokeRect(bx - bw * 0.5, by - bh * 0.35, bw, bh);

    // Dimmed inactive slots + bright active signal lens
    const r = Math.max(0.85, 0.95 * zoom);
    const activeY =
      bulbCol === '#ef4444'
        ? by - bh * 0.12
        : bulbCol === '#facc15'
          ? by + bh * 0.15
          : by + bh * 0.42;

    if (glowStrength > 0.08 || zoom >= 0.95) {
      ctx.fillStyle =
        bulbCol === '#22c55e'
          ? 'rgba(34, 197, 94, 0.28)'
          : bulbCol === '#facc15'
            ? 'rgba(250, 204, 21, 0.30)'
            : 'rgba(239, 68, 68, 0.30)';
      ctx.beginPath();
      ctx.arc(bx, activeY, Math.max(2.4, 3.1 * zoom), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = bulbCol;
    ctx.beginPath();
    ctx.arc(bx, activeY, r, 0, Math.PI * 2);
    ctx.fill();
  };

  // Place two cantilevered poles on diagonally opposite sidewalk corners
  drawSignalPost(sx + 10.2 * zoom, sy - 0.6 * zoom, -2.6 * zoom, 1.1 * zoom, nsColor);
  drawSignalPost(sx - 10.2 * zoom, sy + 0.6 * zoom, 2.6 * zoom, -1.1 * zoom, ewColor);
}

/**
 * Main 64-Bit HD Isometric 3D Canvas Renderer with Strict Painter's Algorithm Depth Sorting:
 * 1. Draws the 3D island bedrock skirt.
 * 2. Iterates all tiles `(rx, ry)` in back-to-front isometric order (`sum = rx + ry`):
 *    - First draws ground & road/water tiles (`grass`, `forest`, `water`, `road`, `bridge`).
 *    - Immediately draws any cars/buses currently driving on that road/bridge tile `(tx, ty)`
 *      and any ships on that water tile `(tx, ty)` — so vehicles ALWAYS sit on top of roads/water!
 *    - Draws 3D buildings & structures (`rural`, `residential`, `commercial`, `industrial`,
 *      `park`, `abandoned`, `port`, `stadium`, `airport`), so any foreground building (`higher rx + ry`)
 *      naturally occludes cars driving on streets behind it!
 */
function renderWeatherAtmosphere64(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  season: SeasonId,
  weatherKind: WeatherKind,
  intensity: number,
  windX: number,
  timeSeconds: number,
  zoom: number
): void {
  const s = Math.max(0.6, Math.min(1.4, zoom));

  // Soft drifting isometric cloud shadows during cloudy, rainy, stormy or snowy weather
  if (weatherKind !== 'clear') {
    const cloudCount = weatherKind === 'partly_cloudy' ? 4 : 6;
    const cloudAlpha =
      weatherKind === 'storm' ? 0.13 : weatherKind === 'rain' ? 0.09 : weatherKind === 'snow' ? 0.07 : 0.06;
    ctx.fillStyle = `rgba(15, 25, 42, ${cloudAlpha})`;
    for (let c = 0; c < cloudCount; c++) {
      const seedX = ((c * 397) % 1000) / 1000;
      const seedY = ((c * 613) % 1000) / 1000;
      const cx = (((seedX * (canvasW + 360) + timeSeconds * (18 + windX * 14 + c * 2)) % (canvasW + 360)) + canvasW + 360) % (canvasW + 360) - 180;
      const cy = seedY * canvasH;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 130 * s, 52 * s, -0.15, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Subtle distant storm sheet-lightning pulse (~once every 11s)
  if (weatherKind === 'storm') {
    const stormPhase = timeSeconds % 11.4;
    if (stormPhase < 0.18) {
      const flashAlpha = (1 - stormPhase / 0.18) * 0.16 * Math.max(0.5, intensity);
      ctx.fillStyle = `rgba(218, 236, 255, ${flashAlpha.toFixed(3)})`;
      ctx.fillRect(0, 0, canvasW, canvasH);
    }
  }

  if (weatherKind === 'rain' || weatherKind === 'storm') {
    const count = Math.round((weatherKind === 'storm' ? 145 : 88) * Math.max(0.45, intensity));
    const speedY = (weatherKind === 'storm' ? 560 : 410) * s;
    const tiltX = (windX * 120 + (weatherKind === 'storm' ? 85 : 42)) * s;
    const dropLen = (weatherKind === 'storm' ? 15 : 11) * s;
    ctx.strokeStyle =
      weatherKind === 'storm' ? 'rgba(186, 230, 253, 0.56)' : 'rgba(186, 230, 253, 0.44)';
    ctx.lineWidth = Math.max(1.0, 1.3 * s);
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const h1 = ((i * 7919) % 1009) / 1009;
      const h2 = ((i * 3571) % 1009) / 1009;
      const px = (((h1 * canvasW + timeSeconds * tiltX) % canvasW) + canvasW) % canvasW;
      const py = (((h2 * canvasH + timeSeconds * speedY) % canvasH) + canvasH) % canvasH;
      ctx.moveTo(px, py);
      ctx.lineTo(px + tiltX * (dropLen / speedY), py + dropLen);
    }
    ctx.stroke();

    // Ground/water raindrop splash flecks
    if (zoom > 0.62) {
      const splashCount = Math.floor(count * 0.25);
      ctx.strokeStyle = 'rgba(224, 242, 254, 0.36)';
      ctx.lineWidth = 1;
      for (let i = 0; i < splashCount; i++) {
        const phase = (timeSeconds * 3.4 + i * 0.37) % 1;
        const sx = ((i * 541 + Math.floor(timeSeconds * 3.4 + i * 0.37) * 97) % Math.max(1, Math.floor(canvasW)));
        const sy = ((i * 389 + Math.floor(timeSeconds * 3.4 + i * 0.37) * 149) % Math.max(1, Math.floor(canvasH)));
        const rx = (2 + phase * 4.5) * s;
        ctx.beginPath();
        ctx.ellipse(sx, sy, rx, rx * 0.45, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    return;
  }

  if (weatherKind === 'snow') {
    const count = Math.round(96 * Math.max(0.5, intensity));
    const speedY = 64 * s;
    for (let i = 0; i < count; i++) {
      const h1 = ((i * 6131) % 997) / 997;
      const h2 = ((i * 4219) % 997) / 997;
      const drift = Math.sin(timeSeconds * 1.9 + i * 0.8) * 16 * s + windX * 32 * timeSeconds;
      const px = (((h1 * canvasW + drift) % canvasW) + canvasW) % canvasW;
      const py = (((h2 * canvasH + timeSeconds * (speedY + (i % 4) * 10)) % canvasH) + canvasH) % canvasH;
      const sz = (i % 3 === 0 ? 3.0 : 2.0) * s;
      ctx.fillStyle = i % 4 === 0 ? 'rgba(219, 234, 254, 0.85)' : 'rgba(255, 255, 255, 0.90)';
      ctx.fillRect(px, py, sz, sz);
    }
    return;
  }

  // Seasonal floating foliage / blossoms on calm Autumn & Spring days
  if ((season === 'autumn' || season === 'spring') && zoom > 0.62) {
    const count = 26;
    const speedY = 34 * s;
    for (let i = 0; i < count; i++) {
      const h1 = ((i * 5381) % 991) / 991;
      const h2 = ((i * 2749) % 991) / 991;
      const sway = Math.sin(timeSeconds * 2.2 + i * 1.3) * 22 * s + (windX * 26 + 18) * timeSeconds;
      const px = (((h1 * canvasW + sway) % canvasW) + canvasW) % canvasW;
      const py = (((h2 * canvasH + timeSeconds * (speedY + (i % 3) * 8)) % canvasH) + canvasH) % canvasH;
      ctx.fillStyle =
        season === 'autumn'
          ? i % 3 === 0
            ? 'rgba(249, 115, 22, 0.85)'
            : i % 3 === 1
              ? 'rgba(245, 158, 11, 0.85)'
              : 'rgba(220, 38, 38, 0.80)'
          : i % 3 === 0
            ? 'rgba(249, 168, 212, 0.85)'
            : i % 3 === 1
              ? 'rgba(253, 242, 248, 0.85)'
              : 'rgba(254, 240, 138, 0.80)';
      const sz = 2.4 * s;
      ctx.fillRect(px, py, sz, sz * 0.75);
    }
  }
}

/**
 * Draw 64-bit Isometric Highway Border Portal (`ENTRADA / SAÍDA`) on the outer edge of the permanent External Highway.
 */
function drawExternalBorderPortal64(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  zoom: number,
  timeSeconds: number,
  glowStrength: number
): void {
  const z = zoom;
  ctx.save();
  ctx.translate(sx, sy);

  // Twin steel gantry pillars straddling the 4-lane expressway
  const pillarSpanX = 11.5 * z;
  const pillarH = 14.5 * z;
  const pillarW = Math.max(1.4, 2.2 * z);

  ctx.fillStyle = '#475569';
  ctx.fillRect(-pillarSpanX - pillarW * 0.5, -pillarH, pillarW, pillarH + 2 * z);
  ctx.fillRect(pillarSpanX - pillarW * 0.5, -pillarH, pillarW, pillarH + 2 * z);

  ctx.fillStyle = '#94a3b8';
  ctx.fillRect(-pillarSpanX - pillarW * 0.5, -pillarH, pillarW * 0.45, pillarH);
  ctx.fillRect(pillarSpanX - pillarW * 0.5, -pillarH, pillarW * 0.45, pillarH);

  // Overhead highway directional sign gantry
  const boardW = pillarSpanX * 2 + 4 * z;
  const boardH = Math.max(3.5, 6.2 * z);
  const boardY = -pillarH - boardH * 0.45;

  // Drop shadow
  ctx.fillStyle = 'rgba(10, 18, 32, 0.35)';
  ctx.fillRect(-boardW * 0.5, 1.2 * z, boardW, 2.4 * z);

  // Highway green board with white border
  ctx.fillStyle = '#0f6a44';
  ctx.fillRect(-boardW * 0.5, boardY, boardW, boardH);
  ctx.strokeStyle = '#e2f8ec';
  ctx.lineWidth = Math.max(0.8, 1.0 * z);
  ctx.strokeRect(-boardW * 0.5 + 0.5, boardY + 0.5, boardW - 1, boardH - 1);

  // Animated directional entry/exit chevron LEDs
  const pulse = 0.55 + 0.45 * Math.sin(timeSeconds * 4.5);
  ctx.fillStyle = `rgba(110, 231, 183, ${0.7 + pulse * 0.3})`;
  ctx.fillRect(-boardW * 0.36, boardY + boardH * 0.28, boardW * 0.28, Math.max(1.2, 1.6 * z));
  ctx.fillStyle = `rgba(253, 224, 71, ${0.7 + (1 - pulse) * 0.3})`;
  ctx.fillRect(boardW * 0.08, boardY + boardH * 0.28, boardW * 0.28, Math.max(1.2, 1.6 * z));

  if (glowStrength > 0.25) {
    ctx.fillStyle = `rgba(110, 231, 183, ${glowStrength * 0.22})`;
    ctx.beginPath();
    ctx.arc(0, boardY + boardH * 0.5, boardW * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/**
 * Draw 64-bit Isometric Praça de Pedágio (Toll Plaza) on the External Highway once constructed at 20.000+ hab.
 * Features concrete toll islands, glass booths, tariff-colored canopy LEDs, and animated barrier arms.
 */
function drawTollPlaza64(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  zoom: number,
  tariff: 'low' | 'medium' | 'high',
  timeSeconds: number,
  glowStrength: number
): void {
  const z = zoom;
  const accent =
    tariff === 'low' ? '#4ade80' : tariff === 'high' ? '#fb7185' : '#fbbf24';
  ctx.save();
  ctx.translate(sx, sy);

  // 3 Toll Booth islands across the expressway lanes
  const boothOffsets = [-9.5, 0, 9.5];
  const boothW = Math.max(2.2, 3.6 * z);
  const boothH = Math.max(4.5, 8.2 * z);

  for (let i = 0; i < boothOffsets.length; i++) {
    const bx = boothOffsets[i] * z;
    // Concrete bumper island
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(bx - boothW * 0.65, -1.5 * z, boothW * 1.3, 4.2 * z);
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(bx - boothW * 0.65, 1.6 * z, boothW * 1.3, 1.0 * z);

    // Booth body + blue-tinted service window
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(bx - boothW * 0.5, -boothH, boothW, boothH);
    ctx.fillStyle = glowStrength > 0.2 ? '#fef08a' : '#38bdf8';
    ctx.fillRect(bx - boothW * 0.36, -boothH + 1.4 * z, boothW * 0.72, boothH * 0.45);
  }

  // Animated striped barrier arms between booths
  const gateLift = 0.5 + 0.5 * Math.sin(timeSeconds * 3.1);
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = Math.max(1.0, 1.5 * z);
  for (const gx of [-4.8 * z, 4.8 * z]) {
    ctx.beginPath();
    ctx.moveTo(gx - 2.4 * z, -2.5 * z);
    ctx.lineTo(gx + 2.4 * z, (-2.5 - gateLift * 4.2) * z);
    ctx.stroke();
  }

  // Overhead Toll Plaza Canopy (isometric floating roof with tariff LED fascia)
  const roofW = 28 * z;
  const roofH = 7.4 * z;
  const roofY = -boothH - roofH * 0.85;

  // Canopy underside shadow
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(-roofW * 0.5, roofY + roofH * 0.55, roofW, roofH * 0.5);

  // Canopy roof top deck
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(-roofW * 0.52, roofY, roofW * 1.04, roofH * 0.58);
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = Math.max(0.8, 1.0 * z);
  ctx.strokeRect(-roofW * 0.52, roofY, roofW * 1.04, roofH * 0.58);

  // Glowing tariff fascia strip (Green=Baixa, Gold=Média, Coral=Alta)
  ctx.fillStyle = accent;
  ctx.fillRect(-roofW * 0.48, roofY + roofH * 0.46, roofW * 0.96, Math.max(1.5, 2.2 * z));

  // Lane status beacons
  for (const lx of [-5 * z, 5 * z]) {
    ctx.fillStyle = '#4ade80';
    ctx.fillRect(lx - 1.1 * z, roofY + roofH * 0.14, 2.2 * z, 1.8 * z);
  }

  if (glowStrength > 0.2) {
    ctx.fillStyle =
      tariff === 'low'
        ? `rgba(74, 222, 128, ${glowStrength * 0.24})`
        : tariff === 'high'
          ? `rgba(251, 113, 133, ${glowStrength * 0.24})`
          : `rgba(251, 191, 36, ${glowStrength * 0.24})`;
    ctx.beginPath();
    ctx.arc(0, roofY + roofH * 0.5, roofW * 0.42, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

export function renderCityCanvas(
  ctx: CanvasRenderingContext2D,
  state: CityState,
  cars: CarEntity[],
  particles: ParticleEntity[],
  opts: RenderOptions
): void {
  const renderScale = opts.renderScale ?? 1;
  const canvasW = opts.logicalWidth ?? ctx.canvas.width;
  const canvasH = opts.logicalHeight ?? ctx.canvas.height;
  const { camera } = opts;
  const zoom = camera.zoom;
  const rot = camera.rotation;
  const gw = state.gridWidth;
  const gh = state.gridHeight;

  ctx.save();
  ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);

  // Adaptive Zoom LOD & Sharp Pixel-Art Rendering:
  // - Never downscale/blur at far zoom (`imageSmoothingEnabled = false` always).
  // - At <= 70% zoom (`zoom <= 0.705`), hide all vehicles (cars, boats, planes, helicopters), wakes, and traffic lights to stay ultra-fast while loading more buildings!
  // - Zoomed Close In (>= 1.08): tight frustum culling + render fine micro-details in focus and surrounding radius
  const hideVehiclesAndBoats = shouldHideVehiclesAtZoom(zoom);
  const isVeryFarZoom = zoom <= 0.605;
  const isFarZoom = zoom < 0.82;
  const isCloseZoom = zoom >= 1.08;

  // Dynamic Day / Dusk / Night + 4-Season & Weather atmospheric lighting
  const activeSeason: SeasonId = state.weather?.season ?? getSeasonForMonth(state.month);
  const weatherKind: WeatherKind = state.weather?.kind ?? 'clear';
  const weatherIntensity = state.weather?.intensity ?? 0.5;
  const weatherWindX = state.weather?.windX ?? 0.2;
  const lighting = getLightingState(
    opts.timeOfDay ?? 'auto',
    opts.timeSeconds,
    activeSeason,
    weatherKind,
    weatherIntensity
  );
  const collectGlow = lighting.glowStrength >= 0.06;

  // Always keep crisp sharp pixel edges with zero blur at every zoom level
  ctx.imageSmoothingEnabled = false;

  // Atmospheric backdrop gradient synchronized with time of day
  const bgGrad = ctx.createLinearGradient(0, 0, 0, canvasH);
  bgGrad.addColorStop(0, lighting.skyTop);
  bgGrad.addColorStop(0.55, lighting.skyMid);
  bgGrad.addColorStop(1, lighting.skyBot);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, canvasW, canvasH);

  const animFrame = Math.floor(opts.timeSeconds * 1.8) % 4;
  const halfW = (ISO_TILE_W / 2) * zoom;
  const halfH = (ISO_TILE_H / 2) * zoom;
  const sScale = zoom / HD_SCALE;
  const skirtDepth = 15 * zoom;

  const { rotW, rotH } = getRotatedGridDims(gw, gh, rot);
  const midX = (rotW - 1) / 2;
  const midY = (rotH - 1) / 2;
  const halfCanvasW = canvasW * 0.5;
  const halfCanvasH = canvasH * 0.5;
  const isoHalfWZoom = (ISO_TILE_W * 0.5) * zoom;
  const isoHalfHZoom = (ISO_TILE_H * 0.5) * zoom;
  const panOffsetX = halfCanvasW - camera.panX * zoom;
  const panOffsetY = halfCanvasH - camera.panY * zoom;

  // Focal screen point for foveated detail rendering when zoomed close in ("no foco e um pouco ao redor")
  let focusX = halfCanvasW;
  let focusY = halfCanvasH;
  if (opts.hoveredTile) {
    const hPos = gridToScreen(
      opts.hoveredTile.tx,
      opts.hoveredTile.ty,
      canvasW,
      canvasH,
      camera,
      gw,
      gh
    );
    if (hPos.sx >= 0 && hPos.sx <= canvasW && hPos.sy >= 0 && hPos.sy <= canvasH) {
      focusX = halfCanvasW * 0.38 + hPos.sx * 0.62;
      focusY = halfCanvasH * 0.38 + hPos.sy * 0.62;
    }
  }
  const focusDetailRadius = Math.min(canvasW, canvasH) * (isCloseZoom ? 0.52 : 0.62);
  const focusDetailRadiusSq = focusDetailRadius * focusDetailRadius;

  // Flat list of visible glowing tiles collected during the painter pass (avoids double projection!)
  const glowEntries: Array<{
    sx: number;
    sy: number;
    tx: number;
    ty: number;
    type: string;
    level: number;
    hasEst: boolean;
    isOrigin: boolean;
  }> = [];

  // Pre-compute visible isometric diagonal range [minSum..maxVisSum] so zoomed-in frames skip off-screen diagonals!
  const maxSum = rotW + rotH - 2;
  const topSumFloat =
    ((-halfH * 8 - panOffsetY) / isoHalfHZoom) + midX + midY;
  const botSumFloat =
    ((canvasH + halfH * 12 - panOffsetY) / isoHalfHZoom) + midX + midY;
  const sumMin = Math.max(0, Math.floor(topSumFloat));
  const sumMax = Math.min(maxSum, Math.ceil(botSumFloat));

  // Group live cars and boats by their current rotated isometric depth `sum = rx + ry` (hidden when zoomed <= 60%)
  const carsByDepth = new Map<number, Array<{ car: CarEntity; idx: number }>>();
  if (!hideVehiclesAndBoats) {
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      const cxTile = Math.max(0, Math.min(gw - 1, Math.floor(car.x)));
      const cyTile = Math.max(0, Math.min(gh - 1, Math.floor(car.y)));
      const { rx, ry } = rotateGridCoord(cxTile, cyTile, rot, gw, gh);
      const depth = Math.max(0, Math.min(maxSum, rx + ry));
      if (depth < sumMin || depth > sumMax) continue;
      let bucket = carsByDepth.get(depth);
      if (!bucket) {
        bucket = [];
        carsByDepth.set(depth, bucket);
      }
      bucket.push({ car, idx: i });
    }
  }

  const boats = opts.boats;
  const boatsByDepth = new Map<number, Array<{ boat: BoatEntity; idx: number }>>();
  if (!hideVehiclesAndBoats && boats && boats.length > 0) {
    for (let i = 0; i < boats.length; i++) {
      const boat = boats[i];
      const bxTile = Math.max(0, Math.min(gw - 1, Math.floor(boat.x)));
      const byTile = Math.max(0, Math.min(gh - 1, Math.floor(boat.y)));
      const { rx, ry } = rotateGridCoord(bxTile, byTile, rot, gw, gh);
      const depth = Math.max(0, Math.min(maxSum, rx + ry));
      if (depth < sumMin || depth > sumMax) continue;
      let bucket = boatsByDepth.get(depth);
      if (!bucket) {
        bucket = [];
        boatsByDepth.set(depth, bucket);
      }
      bucket.push({ boat, idx: i });
    }
  }

  // 1. Sculpted 64-Bit 3D Island Bedrock Skirt along front-left & front-right faces
  for (let rx = 0; rx < rotW; rx++) {
    const ry = rotH - 1;
    const dx = rx - midX;
    const dy = ry - midY;
    const sx = panOffsetX + (dx - dy) * isoHalfWZoom;
    const sy = panOffsetY + (dx + dy) * isoHalfHZoom;
    if (sx < -halfW * 2 || sx > canvasW + halfW * 2 || sy < -halfH * 2 || sy > canvasH + halfH * 4) continue;
    const { tx, ty } = unrotateGridCoord(rx, ry, rot, gw, gh);
    const t = getTile(state, tx, ty);

    ctx.beginPath();
    ctx.moveTo(sx - halfW, sy);
    ctx.lineTo(sx, sy + halfH);
    ctx.lineTo(sx, sy + halfH + skirtDepth);
    ctx.lineTo(sx - halfW, sy + skirtDepth);
    ctx.closePath();
    const isWater = Boolean(t && (t.type === 'water' || t.type === 'bridge'));
    ctx.fillStyle = isWater ? '#185382' : '#574433';
    ctx.fill();
  }

  for (let ry = 0; ry < rotH; ry++) {
    const rx = rotW - 1;
    const dx = rx - midX;
    const dy = ry - midY;
    const sx = panOffsetX + (dx - dy) * isoHalfWZoom;
    const sy = panOffsetY + (dx + dy) * isoHalfHZoom;
    if (sx < -halfW * 2 || sx > canvasW + halfW * 2 || sy < -halfH * 2 || sy > canvasH + halfH * 4) continue;
    const { tx, ty } = unrotateGridCoord(rx, ry, rot, gw, gh);
    const t = getTile(state, tx, ty);

    ctx.beginPath();
    ctx.moveTo(sx, sy + halfH);
    ctx.lineTo(sx + halfW, sy);
    ctx.lineTo(sx + halfW, sy + skirtDepth);
    ctx.lineTo(sx, sy + halfH + skirtDepth);
    ctx.closePath();
    const isWater = Boolean(t && (t.type === 'water' || t.type === 'bridge'));
    ctx.fillStyle = isWater ? '#10395c' : '#3b2e24';
    ctx.fill();
  }

  const glintW = Math.max(2, 3.6 * zoom);
  const glintH = Math.max(1, 1.3 * zoom);
  const drawPedestrians = !isFarZoom && zoom >= 0.86;
  const drawWaterGlints = !isFarZoom;

  // Tight horizontal culling margin (tighter when zoomed close in to avoid rendering far offscreen structures)
  const cullXMargin = isCloseZoom ? halfW * 2.4 : halfW * 3.0;
  const cullTopMargin = isCloseZoom ? halfH * 2.5 : halfH * 3.0;
  const cullBotMargin = isCloseZoom ? halfH * 9.5 : halfH * 10.5;

  // 2. Unified Back-to-Front Isometric Painter's Pass:
  //    Pass 2A: Ground, Water (including river channel under bridges!) & Roads
  //    Pass 2B-Boats: Small Boats, Medium Boats, Yachts & Cargo Ships on the water surface
  //    Pass 2B-Bridges: Elevated Bridge Decks, Arches & Pylons drawn OVER boats so boats visibly pass UNDER bridges!
  //    Pass 2B-Cars: Vehicles driving ON TOP of Roads & Bridge Decks
  //    Pass 2C: 3D Buildings & Landmarks naturally occluding streets/vehicles behind them
  const bridgeTilesAtDepth: Array<{ tile: Tile; rx: number; ry: number; sx: number; sy: number }> = [];
  const monthSubProgress = Math.max(
    0,
    Math.min(1, (state.monthElapsedSec ?? 0) / SECONDS_PER_MONTH_1X)
  );
  const getTileWorkProgress01 = (tile: Tile): number => {
    const c = tile.construction;
    if (!c) return 0;
    const total = Math.max(1, c.totalMonths || 1);
    const completed = Math.max(0, total - (c.remainingMonths || 0));
    return Math.max(0.06, Math.min(1, (completed + monthSubProgress) / total));
  };
  const portBerthsByDepth = new Map<
    number,
    Array<{ sx: number; sy: number; level: number; variant: number; rotW: number; rotH: number; berthDir: 'S' | 'E' }>
  >();

  for (let sum = sumMin; sum <= sumMax; sum++) {
    const rxMin = Math.max(0, sum - (rotH - 1));
    const rxMax = Math.min(rotW - 1, sum);

    // Analytic horizontal visibility window along diagonal `sum` (since dx - dy = 2*rx - sum - midX + midY)
    const minDxMinusDy = (-cullXMargin - panOffsetX) / isoHalfWZoom;
    const maxDxMinusDy = (canvasW + cullXMargin - panOffsetX) / isoHalfWZoom;
    const visRxMin = Math.max(rxMin, Math.floor((minDxMinusDy + sum + midX - midY) * 0.5));
    const visRxMax = Math.min(rxMax, Math.ceil((maxDxMinusDy + sum + midX - midY) * 0.5));
    if (visRxMin > visRxMax) continue;

    bridgeTilesAtDepth.length = 0;

    // Pass 2A: Draw ground, water, river channel under bridges, and road tiles at depth `sum`
    for (let rx = visRxMin; rx <= visRxMax; rx++) {
      const ry = sum - rx;
      const { tx, ty } = unrotateGridCoord(rx, ry, rot, gw, gh);
      const tile = state.tiles[ty * gw + tx];
      if (!tile) continue;

      const isGroundOrRoad =
        tile.type === 'grass' ||
        tile.type === 'forest' ||
        tile.type === 'water' ||
        tile.type === 'road' ||
        tile.type === 'bridge';

      if (!isGroundOrRoad) continue;

      const dx = rx - midX;
      const dy = ry - midY;
      const sx = panOffsetX + (dx - dy) * isoHalfWZoom;
      const sy = panOffsetY + (dx + dy) * isoHalfHZoom;

      if (sy < -cullTopMargin || sy > canvasH + cullBotMargin) continue;

      if (tile.type === 'bridge') {
        // Draw river water underneath first so boats pass right over the water and UNDER the elevated bridge deck!
        const waterSprite = getWaterSprite(0, getWaterBankMask(state, rx, ry, rot), activeSeason);
        ctx.drawImage(
          waterSprite.canvas,
          sx - waterSprite.anchorX * sScale,
          sy - waterSprite.anchorY * sScale,
          waterSprite.canvas.width * sScale,
          waterSprite.canvas.height * sScale
        );
        bridgeTilesAtDepth.push({ tile, rx, ry, sx, sy });
        continue;
      }

      const sprite = getTileSprite(state, tile, rx, ry, rot, 0, activeSeason);
      ctx.drawImage(
        sprite.canvas,
        sx - sprite.anchorX * sScale,
        sy - sprite.anchorY * sScale,
        sprite.canvas.width * sScale,
        sprite.canvas.height * sScale
      );

      // Focus-aware micro-details (water glints & sidewalk pedestrians)
      const fdx = sx - focusX;
      const fdy = sy - focusY;
      const inFocusBand = !isCloseZoom || fdx * fdx + fdy * fdy <= focusDetailRadiusSq;

      if (
        drawWaterGlints &&
        inFocusBand &&
        tile.type === 'water' &&
        (tile.x * 7 + tile.y * 13 + animFrame) % 4 === 0
      ) {
        ctx.fillStyle =
          lighting.nightFactor > 0.35
            ? 'rgba(130, 215, 255, 0.48)'
            : 'rgba(204, 244, 255, 0.72)';
        const gx = sx + ((animFrame % 2) * 3 - 2) * zoom;
        const gy = sy + ((tile.variant % 2) - 0.5) * 2 * zoom;
        ctx.beginPath();
        ctx.ellipse(gx, gy, glintW / 2, glintH / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      if (drawPedestrians && inFocusBand && tile.type === 'road' && (tile.level || 1) <= 2) {
        drawTilePedestrians(ctx, sx, sy, tile.x, tile.y, 'road', zoom, opts.timeSeconds);
      }

      if (
        !hideVehiclesAndBoats &&
        tile.type === 'road' &&
        isTrafficLightIntersection(state, tile.x, tile.y)
      ) {
        drawTrafficLight64(
          ctx,
          sx,
          sy,
          rot,
          tile,
          zoom,
          opts.timeSeconds,
          lighting.glowStrength
        );
      }

      if (tile.type === 'road' && isExternalBorderRoadTile(state, tile.x, tile.y)) {
        drawExternalBorderPortal64(
          ctx,
          sx,
          sy,
          zoom,
          opts.timeSeconds,
          lighting.glowStrength
        );
      } else if (
        tile.type === 'road' &&
        state.tollPlaza?.built &&
        isTollPlazaTile(state, tile.x, tile.y)
      ) {
        drawTollPlaza64(
          ctx,
          sx,
          sy,
          zoom,
          state.tollPlaza.tariff,
          opts.timeSeconds,
          lighting.glowStrength
        );
      }

      if (
        collectGlow &&
        inFocusBand &&
        (tile.type === 'road' || tile.type === 'water') &&
        (!isVeryFarZoom || (tile.type === 'road' && (tile.level || 1) >= 2))
      ) {
        glowEntries.push({
          sx,
          sy,
          tx: tile.x,
          ty: tile.y,
          type: tile.type,
          level: tile.level || 1,
          hasEst: false,
          isOrigin: true,
        });
      }

      if (opts.mapFilter === 'pollution' && tile.pollution > 4) {
        const intensity = Math.min(0.68, (tile.pollution / 100) * 0.72);
        strokeOrFillScreenDiamond(
          ctx,
          sx,
          sy,
          halfW,
          halfH,
          tile.pollution >= 40
            ? `rgba(235, 52, 52, ${intensity})`
            : `rgba(245, 138, 45, ${intensity})`
        );
      } else if (opts.mapFilter === 'value' && tile.type !== 'water') {
        const fill =
          tile.landValue >= 62
            ? `rgba(255, 208, 56, ${Math.min(0.58, ((tile.landValue - 40) / 60) * 0.62)})`
            : tile.landValue >= 38
              ? `rgba(74, 214, 130, ${Math.min(0.38, ((tile.landValue - 20) / 60) * 0.42)})`
              : 'rgba(40, 52, 78, 0.34)';
        strokeOrFillScreenDiamond(ctx, sx, sy, halfW, halfH, fill);
      }

      if (tile.evolveFlash > 0 && tile.type === 'road') {
        drawOrganicEvolutionGlow64(
          ctx,
          sx,
          sy,
          halfW,
          halfH,
          zoom,
          tile.evolveFlash,
          tile.type,
          tile.level || 1,
          tile.x,
          tile.y,
          opts.timeSeconds
        );
      }
    }

    // Pass 1B: Subtle Glowing Underground Metro Line & Animated Subterranean Train Light Pulses!
    const metroStations = getMetroNetworkStations(state);
    if (metroStations.length >= 2) {
      const metroScreenPts = metroStations.map((ms) => {
        const mr = rotateGridCoord(ms.x, ms.y, rot, gw, gh);
        const mdx = mr.rx - midX;
        const mdy = mr.ry - midY;
        return {
          sx: panOffsetX + (mdx - mdy) * isoHalfWZoom,
          sy: panOffsetY + (mdx + mdy) * isoHalfHZoom,
        };
      });

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Soft outer glowing subterranean tunnel aura
      ctx.strokeStyle = 'rgba(99, 102, 241, 0.34)';
      ctx.lineWidth = Math.max(2.5, 5.5 * zoom);
      ctx.beginPath();
      ctx.moveTo(metroScreenPts[0].sx, metroScreenPts[0].sy);
      for (let m = 1; m < metroScreenPts.length; m++) {
        ctx.lineTo(metroScreenPts[m].sx, metroScreenPts[m].sy);
      }
      ctx.stroke();

      // Crisp dashed cyan-violet underground rail track
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.72)';
      ctx.lineWidth = Math.max(1.2, 2.2 * zoom);
      ctx.setLineDash([Math.max(3, 6 * zoom), Math.max(2, 4 * zoom)]);
      ctx.beginPath();
      ctx.moveTo(metroScreenPts[0].sx, metroScreenPts[0].sy);
      for (let m = 1; m < metroScreenPts.length; m++) {
        ctx.lineTo(metroScreenPts[m].sx, metroScreenPts[m].sy);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Animated underground metro train light streaks gliding between stations!
      for (let seg = 0; seg < metroScreenPts.length - 1; seg++) {
        const a = metroScreenPts[seg];
        const b = metroScreenPts[seg + 1];
        const cycle = (opts.timeSeconds * 0.28 + seg * 0.37) % 2;
        const t = cycle <= 1 ? cycle : 2 - cycle;
        const tx = a.sx + (b.sx - a.sx) * t;
        const ty = a.sy + (b.sy - a.sy) * t;
        const tTail = Math.max(0, Math.min(1, t + (cycle <= 1 ? -0.10 : 0.10)));
        const tailX = a.sx + (b.sx - a.sx) * tTail;
        const tailY = a.sy + (b.sy - a.sy) * tTail;

        ctx.strokeStyle = 'rgba(224, 242, 254, 0.92)';
        ctx.lineWidth = Math.max(1.8, 3.2 * zoom);
        ctx.beginPath();
        ctx.moveTo(tailX, tailY);
        ctx.lineTo(tx, ty);
        ctx.stroke();

        drawGlow64(ctx, tx, ty, Math.max(4, 8 * zoom), 'rgba(56, 189, 248, 0.85)');
      }

      ctx.restore();
    }

    // Targeted pre-draw ONLY for the exact 1-2 destination road/water tiles at `sum + 1` under active vehicles
    // (Replaces full-diagonal re-draw, eliminating ~95% of redundant tile drawImage calls in dense cities!)
    const depthBoats = boatsByDepth.get(sum);
    const depthCars = carsByDepth.get(sum);
    if ((depthCars || depthBoats) && sum + 1 <= maxSum) {
      let drawnKeys: Set<number> | null = null;
      const predrawTargetTile = (targetTx: number, targetTy: number) => {
        const nt = getTile(state, targetTx, targetTy);
        if (!nt || (nt.type !== 'road' && nt.type !== 'water')) return;
        const { rx: nrx, ry: nry } = rotateGridCoord(targetTx, targetTy, rot, gw, gh);
        if (nrx + nry !== sum + 1) return;
        const key = targetTy * gw + targetTx;
        if (!drawnKeys) drawnKeys = new Set<number>();
        if (drawnKeys.has(key)) return;
        drawnKeys.add(key);

        const dx = nrx - midX;
        const dy = nry - midY;
        const sx = panOffsetX + (dx - dy) * isoHalfWZoom;
        const sy = panOffsetY + (dx + dy) * isoHalfHZoom;
        if (sx < -halfW * 2 || sx > canvasW + halfW * 2 || sy < -halfH * 2 || sy > canvasH + halfH * 2) {
          return;
        }
        const sprite = getTileSprite(state, nt, nrx, nry, rot, 0, activeSeason);
        ctx.drawImage(
          sprite.canvas,
          sx - sprite.anchorX * sScale,
          sy - sprite.anchorY * sScale,
          sprite.canvas.width * sScale,
          sprite.canvas.height * sScale
        );
      };

      if (depthCars) {
        for (let ci = 0; ci < depthCars.length; ci++) {
          const c = depthCars[ci].car;
          predrawTargetTile(c.toX, c.toY);
        }
      }
      if (depthBoats) {
        for (let bi = 0; bi < depthBoats.length; bi++) {
          const b = depthBoats[bi].boat;
          predrawTargetTile(b.toX, b.toY);
        }
      }
    }

    // Pass 2B-0: Draw Front-Side Port Piers & Moored Cruise/Cargo Ships over already-drawn river water tiles
    const depthPortBerths = portBerthsByDepth.get(sum);
    if (depthPortBerths) {
      for (let pi = 0; pi < depthPortBerths.length; pi++) {
        const pb = depthPortBerths[pi];
        const berthSprite = getPortBerthSprite(pb.level, pb.variant, pb.rotW, pb.rotH, pb.berthDir);
        ctx.drawImage(
          berthSprite.canvas,
          pb.sx - berthSprite.anchorX * sScale,
          pb.sy - berthSprite.anchorY * sScale,
          berthSprite.canvas.width * sScale,
          berthSprite.canvas.height * sScale
        );
      }
    }

    // Pass 2B-1: Draw 3D Isometric Small Boats, Medium Boats, Yachts, Cargo & 2×3 Cruise Liners on the river
    // (Drawn BEFORE bridge superstructures so river boats visibly sail UNDER bridges; cruise liners route strictly to bridge-free ports!)
    if (depthBoats) {
      for (const { boat, idx } of depthBoats) {
        const pos = gridToScreen(boat.x - 0.5, boat.y - 0.5, canvasW, canvasH, camera, gw, gh);
        if (pos.sx < -160 || pos.sx > canvasW + 160 || pos.sy < -160 || pos.sy > canvasH + 160) continue;
        const dest = gridToScreen(boat.toX, boat.toY, canvasW, canvasH, camera, gw, gh);
        const orig = gridToScreen(boat.fromX, boat.fromY, canvasW, canvasH, camera, gw, gh);
        drawShip64(
          ctx,
          pos.sx,
          pos.sy,
          dest.sx - orig.sx,
          dest.sy - orig.sy,
          boat.hullColor,
          boat.cargoColor,
          zoom,
          opts.timeSeconds,
          idx,
          boat.kind ?? 'medium',
          isVeryFarZoom
        );
      }
    }

    // Pass 2B-2: Draw Elevated Bridge Superstructures
    for (let bi = 0; bi < bridgeTilesAtDepth.length; bi++) {
      const { tile, rx, ry, sx, sy } = bridgeTilesAtDepth[bi];
      const sprite = getTileSprite(state, tile, rx, ry, rot, 0);
      ctx.drawImage(
        sprite.canvas,
        sx - sprite.anchorX * sScale,
        sy - sprite.anchorY * sScale,
        sprite.canvas.width * sScale,
        sprite.canvas.height * sScale
      );

      if (tile.construction) {
        drawPublicWorkConstructionSite64(
          ctx,
          sx,
          sy,
          halfW,
          halfH,
          zoom,
          tile,
          getTileWorkProgress01(tile),
          opts.timeSeconds
        );
      }

      if (collectGlow) {
        glowEntries.push({
          sx,
          sy,
          tx: tile.x,
          ty: tile.y,
          type: 'bridge',
          level: tile.level || 1,
          hasEst: false,
          isOrigin: true,
        });
      }

      if (opts.mapFilter === 'pollution' && tile.pollution > 4) {
        const intensity = Math.min(0.68, (tile.pollution / 100) * 0.72);
        strokeOrFillScreenDiamond(
          ctx,
          sx,
          sy,
          halfW,
          halfH,
          tile.pollution >= 40
            ? `rgba(235, 52, 52, ${intensity})`
            : `rgba(245, 138, 45, ${intensity})`
        );
      }
    }

    // Pass 2B-3: Draw 8-Class Vehicles (including Police & Fire units) ON TOP of Roads & Bridge Decks
    if (depthCars) {
      for (const { car, idx } of depthCars) {
        const pos = gridToScreen(car.x - 0.5, car.y - 0.5, canvasW, canvasH, camera, gw, gh);
        if (pos.sx < -24 || pos.sx > canvasW + 24 || pos.sy < -24 || pos.sy > canvasH + 24) continue;
        const dest = gridToScreen(car.toX, car.toY, canvasW, canvasH, camera, gw, gh);
        const orig = gridToScreen(car.fromX, car.fromY, canvasW, canvasH, camera, gw, gh);
        // Lift cars slightly when driving across an elevated bridge deck
        const carTile = getTile(state, Math.floor(car.x), Math.floor(car.y));
        const bridgeLift =
          carTile?.type === 'bridge'
            ? ((carTile.variant || 0) === 1 || (carTile.level || 1) >= 2 ? 3.5 : 2.8) * zoom
            : 0;
        const fdx = pos.sx - focusX;
        const fdy = pos.sy - focusY;
        const useFastCar =
          isFarZoom || (isCloseZoom && fdx * fdx + fdy * fdy > focusDetailRadiusSq * 1.35);

        if (useFastCar) {
          drawCarFast64(
            ctx,
            pos.sx,
            pos.sy - bridgeLift,
            dest.sx - orig.sx,
            dest.sy - orig.sy,
            car.color,
            zoom,
            lighting.glowStrength,
            car.kind ?? getVehicleKind(idx),
            opts.timeSeconds
          );
        } else {
          drawCar64(
            ctx,
            pos.sx,
            pos.sy - bridgeLift,
            dest.sx - orig.sx,
            dest.sy - orig.sy,
            car.color,
            zoom,
            idx,
            lighting.glowStrength,
            car.kind,
            opts.timeSeconds
          );
        }
      }
    }

    // Pass 2C: Draw 3D Buildings & Landmarks at depth `sum` (naturally occluding vehicles behind them!)
    for (let rx = visRxMin; rx <= visRxMax; rx++) {
      const ry = sum - rx;
      const { tx, ty } = unrotateGridCoord(rx, ry, rot, gw, gh);
      const tile = state.tiles[ty * gw + tx];
      if (!tile) continue;

      const isGroundOrRoad =
        tile.type === 'grass' ||
        tile.type === 'forest' ||
        tile.type === 'water' ||
        tile.type === 'road' ||
        tile.type === 'bridge';

      if (isGroundOrRoad && !tile.construction) continue;

      const dx = rx - midX;
      const dy = ry - midY;
      const sx = panOffsetX + (dx - dy) * isoHalfWZoom;
      const sy = panOffsetY + (dx + dy) * isoHalfHZoom;

      if (sy < -cullTopMargin || sy > canvasH + cullBotMargin) continue;

      if (tile.construction) {
        if (!isGroundOrRoad) {
          const sprite = getTileSprite(state, tile, rx, ry, rot, 0, activeSeason);
          ctx.drawImage(
            sprite.canvas,
            sx - sprite.anchorX * sScale,
            sy - sprite.anchorY * sScale,
            sprite.canvas.width * sScale,
            sprite.canvas.height * sScale
          );
        }
        if (!isGroundOrRoad || tile.type !== 'bridge') {
          drawPublicWorkConstructionSite64(
            ctx,
            sx,
            sy,
            halfW,
            halfH,
            zoom,
            tile,
            getTileWorkProgress01(tile),
            opts.timeSeconds
          );
        }
      } else {
        const constructionStage = getTileConstructionStage(tile.evolveFlash, tile.type);

        if (constructionStage === 1 || constructionStage === 2) {
          drawConstructionStage64(
            ctx,
            sx,
            sy,
            halfW,
            halfH,
            zoom,
            tile.type,
            tile.level || 1,
            tile.x,
            tile.y,
            constructionStage,
            opts.timeSeconds
          );
        } else {
          const sprite = getTileSprite(state, tile, rx, ry, rot, 0, activeSeason);
          ctx.drawImage(
            sprite.canvas,
            sx - sprite.anchorX * sScale,
            sy - sprite.anchorY * sScale,
            sprite.canvas.width * sScale,
            sprite.canvas.height * sScale
          );
          if (constructionStage === 3) {
            drawConstructionStage64(
              ctx,
              sx,
              sy,
              halfW,
              halfH,
              zoom,
              tile.type,
              tile.level || 1,
              tile.x,
              tile.y,
              3,
              opts.timeSeconds
            );
          }
        }
      }

      if (tile.type === 'port') {
        const lotW = tile.lotWidth ?? 1;
        const lotH = tile.lotHeight ?? 1;
        if (lotW > 1 || lotH > 1) {
          const rotLot = getRotatedLotCoords(lotW, lotH, tile.lotDx ?? 0, tile.lotDy ?? 0, rot);
          if (rotLot.isFrontCorner) {
            const waterMask = getPortWaterEdgeMask(state, tile, rot);
            const berthDir =
              (waterMask & 4) !== 0
                ? 'S'
                : (waterMask & 2) !== 0
                  ? 'E'
                  : (waterMask & 1) !== 0
                    ? 'N'
                    : (waterMask & 8) !== 0
                      ? 'W'
                      : 'S';
            if (berthDir === 'S' || berthDir === 'E') {
              const berthDepth = sum + 2;
              let bucket = portBerthsByDepth.get(berthDepth);
              if (!bucket) {
                bucket = [];
                portBerthsByDepth.set(berthDepth, bucket);
              }
              bucket.push({
                sx,
                sy,
                level: tile.level || 1,
                variant: tile.variant,
                rotW: rotLot.rotW,
                rotH: rotLot.rotH,
                berthDir,
              });
            }
          }
        }
      }

      const fdx = sx - focusX;
      const fdy = sy - focusY;
      const inFocusBand = !isCloseZoom || fdx * fdx + fdy * fdy <= focusDetailRadiusSq;

      // Subtle living pedestrians strolling in parks & public plazas inside focal band
      if (
        drawPedestrians &&
        inFocusBand &&
        (tile.type === 'park' || tile.establishmentId === 'fountain_plaza')
      ) {
        drawTilePedestrians(
          ctx,
          sx,
          sy,
          tile.x,
          tile.y,
          tile.establishmentId === 'fountain_plaza' ? 'plaza' : 'park',
          zoom,
          opts.timeSeconds
        );
      }

      if (
        collectGlow &&
        inFocusBand &&
        tile.type !== 'abandoned' &&
        tile.type !== 'rural' &&
        (!isVeryFarZoom || (tile.level || 1) >= 2 || Boolean(tile.establishmentId))
      ) {
        glowEntries.push({
          sx,
          sy,
          tx: tile.x,
          ty: tile.y,
          type: tile.type,
          level: tile.level || 1,
          hasEst: Boolean(tile.establishmentId),
          isOrigin: (tile.lotDx ?? 0) === 0 && (tile.lotDy ?? 0) === 0,
        });
      }

      if (opts.mapFilter === 'pollution') {
        if (tile.pollution > 4) {
          const intensity = Math.min(0.68, (tile.pollution / 100) * 0.72);
          strokeOrFillScreenDiamond(
            ctx,
            sx,
            sy,
            halfW,
            halfH,
            tile.pollution >= 40
              ? `rgba(235, 52, 52, ${intensity})`
              : `rgba(245, 138, 45, ${intensity})`
          );
        } else if (tile.type === 'park' || tile.type === 'rural') {
          strokeOrFillScreenDiamond(ctx, sx, sy, halfW, halfH, 'rgba(72, 214, 128, 0.22)');
        }
      } else if (opts.mapFilter === 'value') {
        const fill =
          tile.landValue >= 62
            ? `rgba(255, 208, 56, ${Math.min(0.58, ((tile.landValue - 40) / 60) * 0.62)})`
            : tile.landValue >= 38
              ? `rgba(74, 214, 130, ${Math.min(0.38, ((tile.landValue - 20) / 60) * 0.42)})`
              : 'rgba(40, 52, 78, 0.34)';
        strokeOrFillScreenDiamond(ctx, sx, sy, halfW, halfH, fill);
      }

      if (tile.evolveFlash > 0) {
        drawOrganicEvolutionGlow64(
          ctx,
          sx,
          sy,
          halfW,
          halfH,
          zoom,
          tile.evolveFlash,
          tile.type,
          tile.level || 1,
          tile.x,
          tile.y,
          opts.timeSeconds
        );
      }
    }
  }

  // Flush any front-side port berths whose depth landed just past sumMax
  for (let extraSum = sumMax + 1; extraSum <= sumMax + 2; extraSum++) {
    const extraBerths = portBerthsByDepth.get(extraSum);
    if (!extraBerths) continue;
    for (let pi = 0; pi < extraBerths.length; pi++) {
      const pb = extraBerths[pi];
      const berthSprite = getPortBerthSprite(pb.level, pb.variant, pb.rotW, pb.rotH, pb.berthDir);
      ctx.drawImage(
        berthSprite.canvas,
        pb.sx - berthSprite.anchorX * sScale,
        pb.sy - berthSprite.anchorY * sScale,
        berthSprite.canvas.width * sScale,
        berthSprite.canvas.height * sScale
      );
    }
  }

  // 3. Soft Volumetric 64-Bit Particles (sparkle/evolution particles remain visible even when zoomed out <= 70%)
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    if (!p.active) continue;
    if ((hideVehiclesAndBoats || isFarZoom) && p.kind === 'wake') continue;
    if (hideVehiclesAndBoats && p.kind === 'smoke') continue;
    const { sx, sy } = gridToScreen(p.x - 0.5, p.y - 0.5, canvasW, canvasH, camera, gw, gh);
    if (sx < -20 || sx > canvasW + 20 || sy < -20 || sy > canvasH + 20) continue;
    if (isCloseZoom) {
      const fdx = sx - focusX;
      const fdy = sy - focusY;
      if (fdx * fdx + fdy * fdy > focusDetailRadiusSq * 1.35) continue;
    }

    const alpha = Math.max(0, Math.min(1, p.life / p.maxLife));
    const elapsed = p.maxLife - p.life;
    const riseOffset =
      p.kind === 'wake'
        ? -2.5 * zoom
        : (p.kind === 'smoke' ? 20 + elapsed * 14 : 10 + elapsed * 20) * zoom;
    const radius = Math.max(
      1.3,
      p.size * zoom * (p.kind === 'smoke' ? 0.85 + elapsed * 0.45 : 0.65)
    );

    ctx.globalAlpha =
      p.kind === 'smoke' ? alpha * 0.45 : p.kind === 'wake' ? alpha * 0.45 : alpha * 0.92;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(sx, sy - riseOffset, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 4. High-Flying 64-Bit Isometric Widebody Commercial Jetliners (hidden when <= 70% zoom or parked inside Galpões!)
  const planes = opts.planes;
  const blink = Math.floor(opts.timeSeconds * 4) % 2 === 0;
  if (!hideVehiclesAndBoats && planes && planes.length > 0) {
    for (let i = 0; i < planes.length; i++) {
      const plane = planes[i];
      if (plane.phase === 'in_hangar') continue;
      const ground = gridToScreen(
        plane.x - 0.5,
        plane.y - 0.5,
        canvasW,
        canvasH,
        camera,
        gw,
        gh
      );
      if (
        ground.sx < -90 ||
        ground.sx > canvasW + 90 ||
        ground.sy < -90 ||
        ground.sy > canvasH + 90
      ) {
        continue;
      }
      const ahead = gridToScreen(
        plane.x - 0.5 + plane.vx * 0.25,
        plane.y - 0.5 + plane.vy * 0.25,
        canvasW,
        canvasH,
        camera,
        gw,
        gh
      );

      const altPx = plane.altitude * zoom;
      drawAirplane64(
        ctx,
        ground.sx,
        ground.sy,
        altPx,
        ahead.sx - ground.sx,
        ahead.sy - ground.sy,
        plane.accentColor,
        zoom,
        blink,
        plane.pitch ?? 0
      );
    }
  }

  // 4A. Urban & Rooftop-Helipad Helicopters (hidden when <= 70% zoom)
  const helicopters = opts.helicopters;
  if (!hideVehiclesAndBoats && helicopters && helicopters.length > 0) {
    for (let i = 0; i < helicopters.length; i++) {
      const heli = helicopters[i];
      const ground = gridToScreen(
        heli.x - 0.5,
        heli.y - 0.5,
        canvasW,
        canvasH,
        camera,
        gw,
        gh
      );
      if (
        ground.sx < -90 ||
        ground.sx > canvasW + 90 ||
        ground.sy < -90 ||
        ground.sy > canvasH + 140
      ) {
        continue;
      }
      const ahead = gridToScreen(
        heli.x - 0.5 + heli.vx * 0.25,
        heli.y - 0.5 + heli.vy * 0.25,
        canvasW,
        canvasH,
        camera,
        gw,
        gh
      );
      const isPadPhase =
        heli.phase === 'approach' ||
        heli.phase === 'descending' ||
        heli.phase === 'landed' ||
        heli.phase === 'ascending';
      const shadowAltPx = isPadPhase ? (heli.targetAlt ?? 0) * zoom : 0;
      drawHelicopter64(
        ctx,
        ground.sx,
        ground.sy,
        heli.altitude * zoom,
        shadowAltPx,
        ahead.sx - ground.sx,
        ahead.sy - ground.sy,
        heli.accentColor,
        zoom,
        heli.rotorAngle,
        blink
      );
    }
  }

  // 4B. Atmospheric Dusk / Night Grading & Emissive City Glow Pass (Windows, Streetlamps, Water, Signs)
  const isBlackoutActive = state.activeUrbanIncident?.id === 'blackout';
  if (collectGlow || isBlackoutActive) {
    ctx.save();
    if (opts.mapFilter === 'normal') {
      if (collectGlow) {
        ctx.fillStyle = lighting.ambientVeil;
        ctx.fillRect(0, 0, canvasW, canvasH);
        if (lighting.duskFactor > 0.04) {
          const rimGrad = ctx.createLinearGradient(0, 0, canvasW * 0.85, canvasH * 0.65);
          rimGrad.addColorStop(0, lighting.warmRimVeil);
          rimGrad.addColorStop(1, 'rgba(255, 130, 58, 0)');
          ctx.fillStyle = rimGrad;
          ctx.fillRect(0, 0, canvasW, canvasH);
        }
      }
      if (isBlackoutActive) {
        // Temporary power outage atmosphere dims the city noticeably until resolved!
        ctx.fillStyle = 'rgba(10, 14, 28, 0.34)';
        ctx.fillRect(0, 0, canvasW, canvasH);
      }
    }

    if (collectGlow) {
      ctx.globalCompositeOperation = 'lighter';
      const effectiveGlow = isBlackoutActive
        ? lighting.glowStrength * 0.14
        : lighting.glowStrength;
      const glowStep = isVeryFarZoom ? 2 : 1;
      for (let i = 0; i < glowEntries.length; i += glowStep) {
        const g = glowEntries[i];
        drawTileNightGlow(
          ctx,
          g.sx,
          g.sy,
          g.tx,
          g.ty,
          g.type,
          g.level,
          zoom,
          effectiveGlow,
          opts.timeSeconds,
          g.hasEst,
          g.isOrigin
        );
      }
    }
    ctx.restore();
  }

  // 4C. Live Dynamic Weather Particles & Seasonal Atmosphere (Rain, Storm, Snow, Autumn Leaves, Spring Blossoms)
  renderWeatherAtmosphere64(
    ctx,
    canvasW,
    canvasH,
    activeSeason,
    weatherKind,
    weatherIntensity,
    weatherWindX,
    opts.timeSeconds,
    zoom
  );

  // 5. Hovered Tile Crisp Isometric Outline
  if (opts.hoveredTile) {
    const { sx, sy } = gridToScreen(
      opts.hoveredTile.tx,
      opts.hoveredTile.ty,
      canvasW,
      canvasH,
      camera,
      gw,
      gh
    );
    strokeOrFillScreenDiamond(
      ctx,
      sx,
      sy,
      halfW,
      halfH,
      'rgba(255, 255, 255, 0.14)',
      '#ffe066',
      Math.max(1.5, zoom)
    );
  }

  ctx.restore();
}

/**
 * Render a dedicated 64-Bit HD Scenic Illustration + Live Isometric Diorama Card
 * for the Port ('port'), Airport ('airport'), or River Bridge ('bridge') inside Obras Evolutivas!
 */
export function renderLandmarkArtworkCanvas(
  ctx: CanvasRenderingContext2D,
  kind: 'port' | 'airport' | 'bridge' | 'bus' | 'metro' | 'shopping',
  level: number,
  unlocked: boolean,
  timeSec: number = 0
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const maxLv = kind === 'bridge' ? 4 : 3;
  const lv = Math.max(1, Math.min(maxLv, level || 1));
  const blink = Math.floor(timeSec * 3) % 2 === 0;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, w, h);

  if (kind === 'bridge') {
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.62);
    sky.addColorStop(0, '#0e1b33');
    sky.addColorStop(1, '#224773');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h * 0.62);

    const waterY = Math.floor(h * 0.62);
    const water = ctx.createLinearGradient(0, waterY, 0, h);
    water.addColorStop(0, '#1e6aa3');
    water.addColorStop(1, '#0d3252');
    ctx.fillStyle = water;
    ctx.fillRect(0, waterY, w, h - waterY);

    ctx.fillStyle = 'rgba(150, 224, 255, 0.55)';
    for (let wx = 8; wx < w - 12; wx += 18) {
      const wy = waterY + 6 + ((wx * 5) % (h - waterY - 12));
      const shift = Math.sin(timeSec * 2.2 + wx) * 2.5;
      ctx.beginPath();
      ctx.ellipse(wx + shift, wy, 4.5, 1.1, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    const deckY = waterY - 14;
    if (lv === 1) {
      ctx.fillStyle = '#9e9483';
      ctx.fillRect(8, deckY + 2, 108, 12);
      ctx.fillStyle = '#1e6aa3';
      ctx.beginPath();
      ctx.arc(33, deckY + 14, 13, Math.PI, 0);
      ctx.arc(83, deckY + 14, 13, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = '#dfd5c3';
      ctx.fillRect(8, deckY, 108, 3);
      ctx.fillStyle = '#786655';
      ctx.fillRect(8, deckY + 2.5, 108, 2);
      for (const lx of [20, 58, 96]) {
        drawLine64(ctx, lx, deckY, lx, deckY - 10, '#2a303b', 1.8);
        drawGlow64(ctx, lx, deckY - 12, 6, 'rgba(255, 232, 130, 0.9)');
        ctx.fillStyle = '#fff5bd';
        ctx.beginPath();
        ctx.arc(lx, deckY - 12, 2.0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (lv === 2) {
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(18, deckY + 4, 8, 16);
      ctx.fillRect(94, deckY + 4, 8, 16);
      ctx.fillStyle = '#334155';
      ctx.fillRect(8, deckY, 108, 5);
      drawLine64(ctx, 12, deckY + 2.5, 110, deckY + 2.5, '#ffe066', 1.2);
      let prevX = 14;
      let prevY = deckY - 2;
      for (let x = 18; x <= 106; x += 4) {
        const t = (x - 60) / 46;
        const archY = deckY - 2 - (1 - t * t) * 27;
        drawLine64(ctx, prevX, prevY, x, archY, '#c93434', 3.2);
        drawLine64(ctx, prevX, prevY - 1.2, x, archY - 1.2, '#ff8066', 1.2);
        if (x % 8 === 2) {
          drawLine64(ctx, x, archY + 1, x, deckY, '#d94848', 1.3);
        }
        prevX = x;
        prevY = archY;
      }
    } else if (lv === 3) {
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(54, deckY + 4, 10, 16);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(6, deckY, 112, 5);
      drawLine64(ctx, 6, deckY - 1, 118, deckY - 1, '#ffffff', 1.6);
      drawLine64(ctx, 10, deckY + 2.5, 114, deckY + 2.5, '#ffe066', 1.2);
      const peakX = 59;
      const peakY = 11;
      for (const tx of [12, 24, 36, 46, 72, 82, 94, 108]) {
        drawLine64(ctx, peakX, peakY + 4, tx, deckY - 1, 'rgba(224, 242, 254, 0.85)', 1.1);
      }
      drawLine64(ctx, 51, deckY, peakX, peakY, '#ffffff', 3.0);
      drawLine64(ctx, 67, deckY, peakX, peakY, '#cbd5e1', 3.0);
      drawLine64(ctx, peakX, peakY + 6, peakX, peakY + 24, '#38bdf8', 2.0);
      drawGlow64(
        ctx,
        peakX,
        peakY - 3,
        6,
        blink ? 'rgba(255, 77, 77, 0.9)' : 'rgba(245, 183, 59, 0.7)'
      );
      ctx.fillStyle = blink ? '#ff4d4d' : '#f5b73b';
      ctx.beginPath();
      ctx.arc(peakX, peakY - 3, 1.8, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Nv. 4: Twin-Tower 2-Tile-Wide Monumental Golden-Cyan Mega-Bridge Profile
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(32, deckY + 5, 9, 16);
      ctx.fillRect(78, deckY + 5, 9, 16);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(4, deckY - 1, 116, 7);
      drawLine64(ctx, 4, deckY - 1.5, 120, deckY - 1.5, '#ffffff', 1.5);
      drawLine64(ctx, 4, deckY + 1.5, 120, deckY + 1.5, '#ffe066', 1.3);
      drawLine64(ctx, 4, deckY + 5.2, 120, deckY + 5.2, '#38bdf8', 1.3);

      for (const peakX of [36, 82]) {
        const peakY = 9;
        for (const dx of [-28, -20, -12, 12, 20, 28]) {
          drawLine64(
            ctx,
            peakX,
            peakY + 4,
            Math.max(6, Math.min(118, peakX + dx)),
            deckY - 1,
            Math.abs(dx) > 18 ? 'rgba(254, 240, 138, 0.85)' : 'rgba(224, 242, 254, 0.85)',
            1.05
          );
        }
        drawLine64(ctx, peakX - 6, deckY, peakX, peakY, '#ffffff', 2.8);
        drawLine64(ctx, peakX + 6, deckY, peakX, peakY, '#cbd5e1', 2.8);
        drawLine64(ctx, peakX - 3, peakY + 12, peakX + 3, peakY + 12, '#f5b73b', 2.2);
        drawLine64(ctx, peakX, peakY + 6, peakX, peakY + 25, '#38bdf8', 1.9);
        drawGlow64(
          ctx,
          peakX,
          peakY - 3,
          5.5,
          blink ? 'rgba(255, 77, 77, 0.9)' : 'rgba(245, 183, 59, 0.7)'
        );
        ctx.fillStyle = blink ? '#ff4d4d' : '#f5b73b';
        ctx.beginPath();
        ctx.arc(peakX, peakY - 3, 1.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (lv >= 4) {
      // Show BOTH parallel decks side-by-side in isometric preview to showcase 2-tile width!
      const backSprite = getBridgeSprite(2 | 8, 4, 1, true, 0, 'back', 'ew');
      const frontSprite = getBridgeSprite(2 | 8, 4, 1, true, 0, 'front', 'ew');
      const scale = 0.74;
      const dw = Math.round(backSprite.canvas.width * scale);
      const dh = Math.round(backSprite.canvas.height * scale);
      const baseX = w - dw - 2;
      const baseY = (h - dh) / 2 - 2;
      ctx.drawImage(backSprite.canvas, baseX, baseY, dw, dh);
      ctx.drawImage(frontSprite.canvas, baseX - 11, baseY + 6, dw, dh);
    } else {
      const bridgeSprite = getBridgeSprite(2 | 8, lv, lv >= 2 ? 1 : 0, true, 0, 'none', 'ew');
      const scale = 0.84;
      const dw = Math.round(bridgeSprite.canvas.width * scale);
      const dh = Math.round(bridgeSprite.canvas.height * scale);
      ctx.drawImage(bridgeSprite.canvas, w - dw - 8, (h - dh) / 2 + 4, dw, dh);
    }
  } else if (kind === 'port') {
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.52);
    sky.addColorStop(0, '#0c1c36');
    sky.addColorStop(1, '#1d4473');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h * 0.52);

    const waterY = Math.floor(h * 0.52);
    const water = ctx.createLinearGradient(0, waterY, 0, h);
    water.addColorStop(0, '#185c94');
    water.addColorStop(1, '#0b2d4d');
    ctx.fillStyle = water;
    ctx.fillRect(0, waterY, w, h - waterY);

    ctx.fillStyle = 'rgba(130, 215, 255, 0.55)';
    for (let wx = 8; wx < w - 12; wx += 18) {
      const wy = waterY + 8 + ((wx * 7) % (h - waterY - 14));
      const shift = Math.sin(timeSec * 2.5 + wx) * 2.5;
      ctx.beginPath();
      ctx.ellipse(wx + shift, wy, 5, 1.1, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 64-Bit Scenic Cargo Ship Silhouette
    const shipX = 14 + Math.sin(timeSec * 1.6) * 2.2;
    const shipY = waterY + 6;
    ctx.fillStyle = '#9e2a2b';
    ctx.beginPath();
    ctx.moveTo(shipX - 2, shipY + 6);
    ctx.lineTo(shipX + 52, shipY + 6);
    ctx.lineTo(shipX + 50, shipY + 15);
    ctx.lineTo(shipX + 4, shipY + 15);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#0a2138';
    ctx.fillRect(shipX + 2, shipY + 14, 48, 2.5);

    // Bridge tower & stacked ISO containers
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(shipX + 36, shipY - 7, 11, 13);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(shipX + 38, shipY - 5, 7, 3);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(shipX + 6, shipY, 12, 6);
    ctx.fillStyle = '#f5b73b';
    ctx.fillRect(shipX + 20, shipY, 12, 6);
    if (lv >= 2) {
      ctx.fillStyle = '#66d98c';
      ctx.fillRect(shipX + 8, shipY - 6, 12, 6);
      ctx.fillStyle = '#ff785a';
      ctx.fillRect(shipX + 22, shipY - 6, 10, 6);
    }

    // Glowing harbor lighthouse
    ctx.fillStyle = '#e8eef5';
    ctx.fillRect(76, waterY - 18, 4.5, 18);
    ctx.fillStyle = '#e04848';
    ctx.fillRect(76, waterY - 14, 4.5, 4);
    ctx.fillRect(76, waterY - 7, 4.5, 4);
    drawGlow64(ctx, 78.2, waterY - 20, blink ? 12 : 7, 'rgba(255, 243, 176, 0.85)');
    ctx.fillStyle = '#fff5bd';
    ctx.fillRect(75.5, waterY - 21, 5.5, 3);

    const portSprite = getPortSprite(lv, 0);
    const scale = 0.84;
    const dw = Math.round(portSprite.canvas.width * scale);
    const dh = Math.round(portSprite.canvas.height * scale);
    ctx.drawImage(portSprite.canvas, w - dw - 10, (h - dh) / 2 + 2, dw, dh);
  } else if (kind === 'airport') {
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.6);
    sky.addColorStop(0, '#0c1629');
    sky.addColorStop(1, '#1e3c66');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h * 0.6);

    // Soft atmospheric clouds
    ctx.fillStyle = 'rgba(195, 232, 255, 0.18)';
    ctx.beginPath();
    ctx.ellipse(30, 15, 16, 4.5, 0, 0, Math.PI * 2);
    ctx.ellipse(80, 20, 14, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Illuminated runway strip
    const groundY = Math.floor(h * 0.6);
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, groundY, w, h - groundY);
    ctx.fillStyle = '#2b3547';
    ctx.fillRect(0, groundY + 6, w, 15);
    ctx.fillStyle = '#f8fafc';
    for (let rx = 6; rx < w - 85; rx += 16) {
      ctx.fillRect(rx, groundY + 12.5, 8, 2);
    }
    ctx.fillStyle = lv >= 2 ? '#38bdf8' : '#ffe066';
    for (let rx = 8; rx < w - 85; rx += 12) {
      ctx.fillRect(rx, groundY + 6, 2.5, 2);
      ctx.fillRect(rx, groundY + 19, 2.5, 2);
    }

    // Scenic climbing 64-bit jetliner silhouette with contrail!
    const jetOffset = (timeSec * 22) % 92;
    const jx = 12 + jetOffset;
    const jy = groundY - 8 - jetOffset * 0.34;
    drawAirplane64(ctx, jx, jy, 0, 1.0, -0.34, lv === 3 ? '#ff785a' : '#38bdf8', 0.85, blink);

    const airportSprite = getAirportSprite(lv, 0);
    const scale = 0.78;
    const dw = Math.round(airportSprite.canvas.width * scale);
    const dh = Math.round(airportSprite.canvas.height * scale);
    ctx.drawImage(airportSprite.canvas, w - dw - 8, (h - dh) / 2 + 2, dw, dh);
  } else if (kind === 'bus') {
    // 64-Bit Urban BRT Boulevard & Articulated Municipal Bus Preview!
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.56);
    sky.addColorStop(0, '#0d223d');
    sky.addColorStop(1, '#1e4e7a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h * 0.56);

    // Distant twilight city skyline silhouettes
    ctx.fillStyle = '#132a47';
    for (const [bx, bw, bh] of [
      [10, 14, 24],
      [28, 16, 30],
      [48, 12, 20],
      [66, 18, 28],
      [90, 14, 22],
    ]) {
      ctx.fillRect(bx, h * 0.56 - bh, bw, bh);
    }

    // Wide Boulevard BRT Asphalt Street
    const roadY = Math.floor(h * 0.56);
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(0, roadY, w, h - roadY);
    // Dedicated cyan BRT lane strip & yellow markings
    ctx.fillStyle = 'rgba(14, 165, 233, 0.25)';
    ctx.fillRect(0, roadY + 11, w, 16);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(0, roadY + 10, w, 1.8);
    ctx.fillStyle = '#facc15';
    for (let sx = 6; sx < w - 80; sx += 16) {
      ctx.fillRect(sx, roadY + 4, 8, 1.6);
    }

    // Animated 64-Bit Articulated Municipal Bus cruising along the BRT corridor!
    const busX = 8 + ((timeSec * 24) % 92) - 18;
    const busY = roadY + 6;
    ctx.fillStyle = lv >= 3 ? '#f59e0b' : '#0284c7';
    ctx.fillRect(busX, busY, 44, 14);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(busX, busY, 44, 4);
    ctx.fillStyle = '#bae6fd';
    for (let wx = 4; wx <= 36; wx += 8) {
      ctx.fillRect(busX + wx, busY + 4.5, 5.5, 4.5);
    }
    // Articulated accordion joint
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(busX + 20, busY + 1, 2.5, 13);
    // Wheels + glowing headlights
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(busX + 9, busY + 14.5, 3, 0, Math.PI * 2);
    ctx.arc(busX + 35, busY + 14.5, 3, 0, Math.PI * 2);
    ctx.fill();
    drawGlow64(ctx, busX + 45, busY + 11, 7, 'rgba(254, 240, 138, 0.85)');

    const busSprite = getBusStationSprite(lv, 0);
    const scale = 0.88;
    const dw = Math.round(busSprite.canvas.width * scale);
    const dh = Math.round(busSprite.canvas.height * scale);
    ctx.drawImage(busSprite.canvas, w - dw - 6, (h - dh) / 2 + 4, dw, dh);
  } else if (kind === 'metro') {
    // 64-Bit Subterranean Metro Cross-Section & Glowing Underground Express Train!
    const surfY = Math.floor(h * 0.36);
    const sky = ctx.createLinearGradient(0, 0, 0, surfY);
    sky.addColorStop(0, '#0f172a');
    sky.addColorStop(1, '#263459');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, surfY);

    // Surface boulevard crust
    ctx.fillStyle = '#334155';
    ctx.fillRect(0, surfY - 3, w, 5);
    // Deep subterranean earth strata
    const earth = ctx.createLinearGradient(0, surfY + 2, 0, h);
    earth.addColorStop(0, '#1e1b2e');
    earth.addColorStop(1, '#0b0d17');
    ctx.fillStyle = earth;
    ctx.fillRect(0, surfY + 2, w, h - surfY - 2);

    // Illuminated Subway Tube Cross-Section
    const tubeY = surfY + 14;
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, tubeY, w - 74, 24);
    ctx.strokeStyle = lv >= 3 ? '#f59e0b' : '#6366f1';
    ctx.lineWidth = 1.6;
    ctx.strokeRect(0, tubeY, w - 74, 24);
    // Glowing tunnel ceiling lights
    for (let lx = 10; lx < w - 82; lx += 22) {
      drawGlow64(ctx, lx, tubeY + 3, 6, 'rgba(56, 189, 248, 0.65)');
      ctx.fillStyle = '#e0f2fe';
      ctx.fillRect(lx - 3, tubeY + 1.5, 6, 1.5);
    }
    // Electrified steel rails
    ctx.fillStyle = '#64748b';
    ctx.fillRect(0, tubeY + 21, w - 74, 2);

    // Animated Sleek 64-Bit Express Metro Train gliding smoothly through the underground tunnel!
    const trainX = ((timeSec * 42) % 140) - 52;
    const trainY = tubeY + 8;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, tubeY + 1, w - 75, 22);
    ctx.clip();
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(trainX, trainY, 64, 12);
    ctx.fillStyle = lv >= 3 ? '#f59e0b' : '#8b5cf6';
    ctx.fillRect(trainX, trainY + 7.5, 64, 2.5);
    ctx.fillStyle = '#38bdf8';
    for (let wx = 4; wx <= 54; wx += 9) {
      ctx.fillRect(trainX + wx, trainY + 2, 6, 4.2);
    }
    drawGlow64(ctx, trainX + 65, trainY + 7, 9, 'rgba(56, 189, 248, 0.92)');
    ctx.restore();

    const metroSprite = getMetroStationSprite(lv, 0);
    const scale = 0.86;
    const dw = Math.round(metroSprite.canvas.width * scale);
    const dh = Math.round(metroSprite.canvas.height * scale);
    ctx.drawImage(metroSprite.canvas, w - dw - 6, (h - dh) / 2 + 4, dw, dh);
  } else if (kind === 'shopping') {
    // 64-Bit Scenic Shopping Mall Galleria / Megamall Illustration (Lv.1 6×6, Lv.2 8×8, Lv.3 9×9)
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.58);
    sky.addColorStop(0, lv === 3 ? '#1e1038' : lv === 2 ? '#121d3d' : '#1b263b');
    sky.addColorStop(1, lv === 3 ? '#581c87' : lv === 2 ? '#1d4ed8' : '#c2410c');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h * 0.58);

    const plazaY = Math.floor(h * 0.58);
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, plazaY, w, h - plazaY);
    ctx.fillStyle = '#334155';
    ctx.fillRect(0, plazaY, w, 9);

    // Scenic Architectural Mall Elevation on the left side
    const mallW = lv === 3 ? 114 : lv === 2 ? 104 : 92;
    const mallH = lv === 3 ? 34 : lv === 2 ? 27 : 21;
    const mallX = 8;
    const mallY = plazaY - mallH;

    // Main building body
    ctx.fillStyle = lv === 3 ? '#312e81' : lv === 2 ? '#1e3a8a' : '#e3d5ca';
    ctx.fillRect(mallX, mallY, mallW, mallH);

    // Glowing glass curtain walls / storefront windows
    ctx.fillStyle = lv === 3 ? '#f472b6' : lv === 2 ? '#38bdf8' : '#f59e0b';
    ctx.fillRect(mallX, mallY, mallW, 3);
    for (let wx = mallX + 5; wx < mallX + mallW - 8; wx += 12) {
      ctx.fillStyle = blink && wx % 24 === 5 ? '#fef08a' : '#7dd3fc';
      ctx.fillRect(wx, mallY + 6, 7, mallH - 10);
    }

    // Central Skylight Atrium Dome (scales dramatically across 6×6 -> 8×8 -> 9×9!)
    const domeCenterX = mallX + mallW * 0.5;
    const domeRadius = lv === 3 ? 26 : lv === 2 ? 19 : 13;
    ctx.fillStyle = lv === 3 ? 'rgba(244, 114, 182, 0.45)' : 'rgba(56, 189, 248, 0.45)';
    ctx.beginPath();
    ctx.arc(domeCenterX, mallY, domeRadius, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = lv === 3 ? '#fef08a' : '#e0f2fe';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(domeCenterX, mallY, domeRadius, Math.PI, 0);
    ctx.stroke();

    // Size & Design badge on the scenic plaza
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.fillRect(8, plazaY + 12, 114, 18);
    ctx.strokeStyle = lv === 3 ? '#f472b6' : lv === 2 ? '#38bdf8' : '#fbbf24';
    ctx.lineWidth = 1;
    ctx.strokeRect(8.5, plazaY + 12.5, 113, 17);
    ctx.fillStyle = '#ffe066';
    ctx.font = 'bold 8px monospace';
    const sizeText =
      lv === 3
        ? 'GRANDE 9×9 (81 LOTES)'
        : lv === 2
          ? 'MÉDIO 8×8 (64 LOTES)'
          : 'PEQUENO 6×6 (36 LOTES)';
    ctx.fillText(sizeText, 13, plazaY + 24);

    const shoppingSprite = getShoppingMallSprite(lv, 0);
    const scale = 0.85;
    const dw = Math.round(shoppingSprite.canvas.width * scale);
    const dh = Math.round(shoppingSprite.canvas.height * scale);
    ctx.drawImage(shoppingSprite.canvas, w - dw - 6, (h - dh) / 2 + 2, dw, dh);
  }

  // Subtle lock overlay indicator if not unlocked yet (keeps 64-bit art crystal clear!)
  if (!unlocked) {
    ctx.fillStyle = 'rgba(11, 16, 27, 0.20)';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(11, 16, 27, 0.85)';
    ctx.fillRect(6, 6, 86, 15);
    ctx.strokeStyle = '#f5b73b';
    ctx.lineWidth = 1;
    ctx.strokeRect(6.5, 6.5, 85, 14);
    ctx.fillStyle = '#ffe066';
    ctx.font = 'bold 8px monospace';
    ctx.fillText('PRÉVIA 64-BIT', 13, 16.5);
  }
}
