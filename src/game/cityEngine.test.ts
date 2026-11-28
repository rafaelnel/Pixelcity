import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceSimulationTime,
  closeFinancialMonth,
  computeCityNeeds,
  computeFairTaxRate,
  countRiverBridges,
  createHudSnapshot,
  createNewCity,
  createParticlePool,
  deleteSavedCityFromStorage,
  demolishCityTile,
  deserializeCitySave,
  executeEmergencyAction,
  expandCityLand,
  getCruisePortNavigationInfo,
  getEmergencyOffers,
  getMainConnectedRoadSet,
  getTile,
  getTrafficSignalState,
  isCruiseNavigableWater,
  isDoubleWidthBridgeTile,
  isNavigableWater,
  isTrafficLightIntersection,
  loadSavedCitiesFromStorage,
  placePortOnRiverfront,
  recomputeFieldsAndStats,
  SAVE_STORAGE_KEY,
  saveCurrentCityToStorage,
  serializeCitySave,
  setCityBudget,
  setCityBudgetTargetPct,
  setTaxRate,
  stepCityTick,
  type StorageLike,
  updateBoatsAndPlanes,
  updateCarsAndParticles,
} from './cityEngine';
import {
  gridToScreen,
  MAX_ZOOM,
  MIN_ZOOM,
  rotateRoadMask,
  screenToGrid,
  zoomCameraAtPoint,
} from './isoMath';
import {
  BUDGET_AREA_META,
  BUDGET_AREA_ORDER,
  FIXED_COSTS_CONFIG,
  GRID_SIZE,
  GROWTH_CONFIG,
  LAND_EXPAND_CHUNK,
  POLLUTION_EMISSION,
  SECONDS_PER_GROWTH_TICK_1X,
  SECONDS_PER_MONTH_1X,
  SHOPPING_COMMERCIAL_REVENUE_PER_LEVEL,
  getScaledMaxUpgradesPerTick,
  getSegmentEffectCurve,
} from './simulationConfig';
import type { BoatEntity, CameraRotation, CameraState, CarEntity, EmergencyActionId, HelicopterEntity, PlaneEntity } from './types';

function runEmergencyWorkToCompletion(
  city: ReturnType<typeof createNewCity>,
  actionId: EmergencyActionId
): { ok: boolean; reason?: string; executedTitle?: string; evolvedToTier?: number } {
  const res = executeEmergencyAction(city, actionId);
  if (!res.ok) return res;
  let guard = 18;
  while (city.pendingWorks.some((w) => w.actionId === actionId) && guard > 0) {
    closeFinancialMonth(city);
    guard--;
  }
  return {
    ...res,
    evolvedToTier: city.workTiers[actionId] ?? res.evolvedToTier,
  };
}

test('6 budget segments use the updated Pixópolis names and roles', () => {
  assert.equal(BUDGET_AREA_META.infrastructure.label, 'Infraestrutura');
  assert.equal(BUDGET_AREA_META.education.label, 'Educação');
  assert.equal(BUDGET_AREA_META.security.label, 'Segurança');
  assert.equal(BUDGET_AREA_META.wellbeing.label, 'Saúde & Meio Ambiente');
  assert.equal(BUDGET_AREA_META.entertainment.label, 'Cultura & Lazer');
  assert.equal(BUDGET_AREA_META.tourism.label, 'Turismo & Comércio');
  for (const key of BUDGET_AREA_ORDER) {
    assert.ok(BUDGET_AREA_META[key].roleTag.length > 0);
    assert.ok(BUDGET_AREA_META[key].over100Summary.length > 0);
  }
});

test('realistic calendar timing: 30s/month at 1x, 15s at 2x, 7.5s at 4x with sub-month growth cycles', () => {
  assert.equal(SECONDS_PER_MONTH_1X, 30);
  assert.equal(SECONDS_PER_MONTH_1X / 2, 15);
  assert.equal(SECONDS_PER_MONTH_1X / 4, 7.5);
  assert.ok(
    SECONDS_PER_GROWTH_TICK_1X >= 2 && SECONDS_PER_GROWTH_TICK_1X <= 3,
    `Expected sub-month growth cycle between 2s and 3s at 1x, got ${SECONDS_PER_GROWTH_TICK_1X}`
  );

  const city = createNewCity(424242);
  const startMonth = city.month;
  const startMoney = city.money;

  const half = advanceSimulationTime(city, 15);
  assert.equal(half.grew, true);
  assert.equal(half.monthClosed, false);
  assert.equal(city.month, startMonth);
  assert.equal(city.money, startMoney, 'Cash should not change until monthly closing');

  const end = advanceSimulationTime(city, 15);
  assert.equal(end.monthClosed, true);
  assert.equal(city.month, startMonth + 1);
  assert.equal(city.history.length, 2);
});

test('isometric projection and screenToGrid round-trip cleanly on square AND rectangular expanded maps across all 4 rotations', () => {
  const rotations: CameraRotation[] = [0, 1, 2, 3];
  const shapes: Array<[number, number]> = [
    [GRID_SIZE, GRID_SIZE],
    [44, 36],
    [36, 52],
  ];

  for (const [gw, gh] of shapes) {
    const sampleCoords: Array<[number, number]> = [
      [0, 0],
      [Math.floor(gw / 2), Math.floor(gh / 2)],
      [gw - 1, 0],
      [0, gh - 1],
      [gw - 1, gh - 1],
      [10, 22],
    ];
    for (const rot of rotations) {
      const cam: CameraState = { panX: 45, panY: -22, zoom: 1.5, rotation: rot };
      for (const [tx, ty] of sampleCoords) {
        const { sx, sy } = gridToScreen(tx, ty, 1200, 800, cam, gw, gh);
        const back = screenToGrid(sx, sy, 1200, 800, cam, gw, gh);
        assert.deepEqual(back, { tx, ty }, `Mismatch for ${gw}x${gh} rot=${rot} (${tx},${ty})`);
      }
    }
  }

  assert.equal(rotateRoadMask(1, 1), 2);
  assert.equal(rotateRoadMask(1 | 2, 1), 2 | 4);
  assert.equal(rotateRoadMask(5, 2), 5);
});

test('zoomCameraAtPoint preserves focal world tile under cursor and clamps zoom bounds', () => {
  const startCam: CameraState = { panX: 0, panY: 0, zoom: 1.0, rotation: 0 };
  const focal = gridToScreen(22, 14, 1000, 700, startCam, GRID_SIZE, GRID_SIZE);
  const zoomedIn = zoomCameraAtPoint(startCam, 2.2, focal.sx, focal.sy, 1000, 700, GRID_SIZE, GRID_SIZE);
  assert.equal(zoomedIn.zoom, 2.2);

  const hitAfter = screenToGrid(focal.sx, focal.sy, 1000, 700, zoomedIn, GRID_SIZE, GRID_SIZE);
  assert.deepEqual(hitAfter, { tx: 22, ty: 14 });

  const tooLow = zoomCameraAtPoint(startCam, 0.05, 500, 350, 1000, 700, GRID_SIZE, GRID_SIZE);
  const tooHigh = zoomCameraAtPoint(startCam, 99, 500, 350, 1000, 700, GRID_SIZE, GRID_SIZE);
  assert.equal(tooLow.zoom, MIN_ZOOM);
  assert.equal(tooHigh.zoom, MAX_ZOOM);
});

test('createNewCity is deterministic for the same seed and unique across seeds', () => {
  const a = createNewCity(202601);
  const b = createNewCity(202601);
  const c = createNewCity(998877);

  assert.equal(a.trait.id, b.trait.id);
  assert.equal(a.money, b.money);
  assert.deepEqual(
    a.tiles.map((t) => t.type),
    b.tiles.map((t) => t.type)
  );
  assert.notDeepEqual(
    a.tiles.map((t) => t.type),
    c.tiles.map((t) => t.type)
  );
});

test('unified city-wide variable investments accept any dollar amount and create real fiscal trade-offs', async () => {
  const { setCityBudgetTargetPct } = await import('./cityEngine');
  const city = createNewCity(555001);
  assert.equal(BUDGET_AREA_ORDER.length, 6);

  const starterRev = city.financials.revenue.total;
  assert.ok(starterRev >= 1800, `Expected realistic starter monthly revenue >= $1800, got $${starterRev}`);
  const totalNeededStarter = BUDGET_AREA_ORDER.reduce(
    (s, k) => s + city.stats.coverage[k].needed,
    0
  );
  // 100% across all 6 segments should exceed 9%-tax revenue so player must balance priorities or raise taxes
  assert.ok(
    totalNeededStarter > starterRev * 0.95,
    `Expected 100% total needed ($${totalNeededStarter}) to challenge starter 9%-tax revenue ($${starterRev})`
  );

  // Putting ALL 6 segments at 100% at default 9% tax MUST run a deficit
  for (const k of BUDGET_AREA_ORDER) {
    setCityBudgetTargetPct(city, k, 100);
  }
  assert.ok(
    city.financials.netBalance < 0,
    `Expected 100% across all segments at 9% tax to cause a deficit, got ${city.financials.netBalance}`
  );

  // Putting ALL 6 segments at 200% MUST cause a steep deficit (even after bounded 200% tourism/education returns)
  for (const k of BUDGET_AREA_ORDER) {
    setCityBudgetTargetPct(city, k, 200);
  }
  assert.ok(
    city.financials.netBalance < -2200,
    `Expected 200% across all segments to cause a heavy deficit, got ${city.financials.netBalance}`
  );

  // Raising tax high enough to pay for 100% services visibly lowers happiness vs 9% tax
  for (const k of BUDGET_AREA_ORDER) {
    setCityBudgetTargetPct(city, k, 100);
  }
  const happyAt9 = city.globalHappiness;
  setTaxRate(city, 'residential', 14);
  setTaxRate(city, 'commercial', 14);
  setTaxRate(city, 'industrial', 14);
  assert.ok(
    city.financials.netBalance >= 0,
    `Expected higher taxes (14%) to fund 100% services without deficit, got ${city.financials.netBalance}`
  );
  assert.ok(
    city.globalHappiness < happyAt9,
    `Expected high taxes to lower happiness (${happyAt9} -> ${city.globalHappiness})`
  );

  // Direct exact variable dollar amounts still work
  assert.equal(setCityBudget(city, 'infrastructure', 437), true);
  assert.equal(city.budgets.infrastructure, 437);

  assert.equal(setCityBudget(city, 'education', 12345), true);
  assert.equal(city.budgets.education, 12345);

  assert.equal(setCityBudget(city, 'security', 0), true);
  assert.equal(city.stats.coverage.security.coveragePct, 0);

  const fin = city.financials;
  assert.equal(
    fin.revenue.total,
    fin.revenue.residentialTax +
      fin.revenue.commercialTax +
      fin.revenue.industrialTax +
      fin.revenue.tourismIncome +
      fin.revenue.tradeIncome
  );
  assert.equal(
    fin.expenses.fixedTotal,
    fin.expenses.fixedRoadsAndBridges + fin.expenses.fixedCityHall
  );
  assert.equal(fin.expenses.total, fin.expenses.variableBudgets + fin.expenses.fixedTotal);
  assert.equal(fin.netBalance, fin.revenue.total - fin.expenses.total);
});

test('4-direction adjacent land expansion grows map, shifts tiles/entities cleanly, and continues rivers', () => {
  const city = createNewCity(612345);
  city.money = 350000;
  const cars: CarEntity[] = [
    { x: 18.5, y: 18.5, fromX: 18, fromY: 18, toX: 18, toY: 19, progress: 0.5, speed: 1, color: '#fff', laneOffset: 0.1 },
  ];
  const boats: BoatEntity[] = [
    { x: 5.5, y: 5.5, fromX: 5, fromY: 5, toX: 5, toY: 6, progress: 0.5, speed: 1, hullColor: '#fff', cargoColor: '#f00' },
  ];

  const initialRoadCount = city.stats.roadCount;
  const initialVersion = city.mapVersion;

  // Expand Norte (+8 height, shifts Y by +8)
  const expN = expandCityLand(city, 'norte', cars, boats);
  assert.equal(expN.ok, true);
  assert.equal(city.gridWidth, GRID_SIZE);
  assert.equal(city.gridHeight, GRID_SIZE + LAND_EXPAND_CHUNK);
  assert.equal(city.tiles.length, city.gridWidth * city.gridHeight);
  assert.ok(city.stats.roadCount >= initialRoadCount);
  assert.equal(cars[0].fromY, 18 + LAND_EXPAND_CHUNK);
  assert.equal(boats[0].fromY, 5 + LAND_EXPAND_CHUNK);
  assert.equal(city.mapVersion, initialVersion + 1);

  // Expand Leste (+8 width, no shift)
  const expE = expandCityLand(city, 'leste', cars, boats);
  assert.equal(expE.ok, true);
  assert.equal(city.gridWidth, GRID_SIZE + LAND_EXPAND_CHUNK);
  assert.equal(city.gridHeight, GRID_SIZE + LAND_EXPAND_CHUNK);
  assert.equal(cars[0].fromX, 18);

  // Expand Oeste (+8 width, shifts X by +8) & Sul (+8 height)
  assert.equal(expandCityLand(city, 'oeste', cars, boats).ok, true);
  assert.equal(cars[0].fromX, 18 + LAND_EXPAND_CHUNK);
  assert.equal(expandCityLand(city, 'sul', cars, boats).ok, true);
  assert.equal(city.gridWidth, GRID_SIZE + LAND_EXPAND_CHUNK * 2);
  assert.equal(city.gridHeight, GRID_SIZE + LAND_EXPAND_CHUNK * 2);
});

test('population-based Civic Milestones unlock Sports Center (2k), Airports (5k/15k/30k), Ports (1.2k/8k/18k), and Stadium + Toll Plaza (20k)', async () => {
  const { dismissMilestoneBanner, evaluateCivicMilestones, getCivicMilestoneStatuses } = await import('./cityEngine');
  const city = createNewCity(888111);

  // Below 1,200 pop, Port, Sports Center, Stadium, and Airport remain locked
  assert.ok(city.totalPopulation < 1200);
  assert.equal(city.stats.portCount, 0);
  assert.equal(city.stats.airportCount, 0);
  assert.equal(city.stats.stadiumCount, 0);
  const initialStatuses = getCivicMilestoneStatuses(city);
  assert.equal(initialStatuses.length, 18);
  assert.ok(initialStatuses.every((m) => !m.unlocked));

  // Helper to raise population cleanly to a target threshold and run milestone check
  const growToPop = (targetPop: number) => {
    const slots = city.tiles.filter((t) => t.type === 'grass' || t.type === 'forest');
    let idx = 0;
    while (city.totalPopulation < targetPop && idx < slots.length) {
      slots[idx].type = 'residential';
      slots[idx].level = 3;
      idx++;
      recomputeFieldsAndStats(city);
    }
    const unlocked = evaluateCivicMilestones(city);
    recomputeFieldsAndStats(city);
    return unlocked;
  };

  // 1,200 pop -> Milestone unlocks Port Nv. 1 in Obras + $1,500 reward + celebratory banner!
  const moneyBeforePort = city.money;
  const u1200 = growToPop(1200);
  assert.ok(u1200.includes('civic_port_lv1'), `Expected civic_port_lv1 at >=1,200 pop, got ${u1200.join(',')}`);
  assert.ok(city.money >= moneyBeforePort + 1500, 'Port milestone should award $1,500 cash grant');
  assert.equal(city.recentMilestoneBanner?.id, 'civic_port_lv1');
  city.money = 5_000_000;
  assert.equal(runEmergencyWorkToCompletion(city, 'port_evolution').ok, true, 'Port Nv. 1 should be buildable at 1,200 pop');
  assert.ok(city.stats.portCount >= 1);
  assert.ok(city.financials.revenue.tradeIncome > 0, 'Built Port should generate trade income');

  // Dismissing milestone banner clears it cleanly
  dismissMilestoneBanner(city);
  assert.equal(city.recentMilestoneBanner, null);

  // 2,000 pop -> Centro Esportivo Pequeno unlocks, while Stadium & Airport remain locked!
  const u2000 = growToPop(2000);
  assert.ok(u2000.includes('civic_sports_small'), 'Expected civic_sports_small at 2,000 pop');
  assert.equal(runEmergencyWorkToCompletion(city, 'sports_center_project').ok, true, 'Sports Center should unlock at 2,000 pop');
  assert.equal(executeEmergencyAction(city, 'airport_evolution').ok, false, 'Airport must NOT unlock before 5,000 pop');
  assert.equal(executeEmergencyAction(city, 'landmark_project').ok, false, 'Stadium must NOT unlock before 20,000 pop');

  // 5,000 pop -> Aeroporto Pequeno (Nv. 1) unlocks!
  const u5000 = growToPop(5000);
  assert.ok(u5000.includes('civic_airport_lv1'), 'Expected civic_airport_lv1 at 5,000 pop');
  city.money = 5_000_000;
  assert.equal(runEmergencyWorkToCompletion(city, 'airport_evolution').ok, true, 'Airport Nv. 1 should build at 5,000 pop');
  assert.ok(city.stats.airportCount >= 1);

  // 15,000 pop -> Port Nv. 2 (8k) & Airport Nv. 2 (15k) unlock!
  const u15000 = growToPop(15000);
  assert.ok(u15000.includes('civic_port_lv2'));
  assert.ok(u15000.includes('civic_airport_lv2'));
  city.money = 5_000_000;
  assert.equal(runEmergencyWorkToCompletion(city, 'port_evolution').ok, true);
  assert.equal(runEmergencyWorkToCompletion(city, 'airport_evolution').ok, true);
  assert.ok(
    city.tiles.filter((t) => t.type === 'port').every((t) => t.level >= 2),
    'Port should upgrade to Nv. 2 by 8,000 pop'
  );
  assert.ok(
    city.tiles.filter((t) => t.type === 'airport').every((t) => t.level >= 2),
    'Airport should upgrade to Nv. 2 at 15,000 pop'
  );

  // 20,000 pop -> Cruise Port Nv. 3 (18k) & separated Stadium + Toll Plaza milestones (20k)!
  const u20000 = growToPop(20000);
  assert.ok(u20000.includes('civic_port_lv3'));
  assert.ok(u20000.includes('civic_stadium_20k'), 'Expected civic_stadium_20k at 20,000 pop');
  assert.ok(u20000.includes('civic_toll_20k'), 'Expected civic_toll_20k at 20,000 pop');
  city.money = 5_000_000;
  assert.equal(runEmergencyWorkToCompletion(city, 'port_evolution').ok, true);
  assert.equal(runEmergencyWorkToCompletion(city, 'landmark_project').ok, true);
  assert.ok(city.stats.stadiumCount >= 1, 'Stadium should build at 20,000 pop');
  assert.ok(
    city.tiles.filter((t) => t.type === 'port').every((t) => t.level === 3),
    'Port should reach Cruise Port Nv. 3 at 18,000 pop'
  );

  // 30,000 pop -> Aeroporto Grande (Nv. 3)!
  const u30000 = growToPop(30000);
  assert.ok(u30000.includes('civic_airport_lv3'), 'Expected civic_airport_lv3 at 30,000 pop');
  city.money = 5_000_000;
  assert.equal(runEmergencyWorkToCompletion(city, 'airport_evolution').ok, true);
  assert.ok(
    city.tiles.filter((t) => t.type === 'airport').every((t) => t.level === 3),
    'Airport should reach Nv. 3 at 30,000 pop'
  );
  assert.ok(getCivicMilestoneStatuses(city).every((m) => m.unlocked));

  // Verify Ships & Airplanes spawn and animate once Port & Airport are built!
  const boats: BoatEntity[] = [];
  const planes: PlaneEntity[] = [];
  const particles = createParticlePool(64);
  const cursor = { idx: 0 };
  updateBoatsAndPlanes(city, boats, planes, particles, cursor, 0.1, 1);
  assert.ok(boats.length > 0, 'River ships should spawn once Port is built');
  assert.ok(planes.length > 0, 'Commercial planes should spawn once Airport is built');

  // Verify Obras Evolutivas still evolve cleanly (e.g. port_evolution Fase I -> Fase II upon completion)
  for (const area of BUDGET_AREA_ORDER) {
    setCityBudget(city, area, city.stats.coverage[area].needed);
  }
  city.activeEconomicEvent = null;
  city.activeUrbanIncident = null;
  recomputeFieldsAndStats(city);
  city.money = Math.max(5_000_000, city.financials.revenue.total * 10);
  const beforePort = getEmergencyOffers(city).find((o) => o.id === 'port_evolution')!;
  assert.ok(beforePort.tier >= 2, 'Port should have evolved to Phase II after Phase I completion');
});

test('Salto Evolutivo advances naturally at 100% investment, accelerates at 200%, and respects the 20k Stadium population gate', () => {
  const naturalCity = createNewCity(333999);
  const fastCity = createNewCity(333999);

  // Fund naturalCity at exactly 100% needed and fastCity at 200% needed for 3 ticks
  for (let i = 0; i < 3; i++) {
    setCityBudget(naturalCity, 'entertainment', naturalCity.stats.coverage.entertainment.needed);
    stepCityTick(naturalCity);

    setCityBudget(fastCity, 'entertainment', fastCity.stats.coverage.entertainment.needed * 2);
    stepCityTick(fastCity);
  }

  assert.ok(
    naturalCity.breakthroughCharge.entertainment > 0,
    `Expected natural Salto Evolutivo progression at 100% coverage, got ${naturalCity.breakthroughCharge.entertainment}`
  );
  assert.ok(
    fastCity.breakthroughCharge.entertainment > naturalCity.breakthroughCharge.entertainment * 2.5,
    `Expected 200% investment (${fastCity.breakthroughCharge.entertainment}) to accelerate breakthrough vs 100% (${naturalCity.breakthroughCharge.entertainment})`
  );

  // Run fastCity until breakthrough triggers (respects 20k Stadium gate -> builds Park/Sports Center below 20k!)
  for (let i = 0; i < 24; i++) {
    setCityBudget(fastCity, 'entertainment', fastCity.stats.coverage.entertainment.needed * 2);
    stepCityTick(fastCity);
    if (fastCity.breakthroughCount.entertainment > 0) break;
  }
  assert.ok(fastCity.breakthroughCount.entertainment >= 1);
  assert.equal(
    fastCity.stats.stadiumCount,
    0,
    'Entertainment breakthrough below 20,000 pop must NOT prematurely build a 20k Stadium'
  );
});

test('city save and load round-trips full expanded map, budgets, taxes, landmarks, pending works, and work tiers', async () => {
  const { serializeCitySave, deserializeCitySave } = await import('./cityEngine');
  const city = createNewCity(707070);
  city.money = 45000;
  for (const t of city.tiles) {
    if ((t.type === 'grass' || t.type === 'forest') && city.totalPopulation < 1500) {
      t.type = 'residential';
      t.level = 2;
      recomputeFieldsAndStats(city);
    }
  }
  expandCityLand(city, 'leste');
  executeEmergencyAction(city, 'port_evolution');
  setCityBudget(city, 'infrastructure', 999);
  setTaxRate(city, 'commercial', 14);

  // Mid-construction save/load preserves pendingWorks and tile construction sites
  const midJson = serializeCitySave(city);
  const midLoaded = deserializeCitySave(midJson);
  assert.ok(midLoaded, 'Expected valid deserialized city state mid-construction');
  assert.equal(midLoaded.seed, city.seed);
  assert.equal(midLoaded.gridWidth, city.gridWidth);
  assert.equal(midLoaded.gridHeight, city.gridHeight);
  assert.equal(midLoaded.money, city.money);
  assert.equal(midLoaded.budgets.infrastructure, 999);
  assert.equal(midLoaded.taxes.commercial, 14);
  assert.equal(midLoaded.pendingWorks.length, 1);
  assert.equal(midLoaded.workTiers.port_evolution, 1);
  assert.equal(midLoaded.tiles.length, city.tiles.length);

  // Advancing remaining months on the loaded city completes the work and advances workTier to 2
  while (midLoaded.pendingWorks.length > 0) {
    closeFinancialMonth(midLoaded);
  }
  assert.equal(midLoaded.workTiers.port_evolution, 2);
  const completedLoaded = deserializeCitySave(serializeCitySave(midLoaded));
  assert.ok(completedLoaded);
  assert.equal(completedLoaded.workTiers.port_evolution, 2);
});

test('tax tolerance scales with service coverage and abusive taxes cause happiness drop, exodus & city need alerts', () => {
  assert.ok(computeFairTaxRate(90) >= 10.5 && computeFairTaxRate(90) <= 11.5, '90% services should tolerate ~10.8% taxes');
  assert.ok(computeFairTaxRate(30) <= 8.5, '30% services should only tolerate <= 8.5% taxes');

  const city = createNewCity(314159);
  for (let i = 0; i < 36; i++) {
    for (const k of BUDGET_AREA_ORDER) {
      setCityBudget(city, k, city.stats.coverage[k].needed);
    }
    stepCityTick(city);
  }
  const happyBefore = city.globalHappiness;
  assert.ok(happyBefore >= 60, `Expected healthy funded city happiness >= 60, got ${happyBefore}`);

  setTaxRate(city, 'residential', 24);
  setCityBudget(city, 'security', 0);

  assert.ok(
    city.globalHappiness < happyBefore - 20,
    `Expected sharp happiness drop: ${happyBefore} -> ${city.globalHappiness}`
  );

  const needs = computeCityNeeds(city);
  assert.ok(
    needs.some((n) => n.id === 'tax_res_high' && n.severity === 'critical'),
    'Expected critical high residential tax alert in city needs'
  );

  closeFinancialMonth(city);
  const abandoned = city.tiles.filter((t) => t.type === 'abandoned').length;
  assert.ok(abandoned > 0, `Expected residents leaving / abandoned buildings, got ${abandoned}`);
});

test('setting 100% or 150% of necessity keeps segment percentage constant automatically as city grows', async () => {
  const { setCityBudgetTargetPct } = await import('./cityEngine');
  const city = createNewCity(246810);

  // Lock infrastructure at 100% of need and entertainment (Lazer) at 150% of need
  assert.equal(setCityBudgetTargetPct(city, 'infrastructure', 100), true);
  assert.equal(setCityBudgetTargetPct(city, 'entertainment', 150), true);

  const initialInfraNeed = city.stats.coverage.infrastructure.needed;
  const initialLazerNeed = city.stats.coverage.entertainment.needed;
  assert.equal(city.stats.coverage.infrastructure.coveragePct, 100);
  assert.equal(city.stats.coverage.entertainment.coveragePct, 150);

  // Grow the city across 35 ticks WITHOUT clicking 100% or 150% again
  for (let i = 0; i < 35; i++) {
    stepCityTick(city);
  }

  // Verify demand grew as new buildings and roads appeared
  assert.ok(
    city.stats.coverage.infrastructure.needed > initialInfraNeed,
    `Expected infrastructure need to increase with city growth (${initialInfraNeed} -> ${city.stats.coverage.infrastructure.needed})`
  );
  assert.ok(
    city.stats.coverage.entertainment.needed > initialLazerNeed,
    `Expected Lazer need to increase with city growth (${initialLazerNeed} -> ${city.stats.coverage.entertainment.needed})`
  );

  // And the percentages remained locked at 100% and 150% automatically!
  assert.equal(city.stats.coverage.infrastructure.coveragePct, 100);
  assert.equal(
    city.budgets.infrastructure,
    city.stats.coverage.infrastructure.needed
  );
  assert.ok(
    Math.abs(city.stats.coverage.entertainment.coveragePct - 150) <= 1,
    `Expected Lazer coverage to stay at ~150%, got ${city.stats.coverage.entertainment.coveragePct}%`
  );
});

test('river allows as many bridges as needed when well-spaced, bridges evolve Nv.1 -> Nv.2 -> Nv.3, and demolition clears houses/roads for reconstruction', async () => {
  const { countRiverBridges, demolishCityTile, upgradeAllBridges } = await import('./cityEngine');
  const { MIN_BRIDGE_SPACING_TILES } = await import('./simulationConfig');
  const city = createNewCity(404040);
  const initialPop = city.totalPopulation;
  const initialRoads = city.stats.roadCount;

  // Grow with default balanced (~72%) budgets for 65 ticks — city must keep growing & expanding!
  for (let i = 0; i < 65; i++) {
    stepCityTick(city);
  }
  assert.ok(
    city.totalPopulation > initialPop * 2,
    `Expected city to keep growing steadily (${initialPop} -> ${city.totalPopulation})`
  );
  assert.ok(
    city.stats.roadCount > initialRoads + 10,
    `Expected road network to keep expanding (${initialRoads} -> ${city.stats.roadCount})`
  );

  // Expand map along the river and grow roads so multiple well-spaced bridges can be built (>2 possible when needed)
  city.money = 250000;
  expandCityLand(city, 'norte');
  expandCityLand(city, 'sul');
  expandCityLand(city, 'leste');
  expandCityLand(city, 'oeste');
  for (let i = 0; i < 90; i++) {
    stepCityTick(city);
  }

  const spans = countRiverBridges(city);
  assert.equal(city.stats.bridgeSpanCount, spans);

  // Verify every pair of distinct bridge spans is well spaced (>= MIN_BRIDGE_SPACING_TILES)
  const visited = new Set<number>();
  const spanAnchors: Array<{ x: number; y: number }> = [];
  for (const t of city.tiles) {
    const idx = t.y * city.gridWidth + t.x;
    if (t.type !== 'bridge' || visited.has(idx)) continue;
    spanAnchors.push({ x: t.x, y: t.y });
    const stack = [t];
    visited.add(idx);
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const [dx, dy] of [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ]) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        if (nx < 0 || ny < 0 || nx >= city.gridWidth || ny >= city.gridHeight) continue;
        const nt = city.tiles[ny * city.gridWidth + nx];
        const nIdx = ny * city.gridWidth + nx;
        if (nt.type === 'bridge' && !visited.has(nIdx)) {
          visited.add(nIdx);
          stack.push(nt);
        }
      }
    }
  }
  for (let i = 0; i < spanAnchors.length; i++) {
    for (let j = i + 1; j < spanAnchors.length; j++) {
      const dist =
        Math.abs(spanAnchors[i].x - spanAnchors[j].x) +
        Math.abs(spanAnchors[i].y - spanAnchors[j].y);
      assert.ok(
        dist >= MIN_BRIDGE_SPACING_TILES - 3,
        `Expected distinct river bridges to be well-spaced, got Manhattan distance ${dist}`
      );
    }
  }

  // If bridges exist, verify uniform architectural evolution up to Nv. 3 (Ponte Estaiada)
  if (city.stats.bridgeCount > 0) {
    upgradeAllBridges(city, 3);
    recomputeFieldsAndStats(city);
    assert.equal(city.stats.bridgeLevel, 3);
    const bridgeTiles = city.tiles.filter((t) => t.type === 'bridge');
    assert.ok(bridgeTiles.every((t) => t.level === 3), 'All bridge tiles should evolve uniformly to Nv. 3');
  }

  // Verify demolishing a house/building compound and a road segment clears them back to grass for reconstruction
  const sampleBuilding = city.tiles.find(
    (t) => t.type === 'residential' || t.type === 'commercial'
  );
  assert.ok(sampleBuilding, 'Expected a building to test demolition');
  const bx = sampleBuilding.x;
  const by = sampleBuilding.y;
  const demBuild = demolishCityTile(city, bx, by);
  assert.equal(demBuild.ok, true, 'Demolishing a building should succeed');
  assert.ok(demBuild.tilesCleared >= 1);
  assert.equal(city.tiles[by * city.gridWidth + bx].type, 'grass');

  const sampleRoad = city.tiles.find((t) => t.type === 'road');
  assert.ok(sampleRoad, 'Expected a road tile to test demolition');
  const rx = sampleRoad.x;
  const ry = sampleRoad.y;
  const demRoad = demolishCityTile(city, rx, ry);
  assert.equal(demRoad.ok, true, 'Demolishing a road should succeed');
  assert.equal(city.tiles[ry * city.gridWidth + rx].type, 'grass');
});

test('planned urban road hierarchy creates organized Ruas, Avenidas, Estradas & Trevos with zero chaotic blobs', async () => {
  const { classifyPlannedRoadCell, serializeCitySave, deserializeCitySave } = await import('./cityEngine');
  const city = createNewCity(777888);

  // Starter city immediately features all 4 planned road tiers
  assert.ok(city.stats.streetCount >= 4, `Expected starter Ruas Locais, got ${city.stats.streetCount}`);
  assert.ok(city.stats.avenueCount >= 6, `Expected starter Avenidas, got ${city.stats.avenueCount}`);
  assert.ok(city.stats.highwayCount >= 4, `Expected starter Estradas Expressas, got ${city.stats.highwayCount}`);
  assert.ok(city.stats.interchangeCount >= 2, `Expected starter Trevos (Rotatória + Trevo Rodoviário), got ${city.stats.interchangeCount}`);

  // Verify both variants of Trevo exist at start: Rotatória (variant 0) & Trevo Rodoviário (variant 1)
  const trevos = city.tiles.filter((t) => t.type === 'road' && t.level === 4);
  assert.ok(trevos.some((t) => t.variant === 0), 'Expected central Rotatória de Avenida (variant 0)');
  assert.ok(trevos.some((t) => t.variant === 1), 'Expected Trevo Rodoviário (variant 1)');

  // Grow city for 100 ticks + expand land Norte & Oeste to verify master grid alignment stays exact!
  city.money = 250000;
  for (let i = 0; i < 60; i++) {
    stepCityTick(city);
  }
  const prevOriginX = city.roadOriginX;
  const prevOriginY = city.roadOriginY;
  const expN = expandCityLand(city, 'norte');
  assert.equal(expN.ok, true, `Norte expansion failed: ${expN.reason}`);
  const expW = expandCityLand(city, 'oeste');
  assert.equal(expW.ok, true, `Oeste expansion failed: ${expW.reason}`);
  assert.equal(city.roadOriginX, prevOriginX + 8, 'West expansion should shift roadOriginX by +8');
  assert.equal(city.roadOriginY, prevOriginY + 8, 'North expansion should shift roadOriginY by +8');

  for (let i = 0; i < 40; i++) {
    stepCityTick(city);
  }

  // Every road tile on the map must sit cleanly on the planned master grid & never form a 2x2 asphalt blob
  const roadTiles = city.tiles.filter((t) => t.type === 'road');
  assert.ok(roadTiles.length > 40, `Expected substantial planned road expansion, got ${roadTiles.length}`);
  const onPlanCount = roadTiles.filter((t) => classifyPlannedRoadCell(city, t.x, t.y).isPlanned).length;
  assert.equal(
    onPlanCount,
    roadTiles.length,
    `Expected 100% of planned road tiles to follow master plan grid (${onPlanCount}/${roadTiles.length})`
  );

  // Check zero 2x2 solid asphalt blobs
  for (let y = 0; y < city.gridHeight - 1; y++) {
    for (let x = 0; x < city.gridWidth - 1; x++) {
      const a = city.tiles[y * city.gridWidth + x];
      const b = city.tiles[y * city.gridWidth + (x + 1)];
      const c = city.tiles[(y + 1) * city.gridWidth + x];
      const d = city.tiles[(y + 1) * city.gridWidth + (x + 1)];
      const allRoad =
        a.type === 'road' && b.type === 'road' && c.type === 'road' && d.type === 'road';
      assert.equal(allRoad, false, `Found chaotic 2x2 asphalt blob at (${x},${y})`);
    }
  }

  // Save/load preserves roadOriginX/Y and full road hierarchy
  const reloaded = deserializeCitySave(serializeCitySave(city));
  assert.ok(reloaded, 'Reloaded city should succeed');
  assert.equal(reloaded.roadOriginX, city.roadOriginX);
  assert.equal(reloaded.roadOriginY, city.roadOriginY);
  assert.equal(reloaded.stats.interchangeCount, city.stats.interchangeCount);
  assert.equal(reloaded.stats.highwayCount, city.stats.highwayCount);
  assert.equal(reloaded.stats.avenueCount, city.stats.avenueCount);
});

test('intelligent zoning creates Rural, Commercial, Industrial & Baixo/Médio/Alto Residential zones, multi-tile compounds, private 2x2 Airport, and large bridge spacing', async () => {
  const { placeLandmarkOnBestSlot, getZoneDisplayLabel } = await import('./cityEngine');
  const { MIN_BRIDGE_SPACING_TILES } = await import('./simulationConfig');

  assert.ok(MIN_BRIDGE_SPACING_TILES >= 10, `Expected large minimum bridge spacing >= 10, got ${MIN_BRIDGE_SPACING_TILES}`);

  const city = createNewCity(909192);
  // Starter city already seeds peripheral rural lots alongside residential, commercial, and industrial zones
  assert.ok(city.stats.ruralCount >= 1, `Expected starter rural farms in periphery, got ${city.stats.ruralCount}`);
  assert.equal(
    city.stats.resLowValueCount + city.stats.resMedValueCount + city.stats.resHighValueCount,
    city.stats.residentialCount,
    'Residential wealth tiers (Baixo + Médio + Alto) must sum to total residentialCount'
  );

  // Grow city gradually for 220 ticks (~18 game months) so slower intelligent zoning develops all zones and multi-tile compounds
  for (let i = 0; i < 220; i++) {
    stepCityTick(city);
  }

  assert.ok(city.stats.ruralCount >= 1, 'Expected active Rural zones in outer greenbelt');
  assert.ok(city.stats.commercialCount >= 4, 'Expected Commercial zones along avenues');
  assert.ok(city.stats.industrialCount >= 1, 'Expected Industrial zones along expressways');
  assert.equal(
    city.stats.resLowValueCount + city.stats.resMedValueCount + city.stats.resHighValueCount,
    city.stats.residentialCount
  );
  assert.ok(
    city.stats.multiTileBuildingCount >= 1,
    `Expected multi-tile building compounds (2x1, 1x2, or 2x2), got ${city.stats.multiTileBuildingCount}`
  );

  // Verify architectural variety across neighbors (variants 0..7 used)
  const usedVariants = new Set(
    city.tiles
      .filter(
        (t) =>
          t.type === 'rural' ||
          t.type === 'residential' ||
          t.type === 'commercial' ||
          t.type === 'industrial'
      )
      .map((t) => t.variant)
  );
  assert.ok(usedVariants.size >= 5, `Expected diverse building variants across city, got ${usedVariants.size}`);

  // Ensure Airport is placed and verify it occupies a 4×10 (40-tile) block at Level 1 and expands to 8×16 (128-tile) when evolved, automatically demolishing obstructing structures
  if (city.stats.airportCount === 0) {
    const placedAirport = placeLandmarkOnBestSlot(city, 'airport', true, 1);
    assert.ok(placedAirport, 'Expected 4x10 airport placement with automatic demolition to succeed');
    recomputeFieldsAndStats(city);
  }

  let airportTiles = city.tiles.filter((t) => t.type === 'airport');
  const anchor = airportTiles.find((t) => t.lotRole === 'anchor');
  assert.ok(anchor, 'Expected Airport to have an anchor tile');
  if (anchor.level === 1) {
    assert.equal(
      airportTiles.length,
      4 * 10,
      `Expected Level 1 Airport to occupy a 4x10 (40-tile) block, got ${airportTiles.length}`
    );
    assert.equal(anchor.lotWidth, 4);
    assert.equal(anchor.lotHeight, 10);
    assert.ok(
      getZoneDisplayLabel(anchor).includes('4×10'),
      `Expected Level 1 airport label to indicate 4×10 footprint, got ${getZoneDisplayLabel(anchor)}`
    );
  }

  // Verify live airplanes spawn across landing, takeoff/parked, and sky cruise phases
  const testBoats: BoatEntity[] = [];
  const testPlanes: PlaneEntity[] = [];
  const testParticles = createParticlePool();
  const testCursor = { idx: 0 };
  const seenPhases = new Set<string>();
  for (let s = 0; s < 140; s++) {
    updateBoatsAndPlanes(city, testBoats, testPlanes, testParticles, testCursor, 0.2, 1);
    for (const p of testPlanes) {
      seenPhases.add(p.phase);
    }
  }
  assert.ok(
    seenPhases.has('approach') || seenPhases.has('landing_roll'),
    `Expected planes to perform landing approaches/rollouts at the airport, saw: ${[...seenPhases].join(', ')}`
  );
  assert.ok(
    seenPhases.has('takeoff_roll') && seenPhases.has('climb'),
    `Expected planes to perform takeoff rolls and climbouts from the airport, saw: ${[...seenPhases].join(', ')}`
  );

  // Evolve Airport to Level 2 and verify automatic expansion to 8×16 (128 tiles) with automatic demolition
  const evolvedAirport = placeLandmarkOnBestSlot(city, 'airport', true, 2);
  assert.ok(evolvedAirport, 'Expected Airport evolution to Level 2 (8x16) to succeed');
  recomputeFieldsAndStats(city);

  airportTiles = city.tiles.filter((t) => t.type === 'airport');
  assert.equal(
    airportTiles.length,
    8 * 16,
    `Expected evolved Level 2 Airport to expand to 8x16 (128 tiles), got ${airportTiles.length}`
  );
  assert.equal(city.stats.airportCount, 1, '8x16 Airport complex should count as 1 airport in stats');
  const evolvedAnchor = airportTiles.find((t) => t.lotRole === 'anchor');
  assert.ok(evolvedAnchor, 'Expected 8x16 Airport to have an anchor tile');
  assert.equal(evolvedAnchor.lotWidth, 8);
  assert.equal(evolvedAnchor.lotHeight, 16);
  assert.ok(
    getZoneDisplayLabel(evolvedAnchor).includes('8×16'),
    'Expected evolved airport label to indicate 8×16 footprint'
  );
});

test('20 establishments catalog enforces varied footprints (1x1 up to 4x3), automatic demolition, minDistanceRadius, mandatory water adjacency for Marina, and 3 variations', async () => {
  const { canPlaceEstablishmentAt, getZoneDisplayLabel, placeEstablishmentOnMap } = await import(
    './cityEngine'
  );
  const { ESTABLISHMENT_CATALOG, ESTABLISHMENT_MAP } = await import('./simulationConfig');

  assert.equal(ESTABLISHMENT_CATALOG.length, 20, 'Catalog must contain all 20 requested establishments');
  for (const spec of ESTABLISHMENT_CATALOG) {
    assert.equal(spec.variationCount, 3, `${spec.id} must have 3 variations`);
    assert.ok(spec.minDistanceRadius >= 8, `${spec.id} must define a valid minDistanceRadius`);
    assert.ok(spec.footprintW >= 1 && spec.footprintH >= 1, `${spec.id} must define footprintW and footprintH`);
  }

  const city = createNewCity(314159);
  // Starter city seeds 3 starter establishments (Praça com Chafariz 1x1, Posto de Saúde 1x1, Escola Municipal 2x1)
  assert.ok(
    city.stats.establishmentCount >= 3,
    `Expected at least 3 starter establishments, got ${city.stats.establishmentCount}`
  );

  const starterSchoolTiles = city.tiles.filter((t) => t.establishmentId === 'municipal_school');
  assert.equal(
    starterSchoolTiles.length,
    2,
    `Expected starter Escola Municipal to occupy a 2x1 (2-tile) footprint, got ${starterSchoolTiles.length}`
  );

  // Place a 3x2 Hospital Geral and 1x2 Hotel, verifying varied footprints & automatic demolition
  const placedHospital = placeEstablishmentOnMap(city, 'general_hospital', true);
  assert.ok(placedHospital, 'Expected 3x2 Hospital Geral placement to succeed');
  const hospitalTiles = city.tiles.filter((t) => t.establishmentId === 'general_hospital');
  assert.equal(hospitalTiles.length, 6, 'Expected Hospital Geral to occupy 3x2 (6 tiles)');

  const placedHotel = placeEstablishmentOnMap(city, 'rooftop_hotel', true);
  assert.ok(placedHotel, 'Expected 1x2 Hotel placement to succeed');
  const hotelTiles = city.tiles.filter((t) => t.establishmentId === 'rooftop_hotel');
  assert.equal(hotelTiles.length, 2, 'Expected Hotel com Piscina no Terraço to occupy 1x2 (2 tiles)');

  const starterFountain = city.tiles.find((t) => t.establishmentId === 'fountain_plaza');
  assert.ok(starterFountain, 'Expected starter Praça com Chafariz');
  assert.ok(
    getZoneDisplayLabel(starterFountain).includes('Praça com Chafariz'),
    'Zone display label should show Praça com Chafariz'
  );

  // Verify minDistanceRadius rule blocks placing another Praça com Chafariz within 9 tiles,
  // but allows placing it at distance >= 9 tiles
  const blockedNear = canPlaceEstablishmentAt(
    city,
    'fountain_plaza',
    starterFountain.x + 3,
    starterFountain.y + 2
  );
  assert.equal(blockedNear, false, 'Should block placing another Praça com Chafariz inside minDistanceRadius (9 tiles)');

  const allowedFar = canPlaceEstablishmentAt(
    city,
    'fountain_plaza',
    Math.min(city.gridWidth - 2, starterFountain.x + 11),
    starterFountain.y
  );
  assert.equal(allowedFar, true, 'Should allow placing Praça com Chafariz outside minDistanceRadius (>= 9 tiles)');

  // Verify mandatory water-adjacency rule for Marina na Beira do Rio (river_marina)
  const dryTile = city.tiles.find((t) => {
    if (t.type === 'water') return false;
    const touchesWater = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ].some(([dx, dy]) => {
      const nt = city.tiles[(t.y + dy) * city.gridWidth + (t.x + dx)];
      return nt && nt.type === 'water';
    });
    return !touchesWater;
  });
  assert.ok(dryTile, 'Expected a dry tile away from river');
  assert.equal(
    canPlaceEstablishmentAt(city, 'river_marina', dryTile.x, dryTile.y),
    false,
    'Marina na Beira do Rio must be rejected on tiles not adjacent to water'
  );

  const shoreTile = city.tiles.find((t) => {
    if (t.type === 'water') return false;
    return [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ].some(([dx, dy]) => {
      const nt = city.tiles[(t.y + dy) * city.gridWidth + (t.x + dx)];
      return nt && nt.type === 'water';
    });
  });
  assert.ok(shoreTile, 'Expected a shoreline tile adjacent to water');
  assert.equal(
    canPlaceEstablishmentAt(city, 'river_marina', shoreTile.x, shoreTile.y),
    true,
    'Marina na Beira do Rio must be allowed on tiles adjacent to water'
  );

  // Grow city for 85 ticks and verify additional establishments spawn organically while respecting minDistanceRadius
  city.money = 180000;
  for (let i = 0; i < 85; i++) {
    stepCityTick(city);
  }
  assert.ok(
    city.stats.establishmentCount >= 5,
    `Expected organic growth to spawn multiple establishments, got ${city.stats.establishmentCount}`
  );

  // Verify no two instances of the same establishment on the map violate their minDistanceRadius
  const estTiles = city.tiles.filter((t) => Boolean(t.establishmentId) && t.lotRole !== 'part');
  for (let i = 0; i < estTiles.length; i++) {
    for (let j = i + 1; j < estTiles.length; j++) {
      if (estTiles[i].establishmentId !== estTiles[j].establishmentId) continue;
      const spec = ESTABLISHMENT_MAP[estTiles[i].establishmentId!];
      const d = Math.hypot(estTiles[i].x - estTiles[j].x, estTiles[i].y - estTiles[j].y);
      assert.ok(
        d >= spec.minDistanceRadius,
        `Two ${spec.id} establishments spawned too close (${d.toFixed(1)} < ${spec.minDistanceRadius})`
      );
    }
  }
});

test('3 difficulty modes (Fácil, Médio, Difícil) balance treasury, per-area costs, 100% slider sustainability, strategic trade-offs, and save compatibility', async () => {
  const {
    createHudSnapshot,
    deserializeCitySave,
    getLandExpansions,
    serializeCitySave,
    setCityBudgetTargetPct,
    setCityDifficulty,
  } = await import('./cityEngine');

  const seed = 555001;
  const easy = createNewCity(seed, 'easy');
  const medium = createNewCity(seed, 'medium');
  const hard = createNewCity(seed, 'hard');

  assert.equal(easy.difficulty, 'easy');
  assert.equal(medium.difficulty, 'medium');
  assert.equal(hard.difficulty, 'hard');

  // 1. Starting treasury & construction/expansion costs scale cleanly by difficulty
  assert.ok(
    easy.money > medium.money && medium.money > hard.money,
    `Expected starting money easy (${easy.money}) > medium (${medium.money}) > hard (${hard.money})`
  );

  const easyOfferCost = getEmergencyOffers(easy)[0].cost;
  const medOfferCost = getEmergencyOffers(medium)[0].cost;
  const hardOfferCost = getEmergencyOffers(hard)[0].cost;
  assert.ok(
    easyOfferCost < medOfferCost && medOfferCost < hardOfferCost,
    `Expected emergency offer cost easy (${easyOfferCost}) < medium (${medOfferCost}) < hard (${hardOfferCost})`
  );

  const easyExpCost = getLandExpansions(easy)[0].cost;
  const medExpCost = getLandExpansions(medium)[0].cost;
  const hardExpCost = getLandExpansions(hard)[0].cost;
  assert.ok(
    easyExpCost < medExpCost && medExpCost < hardExpCost,
    `Expected land expansion cost easy (${easyExpCost}) < medium (${medExpCost}) < hard (${hardExpCost})`
  );

  // 2. Every single BudgetAreaKey has strictly ordered maintenance need (easy < medium < hard)
  for (const key of BUDGET_AREA_ORDER) {
    assert.ok(
      easy.stats.coverage[key].needed < medium.stats.coverage[key].needed &&
        medium.stats.coverage[key].needed < hard.stats.coverage[key].needed,
      `Expected needed cost for ${key}: easy (${easy.stats.coverage[key].needed}) < medium (${medium.stats.coverage[key].needed}) < hard (${hard.stats.coverage[key].needed})`
    );
  }

  // 3. Fair tax tolerance scales cleanly with difficulty
  assert.ok(computeFairTaxRate(80, 'easy') > computeFairTaxRate(80, 'medium'));
  assert.ok(computeFairTaxRate(80, 'medium') > computeFairTaxRate(80, 'hard'));

  // 4. With ALL 6 sliders at 100% (default 9% taxes):
  //    - Fácil MUST run a comfortable monthly surplus (both at start AND after growth!)
  //    - Difícil MUST run a steep monthly deficit (both at start AND after growth!)
  //    - Net balance order: easy > medium > hard
  for (const key of BUDGET_AREA_ORDER) {
    setCityBudgetTargetPct(easy, key, 100);
    setCityBudgetTargetPct(medium, key, 100);
    setCityBudgetTargetPct(hard, key, 100);
  }

  assert.ok(
    easy.financials.netBalance > 300,
    `Expected Fácil at 100% across all sliders to have comfortable surplus, got ${easy.financials.netBalance}`
  );
  assert.ok(
    hard.financials.netBalance < -1000,
    `Expected Difícil at 100% across all sliders to produce a real deficit, got ${hard.financials.netBalance}`
  );
  assert.ok(
    easy.financials.netBalance > medium.financials.netBalance &&
      medium.financials.netBalance > hard.financials.netBalance,
    `Expected netBalance order easy (${easy.financials.netBalance}) > medium (${medium.financials.netBalance}) > hard (${hard.financials.netBalance})`
  );

  // Simulate growth across 30 ticks with 100% sliders: Easy stays profitable, Hard stays in deficit at 100%
  for (let i = 0; i < 30; i++) {
    stepCityTick(easy);
    stepCityTick(hard);
  }
  assert.ok(
    easy.financials.netBalance > 0,
    `Expected grown Fácil city with 100% sliders to remain profitable, got ${easy.financials.netBalance}`
  );
  assert.ok(
    hard.financials.netBalance < 0,
    `Expected grown Difícil city with 100% sliders to still run a deficit, got ${hard.financials.netBalance}`
  );

  // 5. Strategic trade-off on Difícil: lowering less-critical sliders below 100% restores positive monthly balance!
  const deficitAt100 = hard.financials.netBalance;
  setCityBudgetTargetPct(hard, 'tourism', 25);
  setCityBudgetTargetPct(hard, 'entertainment', 40);
  setCityBudgetTargetPct(hard, 'education', 50);
  setCityBudgetTargetPct(hard, 'infrastructure', 60);
  setCityBudgetTargetPct(hard, 'security', 65);
  setCityBudgetTargetPct(hard, 'wellbeing', 65);
  assert.ok(
    hard.financials.netBalance > deficitAt100 + 1000,
    `Expected strategic slider cuts to sharply improve Difícil balance (${deficitAt100} -> ${hard.financials.netBalance})`
  );
  assert.ok(
    hard.financials.netBalance > 0,
    `Expected strategic management below 100% on Difícil to achieve surplus, got ${hard.financials.netBalance}`
  );

  // 6. Live difficulty switching via setCityDifficulty updates financials and HUD snapshot immediately
  const beforeSwitchNet = hard.financials.netBalance;
  assert.equal(setCityDifficulty(hard, 'easy'), true);
  assert.equal(hard.difficulty, 'easy');
  assert.ok(
    hard.financials.netBalance > beforeSwitchNet,
    `Expected switching Difícil -> Fácil to immediately improve net balance (${beforeSwitchNet} -> ${hard.financials.netBalance})`
  );
  assert.equal(createHudSnapshot(hard).difficulty, 'easy');

  // 7. Save/load round-trips difficulty AND legacy saves missing `difficulty` safely default to 'medium'
  const hardSave = createNewCity(818181, 'hard');
  const reloadedHard = deserializeCitySave(serializeCitySave(hardSave));
  assert.ok(reloadedHard, 'Expected hard city save to deserialize');
  assert.equal(reloadedHard.difficulty, 'hard');

  const legacyObj = JSON.parse(serializeCitySave(hardSave));
  delete legacyObj.difficulty;
  const reloadedLegacy = deserializeCitySave(JSON.stringify(legacyObj));
  assert.ok(reloadedLegacy, 'Expected legacy save without difficulty to deserialize');
  assert.equal(reloadedLegacy.difficulty, 'medium', 'Legacy saves must default to medium difficulty');
});

test('gradual city progression and sustained-conditions individual evolution with cooldowns & thresholds', async () => {
  const { deserializeCitySave, serializeCitySave, setCityBudgetTargetPct } = await import(
    './cityEngine'
  );
  const { GROWTH_CONFIG } = await import('./simulationConfig');

  const city = createNewCity(123456, 'easy');
  const startPop = city.totalPopulation;
  const startResTiles = city.tiles.filter((t) => t.type === 'residential');
  assert.ok(startResTiles.length >= 2, 'Expected starter residential lots');

  // Ensure all services are funded at 100% and taxes are favorable
  for (const k of BUDGET_AREA_ORDER) {
    setCityBudgetTargetPct(city, k, 100);
  }
  setTaxRate(city, 'residential', 8);
  setTaxRate(city, 'commercial', 8);

  // 1. After 1 full game month (12 ticks): city grows gradually (not exploding) AND no Lv1 starter lot upgrades prematurely
  for (let i = 0; i < 12; i++) {
    stepCityTick(city);
  }
  const popAfterMonth1 = city.totalPopulation;
  assert.ok(
    popAfterMonth1 > startPop && popAfterMonth1 < startPop * 2.5,
    `Expected gradual 1-month population growth (${startPop} -> ${popAfterMonth1})`
  );
  const anyPrematureLv2 = city.tiles.some(
    (t) =>
      (t.type === 'residential' || t.type === 'commercial') && t.level >= 2
  );
  assert.equal(
    anyPrematureLv2,
    false,
    'No residential/commercial building should upgrade before meeting sustained age + cooldown + progress thresholds'
  );

  // 2.5 Fill the 12×12 region around `tracked` with Level 1 houses (required before Lv.1 -> Lv.2 evolution begins!)
  const tracked = startResTiles[0];
  for (let dy = -6; dy <= 5; dy++) {
    for (let dx = -6; dx <= 5; dx++) {
      const nt = getTile(city, tracked.x + dx, tracked.y + dy);
      if (nt && (nt.type === 'grass' || nt.type === 'forest' || nt.type === 'abandoned')) {
        nt.type = 'residential';
        nt.level = 1;
        nt.age = 10;
      }
    }
  }
  recomputeFieldsAndStats(city);

  // 2. Unfavorable conditions (negative treasury or high local pollution) erode/block evolutionProgress
  tracked.age = GROWTH_CONFIG.minAgeForUpgrade + 10;
  tracked.upgradeCooldown = 0;
  tracked.evolutionProgress = 45;
  const savedMoney = city.money;
  city.money = -500; // Negative treasury breaks sustained favorable conditions
  stepCityTick(city);
  assert.ok(
    (tracked.evolutionProgress ?? 0) < 45,
    `Expected unfavorable treasury deficit to erode evolutionProgress (45 -> ${tracked.evolutionProgress})`
  );
  city.money = Math.max(50000, savedMoney);

  // 3. Sustained favorable conditions accumulate evolutionProgress smoothly and graduate to Lv2 -> then enforce Lv2->Lv3 cooldown & age!
  let sawLv2 = false;
  let lv2CooldownAtUpgrade = 0;
  for (let i = 0; i < 75; i++) {
    stepCityTick(city);
    if (!sawLv2 && tracked.level === 2) {
      sawLv2 = true;
      lv2CooldownAtUpgrade = tracked.upgradeCooldown ?? 0;
      break;
    }
  }
  assert.ok(sawLv2, 'Expected tracked residential lot to reach Level 2 after 12×12 neighborhood fill + sustained favorable conditions');
  assert.ok(
    lv2CooldownAtUpgrade >= GROWTH_CONFIG.upgradeCooldownLv2To3 - 1,
    `Expected Lv2->Lv3 cooldown >= ${GROWTH_CONFIG.upgradeCooldownLv2To3 - 1}, got ${lv2CooldownAtUpgrade}`
  );
  assert.equal(tracked.evolutionProgress ?? 0, 0, 'evolutionProgress should reset to 0 after upgrading');

  // Verify Lv2 cannot immediately accumulate progress during cooldown
  for (let i = 0; i < 10; i++) {
    stepCityTick(city);
  }
  assert.equal(
    tracked.level,
    2,
    'Building should remain Level 2 during cooldown before Lv3 evolution begins'
  );
  assert.equal(
    tracked.evolutionProgress ?? 0,
    0,
    'evolutionProgress should remain 0 while upgradeCooldown is active'
  );

  // Save/load preserves evolutionProgress & upgradeCooldown cleanly
  tracked.evolutionProgress = 72;
  const reloaded = deserializeCitySave(serializeCitySave(city));
  assert.ok(reloaded);
  const reloadedTracked = reloaded.tiles[tracked.y * reloaded.gridWidth + tracked.x];
  assert.equal(reloadedTracked.evolutionProgress, 72);
  assert.equal(reloadedTracked.upgradeCooldown, tracked.upgradeCooldown);

  // In default 'manual' condoPolicy, residential buildings pause at Prédio Médio (Lv. 2);
  // switching to 'auto' + reaching the 10k Verticalização milestone allows sustained Lv. 3 evolution!
  const { setCondoPolicy } = await import('./cityEngine');
  setCondoPolicy(city, 'auto');
  for (const t of city.tiles) {
    if (city.totalPopulation >= 10_500) break;
    if (t.type === 'grass' || t.type === 'forest') {
      t.type = 'residential';
      t.level = 2;
      recomputeFieldsAndStats(city);
    }
  }
  for (let i = 0; i < 130; i++) {
    stepCityTick(city);
  }
  const lv3Exists = city.tiles.some(
    (t) =>
      (t.type === 'residential' || t.type === 'commercial' || t.type === 'rural' || t.type === 'industrial') &&
      t.level === 3
  );
  assert.ok(
    lv3Exists,
    'Expected sustained healthy conditions over extended timeline (with auto condo policy & 10k pop) to eventually produce Level 3 evolutions'
  );
});

test('river width varies organically across stretches and strictly never exceeds 8 squares', () => {
  for (const seed of [101, 202, 303, 404, 505, 606]) {
    const city = createNewCity(seed);
    const w = city.gridWidth;
    const h = city.gridHeight;

    // Measure water tile count per row and per column; whichever axis the river crosses has contiguous slices
    const rowCounts: number[] = [];
    const colCounts: number[] = [];
    for (let y = 0; y < h; y++) {
      let c = 0;
      for (let x = 0; x < w; x++) {
        if (city.tiles[y * w + x].type === 'water') c++;
      }
      if (c > 0) rowCounts.push(c);
    }
    for (let x = 0; x < w; x++) {
      let c = 0;
      for (let y = 0; y < h; y++) {
        if (city.tiles[y * w + x].type === 'water') c++;
      }
      if (c > 0) colCounts.push(c);
    }

    // The cross-section axis is the one with counts across all 36 slices
    const slices = rowCounts.length === h ? rowCounts : colCounts;
    const minW = Math.min(...slices);
    const maxW = Math.max(...slices);
    assert.ok(minW >= 2, `Seed ${seed}: expected minimum river width >= 2, got ${minW}`);
    assert.ok(maxW <= 8, `Seed ${seed}: expected river width <= 8 tiles, got ${maxW}`);
    assert.ok(
      maxW - minW >= 2,
      `Seed ${seed}: expected organic river width variation across stretches (min=${minW}, max=${maxW})`
    );
  }
});

test('highways support 2-lane and 4-lane (2 outbound + 2 inbound) classes, wide bridges span up to 8 tiles, and small/medium/yacht boats pass under bridges', async () => {
  const { getRoadClassLabel, isNavigableWater, reconcileRoadHierarchy } = await import('./cityEngine');
  const city = createNewCity(889900);

  // 1. Verify 2-lane and 4-lane highway labels
  assert.ok(
    getRoadClassLabel(3, 0).includes('2 Faixas'),
    `Expected 2-lane highway label, got ${getRoadClassLabel(3, 0)}`
  );
  assert.ok(
    getRoadClassLabel(3, 1).includes('4 Faixas'),
    `Expected 4-lane highway label, got ${getRoadClassLabel(3, 1)}`
  );

  // 2. Verify highways upgrade to 4-lane (variant 1) near Trevo / dense areas while outer low-density stretches stay 2-lane (variant 0)
  reconcileRoadHierarchy(city);
  const fourLaneNearCore = city.tiles.filter((t) => t.type === 'road' && t.level === 3 && t.variant === 1);
  assert.ok(
    fourLaneNearCore.length > 0,
    'Expected busy/interchange highway tiles to upgrade to 4-lane divided highways (variant 1)'
  );

  // Lay an isolated outer highway segment far from population/interchanges -> should stay 2-lane (variant 0)
  const ox = city.roadOriginX;
  const oy = city.roadOriginY;
  const outerHwyX = ox + 6;
  const outerHwyY = oy + 11;
  if (outerHwyX < city.gridWidth - 1 && outerHwyY < city.gridHeight - 1) {
    const ot = city.tiles[outerHwyY * city.gridWidth + outerHwyX];
    ot.type = 'road';
    ot.level = 3;
    reconcileRoadHierarchy(city);
    assert.equal(
      ot.variant,
      0,
      'Expected low-density outer highway segment to operate as a 2-lane highway (variant 0)'
    );
  }

  // 3. Verify wide developed bridges can be built across wider river reaches (up to 8 tiles) and are navigable by boats underneath
  // Place an arterial road tile right at a river shoreline that has dry land on the opposite bank
  let shorePlaced = false;
  for (let y = 2; y < city.gridHeight - 2 && !shorePlaced; y++) {
    for (let x = 2; x < city.gridWidth - 2 && !shorePlaced; x++) {
      const t = city.tiles[y * city.gridWidth + x];
      if (t.type !== 'grass' && t.type !== 'forest') continue;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const adj = city.tiles[(y + dy) * city.gridWidth + (x + dx)];
        if (!adj || adj.type !== 'water') continue;
        let cx = x + dx;
        let cy = y + dy;
        let spanLen = 0;
        while (cx > 0 && cy > 0 && cx < city.gridWidth - 1 && cy < city.gridHeight - 1) {
          const cur = city.tiles[cy * city.gridWidth + cx];
          if (cur.type === 'water') {
            spanLen++;
            cx += dx;
            cy += dy;
          } else if (cur.type === 'grass' || cur.type === 'forest') {
            if (spanLen >= 4 && spanLen <= 8) {
              t.type = 'road';
              t.level = 2;
              shorePlaced = true;
            }
            break;
          } else {
            break;
          }
        }
        if (shorePlaced) break;
      }
    }
  }
  assert.ok(shorePlaced, 'Expected to find a wide (4-8 tile) river crossing for bridge verification');

  city.money = 250000;
  city.breakthroughCharge.infrastructure = 99;
  setCityBudget(city, 'infrastructure', city.stats.coverage.infrastructure.needed * 2);
  stepCityTick(city);
  const bridgeTiles = city.tiles.filter((t) => t.type === 'bridge');
  assert.ok(bridgeTiles.length >= 4, `Expected wide bridge (>=4 tiles) to span across the varied-width river, got ${bridgeTiles.length}`);
  assert.equal(isNavigableWater('bridge'), true, 'Bridge tiles must allow boats to pass underneath');
  assert.ok(
    bridgeTiles.some((t) => t.variant === 1 || t.level >= 2),
    'Expected developed dual-lane bridges (variant 1 or level >= 2) to appear when needed'
  );

  // 4. Verify river spawns small boats, medium boats, and luxury yachts
  const boats: BoatEntity[] = [];
  const planes: PlaneEntity[] = [];
  const particles = createParticlePool(24);
  const cursor = { idx: 0 };
  updateBoatsAndPlanes(city, boats, planes, particles, cursor, 0.1, 1);

  assert.ok(boats.some((b) => b.kind === 'small'), 'Expected small boats on the river');
  assert.ok(boats.some((b) => b.kind === 'medium'), 'Expected medium boats on the river');
  assert.ok(boats.some((b) => b.kind === 'yacht'), 'Expected luxury yachts on the river');
});

test('airplanes enter and emerge from airport hangars, helicopters land/take off on 2x2 Lv4 skyscraper helipads, and large cruise ports spawn cruise liners', async () => {
  const {
    getZoneDisplayLabel,
    hasSkyscraperHelipad,
    placeLandmarkOnBestSlot,
    placePortOnRiverfront,
  } = await import('./cityEngine');

  const city = createNewCity(424242, 'easy');
  city.money = 500000;

  // 1. Place Lv.2 Cargo Port first (should display Cargas and NOT spawn cruise liners)
  const lv2PortPlaced = placePortOnRiverfront(city, true, 2);
  assert.ok(lv2PortPlaced, 'Expected Lv.2 Cargo Port placement to succeed');
  recomputeFieldsAndStats(city);
  const lv2PortAnchor = city.tiles.find((t) => t.type === 'port' && t.lotRole !== 'part')!;
  assert.ok(
    getZoneDisplayLabel(lv2PortAnchor).includes('Cargas'),
    `Expected Lv.2 Port to be Cargo Terminal, got: ${getZoneDisplayLabel(lv2PortAnchor)}`
  );

  const cargoBoats: BoatEntity[] = [];
  const tempPlanes: PlaneEntity[] = [];
  const tempParticles = createParticlePool(16);
  const tempCursor = { idx: 0 };
  for (let s = 0; s < 120; s++) {
    updateBoatsAndPlanes(city, cargoBoats, tempPlanes, tempParticles, tempCursor, 0.2, 1);
  }
  assert.equal(
    cargoBoats.some((b) => b.kind === 'cruise'),
    false,
    'Lv.2 Port must NOT spawn cruise liners before reaching final Lv.3 2x4 Cruise Port'
  );

  // 1B. Upgrade existing port to final Lv.3 Cruise Port (2×4 / 4×2) & verify cruise liners unlock
  const upgradedTiles = (await import('./cityEngine')).upgradeExistingLandmarks(city, 'port', 3);
  assert.ok(upgradedTiles >= 4, `Expected Lv.3 Cruise Port upgrade to expand tiles, got ${upgradedTiles}`);
  recomputeFieldsAndStats(city);
  assert.equal(city.stats.portCount, 1, 'Multi-tile Lv.3 port should still count as 1 port in stats');
  const portTiles = city.tiles.filter((t) => t.type === 'port');
  assert.ok(portTiles.length >= 4, `Expected enlarged Lv.3 Cruise Port (>=4 tiles, up to 2x4), got ${portTiles.length}`);
  assert.ok(
    portTiles.every((t) => t.level === 3),
    'All tiles of Lv.3 Cruise Port must share level 3'
  );
  const portAnchor = portTiles.find((t) => t.lotRole !== 'part')!;
  assert.ok(
    getZoneDisplayLabel(portAnchor).includes('Cruzeiros'),
    `Expected Lv.3 Cruise Port label, got: ${getZoneDisplayLabel(portAnchor)}`
  );

  // 2. Place 4×10 Airport & verify landing planes enter hangars (`taxi_to_hangar` -> `in_hangar` -> `taxi_from_hangar`)
  const airportPlaced = placeLandmarkOnBestSlot(city, 'airport', true, 1);
  assert.ok(airportPlaced, 'Expected 4×10 Airport placement to succeed');
  recomputeFieldsAndStats(city);
  assert.equal(
    city.tiles.filter((t) => t.type === 'airport').length,
    4 * 10,
    'Expected Level 1 Airport to occupy 40 tiles (4x10)'
  );

  // 3. Provision a 2×2 Level 4 Skyscraper with a Rooftop Helipad
  let helipadAnchorX = -1;
  let helipadAnchorY = -1;
  for (let y = 2; y < city.gridHeight - 4 && helipadAnchorX < 0; y++) {
    for (let x = 2; x < city.gridWidth - 4 && helipadAnchorX < 0; x++) {
      const block = [
        city.tiles[y * city.gridWidth + x],
        city.tiles[y * city.gridWidth + (x + 1)],
        city.tiles[(y + 1) * city.gridWidth + x],
        city.tiles[(y + 1) * city.gridWidth + (x + 1)],
      ];
      if (block.some((t) => t.type === 'water' || t.type === 'airport' || t.type === 'port')) continue;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const t = city.tiles[(y + dy) * city.gridWidth + (x + dx)];
          t.type = 'commercial';
          t.level = 4;
          t.lotWidth = 2;
          t.lotHeight = 2;
          t.lotDx = dx;
          t.lotDy = dy;
          t.lotRole = dx === 0 && dy === 0 ? 'anchor' : 'part';
          t.variant = 0;
        }
      }
      const anchor = city.tiles[y * city.gridWidth + x];
      if (hasSkyscraperHelipad(anchor)) {
        helipadAnchorX = x;
        helipadAnchorY = y;
        assert.ok(
          getZoneDisplayLabel(anchor).includes('2×2') && getZoneDisplayLabel(anchor).includes('Heliporto'),
          `Expected Lv.4 skyscraper with helipad label, got: ${getZoneDisplayLabel(anchor)}`
        );
      }
    }
  }
  assert.ok(helipadAnchorX >= 0, 'Expected to locate and configure a 2×2 Lv.4 skyscraper with helipad');
  recomputeFieldsAndStats(city);

  // 4. Simulate boats, planes, and helicopters over time
  const boats: BoatEntity[] = [];
  const planes: PlaneEntity[] = [];
  const helicopters: HelicopterEntity[] = [];
  const particles = createParticlePool(32);
  const cursor = { idx: 0 };

  const planePhases = new Set<string>();
  const heliPhases = new Set<string>();
  let sawCruiseBoat = false;

  for (let step = 0; step < 360; step++) {
    updateBoatsAndPlanes(city, boats, planes, particles, cursor, 0.2, 1, helicopters);
    if (boats.some((b) => b.kind === 'cruise')) sawCruiseBoat = true;
    for (const p of planes) planePhases.add(p.phase);
    for (const h of helicopters) heliPhases.add(h.phase);
  }

  assert.equal(sawCruiseBoat, true, 'Expected Cruise Liner to spawn on the river when Lv.3 Cruise Port exists');
  assert.ok(
    planePhases.has('taxi_to_hangar') && planePhases.has('in_hangar') && planePhases.has('taxi_from_hangar'),
    `Expected landed airplanes to taxi into hangars, stay inside, and emerge; saw: ${[...planePhases].join(', ')}`
  );
  assert.ok(
    heliPhases.has('approach') && heliPhases.has('descending') && heliPhases.has('landed') && heliPhases.has('ascending'),
    `Expected helicopters to approach, descend onto 2×2 skyscraper helipad, park, and ascend; saw: ${[...heliPhases].join(', ')}`
  );
});

test('main road connectivity keeps all ports, 6x12 airports, and developed lots reachable by car from roadOrigin', async () => {
  const { placeLandmarkOnBestSlot, placePortOnRiverfront } = await import('./cityEngine');
  const city = createNewCity(515151, 'easy');
  city.money = 1000000;

  // Simulate expansion + port + 6x12 airport + stadium
  for (let i = 0; i < 60; i++) {
    stepCityTick(city);
  }
  assert.ok(placePortOnRiverfront(city, true, 3), 'Expected Lv.3 Port placement');
  assert.ok(placeLandmarkOnBestSlot(city, 'airport', true, 1), 'Expected 6x12 Airport placement');
  assert.ok(placeLandmarkOnBestSlot(city, 'stadium', true, 1), 'Expected Stadium placement');
  recomputeFieldsAndStats(city);

  const mainRoads = getMainConnectedRoadSet(city);
  assert.ok(mainRoads.size >= 8, 'Expected connected main road network');

  const isAdjacentToMainRoad = (tiles: Array<{ x: number; y: number }>) =>
    tiles.some((t) =>
      [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([dx, dy]) => mainRoads.has((t.y + dy) * city.gridWidth + (t.x + dx)))
    );

  const portTiles = city.tiles.filter((t) => t.type === 'port');
  const airportTiles = city.tiles.filter((t) => t.type === 'airport');
  const stadiumTiles = city.tiles.filter((t) => t.type === 'stadium');

  assert.ok(isAdjacentToMainRoad(portTiles), 'Port must be reachable by car from the main road network');
  assert.ok(isAdjacentToMainRoad(airportTiles), '6x12 Airport must be reachable by car from the main road network');
  assert.ok(isAdjacentToMainRoad(stadiumTiles), 'Stadium must be reachable by car from the main road network');
});

test('traffic lights halt red-direction cars while allowing green cross traffic, bridges stay solid for cars, and police/fire cars patrol', () => {
  const city = createNewCity(909090, 'easy');
  const gw = city.gridWidth;

  // Build an isolated deterministic 4-way intersection at (ix, iy) = (10, 10)
  const ix = 10;
  const iy = 10;
  for (let d = -4; d <= 4; d++) {
    const hTile = city.tiles[iy * gw + (ix + d)];
    hTile.type = 'road';
    hTile.level = 1;
    const vTile = city.tiles[(iy + d) * gw + ix];
    vTile.type = 'road';
    vTile.level = 1;
  }
  assert.equal(isTrafficLightIntersection(city, ix, iy), true, 'Expected 4-way crossing to have a traffic light');

  // At t = 1.0s at even (10+10), N/S is green and E/W is red
  const sig = getTrafficSignalState(ix, iy, 1.0);
  assert.equal(sig.nsGreen, true);
  assert.equal(sig.ewGreen, false);

  const nsCar: CarEntity = {
    x: ix + 0.5,
    y: iy - 0.15,
    fromX: ix,
    fromY: iy - 1,
    toX: ix,
    toY: iy,
    progress: 0.9,
    speed: 2.0,
    color: '#ffffff',
    laneOffset: 0.14,
    kind: 'police',
  };
  const ewCar: CarEntity = {
    x: ix - 0.44,
    y: iy + 0.5,
    fromX: ix - 1,
    fromY: iy,
    toX: ix,
    toY: iy,
    progress: 0.56,
    speed: 2.0,
    color: '#ef4444',
    laneOffset: 0.14,
    kind: 'fire',
  };

  const cars: CarEntity[] = [nsCar, ewCar];
  const particles = createParticlePool(32);
  const cursor = { idx: 0 };

  const nsStartProg = nsCar.progress;
  const ewStartProg = ewCar.progress;
  updateCarsAndParticles(city, cars, particles, cursor, 0.1, 1, 1.0);

  assert.ok(nsCar.progress > nsStartProg || nsCar.toY > iy - 1, 'Green N/S car should proceed through intersection');
  assert.equal(ewCar.progress, ewStartProg, 'Red E/W car should stop cleanly at traffic signal');

  // Verify Police & Fire units exist when fleet fills up on city streets
  const fleet: CarEntity[] = [];
  for (let i = 0; i < 60; i++) {
    updateCarsAndParticles(city, fleet, particles, cursor, 0.1, 1, 1.0 + i * 0.1);
  }
  assert.ok(fleet.some((c) => c.kind === 'police'), 'Expected Police cars patrolling streets');
  assert.ok(fleet.some((c) => c.kind === 'fire'), 'Expected Fire trucks patrolling streets');

  // Bridges stay fixed (never open for cruise ships) so cars cross bridges continuously
  const waterTile = city.tiles.find(
    (t) =>
      t.type === 'water' &&
      t.x >= 4 &&
      t.x <= gw - 5 &&
      t.y >= 4 &&
      t.y <= city.gridHeight - 5
  );
  assert.ok(waterTile, 'Expected river water tile for fixed-bridge car test');
  const bridgeTile = city.tiles[waterTile.y * gw + waterTile.x];
  bridgeTile.type = 'bridge';
  bridgeTile.level = 2;
  const approachTile = city.tiles[waterTile.y * gw + (waterTile.x - 1)];
  approachTile.type = 'road';
  approachTile.level = 2;
  const farTile = city.tiles[waterTile.y * gw + (waterTile.x + 1)];
  farTile.type = 'bridge';
  farTile.level = 2;

  const cruiseBoat: BoatEntity = {
    x: bridgeTile.x + 0.5,
    y: bridgeTile.y + 0.5,
    fromX: bridgeTile.x,
    fromY: bridgeTile.y - 1,
    toX: bridgeTile.x,
    toY: bridgeTile.y + 1,
    progress: 0.5,
    speed: 0.5,
    hullColor: '#f8fafc',
    cargoColor: '#0ea5e9',
    kind: 'cruise',
  };
  const bridgeCar: CarEntity = {
    x: approachTile.x + 0.5,
    y: approachTile.y + 0.5,
    fromX: approachTile.x,
    fromY: approachTile.y,
    toX: bridgeTile.x,
    toY: bridgeTile.y,
    progress: 0.50,
    speed: 2.0,
    color: '#ffffff',
    laneOffset: 0.14,
    kind: 'sedan',
  };
  updateCarsAndParticles(city, [bridgeCar], particles, cursor, 0.1, 1, 2.0, [cruiseBoat]);
  assert.ok(bridgeCar.progress > 0.50, 'Cars must drive smoothly over solid fixed bridges without stopping for drawbridges');
});

test('cruise liners navigate strictly along open water to a port with no bridge in the way and never cross bridges', () => {
  const city = createNewCity(737373, 'easy');
  const gw = city.gridWidth;
  const gh = city.gridHeight;

  // Build a deterministic straight N-S river (x = 18..20) with two E-W bridges at y = 10 and y = 24
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const t = city.tiles[y * gw + x];
      t.type = x >= 18 && x <= 20 ? 'water' : 'grass';
      t.level = 0;
      t.lotRole = undefined;
      t.lotWidth = 1;
      t.lotHeight = 1;
      t.lotDx = 0;
      t.lotDy = 0;
    }
  }
  for (let x = 18; x <= 20; x++) {
    city.tiles[10 * gw + x].type = 'bridge';
    city.tiles[10 * gw + x].level = 2;
    city.tiles[24 * gw + x].type = 'bridge';
    city.tiles[24 * gw + x].level = 2;
  }

  assert.equal(isCruiseNavigableWater('water'), true);
  assert.equal(isCruiseNavigableWater('bridge'), false, 'Cruise liners must never navigate onto bridge tiles');

  // Port A (Lv.3) is boxed between bridges (y = 15..18) -> has bridges blocking both river mouths!
  for (let dy = 0; dy < 4; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      const t = city.tiles[(15 + dy) * gw + (16 + dx)];
      t.type = 'port';
      t.level = 3;
      t.lotWidth = 2;
      t.lotHeight = 4;
      t.lotDx = dx;
      t.lotDy = dy;
      t.lotRole = dx === 0 && dy === 0 ? 'anchor' : 'part';
    }
  }

  // With only the bridge-blocked Port A, cruise ships must NOT spawn in the boxed pocket
  assert.equal(getCruisePortNavigationInfo(city).targetPortAnchor, null);

  // Port B (Lv.3) is at y = 27..30, south of bridge y = 24 -> open bridge-free path from south river mouth (y = 35)!
  for (let dy = 0; dy < 4; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      const t = city.tiles[(27 + dy) * gw + (16 + dx)];
      t.type = 'port';
      t.level = 3;
      t.lotWidth = 2;
      t.lotHeight = 4;
      t.lotDx = dx;
      t.lotDy = dy;
      t.lotRole = dx === 0 && dy === 0 ? 'anchor' : 'part';
    }
  }

  const nav = getCruisePortNavigationInfo(city);
  assert.ok(nav.targetPortAnchor, 'Expected bridge-free Port B to be chosen for cruise ships');
  assert.equal(nav.targetPortAnchor.y, 27, 'Cruise ships must target Port B (no bridge in the way), not Port A');
  for (const idx of nav.navigableWater) {
    assert.equal(city.tiles[idx].type, 'water');
    assert.ok(Math.floor(idx / gw) >= 25, 'Navigable cruise channel must stay strictly south of bridge at y=24');
  }

  // Simulate boats for 240 steps and verify cruise liners spawn, approach Port B, and NEVER touch any bridge
  const boats: BoatEntity[] = [];
  const planes: PlaneEntity[] = [];
  const particles = createParticlePool(32);
  const cursor = { idx: 0 };
  let sawCruiseAtBridgeFreePort = false;
  for (let s = 0; s < 240; s++) {
    updateBoatsAndPlanes(city, boats, planes, particles, cursor, 0.2, 1);
    for (const b of boats) {
      if (b.kind === 'cruise') {
        assert.equal(city.tiles[b.fromY * gw + b.fromX].type, 'water', 'Cruise fromTile must stay on open water');
        assert.equal(city.tiles[b.toY * gw + b.toX].type, 'water', 'Cruise toTile must never enter a bridge');
        assert.ok(b.fromY >= 25 && b.toY >= 25, 'Cruise liner must remain in Port B bridge-free stretch');
        if (b.fromY >= 27 && b.fromY <= 30) sawCruiseAtBridgeFreePort = true;
      }
    }
  }
  assert.equal(sawCruiseAtBridgeFreePort, true, 'Expected cruise liner to sail directly to bridge-free Port B');

  // Also verify placePortOnRiverfront prefers bridge-free riverfronts when placing a Lv.3 Cruise Port
  const cityPlace = createNewCity(747474, 'easy');
  for (let y = 0; y < cityPlace.gridHeight; y++) {
    for (let x = 0; x < cityPlace.gridWidth; x++) {
      const t = cityPlace.tiles[y * cityPlace.gridWidth + x];
      t.type = x >= 18 && x <= 20 ? 'water' : 'grass';
      t.level = 0;
    }
  }
  for (let x = 18; x <= 20; x++) {
    cityPlace.tiles[6 * cityPlace.gridWidth + x].type = 'bridge';
    cityPlace.tiles[29 * cityPlace.gridWidth + x].type = 'bridge';
  }
  const placed = placePortOnRiverfront(cityPlace, true, 3);
  assert.ok(placed, 'Expected Lv.3 Cruise Port placement to succeed');
  const placedNav = getCruisePortNavigationInfo(cityPlace);
  assert.ok(placedNav.targetPortAnchor, 'Placed Lv.3 Cruise Port should have a bridge-free riverfront path');
});

test('dynamic weather cycles across all 4 seasons over the year, evolves weather, accumulates/melts snow, and round-trips saves', async () => {
  const {
    createHudSnapshot,
    cycleCitySeasonMode,
    deserializeCitySave,
    serializeCitySave,
    updateWeatherState,
  } = await import('./cityEngine');

  const city = createNewCity(123456);
  assert.equal(city.weather.season, 'summer', 'City starting in Jan/1994 begins in Verão (summer)');
  assert.equal(city.seasonMode, 'auto');

  const seenSeasons = new Set<string>([city.weather.season]);
  const seenWeatherKinds = new Set<string>([city.weather.kind]);

  // Simulate 12 full months in 5-second chunks (360 sim seconds) so all 4 seasons & changing weather occur
  for (let i = 0; i < 72; i++) {
    advanceSimulationTime(city, 5);
    seenSeasons.add(city.weather.season);
    seenWeatherKinds.add(city.weather.kind);
  }

  assert.deepEqual(
    Array.from(seenSeasons).sort(),
    ['autumn', 'spring', 'summer', 'winter'],
    'Simulating a full year must pass through all 4 seasons'
  );
  assert.ok(
    seenWeatherKinds.size >= 2,
    `Expected changing weather conditions across the year, saw: ${[...seenWeatherKinds].join(', ')}`
  );

  // Verify snow cover builds during winter and melts back down in spring/summer
  const winterCity = createNewCity(777111);
  winterCity.month = 7; // Julho -> Inverno
  updateWeatherState(winterCity, 1);
  for (let i = 0; i < 10; i++) {
    updateWeatherState(winterCity, 2);
  }
  assert.equal(winterCity.weather.season, 'winter');
  assert.ok(winterCity.weather.snowCover >= 0.45, `Expected winter snow cover accumulation, got ${winterCity.weather.snowCover}`);

  winterCity.month = 10; // Outubro -> Primavera
  for (let i = 0; i < 15; i++) {
    updateWeatherState(winterCity, 2);
  }
  assert.equal(winterCity.weather.season, 'spring');
  assert.equal(winterCity.weather.snowCover, 0, 'Winter snow cover should melt away in spring');

  // Verify cycleCitySeasonMode cycles auto -> summer -> autumn -> winter -> spring -> auto
  const cycleCity = createNewCity(654321);
  assert.equal(cycleCitySeasonMode(cycleCity), 'summer');
  assert.equal(cycleCitySeasonMode(cycleCity), 'autumn');
  assert.equal(cycleCitySeasonMode(cycleCity), 'winter');
  assert.equal(cycleCity.weather.season, 'winter');
  assert.ok(cycleCity.weather.snowCover > 0.5);
  assert.equal(cycleCitySeasonMode(cycleCity), 'spring');
  assert.equal(cycleCitySeasonMode(cycleCity), 'auto');
  assert.equal(createHudSnapshot(cycleCity).seasonMode, 'auto');

  // Save/load preserves weather & seasonMode and gracefully handles legacy saves missing weather
  cycleCitySeasonMode(cycleCity); // summer
  cycleCitySeasonMode(cycleCity); // autumn
  const savedJson = serializeCitySave(cycleCity);
  const reloaded = deserializeCitySave(savedJson);
  assert.ok(reloaded);
  assert.equal(reloaded.weather.season, 'autumn');
  assert.equal(reloaded.seasonMode, 'autumn');

  const legacyPayload = JSON.parse(savedJson) as Record<string, unknown>;
  delete legacyPayload.weather;
  delete legacyPayload.seasonMode;
  const legacyLoaded = deserializeCitySave(JSON.stringify(legacyPayload));
  assert.ok(legacyLoaded);
  assert.equal(legacyLoaded.weather.season, 'summer');
  assert.equal(legacyLoaded.seasonMode, 'auto');
});

test('named cities with different difficulties save independently, quick-save updates active save in place, and new year triggers auto-save', () => {

  const storeMap = new Map<string, string>();
  const mockStorage: StorageLike = {
    getItem: (k) => storeMap.get(k) ?? null,
    setItem: (k, v) => {
      storeMap.set(k, v);
    },
  };

  // Start empty -> no saves in memory
  assert.equal(loadSavedCitiesFromStorage(mockStorage).length, 0);

  // Create two distinct cities with different names & difficulties
  const easyCity = createNewCity(101010, 'easy', 'Florianópolis');
  const hardCity = createNewCity(202020, 'hard', 'São Paulo');

  saveCurrentCityToStorage(easyCity, { storage: mockStorage });
  saveCurrentCityToStorage(hardCity, { storage: mockStorage });

  let list = loadSavedCitiesFromStorage(mockStorage);
  assert.equal(list.length, 2);
  const easyRec = list.find((r) => r.saveId === easyCity.saveId)!;
  const hardRec = list.find((r) => r.saveId === hardCity.saveId)!;
  assert.equal(easyRec.name, 'Florianópolis');
  assert.equal(easyRec.difficulty, 'easy');
  assert.equal(hardRec.name, 'São Paulo');
  assert.equal(hardRec.difficulty, 'hard');

  // Quick-saving active city updates its existing record without creating duplicates
  easyCity.money += 1234;
  saveCurrentCityToStorage(easyCity, { storage: mockStorage });
  list = loadSavedCitiesFromStorage(mockStorage);
  assert.equal(list.length, 2, 'Quick-save should update active city in place without duplicating');
  assert.equal(
    list.find((r) => r.saveId === easyCity.saveId)?.money,
    Math.round(easyCity.money)
  );

  // Advancing 12 months (1 full year) automatically triggers annual auto-save on new year
  const prevYear = hardCity.year;
  let sawYearChange = false;
  for (let m = 0; m < 12; m++) {
    const res = advanceSimulationTime(hardCity, SECONDS_PER_MONTH_1X, mockStorage);
    if (res.yearChanged) sawYearChange = true;
  }
  assert.equal(sawYearChange, true, 'Advancing 12 months must cross into a new year');
  assert.equal(hardCity.year, prevYear + 1);

  list = loadSavedCitiesFromStorage(mockStorage);
  const updatedHard = list.find((r) => r.saveId === hardCity.saveId)!;
  assert.equal(updatedHard.year, prevYear + 1);
  assert.equal(updatedHard.isAutoSave, true, 'Annual auto-save should mark record as auto-save');

  const reloadedHard = deserializeCitySave(updatedHard.stateJson)!;
  assert.equal(reloadedHard.cityName, 'São Paulo');
  assert.equal(reloadedHard.difficulty, 'hard');
  assert.equal(reloadedHard.year, prevYear + 1);

  // Deleting one save leaves the other intact
  deleteSavedCityFromStorage(easyCity.saveId, mockStorage);
  list = loadSavedCitiesFromStorage(mockStorage);
  assert.equal(list.length, 1);
  assert.equal(list[0].saveId, hardCity.saveId);

  // Legacy v1 slot migration preserves old saves automatically
  const legacyStoreMap = new Map<string, string>();
  const legacyStorage: StorageLike = {
    getItem: (k) => legacyStoreMap.get(k) ?? null,
    setItem: (k, v) => {
      legacyStoreMap.set(k, v);
    },
  };
  legacyStoreMap.set(
    SAVE_STORAGE_KEY,
    JSON.stringify([
      {
        slotId: 1,
        name: 'Cidade Antiga',
        savedAtIso: '2026-01-01T00:00:00.000Z',
        savedAtLabel: '01/01 às 00:00',
        seed: 303030,
        traitName: 'Solo Fértil',
        traitColor: '#66d98c',
        difficulty: 'medium',
        population: 120,
        money: 5000,
        happiness: 80,
        month: 3,
        year: 1995,
        gridWidth: 36,
        gridHeight: 36,
        stateJson: updatedHard.stateJson,
      },
      null,
      null,
      null,
    ])
  );
  const migrated = loadSavedCitiesFromStorage(legacyStorage);
  assert.equal(migrated.length, 1);
  assert.equal(migrated[0].name, 'Cidade Antiga');
});

test('economic rebalance prevents runaway millions after 4 game years while keeping sustainable city growth', () => {
  const city = createNewCity(202699, 'medium');
  const startPop = city.totalPopulation;

  // Simulate 4 full years (48 months = 48 * 12 = 576 growth ticks)
  for (let m = 0; m < 48; m++) {
    for (let t = 0; t < 12; t++) {
      stepCityTick(city);
    }
    closeFinancialMonth(city);
  }

  assert.ok(
    city.totalPopulation > startPop * 2,
    `Expected healthy multi-year population growth (${startPop} -> ${city.totalPopulation})`
  );
  assert.ok(
    city.money < 600_000,
    `Expected balanced 4-year treasury well below runaway millions, got $${city.money}`
  );
});

test('Prédio Médio -> Condomínio manual conversion and condoPolicy toggle (manual vs auto) persist across saves', async () => {
  const {
    convertBuildingToCondo,
    getCondoConversionInfo,
    getZoneDisplayLabel,
    serializeCitySave,
    setCondoPolicy,
  } = await import('./cityEngine');

  const city = createNewCity(441122, 'easy');
  assert.equal(city.condoPolicy, 'manual', 'Default condoPolicy should be manual');

  // Promote a starter residential lot to Prédio Médio (Lv. 2)
  const resTile = city.tiles.find((t) => t.type === 'residential' && t.lotRole !== 'part')!;
  assert.ok(resTile);
  resTile.level = 2;
  resTile.age = 200;
  resTile.upgradeCooldown = 0;
  resTile.evolutionProgress = 99;
  recomputeFieldsAndStats(city);

  assert.ok(
    getZoneDisplayLabel(resTile).includes('Prédio Médio'),
    `Expected Lv.2 residential label to be Prédio Médio, got ${getZoneDisplayLabel(resTile)}`
  );

  // Under 'manual' policy, ticking must NOT auto-upgrade Prédio Médio into Condomínio (Lv. 3)
  for (let i = 0; i < 10; i++) {
    stepCityTick(city);
  }
  assert.equal(resTile.level, 2, 'Manual condoPolicy must keep Prédio Médio at Lv. 2 until player converts it');

  // Inspect conversion info and manually convert to Condomínio (Lv. 3)
  city.money = 50_000;
  const info = getCondoConversionInfo(city, resTile.x, resTile.y);
  assert.ok(info, 'Expected condo conversion info for Prédio Médio');
  assert.equal(info.eligible, true);
  assert.equal(info.canAfford, true);
  assert.ok(info.popGain > 100, `Expected meaningful resident capacity gain, got +${info.popGain}`);

  const popBefore = city.totalPopulation;
  const conv = convertBuildingToCondo(city, resTile.x, resTile.y);
  assert.equal(conv.ok, true, `Expected manual condo conversion to succeed: ${conv.reason}`);
  assert.equal(resTile.level, 3, 'Converted building should be Lv. 3 Condomínio');
  assert.ok(getZoneDisplayLabel(resTile).includes('Condomínio'));
  assert.ok(city.totalPopulation > popBefore, 'Converting to Condomínio should immediately boost city population');
  assert.ok(city.stats.condoCount >= 1);

  // Toggle condoPolicy to 'auto' and verify save/load preserves it
  assert.equal(setCondoPolicy(city, 'auto'), true);
  const reloaded = deserializeCitySave(serializeCitySave(city));
  assert.ok(reloaded);
  assert.equal(reloaded.condoPolicy, 'auto');
});

test('population gates enforce 2k Sports Center, 5k/15k/30k Airports, and 20k Stadium & Toll Plaza in Obras Evolutivas', () => {
  const city = createNewCity(775533, 'easy');
  city.money = 5_000_000;

  // Below 2,000 pop: Sports Center, Airport, Stadium, and Toll Plaza are all locked by population
  assert.ok(city.totalPopulation < 2000);
  const lockedEarly = ['sports_center_project', 'airport_evolution', 'landmark_project', 'toll_plaza_project'] as const;
  for (const id of lockedEarly) {
    const offer = getEmergencyOffers(city).find((o) => o.id === id);
    assert.ok(offer, `Expected offer ${id} to be listed`);
    assert.equal(offer.unlocked, false, `Expected ${id} to be population-locked at ${city.totalPopulation} pop`);
    const exec = executeEmergencyAction(city, id);
    assert.equal(exec.ok, false, `Expected ${id} execution to fail below required population`);
  }

  const raisePopTo = (target: number) => {
    const slots = city.tiles.filter((t) => t.type === 'grass' || t.type === 'forest');
    let i = 0;
    while (city.totalPopulation < target && i < slots.length) {
      slots[i].type = 'residential';
      slots[i].level = 3;
      i++;
      recomputeFieldsAndStats(city);
    }
  };

  // At 2,000 pop -> Centro Esportivo Pequeno unlocks, while Airport (5k) & Stadium/Toll (20k) stay locked
  raisePopTo(2000);
  assert.equal(runEmergencyWorkToCompletion(city, 'sports_center_project').ok, true);
  assert.equal(executeEmergencyAction(city, 'airport_evolution').ok, false);
  assert.equal(executeEmergencyAction(city, 'landmark_project').ok, false);
  assert.equal(executeEmergencyAction(city, 'toll_plaza_project').ok, false);

  // At 5,000 pop -> Aeroporto Pequeno (Fase I) unlocks, then Fase II requires 15,000 pop!
  raisePopTo(5000);
  city.money = 5_000_000;
  assert.equal(runEmergencyWorkToCompletion(city, 'airport_evolution').ok, true, 'Airport Fase I should unlock at 5k');
  assert.equal(executeEmergencyAction(city, 'airport_evolution').ok, false, 'Airport Fase II should require 15k');

  // At 15,000 pop -> Aeroporto Médio (Fase II) unlocks, then Fase III requires 30,000 pop!
  raisePopTo(15000);
  city.money = 5_000_000;
  assert.equal(runEmergencyWorkToCompletion(city, 'airport_evolution').ok, true, 'Airport Fase II should unlock at 15k');
  assert.equal(executeEmergencyAction(city, 'airport_evolution').ok, false, 'Airport Fase III should require 30k');
  assert.equal(executeEmergencyAction(city, 'landmark_project').ok, false, 'Stadium should still require 20k');
  assert.equal(executeEmergencyAction(city, 'toll_plaza_project').ok, false, 'Toll Plaza should still require 20k');

  // At 20,000 pop -> Estádio Monumental & Praça de Pedágio unlock!
  raisePopTo(20000);
  city.money = 5_000_000;
  assert.equal(runEmergencyWorkToCompletion(city, 'landmark_project').ok, true, 'Stadium should unlock at 20k');
  assert.equal(executeEmergencyAction(city, 'toll_plaza_project').ok, true, 'Toll Plaza should unlock at 20k');
  assert.equal(city.tollPlaza.built, true);

  // At 30,000 pop -> Aeroporto Grande (Fase III) unlocks!
  raisePopTo(30000);
  city.money = 5_000_000;
  assert.equal(runEmergencyWorkToCompletion(city, 'airport_evolution').ok, true, 'Airport Fase III should unlock at 30k');
});

test('permanent External Highway reaches outer map edge across expansions, spawns visitor traffic, and adjustable Toll Plaza (low/medium/high) affects visitors & revenue', async () => {
  const {
    isExternalBorderRoadTile,
    isTollPlazaTile,
    serializeCitySave,
    setTollTariff,
  } = await import('./cityEngine');

  const city = createNewCity(664422, 'easy');
  city.money = 5_000_000;

  // 1. Starter city always has an external highway reaching the outer map border and connected to main roads
  const verifyBorderRoad = (label: string) => {
    const hw = city.externalHighway;
    assert.ok(hw, `${label}: externalHighway must exist`);
    const onEdge =
      hw.borderX === 0 ||
      hw.borderX === city.gridWidth - 1 ||
      hw.borderY === 0 ||
      hw.borderY === city.gridHeight - 1;
    assert.equal(onEdge, true, `${label}: border tile (${hw.borderX},${hw.borderY}) must touch map outer edge`);
    assert.equal(isExternalBorderRoadTile(city, hw.borderX, hw.borderY), true);
    const mainRoads = getMainConnectedRoadSet(city);
    assert.equal(
      mainRoads.has(hw.borderY * city.gridWidth + hw.borderX),
      true,
      `${label}: external border portal must be connected to main road network`
    );
  };

  verifyBorderRoad('starter');

  // 2. Survives expansion in all 4 directions
  for (const dir of ['norte', 'leste', 'sul', 'oeste'] as const) {
    assert.equal(expandCityLand(city, dir).ok, true);
    verifyBorderRoad(`after expand ${dir}`);
  }

  // 3. Visitor vehicles enter from outside (visitor_in) and head out (visitor_out)
  const cars: CarEntity[] = [];
  const particles = createParticlePool(32);
  const cursor = { idx: 0 };
  for (let i = 0; i < 60; i++) {
    updateCarsAndParticles(city, cars, particles, cursor, 0.1, 1, 1 + i * 0.1);
  }
  assert.ok(
    cars.some((c) => c.role === 'visitor_in' || c.role === 'visitor_out'),
    'Expected external visitor traffic on city streets'
  );

  // 4. Build Toll Plaza at 20,000+ pop and test Low / Medium / High tariff effects
  const slots = city.tiles.filter((t) => t.type === 'grass' || t.type === 'forest');
  let idx = 0;
  while (city.totalPopulation < 20_500 && idx < slots.length) {
    slots[idx].type = 'residential';
    slots[idx].level = 3;
    idx++;
    recomputeFieldsAndStats(city);
  }
  assert.equal(executeEmergencyAction(city, 'toll_plaza_project').ok, true);
  assert.equal(city.tollPlaza.built, true);
  assert.equal(isTollPlazaTile(city, city.externalHighway.tollX, city.externalHighway.tollY), true);

  setTollTariff(city, 'low');
  const flowLow = city.stats.visitorTrafficPct;
  const revLow = city.financials.revenue.tollIncome;
  const tourLow = city.financials.revenue.tourismIncome;

  setTollTariff(city, 'medium');
  const flowMed = city.stats.visitorTrafficPct;
  const revMed = city.financials.revenue.tollIncome;

  setTollTariff(city, 'high');
  const flowHigh = city.stats.visitorTrafficPct;
  const revHigh = city.financials.revenue.tollIncome;
  const tourHigh = city.financials.revenue.tourismIncome;

  assert.ok(flowLow > flowMed && flowMed > flowHigh, `Expected visitor flow low (${flowLow}) > medium (${flowMed}) > high (${flowHigh})`);
  assert.ok(revHigh > revLow, `Expected high tariff toll revenue (${revHigh}) > low (${revLow})`);
  assert.ok(tourLow > tourHigh, `Expected low tariff tourism (${tourLow}) > high (${tourHigh})`);
  assert.ok(revMed > 0);

  // Save/load preserves toll plaza & tariff
  const reloaded = deserializeCitySave(serializeCitySave(city));
  assert.ok(reloaded);
  assert.equal(reloaded.tollPlaza.built, true);
  assert.equal(reloaded.tollPlaza.tariff, 'high');
  assert.ok(reloaded.externalHighway);
});

test('random Economic Cycles (recession/inflation) and Urban Incidents (storm/blackout/repairs) impact city and resolve cleanly via emergency action', async () => {
  const {
    serializeCitySave,
    triggerRandomEvent,
  } = await import('./cityEngine');

  const city = createNewCity(991188, 'medium');
  city.money = 120_000;
  const baseRev = city.financials.revenue.total;
  const baseFixed = city.financials.expenses.fixedTotal;
  const baseHappy = city.globalHappiness;

  // 1. Economic Cycle: Recession cuts revenue
  triggerRandomEvent(city, 'recession');
  assert.equal(city.activeEconomicEvent?.id, 'recession');
  assert.ok(
    city.financials.revenue.total < baseRev,
    `Expected recession to cut revenue (${baseRev} -> ${city.financials.revenue.total})`
  );

  // 2. Economic Cycle: Inflation raises fixed expenses & construction costs
  const costBeforeInf = getEmergencyOffers(city).find((o) => o.id === 'port_evolution')!.cost;
  triggerRandomEvent(city, 'inflation');
  assert.equal(city.activeEconomicEvent?.id, 'inflation');
  assert.ok(
    city.financials.expenses.fixedTotal > baseFixed,
    `Expected inflation to raise fixed expenses (${baseFixed} -> ${city.financials.expenses.fixedTotal})`
  );
  const costDuringInf = getEmergencyOffers(city).find((o) => o.id === 'port_evolution')!.cost;
  assert.ok(
    costDuringInf > costBeforeInf,
    `Expected inflation to raise construction costs (${costBeforeInf} -> ${costDuringInf})`
  );

  // 3. Urban Incident: Blackout lowers happiness & exposes contextual 'incident_response' offer
  triggerRandomEvent(city, 'blackout');
  assert.equal(city.activeUrbanIncident?.id, 'blackout');
  assert.ok(
    city.globalHappiness < baseHappy,
    `Expected blackout to lower happiness (${baseHappy} -> ${city.globalHappiness})`
  );
  const responseOffer = getEmergencyOffers(city).find((o) => o.id === 'incident_response');
  assert.ok(responseOffer, 'Expected contextual incident_response offer while urban incident is active');

  // Save/load preserves active events
  const reloaded = deserializeCitySave(serializeCitySave(city));
  assert.ok(reloaded);
  assert.equal(reloaded.activeEconomicEvent?.id, 'inflation');
  assert.equal(reloaded.activeUrbanIncident?.id, 'blackout');

  // 4. Executing incident_response immediately clears the urban incident
  const resolved = executeEmergencyAction(city, 'incident_response');
  assert.equal(resolved.ok, true);
  assert.equal(city.activeUrbanIncident, null, 'Expected incident_response to clear active urban incident');
});

test('civic milestones unlock projects without auto-building; construction & upgrades require funds and explicit player order', async () => {
  const { evaluateCivicMilestones, getCivicMilestoneStatuses, setCityBudgetTargetPct } = await import('./cityEngine');

  const city = createNewCity(314159, 'medium');
  // Ensure there is at least one river bridge to verify bridge level is not auto-upgraded
  const riverTile = city.tiles.find((t) => t.type === 'water');
  if (riverTile) {
    riverTile.type = 'bridge';
    riverTile.level = 1;
    riverTile.variant = 0;
  }

  // Boost city population past every civic milestone (up to 30k+)
  const slots = city.tiles.filter((t) => t.type === 'grass' || t.type === 'forest');
  let i = 0;
  while (city.totalPopulation < 31_000 && i < slots.length) {
    slots[i].type = 'residential';
    slots[i].level = 3;
    i++;
    recomputeFieldsAndStats(city);
  }
  assert.ok(city.totalPopulation >= 30_000, `Expected >= 30k pop, got ${city.totalPopulation}`);

  // Max out budgets and run ticks + milestone evaluation to ensure no automatic building or bridge upgrade occurs
  for (const area of BUDGET_AREA_ORDER) {
    setCityBudgetTargetPct(city, area, 200);
  }
  city.breakthroughCharge.entertainment = 99;
  city.breakthroughCharge.infrastructure = 99;

  for (let t = 0; t < 15; t++) {
    stepCityTick(city);
  }
  evaluateCivicMilestones(city);
  recomputeFieldsAndStats(city);

  assert.equal(city.stats.portCount, 0, 'Port must NOT auto-build when milestone unlocks');
  assert.equal(city.stats.airportCount, 0, 'Airport must NOT auto-build when milestone unlocks');
  assert.equal(city.stats.stadiumCount, 0, 'Stadium must NOT auto-build at 20k+ without player order');
  assert.equal(city.stats.sportsCenterCount, 0, 'Sports Center must NOT auto-build without player order');
  assert.equal(city.stats.busStationCount, 0, 'Bus Terminals must NOT auto-build without player order');
  assert.equal(city.stats.metroStationCount, 0, 'Metro Stations must NOT auto-build without player order');
  assert.equal(city.tollPlaza.built, false, 'Toll Plaza must NOT auto-build without player order');
  assert.equal(
    getEmergencyOffers(city).some((o) => o.id === 'emergency_roadworks'),
    false,
    'Bridge evolution must NOT appear in manual Obras offers'
  );
  assert.equal(city.stats.bridgeLevel, 4, 'River bridges MUST auto-upgrade to Nv. 4 upon reaching 22k+ milestone');

  // All 18 civic milestones should report unlocked=true; automatic milestones (verticalization + bridges) are built=true while Obras-gated projects remain built=false until player builds them
  const statusesBefore = getCivicMilestoneStatuses(city);
  assert.equal(statusesBefore.length, 18);
  for (const m of statusesBefore) {
    assert.equal(m.unlocked, true, `Expected milestone ${m.id} to be unlocked at 30k+ pop`);
    if (
      m.id === 'civic_vertical_10k' ||
      m.id === 'civic_bridge_lv2' ||
      m.id === 'civic_bridge_lv3' ||
      m.id === 'civic_bridge_lv4'
    ) {
      assert.equal(m.built, true, `Automatic milestone ${m.id} should activate once unlocked`);
      assert.equal(m.actionId, undefined, `Automatic milestone ${m.id} should not reference a manual Obras actionId`);
    } else {
      assert.equal(m.built, false, `Expected milestone ${m.id} to remain built=false until player builds it`);
      assert.ok(m.actionId, `Expected milestone ${m.id} to reference an Obras actionId`);
    }
  }

  // With insufficient money, player cannot build any unlocked milestone project
  city.money = 100;
  for (const actionId of [
    'port_evolution',
    'sports_center_project',
    'bus_transit_project',
    'metro_transit_project',
    'airport_evolution',
    'landmark_project',
    'toll_plaza_project',
  ] as const) {
    const res = executeEmergencyAction(city, actionId);
    assert.equal(res.ok, false, `Expected ${actionId} to fail with insufficient treasury`);
  }
  assert.equal(city.stats.portCount, 0);
  assert.equal(city.stats.busStationCount, 0);
  assert.equal(city.stats.metroStationCount, 0);
  assert.equal(city.stats.airportCount, 0);
  assert.equal(city.stats.stadiumCount, 0);
  assert.equal(city.stats.sportsCenterCount, 0);
  assert.equal(city.tollPlaza.built, false);

  // Fund treasury and explicitly execute Obras orders
  city.money = 10_000_000;
  assert.equal(executeEmergencyAction(city, 'port_evolution').ok, true);
  assert.equal(executeEmergencyAction(city, 'sports_center_project').ok, true);
  assert.equal(executeEmergencyAction(city, 'bus_transit_project').ok, true);
  assert.equal(executeEmergencyAction(city, 'metro_transit_project').ok, true);
  assert.equal(executeEmergencyAction(city, 'airport_evolution').ok, true);
  assert.equal(executeEmergencyAction(city, 'landmark_project').ok, true);
  assert.equal(executeEmergencyAction(city, 'toll_plaza_project').ok, true);
  // Toll Plaza is immediate (0 durationMonths); multi-month works stay in pendingWorks until completed
  assert.equal(city.tollPlaza.built, true, 'Expected immediate Toll Plaza built right after order');
  assert.equal(city.stats.airportCount, 0, 'Multi-month Airport must NOT count as built mid-construction');
  assert.equal(city.stats.stadiumCount, 0, 'Multi-month Stadium must NOT count as built mid-construction');

  // Complete all active multi-month projects
  while (city.pendingWorks.length > 0) {
    closeFinancialMonth(city);
  }
  recomputeFieldsAndStats(city);

  assert.ok(city.stats.portCount >= 1, 'Expected Port built after completion');
  assert.ok(city.stats.sportsCenterCount >= 1, 'Expected Sports Center built after completion');
  assert.ok(city.stats.busStationCount >= 2, 'Expected Bus Terminals built after completion');
  assert.ok(city.stats.metroStationCount >= 2, 'Expected Metro Stations built after completion');
  assert.ok(city.stats.airportCount >= 1, 'Expected Airport built after completion');
  assert.ok(city.stats.stadiumCount >= 1, 'Expected Stadium built after completion');
  assert.equal(city.tollPlaza.built, true, 'Expected Toll Plaza built after explicit order');
  assert.equal(city.stats.bridgeLevel, 4, 'Expected river bridges automatically upgraded to Nv. 4');

  const statusesAfterCompletion = getCivicMilestoneStatuses(city);
  const byId = Object.fromEntries(statusesAfterCompletion.map((s) => [s.id, s]));
  assert.equal(byId.civic_port_lv1.built, true);
  assert.equal(byId.civic_sports_small.built, true);
  assert.equal(byId.civic_bus_system.built, true);
  assert.equal(byId.civic_metro_system.built, true);
  assert.equal(byId.civic_bridge_lv2.built, true);
  assert.equal(byId.civic_bridge_lv3.built, true);
  assert.equal(byId.civic_bridge_lv4.built, true);
  assert.equal(byId.civic_airport_lv1.built, true);
  assert.equal(byId.civic_stadium_20k.built, true);
  assert.equal(byId.civic_toll_20k.built, true);
});

test('Nv. 4 Mega-Bridge widens eligible river bridges to 2 tiles wide without overwriting landmarks, keeps cars straight, and demolishes as one span', async () => {
  const { evaluateCivicMilestones } = await import('./cityEngine');
  const city = createNewCity(440044);

  // Build a clean deterministic vertical N-S river (x = 17..19) across the entire map
  for (let y = 0; y < city.gridHeight; y++) {
    for (let x = 0; x < city.gridWidth; x++) {
      const tile = getTile(city, x, y)!;
      if (x >= 17 && x <= 19) {
        tile.type = 'water';
        tile.level = 1;
      } else {
        tile.type = 'grass';
        tile.level = 1;
      }
      tile.variant = 0;
    }
  }

  // Bridge 1 at y = 14 (clear grass banks at y = 13 and y = 15 -> eligible to widen to 2 tiles)
  for (const bx of [17, 18, 19]) {
    const t = getTile(city, bx, 14)!;
    t.type = 'bridge';
    t.level = 1;
  }
  for (const rx of [15, 16, 20, 21]) {
    const t = getTile(city, rx, 14)!;
    t.type = 'road';
    t.level = 2;
  }

  // Bridge 2 at y = 26 (blocked on BOTH sides y = 25 and y = 27 by port landmarks -> must NOT overwrite ports)
  for (const bx of [17, 18, 19]) {
    const t = getTile(city, bx, 26)!;
    t.type = 'bridge';
    t.level = 1;
  }
  for (const rx of [15, 16, 20, 21]) {
    const t = getTile(city, rx, 26)!;
    t.type = 'road';
    t.level = 2;
  }
  for (const portY of [25, 27]) {
    for (const portX of [16, 20]) {
      const p = getTile(city, portX, portY)!;
      p.type = 'port';
      p.level = 2;
    }
  }

  // Populate the map away from both bridges to >= 23,000 residents
  for (let y = 2; y < city.gridHeight - 2 && city.totalPopulation < 23000; y++) {
    for (let x = 2; x < city.gridWidth - 2 && city.totalPopulation < 23000; x++) {
      if (x >= 14 && x <= 22) continue;
      const t = getTile(city, x, y)!;
      if (t.type === 'grass') {
        t.type = 'residential';
        t.level = 4;
        recomputeFieldsAndStats(city);
      }
    }
  }
  assert.ok(city.totalPopulation >= 22000, `Expected >=22k pop, got ${city.totalPopulation}`);
  assert.equal(countRiverBridges(city), 2, 'Expected 2 distinct river bridges before Tier 4 upgrade');

  // Reaching the 22k civic milestone automatically upgrades river bridges to Nv. 4 (2-tile-wide Mega-Bridge)
  city.money = 10_000_000;
  evaluateCivicMilestones(city);
  recomputeFieldsAndStats(city);

  assert.equal(city.stats.bridgeLevel, 4);

  // Bridge 1 should now be 2 tiles wide (y = 14 + either y = 15 or y = 13) with all tiles at level 4
  const widenedRow = getTile(city, 18, 15)?.type === 'bridge' ? 15 : getTile(city, 18, 13)?.type === 'bridge' ? 13 : -1;
  assert.ok(widenedRow === 15 || widenedRow === 13, 'Expected eligible Bridge 1 to widen to an adjacent parallel row');
  for (const bx of [17, 18, 19]) {
    const primary = getTile(city, bx, 14);
    const sibling = getTile(city, bx, widenedRow);
    assert.ok(primary && sibling);
    assert.equal(primary.type, 'bridge');
    assert.equal(primary.level, 4);
    assert.equal(sibling.type, 'bridge');
    assert.equal(sibling.level, 4);
    assert.equal(isDoubleWidthBridgeTile(city, bx, 14), true);
    assert.equal(isDoubleWidthBridgeTile(city, bx, widenedRow), true);
  }
  // Both riverbank landing roads of the widened lane must connect cleanly
  assert.equal(getTile(city, 16, widenedRow)?.type, 'road');
  assert.equal(getTile(city, 20, widenedRow)?.type, 'road');

  // Contiguous 2-tile-wide bridge still counts as 1 span -> total remains 2 spans
  assert.equal(countRiverBridges(city), 2, 'Double-width bridge must count as a single contiguous span');

  // Bridge 2 was flanked by ports on both sides -> upgraded safely to Lv.4 without overwriting ports
  for (const bx of [17, 18, 19]) {
    const b2 = getTile(city, bx, 26)!;
    assert.equal(b2.type, 'bridge');
    assert.equal(b2.level, 4);
    assert.equal(isDoubleWidthBridgeTile(city, bx, 26), false);
  }
  for (const portY of [25, 27]) {
    for (const portX of [16, 20]) {
      assert.equal(getTile(city, portX, portY)?.type, 'port', `Port at (${portX},${portY}) must remain intact`);
    }
  }

  // Boats pass under bridges while cruise liners avoid bridges
  assert.equal(isNavigableWater('bridge'), true);
  assert.equal(isCruiseNavigableWater('bridge'), false);

  // Cars driving east on Bridge 1 (y = 14) must continue straight onto (18, 14) and never jump sideways onto widenedRow
  const car: CarEntity = {
    x: 16,
    y: 14,
    fromX: 16,
    fromY: 14,
    toX: 17,
    toY: 14,
    progress: 0.99,
    speed: 2.0,
    color: '#ef4444',
    kind: 'sedan',
    laneOffset: 0.14,
  };
  const cars: CarEntity[] = [car];
  const particles = createParticlePool();
  updateCarsAndParticles(city, cars, particles, { idx: 0 }, 0.05, 1, 0);
  assert.equal(car.fromX, 17);
  assert.equal(car.fromY, 14);
  assert.equal(car.toX, 18, 'Car crossing 2-tile-wide bridge must proceed straight along its deck');
  assert.equal(car.toY, 14, 'Car crossing 2-tile-wide bridge must not jump sideways mid-river');

  // Demolishing a single tile of the 2-tile-wide bridge clears BOTH parallel decks back to water
  city.money = 1_000_000;
  const demoRes = demolishCityTile(city, 18, 14);
  assert.equal(demoRes.ok, true);
  for (const bx of [17, 18, 19]) {
    assert.equal(getTile(city, bx, 14)?.type, 'water');
    assert.equal(getTile(city, bx, widenedRow)?.type, 'water');
  }
  assert.equal(countRiverBridges(city), 1);
});

test('cohesive neighborhoods partition Residential, Commercial, and Industrial districts, enforce compact infill, and prevent isolated giant towers beside Lv. 1 houses', async () => {
  const {
    getNeighborhoodDistrict,
    getNeighborhoodDistrictLabel,
    getNeighborhoodMaturity,
    setCityBudgetTargetPct,
  } = await import('./cityEngine');
  const city = createNewCity(771122);

  // Deterministic district partitioning must generate all 3 cohesive neighborhood types across the grid
  const districtCounts = { residential: 0, commercial: 0, industrial: 0 };
  for (let y = 2; y < city.gridHeight - 2; y++) {
    for (let x = 2; x < city.gridWidth - 2; x++) {
      const d = getNeighborhoodDistrict(city, x, y);
      districtCounts[d]++;
    }
  }
  assert.ok(districtCounts.residential > 40, 'Expected substantial Bairro Residencial coverage');
  assert.ok(districtCounts.commercial > 25, 'Expected substantial Bairro Comercial coverage');
  assert.ok(districtCounts.industrial > 25, 'Expected substantial Distrito Industrial coverage');
  assert.equal(getNeighborhoodDistrictLabel('residential'), 'Bairro Residencial');
  assert.equal(getNeighborhoodDistrictLabel('commercial'), 'Bairro Comercial');
  assert.equal(getNeighborhoodDistrictLabel('industrial'), 'Distrito Industrial');

  // Verify gradual neighborhood maturity gate: a lone Lv. 2 building surrounded only by grass & Lv. 1 houses
  // must NOT prematurely evolve to Lv. 3 until its neighborhood peers fill and grow together!
  for (let y = 0; y < city.gridHeight; y++) {
    for (let x = 0; x < city.gridWidth; x++) {
      const t = getTile(city, x, y)!;
      t.type = 'grass';
      t.level = 0;
      t.lotRole = undefined;
      t.lotWidth = undefined;
      t.lotHeight = undefined;
      t.lotDx = undefined;
      t.lotDy = undefined;
      t.establishmentId = undefined;
    }
  }
  // Lay a road along y = 16 and put a single Lv. 2 commercial building at (16, 15) beside only 2 Lv. 1 shops
  for (let x = 10; x <= 22; x++) {
    const r = getTile(city, x, 16)!;
    r.type = 'road';
    r.level = 2;
  }
  const loneTower = getTile(city, 16, 15)!;
  loneTower.type = 'commercial';
  loneTower.level = 2;
  loneTower.age = 40;
  loneTower.upgradeCooldown = 0;
  loneTower.evolutionProgress = 99;
  const peer1 = getTile(city, 15, 15)!;
  peer1.type = 'commercial';
  peer1.level = 1;
  const peer2 = getTile(city, 17, 15)!;
  peer2.type = 'commercial';
  peer2.level = 1;

  city.money = 1_000_000;
  for (const area of BUDGET_AREA_ORDER) {
    setCityBudgetTargetPct(city, area, 140);
  }
  recomputeFieldsAndStats(city);

  const immature = getNeighborhoodMaturity(city, 16, 15);
  assert.ok(immature.fillRatio < 0.45, `Expected low fillRatio in sparse block, got ${immature.fillRatio}`);
  assert.ok(immature.avgLevel < 1.5, `Expected low avgLevel beside Lv.1 peers, got ${immature.avgLevel}`);

  // Step several ticks: loneTower must stay <= Lv. 2 while neighborhood peers are still sparse/Lv. 1
  for (let t = 0; t < 6; t++) {
    stepCityTick(city);
  }
  assert.ok(
    loneTower.level <= 2,
    `Expected lone commercial building to wait for its neighborhood peers instead of jumping to Lv.${loneTower.level}`
  );
});

test('2x2 Wide Avenues (Avenida Larga 2x2) are required for Lv. 4 Skyscrapers & Mega Condos, preserved by road reconciliation, and attract high vehicle flow', async () => {
  const {
    getCondoConversionInfo,
    getRoadClassLabel,
    isAdjacentToWideAvenue2x2,
    isWideAvenue2x2Tile,
    reconcileRoadHierarchy,
    widenAvenueCorridorAt,
  } = await import('./cityEngine');
  const city = createNewCity(882233);

  const ox = city.roadOriginX ?? 17;
  const oy = city.roadOriginY ?? 17;
  const aveY = oy + 3; // Planned road row right below the 2×2 block (ox+1..ox+2, oy+1..oy+2)

  // Build a clean flat canvas with a single 1-tile-wide Avenida at y = aveY and a 2×2 residential block right north of it
  for (let y = 0; y < city.gridHeight; y++) {
    for (let x = 0; x < city.gridWidth; x++) {
      const t = getTile(city, x, y)!;
      t.type = 'grass';
      t.level = 0;
      t.variant = 0;
      t.lotRole = undefined;
      t.lotWidth = undefined;
      t.lotHeight = undefined;
      t.lotDx = undefined;
      t.lotDy = undefined;
      t.establishmentId = undefined;
    }
  }
  for (let x = Math.max(2, ox - 4); x <= Math.min(city.gridWidth - 3, ox + 6); x++) {
    const r = getTile(city, x, aveY)!;
    r.type = 'road';
    r.level = 2;
    r.variant = 0;
  }
  // Place a Lv. 3 residential condo at (ox + 1, oy + 2) inside the planned 2×2 block next to the 1-tile-wide avenue
  const bx = ox + 1;
  const by = oy + 1;
  const res = getTile(city, bx, by + 1)!;
  res.type = 'residential';
  res.level = 3;
  res.landValue = 75;
  const res2 = getTile(city, bx + 1, by + 1)!;
  res2.type = 'residential';
  res2.level = 2;
  const res3 = getTile(city, bx, by)!;
  res3.type = 'residential';
  res3.level = 2;
  const res4 = getTile(city, bx + 1, by)!;
  res4.type = 'residential';
  res4.level = 2;

  // Populate outer rows away from the test block to >= 30,500 residents so Lv. 4 Mega Condomínio 30k milestone gate is satisfied
  for (let y = 1; y <= 14 && city.totalPopulation < 30_500; y++) {
    for (let x = 2; x < city.gridWidth - 2 && city.totalPopulation < 30_500; x++) {
      const filler = getTile(city, x, y)!;
      if (filler.type !== 'grass') continue;
      filler.type = 'residential';
      filler.level = 3;
      recomputeFieldsAndStats(city);
    }
  }
  assert.ok(city.totalPopulation >= 30_000, `Expected >= 30,000 pop, got ${city.totalPopulation}`);

  city.money = 1_000_000;
  recomputeFieldsAndStats(city);

  // Without a 2×2 Wide Avenue on at least one side, converting Lv. 3 -> Lv. 4 Mega Condomínio must be blocked!
  assert.equal(isAdjacentToWideAvenue2x2(city, bx, by, 2, 2), false);
  const blockedInfo = getCondoConversionInfo(city, bx, by + 1);
  assert.ok(blockedInfo);
  assert.equal(blockedInfo.canConvert, false);
  assert.ok(
    blockedInfo.reason?.includes('Avenida Larga'),
    `Expected Avenida Larga requirement reason, got: ${blockedInfo.reason}`
  );

  // Widen the avenue along y = aveY into a 2-tile-thick Avenida Larga 2×2 (rows aveY & aveY+1)!
  const widened = widenAvenueCorridorAt(city, bx, aveY, 5);
  assert.ok(widened >= 4, `Expected widenAvenueCorridorAt to form a 2×2 Wide Avenue corridor, got ${widened}`);

  // Reconcile road hierarchy must preserve the 2×2 Wide Avenue tiles as level 2, variant 2
  reconcileRoadHierarchy(city);
  recomputeFieldsAndStats(city);
  assert.equal(isWideAvenue2x2Tile(city, bx, aveY), true);
  assert.equal(getRoadClassLabel(2, 2), 'Avenida Larga 2×2 (Boulevard)');
  assert.ok(city.stats.wideAvenueTileCount >= 8, `Expected >= 8 wide avenue tiles, got ${city.stats.wideAvenueTileCount}`);

  // Now the 2×2 block borders a 2×2 Wide Avenue on its south side -> Lv. 4 Mega Condomínio conversion succeeds!
  assert.equal(isAdjacentToWideAvenue2x2(city, bx, by, 2, 2), true);
  const allowedInfo = getCondoConversionInfo(city, bx, by + 1);
  assert.ok(allowedInfo);
  assert.equal(allowedInfo.canConvert, true, `Expected Lv. 4 condo allowed next to 2×2 wide avenue, got reason: ${allowedInfo.reason}`);
});

test('Bus (4k) and Metro (14k) Public Transit unlock via Milestones, spawn buses only after built, track ridership, and round-trip save/load', async () => {
  const {
    deserializeCitySave,
    evaluateCivicMilestones,
    getMetroNetworkStations,
    serializeCitySave,
  } = await import('./cityEngine');
  const city = createNewCity(993344);

  // Before reaching 4,000 pop, both Bus & Metro projects are locked and NO municipal buses spawn
  city.money = 10_000_000;
  assert.equal(executeEmergencyAction(city, 'bus_transit_project').ok, false);
  assert.equal(executeEmergencyAction(city, 'metro_transit_project').ok, false);

  const preBusCars: CarEntity[] = [];
  const particles = createParticlePool();
  for (let i = 0; i < 40; i++) {
    updateCarsAndParticles(city, preBusCars, particles, { idx: 0 }, 0.05, 1, i * 0.05);
  }
  assert.equal(
    preBusCars.filter((c) => c.kind === 'bus').length,
    0,
    'Municipal buses must NOT spawn before the Bus Transit System is built'
  );

  // Grow city past 15,000 pop so both Bus (4k) and Metro (14k) milestones unlock
  const grassSlots = city.tiles.filter((t) => t.type === 'grass' || t.type === 'forest');
  for (let i = 0; i < grassSlots.length && city.totalPopulation < 15_500; i++) {
    grassSlots[i].type = 'residential';
    grassSlots[i].level = 3;
    recomputeFieldsAndStats(city);
  }
  const unlockedIds = evaluateCivicMilestones(city);
  assert.ok(unlockedIds.includes('civic_bus_system'), 'Expected Bus milestone at >= 4,000 pop');
  assert.ok(unlockedIds.includes('civic_metro_system'), 'Expected Metro milestone at >= 14,000 pop');

  // Execute Bus Transit Project -> enters construction first, delivers >= 2 bus_station hubs & bus fleet only on completion!
  const busRes = executeEmergencyAction(city, 'bus_transit_project');
  assert.equal(busRes.ok, true, `Expected bus_transit_project to succeed: ${busRes.reason ?? ''}`);
  recomputeFieldsAndStats(city);
  assert.equal(city.stats.busStationCount, 0, 'Bus stations must NOT become operational while still under construction');
  while (city.pendingWorks.some((w) => w.actionId === 'bus_transit_project')) {
    closeFinancialMonth(city);
  }
  recomputeFieldsAndStats(city);
  assert.ok(city.stats.busStationCount >= 2, `Expected >= 2 bus stations after completion, got ${city.stats.busStationCount}`);
  assert.ok(city.stats.monthlyTransitRiders > 0, 'Expected Bus system to generate monthly transit riders');
  assert.ok(city.stats.transitCoveragePct > 0, 'Expected positive transit coverage percentage');

  const postBusCars: CarEntity[] = [];
  for (let i = 0; i < 35; i++) {
    updateCarsAndParticles(city, postBusCars, particles, { idx: 0 }, 0.05, 1, i * 0.05);
  }
  assert.ok(
    postBusCars.some((c) => c.kind === 'bus'),
    'Municipal bus fleet should actively spawn once Bus Terminals are constructed'
  );

  // Execute Metro Transit Project -> enters construction, then places >= 2 underground-linked metro_station hubs upon completion!
  const ridersBeforeMetro = city.stats.monthlyTransitRiders;
  const metroRes = runEmergencyWorkToCompletion(city, 'metro_transit_project');
  assert.equal(metroRes.ok, true, `Expected metro_transit_project to succeed: ${metroRes.reason ?? ''}`);
  recomputeFieldsAndStats(city);
  assert.ok(city.stats.metroStationCount >= 2, `Expected >= 2 metro stations, got ${city.stats.metroStationCount}`);
  assert.ok(
    getMetroNetworkStations(city).length >= 2,
    'Expected Metro network helper to return >= 2 connected stations for underground line rendering'
  );
  assert.ok(
    city.stats.monthlyTransitRiders > ridersBeforeMetro,
    'Metro network should significantly boost monthly transit ridership'
  );

  // Round-trip save/load must preserve bus_station, metro_station, and transit stats
  const saved = serializeCitySave(city);
  const restored = deserializeCitySave(saved);
  assert.ok(restored);
  assert.equal(restored.stats.busStationCount, city.stats.busStationCount);
  assert.equal(restored.stats.metroStationCount, city.stats.metroStationCount);
  assert.equal(restored.stats.monthlyTransitRiders, city.stats.monthlyTransitRiders);
});

test('first Airport is 4x10 (40 tiles), houses require a filled 12x12 Level-1 region before evolving one-by-one, and Large Buildings (10k) & Skyscrapers (30k) obey population milestones', async () => {
  const {
    getCondoConversionInfo,
    getNeighborhoodMaturity,
    getZoneDisplayLabel,
    placeLandmarkOnBestSlot,
    setCityBudgetTargetPct,
    setCondoPolicy,
    widenAvenueCorridorAt,
  } = await import('./cityEngine');
  const { GROWTH_CONFIG, URBAN_MATURITY_CONFIG } = await import('./simulationConfig');

  // 1. Verify Level 1 Airport footprint is strictly 4×10 (40 tiles)
  const airportCity = createNewCity(314159, 'easy');
  const firstAirport = placeLandmarkOnBestSlot(airportCity, 'airport', true, 1);
  assert.ok(firstAirport, 'Expected 4×10 Level 1 Airport placement to succeed');
  const airportTiles = airportCity.tiles.filter((t) => t.type === 'airport');
  assert.equal(airportTiles.length, 40, `Expected 4×10 (40 tiles) airport, got ${airportTiles.length}`);
  assert.equal(firstAirport.lotWidth, 4);
  assert.equal(firstAirport.lotHeight, 10);
  assert.ok(getZoneDisplayLabel(firstAirport).includes('4×10'));

  // 2. Build a clean grid with a central house at (18, 18) and test the 12×12 Level-1 region rule!
  const city = createNewCity(271828, 'easy');
  setCondoPolicy(city, 'auto');
  city.money = 2_000_000;
  for (const area of BUDGET_AREA_ORDER) {
    setCityBudgetTargetPct(city, area, 100);
  }
  for (let y = 0; y < city.gridHeight; y++) {
    for (let x = 0; x < city.gridWidth; x++) {
      const t = getTile(city, x, y)!;
      t.type = 'grass';
      t.level = 0;
      t.age = 0;
      t.lotRole = undefined;
      t.lotWidth = undefined;
      t.lotHeight = undefined;
      t.lotDx = undefined;
      t.lotDy = undefined;
      t.establishmentId = undefined;
    }
  }
  const ox = city.roadOriginX ?? 17;
  const oy = city.roadOriginY ?? 17;
  // Lay a clean 3-tile grid of roads across the central 12×12 neighborhood
  for (let y = oy - 6; y <= oy + 6; y++) {
    for (let x = ox - 6; x <= ox + 6; x++) {
      const t = getTile(city, x, y)!;
      if ((((x - ox) % 3) + 3) % 3 === 0 || (((y - oy) % 3) + 3) % 3 === 0) {
        t.type = 'road';
        t.level = 2;
      }
    }
  }
  const centerHouse = getTile(city, ox + 1, oy + 1)!;
  // Fill ~75% of the 12×12 region (< 85% threshold) -> must still block Lv. 1 -> Lv. 2 evolution!
  let leftEmptyCount = 0;
  const skippedLots: Array<{ x: number; y: number }> = [];
  for (let dy = -6; dy <= 5; dy++) {
    for (let dx = -6; dx <= 5; dx++) {
      const nt = getTile(city, centerHouse.x + dx, centerHouse.y + dy);
      if (!nt || nt.type === 'road') continue;
      if (dx >= 0 && dy >= 0 && !(dx === 0 && dy === 0)) {
        skippedLots.push({ x: nt.x, y: nt.y });
        leftEmptyCount++;
        continue;
      }
      nt.type = 'residential';
      nt.level = 1;
      nt.age = GROWTH_CONFIG.minAgeForUpgrade + 25;
      nt.upgradeCooldown = 0;
      nt.evolutionProgress = GROWTH_CONFIG.requiredProgressLv2 + 10;
    }
  }
  recomputeFieldsAndStats(city);

  const sparse12x12 = getNeighborhoodMaturity(city, centerHouse.x, centerHouse.y);
  assert.ok(leftEmptyCount > 10);
  assert.ok(
    sparse12x12.region12FillRatio < URBAN_MATURITY_CONFIG.region12MinFillRatio,
    `Expected < 85% occupancy, got ${(sparse12x12.region12FillRatio * 100).toFixed(1)}%`
  );
  assert.equal(sparse12x12.region12AllLevel1, false, '12×12 region below 85% must NOT unlock Lv. 2');

  stepCityTick(city);
  assert.equal(centerHouse.level, 1, 'House must NOT evolve to Lv. 2 while 12×12 region is below 85% occupancy');

  // Fill all except 1 isolated empty lot inside the 12×12 region (>= 85% occupancy) -> MUST unlock evolution!
  for (let idx = 1; idx < skippedLots.length; idx++) {
    const gap = getTile(city, skippedLots[idx].x, skippedLots[idx].y)!;
    gap.type = 'residential';
    gap.level = 1;
    gap.age = GROWTH_CONFIG.minAgeForUpgrade + 15;
    gap.upgradeCooldown = 0;
    gap.evolutionProgress = GROWTH_CONFIG.requiredProgressLv2 + 10;
  }
  recomputeFieldsAndStats(city);

  const almostFull = getNeighborhoodMaturity(city, centerHouse.x, centerHouse.y);
  assert.equal(almostFull.region12EmptyLots, 1, 'Expected 1 isolated empty lot remaining inside the 12×12 region');
  assert.ok(almostFull.region12FillRatio >= URBAN_MATURITY_CONFIG.region12MinFillRatio);
  assert.equal(almostFull.region12AllLevel1, true, '12×12 region >= 85% occupied should unlock Lv. 2 despite 1 isolated empty lot');

  // Step ticks: buildings evolve gradually to Lv. 2,
  // and MUST NOT jump to Lv. 3 while city population is below the 10,000 milestone!
  let prevLv2Count = 0;
  for (let s = 0; s < 18; s++) {
    stepCityTick(city);
    const curLv2 = city.tiles.filter(
      (t) => t.type === 'residential' && t.lotRole !== 'part' && t.level === 2
    ).length;
    prevLv2Count = curLv2;
  }
  assert.ok(prevLv2Count >= 1, 'Expected gradual Lv. 1 -> Lv. 2 evolutions once 12×12 region reaches >= 85%');

  // 3. Verify 10,000 hab. milestone gate for Lv. 3 Large Buildings & 30,000 hab. milestone gate for Lv. 4 Skyscrapers!
  assert.ok(city.totalPopulation < URBAN_MATURITY_CONFIG.largeBuildingMinPopulation);
  centerHouse.level = 2;
  centerHouse.age = GROWTH_CONFIG.minAgeForUpgradeLv3 + 30;
  centerHouse.upgradeCooldown = 0;
  centerHouse.evolutionProgress = GROWTH_CONFIG.requiredProgressLv3 + 20;
  for (let s = 0; s < 8; s++) {
    stepCityTick(city);
  }
  assert.equal(
    centerHouse.level,
    2,
    `Large Building (Lv. 3) must remain locked below ${URBAN_MATURITY_CONFIG.largeBuildingMinPopulation} pop`
  );

  // Check Lv. 4 Skyscraper / Mega Condomínio is strictly locked below 30,000 hab. even next to a 2×2 Wide Avenue!
  const aveY = oy + 3;
  widenAvenueCorridorAt(city, ox + 1, aveY, 4);
  centerHouse.type = 'residential';
  centerHouse.establishmentId = undefined;
  centerHouse.lotRole = undefined;
  centerHouse.lotWidth = 1;
  centerHouse.lotHeight = 1;
  centerHouse.level = 3;
  recomputeFieldsAndStats(city);
  assert.ok(city.totalPopulation < URBAN_MATURITY_CONFIG.skyscraperMinPopulation);
  const blockedLv4 = getCondoConversionInfo(city, centerHouse.x, centerHouse.y);
  assert.ok(blockedLv4);
  assert.equal(blockedLv4.eligible, false, 'Lv. 4 Skyscraper / Mega Condomínio must be locked below 30,000 pop');
  assert.ok(blockedLv4.reason?.includes('30.000'), `Expected 30.000 hab. requirement, got: ${blockedLv4.reason}`);
});

test('3 Shopping Mall designs unlock by population milestones (5x5 Small at 7.5k, 7x7 Medium at 16k, 9x9 Large at 26k) and track multi-month work execution progress', async () => {
  const {
    closeFinancialMonth,
    evaluateCivicMilestones,
    getCivicMilestoneStatuses,
    getZoneDisplayLabel,
  } = await import('./cityEngine');

  const city = createNewCity(424242, 'easy');
  city.money = 10_000_000;

  const grassSlots = city.tiles.filter((t) => t.type === 'grass' || t.type === 'forest');
  let slotIdx = 0;
  const raisePopTo = (target: number) => {
    while (city.totalPopulation < target && slotIdx < grassSlots.length) {
      grassSlots[slotIdx].type = 'residential';
      grassSlots[slotIdx].level = 3;
      slotIdx++;
      recomputeFieldsAndStats(city);
    }
    evaluateCivicMilestones(city);
  };

  // Below 7,500 pop: Shopping Pequeno (5×5) is locked
  assert.ok(city.totalPopulation < 7500);
  const lockedOffer = getEmergencyOffers(city).find((o) => o.id === 'shopping_evolution')!;
  assert.ok(lockedOffer);
  assert.equal(lockedOffer.unlocked, false);
  assert.equal(executeEmergencyAction(city, 'shopping_evolution').ok, false);

  // 1. Reach 7,500 pop -> Shopping Pequeno (5×5 · 25 tiles · Nv. 1) unlocks & starts 3-month execution progress!
  raisePopTo(7500);
  const lv1Offer = getEmergencyOffers(city).find((o) => o.id === 'shopping_evolution')!;
  assert.equal(lv1Offer.unlocked, true);
  assert.equal(lv1Offer.durationMonths, 3);

  const resLv1 = executeEmergencyAction(city, 'shopping_evolution');
  assert.equal(resLv1.ok, true);
  // Immediately after starting: reserved construction site is placed (5x5), Shopping is NOT operational yet!
  assert.equal(city.stats.shoppingCount, 0, 'Shopping must NOT be operational during construction');
  assert.equal(
    city.tiles.filter((t) => t.construction?.targetType === 'shopping').length,
    25,
    'Shopping Pequeno (5×5) must reserve 25 map tiles as an active construction site'
  );
  const inProgressOffer = getEmergencyOffers(city).find((o) => o.id === 'shopping_evolution')!;
  assert.equal(inProgressOffer.inProgress, true);
  assert.equal(inProgressOffer.remainingMonths, 3);
  assert.equal(inProgressOffer.totalMonths, 3);
  assert.equal(
    executeEmergencyAction(city, 'shopping_evolution').ok,
    false,
    'Duplicate purchase must be blocked while work is in progress'
  );

  // Pending work tracks remainingMonths & totalMonths for the progress bar button across months
  const workLv1 = city.pendingWorks.find((w) => w.actionId === 'shopping_evolution')!;
  assert.ok(workLv1, 'Expected pendingWork for shopping_evolution while work is executing');
  assert.equal(workLv1.totalMonths, 3);
  assert.equal(workLv1.remainingMonths, 3);
  closeFinancialMonth(city);
  assert.equal(
    city.pendingWorks.find((w) => w.actionId === 'shopping_evolution')?.remainingMonths,
    2
  );
  assert.equal(city.stats.shoppingCount, 0, 'Shopping must stay in construction on month 1/3');
  closeFinancialMonth(city);
  closeFinancialMonth(city);
  assert.equal(
    city.pendingWorks.find((w) => w.actionId === 'shopping_evolution'),
    undefined,
    'Expected pendingWork to complete and clear after 3 months'
  );

  const lv1Tiles = city.tiles.filter((t) => t.type === 'shopping');
  assert.equal(lv1Tiles.length, 25, 'Shopping Pequeno (Nv. 1) must be 5×5 (25 tiles)');
  assert.equal(city.stats.shoppingCount, 1);
  assert.equal(city.stats.shoppingLevel, 1);
  assert.equal(lv1Tiles.every((t) => !t.construction), true);
  const anchorLv1 = lv1Tiles.find((t) => t.lotRole === 'anchor')!;
  assert.equal(anchorLv1.lotWidth, 5);
  assert.equal(anchorLv1.lotHeight, 5);
  assert.ok(getZoneDisplayLabel(anchorLv1).includes('5×5'));

  // 2. Below 16,000 pop -> Shopping Médio (7×7 · Nv. 2) is locked; at 16,000 pop it expands to 7×7 (49 tiles) on completion!
  assert.equal(executeEmergencyAction(city, 'shopping_evolution').ok, false);
  raisePopTo(16000);
  city.money = 10_000_000;
  const resLv2 = runEmergencyWorkToCompletion(city, 'shopping_evolution');
  assert.equal(resLv2.ok, true);
  const lv2Tiles = city.tiles.filter((t) => t.type === 'shopping');
  assert.equal(lv2Tiles.length, 49, 'Shopping Médio (Nv. 2) must expand to 7×7 (49 tiles)');
  assert.equal(city.stats.shoppingLevel, 2);
  const anchorLv2 = lv2Tiles.find((t) => t.lotRole === 'anchor')!;
  assert.equal(anchorLv2.lotWidth, 7);
  assert.equal(anchorLv2.lotHeight, 7);
  assert.ok(getZoneDisplayLabel(anchorLv2).includes('7×7'));

  // 3. At 26,000 pop -> Shopping Grande (9×9 · 81 tiles · Nv. 3) unlocks & expands to 9×9 on completion!
  assert.equal(executeEmergencyAction(city, 'shopping_evolution').ok, false);
  raisePopTo(26000);
  city.money = 10_000_000;
  const resLv3 = runEmergencyWorkToCompletion(city, 'shopping_evolution');
  assert.equal(resLv3.ok, true);
  const lv3Tiles = city.tiles.filter((t) => t.type === 'shopping');
  assert.equal(lv3Tiles.length, 81, 'Shopping Grande (Nv. 3) must expand to 9×9 (81 tiles)');
  assert.equal(city.stats.shoppingLevel, 3);
  const anchorLv3 = lv3Tiles.find((t) => t.lotRole === 'anchor')!;
  assert.equal(anchorLv3.lotWidth, 9);
  assert.equal(anchorLv3.lotHeight, 9);
  assert.ok(getZoneDisplayLabel(anchorLv3).includes('9×9'));

  const milestoneById = Object.fromEntries(
    getCivicMilestoneStatuses(city).map((m) => [m.id, m])
  );
  assert.equal(milestoneById.civic_shopping_lv1.built, true);
  assert.equal(milestoneById.civic_shopping_lv2.built, true);
  assert.equal(milestoneById.civic_shopping_lv3.built, true);
});

test('segment investment tiers (<100%, 100%, 150%, 200%) produce real bounded bonuses and transparent trade-offs', () => {
  // 1. Curve monotonicity and clear bounds
  const c75 = getSegmentEffectCurve(75);
  const c100 = getSegmentEffectCurve(100);
  const c150 = getSegmentEffectCurve(150);
  const c200 = getSegmentEffectCurve(200);
  assert.equal(c75.band, 'deficit');
  assert.ok(c75.effectiveFactor < 0.8);
  assert.equal(c100.effectiveFactor, 1.0);
  assert.equal(c150.band, 'over150');
  assert.ok(c150.effectiveFactor > 1.12 && c150.effectiveFactor < 1.2);
  assert.equal(c200.band, 'over200');
  assert.ok(c200.effectiveFactor > c150.effectiveFactor && c200.effectiveFactor <= 1.28);

  // 2. Infraestrutura + baixa Saúde & Meio Ambiente elevates local pollution
  const city = createNewCity(515151, 'medium');
  for (const k of BUDGET_AREA_ORDER) setCityBudgetTargetPct(city, k, 100);
  const polAt100Health = city.stats.avgPollution;
  setCityBudgetTargetPct(city, 'infrastructure', 150);
  setCityBudgetTargetPct(city, 'wellbeing', 25);
  const polAtLowHealth = city.stats.avgPollution;
  assert.ok(
    polAtLowHealth > polAt100Health,
    `Low Saúde & Meio Ambiente with high Infraestrutura must increase pollution (${polAt100Health} -> ${polAtLowHealth})`
  );

  // 3. Educação boosts residential tax base while lowering tolerance for high taxes
  for (const k of BUDGET_AREA_ORDER) setCityBudgetTargetPct(city, k, 100);
  const fair100 = city.financials.fairTaxRate;
  const resTax100 = city.financials.revenue.residentialTax;
  setCityBudgetTargetPct(city, 'education', 200);
  assert.ok(
    city.financials.fairTaxRate < fair100,
    `High Educação must lower fair tax tolerance (${fair100} -> ${city.financials.fairTaxRate})`
  );
  assert.ok(
    city.financials.revenue.residentialTax > resTax100,
    `High Educação must strengthen residential tax base (${resTax100} -> ${city.financials.revenue.residentialTax})`
  );

  // 4. Segurança cannot compensate alone for low Cultura & Lazer / Educação
  setTaxRate(city, 'residential', 13);
  setCityBudgetTargetPct(city, 'education', 30);
  setCityBudgetTargetPct(city, 'entertainment', 30);
  setCityBudgetTargetPct(city, 'security', 100);
  const happySec100LowVit = city.globalHappiness;
  setCityBudgetTargetPct(city, 'security', 200);
  const gainLowVit = city.globalHappiness - happySec100LowVit;

  setCityBudgetTargetPct(city, 'education', 100);
  setCityBudgetTargetPct(city, 'entertainment', 100);
  setCityBudgetTargetPct(city, 'security', 100);
  const happySec100HighVit = city.globalHappiness;
  setCityBudgetTargetPct(city, 'security', 200);
  const gainHighVit = city.globalHappiness - happySec100HighVit;
  assert.ok(
    gainLowVit === 0 && gainHighVit > gainLowVit,
    `Security bonus should be contained when Cultura/Educação are low (lowVitGain=${gainLowVit}, highVitGain=${gainHighVit})`
  );
  setTaxRate(city, 'residential', 9);

  // 5. Turismo & Comércio scales up cleanly at 150%/200%, penalized by low Segurança, with modest upkeep cost
  for (const k of BUDGET_AREA_ORDER) setCityBudgetTargetPct(city, k, 100);
  const tour100 = city.financials.revenue.tourismIncome;
  const roadUpkeep100 = city.financials.expenses.fixedRoadsAndBridges;
  setCityBudgetTargetPct(city, 'tourism', 150);
  const tour150 = city.financials.revenue.tourismIncome;
  setCityBudgetTargetPct(city, 'tourism', 200);
  const tour200 = city.financials.revenue.tourismIncome;
  const roadUpkeep200 = city.financials.expenses.fixedRoadsAndBridges;
  assert.ok(tour100 < tour150 && tour150 < tour200, `Expected tourism 100% (${tour100}) < 150% (${tour150}) < 200% (${tour200})`);
  assert.ok(roadUpkeep200 > roadUpkeep100, `Expected high Turismo & Comércio to add modest traffic upkeep (${roadUpkeep100} -> ${roadUpkeep200})`);

  setCityBudgetTargetPct(city, 'security', 40);
  const tourLowSec = city.financials.revenue.tourismIncome;
  assert.ok(
    tourLowSec < tour200 * 0.88,
    `Low Segurança must penalize Turismo & Comércio revenue (${tour200} -> ${tourLowSec})`
  );
});

test('large cities scale upgrades-per-tick beyond 1 so urban evolution is not bottlenecked', () => {
  assert.equal(getScaledMaxUpgradesPerTick(2000, 36, 36), 1);
  assert.equal(getScaledMaxUpgradesPerTick(12000, 36, 36), 2);
  assert.equal(getScaledMaxUpgradesPerTick(25000, 36, 36), 4);
  assert.equal(getScaledMaxUpgradesPerTick(35000, 52, 52), 5);

  const city = createNewCity(616161, 'easy');
  city.money = 500_000;
  for (const k of BUDGET_AREA_ORDER) setCityBudgetTargetPct(city, k, 100);

  // Build >20,000 population in outer tiles so city crosses the 20k threshold
  const ox = city.roadOriginX ?? 17;
  const oy = city.roadOriginY ?? 17;
  for (let i = 0; i < city.tiles.length; i++) {
    const t = city.tiles[i];
    if (t.type === 'water') t.type = 'grass';
    if (t.type !== 'road') {
      t.type = 'grass';
      t.level = 0;
      t.lotRole = undefined;
      t.lotWidth = undefined;
      t.lotHeight = undefined;
      t.establishmentId = undefined;
    }
  }
  for (let y = oy - 6; y <= oy + 6; y++) {
    for (let x = ox - 6; x <= ox + 6; x++) {
      const t = getTile(city, x, y)!;
      if ((((x - ox) % 3) + 3) % 3 === 0 || (((y - oy) % 3) + 3) % 3 === 0) {
        t.type = 'road';
        t.level = 2;
      } else {
        t.type = 'residential';
        t.level = 1;
        t.age = GROWTH_CONFIG.minAgeForUpgrade + 30;
        t.upgradeCooldown = 0;
        t.evolutionProgress = GROWTH_CONFIG.requiredProgressLv2 + 20;
      }
    }
  }
  // Place Lv.3 residential towers outside the 12×12 core to push population > 20,000
  for (const t of city.tiles) {
    if (t.type === 'grass' && Math.hypot(t.x - ox, t.y - oy) > 8) {
      t.type = 'residential';
      t.level = 3;
      t.age = 0;
      t.upgradeCooldown = 40;
      if (city.tiles.filter((x) => x.type === 'residential' && x.level === 3).length >= 90) break;
    }
  }
  recomputeFieldsAndStats(city);
  assert.ok(city.totalPopulation > 20000, `Expected >20k pop, got ${city.totalPopulation}`);

  let maxSingleTickLv2Jump = 0;
  let prevLv2 = 0;
  for (let s = 0; s < 10; s++) {
    stepCityTick(city);
    const curLv2 = city.tiles.filter((t) => t.type === 'residential' && t.lotRole !== 'part' && t.level === 2).length;
    maxSingleTickLv2Jump = Math.max(maxSingleTickLv2Jump, curLv2 - prevLv2);
    prevLv2 = curLv2;
  }
  assert.ok(
    maxSingleTickLv2Jump >= 2 && maxSingleTickLv2Jump <= 4,
    `Expected >20k city to allow 2..4 building upgrades in a tick (not stuck at 1), got max jump ${maxSingleTickLv2Jump}`
  );
});

test('commercial Lv.4 pollution, SHOPPING_COMMERCIAL_REVENUE_PER_LEVEL, avgPol second-pass convergence, and largeFootprintMaintenanceFactor behave consistently', () => {
  const city = createNewCity(778899);
  for (const k of BUDGET_AREA_ORDER) setCityBudgetTargetPct(city, k, 100);

  // Clear all tiles to grass for isolated controlled checks
  for (const t of city.tiles) {
    t.type = 'grass';
    t.level = 0;
    t.lotRole = 'single';
    t.lotWidth = 1;
    t.lotHeight = 1;
    t.establishmentId = undefined;
  }

  // 1) Commercial Lv.3 and Lv.4 emit advanced commercial pollution
  const com3 = getTile(city, 10, 10)!;
  com3.type = 'commercial';
  com3.level = 3;
  const com4 = getTile(city, 20, 20)!;
  com4.type = 'commercial';
  com4.level = 4;
  recomputeFieldsAndStats(city);
  assert.ok(POLLUTION_EMISSION.commercialLv3 > 0);
  assert.ok(com3.pollution > 0, `Expected Commercial Lv.3 to emit pollution, got ${com3.pollution}`);
  assert.ok(com4.pollution > 0, `Expected Commercial Lv.4 to emit pollution, got ${com4.pollution}`);
  assert.equal(com4.pollution, com3.pollution, 'Commercial Lv.4 tile should emit commercialLv3 pollution');

  // 2) SHOPPING_COMMERCIAL_REVENUE_PER_LEVEL drives Shopping commercial tax base
  const comTaxBeforeShopping = city.financials.revenue.commercialTax;
  const shop = getTile(city, 14, 14)!;
  shop.type = 'shopping';
  shop.level = 2;
  shop.lotRole = 'anchor';
  recomputeFieldsAndStats(city);
  const comTaxWithShopping = city.financials.revenue.commercialTax;
  assert.ok(
    SHOPPING_COMMERCIAL_REVENUE_PER_LEVEL === 1150 && comTaxWithShopping > comTaxBeforeShopping + 1800,
    `Expected Lv.2 Shopping to add commercial revenue via SHOPPING_COMMERCIAL_REVENUE_PER_LEVEL (${comTaxBeforeShopping} -> ${comTaxWithShopping})`
  );

  // 3) Second-pass avgPol consistency: fix wellbeing $ amount, inject industrial pollution, and verify single recompute converges
  setCityBudget(city, 'wellbeing', 450);
  for (let x = 24; x <= 29; x++) {
    const ind = getTile(city, x, 24)!;
    ind.type = 'industrial';
    ind.level = 2;
  }
  const houseNear = getTile(city, 24, 22)!;
  houseNear.type = 'residential';
  houseNear.level = 2;

  recomputeFieldsAndStats(city, 'wellbeing');
  const firstAvgPol = city.stats.avgPollution;
  const firstWellCov = city.stats.coverage.wellbeing.coveragePct;
  const firstWellNeeded = city.stats.coverage.wellbeing.needed;
  const firstHouseLandVal = houseNear.landValue;

  recomputeFieldsAndStats(city, 'wellbeing');
  assert.equal(city.stats.avgPollution, firstAvgPol, 'avgPollution must converge in a single pass');
  assert.equal(city.stats.coverage.wellbeing.coveragePct, firstWellCov, 'wellbeing coveragePct must converge in a single pass');
  assert.equal(city.stats.coverage.wellbeing.needed, firstWellNeeded, 'wellbeing needed must converge in a single pass');
  assert.equal(houseNear.landValue, firstHouseLandVal, 'landValue must use consistent same-cycle avgPol & wellbeing');

  // 4) largeFootprintMaintenanceFactor discounts extra tiles of multi-tile buildings vs 4 separate 1x1 tiles
  const singleCity = createNewCity(778899);
  const multiCity = createNewCity(778899);
  for (const c of [singleCity, multiCity]) {
    for (const t of c.tiles) {
      t.type = 'grass';
      t.level = 0;
      t.lotRole = 'single';
      t.lotWidth = 1;
      t.lotHeight = 1;
      t.establishmentId = undefined;
    }
  }
  for (const [dx, dy] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ] as const) {
    const ts = getTile(singleCity, 10 + dx, 10 + dy)!;
    ts.type = 'residential';
    ts.level = 1;
    ts.lotRole = 'single';

    const tm = getTile(multiCity, 10 + dx, 10 + dy)!;
    tm.type = 'residential';
    tm.level = 1;
    tm.lotRole = dx === 0 && dy === 0 ? 'anchor' : 'part';
    tm.lotWidth = 2;
    tm.lotHeight = 2;
  }
  recomputeFieldsAndStats(singleCity);
  recomputeFieldsAndStats(multiCity);
  const singleFixed = singleCity.financials.expenses.fixedCityHall;
  const multiFixed = multiCity.financials.expenses.fixedCityHall;
  assert.ok(FIXED_COSTS_CONFIG.largeFootprintMaintenanceFactor < 1);
  assert.ok(
    multiFixed < singleFixed,
    `Expected 2x2 multi-tile lot fixed maintenance ($${multiFixed}) < 4 separate 1x1 lots ($${singleFixed})`
  );
  const expectedDiff = Math.round(
    3 * (1 - FIXED_COSTS_CONFIG.largeFootprintMaintenanceFactor) * FIXED_COSTS_CONFIG.perBuilding
  );
  assert.ok(
    Math.abs(singleFixed - multiFixed - expectedDiff) <= 1,
    `Expected maintenance discount ~${expectedDiff}, got ${singleFixed - multiFixed}`
  );
});

test('civic_stadium_20k and civic_toll_20k track built status independently and migrate legacy civic_stadium_toll_20k saves', async () => {
  const { evaluateCivicMilestones, getCivicMilestoneStatuses } = await import('./cityEngine');
  const city = createNewCity(889900);
  city.money = 1_000_000;

  // Push pop >= 20,000
  for (const t of city.tiles) {
    if (t.type === 'grass') {
      t.type = 'residential';
      t.level = 3;
      if (city.tiles.filter((x) => x.type === 'residential' && x.level === 3).length >= 130) break;
    }
  }
  recomputeFieldsAndStats(city);
  evaluateCivicMilestones(city);

  // Build ONLY Stadium first -> civic_stadium_20k built=true, civic_toll_20k built=false
  assert.equal(runEmergencyWorkToCompletion(city, 'landmark_project').ok, true);
  recomputeFieldsAndStats(city);
  let statuses = Object.fromEntries(getCivicMilestoneStatuses(city).map((s) => [s.id, s]));
  assert.equal(statuses.civic_stadium_20k.unlocked, true);
  assert.equal(statuses.civic_stadium_20k.built, true);
  assert.equal(statuses.civic_toll_20k.unlocked, true);
  assert.equal(statuses.civic_toll_20k.built, false, 'Building Stadium must NOT mark Toll Plaza milestone as built');

  // Now build Toll Plaza -> civic_toll_20k built=true
  assert.equal(executeEmergencyAction(city, 'toll_plaza_project').ok, true);
  recomputeFieldsAndStats(city);
  statuses = Object.fromEntries(getCivicMilestoneStatuses(city).map((s) => [s.id, s]));
  assert.equal(statuses.civic_toll_20k.built, true);

  // Legacy save with only civic_stadium_toll_20k=true migrates cleanly without double cash grant
  const legacyCity = createNewCity(889901);
  for (const t of legacyCity.tiles) {
    if (t.type === 'grass') {
      t.type = 'residential';
      t.level = 3;
      if (legacyCity.tiles.filter((x) => x.type === 'residential' && x.level === 3).length >= 130) break;
    }
  }
  legacyCity.milestonesReached = { civic_stadium_toll_20k: true };
  recomputeFieldsAndStats(legacyCity);
  const rawSave = JSON.parse(serializeCitySave(legacyCity));
  rawSave.milestonesReached = { civic_stadium_toll_20k: true };
  const restored = deserializeCitySave(JSON.stringify(rawSave))!;
  assert.ok(restored);
  assert.equal(restored.milestonesReached.civic_stadium_20k, true);
  assert.equal(restored.milestonesReached.civic_toll_20k, true);
  const moneyBeforeEval = restored.money;
  const newlyTriggered = evaluateCivicMilestones(restored);
  assert.ok(!newlyTriggered.includes('civic_stadium_20k'));
  assert.ok(!newlyTriggered.includes('civic_toll_20k'));
  assert.ok(restored.money >= moneyBeforeEval);
});

test('multi-month EMERGENCY_LINES works reserve map sites, block demolition/duplicate purchase, defer operational effects until completion, and preserve legacy saves', async () => {
  const { evaluateCivicMilestones } = await import('./cityEngine');
  const city = createNewCity(112233, 'easy');
  city.money = 10_000_000;

  // Raise population above 5,500 so Port (1.2k), Sports Center (2k), Bus (4k), and Airport (5k) unlock
  for (const t of city.tiles) {
    if ((t.type === 'grass' || t.type === 'forest') && city.totalPopulation < 5600) {
      t.type = 'residential';
      t.level = 3;
      recomputeFieldsAndStats(city);
    }
  }
  evaluateCivicMilestones(city);

  // 1. Start Airport (3 months, 4x10 = 40 tiles) -> deducts cost immediately, reserves 40 construction tiles, defers airportCount & airplanes
  const moneyBefore = city.money;
  const airOffer = getEmergencyOffers(city).find((o) => o.id === 'airport_evolution')!;
  assert.equal(airOffer.durationMonths, 3);
  const airStart = executeEmergencyAction(city, 'airport_evolution');
  assert.equal(airStart.ok, true);
  assert.equal(city.money, moneyBefore - airOffer.cost);
  assert.equal(city.workTiers.airport_evolution, 1, 'Work tier must NOT advance before completion');
  assert.equal(city.stats.airportCount, 0, 'Airport count must remain 0 during construction');

  const reservedAirportTiles = city.tiles.filter((t) => t.construction?.actionId === 'airport_evolution');
  assert.equal(reservedAirportTiles.length, 40, 'Airport Nv.1 must reserve 4x10 (40) construction tiles');
  assert.equal(reservedAirportTiles.every((t) => t.construction?.remainingMonths === 3), true);

  // Demolishing a tile under public construction must be blocked
  const demoBlocked = demolishCityTile(city, reservedAirportTiles[0].x, reservedAirportTiles[0].y);
  assert.equal(demoBlocked.ok, false);

  // Duplicate purchase is blocked while work is in progress
  const airOfferBusy = getEmergencyOffers(city).find((o) => o.id === 'airport_evolution')!;
  assert.equal(airOfferBusy.inProgress, true);
  assert.equal(airOfferBusy.unlocked, false);
  assert.equal(executeEmergencyAction(city, 'airport_evolution').ok, false);

  // Also start Port (2 months) and Bus Transit (3 months)
  const portStart = executeEmergencyAction(city, 'port_evolution');
  const busStart = executeEmergencyAction(city, 'bus_transit_project');
  assert.equal(portStart.ok, true);
  assert.equal(busStart.ok, true);
  assert.equal(city.stats.portCount, 0, 'Port count must remain 0 during construction');
  assert.equal(city.financials.revenue.tradeIncome, 0, 'Port tradeIncome must remain 0 until completion');
  assert.equal(city.stats.busStationCount, 0, 'Bus count must remain 0 during construction');

  // No airplanes or port boats spawn yet before completion
  const boatsMid: BoatEntity[] = [];
  const planesMid: PlaneEntity[] = [];
  const particles = createParticlePool(32);
  updateBoatsAndPlanes(city, boatsMid, planesMid, particles, { idx: 0 }, 0.1, 1);
  assert.equal(planesMid.length, 0, 'Planes must NOT spawn while Airport is still under construction');

  // 2. Advance 1 month: Port (2m -> 1m), Airport (3m -> 2m), Bus Transit (3m -> 2m) still building
  closeFinancialMonth(city);
  assert.equal(city.pendingWorks.find((w) => w.actionId === 'airport_evolution')?.remainingMonths, 2);
  assert.equal(city.pendingWorks.find((w) => w.actionId === 'port_evolution')?.remainingMonths, 1);
  assert.equal(city.pendingWorks.find((w) => w.actionId === 'bus_transit_project')?.remainingMonths, 2);
  assert.equal(
    reservedAirportTiles.every((t) => t.construction?.remainingMonths === 2),
    true,
    'Tile construction remainingMonths must sync each month'
  );
  assert.equal(city.stats.airportCount, 0);
  assert.equal(city.stats.portCount, 0);

  // 3. Round-trip save/load mid-construction, then complete remaining months on restored state
  const midSave = serializeCitySave(city);
  const restored = deserializeCitySave(midSave)!;
  assert.ok(restored);
  assert.equal(restored.pendingWorks.length, 3);
  assert.equal(restored.tiles.filter((t) => t.construction?.actionId === 'airport_evolution').length, 40);

  // Month 2 completes Port (2m); Airport and Bus Transit remain at 1m
  closeFinancialMonth(restored);
  assert.equal(restored.stats.portCount, 1, 'Port should complete on month 2');
  assert.ok(restored.financials.revenue.tradeIncome > 0, 'Completed Port should generate tradeIncome');
  assert.equal(restored.workTiers.port_evolution, 2);
  assert.equal(restored.workTiers.bus_transit_project, 1);
  assert.equal(restored.stats.busStationCount, 0, 'Bus Transit must remain 0 until month 3 completion');
  assert.equal(restored.pendingWorks.find((w) => w.actionId === 'airport_evolution')?.remainingMonths, 1);
  assert.equal(restored.pendingWorks.find((w) => w.actionId === 'bus_transit_project')?.remainingMonths, 1);
  assert.equal(restored.stats.airportCount, 0);

  // Month 3 completes Airport (3m) and Bus Transit (3m): clears construction flags, spawns tiles/stations, advances workTiers, plays milestone sound
  restored.pendingSounds = [];
  closeFinancialMonth(restored);
  assert.equal(restored.pendingWorks.length, 0);
  assert.equal(restored.stats.airportCount, 1);
  assert.equal(restored.workTiers.bus_transit_project, 2);
  assert.ok(restored.stats.busStationCount >= 1, 'Bus Transit should deliver bus stations on month 3');
  assert.equal(restored.tiles.filter((t) => t.type === 'airport').length, 40);
  assert.equal(restored.tiles.some((t) => Boolean(t.construction)), false, 'All construction markers must clear on completion');
  assert.equal(restored.workTiers.airport_evolution, 2);
  assert.ok(restored.pendingSounds.some((s) => s.type === 'milestone'));

  const boatsDone: BoatEntity[] = [];
  const planesDone: PlaneEntity[] = [];
  updateBoatsAndPlanes(restored, boatsDone, planesDone, particles, { idx: 0 }, 0.1, 1);
  assert.ok(planesDone.length > 0, 'Planes should spawn once Airport completes');
  assert.ok(boatsDone.length > 0, 'Ships should spawn once Port completes');

  // 4. Legacy save compatibility (JSON lacking pendingWorks field)
  const rawLegacy = JSON.parse(serializeCitySave(createNewCity(554433)));
  delete rawLegacy.pendingWorks;
  const legacyLoaded = deserializeCitySave(JSON.stringify(rawLegacy));
  assert.ok(legacyLoaded);
  assert.deepEqual(legacyLoaded.pendingWorks, []);
});

test('campaigns (Mutirão Ambiental, Revitalização, Festival Turístico) are removed from manual purchase and run automatically from good budget investments', () => {
  const city = createNewCity(778899, 'medium');
  city.money = 120_000;
  recomputeFieldsAndStats(city);

  // 1. Campaigns must NOT be offered as purchasable actions
  const offerIds = getEmergencyOffers(city).map((o) => o.id);
  assert.equal(offerIds.includes('environmental_cleanup'), false);
  assert.equal(offerIds.includes('revitalization'), false);
  assert.equal(offerIds.includes('tourism_festival'), false);
  assert.equal(executeEmergencyAction(city, 'environmental_cleanup').ok, false);
  assert.equal(executeEmergencyAction(city, 'revitalization').ok, false);
  assert.equal(executeEmergencyAction(city, 'tourism_festival').ok, false);

  // 2. Under low investments (60%), closing a month does NOT activate automatic campaigns
  for (const area of BUDGET_AREA_ORDER) {
    setCityBudgetTargetPct(city, area, 60);
  }
  city.activeBoosts = [];
  closeFinancialMonth(city);
  assert.equal(
    city.activeBoosts.some(
      (b) =>
        b.actionId === 'environmental_cleanup' ||
        b.actionId === 'revitalization' ||
        b.actionId === 'tourism_festival'
    ),
    false,
    'Low budget investments (<100%) must not trigger automatic campaigns'
  );

  // 3. Create an abandoned building and fund all segments well (150%):
  //    closing a month automatically launches all 3 campaigns and recovers the abandoned lot
  const victim = city.tiles.find((t) => t.type === 'residential' && t.lotRole !== 'part')!;
  victim.previousType = 'residential';
  victim.type = 'abandoned';
  victim.level = 1;
  recomputeFieldsAndStats(city);
  assert.ok(city.stats.abandonedCount >= 1);

  for (const area of BUDGET_AREA_ORDER) {
    setCityBudgetTargetPct(city, area, 150);
  }
  recomputeFieldsAndStats(city);
  closeFinancialMonth(city);

  const envBoost = city.activeBoosts.find((b) => b.actionId === 'environmental_cleanup');
  const revitBoost = city.activeBoosts.find((b) => b.actionId === 'revitalization');
  const tourBoost = city.activeBoosts.find((b) => b.actionId === 'tourism_festival');
  assert.ok(envBoost && envBoost.tier >= 2, 'Good wellbeing + education investment triggers Mutirão Ambiental');
  assert.ok(revitBoost && revitBoost.tier >= 2, 'Good security + infrastructure investment triggers Revitalização');
  assert.ok(tourBoost && tourBoost.tier >= 2, 'Good tourism + entertainment investment triggers Festival Turístico');
  assert.equal(victim.type, 'residential', 'Automatic Revitalização must restore abandoned building');
});

test('available works and milestones are ordered by first necessity and 2x2 markets (municipal_market and 2x2 commercial lots) are supported', async () => {
  const { getZoneDisplayLabel } = await import('./cityEngine');
  const { ESTABLISHMENT_CATALOG, SHOPPING_FOOTPRINT_BY_LEVEL } = await import('./simulationConfig');

  // 1. Shopping footprints must be 5×5, 7×7, and 9×9
  assert.deepEqual(SHOPPING_FOOTPRINT_BY_LEVEL[1], { w: 5, h: 5 });
  assert.deepEqual(SHOPPING_FOOTPRINT_BY_LEVEL[2], { w: 7, h: 7 });
  assert.deepEqual(SHOPPING_FOOTPRINT_BY_LEVEL[3], { w: 9, h: 9 });

  // 2. Initial available works must be ordered strictly by first necessity (ascending minPopulation)
  const city = createNewCity(334455, 'easy');
  const initialOffers = getEmergencyOffers(city);
  assert.deepEqual(
    initialOffers.map((o) => o.id),
    [
      'port_evolution',          // 1,200 hab.
      'sports_center_project',   // 2,000 hab.
      'clean_energy_project',    // 3,200 hab.
      'bus_transit_project',     // 4,000 hab.
      'hospital_project',        // 4,800 hab.
      'airport_evolution',       // 5,000 hab.
      'tech_university_project', // 6,500 hab.
      'shopping_evolution',      // 7,500 hab.
      'amusement_park_project',  // 8,500 hab.
      'rail_freight_project',    // 9,500 hab.
      'metro_transit_project',   // 14,000 hab.
      'toll_plaza_project',      // 20,000 hab. ($18,500)
      'landmark_project',        // 20,000 hab. ($26,000)
    ]
  );

  // When Port Phase I completes (advancing to Phase II · 10,000 hab.), Sports Center (2,000 hab.) becomes first in the list
  city.workTiers.port_evolution = 2;
  const reorderedOffers = getEmergencyOffers(city);
  assert.equal(reorderedOffers[0].id, 'sports_center_project', 'Sports Center (2k) should move ahead of Port Phase II (10k)');
  assert.equal(reorderedOffers[1].id, 'clean_energy_project');
  assert.equal(reorderedOffers[2].id, 'bus_transit_project');
  assert.equal(reorderedOffers[3].id, 'hospital_project');
  assert.equal(reorderedOffers[4].id, 'airport_evolution');

  // 3. 2×2 Market (municipal_market and 2×2 commercial lots) config and labels
  const marketDef = ESTABLISHMENT_CATALOG.find((e) => e.id === 'municipal_market')!;
  assert.ok(marketDef);
  assert.equal(marketDef.footprintW, 2);
  assert.equal(marketDef.footprintH, 2);
  assert.equal(marketDef.hostTileType, 'commercial');

  const marketTile = getTile(city, 10, 10)!;
  marketTile.type = 'commercial';
  marketTile.level = 2;
  marketTile.lotRole = 'anchor';
  marketTile.lotWidth = 2;
  marketTile.lotHeight = 2;
  assert.ok(
    getZoneDisplayLabel(marketTile).includes('Mercado') && getZoneDisplayLabel(marketTile).includes('2×2'),
    `Expected 2×2 commercial lot label to mention Mercado 2×2, got: ${getZoneDisplayLabel(marketTile)}`
  );
});

test('Mercado (2x2) is a basic early-game commercial establishment that boosts local commercial distribution, Sports Centers build 2x2 then 4x4, courts are 2x1 every few blocks, and Stadiums obey 1 per 100k inhabitants', async () => {
  const {
    getMaxStadiumsForPopulation,
    getZoneDisplayLabel,
  } = await import('./cityEngine');
  const {
    ESTABLISHMENT_CATALOG,
    SPORTS_CENTER_FOOTPRINT_BY_TIER,
    STADIUM_POPULATION_INTERVAL,
  } = await import('./simulationConfig');

  // 1. Mercado (municipal_market) is a 2×2 basic commercial establishment available right after game start (minPopulation: 0, hostLevel: 1)
  const marketSpec = ESTABLISHMENT_CATALOG.find((e) => e.id === 'municipal_market')!;
  assert.ok(marketSpec);
  assert.equal(marketSpec.label, 'Mercado');
  assert.equal(marketSpec.hostTileType, 'commercial');
  assert.equal(marketSpec.hostLevel, 1);
  assert.equal(marketSpec.footprintW, 2);
  assert.equal(marketSpec.footprintH, 2);
  assert.equal(marketSpec.minPopulation, 0);
  assert.equal(marketSpec.minDistanceRadius, 8);

  // 2. Neighborhood Sports Courts (sports_court) are 2×1 placed every few blocks (minDistanceRadius: 8, minPopulation: 0)
  const courtSpec = ESTABLISHMENT_CATALOG.find((e) => e.id === 'sports_court')!;
  assert.ok(courtSpec);
  assert.equal(courtSpec.label, 'Quadra Esportiva');
  assert.equal(courtSpec.footprintW, 2);
  assert.equal(courtSpec.footprintH, 1);
  assert.equal(courtSpec.minDistanceRadius, 8);
  assert.equal(courtSpec.minPopulation, 0);

  // 3. Sports Center footprints: first = 2×2, next = 4×4
  assert.deepEqual(SPORTS_CENTER_FOOTPRINT_BY_TIER[1], { w: 2, h: 2 });
  assert.deepEqual(SPORTS_CENTER_FOOTPRINT_BY_TIER[2], { w: 4, h: 4 });

  const city = createNewCity(889911, 'easy');
  city.money = 10_000_000;

  // Verify local commercial distribution boost from a 2×2 Mercado on an adjacent commercial tile
  const commNeighbor = getTile(city, 5, 5)!;
  commNeighbor.type = 'commercial';
  commNeighbor.level = 1;
  commNeighbor.establishmentId = undefined;
  recomputeFieldsAndStats(city);
  const landValBeforeMarket = commNeighbor.landValue;
  assert.ok(landValBeforeMarket < 100, `Expected outer commercial tile baseline landValue < 100, got ${landValBeforeMarket}`);

  // Stamp a 2×2 Mercado right next to commNeighbor
  const mx = commNeighbor.x + 1;
  const my = commNeighbor.y;
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      const mt = getTile(city, mx + dx, my + dy)!;
      mt.type = 'commercial';
      mt.level = 1;
      mt.establishmentId = 'municipal_market';
      mt.lotRole = dx === 0 && dy === 0 ? 'anchor' : 'part';
      mt.lotWidth = 2;
      mt.lotHeight = 2;
      mt.lotDx = dx;
      mt.lotDy = dy;
    }
  }
  recomputeFieldsAndStats(city);
  assert.ok(
    commNeighbor.landValue > landValBeforeMarket,
    `Expected 2×2 Mercado to boost nearby commercial distribution/landValue (${commNeighbor.landValue} > ${landValBeforeMarket})`
  );
  assert.ok(
    getZoneDisplayLabel(getTile(city, mx, my)!).includes('Mercado') &&
      getZoneDisplayLabel(getTile(city, mx, my)!).includes('2×2'),
    `Expected Mercado 2×2 label, got: ${getZoneDisplayLabel(getTile(city, mx, my)!)}`
  );

  // Populate city to 7,000 hab. so both Tier 1 (2k) and Tier 2 (6k) Sports Centers can be built
  for (const t of city.tiles) {
    if ((t.type === 'grass' || t.type === 'forest') && city.totalPopulation < 7200) {
      t.type = 'residential';
      t.level = 3;
      recomputeFieldsAndStats(city);
    }
  }

  // Build 1st Sports Center (Tier 1 -> 2×2 = 4 tiles)
  assert.equal(city.workTiers.sports_center_project, 1);
  const startSports1 = executeEmergencyAction(city, 'sports_center_project');
  assert.equal(startSports1.ok, true);
  const reservedSports1 = city.tiles.filter((t) => t.construction?.actionId === 'sports_center_project');
  assert.equal(reservedSports1.length, 4, '1st Sports Center must reserve a 2×2 (4-tile) footprint');
  while (city.pendingWorks.length > 0) {
    closeFinancialMonth(city);
  }
  recomputeFieldsAndStats(city);
  assert.equal(city.workTiers.sports_center_project, 2);
  assert.equal(city.stats.sportsCenterCount, 1);
  const anchor2x2 = city.tiles.find(
    (t) =>
      t.establishmentId === 'sports_court' &&
      t.lotRole === 'anchor' &&
      t.lotWidth === 2 &&
      t.lotHeight === 2
  );
  assert.ok(anchor2x2, 'Expected completed 1st Sports Center to be a 2×2 compound');
  assert.ok(
    getZoneDisplayLabel(anchor2x2!).includes('Centro de Esporte') &&
      getZoneDisplayLabel(anchor2x2!).includes('2×2'),
    `Expected Centro de Esporte 2×2 label, got: ${getZoneDisplayLabel(anchor2x2!)}`
  );

  // Build 2nd Sports Center (Tier 2 -> 4×4 = 16 tiles)
  const startSports2 = executeEmergencyAction(city, 'sports_center_project');
  assert.equal(startSports2.ok, true);
  const reservedSports2 = city.tiles.filter((t) => t.construction?.actionId === 'sports_center_project');
  assert.equal(reservedSports2.length, 16, '2nd Sports Center must reserve a 4×4 (16-tile) footprint');
  while (city.pendingWorks.length > 0) {
    closeFinancialMonth(city);
  }
  recomputeFieldsAndStats(city);
  assert.equal(city.stats.sportsCenterCount, 2);
  const anchor4x4 = city.tiles.find(
    (t) =>
      t.establishmentId === 'sports_court' &&
      t.lotRole === 'anchor' &&
      t.lotWidth === 4 &&
      t.lotHeight === 4
  );
  assert.ok(anchor4x4, 'Expected completed 2nd Sports Center to be a 4×4 Olympic Sports Complex');
  assert.ok(
    getZoneDisplayLabel(anchor4x4!).includes('Complexo de Esporte Olímpico') &&
      getZoneDisplayLabel(anchor4x4!).includes('4×4'),
    `Expected Complexo de Esporte Olímpico 4×4 label, got: ${getZoneDisplayLabel(anchor4x4!)}`
  );

  // 4. Stadium rule: 1 stadium per 100,000 inhabitants
  assert.equal(STADIUM_POPULATION_INTERVAL, 100000);
  assert.equal(getMaxStadiumsForPopulation(15000), 0);
  assert.equal(getMaxStadiumsForPopulation(20000), 1);
  assert.equal(getMaxStadiumsForPopulation(99999), 1);
  assert.equal(getMaxStadiumsForPopulation(100000), 2);
  assert.equal(getMaxStadiumsForPopulation(199999), 2);
  assert.equal(getMaxStadiumsForPopulation(200000), 3);

  // At 25,000 inhabitants, 1st Stadium (Tier 1) can be built, Tier 2 expands complex,
  // but Tier 3 (which adds a 2nd Stadium) MUST remain locked until 100,000 inhabitants!
  city.totalPopulation = 25000;
  assert.equal(executeEmergencyAction(city, 'landmark_project').ok, true);
  while (city.pendingWorks.length > 0) {
    closeFinancialMonth(city);
  }
  recomputeFieldsAndStats(city);
  assert.equal(city.stats.stadiumCount, 1);
  assert.equal(city.workTiers.landmark_project, 2);

  // Tier 2 (Arena & Esplanada Cultural expansion, doesn't add a 2nd stadium) can be built at 45,000 hab.
  city.totalPopulation = 45000;
  assert.equal(executeEmergencyAction(city, 'landmark_project').ok, true);
  while (city.pendingWorks.length > 0) {
    closeFinancialMonth(city);
  }
  recomputeFieldsAndStats(city);
  assert.equal(city.stats.stadiumCount, 1);
  assert.equal(city.workTiers.landmark_project, 3);

  // At 85,000 inhabitants (< 100k), 2nd Stadium is blocked by the 1-per-100k rule
  city.totalPopulation = 85000;
  const offerAt85k = getEmergencyOffers(city).find((o) => o.id === 'landmark_project')!;
  assert.equal(offerAt85k.unlocked, false);
  assert.ok(
    offerAt85k.lockReason?.includes('100.000'),
    `Expected lockReason at 85k to require 100.000 hab., got: ${offerAt85k.lockReason}`
  );
  assert.equal(executeEmergencyAction(city, 'landmark_project').ok, false);

  // At 100,000 inhabitants, 2nd Stadium unlocks!
  city.totalPopulation = 100000;
  const offerAt100k = getEmergencyOffers(city).find((o) => o.id === 'landmark_project')!;
  assert.equal(offerAt100k.unlocked, true);
});

test('5 new evolutionary landmarks (Clean Energy, Hospital 3x3, Tech University, Amusement Park, Rail Terminal), 3 live map animations (Stadium Match Day fireworks, Helipad helicopters, Freight Convoys), and Mandate Missions work end-to-end', async () => {
  const {
    claimMandateMission,
    createParticlePool,
    getMandateMissionStatuses,
    triggerStadiumMatchDay,
    updateBoatsAndPlanes,
    updateCarsAndParticles,
  } = await import('./cityEngine');
  const typeMod = await import('./types');

  const city = createNewCity(774411, 'easy');
  city.money = 10_000_000;

  // Populate city to 25,000 hab. so all new landmarks unlock
  for (const t of city.tiles) {
    if ((t.type === 'grass' || t.type === 'forest') && city.totalPopulation < 24500) {
      t.type = 'residential';
      t.level = 3;
      recomputeFieldsAndStats(city);
    }
  }
  assert.ok(city.totalPopulation >= 22000);

  // 1. Build Clean Energy Tier 1 (2×2 Solar Power Plant)
  assert.equal(executeEmergencyAction(city, 'clean_energy_project').ok, true);
  while (city.pendingWorks.length > 0) closeFinancialMonth(city);
  recomputeFieldsAndStats(city);
  assert.equal(city.stats.cleanEnergyCount, 1);
  assert.equal(city.stats.cleanEnergyLevel, 1);

  // 2. Build Hospital Central Tier 1 (3×3 with Helipad)
  assert.equal(executeEmergencyAction(city, 'hospital_project').ok, true);
  while (city.pendingWorks.length > 0) closeFinancialMonth(city);
  recomputeFieldsAndStats(city);
  assert.equal(city.stats.hospitalCount, 1);
  assert.ok(city.stats.helipadCount >= 1, 'Hospital Central 3×3 should register a rooftop helipad');

  // 3. Build Tech University Tier 1 (3×3) and Tier 2 (4×4 Tech Park with Helipad)
  assert.equal(executeEmergencyAction(city, 'tech_university_project').ok, true);
  while (city.pendingWorks.length > 0) closeFinancialMonth(city);
  assert.equal(executeEmergencyAction(city, 'tech_university_project').ok, true);
  while (city.pendingWorks.length > 0) closeFinancialMonth(city);
  recomputeFieldsAndStats(city);
  assert.ok(city.stats.universityCount >= 2);
  assert.ok(city.stats.helipadCount >= 2, '4×4 Tech Park should add a 2nd rooftop helipad');

  // 4. Build Amusement Park Tier 1 (3×3 with Illuminated Ferris Wheel)
  assert.equal(executeEmergencyAction(city, 'amusement_park_project').ok, true);
  while (city.pendingWorks.length > 0) closeFinancialMonth(city);
  recomputeFieldsAndStats(city);
  assert.equal(city.stats.amusementParkCount, 1);

  // 5. Build Port + Rail Freight Terminal (3×2) and verify Freight Convoys spawn between Industry, Rail Terminal, and Port
  assert.equal(executeEmergencyAction(city, 'port_evolution').ok, true);
  while (city.pendingWorks.length > 0) closeFinancialMonth(city);
  assert.equal(executeEmergencyAction(city, 'rail_freight_project').ok, true);
  while (city.pendingWorks.length > 0) closeFinancialMonth(city);
  recomputeFieldsAndStats(city);
  assert.equal(city.stats.portCount, 1);
  assert.equal(city.stats.railTerminalCount, 1);

  const cars: import('./types').CarEntity[] = [];
  const particles = createParticlePool();
  const cursor = { idx: 0 };
  for (let step = 0; step < 30; step++) {
    updateCarsAndParticles(city, cars, particles, cursor, 0.25, 1.0, step * 0.25);
  }
  const freightConvoys = cars.filter((c) => c.role === 'freight_convoy' && c.kind === 'truck');
  assert.ok(
    freightConvoys.length >= 1,
    `Expected Freight Convoy trucks to spawn when Port + Industry/Rail exist, got ${freightConvoys.length}`
  );

  // 6. Verify Helicopter flights spawn and target rooftop helipads (Hospital 3×3 / Tech Park 4×4)
  const boats: import('./types').BoatEntity[] = [];
  const planes: import('./types').PlaneEntity[] = [];
  const helicopters: import('./types').HelicopterEntity[] = [];
  for (let step = 0; step < 25; step++) {
    updateBoatsAndPlanes(city, boats, planes, particles, cursor, 0.25, 1.0, helicopters);
  }
  assert.ok(
    helicopters.length >= 1,
    'Expected helicopters to spawn and fly between Hospital 3×3 and Tech University 4×4 helipads'
  );

  // 7. Build Stadium and verify Stadium Match Day triggers fireworks & tourism bonus
  assert.equal(executeEmergencyAction(city, 'landmark_project').ok, true);
  while (city.pendingWorks.length > 0) closeFinancialMonth(city);
  recomputeFieldsAndStats(city);
  assert.equal(city.stats.stadiumCount, 1);
  assert.equal(triggerStadiumMatchDay(city, 2).ok, true);
  assert.ok((city.stadiumMatchRemainingMonths ?? 0) >= 2);
  for (let step = 0; step < 15; step++) {
    updateCarsAndParticles(city, cars, particles, cursor, 0.2, 1.0, step * 0.2);
  }
  const activeFireworks = particles.filter((p) => p.active && p.maxLife <= 1.25);
  assert.ok(activeFireworks.length > 0, 'Expected colorful firework particles above stadium on Match Day');

  // 8. Verify Mandate Missions & Cash Rewards
  const missions = getMandateMissionStatuses(city);
  assert.equal(missions.length, 8);
  const completedMission = missions.find((m) => m.completed && !m.claimed);
  assert.ok(completedMission, 'Expected at least one Mandate Mission to be completed');
  const cashBefore = city.money;
  const claimRes = claimMandateMission(city, completedMission!.id);
  assert.equal(claimRes.ok, true);
  assert.equal(city.money, cashBefore + completedMission!.rewardCash);
  // Claiming again must fail
  assert.equal(claimMandateMission(city, completedMission!.id).ok, false);
  void typeMod;
});

test('RCI demand balances cause-and-effect between residents and jobs and reacts to per-sector taxes (attraction vs abandonment)', () => {
  const city = createNewCity(202611, 'medium');
  city.money = 250000;

  // Run initial growth to establish R, C, and I tiles
  for (let i = 0; i < 65; i++) {
    stepCityTick(city);
  }
  recomputeFieldsAndStats(city);

  const hud = createHudSnapshot(city);
  assert.ok(hud.rciDemand, 'HudSnapshot must expose rciDemand');
  assert.ok(hud.rciDemand.workforce > 0, 'Expected positive workforce');
  assert.ok(hud.rciDemand.totalJobs > 0, 'Expected positive jobs');
  assert.ok(hud.rciDemand.summary.length > 10, 'Expected readable RCI summary');

  // 1. Lowering residential tax boosts R demand; raising residential tax to 24% collapses R demand & causes residential abandonment
  setTaxRate(city, 'residential', 4);
  const lowResDemand = city.stats.rciDemand.residential.demand;
  setTaxRate(city, 'residential', 24);
  const highResDemand = city.stats.rciDemand.residential.demand;
  assert.ok(
    lowResDemand > highResDemand + 40,
    `Expected low residential tax (${lowResDemand}) to yield much higher R demand than abusive 24% tax (${highResDemand})`
  );
  assert.ok(highResDemand < -10, `Expected abusive residential tax to produce negative R demand, got ${highResDemand}`);

  // 2. Lowering commercial tax boosts C demand; raising commercial tax to 24% collapses C demand and causes commercial closures
  setTaxRate(city, 'residential', 9);
  setTaxRate(city, 'commercial', 4);
  const lowComDemand = city.stats.rciDemand.commercial.demand;
  setTaxRate(city, 'commercial', 24);
  const highComDemand = city.stats.rciDemand.commercial.demand;
  assert.ok(
    lowComDemand > highComDemand + 40,
    `Expected low commercial tax (${lowComDemand}) to beat abusive commercial tax (${highComDemand})`
  );
  assert.ok(highComDemand < -10, `Expected abusive commercial tax to produce negative C demand, got ${highComDemand}`);

  const comCountBefore = city.stats.commercialCount;
  for (let m = 0; m < 4; m++) {
    closeFinancialMonth(city);
  }
  const closedCom = city.tiles.filter((t) => t.type === 'abandoned' && t.previousType === 'commercial').length;
  assert.ok(
    closedCom > 0 || city.stats.commercialCount < comCountBefore,
    `Expected abusive 24% commercial tax to close/abandon commercial buildings (before=${comCountBefore}, after=${city.stats.commercialCount}, closed=${closedCom})`
  );

  // 3. Abusive industrial tax suppresses industrial demand and causes industrial closures
  setTaxRate(city, 'commercial', 9);
  setTaxRate(city, 'industrial', 4);
  const lowIndDemand = city.stats.rciDemand.industrial.demand;
  setTaxRate(city, 'industrial', 24);
  const highIndDemand = city.stats.rciDemand.industrial.demand;
  assert.ok(
    lowIndDemand > highIndDemand + 40,
    `Expected low industrial tax (${lowIndDemand}) to beat abusive industrial tax (${highIndDemand})`
  );
  assert.ok(highIndDemand < -10, `Expected abusive industrial tax to produce negative I demand, got ${highIndDemand}`);

  // 4. Cause-and-effect: Adding many new residents (workforce >> jobs) increases C and I job demand!
  setTaxRate(city, 'residential', 9);
  setTaxRate(city, 'commercial', 9);
  setTaxRate(city, 'industrial', 9);
  recomputeFieldsAndStats(city);
  const baseComBalance = city.stats.rciDemand.commercial.balanceEffect;
  const baseIndBalance = city.stats.rciDemand.industrial.balanceEffect;

  // Add 18 dense residential tiles to simulate a wave of new workers arriving
  let addedRes = 0;
  for (const t of city.tiles) {
    if (addedRes >= 18) break;
    if (t.type === 'grass') {
      t.type = 'residential';
      t.level = 3;
      addedRes++;
    }
  }
  recomputeFieldsAndStats(city);
  assert.ok(
    city.stats.rciDemand.commercial.balanceEffect > baseComBalance &&
      city.stats.rciDemand.industrial.balanceEffect > baseIndBalance,
    `Expected influx of workers to increase Commercial (${baseComBalance} -> ${city.stats.rciDemand.commercial.balanceEffect}) and Industrial (${baseIndBalance} -> ${city.stats.rciDemand.industrial.balanceEffect}) job demand`
  );
});

test('dynamic parking lots allow live cars to enter stalls, park, and exit back onto adjacent streets', () => {
  const city = createNewCity(771122, 'easy');
  city.money = 900000;

  for (let i = 0; i < 40; i++) {
    stepCityTick(city);
  }
  // Unlock and construct a 5x5 Shopping Mall Lv.1 with 7 live parking bays adjacent to the road network
  city.totalPopulation = Math.max(city.totalPopulation, 8500);
  const res = executeEmergencyAction(city, 'shopping_evolution');
  assert.equal(res.ok, true, `Expected 5x5 Shopping Mall work to start: ${res.reason ?? ''}`);
  while (city.pendingWorks.length > 0) {
    closeFinancialMonth(city);
  }
  recomputeFieldsAndStats(city);
  assert.ok(city.stats.shoppingCount >= 1, 'Expected at least 1 shopping mall');

  const cars: CarEntity[] = [];
  const particles = createParticlePool(32);
  const cursor = { idx: 0 };

  const observedParkingStates = new Set<string>();
  let observedRejoinedStreet = false;
  const hadParkedCar = new Set<CarEntity>();
  let minParkedAtMall = Infinity;

  for (let step = 0; step < 260; step++) {
    updateCarsAndParticles(city, cars, particles, cursor, 0.25, 1.0, step * 0.25);
    let parkedAtMallNow = 0;
    for (const c of cars) {
      if (c.parkingState) {
        observedParkingStates.add(c.parkingState);
        hadParkedCar.add(c);
        if (c.parkingState === 'parked' && c.parkLotKey?.startsWith('shopping_')) {
          parkedAtMallNow++;
        }
      } else if (hadParkedCar.has(c)) {
        observedRejoinedStreet = true;
      }
    }
    if (parkedAtMallNow < minParkedAtMall) {
      minParkedAtMall = parkedAtMallNow;
    }
  }

  assert.ok(
    minParkedAtMall >= 4,
    `Expected 5x5 Shopping Mall parking lot to ALWAYS have at least 4 parked cars on every step, lowest observed was ${minParkedAtMall}`
  );
  assert.ok(
    observedParkingStates.has('entering') &&
      observedParkingStates.has('parked') &&
      observedParkingStates.has('exiting'),
    `Expected parking lot cars to enter, park, and exit; saw: ${[...observedParkingStates].join(', ')}`
  );
  assert.equal(observedRejoinedStreet, true, 'Expected exiting cars to cleanly rejoin adjacent street traffic');
});

test('cross-map railway runs edge-to-edge through 2x4 then 4x8 train station, and duplicate major structures enforce >=32-block spacing with distinct rotation', () => {
  const city = createNewCity(884422, 'easy');
  city.money = 5_000_000;
  for (let i = 0; i < 30; i++) {
    stepCityTick(city);
  }

  // 1. Build Tier 1 Train Station (2x4 or 4x2) with cross-map railway corridor
  city.totalPopulation = Math.max(city.totalPopulation, 40_000);
  const railLv1 = executeEmergencyAction(city, 'rail_freight_project');
  assert.equal(railLv1.ok, true, `Expected Lv.1 train station work to start: ${railLv1.reason ?? ''}`);
  while (city.pendingWorks.length > 0) {
    closeFinancialMonth(city);
  }
  recomputeFieldsAndStats(city);

  const rc1 = city.railCorridor;
  assert.ok(rc1, 'Expected active state.railCorridor after completing Lv.1 Train Station');
  const stLv1Tiles = city.tiles.filter((t) => t.type === 'rail_terminal');
  assert.equal(stLv1Tiles.length, 8, `Expected Lv.1 Train Station to cover 2x4 = 8 tiles, got ${stLv1Tiles.length}`);
  const stLv1Anchor = stLv1Tiles.find((t) => t.lotRole !== 'part')!;
  assert.ok(
    (stLv1Anchor.lotWidth === 2 && stLv1Anchor.lotHeight === 4) ||
      (stLv1Anchor.lotWidth === 4 && stLv1Anchor.lotHeight === 2),
    `Expected 2x4 or 4x2 Train Station footprint, got ${stLv1Anchor.lotWidth}x${stLv1Anchor.lotHeight}`
  );

  // Verify continuous edge-to-edge railway from 0 to max - 1
  const alongMax1 = rc1.axis === 'ns' ? city.gridHeight : city.gridWidth;
  for (let c = 0; c < alongMax1; c++) {
    const t = getTile(city, rc1.axis === 'ns' ? rc1.lineCoord : c, rc1.axis === 'ns' ? c : rc1.lineCoord);
    assert.ok(
      t &&
        (t.type === 'rail_track' ||
          t.type === 'rail_terminal' ||
          t.type === 'road' ||
          t.type === 'bridge' ||
          t.type === 'water'),
      `Expected continuous railway tile at c=${c}, got ${t?.type}`
    );
  }
  const edge0 = getTile(city, rc1.axis === 'ns' ? rc1.lineCoord : 0, rc1.axis === 'ns' ? 0 : rc1.lineCoord);
  const edgeEnd = getTile(
    city,
    rc1.axis === 'ns' ? rc1.lineCoord : alongMax1 - 1,
    rc1.axis === 'ns' ? alongMax1 - 1 : rc1.lineCoord
  );
  assert.ok(
    edge0 && (edge0.type === 'rail_track' || edge0.type === 'road' || edge0.type === 'water'),
    'Expected railway corridor to touch edge 0'
  );
  assert.ok(
    edgeEnd && (edgeEnd.type === 'rail_track' || edgeEnd.type === 'road' || edgeEnd.type === 'water'),
    'Expected railway corridor to touch opposite outer edge'
  );

  // 2. Upgrade to Tier 2 Central Train Station (4x8 or 8x4) on the same corridor
  city.totalPopulation = Math.max(city.totalPopulation, 80_000);
  const railLv2 = executeEmergencyAction(city, 'rail_freight_project');
  assert.equal(railLv2.ok, true, `Expected Lv.2 train station upgrade to start: ${railLv2.reason ?? ''}`);
  while (city.pendingWorks.length > 0) {
    closeFinancialMonth(city);
  }
  recomputeFieldsAndStats(city);

  const stLv2Tiles = city.tiles.filter((t) => t.type === 'rail_terminal');
  assert.equal(stLv2Tiles.length, 32, `Expected Lv.2 Central Train Station to cover 4x8 = 32 tiles, got ${stLv2Tiles.length}`);
  const stLv2Anchor = stLv2Tiles.find((t) => t.lotRole !== 'part')!;
  assert.ok(
    (stLv2Anchor.lotWidth === 4 && stLv2Anchor.lotHeight === 8) ||
      (stLv2Anchor.lotWidth === 8 && stLv2Anchor.lotHeight === 4),
    `Expected 4x8 or 8x4 Central Train Station footprint, got ${stLv2Anchor.lotWidth}x${stLv2Anchor.lotHeight}`
  );

  // 3. Expanding city land extends the railway all the way to the new outer borders
  const oldAlong = city.railCorridor!.axis === 'ns' ? city.gridHeight : city.gridWidth;
  const expDir = city.railCorridor!.axis === 'ns' ? 'norte' : 'oeste';
  const expRes = expandCityLand(city, expDir);
  assert.equal(expRes.ok, true, `Expected expandCityLand(${expDir}) to succeed: ${expRes.reason ?? ''}`);
  const newAlong = city.railCorridor!.axis === 'ns' ? city.gridHeight : city.gridWidth;
  assert.ok(newAlong > oldAlong, 'Expected grid size to increase after expandCityLand');
  const rcExp = city.railCorridor!;
  const newEdge0 = getTile(city, rcExp.axis === 'ns' ? rcExp.lineCoord : 0, rcExp.axis === 'ns' ? 0 : rcExp.lineCoord);
  const newEdgeEnd = getTile(
    city,
    rcExp.axis === 'ns' ? rcExp.lineCoord : newAlong - 1,
    rcExp.axis === 'ns' ? newAlong - 1 : rcExp.lineCoord
  );
  assert.ok(
    newEdge0 && (newEdge0.type === 'rail_track' || newEdge0.type === 'road' || newEdge0.type === 'water'),
    'Expected railway corridor to extend to new edge 0 after land expansion'
  );
  assert.ok(
    newEdgeEnd && (newEdgeEnd.type === 'rail_track' || newEdgeEnd.type === 'road' || newEdgeEnd.type === 'water'),
    'Expected railway corridor to extend to new far edge after land expansion'
  );

  // 4. Duplicate Sports Centers (2x2 & 4x4) and Hospitals (3x3) enforce >= 32 blocks spacing & distinct lotRotation
  city.totalPopulation = 80_000;
  const sp1 = executeEmergencyAction(city, 'sports_center_project');
  assert.equal(sp1.ok, true, `Expected 1st sports center to start: ${sp1.reason ?? ''}`);
  while (city.pendingWorks.length > 0) closeFinancialMonth(city);
  city.totalPopulation = 80_000;
  const sp2 = executeEmergencyAction(city, 'sports_center_project');
  assert.equal(sp2.ok, true, `Expected 2nd sports center to start: ${sp2.reason ?? ''}`);
  while (city.pendingWorks.length > 0) closeFinancialMonth(city);

  const sportAnchors = city.tiles.filter(
    (t) => t.establishmentId === 'sports_court' && t.lotRole !== 'part' && (t.lotWidth ?? 1) >= 2 && (t.lotHeight ?? 1) >= 2
  );
  assert.ok(sportAnchors.length >= 2, `Expected 2 sports center anchors (2x2 and 4x4), got ${sportAnchors.length}`);
  const sDist = Math.hypot(sportAnchors[0].x - sportAnchors[1].x, sportAnchors[0].y - sportAnchors[1].y);
  assert.ok(sDist >= 32, `Expected Sports Centers to be >= 32 blocks apart, got ${sDist.toFixed(1)}`);
  assert.notEqual(
    sportAnchors[0].lotRotation ?? 0,
    sportAnchors[1].lotRotation ?? 0,
    'Expected duplicate Sports Centers to have distinct lotRotation'
  );

  city.totalPopulation = 80_000;
  const h1 = executeEmergencyAction(city, 'hospital_project');
  assert.equal(h1.ok, true, `Expected 1st hospital to start: ${h1.reason ?? ''}`);
  while (city.pendingWorks.length > 0) closeFinancialMonth(city);
  city.totalPopulation = 80_000;
  const h2 = executeEmergencyAction(city, 'hospital_project');
  assert.equal(h2.ok, true, `Expected 2nd hospital to start: ${h2.reason ?? ''}`);
  while (city.pendingWorks.length > 0) closeFinancialMonth(city);

  const hospAnchors = city.tiles.filter(
    (t) => t.establishmentId === 'general_hospital' && t.lotRole !== 'part' && (t.lotWidth ?? 1) >= 3
  );
  assert.ok(hospAnchors.length >= 2, `Expected 2 3x3 Hospital anchors, got ${hospAnchors.length}`);
  const hDist = Math.hypot(hospAnchors[0].x - hospAnchors[1].x, hospAnchors[0].y - hospAnchors[1].y);
  assert.ok(hDist >= 32, `Expected Hospitals to be >= 32 blocks apart, got ${hDist.toFixed(1)}`);
  assert.notEqual(
    hospAnchors[0].lotRotation ?? 0,
    hospAnchors[1].lotRotation ?? 0,
    'Expected duplicate Hospitals to have distinct lotRotation'
  );

  // 5. Save/load round-trip preserves railCorridor & lotRotation
  const saved = serializeCitySave(city);
  const restored = deserializeCitySave(saved);
  assert.ok(restored, 'Expected deserializeCitySave to succeed');
  assert.equal(restored!.railCorridor?.axis, city.railCorridor?.axis);
  assert.equal(restored!.railCorridor?.lineCoord, city.railCorridor?.lineCoord);
  const restoredHosp = restored!.tiles.filter(
    (t) => t.establishmentId === 'general_hospital' && t.lotRole !== 'part' && (t.lotWidth ?? 1) >= 3
  );
  assert.notEqual(
    restoredHosp[0]?.lotRotation ?? 0,
    restoredHosp[1]?.lotRotation ?? 0,
    'Expected distinct lotRotation to survive save/load round-trip'
  );
});

