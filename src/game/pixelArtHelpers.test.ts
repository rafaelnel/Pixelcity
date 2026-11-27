import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMERCIAL_PALETTES,
  CONSTRUCTION_TOTAL_DURATION,
  drawPublicWorkConstructionSite64,
  getAtmosphericGradientOverlay,
  getConstructionStageLabel,
  getLightingState,
  getSeasonForMonth,
  getSeasonLabel,
  getTileConstructionStage,
  getVehicleKind,
  getWeatherLabel,
  hashCoord,
  RESIDENTIAL_PALETTES,
  shouldHideVehiclesAtZoom,
} from './pixelArtHelpers';
import type { Tile } from './types';

test('hashCoord is deterministic per coordinate and well-distributed across neighbors', () => {
  assert.equal(hashCoord(12, 7, 3), hashCoord(12, 7, 3));
  const seen = new Set<number>();
  for (let x = 0; x < 12; x++) {
    for (let y = 0; y < 12; y++) {
      seen.add(hashCoord(x, y, 0));
    }
  }
  assert.equal(seen.size, 144, 'all 144 neighboring tiles should receive distinct visual hashes');
});

test('getLightingState transitions smoothly across day, dusk, night, and auto cycle', () => {
  const day = getLightingState('day', 0);
  const dusk = getLightingState('dusk', 0);
  const night = getLightingState('night', 0);

  assert.equal(day.phaseLabel, 'Dia');
  assert.equal(day.nightFactor, 0);
  assert.equal(dusk.phaseLabel, 'Entardecer');
  assert.ok(dusk.duskFactor > 0.8);
  assert.ok(dusk.glowStrength > 0.4);
  assert.equal(night.phaseLabel, 'Noite');
  assert.ok(night.nightFactor > 0.85);
  assert.ok(night.glowStrength > 0.8);

  // Auto mode hits all three phases across a 96-second cycle
  const phases = new Set<string>();
  for (let sec = 0; sec < 96; sec += 4) {
    const ls = getLightingState('auto', sec);
    assert.ok(ls.nightFactor >= 0 && ls.nightFactor <= 1);
    assert.ok(ls.glowStrength >= 0 && ls.glowStrength <= 1);
    phases.add(ls.phaseLabel);
  }
  assert.ok(phases.has('Dia') && phases.has('Entardecer') && phases.has('Noite'));
});

test('getVehicleKind covers all 8 vehicle classes including police and fire units', () => {
  const kinds = new Set<string>();
  for (let i = 0; i < 32; i++) {
    kinds.add(getVehicleKind(i));
  }
  assert.deepEqual(
    Array.from(kinds).sort(),
    ['bus', 'fire', 'hatch', 'police', 'sedan', 'suv', 'truck', 'van']
  );
});

test('architectural color palettes provide rich multi-material variety', () => {
  assert.ok(RESIDENTIAL_PALETTES.length >= 16);
  assert.ok(COMMERCIAL_PALETTES.length >= 12);
  const resMaterials = new Set(RESIDENTIAL_PALETTES.map((p) => p.material));
  assert.ok(
    resMaterials.has('brick') &&
      resMaterials.has('plaster') &&
      resMaterials.has('stone') &&
      resMaterials.has('wood') &&
      resMaterials.has('concrete') &&
      resMaterials.has('glass')
  );
});

test('getSeasonForMonth maps all 12 calendar months across 4 seasons and weather modulates lighting', () => {
  assert.equal(getSeasonForMonth(1), 'summer');
  assert.equal(getSeasonForMonth(2), 'summer');
  assert.equal(getSeasonForMonth(3), 'autumn');
  assert.equal(getSeasonForMonth(5), 'autumn');
  assert.equal(getSeasonForMonth(6), 'winter');
  assert.equal(getSeasonForMonth(8), 'winter');
  assert.equal(getSeasonForMonth(9), 'spring');
  assert.equal(getSeasonForMonth(11), 'spring');
  assert.equal(getSeasonForMonth(12), 'summer');

  assert.equal(getSeasonLabel('summer'), 'Verão');
  assert.equal(getSeasonLabel('autumn'), 'Outono');
  assert.equal(getSeasonLabel('winter'), 'Inverno');
  assert.equal(getSeasonLabel('spring'), 'Primavera');

  assert.equal(getWeatherLabel('clear'), 'Céu Limpo');
  assert.equal(getWeatherLabel('partly_cloudy'), 'Parcialmente Nublado');
  assert.equal(getWeatherLabel('rain'), 'Chuva');
  assert.equal(getWeatherLabel('storm'), 'Tempestade');
  assert.equal(getWeatherLabel('snow'), 'Neve');

  const clearDay = getLightingState('day', 0, 'summer', 'clear', 0.5);
  const stormDay = getLightingState('day', 0, 'summer', 'storm', 0.9);
  const snowDay = getLightingState('day', 0, 'winter', 'snow', 0.8);

  assert.ok(stormDay.glowStrength > clearDay.glowStrength, 'Stormy daytime should trigger streetlights/headlights');
  assert.ok(snowDay.glowStrength > clearDay.glowStrength, 'Snowy winter daytime should boost glow');
  assert.notEqual(stormDay.skyTop, clearDay.skyTop);
  assert.notEqual(snowDay.skyTop, clearDay.skyTop);
});

test('shouldHideVehiclesAtZoom hides vehicles starting at 70% zoom and further out while keeping them visible above 70%', () => {
  assert.equal(shouldHideVehiclesAtZoom(0.35), true);
  assert.equal(shouldHideVehiclesAtZoom(0.60), true);
  assert.equal(shouldHideVehiclesAtZoom(0.70), true);
  assert.equal(shouldHideVehiclesAtZoom(0.704), true);
  assert.equal(shouldHideVehiclesAtZoom(0.72), false);
  assert.equal(shouldHideVehiclesAtZoom(1.0), false);
  assert.equal(shouldHideVehiclesAtZoom(1.8), false);
});

test('getTileConstructionStage progresses sequentially through Stages 1, 2, and 3 into completion', () => {
  assert.equal(getTileConstructionStage(CONSTRUCTION_TOTAL_DURATION, 'residential'), 1);
  assert.equal(getTileConstructionStage(1.4, 'commercial'), 1);
  assert.equal(getTileConstructionStage(1.05, 'industrial'), 2);
  assert.equal(getTileConstructionStage(0.55, 'stadium'), 3);
  assert.equal(getTileConstructionStage(0.25, 'residential'), 0);
  assert.equal(getTileConstructionStage(0, 'residential'), 0);

  // Non-building tiles (roads, bridges, abandoned, grass, water) do not enter building scaffolding stages
  assert.equal(getTileConstructionStage(1.6, 'road'), 0);
  assert.equal(getTileConstructionStage(1.6, 'bridge'), 0);
  assert.equal(getTileConstructionStage(1.6, 'abandoned'), 0);
  assert.equal(getTileConstructionStage(1.6, 'grass'), 0);

  assert.ok(getConstructionStageLabel(1)?.includes('1/3'));
  assert.ok(getConstructionStageLabel(2)?.includes('2/3'));
  assert.ok(getConstructionStageLabel(3)?.includes('3/3'));
  assert.equal(getConstructionStageLabel(0), null);
});

test('getAtmosphericGradientOverlay smoothly darkens the city across day, dusk (crepúsculo), and night', () => {
  const day = getAtmosphericGradientOverlay('day', 0);
  const dusk = getAtmosphericGradientOverlay('dusk', 0);
  const night = getAtmosphericGradientOverlay('night', 0);

  assert.equal(day.phase, 'day');
  assert.equal(day.phaseLabel, 'Dia');
  assert.equal(dusk.phase, 'dusk');
  assert.equal(dusk.phaseLabel, 'Crepúsculo');
  assert.equal(night.phase, 'night');
  assert.equal(night.phaseLabel, 'Noite');

  assert.ok(
    day.darknessLevel < dusk.darknessLevel && dusk.darknessLevel < night.darknessLevel,
    `Expected darknessLevel day (${day.darknessLevel}) < dusk (${dusk.darknessLevel}) < night (${night.darknessLevel})`
  );
  assert.ok(
    day.opacity < dusk.opacity && dusk.opacity < night.opacity,
    `Expected overlay opacity day (${day.opacity}) < dusk (${dusk.opacity}) < night (${night.opacity})`
  );
  assert.ok(day.gradientCss.includes('radial-gradient') && day.gradientCss.includes('linear-gradient'));
  assert.ok(dusk.gradientCss.includes('radial-gradient') && dusk.gradientCss.includes('linear-gradient'));
  assert.ok(night.gradientCss.includes('radial-gradient') && night.gradientCss.includes('linear-gradient'));

  // Auto cycle visits all three overlay phases (day, dusk, night) smoothly
  const autoPhases = new Set<string>();
  for (let sec = 0; sec < 96; sec += 3) {
    const ov = getAtmosphericGradientOverlay('auto', sec);
    assert.ok(ov.opacity >= 0.18 && ov.opacity <= 0.92);
    assert.ok(ov.darknessLevel >= 0 && ov.darknessLevel <= 1);
    autoPhases.add(ov.phase);
  }
  assert.ok(autoPhases.has('day') && autoPhases.has('dusk') && autoPhases.has('night'));
});

test('drawPublicWorkConstructionSite64 renders single-tile and multi-tile public work sites cleanly across progress phases', () => {
  const noop = () => {};
  const mockCtx = {
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    ellipse: noop,
    rect: noop,
    roundRect: noop,
    fill: noop,
    stroke: noop,
    fillRect: noop,
    strokeRect: noop,
    fillText: noop,
    measureText: () => ({ width: 20 }),
    setLineDash: noop,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'center',
    textBaseline: 'middle',
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;

  const baseTile: Tile = {
    x: 12,
    y: 14,
    type: 'grass',
    level: 1,
    age: 0,
    variant: 0,
    evolveFlash: 0,
    pollution: 0,
    landValue: 50,
    construction: {
      workId: 'w1',
      actionId: 'shopping_evolution',
      title: 'Shopping Pequeno',
      targetType: 'shopping',
      targetLevel: 1,
      isUpgrade: false,
      lotWidth: 6,
      lotHeight: 6,
      lotDx: 0,
      lotDy: 0,
      totalMonths: 3,
      remainingMonths: 2,
    },
  };

  for (const progress of [0.1, 0.5, 0.9]) {
    drawPublicWorkConstructionSite64(mockCtx, 400, 300, 32, 16, 1.1, baseTile, progress, 12.5);
  }

  const singleTile: Tile = {
    ...baseTile,
    type: 'abandoned',
    construction: {
      ...baseTile.construction!,
      actionId: 'revitalization',
      targetType: 'residential',
      isUpgrade: true,
      lotWidth: 1,
      lotHeight: 1,
    },
  };
  drawPublicWorkConstructionSite64(mockCtx, 420, 310, 32, 16, 0.9, singleTile, 0.65, 4.2);
});



