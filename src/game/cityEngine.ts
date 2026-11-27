import {
  AIRPORT_FOOTPRINT_BY_LEVEL,
  BUDGET_AREA_META,
  BUDGET_AREA_ORDER,
  CITY_TRAITS,
  CIVIC_MILESTONES,
  CONDO_CONVERSION_CONFIG,
  DEFAULT_DIFFICULTY,
  DEFAULT_TAX_RATES,
  DIFFICULTY_CONFIGS,
  EMERGENCY_LINES,
  ESTABLISHMENT_CATALOG,
  ESTABLISHMENT_MAP,
  EXPAND_DIRECTIONS,
  FIXED_COSTS_CONFIG,
  GRID_SIZE,
  GROWTH_CONFIG,
  INITIAL_MONEY,
  LAND_EXPAND_BASE_COST,
  LAND_EXPAND_CHUNK,
  MAX_EXPANSIONS_PER_SIDE,
  MAX_TAX_RATE,
  MIN_BRIDGE_SPACING_TILES,
  MIN_TAX_RATE,
  MONTH_NAMES,
  MONTHLY_TAX_BASE_AT_10PCT,
  POLLUTION_EMISSION,
  POPULATION_BY_BUILDING,
  RANDOM_EVENT_SPECS,
  ROAD_PLAN_CONFIG,
  SECONDS_PER_GROWTH_TICK_1X,
  SECONDS_PER_MONTH_1X,
  SHOPPING_COMMERCIAL_REVENUE_PER_LEVEL,
  SHOPPING_FOOTPRINT_BY_LEVEL,
  START_MONTH,
  START_YEAR,
  TOLL_MIN_POPULATION,
  TOLL_TARIFF_CONFIGS,
  URBAN_MATURITY_CONFIG,
  evaluateBudgetCampaignStatus,
  getScaledMaxUpgradesPerTick,
  getSegmentEffectCurve,
  type EstablishmentSpec,
} from './simulationConfig';
import type {
  ActiveCityEvent,
  BoatEntity,
  BoatKind,
  BudgetAreaKey,
  BudgetAreaStatus,
  CarEntity,
  CityBoost,
  CityBudgets,
  CityNeedItem,
  CityState,
  CityStats,
  CivicMilestoneStatus,
  CondoPolicy,
  DifficultyLevel,
  EconomicEventId,
  EmergencyActionId,
  EmergencyOfferView,
  EstablishmentId,
  ExpandDirection,
  ExternalHighwayEdge,
  ExternalHighwayState,
  HelicopterEntity,
  HudSnapshot,
  LandExpansionStatus,
  MonthlyFinancials,
  NeighborhoodDistrictType,
  NewsItem,
  ParticleEntity,
  PendingConstructionWork,
  PlaneEntity,
  SeasonId,
  SeasonMode,
  TaxRates,
  Tile,
  TileConstructionMeta,
  TileType,
  TollPlazaState,
  TollTariffLevel,
  UrbanIncidentId,
  WeatherKind,
  WeatherState,
} from './types';
import {
  getSeasonForMonth,
  getSeasonLabel,
  getVehicleKind,
  getWeatherLabel,
  type VehicleKind,
} from './pixelArtHelpers';

/** Deterministic PRNG step (Mulberry32) */
export function nextRandom(state: CityState): number {
  let t = (state.rngState += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Standalone seeded RNG for pure map generation helpers */
export function createSeededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function tileIndex(x: number, y: number, gridWidth: number = GRID_SIZE): number {
  return y * gridWidth + x;
}

export function getTile(state: CityState, x: number, y: number): Tile | null {
  if (x < 0 || y < 0 || x >= state.gridWidth || y >= state.gridHeight) return null;
  return state.tiles[y * state.gridWidth + x];
}

export function isRoadLike(type: TileType): boolean {
  return type === 'road' || type === 'bridge';
}

export function isLandmarkType(type: TileType): boolean {
  return type === 'port' || type === 'airport' || type === 'stadium' || type === 'shopping';
}

export function isTransitStationType(type: TileType): boolean {
  return type === 'bus_station' || type === 'metro_station';
}

export function isBuildingType(type: TileType): boolean {
  return (
    type === 'rural' ||
    type === 'residential' ||
    type === 'commercial' ||
    type === 'industrial' ||
    type === 'park' ||
    type === 'abandoned' ||
    isLandmarkType(type) ||
    isTransitStationType(type)
  );
}

export function getSkyscraperStyleIdx(
  ax: number,
  ay: number,
  variant: number,
  mod: number
): number {
  const h = Math.abs((ax * 73856093) ^ (ay * 19349663) ^ (variant * 83492791));
  return h % Math.max(1, mod);
}

/** Deterministic check whether a 2×2 Level 4 Skyscraper features a rooftop helipad */
export function hasSkyscraperHelipad(tile: Tile): boolean {
  if (tile.type !== 'residential' && tile.type !== 'commercial') return false;
  if ((tile.level || 1) < 4) return false;
  if ((tile.lotWidth ?? 1) < 2 || (tile.lotHeight ?? 1) < 2) return false;
  if (tile.establishmentId) return false;
  const ax = tile.x - (tile.lotDx ?? 0);
  const ay = tile.y - (tile.lotDy ?? 0);
  return ((tile.variant + ax * 3 + ay * 5) & 7) < 5;
}

/** Exact HD pixel height of a 2×2 Level 4 Skyscraper rooftop deck (shared by renderer & helicopter landings) */
export function getSkyscraperRoofHeightHd(tile: Tile): number {
  const ax = tile.x - (tile.lotDx ?? 0);
  const ay = tile.y - (tile.lotDy ?? 0);
  if (tile.type === 'commercial') {
    const idx = getSkyscraperStyleIdx(ax, ay, tile.variant, 12);
    return 126 + (idx % 4) * 10;
  }
  const idx = getSkyscraperStyleIdx(ax, ay, tile.variant, 16);
  return 118 + (idx % 4) * 9;
}

/** Human-readable Brazilian Portuguese zone classification including residential value tiers & 20 reference establishments */
export function getZoneDisplayLabel(tile: Tile): string {
  if (tile.construction) {
    const rem = Math.max(1, tile.construction.remainingMonths || 1);
    const remTag = `${rem} ${rem === 1 ? 'mês restante' : 'meses restantes'}`;
    return tile.construction.isUpgrade
      ? `Em Ampliação/Reforma: ${tile.construction.title} (${remTag})`
      : `Canteiro de Obras: ${tile.construction.title} (${remTag})`;
  }
  if (tile.establishmentId && ESTABLISHMENT_MAP[tile.establishmentId]) {
    const spec = ESTABLISHMENT_MAP[tile.establishmentId];
    const vIdx = (tile.variant % 3) + 1;
    const lw = tile.lotWidth ?? spec.footprintW ?? 1;
    const lh = tile.lotHeight ?? spec.footprintH ?? 1;
    const sizeTag = lw > 1 || lh > 1 ? `${lw}×${lh} · ` : '';
    return `${spec.label} (${sizeTag}Var. ${vIdx} · ${spec.categoryLabel})`;
  }
  if (tile.type === 'rural') {
    const sub =
      tile.level >= 3
        ? 'Agroindústria & Estufas'
        : tile.level === 2
          ? 'Pomar & Celeiro'
          : 'Fazenda & Lavoura';
    return `Zona Rural (${sub})`;
  }
  if (tile.type === 'residential') {
    if ((tile.level || 1) >= 4 && (tile.lotWidth ?? 1) >= 2 && (tile.lotHeight ?? 1) >= 2) {
      return hasSkyscraperHelipad(tile)
        ? 'Mega Condomínio 2×2 (Com Heliporto)'
        : 'Mega Condomínio 2×2';
    }
    const wealth =
      tile.landValue >= 62
        ? 'Alto Valor'
        : tile.landValue >= 38
          ? 'Médio Valor'
          : 'Baixo Valor';
    const lv = tile.level || 1;
    const tierName =
      lv >= 3
        ? 'Condomínio Residencial'
        : lv === 2
          ? 'Prédio Médio'
          : 'Casa Residencial';
    const scale =
      (tile.lotWidth ?? 1) > 1 || (tile.lotHeight ?? 1) > 1
        ? ` ${tile.lotWidth ?? 1}×${tile.lotHeight ?? 1}`
        : '';
    return `${tierName}${scale} (${wealth})`;
  }
  if (tile.type === 'commercial') {
    if ((tile.level || 1) >= 4 && (tile.lotWidth ?? 1) >= 2 && (tile.lotHeight ?? 1) >= 2) {
      return hasSkyscraperHelipad(tile)
        ? 'Arranha-Céu Corporativo 2×2 (Com Heliporto)'
        : 'Arranha-Céu Corporativo 2×2';
    }
    const scale =
      (tile.lotWidth ?? 1) > 1 || (tile.lotHeight ?? 1) > 1
        ? ` · Complexo ${tile.lotWidth ?? 1}×${tile.lotHeight ?? 1}`
        : '';
    return `Zona Comercial${scale}`;
  }
  if (tile.type === 'industrial') {
    const scale =
      (tile.lotWidth ?? 1) > 1 || (tile.lotHeight ?? 1) > 1
        ? ` · Galpão ${tile.lotWidth ?? 1}×${tile.lotHeight ?? 1}`
        : '';
    return `Zona Industrial${scale}`;
  }
  if (tile.type === 'airport') {
    const scale =
      (tile.lotWidth ?? 1) > 1 || (tile.lotHeight ?? 1) > 1
        ? ` (${tile.lotWidth}×${tile.lotHeight} Pista & Galpão)`
        : '';
    return `Complexo Aeroportuário${scale}`;
  }
  if (tile.type === 'stadium') {
    const scale =
      (tile.lotWidth ?? 1) > 1 || (tile.lotHeight ?? 1) > 1
        ? ` (${tile.lotWidth}×${tile.lotHeight})`
        : '';
    return `Estádio de Futebol${scale}`;
  }
  if (tile.type === 'shopping') {
    const lw = tile.lotWidth ?? 6;
    const lh = tile.lotHeight ?? 6;
    const lv = tile.level || 1;
    if (lv >= 3) {
      return `Shopping Grande ${lw}×${lh} (Grand Megamall · Nv. 3)`;
    }
    if (lv === 2) {
      return `Shopping Médio ${lw}×${lh} (Metropolitano · Nv. 2)`;
    }
    return `Shopping Pequeno ${lw}×${lh} (Galleria Regional · Nv. 1)`;
  }
  if (tile.type === 'port') {
    const lw = tile.lotWidth ?? 1;
    const lh = tile.lotHeight ?? 1;
    const lv = tile.level || 1;
    if (lv >= 3) {
      return lw > 1 || lh > 1
        ? `Complexo Portuário ${lw}×${lh} (Terminal de Cruzeiros)`
        : 'Porto Internacional (Terminal de Cruzeiros)';
    }
    return lw > 1 || lh > 1
      ? `Complexo Portuário ${lw}×${lh} (Terminal de Cargas)`
      : 'Zona Portuária';
  }
  if (tile.type === 'bus_station') {
    const lv = tile.level || 1;
    return lv >= 3
      ? 'Terminal de Ônibus Elétrico'
      : lv === 2
        ? 'Terminal Expresso BRT'
        : 'Terminal de Ônibus Urbano';
  }
  if (tile.type === 'metro_station') {
    const lv = tile.level || 1;
    return lv >= 3
      ? 'Estação Central de Metrô (Integrada)'
      : lv === 2
        ? 'Estação de Metrô · Linha 2'
        : 'Estação de Metrô · Linha 1';
  }
  if (tile.type === 'park') return 'Parque Urbano';
  if (tile.type === 'abandoned') return 'Imóvel Abandonado';
  return tile.type;
}

/**
 * Verify minimum distance radius (`minDistanceRadius`) and terrain rules before generating
 * any of the 20 iconic establishments at `(x, y)`.
 */
export function canPlaceEstablishmentAt(
  state: CityState,
  estId: EstablishmentId,
  x: number,
  y: number,
  ignoreTile?: Tile
): boolean {
  const spec = ESTABLISHMENT_MAP[estId];
  if (!spec) return false;

  // Mandatory shoreline rule for Marina na Beira do Rio (and any water-adjacent establishment)
  if (spec.requiresWaterAdjacent) {
    let touchesWater = false;
    for (const [dx, dy] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ]) {
      const nt = getTile(state, x + dx, y + dy);
      if (nt && nt.type === 'water') {
        touchesWater = true;
        break;
      }
    }
    if (!touchesWater) return false;
  }

  const minR = spec.minDistanceRadius;
  for (let i = 0; i < state.tiles.length; i++) {
    const other = state.tiles[i];
    if (other === ignoreTile) continue;
    const isSameEst =
      other.establishmentId === estId ||
      (estId === 'soccer_stadium' && other.type === 'stadium');
    if (!isSameEst) continue;
    const dist = Math.hypot(other.x - x, other.y - y);
    if (dist < minR) {
      return false;
    }
  }
  return true;
}

/** Pick a visual variation (0..2) distinct from the most recent instance of the same establishment */
function pickEstablishmentVariation(state: CityState, estId: EstablishmentId): number {
  const used = new Set<number>();
  for (let i = 0; i < state.tiles.length; i++) {
    const t = state.tiles[i];
    if (t.establishmentId === estId && t.lotRole !== 'part') {
      used.add(t.variant % 3);
    }
  }
  const avail: number[] = [];
  for (let v = 0; v < 3; v++) {
    if (!used.has(v)) avail.push(v);
  }
  if (avail.length > 0) {
    return avail[Math.floor(nextRandom(state) * avail.length)];
  }
  return Math.floor(nextRandom(state) * 3);
}

/**
 * Attempt to select a valid specialized establishment from ESTABLISHMENT_CATALOG for a tile at `(x, y)`
 * matching `hostTileType` and `hostLevel`, strictly respecting `minDistanceRadius`, `requiresWaterAdjacent`,
 * and `prefersCentralDense`.
 */
function tryPickOrganicEstablishment(
  state: CityState,
  x: number,
  y: number,
  hostTileType: 'park' | 'commercial' | 'residential',
  hostLevel: 1 | 2 | 3,
  ignoreTile?: Tile
): { establishmentId: EstablishmentId; variant: number } | null {
  const cx = typeof state.roadOriginX === 'number' ? state.roadOriginX : state.gridWidth / 2;
  const cy = typeof state.roadOriginY === 'number' ? state.roadOriginY : state.gridHeight / 2;
  const distFromCenter = Math.hypot(x - cx, y - cy);

  const candidates: Array<{ spec: EstablishmentSpec; weight: number }> = [];
  for (const spec of ESTABLISHMENT_CATALOG) {
    if (spec.id === 'soccer_stadium' || spec.id === 'sports_court') continue; // Built strictly when unlocked and ordered by the player in Obras
    const levelMatches =
      spec.hostLevel === hostLevel ||
      (hostLevel === 1 && spec.hostLevel === 2 && (spec.minPopulation ?? 0) <= 1000);
    if (spec.hostTileType !== hostTileType || !levelMatches) continue;
    if (state.totalPopulation < (spec.minPopulation ?? 0)) continue;
    if (!canPlaceEstablishmentAt(state, spec.id, x, y, ignoreTile)) continue;

    if (spec.prefersCentralDense && distFromCenter > 9.5) {
      continue;
    }

    const covPct = state.stats.coverage[spec.driverArea]?.coveragePct ?? 80;
    const covBoost = Math.max(0.5, Math.min(1.8, covPct / 85));
    // Give shoreline Marina and neighborhood services high priority when a valid spaced slot opens
    const baseWeight = spec.requiresWaterAdjacent
      ? 3.2
      : spec.prefersCentralDense
        ? 1.9
        : 1.4;
    candidates.push({ spec, weight: baseWeight * covBoost });
  }

  if (candidates.length === 0) return null;

  let totalW = 0;
  for (const c of candidates) totalW += c.weight;
  let roll = nextRandom(state) * totalW;
  let chosenSpec = candidates[0].spec;
  for (const c of candidates) {
    roll -= c.weight;
    if (roll <= 0) {
      chosenSpec = c.spec;
      break;
    }
  }

  return {
    establishmentId: chosenSpec.id,
    variant: pickEstablishmentVariation(state, chosenSpec.id),
  };
}


/** Pick an architectural variant (0..7) distinct from orthogonal neighbors so adjacent buildings look unique */
function pickDistinctBuildingVariant(state: CityState, x: number, y: number): number {
  const used = new Set<number>();
  for (const [dx, dy] of [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const nt = getTile(state, x + dx, y + dy);
    if (nt && isBuildingType(nt.type)) {
      used.add(nt.variant % 8);
    }
  }
  const available: number[] = [];
  for (let v = 0; v < 8; v++) {
    if (!used.has(v)) available.push(v);
  }
  if (available.length > 0) {
    return available[Math.floor(nextRandom(state) * available.length)];
  }
  return Math.floor(nextRandom(state) * 8);
}

/**
 * Assign a multi-tile compound of any dimensions (`w × h`, e.g. 1×1, 2×1, 2×2, 3×2, 3×3, 4×3, 8×16, 12×24)
 * across a rectangular block of tiles, automatically demolishing any partially overlapped compounds or roads!
 */
function assignCompoundLot(
  state: CityState,
  anchorX: number,
  anchorY: number,
  w: number,
  h: number,
  type: TileType,
  level: number,
  variant: number,
  evolveFlash: number = 1.0,
  establishmentId?: EstablishmentId
): Tile[] {
  let demolishedRoad = false;

  // Automatically demolish any outside remnants of existing multi-tile compounds that partially overlap [anchorX..anchorX+w-1, anchorY..anchorY+h-1]
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const t = getTile(state, anchorX + dx, anchorY + dy);
      if (!t) continue;
      if (t.type === 'road') {
        demolishedRoad = true;
      }
      if ((t.lotWidth ?? 1) > 1 || (t.lotHeight ?? 1) > 1) {
        const comp = getCompoundTiles(state, t);
        for (const ct of comp) {
          const insideNew =
            ct.x >= anchorX &&
            ct.x < anchorX + w &&
            ct.y >= anchorY &&
            ct.y < anchorY + h;
          if (!insideNew) {
            resetTileToGrass(ct, 0.9);
          }
        }
      }
    }
  }

  const affected: Tile[] = [];
  const isMulti = w > 1 || h > 1;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const t = getTile(state, anchorX + dx, anchorY + dy);
      if (!t) continue;
      t.type = type;
      t.level = level;
      t.variant = variant;
      t.previousType = undefined;
      t.establishmentId = establishmentId;
      t.age = 0;
      t.evolutionProgress = 0;
      t.upgradeCooldown =
        type === 'rural' ||
        type === 'residential' ||
        type === 'commercial' ||
        type === 'industrial'
          ? level >= 2
            ? GROWTH_CONFIG.upgradeCooldownLv2To3
            : GROWTH_CONFIG.upgradeCooldownLv1To2
          : 0;
      t.evolveFlash =
        evolveFlash > 0 &&
        (type === 'rural' ||
          type === 'residential' ||
          type === 'commercial' ||
          type === 'industrial' ||
          type === 'park' ||
          type === 'port' ||
          type === 'airport' ||
          type === 'stadium' ||
          type === 'shopping')
          ? Math.max(1.75, evolveFlash)
          : evolveFlash;
      t.lotRole = !isMulti ? 'single' : dx === 0 && dy === 0 ? 'anchor' : 'part';
      t.lotWidth = w;
      t.lotHeight = h;
      t.lotDx = dx;
      t.lotDy = dy;
      t.construction = undefined;
      affected.push(t);
    }
  }

  if (demolishedRoad) {
    reconcileRoadHierarchy(state);
  }

  return affected;
}

/** Resolve the top-left anchor tile of a single or multi-tile compound */
export function getCompoundAnchorTile(state: CityState, tile: Tile): Tile | null {
  const anchorX = tile.x - (tile.lotDx ?? 0);
  const anchorY = tile.y - (tile.lotDy ?? 0);
  return getTile(state, anchorX, anchorY) ?? tile;
}

/** Collect all tiles belonging to the same multi-tile compound as `tile` */
export function getCompoundTiles(state: CityState, tile: Tile): Tile[] {
  const w = tile.lotWidth ?? 1;
  const h = tile.lotHeight ?? 1;
  if (w <= 1 && h <= 1) return [tile];
  const anchorX = tile.x - (tile.lotDx ?? 0);
  const anchorY = tile.y - (tile.lotDy ?? 0);
  const out: Tile[] = [];
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const t = getTile(state, anchorX + dx, anchorY + dy);
      if (t && t.type === tile.type) {
        out.push(t);
      }
    }
  }
  return out.length > 0 ? out : [tile];
}

/** Reset a single tile back to clean grass so a new road or structure can be built in its place */
function resetTileToGrass(t: Tile, flash: number = 0.9): void {
  t.type = 'grass';
  t.level = 0;
  t.variant = (t.x * 3 + t.y * 5) % 4;
  t.previousType = undefined;
  t.establishmentId = undefined;
  t.age = 0;
  t.evolutionProgress = 0;
  t.upgradeCooldown = 0;
  t.evolveFlash = flash;
  t.lotRole = 'single';
  t.lotWidth = 1;
  t.lotHeight = 1;
  t.lotDx = 0;
  t.lotDy = 0;
  t.construction = undefined;
}

/**
 * Demolish a building compound, house, park, road, or bridge at `(tx, ty)` so the area can be rebuilt or evolve.
 * - Multi-tile compounds (e.g., 2×1, 1×2, 2×2) are demolished as a complete unit.
 * - Bridge crossings are demolished across their full contiguous water span (restoring `'water'`).
 */
export function demolishCityTile(
  state: CityState,
  tx: number,
  ty: number
): { ok: boolean; reason?: string; demolishedLabel?: string; tilesCleared: number } {
  const tile = getTile(state, tx, ty);
  if (!tile) {
    return { ok: false, reason: 'Lote fora dos limites do mapa.', tilesCleared: 0 };
  }
  if (tile.construction) {
    return {
      ok: false,
      reason: 'Este lote está reservado para uma obra pública em andamento.',
      tilesCleared: 0,
    };
  }
  if (tile.type === 'water') {
    return { ok: false, reason: 'Não é possível demolir o leito natural do rio.', tilesCleared: 0 };
  }
  if (tile.type === 'grass' || tile.type === 'forest') {
    return { ok: false, reason: 'Este terreno já está livre para novas construções.', tilesCleared: 0 };
  }

  // Demolish full contiguous river bridge span back to water
  if (tile.type === 'bridge') {
    const stack: Tile[] = [tile];
    const visited = new Set<number>([tile.y * state.gridWidth + tile.x]);
    const span: Tile[] = [];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      span.push(cur);
      for (const [dx, dy] of [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ]) {
        const nt = getTile(state, cur.x + dx, cur.y + dy);
        if (!nt || nt.type !== 'bridge') continue;
        const idx = nt.y * state.gridWidth + nt.x;
        if (!visited.has(idx)) {
          visited.add(idx);
          stack.push(nt);
        }
      }
    }
    for (const bt of span) {
      bt.type = 'water';
      bt.level = 0;
      bt.age = 0;
      bt.evolveFlash = 1.1;
      bt.lotRole = 'single';
      bt.lotWidth = 1;
      bt.lotHeight = 1;
      bt.lotDx = 0;
      bt.lotDy = 0;
    }
    reconcileRoadHierarchy(state);
    state.mapVersion += 1;
    state.pendingSounds.push({ type: 'decay' });
    pushNews(
      state,
      'Ponte demolida para reestruturação viária e abertura de novos projetos!',
      'info'
    );
    recomputeFieldsAndStats(state);
    return {
      ok: true,
      demolishedLabel: 'Ponte sobre o Rio',
      tilesCleared: span.length,
    };
  }

  // Demolish road segment (protect external highway portal and active Toll Plaza)
  if (tile.type === 'road') {
    if (isExternalBorderRoadTile(state, tx, ty) || isTollPlazaTile(state, tx, ty)) {
      return {
        ok: false,
        reason: 'A rodovia externa de acesso regional e o ponto de pedágio não podem ser demolidos.',
        tilesCleared: 0,
      };
    }
    const roadLabel = getRoadClassLabel(tile.level || 1, tile.variant || 0);
    resetTileToGrass(tile, 1.0);
    reconcileRoadHierarchy(state);
    state.mapVersion += 1;
    state.pendingSounds.push({ type: 'decay' });
    pushNews(
      state,
      `${roadLabel} (${tx},${ty}) demolida para reorganização e evolução da área.`,
      'info'
    );
    recomputeFieldsAndStats(state);
    return {
      ok: true,
      demolishedLabel: roadLabel,
      tilesCleared: 1,
    };
  }

  // Demolish building or multi-tile compound
  const label = getZoneDisplayLabel(tile);
  const compound = getCompoundTiles(state, tile);
  for (const ct of compound) {
    resetTileToGrass(ct, 1.1);
  }
  state.mapVersion += 1;
  state.pendingSounds.push({ type: 'decay' });
  pushNews(
    state,
    `${label} demolido para abrir espaço a novas construções mais modernas!`,
    'info'
  );
  recomputeFieldsAndStats(state);
  return {
    ok: true,
    demolishedLabel: label,
    tilesCleared: compound.length,
  };
}

export function isNavigableWater(type: TileType): boolean {
  return type === 'water' || type === 'bridge';
}

export function isCruiseNavigableWater(type: TileType): boolean {
  return type === 'water';
}

/**
 * Compute all open river `'water'` tile indices reachable from the map perimeter
 * without crossing any `'bridge'` tile.
 */
export function getBridgeFreeRiverEdgeWaterSet(state: CityState): Set<number> {
  const gw = state.gridWidth;
  const gh = state.gridHeight;
  const reachable = new Set<number>();
  const queue: number[] = [];

  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (x !== 0 && x !== gw - 1 && y !== 0 && y !== gh - 1) continue;
      const idx = y * gw + x;
      if (state.tiles[idx]?.type === 'water' && !reachable.has(idx)) {
        reachable.add(idx);
        queue.push(idx);
      }
    }
  }

  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    const cx = idx % gw;
    const cy = Math.floor(idx / gw);
    for (const [dx, dy] of ORTHO_DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= gw || ny < 0 || ny >= gh) continue;
      const nIdx = ny * gw + nx;
      if (!reachable.has(nIdx) && state.tiles[nIdx]?.type === 'water') {
        reachable.add(nIdx);
        queue.push(nIdx);
      }
    }
  }

  return reachable;
}

export interface CruisePortNavigationInfo {
  targetPortAnchor: Tile | null;
  navigableWater: Set<number>;
  distToPort: Map<number, number>;
  distToMouth: Map<number, number>;
}

/**
 * Find the best Level 3 Cruise Port reachable from the open river mouth with NO bridge in the way,
 * along with open-water (`'water'` only) BFS distance fields between the river mouth and that port.
 */
export function getCruisePortNavigationInfo(state: CityState): CruisePortNavigationInfo {
  const empty: CruisePortNavigationInfo = {
    targetPortAnchor: null,
    navigableWater: new Set<number>(),
    distToPort: new Map<number, number>(),
    distToMouth: new Map<number, number>(),
  };

  const gw = state.gridWidth;
  const gh = state.gridHeight;
  const cruisePortTiles = state.tiles.filter(
    (t) => t.type === 'port' && (t.level || 1) >= 3
  );
  if (cruisePortTiles.length === 0) return empty;

  // Group tiles by port anchor/cluster
  const portClusters = new Map<number, { anchor: Tile; adjacentWater: number[] }>();
  for (const pt of cruisePortTiles) {
    const anchorX = pt.x - (pt.lotDx ?? 0);
    const anchorY = pt.y - (pt.lotDy ?? 0);
    const anchor =
      getTile(state, anchorX, anchorY) ??
      pt;
    const key = anchor.y * gw + anchor.x;
    if (!portClusters.has(key)) {
      portClusters.set(key, { anchor, adjacentWater: [] });
    }
    const cluster = portClusters.get(key)!;
    for (const [dx, dy] of ORTHO_DIRS) {
      const nt = getTile(state, pt.x + dx, pt.y + dy);
      if (nt && nt.type === 'water') {
        const wIdx = nt.y * gw + nt.x;
        if (!cluster.adjacentWater.includes(wIdx)) {
          cluster.adjacentWater.push(wIdx);
        }
      }
    }
  }

  const openEdgeWater = getBridgeFreeRiverEdgeWaterSet(state);

  // Pick the bridge-free Cruise Port (adjacent water connects to open river edge without crossing any bridge)
  let bestCluster: {
    anchor: Tile;
    adjacentWater: number[];
    component: Set<number>;
    mouthTiles: number[];
  } | null = null;

  for (const cluster of portClusters.values()) {
    const openAdj = cluster.adjacentWater.filter((idx) => openEdgeWater.has(idx));
    if (openAdj.length === 0) continue;

    // Collect the exact water-only connected component feeding this bridge-free port
    const component = new Set<number>(openAdj);
    const queue = [...openAdj];
    const mouthTiles: number[] = [];
    let head = 0;
    while (head < queue.length) {
      const idx = queue[head++];
      const cx = idx % gw;
      const cy = Math.floor(idx / gw);
      if (cx === 0 || cx === gw - 1 || cy === 0 || cy === gh - 1) {
        mouthTiles.push(idx);
      }
      for (const [dx, dy] of ORTHO_DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= gw || ny < 0 || ny >= gh) continue;
        const nIdx = ny * gw + nx;
        if (!component.has(nIdx) && state.tiles[nIdx]?.type === 'water') {
          component.add(nIdx);
          queue.push(nIdx);
        }
      }
    }

    if (
      !bestCluster ||
      component.size > bestCluster.component.size
    ) {
      bestCluster = {
        anchor: cluster.anchor,
        adjacentWater: openAdj,
        component,
        mouthTiles,
      };
    }
  }

  if (!bestCluster || bestCluster.component.size < 2) return empty;

  const runBfs = (seeds: number[]): Map<number, number> => {
    const dist = new Map<number, number>();
    const q: number[] = [];
    for (const s of seeds) {
      if (!bestCluster!.component.has(s) || dist.has(s)) continue;
      dist.set(s, 0);
      q.push(s);
    }
    let head = 0;
    while (head < q.length) {
      const idx = q[head++];
      const d = dist.get(idx)!;
      const cx = idx % gw;
      const cy = Math.floor(idx / gw);
      for (const [dx, dy] of ORTHO_DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= gw || ny < 0 || ny >= gh) continue;
        const nIdx = ny * gw + nx;
        if (bestCluster!.component.has(nIdx) && !dist.has(nIdx)) {
          dist.set(nIdx, d + 1);
          q.push(nIdx);
        }
      }
    }
    return dist;
  };

  return {
    targetPortAnchor: bestCluster.anchor,
    navigableWater: bestCluster.component,
    distToPort: runBfs(bestCluster.adjacentWater),
    distToMouth: runBfs(bestCluster.mouthTiles),
  };
}

export function formatDateLabel(month: number, year: number): string {
  const m = MONTH_NAMES[(month - 1) % 12] ?? 'Jan';
  return `${m}/${year}`;
}

function roundTo10(value: number, minVal: number = 100): number {
  return Math.max(minVal, Math.round(value / 10) * 10);
}

function createDefaultBudgets(): CityBudgets {
  return {
    infrastructure: BUDGET_AREA_META.infrastructure.defaultMonthly,
    education: BUDGET_AREA_META.education.defaultMonthly,
    security: BUDGET_AREA_META.security.defaultMonthly,
    wellbeing: BUDGET_AREA_META.wellbeing.defaultMonthly,
    entertainment: BUDGET_AREA_META.entertainment.defaultMonthly,
    tourism: BUDGET_AREA_META.tourism.defaultMonthly,
  };
}

export function sanitizeDifficulty(raw?: unknown): DifficultyLevel {
  if (raw === 'easy' || raw === 'medium' || raw === 'hard') return raw;
  return DEFAULT_DIFFICULTY;
}

function createDefaultTargetPcts(
  difficulty: DifficultyLevel = DEFAULT_DIFFICULTY
): Record<BudgetAreaKey, number> {
  if (difficulty === 'easy') {
    return {
      infrastructure: 100,
      education: 100,
      security: 100,
      wellbeing: 100,
      entertainment: 100,
      tourism: 100,
    };
  }
  if (difficulty === 'hard') {
    return {
      infrastructure: 68,
      education: 58,
      security: 65,
      wellbeing: 68,
      entertainment: 48,
      tourism: 40,
    };
  }
  return {
    infrastructure: 75,
    education: 72,
    security: 72,
    wellbeing: 75,
    entertainment: 68,
    tourism: 65,
  };
}

function createZeroAreaRecord(): Record<BudgetAreaKey, number> {
  return {
    infrastructure: 0,
    education: 0,
    security: 0,
    wellbeing: 0,
    entertainment: 0,
    tourism: 0,
  };
}

function createInitialWorkTiers(): Record<EmergencyActionId, number> {
  return {
    sports_center_project: 1,
    bus_transit_project: 1,
    metro_transit_project: 1,
    port_evolution: 1,
    airport_evolution: 1,
    shopping_evolution: 1,
    toll_plaza_project: 1,
    environmental_cleanup: 1,
    revitalization: 1,
    tourism_festival: 1,
    emergency_roadworks: 1,
    landmark_project: 1,
    incident_response: 1,
  };
}

function createInitialTollPlaza(): TollPlazaState {
  return {
    built: false,
    tariff: 'medium',
    visitorFlowPct: 100,
    monthlyVehicles: 0,
    monthlyRevenue: 0,
  };
}

function createEmptyCoverage(budgets: CityBudgets): Record<BudgetAreaKey, BudgetAreaStatus> {
  const out = {} as Record<BudgetAreaKey, BudgetAreaStatus>;
  for (const key of BUDGET_AREA_ORDER) {
    const invested = budgets[key];
    const needed = Math.max(100, invested);
    const pct = Math.round((invested / needed) * 100);
    out[key] = {
      invested,
      needed,
      coveragePct: pct,
      targetPct: pct,
      breakthroughPct: 0,
    };
  }
  return out;
}

function createEmptyCityStats(budgets: CityBudgets): CityStats {
  return {
    population: 0,
    avgPollution: 0,
    happiness: 74,
    serviceCoverageAvg: 80,
    budgetTotal: BUDGET_AREA_ORDER.reduce((s, k) => s + budgets[k], 0),
    tourismRevenue: 0,
    tradeRevenue: 0,
    ruralCount: 0,
    residentialCount: 0,
    resLowValueCount: 0,
    resMedValueCount: 0,
    resHighValueCount: 0,
    commercialCount: 0,
    industrialCount: 0,
    parkCount: 0,
    abandonedCount: 0,
    multiTileBuildingCount: 0,
    establishmentCount: 0,
    roadCount: 0,
    streetCount: 0,
    avenueCount: 0,
    highwayCount: 0,
    interchangeCount: 0,
    bridgeCount: 0,
    bridgeSpanCount: 0,
    bridgeLevel: 1,
    portCount: 0,
    airportCount: 0,
    stadiumCount: 0,
    sportsCenterCount: 0,
    busStationCount: 0,
    metroStationCount: 0,
    shoppingCount: 0,
    shoppingLevel: 0,
    wideAvenueTileCount: 0,
    monthlyTransitRiders: 0,
    transitCoveragePct: 0,
    condoCount: 0,
    midRiseCount: 0,
    level3Count: 0,
    visitorTrafficPct: 100,
    coverage: createEmptyCoverage(budgets),
  };
}

function createEmptyFinancials(): MonthlyFinancials {
  return {
    revenue: {
      residentialTax: 0,
      commercialTax: 0,
      industrialTax: 0,
      tourismIncome: 0,
      tradeIncome: 0,
      tollIncome: 0,
      total: 0,
    },
    expenses: {
      variableBudgets: 0,
      fixedRoadsAndBridges: 0,
      fixedCityHall: FIXED_COSTS_CONFIG.baseCityHall,
      fixedTotal: FIXED_COSTS_CONFIG.baseCityHall,
      total: FIXED_COSTS_CONFIG.baseCityHall,
    },
    netBalance: 0,
    fairTaxRate: 11.5,
    eventRevenueMult: 1.0,
    eventExpenseMult: 1.0,
  };
}

/** Check if `(tx, ty)` is the outer border portal of the external regional highway */
export function isExternalBorderRoadTile(state: CityState, tx: number, ty: number): boolean {
  const hw = state.externalHighway;
  return Boolean(hw && hw.borderX === tx && hw.borderY === ty);
}

/** Check if `(tx, ty)` is the Toll Plaza tile on the external regional highway */
export function isTollPlazaTile(state: CityState, tx: number, ty: number): boolean {
  const hw = state.externalHighway;
  return Boolean(hw && hw.tollX === tx && hw.tollY === ty);
}

/** Check if `(tx, ty)` lies on the outer external highway connector corridor */
export function isExternalHighwayCorridorTile(state: CityState, tx: number, ty: number): boolean {
  const hw = state.externalHighway;
  if (!hw) return false;
  if (hw.edge === 'west') {
    return ty === hw.borderY && tx <= Math.max(hw.tollX + 2, 5);
  }
  if (hw.edge === 'east') {
    return ty === hw.borderY && tx >= Math.min(hw.tollX - 2, state.gridWidth - 6);
  }
  if (hw.edge === 'north') {
    return tx === hw.borderX && ty <= Math.max(hw.tollY + 2, 5);
  }
  return tx === hw.borderX && ty >= Math.min(hw.tollY - 2, state.gridHeight - 6);
}

/** Compute combined gameplay modifiers from active economic cycle and urban incident */
export function getActiveEventModifiers(state: CityState): {
  revenueMult: number;
  expenseMult: number;
  growthMult: number;
  happinessDelta: number;
  servicePenaltyPct: number;
} {
  let revenueMult = 1.0;
  let expenseMult = 1.0;
  let growthMult = 1.0;
  let happinessDelta = 0;
  let servicePenaltyPct = 0;

  for (const ev of [state.activeEconomicEvent, state.activeUrbanIncident]) {
    if (!ev || ev.remainingMonths <= 0) continue;
    const spec = RANDOM_EVENT_SPECS[ev.id];
    if (!spec) continue;
    revenueMult *= spec.revenueMult;
    expenseMult *= spec.expenseMult;
    growthMult *= spec.growthMult;
    happinessDelta += spec.happinessDelta;
    servicePenaltyPct += spec.servicePenaltyPct;
  }

  return {
    revenueMult,
    expenseMult,
    growthMult,
    happinessDelta,
    servicePenaltyPct: Math.min(35, servicePenaltyPct),
  };
}

/**
 * Guarantee a continuous planned external highway extending from the central road origin
 * all the way to the outer dry map border (`x = 0 | gridWidth - 1` or `y = 0 | gridHeight - 1`),
 * keeping the border portal and toll plaza location cleanly updated even after map expansions or legacy save loads.
 */
export function ensureExternalHighwayConnected(
  state: CityState,
  preferredEdge?: ExternalHighwayEdge
): ExternalHighwayState {
  const gw = state.gridWidth;
  const gh = state.gridHeight;
  const ox = Math.max(2, Math.min(gw - 3, state.roadOriginX ?? Math.floor(gw / 2) - 1));
  const oy = Math.max(2, Math.min(gh - 3, state.roadOriginY ?? Math.floor(gh / 2) - 1));

  // Score all 4 cardinal axes from (ox, oy) to the outer border, preferring dry (zero-water) routes
  const edges: ExternalHighwayEdge[] = preferredEdge
    ? [preferredEdge, 'west', 'east', 'north', 'south'].filter(
        (v, idx, arr) => arr.indexOf(v) === idx
      ) as ExternalHighwayEdge[]
    : ['west', 'east', 'north', 'south'];

  let chosenEdge: ExternalHighwayEdge = preferredEdge ?? 'west';
  if (!preferredEdge) {
    let bestScore = -Infinity;
    for (const edge of edges) {
      let waterHits = 0;
      let existingRoads = 0;
      const dx = edge === 'east' ? 1 : edge === 'west' ? -1 : 0;
      const dy = edge === 'south' ? 1 : edge === 'north' ? -1 : 0;
      let cx = ox + dx;
      let cy = oy + dy;
      while (cx >= 0 && cy >= 0 && cx < gw && cy < gh) {
        const t = getTile(state, cx, cy);
        if (t?.type === 'water') waterHits++;
        else if (t && isRoadLike(t.type)) existingRoads++;
        cx += dx;
        cy += dy;
      }
      const score = existingRoads * 3 - waterHits * 40;
      if (score > bestScore) {
        bestScore = score;
        chosenEdge = edge;
      }
    }
  }

  const dx = chosenEdge === 'east' ? 1 : chosenEdge === 'west' ? -1 : 0;
  const dy = chosenEdge === 'south' ? 1 : chosenEdge === 'north' ? -1 : 0;
  const borderX = chosenEdge === 'west' ? 0 : chosenEdge === 'east' ? gw - 1 : ox;
  const borderY = chosenEdge === 'north' ? 0 : chosenEdge === 'south' ? gh - 1 : oy;

  // Lay continuous highway/bridge tiles from (ox, oy) straight to (borderX, borderY)
  let cx = ox;
  let cy = oy;
  while (cx >= 0 && cy >= 0 && cx < gw && cy < gh) {
    const t = getTile(state, cx, cy);
    if (t) {
      if (t.type === 'water') {
        t.type = 'bridge';
        t.level = Math.max(1, state.stats?.bridgeLevel || 1);
        t.variant = 1;
      } else if (t.type !== 'road' && t.type !== 'bridge') {
        if (isBuildingType(t.type)) {
          for (const ct of getCompoundTiles(state, t)) {
            resetTileToGrass(ct, 0);
          }
        }
        t.type = 'road';
        t.level = 3;
        t.variant = 1;
        t.establishmentId = undefined;
        t.lotRole = 'single';
        t.lotWidth = 1;
        t.lotHeight = 1;
        t.lotDx = 0;
        t.lotDy = 0;
      }
    }
    if (cx === borderX && cy === borderY) break;
    cx += dx;
    cy += dy;
  }

  // Pick a dry road tile 3 tiles inward from the map border for the Toll Plaza (never on water/bridge or Trevo)
  let tollX = borderX - dx * 3;
  let tollY = borderY - dy * 3;
  for (const offset of [3, 2, 4, 1, 5]) {
    const tx = borderX - dx * offset;
    const ty = borderY - dy * offset;
    const candidate = getTile(state, tx, ty);
    if (candidate && candidate.type === 'road' && (candidate.level || 1) < 4) {
      tollX = tx;
      tollY = ty;
      break;
    }
  }

  state.externalHighway = {
    edge: chosenEdge,
    borderX,
    borderY,
    tollX,
    tollY,
  };
  return state.externalHighway;
}

/**
 * Compute fair tax tolerance (%) from average city service coverage (0..115),
 * difficulty, and Education expectation shift (more educated citizens demand fairer taxes).
 */
export function computeFairTaxRate(
  serviceCoverageAvg: number,
  difficulty: DifficultyLevel = DEFAULT_DIFFICULTY,
  educationCoveragePct: number = 80
): number {
  const clamped = Math.max(0, Math.min(115, serviceCoverageAvg));
  const diffBonus = DIFFICULTY_CONFIGS[sanitizeDifficulty(difficulty)].fairTaxBonus;
  const eduDemandShift =
    educationCoveragePct > 80
      ? ((Math.min(200, educationCoveragePct) - 80) / 120) * 1.1
      : 0;
  return Math.round((6.8 + (clamped / 100) * 4.4 + diffBonus - eduDemandShift) * 10) / 10;
}

/** Return highest active boost tier (0 if inactive) for an emergency action */
function getBoostTier(state: CityState, actionId: EmergencyActionId): number {
  let maxTier = 0;
  for (const b of state.activeBoosts) {
    if (b.actionId === actionId && b.remainingMonths > 0) {
      maxTier = Math.max(maxTier, b.tier || 1);
    }
  }
  return maxTier;
}

function hasCityBoost(state: CityState, actionId: EmergencyActionId): boolean {
  return getBoostTier(state, actionId) > 0;
}

/**
 * Effective bounded segment curve across 0..200% of need:
 * <100% penalizes progressively; 100% = 1.00; 150% = ~1.16; 200% = 1.28 cap.
 */
function getCovRatio(state: CityState, key: BudgetAreaKey): number {
  const st = state.stats.coverage[key];
  if (!st || st.needed <= 0) return 1;
  const pct = Math.max(0, Math.min(200, (st.invested / st.needed) * 100));
  return getSegmentEffectCurve(pct).effectiveFactor;
}

export function sanitizeCityName(raw?: string | null): string {
  const cleaned = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, 32) : '';
  return cleaned.length > 0 ? cleaned : 'Pixópolis';
}

let saveSeqCounter = 1;
export function createCitySaveId(seed: number): string {
  saveSeqCounter = (saveSeqCounter + 1) % 100000;
  return `city_${seed}_${Date.now().toString(36)}_${saveSeqCounter.toString(36)}`;
}

export function setCityName(state: CityState, name: string): void {
  state.cityName = sanitizeCityName(name);
}

export function createNewCity(
  rawSeed?: number,
  rawDifficulty: DifficultyLevel = DEFAULT_DIFFICULTY,
  rawCityName?: string
): CityState {
  const difficulty = sanitizeDifficulty(rawDifficulty);
  const cityName = sanitizeCityName(rawCityName);
  const diffCfg = DIFFICULTY_CONFIGS[difficulty];
  const seed =
    rawSeed !== undefined
      ? (Math.floor(rawSeed) >>> 0) || 1337
      : Math.floor(Math.random() * 899999 + 100000);

  const rng = createSeededRng(seed);
  const gridWidth = GRID_SIZE;
  const gridHeight = GRID_SIZE;

  const traitIndex = Math.floor(rng() * CITY_TRAITS.length);
  const trait = CITY_TRAITS[traitIndex];

  const tiles: Tile[] = new Array(gridWidth * gridHeight);
  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      tiles[y * gridWidth + x] = {
        x,
        y,
        type: 'grass',
        level: 0,
        variant: Math.floor(rng() * 4),
        pollution: 0,
        landValue: 30,
        age: 0,
        evolutionProgress: 0,
        upgradeCooldown: 0,
        evolveFlash: 0,
      };
    }
  }

  // 1. Carve a continuous winding river with organic width variations (narrow bends of 2-3 tiles,
  //    medium reaches of 4-5 tiles, and wider river basins of 6-8 tiles — strictly never exceeding 8 squares!)
  const verticalRiver = rng() > 0.5;
  const riverSide = rng() > 0.5 ? 1 : -1;
  const baseOffset = riverSide * (8.5 + rng() * 3.0);
  const waveFreq = 0.14 + rng() * 0.07;
  const wavePhase = rng() * Math.PI * 2;
  const widthPhase = rng() * Math.PI * 2;
  const waveAmp = 1.8 + rng() * 1.8;
  const midCoord = (gridWidth - 1) / 2;

  for (let i = 0; i < gridWidth; i++) {
    let centerLine =
      midCoord +
      baseOffset +
      Math.sin(i * waveFreq + wavePhase) * waveAmp +
      Math.cos(i * 0.08 - wavePhase) * 0.9;

    // Smoothly vary river width along its length: some stretches 2-3 tiles, some 4-5, some 6-8 tiles (max 8)
    const widthWave =
      (Math.sin(i * 0.23 + widthPhase) * 0.5 + 0.5) * 0.62 +
      (Math.cos(i * 0.12 - widthPhase * 0.65) * 0.5 + 0.5) * 0.38;
    const sliceWidthTiles = Math.max(2, Math.min(8, Math.round(2.3 + widthWave * 5.6)));
    const halfSpan = (sliceWidthTiles - 1) * 0.5;

    // Keep central starter blocks and avenues completely dry
    const distAlong = Math.abs(i - midCoord);
    if (distAlong < 8) {
      const minClearance = 5.6 + halfSpan;
      const offsetFromMid = centerLine - midCoord;
      if (Math.abs(offsetFromMid) < minClearance) {
        const push = (1 - distAlong / 8) * (minClearance - Math.abs(offsetFromMid));
        centerLine += riverSide * push;
      }
    }

    let startJ = Math.round(centerLine - halfSpan);
    let endJ = startJ + sliceWidthTiles - 1;
    if (startJ < 1) {
      startJ = 1;
      endJ = Math.min(gridHeight - 2, startJ + sliceWidthTiles - 1);
    }
    if (endJ > gridHeight - 2) {
      endJ = gridHeight - 2;
      startJ = Math.max(1, endJ - sliceWidthTiles + 1);
    }

    for (let j = startJ; j <= endJ; j++) {
      const x = verticalRiver ? j : i;
      const y = verticalRiver ? i : j;
      tiles[y * gridWidth + x].type = 'water';
    }
  }

  // 2. Plant organic forest clusters across the valley
  const groveCount = 8 + Math.floor(rng() * 5);
  for (let g = 0; g < groveCount; g++) {
    const gx = 2 + rng() * (gridWidth - 4);
    const gy = 2 + rng() * (gridHeight - 4);
    const radius = 2.4 + rng() * 3.4;
    for (let y = 0; y < gridHeight; y++) {
      for (let x = 0; x < gridWidth; x++) {
        if (x >= 14 && x <= 21 && y >= 14 && y <= 21) continue;
        const t = tiles[y * gridWidth + x];
        if (t.type !== 'grass') continue;
        const d = Math.hypot(x - gx, y - gy);
        if (d < radius && rng() < 0.78 - (d / radius) * 0.45) {
          t.type = 'forest';
          t.variant = Math.floor(rng() * 4);
        }
      }
    }
  }

  // 3. Seed starter city with an organized urban master plan (Plano Diretor Viário):
  //    - Central Rotatória at (originX, originY)
  //    - Central Avenidas (Nv. 2) on originX / originY
  //    - Regional Estrada Expressa (Nv. 3) along the dry ±6 ring corridor with a Trevo Rodoviário (Nv. 4)
  //    - Clean Starter Ruas Locais (Nv. 1) framing neat 2x2 city blocks
  const c = Math.floor(gridWidth / 2); // 18
  const originX = c - 1; // 17
  const originY = c - 1; // 17
  const drySide = -riverSide; // Place regional expressway opposite the river so it never clashes with water

  const layStarterRoad = (rx: number, ry: number, level: number, variant: number = 0) => {
    if (rx < 1 || ry < 1 || rx >= gridWidth - 1 || ry >= gridHeight - 1) return;
    const t = tiles[ry * gridWidth + rx];
    if (t.type === 'water') return;
    t.type = 'road';
    t.level = level;
    t.variant = variant;
  };

  // Central Avenue Cross (Nv. 2) — trimmed gracefully if river approaches
  for (let d = -3; d <= 3; d++) {
    layStarterRoad(originX + d, originY, 2);
    layStarterRoad(originX, originY + d, 2);
  }
  // Extend Avenue seamlessly to the Regional Highway corridor (±6 on the dry side)
  if (verticalRiver) {
    for (let step = 4; step <= 6; step++) {
      layStarterRoad(originX + drySide * step, originY, 2);
    }
    const hx = originX + drySide * 6;
    for (let d = -3; d <= 3; d++) {
      layStarterRoad(hx, originY + d, 3);
    }
    // Trevo Rodoviário connecting Estrada Expressa -> Avenida Central
    layStarterRoad(hx, originY, 4, 1);
  } else {
    for (let step = 4; step <= 6; step++) {
      layStarterRoad(originX, originY + drySide * step, 2);
    }
    const hy = originY + drySide * 6;
    for (let d = -3; d <= 3; d++) {
      layStarterRoad(originX + d, hy, 3);
    }
    // Trevo Rodoviário connecting Estrada Expressa -> Avenida Central
    layStarterRoad(originX, hy, 4, 1);
  }

  // Central Rotatória Paisagística (Trevo de Avenida)
  layStarterRoad(originX, originY, 4, 0);

  // Starter Ruas Locais (Nv. 1) framing a clean 2x2 neighborhood block on the dry side
  const blkDirX = verticalRiver ? drySide : -1;
  const blkDirY = verticalRiver ? -1 : drySide;
  for (let s = 1; s <= 3; s++) {
    layStarterRoad(originX + blkDirX * s, originY + blkDirY * 3, 1);
    layStarterRoad(originX + blkDirX * 3, originY + blkDirY * s, 1);
  }

  // Starter buildings placed cleanly inside planned 2x2 city blocks, plus 2 peripheral Rural farms on the outer expressway corridor
  const ruralCoordA: [number, number] = verticalRiver
    ? [originX + drySide * 7, originY - 2]
    : [originX - 2, originY + drySide * 7];
  const ruralCoordB: [number, number] = verticalRiver
    ? [originX + drySide * 7, originY + 2]
    : [originX + 2, originY + drySide * 7];

  const starterBuildings: Array<
    [number, number, TileType, number, number, EstablishmentId | undefined]
  > = [
    [originX + blkDirX * 1, originY + blkDirY * 1, 'park', 1, 0, 'fountain_plaza'],
    [originX + blkDirX * 2, originY + blkDirY * 1, 'commercial', 1, 1, 'health_clinic'],
    [originX + blkDirX * 1, originY + blkDirY * 2, 'residential', 1, 0, undefined],
    [originX + blkDirX * 2, originY + blkDirY * 2, 'residential', 1, 2, undefined],
    [originX + blkDirX * 1, originY - blkDirY * 1, 'residential', 1, 6, undefined],
    [ruralCoordA[0], ruralCoordA[1], 'rural', 1, 0, undefined],
    [ruralCoordB[0], ruralCoordB[1], 'rural', 1, 3, undefined],
  ];
  for (const [bx, by, btype, blevel, bvar, estId] of starterBuildings) {
    if (bx < 1 || by < 1 || bx >= gridWidth - 1 || by >= gridHeight - 1) continue;
    const t = tiles[by * gridWidth + bx];
    if (t.type === 'water' || t.type === 'road') continue;
    t.type = btype;
    t.level = blevel;
    t.variant = bvar;
    t.establishmentId = estId;
    t.lotRole = 'single';
    t.lotWidth = 1;
    t.lotHeight = 1;
    t.lotDx = 0;
    t.lotDy = 0;
    t.age = 2;
    t.evolutionProgress = 0;
    t.upgradeCooldown = Math.max(4, GROWTH_CONFIG.upgradeCooldownLv1To2 - 2);
  }

  const budgets = createDefaultBudgets();
  const baseStartingCash = Math.round(INITIAL_MONEY * diffCfg.startingMoneyMultiplier);
  const startingMoney = Math.max(
    1500,
    baseStartingCash + trait.modifiers.startingMoneyBonus
  );

  const initialExternalEdge: ExternalHighwayEdge = verticalRiver
    ? drySide < 0
      ? 'west'
      : 'east'
    : drySide < 0
      ? 'north'
      : 'south';

  const state: CityState = {
    seed,
    cityName,
    saveId: createCitySaveId(seed),
    gridWidth,
    gridHeight,
    gridSize: Math.max(gridWidth, gridHeight),
    expansions: { norte: 0, leste: 0, sul: 0, oeste: 0 },
    mapVersion: 1,
    roadOriginX: originX,
    roadOriginY: originY,
    tiles,
    budgets,
    budgetTargetsPct: createDefaultTargetPcts(difficulty),
    breakthroughCharge: createZeroAreaRecord(),
    breakthroughCount: createZeroAreaRecord(),
    workTiers: createInitialWorkTiers(),
    stats: createEmptyCityStats(budgets),
    trait,
    difficulty,
    money: startingMoney,
    taxes: { ...DEFAULT_TAX_RATES },
    financials: createEmptyFinancials(),
    totalPopulation: 0,
    lastMigrationDelta: 0,
    prevMonthPopulation: 0,
    globalServiceCoverage: 80,
    globalHappiness: 74,
    tick: 0,
    monthElapsedSec: 0,
    month: START_MONTH,
    year: START_YEAR,
    news: [
      {
        id: 1,
        tick: 0,
        dateLabel: formatDateLabel(START_MONTH, START_YEAR),
        text: `${cityName} fundada no modo ${diffCfg.label}! Traço: ${trait.name} — ${trait.summary}`,
        tone: 'milestone',
      },
    ],
    nextNewsId: 2,
    activeBoosts: [],
    pendingWorks: [],
    history: [],
    rngState: (seed ^ 0x9e3779b9) >>> 0,
    pendingSounds: [],
    milestonesReached: {},
    recentMilestoneBanner: null,
    weather: createInitialWeather(START_MONTH, seed),
    seasonMode: 'auto',
    externalHighway: {
      edge: initialExternalEdge,
      borderX: initialExternalEdge === 'west' ? 0 : initialExternalEdge === 'east' ? gridWidth - 1 : originX,
      borderY: initialExternalEdge === 'north' ? 0 : initialExternalEdge === 'south' ? gridHeight - 1 : originY,
      tollX: originX,
      tollY: originY,
    },
    tollPlaza: createInitialTollPlaza(),
    condoPolicy: 'manual',
    activeEconomicEvent: null,
    activeUrbanIncident: null,
    economicEventCooldownMonths: 10,
    urbanIncidentCooldownMonths: 8,
  };

  // Seed starter 2×1 Escola Municipal (with automatic footprint assignment)
  const schoolX = blkDirX > 0 ? originX - 2 : originX + 1;
  const schoolY = originY + blkDirY * 1;
  tryPlaceEstablishmentFootprint(
    state,
    schoolX,
    schoolY,
    ESTABLISHMENT_MAP.municipal_school,
    1,
    0,
    true
  );

  // Guarantee continuous Regional External Highway to the dry outer border (visitors in/out + future Toll Plaza)
  ensureExternalHighwayConnected(state, initialExternalEdge);

  // Starter town buildings begin already constructed; all subsequent growth & renovations animate through 3 stages
  for (let i = 0; i < state.tiles.length; i++) {
    state.tiles[i].evolveFlash = 0;
  }

  reconcileRoadHierarchy(state);
  recomputeFieldsAndStats(state);
  state.prevMonthPopulation = state.totalPopulation;
  state.history.push({
    dateLabel: formatDateLabel(state.month, state.year),
    month: state.month,
    year: state.year,
    population: state.totalPopulation,
    money: Math.round(state.money),
    revenue: state.financials.revenue.total,
    expenses: state.financials.expenses.total,
    netBalance: state.financials.netBalance,
    happiness: state.globalHappiness,
    migrationDelta: 0,
  });

  return state;
}

export function pushNews(
  state: CityState,
  text: string,
  tone: NewsItem['tone'] = 'info'
): void {
  const item: NewsItem = {
    id: state.nextNewsId++,
    tick: state.tick,
    dateLabel: formatDateLabel(state.month, state.year),
    text,
    tone,
  };
  state.news.unshift(item);
  if (state.news.length > 24) {
    state.news.length = 24;
  }
}

const ORTHO_DIRS: ReadonlyArray<[number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

function getOrthoNeighbors(state: CityState, x: number, y: number): Tile[] {
  const out: Tile[] = [];
  for (const [dx, dy] of ORTHO_DIRS) {
    const n = getTile(state, x + dx, y + dy);
    if (n) out.push(n);
  }
  return out;
}

/** Positive modulo helper that works identically for negative offsets after land expansion */
function posMod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

export interface PlannedRoadClassification {
  isPlanned: boolean;
  /** 1 = Rua Local, 2 = Avenida, 3 = Estrada Expressa, 4 = Trevo Viário (when arterial crossing) */
  corridorLevel: 1 | 2 | 3;
  isArterialCross: boolean;
  isHighwayCross: boolean;
  isBlockCorner: boolean;
  onHighwayAxis: boolean;
  onAvenueAxis: boolean;
  onLocalAxis: boolean;
}

/**
 * Urban Master Plan (Plano Diretor Viário) coordinate classifier:
 * - Local Streets (Rua, Nv.1): every 3 tiles -> crisp 2x2 buildable city blocks
 * - Boulevards (Avenida, Nv.2): central & 12-tile arterial axes (mod 12 === 0)
 * - Expressways (Estrada, Nv.3): offset 12-tile ring highways (mod 12 === 6)
 * - Planned Interchanges (Trevo, Nv.4): every 6x6 arterial crossing
 */
export function classifyPlannedRoadCell(
  state: Pick<CityState, 'roadOriginX' | 'roadOriginY' | 'gridWidth' | 'gridHeight'>,
  x: number,
  y: number
): PlannedRoadClassification {
  const ox =
    typeof state.roadOriginX === 'number'
      ? state.roadOriginX
      : Math.floor(state.gridWidth / 2) - 1;
  const oy =
    typeof state.roadOriginY === 'number'
      ? state.roadOriginY
      : Math.floor(state.gridHeight / 2) - 1;

  const dx = x - ox;
  const dy = y - oy;

  const { blockStep, arterialStep, highwayCycle, highwayOffset } = ROAD_PLAN_CONFIG;

  const onLocalX = posMod(dx, blockStep) === 0;
  const onLocalY = posMod(dy, blockStep) === 0;
  const onArtX = posMod(dx, arterialStep) === 0;
  const onArtY = posMod(dy, arterialStep) === 0;
  const onHwyX = posMod(dx - highwayOffset, highwayCycle) === 0;
  const onHwyY = posMod(dy - highwayOffset, highwayCycle) === 0;
  const onAveX = onArtX && !onHwyX;
  const onAveY = onArtY && !onHwyY;

  const isArterialCross = onArtX && onArtY;
  const isHighwayCross = isArterialCross && (onHwyX || onHwyY);
  const isBlockCorner = onLocalX && onLocalY;
  const isPlanned = onLocalX || onLocalY;

  const corridorLevel: 1 | 2 | 3 =
    onHwyX || onHwyY ? 3 : onAveX || onAveY ? 2 : 1;

  return {
    isPlanned,
    corridorLevel,
    isArterialCross,
    isHighwayCross,
    isBlockCorner,
    onHighwayAxis: onHwyX || onHwyY,
    onAvenueAxis: onAveX || onAveY,
    onLocalAxis: isPlanned,
  };
}

/**
 * Determine the cohesive urban neighborhood (Bairro) macro-zone for any tile coordinate.
 * Aligns cleanly to the 6×6 arterial macro-blocks so Residential, Commercial, and Industrial
 * neighborhoods form unified districts that fill and evolve together rather than scattering.
 */
export function getNeighborhoodDistrict(
  state: Pick<CityState, 'seed' | 'roadOriginX' | 'roadOriginY' | 'gridWidth' | 'gridHeight'>,
  x: number,
  y: number
): NeighborhoodDistrictType {
  const ox =
    typeof state.roadOriginX === 'number'
      ? state.roadOriginX
      : Math.floor(state.gridWidth / 2) - 1;
  const oy =
    typeof state.roadOriginY === 'number'
      ? state.roadOriginY
      : Math.floor(state.gridHeight / 2) - 1;

  // Group tiles into 6x6 arterial neighborhood macro-blocks (each containing four 2x2 city blocks)
  const bx = Math.floor((x - ox + 3) / 6);
  const by = Math.floor((y - oy + 3) / 6);

  // Downtown Central Core (macro-block 0,0) is always the main Commercial District
  if (bx === 0 && by === 0) return 'commercial';

  // Rotate quadrant layout deterministically per city seed so every map feels unique yet cohesive
  const rot = Math.abs(state.seed || 0) % 4;
  const rx = rot === 0 ? bx : rot === 1 ? -by : rot === 2 ? -bx : by;
  const ry = rot === 0 ? by : rot === 1 ? bx : rot === 2 ? -by : -bx;

  // Dedicated Industrial District grouped cleanly along one cohesive arterial flank & quadrant
  if ((rx >= 1 && ry >= 1) || (rx >= 1 && ry === 0)) {
    return 'industrial';
  }

  // Secondary Commercial sub-center along the main central avenue axis adjacent to downtown
  if ((rx === 0 && ry === -1) || (rx === -1 && ry === 0 && Math.abs(state.seed || 0) % 2 === 0)) {
    return 'commercial';
  }

  // Outer commercial retail corridor every 3rd arterial node
  if (Math.abs(rx) + Math.abs(ry) >= 3 && posMod(rx * 2 + ry + rot, 5) === 0) {
    return 'commercial';
  }

  // Majority of surrounding neighborhoods are cohesive Residential Bairros
  return 'residential';
}

export function getNeighborhoodDistrictLabel(district: NeighborhoodDistrictType): string {
  if (district === 'commercial') return 'Bairro Comercial';
  if (district === 'industrial') return 'Distrito Industrial';
  return 'Bairro Residencial';
}

export interface NeighborhoodMaturity {
  district: NeighborhoodDistrictType;
  totalLots: number;
  builtLots: number;
  emptyLots: number;
  blockBuiltLots: number;
  blockEmptyLots: number;
  lv1Count: number;
  lv2PlusCount: number;
  lv3PlusCount: number;
  avgLevel: number;
  fillRatio: number;
  peerLv2Ratio: number;
  sameZoneDirectLv1Count: number;
  region12TotalLots: number;
  region12BuiltLots: number;
  region12EmptyLots: number;
  region12FillRatio: number;
  region12AllLevel1: boolean;
}

/**
 * Inspect the local neighborhood and 2×2 city block around `(x, y)` to coordinate
 * compact infill and gradual, synchronized peer evolution (preventing giant towers next to tiny houses).
 */
export function getNeighborhoodMaturity(
  state: CityState,
  x: number,
  y: number
): NeighborhoodMaturity {
  const district = getNeighborhoodDistrict(state, x, y);
  const tile = getTile(state, x, y);
  const ownType = tile?.type;

  // Identify the 2×2 buildable block cell coordinates inside the 3-tile planned street grid
  const ox =
    typeof state.roadOriginX === 'number'
      ? state.roadOriginX
      : Math.floor(state.gridWidth / 2) - 1;
  const oy =
    typeof state.roadOriginY === 'number'
      ? state.roadOriginY
      : Math.floor(state.gridHeight / 2) - 1;
  const blockOriginX = x - posMod(x - ox, ROAD_PLAN_CONFIG.blockStep);
  const blockOriginY = y - posMod(y - oy, ROAD_PLAN_CONFIG.blockStep);

  let blockBuiltLots = 0;
  let blockEmptyLots = 0;
  for (let dy = 1; dy <= 2; dy++) {
    for (let dx = 1; dx <= 2; dx++) {
      const bt = getTile(state, blockOriginX + dx, blockOriginY + dy);
      if (!bt || bt.type === 'water' || isRoadLike(bt.type)) continue;
      if (bt.type === 'grass' || bt.type === 'forest') blockEmptyLots++;
      else if (isBuildingType(bt.type)) blockBuiltLots++;
    }
  }

  let totalLots = 0;
  let builtLots = 0;
  let emptyLots = 0;
  let lv1Count = 0;
  let lv2PlusCount = 0;
  let lv3PlusCount = 0;
  let levelSum = 0;
  let leveledCount = 0;
  let sameZoneDirectLv1Count = 0;

  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (Math.abs(dx) + Math.abs(dy) > 4) continue;
      const nt = getTile(state, x + dx, y + dy);
      if (!nt || nt.type === 'water' || isRoadLike(nt.type)) continue;
      if (nt.type === 'grass' || nt.type === 'forest') {
        if (!classifyPlannedRoadCell(state, nt.x, nt.y).isPlanned) {
          totalLots++;
          emptyLots++;
        }
      } else if (
        nt.type === 'residential' ||
        nt.type === 'commercial' ||
        nt.type === 'industrial' ||
        nt.type === 'rural'
      ) {
        totalLots++;
        builtLots++;
        const lv = Math.max(1, nt.level || 1);
        levelSum += lv;
        leveledCount++;
        if (lv <= 1) {
          lv1Count++;
          if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && nt.type === ownType) {
            sameZoneDirectLv1Count++;
          }
        } else {
          lv2PlusCount++;
          if (lv >= 3) lv3PlusCount++;
        }
      } else if (isBuildingType(nt.type)) {
        totalLots++;
        builtLots++;
      }
    }
  }

  // 12×12 Neighborhood Maturity Check:
  // Houses & urban lots can evolve from Lv. 1 -> Lv. 2 once >= 85% of buildable lots
  // in the surrounding 12×12 region are occupied at >= Level 1 (prevents 1 isolated lot from stalling a whole district).
  const regionSize = URBAN_MATURITY_CONFIG.regionSize;
  const halfMin = -Math.floor(regionSize / 2);
  const halfMax = halfMin + regionSize - 1;
  let region12TotalLots = 0;
  let region12BuiltLots = 0;
  let region12EmptyLots = 0;

  for (let dy = halfMin; dy <= halfMax; dy++) {
    for (let dx = halfMin; dx <= halfMax; dx++) {
      const nt = getTile(state, x + dx, y + dy);
      if (!nt || nt.type === 'water' || isRoadLike(nt.type)) continue;
      if (nt.type === 'grass' || nt.type === 'forest') {
        if (!classifyPlannedRoadCell(state, nt.x, nt.y).isPlanned) {
          region12TotalLots++;
          region12EmptyLots++;
        }
      } else if (nt.type === 'abandoned') {
        region12TotalLots++;
        region12EmptyLots++;
      } else if (isBuildingType(nt.type)) {
        region12TotalLots++;
        region12BuiltLots++;
      }
    }
  }

  const region12FillRatio =
    region12TotalLots > 0 ? region12BuiltLots / region12TotalLots : 0;
  const region12AllLevel1 =
    region12TotalLots >= 12 &&
    region12FillRatio >= URBAN_MATURITY_CONFIG.region12MinFillRatio;

  const fillRatio = totalLots > 0 ? builtLots / totalLots : 1;
  const avgLevel = leveledCount > 0 ? levelSum / leveledCount : 1;
  const peerLv2Ratio = leveledCount > 0 ? lv2PlusCount / leveledCount : 0;

  return {
    district,
    totalLots,
    builtLots,
    emptyLots,
    blockBuiltLots,
    blockEmptyLots,
    lv1Count,
    lv2PlusCount,
    lv3PlusCount,
    avgLevel,
    fillRatio,
    peerLv2Ratio,
    sameZoneDirectLv1Count,
    region12TotalLots,
    region12BuiltLots,
    region12EmptyLots,
    region12FillRatio,
    region12AllLevel1,
  };
}

/** Check whether a road tile belongs to a 2-tile-thick Grand Avenue (Avenida Larga 2×2) */
export function isWideAvenue2x2Tile(state: CityState, x: number, y: number): boolean {
  const tile = getTile(state, x, y);
  if (!tile || tile.type !== 'road') return false;
  const quads: Array<Array<[number, number]>> = [
    [
      [x - 1, y - 1],
      [x, y - 1],
      [x - 1, y],
    ],
    [
      [x + 1, y - 1],
      [x, y - 1],
      [x + 1, y],
    ],
    [
      [x - 1, y + 1],
      [x, y + 1],
      [x - 1, y],
    ],
    [
      [x + 1, y + 1],
      [x, y + 1],
      [x + 1, y],
    ],
  ];
  for (const q of quads) {
    let ok = true;
    for (const [qx, qy] of q) {
      const nt = getTile(state, qx, qy);
      if (!nt || !isRoadLike(nt.type)) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/**
 * Check whether a building footprint (`ax, ay, width, height`) borders a true
 * 2-tile-thick Wide Avenue (`2×2` thickness) along at least one of its 4 sides.
 * Required for Level 4 Skyscrapers so they attract heavy urban movement!
 */
export function isAdjacentToWideAvenue2x2(
  state: CityState,
  ax: number,
  ay: number,
  width: number = 1,
  height: number = 1
): boolean {
  const isSideWide = (coords: Array<[number, number]>, nx: number, ny: number): boolean => {
    let wideCount = 0;
    for (const [rx, ry] of coords) {
      const r1 = getTile(state, rx, ry);
      const r2 = getTile(state, rx + nx, ry + ny);
      if (
        r1 &&
        isRoadLike(r1.type) &&
        r2 &&
        isRoadLike(r2.type) &&
        (r1.type !== 'road' || isWideAvenue2x2Tile(state, rx, ry))
      ) {
        wideCount++;
      }
    }
    return wideCount >= Math.min(2, coords.length);
  };

  // North side (y = ay - 1, expanding outward along ny = -1)
  const north: Array<[number, number]> = [];
  const south: Array<[number, number]> = [];
  for (let dx = 0; dx < width; dx++) {
    north.push([ax + dx, ay - 1]);
    south.push([ax + dx, ay + height]);
  }
  if (isSideWide(north, 0, -1) || isSideWide(south, 0, 1)) return true;

  // West / East sides
  const west: Array<[number, number]> = [];
  const east: Array<[number, number]> = [];
  for (let dy = 0; dy < height; dy++) {
    west.push([ax - 1, ay + dy]);
    east.push([ax + width, ay + dy]);
  }
  if (isSideWide(west, -1, 0) || isSideWide(east, 1, 0)) return true;

  return false;
}

/**
 * Safely widen an existing arterial Avenue segment into a 2-tile-thick Grand Avenue (`Avenida Larga 2×2`)
 * without destroying landmarks, transit stations, or Level 2+ buildings.
 */
export function widenAvenueCorridorAt(
  state: CityState,
  roadX: number,
  roadY: number,
  maxLength: number = 5
): number {
  const anchor = getTile(state, roadX, roadY);
  if (!anchor || anchor.type !== 'road') return 0;
  if (isWideAvenue2x2Tile(state, roadX, roadY)) return 0;

  // Detect primary direction of the road corridor (E-W or N-S)
  const hasE = Boolean(getTile(state, roadX + 1, roadY) && isRoadLike(getTile(state, roadX + 1, roadY)!.type));
  const hasW = Boolean(getTile(state, roadX - 1, roadY) && isRoadLike(getTile(state, roadX - 1, roadY)!.type));
  const hasN = Boolean(getTile(state, roadX, roadY - 1) && isRoadLike(getTile(state, roadX, roadY - 1)!.type));
  const hasS = Boolean(getTile(state, roadX, roadY + 1) && isRoadLike(getTile(state, roadX, roadY + 1)!.type));

  const orientations: Array<{ stepX: number; stepY: number; perpX: number; perpY: number }> = [];
  if (hasE || hasW) {
    orientations.push({ stepX: 1, stepY: 0, perpX: 0, perpY: 1 });
    orientations.push({ stepX: 1, stepY: 0, perpX: 0, perpY: -1 });
  }
  if (hasN || hasS) {
    orientations.push({ stepX: 0, stepY: 1, perpX: 1, perpY: 0 });
    orientations.push({ stepX: 0, stepY: 1, perpX: -1, perpY: 0 });
  }

  const isSafeToWidenInto = (cand: Tile | null): boolean => {
    if (!cand) return false;
    if (cand.x <= 1 || cand.y <= 1 || cand.x >= state.gridWidth - 2 || cand.y >= state.gridHeight - 2) {
      return false;
    }
    if (cand.type === 'road') return true;
    if (cand.type === 'grass' || cand.type === 'forest' || cand.type === 'abandoned') return true;
    if (
      (cand.type === 'rural' || cand.type === 'residential' || cand.type === 'commercial' || cand.type === 'industrial') &&
      (cand.level || 1) <= 1 &&
      !cand.establishmentId &&
      (cand.lotWidth ?? 1) === 1 &&
      (cand.lotHeight ?? 1) === 1
    ) {
      return true;
    }
    return false;
  };

  for (const ori of orientations) {
    // Collect contiguous road stretch up to maxLength centered around (roadX, roadY)
    const baseRoadTiles: Tile[] = [anchor];
    for (let step = 1; step < maxLength && baseRoadTiles.length < maxLength; step++) {
      const fwd = getTile(state, roadX + ori.stepX * step, roadY + ori.stepY * step);
      if (fwd && fwd.type === 'road') baseRoadTiles.push(fwd);
      else break;
    }
    for (let step = 1; step < maxLength && baseRoadTiles.length < maxLength; step++) {
      const bwd = getTile(state, roadX - ori.stepX * step, roadY - ori.stepY * step);
      if (bwd && bwd.type === 'road') baseRoadTiles.unshift(bwd);
      else break;
    }
    if (baseRoadTiles.length < 2) continue;

    // Collect the longest contiguous sub-stretch (>= 2 tiles) whose parallel strip is safe
    let bestStart = -1;
    let bestLen = 0;
    let curStart = -1;
    let curLen = 0;
    for (let i = 0; i < baseRoadTiles.length; i++) {
      const bt = baseRoadTiles[i];
      const pt = getTile(state, bt.x + ori.perpX, bt.y + ori.perpY);
      if (isSafeToWidenInto(pt)) {
        if (curStart === -1) curStart = i;
        curLen++;
        if (curLen > bestLen) {
          bestLen = curLen;
          bestStart = curStart;
        }
      } else {
        curStart = -1;
        curLen = 0;
      }
    }

    if (bestLen >= 2 && bestStart >= 0) {
      let widened = 0;
      for (let i = bestStart; i < bestStart + bestLen; i++) {
        const bt = baseRoadTiles[i];
        const pt = getTile(state, bt.x + ori.perpX, bt.y + ori.perpY)!;
        if (pt.type !== 'road') {
          if (isBuildingType(pt.type)) {
            for (const ct of getCompoundTiles(state, pt)) {
              resetTileToGrass(ct, 0.7);
            }
          }
          pt.type = 'road';
          pt.level = 2;
          pt.variant = 2;
          pt.age = 0;
          pt.evolveFlash = 1.25;
          widened++;
        }
        if (bt.level < 3) {
          bt.level = 2;
          bt.variant = 2;
        }
      }
      if (widened > 0) {
        reconcileRoadHierarchy(state);
        state.mapVersion += 1;
        return widened;
      }
    }
  }
  return 0;
}

/** Find a nearby arterial avenue around (targetX, targetY) and widen it to 2×2 thickness */
export function tryWidenAvenueNear(state: CityState, targetX: number, targetY: number, radius: number = 4): number {
  const candidates: Array<{ tile: Tile; dist: number; prio: number }> = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const t = getTile(state, targetX + dx, targetY + dy);
      if (!t || t.type !== 'road' || t.construction) continue;
      if (t.level >= 4 || isExternalBorderRoadTile(state, t.x, t.y) || isTollPlazaTile(state, t.x, t.y)) continue;
      if (isWideAvenue2x2Tile(state, t.x, t.y)) continue;
      const plan = classifyPlannedRoadCell(state, t.x, t.y);
      const prio = plan.onAvenueAxis ? 3 : t.level === 2 ? 2 : 1;
      candidates.push({ tile: t, dist: Math.abs(dx) + Math.abs(dy), prio });
    }
  }
  candidates.sort((a, b) => b.prio - a.prio || a.dist - b.dist);
  for (const c of candidates.slice(0, 6)) {
    const widened = widenAvenueCorridorAt(state, c.tile.x, c.tile.y, 4);
    if (widened > 0) return widened;
  }
  return 0;
}

/** Human-readable Portuguese label for any road hierarchy level + variant */
export function getRoadClassLabel(level: number, variant: number = 0): string {
  if (level >= 4) {
    return variant === 1 ? 'Trevo Rodoviário' : 'Rotatória (Trevo de Avenida)';
  }
  if (level === 3) {
    return variant === 1
      ? 'Rodovia de 4 Faixas (2 Idas / 2 Voltas)'
      : 'Rodovia de 2 Faixas (Estrada Expressa)';
  }
  if (level === 2) {
    return variant === 2 ? 'Avenida Larga 2×2 (Boulevard)' : 'Avenida';
  }
  return 'Rua Local';
}

/**
 * Determine if a highway tile (level 3) warrants upgrading to a 4-lane divided highway
 * (2 outbound + 2 inbound lanes, variant = 1) vs a 2-lane highway (1 outbound + 1 inbound, variant = 0).
 */
function shouldUpgradeToFourLaneHighway(state: CityState, x: number, y: number): boolean {
  // Check proximity to high-capacity interchanges (Trevo), bridges, airports, or ports
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > 2) continue;
      const nt = getTile(state, x + dx, y + dy);
      if (!nt) continue;
      if (
        (nt.type === 'road' && nt.level >= 4) ||
        nt.type === 'bridge' ||
        nt.type === 'airport' ||
        nt.type === 'port' ||
        nt.type === 'stadium'
      ) {
        return true;
      }
    }
  }
  const localPopDensity = countPopulatedNear(state, x, y, 4);
  if (localPopDensity >= 3) return true;

  const roadTier = state.workTiers?.emergency_roadworks ?? 1;
  if ((roadTier >= 2 || (state.totalPopulation || 0) >= 220) && countPopulatedNear(state, x, y, 6) >= 1) {
    return true;
  }
  return false;
}

/**
 * Reconcile every road tile's hierarchy level & interchange status cleanly:
 * - Arterial 6x6 crossings with roads on BOTH X and Y axes automatically become Trevos (Nv. 4)
 *   - variant 1 = Trevo Rodoviário (connects Estrada Expressa)
 *   - variant 0 = Rotatória Paisagística (connects Avenidas)
 * - 2-tile-thick Grand Avenues (forming 2x2 road strips) are preserved as `level = 2, variant = 2` (Avenida Larga 2×2).
 * - Highway corridors (Nv. 3) dynamically operate as 2-Lane Highways (variant 0) or
 *   4-Lane Divided Highways (2 idas e 2 voltas, variant 1) when traffic/corridor demand warrants it.
 * - River bridges upgrade to wider, more developed dual-lane variants (variant 1) on arterial corridors or wide spans.
 */
export function reconcileRoadHierarchy(state: CityState): void {
  // Pass 1: assign road levels & Trevo interchanges
  for (let i = 0; i < state.tiles.length; i++) {
    const t = state.tiles[i];
    if (t.type !== 'road') continue;

    const plan = classifyPlannedRoadCell(state, t.x, t.y);
    const n = getTile(state, t.x, t.y - 1);
    const s = getTile(state, t.x, t.y + 1);
    const e = getTile(state, t.x + 1, t.y);
    const w = getTile(state, t.x - 1, t.y);

    const hasNS = Boolean((n && isRoadLike(n.type)) || (s && isRoadLike(s.type)));
    const hasEW = Boolean((e && isRoadLike(e.type)) || (w && isRoadLike(w.type)));
    const deg =
      (n && isRoadLike(n.type) ? 1 : 0) +
      (s && isRoadLike(s.type) ? 1 : 0) +
      (e && isRoadLike(e.type) ? 1 : 0) +
      (w && isRoadLike(w.type) ? 1 : 0);

    const isWideAve = isWideAvenue2x2Tile(state, t.x, t.y);

    if (plan.isArterialCross && hasNS && hasEW && deg >= 3 && !isTollPlazaTile(state, t.x, t.y) && !isWideAve) {
      t.level = 4;
      t.variant = plan.isHighwayCross ? 1 : 0;
    } else if (isExternalHighwayCorridorTile(state, t.x, t.y)) {
      t.level = 3;
      t.variant = 1;
    } else if (isWideAve) {
      t.level = 2;
      t.variant = 2;
    } else if (plan.isPlanned) {
      t.level = plan.corridorLevel;
      t.variant = 0;
    } else {
      t.level = 1;
      t.variant = 0;
    }
  }

  // Pass 2: assign 2-lane vs 4-lane highways (level === 3) and developed dual-lane bridges
  for (let i = 0; i < state.tiles.length; i++) {
    const t = state.tiles[i];
    if (t.type === 'road' && t.level === 3) {
      t.variant =
        isExternalHighwayCorridorTile(state, t.x, t.y) ||
        shouldUpgradeToFourLaneHighway(state, t.x, t.y)
          ? 1
          : 0;
    } else if (t.type === 'bridge') {
      const plan = classifyPlannedRoadCell(state, t.x, t.y);
      const neigh = getOrthoNeighbors(state, t.x, t.y);
      const touchesMajorRoad = neigh.some(
        (nt) => (nt.type === 'road' && (nt.level || 1) >= 2) || (nt.type === 'bridge' && (nt.variant || 0) === 1)
      );
      if ((t.level || 1) >= 2 || plan.onHighwayAxis || plan.onAvenueAxis || touchesMajorRoad) {
        t.variant = 1;
      }
    }
  }
}

/**
 * Compute the Set of tile indices (`y * gridWidth + x`) belonging to the city's
 * main connected road network (anchored at `roadOriginX, roadOriginY` or the largest connected component).
 */
export function getMainConnectedRoadSet(state: CityState): Set<number> {
  const gw = state.gridWidth;
  const gh = state.gridHeight;
  const total = state.tiles.length;

  const bfsFrom = (seedIdx: number, visited: Uint8Array): Set<number> => {
    const comp = new Set<number>([seedIdx]);
    visited[seedIdx] = 1;
    const q: number[] = [seedIdx];
    let head = 0;
    while (head < q.length) {
      const idx = q[head++];
      const cx = idx % gw;
      const cy = Math.floor(idx / gw);
      for (const [dx, dy] of ORTHO_DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const nIdx = ny * gw + nx;
        if (visited[nIdx]) continue;
        const nt = state.tiles[nIdx];
        if (!nt || !isRoadLike(nt.type)) continue;
        visited[nIdx] = 1;
        comp.add(nIdx);
        q.push(nIdx);
      }
    }
    return comp;
  };

  const ox = Math.max(0, Math.min(gw - 1, Math.round(state.roadOriginX ?? gw / 2)));
  const oy = Math.max(0, Math.min(gh - 1, Math.round(state.roadOriginY ?? gh / 2)));
  const originTile = getTile(state, ox, oy);
  if (originTile && isRoadLike(originTile.type)) {
    const visited = new Uint8Array(total);
    return bfsFrom(oy * gw + ox, visited);
  }

  const visited = new Uint8Array(total);
  let best = new Set<number>();
  for (let i = 0; i < total; i++) {
    if (visited[i]) continue;
    const t = state.tiles[i];
    if (!t || !isRoadLike(t.type)) continue;
    const comp = bfsFrom(i, visited);
    if (comp.size > best.size) {
      best = comp;
    }
  }
  return best;
}

/**
 * Guarantee that `targetTiles` (e.g. a Port, Airport, Stadium, or Establishment) can be reached
 * by car from the city's main road network, automatically laying the shortest connecting road link
 * over open dry land (or low-tier replaceable lots if needed) when not already touching a main road.
 */
export function ensureTileConnectedToMainRoad(
  state: CityState,
  targetTiles: Tile[]
): boolean {
  if (targetTiles.length === 0) return false;
  const gw = state.gridWidth;
  const gh = state.gridHeight;
  const targetSet = new Set<number>(targetTiles.map((t) => t.y * gw + t.x));
  const mainSet = getMainConnectedRoadSet(state);
  if (mainSet.size === 0) return false;

  // 1. Already adjacent to main connected road network?
  for (const t of targetTiles) {
    for (const nb of getOrthoNeighbors(state, t.x, t.y)) {
      const nIdx = nb.y * gw + nb.x;
      if (targetSet.has(nIdx)) continue;
      if (mainSet.has(nIdx)) return true;
    }
  }

  // 2. Dijkstra shortest-cost path from target perimeter tiles to any tile in mainSet
  const dist = new Float64Array(state.tiles.length).fill(Infinity);
  const parent = new Int32Array(state.tiles.length).fill(-1);
  const queue: number[] = [];

  for (const t of targetTiles) {
    for (const nb of getOrthoNeighbors(state, t.x, t.y)) {
      const nIdx = nb.y * gw + nb.x;
      if (targetSet.has(nIdx)) continue;
      if (nb.type === 'water' || isLandmarkType(nb.type)) continue;
      const stepCost =
        nb.type === 'road' || nb.type === 'bridge'
          ? 0.2
          : nb.type === 'grass' || nb.type === 'forest'
            ? 1.0
            : nb.type === 'abandoned'
              ? 1.5
              : (nb.level || 1) <= 1 && !nb.establishmentId
                ? 4.0
                : 18.0;
      if (stepCost < dist[nIdx]) {
        dist[nIdx] = stepCost;
        parent[nIdx] = -2; // seed adjacent to targetTiles
        queue.push(nIdx);
      }
    }
  }

  let reachedIdx = -1;
  let bestCost = Infinity;

  while (queue.length > 0) {
    // Pop lowest-cost node (grid <= ~2500 tiles so linear min-pop is <0.1ms)
    let minPos = 0;
    for (let i = 1; i < queue.length; i++) {
      if (dist[queue[i]] < dist[queue[minPos]]) minPos = i;
    }
    const curIdx = queue[minPos];
    queue[minPos] = queue[queue.length - 1];
    queue.pop();

    const curCost = dist[curIdx];
    if (curCost >= bestCost) continue;
    if (mainSet.has(curIdx)) {
      reachedIdx = curIdx;
      bestCost = curCost;
      continue;
    }

    const cx = curIdx % gw;
    const cy = Math.floor(curIdx / gw);
    for (const [dx, dy] of ORTHO_DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
      const nIdx = ny * gw + nx;
      if (targetSet.has(nIdx)) continue;
      const nt = state.tiles[nIdx];
      if (!nt || nt.type === 'water' || isLandmarkType(nt.type)) continue;

      let stepCost = 1.0;
      if (mainSet.has(nIdx) || isRoadLike(nt.type)) {
        stepCost = 0.2;
      } else if (nt.type === 'grass' || nt.type === 'forest') {
        const plan = classifyPlannedRoadCell(state, nx, ny);
        stepCost = plan.isPlanned ? 0.65 : 1.15;
      } else if (nt.type === 'abandoned') {
        stepCost = 1.5;
      } else if ((nt.level || 1) <= 1 && !nt.establishmentId) {
        stepCost = 4.5;
      } else {
        stepCost = 22.0;
      }

      const nextCost = curCost + stepCost;
      if (nextCost < dist[nIdx]) {
        dist[nIdx] = nextCost;
        parent[nIdx] = curIdx;
        queue.push(nIdx);
      }
    }
  }

  if (reachedIdx < 0) return false;

  let cur = reachedIdx;
  let laidAny = false;
  while (cur >= 0) {
    const t = state.tiles[cur];
    if (t && !isRoadLike(t.type)) {
      if (isBuildingType(t.type)) {
        for (const ct of getCompoundTiles(state, t)) {
          resetTileToGrass(ct, 0.85);
        }
      }
      t.type = 'road';
      const plan = classifyPlannedRoadCell(state, t.x, t.y);
      t.level = Math.max(1, plan.corridorLevel);
      t.variant = 0;
      t.age = 0;
      t.evolveFlash = 0.85;
      laidAny = true;
    }
    cur = parent[cur];
  }

  if (laidAny) {
    reconcileRoadHierarchy(state);
    state.mapVersion += 1;
  }
  return true;
}

/** True when road tile `(x, y)` is a 3-way or 4-way intersection controlled by traffic lights (excluding Lv.4 roundabouts/cloverleafs) */
export function isTrafficLightIntersection(
  state: CityState,
  x: number,
  y: number
): boolean {
  const t = getTile(state, x, y);
  if (!t || t.type !== 'road' || (t.level || 1) >= 4) return false;
  const n = getTile(state, x, y - 1);
  const s = getTile(state, x, y + 1);
  const e = getTile(state, x + 1, y);
  const w = getTile(state, x - 1, y);
  const hasNS = Boolean((n && isRoadLike(n.type)) || (s && isRoadLike(s.type)));
  const hasEW = Boolean((e && isRoadLike(e.type)) || (w && isRoadLike(w.type)));
  return hasNS && hasEW;
}

export interface TrafficSignalState {
  nsGreen: boolean;
  nsYellow: boolean;
  ewGreen: boolean;
  ewYellow: boolean;
}

/** Deterministic alternating traffic signal phase per intersection (`period = 10s`: N/S green <-> E/W green) */
export function getTrafficSignalState(
  x: number,
  y: number,
  timeSeconds: number
): TrafficSignalState {
  const phaseOffset = (((x + y) & 1) === 1) ? 5.0 : 0.0;
  const cycle = (((timeSeconds + phaseOffset) % 10) + 10) % 10;
  if (cycle < 4.0) {
    return { nsGreen: true, nsYellow: false, ewGreen: false, ewYellow: false };
  }
  if (cycle < 5.0) {
    return { nsGreen: false, nsYellow: true, ewGreen: false, ewYellow: false };
  }
  if (cycle < 9.0) {
    return { nsGreen: false, nsYellow: false, ewGreen: true, ewYellow: false };
  }
  return { nsGreen: false, nsYellow: false, ewGreen: false, ewYellow: true };
}

/** Avoid ugly 2x2 solid asphalt blocks so streets form readable urban blocks */
function wouldCreateRoadBlob(state: CityState, x: number, y: number): boolean {
  const quads: Array<Array<[number, number]>> = [
    [
      [x - 1, y - 1],
      [x, y - 1],
      [x - 1, y],
    ],
    [
      [x + 1, y - 1],
      [x, y - 1],
      [x + 1, y],
    ],
    [
      [x - 1, y + 1],
      [x, y + 1],
      [x - 1, y],
    ],
    [
      [x + 1, y + 1],
      [x, y + 1],
      [x + 1, y],
    ],
  ];

  for (const q of quads) {
    let allRoads = true;
    for (const [qx, qy] of q) {
      const t = getTile(state, qx, qy);
      if (!t || !isRoadLike(t.type)) {
        allRoads = false;
        break;
      }
    }
    if (allRoads) return true;
  }
  return false;
}

function countPopulatedNear(state: CityState, x: number, y: number, radius: number = 3): number {
  let count = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > radius) continue;
      const t = getTile(state, x + dx, y + dy);
      if (t && (t.type === 'residential' || t.type === 'commercial' || t.type === 'industrial')) {
        count++;
      }
    }
  }
  return count;
}

/** Count distinct contiguous bridge crossings over the river (spaced by MIN_BRIDGE_SPACING_TILES) */
export function countRiverBridges(state: CityState): number {
  const visited = new Uint8Array(state.tiles.length);
  let spans = 0;
  const w = state.gridWidth;

  for (let i = 0; i < state.tiles.length; i++) {
    if (visited[i] || state.tiles[i].type !== 'bridge') continue;
    spans++;
    const stack = [i];
    visited[i] = 1;
    while (stack.length > 0) {
      const curIdx = stack.pop()!;
      const cur = state.tiles[curIdx];
      for (const [dx, dy] of ORTHO_DIRS) {
        const nt = getTile(state, cur.x + dx, cur.y + dy);
        if (!nt || nt.type !== 'bridge') continue;
        const ni = nt.y * w + nt.x;
        if (!visited[ni]) {
          visited[ni] = 1;
          stack.push(ni);
        }
      }
    }
  }
  return spans;
}

/** Determine the current architectural evolution level (1..4) for city river bridges */
function getCurrentBridgeLevel(state: CityState): number {
  let maxLv = 1;
  for (let i = 0; i < state.tiles.length; i++) {
    const t = state.tiles[i];
    if (t.type === 'bridge' && t.level > maxLv) {
      maxLv = t.level;
    }
  }
  const pop = state.totalPopulation || 0;
  if (pop >= 22000 || state.milestonesReached?.civic_bridge_lv4) maxLv = Math.max(maxLv, 4);
  else if (pop >= 12000 || state.milestonesReached?.civic_bridge_lv3) maxLv = Math.max(maxLv, 3);
  else if (pop >= 3500 || state.milestonesReached?.civic_bridge_lv2) maxLv = Math.max(maxLv, 2);
  return Math.max(1, Math.min(4, maxLv));
}

/**
 * Check whether a bridge tile belongs to a 2-tile-wide (double-width) bridge span
 * (at least one orthogonal bridge neighbor perpendicular to its crossing axis).
 */
export function isDoubleWidthBridgeTile(state: CityState, x: number, y: number): boolean {
  const tile = getTile(state, x, y);
  if (!tile || tile.type !== 'bridge') return false;
  const hasE = getTile(state, x + 1, y)?.type === 'bridge';
  const hasW = getTile(state, x - 1, y)?.type === 'bridge';
  const hasN = getTile(state, x, y - 1)?.type === 'bridge';
  const hasS = getTile(state, x, y + 1)?.type === 'bridge';
  if ((hasE || hasW) && (hasN || hasS)) return true;
  // Single-tile river crossing widened to 2 tiles wide (1x2 or 2x1 bridge with roads on both perpendicular banks)
  if ((hasE || hasW) && !hasN && !hasS) {
    const roadN = getTile(state, x, y - 1)?.type === 'road';
    const roadS = getTile(state, x, y + 1)?.type === 'road';
    return Boolean(roadN && roadS);
  }
  if ((hasN || hasS) && !hasE && !hasW) {
    const roadE = getTile(state, x + 1, y)?.type === 'road';
    const roadW = getTile(state, x - 1, y)?.type === 'road';
    return Boolean(roadE && roadW);
  }
  return false;
}

/**
 * Safely widen a contiguous 1-tile-wide river bridge span into a 2-tile-wide monumental bridge (Nv. 4)
 * whenever adjacent water tiles and safe riverbank landing approaches are available (never overwriting landmarks or buildings).
 */
function tryWidenBridgeComponentToDoubleWidth(
  state: CityState,
  component: Tile[]
): number {
  if (component.length === 0) return 0;

  let minX = component[0].x;
  let maxX = component[0].x;
  let minY = component[0].y;
  let maxY = component[0].y;
  const compSet = new Set<number>();
  const w = state.gridWidth;

  for (const t of component) {
    if (t.x < minX) minX = t.x;
    if (t.x > maxX) maxX = t.x;
    if (t.y < minY) minY = t.y;
    if (t.y > maxY) maxY = t.y;
    compSet.add(t.y * w + t.x);
  }

  const spanW = maxX - minX + 1;
  const spanH = maxY - minY + 1;

  // Determine crossing orientation: E-W bridges cross along X (widen along Y); N-S bridges cross along Y (widen along X)
  let crossingAxis: 'ew' | 'ns';
  if (spanW >= 2 && spanH >= 2) {
    // Already 2+ tiles wide!
    return 0;
  } else if (spanW > spanH) {
    crossingAxis = 'ew';
  } else if (spanH > spanW) {
    crossingAxis = 'ns';
  } else {
    // 1x1 bridge over a 1-tile river: inspect road neighbors to pick crossing axis
    const hasRoadEW =
      isRoadLike(getTile(state, minX - 1, minY)?.type ?? 'grass') ||
      isRoadLike(getTile(state, maxX + 1, minY)?.type ?? 'grass');
    const hasRoadNS =
      isRoadLike(getTile(state, minX, minY - 1)?.type ?? 'grass') ||
      isRoadLike(getTile(state, minX, maxY + 1)?.type ?? 'grass');
    crossingAxis = hasRoadEW && !hasRoadNS ? 'ew' : 'ns';
  }

  const isSafeBankTile = (t: Tile | null): boolean =>
    Boolean(
      t &&
        !isLandmarkType(t.type) &&
        !t.establishmentId &&
        (t.type === 'grass' || t.type === 'forest' || isRoadLike(t.type))
    );

  const offsets: ReadonlyArray<1 | -1> = [1, -1];

  for (const off of offsets) {
    const parallelWater: Tile[] = [];
    let landA: Tile | null = null;
    let landB: Tile | null = null;

    if (crossingAxis === 'ew') {
      const py = minY + off;
      if (py <= 0 || py >= state.gridHeight - 1) continue;
      // Find a seed water tile along the parallel row overlapping [minX..maxX]
      const midX = Math.floor((minX + maxX) / 2);
      let seedX = -1;
      if (getTile(state, midX, py)?.type === 'water') {
        seedX = midX;
      } else {
        for (let sx = minX; sx <= maxX; sx++) {
          if (getTile(state, sx, py)?.type === 'water') {
            seedX = sx;
            break;
          }
        }
      }
      if (seedX < 0) continue;

      let leftX = seedX;
      while (leftX > 1 && getTile(state, leftX - 1, py)?.type === 'water') {
        leftX--;
      }
      let rightX = seedX;
      while (rightX < state.gridWidth - 2 && getTile(state, rightX + 1, py)?.type === 'water') {
        rightX++;
      }
      const pLen = rightX - leftX + 1;
      if (pLen < 1 || pLen > 8) continue;
      if (rightX < minX || leftX > maxX) continue;

      landA = getTile(state, leftX - 1, py);
      landB = getTile(state, rightX + 1, py);
      if (!isSafeBankTile(landA) || !isSafeBankTile(landB)) continue;

      for (let x = leftX; x <= rightX; x++) {
        const wt = getTile(state, x, py);
        if (wt && wt.type === 'water') parallelWater.push(wt);
      }
    } else {
      const px = minX + off;
      if (px <= 0 || px >= state.gridWidth - 1) continue;
      const midY = Math.floor((minY + maxY) / 2);
      let seedY = -1;
      if (getTile(state, px, midY)?.type === 'water') {
        seedY = midY;
      } else {
        for (let sy = minY; sy <= maxY; sy++) {
          if (getTile(state, px, sy)?.type === 'water') {
            seedY = sy;
            break;
          }
        }
      }
      if (seedY < 0) continue;

      let topY = seedY;
      while (topY > 1 && getTile(state, px, topY - 1)?.type === 'water') {
        topY--;
      }
      let botY = seedY;
      while (botY < state.gridHeight - 2 && getTile(state, px, botY + 1)?.type === 'water') {
        botY++;
      }
      const pLen = botY - topY + 1;
      if (pLen < 1 || pLen > 8) continue;
      if (botY < minY || topY > maxY) continue;

      landA = getTile(state, px, topY - 1);
      landB = getTile(state, px, botY + 1);
      if (!isSafeBankTile(landA) || !isSafeBankTile(landB)) continue;

      for (let y = topY; y <= botY; y++) {
        const wt = getTile(state, px, y);
        if (wt && wt.type === 'water') parallelWater.push(wt);
      }
    }

    if (parallelWater.length === 0) continue;

    // Ensure the parallel deck does not collide with another distinct bridge span
    let tooCloseToOtherBridge = false;
    for (const wt of parallelWater) {
      for (let i = 0; i < state.tiles.length; i++) {
        const other = state.tiles[i];
        if (other.type !== 'bridge') continue;
        if (compSet.has(i)) continue;
        if (Math.abs(other.x - wt.x) + Math.abs(other.y - wt.y) < 3) {
          tooCloseToOtherBridge = true;
          break;
        }
      }
      if (tooCloseToOtherBridge) break;
    }
    if (tooCloseToOtherBridge) continue;

    // Commit the 2nd parallel bridge deck at Nv. 4!
    for (const wt of parallelWater) {
      wt.type = 'bridge';
      wt.level = 4;
      wt.variant = 1;
      wt.age = 0;
      wt.evolveFlash = 1.7;
    }

    // Connect both riverbank landings to the road network cleanly
    for (const landing of [landA, landB]) {
      if (landing && !isRoadLike(landing.type)) {
        landing.type = 'road';
        const plan = classifyPlannedRoadCell(state, landing.x, landing.y);
        landing.level = Math.max(2, plan.corridorLevel);
        landing.age = 0;
        landing.evolveFlash = 0.9;
      }
    }

    return parallelWater.length;
  }

  return 0;
}

/**
 * Collect distinct contiguous river bridge spans and widen every eligible 1-tile bridge
 * into a 2-tile-wide Mega-Bridge (Nv. 4) whenever riverbank space permits.
 */
function widenEligibleBridgesToDoubleWidth(state: CityState): number {
  const visited = new Uint8Array(state.tiles.length);
  const w = state.gridWidth;
  const components: Tile[][] = [];

  for (let i = 0; i < state.tiles.length; i++) {
    if (visited[i] || state.tiles[i].type !== 'bridge') continue;
    const comp: Tile[] = [];
    const stack = [i];
    visited[i] = 1;
    while (stack.length > 0) {
      const curIdx = stack.pop()!;
      const cur = state.tiles[curIdx];
      comp.push(cur);
      for (const [dx, dy] of ORTHO_DIRS) {
        const nt = getTile(state, cur.x + dx, cur.y + dy);
        if (!nt || nt.type !== 'bridge') continue;
        const ni = nt.y * w + nt.x;
        if (!visited[ni]) {
          visited[ni] = 1;
          stack.push(ni);
        }
      }
    }
    components.push(comp);
  }

  let widenedSpans = 0;
  for (const comp of components) {
    if (tryWidenBridgeComponentToDoubleWidth(state, comp) > 0) {
      widenedSpans++;
    }
  }
  return widenedSpans;
}

/** Upgrade all existing river bridge tiles uniformly to targetLevel (1..4; Nv. 4 widens eligible bridges to 2 tiles wide) */
export function upgradeAllBridges(state: CityState, targetLevel: number): number {
  const clamped = Math.max(1, Math.min(4, targetLevel));
  let upgraded = 0;
  for (let i = 0; i < state.tiles.length; i++) {
    const t = state.tiles[i];
    if (t.type === 'bridge' && (t.level || 1) < clamped) {
      t.level = clamped;
      if (clamped >= 2) {
        t.variant = 1;
      }
      t.evolveFlash = 1.5;
      upgraded++;
    }
  }

  let widenedSpans = 0;
  if (clamped >= 4) {
    widenedSpans = widenEligibleBridgesToDoubleWidth(state);
    upgraded += widenedSpans;
  }

  if (upgraded > 0) {
    if (widenedSpans > 0) {
      reconcileRoadHierarchy(state);
    }
    state.mapVersion += 1;
  }
  return upgraded;
}

function tryBuildBridgeFrom(
  state: CityState,
  roadTile: Tile,
  dx: number,
  dy: number
): boolean {
  const span: Tile[] = [];
  let cx = roadTile.x + dx;
  let cy = roadTile.y + dy;

  // Support spanning river reaches up to 8 water squares wide (step < 10: up to 8 water + 1 landing tile)
  for (let step = 0; step < 10; step++) {
    const t = getTile(state, cx, cy);
    if (!t || t.construction) return false;
    if (t.type === 'water') {
      if (span.length >= 8) return false;
      span.push(t);
    } else if (t.type === 'grass' || t.type === 'forest' || isRoadLike(t.type)) {
      if (span.length === 0) return false;

      // Ensure a large minimum distance (>= MIN_BRIDGE_SPACING_TILES) between river bridges, with no fixed upper cap!
      for (const st of span) {
        for (let i = 0; i < state.tiles.length; i++) {
          const other = state.tiles[i];
          if (other.type !== 'bridge') continue;
          if (Math.abs(other.x - st.x) + Math.abs(other.y - st.y) < MIN_BRIDGE_SPACING_TILES) {
            return false;
          }
        }
      }

      const bridgeLv = getCurrentBridgeLevel(state);
      const roadPlan = classifyPlannedRoadCell(state, roadTile.x, roadTile.y);
      const isWideDualBridge =
        bridgeLv >= 2 ||
        (roadTile.level || 1) >= 2 ||
        roadPlan.onHighwayAxis ||
        roadPlan.onAvenueAxis ||
        span.length >= 4;
      const bridgeVariant = isWideDualBridge ? 1 : 0;

      for (const wt of span) {
        wt.type = 'bridge';
        wt.level = bridgeLv;
        wt.variant = bridgeVariant;
        wt.age = 0;
        wt.evolveFlash = 1.2;
      }
      if (!isRoadLike(t.type)) {
        t.type = 'road';
        const landingPlan = classifyPlannedRoadCell(state, t.x, t.y);
        t.level = landingPlan.corridorLevel;
        t.age = 0;
        t.evolveFlash = 0.7;
      }

      // At ultimate Nv. 4, automatically build as a 2-tile-wide bridge if riverbank space allows
      let widenedToDouble = false;
      if (bridgeLv >= 4) {
        widenedToDouble = tryWidenBridgeComponentToDoubleWidth(state, span) > 0;
      }

      reconcileRoadHierarchy(state);
      state.mapVersion += 1;
      state.pendingSounds.push({ type: 'bridge' });
      const bridgeLabel =
        bridgeLv >= 4
          ? widenedToDouble
            ? 'Megaponte Expressa de 2 Espaços (Nv. 4)'
            : 'Megaponte Estaiada Expressa (Nv. 4)'
          : bridgeLv === 3
            ? 'Ponte Estaiada de Duas Faixas (Nv. 3)'
            : bridgeLv === 2
              ? 'Ponte de Arcos Metálicos Dupla (Nv. 2)'
              : bridgeVariant === 1
                ? 'Ponte de Pedra Dupla (Nv. 1)'
                : 'Ponte Histórica de Pedra (Nv. 1)';
      const totalNow = countRiverBridges(state);
      pushNews(
        state,
        `${bridgeLabel} inaugurada sobre o rio (${totalNow} ${totalNow === 1 ? 'ponte ativa' : 'pontes ativas'})!`,
        'milestone'
      );
      return true;
    } else {
      return false;
    }
    cx += dx;
    cy += dy;
  }
  return false;
}

/**
 * Place a Riverfront Cargo or Cruise Port along the river shoreline:
 * - Level 1–2: compact cargo dock (`2×2`, `2×1`/`1×2`, or `1×1`)
 * - Level 3: expanded `2×4` / `4×2` International Cruise Terminal (`Terminal de Cruzeiros`)
 * Always guarantees a car-accessible connection to the city's main road network!
 */
export function placePortOnRiverfront(
  state: CityState,
  force: boolean = false,
  initialLevel: number = 1
): Tile | null {
  const clampedLevel = Math.max(1, Math.min(3, initialLevel));
  const mainRoadSet = getMainConnectedRoadSet(state);
  const openEdgeWater = getBridgeFreeRiverEdgeWaterSet(state);
  const shapes: Array<[number, number]> =
    clampedLevel >= 3
      ? [
          [2, 4],
          [4, 2],
          [2, 3],
          [3, 2],
          [2, 2],
          [1, 2],
          [2, 1],
          [1, 1],
        ]
      : [
          [2, 2],
          [1, 2],
          [2, 1],
          [1, 1],
        ];

  for (const [fw, fh] of shapes) {
    const candidates: Array<{
      x: number;
      y: number;
      score: number;
      bridgeFree: boolean;
    }> = [];

    for (let y = 1; y <= state.gridHeight - fh - 1; y++) {
      for (let x = 1; x <= state.gridWidth - fw - 1; x++) {
        let valid = true;
        let touchesWaterEdges = 0;
        let touchesBridgeFreeWater = 0;
        let touchesMainRoad = false;
        let touchesAnyRoad = false;
        let demolishedCost = 0;
        let popNear = 0;

        for (let dy = 0; dy < fh && valid; dy++) {
          for (let dx = 0; dx < fw; dx++) {
            const qt = getTile(state, x + dx, y + dy);
            if (
              !qt ||
              qt.construction ||
              qt.type === 'water' ||
              qt.type === 'bridge' ||
              isLandmarkType(qt.type) ||
              qt.establishmentId
            ) {
              valid = false;
              break;
            }
            const plan = classifyPlannedRoadCell(state, qt.x, qt.y);
            if (plan.onAvenueAxis || plan.onHighwayAxis) {
              valid = false;
              break;
            }
            if (qt.type === 'road') {
              if (!force) {
                valid = false;
                break;
              }
              demolishedCost += 12;
            } else if (qt.type !== 'grass' && qt.type !== 'forest') {
              if (!force || qt.level >= 3) {
                valid = false;
                break;
              }
              demolishedCost += qt.level * 8;
            }

            const neigh = getOrthoNeighbors(state, qt.x, qt.y);
            for (const nt of neigh) {
              const outside =
                nt.x < x || nt.x >= x + fw || nt.y < y || nt.y >= y + fh;
              if (!outside) continue;
              if (nt.type === 'water') {
                touchesWaterEdges++;
                if (openEdgeWater.has(nt.y * state.gridWidth + nt.x)) {
                  touchesBridgeFreeWater++;
                }
              }
              if (nt.type === 'port') {
                valid = false;
                break;
              }
              if (isRoadLike(nt.type)) {
                touchesAnyRoad = true;
                if (mainRoadSet.has(nt.y * state.gridWidth + nt.x)) {
                  touchesMainRoad = true;
                }
              }
            }
            popNear += countPopulatedNear(state, qt.x, qt.y, 4);
          }
        }

        if (!valid || touchesWaterEdges === 0) continue;
        if (!force && !touchesMainRoad && !touchesAnyRoad && popNear < 1) continue;

        const bridgeFree = touchesBridgeFreeWater > 0;
        const score =
          touchesWaterEdges * 18 +
          (touchesMainRoad ? 34 : touchesAnyRoad ? 14 : 0) +
          Math.min(20, popNear * 2) -
          demolishedCost;
        candidates.push({ x, y, score, bridgeFree });
      }
    }

    if (candidates.length === 0) continue;
    const bridgeFreePool = candidates.filter((c) => c.bridgeFree);
    const pool = bridgeFreePool.length > 0 ? bridgeFreePool : candidates;
    pool.sort((a, b) => b.score - a.score);
    const topSlice = Math.max(1, Math.min(3, pool.length));
    const pick = pool[Math.floor(nextRandom(state) * topSlice)];
    const variant = Math.floor(nextRandom(state) * 4);

    const compound = assignCompoundLot(
      state,
      pick.x,
      pick.y,
      fw,
      fh,
      'port',
      clampedLevel,
      variant,
      1.6
    );
    const anchor = compound[0];
    if (!anchor) continue;

    // Guarantee road access back to the city's main road network so cars can always reach the Port
    ensureTileConnectedToMainRoad(state, compound);

    state.pendingSounds.push({ type: 'bridge' });
    pushNews(
      state,
      clampedLevel >= 3
        ? `Terminal Internacional de Cruzeiros ${fw}×${fh} (Nv. ${clampedLevel}) inaugurado na orla!`
        : `Porto Fluvial ${fw}×${fh} (Nv. ${clampedLevel}) inaugurado com acesso rodoviário!`,
      'milestone'
    );
    return anchor;
  }

  return null;
}

/**
 * Place or expand an establishment of dimensions `spec.footprintW × spec.footprintH`
 * (`1×1`, `2×1`, `2×2`, `3×2`, `3×3`, `4×3`) around `(baseX, baseY)`.
 * Automatically demolishes lower-tier buildings, abandoned/rural lots, or internal local streets
 * if needed to accommodate the multi-tile establishment!
 */
export function tryPlaceEstablishmentFootprint(
  state: CityState,
  baseX: number,
  baseY: number,
  spec: EstablishmentSpec,
  level: number,
  variant: number,
  allowAutoDemolish: boolean = true
): Tile | null {
  const fw = Math.max(1, spec.footprintW || 1);
  const fh = Math.max(1, spec.footprintH || 1);
  const baseTile = getTile(state, baseX, baseY);
  const targetType: TileType =
    spec.id === 'soccer_stadium' ? 'stadium' : spec.hostTileType;

  // Candidate anchor offsets so the fw × fh footprint includes or starts at (baseX, baseY)
  const candidates: Array<{
    ax: number;
    ay: number;
    score: number;
    demolishedCount: number;
  }> = [];

  for (let oy = 0; oy < fh; oy++) {
    for (let ox = 0; ox < fw; ox++) {
      const ax = baseX - ox;
      const ay = baseY - oy;
      if (
        ax < 1 ||
        ay < 1 ||
        ax + fw > state.gridWidth - 1 ||
        ay + fh > state.gridHeight - 1
      ) {
        continue;
      }

      // Check minDistanceRadius (ignoring baseTile if it's evolving in place)
      if (!canPlaceEstablishmentAt(state, spec.id, ax, ay, baseTile ?? undefined)) {
        // Wait: if spec.requiresWaterAdjacent, canPlaceEstablishmentAt only checked (ax, ay);
        // For multi-tile shoreline establishments (e.g. 2x1 river_marina), any tile in the footprint touching water satisfies requiresWaterAdjacent!
        if (!spec.requiresWaterAdjacent) {
          continue;
        }
        // Check distance radius manually when requiresWaterAdjacent is checked across the whole footprint below
        let tooClose = false;
        for (let i = 0; i < state.tiles.length; i++) {
          const other = state.tiles[i];
          if (other === baseTile) continue;
          if (other.establishmentId !== spec.id) continue;
          if (Math.hypot(other.x - ax, other.y - ay) < spec.minDistanceRadius) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;
      }

      let valid = true;
      let touchesWater = false;
      let touchesRoad = false;
      let demolishedBuildings = 0;
      let demolishedRoads = 0;

      for (let dy = 0; dy < fh && valid; dy++) {
        for (let dx = 0; dx < fw; dx++) {
          const qt = getTile(state, ax + dx, ay + dy);
          if (!qt) {
            valid = false;
            break;
          }
          if (
            qt.construction ||
            qt.type === 'water' ||
            qt.type === 'bridge' ||
            isLandmarkType(qt.type)
          ) {
            valid = false;
            break;
          }
          if (qt.establishmentId && qt !== baseTile) {
            valid = false;
            break;
          }

          const plan = classifyPlannedRoadCell(state, qt.x, qt.y);
          // Footprints <= 2x2 fit inside a 2x2 city block without blocking planned roads;
          // larger footprints (3x2, 3x3, 4x3) span across internal local streets (corridorLevel 1) and automatically demolish them
          if (fw <= 2 && fh <= 2 && plan.isPlanned) {
            valid = false;
            break;
          }
          if ((fw > 2 || fh > 2) && (plan.onAvenueAxis || plan.onHighwayAxis)) {
            valid = false;
            break;
          }

          if (qt.type === 'road') {
            if (!allowAutoDemolish || qt.level >= 2) {
              valid = false;
              break;
            }
            demolishedRoads++;
          } else if (qt.type !== 'grass' && qt.type !== 'forest' && qt !== baseTile) {
            if (!allowAutoDemolish) {
              valid = false;
              break;
            }
            // Only auto-demolish buildings up to the establishment's host level (or rural/abandoned/park)
            if (
              (qt.type === 'residential' || qt.type === 'commercial') &&
              qt.level > Math.max(2, level)
            ) {
              valid = false;
              break;
            }
            demolishedBuildings++;
          }

          for (const nb of getOrthoNeighbors(state, qt.x, qt.y)) {
            if (nb.type === 'water') touchesWater = true;
            const outsideFootprint =
              nb.x < ax || nb.x >= ax + fw || nb.y < ay || nb.y >= ay + fh;
            if (outsideFootprint && isRoadLike(nb.type)) {
              touchesRoad = true;
            }
          }
        }
      }

      if (!valid) continue;
      if (spec.requiresWaterAdjacent && !touchesWater) continue;
      if (!allowAutoDemolish && !touchesRoad) continue;

      const score =
        (touchesRoad ? 14 : 0) -
        demolishedBuildings * 6 -
        demolishedRoads * 10 -
        (ox + oy) * 0.5;
      candidates.push({
        ax,
        ay,
        score,
        demolishedCount: demolishedBuildings + demolishedRoads,
      });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  const compound = assignCompoundLot(
    state,
    best.ax,
    best.ay,
    fw,
    fh,
    targetType,
    level,
    variant,
    1.35,
    spec.id
  );
  ensureTileConnectedToMainRoad(state, compound);
  state.mapVersion += 1;
  return compound[0] ?? null;
}

/**
 * Search the entire map for the best valid slot to place `estId` with its full
 * `footprintW × footprintH` area (automatically demolishing obstructing houses/streets if needed).
 */
export function placeEstablishmentOnMap(
  state: CityState,
  estId: EstablishmentId,
  force: boolean = false
): Tile | null {
  const spec = ESTABLISHMENT_MAP[estId];
  if (!spec) return null;
  if (estId === 'soccer_stadium') {
    return placeLandmarkOnBestSlot(state, 'stadium', force, spec.hostLevel);
  }

  const cx = typeof state.roadOriginX === 'number' ? state.roadOriginX : state.gridWidth / 2;
  const cy = typeof state.roadOriginY === 'number' ? state.roadOriginY : state.gridHeight / 2;
  const variant = pickEstablishmentVariation(state, estId);

  const orderedTiles = [...state.tiles].sort((a, b) => {
    const da = Math.hypot(a.x - cx, a.y - cy);
    const db = Math.hypot(b.x - cx, b.y - cy);
    return spec.prefersCentralDense ? da - db : Math.abs(da - 7) - Math.abs(db - 7);
  });

  for (const t of orderedTiles) {
    const placed = tryPlaceEstablishmentFootprint(
      state,
      t.x,
      t.y,
      spec,
      spec.hostLevel,
      variant,
      true
    );
    if (placed) {
      return placed;
    }
  }
  return null;
}

/**
 * Construct or evolve the Airport Complex (`Complexo Aeroportuário`):
 * - Level 1: `4×10` (`40` tiles) featuring a 10-tile regional landing strip (`pista`), apron, ATC tower and dual hangars (`galpões`).
 * - Level 2 & Level 3: Expands to `8×16` (`128` tiles) with an international runway, parallel taxiway, dual hangars, and passenger terminal.
 * - Automatically demolishes obstructing lots and connects the airport terminal to the city's main road network!
 */
export function placeOrExpandAirportComplex(
  state: CityState,
  targetLevel: number = 1,
  force: boolean = false
): Tile | null {
  const clampedLevel = Math.max(1, Math.min(3, targetLevel)) as 1 | 2 | 3;
  const { w, h } = AIRPORT_FOOTPRINT_BY_LEVEL[clampedLevel];
  const cx = typeof state.roadOriginX === 'number' ? state.roadOriginX : state.gridWidth / 2;
  const cy = typeof state.roadOriginY === 'number' ? state.roadOriginY : state.gridHeight / 2;

  const existingAirportTiles = state.tiles.filter((t) => t.type === 'airport');
  const existingAnchor =
    existingAirportTiles.find((t) => t.lotRole === 'anchor') ??
    existingAirportTiles[0] ??
    null;

  // If the airport already occupies the target w × h footprint (e.g., Nv.2 8×16 -> Nv.3 8×16), upgrade in place
  if (
    existingAnchor &&
    (existingAnchor.lotWidth ?? 1) >= w &&
    (existingAnchor.lotHeight ?? 1) >= h &&
    existingAirportTiles.length >= w * h
  ) {
    for (const t of existingAirportTiles) {
      if (t.level < clampedLevel) {
        t.level = clampedLevel;
      }
      t.evolveFlash = 1.65;
    }
    ensureTileConnectedToMainRoad(state, existingAirportTiles);
    state.mapVersion += 1;
    return existingAnchor;
  }

  const mainRoadSet = getMainConnectedRoadSet(state);
  const variant = existingAnchor
    ? existingAnchor.variant
    : Math.floor(nextRandom(state) * 8);

  interface AirportCandidate {
    x: number;
    y: number;
    score: number;
    demolishedBuildings: number;
    demolishedRoads: number;
  }

  const searchAirportRects = (): AirportCandidate[] => {
    const out: AirportCandidate[] = [];
    const maxX = state.gridWidth - w - 1;
    const maxY = state.gridHeight - h - 1;

    for (let y = 1; y <= maxY; y++) {
      for (let x = 1; x <= maxX; x++) {
        let valid = true;
        let overlapAirport = 0;
        let demolishedBuildings = 0;
        let demolishedHighLv = 0;
        let demolishedRoads = 0;

        for (let dy = 0; dy < h && valid; dy++) {
          for (let dx = 0; dx < w; dx++) {
            const qt = state.tiles[(y + dy) * state.gridWidth + (x + dx)];
            if (
              !qt ||
              qt.construction ||
              qt.type === 'water' ||
              qt.type === 'bridge' ||
              qt.type === 'port' ||
              qt.type === 'stadium'
            ) {
              valid = false;
              break;
            }
            if (qt.type === 'airport') {
              overlapAirport++;
            } else if (qt.type === 'road') {
              demolishedRoads++;
            } else if (isBuildingType(qt.type)) {
              demolishedBuildings++;
              if (qt.level >= 2 || qt.establishmentId) {
                demolishedHighLv++;
              }
            }
          }
        }

        if (!valid) continue;

        let touchesMainRoad = false;
        let touchesAnyRoad = false;
        for (let dx = 0; dx < w && !touchesMainRoad; dx++) {
          const topN = getTile(state, x + dx, y - 1);
          const botN = getTile(state, x + dx, y + h);
          if (topN && isRoadLike(topN.type)) {
            touchesAnyRoad = true;
            if (mainRoadSet.has(topN.y * state.gridWidth + topN.x)) touchesMainRoad = true;
          }
          if (botN && isRoadLike(botN.type)) {
            touchesAnyRoad = true;
            if (mainRoadSet.has(botN.y * state.gridWidth + botN.x)) touchesMainRoad = true;
          }
        }
        for (let dy = 0; dy < h && !touchesMainRoad; dy++) {
          const leftN = getTile(state, x - 1, y + dy);
          const rightN = getTile(state, x + w, y + dy);
          if (leftN && isRoadLike(leftN.type)) {
            touchesAnyRoad = true;
            if (mainRoadSet.has(leftN.y * state.gridWidth + leftN.x)) touchesMainRoad = true;
          }
          if (rightN && isRoadLike(rightN.type)) {
            touchesAnyRoad = true;
            if (mainRoadSet.has(rightN.y * state.gridWidth + rightN.x)) touchesMainRoad = true;
          }
        }

        let score = 0;
        if (existingAnchor) {
          const distFromOld = Math.hypot(x - existingAnchor.x, y - existingAnchor.y);
          score =
            overlapAirport * 30 -
            distFromOld * 20 -
            demolishedBuildings * 8 -
            demolishedHighLv * 14 -
            demolishedRoads * 22 +
            (touchesMainRoad ? 28 : touchesAnyRoad ? 12 : 0);
        } else {
          const distFromCore = Math.hypot(x + w * 0.5 - cx, y + h * 0.5 - cy);
          score =
            distFromCore * 3.5 -
            demolishedBuildings * 12 -
            demolishedHighLv * 25 -
            demolishedRoads * 32 +
            (touchesMainRoad ? 26 : touchesAnyRoad ? 10 : 0);
        }

        out.push({
          x,
          y,
          score,
          demolishedBuildings,
          demolishedRoads,
        });
      }
    }
    return out;
  };

  let candidates = searchAirportRects();

  // If expanding to 6×12 or 8×16 on a cramped river split, automatically expand the dry-side map border free of charge
  for (let expAttempt = 0; expAttempt < 2 && candidates.length === 0; expAttempt++) {
    let northWater = 0;
    let southWater = 0;
    let westWater = 0;
    let eastWater = 0;
    for (const t of state.tiles) {
      if (t.type !== 'water') continue;
      if (t.y < state.gridHeight / 2) northWater++;
      else southWater++;
      if (t.x < state.gridWidth / 2) westWater++;
      else eastWater++;
    }
    const vertDirs: ExpandDirection[] =
      northWater <= southWater ? ['norte', 'sul'] : ['sul', 'norte'];
    const horizDirs: ExpandDirection[] =
      westWater <= eastWater ? ['oeste', 'leste'] : ['leste', 'oeste'];
    const prefDirs: ExpandDirection[] =
      h >= w ? [...vertDirs, ...horizDirs] : [...horizDirs, ...vertDirs];

    const offers = getLandExpansions(state);
    const chosenOffer = prefDirs
      .map((d) => offers.find((o) => o.direction === d))
      .find((o) => o && o.canExpand);
    if (!chosenOffer) break;

    state.money += chosenOffer.cost;
    expandCityLand(state, chosenOffer.direction);
    candidates = searchAirportRects();
  }

  if (candidates.length === 0 && !force) {
    return null;
  }
  if (candidates.length === 0) {
    return existingAnchor;
  }

  candidates.sort((a, b) => b.score - a.score);
  const topSlice = existingAnchor ? 1 : Math.max(1, Math.min(3, candidates.length));
  const pick = candidates[Math.floor(nextRandom(state) * topSlice)];

  // If expanding an existing airport and the new anchor shifted slightly, clear any old airport tiles outside the new rectangle
  if (existingAirportTiles.length > 0) {
    for (const oldTile of existingAirportTiles) {
      const insideNew =
        oldTile.x >= pick.x &&
        oldTile.x < pick.x + w &&
        oldTile.y >= pick.y &&
        oldTile.y < pick.y + h;
      if (!insideNew) {
        resetTileToGrass(oldTile, 0.9);
      }
    }
  }

  const compound = assignCompoundLot(
    state,
    pick.x,
    pick.y,
    w,
    h,
    'airport',
    clampedLevel,
    variant,
    1.65
  );
  state.mapVersion += 1;

  // Always connect the Airport complex directly to the city's main road network so cars can reach it!
  ensureTileConnectedToMainRoad(state, compound);

  const totalDemolished = pick.demolishedBuildings + pick.demolishedRoads;
  const demMsg =
    totalDemolished > 0
      ? ` (${totalDemolished} ${totalDemolished === 1 ? 'lote demolido automaticamente' : 'lotes demolidos automaticamente'} para a obra)`
      : '';

  state.pendingSounds.push({ type: 'milestone' });
  if (existingAnchor) {
    pushNews(
      state,
      `Complexo Aeroportuário evoluído para ${w}×${h} (Nv. ${clampedLevel}) com nova pista internacional e galpões ampliados${demMsg}!`,
      'milestone'
    );
  } else {
    pushNews(
      state,
      `Complexo Aeroportuário ${w}×${h} (Nv. ${clampedLevel}) inaugurado com acesso rodoviário, pista e galpões${demMsg}!`,
      'milestone'
    );
  }

  return compound[0] ?? null;
}

/**
 * Construct or evolve the Shopping Mall Complex (`Shopping Center`):
 * - Level 1 (Shopping Pequeno): `6×6` (`36` tiles) — Galleria Comercial Regional (Marco 7.500 hab.)
 * - Level 2 (Shopping Médio): `8×8` (`64` tiles) — Shopping Metropolitano com Cúpula e Multiplex (Marco 16.000 hab.)
 * - Level 3 (Shopping Grande): `9×9` (`81` tiles) — Grand Megamall com Domo de Cristal e Heliponto VIP (Marco 26.000 hab.)
 * - Automatically expands from 6×6 -> 8×8 -> 9×9 and connects to the main road network.
 */
export function placeOrExpandShoppingComplex(
  state: CityState,
  targetLevel: number = 1,
  force: boolean = false
): Tile | null {
  const clampedLevel = Math.max(1, Math.min(3, targetLevel)) as 1 | 2 | 3;
  const { w, h } = SHOPPING_FOOTPRINT_BY_LEVEL[clampedLevel];
  const cx = typeof state.roadOriginX === 'number' ? state.roadOriginX : state.gridWidth / 2;
  const cy = typeof state.roadOriginY === 'number' ? state.roadOriginY : state.gridHeight / 2;

  const existingShoppingTiles = state.tiles.filter((t) => t.type === 'shopping');
  const existingAnchor =
    existingShoppingTiles.find((t) => t.lotRole === 'anchor') ??
    existingShoppingTiles[0] ??
    null;

  if (
    existingAnchor &&
    (existingAnchor.lotWidth ?? 1) >= w &&
    (existingAnchor.lotHeight ?? 1) >= h &&
    existingShoppingTiles.length >= w * h
  ) {
    for (const t of existingShoppingTiles) {
      if (t.level < clampedLevel) {
        t.level = clampedLevel;
      }
      t.evolveFlash = 1.65;
    }
    ensureTileConnectedToMainRoad(state, existingShoppingTiles);
    state.mapVersion += 1;
    return existingAnchor;
  }

  const mainRoadSet = getMainConnectedRoadSet(state);
  const variant = existingAnchor
    ? existingAnchor.variant
    : Math.floor(nextRandom(state) * 8);

  interface ShoppingCandidate {
    x: number;
    y: number;
    score: number;
    demolishedBuildings: number;
    demolishedRoads: number;
  }

  const searchShoppingRects = (): ShoppingCandidate[] => {
    const out: ShoppingCandidate[] = [];
    const maxX = state.gridWidth - w - 1;
    const maxY = state.gridHeight - h - 1;

    for (let y = 1; y <= maxY; y++) {
      for (let x = 1; x <= maxX; x++) {
        let valid = true;
        let overlapShopping = 0;
        let demolishedBuildings = 0;
        let demolishedHighLv = 0;
        let demolishedRoads = 0;

        for (let dy = 0; dy < h && valid; dy++) {
          for (let dx = 0; dx < w; dx++) {
            const qt = state.tiles[(y + dy) * state.gridWidth + (x + dx)];
            if (
              !qt ||
              qt.construction ||
              qt.type === 'water' ||
              qt.type === 'bridge' ||
              qt.type === 'port' ||
              qt.type === 'airport' ||
              qt.type === 'stadium' ||
              isExternalBorderRoadTile(state, qt.x, qt.y) ||
              isTollPlazaTile(state, qt.x, qt.y)
            ) {
              valid = false;
              break;
            }
            if (qt.type === 'shopping') {
              overlapShopping++;
            } else if (qt.type === 'road') {
              demolishedRoads++;
            } else if (isBuildingType(qt.type)) {
              demolishedBuildings++;
              if (qt.level >= 3 || qt.establishmentId) {
                demolishedHighLv++;
              }
            }
          }
        }

        if (!valid) continue;

        let touchesMainRoad = false;
        let touchesWideAvenue = false;
        let touchesAnyRoad = false;
        for (let dx = 0; dx < w; dx++) {
          const topN = getTile(state, x + dx, y - 1);
          const botN = getTile(state, x + dx, y + h);
          for (const nb of [topN, botN]) {
            if (nb && isRoadLike(nb.type)) {
              touchesAnyRoad = true;
              if (mainRoadSet.has(nb.y * state.gridWidth + nb.x)) touchesMainRoad = true;
              if (nb.type === 'road' && nb.level === 2 && nb.variant === 2) touchesWideAvenue = true;
            }
          }
        }
        for (let dy = 0; dy < h; dy++) {
          const leftN = getTile(state, x - 1, y + dy);
          const rightN = getTile(state, x + w, y + dy);
          for (const nb of [leftN, rightN]) {
            if (nb && isRoadLike(nb.type)) {
              touchesAnyRoad = true;
              if (mainRoadSet.has(nb.y * state.gridWidth + nb.x)) touchesMainRoad = true;
              if (nb.type === 'road' && nb.level === 2 && nb.variant === 2) touchesWideAvenue = true;
            }
          }
        }

        let score = 0;
        if (existingAnchor) {
          const distFromOld = Math.hypot(x - existingAnchor.x, y - existingAnchor.y);
          score =
            overlapShopping * 36 -
            distFromOld * 24 -
            demolishedBuildings * 7 -
            demolishedHighLv * 16 -
            demolishedRoads * 18 +
            (touchesWideAvenue ? 18 : 0) +
            (touchesMainRoad ? 28 : touchesAnyRoad ? 12 : 0);
        } else {
          const distFromCore = Math.hypot(x + w * 0.5 - cx, y + h * 0.5 - cy);
          const district = getNeighborhoodDistrict(state, Math.round(x + w * 0.5), Math.round(y + h * 0.5));
          const districtBonus = district === 'commercial' ? 22 : district === 'residential' ? 10 : -8;
          score =
            40 -
            Math.abs(distFromCore - 6) * 2.2 +
            districtBonus +
            (touchesWideAvenue ? 20 : 0) +
            (touchesMainRoad ? 28 : touchesAnyRoad ? 12 : 0) -
            demolishedBuildings * 9 -
            demolishedHighLv * 22 -
            demolishedRoads * 24;
        }

        out.push({
          x,
          y,
          score,
          demolishedBuildings,
          demolishedRoads,
        });
      }
    }
    return out;
  };

  let candidates = searchShoppingRects();

  for (let expAttempt = 0; expAttempt < 2 && candidates.length === 0; expAttempt++) {
    const offers = getLandExpansions(state);
    const chosenOffer = offers.find((o) => o.canExpand);
    if (!chosenOffer) break;
    state.money += chosenOffer.cost;
    expandCityLand(state, chosenOffer.direction);
    candidates = searchShoppingRects();
  }

  if (candidates.length === 0 && !force) {
    return null;
  }
  if (candidates.length === 0) {
    return existingAnchor;
  }

  candidates.sort((a, b) => b.score - a.score);
  const topSlice = existingAnchor ? 1 : Math.max(1, Math.min(3, candidates.length));
  const pick = candidates[Math.floor(nextRandom(state) * topSlice)];

  if (existingShoppingTiles.length > 0) {
    for (const oldTile of existingShoppingTiles) {
      const insideNew =
        oldTile.x >= pick.x &&
        oldTile.x < pick.x + w &&
        oldTile.y >= pick.y &&
        oldTile.y < pick.y + h;
      if (!insideNew) {
        resetTileToGrass(oldTile, 0.9);
      }
    }
  }

  const compound = assignCompoundLot(
    state,
    pick.x,
    pick.y,
    w,
    h,
    'shopping',
    clampedLevel,
    variant,
    1.75
  );
  state.mapVersion += 1;

  ensureTileConnectedToMainRoad(state, compound);

  const sizeLabel =
    clampedLevel === 3
      ? 'Shopping Grande 9×9 (Grand Megamall · Nv. 3)'
      : clampedLevel === 2
        ? 'Shopping Médio 8×8 (Metropolitano · Nv. 2)'
        : 'Shopping Pequeno 6×6 (Galleria Regional · Nv. 1)';

  state.pendingSounds.push({ type: 'milestone' });
  pushNews(
    state,
    `${sizeLabel} ${existingAnchor ? 'expandido e modernizado' : 'inaugurado'} com conexão viária e praça comercial!`,
    'milestone'
  );

  return compound[0] ?? null;
}

/**
 * Place a major landmark (`stadium` or `airport`):
 * - Airports occupy a `6×12` area at Nv. 1 and expand to `8×16` at Nv. 2/3, automatically demolishing obstructing lots.
 * - Stadiums occupy a `4×3` (`soccer_stadium`) sports arena complex, automatically demolishing obstructing lots.
 */
/** Return all active Metro Stations ordered cleanly along the city's underground Metro Line */
export function getMetroNetworkStations(state: CityState): Tile[] {
  const stations: Tile[] = [];
  for (let i = 0; i < state.tiles.length; i++) {
    const t = state.tiles[i];
    if (t.type === 'metro_station' && t.lotRole !== 'part') {
      stations.push(t);
    }
  }
  if (stations.length <= 2) return stations;
  // Order stations cleanly into a nearest-neighbor transit loop starting closest to city center
  const cx = typeof state.roadOriginX === 'number' ? state.roadOriginX : state.gridWidth / 2;
  const cy = typeof state.roadOriginY === 'number' ? state.roadOriginY : state.gridHeight / 2;
  stations.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
  const ordered: Tile[] = [stations.shift()!];
  while (stations.length > 0) {
    const last = ordered[ordered.length - 1];
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < stations.length; i++) {
      const d = Math.hypot(stations[i].x - last.x, stations[i].y - last.y);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    ordered.push(stations.splice(bestIdx, 1)[0]);
  }
  return ordered;
}

/**
 * Place `count` well-spaced Bus Terminals (`bus_station`) or Metro Stations (`metro_station`)
 * adjacent to the main road network (preferring wide avenues, arterial avenues & distinct neighborhoods),
 * without overwriting landmarks or high-rise towers.
 */
export function placeTransitStationOnBestSlot(
  state: CityState,
  kind: 'bus_station' | 'metro_station',
  count: number = 2,
  stationLevel: number = 1
): number {
  const clampedLv = Math.max(1, Math.min(3, stationLevel || 1));
  const minSpacing = kind === 'metro_station' ? 7 : 6;
  let placedCount = 0;

  for (let n = 0; n < count; n++) {
    const mainRoads = getMainConnectedRoadSet(state);
    const existingStations = state.tiles.filter((t) => t.type === kind);
    const existingDistricts = new Set(
      existingStations.map((st) => getNeighborhoodDistrict(state, st.x, st.y))
    );

    let best: { tile: Tile; score: number } | null = null;
    for (let i = 0; i < state.tiles.length; i++) {
      const t = state.tiles[i];
      if (t.x <= 1 || t.y <= 1 || t.x >= state.gridWidth - 2 || t.y >= state.gridHeight - 2) {
        continue;
      }
      if (classifyPlannedRoadCell(state, t.x, t.y).isPlanned) continue;
      if (t.construction || t.establishmentId || isLandmarkType(t.type) || isTransitStationType(t.type)) continue;
      if ((t.lotWidth ?? 1) > 1 || (t.lotHeight ?? 1) > 1) continue;

      const isReplaceable =
        t.type === 'grass' ||
        t.type === 'forest' ||
        t.type === 'abandoned' ||
        ((t.type === 'rural' || t.type === 'residential' || t.type === 'commercial' || t.type === 'industrial') &&
          (t.level || 1) <= 2);
      if (!isReplaceable) continue;

      const neigh = getOrthoNeighbors(state, t.x, t.y);
      const adjRoads = neigh.filter((nt) => nt.type === 'road' && mainRoads.has(nt.y * state.gridWidth + nt.x));
      if (adjRoads.length === 0) continue;

      let tooClose = false;
      for (const st of existingStations) {
        if (Math.hypot(st.x - t.x, st.y - t.y) < minSpacing) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      const district = getNeighborhoodDistrict(state, t.x, t.y);
      const touchesWideAve = adjRoads.some((r) => isWideAvenue2x2Tile(state, r.x, r.y));
      const touchesAvenue = adjRoads.some((r) => (r.level || 1) >= 2);
      const nearbyPop = countPopulatedNear(state, t.x, t.y, 4);

      let score = nearbyPop * 4 + (touchesWideAve ? 24 : touchesAvenue ? 14 : 4);
      if (!existingDistricts.has(district)) score += 22; // Spread transit across different bairros
      if (t.type === 'grass' || t.type === 'forest' || t.type === 'abandoned') score += 12;
      else if ((t.level || 1) === 1) score += 5;
      else score -= 4;

      if (!best || score > best.score) {
        best = { tile: t, score };
      }
    }

    if (!best) break;
    const target = best.tile;
    assignCompoundLot(state, target.x, target.y, 1, 1, kind, clampedLv, placedCount % 3, 1.8);
    ensureTileConnectedToMainRoad(state, [target]);
    placedCount++;
  }

  if (placedCount > 0) {
    // Also upgrade existing stations of this kind to reflect system modernization
    for (let i = 0; i < state.tiles.length; i++) {
      const t = state.tiles[i];
      if (t.type === kind && (t.level || 1) < clampedLv) {
        t.level = clampedLv;
        t.evolveFlash = 1.4;
      }
    }
    state.mapVersion += 1;
  }

  return placedCount;
}

export function placeLandmarkOnBestSlot(
  state: CityState,
  landmarkType: 'stadium' | 'airport',
  force: boolean = false,
  initialLevel: number = 1
): Tile | null {
  if (landmarkType === 'airport') {
    return placeOrExpandAirportComplex(state, initialLevel, force);
  }

  const cx = typeof state.roadOriginX === 'number' ? state.roadOriginX : state.gridWidth / 2;
  const cy = typeof state.roadOriginY === 'number' ? state.roadOriginY : state.gridHeight / 2;
  const clampedLevel = Math.max(1, Math.min(3, initialLevel));
  const stadiumSpec = ESTABLISHMENT_MAP.soccer_stadium;
  const stadiumVar = pickEstablishmentVariation(state, 'soccer_stadium');
  const orientations: Array<[number, number]> = [
    [stadiumSpec.footprintW, stadiumSpec.footprintH],
    [stadiumSpec.footprintH, stadiumSpec.footprintW],
  ];

  // Search for the best 4×3 (or rotated 3×4 when tight) slot for the Estádio de Futebol
  for (const allowAvenueCross of force ? [false, true] : [false]) {
    for (const [fw, fh] of orientations) {
      const candidates: Array<{
        x: number;
        y: number;
        score: number;
        demolishedCount: number;
      }> = [];

      for (let y = 1; y <= state.gridHeight - fh - 1; y++) {
        for (let x = 1; x <= state.gridWidth - fw - 1; x++) {
          if (!canPlaceEstablishmentAt(state, 'soccer_stadium', x, y)) continue;

          let valid = true;
          let demolishedBuildings = 0;
          let demolishedRoads = 0;
          let touchesRoad = false;

          for (let dy = 0; dy < fh && valid; dy++) {
            for (let dx = 0; dx < fw; dx++) {
              const qt = getTile(state, x + dx, y + dy);
              if (
                !qt ||
                qt.construction ||
                qt.type === 'water' ||
                qt.type === 'bridge' ||
                isLandmarkType(qt.type) ||
                qt.establishmentId
              ) {
                valid = false;
                break;
              }
              const plan = classifyPlannedRoadCell(state, qt.x, qt.y);
              if (!allowAvenueCross && (plan.onAvenueAxis || plan.onHighwayAxis)) {
                valid = false;
                break;
              }
              if (qt.type === 'road') {
                demolishedRoads++;
              } else if (qt.type !== 'grass' && qt.type !== 'forest') {
                if (!force && qt.level >= 2) {
                  valid = false;
                  break;
                }
                demolishedBuildings++;
              }
              for (const nb of getOrthoNeighbors(state, qt.x, qt.y)) {
                const outside =
                  nb.x < x || nb.x >= x + fw || nb.y < y || nb.y >= y + fh;
                if (outside && isRoadLike(nb.type)) {
                  touchesRoad = true;
                }
              }
            }
          }

          if (!valid) continue;
          if (!touchesRoad && !force) continue;

          const distFromCore = Math.hypot(x + fw * 0.5 - cx, y + fh * 0.5 - cy);
          const score =
            (touchesRoad ? 16 : 0) -
            Math.abs(distFromCore - 6.5) * 2.2 -
            demolishedBuildings * 8 -
            demolishedRoads * 14;
          candidates.push({
            x,
            y,
            score,
            demolishedCount: demolishedBuildings + demolishedRoads,
          });
        }
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => b.score - a.score);
        const topSlice = Math.max(1, Math.min(4, candidates.length));
        const pick = candidates[Math.floor(nextRandom(state) * topSlice)];
        const compound = assignCompoundLot(
          state,
          pick.x,
          pick.y,
          fw,
          fh,
          'stadium',
          clampedLevel,
          stadiumVar,
          1.65,
          'soccer_stadium'
        );
        state.mapVersion += 1;

        // Ensure road access to the main road network
        ensureTileConnectedToMainRoad(state, compound);

        const demText =
          pick.demolishedCount > 0
            ? ` (${pick.demolishedCount} lotes demolidos automaticamente)`
            : '';
        state.pendingSounds.push({ type: 'milestone' });
        pushNews(
          state,
          `Estádio de Futebol ${fw}×${fh} inaugurado${demText}! Esporte e lazer elevam a felicidade da cidade!`,
          'milestone'
        );
        return compound[0] ?? null;
      }
    }
  }

  return null;
}

/**
 * Upgrade all existing tiles of a landmark type ('port' or 'airport') up to `targetLevel`.
 * - When an `'airport'` upgrades from Nv. 1 (`6×12`) to Nv. 2/3 (`8×16`), it expands automatically.
 * - When a `'port'` upgrades to Nv. 3, it expands along the shoreline into a `2×4` / `4×2` International Cruise Terminal!
 */
export function upgradeExistingLandmarks(
  state: CityState,
  landmarkType: 'port' | 'airport',
  targetLevel: number
): number {
  const clamped = Math.max(1, Math.min(3, targetLevel));
  if (landmarkType === 'airport') {
    const hasAirport = state.tiles.some((t) => t.type === 'airport');
    if (!hasAirport) return 0;
    const anchor = placeOrExpandAirportComplex(state, clamped, true);
    return anchor ? state.tiles.filter((t) => t.type === 'airport').length : 0;
  }

  const existingPorts = state.tiles.filter((t) => t.type === 'port');
  if (existingPorts.length === 0) return 0;

  // Upgrade Port to Lv. 3: expand along the riverbank to 2×4 / 4×2 (or largest contiguous shoreline footprint >= 2×3)
  if (clamped >= 3) {
    const firstAnchor =
      existingPorts.find((t) => t.lotRole !== 'part') ?? existingPorts[0];
    const alreadyLarge =
      (firstAnchor.lotWidth ?? 1) * (firstAnchor.lotHeight ?? 1) >= 8;

    if (!alreadyLarge) {
      // Snapshot existing port tiles in case no 2×4 / 4×2 fits, then try expanding cleanly around current shoreline
      const oldSnapshot = existingPorts.map((t) => ({
        tile: t,
        level: t.level,
        variant: t.variant,
        lotRole: t.lotRole,
        lotWidth: t.lotWidth,
        lotHeight: t.lotHeight,
        lotDx: t.lotDx,
        lotDy: t.lotDy,
      }));
      const oldAnchorX = firstAnchor.x;
      const oldAnchorY = firstAnchor.y;

      for (const pt of existingPorts) {
        resetTileToGrass(pt, 0.2);
      }

      const openEdgeWater = getBridgeFreeRiverEdgeWaterSet(state);
      const shapes: Array<[number, number]> = [
        [2, 4],
        [4, 2],
        [2, 3],
        [3, 2],
      ];
      type PortPick = { x: number; y: number; fw: number; fh: number; score: number };
      let bestPick: PortPick | null = null;
      let bestScore = -Infinity;

      for (const [fw, fh] of shapes) {
        for (let y = 1; y <= state.gridHeight - fh - 1; y++) {
          for (let x = 1; x <= state.gridWidth - fw - 1; x++) {
            let valid = true;
            let touchesWater = 0;
            let touchesBridgeFreeWater = 0;
            let demolishedCost = 0;
            for (let dy = 0; dy < fh && valid; dy++) {
              for (let dx = 0; dx < fw; dx++) {
                const qt = getTile(state, x + dx, y + dy);
                if (
                  !qt ||
                  qt.type === 'water' ||
                  qt.type === 'bridge' ||
                  isLandmarkType(qt.type) ||
                  qt.establishmentId
                ) {
                  valid = false;
                  break;
                }
                const plan = classifyPlannedRoadCell(state, qt.x, qt.y);
                if (plan.onAvenueAxis || plan.onHighwayAxis) {
                  valid = false;
                  break;
                }
                if (qt.type === 'road') demolishedCost += 12;
                else if (qt.type !== 'grass' && qt.type !== 'forest') {
                  if (qt.level >= 3) {
                    valid = false;
                    break;
                  }
                  demolishedCost += qt.level * 8;
                }
                for (const nt of getOrthoNeighbors(state, qt.x, qt.y)) {
                  const outside =
                    nt.x < x || nt.x >= x + fw || nt.y < y || nt.y >= y + fh;
                  if (outside && nt.type === 'water') {
                    touchesWater++;
                    if (openEdgeWater.has(nt.y * state.gridWidth + nt.x)) {
                      touchesBridgeFreeWater++;
                    }
                  }
                }
              }
            }
            if (!valid || touchesWater === 0) continue;
            const distToOld = Math.hypot(x - oldAnchorX, y - oldAnchorY);
            const score =
              touchesWater * 18 +
              (touchesBridgeFreeWater > 0 ? 220 : 0) -
              distToOld * 22 -
              demolishedCost;
            if (score > bestScore) {
              bestScore = score;
              bestPick = { x, y, fw, fh, score };
            }
          }
        }
        if (bestPick) break;
      }

      const chosenPick = bestPick as PortPick | null;
      if (chosenPick) {
        const compound = assignCompoundLot(
          state,
          chosenPick.x,
          chosenPick.y,
          chosenPick.fw,
          chosenPick.fh,
          'port',
          3,
          firstAnchor.variant,
          1.65
        );
        ensureTileConnectedToMainRoad(state, compound);
        state.mapVersion += 1;
        return compound.length;
      }

      // Restore previous port tiles if shoreline couldn't fit expansion
      for (const snap of oldSnapshot) {
        snap.tile.type = 'port';
        snap.tile.level = 3;
        snap.tile.variant = snap.variant;
        snap.tile.lotRole = snap.lotRole;
        snap.tile.lotWidth = snap.lotWidth;
        snap.tile.lotHeight = snap.lotHeight;
        snap.tile.lotDx = snap.lotDx;
        snap.tile.lotDy = snap.lotDy;
        snap.tile.evolveFlash = 1.65;
      }
      ensureTileConnectedToMainRoad(state, existingPorts);
      state.mapVersion += 1;
      return existingPorts.length;
    }
  }

  let count = 0;
  for (const t of existingPorts) {
    if (t.level < clamped) {
      t.level = clamped;
    }
    t.evolveFlash = 1.65;
    count++;
  }
  if (count > 0) {
    ensureTileConnectedToMainRoad(state, existingPorts);
    state.mapVersion += 1;
  }
  return count;
}

function countAdjacentTypes(state: CityState, x: number, y: number) {
  let road = 0;
  let rural = 0;
  let residential = 0;
  let commercial = 0;
  let industrial = 0;
  let park = 0;
  let water = 0;
  let abandoned = 0;
  let landmark = 0;

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const t = getTile(state, x + dx, y + dy);
      if (!t) continue;
      const isOrtho = dx === 0 || dy === 0;
      if (isOrtho && isRoadLike(t.type)) road++;
      if (t.type === 'rural') rural++;
      else if (t.type === 'residential') residential++;
      else if (t.type === 'commercial') commercial++;
      else if (t.type === 'industrial') industrial++;
      else if (t.type === 'park') park++;
      else if (t.type === 'water') water++;
      else if (t.type === 'abandoned') abandoned++;
      else if (isLandmarkType(t.type)) landmark++;
    }
  }

  return { road, rural, residential, commercial, industrial, park, water, abandoned, landmark };
}

/**
 * Recompute spatial pollution, landValue, revenue-coherent city-wide budget demand/coverage,
 * happiness, tax tolerance, trade/tourism revenue, and projected monthly financials.
 */
export function recomputeFieldsAndStats(
  state: CityState,
  preserveExactArea?: BudgetAreaKey | 'ALL'
): void {
  const w = state.gridWidth;
  const h = state.gridHeight;
  const tm = state.trait.modifiers;
  if (!state.budgetTargetsPct) {
    state.budgetTargetsPct = createDefaultTargetPcts();
  }

  let pop = 0;
  let resBaseTax = 0;
  let comBaseTax = 0;
  let indBaseTax = 0;
  let rural = 0;
  let res = 0;
  let com = 0;
  let ind = 0;
  let park = 0;
  let abn = 0;
  let roads = 0;
  let streets = 0;
  let avenues = 0;
  let highways = 0;
  let interchanges = 0;
  let bridges = 0;
  let ports = 0;
  let portLevelSum = 0;
  let airports = 0;
  let airportLevelSum = 0;
  let shoppings = 0;
  let shoppingLevelSum = 0;
  let shoppingMaxLv = 0;
  let stadiums = 0;
  let sportsCenters = 0;
  let busStations = 0;
  let metroStations = 0;
  let wideAvenueTiles = 0;
  let condos = 0;
  let midRises = 0;
  let lv3 = 0;
  let multiTileBuildings = 0;
  let extraFootprintBuildingTiles = 0;
  let establishments = 0;
  let estHappyBonus = 0;
  let estTourismBonus = 0;
  let estHealthScore = 0;
  let estSecurityScore = 0;
  let estEducationScore = 0;

  for (let i = 0; i < state.tiles.length; i++) {
    const t = state.tiles[i];
    if (t.lotRole === 'anchor') {
      multiTileBuildings++;
    }
    if (t.establishmentId && t.lotRole !== 'part') {
      const spec = ESTABLISHMENT_MAP[t.establishmentId];
      if (spec) {
        establishments++;
        if (t.establishmentId === 'sports_court') {
          sportsCenters++;
        }
        pop += spec.populationBonus;
        comBaseTax += spec.monthlyRevenueBonus;
        estTourismBonus += spec.tourismBonus;
        estHappyBonus += spec.happinessBonus;
        if (spec.driverArea === 'wellbeing') estHealthScore += spec.happinessBonus;
        else if (spec.driverArea === 'security') estSecurityScore += spec.happinessBonus;
        else if (spec.driverArea === 'education') estEducationScore += spec.happinessBonus;
      }
    }
    if (t.type === 'road') {
      roads++;
      if (t.level >= 4) interchanges++;
      else if (t.level === 3) highways++;
      else if (t.level === 2) {
        avenues++;
        if (t.variant === 2) wideAvenueTiles++;
      } else streets++;
    } else if (t.type === 'bridge') {
      bridges++;
    } else if (t.type === 'rural') {
      rural++;
      if (t.lotRole === 'part') extraFootprintBuildingTiles++;
      const rLv = Math.max(1, Math.min(3, t.level || 1));
      pop += POPULATION_BY_BUILDING.rural[rLv] ?? 12;
      indBaseTax += MONTHLY_TAX_BASE_AT_10PCT.rural[rLv] ?? 300;
    } else if (t.type === 'residential') {
      res++;
      if (t.lotRole === 'part') extraFootprintBuildingTiles++;
      const resLv = Math.max(1, Math.min(4, t.level || 1));
      pop += POPULATION_BY_BUILDING.residential[resLv] ?? 24;
      resBaseTax += MONTHLY_TAX_BASE_AT_10PCT.residential[resLv] ?? 275;
      if (resLv >= 3) lv3++;
      if (!t.establishmentId && t.lotRole !== 'part') {
        if (resLv === 2) midRises++;
        else if (resLv >= 3) condos++;
      }
    } else if (t.type === 'commercial') {
      com++;
      if (t.lotRole === 'part') extraFootprintBuildingTiles++;
      const comLv = Math.max(1, Math.min(4, t.level || 1));
      pop += POPULATION_BY_BUILDING.commercial[comLv] ?? 8;
      comBaseTax += MONTHLY_TAX_BASE_AT_10PCT.commercial[comLv] ?? 410;
      if (comLv >= 3) lv3++;
    } else if (t.type === 'industrial') {
      ind++;
      if (t.lotRole === 'part') extraFootprintBuildingTiles++;
      const indLv = Math.max(1, Math.min(3, t.level || 1));
      pop += POPULATION_BY_BUILDING.industrial[indLv] ?? 14;
      indBaseTax += MONTHLY_TAX_BASE_AT_10PCT.industrial[indLv] ?? 560;
    } else if (t.type === 'park') {
      park++;
      if (t.lotRole === 'part') extraFootprintBuildingTiles++;
    } else if (t.type === 'abandoned') {
      abn++;
    } else if (t.type === 'port') {
      if (t.lotRole !== 'part') {
        ports++;
        const lv = Math.max(1, Math.min(3, t.level || 1));
        portLevelSum += lv;
        pop += POPULATION_BY_BUILDING.port * lv;
      }
    } else if (t.type === 'airport') {
      if (t.lotRole !== 'part') {
        airports++;
        const lv = Math.max(1, Math.min(3, t.level || 1));
        airportLevelSum += lv;
        pop += POPULATION_BY_BUILDING.airport * lv;
      }
    } else if (t.type === 'stadium') {
      if (t.lotRole !== 'part') {
        stadiums++;
        pop += POPULATION_BY_BUILDING.stadium;
      }
    } else if (t.type === 'bus_station') {
      if (t.lotRole !== 'part') {
        busStations++;
      }
    } else if (t.type === 'metro_station') {
      if (t.lotRole !== 'part') {
        metroStations++;
      }
    } else if (t.type === 'shopping') {
      if (t.lotRole !== 'part') {
        shoppings++;
        const lv = Math.max(1, Math.min(3, t.level || 1));
        shoppingLevelSum += lv;
        if (lv > shoppingMaxLv) shoppingMaxLv = lv;
        pop += POPULATION_BY_BUILDING.shopping * lv;
        comBaseTax += SHOPPING_COMMERCIAL_REVENUE_PER_LEVEL * lv;
      }
    }
  }

  const rawBuildingTiles = rural + res + com + ind + park;
  const primaryBuildingUnits = Math.max(0, rawBuildingTiles - extraFootprintBuildingTiles);
  const totalBuildings =
    primaryBuildingUnits +
    extraFootprintBuildingTiles * FIXED_COSTS_CONFIG.largeFootprintMaintenanceFactor;
  const totalLandmarks = ports + airports + stadiums + shoppings;
  const prevPol = state.stats.avgPollution;
  const difficulty = sanitizeDifficulty(state.difficulty);
  state.difficulty = difficulty;
  const diffCfg = DIFFICULTY_CONFIGS[difficulty];
  const needMult = diffCfg.budgetNeedMultiplier;
  const serviceImpact = diffCfg.serviceImpactMultiplier;
  const eventMods = getActiveEventModifiers(state);

  // Difficulty-scaled economic model calibrated for reduced tax yields & higher building capacity:
  // - Fácil (needMult 0.72, taxRev 1.28): 100% across all 6 segments stays comfortably in surplus
  // - Médio (needMult 1.00, taxRev 1.00): balanced classic challenge without runaway millions
  // - Difícil (needMult 1.22, taxRev 0.86): 100% across all 6 segments runs a deficit, requiring trade-offs
  const econUnit = (resBaseTax + comBaseTax + indBaseTax) * 0.1;

  const computeNeeded = (avgPolEstimate: number): Record<BudgetAreaKey, number> => ({
    infrastructure: roundTo10(
      (50 + (roads + bridges * 3) * 4 + lv3 * 70 + (ports + airports) * 110 + econUnit * 1.50) *
        needMult,
      Math.max(80, Math.round(140 * needMult))
    ),
    education: roundTo10(
      (50 + pop * 0.16 + econUnit * 1.56) * needMult,
      Math.max(80, Math.round(140 * needMult))
    ),
    security: roundTo10(
      (50 + pop * 0.14 + abn * 150 + econUnit * 1.50) * needMult,
      Math.max(80, Math.round(140 * needMult))
    ),
    wellbeing: roundTo10(
      (50 + pop * 0.15 + ind * 75 + avgPolEstimate * 10 + econUnit * 1.52) * needMult,
      Math.max(80, Math.round(140 * needMult))
    ),
    entertainment: roundTo10(
      (45 + pop * 0.11 + com * 28 + stadiums * 85 + econUnit * 1.30) * needMult,
      Math.max(70, Math.round(120 * needMult))
    ),
    tourism: roundTo10(
      (40 + com * 22 + park * 22 + totalLandmarks * 65 + econUnit * 1.12) * needMult,
      Math.max(60, Math.round(100 * needMult))
    ),
  });

  const prelimNeeded = computeNeeded(prevPol);
  const cov: Record<BudgetAreaKey, BudgetAreaStatus> = {} as Record<
    BudgetAreaKey,
    BudgetAreaStatus
  >;
  for (const key of BUDGET_AREA_ORDER) {
    const needed = prelimNeeded[key];
    const targetPct = Math.max(0, state.budgetTargetsPct[key] ?? 100);
    if (preserveExactArea !== 'ALL' && preserveExactArea !== key) {
      state.budgets[key] = Math.round((needed * targetPct) / 100);
    }
    const invested = state.budgets[key];
    const covPct = Math.min(200, Math.round((invested / needed) * 100));
    cov[key] = {
      invested,
      needed,
      coveragePct: covPct,
      targetPct: Math.min(200, Math.round(targetPct)),
      breakthroughPct: Math.min(100, Math.round(state.breakthroughCharge[key] ?? 0)),
    };
  }

  const polBuffer = new Float32Array(w * h);
  const valBuffer = new Float32Array(w * h);

  const infraCurve = getSegmentEffectCurve(cov.infrastructure.coveragePct).effectiveFactor;
  const eduCurvePre = getSegmentEffectCurve(cov.education.coveragePct).effectiveFactor;
  const tourCurvePre = getSegmentEffectCurve(cov.tourism.coveragePct).effectiveFactor;
  const cleanupTier = getBoostTier(state, 'environmental_cleanup');
  const cleanupMult =
    cleanupTier === 0
      ? 1.0
      : Math.max(0.18, 0.55 - (cleanupTier - 1) * 0.12);
  const tourismTrafficPol = Math.max(0, tourCurvePre - 0.85) * 1.65;

  let lowHealthFactor = 0;
  const fillSpatialBuffers = (wellCovPct: number): void => {
    polBuffer.fill(0);
    valBuffer.fill(28);
    const wellCurveCur = getSegmentEffectCurve(wellCovPct).effectiveFactor;
    // Saúde & Meio Ambiente (wellbeing) + Educação (clean tech) combat pollution directly;
    // Low Saúde & Meio Ambiente (< 85%) causes Infraestrutura (roads/density) to generate sharper traffic & local pollution.
    const cleanFactor = Math.max(
      0.20,
      (1 - (eduCurvePre * 0.15 + wellCurveCur * 0.27) * serviceImpact) * cleanupMult
    );
    lowHealthFactor = Math.max(0, 85 - wellCovPct) / 85;
    const infraLowHealthPolMult =
      1 + lowHealthFactor * (0.42 + Math.max(0.4, infraCurve) * 0.48);

    for (let i = 0; i < state.tiles.length; i++) {
      const t = state.tiles[i];

      if (t.type === 'industrial') {
        const emit = POLLUTION_EMISSION.industrial * tm.pollutionMultiplier * cleanFactor;
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            const nx = t.x + dx;
            const ny = t.y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const d = Math.hypot(dx, dy);
            if (d > 3.2) continue;
            const falloff = 1 - d / 3.5;
            polBuffer[ny * w + nx] += emit * falloff;
            valBuffer[ny * w + nx] -= 11 * falloff;
          }
        }
      } else if (t.type === 'road' || t.type === 'bridge') {
        const roadEnvMult = tm.pollutionMultiplier * cleanupMult * infraLowHealthPolMult;
        if (t.type === 'road' && t.level >= 4) {
          // Planned Trevo / Rotatória: smooth traffic flow reduces congestion & elevates urban prestige
          polBuffer[i] +=
            (POLLUTION_EMISSION.road * 0.55 * roadEnvMult) + tourismTrafficPol * 0.6;
          valBuffer[i] += 11;
          for (const nb of getOrthoNeighbors(state, t.x, t.y)) {
            valBuffer[nb.y * w + nb.x] += 4;
          }
        } else if (t.type === 'road' && t.level === 3) {
          // Estrada Expressa: high-speed corridor, modest highway emission & logistics value
          polBuffer[i] +=
            (POLLUTION_EMISSION.road * 1.45 * roadEnvMult) + tourismTrafficPol;
          valBuffer[i] += 5;
        } else if (t.type === 'road' && t.level === 2) {
          // Avenida Arborizada / Avenida Larga 2×2: high commercial & residential prestige along the boulevard
          const isWide2x2 = t.variant === 2;
          polBuffer[i] +=
            POLLUTION_EMISSION.road * (isWide2x2 ? 0.78 : 0.9) * roadEnvMult +
            tourismTrafficPol * 0.75;
          valBuffer[i] += isWide2x2 ? 12 : 8;
          for (const nb of getOrthoNeighbors(state, t.x, t.y)) {
            valBuffer[nb.y * w + nb.x] += isWide2x2 ? 5 : 3;
          }
        } else {
          polBuffer[i] += POLLUTION_EMISSION.road * roadEnvMult + tourismTrafficPol * 0.4;
          valBuffer[i] += 4;
        }
      } else if (t.type === 'bus_station') {
        const lvMult = 0.85 + (t.level || 1) * 0.25;
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            const nx = t.x + dx;
            const ny = t.y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const d = Math.hypot(dx, dy);
            if (d > 3.2) continue;
            const falloff = 1 - d / 3.5;
            polBuffer[ny * w + nx] += POLLUTION_EMISSION.busStationReduction * lvMult * falloff;
            valBuffer[ny * w + nx] += 14 * lvMult * falloff;
          }
        }
      } else if (t.type === 'metro_station') {
        const lvMult = 0.9 + (t.level || 1) * 0.25;
        for (let dy = -4; dy <= 4; dy++) {
          for (let dx = -4; dx <= 4; dx++) {
            const nx = t.x + dx;
            const ny = t.y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const d = Math.hypot(dx, dy);
            if (d > 4.2) continue;
            const falloff = 1 - d / 4.5;
            polBuffer[ny * w + nx] += POLLUTION_EMISSION.metroStationReduction * lvMult * falloff;
            valBuffer[ny * w + nx] += 26 * lvMult * falloff;
          }
        }
      } else if (t.type === 'commercial' && t.level >= 3) {
        // Emissão de comércio avançado (Nv. 3 e Nv. 4)
        polBuffer[i] +=
          POLLUTION_EMISSION.commercialLv3 *
            tm.pollutionMultiplier *
            cleanupMult *
            (1 + lowHealthFactor * 0.55) +
          tourismTrafficPol * 1.25;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const nx = t.x + dx;
            const ny = t.y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            valBuffer[ny * w + nx] += 10;
          }
        }
      } else if (t.type === 'park') {
        const greenBonus = 1 + Math.max(0, wellCurveCur - 1.0) * 0.45;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const nx = t.x + dx;
            const ny = t.y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const d = Math.hypot(dx, dy);
            if (d > 2.4) continue;
            const falloff = 1 - d / 2.6;
            polBuffer[ny * w + nx] += POLLUTION_EMISSION.parkReduction * greenBonus * falloff;
            valBuffer[ny * w + nx] += 18 * falloff;
          }
        }
      } else if (t.type === 'stadium') {
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            const nx = t.x + dx;
            const ny = t.y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const d = Math.hypot(dx, dy);
            if (d > 3.2) continue;
            valBuffer[ny * w + nx] += 20 * (1 - d / 3.5);
          }
        }
      } else if (t.type === 'port') {
        polBuffer[i] += POLLUTION_EMISSION.port * tm.pollutionMultiplier * cleanupMult;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const nx = t.x + dx;
            const ny = t.y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            valBuffer[ny * w + nx] += 12;
          }
        }
      } else if (t.type === 'airport') {
        if (t.lotRole !== 'part') {
          polBuffer[i] += POLLUTION_EMISSION.airport * tm.pollutionMultiplier * cleanupMult;
        } else {
          polBuffer[i] += 2 * tm.pollutionMultiplier * cleanupMult;
        }
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const nx = t.x + dx;
            const ny = t.y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            valBuffer[ny * w + nx] += t.lotRole !== 'part' ? 14 : 1.5;
          }
        }
      } else if (t.type === 'shopping') {
        if (t.lotRole !== 'part') {
          polBuffer[i] +=
            POLLUTION_EMISSION.shopping * tm.pollutionMultiplier * cleanupMult +
            tourismTrafficPol;
        }
        const lvBoost = 1 + (t.level || 1) * 0.25;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const nx = t.x + dx;
            const ny = t.y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            valBuffer[ny * w + nx] += (t.lotRole !== 'part' ? 16 : 2.2) * lvBoost;
          }
        }
      } else if (t.type === 'forest') {
        polBuffer[i] += POLLUTION_EMISSION.forestReduction;
        valBuffer[i] += 6;
      } else if (t.type === 'water') {
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const nx = t.x + dx;
            const ny = t.y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            valBuffer[ny * w + nx] += 4.5;
          }
        }
      } else if (t.type === 'abandoned') {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = t.x + dx;
            const ny = t.y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            valBuffer[ny * w + nx] -= 10;
          }
        }
      } else if (t.type === 'rural') {
        polBuffer[i] += POLLUTION_EMISSION.rural;
        valBuffer[i] += 7;
      } else if (t.type === 'residential' || t.type === 'commercial') {
        valBuffer[i] += t.level * 12;
        if (t.type === 'residential' && t.level >= 3 && lowHealthFactor > 0) {
          polBuffer[i] += lowHealthFactor * Math.max(0.5, infraCurve) * 4.5;
        }
      }

      // Apply specialized establishment spatial land-value aura & pollution reduction
      if (t.establishmentId && t.lotRole !== 'part') {
        const spec = ESTABLISHMENT_MAP[t.establishmentId];
        if (spec) {
          const r = Math.max(1, spec.landValueRadius);
          for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
              const nx = t.x + dx;
              const ny = t.y + dy;
              if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
              const d = Math.hypot(dx, dy);
              if (d > r + 0.35) continue;
              const falloff = 1 - d / (r + 0.75);
              valBuffer[ny * w + nx] += spec.landValueBonus * falloff;
              if (spec.pollutionDelta !== 0) {
                polBuffer[ny * w + nx] += spec.pollutionDelta * falloff;
              }
            }
          }
        }
      }
    }
  };

  const prelimWellCovPct = cov.wellbeing.coveragePct;
  fillSpatialBuffers(prelimWellCovPct);

  // Pass 1 pollution estimate so Saúde & Meio Ambiente (wellbeing) needed/coverage updates BEFORE
  // computing active pollution scrubbing, serviceValBonus, and tile landValue in the same cycle.
  const wellCurvePre = getSegmentEffectCurve(prelimWellCovPct).effectiveFactor;
  const wellActiveScrubPre = Math.max(0, wellCurvePre - 1.0) * 14;
  let polSumPass1 = 0;
  let devTilesPass1 = 0;
  for (let i = 0; i < state.tiles.length; i++) {
    const t = state.tiles[i];
    if (
      (isBuildingType(t.type) && (!isLandmarkType(t.type) || t.lotRole !== 'part')) ||
      isRoadLike(t.type)
    ) {
      const scrubbedPre =
        polBuffer[i] > 0 && t.type !== 'industrial'
          ? Math.max(0, polBuffer[i] - wellActiveScrubPre)
          : polBuffer[i];
      polSumPass1 += Math.max(0, Math.min(100, Math.round(scrubbedPre)));
      devTilesPass1++;
    }
  }
  const avgPolPass1 = devTilesPass1 > 0 ? Math.round(polSumPass1 / devTilesPass1) : 0;

  const midNeeded = computeNeeded(avgPolPass1);
  const wellTargetPct = Math.max(0, state.budgetTargetsPct.wellbeing ?? 100);
  if (preserveExactArea !== 'ALL' && preserveExactArea !== 'wellbeing') {
    state.budgets.wellbeing = Math.round((midNeeded.wellbeing * wellTargetPct) / 100);
  }
  cov.wellbeing = {
    invested: state.budgets.wellbeing,
    needed: midNeeded.wellbeing,
    coveragePct: Math.min(
      200,
      Math.round((state.budgets.wellbeing / midNeeded.wellbeing) * 100)
    ),
    targetPct: Math.min(200, Math.round(wellTargetPct)),
    breakthroughPct: Math.min(100, Math.round(state.breakthroughCharge.wellbeing ?? 0)),
  };

  // If wellbeing coveragePct shifted between prevPol and avgPolPass1, refresh spatial buffers with updated wellbeing
  if (cov.wellbeing.coveragePct !== prelimWellCovPct) {
    fillSpatialBuffers(cov.wellbeing.coveragePct);
  }

  const infraR = infraCurve;
  const eduR = eduCurvePre;
  const wellR = getSegmentEffectCurve(cov.wellbeing.coveragePct).effectiveFactor;
  const secR = getSegmentEffectCurve(cov.security.coveragePct).effectiveFactor;
  const entR = getSegmentEffectCurve(cov.entertainment.coveragePct).effectiveFactor;

  const vitalityFloorPre = Math.min(entR, eduR);
  const secValR = vitalityFloorPre < 0.7 ? Math.min(secR, 0.58 + vitalityFloorPre * 0.42) : secR;

  const serviceValBonus =
    (infraR * 9 + eduR * 11 + wellR * 11 + secValR * 8 + entR * 8) * serviceImpact +
    Math.min(12, (estHealthScore + estSecurityScore + estEducationScore) * 0.22);

  // Over-investment (>100%) in Saúde & Meio Ambiente actively scrubs residual urban pollution
  const wellActiveScrub = Math.max(0, wellR - 1.0) * 14;

  let polSum = 0;
  let devTiles = 0;
  let resLow = 0;
  let resMed = 0;
  let resHigh = 0;

  for (let i = 0; i < state.tiles.length; i++) {
    const t = state.tiles[i];
    const scrubbedPol =
      polBuffer[i] > 0 && t.type !== 'industrial'
        ? Math.max(0, polBuffer[i] - wellActiveScrub)
        : polBuffer[i];
    t.pollution = Math.max(0, Math.min(100, Math.round(scrubbedPol)));
    t.landValue = Math.max(
      0,
      Math.min(100, Math.round(valBuffer[i] + serviceValBonus - t.pollution * 0.45))
    );
    if (t.type === 'residential') {
      if (t.landValue >= 62) resHigh++;
      else if (t.landValue >= 38) resMed++;
      else resLow++;
    }
    if (
      (isBuildingType(t.type) && (!isLandmarkType(t.type) || t.lotRole !== 'part')) ||
      isRoadLike(t.type)
    ) {
      polSum += t.pollution;
      devTiles++;
    }
  }

  const avgPol = devTiles > 0 ? Math.round(polSum / devTiles) : 0;

  if (avgPol !== avgPolPass1) {
    const finalNeeded = computeNeeded(avgPol);
    if (preserveExactArea !== 'ALL' && preserveExactArea !== 'wellbeing') {
      state.budgets.wellbeing = Math.round((finalNeeded.wellbeing * wellTargetPct) / 100);
    }
    cov.wellbeing = {
      invested: state.budgets.wellbeing,
      needed: finalNeeded.wellbeing,
      coveragePct: Math.min(
        200,
        Math.round((state.budgets.wellbeing / finalNeeded.wellbeing) * 100)
      ),
      targetPct: Math.min(200, Math.round(wellTargetPct)),
      breakthroughPct: Math.min(100, Math.round(state.breakthroughCharge.wellbeing ?? 0)),
    };
  }

  const wellRatio = getSegmentEffectCurve(cov.wellbeing.coveragePct).effectiveFactor;
  const secRatio = getSegmentEffectCurve(cov.security.coveragePct).effectiveFactor;
  const entRatio = getSegmentEffectCurve(cov.entertainment.coveragePct).effectiveFactor;
  const eduRatio = getSegmentEffectCurve(cov.education.coveragePct).effectiveFactor;
  const tourRatio = getSegmentEffectCurve(cov.tourism.coveragePct).effectiveFactor;

  // Segurança happiness/attractiveness is contained when Cultura & Lazer or Educação are low (< 70%)
  const vitalityFloor = Math.min(entRatio, eduRatio);
  const secHappyRatio =
    vitalityFloor < 0.7
      ? Math.min(secRatio, 0.56 + vitalityFloor * 0.42)
      : secRatio;

  const rawServiceAvg = Math.round(
    ((eduRatio + wellRatio + secHappyRatio + entRatio) / 4) * 100
  );
  const serviceAvg = Math.max(0, rawServiceAvg - eventMods.servicePenaltyPct);
  const clampedServiceAvg = Math.min(100, serviceAvg);
  const fairTax = computeFairTaxRate(serviceAvg, difficulty, cov.education.coveragePct);

  // Toll Plaza (Pedágio Rodoviário) external visitor flow & revenue calculation
  if (!state.tollPlaza) {
    state.tollPlaza = createInitialTollPlaza();
  }
  const tollSpec = TOLL_TARIFF_CONFIGS[state.tollPlaza.tariff ?? 'medium'] ?? TOLL_TARIFF_CONFIGS.medium;
  const festTier = getBoostTier(state, 'tourism_festival');
  const baseVisitorFlowPct = Math.round(
    100 *
      (state.tollPlaza.built ? tollSpec.visitorFlowMult : 1.0) *
      (festTier > 0 ? 1.12 + festTier * 0.04 : 1.0) *
      (eventMods.growthMult < 0.7 ? 0.85 : eventMods.growthMult > 1.1 ? 1.12 : 1.0)
  );
  const visitorFlowPct = Math.max(35, Math.min(135, baseVisitorFlowPct));
  const tollTourismMult = state.tollPlaza.built ? tollSpec.tourismMult : 1.0;
  const tollHappyDelta = state.tollPlaza.built ? tollSpec.happinessDelta : 0;

  const resTaxExcess = state.taxes.residential - fairTax;
  const comTaxExcess = state.taxes.commercial - (fairTax + 0.5);

  const serviceScore =
    (wellRatio * 20 + secHappyRatio * 14 + entRatio * 12 + eduRatio * 10) * serviceImpact;
  // Educated citizens notice service-quality shortfalls more sharply
  const eduQualityExpectationPenalty =
    Math.max(0, eduRatio - 0.92) * Math.max(0, 84 - serviceAvg) * 0.20;
  const wellOverBonus = wellRatio > 1.0 ? Math.min(6, (wellRatio - 1.0) * 20) : 0;
  const parkBonus = Math.min(14, park * 2.0);
  const transitHappyBonus = Math.min(10, busStations * 1.5 + metroStations * 2.8);
  const shoppingHappyBonus = Math.min(9, shoppingLevelSum * 2.8);
  const landmarkHappyBonus =
    Math.min(20, stadiums * 9 + ports * 3 + airports * 4 + shoppingHappyBonus) + transitHappyBonus;
  const abandonPenalty = Math.min(28, abn * 3.5);
  const polPenalty = avgPol * 0.65;
  const cashPenalty = state.money < 0 ? 11 : 0;

  const festivalBonus = festTier > 0 ? 8 + festTier * 4 : 0;
  const cleanBonus = cleanupTier >= 2 ? (cleanupTier - 1) * 4 : 0;
  const landmarkBoostBonus = hasCityBoost(state, 'landmark_project') ? 14 : 0;

  const taxHappyEffect =
    resTaxExcess > 0
      ? -(resTaxExcess * 3.8 + Math.max(0, comTaxExcess) * 1.1)
      : Math.min(10, -resTaxExcess * 1.5);

  const establishmentServiceBonus = Math.min(
    18,
    estHappyBonus * 0.55 + (estHealthScore + estSecurityScore + estEducationScore) * 0.25
  );

  const rawHappiness =
    36 +
    serviceScore +
    wellOverBonus +
    parkBonus +
    landmarkHappyBonus +
    establishmentServiceBonus +
    festivalBonus +
    cleanBonus +
    landmarkBoostBonus +
    tm.happinessBonus +
    diffCfg.happinessBonus +
    eventMods.happinessDelta +
    tollHappyDelta +
    taxHappyEffect -
    eduQualityExpectationPenalty -
    polPenalty -
    abandonPenalty -
    cashPenalty;

  const happiness = Math.max(5, Math.min(100, Math.round(rawHappiness)));

  // Public Transit (Bus & Metro) ridership & coverage metrics
  const transitCapacity = busStations * 1400 + metroStations * 4600;
  const transitCoveragePct =
    pop > 0 && transitCapacity > 0
      ? Math.min(100, Math.round((transitCapacity / Math.max(1200, pop)) * 100))
      : 0;
  const monthlyTransitRiders =
    transitCapacity > 0
      ? Math.round(
          Math.min(transitCapacity * 1.45, pop * (0.22 + (transitCoveragePct / 100) * 0.58))
        )
      : 0;

  // Educação (Tecnologia & Renda) expands tax base & clean commercial yields (bounded at 150%/200%)
  const eduIncomeBoost =
    0.86 + eduRatio * 0.29 * serviceImpact + Math.min(0.12, estEducationScore * 0.008);
  const happyScale = 0.72 + (happiness / 100) * 0.42;
  const revDiffMult = diffCfg.taxRevenueMultiplier * eventMods.revenueMult;

  const totalResTax = Math.round(
    resBaseTax *
      (state.taxes.residential / 10) *
      eduIncomeBoost *
      happyScale *
      tm.taxMultiplier *
      revDiffMult
  );
  // Segurança penalty on Turismo & Comércio when Security < 85%
  const secTourismPenalty =
    cov.security.coveragePct < 85
      ? Math.max(0.54, 0.54 + (cov.security.coveragePct / 85) * 0.46)
      : 1.0;

  const transitComBonus = Math.min(0.16, busStations * 0.015 + metroStations * 0.03);
  const tourComBoost =
    tourRatio > 1.0 ? (tourRatio - 1.0) * 0.30 * secTourismPenalty : 0;
  const eduComModernBonus = eduRatio > 1.0 ? (eduRatio - 1.0) * 0.18 : 0;
  const totalComTax = Math.round(
    comBaseTax *
      (state.taxes.commercial / 10) *
      (0.88 +
        entRatio * 0.24 * serviceImpact +
        tourComBoost +
        eduComModernBonus +
        stadiums * 0.06 +
        airports * 0.08 +
        transitComBonus) *
      happyScale *
      tm.taxMultiplier *
      revDiffMult
  );
  const totalIndTax = Math.round(
    indBaseTax *
      (state.taxes.industrial / 10) *
      (0.88 + infraCurve * 0.2 * serviceImpact + ports * 0.08) *
      tm.taxMultiplier *
      revDiffMult
  );

  // Monthly Tourism & Commerce External Revenue: penalized when Segurança is low (< 85%)
  const beautyFactor = Math.max(0.25, 1 - avgPol / 75);
  const cityAppeal =
    45 +
    park * 42 +
    com * 34 +
    lv3 * 72 +
    portLevelSum * 155 +
    stadiums * 280 +
    airportLevelSum * 390 +
    shoppingLevelSum * 260 +
    busStations * 45 +
    metroStations * 130 +
    estTourismBonus +
    entRatio * 65 +
    (state.trait.id === 'tourist_climate' ? 95 : 0);
  const festivalMult = festTier > 0 ? 1.65 + festTier * 0.48 : 1.0;
  const totalTourism =
    state.budgets.tourism > 0 || festivalMult > 1 || totalLandmarks > 0 || estTourismBonus > 0
      ? Math.round(
          cityAppeal *
            Math.max(0.42, tourRatio) *
            secTourismPenalty *
            beautyFactor *
            festivalMult *
            tollTourismMult *
            tm.taxMultiplier *
            revDiffMult
        )
      : 0;

  // Monthly Maritime / Air Trade Revenue from Ports & Airports (scales with Evolutionary Level 1..3!)
  const portHubMult = hasCityBoost(state, 'port_evolution') ? 1.35 : 1.0;
  const airHubMult = hasCityBoost(state, 'airport_evolution') ? 1.4 : 1.0;
  const totalTrade = Math.round(
    (portLevelSum * (260 + com * 14 + ind * 18) * portHubMult +
      airportLevelSum * (440 + com * 22 + lv3 * 36) * airHubMult) *
      tm.taxMultiplier *
      revDiffMult
  );

  // Monthly External Highway Toll Revenue (when Pedágio is constructed at 20.000+ hab.)
  const baseMonthlyVehicles = Math.round(
    (360 + pop * 0.14 + com * 18 + totalLandmarks * 140 + sportsCenters * 45) *
      (visitorFlowPct / 100)
  );
  const totalTollIncome = state.tollPlaza.built
    ? Math.round(baseMonthlyVehicles * tollSpec.feePerVehicle * revDiffMult)
    : 0;
  state.tollPlaza.monthlyVehicles = baseMonthlyVehicles;
  state.tollPlaza.monthlyRevenue = totalTollIncome;
  state.tollPlaza.visitorFlowPct = visitorFlowPct;

  const budgetTotal = BUDGET_AREA_ORDER.reduce((sum, k) => sum + state.budgets[k], 0);

  const bridgeSpanCount = countRiverBridges(state);
  let maxBridgeLv = 1;
  for (let i = 0; i < state.tiles.length; i++) {
    const t = state.tiles[i];
    if (t.type === 'bridge') {
      const lv = Math.max(1, Math.min(4, t.level || 1));
      if (lv > maxBridgeLv) maxBridgeLv = lv;
    }
  }

  state.stats = {
    population: pop,
    avgPollution: avgPol,
    happiness,
    serviceCoverageAvg: clampedServiceAvg,
    budgetTotal,
    tourismRevenue: totalTourism,
    tradeRevenue: totalTrade,
    ruralCount: rural,
    residentialCount: res,
    resLowValueCount: resLow,
    resMedValueCount: resMed,
    resHighValueCount: resHigh,
    commercialCount: com,
    industrialCount: ind,
    parkCount: park,
    abandonedCount: abn,
    roadCount: roads,
    streetCount: streets,
    avenueCount: avenues,
    highwayCount: highways,
    interchangeCount: interchanges,
    bridgeCount: bridges,
    bridgeSpanCount,
    bridgeLevel: bridges > 0 ? maxBridgeLv : getCurrentBridgeLevel(state),
    portCount: ports,
    airportCount: airports,
    stadiumCount: stadiums,
    sportsCenterCount: sportsCenters,
    busStationCount: busStations,
    metroStationCount: metroStations,
    shoppingCount: shoppings,
    shoppingLevel: shoppingMaxLv,
    wideAvenueTileCount: wideAvenueTiles,
    monthlyTransitRiders,
    transitCoveragePct,
    condoCount: condos,
    midRiseCount: midRises,
    visitorTrafficPct: visitorFlowPct,
    level3Count: lv3,
    multiTileBuildingCount: multiTileBuildings,
    establishmentCount: establishments,
    coverage: cov,
  };

  state.totalPopulation = pop;
  state.globalHappiness = happiness;
  state.globalServiceCoverage = clampedServiceAvg;

  const revenueTotal =
    totalResTax + totalComTax + totalIndTax + totalTourism + totalTrade + totalTollIncome;
  const fixedMult = diffCfg.fixedCostMultiplier * eventMods.expenseMult;
  // High Tourism & Commerce or high Infrastructure under low Saúde & Meio Ambiente adds moderate road upkeep
  const trafficUpkeepMult =
    1 +
    Math.max(0, tourRatio - 0.9) * 0.14 +
    lowHealthFactor * Math.max(0, infraCurve - 0.85) * 0.12;
  const fixedRoadsAndBridges = Math.round(
    (roads * FIXED_COSTS_CONFIG.perRoad +
      bridges * FIXED_COSTS_CONFIG.perBridge +
      busStations * FIXED_COSTS_CONFIG.perBusStation +
      metroStations * FIXED_COSTS_CONFIG.perMetroStation +
      shoppings * FIXED_COSTS_CONFIG.perShopping) *
      trafficUpkeepMult *
      fixedMult
  );
  const debtInterest =
    state.money < 0
      ? Math.max(180, Math.round(Math.abs(state.money) * 0.08 * diffCfg.fixedCostMultiplier))
      : 0;
  const tollUpkeep = state.tollPlaza.built ? FIXED_COSTS_CONFIG.perTollPlaza : 0;
  const fixedCityHall =
    Math.round(
      (FIXED_COSTS_CONFIG.baseCityHall +
        totalBuildings * FIXED_COSTS_CONFIG.perBuilding +
        totalLandmarks * FIXED_COSTS_CONFIG.perLandmark +
        tollUpkeep) *
        fixedMult
    ) + debtInterest;
  const fixedTotal = fixedRoadsAndBridges + fixedCityHall;
  const expensesTotal = budgetTotal + fixedTotal;

  state.financials = {
    revenue: {
      residentialTax: totalResTax,
      commercialTax: totalComTax,
      industrialTax: totalIndTax,
      tourismIncome: totalTourism,
      tradeIncome: totalTrade,
      tollIncome: totalTollIncome,
      total: revenueTotal,
    },
    expenses: {
      variableBudgets: budgetTotal,
      fixedRoadsAndBridges,
      fixedCityHall,
      fixedTotal,
      total: expensesTotal,
    },
    netBalance: revenueTotal - expensesTotal,
    fairTaxRate: fairTax,
    eventRevenueMult: eventMods.revenueMult,
    eventExpenseMult: eventMods.expenseMult,
  };
}

/**
 * Set variable monthly budget ($/mês) for one city-wide investment area,
 * and lock its proportional target percentage of necessity so it scales automatically as the city grows!
 */
export function setCityBudget(
  state: CityState,
  area: BudgetAreaKey,
  nextAmount: number
): boolean {
  if (!Number.isFinite(nextAmount)) return false;
  const sanitized = Math.max(0, Math.round(nextAmount));
  if (!state.budgetTargetsPct) {
    state.budgetTargetsPct = createDefaultTargetPcts();
  }
  const curNeeded = Math.max(
    1,
    state.stats.coverage[area]?.needed || BUDGET_AREA_META[area].defaultMonthly
  );
  let nextPct = (sanitized / curNeeded) * 100;
  if (sanitized === curNeeded) nextPct = 100;
  else if (sanitized === Math.round(curNeeded * 1.5)) nextPct = 150;
  else if (sanitized === Math.round(curNeeded * 2.0)) nextPct = 200;

  if (
    state.budgets[area] === sanitized &&
    Math.abs((state.budgetTargetsPct[area] ?? 100) - nextPct) < 0.01
  ) {
    return false;
  }
  state.budgets[area] = sanitized;
  state.budgetTargetsPct[area] = nextPct;
  recomputeFieldsAndStats(state, area);
  return true;
}

/**
 * Set persistent target percentage of necessity (e.g. 100%, 150%, 200%, or 0..200%)
 * for one segment so its dollar investment automatically scales as city demand grows!
 */
export function setCityBudgetTargetPct(
  state: CityState,
  area: BudgetAreaKey,
  targetPct: number
): boolean {
  if (!Number.isFinite(targetPct)) return false;
  const clamped = Math.max(0, Math.min(200, Math.round(targetPct)));
  if (!state.budgetTargetsPct) {
    state.budgetTargetsPct = createDefaultTargetPcts();
  }
  const curNeeded = Math.max(
    1,
    state.stats.coverage[area]?.needed || BUDGET_AREA_META[area].defaultMonthly
  );
  const nextDollar = Math.round((curNeeded * clamped) / 100);
  state.budgetTargetsPct[area] = clamped;
  state.budgets[area] = nextDollar;
  recomputeFieldsAndStats(state);
  return true;
}

/** Adjust city-wide tax rate (%) for Residential, Commercial, or Industrial (0..25%) */
export function setTaxRate(
  state: CityState,
  sector: keyof TaxRates,
  nextRate: number
): boolean {
  const clamped = Math.max(MIN_TAX_RATE, Math.min(MAX_TAX_RATE, Math.round(nextRate)));
  if (state.taxes[sector] === clamped) return false;
  state.taxes[sector] = clamped;
  recomputeFieldsAndStats(state);
  return true;
}

/** Switch active city difficulty live and immediately recalculate economy & budget needs */
export function setCityDifficulty(
  state: CityState,
  nextDifficulty: DifficultyLevel
): boolean {
  const sanitized = sanitizeDifficulty(nextDifficulty);
  if (state.difficulty === sanitized) return false;
  state.difficulty = sanitized;
  const cfg = DIFFICULTY_CONFIGS[sanitized];
  recomputeFieldsAndStats(state);
  pushNews(
    state,
    `Dificuldade ajustada para ${cfg.label}: ${cfg.tagline}.`,
    'info'
  );
  return true;
}

/** Toggle city-wide housing policy: manual Mid-Rise -> Condo conversion vs automatic verticalization */
export function setCondoPolicy(state: CityState, policy: CondoPolicy): boolean {
  if (state.condoPolicy === policy) return false;
  state.condoPolicy = policy;
  pushNews(
    state,
    policy === 'auto'
      ? 'Plano Habitacional: Prédios Médios agora podem evoluir automaticamente para Condomínios!'
      : 'Plano Habitacional: Prédios Médios permanecem contidos até você autorizar conversão em Condomínio no mapa.',
    'info'
  );
  return true;
}

/** Find a valid 2×2 city block slot around a tile for a Mega Condomínio / Skyscraper 2×2 */
function findSkyscraper2x2SlotForTile(
  state: CityState,
  tile: Tile
): { ax: number; ay: number } | null {
  if ((tile.lotWidth ?? 1) === 2 && (tile.lotHeight ?? 1) === 2) {
    return {
      ax: tile.x - (tile.lotDx ?? 0),
      ay: tile.y - (tile.lotDy ?? 0),
    };
  }
  for (const [ox, oy] of [
    [0, 0],
    [-1, 0],
    [0, -1],
    [-1, -1],
  ]) {
    const ax = tile.x + ox;
    const ay = tile.y + oy;
    if (ax < 1 || ay < 1 || ax + 1 >= state.gridWidth - 1 || ay + 1 >= state.gridHeight - 1) {
      continue;
    }
    let validBlock = true;
    let supportingTiles = 0;
    for (let dy = 0; dy < 2 && validBlock; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const bt = getTile(state, ax + dx, ay + dy);
        if (!bt || bt.construction || bt.establishmentId || classifyPlannedRoadCell(state, bt.x, bt.y).isPlanned) {
          validBlock = false;
          break;
        }
        if ((bt.lotWidth ?? 1) > 2 || (bt.lotHeight ?? 1) > 2) {
          validBlock = false;
          break;
        }
        if (
          bt.lotRole === 'part' &&
          (bt.x - (bt.lotDx ?? 0) < ax || bt.y - (bt.lotDy ?? 0) < ay)
        ) {
          validBlock = false;
          break;
        }
        if (
          bt.type !== 'residential' &&
          bt.type !== 'commercial' &&
          bt.type !== 'rural' &&
          bt.type !== 'abandoned' &&
          bt.type !== 'grass' &&
          bt.type !== 'forest'
        ) {
          validBlock = false;
          break;
        }
        if (bt.type === tile.type || bt.level >= 2) {
          supportingTiles++;
        }
      }
    }
    if (validBlock && supportingTiles >= 1) {
      return { ax, ay };
    }
  }
  return null;
}

export interface CondoConversionInfo {
  eligible: boolean;
  canConvert: boolean;
  canAfford: boolean;
  targetLevel: 3 | 4;
  targetLabel: string;
  cost: number;
  currentResidents: number;
  projectedResidents: number;
  popGain: number;
  reason?: string;
}

/** Inspect whether a tile is a Prédio Médio (Nv. 2) or Condomínio (Nv. 3) eligible for player-triggered Condo conversion */
export function getCondoConversionInfo(
  state: CityState,
  tx: number,
  ty: number
): CondoConversionInfo | null {
  const tile = getTile(state, tx, ty);
  if (!tile || tile.type !== 'residential' || tile.establishmentId) return null;
  const anchor = getCompoundAnchorTile(state, tile);
  if (!anchor || anchor.type !== 'residential' || anchor.establishmentId) return null;
  if (anchor.level !== 2 && anchor.level !== 3) return null;

  const compound = getCompoundTiles(state, anchor);
  const diffCfg = DIFFICULTY_CONFIGS[sanitizeDifficulty(state.difficulty)];
  const eventMods = getActiveEventModifiers(state);
  const costMult = diffCfg.constructionCostMultiplier * eventMods.expenseMult;

  if (anchor.level === 2) {
    const cost = roundTo10(
      CONDO_CONVERSION_CONFIG.toCondoLv3BaseCost * (0.75 + compound.length * 0.25) * costMult,
      50
    );
    const currentResidents = compound.length * (POPULATION_BY_BUILDING.residential[2] ?? 90);
    const projectedResidents = compound.length * (POPULATION_BY_BUILDING.residential[3] ?? 240);
    const canAfford = state.money >= cost;
    return {
      eligible: true,
      canConvert: canAfford,
      canAfford,
      targetLevel: 3,
      targetLabel: 'Condomínio Residencial (Nv. 3)',
      cost,
      currentResidents,
      projectedResidents,
      popGain: Math.max(0, projectedResidents - currentResidents),
      reason: canAfford ? undefined : `Caixa insuficiente ($${cost.toLocaleString('pt-BR')})`,
    };
  }

  // Level 3 -> Mega Condomínio 2×2 (Lv. 4)
  const cost = roundTo10(CONDO_CONVERSION_CONFIG.toMegaCondoLv4BaseCost * costMult, 100);
  const currentResidents = compound.length * (POPULATION_BY_BUILDING.residential[3] ?? 240);
  const projectedResidents = 4 * (POPULATION_BY_BUILDING.residential[4] ?? 520);
  const popGain = Math.max(0, projectedResidents - currentResidents);
  const canAfford = state.money >= cost;
  if (state.totalPopulation < CONDO_CONVERSION_CONFIG.megaCondoMinPopulation) {
    return {
      eligible: false,
      canConvert: false,
      canAfford,
      targetLevel: 4,
      targetLabel: 'Mega Condomínio 2×2 (Nv. 4)',
      cost,
      currentResidents,
      projectedResidents,
      popGain,
      reason: `Requer ${CONDO_CONVERSION_CONFIG.megaCondoMinPopulation.toLocaleString('pt-BR')} hab.`,
    };
  }
  const slot = findSkyscraper2x2SlotForTile(state, anchor);
  if (!slot) {
    return {
      eligible: false,
      canConvert: false,
      canAfford,
      targetLevel: 4,
      targetLabel: 'Mega Condomínio 2×2 (Nv. 4)',
      cost,
      currentResidents,
      projectedResidents,
      popGain,
      reason: 'Sem espaço livre de quadra 2×2 ao lado',
    };
  }
  if (!isAdjacentToWideAvenue2x2(state, slot.ax, slot.ay, 2, 2)) {
    return {
      eligible: false,
      canConvert: false,
      canAfford,
      targetLevel: 4,
      targetLabel: 'Mega Condomínio 2×2 (Nv. 4)',
      cost,
      currentResidents,
      projectedResidents,
      popGain,
      reason: 'Arranha-céu 2×2 exige Avenida Larga (2×2) em um dos lados',
    };
  }
  return {
    eligible: true,
    canConvert: canAfford,
    canAfford,
    targetLevel: 4,
    targetLabel: 'Mega Condomínio 2×2 (Nv. 4)',
    cost,
    currentResidents,
    projectedResidents,
    popGain,
    reason: canAfford ? undefined : `Caixa insuficiente ($${cost.toLocaleString('pt-BR')})`,
  };
}

/** Convert a selected Prédio Médio (Nv. 2) into a Condomínio (Nv. 3) or Condomínio (Nv. 3) into a Mega Condomínio 2×2 (Nv. 4) */
export function convertBuildingToCondo(
  state: CityState,
  tx: number,
  ty: number
): { ok: boolean; reason?: string; cost?: number; targetLabel?: string; newLabel?: string; popGain?: number } {
  const info = getCondoConversionInfo(state, tx, ty);
  if (!info || !info.eligible) {
    return {
      ok: false,
      reason: info?.reason ?? 'Selecione um Prédio Médio (Nv. 2) ou Condomínio (Nv. 3) para converter.',
    };
  }
  if (!info.canConvert) {
    return { ok: false, reason: info.reason ?? 'Conversão indisponível no momento.' };
  }
  const tile = getTile(state, tx, ty);
  if (!tile) return { ok: false, reason: 'Lote inválido.' };
  const anchor = getCompoundAnchorTile(state, tile);
  if (!anchor) return { ok: false, reason: 'Lote inválido.' };

  state.money -= info.cost;

  if (info.targetLevel === 3) {
    const compound = getCompoundTiles(state, anchor);
    for (const ct of compound) {
      ct.level = 3;
      ct.age = 0;
      ct.evolutionProgress = 0;
      ct.upgradeCooldown = GROWTH_CONFIG.upgradeCooldownLv3To4;
      ct.evolveFlash = 1.75;
    }
    state.pendingSounds.push({ type: 'level3' });
    pushNews(
      state,
      `Prédio Médio convertido em Condomínio Residencial (+${info.popGain.toLocaleString('pt-BR')} moradores)!`,
      'good'
    );
  } else {
    const slot = findSkyscraper2x2SlotForTile(state, anchor);
    if (!slot) {
      state.money += info.cost;
      return { ok: false, reason: 'Quadra 2×2 indisponível.' };
    }
    const built = assignCompoundLot(
      state,
      slot.ax,
      slot.ay,
      2,
      2,
      'residential',
      4,
      anchor.variant,
      1.85
    );
    for (const ct of built) {
      ct.upgradeCooldown = GROWTH_CONFIG.upgradeCooldownLv3To4;
    }
    state.pendingSounds.push({ type: 'level3' });
    pushNews(
      state,
      `Mega Condomínio 2×2 inaugurado em ${sanitizeCityName(state.cityName)}!`,
      'milestone'
    );
  }

  recomputeFieldsAndStats(state);
  return {
    ok: true,
    cost: info.cost,
    targetLabel: info.targetLabel,
    newLabel: info.targetLabel,
    popGain: info.popGain,
  };
}

/** Change the External Highway Toll Plaza tariff (Baixa / Média / Alta) */
export function setTollTariff(state: CityState, tariff: TollTariffLevel): boolean {
  if (!state.tollPlaza) {
    state.tollPlaza = createInitialTollPlaza();
  }
  if (!TOLL_TARIFF_CONFIGS[tariff]) return false;
  if (state.tollPlaza.tariff === tariff) return false;
  state.tollPlaza.tariff = tariff;
  const spec = TOLL_TARIFF_CONFIGS[tariff];
  recomputeFieldsAndStats(state);
  if (state.tollPlaza.built) {
    pushNews(
      state,
      `Pedágio ajustado para ${spec.label}: fluxo de visitantes em ${state.tollPlaza.visitorFlowPct}% e receita estimada de $${state.tollPlaza.monthlyRevenue.toLocaleString('pt-BR')}/mês.`,
      tariff === 'high' ? 'warning' : 'info'
    );
  }
  return true;
}

/** Activate a random Economic Cycle or Urban Incident cleanly (used by monthly roller & tests) */
export function triggerRandomEvent(
  state: CityState,
  eventId: EconomicEventId | UrbanIncidentId,
  customMonths?: number
): ActiveCityEvent {
  const spec = RANDOM_EVENT_SPECS[eventId];
  const duration =
    typeof customMonths === 'number' && customMonths > 0
      ? Math.round(customMonths)
      : spec.minMonths +
        Math.floor(nextRandom(state) * (spec.maxMonths - spec.minMonths + 1));

  const evt: ActiveCityEvent = {
    id: spec.id,
    channel: spec.channel,
    title: spec.title,
    summary: spec.summary,
    effectHint: spec.effectHint,
    accentColor: spec.accentColor,
    remainingMonths: duration,
    totalMonths: duration,
    repairCost:
      spec.channel === 'urban'
        ? roundTo10(
            ((spec.baseRepairCost ?? 2400) +
              Math.max(1200, state.financials.revenue.total) * 0.14) *
              DIFFICULTY_CONFIGS[sanitizeDifficulty(state.difficulty)].constructionCostMultiplier,
            100
          )
        : undefined,
  };

  if (spec.channel === 'economic') {
    state.activeEconomicEvent = evt;
    state.economicEventCooldownMonths = duration + 4;
  } else {
    state.activeUrbanIncident = evt;
    state.urbanIncidentCooldownMonths = duration + 4;
    if (eventId === 'severe_storm' && state.weather) {
      state.weather.kind = 'storm';
      state.weather.intensity = 0.92;
      state.weather.nextChangeSec = 26;
    }
  }

  recomputeFieldsAndStats(state);
  pushNews(
    state,
    `${spec.channel === 'economic' ? 'CICLO ECONÔMICO' : 'IMPREVISTO URBANO'}: ${spec.title} (${duration} meses) — ${spec.effectHint}.`,
    eventId === 'economic_boom' ? 'good' : 'warning'
  );
  return evt;
}

/** Pay emergency repair cost to immediately resolve an active Urban Incident (storm / blackout / structural repairs) */
export function resolveUrbanIncident(
  state: CityState
): { ok: boolean; reason?: string; cost?: number; resolvedTitle?: string } {
  const incident = state.activeUrbanIncident;
  if (!incident) {
    return { ok: false, reason: 'Não há nenhum imprevisto urbano ativo no momento.' };
  }
  const cost = Math.max(
    500,
    incident.repairCost ??
      roundTo10(
        (2400 + Math.max(1200, state.financials.revenue.total) * 0.14) *
          DIFFICULTY_CONFIGS[sanitizeDifficulty(state.difficulty)].constructionCostMultiplier,
        100
      )
  );
  if (state.money < cost) {
    return {
      ok: false,
      reason: `Caixa insuficiente (necessário $${cost.toLocaleString('pt-BR')}).`,
    };
  }
  state.money -= cost;
  const resolvedTitle = incident.title;
  state.activeUrbanIncident = null;
  state.urbanIncidentCooldownMonths = Math.max(state.urbanIncidentCooldownMonths ?? 0, 5);
  state.pendingSounds.push({ type: 'emergency' });
  recomputeFieldsAndStats(state);
  pushNews(
    state,
    `Intervenção concluída! "${resolvedTitle}" resolvido imediatamente por $${cost.toLocaleString('pt-BR')}.`,
    'good'
  );
  return { ok: true, cost, resolvedTitle };
}

/** Build the current evolving works & emergencies list based on each line's unlocked tier */
export function getEmergencyOffers(state: CityState): EmergencyOfferView[] {
  const rev = Math.max(1200, state.financials.revenue.total);
  const eventMods = getActiveEventModifiers(state);
  const costMult =
    DIFFICULTY_CONFIGS[sanitizeDifficulty(state.difficulty)].constructionCostMultiplier *
    eventMods.expenseMult;

  const offers: EmergencyOfferView[] = [];

  // Prepend contextual Emergency Intervention card whenever an Urban Incident is active!
  if (state.activeUrbanIncident) {
    const inc = state.activeUrbanIncident;
    const repairCost = Math.max(
      500,
      inc.repairCost ??
        roundTo10(
          (2400 + rev * 0.14) *
            DIFFICULTY_CONFIGS[sanitizeDifficulty(state.difficulty)].constructionCostMultiplier,
          100
        )
    );
    offers.push({
      id: 'incident_response',
      tier: 1,
      tierLabel: `Urgência · ${inc.remainingMonths}m`,
      title: `Conter ${inc.title}`,
      summary: `${inc.summary} Acione equipes emergenciais para normalizar a cidade agora mesmo.`,
      effectHint: `Encerra imediatamente "${inc.title}" e restaura serviços e receita`,
      nextEvolutionHint: 'Disponível enquanto houver um imprevisto urbano ativo',
      cost: repairCost,
      durationMonths: 0,
      accentColor: inc.accentColor,
      unlocked: true,
    });
  }

  for (const line of EMERGENCY_LINES) {
    const curTier = Math.max(1, Math.min(line.tiers.length, state.workTiers[line.id] ?? 1));
    const spec = line.tiers[curTier - 1];
    const nextSpec = line.tiers[curTier];
    const cost = roundTo10((spec.baseCost + rev * spec.revScalePct) * costMult, 100);
    const minPop = spec.minPopulation ?? 0;
    const alreadyBuiltToll = line.id === 'toll_plaza_project' && Boolean(state.tollPlaza?.built);
    const activeWork = (state.pendingWorks ?? []).find((w) => w.actionId === line.id);
    const inProgress = Boolean(activeWork);
    const unlocked = !alreadyBuiltToll && !inProgress && state.totalPopulation >= minPop;

    offers.push({
      id: line.id,
      tier: activeWork ? activeWork.tier : curTier,
      tierLabel: alreadyBuiltToll ? 'Construído' : inProgress ? 'Em Obra' : spec.tierLabel,
      title: activeWork ? activeWork.title : spec.title,
      summary: spec.summary,
      effectHint: spec.effectHint,
      nextEvolutionHint: alreadyBuiltToll
        ? 'Praça de Pedágio ativa na rodovia externa — ajuste a tarifa em Finanças ou clicando no pedágio.'
        : nextSpec
          ? `Próxima evolução: ${nextSpec.tierLabel} — ${nextSpec.title}`
          : line.id === 'toll_plaza_project'
            ? 'Obra única na rodovia de entrada · Tarifa ajustável (Baixa / Média / Alta)'
            : 'Nível máximo atingido (obra repetível de alto impacto)',
      cost,
      durationMonths: activeWork ? activeWork.totalMonths : spec.durationMonths,
      accentColor: line.accentColor,
      unlocked,
      inProgress,
      remainingMonths: activeWork?.remainingMonths,
      totalMonths: activeWork?.totalMonths,
      lockReason: alreadyBuiltToll
        ? 'Pedágio já construído (ajuste a tarifa em Finanças)'
        : activeWork
          ? `Obra em andamento (${activeWork.remainingMonths} ${activeWork.remainingMonths === 1 ? 'mês restante' : 'meses restantes'})`
          : unlocked
            ? undefined
            : `Requer ${minPop.toLocaleString('pt-BR')} habitantes`,
    });
  }

  return offers;
}

/** Build 4-direction adjacent land expansion purchase status */
export function getLandExpansions(state: CityState): LandExpansionStatus[] {
  const totalExpansions =
    state.expansions.norte +
    state.expansions.leste +
    state.expansions.sul +
    state.expansions.oeste;
  const rev = Math.max(1200, state.financials.revenue.total);
  const eventMods = getActiveEventModifiers(state);
  const costMult =
    DIFFICULTY_CONFIGS[sanitizeDifficulty(state.difficulty)].constructionCostMultiplier *
    eventMods.expenseMult;
  const cost = roundTo10(
    (LAND_EXPAND_BASE_COST * (1 + totalExpansions * 0.45) + rev * 0.28) * costMult,
    200
  );

  return EXPAND_DIRECTIONS.map(({ dir, label }) => {
    const done = state.expansions[dir] ?? 0;
    return {
      direction: dir,
      label,
      expansionsDone: done,
      maxExpansions: MAX_EXPANSIONS_PER_SIDE,
      cost,
      canExpand: done < MAX_EXPANSIONS_PER_SIDE,
    };
  });
}

/**
 * Buy adjacent land strip (+8 tiles) in any of the 4 cardinal directions (`norte`, `leste`, `sul`, `oeste`).
 * Seamless grass, forests, and river continuation with clean entity coordinate shifting!
 */
export function expandCityLand(
  state: CityState,
  direction: ExpandDirection,
  cars?: CarEntity[],
  boats?: BoatEntity[],
  particles?: ParticleEntity[]
): { ok: boolean; reason?: string; cost?: number } {
  const offers = getLandExpansions(state);
  const offer = offers.find((o) => o.direction === direction);
  if (!offer) return { ok: false, reason: 'Direção inválida.' };

  if (!offer.canExpand) {
    return {
      ok: false,
      reason: `Limite máximo de expansão ao ${offer.label} atingido.`,
    };
  }

  if (state.money < offer.cost) {
    return {
      ok: false,
      reason: `Caixa insuficiente (necessário $${offer.cost.toLocaleString('pt-BR')}).`,
    };
  }

  state.money -= offer.cost;

  const oldW = state.gridWidth;
  const oldH = state.gridHeight;
  const addW = direction === 'leste' || direction === 'oeste' ? LAND_EXPAND_CHUNK : 0;
  const addH = direction === 'norte' || direction === 'sul' ? LAND_EXPAND_CHUNK : 0;
  const shiftX = direction === 'oeste' ? LAND_EXPAND_CHUNK : 0;
  const shiftY = direction === 'norte' ? LAND_EXPAND_CHUNK : 0;
  const newW = oldW + addW;
  const newH = oldH + addH;

  // Detect river tiles touching the old edge so we can extend the river seamlessly!
  const edgeWaterCoords: number[] = [];
  if (direction === 'norte') {
    for (let x = 0; x < oldW; x++) {
      const t = state.tiles[x];
      if (t.type === 'water' || t.type === 'bridge') edgeWaterCoords.push(x);
    }
  } else if (direction === 'sul') {
    for (let x = 0; x < oldW; x++) {
      const t = state.tiles[(oldH - 1) * oldW + x];
      if (t.type === 'water' || t.type === 'bridge') edgeWaterCoords.push(x);
    }
  } else if (direction === 'oeste') {
    for (let y = 0; y < oldH; y++) {
      const t = state.tiles[y * oldW];
      if (t.type === 'water' || t.type === 'bridge') edgeWaterCoords.push(y);
    }
  } else if (direction === 'leste') {
    for (let y = 0; y < oldH; y++) {
      const t = state.tiles[y * oldW + (oldW - 1)];
      if (t.type === 'water' || t.type === 'bridge') edgeWaterCoords.push(y);
    }
  }

  const newTiles: Tile[] = new Array(newW * newH);
  for (let y = 0; y < newH; y++) {
    for (let x = 0; x < newW; x++) {
      newTiles[y * newW + x] = {
        x,
        y,
        type: 'grass',
        level: 0,
        variant: Math.floor(nextRandom(state) * 4),
        pollution: 0,
        landValue: 30,
        age: 0,
        evolveFlash: 0,
      };
    }
  }

  // Copy existing tiles into shifted positions
  for (let y = 0; y < oldH; y++) {
    for (let x = 0; x < oldW; x++) {
      const src = state.tiles[y * oldW + x];
      const nx = x + shiftX;
      const ny = y + shiftY;
      src.x = nx;
      src.y = ny;
      newTiles[ny * newW + nx] = src;
    }
  }

  // Seamlessly continue river if it crossed the expanded border, with organic width variation (2..8 tiles max)
  if (edgeWaterCoords.length > 0) {
    const avgCoord =
      edgeWaterCoords.reduce((sum, v) => sum + v, 0) / edgeWaterCoords.length;
    const baseEdgeWidth = Math.max(2, Math.min(8, edgeWaterCoords.length));
    const curvePhase = nextRandom(state) * Math.PI * 2;

    if (direction === 'norte' || direction === 'sul') {
      for (let step = 0; step < LAND_EXPAND_CHUNK; step++) {
        const y = direction === 'norte' ? shiftY - 1 - step : oldH + step;
        const drift = Math.sin((step + 1) * 0.35 + curvePhase) * 1.4;
        const waveDelta = Math.round(
          Math.sin((step + 1) * 0.45 + curvePhase) * 1.8 +
            Math.cos((step + 1) * 0.22) * 0.9
        );
        const sliceWidthTiles = Math.max(2, Math.min(8, baseEdgeWidth + waveDelta));
        const halfSpan = (sliceWidthTiles - 1) * 0.5;
        const center = Math.max(
          2 + halfSpan,
          Math.min(newW - 3 - halfSpan, avgCoord + shiftX + drift)
        );
        let startX = Math.round(center - halfSpan);
        let endX = startX + sliceWidthTiles - 1;
        if (startX < 1) {
          startX = 1;
          endX = Math.min(newW - 2, startX + sliceWidthTiles - 1);
        }
        if (endX > newW - 2) {
          endX = newW - 2;
          startX = Math.max(1, endX - sliceWidthTiles + 1);
        }
        for (let x = startX; x <= endX; x++) {
          newTiles[y * newW + x].type = 'water';
        }
      }
    } else {
      for (let step = 0; step < LAND_EXPAND_CHUNK; step++) {
        const x = direction === 'oeste' ? shiftX - 1 - step : oldW + step;
        const drift = Math.sin((step + 1) * 0.35 + curvePhase) * 1.4;
        const waveDelta = Math.round(
          Math.sin((step + 1) * 0.45 + curvePhase) * 1.8 +
            Math.cos((step + 1) * 0.22) * 0.9
        );
        const sliceWidthTiles = Math.max(2, Math.min(8, baseEdgeWidth + waveDelta));
        const halfSpan = (sliceWidthTiles - 1) * 0.5;
        const center = Math.max(
          2 + halfSpan,
          Math.min(newH - 3 - halfSpan, avgCoord + shiftY + drift)
        );
        let startY = Math.round(center - halfSpan);
        let endY = startY + sliceWidthTiles - 1;
        if (startY < 1) {
          startY = 1;
          endY = Math.min(newH - 2, startY + sliceWidthTiles - 1);
        }
        if (endY > newH - 2) {
          endY = newH - 2;
          startY = Math.max(1, endY - sliceWidthTiles + 1);
        }
        for (let y = startY; y <= endY; y++) {
          newTiles[y * newW + x].type = 'water';
        }
      }
    }
  }

  // Populate organic forest groves on the newly purchased land strip
  const minX = direction === 'leste' ? oldW : 0;
  const maxX = direction === 'oeste' ? LAND_EXPAND_CHUNK - 1 : newW - 1;
  const minY = direction === 'sul' ? oldH : 0;
  const maxY = direction === 'norte' ? LAND_EXPAND_CHUNK - 1 : newH - 1;
  const stripGroves = 3 + Math.floor(nextRandom(state) * 3);

  for (let g = 0; g < stripGroves; g++) {
    const gx = minX + nextRandom(state) * Math.max(1, maxX - minX);
    const gy = minY + nextRandom(state) * Math.max(1, maxY - minY);
    const radius = 2.1 + nextRandom(state) * 2.6;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const t = newTiles[y * newW + x];
        if (t.type !== 'grass') continue;
        const d = Math.hypot(x - gx, y - gy);
        if (d < radius && nextRandom(state) < 0.72 - (d / radius) * 0.4) {
          t.type = 'forest';
          t.variant = Math.floor(nextRandom(state) * 4);
        }
      }
    }
  }

  // Subtle celebratory flash along the new frontier border
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const t = newTiles[y * newW + x];
      if (t.type !== 'water' && nextRandom(state) < 0.25) {
        t.evolveFlash = 0.75;
      }
    }
  }

  state.tiles = newTiles;
  state.gridWidth = newW;
  state.gridHeight = newH;
  state.gridSize = Math.max(newW, newH);
  state.roadOriginX =
    (typeof state.roadOriginX === 'number' ? state.roadOriginX : Math.floor(oldW / 2) - 1) +
    shiftX;
  state.roadOriginY =
    (typeof state.roadOriginY === 'number' ? state.roadOriginY : Math.floor(oldH / 2) - 1) +
    shiftY;
  if (state.externalHighway) {
    state.externalHighway.borderX += shiftX;
    state.externalHighway.borderY += shiftY;
    state.externalHighway.tollX += shiftX;
    state.externalHighway.tollY += shiftY;
  }
  state.expansions[direction] = (state.expansions[direction] ?? 0) + 1;
  state.mapVersion += 1;

  // Always extend the permanent External Highway out to the newly expanded outer map border
  ensureExternalHighwayConnected(state, state.externalHighway?.edge);
  reconcileRoadHierarchy(state);

  // Shift live entity coordinates and pending work coordinates smoothly if expanding North or West
  if (shiftX !== 0 || shiftY !== 0) {
    if (state.pendingWorks) {
      for (const w of state.pendingWorks) {
        if (typeof w.anchorX === 'number') w.anchorX += shiftX;
        if (typeof w.anchorY === 'number') w.anchorY += shiftY;
        if (w.targetCoords) {
          for (const c of w.targetCoords) {
            c.x += shiftX;
            c.y += shiftY;
          }
        }
      }
    }
    if (cars) {
      for (const c of cars) {
        c.x += shiftX;
        c.y += shiftY;
        c.fromX += shiftX;
        c.fromY += shiftY;
        c.toX += shiftX;
        c.toY += shiftY;
      }
    }
    if (boats) {
      for (const b of boats) {
        b.x += shiftX;
        b.y += shiftY;
        b.fromX += shiftX;
        b.fromY += shiftY;
        b.toX += shiftX;
        b.toY += shiftY;
      }
    }
    if (particles) {
      for (const p of particles) {
        if (!p.active) continue;
        p.x += shiftX;
        p.y += shiftY;
      }
    }
  }

  state.pendingSounds.push({ type: 'milestone' });
  pushNews(
    state,
    `Território expandido ao ${offer.label}! Novo mapa: ${newW}×${newH} lotes e rodovia externa estendida até a nova fronteira.`,
    'milestone'
  );
  recomputeFieldsAndStats(state);
  return { ok: true, cost: offer.cost };
}

/** Upgrade up to `count` residential/commercial buildings by 1 level (respecting manual condo policy for residential) */
function upgradeTopBuildings(
  state: CityState,
  count: number,
  preferType?: 'residential' | 'commercial'
): number {
  const resCap = state.condoPolicy === 'auto' ? 3 : 2;
  const candidates = state.tiles
    .filter(
      (t) =>
        (t.type === 'residential' || t.type === 'commercial') &&
        t.lotRole !== 'part' &&
        !t.construction &&
        !t.establishmentId &&
        t.level < (t.type === 'residential' ? resCap : 3) &&
        (!preferType || t.type === preferType)
    )
    .map((t) => {
      const mat = getNeighborhoodMaturity(state, t.x, t.y);
      // Prioritize lower-level lagging peers inside dense filled neighborhoods so blocks grow together!
      const score =
        (3 - t.level) * 2.4 +
        mat.fillRatio * 1.8 +
        (t.level === 2 && mat.avgLevel >= 1.55 ? 0.6 : 0) +
        nextRandom(state) * 0.45;
      return { tile: t, mat, score };
    })
    .filter(({ tile, mat }) => {
      // Enforce hybrid 12×12 neighborhood rule & 10k population milestone for Large Buildings (Lv. 3)
      if (!mat.region12AllLevel1) return false;
      if (
        tile.level === 2 &&
        state.totalPopulation < URBAN_MATURITY_CONFIG.largeBuildingMinPopulation
      ) {
        return false;
      }
      if (tile.level === 2 && mat.fillRatio < 0.42 && mat.builtLots < 4) {
        return false;
      }
      return true;
    })
    .sort((a, b) => b.score - a.score);

  let upgraded = 0;
  for (let i = 0; i < count && i < candidates.length; i++) {
    const target = candidates[i].tile;
    const cap = target.type === 'residential' ? resCap : 3;
    const nextLv = Math.min(cap, target.level + 1);
    for (const ct of getCompoundTiles(state, target)) {
      ct.level = nextLv;
      ct.age = 0;
      ct.evolutionProgress = 0;
      ct.upgradeCooldown =
        nextLv >= 2 ? GROWTH_CONFIG.upgradeCooldownLv2To3 : GROWTH_CONFIG.upgradeCooldownLv1To2;
      ct.evolveFlash = 1.75;
    }
    upgraded++;
  }
  return upgraded;
}

/** Lay up to `count` immediate planned road tiles (prioritizing Avenidas, Estradas & Trevos) and optionally force a bridge over water */
function buildImmediateRoads(
  state: CityState,
  roadCount: number,
  tryBridge: boolean = false
): { roadsLaid: number; builtBridge: boolean } {
  let roadsLaid = 0;
  let builtBridge = false;

  if (tryBridge) {
    // Prefer building bridges along planned arterial corridors (Avenidas / Estradas)
    const bridgeCandidates: Array<{ road: Tile; dx: number; dy: number; priority: number }> = [];
    for (const t of state.tiles) {
      if (t.type !== 'road') continue;
      const plan = classifyPlannedRoadCell(state, t.x, t.y);
      for (const [dx, dy] of ORTHO_DIRS) {
        const adj = getTile(state, t.x + dx, t.y + dy);
        if (adj && adj.type === 'water') {
          const prio = plan.onHighwayAxis ? 3 : plan.onAvenueAxis ? 2 : 1;
          bridgeCandidates.push({ road: t, dx, dy, priority: prio });
        }
      }
    }
    bridgeCandidates.sort((a, b) => b.priority - a.priority);
    for (const cand of bridgeCandidates) {
      if (tryBuildBridgeFrom(state, cand.road, cand.dx, cand.dy)) {
        builtBridge = true;
        break;
      }
    }
  }

  for (let pass = 0; pass < 4 && roadsLaid < roadCount; pass++) {
    const candidates: Array<{ target: Tile; level: 1 | 2 | 3; priority: number }> = [];
    const seen = new Set<number>();

    for (const t of state.tiles) {
      if (!isRoadLike(t.type)) continue;
      for (const [dx, dy] of ORTHO_DIRS) {
        const target = getTile(state, t.x + dx, t.y + dy);
        if (!target) continue;
        if (target.x <= 0 || target.y <= 0 || target.x >= state.gridWidth - 1 || target.y >= state.gridHeight - 1) {
          continue;
        }
        const key = target.y * state.gridWidth + target.x;
        if (seen.has(key)) continue;
        if (target.type !== 'grass' && target.type !== 'forest') continue;
        if (wouldCreateRoadBlob(state, target.x, target.y)) continue;

        const plan = classifyPlannedRoadCell(state, target.x, target.y);
        if (!plan.isPlanned) continue;

        seen.add(key);
        const behind = getTile(state, t.x - dx, t.y - dy);
        const straight = behind && isRoadLike(behind.type) ? 1.5 : 0;
        const prio =
          (plan.isArterialCross ? 6 : 0) +
          (plan.onHighwayAxis ? 4 : plan.onAvenueAxis ? 3 : 1) +
          straight;
        candidates.push({ target, level: plan.corridorLevel, priority: prio });
      }
    }

    if (candidates.length === 0) break;
    candidates.sort((a, b) => b.priority - a.priority);

    for (const c of candidates) {
      if (roadsLaid >= roadCount) break;
      if (c.target.type !== 'grass' && c.target.type !== 'forest') continue;
      if (wouldCreateRoadBlob(state, c.target.x, c.target.y)) continue;
      c.target.type = 'road';
      c.target.level = c.level;
      c.target.age = 0;
      c.target.evolveFlash = 1.2;
      roadsLaid++;
    }
  }

  if (roadsLaid > 0 || builtBridge) {
    reconcileRoadHierarchy(state);
  }

  return { roadsLaid, builtBridge };
}

/** Plant up to `count` parks near roads */
function plantImmediateParks(state: CityState, count: number): number {
  const openSlots: Tile[] = [];
  for (const t of state.tiles) {
    if (
      (t.type === 'grass' || t.type === 'forest') &&
      !t.construction &&
      getOrthoNeighbors(state, t.x, t.y).some((nt) => nt.type === 'road')
    ) {
      openSlots.push(t);
    }
  }
  let planted = 0;
  for (let i = 0; i < count && openSlots.length > 0; i++) {
    const idx = Math.floor(nextRandom(state) * openSlots.length);
    const target = openSlots.splice(idx, 1)[0];
    target.type = 'park';
    target.level = 1;
    target.age = 0;
    target.evolveFlash = 1.75;
    planted++;
  }
  return planted;
}

/** Place a specific establishment (e.g. Centro Esportivo Pequeno or Parque de Diversões) on the best road-connected lot */
function placeSpecificEstablishmentOnBestSlot(
  state: CityState,
  establishmentId: EstablishmentId,
  forceOverwriteLowLevel: boolean = true
): boolean {
  const spec = ESTABLISHMENT_MAP[establishmentId];
  if (!spec) return false;
  const mainRoadSet = getMainConnectedRoadSet(state);
  const candidates: Array<{ x: number; y: number; score: number }> = [];

  for (let y = 1; y <= state.gridHeight - spec.footprintH - 1; y++) {
    for (let x = 1; x <= state.gridWidth - spec.footprintW - 1; x++) {
      let ok = true;
      let touchesRoad = false;
      let overwritePenalty = 0;

      for (let dy = 0; dy < spec.footprintH && ok; dy++) {
        for (let dx = 0; dx < spec.footprintW; dx++) {
          const t = getTile(state, x + dx, y + dy);
          if (!t) {
            ok = false;
            break;
          }
          if (
            isExternalBorderRoadTile(state, t.x, t.y) ||
            isTollPlazaTile(state, t.x, t.y) ||
            classifyPlannedRoadCell(state, t.x, t.y).isPlanned
          ) {
            ok = false;
            break;
          }
          if (t.type === 'grass' || t.type === 'forest') {
            // ideal
          } else if (
            forceOverwriteLowLevel &&
            !t.establishmentId &&
            (t.type === 'rural' ||
              t.type === 'abandoned' ||
              t.type === 'park' ||
              ((t.type === 'residential' || t.type === 'commercial') && t.level <= 1))
          ) {
            overwritePenalty += 3;
          } else {
            ok = false;
            break;
          }
          if (
            getOrthoNeighbors(state, t.x, t.y).some(
              (n) => isRoadLike(n.type) && mainRoadSet.has(n.y * state.gridWidth + n.x)
            )
          ) {
            touchesRoad = true;
          }
        }
      }
      if (!ok || !touchesRoad) continue;
      const distCenter = Math.hypot(
        x - state.gridWidth / 2,
        y - state.gridHeight / 2
      );
      candidates.push({ x, y, score: 40 - distCenter - overwritePenalty });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const variation = pickEstablishmentVariation(state, establishmentId);
  for (const cand of candidates) {
    if (
      tryPlaceEstablishmentFootprint(
        state,
        cand.x,
        cand.y,
        spec,
        spec.hostLevel,
        variation,
        false
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Find the best rectangular slot for a construction project without mutating tiles yet.
 * Works for Airport (`4×10` / `8×16`), Shopping (`6×6` / `8×8` / `9×9`), Stadium (`4×3`),
 * Port (`2×2` / `2×4`), and multi-tile Establishments (`sports_court`, `amusement_park`).
 */
function clearObstructionAndReserveTile(
  state: CityState,
  t: Tile,
  keepExistingTypes: TileType[],
  meta: TileConstructionMeta
): boolean {
  let clearedRoad = false;
  const keepExisting = keepExistingTypes.includes(t.type);
  if (!keepExisting && t.type !== 'grass' && t.type !== 'forest' && t.type !== 'water') {
    if (t.type === 'road') {
      clearedRoad = true;
    }
    if ((t.lotWidth ?? 1) > 1 || (t.lotHeight ?? 1) > 1) {
      for (const ct of getCompoundTiles(state, t)) {
        resetTileToGrass(ct, 0.3);
      }
    } else {
      resetTileToGrass(t, 0.3);
    }
  }
  t.construction = meta;
  t.evolveFlash = 0.9;
  return clearedRoad;
}

function reserveCompoundConstructionRect(
  state: CityState,
  ax: number,
  ay: number,
  fw: number,
  fh: number,
  work: PendingConstructionWork,
  targetType: TileType,
  targetLevel: number,
  keepExistingTypes: TileType[],
  targetEstablishmentId?: EstablishmentId
): void {
  const coords: Array<{ x: number; y: number }> = [];
  let clearedRoad = false;
  for (let dy = 0; dy < fh; dy++) {
    for (let dx = 0; dx < fw; dx++) {
      const t = getTile(state, ax + dx, ay + dy);
      if (!t) continue;
      coords.push({ x: t.x, y: t.y });
      const isUpgrade = keepExistingTypes.includes(t.type);
      const didClearRoad = clearObstructionAndReserveTile(state, t, keepExistingTypes, {
        workId: work.id,
        actionId: work.actionId,
        title: work.title,
        targetType,
        targetLevel,
        targetEstablishmentId,
        isUpgrade,
        lotWidth: fw,
        lotHeight: fh,
        lotDx: dx,
        lotDy: dy,
        totalMonths: work.totalMonths,
        remainingMonths: work.remainingMonths,
      });
      if (didClearRoad) clearedRoad = true;
    }
  }
  work.anchorX = ax;
  work.anchorY = ay;
  work.lotWidth = fw;
  work.lotHeight = fh;
  work.targetType = targetType;
  work.targetLevel = targetLevel;
  work.targetEstablishmentId = targetEstablishmentId;
  work.targetCoords = coords;
  if (clearedRoad) {
    reconcileRoadHierarchy(state);
  }
}

function findBestEstablishmentRect(
  state: CityState,
  establishmentId: EstablishmentId,
  forceOverwriteLowLevel: boolean = true
): { x: number; y: number; fw: number; fh: number } | null {
  const spec = ESTABLISHMENT_MAP[establishmentId];
  if (!spec) return null;
  const mainRoadSet = getMainConnectedRoadSet(state);
  const candidates: Array<{ x: number; y: number; score: number }> = [];

  for (let y = 1; y <= state.gridHeight - spec.footprintH - 1; y++) {
    for (let x = 1; x <= state.gridWidth - spec.footprintW - 1; x++) {
      if (!canPlaceEstablishmentAt(state, establishmentId, x, y)) continue;
      let ok = true;
      let touchesRoad = false;
      let overwritePenalty = 0;

      for (let dy = 0; dy < spec.footprintH && ok; dy++) {
        for (let dx = 0; dx < spec.footprintW; dx++) {
          const t = getTile(state, x + dx, y + dy);
          if (
            !t ||
            t.construction ||
            t.type === 'water' ||
            t.type === 'bridge' ||
            isLandmarkType(t.type) ||
            isTransitStationType(t.type)
          ) {
            ok = false;
            break;
          }
          if (
            isExternalBorderRoadTile(state, t.x, t.y) ||
            isTollPlazaTile(state, t.x, t.y) ||
            classifyPlannedRoadCell(state, t.x, t.y).isPlanned
          ) {
            ok = false;
            break;
          }
          if (t.type === 'grass' || t.type === 'forest') {
            // ideal
          } else if (
            forceOverwriteLowLevel &&
            !t.establishmentId &&
            (t.type === 'rural' ||
              t.type === 'abandoned' ||
              t.type === 'park' ||
              ((t.type === 'residential' || t.type === 'commercial') && t.level <= 1))
          ) {
            overwritePenalty += 3;
          } else {
            ok = false;
            break;
          }
          if (
            getOrthoNeighbors(state, t.x, t.y).some(
              (n) => isRoadLike(n.type) && mainRoadSet.has(n.y * state.gridWidth + n.x)
            )
          ) {
            touchesRoad = true;
          }
        }
      }
      if (!ok || !touchesRoad) continue;
      const distCenter = Math.hypot(x - state.gridWidth / 2, y - state.gridHeight / 2);
      candidates.push({ x, y, score: 40 - distCenter - overwritePenalty });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return { x: candidates[0].x, y: candidates[0].y, fw: spec.footprintW, fh: spec.footprintH };
}

function findBestStadiumRect(
  state: CityState,
  force: boolean = true
): { x: number; y: number; fw: number; fh: number } | null {
  const cx = typeof state.roadOriginX === 'number' ? state.roadOriginX : state.gridWidth / 2;
  const cy = typeof state.roadOriginY === 'number' ? state.roadOriginY : state.gridHeight / 2;
  const stadiumSpec = ESTABLISHMENT_MAP.soccer_stadium;
  const orientations: Array<[number, number]> = [
    [stadiumSpec.footprintW, stadiumSpec.footprintH],
    [stadiumSpec.footprintH, stadiumSpec.footprintW],
  ];

  for (const allowAvenueCross of force ? [false, true] : [false]) {
    for (const [fw, fh] of orientations) {
      const candidates: Array<{ x: number; y: number; score: number }> = [];
      for (let y = 1; y <= state.gridHeight - fh - 1; y++) {
        for (let x = 1; x <= state.gridWidth - fw - 1; x++) {
          if (!canPlaceEstablishmentAt(state, 'soccer_stadium', x, y)) continue;
          let valid = true;
          let demolishedBuildings = 0;
          let demolishedRoads = 0;
          let touchesRoad = false;

          for (let dy = 0; dy < fh && valid; dy++) {
            for (let dx = 0; dx < fw; dx++) {
              const qt = getTile(state, x + dx, y + dy);
              if (
                !qt ||
                qt.construction ||
                qt.type === 'water' ||
                qt.type === 'bridge' ||
                isLandmarkType(qt.type) ||
                qt.establishmentId
              ) {
                valid = false;
                break;
              }
              const plan = classifyPlannedRoadCell(state, qt.x, qt.y);
              if (!allowAvenueCross && (plan.onAvenueAxis || plan.onHighwayAxis)) {
                valid = false;
                break;
              }
              if (qt.type === 'road') {
                demolishedRoads++;
              } else if (qt.type !== 'grass' && qt.type !== 'forest') {
                if (!force && qt.level >= 2) {
                  valid = false;
                  break;
                }
                demolishedBuildings++;
              }
              for (const nb of getOrthoNeighbors(state, qt.x, qt.y)) {
                const outside = nb.x < x || nb.x >= x + fw || nb.y < y || nb.y >= y + fh;
                if (outside && isRoadLike(nb.type)) touchesRoad = true;
              }
            }
          }
          if (!valid || (!touchesRoad && !force)) continue;
          const distFromCore = Math.hypot(x + fw * 0.5 - cx, y + fh * 0.5 - cy);
          const score =
            (touchesRoad ? 16 : 0) -
            Math.abs(distFromCore - 6.5) * 2.2 -
            demolishedBuildings * 8 -
            demolishedRoads * 14;
          candidates.push({ x, y, score });
        }
      }
      if (candidates.length > 0) {
        candidates.sort((a, b) => b.score - a.score);
        return { x: candidates[0].x, y: candidates[0].y, fw, fh };
      }
    }
  }
  return null;
}

function findBestAirportReservationRect(
  state: CityState,
  targetLevel: number
): { x: number; y: number; fw: number; fh: number; existingAnchor: Tile | null } | null {
  const clampedLevel = Math.max(1, Math.min(3, targetLevel)) as 1 | 2 | 3;
  const { w, h } = AIRPORT_FOOTPRINT_BY_LEVEL[clampedLevel];
  const cx = typeof state.roadOriginX === 'number' ? state.roadOriginX : state.gridWidth / 2;
  const cy = typeof state.roadOriginY === 'number' ? state.roadOriginY : state.gridHeight / 2;
  const existingAirportTiles = state.tiles.filter((t) => t.type === 'airport');
  const existingAnchor =
    existingAirportTiles.find((t) => t.lotRole === 'anchor') ?? existingAirportTiles[0] ?? null;

  if (
    existingAnchor &&
    (existingAnchor.lotWidth ?? 1) >= w &&
    (existingAnchor.lotHeight ?? 1) >= h &&
    existingAirportTiles.length >= w * h
  ) {
    return {
      x: existingAnchor.x,
      y: existingAnchor.y,
      fw: existingAnchor.lotWidth ?? w,
      fh: existingAnchor.lotHeight ?? h,
      existingAnchor,
    };
  }

  const mainRoadSet = getMainConnectedRoadSet(state);
  const searchRects = () => {
    const out: Array<{ x: number; y: number; score: number }> = [];
    const maxX = state.gridWidth - w - 1;
    const maxY = state.gridHeight - h - 1;
    for (let y = 1; y <= maxY; y++) {
      for (let x = 1; x <= maxX; x++) {
        let valid = true;
        let overlapAirport = 0;
        let demolishedBuildings = 0;
        let demolishedHighLv = 0;
        let demolishedRoads = 0;

        for (let dy = 0; dy < h && valid; dy++) {
          for (let dx = 0; dx < w; dx++) {
            const qt = state.tiles[(y + dy) * state.gridWidth + (x + dx)];
            if (
              !qt ||
              qt.construction ||
              qt.type === 'water' ||
              qt.type === 'bridge' ||
              qt.type === 'port' ||
              qt.type === 'stadium'
            ) {
              valid = false;
              break;
            }
            if (qt.type === 'airport') overlapAirport++;
            else if (qt.type === 'road') demolishedRoads++;
            else if (isBuildingType(qt.type)) {
              demolishedBuildings++;
              if (qt.level >= 2 || qt.establishmentId) demolishedHighLv++;
            }
          }
        }
        if (!valid) continue;

        let touchesMainRoad = false;
        let touchesAnyRoad = false;
        for (let dx = 0; dx < w && !touchesMainRoad; dx++) {
          for (const nb of [getTile(state, x + dx, y - 1), getTile(state, x + dx, y + h)]) {
            if (nb && isRoadLike(nb.type)) {
              touchesAnyRoad = true;
              if (mainRoadSet.has(nb.y * state.gridWidth + nb.x)) touchesMainRoad = true;
            }
          }
        }
        for (let dy = 0; dy < h && !touchesMainRoad; dy++) {
          for (const nb of [getTile(state, x - 1, y + dy), getTile(state, x + w, y + dy)]) {
            if (nb && isRoadLike(nb.type)) {
              touchesAnyRoad = true;
              if (mainRoadSet.has(nb.y * state.gridWidth + nb.x)) touchesMainRoad = true;
            }
          }
        }
        const dist = existingAnchor
          ? Math.hypot(x - existingAnchor.x, y - existingAnchor.y)
          : Math.hypot(x + w * 0.5 - cx, y + h * 0.5 - cy);
        const score = existingAnchor
          ? overlapAirport * 30 -
            dist * 20 -
            demolishedBuildings * 8 -
            demolishedHighLv * 14 -
            demolishedRoads * 22 +
            (touchesMainRoad ? 28 : touchesAnyRoad ? 12 : 0)
          : dist * 3.5 -
            demolishedBuildings * 12 -
            demolishedHighLv * 25 -
            demolishedRoads * 32 +
            (touchesMainRoad ? 26 : touchesAnyRoad ? 10 : 0);
        out.push({ x, y, score });
      }
    }
    return out;
  };

  let candidates = searchRects();
  for (let expAttempt = 0; expAttempt < 2 && candidates.length === 0; expAttempt++) {
    let northWater = 0;
    let southWater = 0;
    let westWater = 0;
    let eastWater = 0;
    for (const t of state.tiles) {
      if (t.type !== 'water') continue;
      if (t.y < state.gridHeight / 2) northWater++;
      else southWater++;
      if (t.x < state.gridWidth / 2) westWater++;
      else eastWater++;
    }
    const vertDirs: ExpandDirection[] =
      northWater <= southWater ? ['norte', 'sul'] : ['sul', 'norte'];
    const horizDirs: ExpandDirection[] =
      westWater <= eastWater ? ['oeste', 'leste'] : ['leste', 'oeste'];
    const prefDirs: ExpandDirection[] =
      h >= w ? [...vertDirs, ...horizDirs] : [...horizDirs, ...vertDirs];
    const offers = getLandExpansions(state);
    const chosenOffer = prefDirs
      .map((d) => offers.find((o) => o.direction === d))
      .find((o) => o && o.canExpand);
    if (!chosenOffer) break;
    state.money += chosenOffer.cost;
    expandCityLand(state, chosenOffer.direction);
    candidates = searchRects();
  }
  if (candidates.length === 0) {
    return existingAnchor
      ? {
          x: existingAnchor.x,
          y: existingAnchor.y,
          fw: existingAnchor.lotWidth ?? 4,
          fh: existingAnchor.lotHeight ?? 10,
          existingAnchor,
        }
      : null;
  }
  candidates.sort((a, b) => b.score - a.score);
  return { x: candidates[0].x, y: candidates[0].y, fw: w, fh: h, existingAnchor };
}

function findBestShoppingReservationRect(
  state: CityState,
  targetLevel: number
): { x: number; y: number; fw: number; fh: number; existingAnchor: Tile | null } | null {
  const clampedLevel = Math.max(1, Math.min(3, targetLevel)) as 1 | 2 | 3;
  const { w, h } = SHOPPING_FOOTPRINT_BY_LEVEL[clampedLevel];
  const cx = typeof state.roadOriginX === 'number' ? state.roadOriginX : state.gridWidth / 2;
  const cy = typeof state.roadOriginY === 'number' ? state.roadOriginY : state.gridHeight / 2;
  const existingShoppingTiles = state.tiles.filter((t) => t.type === 'shopping');
  const existingAnchor =
    existingShoppingTiles.find((t) => t.lotRole === 'anchor') ?? existingShoppingTiles[0] ?? null;

  if (
    existingAnchor &&
    (existingAnchor.lotWidth ?? 1) >= w &&
    (existingAnchor.lotHeight ?? 1) >= h &&
    existingShoppingTiles.length >= w * h
  ) {
    return {
      x: existingAnchor.x,
      y: existingAnchor.y,
      fw: existingAnchor.lotWidth ?? w,
      fh: existingAnchor.lotHeight ?? h,
      existingAnchor,
    };
  }

  const mainRoadSet = getMainConnectedRoadSet(state);
  const searchRects = () => {
    const out: Array<{ x: number; y: number; score: number }> = [];
    const maxX = state.gridWidth - w - 1;
    const maxY = state.gridHeight - h - 1;
    for (let y = 1; y <= maxY; y++) {
      for (let x = 1; x <= maxX; x++) {
        let valid = true;
        let overlapShopping = 0;
        let demolishedBuildings = 0;
        let demolishedHighLv = 0;
        let demolishedRoads = 0;

        for (let dy = 0; dy < h && valid; dy++) {
          for (let dx = 0; dx < w; dx++) {
            const qt = state.tiles[(y + dy) * state.gridWidth + (x + dx)];
            if (
              !qt ||
              qt.construction ||
              qt.type === 'water' ||
              qt.type === 'bridge' ||
              qt.type === 'port' ||
              qt.type === 'airport' ||
              qt.type === 'stadium' ||
              isExternalBorderRoadTile(state, qt.x, qt.y) ||
              isTollPlazaTile(state, qt.x, qt.y)
            ) {
              valid = false;
              break;
            }
            if (qt.type === 'shopping') overlapShopping++;
            else if (qt.type === 'road') demolishedRoads++;
            else if (isBuildingType(qt.type)) {
              demolishedBuildings++;
              if (qt.level >= 3 || qt.establishmentId) demolishedHighLv++;
            }
          }
        }
        if (!valid) continue;

        let touchesMainRoad = false;
        let touchesWideAvenue = false;
        let touchesAnyRoad = false;
        for (let dx = 0; dx < w; dx++) {
          for (const nb of [getTile(state, x + dx, y - 1), getTile(state, x + dx, y + h)]) {
            if (nb && isRoadLike(nb.type)) {
              touchesAnyRoad = true;
              if (mainRoadSet.has(nb.y * state.gridWidth + nb.x)) touchesMainRoad = true;
              if (nb.type === 'road' && nb.level === 2 && nb.variant === 2) touchesWideAvenue = true;
            }
          }
        }
        for (let dy = 0; dy < h; dy++) {
          for (const nb of [getTile(state, x - 1, y + dy), getTile(state, x + w, y + dy)]) {
            if (nb && isRoadLike(nb.type)) {
              touchesAnyRoad = true;
              if (mainRoadSet.has(nb.y * state.gridWidth + nb.x)) touchesMainRoad = true;
              if (nb.type === 'road' && nb.level === 2 && nb.variant === 2) touchesWideAvenue = true;
            }
          }
        }

        let score = 0;
        if (existingAnchor) {
          const distFromOld = Math.hypot(x - existingAnchor.x, y - existingAnchor.y);
          score =
            overlapShopping * 36 -
            distFromOld * 24 -
            demolishedBuildings * 7 -
            demolishedHighLv * 16 -
            demolishedRoads * 18 +
            (touchesWideAvenue ? 18 : 0) +
            (touchesMainRoad ? 28 : touchesAnyRoad ? 12 : 0);
        } else {
          const distFromCore = Math.hypot(x + w * 0.5 - cx, y + h * 0.5 - cy);
          const district = getNeighborhoodDistrict(state, Math.round(x + w * 0.5), Math.round(y + h * 0.5));
          const districtBonus = district === 'commercial' ? 22 : district === 'residential' ? 10 : -8;
          score =
            40 -
            Math.abs(distFromCore - 6) * 2.2 +
            districtBonus +
            (touchesWideAvenue ? 20 : 0) +
            (touchesMainRoad ? 28 : touchesAnyRoad ? 12 : 0) -
            demolishedBuildings * 9 -
            demolishedHighLv * 22 -
            demolishedRoads * 24;
        }
        out.push({ x, y, score });
      }
    }
    return out;
  };

  let candidates = searchRects();
  for (let expAttempt = 0; expAttempt < 2 && candidates.length === 0; expAttempt++) {
    const offers = getLandExpansions(state);
    const chosenOffer = offers.find((o) => o.canExpand);
    if (!chosenOffer) break;
    state.money += chosenOffer.cost;
    expandCityLand(state, chosenOffer.direction);
    candidates = searchRects();
  }
  if (candidates.length === 0) {
    return existingAnchor
      ? {
          x: existingAnchor.x,
          y: existingAnchor.y,
          fw: existingAnchor.lotWidth ?? 6,
          fh: existingAnchor.lotHeight ?? 6,
          existingAnchor,
        }
      : null;
  }
  candidates.sort((a, b) => b.score - a.score);
  return { x: candidates[0].x, y: candidates[0].y, fw: w, fh: h, existingAnchor };
}

function findBestPortReservationRect(
  state: CityState,
  targetLevel: number
): { x: number; y: number; fw: number; fh: number } | null {
  const clampedLevel = Math.max(1, Math.min(3, targetLevel));
  const openEdgeWater = getBridgeFreeRiverEdgeWaterSet(state);
  const existingPorts = state.tiles.filter((t) => t.type === 'port');
  const oldAnchor = existingPorts.find((t) => t.lotRole !== 'part') ?? existingPorts[0] ?? null;

  const shapes: Array<[number, number]> =
    clampedLevel >= 3
      ? [
          [2, 4],
          [4, 2],
          [2, 3],
          [3, 2],
          [2, 2],
        ]
      : [
          [2, 2],
          [1, 2],
          [2, 1],
          [1, 1],
        ];

  for (const [fw, fh] of shapes) {
    const candidates: Array<{ x: number; y: number; score: number; bridgeFree: boolean }> = [];
    for (let y = 1; y <= state.gridHeight - fh - 1; y++) {
      for (let x = 1; x <= state.gridWidth - fw - 1; x++) {
        let valid = true;
        let touchesWater = 0;
        let touchesBridgeFree = 0;
        let overlapPort = 0;
        let demolishedCost = 0;

        for (let dy = 0; dy < fh && valid; dy++) {
          for (let dx = 0; dx < fw; dx++) {
            const qt = getTile(state, x + dx, y + dy);
            if (
              !qt ||
              qt.construction ||
              qt.type === 'water' ||
              qt.type === 'bridge' ||
              (isLandmarkType(qt.type) && qt.type !== 'port') ||
              qt.establishmentId
            ) {
              valid = false;
              break;
            }
            const plan = classifyPlannedRoadCell(state, qt.x, qt.y);
            if (plan.onAvenueAxis || plan.onHighwayAxis) {
              valid = false;
              break;
            }
            if (qt.type === 'port') {
              overlapPort++;
            } else if (qt.type === 'road') {
              demolishedCost += 12;
            } else if (qt.type !== 'grass' && qt.type !== 'forest') {
              if (qt.level >= 3) {
                valid = false;
                break;
              }
              demolishedCost += qt.level * 8;
            }
            for (const nt of getOrthoNeighbors(state, qt.x, qt.y)) {
              const outside = nt.x < x || nt.x >= x + fw || nt.y < y || nt.y >= y + fh;
              if (!outside) continue;
              if (nt.type === 'water') {
                touchesWater++;
                if (openEdgeWater.has(nt.y * state.gridWidth + nt.x)) touchesBridgeFree++;
              }
            }
          }
        }
        if (!valid || touchesWater === 0) continue;
        const distOld = oldAnchor ? Math.hypot(x - oldAnchor.x, y - oldAnchor.y) : 0;
        const score =
          overlapPort * 28 +
          touchesWater * 18 +
          (touchesBridgeFree > 0 ? 220 : 0) -
          distOld * 20 -
          demolishedCost;
        candidates.push({ x, y, score, bridgeFree: touchesBridgeFree > 0 });
      }
    }
    if (candidates.length === 0) continue;
    const freePool = candidates.filter((c) => c.bridgeFree);
    const pool = freePool.length > 0 ? freePool : candidates;
    pool.sort((a, b) => b.score - a.score);
    return { x: pool[0].x, y: pool[0].y, fw, fh };
  }
  return null;
}

function findTransitStationSlots(
  state: CityState,
  kind: 'bus_station' | 'metro_station',
  count: number = 2
): Tile[] {
  const minSpacing = kind === 'metro_station' ? 7 : 6;
  const mainRoads = getMainConnectedRoadSet(state);
  const existingStations = state.tiles.filter((t) => t.type === kind);
  const chosen: Tile[] = [];

  for (let n = 0; n < count; n++) {
    const existingDistricts = new Set(
      [...existingStations, ...chosen].map((st) => getNeighborhoodDistrict(state, st.x, st.y))
    );
    let best: { tile: Tile; score: number } | null = null;
    for (let i = 0; i < state.tiles.length; i++) {
      const t = state.tiles[i];
      if (t.x <= 1 || t.y <= 1 || t.x >= state.gridWidth - 2 || t.y >= state.gridHeight - 2) {
        continue;
      }
      if (chosen.includes(t)) continue;
      if (classifyPlannedRoadCell(state, t.x, t.y).isPlanned) continue;
      if (t.construction || t.establishmentId || isLandmarkType(t.type) || isTransitStationType(t.type)) {
        continue;
      }
      if ((t.lotWidth ?? 1) > 1 || (t.lotHeight ?? 1) > 1) continue;

      const isReplaceable =
        t.type === 'grass' ||
        t.type === 'forest' ||
        t.type === 'abandoned' ||
        ((t.type === 'rural' || t.type === 'residential' || t.type === 'commercial' || t.type === 'industrial') &&
          (t.level || 1) <= 2);
      if (!isReplaceable) continue;

      const neigh = getOrthoNeighbors(state, t.x, t.y);
      const adjRoads = neigh.filter((nt) => nt.type === 'road' && mainRoads.has(nt.y * state.gridWidth + nt.x));
      if (adjRoads.length === 0) continue;

      let tooClose = false;
      for (const st of [...existingStations, ...chosen]) {
        if (Math.hypot(st.x - t.x, st.y - t.y) < minSpacing) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      const district = getNeighborhoodDistrict(state, t.x, t.y);
      const touchesWideAve = adjRoads.some((r) => isWideAvenue2x2Tile(state, r.x, r.y));
      const touchesAvenue = adjRoads.some((r) => (r.level || 1) >= 2);
      const nearbyPop = countPopulatedNear(state, t.x, t.y, 4);
      let score = nearbyPop * 4 + (touchesWideAve ? 24 : touchesAvenue ? 14 : 4);
      if (!existingDistricts.has(district)) score += 22;
      if (t.type === 'grass' || t.type === 'forest' || t.type === 'abandoned') score += 12;
      else if ((t.level || 1) === 1) score += 5;
      else score -= 4;

      if (!best || score > best.score) best = { tile: t, score };
    }
    if (!best) break;
    chosen.push(best.tile);
  }
  return chosen;
}

function findRoadworkPlanCoords(
  state: CityState,
  roadCount: number,
  tryBridge: boolean = true
): { roadTiles: Tile[]; bridgeWaterTiles: Tile[] } {
  const bridgeWaterTiles: Tile[] = [];
  if (tryBridge) {
    const bridgeCandidates: Array<{ road: Tile; dx: number; dy: number; priority: number }> = [];
    for (const t of state.tiles) {
      if (t.type !== 'road') continue;
      const plan = classifyPlannedRoadCell(state, t.x, t.y);
      for (const [dx, dy] of ORTHO_DIRS) {
        const adj = getTile(state, t.x + dx, t.y + dy);
        if (adj && adj.type === 'water' && !adj.construction) {
          const prio = plan.onHighwayAxis ? 3 : plan.onAvenueAxis ? 2 : 1;
          bridgeCandidates.push({ road: t, dx, dy, priority: prio });
        }
      }
    }
    bridgeCandidates.sort((a, b) => b.priority - a.priority);
    for (const cand of bridgeCandidates) {
      const span: Tile[] = [];
      let cx = cand.road.x + cand.dx;
      let cy = cand.road.y + cand.dy;
      let okSpan = false;
      for (let step = 0; step < 10; step++) {
        const t = getTile(state, cx, cy);
        if (!t || t.construction) break;
        if (t.type === 'water') {
          if (span.length >= 8) break;
          span.push(t);
        } else if (t.type === 'grass' || t.type === 'forest' || isRoadLike(t.type)) {
          if (span.length > 0) {
            let tooClose = false;
            for (const st of span) {
              for (const other of state.tiles) {
                if (other.type !== 'bridge') continue;
                if (Math.abs(other.x - st.x) + Math.abs(other.y - st.y) < MIN_BRIDGE_SPACING_TILES) {
                  tooClose = true;
                  break;
                }
              }
              if (tooClose) break;
            }
            if (!tooClose) okSpan = true;
          }
          break;
        } else {
          break;
        }
        cx += cand.dx;
        cy += cand.dy;
      }
      if (okSpan && span.length > 0) {
        bridgeWaterTiles.push(...span);
        break;
      }
    }
  }

  const roadTiles: Tile[] = [];
  const chosenSet = new Set<number>();
  for (let pass = 0; pass < 4 && roadTiles.length < roadCount; pass++) {
    const candidates: Array<{ target: Tile; priority: number }> = [];
    for (const t of state.tiles) {
      const isSeedRoad = isRoadLike(t.type) || chosenSet.has(t.y * state.gridWidth + t.x);
      if (!isSeedRoad) continue;
      for (const [dx, dy] of ORTHO_DIRS) {
        const target = getTile(state, t.x + dx, t.y + dy);
        if (!target || target.construction) continue;
        if (
          target.x <= 0 ||
          target.y <= 0 ||
          target.x >= state.gridWidth - 1 ||
          target.y >= state.gridHeight - 1
        ) {
          continue;
        }
        const key = target.y * state.gridWidth + target.x;
        if (chosenSet.has(key)) continue;
        if (target.type !== 'grass' && target.type !== 'forest') continue;
        const plan = classifyPlannedRoadCell(state, target.x, target.y);
        if (!plan.isPlanned) continue;
        const behind = getTile(state, t.x - dx, t.y - dy);
        const straight = behind && isRoadLike(behind.type) ? 1.5 : 0;
        const prio =
          (plan.isArterialCross ? 6 : 0) +
          (plan.onHighwayAxis ? 4 : plan.onAvenueAxis ? 3 : 1) +
          straight;
        candidates.push({ target, priority: prio });
      }
    }
    if (candidates.length === 0) break;
    candidates.sort((a, b) => b.priority - a.priority);
    for (const c of candidates) {
      if (roadTiles.length >= roadCount) break;
      const key = c.target.y * state.gridWidth + c.target.x;
      if (chosenSet.has(key)) continue;
      chosenSet.add(key);
      roadTiles.push(c.target);
    }
  }
  return { roadTiles, bridgeWaterTiles };
}

function syncWorkTilesRemainingMonths(state: CityState, work: PendingConstructionWork): void {
  if (work.targetCoords) {
    for (const c of work.targetCoords) {
      const t = getTile(state, c.x, c.y);
      if (t?.construction && t.construction.workId === work.id) {
        t.construction.remainingMonths = Math.max(0, work.remainingMonths);
      }
    }
  }
  for (let i = 0; i < state.tiles.length; i++) {
    const t = state.tiles[i];
    if (t.construction && t.construction.workId === work.id) {
      t.construction.remainingMonths = Math.max(0, work.remainingMonths);
    }
  }
}

function clearWorkTileConstruction(state: CityState, workId: string): void {
  for (let i = 0; i < state.tiles.length; i++) {
    const t = state.tiles[i];
    if (t.construction && t.construction.workId === workId) {
      t.construction = undefined;
    }
  }
}

function canUseReservedRectForLandmark(
  state: CityState,
  ax: number,
  ay: number,
  fw: number,
  fh: number,
  allowedSameType?: TileType
): boolean {
  if (ax < 1 || ay < 1 || ax + fw > state.gridWidth - 1 || ay + fh > state.gridHeight - 1) {
    return false;
  }
  for (let dy = 0; dy < fh; dy++) {
    for (let dx = 0; dx < fw; dx++) {
      const qt = getTile(state, ax + dx, ay + dy);
      if (!qt || qt.construction || qt.type === 'water' || qt.type === 'bridge') return false;
      if (isLandmarkType(qt.type) && qt.type !== allowedSameType) return false;
    }
  }
  return true;
}

/** Finalize a completed multi-month public work when its remainingMonths reaches 0 */
function finalizePendingWork(state: CityState, work: PendingConstructionWork): void {
  clearWorkTileConstruction(state, work.id);

  const actionId = work.actionId;
  const tier = work.tier;

  if (actionId === 'sports_center_project') {
    let built = false;
    if (
      typeof work.anchorX === 'number' &&
      typeof work.anchorY === 'number' &&
      canUseReservedRectForLandmark(
        state,
        work.anchorX,
        work.anchorY,
        work.lotWidth ?? 2,
        work.lotHeight ?? 1
      )
    ) {
      const compound = assignCompoundLot(
        state,
        work.anchorX,
        work.anchorY,
        work.lotWidth ?? 2,
        work.lotHeight ?? 1,
        'commercial',
        ESTABLISHMENT_MAP.sports_court.hostLevel,
        work.variant ?? pickEstablishmentVariation(state, 'sports_court'),
        1.85,
        'sports_court'
      );
      ensureTileConnectedToMainRoad(state, compound);
      state.mapVersion += 1;
      built = compound.length > 0;
    }
    if (!built) {
      built = placeSpecificEstablishmentOnBestSlot(state, 'sports_court', true);
    }
    if (!built) {
      plantImmediateParks(state, 2);
    }
    state.pendingSounds.push({ type: 'milestone' });
    pushNews(
      state,
      `${work.title} concluído e inaugurado! Novo Centro Esportivo Pequeno eleva o lazer nos bairros.`,
      'milestone'
    );
  } else if (actionId === 'bus_transit_project') {
    let placed = 0;
    if (work.targetCoords) {
      for (const c of work.targetCoords) {
        const t = getTile(state, c.x, c.y);
        if (!t || t.construction) continue;
        if (t.type === 'bus_station') {
          if (t.level < tier) t.level = tier;
          t.evolveFlash = 1.75;
        } else if (
          t.type === 'grass' ||
          t.type === 'forest' ||
          t.type === 'abandoned' ||
          ((t.type === 'rural' || t.type === 'residential' || t.type === 'commercial' || t.type === 'industrial') &&
            (t.level || 1) <= 2 &&
            !t.establishmentId)
        ) {
          assignCompoundLot(state, t.x, t.y, 1, 1, 'bus_station', Math.max(1, Math.min(3, tier)), placed % 3, 1.85);
          ensureTileConnectedToMainRoad(state, [t]);
          placed++;
        }
      }
    }
    if (placed === 0) {
      placed = placeTransitStationOnBestSlot(state, 'bus_station', 2, tier);
    }
    for (const t of state.tiles) {
      if (t.type === 'bus_station' && (t.level || 1) < tier) {
        t.level = Math.min(3, tier);
        t.evolveFlash = 1.6;
      }
    }
    if (tier >= 2) {
      tryWidenAvenueNear(state, state.roadOriginX, state.roadOriginY, 8);
    }
    state.mapVersion += 1;
    state.pendingSounds.push({ type: 'milestone' });
    pushNews(
      state,
      `${work.title} concluído! ${placed > 0 ? `${placed} terminais de ônibus` : 'Frota modernizada'} e ônibus urbanos agora circulam pelos bairros.`,
      'milestone'
    );
  } else if (actionId === 'metro_transit_project') {
    let placed = 0;
    if (work.targetCoords) {
      for (const c of work.targetCoords) {
        const t = getTile(state, c.x, c.y);
        if (!t || t.construction) continue;
        if (t.type === 'metro_station') {
          if (t.level < tier) t.level = tier;
          t.evolveFlash = 1.75;
        } else if (
          t.type === 'grass' ||
          t.type === 'forest' ||
          t.type === 'abandoned' ||
          ((t.type === 'rural' || t.type === 'residential' || t.type === 'commercial' || t.type === 'industrial') &&
            (t.level || 1) <= 2 &&
            !t.establishmentId)
        ) {
          assignCompoundLot(state, t.x, t.y, 1, 1, 'metro_station', Math.max(1, Math.min(3, tier)), placed % 3, 1.85);
          ensureTileConnectedToMainRoad(state, [t]);
          placed++;
        }
      }
    }
    if (placed === 0) {
      placed = placeTransitStationOnBestSlot(state, 'metro_station', 2, tier);
    }
    for (const t of state.tiles) {
      if (t.type === 'metro_station' && (t.level || 1) < tier) {
        t.level = Math.min(3, tier);
        t.evolveFlash = 1.6;
      }
    }
    tryWidenAvenueNear(state, state.roadOriginX, state.roadOriginY, 10);
    state.mapVersion += 1;
    state.pendingSounds.push({ type: 'milestone' });
    pushNews(
      state,
      `${work.title} concluído! ${placed > 0 ? `${placed} novas Estações de Metrô` : 'Malha metroviária'} conectam os bairros no subsolo.`,
      'milestone'
    );
  } else if (actionId === 'environmental_cleanup') {
    let planted = 0;
    if (work.targetCoords) {
      for (const c of work.targetCoords) {
        const t = getTile(state, c.x, c.y);
        if (t && !t.construction && (t.type === 'grass' || t.type === 'forest')) {
          t.type = 'park';
          t.level = 1;
          t.age = 0;
          t.evolveFlash = 1.8;
          planted++;
        }
      }
    }
    const targetParks = tier * 2;
    if (planted < targetParks) {
      planted += plantImmediateParks(state, targetParks - planted);
    }
    state.pendingSounds.push({ type: 'milestone' });
    pushNews(
      state,
      `${work.title} concluído! ${planted} novos parques entregues à cidade.`,
      'good'
    );
  } else if (actionId === 'revitalization') {
    let recovered = 0;
    if (work.targetCoords) {
      for (const c of work.targetCoords) {
        const t = getTile(state, c.x, c.y);
        if (t && t.type === 'abandoned') {
          t.type = t.previousType ?? 'residential';
          t.level = tier >= 2 && t.type !== 'industrial' ? 2 : 1;
          t.age = 0;
          t.evolveFlash = 1.85;
          recovered++;
        }
      }
    }
    if (recovered === 0) {
      const abandonedTiles = state.tiles.filter((t) => t.type === 'abandoned' && !t.construction);
      const maxRestore = tier >= 3 ? abandonedTiles.length : tier === 2 ? 10 : 6;
      for (let i = 0; i < Math.min(maxRestore, abandonedTiles.length); i++) {
        const t = abandonedTiles[i];
        t.type = t.previousType ?? 'residential';
        t.level = tier >= 2 && t.type !== 'industrial' ? 2 : 1;
        t.age = 0;
        t.evolveFlash = 1.85;
        recovered++;
      }
    }
    const upgraded = tier >= 3 ? upgradeTopBuildings(state, tier === 4 ? 4 : 2) : 0;
    state.pendingSounds.push({ type: 'milestone' });
    pushNews(
      state,
      `${work.title} concluída! ${recovered} imóveis recuperados${upgraded > 0 ? ` e ${upgraded} modernizados` : ''}!`,
      'good'
    );
  } else if (actionId === 'tourism_festival') {
    if (tier >= 2 && state.totalPopulation >= 20000 && state.stats.stadiumCount === 0) {
      state.breakthroughCharge.entertainment = Math.min(
        100,
        state.breakthroughCharge.entertainment + 30
      );
    }
    const upgraded = tier >= 3 ? upgradeTopBuildings(state, tier === 4 ? 4 : 2, 'commercial') : 0;
    state.pendingSounds.push({ type: 'milestone' });
    pushNews(
      state,
      `${work.title} encerrado com sucesso! Legado turístico consolidado${upgraded > 0 ? ` (${upgraded} comércios modernizados)` : ''}!`,
      'milestone'
    );
  } else if (actionId === 'emergency_roadworks') {
    const roadTargets = [4, 6, 8, 10][tier - 1] ?? 8;
    let roadsLaid = 0;
    let builtBridge = false;

    if (work.targetCoords && work.targetCoords.length > 0) {
      const bridgeSpan: Tile[] = [];
      for (const c of work.targetCoords) {
        const t = getTile(state, c.x, c.y);
        if (!t || t.construction) continue;
        if (t.type === 'water') {
          bridgeSpan.push(t);
        } else if (t.type === 'grass' || t.type === 'forest') {
          const plan = classifyPlannedRoadCell(state, t.x, t.y);
          t.type = 'road';
          t.level = plan.corridorLevel;
          t.age = 0;
          t.evolveFlash = 1.6;
          roadsLaid++;
        }
      }
      if (bridgeSpan.length > 0) {
        const bridgeLv = getCurrentBridgeLevel(state);
        for (const wt of bridgeSpan) {
          wt.type = 'bridge';
          wt.level = bridgeLv;
          wt.variant = bridgeLv >= 2 || bridgeSpan.length >= 4 ? 1 : 0;
          wt.age = 0;
          wt.evolveFlash = 1.5;
        }
        builtBridge = true;
      }
    }
    if (roadsLaid < roadTargets || !builtBridge) {
      const extra = buildImmediateRoads(
        state,
        Math.max(0, roadTargets - roadsLaid),
        !builtBridge
      );
      roadsLaid += extra.roadsLaid;
      builtBridge = builtBridge || extra.builtBridge;
    }

    const wideAvenueAdded =
      tier >= 2 ? tryWidenAvenueNear(state, state.roadOriginX, state.roadOriginY, 10) : 0;
    const targetBridgeLv =
      tier >= 4 && state.totalPopulation >= 22000
        ? 4
        : tier >= 3 && state.totalPopulation >= 12000
          ? 3
          : tier >= 2 && state.totalPopulation >= 3500
            ? 2
            : 1;
    const bridgesUpgraded =
      targetBridgeLv >= 2 ? upgradeAllBridges(state, targetBridgeLv) : 0;
    if (tier >= 3) {
      upgradeTopBuildings(state, tier === 4 ? 3 : 2);
    }
    reconcileRoadHierarchy(state);
    state.mapVersion += 1;
    const wideAveMsg = wideAvenueAdded > 0 ? ' + Avenida Larga 2×2' : '';
    const bridgeMsg =
      bridgesUpgraded > 0
        ? targetBridgeLv >= 4
          ? ' e pontes alargadas para Megaponte de 2 Espaços (Nv. 4)'
          : ` e pontes evoluídas para Nv. ${targetBridgeLv}`
        : '';
    state.pendingSounds.push({ type: bridgesUpgraded > 0 || builtBridge ? 'bridge' : 'milestone' });
    pushNews(
      state,
      `${work.title} concluída! ${roadsLaid} vias entregues${wideAveMsg}${bridgeMsg}!`,
      'milestone'
    );
  } else if (actionId === 'port_evolution') {
    const targetPortLv = Math.max(1, Math.min(3, tier));
    if (tier === 1) {
      let placed: Tile | null = null;
      if (
        typeof work.anchorX === 'number' &&
        typeof work.anchorY === 'number' &&
        canUseReservedRectForLandmark(
          state,
          work.anchorX,
          work.anchorY,
          work.lotWidth ?? 2,
          work.lotHeight ?? 2,
          'port'
        )
      ) {
        const compound = assignCompoundLot(
          state,
          work.anchorX,
          work.anchorY,
          work.lotWidth ?? 2,
          work.lotHeight ?? 2,
          'port',
          1,
          work.variant ?? 0,
          1.75
        );
        ensureTileConnectedToMainRoad(state, compound);
        state.mapVersion += 1;
        placed = compound[0] ?? null;
      }
      if (!placed) {
        placed = placePortOnRiverfront(state, true, 1);
      }
      if (!placed) {
        upgradeExistingLandmarks(state, 'port', 2);
      }
      state.pendingSounds.push({ type: 'bridge' });
      pushNews(
        state,
        'Porto Fluvial concluído e integrado às rotas de navegação!',
        'milestone'
      );
    } else if (tier === 2) {
      const count = upgradeExistingLandmarks(state, 'port', 2);
      if (count === 0) {
        placePortOnRiverfront(state, true, 2);
      }
      state.pendingSounds.push({ type: 'bridge' });
      pushNews(
        state,
        'Porto evoluído para Nível 2! Navio cargueiro e pátio de contêineres em operação.',
        'milestone'
      );
    } else if (tier === 3) {
      if (
        typeof work.anchorX === 'number' &&
        typeof work.anchorY === 'number' &&
        canUseReservedRectForLandmark(
          state,
          work.anchorX,
          work.anchorY,
          work.lotWidth ?? 2,
          work.lotHeight ?? 4,
          'port'
        )
      ) {
        for (const oldP of state.tiles) {
          if (
            oldP.type === 'port' &&
            (oldP.x < work.anchorX ||
              oldP.x >= work.anchorX + (work.lotWidth ?? 2) ||
              oldP.y < work.anchorY ||
              oldP.y >= work.anchorY + (work.lotHeight ?? 4))
          ) {
            resetTileToGrass(oldP, 0.5);
          }
        }
        const compound = assignCompoundLot(
          state,
          work.anchorX,
          work.anchorY,
          work.lotWidth ?? 2,
          work.lotHeight ?? 4,
          'port',
          3,
          work.variant ?? 0,
          1.75
        );
        ensureTileConnectedToMainRoad(state, compound);
        state.mapVersion += 1;
      } else {
        upgradeExistingLandmarks(state, 'port', 3);
        if (getCruisePortNavigationInfo(state).targetPortAnchor === null) {
          placePortOnRiverfront(state, true, 3);
        }
      }
      state.pendingSounds.push({ type: 'bridge' });
      pushNews(
        state,
        'Terminal Internacional de Cruzeiros 2×4 (Nv. 3) concluído em trecho fluvial livre de pontes!',
        'milestone'
      );
    } else {
      upgradeExistingLandmarks(state, 'port', targetPortLv);
      upgradeTopBuildings(state, 3, 'commercial');
      state.pendingSounds.push({ type: 'milestone' });
      pushNews(
        state,
        'Zona Franca & Hub Marítimo Global concluídos! Comércio exterior em capacidade máxima!',
        'milestone'
      );
    }
  } else if (actionId === 'airport_evolution') {
    const targetAirLv = Math.max(1, Math.min(3, tier)) as 1 | 2 | 3;
    const { w, h } = AIRPORT_FOOTPRINT_BY_LEVEL[targetAirLv];
    let placed: Tile | null = null;
    if (
      typeof work.anchorX === 'number' &&
      typeof work.anchorY === 'number' &&
      canUseReservedRectForLandmark(
        state,
        work.anchorX,
        work.anchorY,
        work.lotWidth ?? w,
        work.lotHeight ?? h,
        'airport'
      )
    ) {
      for (const oldA of state.tiles) {
        if (
          oldA.type === 'airport' &&
          (oldA.x < work.anchorX ||
            oldA.x >= work.anchorX + (work.lotWidth ?? w) ||
            oldA.y < work.anchorY ||
            oldA.y >= work.anchorY + (work.lotHeight ?? h))
        ) {
          resetTileToGrass(oldA, 0.5);
        }
      }
      const compound = assignCompoundLot(
        state,
        work.anchorX,
        work.anchorY,
        work.lotWidth ?? w,
        work.lotHeight ?? h,
        'airport',
        targetAirLv,
        work.variant ?? 0,
        1.85
      );
      ensureTileConnectedToMainRoad(state, compound);
      state.mapVersion += 1;
      placed = compound[0] ?? null;
    }
    if (!placed) {
      if (tier === 1) {
        placed = placeLandmarkOnBestSlot(state, 'airport', true, 1);
        if (!placed) upgradeExistingLandmarks(state, 'airport', 2);
      } else {
        const count = upgradeExistingLandmarks(state, 'airport', targetAirLv);
        if (count === 0) placeLandmarkOnBestSlot(state, 'airport', true, targetAirLv);
      }
    }
    if (tier >= 4) {
      upgradeTopBuildings(state, 4);
    }
    state.pendingSounds.push({ type: 'milestone' });
    pushNews(
      state,
      tier === 1
        ? `Complexo Aeroportuário ${work.lotWidth ?? 4}×${work.lotHeight ?? 10} (Nv. 1) concluído e aberto para pousos e decolagens!`
        : tier === 2
          ? 'Aeroporto evoluído para Médio 8×16 (Nv. 2)! Torre ATC com radar e terminal de vidro em operação!'
          : tier === 3
            ? 'Aeroporto Grande Internacional (Nv. 3) concluído! Rotas intercontinentais ativas!'
            : 'Megahub Aeroespacial & Ponte Aérea Mundial concluídos! Pixópolis conectada ao planeta!',
      'milestone'
    );
  } else if (actionId === 'shopping_evolution') {
    const targetShopLv = Math.max(1, Math.min(3, tier)) as 1 | 2 | 3;
    const { w, h } = SHOPPING_FOOTPRINT_BY_LEVEL[targetShopLv];
    let placed: Tile | null = null;
    if (
      typeof work.anchorX === 'number' &&
      typeof work.anchorY === 'number' &&
      canUseReservedRectForLandmark(
        state,
        work.anchorX,
        work.anchorY,
        work.lotWidth ?? w,
        work.lotHeight ?? h,
        'shopping'
      )
    ) {
      for (const oldS of state.tiles) {
        if (
          oldS.type === 'shopping' &&
          (oldS.x < work.anchorX ||
            oldS.x >= work.anchorX + (work.lotWidth ?? w) ||
            oldS.y < work.anchorY ||
            oldS.y >= work.anchorY + (work.lotHeight ?? h))
        ) {
          resetTileToGrass(oldS, 0.5);
        }
      }
      const compound = assignCompoundLot(
        state,
        work.anchorX,
        work.anchorY,
        work.lotWidth ?? w,
        work.lotHeight ?? h,
        'shopping',
        targetShopLv,
        work.variant ?? 0,
        1.85
      );
      ensureTileConnectedToMainRoad(state, compound);
      state.mapVersion += 1;
      placed = compound[0] ?? null;
    }
    if (!placed) {
      placeOrExpandShoppingComplex(state, targetShopLv, true);
    }
    if (tier >= 2) {
      upgradeTopBuildings(state, tier === 3 ? 3 : 2, 'commercial');
    }
    state.pendingSounds.push({ type: 'milestone' });
    const sizeLabel =
      targetShopLv === 3
        ? 'Shopping Grande 9×9 (Grand Megamall · Nv. 3)'
        : targetShopLv === 2
          ? 'Shopping Médio 8×8 (Metropolitano · Nv. 2)'
          : 'Shopping Pequeno 6×6 (Galleria Regional · Nv. 1)';
    pushNews(
      state,
      `${sizeLabel} concluído e inaugurado com conexão viária e praça comercial!`,
      'milestone'
    );
  } else if (actionId === 'landmark_project') {
    if (tier === 1) {
      let built = false;
      if (
        typeof work.anchorX === 'number' &&
        typeof work.anchorY === 'number' &&
        canUseReservedRectForLandmark(
          state,
          work.anchorX,
          work.anchorY,
          work.lotWidth ?? 4,
          work.lotHeight ?? 3
        )
      ) {
        const compound = assignCompoundLot(
          state,
          work.anchorX,
          work.anchorY,
          work.lotWidth ?? 4,
          work.lotHeight ?? 3,
          'stadium',
          1,
          work.variant ?? 0,
          1.85,
          'soccer_stadium'
        );
        ensureTileConnectedToMainRoad(state, compound);
        state.mapVersion += 1;
        built = compound.length > 0;
      }
      if (!built) placeLandmarkOnBestSlot(state, 'stadium', true, 1);
      state.pendingSounds.push({ type: 'milestone' });
      pushNews(
        state,
        `Estádio de Futebol ${work.lotWidth ?? 4}×${work.lotHeight ?? 3} concluído! Esporte e lazer elevam a felicidade da cidade!`,
        'milestone'
      );
    } else if (tier === 2) {
      let built = false;
      if (
        typeof work.anchorX === 'number' &&
        typeof work.anchorY === 'number' &&
        canUseReservedRectForLandmark(
          state,
          work.anchorX,
          work.anchorY,
          work.lotWidth ?? 3,
          work.lotHeight ?? 3
        )
      ) {
        const compound = assignCompoundLot(
          state,
          work.anchorX,
          work.anchorY,
          work.lotWidth ?? 3,
          work.lotHeight ?? 3,
          'park',
          ESTABLISHMENT_MAP.amusement_park.hostLevel,
          work.variant ?? 0,
          1.85,
          'amusement_park'
        );
        ensureTileConnectedToMainRoad(state, compound);
        state.mapVersion += 1;
        built = compound.length > 0;
      }
      if (!built) {
        built = placeSpecificEstablishmentOnBestSlot(state, 'amusement_park', true);
      }
      if (!built) {
        plantImmediateParks(state, 3);
      }
      state.pendingSounds.push({ type: 'milestone' });
      pushNews(
        state,
        'Grande Parque de Diversões concluído e inaugurado! Fluxo de visitantes e turismo disparam!',
        'milestone'
      );
    } else {
      if (state.stats.stadiumCount < 2) {
        if (
          typeof work.anchorX === 'number' &&
          typeof work.anchorY === 'number' &&
          canUseReservedRectForLandmark(
            state,
            work.anchorX,
            work.anchorY,
            work.lotWidth ?? 4,
            work.lotHeight ?? 3
          )
        ) {
          const compound = assignCompoundLot(
            state,
            work.anchorX,
            work.anchorY,
            work.lotWidth ?? 4,
            work.lotHeight ?? 3,
            'stadium',
            1,
            work.variant ?? 0,
            1.85,
            'soccer_stadium'
          );
          ensureTileConnectedToMainRoad(state, compound);
          state.mapVersion += 1;
        } else {
          placeLandmarkOnBestSlot(state, 'stadium', true, 1);
        }
      }
      upgradeTopBuildings(state, 4);
      state.pendingSounds.push({ type: 'milestone' });
      pushNews(
        state,
        'Distrito Metropolitano & Arena Global concluídos! Grande salto econômico e urbano!',
        'milestone'
      );
    }
  }

  // Advance work line tier ONLY upon true project completion!
  const lineSpec = EMERGENCY_LINES.find((l) => l.id === actionId);
  const maxTier = lineSpec ? lineSpec.tiers.length : 4;
  const currentTier = state.workTiers[actionId] ?? 1;
  state.workTiers[actionId] = Math.min(maxTier, Math.max(currentTier, tier + 1));
}

/** Execute one of the progressive evolving Emergency / Landmark Works */
export function executeEmergencyAction(
  state: CityState,
  actionId: EmergencyActionId
): { ok: boolean; reason?: string; executedTitle?: string; evolvedToTier?: number } {
  if (actionId === 'incident_response') {
    const res = resolveUrbanIncident(state);
    return {
      ok: res.ok,
      reason: res.reason,
      executedTitle: res.resolvedTitle ? `Conter ${res.resolvedTitle}` : undefined,
      evolvedToTier: 1,
    };
  }

  if (!Array.isArray(state.pendingWorks)) {
    state.pendingWorks = [];
  }

  const offers = getEmergencyOffers(state);
  const offer = offers.find((o) => o.id === actionId);
  if (!offer) return { ok: false, reason: 'Ação inválida.' };

  if (!offer.unlocked) {
    return { ok: false, reason: offer.lockReason ?? 'Obra ainda bloqueada.' };
  }

  if (state.money < offer.cost) {
    return {
      ok: false,
      reason: `Caixa insuficiente (necessário $${offer.cost.toLocaleString('pt-BR')}).`,
    };
  }

  if (actionId === 'revitalization' && offer.tier <= 2 && state.stats.abandonedCount === 0) {
    return {
      ok: false,
      reason: 'Não há prédios abandonados na cidade no momento.',
    };
  }

  state.money -= offer.cost;
  const tier = offer.tier;

  const upsertBoost = (label: string, months: number) => {
    if (months <= 0) return;
    const existing = state.activeBoosts.find((b) => b.actionId === actionId);
    if (existing) {
      existing.remainingMonths = Math.max(existing.remainingMonths, months);
      existing.totalMonths = Math.max(existing.totalMonths ?? months, existing.remainingMonths);
      existing.tier = Math.max(existing.tier, tier);
      existing.label = label;
    } else {
      state.activeBoosts.push({
        id: `${actionId}_${state.tick}`,
        actionId,
        label,
        tier,
        remainingMonths: months,
        totalMonths: months,
      });
    }
  };

  // Immediate project (0 durationMonths): Toll Plaza
  if (offer.durationMonths <= 1 || actionId === 'toll_plaza_project') {
    if (actionId === 'toll_plaza_project') {
      ensureExternalHighwayConnected(state, state.externalHighway?.edge);
      if (!state.tollPlaza) {
        state.tollPlaza = createInitialTollPlaza();
      }
      state.tollPlaza.built = true;
      state.tollPlaza.tariff = state.tollPlaza.tariff ?? 'medium';
      const tollTile = state.externalHighway
        ? getTile(state, state.externalHighway.tollX, state.externalHighway.tollY)
        : null;
      if (tollTile) {
        tollTile.evolveFlash = 1.8;
      }
      reconcileRoadHierarchy(state);
      pushNews(
        state,
        'Praça de Pedágio inaugurada na Rodovia Externa! Ajuste a tarifa (Baixa, Média ou Alta) em Finanças ou clicando no pedágio.',
        'milestone'
      );
    }

    const lineSpec = EMERGENCY_LINES.find((l) => l.id === actionId);
    const maxTier = lineSpec ? lineSpec.tiers.length : 4;
    const nextTier = Math.min(maxTier, tier + 1);
    state.workTiers[actionId] = nextTier;
    state.pendingSounds.push({ type: 'emergency' });
    recomputeFieldsAndStats(state);
    return {
      ok: true,
      executedTitle: offer.title,
      evolvedToTier: nextTier,
    };
  }

  // Multi-month public work: reserve lot(s)/construction site on the map and deliver upon real completion!
  const work: PendingConstructionWork = {
    id: `work_${actionId}_${state.tick}_${Math.floor(nextRandom(state) * 10000)}`,
    actionId,
    tier,
    title: offer.title,
    totalMonths: offer.durationMonths,
    remainingMonths: offer.durationMonths,
  };

  if (actionId === 'sports_center_project') {
    const slot = findBestEstablishmentRect(state, 'sports_court', true);
    work.variant = pickEstablishmentVariation(state, 'sports_court');
    if (slot) {
      reserveCompoundConstructionRect(
        state,
        slot.x,
        slot.y,
        slot.fw,
        slot.fh,
        work,
        'commercial',
        ESTABLISHMENT_MAP.sports_court.hostLevel,
        [],
        'sports_court'
      );
    }
    pushNews(
      state,
      `Canteiro de obras aberto: ${offer.title} (${offer.durationMonths} meses para conclusão).`,
      'info'
    );
  } else if (actionId === 'bus_transit_project') {
    const slots = findTransitStationSlots(state, 'bus_station', 2);
    const existingStations = state.tiles.filter((t) => t.type === 'bus_station' && !t.construction);
    const coords: Array<{ x: number; y: number }> = [];
    for (const s of slots) {
      clearObstructionAndReserveTile(state, s, [], {
        workId: work.id,
        actionId,
        title: offer.title,
        targetType: 'bus_station',
        targetLevel: tier,
        isUpgrade: false,
        lotWidth: 1,
        lotHeight: 1,
        lotDx: 0,
        lotDy: 0,
        totalMonths: work.totalMonths,
        remainingMonths: work.remainingMonths,
      });
      coords.push({ x: s.x, y: s.y });
    }
    for (const st of existingStations) {
      if ((st.level || 1) < tier && !st.construction) {
        st.construction = {
          workId: work.id,
          actionId,
          title: offer.title,
          targetType: 'bus_station',
          targetLevel: tier,
          isUpgrade: true,
          lotWidth: 1,
          lotHeight: 1,
          lotDx: 0,
          lotDy: 0,
          totalMonths: work.totalMonths,
          remainingMonths: work.remainingMonths,
        };
        coords.push({ x: st.x, y: st.y });
      }
    }
    work.targetCoords = coords;
    work.targetType = 'bus_station';
    work.targetLevel = tier;
    pushNews(
      state,
      `Obras iniciadas: ${offer.title} (${offer.durationMonths} meses para entrega dos terminais).`,
      'info'
    );
  } else if (actionId === 'metro_transit_project') {
    const slots = findTransitStationSlots(state, 'metro_station', 2);
    const existingStations = state.tiles.filter((t) => t.type === 'metro_station' && !t.construction);
    const coords: Array<{ x: number; y: number }> = [];
    for (const s of slots) {
      clearObstructionAndReserveTile(state, s, [], {
        workId: work.id,
        actionId,
        title: offer.title,
        targetType: 'metro_station',
        targetLevel: tier,
        isUpgrade: false,
        lotWidth: 1,
        lotHeight: 1,
        lotDx: 0,
        lotDy: 0,
        totalMonths: work.totalMonths,
        remainingMonths: work.remainingMonths,
      });
      coords.push({ x: s.x, y: s.y });
    }
    for (const st of existingStations) {
      if ((st.level || 1) < tier && !st.construction) {
        st.construction = {
          workId: work.id,
          actionId,
          title: offer.title,
          targetType: 'metro_station',
          targetLevel: tier,
          isUpgrade: true,
          lotWidth: 1,
          lotHeight: 1,
          lotDx: 0,
          lotDy: 0,
          totalMonths: work.totalMonths,
          remainingMonths: work.remainingMonths,
        };
        coords.push({ x: st.x, y: st.y });
      }
    }
    work.targetCoords = coords;
    work.targetType = 'metro_station';
    work.targetLevel = tier;
    pushNews(
      state,
      `Escavações iniciadas: ${offer.title} (${offer.durationMonths} meses para conclusão).`,
      'info'
    );
  } else if (actionId === 'environmental_cleanup') {
    // Explicit ongoing environmental cleanup crew buff + reserved park slots completed at term end
    upsertBoost(offer.title, offer.durationMonths);
    const parkTargets = tier * 2;
    const openSlots: Tile[] = [];
    for (const t of state.tiles) {
      if (
        (t.type === 'grass' || t.type === 'forest') &&
        !t.construction &&
        getOrthoNeighbors(state, t.x, t.y).some((nt) => nt.type === 'road')
      ) {
        openSlots.push(t);
      }
    }
    const coords: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < parkTargets && openSlots.length > 0; i++) {
      const idx = Math.floor(nextRandom(state) * openSlots.length);
      const slot = openSlots.splice(idx, 1)[0];
      slot.construction = {
        workId: work.id,
        actionId,
        title: offer.title,
        targetType: 'park',
        targetLevel: 1,
        isUpgrade: false,
        lotWidth: 1,
        lotHeight: 1,
        lotDx: 0,
        lotDy: 0,
        totalMonths: work.totalMonths,
        remainingMonths: work.remainingMonths,
      };
      slot.evolveFlash = 0.85;
      coords.push({ x: slot.x, y: slot.y });
    }
    work.targetCoords = coords;
    work.targetType = 'park';
    pushNews(
      state,
      `${offer.title} em execução! Equipes despoluem o ar e preparam ${parkTargets} parques (${offer.durationMonths} meses).`,
      'good'
    );
  } else if (actionId === 'revitalization') {
    // Explicit ongoing anti-abandonment shield + multi-month restoration scaffolds on abandoned buildings
    upsertBoost(offer.title, offer.durationMonths);
    const abandonedTiles = state.tiles.filter((t) => t.type === 'abandoned' && !t.construction);
    const maxRestore = tier >= 3 ? abandonedTiles.length : tier === 2 ? 10 : 6;
    const coords: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < Math.min(maxRestore, abandonedTiles.length); i++) {
      const t = abandonedTiles[i];
      t.construction = {
        workId: work.id,
        actionId,
        title: offer.title,
        targetType: t.previousType ?? 'residential',
        targetLevel: tier >= 2 ? 2 : 1,
        isUpgrade: true,
        lotWidth: 1,
        lotHeight: 1,
        lotDx: 0,
        lotDy: 0,
        totalMonths: work.totalMonths,
        remainingMonths: work.remainingMonths,
      };
      t.evolveFlash = 0.85;
      coords.push({ x: t.x, y: t.y });
    }
    work.targetCoords = coords;
    work.isUpgrade = true;
    pushNews(
      state,
      `${offer.title} iniciada! Andaimes instalados em ${coords.length} imóveis (${offer.durationMonths} meses para entrega).`,
      'good'
    );
  } else if (actionId === 'tourism_festival') {
    // Explicit festival campaign boost during execution + commercial upgrades delivered upon conclusion
    upsertBoost(offer.title, offer.durationMonths);
    pushNews(
      state,
      `${offer.title} em andamento por ${offer.durationMonths} meses! Atrações aquecem o turismo e o comércio local.`,
      'milestone'
    );
  } else if (actionId === 'emergency_roadworks') {
    const roadTargets = [4, 6, 8, 10][tier - 1] ?? 8;
    const { roadTiles, bridgeWaterTiles } = findRoadworkPlanCoords(state, roadTargets, true);
    const coords: Array<{ x: number; y: number }> = [];
    for (const rt of roadTiles) {
      const plan = classifyPlannedRoadCell(state, rt.x, rt.y);
      rt.construction = {
        workId: work.id,
        actionId,
        title: offer.title,
        targetType: 'road',
        targetLevel: plan.corridorLevel,
        isUpgrade: false,
        lotWidth: 1,
        lotHeight: 1,
        lotDx: 0,
        lotDy: 0,
        totalMonths: work.totalMonths,
        remainingMonths: work.remainingMonths,
      };
      rt.evolveFlash = 0.85;
      coords.push({ x: rt.x, y: rt.y });
    }
    for (const wt of bridgeWaterTiles) {
      wt.construction = {
        workId: work.id,
        actionId,
        title: offer.title,
        targetType: 'bridge',
        targetLevel: getCurrentBridgeLevel(state),
        isUpgrade: false,
        lotWidth: 1,
        lotHeight: 1,
        lotDx: 0,
        lotDy: 0,
        totalMonths: work.totalMonths,
        remainingMonths: work.remainingMonths,
      };
      wt.evolveFlash = 0.85;
      coords.push({ x: wt.x, y: wt.y });
    }
    const targetBridgeLv =
      tier >= 4 && state.totalPopulation >= 22000
        ? 4
        : tier >= 3 && state.totalPopulation >= 12000
          ? 3
          : tier >= 2 && state.totalPopulation >= 3500
            ? 2
            : 1;
    if (targetBridgeLv >= 2) {
      for (const bt of state.tiles) {
        if (bt.type === 'bridge' && (bt.level || 1) < targetBridgeLv && !bt.construction) {
          bt.construction = {
            workId: work.id,
            actionId,
            title: offer.title,
            targetType: 'bridge',
            targetLevel: targetBridgeLv,
            isUpgrade: true,
            lotWidth: 1,
            lotHeight: 1,
            lotDx: 0,
            lotDy: 0,
            totalMonths: work.totalMonths,
            remainingMonths: work.remainingMonths,
          };
          coords.push({ x: bt.x, y: bt.y });
        }
      }
    }
    work.targetCoords = coords;
    pushNews(
      state,
      `Canteiros viários abertos: ${offer.title} (${offer.durationMonths} meses para conclusão).`,
      'info'
    );
  } else if (actionId === 'port_evolution') {
    const targetPortLv = Math.max(1, Math.min(3, tier));
    work.variant = Math.floor(nextRandom(state) * 4);
    const existingPorts = state.tiles.filter((t) => t.type === 'port' && !t.construction);
    if (tier === 1) {
      const slot = findBestPortReservationRect(state, 1);
      if (slot) {
        reserveCompoundConstructionRect(state, slot.x, slot.y, slot.fw, slot.fh, work, 'port', 1, []);
      }
    } else if (tier === 3) {
      const slot = findBestPortReservationRect(state, 3);
      if (slot) {
        reserveCompoundConstructionRect(state, slot.x, slot.y, slot.fw, slot.fh, work, 'port', 3, ['port']);
      } else if (existingPorts.length > 0) {
        for (const pt of existingPorts) {
          pt.construction = {
            workId: work.id,
            actionId,
            title: offer.title,
            targetType: 'port',
            targetLevel: targetPortLv,
            isUpgrade: true,
            lotWidth: pt.lotWidth ?? 1,
            lotHeight: pt.lotHeight ?? 1,
            lotDx: pt.lotDx ?? 0,
            lotDy: pt.lotDy ?? 0,
            totalMonths: work.totalMonths,
            remainingMonths: work.remainingMonths,
          };
        }
        work.targetCoords = existingPorts.map((p) => ({ x: p.x, y: p.y }));
      }
    } else if (existingPorts.length > 0) {
      work.variant = existingPorts[0].variant;
      work.isUpgrade = true;
      for (const pt of existingPorts) {
        pt.construction = {
          workId: work.id,
          actionId,
          title: offer.title,
          targetType: 'port',
          targetLevel: targetPortLv,
          isUpgrade: true,
          lotWidth: pt.lotWidth ?? 1,
          lotHeight: pt.lotHeight ?? 1,
          lotDx: pt.lotDx ?? 0,
          lotDy: pt.lotDy ?? 0,
          totalMonths: work.totalMonths,
          remainingMonths: work.remainingMonths,
        };
      }
      work.targetCoords = existingPorts.map((p) => ({ x: p.x, y: p.y }));
    } else {
      const slot = findBestPortReservationRect(state, targetPortLv);
      if (slot) {
        reserveCompoundConstructionRect(state, slot.x, slot.y, slot.fw, slot.fh, work, 'port', targetPortLv, []);
      }
    }
    pushNews(
      state,
      `Obras portuárias iniciadas: ${offer.title} (${offer.durationMonths} meses para conclusão).`,
      'info'
    );
  } else if (actionId === 'airport_evolution') {
    const targetAirLv = Math.max(1, Math.min(3, tier)) as 1 | 2 | 3;
    const slot = findBestAirportReservationRect(state, targetAirLv);
    work.variant = slot?.existingAnchor ? slot.existingAnchor.variant : Math.floor(nextRandom(state) * 8);
    if (slot) {
      work.isUpgrade = Boolean(slot.existingAnchor);
      reserveCompoundConstructionRect(
        state,
        slot.x,
        slot.y,
        slot.fw,
        slot.fh,
        work,
        'airport',
        targetAirLv,
        ['airport']
      );
    }
    pushNews(
      state,
      `Canteiro aeroportuário aberto: ${offer.title} (${offer.durationMonths} meses para inauguração).`,
      'info'
    );
  } else if (actionId === 'shopping_evolution') {
    const targetShopLv = Math.max(1, Math.min(3, tier)) as 1 | 2 | 3;
    const slot = findBestShoppingReservationRect(state, targetShopLv);
    work.variant = slot?.existingAnchor ? slot.existingAnchor.variant : Math.floor(nextRandom(state) * 8);
    if (slot) {
      work.isUpgrade = Boolean(slot.existingAnchor);
      reserveCompoundConstructionRect(
        state,
        slot.x,
        slot.y,
        slot.fw,
        slot.fh,
        work,
        'shopping',
        targetShopLv,
        ['shopping']
      );
    }
    pushNews(
      state,
      `Obras iniciadas: ${offer.title} (${offer.durationMonths} meses para inauguração).`,
      'info'
    );
  } else if (actionId === 'landmark_project') {
    if (tier === 1 || (tier >= 3 && state.stats.stadiumCount < 2)) {
      const slot = findBestStadiumRect(state, true);
      work.variant = pickEstablishmentVariation(state, 'soccer_stadium');
      if (slot) {
        reserveCompoundConstructionRect(
          state,
          slot.x,
          slot.y,
          slot.fw,
          slot.fh,
          work,
          'stadium',
          1,
          [],
          'soccer_stadium'
        );
      }
    } else if (tier === 2) {
      const slot = findBestEstablishmentRect(state, 'amusement_park', true);
      work.variant = pickEstablishmentVariation(state, 'amusement_park');
      if (slot) {
        reserveCompoundConstructionRect(
          state,
          slot.x,
          slot.y,
          slot.fw,
          slot.fh,
          work,
          'park',
          ESTABLISHMENT_MAP.amusement_park.hostLevel,
          [],
          'amusement_park'
        );
      }
    }
    pushNews(
      state,
      `Canteiro monumental aberto: ${offer.title} (${offer.durationMonths} meses para conclusão).`,
      'info'
    );
  }

  state.pendingWorks.push(work);
  state.mapVersion += 1;
  state.pendingSounds.push({ type: 'emergency' });
  recomputeFieldsAndStats(state);
  return {
    ok: true,
    executedTitle: offer.title,
    evolvedToTier: tier,
  };
}

/**
 * Trigger a major Evolutionary Breakthrough ("Salto Evolutivo") when a system reaches 100% charge!
 * Strictly respects population gates (2k Small Sports Center, 3.5k/12k Bridges, 15k/30k Airports, 20k Stadium).
 */
function triggerSystemBreakthrough(state: CityState, area: BudgetAreaKey): void {
  state.breakthroughCharge[area] = 0;
  state.breakthroughCount[area] = (state.breakthroughCount[area] ?? 0) + 1;
  state.pendingSounds.push({ type: 'milestone' });

  if (area === 'infrastructure') {
    buildImmediateRoads(state, 5, true);
    const up = upgradeTopBuildings(state, 2);
    pushNews(
      state,
      `SALTO DE INFRAESTRUTURA! Megainvestimento abre vias planejadas e moderniza ${up} edifícios!`,
      'milestone'
    );
  } else if (area === 'entertainment') {
    plantImmediateParks(state, 2);
    upgradeTopBuildings(state, 2, 'commercial');
    pushNews(
      state,
      'SALTO DE CULTURA & LAZER! Novas praças e comércio cultural aquecem a cidade!',
      'milestone'
    );
  } else if (area === 'education') {
    const up = upgradeTopBuildings(state, 3);
    pushNews(
      state,
      `SALTO EDUCACIONAL! Polo Universitário impulsiona inovação e evolui ${up} edifícios modernos!`,
      'milestone'
    );
  } else if (area === 'wellbeing') {
    const planted = plantImmediateParks(state, 4);
    const existing = state.activeBoosts.find((b) => b.actionId === 'environmental_cleanup');
    if (existing) {
      existing.remainingMonths = Math.max(existing.remainingMonths, 3);
    } else {
      state.activeBoosts.push({
        id: `breakthrough_well_${state.tick}`,
        actionId: 'environmental_cleanup',
        label: 'Revolução Ecológica',
        tier: 2,
        remainingMonths: 3,
      });
    }
    pushNews(
      state,
      `REVOLUÇÃO ECOLÓGICA! Superinvestimento em Saúde & Meio Ambiente cria ${planted} parques e purifica o ar!`,
      'milestone'
    );
  } else if (area === 'security') {
    let restored = 0;
    for (const t of state.tiles) {
      if (t.type === 'abandoned') {
        t.type = t.previousType ?? 'residential';
        t.level = t.type !== 'industrial' ? 2 : 1;
        t.age = 0;
        t.evolveFlash = 1.75;
        restored++;
      }
    }
    const existing = state.activeBoosts.find((b) => b.actionId === 'revitalization');
    if (existing) {
      existing.remainingMonths = Math.max(existing.remainingMonths, 4);
    } else {
      state.activeBoosts.push({
        id: `breakthrough_sec_${state.tick}`,
        actionId: 'revitalization',
        label: 'Cidade Modelo Segura',
        tier: 3,
        remainingMonths: 4,
      });
    }
    pushNews(
      state,
      `CIDADE MODELO SEGURA! Superinvestimento em Segurança blinda bairros por 4 meses${restored > 0 ? ` e restaura ${restored} imóveis` : ''}!`,
      'milestone'
    );
  } else if (area === 'tourism') {
    plantImmediateParks(state, 2);
    const windfall = roundTo10(Math.max(1200, state.financials.revenue.total * 0.35), 200);
    state.money += windfall;
    const existing = state.activeBoosts.find((b) => b.actionId === 'tourism_festival');
    if (existing) {
      existing.remainingMonths = Math.max(existing.remainingMonths, 3);
    } else {
      state.activeBoosts.push({
        id: `breakthrough_tour_${state.tick}`,
        actionId: 'tourism_festival',
        label: 'Boom Turismo & Comércio',
        tier: 2,
        remainingMonths: 3,
      });
    }
    pushNews(
      state,
      `BOOM DE TURISMO & COMÉRCIO! Pixópolis recebe visitantes externos e +$${windfall.toLocaleString('pt-BR')} em caixa!`,
      'milestone'
    );
  }
}

/**
 * Advance simulation time smoothly by `simSeconds` (= dt * speed).
 */
export function advanceSimulationTime(
  state: CityState,
  simSeconds: number,
  autoSaveStorage?: StorageLike
): { grew: boolean; monthClosed: boolean; yearChanged: boolean } {
  if (simSeconds <= 0) return { grew: false, monthClosed: false, yearChanged: false };

  const prevGrowthBucket = Math.floor(
    state.monthElapsedSec / SECONDS_PER_GROWTH_TICK_1X
  );
  state.monthElapsedSec += simSeconds;

  let grew = false;
  let monthClosed = false;

  const totalElapsed = state.monthElapsedSec;
  const targetBuckets = Math.floor(totalElapsed / SECONDS_PER_GROWTH_TICK_1X);
  const ticksToRun = Math.min(6, Math.max(0, targetBuckets - prevGrowthBucket));

  for (let i = 0; i < ticksToRun; i++) {
    stepCityTick(state);
    grew = true;
  }

  const prevSeason = state.weather?.season ?? getSeasonForMonth(state.month);
  const prevYear = state.year;

  while (state.monthElapsedSec >= SECONDS_PER_MONTH_1X) {
    state.monthElapsedSec -= SECONDS_PER_MONTH_1X;
    closeFinancialMonth(state);
    monthClosed = true;
  }

  const yearChanged = state.year > prevYear;
  const weatherChanged = updateWeatherState(state, simSeconds, prevSeason);

  if (yearChanged) {
    pushNews(
      state,
      `Auto-save anual: ${sanitizeCityName(state.cityName)} salva em ${formatDateLabel(state.month, state.year)}.`,
      'info'
    );
    saveCurrentCityToStorage(state, { isAutoSave: true, storage: autoSaveStorage });
  }

  return { grew: grew || weatherChanged, monthClosed, yearChanged };
}

function getSeasonalBaseTemp(season: SeasonId, kind: WeatherKind, rand01: number): number {
  if (season === 'summer') {
    const base = kind === 'clear' ? 29 : kind === 'partly_cloudy' ? 26 : 23;
    return Math.round(base + rand01 * 5);
  }
  if (season === 'autumn') {
    const base = kind === 'clear' ? 19 : kind === 'partly_cloudy' ? 16 : 13;
    return Math.round(base + rand01 * 4);
  }
  if (season === 'winter') {
    const base = kind === 'snow' ? -1 : kind === 'rain' ? 4 : kind === 'partly_cloudy' ? 3 : 6;
    return Math.round(base + rand01 * 4);
  }
  const base = kind === 'clear' ? 22 : kind === 'partly_cloudy' ? 19 : 16;
  return Math.round(base + rand01 * 4);
}

/** Roll next weather condition according to the active season's climate distribution */
function rollSeasonalWeatherKind(state: CityState, season: SeasonId): WeatherKind {
  const r = nextRandom(state);
  if (season === 'summer') {
    if (r < 0.45) return 'clear';
    if (r < 0.68) return 'partly_cloudy';
    if (r < 0.88) return 'rain';
    return 'storm';
  }
  if (season === 'autumn') {
    if (r < 0.32) return 'clear';
    if (r < 0.70) return 'partly_cloudy';
    if (r < 0.95) return 'rain';
    return 'storm';
  }
  if (season === 'winter') {
    if (r < 0.24) return 'clear';
    if (r < 0.52) return 'partly_cloudy';
    if (r < 0.86) return 'snow';
    return 'rain';
  }
  // spring
  if (r < 0.42) return 'clear';
  if (r < 0.68) return 'partly_cloudy';
  if (r < 0.93) return 'rain';
  return 'storm';
}

export function createInitialWeather(month: number, seed: number): WeatherState {
  const season = getSeasonForMonth(month);
  const frac = ((seed % 100) + 100) % 100 / 100;
  const kind: WeatherKind =
    season === 'winter'
      ? frac < 0.4 ? 'snow' : 'partly_cloudy'
      : season === 'autumn'
        ? frac < 0.45 ? 'partly_cloudy' : 'clear'
        : 'clear';
  return {
    season,
    kind,
    intensity: kind === 'clear' ? 0.35 : 0.65,
    snowCover: season === 'winter' ? (kind === 'snow' ? 0.8 : 0.55) : 0,
    temperatureC: getSeasonalBaseTemp(season, kind, frac),
    windX: Number(((frac - 0.5) * 0.9).toFixed(2)),
    nextChangeSec: 12 + frac * 8,
  };
}

/**
 * Advance dynamic weather & seasonal snow accumulation over `simSeconds`.
 * Returns `true` when the discrete season or weather kind changes.
 */
export function updateWeatherState(
  state: CityState,
  simSeconds: number,
  prevSeasonHint?: SeasonId
): boolean {
  if (!state.weather) {
    state.weather = createInitialWeather(state.month, state.seed);
  }
  const w = state.weather;
  const prevSeason = prevSeasonHint ?? w.season;
  const prevKind = w.kind;
  const targetSeason: SeasonId =
    state.seasonMode && state.seasonMode !== 'auto'
      ? state.seasonMode
      : getSeasonForMonth(state.month);
  let changed = false;

  if (targetSeason !== prevSeason) {
    w.season = targetSeason;
    const nextKind = rollSeasonalWeatherKind(state, targetSeason);
    w.kind = nextKind;
    w.intensity = Number((0.55 + nextRandom(state) * 0.4).toFixed(2));
    w.windX = Number(((nextRandom(state) - 0.5) * 1.4).toFixed(2));
    w.temperatureC = getSeasonalBaseTemp(targetSeason, nextKind, nextRandom(state));
    w.nextChangeSec = 10 + nextRandom(state) * 10;
    changed = true;

    const seasonHint =
      targetSeason === 'summer'
        ? 'Dias ensolarados e calor tropical aquecem a cidade.'
        : targetSeason === 'autumn'
          ? 'Folhas douradas e brisas amenas tomam conta das ruas e parques.'
          : targetSeason === 'winter'
            ? 'Frente fria traz geada, nevascas e telhados nevados.'
            : 'Ipês floridos e chuvas suaves renovam os campos e parques.';
    pushNews(
      state,
      `Estação: ${getSeasonLabel(targetSeason)} (${getWeatherLabel(nextKind)}, ${w.temperatureC}°C) — ${seasonHint}`,
      'info'
    );
  }

  w.nextChangeSec -= simSeconds;
  if (w.nextChangeSec <= 0) {
    const nextKind = rollSeasonalWeatherKind(state, w.season);
    if (nextKind !== w.kind) {
      changed = true;
    }
    w.kind = nextKind;
    w.intensity = Number((0.45 + nextRandom(state) * 0.55).toFixed(2));
    w.windX = Number(
      (
        (nextKind === 'storm' ? 0.55 : 0.25) *
        (nextRandom(state) < 0.5 ? -1 : 1) +
        (nextRandom(state) - 0.5) * 0.6
      ).toFixed(2)
    );
    w.temperatureC = getSeasonalBaseTemp(w.season, nextKind, nextRandom(state));
    w.nextChangeSec = 11 + nextRandom(state) * 11;
  }

  // Smooth seasonal snow accumulation / thaw
  if (w.season === 'winter') {
    const targetSnow = w.kind === 'snow' ? 0.95 : 0.62;
    const rate = w.kind === 'snow' ? 0.08 : 0.03;
    w.snowCover = Math.min(1, w.snowCover + (targetSnow - w.snowCover) * Math.min(1, simSeconds * rate));
    if (w.snowCover < 0.45) {
      w.snowCover = Math.min(0.45, w.snowCover + simSeconds * 0.06);
    }
  } else {
    w.snowCover = Math.max(0, w.snowCover - simSeconds * 0.08);
  }

  return changed || w.kind !== prevKind;
}

/** Cycle season mode ('auto' -> Verão -> Outono -> Inverno -> Primavera -> 'auto') and refresh weather */
export function cycleCitySeasonMode(state: CityState): SeasonMode {
  const order: SeasonMode[] = ['auto', 'summer', 'autumn', 'winter', 'spring'];
  const cur: SeasonMode = state.seasonMode ?? 'auto';
  const next = order[(order.indexOf(cur) + 1) % order.length];
  state.seasonMode = next;

  const targetSeason: SeasonId =
    next === 'auto' ? getSeasonForMonth(state.month) : next;
  const w = state.weather ?? createInitialWeather(state.month, state.seed);
  state.weather = w;
  w.season = targetSeason;
  w.kind =
    targetSeason === 'winter'
      ? 'snow'
      : targetSeason === 'autumn'
        ? 'rain'
        : targetSeason === 'spring'
          ? 'partly_cloudy'
          : 'clear';
  w.intensity = w.kind === 'clear' ? 0.35 : 0.78;
  w.snowCover = targetSeason === 'winter' ? 0.9 : 0;
  w.windX = targetSeason === 'autumn' ? 0.45 : targetSeason === 'winter' ? -0.35 : 0.18;
  w.temperatureC = getSeasonalBaseTemp(targetSeason, w.kind, 0.45);
  w.nextChangeSec = 12;
  return next;
}

/** Advance one organic probabilistic growth cycle (roads, bridges, ports, landmarks, breakthroughs) */
export function stepCityTick(state: CityState): void {
  state.tick += 1;

  for (let i = 0; i < state.tiles.length; i++) {
    const t = state.tiles[i];
    if (isBuildingType(t.type)) {
      t.age += 1;
      if ((t.upgradeCooldown ?? 0) > 0) {
        t.upgradeCooldown = Math.max(0, (t.upgradeCooldown ?? 0) - 1);
      }
    }
  }

  const tm = state.trait.modifiers;
  const eventMods = getActiveEventModifiers(state);
  const infraCov = getCovRatio(state, 'infrastructure');
  const eduCov = getCovRatio(state, 'education');
  const secCov = getCovRatio(state, 'security');
  const wellCov = getCovRatio(state, 'wellbeing');
  const entCov = getCovRatio(state, 'entertainment');
  const tourCov = getCovRatio(state, 'tourism');

  const roadBoostTier = getBoostTier(state, 'emergency_roadworks');
  const roadBoostMult = roadBoostTier > 0 ? 1.8 + roadBoostTier * 0.4 : 1.0;
  const festTier = getBoostTier(state, 'tourism_festival');
  const festivalBoost = festTier > 0 ? 1.25 + festTier * 0.25 : 1.0;
  const revitTier = getBoostTier(state, 'revitalization');
  const revitShield = revitTier > 0 ? Math.max(0.15, 0.4 - revitTier * 0.08) : 1.0;
  const fairTax = computeFairTaxRate(
    state.stats.serviceCoverageAvg,
    state.difficulty,
    state.stats.coverage.education.coveragePct
  );
  const maxUpgradesThisTick = getScaledMaxUpgradesPerTick(
    state.totalPopulation,
    state.gridWidth,
    state.gridHeight
  );

  // Collect active frontier lists strictly following the Plano Diretor Viário
  const roadFrontier: Array<{
    road: Tile;
    dir: [number, number];
    target: Tile;
    weight: number;
    corridorLevel: 1 | 2 | 3;
  }> = [];
  const buildableEmptyTiles: Tile[] = [];
  const buildings: Tile[] = [];

  const mainRoadSet = getMainConnectedRoadSet(state);

  for (let i = 0; i < state.tiles.length; i++) {
    const t = state.tiles[i];
    if (isRoadLike(t.type)) {
      // Strict connectivity rule: only extend roads that belong to the main connected road network!
      if (!mainRoadSet.has(i)) continue;
      for (const dir of ORTHO_DIRS) {
        const target = getTile(state, t.x + dir[0], t.y + dir[1]);
        if (!target) continue;
        if (target.type === 'water' && t.type === 'road' && !target.construction) {
          const plan = classifyPlannedRoadCell(state, t.x, t.y);
          // Prioritize river bridges on arterial Avenidas & Estradas
          const bridgePrio = plan.onHighwayAxis ? 2.4 : plan.onAvenueAxis ? 2.0 : 0.7;
          roadFrontier.push({
            road: t,
            dir,
            target,
            weight: bridgePrio,
            corridorLevel: plan.corridorLevel,
          });
        } else if (
          !target.construction &&
          (target.type === 'grass' || target.type === 'forest') &&
          target.x > 0 &&
          target.y > 0 &&
          target.x < state.gridWidth - 1 &&
          target.y < state.gridHeight - 1 &&
          !wouldCreateRoadBlob(state, target.x, target.y)
        ) {
          const targetPlan = classifyPlannedRoadCell(state, target.x, target.y);
          if (!targetPlan.isPlanned) continue;

          const behind = getTile(state, t.x - dir[0], t.y - dir[1]);
          const isStraight = Boolean(behind && isRoadLike(behind.type));
          let weight = 1.0;
          if (targetPlan.isArterialCross) weight = 2.8;
          else if (targetPlan.onHighwayAxis) weight = isStraight ? 2.5 : 1.7;
          else if (targetPlan.onAvenueAxis) weight = isStraight ? 2.2 : 1.5;
          else weight = isStraight ? 1.55 : 0.95;

          const coreDist = Math.hypot(
            target.x - (typeof state.roadOriginX === 'number' ? state.roadOriginX : state.gridWidth / 2),
            target.y - (typeof state.roadOriginY === 'number' ? state.roadOriginY : state.gridHeight / 2)
          );
          const coreFocusMult = coreDist <= 9 ? 1.45 : coreDist > 13 ? 0.72 : 1.0;

          roadFrontier.push({
            road: t,
            dir,
            target,
            weight: weight * coreFocusMult,
            corridorLevel: targetPlan.corridorLevel,
          });
        } else if (
          !target.construction &&
          (target.type === 'abandoned' ||
            ((target.type === 'rural' || target.type === 'residential' || target.type === 'commercial') &&
              target.level <= 1 &&
              !target.establishmentId)) &&
          target.x > 0 &&
          target.y > 0 &&
          target.x < state.gridWidth - 1 &&
          target.y < state.gridHeight - 1 &&
          !wouldCreateRoadBlob(state, target.x, target.y)
        ) {
          // If an old house/lot or abandoned structure is obstructing a planned road corridor, allow urban renewal to demolish & extend the road!
          const targetPlan = classifyPlannedRoadCell(state, target.x, target.y);
          if (targetPlan.isPlanned && (target.type === 'abandoned' || targetPlan.onHighwayAxis || targetPlan.onAvenueAxis)) {
            roadFrontier.push({
              road: t,
              dir,
              target,
              weight: target.type === 'abandoned' ? 2.1 : 1.65,
              corridorLevel: targetPlan.corridorLevel,
            });
          }
        }
      }
    } else if (isBuildingType(t.type)) {
      if (!t.construction) {
        buildings.push(t);
      }
    } else if ((t.type === 'grass' || t.type === 'forest') && !t.construction) {
      // Reserve planned road corridors (right-of-way) and require adjacency to the main connected road network!
      const cellPlan = classifyPlannedRoadCell(state, t.x, t.y);
      if (!cellPlan.isPlanned) {
        const neigh = getOrthoNeighbors(state, t.x, t.y);
        if (
          neigh.some(
            (nt) =>
              nt.type === 'road' &&
              mainRoadSet.has(nt.y * state.gridWidth + nt.x)
          )
        ) {
          buildableEmptyTiles.push(t);
        }
      }
    }
  }

  // Pre-compute compact block infill metrics so active 2×2 city blocks fill completely before sprawling outward!
  const cx = typeof state.roadOriginX === 'number' ? state.roadOriginX : state.gridWidth / 2;
  const cy = typeof state.roadOriginY === 'number' ? state.roadOriginY : state.gridHeight / 2;
  const ox = Math.floor(cx);
  const oy = Math.floor(cy);

  const countBuiltInSame2x2Block = (tx: number, ty: number): number => {
    const relX = ((((tx - ox) % 3) + 3) % 3);
    const relY = ((((ty - oy) % 3) + 3) % 3);
    if (relX === 0 || relY === 0) return 0;
    const bx = tx - (relX - 1);
    const by = ty - (relY - 1);
    let built = 0;
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        const bt = getTile(state, bx + dx, by + dy);
        if (bt && isBuildingType(bt.type)) built++;
      }
    }
    return built;
  };

  let internalGapCount = 0;
  const scoredBuildableSlots: Array<{
    tile: Tile;
    blockBuiltLots: number;
    adjBuildings: number;
    infillScore: number;
  }> = [];

  for (let i = 0; i < buildableEmptyTiles.length; i++) {
    const t = buildableEmptyTiles[i];
    const blockBuiltLots = countBuiltInSame2x2Block(t.x, t.y);
    const adjBuildings = getOrthoNeighbors(state, t.x, t.y).filter((n) =>
      isBuildingType(n.type)
    ).length;
    if (blockBuiltLots > 0 || adjBuildings >= 2) {
      internalGapCount++;
    }
    const distFromCore = Math.hypot(t.x - cx, t.y - cy);
    // Strongly prioritize closing empty gaps inside already-started 2×2 blocks and adjacent to existing buildings!
    const infillScore =
      blockBuiltLots * 6.5 +
      adjBuildings * 3.4 -
      distFromCore * 0.65 +
      nextRandom(state) * 1.15;
    scoredBuildableSlots.push({ tile: t, blockBuiltLots, adjBuildings, infillScore });
  }
  scoredBuildableSlots.sort((a, b) => b.infillScore - a.infillScore);

  // 1. Planned Urban Road Network Expansion (Estradas, Avenidas, Ruas, Trevos & Arterial River Bridges)
  // Throttle outer road sprawl whenever many interior block lots are still empty grass gaps!
  const shouldThrottleSprawl = internalGapCount >= 8 && roadBoostTier === 0;
  let roadsChanged = false;
  const roadAttempts = shouldThrottleSprawl
    ? 1
    : Math.min(4, Math.max(1, Math.floor(roadFrontier.length / 12) + 1));
  for (let a = 0; a < roadAttempts; a++) {
    if (roadFrontier.length === 0) break;
    // Weighted pick favoring arterials, ring highways, and completing Trevos cleanly
    let totalWeight = 0;
    for (let k = 0; k < roadFrontier.length; k++) totalWeight += roadFrontier[k].weight;
    let roll = nextRandom(state) * totalWeight;
    let pick = roadFrontier[0];
    for (let k = 0; k < roadFrontier.length; k++) {
      roll -= roadFrontier[k].weight;
      if (roll <= 0) {
        pick = roadFrontier[k];
        break;
      }
    }
    const { road: rt, dir, target, weight, corridorLevel } = pick;
    const [dx, dy] = dir;

    if (target.type === 'water' && rt.type === 'road') {
      const popNearRiver = countPopulatedNear(state, rt.x, rt.y, 4);
      const minInfraForBridge =
        popNearRiver >= 2 ? 0.25 : GROWTH_CONFIG.bridgeMinInfraCoverage;
      if (infraCov >= minInfraForBridge || roadBoostTier > 0) {
        const riverProximityBoost = popNearRiver >= 2 ? 1.8 : 1.0;
        const bridgeChance =
          (GROWTH_CONFIG.baseBridgeChance + infraCov * 0.14) *
          riverProximityBoost *
          weight *
          tm.roadExpandMultiplier *
          (roadBoostTier > 0 ? 2.4 : 1.0);
        if (nextRandom(state) < bridgeChance) {
          if (tryBuildBridgeFrom(state, rt, dx, dy)) {
            roadsChanged = true;
          }
        }
      }
      continue;
    }

    if (
      target.type === 'grass' ||
      target.type === 'forest' ||
      target.type === 'abandoned' ||
      ((target.type === 'rural' || target.type === 'residential' || target.type === 'commercial') &&
        target.level <= 1 &&
        !target.establishmentId)
    ) {
      if (wouldCreateRoadBlob(state, target.x, target.y)) continue;
      const sprawlBrake = shouldThrottleSprawl ? 0.28 : 1.0;
      const expandChance =
        (GROWTH_CONFIG.baseRoadExpandChance + infraCov * GROWTH_CONFIG.infraRoadBonus) *
        Math.min(2.1, weight) *
        tm.roadExpandMultiplier *
        roadBoostMult *
        eventMods.growthMult *
        sprawlBrake;

      if (nextRandom(state) < expandChance) {
        if (isBuildingType(target.type)) {
          // Demolish obstructing compound cleanly before laying the planned road
          for (const ct of getCompoundTiles(state, target)) {
            resetTileToGrass(ct, 0.9);
          }
        }
        target.type = 'road';
        target.level = corridorLevel;
        target.variant = 0;
        target.age = 0;
        target.evolveFlash = 0.55;
        roadsChanged = true;
      }
    }
  }

  // Also automatically demolish any legacy/misplaced non-arterial road tile sitting inside a 2×2 buildable block interior
  // (NEVER touch intentional 2×2 Wide Avenues / Boulevards!)
  for (let i = 0; i < state.tiles.length; i++) {
    const rt = state.tiles[i];
    if (rt.type !== 'road' || rt.construction) continue;
    if (
      isExternalBorderRoadTile(state, rt.x, rt.y) ||
      isTollPlazaTile(state, rt.x, rt.y) ||
      isWideAvenue2x2Tile(state, rt.x, rt.y)
    ) {
      continue;
    }
    const plan = classifyPlannedRoadCell(state, rt.x, rt.y);
    if (!plan.isPlanned) {
      const neigh = getOrthoNeighbors(state, rt.x, rt.y);
      const roadDeg = neigh.filter((n) => isRoadLike(n.type)).length;
      const buildingNeighbors = neigh.filter((n) => isBuildingType(n.type)).length;
      if (roadDeg <= 1 && buildingNeighbors >= 2 && nextRandom(state) < 0.25) {
        resetTileToGrass(rt, 0.95);
        roadsChanged = true;
      }
    }
  }

  // Organic 2×2 Wide Avenue (Boulevard) widening once city reaches mid-sized density (>= 2.200 hab.)
  // so downtown commercial/residential boulevards naturally prepare for future Lv. 4 Skyscrapers!
  const desiredWideAvenueTiles =
    state.stats.population >= 2200
      ? Math.min(48, Math.floor((state.stats.population - 1400) / 450) * 6)
      : 0;
  if (
    desiredWideAvenueTiles > (state.stats.wideAvenueTileCount || 0) &&
    nextRandom(state) < (roadBoostTier > 0 ? 0.35 : 0.14)
  ) {
    if (tryWidenAvenueNear(state, Math.round(cx), Math.round(cy))) {
      roadsChanged = true;
    }
  }

  if (roadsChanged) {
    reconcileRoadHierarchy(state);
  }

  // 2. Cohesive Neighborhood Zoning & Compact Infill inside Planned 2x2 City Blocks:
  // Groups homes into Bairros Residenciais, shops/towers into Bairros Comerciais, and factories into Distritos Industriais,
  // while tightly filling active blocks before spreading out!
  const resTaxFactor = Math.max(0.24, 1 - (state.taxes.residential - fairTax) * 0.13);
  const comTaxFactor = Math.max(0.24, 1 - (state.taxes.commercial - (fairTax + 0.5)) * 0.12);
  const indTaxFactor = Math.max(0.24, 1 - (state.taxes.industrial - (fairTax + 1.0)) * 0.11);
  const avgDemandFactor = (resTaxFactor + comTaxFactor + indTaxFactor) / 3;
  const growthSpeed =
    (GROWTH_CONFIG.baseZoneChance + (infraCov + wellCov + entCov) * 0.011) *
    Math.min(1.3, Math.max(0.25, avgDemandFactor)) *
    eventMods.growthMult;

  const isEarlyHorizontalTown = state.totalPopulation < 1500;
  const zoneAttempts = Math.min(
    isEarlyHorizontalTown ? GROWTH_CONFIG.evaluationsPerTick + 2 : GROWTH_CONFIG.evaluationsPerTick,
    scoredBuildableSlots.length
  );
  const topPoolCap = Math.max(1, Math.min(scoredBuildableSlots.length, Math.max(8, Math.ceil(scoredBuildableSlots.length * 0.30))));
  for (let z = 0; z < zoneAttempts; z++) {
    // Strongly favor top compact-infill slots (82% from the tightest active-block gaps, 18% organic frontier)
    const useCompactPool = z < Math.ceil(zoneAttempts * 0.82);
    const poolLimit = useCompactPool ? topPoolCap : scoredBuildableSlots.length;
    const slot = scoredBuildableSlots[Math.floor(nextRandom(state) * poolLimit)];
    const tile = slot?.tile;
    if (!tile || (tile.type !== 'grass' && tile.type !== 'forest')) continue;

    // Prioritize closing interior block gaps so 12×12 Level-1 neighborhoods consolidate briskly while keeping multi-year economy balanced
    const infillBoost = isEarlyHorizontalTown
      ? slot.blockBuiltLots >= 2
        ? 1.72
        : slot.blockBuiltLots === 1 || slot.adjBuildings >= 2
          ? 1.42
          : 0.72
      : slot.blockBuiltLots >= 2
        ? 1.15
        : slot.blockBuiltLots === 1 || slot.adjBuildings >= 2
          ? 0.96
          : 0.44;
    if (nextRandom(state) > Math.min(0.88, growthSpeed * infillBoost)) continue;

    const adj = countAdjacentTypes(state, tile.x, tile.y);
    const adjRoadNeighbors = getOrthoNeighbors(state, tile.x, tile.y).filter(
      (n) => n.type === 'road'
    );
    const nearHighway = adjRoadNeighbors.some((n) => n.level === 3);
    const nearWideAvenue = adjRoadNeighbors.some((n) => n.level === 2 && n.variant === 2);
    const nearAvenueOrTrevo = adjRoadNeighbors.some((n) => n.level === 2 || n.level >= 4);
    const nearLocalOnly = adjRoadNeighbors.length > 0 && !nearHighway && !nearAvenueOrTrevo;

    const district = getNeighborhoodDistrict(state, tile.x, tile.y);
    const distFromCenter = Math.hypot(tile.x - cx, tile.y - cy);
    const densePopNear = countPopulatedNear(state, tile.x, tile.y, 3);
    const isOuterFrontier = distFromCenter >= 6.8 && densePopNear <= 3;

    let wRural = isOuterFrontier
      ? (1.25 + (distFromCenter - 5.8) * 0.30 + adj.rural * 0.95 + adj.water * 0.35) *
        (nearHighway ? 0.55 : nearAvenueOrTrevo ? 0.4 : 1.35) *
        indTaxFactor
      : 0.02;

    let wRes =
      (2.1 + wellCov * 1.45 + eduCov * 1.1 + entCov * 1.15 + adj.residential * 1.15 + adj.park * 0.75 + adj.water * 0.4 + adj.landmark * 0.45) *
      tm.residentialWeightMultiplier *
      resTaxFactor;
    const secComMult = secCov < 0.85 ? Math.max(0.75, 0.75 + (secCov / 0.85) * 0.25) : 1.0;
    let wCom =
      (1.1 + entCov * 1.55 + tourCov * 1.35 * secComMult + infraCov * 0.65 + adj.commercial * 1.2 + adj.residential * 0.25 + adj.landmark * 1.15) *
      tm.commercialWeightMultiplier *
      festivalBoost *
      comTaxFactor;
    let wInd =
      (0.85 + infraCov * 0.95 + adj.industrial * 1.3 - wellCov * 0.35 - eduCov * 0.25) *
      tm.industrialWeightMultiplier *
      indTaxFactor;
    let wPark =
      (0.28 + wellCov * 1.85 + tourCov * 0.55 + adj.water * 0.45 + (tile.pollution > 22 ? 0.75 : 0)) *
      tm.parkWeightMultiplier;

    // Cohesive Neighborhood District Specialization (Bairros Residenciais, Comerciais & Distritos Industriais):
    if (district === 'residential') {
      wRes *= 3.8;
      wCom *= 0.34;
      wInd *= 0.08;
      wPark *= 0.78;
    } else if (district === 'commercial') {
      wCom *= 3.5;
      wRes *= 0.62;
      wInd *= 0.08;
      wPark *= 0.72;
    } else {
      // 'industrial' district: keeps heavy industry grouped together cleanly away from residential areas
      wInd *= 3.7;
      wCom *= 0.42;
      wRes *= 0.09;
      wPark *= 0.48;
      wRural *= 0.45;
    }

    // Smart urban land-use tuning along the planned road hierarchy:
    if (nearWideAvenue) {
      wCom *= 1.85; // 2×2 Wide Boulevards strongly attract high-value commercial corridors & future skyscrapers
      wRes *= 1.18;
      wInd *= 0.35;
    } else if (nearHighway) {
      wInd *= district === 'residential' ? 1.45 : 2.35; // Logistics & industry thrive next to Estradas Expressas
      wCom *= 1.12;
      wPark *= 1.15;
      wRes *= 0.52;
    } else if (nearAvenueOrTrevo) {
      wCom *= 1.45; // Shops & commercial avenues line Avenidas & Trevos
      wRes *= 1.05;
      wInd *= 0.55;
    } else if (nearLocalOnly) {
      wRes *= 1.32; // Cozy residential neighborhoods flourish on Ruas Locais
      wInd *= 0.68;
    }

    if (tile.pollution > 26) {
      wRes *= 0.35;
      wRural *= 0.35;
      wInd *= 1.35;
    }
    if (adj.industrial > 0) {
      wRes *= 0.42;
      wRural *= 0.45;
    }

    wRural = Math.max(0.01, wRural);
    wRes = Math.max(0.04, wRes);
    wCom = Math.max(0.04, wCom);
    wInd = Math.max(0.04, wInd);
    wPark = Math.max(0.08, wPark);

    const totalW = wRural + wRes + wCom + wInd + wPark;
    let roll = nextRandom(state) * totalW;

    let chosen: TileType = 'residential';
    if (roll < wRural) {
      chosen = 'rural';
    } else if ((roll -= wRural) < wRes) {
      chosen = 'residential';
    } else if ((roll -= wRes) < wCom) {
      chosen = 'commercial';
    } else if ((roll -= wCom) < wInd) {
      chosen = 'industrial';
    } else {
      chosen = 'park';
    }

    let chosenVariant = pickDistinctBuildingVariant(state, tile.x, tile.y);
    let chosenEstablishmentId: EstablishmentId | undefined = undefined;

    // Organically spawn one of the 20 iconic establishments only gradually when a valid minimum-radius slot is available!
    let formedCompound = false;
    if (
      (chosen === 'park' || chosen === 'commercial' || chosen === 'residential') &&
      nextRandom(state) < (chosen === 'park' ? 0.55 : 0.28)
    ) {
      const estPick = tryPickOrganicEstablishment(state, tile.x, tile.y, chosen, 1, tile);
      if (estPick) {
        const spec = ESTABLISHMENT_MAP[estPick.establishmentId];
        if (spec) {
          const placedEst = tryPlaceEstablishmentFootprint(
            state,
            tile.x,
            tile.y,
            spec,
            1,
            estPick.variant,
            true
          );
          if (placedEst) {
            formedCompound = true;
          } else if (spec.footprintW === 1 && spec.footprintH === 1) {
            chosenEstablishmentId = estPick.establishmentId;
            chosenVariant = estPick.variant;
          }
        }
      }
    }

    // Check if this lot can form a multi-tile construction (2×1, 1×2, or 2×2) inside the planned 2×2 city block
    if (
      !formedCompound &&
      !chosenEstablishmentId &&
      (chosen === 'rural' ||
        chosen === 'industrial' ||
        chosen === 'commercial' ||
        chosen === 'residential') &&
      nextRandom(state) < (chosen === 'rural' || chosen === 'industrial' ? 0.32 : 0.18)
    ) {
      const east = getTile(state, tile.x + 1, tile.y);
      const south = getTile(state, tile.x, tile.y + 1);
      const se = getTile(state, tile.x + 1, tile.y + 1);
      const canUse = (cand: Tile | null) =>
        Boolean(
          cand &&
            !cand.construction &&
            (cand.type === 'grass' || cand.type === 'forest') &&
            !classifyPlannedRoadCell(state, cand.x, cand.y).isPlanned
        );

      if (canUse(east) && canUse(south) && canUse(se) && nextRandom(state) < 0.42) {
        assignCompoundLot(state, tile.x, tile.y, 2, 2, chosen, 1, chosenVariant, 0.9);
        formedCompound = true;
      } else if (canUse(east)) {
        assignCompoundLot(state, tile.x, tile.y, 2, 1, chosen, 1, chosenVariant, 0.85);
        formedCompound = true;
      } else if (canUse(south)) {
        assignCompoundLot(state, tile.x, tile.y, 1, 2, chosen, 1, chosenVariant, 0.85);
        formedCompound = true;
      }
    }

    if (!formedCompound) {
      assignCompoundLot(
        state,
        tile.x,
        tile.y,
        1,
        1,
        chosen,
        1,
        chosenVariant,
        0.75,
        chosenEstablishmentId
      );
    }
  }

  // 2b. Organic Riverbank Marina Generation (2×1 shoreline establishment, gated at 1.200+ hab.)
  if (state.totalPopulation >= 1200 && (entCov >= 0.65 || tourCov >= 0.65) && nextRandom(state) < 0.04) {
    const marinaSpec = ESTABLISHMENT_MAP.river_marina;
    for (let i = 0; i < state.tiles.length; i++) {
      const st = state.tiles[i];
      if (st.construction) continue;
      if (st.type !== 'grass' && st.type !== 'forest' && (st.type !== 'park' || st.establishmentId)) {
        continue;
      }
      if (classifyPlannedRoadCell(state, st.x, st.y).isPlanned) continue;
      const neigh = getOrthoNeighbors(state, st.x, st.y);
      const touchesMainRoad = neigh.some(
        (nt) => isRoadLike(nt.type) && mainRoadSet.has(nt.y * state.gridWidth + nt.x)
      );
      if (!touchesMainRoad) continue;
      const marinaVar = pickEstablishmentVariation(state, 'river_marina');
      const placedMarina = tryPlaceEstablishmentFootprint(
        state,
        st.x,
        st.y,
        marinaSpec,
        1,
        marinaVar,
        true
      );
      if (placedMarina) {
        pushNews(
          state,
          `Marina na Beira do Rio ${marinaSpec.footprintW}×${marinaSpec.footprintH} (Var. ${marinaVar + 1}) inaugurada! Píeres e embarcações movimentam o lazer náutico!`,
          'good'
        );
        break;
      }
    }
  }

  // 3. Major Civic Landmarks (Stadiums, Ports, Airports, Sports Centers & Bridge upgrades)
  // are unlocked by Civic Milestones and built ONLY when the player has funds and orders them in Obras.
  // 4. Natural + Accelerated Evolutionary Breakthrough Charge ("Salto Evolutivo")
  // Calibrated for long-term pacing so breakthroughs feel like genuine multi-year milestones!
  for (const area of BUDGET_AREA_ORDER) {
    const covPct = state.stats.coverage[area].coveragePct;
    let gain = 0;

    if (covPct >= 65) {
      const naturalRate = 0.16 + Math.min(100, covPct) * 0.0042;
      const overInvestAccel = covPct > 100 ? (covPct - 100) * 0.055 : 0;
      gain = Math.min(10, (naturalRate + overInvestAccel) * eventMods.growthMult);
    } else if (covPct >= 40) {
      gain = 0.08;
    } else if (state.breakthroughCharge[area] > 0) {
      gain = -0.5;
    }

    if (gain !== 0) {
      state.breakthroughCharge[area] = Math.max(
        0,
        Math.min(100, (state.breakthroughCharge[area] ?? 0) + gain)
      );
      if (state.breakthroughCharge[area] >= 100) {
        triggerSystemBreakthrough(state, area);
      }
    }
  }

  // 5. Sustained Building Evolution (Lv1 -> Lv2 -> Lv3), Decay (Abandonment), & Gradual Recovery
  let upgradesThisTick = 0;
  for (let b = 0; b < buildings.length; b++) {
    const tile = buildings[b];
    if (!tile || tile.lotRole === 'part') continue;
    const adj = countAdjacentTypes(state, tile.x, tile.y);

    if (tile.type === 'abandoned') {
      const taxOk = state.taxes.residential <= fairTax + 1.5;
      if (state.money >= 0 && taxOk && tile.pollution < 45 && state.globalHappiness >= 48) {
        const recChance =
          GROWTH_CONFIG.baseRecoveryChance + secCov * 0.11 + wellCov * 0.04;
        if (nextRandom(state) < recChance) {
          const restoredType = tile.previousType ?? 'residential';
          for (const ct of getCompoundTiles(state, tile)) {
            ct.type = restoredType;
            ct.level = 1;
            ct.age = 0;
            ct.evolutionProgress = 0;
            ct.upgradeCooldown = GROWTH_CONFIG.upgradeCooldownLv1To2;
            ct.evolveFlash = 1.75;
          }
        }
      }
      continue;
    }

    if (tile.type === 'park' || isLandmarkType(tile.type) || isTransitStationType(tile.type)) continue;

    const sectorTaxExcess =
      tile.type === 'residential'
        ? state.taxes.residential - fairTax
        : tile.type === 'commercial'
          ? state.taxes.commercial - (fairTax + 0.5)
          : state.taxes.industrial - (fairTax + 1.0);

    let decayRisk = 0;
    if (
      (tile.type === 'residential' || tile.type === 'commercial') &&
      tile.pollution >= GROWTH_CONFIG.dangerPollutionThreshold
    ) {
      decayRisk += (tile.pollution - GROWTH_CONFIG.dangerPollutionThreshold) * 0.0045;
    }
    if (sectorTaxExcess >= 2.5) {
      decayRisk += (sectorTaxExcess - 2.0) * 0.015;
    }
    if (state.money < 0) {
      decayRisk += 0.04;
    }
    if (state.globalHappiness < 42) {
      decayRisk += (42 - state.globalHappiness) * 0.0028;
    }
    if (adj.abandoned >= 2) {
      decayRisk += 0.022;
    }
    if (secCov < 0.45 && tile.age > 14) {
      decayRisk += (0.45 - secCov) * 0.045;
    }
    if (tile.type === 'residential' && entCov < 0.40 && tile.age > 18) {
      decayRisk += (0.40 - entCov) * 0.028;
    }
    // High Cultura & Lazer boosts resident retention and reduces urban churn
    if (tile.type === 'residential' && entCov > 1.05) {
      decayRisk *= Math.max(0.72, 1 - (entCov - 1.0) * 0.85);
    }

    if (decayRisk > 0) {
      const securityMitigation = 1 / (1 + secCov * 2.4);
      const effectiveMitigation =
        sectorTaxExcess >= 4 ? Math.max(0.55, securityMitigation) : securityMitigation;
      const finalDecayChance =
        decayRisk * effectiveMitigation * revitShield * tm.decayMultiplier;

      if (nextRandom(state) < finalDecayChance) {
        const compoundTiles = getCompoundTiles(state, tile);
        for (const ct of compoundTiles) {
          ct.previousType = ct.type as 'rural' | 'residential' | 'commercial' | 'industrial';
          ct.type = 'abandoned';
          ct.level = 1;
          ct.age = 0;
          ct.evolutionProgress = 0;
          ct.upgradeCooldown = 6;
          ct.evolveFlash = 0.85;
        }
        if (nextRandom(state) < 0.35) {
          state.pendingSounds.push({ type: 'decay' });
          pushNews(
            state,
            sectorTaxExcess >= 2.5
              ? 'Impostos abusivos causam êxodo e prédios abandonados na cidade!'
              : tile.pollution >= GROWTH_CONFIG.dangerPollutionThreshold
                ? 'Poluição elevada provoca abandono de imóvel em Pixópolis!'
                : state.money < 0
                  ? 'Caixa negativo gera decadência urbana em Pixópolis!'
                  : 'Baixa segurança provoca abandono de imóvel na cidade.',
            'warning'
          );
        }
        continue;
      }
    }

    // Rural zone slow urbanization when encircled by dense city core, or modernization Lv1->Lv2->Lv3
    if (tile.type === 'rural') {
      const urbanNeighbors = adj.residential + adj.commercial + adj.industrial;
      if (
        urbanNeighbors >= 5 &&
        tile.age >= GROWTH_CONFIG.minAgeForUpgrade &&
        (tile.upgradeCooldown ?? 0) <= 0 &&
        nextRandom(state) < 0.045
      ) {
        const compoundTiles = getCompoundTiles(state, tile);
        const newType: TileType = adj.commercial >= 2 ? 'commercial' : 'residential';
        for (const ct of compoundTiles) {
          ct.type = newType;
          ct.level = 1;
          ct.age = 0;
          ct.evolutionProgress = 0;
          ct.upgradeCooldown = GROWTH_CONFIG.upgradeCooldownLv1To2;
          ct.evolveFlash = 1.75;
        }
        continue;
      }
    }

    // Residential buildings stop at Prédio Médio (Lv. 2) when condoPolicy === 'manual',
    // letting the player choose which mid-rises become Condomínios (or switch to 'auto' in BudgetModal)!
    const maxTargetLv =
      !tile.establishmentId && tile.type === 'residential'
        ? state.condoPolicy === 'auto'
          ? 4
          : 2
        : !tile.establishmentId && tile.type === 'commercial'
          ? 4
          : 3;

    if (
      (tile.type === 'rural' ||
        tile.type === 'residential' ||
        tile.type === 'commercial' ||
        tile.type === 'industrial') &&
      tile.level < maxTargetLv
    ) {
      const targetLevel = tile.level + 1;
      const cooldownLeft = tile.upgradeCooldown ?? 0;
      const baseMinAge =
        targetLevel >= 4
          ? GROWTH_CONFIG.minAgeForUpgradeLv4
          : targetLevel === 3
            ? GROWTH_CONFIG.minAgeForUpgradeLv3
            : GROWTH_CONFIG.minAgeForUpgrade;
      const minAgeRequired = tile.establishmentId ? baseMinAge + 6 : baseMinAge;
      const requiredProgress =
        targetLevel >= 4
          ? GROWTH_CONFIG.requiredProgressLv4
          : targetLevel === 3
            ? GROWTH_CONFIG.requiredProgressLv3
            : GROWTH_CONFIG.requiredProgressLv2;

      // Cooldown & minimum maturity gate: cannot pre-accumulate evolution before settling
      if (cooldownLeft > 0 || tile.age < minAgeRequired) {
        continue;
      }

      // Treasury deficit always erodes accumulated evolution progress immediately
      if (state.money < 0 && (tile.evolutionProgress ?? 0) > 0) {
        const decayed = Math.max(0, (tile.evolutionProgress ?? 0) - 4);
        for (const ct of getCompoundTiles(state, tile)) {
          ct.evolutionProgress = decayed;
        }
        continue;
      }

      // Hybrid Neighborhood Maturity + Population Milestone Gate:
      // 1) Lv. 1 -> Lv. 2: A 12×12 region around the house/building MUST have all buildable lots filled at >= Lv. 1,
      //    after which lots evolve gradually one-by-one.
      // 2) Lv. 2 -> Lv. 3 (Prédios Grandes): Requires 10,000+ inhabitants (Marco de Verticalização) + consolidated 12×12 neighborhood.
      // 3) Lv. 3 -> Lv. 4 (Arranha-Céus 2×2 / Mega Condomínios): Requires 30,000+ inhabitants (Marco Metropolitano) + mature 12×12 + Avenida Larga 2×2.
      const maturity = getNeighborhoodMaturity(state, tile.x, tile.y);
      if (tile.type !== 'rural') {
        if (!maturity.region12AllLevel1) {
          continue;
        }
        if (targetLevel === 3) {
          if (state.totalPopulation < URBAN_MATURITY_CONFIG.largeBuildingMinPopulation) {
            continue;
          }
          // Neighborhood must be compactly filled and peers must have started maturing to Lv. 2+
          if (maturity.fillRatio < 0.55 || (maturity.builtLots >= 3 && maturity.peerLv2Ratio < 0.35)) {
            continue;
          }
          if (maturity.sameZoneDirectLv1Count >= 2 && maturity.lv2PlusCount < 2) {
            continue;
          }
        }
      }

      // Level 4 (2×2 Skyscraper / Mega Condomínio) requires Marco de 30.000 habitantes,
      // a mature 12×12 neighborhood, a valid 2×2 city block slot, AND a 2-tile-thick Wide Avenue (2×2)!
      let skyscraper2x2Slot: { ax: number; ay: number } | null = null;
      if (targetLevel === 4) {
        if (state.totalPopulation < URBAN_MATURITY_CONFIG.skyscraperMinPopulation) continue;
        if (
          !maturity.region12AllLevel1 ||
          maturity.fillRatio < 0.65 ||
          maturity.avgLevel < 2.0 ||
          maturity.sameZoneDirectLv1Count > 0
        ) {
          continue;
        }
        skyscraper2x2Slot = findSkyscraper2x2SlotForTile(state, tile);
        if (!skyscraper2x2Slot) continue;
        if (!isAdjacentToWideAvenue2x2(state, skyscraper2x2Slot.ax, skyscraper2x2Slot.ay, 2, 2)) {
          continue;
        }
      }

      const nearbyBuilt = adj.residential + adj.commercial + adj.park + adj.landmark;
      const driverCoverage =
        tile.type === 'residential'
          ? wellCov * 0.4 + eduCov * 0.35 + infraCov * 0.25
          : tile.type === 'commercial'
            ? entCov * 0.4 + infraCov * 0.35 + eduCov * 0.25
            : tile.type === 'industrial'
              ? infraCov * 0.65 + eduCov * 0.35
              : infraCov * 0.6 + wellCov * 0.4;

      const minDriverRequired =
        tile.type === 'rural'
          ? targetLevel === 3
            ? 0.52
            : 0.38
          : targetLevel >= 4
            ? 0.74
            : targetLevel === 3
              ? 0.66
              : 0.48;
      const maxAllowedPollution =
        tile.type === 'industrial' ? 82 : targetLevel >= 4 ? 24 : targetLevel === 3 ? 28 : 34;
      const maxAllowedTaxExcess = targetLevel >= 4 ? 0.9 : targetLevel === 3 ? 1.2 : 1.8;
      const minHappinessRequired =
        tile.type === 'industrial' || tile.type === 'rural'
          ? targetLevel === 3
            ? 56
            : 46
          : targetLevel >= 4
            ? 68
            : targetLevel === 3
              ? 62
              : 52;
      const minLandValueRequired =
        tile.type === 'industrial' || tile.type === 'rural'
          ? targetLevel === 3
            ? 24
            : 12
          : targetLevel >= 4
            ? 56
            : targetLevel === 3
              ? 46
              : 24;
      const minNeighborsRequired =
        tile.type === 'rural'
          ? targetLevel === 3
            ? 1
            : 0
          : targetLevel >= 3
            ? 3
            : 1;
      const minInfraHigh =
        targetLevel >= 4
          ? state.trait.id === 'tech_boom'
            ? 0.56
            : 0.75
          : state.trait.id === 'tech_boom'
            ? 0.48
            : 0.68;

      const sustainedConditionsMet =
        state.money >= 0 &&
        tile.pollution <= maxAllowedPollution &&
        sectorTaxExcess <= maxAllowedTaxExcess &&
        state.globalHappiness >= minHappinessRequired &&
        tile.landValue >= minLandValueRequired &&
        driverCoverage >= minDriverRequired &&
        nearbyBuilt >= minNeighborsRequired &&
        (targetLevel < 3 || infraCov >= minInfraHigh);

      const compoundTiles = getCompoundTiles(state, tile);

      if (!sustainedConditionsMet) {
        // Unfavorable conditions gradually erode accumulated progress (must be sustained continuously!)
        if ((tile.evolutionProgress ?? 0) > 0) {
          const decayed = Math.max(0, (tile.evolutionProgress ?? 0) - 4);
          for (const ct of compoundTiles) {
            ct.evolutionProgress = decayed;
          }
        }
        continue;
      }

      // Accumulate sustained progression proportional to service quality, land value, parks & peer catch-up
      const parkBonus = adj.park > 0 || adj.landmark > 0 ? 1.22 : 1.0;
      const peerCatchupBonus = maturity.avgLevel > tile.level + 0.35 ? 1.45 : 1.0;
      const transitBonus =
        state.stats.metroStationCount > 0 ? 1.15 : state.stats.busStationCount > 0 ? 1.08 : 1.0;
      const happyMult =
        state.globalHappiness >= 75 ? 1.2 : state.globalHappiness >= 60 ? 1.0 : 0.85;
      const valueMult = 0.85 + Math.min(0.4, (tile.landValue / 100) * 0.4);
      const demandMult = sectorTaxExcess < -1.0 ? 1.2 : 1.0;
      const baseRate = targetLevel >= 4 ? 2.4 : targetLevel === 3 ? 3.0 : 3.9;
      const progressGain =
        baseRate *
        (0.75 + driverCoverage * 0.55) *
        parkBonus *
        peerCatchupBonus *
        transitBonus *
        happyMult *
        valueMult *
        demandMult *
        tm.upgradeMultiplier *
        eventMods.growthMult;

      const nextProgress = Math.min(
        requiredProgress + 24,
        (tile.evolutionProgress ?? 0) + progressGain
      );
      for (const ct of compoundTiles) {
        ct.evolutionProgress = nextProgress;
      }

      if (nextProgress < requiredProgress) {
        continue;
      }

      if (upgradesThisTick >= maxUpgradesThisTick) {
        continue;
      }

      const readinessRoll =
        (GROWTH_CONFIG.baseUpgradeChance * 12 + driverCoverage * 0.25) *
        (targetLevel >= 4 ? 0.58 : targetLevel === 3 ? 0.72 : 1.0) *
        peerCatchupBonus *
        tm.upgradeMultiplier;

      if (nextRandom(state) < Math.min(0.68, readinessRoll)) {
        upgradesThisTick++;
        const nextCooldown =
          targetLevel >= 3
            ? GROWTH_CONFIG.upgradeCooldownLv3To4
            : targetLevel >= 2
              ? GROWTH_CONFIG.upgradeCooldownLv2To3
              : GROWTH_CONFIG.upgradeCooldownLv1To2;

        // Synchronized neighborhood peer nudge: when a building evolves, nearby peer lots of the same zone
        // gain momentum so the whole bairro grows together!
        let nudgedPeers = 0;
        for (let dy = -2; dy <= 2 && nudgedPeers < 3; dy++) {
          for (let dx = -2; dx <= 2 && nudgedPeers < 3; dx++) {
            if (dx === 0 && dy === 0) continue;
            const peer = getTile(state, tile.x + dx, tile.y + dy);
            if (
              peer &&
              peer.lotRole !== 'part' &&
              peer.type === tile.type &&
              peer.level === tile.level
            ) {
              peer.evolutionProgress = (peer.evolutionProgress ?? 0) + 32;
              peer.upgradeCooldown = Math.max(0, (peer.upgradeCooldown ?? 0) - 4);
              nudgedPeers++;
            }
          }
        }

        if (targetLevel === 4 && skyscraper2x2Slot) {
          const built = assignCompoundLot(
            state,
            skyscraper2x2Slot.ax,
            skyscraper2x2Slot.ay,
            2,
            2,
            tile.type,
            4,
            tile.variant,
            1.8
          );
          for (const ct of built) {
            ct.upgradeCooldown = nextCooldown;
          }
          const anchor = built[0];
          if (anchor) {
            state.pendingSounds.push({ type: 'level3' });
            const helipadTag = hasSkyscraperHelipad(anchor) ? ' com heliporto' : '';
            pushNews(
              state,
              `Novo Arranha-Céu Supremo 2×2${helipadTag} erguido no coração de Pixópolis!`,
              'milestone'
            );
          }
          continue;
        }

        const prevEstId = tile.establishmentId;
        let evolvedEstId = tile.establishmentId;
        let evolvedVar = tile.variant;

        // Check if an upgrading residential/commercial lot can graduate into a specialized Lv2/Lv3 establishment!
        let placedMultiTileEst = false;
        if (
          !prevEstId &&
          (tile.type === 'residential' || tile.type === 'commercial') &&
          compoundTiles.length === 1 &&
          (targetLevel === 2 || targetLevel === 3) &&
          nextRandom(state) < 0.38
        ) {
          const estPick = tryPickOrganicEstablishment(
            state,
            tile.x,
            tile.y,
            tile.type,
            targetLevel as 2 | 3,
            tile
          );
          if (estPick) {
            const spec = ESTABLISHMENT_MAP[estPick.establishmentId];
            if (spec) {
              const placed = tryPlaceEstablishmentFootprint(
                state,
                tile.x,
                tile.y,
                spec,
                targetLevel,
                estPick.variant,
                true
              );
              if (placed) {
                placedMultiTileEst = true;
                evolvedEstId = estPick.establishmentId;
                evolvedVar = estPick.variant;
              }
            }
          }
        }

        if (!placedMultiTileEst) {
          for (const ct of compoundTiles) {
            ct.level = targetLevel;
            ct.variant = evolvedVar;
            ct.establishmentId = evolvedEstId;
            ct.age = 0;
            ct.evolutionProgress = 0;
            ct.upgradeCooldown = nextCooldown;
            ct.evolveFlash = 1.75;
          }
        }

        // Gradually consolidate single-lot non-establishment buildings into 2x1 / 1x2 compounds in high-value blocks
        if (
          !evolvedEstId &&
          (tile.type === 'residential' || tile.type === 'commercial' || tile.type === 'industrial') &&
          (tile.lotWidth ?? 1) === 1 &&
          (tile.lotHeight ?? 1) === 1 &&
          nextRandom(state) < 0.30
        ) {
          const east = getTile(state, tile.x + 1, tile.y);
          const south = getTile(state, tile.x, tile.y + 1);
          const canAbsorbNeighbor = (nb: Tile | null) => {
            if (!nb || nb.construction || nb.establishmentId) return false;
            if (classifyPlannedRoadCell(state, nb.x, nb.y).isPlanned) return false;
            if ((nb.lotWidth ?? 1) !== 1 || (nb.lotHeight ?? 1) !== 1) return false;
            if (nb.type === tile.type) return true;
            if (nb.type === 'abandoned' || nb.type === 'rural') return true;
            if (
              targetLevel >= 2 &&
              tile.landValue >= 48 &&
              (nb.type === 'residential' || nb.type === 'commercial') &&
              nb.level === 1 &&
              nb.level < targetLevel
            ) {
              return true;
            }
            return false;
          };

          if (canAbsorbNeighbor(east)) {
            assignCompoundLot(
              state,
              tile.x,
              tile.y,
              2,
              1,
              tile.type,
              targetLevel,
              tile.variant,
              1.3
            );
          } else if (canAbsorbNeighbor(south)) {
            assignCompoundLot(
              state,
              tile.x,
              tile.y,
              1,
              2,
              tile.type,
              targetLevel,
              tile.variant,
              1.3
            );
          }
        }

        if (evolvedEstId && evolvedEstId !== prevEstId) {
          const spec = ESTABLISHMENT_MAP[evolvedEstId];
          if (spec && targetLevel >= 2) {
            state.pendingSounds.push({ type: 'level3' });
            const sizeTag =
              spec.footprintW > 1 || spec.footprintH > 1
                ? ` (${spec.footprintW}×${spec.footprintH})`
                : '';
            pushNews(
              state,
              `${spec.label}${sizeTag} (Var. ${(evolvedVar % 3) + 1}) inaugurado em Pixópolis!`,
              'good'
            );
          }
        } else if (targetLevel === 3) {
          state.pendingSounds.push({ type: 'level3' });
          const label =
            tile.type === 'commercial'
              ? 'Novo arranha-céu espelhado inaugurado em Pixópolis!'
              : tile.type === 'industrial'
                ? 'Complexo industrial de alta tecnologia inaugurado em Pixópolis!'
                : tile.type === 'rural'
                  ? 'Agroindústria moderna concluída no cinturão verde!'
                  : 'Novo edifício residencial de alto padrão erguido na cidade!';
          pushNews(state, label, 'good');
        }
      }
    }
  }

  recomputeFieldsAndStats(state);
  const newlyUnlockedMilestones = evaluateCivicMilestones(state);
  if (newlyUnlockedMilestones.length > 0) {
    recomputeFieldsAndStats(state);
  }
  if (
    state.recentMilestoneBanner &&
    state.tick - state.recentMilestoneBanner.triggeredAtTick >= 6
  ) {
    state.recentMilestoneBanner = null;
  }
  checkEmergentNews(state);
}

/** Compute live progression statuses for all population-based Civic Milestones */
export function getCivicMilestoneStatuses(state: CityState): CivicMilestoneStatus[] {
  const pop = state.totalPopulation;
  let maxPortLv = 0;
  let maxAirportLv = 0;
  let maxShoppingLv = 0;
  for (let i = 0; i < state.tiles.length; i++) {
    const t = state.tiles[i];
    if (t.type === 'port' && t.level > maxPortLv) maxPortLv = t.level;
    if (t.type === 'airport' && t.level > maxAirportLv) maxAirportLv = t.level;
    if (t.type === 'shopping' && t.level > maxShoppingLv) maxShoppingLv = t.level;
  }

  return CIVIC_MILESTONES.map((m) => {
    const legacy20k =
      (m.id === 'civic_stadium_20k' || m.id === 'civic_toll_20k') &&
      Boolean(state.milestonesReached.civic_stadium_toll_20k);
    const unlocked = Boolean(state.milestonesReached[m.id] || legacy20k);
    const progressPct = unlocked
      ? 100
      : Math.max(0, Math.min(99, Math.floor((pop / Math.max(1, m.populationTarget)) * 100)));

    let built = false;
    if (m.id === 'civic_port_lv1') built = state.stats.portCount >= 1;
    else if (m.id === 'civic_port_lv2') built = maxPortLv >= 2;
    else if (m.id === 'civic_port_lv3') built = maxPortLv >= 3;
    else if (m.id === 'civic_sports_small') built = state.stats.sportsCenterCount >= 1;
    else if (m.id === 'civic_bus_system') built = state.stats.busStationCount >= 1;
    else if (m.id === 'civic_metro_system') built = state.stats.metroStationCount >= 1;
    else if (m.id === 'civic_bridge_lv2') built = unlocked || state.stats.bridgeLevel >= 2;
    else if (m.id === 'civic_bridge_lv3') built = unlocked || state.stats.bridgeLevel >= 3;
    else if (m.id === 'civic_bridge_lv4') built = unlocked || state.stats.bridgeLevel >= 4;
    else if (m.id === 'civic_airport_lv1') built = state.stats.airportCount >= 1;
    else if (m.id === 'civic_airport_lv2') built = maxAirportLv >= 2;
    else if (m.id === 'civic_airport_lv3') built = maxAirportLv >= 3;
    else if (m.id === 'civic_shopping_lv1') built = state.stats.shoppingCount >= 1;
    else if (m.id === 'civic_shopping_lv2') built = maxShoppingLv >= 2;
    else if (m.id === 'civic_shopping_lv3') built = maxShoppingLv >= 3;
    else if (m.id === 'civic_vertical_10k') built = unlocked;
    else if (m.id === 'civic_stadium_20k') built = state.stats.stadiumCount >= 1;
    else if (m.id === 'civic_toll_20k') built = Boolean(state.tollPlaza?.built);

    return {
      id: m.id,
      populationTarget: m.populationTarget,
      kind: m.kind,
      title: m.title,
      subtitle: m.subtitle,
      rewardCash: m.rewardCash,
      unlocked,
      progressPct,
      actionId: m.actionId,
      built,
    };
  });
}

/** Dismiss the floating milestone celebration banner */
export function dismissMilestoneBanner(state: CityState): void {
  state.recentMilestoneBanner = null;
}

/**
 * Evaluate population-based Civic Milestones automatically:
 * Unlocks staged population milestones (1.2k -> 30k+), awards civic grants,
 * automatically upgrades river bridges on bridge milestones, and notifies the mayor!
 */
export function evaluateCivicMilestones(state: CityState): string[] {
  const triggered: string[] = [];
  const pop = state.totalPopulation;
  const legacy20k = Boolean(state.milestonesReached.civic_stadium_toll_20k);

  for (const m of CIVIC_MILESTONES) {
    if (pop < m.populationTarget || state.milestonesReached[m.id]) continue;

    if (legacy20k && (m.id === 'civic_stadium_20k' || m.id === 'civic_toll_20k')) {
      state.milestonesReached[m.id] = true;
      continue;
    }

    state.milestonesReached[m.id] = true;
    state.money += m.rewardCash;

    if (m.id === 'civic_bridge_lv2') {
      upgradeAllBridges(state, 2);
    } else if (m.id === 'civic_bridge_lv3') {
      upgradeAllBridges(state, 3);
    } else if (m.id === 'civic_bridge_lv4') {
      upgradeAllBridges(state, 4);
    }

    state.recentMilestoneBanner = {
      id: m.id,
      kind: m.kind,
      populationTarget: m.populationTarget,
      title: m.title,
      subtitle: m.subtitle,
      rewardCash: m.rewardCash,
      triggeredAtTick: state.tick,
      actionId: m.actionId,
    };

    state.pendingSounds.push({ type: m.kind === 'bridge' ? 'bridge' : 'milestone' });
    pushNews(
      state,
      m.actionId
        ? `MARCO CÍVICO (${m.populationTarget.toLocaleString('pt-BR')} hab): ${m.title} (+$${m.rewardCash.toLocaleString('pt-BR')}) — disponível para construir em Obras!`
        : `MARCO CÍVICO (${m.populationTarget.toLocaleString('pt-BR')} hab): ${m.title} (+$${m.rewardCash.toLocaleString('pt-BR')}) — evolução automática ativada!`,
      'milestone'
    );
    triggered.push(m.id);
  }

  // Keep any existing river bridges aligned with already-reached automatic bridge milestones
  const targetAutoBridgeLv = state.milestonesReached.civic_bridge_lv4
    ? 4
    : state.milestonesReached.civic_bridge_lv3
      ? 3
      : state.milestonesReached.civic_bridge_lv2
        ? 2
        : 1;
  if (targetAutoBridgeLv >= 2 && state.stats.bridgeCount > 0 && state.stats.bridgeLevel < targetAutoBridgeLv) {
    upgradeAllBridges(state, targetAutoBridgeLv);
  }

  return triggered;
}

/**
 * Automatically run Environmental Cleanup, Revitalization, and Tourism Festival
 * campaigns based on sustained budget investments in their linked city segments.
 */
function evaluateBudgetDrivenCampaigns(state: CityState): void {
  const evaluated = evaluateBudgetCampaignStatus(state.stats.coverage, state.money);

  for (const item of evaluated) {
    if (!item.eligible || item.tier <= 0) continue;

    const { spec, tier, tierTitle } = item;
    const duration = tier >= 3 ? 3 : 2;
    const existing = state.activeBoosts.find((b) => b.actionId === spec.id);
    const wasActive = Boolean(existing);

    if (existing) {
      existing.remainingMonths = Math.max(existing.remainingMonths, duration);
      existing.totalMonths = Math.max(existing.totalMonths ?? duration, duration);
      if (tier > existing.tier) {
        existing.tier = tier;
      }
      existing.label = tierTitle;
    } else {
      state.activeBoosts.push({
        id: `auto_${spec.id}_${state.tick}_${state.month}`,
        actionId: spec.id,
        label: tierTitle,
        tier,
        remainingMonths: duration,
        totalMonths: duration,
      });
    }

    if (spec.id === 'environmental_cleanup') {
      const targetParkCap = Math.max(6, Math.floor(state.totalPopulation / 260) + 4);
      if (
        (!wasActive && state.stats.parkCount < targetParkCap) ||
        state.stats.avgPollution >= 16
      ) {
        plantImmediateParks(state, tier >= 3 ? 2 : 1);
      }
      if (!wasActive) {
        pushNews(
          state,
          `${tierTitle} em ação! Bons investimentos em Saúde & Meio Ambiente e Educação purificam a cidade.`,
          'good'
        );
      }
    } else if (spec.id === 'revitalization') {
      let recovered = 0;
      if (state.stats.abandonedCount > 0) {
        const abandonedTiles = state.tiles.filter(
          (t) => t.type === 'abandoned' && !t.construction
        );
        const maxRestore = Math.min(tier * 2, abandonedTiles.length);
        for (let i = 0; i < maxRestore; i++) {
          const t = abandonedTiles[i];
          t.type = t.previousType ?? 'residential';
          t.level = tier >= 2 && t.type !== 'industrial' ? 2 : 1;
          t.age = 0;
          t.evolveFlash = 1.75;
          recovered++;
        }
      }
      if (!wasActive && tier >= 3) {
        upgradeTopBuildings(state, 1);
      }
      if (!wasActive || recovered > 0) {
        pushNews(
          state,
          recovered > 0
            ? `${tierTitle} automática recuperou ${recovered} ${recovered === 1 ? 'imóvel abandonado' : 'imóveis abandonados'}!`
            : `${tierTitle} ativa graças ao investimento em Segurança e Infraestrutura!`,
          'good'
        );
      }
    } else if (spec.id === 'tourism_festival') {
      if (!wasActive && tier >= 3) {
        upgradeTopBuildings(state, 1, 'commercial');
      }
      if (!wasActive) {
        pushNews(
          state,
          `${tierTitle} em andamento! Investimentos em Turismo & Comércio e Cultura & Lazer atraem visitantes.`,
          'milestone'
        );
      }
    }
  }
}

/**
 * Monthly financial settlement, migration wave/exodus, emergency boost decay,
 * economic cycle & urban incident rolling, calendar rollover, and 12-month history recording.
 */
export function closeFinancialMonth(state: CityState): void {
  recomputeFieldsAndStats(state);

  const fairTax = state.financials.fairTaxRate;
  const resExcess = state.taxes.residential - fairTax;

  if (resExcess >= 3.0 || state.globalHappiness < 36) {
    const exodusSeverity = Math.min(
      3,
      Math.max(
        1,
        Math.floor(
          (Math.max(0, resExcess - 2) + Math.max(0, (38 - state.globalHappiness) / 10)) *
            0.7
        )
      )
    );
    const activeRes = state.tiles.filter(
      (t) => t.type === 'residential' || t.type === 'commercial'
    );
    let leftCount = 0;
    for (let i = 0; i < exodusSeverity && activeRes.length > 2; i++) {
      const idx = Math.floor(nextRandom(state) * activeRes.length);
      const victim = activeRes.splice(idx, 1)[0];
      victim.previousType = victim.type as 'residential' | 'commercial';
      victim.type = 'abandoned';
      victim.level = 1;
      victim.age = 0;
      victim.evolveFlash = 1.0;
      leftCount++;
    }
    if (leftCount > 0) {
      state.pendingSounds.push({ type: 'decay' });
      pushNews(
        state,
        `Impostos altos (${state.taxes.residential}%) provocam saída de moradores no fechamento do mês!`,
        'warning'
      );
    }
  } else if (
    (resExcess <= -1.5 && state.globalHappiness >= 64) ||
    (getCovRatio(state, 'entertainment') >= 1.1 &&
      resExcess <= -0.4 &&
      state.globalHappiness >= 68)
  ) {
    const openSlots: Tile[] = [];
    for (const t of state.tiles) {
      if (
        (t.type === 'grass' || t.type === 'forest') &&
        t.pollution < 26 &&
        !classifyPlannedRoadCell(state, t.x, t.y).isPlanned &&
        getOrthoNeighbors(state, t.x, t.y).some((nt) => nt.type === 'road')
      ) {
        openSlots.push(t);
      }
    }
    const cultureArrivalCap = getCovRatio(state, 'entertainment') >= 1.15 ? 2 : 1;
    const arrivals = Math.min(cultureArrivalCap, openSlots.length);
    for (let i = 0; i < arrivals; i++) {
      const idx = Math.floor(nextRandom(state) * openSlots.length);
      const slot = openSlots.splice(idx, 1)[0];
      slot.type = nextRandom(state) < 0.72 ? 'residential' : 'commercial';
      slot.level = 1;
      slot.age = 0;
      slot.evolutionProgress = 0;
      slot.upgradeCooldown = GROWTH_CONFIG.upgradeCooldownLv1To2;
      slot.variant = Math.floor(nextRandom(state) * 4);
      slot.evolveFlash = 1.75;
    }
  }

  recomputeFieldsAndStats(state);

  const net = state.financials.netBalance;
  const rev = state.financials.revenue.total;
  const exp = state.financials.expenses.total;
  state.money += net;

  state.lastMigrationDelta = state.totalPopulation - state.prevMonthPopulation;
  state.prevMonthPopulation = state.totalPopulation;

  if (state.activeBoosts.length > 0) {
    const remaining: CityBoost[] = [];
    for (const boost of state.activeBoosts) {
      boost.remainingMonths -= 1;
      if (boost.remainingMonths > 0) {
        remaining.push(boost);
      }
    }
    state.activeBoosts = remaining;
  }

  evaluateBudgetDrivenCampaigns(state);

  // Advance / complete multi-month public works under construction!
  if (state.pendingWorks && state.pendingWorks.length > 0) {
    const stillBuilding: PendingConstructionWork[] = [];
    const completedNow: PendingConstructionWork[] = [];
    for (const work of state.pendingWorks) {
      work.remainingMonths = Math.max(0, (work.remainingMonths ?? 1) - 1);
      syncWorkTilesRemainingMonths(state, work);
      if (work.remainingMonths <= 0) {
        completedNow.push(work);
      } else {
        stillBuilding.push(work);
      }
    }
    state.pendingWorks = stillBuilding;
    for (const doneWork of completedNow) {
      finalizePendingWork(state, doneWork);
    }
  }

  // Advance / expire active Economic Cycles & Urban Incidents
  if (state.activeEconomicEvent) {
    state.activeEconomicEvent.remainingMonths -= 1;
    if (state.activeEconomicEvent.remainingMonths <= 0) {
      const ended = state.activeEconomicEvent.title;
      state.activeEconomicEvent = null;
      pushNews(state, `Ciclo encerrado: "${ended}" chegou ao fim.`, 'info');
    }
  }
  if (state.activeUrbanIncident) {
    state.activeUrbanIncident.remainingMonths -= 1;
    if (state.activeUrbanIncident.remainingMonths <= 0) {
      const ended = state.activeUrbanIncident.title;
      state.activeUrbanIncident = null;
      pushNews(state, `Normalizado: "${ended}" foi superado pelas equipes municipais.`, 'good');
    }
  }

  state.economicEventCooldownMonths = Math.max(0, (state.economicEventCooldownMonths ?? 0) - 1);
  state.urbanIncidentCooldownMonths = Math.max(0, (state.urbanIncidentCooldownMonths ?? 0) - 1);

  state.month += 1;
  if (state.month > 12) {
    state.month = 1;
    state.year += 1;
  }

  // Roll new Random Economic Cycles & Urban Incidents (starting after the grace period in late Year 1)
  const totalMonthsElapsed = (state.year - START_YEAR) * 12 + (state.month - START_MONTH);
  if (totalMonthsElapsed >= 9) {
    if (!state.activeEconomicEvent && (state.economicEventCooldownMonths ?? 0) <= 0) {
      if (nextRandom(state) < 0.14) {
        const roll = nextRandom(state);
        const nextEcon: EconomicEventId =
          roll < 0.42 ? 'recession' : roll < 0.80 ? 'inflation' : 'economic_boom';
        triggerRandomEvent(state, nextEcon);
      }
    }
    if (!state.activeUrbanIncident && (state.urbanIncidentCooldownMonths ?? 0) <= 0) {
      if (nextRandom(state) < 0.12) {
        const roll = nextRandom(state);
        const nextUrban: UrbanIncidentId =
          roll < 0.36 ? 'severe_storm' : roll < 0.68 ? 'blackout' : 'urgent_repairs';
        triggerRandomEvent(state, nextUrban);
      }
    }
  }

  recomputeFieldsAndStats(state);
  evaluateCivicMilestones(state);

  state.history.push({
    dateLabel: formatDateLabel(state.month, state.year),
    month: state.month,
    year: state.year,
    population: state.totalPopulation,
    money: Math.round(state.money),
    revenue: rev,
    expenses: exp,
    netBalance: net,
    happiness: state.globalHappiness,
    migrationDelta: state.lastMigrationDelta,
  });
  if (state.history.length > 12) {
    state.history.shift();
  }

  state.pendingSounds.push({ type: 'monthClose' });
  const sign = net >= 0 ? '+' : '-';
  const migText =
    state.lastMigrationDelta > 0
      ? ` · +${state.lastMigrationDelta} novos moradores`
      : state.lastMigrationDelta < 0
        ? ` · ${state.lastMigrationDelta} moradores saíram`
        : '';
  pushNews(
    state,
    `Fechamento mensal: ${sign}$${Math.abs(net).toLocaleString('pt-BR')} (Caixa: $${Math.round(state.money).toLocaleString('pt-BR')})${migText}.`,
    net < 0 || state.money < 0 ? 'warning' : 'info'
  );
}

/** Dynamic prioritized list of real city bottlenecks for the Report modal */
export function computeCityNeeds(state: CityState): CityNeedItem[] {
  const needs: CityNeedItem[] = [];
  const fairTax = state.financials.fairTaxRate;

  if (state.activeUrbanIncident) {
    const inc = state.activeUrbanIncident;
    needs.push({
      id: `urban_inc_${inc.id}`,
      severity: 'critical',
      title: `${inc.title} (${inc.remainingMonths}m restantes)`,
      detail: `${inc.effectHint}. Acione a intervenção emergencial em Obras para resolver imediatamente.`,
      targetTab: 'emergencies',
    });
  }

  if (state.activeEconomicEvent && state.activeEconomicEvent.id !== 'economic_boom') {
    const ec = state.activeEconomicEvent;
    needs.push({
      id: `econ_evt_${ec.id}`,
      severity: 'warning',
      title: `${ec.title} (${ec.remainingMonths}m restantes)`,
      detail: `${ec.effectHint}. Monitore seu caixa e revise alíquotas ou investimentos.`,
      targetTab: 'finances',
    });
  }

  if (state.totalPopulation >= TOLL_MIN_POPULATION && !state.tollPlaza?.built) {
    needs.push({
      id: 'toll_unlocked',
      severity: 'info',
      title: 'Praça de Pedágio liberada (20.000+ hab.)',
      detail: 'Construa o Pedágio na Rodovia Externa em Obras para gerar receita mensal com visitantes.',
      targetTab: 'emergencies',
    });
  }

  if (state.money < 0) {
    needs.push({
      id: 'cash_negative',
      severity: 'critical',
      title: 'Caixa municipal negativo',
      detail: `Saldo atual de -$${Math.abs(Math.round(state.money)).toLocaleString('pt-BR')}. Reduza investimentos mensais ou ajuste impostos.`,
      targetTab: 'finances',
    });
  } else if (state.financials.netBalance < -250) {
    needs.push({
      id: 'monthly_deficit',
      severity: 'warning',
      title: `Déficit mensal projetado (-$${Math.abs(state.financials.netBalance).toLocaleString('pt-BR')}/mês)`,
      detail: 'Despesas superam as receitas. Equilibre o orçamento geral ou ajuste alíquotas.',
      targetTab: 'finances',
    });
  }

  if (state.taxes.residential > fairTax + 1.8) {
    needs.push({
      id: 'tax_res_high',
      severity: state.taxes.residential >= fairTax + 3.5 ? 'critical' : 'warning',
      title: `Imposto Residencial (${state.taxes.residential}%) está causando saída de moradores`,
      detail: `Com os serviços atuais (${state.globalServiceCoverage}%), a tolerância justa é até ~${fairTax.toFixed(1)}%.`,
      targetTab: 'finances',
    });
  }
  if (state.taxes.commercial > fairTax + 2.5) {
    needs.push({
      id: 'tax_com_high',
      severity: 'warning',
      title: `Imposto Comercial (${state.taxes.commercial}%) está travando novas lojas`,
      detail: `Reduza para até ~${(fairTax + 0.5).toFixed(1)}% ou melhore serviços para reaquecer o comércio.`,
      targetTab: 'finances',
    });
  }
  if (state.taxes.industrial > fairTax + 3.0) {
    needs.push({
      id: 'tax_ind_high',
      severity: 'warning',
      title: `Imposto Industrial (${state.taxes.industrial}%) espanta fábricas`,
      detail: `Empresas evitam expandir quando a alíquota passa de ~${(fairTax + 1.0).toFixed(1)}%.`,
      targetTab: 'finances',
    });
  }

  if (state.stats.abandonedCount >= 2) {
    needs.push({
      id: 'city_abandoned',
      severity: state.stats.abandonedCount >= 4 ? 'critical' : 'warning',
      title: `Cidade tem ${state.stats.abandonedCount} prédios abandonados`,
      detail: 'Reforce Segurança e Infraestrutura no orçamento geral para ativar a Revitalização automática.',
      targetTab: 'budget',
    });
  }

  if (state.stats.avgPollution >= 26) {
    needs.push({
      id: 'city_pollution',
      severity: state.stats.avgPollution >= 40 ? 'critical' : 'warning',
      title: `Poluição urbana elevada (${state.stats.avgPollution}%)`,
      detail: 'Invista em Saúde & Meio Ambiente e Educação no orçamento para ativar o Mutirão Ambiental automático.',
      targetTab: 'budget',
    });
  }

  const checkAreas: BudgetAreaKey[] = [
    'security',
    'wellbeing',
    'infrastructure',
    'education',
    'entertainment',
    'tourism',
  ];
  for (const area of checkAreas) {
    const cov = state.stats.coverage[area];
    const label = BUDGET_AREA_META[area].label;
    if (cov.coveragePct < 75) {
      needs.push({
        id: `cov_${area}`,
        severity: cov.coveragePct < 48 ? 'critical' : 'warning',
        title: `Pressão em ${label} (${cov.coveragePct}% da necessidade)`,
        detail: `Investido: $${cov.invested.toLocaleString('pt-BR')}/mês · Necessário: $${cov.needed.toLocaleString('pt-BR')}/mês.`,
        targetTab: 'budget',
      });
    }
  }

  const rank = { critical: 0, warning: 1, info: 2 };
  needs.sort((a, b) => rank[a.severity] - rank[b.severity]);

  if (needs.length === 0) {
    needs.push({
      id: 'all_good',
      severity: 'info',
      title: 'Cidade em equilíbrio saudável',
      detail: 'Os Saltos Evolutivos avançam gradualmente. Clique em Prédios Médios no mapa para convertê-los em Condomínios quando desejar.',
      targetTab: 'budget',
    });
  }

  return needs.slice(0, 8);
}

// ============================================================================
// City Save / Load System (Multi-City localStorage Library + Portable JSON)
// ============================================================================

export const SAVE_STORAGE_KEY = 'pixopolis_city_saves_v1';
export const SAVE_LIBRARY_KEY = 'pixopolis_saves_library_v2';
export const MAX_SAVE_SLOTS = 4;
export const MAX_SAVED_CITIES = 24;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface CitySaveRecord {
  saveId: string;
  slotId?: number;
  name: string;
  isAutoSave?: boolean;
  savedAtIso: string;
  savedAtLabel: string;
  seed: number;
  traitName: string;
  traitColor: string;
  difficulty?: DifficultyLevel;
  population: number;
  money: number;
  happiness: number;
  month: number;
  year: number;
  gridWidth: number;
  gridHeight: number;
  stateJson: string;
}

/** Serialize full CityState into a compact, deterministic JSON string */
export function serializeCitySave(state: CityState): string {
  const cleanCopy: CityState = {
    ...state,
    cityName: sanitizeCityName(state.cityName),
    saveId: state.saveId || createCitySaveId(state.seed),
    pendingSounds: [],
  };
  return JSON.stringify(cleanCopy);
}

/** Rehydrate and validate a CityState from a serialized JSON string */
export function deserializeCitySave(rawJson: string): CityState | null {
  try {
    const parsed = JSON.parse(rawJson) as Partial<CityState>;
    if (
      !parsed ||
      typeof parsed.seed !== 'number' ||
      !Array.isArray(parsed.tiles) ||
      !parsed.budgets ||
      !parsed.taxes
    ) {
      return null;
    }

    const gw =
      typeof parsed.gridWidth === 'number' && parsed.gridWidth >= 16
        ? parsed.gridWidth
        : typeof parsed.gridSize === 'number'
          ? parsed.gridSize
          : GRID_SIZE;
    const gh =
      typeof parsed.gridHeight === 'number' && parsed.gridHeight >= 16
        ? parsed.gridHeight
        : gw;

    if (parsed.tiles.length !== gw * gh) {
      return null;
    }

    const trait =
      CITY_TRAITS.find((t) => t.id === parsed.trait?.id) ?? CITY_TRAITS[0];
    const difficulty = sanitizeDifficulty(parsed.difficulty);

    const budgets: CityBudgets = {
      ...createDefaultBudgets(),
      ...parsed.budgets,
    };

    const budgetTargetsPct: Record<BudgetAreaKey, number> = {
      ...createDefaultTargetPcts(difficulty),
      ...(parsed.budgetTargetsPct ?? {}),
    };

    const breakthroughCharge: Record<BudgetAreaKey, number> = {
      ...createZeroAreaRecord(),
      ...(parsed.breakthroughCharge ?? {}),
    };

    const breakthroughCount: Record<BudgetAreaKey, number> = {
      ...createZeroAreaRecord(),
      ...(parsed.breakthroughCount ?? {}),
    };

    const workTiers: Record<EmergencyActionId, number> = {
      ...createInitialWorkTiers(),
      ...(parsed.workTiers ?? {}),
    };

    const expansions: Record<ExpandDirection, number> = {
      norte: parsed.expansions?.norte ?? 0,
      leste: parsed.expansions?.leste ?? 0,
      sul: parsed.expansions?.sul ?? 0,
      oeste: parsed.expansions?.oeste ?? 0,
    };

    const restored: CityState = {
      seed: parsed.seed,
      cityName: sanitizeCityName(parsed.cityName),
      saveId:
        typeof parsed.saveId === 'string' && parsed.saveId.trim().length > 0
          ? parsed.saveId
          : `save_${parsed.seed}_restored`,
      gridWidth: gw,
      gridHeight: gh,
      gridSize: Math.max(gw, gh),
      expansions,
      mapVersion: (parsed.mapVersion ?? 1) + 1,
      roadOriginX:
        typeof parsed.roadOriginX === 'number'
          ? parsed.roadOriginX
          : Math.floor(gw / 2) - 1,
      roadOriginY:
        typeof parsed.roadOriginY === 'number'
          ? parsed.roadOriginY
          : Math.floor(gh / 2) - 1,
      tiles: parsed.tiles.map((t, idx) => ({
        x: typeof t.x === 'number' ? t.x : idx % gw,
        y: typeof t.y === 'number' ? t.y : Math.floor(idx / gw),
        type: t.type ?? 'grass',
        level: typeof t.level === 'number' ? t.level : 0,
        variant: typeof t.variant === 'number' ? t.variant : 0,
        pollution: typeof t.pollution === 'number' ? t.pollution : 0,
        landValue: typeof t.landValue === 'number' ? t.landValue : 30,
        age: typeof t.age === 'number' ? t.age : 0,
        evolutionProgress:
          typeof t.evolutionProgress === 'number' ? t.evolutionProgress : 0,
        upgradeCooldown:
          typeof t.upgradeCooldown === 'number' ? t.upgradeCooldown : 0,
        evolveFlash: 0,
        previousType: t.previousType,
        establishmentId: t.establishmentId,
        lotRole: t.lotRole ?? 'single',
        lotWidth: t.lotWidth ?? 1,
        lotHeight: t.lotHeight ?? 1,
        lotDx: t.lotDx ?? 0,
        lotDy: t.lotDy ?? 0,
        construction: t.construction ? { ...t.construction } : undefined,
      })),
      budgets,
      budgetTargetsPct,
      breakthroughCharge,
      breakthroughCount,
      workTiers,
      stats: createEmptyCityStats(budgets),
      trait,
      difficulty,
      money: typeof parsed.money === 'number' ? parsed.money : INITIAL_MONEY,
      taxes: {
        ...DEFAULT_TAX_RATES,
        ...(parsed.taxes ?? {}),
      },
      financials: createEmptyFinancials(),
      totalPopulation: typeof parsed.totalPopulation === 'number' ? parsed.totalPopulation : 0,
      lastMigrationDelta:
        typeof parsed.lastMigrationDelta === 'number' ? parsed.lastMigrationDelta : 0,
      prevMonthPopulation:
        typeof parsed.prevMonthPopulation === 'number' ? parsed.prevMonthPopulation : 0,
      globalServiceCoverage:
        typeof parsed.globalServiceCoverage === 'number' ? parsed.globalServiceCoverage : 80,
      globalHappiness:
        typeof parsed.globalHappiness === 'number' ? parsed.globalHappiness : 74,
      tick: typeof parsed.tick === 'number' ? parsed.tick : 0,
      monthElapsedSec:
        typeof parsed.monthElapsedSec === 'number' ? parsed.monthElapsedSec : 0,
      month: typeof parsed.month === 'number' ? parsed.month : START_MONTH,
      year: typeof parsed.year === 'number' ? parsed.year : START_YEAR,
      news: Array.isArray(parsed.news) ? parsed.news : [],
      nextNewsId: typeof parsed.nextNewsId === 'number' ? parsed.nextNewsId : 10,
      activeBoosts: Array.isArray(parsed.activeBoosts)
        ? parsed.activeBoosts.map((b) => ({
            ...b,
            totalMonths:
              typeof b.totalMonths === 'number' && b.totalMonths >= b.remainingMonths
                ? b.totalMonths
                : b.remainingMonths,
          }))
        : [],
      pendingWorks: Array.isArray(parsed.pendingWorks)
        ? parsed.pendingWorks.map((w) => ({
            ...w,
            targetCoords: Array.isArray(w.targetCoords)
              ? w.targetCoords.map((c) => ({ x: c.x, y: c.y }))
              : undefined,
          }))
        : [],
      history: Array.isArray(parsed.history) ? parsed.history : [],
      rngState:
        typeof parsed.rngState === 'number'
          ? parsed.rngState
          : (parsed.seed ^ 0x9e3779b9) >>> 0,
      pendingSounds: [],
      milestonesReached: (() => {
        const mr = { ...(parsed.milestonesReached ?? {}) };
        if (mr.civic_stadium_toll_20k) {
          mr.civic_stadium_20k = true;
          mr.civic_toll_20k = true;
        }
        return mr;
      })(),
      recentMilestoneBanner: parsed.recentMilestoneBanner ?? null,
      weather: parsed.weather
        ? {
            season: parsed.weather.season ?? getSeasonForMonth(typeof parsed.month === 'number' ? parsed.month : START_MONTH),
            kind: parsed.weather.kind ?? 'clear',
            intensity: typeof parsed.weather.intensity === 'number' ? parsed.weather.intensity : 0.5,
            snowCover: typeof parsed.weather.snowCover === 'number' ? parsed.weather.snowCover : 0,
            temperatureC: typeof parsed.weather.temperatureC === 'number' ? parsed.weather.temperatureC : 26,
            windX: typeof parsed.weather.windX === 'number' ? parsed.weather.windX : 0.1,
            nextChangeSec: typeof parsed.weather.nextChangeSec === 'number' ? parsed.weather.nextChangeSec : 12,
          }
        : createInitialWeather(
            typeof parsed.month === 'number' ? parsed.month : START_MONTH,
            parsed.seed
          ),
      seasonMode:
        parsed.seasonMode === 'summer' ||
        parsed.seasonMode === 'autumn' ||
        parsed.seasonMode === 'winter' ||
        parsed.seasonMode === 'spring'
          ? parsed.seasonMode
          : 'auto',
      externalHighway: parsed.externalHighway ?? {
        edge: 'east',
        borderX: Math.max(0, gw - 1),
        borderY: typeof parsed.roadOriginY === 'number' ? parsed.roadOriginY : Math.floor(gh / 2) - 1,
        tollX: Math.max(1, gw - 3),
        tollY: typeof parsed.roadOriginY === 'number' ? parsed.roadOriginY : Math.floor(gh / 2) - 1,
      },
      tollPlaza: parsed.tollPlaza
        ? {
            built: Boolean(parsed.tollPlaza.built),
            tariff:
              parsed.tollPlaza.tariff === 'low' ||
              parsed.tollPlaza.tariff === 'medium' ||
              parsed.tollPlaza.tariff === 'high'
                ? parsed.tollPlaza.tariff
                : 'medium',
            monthlyVehicles: parsed.tollPlaza.monthlyVehicles ?? 0,
            monthlyRevenue: parsed.tollPlaza.monthlyRevenue ?? 0,
            visitorFlowPct: parsed.tollPlaza.visitorFlowPct ?? 100,
          }
        : createInitialTollPlaza(),
      condoPolicy: parsed.condoPolicy === 'auto' ? 'auto' : 'manual',
      activeEconomicEvent: parsed.activeEconomicEvent ?? null,
      activeUrbanIncident: parsed.activeUrbanIncident ?? null,
      economicEventCooldownMonths:
        typeof parsed.economicEventCooldownMonths === 'number'
          ? parsed.economicEventCooldownMonths
          : 4,
      urbanIncidentCooldownMonths:
        typeof parsed.urbanIncidentCooldownMonths === 'number'
          ? parsed.urbanIncidentCooldownMonths
          : 4,
    };

    ensureExternalHighwayConnected(restored, restored.externalHighway?.edge);
    reconcileRoadHierarchy(restored);
    recomputeFieldsAndStats(restored, 'ALL');
    if (!parsed.budgetTargetsPct) {
      for (const key of BUDGET_AREA_ORDER) {
        const needed = Math.max(1, restored.stats.coverage[key].needed);
        restored.budgetTargetsPct[key] = (restored.budgets[key] / needed) * 100;
        restored.stats.coverage[key].targetPct = Math.min(
          200,
          Math.round(restored.budgetTargetsPct[key])
        );
      }
    }
    return restored;
  } catch {
    return null;
  }
}

function getDefaultStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

function buildSaveRecord(
  state: CityState,
  customName?: string,
  isAutoSave: boolean = false,
  slotId?: number
): CitySaveRecord {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const savedAtLabel = `${dd}/${mo} às ${hh}:${mm}`;

  if (!state.saveId) {
    state.saveId = createCitySaveId(state.seed);
  }
  const resolvedName = customName?.trim()
    ? sanitizeCityName(customName)
    : sanitizeCityName(state.cityName);
  state.cityName = resolvedName;

  return {
    saveId: state.saveId,
    slotId,
    name: resolvedName,
    isAutoSave,
    savedAtIso: now.toISOString(),
    savedAtLabel,
    seed: state.seed,
    traitName: state.trait.name,
    traitColor: state.trait.accentColor,
    difficulty: sanitizeDifficulty(state.difficulty),
    population: state.totalPopulation,
    money: Math.round(state.money),
    happiness: state.globalHappiness,
    month: state.month,
    year: state.year,
    gridWidth: state.gridWidth,
    gridHeight: state.gridHeight,
    stateJson: serializeCitySave(state),
  };
}

/** Load all saved cities from browser memory (migrating any legacy v1 slots cleanly) */
export function loadSavedCitiesFromStorage(storage?: StorageLike): CitySaveRecord[] {
  const store = getDefaultStorage(storage);
  if (!store) return [];

  const byId = new Map<string, CitySaveRecord>();
  try {
    const rawLib = store.getItem(SAVE_LIBRARY_KEY);
    if (rawLib) {
      const parsed = JSON.parse(rawLib);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item.stateJson === 'string' && typeof item.seed === 'number') {
            const rec = item as CitySaveRecord;
            const id =
              typeof rec.saveId === 'string' && rec.saveId.length > 0
                ? rec.saveId
                : `legacy_${rec.seed}_${rec.slotId ?? 0}`;
            byId.set(id, { ...rec, saveId: id });
          }
        }
      }
    }

    // Merge legacy v1 fixed-slot saves only if library didn't already migrate or delete them
    if (!rawLib) {
      const rawLegacy = store.getItem(SAVE_STORAGE_KEY);
      if (rawLegacy) {
        const parsedLegacy = JSON.parse(rawLegacy);
        if (Array.isArray(parsedLegacy)) {
          for (let i = 0; i < parsedLegacy.length; i++) {
            const item = parsedLegacy[i];
            if (item && typeof item.stateJson === 'string' && typeof item.seed === 'number') {
              const rec = item as CitySaveRecord;
              const id =
                typeof rec.saveId === 'string' && rec.saveId.length > 0
                  ? rec.saveId
                  : `legacy_slot_${i + 1}_${rec.seed}`;
              if (!byId.has(id)) {
                byId.set(id, { ...rec, saveId: id });
              }
            }
          }
          if (byId.size > 0) {
            store.setItem(SAVE_LIBRARY_KEY, JSON.stringify(Array.from(byId.values())));
          }
        }
      }
    }
  } catch {
    return [];
  }

  return Array.from(byId.values()).sort((a, b) =>
    b.savedAtIso.localeCompare(a.savedAtIso)
  );
}

/** Save or overwrite the currently active city directly in memory without opening a modal */
export function saveCurrentCityToStorage(
  state: CityState,
  options?: { isAutoSave?: boolean; customName?: string; storage?: StorageLike }
): CitySaveRecord[] {
  const store = getDefaultStorage(options?.storage);
  const existing = loadSavedCitiesFromStorage(options?.storage);
  const record = buildSaveRecord(
    state,
    options?.customName,
    Boolean(options?.isAutoSave)
  );

  const filtered = existing.filter((r) => r.saveId !== record.saveId);
  const next = [record, ...filtered].slice(0, MAX_SAVED_CITIES);

  if (store) {
    try {
      store.setItem(SAVE_LIBRARY_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota errors in restricted environments
    }
  }
  return next;
}

/** Delete a saved city by saveId from memory */
export function deleteSavedCityFromStorage(
  saveId: string,
  storage?: StorageLike
): CitySaveRecord[] {
  const store = getDefaultStorage(storage);
  const existing = loadSavedCitiesFromStorage(storage);
  const next = existing.filter((r) => r.saveId !== saveId);
  if (store) {
    try {
      store.setItem(SAVE_LIBRARY_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors
    }
  }
  return next;
}

export function loadSaveSlotsFromStorage(): Array<CitySaveRecord | null> {
  const slots: Array<CitySaveRecord | null> = new Array(MAX_SAVE_SLOTS).fill(null);
  if (typeof window === 'undefined' || !window.localStorage) return slots;
  try {
    const raw = window.localStorage.getItem(SAVE_STORAGE_KEY);
    if (!raw) return slots;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return slots;
    for (let i = 0; i < MAX_SAVE_SLOTS; i++) {
      const item = parsed[i];
      if (item && typeof item.stateJson === 'string' && typeof item.seed === 'number') {
        slots[i] = item as CitySaveRecord;
      }
    }
    return slots;
  } catch {
    return slots;
  }
}

export function saveCityToStorageSlot(
  state: CityState,
  slotIndex: number,
  customName?: string
): Array<CitySaveRecord | null> {
  const slots = loadSaveSlotsFromStorage();
  if (slotIndex < 0 || slotIndex >= MAX_SAVE_SLOTS) return slots;
  const record = buildSaveRecord(state, customName, false, slotIndex + 1);
  slots[slotIndex] = record;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(slots));
    } catch {
      // Ignore storage quota errors in restricted environments
    }
  }
  return slots;
}

export function deleteSaveSlotFromStorage(
  slotIndex: number
): Array<CitySaveRecord | null> {
  const slots = loadSaveSlotsFromStorage();
  if (slotIndex < 0 || slotIndex >= MAX_SAVE_SLOTS) return slots;
  slots[slotIndex] = null;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(slots));
    } catch {
      // Ignore storage errors
    }
  }
  return slots;
}

function checkEmergentNews(state: CityState): void {
  const pop = state.totalPopulation;
  const popMilestones: Array<[number, string]> = [
    [250, 'Pixópolis ultrapassa 250 habitantes e ganha status de vila próspera!'],
    [600, '600 moradores! O comércio aquece e novas obras avançadas surgem em Pixópolis.'],
    [1200, '1.200 habitantes! A metrópole 64-bit cresce a todo vapor!'],
    [2500, '2.500 moradores! Pixópolis vira referência urbana nacional!'],
  ];

  for (const [threshold, msg] of popMilestones) {
    const key = `pop_${threshold}`;
    if (pop >= threshold && !state.milestonesReached[key]) {
      state.milestonesReached[key] = true;
      state.pendingSounds.push({ type: 'milestone' });
      pushNews(state, msg, 'milestone');
      return;
    }
  }

  if (state.tick > 0 && state.tick % 16 === 0) {
    if (state.stats.avgPollution >= 26) {
      pushNews(
        state,
        `Fábricas elevam a poluição urbana para ${state.stats.avgPollution}%.`,
        'warning'
      );
    } else if (state.stats.airportCount > 0 && state.tick % 32 === 0) {
      pushNews(state, 'Voos regulares conectam o Aeroporto de Pixópolis ao mundo!', 'good');
    } else if (state.stats.portCount > 0 && state.tick % 48 === 0) {
      pushNews(state, 'Barcos comerciais movimentam o Porto Fluvial e reforçam a economia!', 'good');
    } else if (state.stats.commercialCount >= 10) {
      pushNews(state, 'Boom comercial movimenta as avenidas de Pixópolis!', 'good');
    } else if (state.stats.parkCount >= 5) {
      pushNews(state, 'Parques arborizados valorizam imóveis e atraem turistas.', 'good');
    } else {
      pushNews(state, 'Novas ruas ampliam a circulação pela cidade.', 'info');
    }
  }
}

/** Create immutable snapshot for React HUD & Modals */
export function createHudSnapshot(state: CityState): HudSnapshot {
  const covCopy = {} as Record<BudgetAreaKey, BudgetAreaStatus>;
  for (const key of BUDGET_AREA_ORDER) {
    covCopy[key] = { ...state.stats.coverage[key] };
  }

  return {
    seed: state.seed,
    cityName: sanitizeCityName(state.cityName),
    saveId: state.saveId || createCitySaveId(state.seed),
    gridWidth: state.gridWidth,
    gridHeight: state.gridHeight,
    money: Math.round(state.money),
    taxes: { ...state.taxes },
    financials: {
      revenue: { ...state.financials.revenue },
      expenses: { ...state.financials.expenses },
      netBalance: state.financials.netBalance,
      fairTaxRate: state.financials.fairTaxRate,
      eventRevenueMult: state.financials.eventRevenueMult,
      eventExpenseMult: state.financials.eventExpenseMult,
    },
    totalPopulation: state.totalPopulation,
    lastMigrationDelta: state.lastMigrationDelta,
    globalServiceCoverage: state.globalServiceCoverage,
    globalHappiness: state.globalHappiness,
    month: state.month,
    year: state.year,
    monthProgress: Math.max(
      0,
      Math.min(1, state.monthElapsedSec / SECONDS_PER_MONTH_1X)
    ),
    trait: state.trait,
    difficulty: sanitizeDifficulty(state.difficulty),
    budgets: { ...state.budgets },
    budgetTargetsPct: { ...(state.budgetTargetsPct ?? createDefaultTargetPcts()) },
    stats: {
      ...state.stats,
      coverage: covCopy,
    },
    emergencyOffers: getEmergencyOffers(state),
    landExpansions: getLandExpansions(state),
    civicMilestones: getCivicMilestoneStatuses(state),
    recentMilestoneBanner: state.recentMilestoneBanner
      ? { ...state.recentMilestoneBanner }
      : null,
    news: state.news.slice(0, 12),
    activeBoosts: state.activeBoosts.map((b) => ({ ...b })),
    pendingWorks: (state.pendingWorks ?? []).map((w) => ({
      ...w,
      targetCoords: w.targetCoords?.map((c) => ({ ...c })),
    })),
    history: state.history.map((h) => ({ ...h })),
    needs: computeCityNeeds(state),
    tick: state.tick,
    weather: state.weather
      ? { ...state.weather }
      : createInitialWeather(state.month, state.seed),
    seasonMode: state.seasonMode ?? 'auto',
    externalHighway: state.externalHighway
      ? { ...state.externalHighway }
      : {
          edge: 'east',
          borderX: Math.max(0, state.gridWidth - 1),
          borderY: state.roadOriginY,
          tollX: Math.max(1, state.gridWidth - 3),
          tollY: state.roadOriginY,
        },
    tollPlaza: state.tollPlaza ? { ...state.tollPlaza } : createInitialTollPlaza(),
    condoPolicy: state.condoPolicy ?? 'manual',
    activeEconomicEvent: state.activeEconomicEvent ? { ...state.activeEconomicEvent } : null,
    activeUrbanIncident: state.activeUrbanIncident ? { ...state.activeUrbanIncident } : null,
  };
}

// ============================================================================
// Live Ambient Cars, River Boats, Airplanes & Pooled Particles
// ============================================================================

const CAR_COLORS = ['#ff595e', '#ffca3a', '#4ea8de', '#f8f9fa', '#ff924c', '#8ac926'];
const BOAT_HULLS = ['#e8eef5', '#d94848', '#2b5f8f', '#f2c14e'];
const BOAT_CARGO = ['#ff785a', '#56c2ff', '#ffe066', '#66d98c'];
const PLANE_ACCENTS = ['#e05252', '#2d8cd6', '#f5b73b', '#38a169'];

export function createParticlePool(
  size: number = GROWTH_CONFIG.particlePoolSize
): ParticleEntity[] {
  const pool: ParticleEntity[] = [];
  for (let i = 0; i < size; i++) {
    pool.push({
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: 1,
      size: 2,
      color: '#ffffff',
      kind: 'smoke',
    });
  }
  return pool;
}

export function spawnParticle(
  pool: ParticleEntity[],
  cursorRef: { idx: number },
  x: number,
  y: number,
  vx: number,
  vy: number,
  maxLife: number,
  size: number,
  color: string,
  kind: ParticleEntity['kind']
): void {
  const p = pool[cursorRef.idx];
  cursorRef.idx = (cursorRef.idx + 1) % pool.length;
  p.active = true;
  p.x = x;
  p.y = y;
  p.vx = vx;
  p.vy = vy;
  p.life = maxLife;
  p.maxLife = maxLife;
  p.size = size;
  p.color = color;
  p.kind = kind;
}

export function updateCarsAndParticles(
  state: CityState,
  cars: CarEntity[],
  particles: ParticleEntity[],
  particleCursor: { idx: number },
  dt: number,
  speedScale: number,
  timeSeconds: number = 0,
  _boats?: BoatEntity[]
): void {
  const moveDt = dt * Math.max(0.4, speedScale);

  for (let i = 0; i < state.tiles.length; i++) {
    const t = state.tiles[i];
    if (t.evolveFlash > 0) {
      const prev = t.evolveFlash;
      t.evolveFlash = Math.max(0, t.evolveFlash - dt);
      if (prev > 0.18 && Math.random() < dt * 18) {
        const isDecay = t.type === 'abandoned';
        const inConstructionStages = prev > 0.55 && !isDecay && t.type !== 'road' && t.type !== 'bridge';
        spawnParticle(
          particles,
          particleCursor,
          t.x + 0.18 + Math.random() * 0.64,
          t.y + 0.18 + Math.random() * 0.56,
          (Math.random() - 0.5) * 0.95,
          -0.85 - Math.random() * 1.15,
          0.55 + Math.random() * 0.45,
          inConstructionStages && Math.random() < 0.45 ? 1.8 : 2.1,
          isDecay
            ? '#8b95a5'
            : inConstructionStages && Math.random() < 0.45
              ? '#fbbf24'
              : t.level >= 3 || isLandmarkType(t.type)
                ? '#ffe066'
                : '#72efdd',
          isDecay ? 'decay' : 'sparkle'
        );
      }
    }

    if (t.type === 'industrial' && Math.random() < dt * 1.65) {
      spawnParticle(
        particles,
        particleCursor,
        t.x + 0.72 + (Math.random() - 0.5) * 0.1,
        t.y + 0.12,
        0.16 + Math.random() * 0.18,
        -0.45 - Math.random() * 0.25,
        1.4 + Math.random() * 0.8,
        Math.random() > 0.4 ? 2 : 3,
        Math.random() > 0.5 ? '#c4ccd8' : '#8d99ae',
        'smoke'
      );
    }
  }

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    if (!p.active) continue;
    p.life -= dt;
    if (p.life <= 0) {
      p.active = false;
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }

  const roadList: Tile[] = [];
  for (let i = 0; i < state.tiles.length; i++) {
    if (isRoadLike(state.tiles[i].type)) roadList.push(state.tiles[i]);
  }
  const desiredCars = Math.min(
    GROWTH_CONFIG.maxCars,
    Math.max(3, Math.floor(roadList.length * 0.42))
  );

  // Backfill legacy spawned cars lacking explicit `kind` and guarantee Police & Fire patrol presence
  for (let i = 0; i < cars.length; i++) {
    if (!cars[i].kind) {
      cars[i].kind = getVehicleKind(i);
    }
  }
  const countKind = (k: VehicleKind) => cars.filter((c) => c.kind === k).length;

  const extHw = state.externalHighway;
  const visitorFlowScale = Math.max(
    0.45,
    Math.min(1.35, (state.tollPlaza?.visitorFlowPct ?? 100) / 100)
  );
  const desiredVisitorCars = extHw
    ? Math.max(2, Math.min(12, Math.round((2 + roadList.length * 0.06) * visitorFlowScale)))
    : 0;
  let activeVisitorCars = cars.filter(
    (c) => c.role === 'visitor_in' || c.role === 'visitor_out'
  ).length;

  let spawnAttempts = 0;
  const maxSpawnAttempts = desiredCars * 4 + 8;
  while (cars.length < desiredCars && roadList.length >= 2 && spawnAttempts < maxSpawnAttempts) {
    spawnAttempts++;
    let start: Tile;
    let next: Tile;
    let role: 'local' | 'visitor_in' | 'visitor_out' = 'local';

    const needsPolice =
      roadList.length >= 4 && countKind('police') < Math.max(1, Math.floor(desiredCars * 0.1));
    const needsFire =
      roadList.length >= 4 && countKind('fire') < Math.max(1, Math.floor(desiredCars * 0.08));
    const busStationsCount = state.stats.busStationCount ?? 0;
    const desiredBuses =
      busStationsCount > 0 ? Math.min(10, 2 + busStationsCount * 2) : 0;
    const needsBus =
      busStationsCount > 0 && roadList.length >= 4 && countKind('bus') < desiredBuses;

    // Wide 2x2 Avenues and Bus Terminal corridors attract significantly higher vehicle & bus movement!
    const wideAvenueRoads = roadList.filter(
      (r) => r.type === 'road' && r.level === 2 && r.variant === 2
    );
    const pickWeightedRoad = (): Tile => {
      if (wideAvenueRoads.length > 0 && Math.random() < (needsBus ? 0.58 : 0.42)) {
        return wideAvenueRoads[Math.floor(Math.random() * wideAvenueRoads.length)];
      }
      return roadList[Math.floor(Math.random() * roadList.length)];
    };

    const shouldSpawnVisitor =
      !needsPolice &&
      !needsFire &&
      !needsBus &&
      extHw &&
      activeVisitorCars < desiredVisitorCars;
    if (shouldSpawnVisitor && extHw) {
      const borderTile = getTile(state, extHw.borderX, extHw.borderY);
      const borderNeighbors = borderTile
        ? getOrthoNeighbors(state, borderTile.x, borderTile.y).filter((n) => isRoadLike(n.type))
        : [];
      if (borderTile && isRoadLike(borderTile.type) && borderNeighbors.length > 0 && Math.random() < 0.62) {
        // Incoming visitor entering from the outside world through the highway portal!
        start = borderTile;
        next = borderNeighbors[0];
        role = 'visitor_in';
      } else {
        // Outgoing vehicle heading toward the external highway border to leave the city
        start = pickWeightedRoad();
        const roadNeighbors = getOrthoNeighbors(state, start.x, start.y).filter((n) =>
          isRoadLike(n.type)
        );
        if (roadNeighbors.length === 0) break;
        roadNeighbors.sort(
          (a, b) =>
            Math.hypot(a.x - extHw.borderX, a.y - extHw.borderY) -
            Math.hypot(b.x - extHw.borderX, b.y - extHw.borderY)
        );
        next = roadNeighbors[0];
        role = 'visitor_out';
      }
    } else {
      start = pickWeightedRoad();
      const roadNeighbors = getOrthoNeighbors(state, start.x, start.y).filter((n) =>
        isRoadLike(n.type)
      );
      if (roadNeighbors.length === 0) break;
      next = roadNeighbors[Math.floor(Math.random() * roadNeighbors.length)];
    }

    const isMultiLane =
      (start.type === 'road' &&
        ((start.level === 3 && start.variant === 1) || (start.level === 2 && start.variant === 2))) ||
      (start.type === 'bridge' && ((start.variant || 0) === 1 || (start.level || 1) >= 2));

    let kind: VehicleKind;
    if (role === 'local' && needsBus) {
      kind = 'bus';
    } else if (role === 'local' && needsPolice) {
      kind = 'police';
    } else if (role === 'local' && needsFire) {
      kind = 'fire';
    } else {
      kind = getVehicleKind(cars.length + Math.floor(Math.random() * 14));
      if (kind === 'bus' && busStationsCount === 0) {
        kind = 'van';
      }
      if (role !== 'local' && (kind === 'police' || kind === 'fire' || kind === 'bus')) {
        kind = 'sedan';
      }
    }

    const baseSpeed =
      kind === 'police'
        ? 2.15 + Math.random() * 0.7
        : kind === 'fire'
          ? 1.95 + Math.random() * 0.6
          : kind === 'bus'
            ? 1.55 + Math.random() * 0.55
            : role !== 'local'
              ? 1.85 + Math.random() * 0.9
              : 1.5 + Math.random() * 1.4;

    const spawnProgress = role === 'visitor_in' ? 0.04 : Math.random();
    const overlapsExisting = cars.some(
      (c) =>
        c.fromX === start.x &&
        c.fromY === start.y &&
        c.toX === next.x &&
        c.toY === next.y
    );
    if (overlapsExisting) continue;
    if (role === 'visitor_in' || role === 'visitor_out') {
      activeVisitorCars++;
    }

    cars.push({
      x: start.x + 0.5,
      y: start.y + 0.5,
      fromX: start.x,
      fromY: start.y,
      toX: next.x,
      toY: next.y,
      progress: spawnProgress,
      speed: baseSpeed,
      color:
        kind === 'police'
          ? '#0f172a'
          : kind === 'fire'
            ? '#dc2626'
            : kind === 'bus'
              ? '#0284c7'
              : CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)],
      laneOffset: isMultiLane ? (cars.length % 2 === 0 ? 0.10 : 0.23) : 0.14,
      kind,
      role,
    });
  }

  for (let i = cars.length - 1; i >= 0; i--) {
    const car = cars[i];
    const activeTile = getTile(state, car.fromX, car.fromY);
    const isPassingToll =
      Boolean(state.tollPlaza?.built) && isTollPlazaTile(state, car.fromX, car.fromY);
    const roadSpeedMult = isPassingToll
      ? 0.58 // Brief slowdown while crossing the Toll Plaza gates
      : activeTile?.type === 'bridge'
        ? (activeTile.level || 1) >= 4
          ? 1.85 // 2-tile-wide Mega-Bridge expressway speed
          : (activeTile.variant || 0) === 1 || (activeTile.level || 1) >= 2
            ? 1.55
            : 1.35
        : activeTile?.type === 'road'
          ? activeTile.level === 3
            ? activeTile.variant === 1
              ? 2.15 // 4-Lane divided highway (2 idas / 2 voltas)
              : 1.85 // 2-Lane expressway
            : activeTile.level === 2
              ? activeTile.variant === 2
                ? 1.55 // 2×2 Wide Avenue (Boulevard) high-capacity smooth speed
                : 1.35 // Smooth boulevard speed on Avenidas
              : activeTile.level >= 4
                ? 1.15 // Flowing roundabout / Trevo
                : 1.0 // Neighborhood Rua Local
          : 1.0;

    // 1. Check Traffic Signal control before entering a 3/4-way intersection (`car.toX, car.toY`)
    let blocked = false;
    let holdCap = 0.58;
    if (isTrafficLightIntersection(state, car.toX, car.toY)) {
      const movingNS = Math.abs(car.toY - car.fromY) > 0;
      const sig = getTrafficSignalState(car.toX, car.toY, timeSeconds);
      const hasGreen = movingNS ? sig.nsGreen : sig.ewGreen;
      if (!hasGreen && car.progress >= 0.40 && car.progress <= 0.84) {
        blocked = true;
        holdCap = 0.56;
      }
    }

    // 2. Respect stopped lead vehicles on the same street segment
    if (!blocked) {
      for (let j = 0; j < cars.length; j++) {
        if (j === i) continue;
        const other = cars[j];
        if (
          other.fromX === car.fromX &&
          other.fromY === car.fromY &&
          other.toX === car.toX &&
          other.toY === car.toY &&
          other.progress > car.progress &&
          other.progress - car.progress < 0.24
        ) {
          blocked = true;
          holdCap = Math.max(0.08, other.progress - 0.22);
          break;
        }
      }
    }

    if (blocked) {
      if (car.progress < holdCap) {
        car.progress = Math.min(holdCap, car.progress + car.speed * roadSpeedMult * moveDt * 0.65);
      }
    } else {
      car.progress += car.speed * roadSpeedMult * moveDt;
    }

    if (car.progress >= 1) {
      car.progress -= 1;
      const prevX = car.fromX;
      const prevY = car.fromY;
      const dirX = car.toX - prevX;
      const dirY = car.toY - prevY;
      car.fromX = car.toX;
      car.fromY = car.toY;

      // Outgoing vehicles reaching the external highway border cleanly exit the map!
      if (
        extHw &&
        car.fromX === extHw.borderX &&
        car.fromY === extHw.borderY &&
        car.role !== 'visitor_in'
      ) {
        cars.splice(i, 1);
        continue;
      }

      // Incoming visitor becomes a local cruiser once inside the city core (and may later depart)
      if (
        car.role === 'visitor_in' &&
        extHw &&
        Math.hypot(car.fromX - extHw.borderX, car.fromY - extHw.borderY) >= 6
      ) {
        car.role = Math.random() < 0.35 ? 'visitor_out' : 'local';
      }

      const curTile = getTile(state, car.fromX, car.fromY);
      if (!curTile || !isRoadLike(curTile.type)) {
        cars.splice(i, 1);
        continue;
      }

      const isMultiLane =
        (curTile.type === 'road' &&
          ((curTile.level === 3 && curTile.variant === 1) ||
            (curTile.level === 2 && curTile.variant === 2))) ||
        (curTile.type === 'bridge' && ((curTile.variant || 0) === 1 || (curTile.level || 1) >= 2));
      car.laneOffset = isMultiLane ? (i % 2 === 0 ? 0.10 : 0.23) : 0.14;

      const neighbors = getOrthoNeighbors(state, car.fromX, car.fromY).filter((n) =>
        isRoadLike(n.type)
      );
      if (neighbors.length === 0) {
        cars.splice(i, 1);
        continue;
      }
      const forward = neighbors.filter((n) => n.x !== prevX || n.y !== prevY);
      const pool = forward.length > 0 ? forward : neighbors;
      const straight = pool.find(
        (n) => n.x - car.fromX === dirX && n.y - car.fromY === dirY
      );
      const wideAvenueChoices = pool.filter(
        (n) => n.type === 'road' && n.level === 2 && n.variant === 2
      );

      let next: Tile;
      if (curTile.type === 'bridge' && straight) {
        // Keep cars moving smoothly straight along the bridge deck (no mid-river sideways lane-jumps on 2-tile bridges!)
        next = straight;
      } else if (car.role === 'visitor_out' && extHw && Math.random() < 0.78) {
        // Steer outgoing cars toward the external border highway!
        const sorted = [...pool].sort(
          (a, b) =>
            Math.hypot(a.x - extHw.borderX, a.y - extHw.borderY) -
            Math.hypot(b.x - extHw.borderX, b.y - extHw.borderY)
        );
        next = sorted[0];
      } else if (
        straight &&
        curTile.type === 'road' &&
        curTile.level === 2 &&
        curTile.variant === 2 &&
        straight.type === 'road' &&
        straight.level === 2 &&
        straight.variant === 2 &&
        Math.random() < 0.84
      ) {
        // Keep smooth multi-lane flow along 2×2 Wide Boulevards!
        next = straight;
      } else if (
        wideAvenueChoices.length > 0 &&
        (car.kind === 'bus' ? Math.random() < 0.72 : Math.random() < 0.45)
      ) {
        // Buses & urban commuters gravitate toward 2×2 Wide Boulevards!
        next = wideAvenueChoices[Math.floor(Math.random() * wideAvenueChoices.length)];
      } else {
        // Prefer continuing straight along Estradas / Avenidas for realistic urban flow
        next =
          straight && (curTile.level === 2 || curTile.level === 3) && Math.random() < 0.76
            ? straight
            : pool[Math.floor(Math.random() * pool.length)];
      }
      car.toX = next.x;
      car.toY = next.y;
    }

    const dx = car.toX - car.fromX;
    const dy = car.toY - car.fromY;
    const perpX = -dy * car.laneOffset;
    const perpY = dx * car.laneOffset;
    car.x = car.fromX + 0.5 + dx * car.progress + perpX;
    car.y = car.fromY + 0.5 + dy * car.progress + perpY;
  }
}

/**
 * Update animated river boats (small, medium, yacht, cargo & Lv.3 cruise liners routed strictly to bridge-free ports),
 * commercial airplanes (landing, entering airport hangars, emerging & taking off),
 * and city helicopters (cruising and landing/taking off on 2×2 skyscraper helipads).
 */
export function updateBoatsAndPlanes(
  state: CityState,
  boats: BoatEntity[],
  planes: PlaneEntity[],
  particles: ParticleEntity[],
  particleCursor: { idx: number },
  dt: number,
  speedScale: number,
  helicopters?: HelicopterEntity[]
): void {
  const moveDt = dt * Math.max(0.4, speedScale);
  const gw = state.gridWidth;

  // 1. River Navigation Boats: small boats, medium boats, luxury yachts, cargo ships & bridge-free Cruise Liners!
  const cruiseNav = getCruisePortNavigationInfo(state);
  const hasBridgeFreeCruisePort =
    cruiseNav.targetPortAnchor !== null && cruiseNav.navigableWater.size >= 4;

  const desiredBoats = Math.min(
    GROWTH_CONFIG.maxBoats,
    Math.max(4, 3 + state.stats.portCount * 3 + state.stats.bridgeCount * 2)
  );

  if (boats.length < desiredBoats) {
    const waterTiles: Tile[] = [];
    const cruiseWaterTiles: Tile[] = [];
    for (let i = 0; i < state.tiles.length; i++) {
      const t = state.tiles[i];
      if (isNavigableWater(t.type)) waterTiles.push(t);
      if (hasBridgeFreeCruisePort && t.type === 'water' && cruiseNav.navigableWater.has(i)) {
        cruiseWaterTiles.push(t);
      }
    }
    const baseKinds: BoatKind[] = ['small', 'medium', 'yacht'];
    while (boats.length < desiredBoats && waterTiles.length >= 2) {
      // Ensure small boats, medium boats, yachts, and bridge-free Cruise Liners are represented
      const missingKind = baseKinds.find((k) => !boats.some((b) => b.kind === k));
      let kind: BoatKind;
      if (hasBridgeFreeCruisePort && !boats.some((b) => b.kind === 'cruise')) {
        kind = 'cruise';
      } else if (missingKind) {
        kind = missingKind;
      } else {
        const roll = Math.random();
        if (hasBridgeFreeCruisePort && roll < 0.22) {
          kind = 'cruise';
        } else if (state.stats.portCount > 0 && roll < 0.42) {
          kind = 'cargo';
        } else if (roll < 0.66) {
          kind = 'small';
        } else if (roll < 0.86) {
          kind = 'medium';
        } else {
          kind = 'yacht';
        }
      }

      let start: Tile;
      let next: Tile;
      let cruisePhase: 'to_port' | 'to_mouth' | undefined;

      if (kind === 'cruise') {
        if (!hasBridgeFreeCruisePort || cruiseWaterTiles.length < 2) {
          kind = state.stats.portCount > 0 ? 'cargo' : 'yacht';
        } else {
          // Prefer spawning Cruise Liners near the open river mouth so they glide cleanly toward the bridge-free port
          const mouthCandidates = cruiseWaterTiles.filter(
            (t) => (cruiseNav.distToMouth.get(t.y * gw + t.x) ?? 999) <= 3
          );
          const spawnPool = mouthCandidates.length > 0 ? mouthCandidates : cruiseWaterTiles;
          start = spawnPool[Math.floor(Math.random() * spawnPool.length)];
          const cruiseNeighbors = getOrthoNeighbors(state, start.x, start.y).filter(
            (n) => n.type === 'water' && cruiseNav.navigableWater.has(n.y * gw + n.x)
          );
          if (cruiseNeighbors.length === 0) break;
          cruiseNeighbors.sort(
            (a, b) =>
              (cruiseNav.distToPort.get(a.y * gw + a.x) ?? 999) -
              (cruiseNav.distToPort.get(b.y * gw + b.x) ?? 999)
          );
          next = cruiseNeighbors[0];
          cruisePhase = 'to_port';
        }
      }

      if (kind !== 'cruise') {
        start = waterTiles[Math.floor(Math.random() * waterTiles.length)];
        const waterNeighbors = getOrthoNeighbors(state, start.x, start.y).filter((n) =>
          isNavigableWater(n.type)
        );
        if (waterNeighbors.length === 0) break;
        next = waterNeighbors[Math.floor(Math.random() * waterNeighbors.length)];
      }

      const speedByKind =
        kind === 'small'
          ? 1.15 + Math.random() * 0.45
          : kind === 'yacht'
            ? 1.0 + Math.random() * 0.35
            : kind === 'medium'
              ? 0.82 + Math.random() * 0.32
              : kind === 'cruise'
                ? 0.56 + Math.random() * 0.20
                : 0.68 + Math.random() * 0.28;

      const hullByKind =
        kind === 'cruise'
          ? '#ffffff'
          : kind === 'yacht'
            ? '#f8fafc'
            : kind === 'small'
              ? ['#e63946', '#3a86ff', '#ffb703', '#f1faee'][Math.floor(Math.random() * 4)]
              : kind === 'medium'
                ? ['#1d3557', '#2a9d8f', '#457b9d', '#e76f51'][Math.floor(Math.random() * 4)]
                : BOAT_HULLS[Math.floor(Math.random() * BOAT_HULLS.length)];

      boats.push({
        x: start!.x + 0.5,
        y: start!.y + 0.5,
        fromX: start!.x,
        fromY: start!.y,
        toX: next!.x,
        toY: next!.y,
        progress: Math.random(),
        speed: speedByKind,
        hullColor: hullByKind,
        cargoColor:
          kind === 'cruise'
            ? ['#0284c7', '#e11d48', '#f59e0b'][Math.floor(Math.random() * 3)]
            : BOAT_CARGO[Math.floor(Math.random() * BOAT_CARGO.length)],
        kind,
        ...(cruisePhase ? { cruisePhase } : {}),
      });
    }
  }

  for (let i = boats.length - 1; i >= 0; i--) {
    const boat = boats[i];
    if (!boat.kind) {
      boat.kind = i % 3 === 0 ? 'small' : i % 3 === 1 ? 'medium' : 'yacht';
    }
    const isCruise = boat.kind === 'cruise';

    if (isCruise) {
      const fromIdx = boat.fromY * gw + boat.fromX;
      const toIdx = boat.toY * gw + boat.toX;
      if (
        !hasBridgeFreeCruisePort ||
        !cruiseNav.navigableWater.has(fromIdx) ||
        !cruiseNav.navigableWater.has(toIdx)
      ) {
        boats.splice(i, 1);
        continue;
      }
    }

    boat.progress += boat.speed * moveDt;
    if (boat.progress >= 1) {
      boat.progress -= 1;
      const prevX = boat.fromX;
      const prevY = boat.fromY;
      const dirX = boat.toX - prevX;
      const dirY = boat.toY - prevY;
      boat.fromX = boat.toX;
      boat.fromY = boat.toY;

      const curTile = getTile(state, boat.fromX, boat.fromY);
      const curIdx = boat.fromY * gw + boat.fromX;

      if (isCruise) {
        if (
          !curTile ||
          !isCruiseNavigableWater(curTile.type) ||
          !cruiseNav.navigableWater.has(curIdx)
        ) {
          boats.splice(i, 1);
          continue;
        }
        const neighbors = getOrthoNeighbors(state, boat.fromX, boat.fromY).filter(
          (n) => isCruiseNavigableWater(n.type) && cruiseNav.navigableWater.has(n.y * gw + n.x)
        );
        if (neighbors.length === 0) {
          boats.splice(i, 1);
          continue;
        }

        const dPort = cruiseNav.distToPort.get(curIdx) ?? 999;
        const dMouth = cruiseNav.distToMouth.get(curIdx) ?? 999;
        if (dPort === 0) {
          boat.cruisePhase = 'to_mouth';
        } else if (dMouth === 0 || !boat.cruisePhase) {
          boat.cruisePhase = 'to_port';
        }

        const forward = neighbors.filter((n) => n.x !== prevX || n.y !== prevY);
        const pool = forward.length > 0 ? forward : neighbors;
        const distField =
          boat.cruisePhase === 'to_mouth' ? cruiseNav.distToMouth : cruiseNav.distToPort;
        pool.sort((a, b) => {
          const da = distField.get(a.y * gw + a.x) ?? 999;
          const db = distField.get(b.y * gw + b.x) ?? 999;
          if (da !== db) return da - db;
          const sa = a.x - boat.fromX === dirX && a.y - boat.fromY === dirY ? 0 : 1;
          const sb = b.x - boat.fromX === dirX && b.y - boat.fromY === dirY ? 0 : 1;
          return sa - sb;
        });
        const next = pool[0];
        boat.toX = next.x;
        boat.toY = next.y;
      } else {
        if (!curTile || !isNavigableWater(curTile.type)) {
          boats.splice(i, 1);
          continue;
        }

        const neighbors = getOrthoNeighbors(state, boat.fromX, boat.fromY).filter((n) =>
          isNavigableWater(n.type)
        );
        if (neighbors.length === 0) {
          boats.splice(i, 1);
          continue;
        }
        const forward = neighbors.filter((n) => n.x !== prevX || n.y !== prevY);
        const pool = forward.length > 0 ? forward : neighbors;
        // Prefer continuing straight along the river channel and passing under bridges
        const bridgeAhead = pool.find((n) => n.type === 'bridge');
        const straight = pool.find(
          (n) => n.x - boat.fromX === dirX && n.y - boat.fromY === dirY
        );
        const next =
          bridgeAhead && Math.random() < 0.72
            ? bridgeAhead
            : straight && Math.random() < 0.74
              ? straight
              : pool[Math.floor(Math.random() * pool.length)];
        boat.toX = next.x;
        boat.toY = next.y;
      }
    }

    boat.x = boat.fromX + 0.5 + (boat.toX - boat.fromX) * boat.progress;
    boat.y = boat.fromY + 0.5 + (boat.toY - boat.fromY) * boat.progress;

    if (Math.random() < dt * 4.5) {
      spawnParticle(
        particles,
        particleCursor,
        boat.x,
        boat.y,
        0,
        0,
        0.7,
        boat.kind === 'small' ? 1.5 : boat.kind === 'cruise' ? 3.2 : 2,
        '#b8f0ff',
        'wake'
      );
    }
  }

  // 2. Commercial Airplanes: Sky Overflights + Realistic Airport Landings, Hangar Entry & Takeoffs!
  const airportAnchor =
    state.tiles.find((t) => t.type === 'airport' && t.lotRole !== 'part') ?? null;
  const airportLevel = airportAnchor ? Math.max(1, Math.min(3, airportAnchor.level || 1)) : 0;
  const desiredPlanes =
    state.stats.airportCount > 0 && airportAnchor
      ? Math.min(GROWTH_CONFIG.maxPlanes, 2 + airportLevel)
      : 0;

  if (desiredPlanes === 0 && planes.length > 0) {
    planes.length = 0;
  }

  if (desiredPlanes > 0 && airportAnchor) {
    const lotW = airportAnchor.lotWidth ?? 4;
    const lotH = airportAnchor.lotHeight ?? 10;
    const isExpanded = lotW >= 8 || lotH >= 16;
    const isMedium6x12 = !isExpanded && lotW >= 6 && lotH >= 12;
    const isCompact4x10 = !isExpanded && !isMedium6x12 && lotW === 4 && lotH >= 10;
    const runwayX =
      airportAnchor.x + (isExpanded ? 5.5 : isMedium6x12 ? 4.0 : 2.5);
    const apronX =
      airportAnchor.x + (isExpanded ? 3.5 : isMedium6x12 ? 1.5 : 1.5);
    const runwayStartY = airportAnchor.y + 1.3;
    const runwayEndY = airportAnchor.y + lotH - 1.3;
    const northHangarX = airportAnchor.x + (isExpanded ? 1.45 : isMedium6x12 ? 0.52 : 0.48);
    const northHangarY = airportAnchor.y + (isExpanded ? 4.5 : isMedium6x12 ? 3.2 : 3.2);
    const southHangarX = airportAnchor.x + (isExpanded ? 1.45 : isMedium6x12 ? 0.52 : 0.48);
    const southHangarY =
      airportAnchor.y +
      (isExpanded ? 12.5 : isMedium6x12 ? 9.2 : isCompact4x10 ? 7.5 : 3.2);

    const countActiveRunwayTraffic = () =>
      planes.filter(
        (p) =>
          p.phase === 'approach' ||
          p.phase === 'landing_roll' ||
          p.phase === 'takeoff_roll'
      ).length;

    while (planes.length < desiredPlanes) {
      const idx = planes.length;
      const accentColor = PLANE_ACCENTS[idx % PLANE_ACCENTS.length];
      const useSouth = (isExpanded || isMedium6x12 || isCompact4x10) && idx % 2 === 1;
      const hx = useSouth ? southHangarX : northHangarX;
      const hy = useSouth ? southHangarY : northHangarY;
      if (idx === 0) {
        planes.push({
          x: hx,
          y: hy,
          vx: 0.8,
          vy: 0,
          altitude: 0,
          accentColor,
          phase: 'in_hangar',
          phaseTimer: 2.2,
          pitch: 0,
          runwayX,
          runwayStartY,
          runwayEndY,
          apronX,
          hangarX: hx,
          hangarY: hy,
        });
      } else if (idx === 1) {
        planes.push({
          x: runwayX + (Math.random() - 0.5) * 3,
          y: runwayStartY - 12,
          vx: 0,
          vy: 2.7,
          altitude: 54,
          accentColor,
          phase: 'approach',
          phaseTimer: 0,
          pitch: -0.14,
          runwayX,
          runwayStartY,
          runwayEndY,
          apronX,
          hangarX: hx,
          hangarY: hy,
        });
      } else {
        const fromLeft = idx % 2 === 0;
        const speed = 2.6 + Math.random() * 1.0;
        planes.push({
          x: fromLeft ? -3 - Math.random() * 4 : state.gridWidth + 3 + Math.random() * 4,
          y: 3 + Math.random() * Math.max(6, state.gridHeight - 6),
          vx: fromLeft ? speed : -speed,
          vy: (Math.random() - 0.5) * 1.5,
          altitude: 58 + Math.random() * 16,
          accentColor,
          phase: 'cruise',
          phaseTimer: 0,
          pitch: 0,
          runwayX,
          runwayStartY,
          runwayEndY,
          apronX,
          hangarX: hx,
          hangarY: hy,
        });
      }
    }

    for (let i = 0; i < planes.length; i++) {
      const plane = planes[i];
      plane.runwayX = runwayX;
      plane.runwayStartY = runwayStartY;
      plane.runwayEndY = runwayEndY;
      plane.apronX = apronX;
      const useSouth = (isExpanded || isMedium6x12 || isCompact4x10) && i % 2 === 1;
      const hx = plane.hangarX ?? (useSouth ? southHangarX : northHangarX);
      const hy = plane.hangarY ?? (useSouth ? southHangarY : northHangarY);
      plane.hangarX = hx;
      plane.hangarY = hy;
      plane.phaseTimer = (plane.phaseTimer ?? 0) + moveDt;

      if (plane.phase === 'approach') {
        const targetX = runwayX;
        const targetY = runwayStartY + 1.2;
        const dx = targetX - plane.x;
        const dy = targetY - plane.y;
        const dist = Math.hypot(dx, dy);

        if (dist < 0.65) {
          plane.phase = 'landing_roll';
          plane.phaseTimer = 0;
          plane.x = runwayX;
          plane.y = runwayStartY + 1.2;
          plane.vx = 0;
          plane.vy = 2.7;
          plane.altitude = 0;
          plane.pitch = 0.04;
          for (let s = 0; s < 3; s++) {
            spawnParticle(
              particles,
              particleCursor,
              plane.x + (Math.random() - 0.5) * 0.3,
              plane.y + (Math.random() - 0.5) * 0.3,
              (Math.random() - 0.5) * 0.4,
              -0.25,
              0.7,
              2.6,
              '#e2e8f0',
              'smoke'
            );
          }
        } else {
          const speed = Math.max(2.2, Math.min(3.1, 2.2 + dist * 0.07));
          const desiredVx = (dx / dist) * speed;
          const desiredVy = (dy / dist) * speed;
          const turnRate = Math.min(1, moveDt * 3.5);
          plane.vx += (desiredVx - plane.vx) * turnRate;
          plane.vy += (desiredVy - plane.vy) * turnRate;
          plane.x += plane.vx * moveDt;
          plane.y += plane.vy * moveDt;
          const targetAlt = Math.max(0, Math.min(64, (dist - 0.4) * 3.8));
          plane.altitude += (targetAlt - plane.altitude) * Math.min(1, moveDt * 4.5);
          plane.pitch = dist < 3.0 ? 0.08 : -0.14;
        }
      } else if (plane.phase === 'landing_roll') {
        const runwayLen = Math.max(4, runwayEndY - runwayStartY);
        const progress = Math.max(
          0,
          Math.min(1, (plane.y - runwayStartY) / runwayLen)
        );
        const speed = 2.6 * (1 - progress * 0.72);
        plane.x += (runwayX - plane.x) * Math.min(1, moveDt * 8);
        plane.vx = 0;
        plane.vy = Math.max(0.7, speed);
        plane.y += plane.vy * moveDt;
        plane.altitude = 0;
        plane.pitch = 0;

        if (plane.y >= runwayEndY - 0.8) {
          plane.phase = 'taxi_to_hangar';
          plane.phaseTimer = 0;
          plane.pitch = 0;
        }
      } else if (plane.phase === 'taxi_to_hangar') {
        // Taxi off the runway onto the apron, align with the hangar bay, then enter the hangar!
        plane.altitude = 0;
        plane.pitch = 0;
        const taxiSpd = 1.65;
        let wpX = apronX;
        let wpY = hy;
        if (Math.abs(plane.x - apronX) > 0.35 && Math.abs(plane.y - hy) > 0.45) {
          wpX = apronX;
          wpY = plane.y;
        } else if (Math.abs(plane.y - hy) > 0.25) {
          wpX = apronX;
          wpY = hy;
        } else {
          wpX = hx;
          wpY = hy;
        }

        const dx = wpX - plane.x;
        const dy = wpY - plane.y;
        const dist = Math.hypot(dx, dy);
        if (wpX === hx && dist < 0.24) {
          plane.phase = 'in_hangar';
          plane.phaseTimer = 0;
          plane.x = hx;
          plane.y = hy;
          plane.vx = 0.8;
          plane.vy = 0;
        } else if (dist > 0.02) {
          const step = Math.min(dist, taxiSpd * moveDt);
          plane.vx = (dx / dist) * taxiSpd;
          plane.vy = (dy / dist) * taxiSpd;
          plane.x += (dx / dist) * step;
          plane.y += (dy / dist) * step;
        }
      } else if (plane.phase === 'in_hangar') {
        // Parked safely inside the airport Galpão (hangar) before departing
        plane.altitude = 0;
        plane.pitch = 0;
        plane.x = hx;
        plane.y = hy;
        plane.vx = 0.8;
        plane.vy = 0;
        if (plane.phaseTimer >= 3.6) {
          plane.phase = 'taxi_from_hangar';
          plane.phaseTimer = 0;
        }
      } else if (plane.phase === 'taxi_from_hangar' || plane.phase === 'parked') {
        // Emerge nose-first from the hangar onto the apron, then taxi to runway takeoff threshold
        plane.altitude = 0;
        plane.pitch = 0;
        const taxiSpd = 1.65;
        const targetStartY = runwayStartY + 0.3;
        let wpX = runwayX;
        let wpY = targetStartY;
        if (plane.x < apronX - 0.22 && Math.abs(plane.y - hy) < 0.6) {
          wpX = apronX;
          wpY = hy;
        } else if (Math.abs(plane.y - targetStartY) > 0.35) {
          wpX = apronX;
          wpY = targetStartY;
        }
        const dx = wpX - plane.x;
        const dy = wpY - plane.y;
        const dist = Math.hypot(dx, dy);

        if (wpX === runwayX && dist < 0.26) {
          if (countActiveRunwayTraffic() < 2) {
            plane.phase = 'takeoff_roll';
            plane.phaseTimer = 0;
            plane.x = runwayX;
            plane.y = targetStartY;
            plane.vx = 0;
            plane.vy = 0.9;
            plane.altitude = 0;
            plane.pitch = 0;
          } else {
            plane.vx = 0.1;
            plane.vy = 0.05;
          }
        } else if (dist > 0.02) {
          const step = Math.min(dist, taxiSpd * moveDt);
          plane.vx = (dx / dist) * taxiSpd;
          plane.vy = (dy / dist) * taxiSpd;
          plane.x += (dx / dist) * step;
          plane.y += (dy / dist) * step;
        }
      } else if (plane.phase === 'takeoff_roll') {
        const runwayLen = Math.max(4, runwayEndY - runwayStartY);
        const progress = Math.max(
          0,
          Math.min(1, (plane.y - runwayStartY) / runwayLen)
        );
        const speed = 1.0 + progress * 2.9;
        plane.x += (runwayX - plane.x) * Math.min(1, moveDt * 8);
        plane.vx = 0;
        plane.vy = speed;
        plane.y += plane.vy * moveDt;

        // Rotate nose up & lift off in the final third of the runway!
        if (progress > 0.68) {
          const lift = (progress - 0.68) / 0.32;
          plane.altitude = lift * 9;
          plane.pitch = 0.28;
        } else {
          plane.altitude = 0;
          plane.pitch = 0.03;
        }

        if (plane.y >= runwayEndY - 0.2 || plane.altitude >= 8.5) {
          plane.phase = 'climb';
          plane.phaseTimer = 0;
          const lateral = (Math.random() - 0.5) * 2.4;
          const climbSpeed = 3.1;
          const mag = Math.hypot(lateral, 2.4) || 1;
          plane.exitVx = (lateral / mag) * climbSpeed;
          plane.exitVy = (2.4 / mag) * climbSpeed;
        }
      } else if (plane.phase === 'climb') {
        const targetVx = plane.exitVx ?? 1.2;
        const targetVy = plane.exitVy ?? 2.6;
        const blend = Math.min(1, moveDt * 1.4);
        plane.vx += (targetVx - plane.vx) * blend;
        plane.vy += (targetVy - plane.vy) * blend;
        plane.x += plane.vx * moveDt;
        plane.y += plane.vy * moveDt;
        plane.altitude += 15 * moveDt;
        plane.pitch = 0.24;

        if (plane.altitude >= 58) {
          plane.phase = 'cruise';
          plane.phaseTimer = 0;
          plane.pitch = 0;
        }
      } else {
        // 'cruise' high-altitude sky overflight
        plane.x += plane.vx * moveDt;
        plane.y += plane.vy * moveDt;
        plane.pitch = 0;

        // Some sky planes passing over the northern approach sector smoothly divert to land!
        if (
          plane.phaseTimer > 2.5 &&
          plane.y > -2 &&
          plane.y < runwayStartY - 3.5 &&
          Math.abs(plane.x - runwayX) < 11 &&
          plane.vy >= -0.4 &&
          countActiveRunwayTraffic() === 0 &&
          Math.random() < 0.04
        ) {
          plane.phase = 'approach';
          plane.phaseTimer = 0;
          plane.pitch = -0.14;
          continue;
        }

        const outOfBounds =
          plane.x < -8 ||
          plane.x > state.gridWidth + 8 ||
          plane.y < -8 ||
          plane.y > state.gridHeight + 8;

        if (outOfBounds) {
          const shouldLandNext =
            countActiveRunwayTraffic() === 0 && Math.random() < 0.45;
          if (shouldLandNext) {
            plane.phase = 'approach';
            plane.phaseTimer = 0;
            plane.x = runwayX + (Math.random() - 0.5) * 10;
            plane.y = -4;
            plane.vx = (runwayX - plane.x) * 0.15;
            plane.vy = 2.7;
            plane.altitude = 62;
            plane.pitch = -0.14;
          } else {
            const fromLeft = Math.random() > 0.5;
            const speed = 2.5 + Math.random() * 1.2;
            plane.phase = 'cruise';
            plane.phaseTimer = 0;
            plane.x = fromLeft ? -4 : state.gridWidth + 4;
            plane.y = 3 + Math.random() * Math.max(4, state.gridHeight - 6);
            plane.vx = fromLeft ? speed : -speed;
            plane.vy = (Math.random() - 0.5) * 1.5;
            plane.altitude = 56 + Math.random() * 20;
            plane.pitch = 0;
          }
        }
      }
    }
  }

  // 3. City Helicopters & 2×2 Skyscraper Helipad Landing / Takeoff Operations
  if (helicopters) {
    const helipadTargets: Array<{
      tileKey: number;
      centerX: number;
      centerY: number;
      roofAlt: number;
    }> = [];

    for (let i = 0; i < state.tiles.length; i++) {
      const t = state.tiles[i];
      if (t.lotRole === 'part') continue;
      if (hasSkyscraperHelipad(t)) {
        const roofHd = getSkyscraperRoofHeightHd(t);
        helipadTargets.push({
          tileKey: t.y * state.gridWidth + t.x,
          centerX: t.x + 1.0,
          centerY: t.y + 1.0,
          roofAlt: roofHd / 2,
        });
      }
    }

    const desiredHelis =
      helipadTargets.length > 0
        ? Math.min(GROWTH_CONFIG.maxHelicopters, 1 + Math.min(3, helipadTargets.length))
        : state.stats.airportCount > 0
          ? 2
          : state.totalPopulation >= 200
            ? 1
            : 0;

    if (desiredHelis === 0 && helicopters.length > 0) {
      helicopters.length = 0;
    }

    const HELI_COLORS: Array<[string, string]> = [
      ['#f8fafc', '#ef4444'],
      ['#0f172a', '#f5b73b'],
      ['#1d4ed8', '#38bdf8'],
      ['#047857', '#fde047'],
    ];

    while (helicopters.length < desiredHelis) {
      const idx = helicopters.length;
      const [color, accentColor] = HELI_COLORS[idx % HELI_COLORS.length];
      if (idx === 0 && helipadTargets.length > 0) {
        const pad = helipadTargets[0];
        helicopters.push({
          x: pad.centerX + 3.2,
          y: pad.centerY - 2.4,
          vx: -1.1,
          vy: 0.85,
          altitude: pad.roofAlt + 18,
          rotorAngle: idx * 1.3,
          color,
          accentColor,
          phase: 'approach',
          phaseTimer: 0,
          targetX: pad.centerX,
          targetY: pad.centerY,
          targetAlt: pad.roofAlt,
          targetTileKey: pad.tileKey,
        });
      } else {
        const fromLeft = idx % 2 === 0;
        const spd = 1.6 + Math.random() * 0.7;
        helicopters.push({
          x: fromLeft ? 1 : state.gridWidth - 1,
          y: 4 + Math.random() * Math.max(4, state.gridHeight - 8),
          vx: fromLeft ? spd : -spd,
          vy: (Math.random() - 0.5) * 1.1,
          altitude: 68 + Math.random() * 14,
          rotorAngle: idx * 1.7,
          color,
          accentColor,
          phase: 'cruise',
          phaseTimer: 0,
        });
      }
    }

    const padOccupiedByOther = (tileKey: number, selfIdx: number) =>
      helicopters.some(
        (h, j) =>
          j !== selfIdx &&
          h.targetTileKey === tileKey &&
          h.phase !== 'cruise'
      );

    for (let i = 0; i < helicopters.length; i++) {
      const heli = helicopters[i];
      heli.phaseTimer = (heli.phaseTimer ?? 0) + moveDt;

      // Rotor spin speed: fast in flight, winds down gently while landed on a skyscraper helipad
      const rotorSpeed =
        heli.phase === 'landed'
          ? heli.phaseTimer < 1.0 || heli.phaseTimer > 3.6
            ? 14
            : 2.8
          : 26;
      heli.rotorAngle = (heli.rotorAngle + moveDt * rotorSpeed) % (Math.PI * 2);

      // Keep target pad valid if the skyscraper still exists
      const targetPad =
        heli.targetTileKey !== undefined
          ? helipadTargets.find((p) => p.tileKey === heli.targetTileKey)
          : undefined;

      if (heli.phase === 'approach') {
        if (!targetPad) {
          heli.phase = 'cruise';
          heli.phaseTimer = 0;
          continue;
        }
        heli.targetX = targetPad.centerX;
        heli.targetY = targetPad.centerY;
        heli.targetAlt = targetPad.roofAlt;

        const dx = targetPad.centerX - heli.x;
        const dy = targetPad.centerY - heli.y;
        const dist = Math.hypot(dx, dy);
        const hoverAlt = targetPad.roofAlt + 18;
        heli.altitude += (hoverAlt - heli.altitude) * Math.min(1, moveDt * 2.8);

        if (dist < 0.18) {
          heli.x = targetPad.centerX;
          heli.y = targetPad.centerY;
          heli.phase = 'descending';
          heli.phaseTimer = 0;
        } else {
          const speed = Math.max(0.85, Math.min(1.9, dist * 0.9));
          const step = Math.min(dist, speed * moveDt);
          heli.vx = (dx / dist) * speed;
          heli.vy = (dy / dist) * speed;
          heli.x += (dx / dist) * step;
          heli.y += (dy / dist) * step;
        }
      } else if (heli.phase === 'descending') {
        if (!targetPad) {
          heli.phase = 'ascending';
          heli.phaseTimer = 0;
          continue;
        }
        heli.x = targetPad.centerX;
        heli.y = targetPad.centerY;
        heli.targetAlt = targetPad.roofAlt;
        heli.altitude = Math.max(targetPad.roofAlt, heli.altitude - 13 * moveDt);
        if (heli.altitude <= targetPad.roofAlt + 0.35) {
          heli.altitude = targetPad.roofAlt;
          heli.phase = 'landed';
          heli.phaseTimer = 0;
        }
      } else if (heli.phase === 'landed') {
        if (targetPad) {
          heli.x = targetPad.centerX;
          heli.y = targetPad.centerY;
          heli.altitude = targetPad.roofAlt;
        }
        if (heli.phaseTimer >= 4.5) {
          heli.phase = 'ascending';
          heli.phaseTimer = 0;
          const ang = Math.random() * Math.PI * 2;
          const spd = 1.65 + Math.random() * 0.55;
          heli.exitVx = Math.cos(ang) * spd;
          heli.exitVy = Math.sin(ang) * spd;
        }
      } else if (heli.phase === 'ascending') {
        const liftTarget = (heli.targetAlt ?? 56) + 22;
        heli.altitude = Math.min(liftTarget, heli.altitude + 14 * moveDt);
        if (heli.altitude >= liftTarget - 0.5) {
          heli.vx = heli.exitVx ?? 1.4;
          heli.vy = heli.exitVy ?? -0.9;
          heli.phase = 'cruise';
          heli.phaseTimer = 0;
          heli.targetTileKey = undefined;
          heli.targetX = undefined;
          heli.targetY = undefined;
        }
      } else {
        // 'cruise' city patrol / transit
        heli.x += heli.vx * moveDt;
        heli.y += heli.vy * moveDt;
        const desiredCruiseAlt = 76;
        heli.altitude += (desiredCruiseAlt - heli.altitude) * Math.min(1, moveDt * 1.4);

        // Divert to land on a 2×2 skyscraper helipad!
        if (helipadTargets.length > 0 && heli.phaseTimer > 2.4) {
          const freePad = helipadTargets.find((p) => !padOccupiedByOther(p.tileKey, i));
          if (
            freePad &&
            (Math.hypot(freePad.centerX - heli.x, freePad.centerY - heli.y) < 18 ||
              Math.random() < 0.08)
          ) {
            heli.phase = 'approach';
            heli.phaseTimer = 0;
            heli.targetTileKey = freePad.tileKey;
            heli.targetX = freePad.centerX;
            heli.targetY = freePad.centerY;
            heli.targetAlt = freePad.roofAlt;
            continue;
          }
        }

        const outOfBounds =
          heli.x < -5 ||
          heli.x > state.gridWidth + 5 ||
          heli.y < -5 ||
          heli.y > state.gridHeight + 5;
        if (outOfBounds) {
          const freePad = helipadTargets.find((p) => !padOccupiedByOther(p.tileKey, i));
          if (freePad) {
            heli.phase = 'approach';
            heli.phaseTimer = 0;
            heli.targetTileKey = freePad.tileKey;
            heli.targetX = freePad.centerX;
            heli.targetY = freePad.centerY;
            heli.targetAlt = freePad.roofAlt;
            heli.x = Math.max(
              0,
              Math.min(state.gridWidth - 1, freePad.centerX + (Math.random() > 0.5 ? 8 : -8))
            );
            heli.y = Math.max(
              0,
              Math.min(state.gridHeight - 1, freePad.centerY + (Math.random() > 0.5 ? 6 : -6))
            );
            heli.altitude = freePad.roofAlt + 24;
          } else {
            const fromLeft = Math.random() > 0.5;
            const spd = 1.65 + Math.random() * 0.65;
            heli.x = fromLeft ? -3 : state.gridWidth + 3;
            heli.y = 3 + Math.random() * Math.max(4, state.gridHeight - 6);
            heli.vx = fromLeft ? spd : -spd;
            heli.vy = (Math.random() - 0.5) * 1.1;
            heli.altitude = 70 + Math.random() * 14;
            heli.phaseTimer = 0;
          }
        }
      }
    }
  }
}
