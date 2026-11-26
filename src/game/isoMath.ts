import { GRID_SIZE } from './simulationConfig';
import type { CameraRotation, CameraState } from './types';

/** Classic 32-bit 2:1 isometric pixel-art diamond dimensions */
export const ISO_TILE_W = 32;
export const ISO_TILE_H = 16;

export const MIN_ZOOM = 0.35;
export const MAX_ZOOM = 3.0;
export const DEFAULT_ZOOM = 1.25;

/** Rotated grid dimensions for rectangular expandable maps */
export function getRotatedGridDims(
  gridW: number = GRID_SIZE,
  gridH: number = gridW,
  rotation: CameraRotation = 0
): { rotW: number; rotH: number } {
  return rotation === 1 || rotation === 3
    ? { rotW: gridH, rotH: gridW }
    : { rotW: gridW, rotH: gridH };
}

/** Rotate a grid coordinate (tx, ty) into camera-aligned isometric grid space (rx, ry) */
export function rotateGridCoord(
  tx: number,
  ty: number,
  rotation: CameraRotation,
  gridW: number = GRID_SIZE,
  gridH: number = gridW
): { rx: number; ry: number } {
  switch (rotation) {
    case 0:
      return { rx: tx, ry: ty };
    case 1:
      return { rx: gridH - 1 - ty, ry: tx };
    case 2:
      return { rx: gridW - 1 - tx, ry: gridH - 1 - ty };
    case 3:
      return { rx: ty, ry: gridW - 1 - tx };
  }
}

/** Inverse of rotateGridCoord: convert camera-aligned (rx, ry) back to world (tx, ty) */
export function unrotateGridCoord(
  rx: number,
  ry: number,
  rotation: CameraRotation,
  gridW: number = GRID_SIZE,
  gridH: number = gridW
): { tx: number; ty: number } {
  switch (rotation) {
    case 0:
      return { tx: rx, ty: ry };
    case 1:
      return { tx: ry, ty: gridH - 1 - rx };
    case 2:
      return { tx: gridW - 1 - rx, ty: gridH - 1 - ry };
    case 3:
      return { tx: gridW - 1 - ry, ty: rx };
  }
}

/** Rotate a 4-bit N/E/S/W bitmask (N=1, E=2, S=4, W=8) to match isometric camera rotation */
export function rotateRoadMask(mask: number, rotation: CameraRotation): number {
  if (rotation === 0) return mask;
  let out = 0;
  for (let bit = 0; bit < 4; bit++) {
    if (mask & (1 << bit)) {
      const nextBit = (bit + rotation) % 4;
      out |= 1 << nextBit;
    }
  }
  return out;
}

/** Project fractional or integer world grid coordinates (tx, ty) into isometric world pixels */
export function gridToIsoWorld(
  tx: number,
  ty: number,
  rotation: CameraRotation,
  gridW: number = GRID_SIZE,
  gridH: number = gridW
): { wx: number; wy: number } {
  const { rx, ry } = rotateGridCoord(tx, ty, rotation, gridW, gridH);
  const { rotW, rotH } = getRotatedGridDims(gridW, gridH, rotation);
  const midX = (rotW - 1) / 2;
  const midY = (rotH - 1) / 2;
  const dx = rx - midX;
  const dy = ry - midY;
  return {
    wx: (dx - dy) * (ISO_TILE_W / 2),
    wy: (dx + dy) * (ISO_TILE_H / 2),
  };
}

/** Project world grid coordinates (tx, ty) into canvas CSS/pixel screen coordinates */
export function gridToScreen(
  tx: number,
  ty: number,
  canvasW: number,
  canvasH: number,
  cam: CameraState,
  gridW: number = GRID_SIZE,
  gridH: number = gridW
): { sx: number; sy: number } {
  const { wx, wy } = gridToIsoWorld(tx, ty, cam.rotation, gridW, gridH);
  return {
    sx: canvasW / 2 + (wx - cam.panX) * cam.zoom,
    sy: canvasH / 2 + (wy - cam.panY) * cam.zoom,
  };
}

/** Inverse hit-test: convert canvas coordinates (sx, sy) to integer tile coordinates (tx, ty) */
export function screenToGrid(
  sx: number,
  sy: number,
  canvasW: number,
  canvasH: number,
  cam: CameraState,
  gridW: number = GRID_SIZE,
  gridH: number = gridW
): { tx: number; ty: number } | null {
  const wx = (sx - canvasW / 2) / cam.zoom + cam.panX;
  const wy = (sy - canvasH / 2) / cam.zoom + cam.panY;

  const halfW = ISO_TILE_W / 2;
  const halfH = ISO_TILE_H / 2;

  const dx = (wx / halfW + wy / halfH) / 2;
  const dy = (wy / halfH - wx / halfW) / 2;

  const { rotW, rotH } = getRotatedGridDims(gridW, gridH, cam.rotation);
  const midX = (rotW - 1) / 2;
  const midY = (rotH - 1) / 2;
  const rx = Math.round(dx + midX) || 0;
  const ry = Math.round(dy + midY) || 0;

  if (rx < 0 || ry < 0 || rx >= rotW || ry >= rotH) {
    return null;
  }

  const out = unrotateGridCoord(rx, ry, cam.rotation, gridW, gridH);
  return { tx: out.tx || 0, ty: out.ty || 0 };
}

/** Clamp camera pan inside reasonable bounds around the expandable isometric island */
export function clampCamera(
  cam: CameraState,
  gridW: number = GRID_SIZE,
  gridH: number = gridW
): CameraState {
  const span = (gridW + gridH) / 2;
  const maxPanX = span * ISO_TILE_W * 0.48;
  const maxPanY = span * ISO_TILE_H * 0.5;
  return {
    panX: Math.max(-maxPanX, Math.min(maxPanX, cam.panX)),
    panY: Math.max(-maxPanY, Math.min(maxPanY, cam.panY)),
    zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cam.zoom)),
    rotation: cam.rotation,
  };
}

/** Zoom smoothly toward a specific screen point (cursor-centered zoom) */
export function zoomCameraAtPoint(
  cam: CameraState,
  nextZoomRaw: number,
  screenX: number,
  screenY: number,
  canvasW: number,
  canvasH: number,
  gridW: number = GRID_SIZE,
  gridH: number = gridW
): CameraState {
  const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoomRaw));
  const worldX = (screenX - canvasW / 2) / cam.zoom + cam.panX;
  const worldY = (screenY - canvasH / 2) / cam.zoom + cam.panY;
  const nextPanX = worldX - (screenX - canvasW / 2) / nextZoom;
  const nextPanY = worldY - (screenY - canvasH / 2) / nextZoom;

  return clampCamera(
    {
      panX: nextPanX,
      panY: nextPanY,
      zoom: nextZoom,
      rotation: cam.rotation,
    },
    gridW,
    gridH
  );
}
