import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceSimulationTime,
  closeFinancialMonth,
  computeCityNeeds,
  computeFairTaxRate,
  createNewCity,
  createParticlePool,
  deleteSavedCityFromStorage,
  deserializeCitySave,
  executeEmergencyAction,
  expandCityLand,
  getCruisePortNavigationInfo,
  getEmergencyOffers,
  getMainConnectedRoadSet,
  getTrafficSignalState,
  isCruiseNavigableWater,
  isTrafficLightIntersection,
  loadSavedCitiesFromStorage,
  placePortOnRiverfront,
  recomputeFieldsAndStats,
  SAVE_STORAGE_KEY,
  saveCurrentCityToStorage,
  setCityBudget,
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
  GRID_SIZE,
  LAND_EXPAND_CHUNK,
  SECONDS_PER_GROWTH_TICK_1X,
  SECONDS_PER_MONTH_1X,
} from './simulationConfig';
import type { BoatEntity, CameraRotation, CameraState, CarEntity, HelicopterEntity, PlaneEntity } from './types';

test('Lazer replaces Diversão in budget metadata and UI labels', () => {
  assert.equal(BUDGET_AREA_META.entertainment.label, 'Lazer');
  for (const key of BUDGET_AREA_ORDER) {
    assert.ok(
      !BUDGET_AREA_META[key].label.toLowerCase().includes('divers'),
      `Unexpected Diversão label in ${key}`
    );
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

  // Putting ALL 6 segments at 200% MUST cause a steep deficit
  for (const k of BUDGET_AREA_ORDER) {
    setCityBudgetTargetPct(city, k, 200);
  }
  assert.ok(
    city.financials.netBalance < -2500,
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
  assert.equal(initialStatuses.length, 10);
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
  assert.equal(executeEmergencyAction(city, 'port_evolution').ok, true, 'Port Nv. 1 should be buildable at 1,200 pop');
  assert.ok(city.stats.portCount >= 1);
  assert.ok(city.financials.revenue.tradeIncome > 0, 'Built Port should generate trade income');

  // Dismissing milestone banner clears it cleanly
  dismissMilestoneBanner(city);
  assert.equal(city.recentMilestoneBanner, null);

  // 2,000 pop -> Centro Esportivo Pequeno unlocks, while Stadium & Airport remain locked!
  const u2000 = growToPop(2000);
  assert.ok(u2000.includes('civic_sports_small'), 'Expected civic_sports_small at 2,000 pop');
  assert.equal(executeEmergencyAction(city, 'sports_center_project').ok, true, 'Sports Center should unlock at 2,000 pop');
  assert.equal(executeEmergencyAction(city, 'airport_evolution').ok, false, 'Airport must NOT unlock before 5,000 pop');
  assert.equal(executeEmergencyAction(city, 'landmark_project').ok, false, 'Stadium must NOT unlock before 20,000 pop');

  // 5,000 pop -> Aeroporto Pequeno (Nv. 1) unlocks!
  const u5000 = growToPop(5000);
  assert.ok(u5000.includes('civic_airport_lv1'), 'Expected civic_airport_lv1 at 5,000 pop');
  assert.equal(executeEmergencyAction(city, 'airport_evolution').ok, true, 'Airport Nv. 1 should build at 5,000 pop');
  assert.ok(city.stats.airportCount >= 1);

  // 15,000 pop -> Port Nv. 2 (8k) & Airport Nv. 2 (15k) unlock!
  const u15000 = growToPop(15000);
  assert.ok(u15000.includes('civic_port_lv2'));
  assert.ok(u15000.includes('civic_airport_lv2'));
  assert.equal(executeEmergencyAction(city, 'port_evolution').ok, true);
  assert.equal(executeEmergencyAction(city, 'airport_evolution').ok, true);
  assert.ok(
    city.tiles.filter((t) => t.type === 'port').every((t) => t.level >= 2),
    'Port should upgrade to Nv. 2 by 8,000 pop'
  );
  assert.ok(
    city.tiles.filter((t) => t.type === 'airport').every((t) => t.level >= 2),
    'Airport should upgrade to Nv. 2 at 15,000 pop'
  );

  // 20,000 pop -> Cruise Port Nv. 3 (18k) & Stadium Monumental + Toll Plaza gate (20k)!
  const u20000 = growToPop(20000);
  assert.ok(u20000.includes('civic_port_lv3'));
  assert.ok(u20000.includes('civic_stadium_toll_20k'), 'Expected civic_stadium_toll_20k at 20,000 pop');
  assert.equal(executeEmergencyAction(city, 'port_evolution').ok, true);
  assert.equal(executeEmergencyAction(city, 'landmark_project').ok, true);
  assert.ok(city.stats.stadiumCount >= 1, 'Stadium should build at 20,000 pop');
  assert.ok(
    city.tiles.filter((t) => t.type === 'port').every((t) => t.level === 3),
    'Port should reach Cruise Port Nv. 3 at 18,000 pop'
  );

  // 30,000 pop -> Aeroporto Grande (Nv. 3)!
  const u30000 = growToPop(30000);
  assert.ok(u30000.includes('civic_airport_lv3'), 'Expected civic_airport_lv3 at 30,000 pop');
  assert.equal(executeEmergencyAction(city, 'airport_evolution').ok, true);
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

  // Verify Obras Evolutivas still evolve cleanly (e.g. tourism_festival Fase I -> Fase II)
  city.money = Math.max(800000, city.financials.revenue.total * 10);
  const beforeFest = getEmergencyOffers(city).find((o) => o.id === 'tourism_festival')!;
  assert.equal(beforeFest.tier, 1);
  const res1 = executeEmergencyAction(city, 'tourism_festival');
  assert.equal(res1.ok, true);
  assert.equal(res1.evolvedToTier, 2);
  const afterFest = getEmergencyOffers(city).find((o) => o.id === 'tourism_festival')!;
  assert.ok(afterFest.cost > beforeFest.cost, 'Phase II work should be more complex/expensive');
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

test('city save and load round-trips full expanded map, budgets, taxes, landmarks, and work tiers', async () => {
  const { serializeCitySave, deserializeCitySave } = await import('./cityEngine');
  const city = createNewCity(707070);
  city.money = 45000;
  expandCityLand(city, 'leste');
  executeEmergencyAction(city, 'emergency_roadworks');
  setCityBudget(city, 'infrastructure', 999);
  setTaxRate(city, 'commercial', 14);

  const json = serializeCitySave(city);
  const loaded = deserializeCitySave(json);
  assert.ok(loaded, 'Expected valid deserialized city state');
  assert.equal(loaded.seed, city.seed);
  assert.equal(loaded.gridWidth, city.gridWidth);
  assert.equal(loaded.gridHeight, city.gridHeight);
  assert.equal(loaded.money, city.money);
  assert.equal(loaded.budgets.infrastructure, 999);
  assert.equal(loaded.taxes.commercial, 14);
  assert.equal(loaded.workTiers.emergency_roadworks, 2);
  assert.equal(loaded.tiles.length, city.tiles.length);
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

  // Expand map along the river and run roadworks so multiple well-spaced bridges can be built (>2 possible when needed)
  city.money = 250000;
  expandCityLand(city, 'norte');
  expandCityLand(city, 'sul');
  expandCityLand(city, 'leste');
  expandCityLand(city, 'oeste');
  executeEmergencyAction(city, 'emergency_roadworks');
  executeEmergencyAction(city, 'emergency_roadworks');
  executeEmergencyAction(city, 'emergency_roadworks');
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

  // Ensure Airport is placed (either automatically by the 1,600-pop civic milestone or explicitly) and verify it occupies a 6×12 (72-tile) block at Level 1 and expands to 8×16 (128-tile) when evolved, automatically demolishing obstructing structures
  if (city.stats.airportCount === 0) {
    const placedAirport = placeLandmarkOnBestSlot(city, 'airport', true, 1);
    assert.ok(placedAirport, 'Expected 6x12 airport placement with automatic demolition to succeed');
    recomputeFieldsAndStats(city);
  }

  let airportTiles = city.tiles.filter((t) => t.type === 'airport');
  const anchor = airportTiles.find((t) => t.lotRole === 'anchor');
  assert.ok(anchor, 'Expected Airport to have an anchor tile');
  if (anchor.level === 1) {
    assert.equal(
      airportTiles.length,
      6 * 12,
      `Expected Level 1 Airport to occupy a 6x12 (72-tile) block, got ${airportTiles.length}`
    );
    assert.equal(anchor.lotWidth, 6);
    assert.equal(anchor.lotHeight, 12);
    assert.ok(
      getZoneDisplayLabel(anchor).includes('12×6') || getZoneDisplayLabel(anchor).includes('6×12'),
      `Expected Level 1 airport label to indicate 12×6/6×12 footprint, got ${getZoneDisplayLabel(anchor)}`
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

  // 2. Unfavorable conditions (negative treasury or high local pollution) erode/block evolutionProgress
  const tracked = startResTiles[0];
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
  for (let i = 0; i < 65; i++) {
    stepCityTick(city);
    if (!sawLv2 && tracked.level === 2) {
      sawLv2 = true;
      lv2CooldownAtUpgrade = tracked.upgradeCooldown ?? 0;
      break;
    }
  }
  assert.ok(sawLv2, 'Expected tracked residential lot to reach Level 2 after sustained favorable conditions');
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

  // In default 'manual' condoPolicy, residential buildings pause at Prédio Médio (Lv. 2); switching to 'auto' allows sustained Lv. 3 evolution!
  const { setCondoPolicy } = await import('./cityEngine');
  setCondoPolicy(city, 'auto');
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
    'Expected sustained healthy conditions over extended timeline (with auto condo policy) to eventually produce Level 3 evolutions'
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
  executeEmergencyAction(city, 'emergency_roadworks');
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

  // 2. Place 6×12 (12×6) Airport & verify landing planes enter hangars (`taxi_to_hangar` -> `in_hangar` -> `taxi_from_hangar`)
  const airportPlaced = placeLandmarkOnBestSlot(city, 'airport', true, 1);
  assert.ok(airportPlaced, 'Expected 6×12 Airport placement to succeed');
  recomputeFieldsAndStats(city);
  assert.equal(
    city.tiles.filter((t) => t.type === 'airport').length,
    6 * 12,
    'Expected Level 1 Airport to occupy 72 tiles (6x12)'
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
    city.money < 500_000,
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
  assert.equal(executeEmergencyAction(city, 'sports_center_project').ok, true);
  assert.equal(executeEmergencyAction(city, 'airport_evolution').ok, false);
  assert.equal(executeEmergencyAction(city, 'landmark_project').ok, false);
  assert.equal(executeEmergencyAction(city, 'toll_plaza_project').ok, false);

  // At 5,000 pop -> Aeroporto Pequeno (Fase I) unlocks, then Fase II requires 15,000 pop!
  raisePopTo(5000);
  assert.equal(executeEmergencyAction(city, 'airport_evolution').ok, true, 'Airport Fase I should unlock at 5k');
  assert.equal(executeEmergencyAction(city, 'airport_evolution').ok, false, 'Airport Fase II should require 15k');

  // At 15,000 pop -> Aeroporto Médio (Fase II) unlocks, then Fase III requires 30,000 pop!
  raisePopTo(15000);
  assert.equal(executeEmergencyAction(city, 'airport_evolution').ok, true, 'Airport Fase II should unlock at 15k');
  assert.equal(executeEmergencyAction(city, 'airport_evolution').ok, false, 'Airport Fase III should require 30k');
  assert.equal(executeEmergencyAction(city, 'landmark_project').ok, false, 'Stadium should still require 20k');
  assert.equal(executeEmergencyAction(city, 'toll_plaza_project').ok, false, 'Toll Plaza should still require 20k');

  // At 20,000 pop -> Estádio Monumental & Praça de Pedágio unlock!
  raisePopTo(20000);
  assert.equal(executeEmergencyAction(city, 'landmark_project').ok, true, 'Stadium should unlock at 20k');
  assert.equal(executeEmergencyAction(city, 'toll_plaza_project').ok, true, 'Toll Plaza should unlock at 20k');
  assert.equal(city.tollPlaza.built, true);

  // At 30,000 pop -> Aeroporto Grande (Fase III) unlocks!
  raisePopTo(30000);
  assert.equal(executeEmergencyAction(city, 'airport_evolution').ok, true, 'Airport Fase III should unlock at 30k');
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
  const costBeforeInf = getEmergencyOffers(city).find((o) => o.id === 'emergency_roadworks')!.cost;
  triggerRandomEvent(city, 'inflation');
  assert.equal(city.activeEconomicEvent?.id, 'inflation');
  assert.ok(
    city.financials.expenses.fixedTotal > baseFixed,
    `Expected inflation to raise fixed expenses (${baseFixed} -> ${city.financials.expenses.fixedTotal})`
  );
  const costDuringInf = getEmergencyOffers(city).find((o) => o.id === 'emergency_roadworks')!.cost;
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
  assert.equal(city.tollPlaza.built, false, 'Toll Plaza must NOT auto-build without player order');
  assert.equal(city.stats.bridgeLevel, 1, 'River bridges must NOT auto-upgrade without player order');

  // All 10 civic milestones should report unlocked=true, built=false, and carry their Obras actionId
  const statusesBefore = getCivicMilestoneStatuses(city);
  assert.equal(statusesBefore.length, 10);
  for (const m of statusesBefore) {
    assert.equal(m.unlocked, true, `Expected milestone ${m.id} to be unlocked at 30k+ pop`);
    assert.equal(m.built, false, `Expected milestone ${m.id} to remain built=false until player builds it`);
    assert.ok(m.actionId, `Expected milestone ${m.id} to reference an Obras actionId`);
  }

  // With insufficient money, player cannot build any unlocked milestone project
  city.money = 100;
  for (const actionId of [
    'port_evolution',
    'sports_center_project',
    'airport_evolution',
    'landmark_project',
    'toll_plaza_project',
  ] as const) {
    const res = executeEmergencyAction(city, actionId);
    assert.equal(res.ok, false, `Expected ${actionId} to fail with insufficient treasury`);
  }
  assert.equal(city.stats.portCount, 0);
  assert.equal(city.stats.airportCount, 0);
  assert.equal(city.stats.stadiumCount, 0);
  assert.equal(city.stats.sportsCenterCount, 0);
  assert.equal(city.tollPlaza.built, false);

  // Fund treasury and explicitly execute Obras orders
  city.money = 10_000_000;
  assert.equal(executeEmergencyAction(city, 'port_evolution').ok, true);
  assert.equal(executeEmergencyAction(city, 'sports_center_project').ok, true);
  assert.equal(executeEmergencyAction(city, 'airport_evolution').ok, true);
  assert.equal(executeEmergencyAction(city, 'landmark_project').ok, true);
  assert.equal(executeEmergencyAction(city, 'toll_plaza_project').ok, true);
  // Roadworks tiers 1 -> 2 -> 3 allow bridges to upgrade to Lv.2 & Lv.3 once pop >= 12k
  assert.equal(executeEmergencyAction(city, 'emergency_roadworks').ok, true);
  assert.equal(executeEmergencyAction(city, 'emergency_roadworks').ok, true);
  assert.equal(executeEmergencyAction(city, 'emergency_roadworks').ok, true);
  recomputeFieldsAndStats(city);

  assert.ok(city.money < 10_000_000, 'Expected treasury deduction after ordering projects');
  assert.ok(city.stats.portCount >= 1, 'Expected Port built after explicit order');
  assert.ok(city.stats.sportsCenterCount >= 1, 'Expected Sports Center built after explicit order');
  assert.ok(city.stats.airportCount >= 1, 'Expected Airport built after explicit order');
  assert.ok(city.stats.stadiumCount >= 1, 'Expected Stadium built after explicit order');
  assert.equal(city.tollPlaza.built, true, 'Expected Toll Plaza built after explicit order');
  assert.equal(city.stats.bridgeLevel, 3, 'Expected river bridges upgraded to Nv. 3 after roadworks order');

  const statusesAfter = getCivicMilestoneStatuses(city);
  const byId = Object.fromEntries(statusesAfter.map((s) => [s.id, s]));
  assert.equal(byId.civic_port_lv1.built, true);
  assert.equal(byId.civic_sports_small.built, true);
  assert.equal(byId.civic_bridge_lv2.built, true);
  assert.equal(byId.civic_bridge_lv3.built, true);
  assert.equal(byId.civic_airport_lv1.built, true);
  assert.equal(byId.civic_stadium_toll_20k.built, true);
});








