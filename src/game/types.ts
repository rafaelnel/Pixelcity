import type { TimeOfDayMode, VehicleKind } from './pixelArtHelpers';

export type TileType =
  | 'grass'
  | 'forest'
  | 'water'
  | 'road'
  | 'bridge'
  | 'rural'
  | 'residential'
  | 'commercial'
  | 'industrial'
  | 'park'
  | 'abandoned'
  | 'port'
  | 'airport'
  | 'stadium'
  | 'bus_station'
  | 'metro_station'
  | 'shopping'
  | 'clean_energy'
  | 'rail_terminal'
  | 'rail_track';

/** Coherent urban neighborhood (bairro) macro-zone classification */
export type NeighborhoodDistrictType = 'residential' | 'commercial' | 'industrial';

/**
 * 20 Iconic Civic, Cultural, Commercial & Waterfront Establishments
 * modeled directly after the reference 64-bit isometric pixel art sheet.
 */
export type EstablishmentId =
  | 'fountain_plaza'
  | 'health_clinic'
  | 'sports_court'
  | 'municipal_school'
  | 'public_library'
  | 'police_station'
  | 'fire_station'
  | 'retro_cinema'
  | 'municipal_market'
  | 'rooftop_hotel'
  | 'general_hospital'
  | 'municipal_theater'
  | 'botanical_garden'
  | 'modern_art_museum'
  | 'municipal_planetarium'
  | 'court_of_justice'
  | 'tech_university'
  | 'river_marina'
  | 'amusement_park'
  | 'soccer_stadium';

export type ExpandDirection = 'norte' | 'leste' | 'sul' | 'oeste';

/**
 * 6 Budget Segments (keys kept for save compatibility):
 * - infrastructure: Infraestrutura (Expansão & Densidade)
 * - education: Educação (Tecnologia & Renda)
 * - security: Segurança (Estabilidade & Ordem)
 * - wellbeing: Saúde & Meio Ambiente (antigo "Bem-estar")
 * - entertainment: Cultura & Lazer (antigo "Lazer")
 * - tourism: Turismo & Comércio (antigo "Turismo")
 */
export type BudgetAreaKey =
  | 'infrastructure'
  | 'education'
  | 'security'
  | 'wellbeing'
  | 'entertainment'
  | 'tourism';

export type ModalTab = 'budget' | 'finances' | 'emergencies' | 'report';

export type EmergencyActionId =
  | 'sports_center_project'
  | 'clean_energy_project'
  | 'bus_transit_project'
  | 'hospital_project'
  | 'airport_evolution'
  | 'tech_university_project'
  | 'shopping_evolution'
  | 'amusement_park_project'
  | 'rail_freight_project'
  | 'metro_transit_project'
  | 'port_evolution'
  | 'toll_plaza_project'
  | 'environmental_cleanup'
  | 'revitalization'
  | 'tourism_festival'
  | 'emergency_roadworks'
  | 'landmark_project'
  | 'incident_response';

export type MapFilter = 'normal' | 'pollution' | 'value';

export type SimSpeed = 0 | 1 | 2 | 4;

export type AppScreenState = 'title' | 'playing' | 'paused';

export type CameraRotation = 0 | 1 | 2 | 3;

export type SeasonId = 'summer' | 'autumn' | 'winter' | 'spring';

export type SeasonMode = 'auto' | SeasonId;

export type WeatherKind = 'clear' | 'partly_cloudy' | 'rain' | 'storm' | 'snow';

export interface WeatherState {
  season: SeasonId;
  kind: WeatherKind;
  /** 0..1 visual & atmospheric intensity */
  intensity: number;
  /** 0..1 ambient snow cover (builds in winter, melts in spring) */
  snowCover: number;
  /** Simulated outdoor temperature in Celsius */
  temperatureC: number;
  /** Horizontal wind bias (-1..1) for rain/snow/leaf drift */
  windX: number;
  /** Simulation seconds remaining until next weather evaluation */
  nextChangeSec: number;
}

export type ExternalHighwayEdge = 'north' | 'south' | 'east' | 'west';

export interface ExternalHighwayState {
  edge: ExternalHighwayEdge;
  /** Road tile touching the outer map border (Portal de Entrada/Saída) */
  borderX: number;
  borderY: number;
  /** Dedicated highway tile reserved for the Toll Plaza (Pedágio) */
  tollX: number;
  tollY: number;
}

export interface RailCorridorState {
  /** Cross-map direction: 'ns' (North <-> South along column `lineCoord`) or 'ew' (West <-> East along row `lineCoord`) */
  axis: 'ns' | 'ew';
  /** Column X (for 'ns') or row Y (for 'ew') where the continuous edge-to-edge railway runs */
  lineCoord: number;
  /** Anchor coordinates of the Train Station (`rail_terminal`) situated along the corridor */
  stationAnchorX: number;
  stationAnchorY: number;
  /** Current station tier: 1 = 2x4 initial station, 2 = 4x8 central station */
  stationLevel: 1 | 2;
}

export type TollTariffLevel = 'low' | 'medium' | 'high';

export interface TollTariffSpec {
  id: TollTariffLevel;
  label: string;
  shortLabel: string;
  feePerVehicle: number;
  visitorFlowMult: number;
  tourismMult: number;
  happinessDelta: number;
  accentColor: string;
  description: string;
}

export interface TollPlazaState {
  built: boolean;
  tariff: TollTariffLevel;
  /** Effective visitor flow percentage (e.g. 100%, 82%, 58%) */
  visitorFlowPct: number;
  /** Estimated external vehicles charged per month */
  monthlyVehicles: number;
  /** Monthly toll revenue ($/mês) */
  monthlyRevenue: number;
}

export type CondoPolicy = 'manual' | 'auto';

export type EconomicEventId = 'recession' | 'inflation' | 'economic_boom';
export type UrbanIncidentId = 'severe_storm' | 'blackout' | 'urgent_repairs';
export type RandomEventChannel = 'economic' | 'urban';

export interface ActiveCityEvent {
  id: EconomicEventId | UrbanIncidentId;
  channel: RandomEventChannel;
  title: string;
  summary: string;
  effectHint: string;
  accentColor: string;
  remainingMonths: number;
  totalMonths: number;
  /** Optional emergency repair/mitigation cost for urban incidents */
  repairCost?: number;
}

export interface CameraState {
  /** World-space isometric pixel pan offset X */
  panX: number;
  /** World-space isometric pixel pan offset Y */
  panY: number;
  /** Zoom scale (0.35 = far overview, 3.0 = street close-up) */
  zoom: number;
  /** 90-degree clockwise isometric rotation step */
  rotation: CameraRotation;
}

export interface Tile {
  x: number;
  y: number;
  type: TileType;
  /** 1..4 for residential/commercial/bridge; 1..3 for port/airport; for road: 1=Rua, 2=Avenida, 3=Estrada, 4=Trevo; 0 otherwise */
  level: number;
  /** Visual variant index (0..7) so neighboring buildings have distinct architectural styles */
  variant: number;
  /** Local pollution 0..100 */
  pollution: number;
  /** Local land value / wealth 0..100 */
  landValue: number;
  /** Age in growth cycles since placed or upgraded */
  age: number;
  /** Sustained progression points (0..180+) accumulated continuously only while favorable conditions hold */
  evolutionProgress?: number;
  /** Remaining growth cycles before this building can resume accumulating evolution progress */
  upgradeCooldown?: number;
  /** Remaining flash timer (seconds) when newly built or evolved */
  evolveFlash: number;
  /** Original zone before becoming abandoned (allows recovery) */
  previousType?: 'rural' | 'residential' | 'commercial' | 'industrial';
  /** Optional specialized establishment ID (one of the 20 iconic reference establishments) */
  establishmentId?: EstablishmentId;
  /** Multi-tile building/establishment compound metadata (e.g. 1x1, 2x1, 1x2, 2x2, 3x2, 3x3, 4x3, 4x8, 8x16) */
  lotRole?: 'single' | 'anchor' | 'part';
  lotWidth?: number;
  lotHeight?: number;
  /** Relative offset (0..lotWidth-1, 0..lotHeight-1) from the compound's top-left anchor tile */
  lotDx?: number;
  lotDy?: number;
  /** Per-building visual rotation step (0..3) so duplicate structures on the map look distinct */
  lotRotation?: 0 | 1 | 2 | 3;
  /** Active multi-month public work construction/upgrade reservation on this tile */
  construction?: TileConstructionMeta;
}

export interface TileConstructionMeta {
  workId: string;
  actionId: EmergencyActionId;
  title: string;
  targetType: TileType;
  targetLevel: number;
  targetEstablishmentId?: EstablishmentId;
  isUpgrade?: boolean;
  lotWidth: number;
  lotHeight: number;
  lotDx: number;
  lotDy: number;
  totalMonths: number;
  remainingMonths: number;
}

export interface PendingConstructionWork {
  id: string;
  actionId: EmergencyActionId;
  tier: number;
  title: string;
  totalMonths: number;
  remainingMonths: number;
  anchorX?: number;
  anchorY?: number;
  lotWidth?: number;
  lotHeight?: number;
  targetType?: TileType;
  targetLevel?: number;
  targetEstablishmentId?: EstablishmentId;
  targetCoords?: Array<{ x: number; y: number }>;
  isUpgrade?: boolean;
  variant?: number;
  /** Visual rotation assigned to the completed building/compound */
  lotRotation?: 0 | 1 | 2 | 3;
  /** Planned cross-map railroad corridor metadata when constructing/upgrading the Train Station */
  railAxis?: 'ns' | 'ew';
  railLineCoord?: number;
}

export type CityBudgets = Record<BudgetAreaKey, number>;

export interface BudgetAreaStatus {
  invested: number;
  needed: number;
  /** Percentage 0..200 (100 = fully funded) */
  coveragePct: number;
  /** Locked target percentage of necessity (0..200) that auto-scales dollar investment as city grows */
  targetPct: number;
  /** 0..100 breakthrough evolution charge when funded far above normal (>=140%) */
  breakthroughPct: number;
}

export interface CityStats {
  population: number;
  avgPollution: number;
  happiness: number; // 0..100
  serviceCoverageAvg: number; // 0..100 média de Educação, Saúde & Meio Ambiente, Segurança e Cultura & Lazer
  budgetTotal: number;
  tourismRevenue: number;
  tradeRevenue: number;
  ruralCount: number;
  residentialCount: number;
  /** Residential zones by land-value / wealth tier */
  resLowValueCount: number;
  resMedValueCount: number;
  resHighValueCount: number;
  commercialCount: number;
  industrialCount: number;
  parkCount: number;
  abandonedCount: number;
  /** Multi-tile compound count (2x1, 1x2, 2x2 buildings & mega-complexes) */
  multiTileBuildingCount: number;
  /** Total count of active specialized civic/cultural/commercial establishments (from the 20 catalog types) */
  establishmentCount: number;
  roadCount: number;
  /** Road hierarchy breakdown */
  streetCount: number;
  avenueCount: number;
  highwayCount: number;
  interchangeCount: number;
  bridgeCount: number;
  /** Number of distinct river crossings */
  bridgeSpanCount: number;
  /** Current architectural evolution level of river bridges (1..4; Nv. 4 = 2-tile-wide Mega-Bridge) */
  bridgeLevel: number;
  portCount: number;
  airportCount: number;
  stadiumCount: number;
  sportsCenterCount: number;
  busStationCount: number;
  metroStationCount: number;
  shoppingCount: number;
  shoppingLevel: number;
  cleanEnergyCount: number;
  cleanEnergyLevel: number;
  hospitalCount: number;
  universityCount: number;
  amusementParkCount: number;
  railTerminalCount: number;
  railTerminalLevel: number;
  helipadCount: number;
  wideAvenueTileCount: number;
  monthlyTransitRiders: number;
  transitCoveragePct: number;
  condoCount: number;
  midRiseCount: number;
  level3Count: number;
  visitorTrafficPct: number;
  coverage: Record<BudgetAreaKey, BudgetAreaStatus>;
  /** Live RCI (Residencial / Comercial / Industrial) demand & cause-effect balance state */
  rciDemand: RciDemandState;
}

export interface RciSectorDemand {
  /** Net demand score from -100 (êxodo/abandono) to +100 (alta procura) */
  demand: number;
  /** Short status label: 'Alta' | 'Moderada' | 'Estável' | 'Fraca' | 'Êxodo' */
  statusLabel: string;
  /** Clear cause-and-effect explanation for why this sector is growing or shrinking */
  reason: string;
  /** Contribution from this sector's tax rate */
  taxEffect: number;
  /** Contribution from workforce / jobs / supply-chain balance */
  balanceEffect: number;
}

export interface RciDemandState {
  residential: RciSectorDemand;
  commercial: RciSectorDemand;
  industrial: RciSectorDemand;
  /** Active working-age population seeking employment */
  workforce: number;
  /** Jobs provided by commercial stores, offices, malls & civic services */
  commercialJobs: number;
  /** Jobs provided by industrial plants, ports, rail & energy */
  industrialJobs: number;
  /** Combined jobs available across the city */
  totalJobs: number;
  /** Percentage of workforce covered by available jobs (100% = balanced) */
  employmentRatioPct: number;
  /** One-line summary of the dominant cause-effect dynamic in the city */
  summary: string;
}

export interface TaxRates {
  /** 0..25 (%) */
  residential: number;
  /** 0..25 (%) */
  commercial: number;
  /** 0..25 (%) */
  industrial: number;
}

export interface MonthlyFinancials {
  revenue: {
    residentialTax: number;
    commercialTax: number;
    industrialTax: number;
    tourismIncome: number;
    tradeIncome: number;
    tollIncome: number;
    total: number;
  };
  expenses: {
    variableBudgets: number;
    fixedRoadsAndBridges: number;
    fixedCityHall: number;
    fixedTotal: number;
    total: number;
  };
  netBalance: number;
  /** Fair tolerated tax rate (%) based on city service coverage */
  fairTaxRate: number;
  /** Active event multiplier on tax/trade revenue (1.0 normal, <1 recession, >1 boom) */
  eventRevenueMult: number;
  /** Active event multiplier on fixed/construction costs (1.0 normal, >1 inflation/repairs) */
  eventExpenseMult: number;
}

export interface CityBoost {
  id: string;
  actionId: EmergencyActionId;
  label: string;
  tier: number;
  remainingMonths: number;
  totalMonths?: number;
}

export interface EmergencyOfferView {
  id: EmergencyActionId;
  tier: number; // 1..4+ (next tier to approve, or maxTier when fully approved)
  tierLabel: string; // Fase I, Fase II, ...
  title: string;
  summary: string;
  effectHint: string;
  nextEvolutionHint: string;
  cost: number;
  durationMonths: number;
  accentColor: string;
  unlocked: boolean;
  minPopulation?: number;
  lockReason?: string;
  inProgress?: boolean;
  remainingMonths?: number;
  totalMonths?: number;
  /** Highest evolution tier already approved by the mayor (0 = none approved yet) */
  approvedTier?: number;
  /** Maximum evolution tiers in this line */
  maxTier?: number;
  /** True once all evolution tiers in this line have been approved (cannot be re-purchased) */
  fullyApproved?: boolean;
  /** Linked Budget/Investment area that funds automatic unit construction & scales monthly cost */
  investmentArea?: BudgetAreaKey;
  /** Monthly investment requirement increase added when this tier is approved */
  monthlyNeedIncrease?: number;
  /** Investment reserve cost deducted each time the city constructs a unit from this line */
  unitInvestmentCost?: number;
  /** Current accumulated balance in the linked investment fund */
  investmentFundBalance?: number;
  /** Current coverage percentage of the linked investment area (must be >= 100% to build) */
  investmentCoveragePct?: number;
}

export interface LandExpansionStatus {
  direction: ExpandDirection;
  label: string;
  expansionsDone: number;
  maxExpansions: number;
  cost: number;
  canExpand: boolean;
}

export interface MonthlyHistoryPoint {
  dateLabel: string;
  month: number;
  year: number;
  population: number;
  money: number;
  revenue: number;
  expenses: number;
  netBalance: number;
  happiness: number;
  migrationDelta: number;
}

export interface CityNeedItem {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  targetTab: ModalTab;
}

export type CivicMilestoneKind =
  | 'port'
  | 'bridge'
  | 'sports'
  | 'bus'
  | 'metro'
  | 'shopping'
  | 'stadium'
  | 'airport'
  | 'toll'
  | 'clean_energy'
  | 'hospital'
  | 'university'
  | 'amusement'
  | 'rail'
  | 'megapolis';

export type MandateMissionId =
  | 'mission_local_market'
  | 'mission_clean_energy'
  | 'mission_hospital_care'
  | 'mission_tech_campus'
  | 'mission_amusement_wheel'
  | 'mission_freight_corridor'
  | 'mission_skyline_helipads'
  | 'mission_stadium_match_night';

export interface MandateMissionStatus {
  id: MandateMissionId;
  title: string;
  categoryLabel: string;
  description: string;
  rewardCash: number;
  accentColor: string;
  progressPct: number;
  progressLabel: string;
  currentValue: number;
  targetValue: number;
  completed: boolean;
  claimed: boolean;
}

export interface CivicMilestoneStatus {
  id: string;
  populationTarget: number;
  kind: CivicMilestoneKind;
  title: string;
  subtitle: string;
  rewardCash: number;
  unlocked: boolean;
  progressPct: number;
  actionId?: EmergencyActionId;
  built?: boolean;
}

export interface MilestoneBanner {
  id: string;
  kind: CivicMilestoneKind;
  populationTarget: number;
  title: string;
  subtitle: string;
  rewardCash: number;
  triggeredAtTick: number;
  actionId?: EmergencyActionId;
}

export type CityTraitId =
  | 'gold_rush'
  | 'fertile_soil'
  | 'tech_boom'
  | 'tourist_climate'
  | 'initial_crisis'
  | 'industrial_heart';

export interface CityTraitModifiers {
  startingMoneyBonus: number;
  taxMultiplier: number;
  roadExpandMultiplier: number;
  residentialWeightMultiplier: number;
  commercialWeightMultiplier: number;
  industrialWeightMultiplier: number;
  parkWeightMultiplier: number;
  upgradeMultiplier: number;
  decayMultiplier: number;
  pollutionMultiplier: number;
  happinessBonus: number;
}

export type DifficultyLevel = 'easy' | 'medium' | 'hard';

export interface DifficultyConfig {
  id: DifficultyLevel;
  label: string;
  shortLabel: string;
  tagline: string;
  description: string;
  budgetHint: string;
  accentColor: string;
  startingMoneyMultiplier: number;
  taxRevenueMultiplier: number;
  budgetNeedMultiplier: number;
  fixedCostMultiplier: number;
  constructionCostMultiplier: number;
  serviceImpactMultiplier: number;
  fairTaxBonus: number;
  happinessBonus: number;
}

export interface CityTrait {
  id: CityTraitId;
  name: string;
  summary: string;
  accentColor: string;
  modifiers: CityTraitModifiers;
}

export interface NewsItem {
  id: number;
  tick: number;
  dateLabel: string;
  text: string;
  tone: 'info' | 'good' | 'warning' | 'milestone';
}

export interface CarEntity {
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  progress: number;
  speed: number;
  color: string;
  laneOffset: number;
  kind?: VehicleKind;
  /** Distinguishes city commuters, external highway visitors, and industrial-port freight convoys */
  role?: 'local' | 'visitor_in' | 'visitor_out' | 'freight_convoy';
  /** Optional target destination for freight convoys routing between industrial zones, rail terminal, and port */
  targetX?: number;
  targetY?: number;
  /** Secondary container color for articulated freight convoys */
  cargoColor?: string;
  /** Dynamic parking lot lifecycle for vehicles entering, parking, and exiting parking lots */
  parkingState?: 'entering' | 'parked' | 'exiting';
  /** Remaining seconds parked inside the bay before departing back onto the street */
  parkTimer?: number;
  /** Entry/exit road tile coordinates adjacent to the parking lot */
  parkRoadX?: number;
  parkRoadY?: number;
  /** World grid fractional position of the assigned parking stall */
  parkSpotX?: number;
  parkSpotY?: number;
  /** Facing direction vector while parked */
  parkDirX?: number;
  parkDirY?: number;
  /** Compound parking lot key for occupancy tracking */
  parkLotKey?: string;
  /** Assigned stall index within the lot so live cars never overlap */
  parkSlotIdx?: number;
  /** Compound geometry & local visual layout coordinates (u, v) for rotation-accurate stall alignment */
  parkAnchorX?: number;
  parkAnchorY?: number;
  parkLotW?: number;
  parkLotH?: number;
  parkU?: number;
  parkV?: number;
  /** Cooldown seconds after exiting a parking lot before entering another */
  parkCooldown?: number;
}

export type BoatKind = 'small' | 'medium' | 'yacht' | 'cargo' | 'cruise';

export type BoatBehavior =
  | 'river_through'
  | 'cross_shore'
  | 'fishing'
  | 'yacht_party'
  | 'port_shuttle';

export interface BoatEntity {
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  progress: number;
  speed: number;
  hullColor: string;
  cargoColor: string;
  kind?: BoatKind;
  cruisePhase?: 'to_port' | 'to_mouth';
  /** Intentional river activity: crossing shores, leaving downstream/upstream, fishing pause, or anchored yacht leisure */
  behavior?: BoatBehavior;
  /** Remaining seconds anchored/paused on the river (fishing or yacht party) before moving again */
  pauseTimer?: number;
  /** Intentional target tile coordinates for river transit or bank-to-bank crossing */
  targetX?: number;
  targetY?: number;
}

export type PlaneFlightPhase =
  | 'cruise'
  | 'approach'
  | 'landing_roll'
  | 'taxi_to_hangar'
  | 'in_hangar'
  | 'taxi_from_hangar'
  | 'parked'
  | 'takeoff_roll'
  | 'climb';

export interface PlaneEntity {
  /** World grid fractional coordinates */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Altitude in isometric world pixels above ground */
  altitude: number;
  accentColor: string;
  /** Current flight phase: sky overflight vs airport landing/hangar/takeoff lifecycle */
  phase: PlaneFlightPhase;
  /** Elapsed seconds or progress within current landing/takeoff phase */
  phaseTimer: number;
  /** Pitch angle visual offset (-0.25 descent .. +0.35 takeoff/climb) */
  pitch?: number;
  /** Optional assigned airport runway & hangar coordinates */
  runwayX?: number;
  runwayStartY?: number;
  runwayEndY?: number;
  apronX?: number;
  hangarX?: number;
  hangarY?: number;
  /** Cruise direction to resume after takeoff climb */
  exitVx?: number;
  exitVy?: number;
}

export type HelicopterFlightPhase =
  | 'cruise'
  | 'approach'
  | 'descending'
  | 'landed'
  | 'ascending';

export interface HelicopterEntity {
  x: number;
  y: number;
  vx: number;
  vy: number;
  altitude: number;
  rotorAngle: number;
  color: string;
  accentColor: string;
  phase: HelicopterFlightPhase;
  phaseTimer: number;
  targetX?: number;
  targetY?: number;
  targetAlt?: number;
  targetTileKey?: number;
  exitVx?: number;
  exitVy?: number;
}

export interface ParticleEntity {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  kind: 'smoke' | 'sparkle' | 'build' | 'decay' | 'wake';
}

export interface SoundCue {
  type: 'level3' | 'bridge' | 'decay' | 'milestone' | 'monthClose' | 'emergency';
}

export interface CityState {
  seed: number;
  cityName: string;
  saveId: string;
  gridWidth: number;
  gridHeight: number;
  /** Legacy alias kept synced to Math.max(gridWidth, gridHeight) */
  gridSize: number;
  /** Map expansion counts per cardinal direction (0..MAX_EXPANSIONS_PER_SIDE) */
  expansions: Record<ExpandDirection, number>;
  /** Revision incremented when terrain geometry expands so world cache rebuilds immediately */
  mapVersion: number;
  /** Origin coordinates of the urban master road plan (shifted automatically on land expansion) */
  roadOriginX: number;
  roadOriginY: number;
  tiles: Tile[];
  /** Unified city-wide variable monthly investments ($/mês) */
  budgets: CityBudgets;
  /** Target percentage of necessity (0..200+) per segment that automatically scales budgets as city grows */
  budgetTargetsPct: Record<BudgetAreaKey, number>;
  /** Over-investment breakthrough charge (0..100) per budget system */
  breakthroughCharge: Record<BudgetAreaKey, number>;
  /** Total breakthroughs achieved per budget system */
  breakthroughCount: Record<BudgetAreaKey, number>;
  /** Current evolutionary tier (1..4) of each emergency/work line physically built/next to construct */
  workTiers: Record<EmergencyActionId, number>;
  /** Highest evolution tier approved once per line by the mayor (0 = none approved yet) */
  approvedTiers?: Record<EmergencyActionId, number>;
  /** Accumulated capital investment funds per budget segment used to auto-construct approved units */
  investmentFunds?: Record<BudgetAreaKey, number>;
  stats: CityStats;
  trait: CityTrait;
  difficulty: DifficultyLevel;
  money: number;
  taxes: TaxRates;
  financials: MonthlyFinancials;
  totalPopulation: number;
  lastMigrationDelta: number;
  prevMonthPopulation: number;
  globalServiceCoverage: number;
  globalHappiness: number;
  tick: number;
  monthElapsedSec: number;
  month: number; // 1..12
  year: number;
  news: NewsItem[];
  nextNewsId: number;
  activeBoosts: CityBoost[];
  /** Multi-month emergency/civic public works currently under construction */
  pendingWorks: PendingConstructionWork[];
  history: MonthlyHistoryPoint[];
  rngState: number;
  pendingSounds: SoundCue[];
  milestonesReached: Record<string, boolean>;
  /** Mandate missions claimed by the mayor for cash rewards */
  claimedMissions?: Record<string, boolean>;
  /** Remaining months of an active Stadium Match Day event (refletores + fogos + bilheteria) */
  stadiumMatchRemainingMonths?: number;
  /** Total Stadium Match Days hosted during the city's history */
  stadiumMatchesHosted?: number;
  recentMilestoneBanner: MilestoneBanner | null;
  /** Dynamic 4-season & shifting weather simulation state */
  weather: WeatherState;
  /** 'auto' follows calendar months; explicit SeasonId locks a season preview */
  seasonMode?: SeasonMode;
  /** Permanent external regional highway connecting the city to the outside map edge */
  externalHighway: ExternalHighwayState;
  /** Continuous edge-to-edge cross-map railway passing through the Train Station (2x4 -> 4x8) */
  railCorridor?: RailCorridorState | null;
  /** Optional Toll Plaza (Pedágio) built on the external entry road at 20,000+ inhabitants */
  tollPlaza: TollPlazaState;
  /** Controls whether residential Prédios Médios stay mid-rise until manually converted ('manual') or auto-evolve into Condomínios ('auto') */
  condoPolicy: CondoPolicy;
  /** Active random economic cycle event (Recessão, Inflação Temporária, Aquecimento) */
  activeEconomicEvent: ActiveCityEvent | null;
  /** Active random urban incident (Temporal Severo, Apagão Temporário, Reparos Urgentes) */
  activeUrbanIncident: ActiveCityEvent | null;
  /** Cooldown months remaining before the next economic cycle can trigger */
  economicEventCooldownMonths: number;
  /** Cooldown months remaining before the next urban incident can trigger */
  urbanIncidentCooldownMonths: number;
}

export interface HudSnapshot {
  seed: number;
  cityName: string;
  saveId: string;
  gridWidth: number;
  gridHeight: number;
  money: number;
  taxes: TaxRates;
  financials: MonthlyFinancials;
  totalPopulation: number;
  lastMigrationDelta: number;
  globalServiceCoverage: number;
  globalHappiness: number;
  month: number;
  year: number;
  monthProgress: number;
  trait: CityTrait;
  difficulty: DifficultyLevel;
  budgets: CityBudgets;
  budgetTargetsPct: Record<BudgetAreaKey, number>;
  investmentFunds?: Record<BudgetAreaKey, number>;
  approvedTiers?: Record<EmergencyActionId, number>;
  stats: CityStats;
  emergencyOffers: EmergencyOfferView[];
  landExpansions: LandExpansionStatus[];
  civicMilestones: CivicMilestoneStatus[];
  mandateMissions: MandateMissionStatus[];
  stadiumMatchActive: boolean;
  stadiumMatchesHosted: number;
  recentMilestoneBanner: MilestoneBanner | null;
  news: NewsItem[];
  activeBoosts: CityBoost[];
  pendingWorks: PendingConstructionWork[];
  history: MonthlyHistoryPoint[];
  needs: CityNeedItem[];
  tick: number;
  weather: WeatherState;
  seasonMode: SeasonMode;
  externalHighway: ExternalHighwayState;
  tollPlaza: TollPlazaState;
  condoPolicy: CondoPolicy;
  activeEconomicEvent: ActiveCityEvent | null;
  activeUrbanIncident: ActiveCityEvent | null;
  /** Live RCI demand & cause-effect workforce/jobs balance */
  rciDemand: RciDemandState;
}
