import type {
  BudgetAreaKey,
  BudgetAreaStatus,
  CityTrait,
  CivicMilestoneKind,
  DifficultyConfig,
  DifficultyLevel,
  EconomicEventId,
  EmergencyActionId,
  EstablishmentId,
  ExpandDirection,
  MandateMissionId,
  TaxRates,
  TileType,
  TollTariffLevel,
  TollTariffSpec,
  UrbanIncidentId,
} from './types';

export const GRID_SIZE = 36;
export const TILE_PX = 16;

/** Land expansion parameters: players can buy adjacent strips in all 4 directions */
export const LAND_EXPAND_CHUNK = 8;
export const MAX_EXPANSIONS_PER_SIDE = 4; // Up to 68x68!
export const LAND_EXPAND_BASE_COST = 9200;
export const EXPAND_DIRECTIONS: Array<{ dir: ExpandDirection; label: string }> = [
  { dir: 'norte', label: 'Norte' },
  { dir: 'leste', label: 'Leste' },
  { dir: 'sul', label: 'Sul' },
  { dir: 'oeste', label: 'Oeste' },
];

export const START_YEAR = 1994;
export const START_MONTH = 1;
export const INITIAL_MONEY = 3800;

/**
 * Realistic Calendar Pace:
 * - 1x speed: 30.0 seconds per month
 * - 2x speed: 15.0 seconds per month
 * - 4x speed:  7.5 seconds per month
 */
export const SECONDS_PER_MONTH_1X = 30;
export const GROWTH_CYCLES_PER_MONTH = 12;
export const SECONDS_PER_GROWTH_TICK_1X =
  SECONDS_PER_MONTH_1X / GROWTH_CYCLES_PER_MONTH;

export const MIN_TAX_RATE = 0;
export const MAX_TAX_RATE = 25;
export const DEFAULT_TAX_RATES: TaxRates = {
  residential: 9,
  commercial: 9,
  industrial: 9,
};

export const DEFAULT_DIFFICULTY: DifficultyLevel = 'medium';

export const DIFFICULTY_ORDER: DifficultyLevel[] = ['easy', 'medium', 'hard'];

export const DIFFICULTY_CONFIGS: Record<DifficultyLevel, DifficultyConfig> = {
  easy: {
    id: 'easy',
    label: 'Fácil',
    shortLabel: 'FÁCIL',
    tagline: 'Economia generosa e 100% sustentável',
    description:
      'Maior tesouro inicial, arrecadação reforçada (+28%) e custos de manutenção/obras reduzidos (-28%). Permite manter todos os serviços em 100% com folga no caixa.',
    budgetHint:
      'Modo Fácil: custos operacionais reduzidos permitem deixar todos os recursos em 100% com superávit confortável.',
    accentColor: '#66d98c',
    startingMoneyMultiplier: 1.6,
    taxRevenueMultiplier: 1.28,
    budgetNeedMultiplier: 0.72,
    fixedCostMultiplier: 0.72,
    constructionCostMultiplier: 0.75,
    serviceImpactMultiplier: 1.12,
    fairTaxBonus: 1.4,
    happinessBonus: 6,
  },
  medium: {
    id: 'medium',
    label: 'Médio',
    shortLabel: 'MÉDIO',
    tagline: 'Desafio clássico e gestão equilibrada',
    description:
      'Economia padrão equilibrada: exige planejamento de zonas, crescimento contínuo e ajustes pontuais de serviços ou impostos conforme a cidade evolui.',
    budgetHint:
      'Modo Médio: orçamento equilibrado. Manter tudo em 100% exige boa arrecadação, comércio ativo ou ajustes estratégicos.',
    accentColor: '#f5b73b',
    startingMoneyMultiplier: 1.0,
    taxRevenueMultiplier: 1.0,
    budgetNeedMultiplier: 1.0,
    fixedCostMultiplier: 1.0,
    constructionCostMultiplier: 1.0,
    serviceImpactMultiplier: 1.0,
    fairTaxBonus: 0,
    happinessBonus: 0,
  },
  hard: {
    id: 'hard',
    label: 'Difícil',
    shortLabel: 'DIFÍCIL',
    tagline: 'Orçamento rigoroso e trade-offs reais',
    description:
      'Receita mais apertada (-14%), custos operacionais/obras altos (+22% a +30%) e cidadãos exigentes com impostos. Manter tudo em 100% gera déficit — priorize áreas abaixo de 100% para sobreviver.',
    budgetHint:
      'Modo Difícil: deixar todos os recursos em 100% gera déficit mensal! Reduza áreas menos urgentes abaixo de 100% e priorize o essencial.',
    accentColor: '#ff6b6b',
    startingMoneyMultiplier: 0.68,
    taxRevenueMultiplier: 0.92,
    budgetNeedMultiplier: 1.20,
    fixedCostMultiplier: 1.02,
    constructionCostMultiplier: 1.3,
    serviceImpactMultiplier: 0.9,
    fairTaxBonus: -1.0,
    happinessBonus: -5,
  },
};

/**
 * Planned Urban Road Hierarchy (Plano Diretor Viário):
 * - Local streets (Rua, lv 1): every 3 tiles -> crisp 2x2 buildable city blocks
 * - Main boulevards (Avenida, lv 2): central axes (mod 12 === 0)
 * - Expressways / ring highways (Estrada, lv 3): offset arterial ring corridors (mod 12 === 6)
 * - Planned interchanges / roundabouts (Trevo, lv 4): every 6x6 arterial crossing with >= 2 axes
 */
export const ROAD_PLAN_CONFIG = {
  blockStep: 3,
  arterialStep: 6,
  highwayCycle: 12,
  highwayOffset: 6,
};

/** Fixed monthly city hall & infrastructure maintenance rates (scales meaningfully with urban footprint) */
export const FIXED_COSTS_CONFIG = {
  baseCityHall: 120,
  perRoad: 5,
  perBridge: 34,
  perBuilding: 7,
  /** Maintenance discount factor applied to extra footprint tiles (lotRole === 'part') beyond the anchor tile */
  largeFootprintMaintenanceFactor: 0.25,
  perLandmark: 160,
  perTollPlaza: 200,
  perBusStation: 42,
  perMetroStation: 125,
  perShopping: 145,
};

/** Toll Plaza (Pedágio Rodoviário) unlock threshold and 3 adjustable tariff tiers */
export const TOLL_MIN_POPULATION = 20000;
export const STADIUM_POPULATION_INTERVAL = 100000;

/** Sports Center footprints by project tier: 1st Sports Center is 2×2, next Sports Center is 4×4 */
export const SPORTS_CENTER_FOOTPRINT_BY_TIER: Record<1 | 2, { w: number; h: number }> = {
  1: { w: 2, h: 2 },
  2: { w: 4, h: 4 },
};

/** Usina de Energia Limpa: Tier 1 = Usina Solar 2×2, Tier 2 = Parque Eólico & Solar 3×3 */
export const CLEAN_ENERGY_FOOTPRINT_BY_TIER: Record<1 | 2, { w: number; h: number }> = {
  1: { w: 2, h: 2 },
  2: { w: 3, h: 3 },
};

/** Hospital Central & Centro Médico Regional: 3×3 compound with rooftop medical helipad */
export const HOSPITAL_FOOTPRINT_BY_TIER: Record<1 | 2, { w: number; h: number }> = {
  1: { w: 3, h: 3 },
  2: { w: 3, h: 3 },
};

/** Campus Universitário (3×3) & Parque Tecnológico (4×4) */
export const UNIVERSITY_FOOTPRINT_BY_TIER: Record<1 | 2, { w: number; h: number }> = {
  1: { w: 3, h: 3 },
  2: { w: 4, h: 4 },
};

/** Parque de Diversões com Roda-Gigante Iluminada (3×3) & Mundo Temático (4×4) */
export const AMUSEMENT_FOOTPRINT_BY_TIER: Record<1 | 2, { w: number; h: number }> = {
  1: { w: 3, h: 3 },
  2: { w: 4, h: 4 },
};

/** Ferrovia de Carga (3×2) & Monotrilho Elevado Intermodal (3×3) */
export const RAIL_TERMINAL_FOOTPRINT_BY_TIER: Record<1 | 2, { w: number; h: number }> = {
  1: { w: 3, h: 2 },
  2: { w: 3, h: 3 },
};

export const TOLL_TARIFF_ORDER: TollTariffLevel[] = ['low', 'medium', 'high'];

export const TOLL_TARIFF_CONFIGS: Record<TollTariffLevel, TollTariffSpec> = {
  low: {
    id: 'low',
    label: 'Tarifa Baixa',
    shortLabel: 'BAIXA',
    feePerVehicle: 1.6,
    visitorFlowMult: 1.0,
    tourismMult: 1.05,
    happinessDelta: 1,
    accentColor: '#66d98c',
    description: 'Mantém 100% do fluxo de visitantes e estimula o turismo com arrecadação moderada.',
  },
  medium: {
    id: 'medium',
    label: 'Tarifa Média',
    shortLabel: 'MÉDIA',
    feePerVehicle: 2.9,
    visitorFlowMult: 0.82,
    tourismMult: 0.92,
    happinessDelta: -1,
    accentColor: '#f5b73b',
    description: 'Equilíbrio fiscal: arrecadação sólida com leve recuo (-18%) no fluxo de visitantes externos.',
  },
  high: {
    id: 'high',
    label: 'Tarifa Alta',
    shortLabel: 'ALTA',
    feePerVehicle: 4.4,
    visitorFlowMult: 0.58,
    tourismMult: 0.74,
    happinessDelta: -4,
    accentColor: '#ff6b6b',
    description: 'Cobrança máxima por veículo, porém afugenta visitantes (-42%), reduz turismo e gera insatisfação.',
  },
};

/**
 * Hybrid Urban Maturation & Milestone Rules:
 * - Lv. 1 -> Lv. 2: Requires a 12×12 surrounding neighborhood region to reach >= 85% occupancy (>= Lv. 1),
 *   then buildings evolve gradually (scaled by population/map size).
 * - Lv. 2 -> Lv. 3 (Prédios Grandes): Unlocks organically at 10,000 inhabitants inside consolidated 12×12 neighborhoods.
 * - Lv. 3 -> Lv. 4 (Arranha-Céus 2×2 / Mega Condomínios): Unlocks at 30,000 inhabitants alongside a 2×2 Wide Avenue.
 */
export const URBAN_MATURITY_CONFIG = {
  regionSize: 12,
  region12MinFillRatio: 0.85,
  largeBuildingMinPopulation: 10000,
  skyscraperMinPopulation: 30000,
};

/** Residential Mid-Rise (Prédio Médio Nv.2) -> Condomínio (Nv.3 / 2×2 Nv.4) manual conversion parameters */
export const CONDO_CONVERSION_CONFIG = {
  /** Base cost to convert a Prédio Médio (Nv.2) into a Condomínio Residencial (Nv.3) */
  toCondoLv3BaseCost: 2400,
  /** Base cost to consolidate a Condomínio (Nv.3) into a Mega Condomínio 2×2 (Nv.4) */
  toMegaCondoLv4BaseCost: 8500,
  /** Minimum population before Mega Condomínio 2×2 & Arranha-Céus (Lv.4) unlock (Marco de 30.000 hab.) */
  megaCondoMinPopulation: URBAN_MATURITY_CONFIG.skyscraperMinPopulation,
};

export interface RandomEventSpec {
  id: EconomicEventId | UrbanIncidentId;
  channel: 'economic' | 'urban';
  title: string;
  summary: string;
  effectHint: string;
  accentColor: string;
  minMonths: number;
  maxMonths: number;
  revenueMult: number;
  expenseMult: number;
  growthMult: number;
  happinessDelta: number;
  servicePenaltyPct: number;
  baseRepairCost?: number;
}

export const RANDOM_EVENT_SPECS: Record<EconomicEventId | UrbanIncidentId, RandomEventSpec> = {
  recession: {
    id: 'recession',
    channel: 'economic',
    title: 'Recessão Econômica',
    summary: 'Desaceleração regional reduz consumo, arrecadação fiscal e o ritmo de novas obras privadas.',
    effectHint: '-22% receita fiscal · Crescimento urbano lento · -3% felicidade',
    accentColor: '#f59e0b',
    minMonths: 4,
    maxMonths: 7,
    revenueMult: 0.78,
    expenseMult: 1.0,
    growthMult: 0.55,
    happinessDelta: -3,
    servicePenaltyPct: 0,
  },
  inflation: {
    id: 'inflation',
    channel: 'economic',
    title: 'Inflação Temporária',
    summary: 'Alta nos insumos e materiais encarece manutenção viária, custeio municipal e grandes obras.',
    effectHint: '+24% custos fixos e obras · -2% felicidade',
    accentColor: '#fb7185',
    minMonths: 4,
    maxMonths: 6,
    revenueMult: 1.0,
    expenseMult: 1.24,
    growthMult: 0.8,
    happinessDelta: -2,
    servicePenaltyPct: 0,
  },
  economic_boom: {
    id: 'economic_boom',
    channel: 'economic',
    title: 'Aquecimento Econômico',
    summary: 'Ciclo favorável atrai empresas e visitantes, reforçando o comércio e a arrecadação municipal.',
    effectHint: '+14% receita fiscal · Crescimento +25% · +3% felicidade',
    accentColor: '#66d98c',
    minMonths: 3,
    maxMonths: 5,
    revenueMult: 1.14,
    expenseMult: 1.0,
    growthMult: 1.25,
    happinessDelta: 3,
    servicePenaltyPct: 0,
  },
  severe_storm: {
    id: 'severe_storm',
    channel: 'urban',
    title: 'Temporal Severo & Alagamentos',
    summary: 'Chuvas intensas sobrecarregam drenagem e vias arteriais, exigindo manutenção emergencial.',
    effectHint: '+18% manutenção · -12% eficiência viária · -5% felicidade',
    accentColor: '#60a5fa',
    minMonths: 2,
    maxMonths: 3,
    revenueMult: 0.94,
    expenseMult: 1.18,
    growthMult: 0.65,
    happinessDelta: -5,
    servicePenaltyPct: 12,
    baseRepairCost: 2200,
  },
  blackout: {
    id: 'blackout',
    channel: 'urban',
    title: 'Apagão Temporário',
    summary: 'Sobrecarga na rede elétrica derruba a iluminação urbana e reduz temporariamente os serviços públicos.',
    effectHint: '-18% cobertura de serviços · -10% receita · -7% felicidade',
    accentColor: '#c084fc',
    minMonths: 2,
    maxMonths: 3,
    revenueMult: 0.90,
    expenseMult: 1.10,
    growthMult: 0.55,
    happinessDelta: -7,
    servicePenaltyPct: 18,
    baseRepairCost: 2800,
  },
  urgent_repairs: {
    id: 'urgent_repairs',
    channel: 'urban',
    title: 'Reparos Estruturais Urgentes',
    summary: 'Desgaste em galerias, pontes e pavimentação exige intervenção técnica para evitar queda de eficiência.',
    effectHint: '+22% custos de manutenção · -10% serviços · -4% felicidade',
    accentColor: '#fb923c',
    minMonths: 3,
    maxMonths: 4,
    revenueMult: 0.96,
    expenseMult: 1.22,
    growthMult: 0.72,
    happinessDelta: -4,
    servicePenaltyPct: 10,
    baseRepairCost: 2600,
  },
};

export const BUDGET_AREA_ORDER: BudgetAreaKey[] = [
  'infrastructure',
  'education',
  'security',
  'wellbeing',
  'entertainment',
  'tourism',
];

export interface BudgetAreaMeta {
  key: BudgetAreaKey;
  label: string;
  roleTag: string;
  shortDesc: string;
  under100Summary: string;
  at100Summary: string;
  over100Summary: string;
  breakthroughHint: string;
  color: string;
  defaultMonthly: number;
}

/**
 * Diminishing-returns segment performance curve across 0%..200% of calculated need:
 * - <100%: progressive shortfall (e.g. 75% -> 0.72, 50% -> 0.42)
 * - 100%: 1.00 equilibrium
 * - 150%..200%: real bounded bonus (+16% at 150%, capped at +28% at 200%) + accelerated Salto Evolutivo
 */
export function getSegmentEffectCurve(coveragePct: number): {
  coveragePct: number;
  effectiveFactor: number;
  overBonusPct: number;
  band: 'deficit' | 'balanced' | 'over150' | 'over200';
} {
  const clamped = Math.max(0, Math.min(200, coveragePct));
  if (clamped < 100) {
    const ratio = clamped / 100;
    const effectiveFactor = Number(Math.pow(ratio, 1.15).toFixed(4));
    return {
      coveragePct: clamped,
      effectiveFactor,
      overBonusPct: Math.round((effectiveFactor - 1) * 100),
      band: 'deficit',
    };
  }
  if (clamped === 100) {
    return {
      coveragePct: 100,
      effectiveFactor: 1.0,
      overBonusPct: 0,
      band: 'balanced',
    };
  }
  const excess = (clamped - 100) / 100; // 0..1
  const bonus = Math.pow(excess, 0.82) * 0.28; // +15.8% at 150%, +28% cap at 200%
  const effectiveFactor = Number((1.0 + bonus).toFixed(4));
  return {
    coveragePct: clamped,
    effectiveFactor,
    overBonusPct: Math.round(bonus * 100),
    band: clamped >= 175 ? 'over200' : 'over150',
  };
}

export const BUDGET_AREA_META: Record<BudgetAreaKey, BudgetAreaMeta> = {
  infrastructure: {
    key: 'infrastructure',
    label: 'Infraestrutura',
    roleTag: 'Expansão & Densidade',
    shortDesc:
      'Expande malha viária, pontes e verticalização (Nv.3/4). Sem Saúde & Meio Ambiente, mais vias e densidade elevam poluição e tráfego local.',
    under100Summary: 'Freia abertura de ruas/pontes e trava verticalização Nv.3/4.',
    at100Summary: 'Equilíbrio padrão da malha viária e evolução urbana.',
    over100Summary: 'Até +28% ritmo de obras viárias/verticalização (c/ teto) + Salto rápido.',
    breakthroughHint:
      'Próximo Salto: novas avenidas, estradas, trevos, pontes e modernização vertical (150%/200% acelera)',
    color: '#56c2ff',
    defaultMonthly: 360,
  },
  education: {
    key: 'education',
    label: 'Educação',
    roleTag: 'Tecnologia & Renda',
    shortDesc:
      'Impulsiona evolução para perfis limpos/modernos e amplia a base tributária, mas torna cidadãos mais exigentes com impostos e qualidade de serviços.',
    under100Summary: 'Reduz modernização limpa e reduz o retorno tributário.',
    at100Summary: 'Evolução e arrecadação tecnológica equilibradas.',
    over100Summary: 'Até +18% base tributária/limpeza (teto econômico), porém exige impostos menores.',
    breakthroughHint:
      'Próximo Salto: Polo Universitário, inovação limpa e torres modernas (150%/200% acelera)',
    color: '#818cf8',
    defaultMonthly: 300,
  },
  security: {
    key: 'security',
    label: 'Segurança',
    roleTag: 'Estabilidade & Ordem',
    shortDesc:
      'Previne abandono, degradação e incidentes e recupera imóveis vazios. Sem Cultura & Lazer ou Educação, seu ganho de felicidade é contido.',
    under100Summary: 'Aumenta risco de abandono, degradação e lenta recuperação.',
    at100Summary: 'Ordem urbana estável e proteção padrão contra decadência.',
    over100Summary: 'Escudo anti-abandono reforçado e recuperação acelerada (felicidade limitada sem vitalidade).',
    breakthroughHint:
      'Próximo Salto: Cidade Modelo Segura e recuperação total de imóveis (150%/200% acelera)',
    color: '#c28bff',
    defaultMonthly: 290,
  },
  wellbeing: {
    key: 'wellbeing',
    label: 'Saúde & Meio Ambiente',
    roleTag: 'Ar Limpo & Saúde',
    shortDesc:
      'Combate diretamente a poluição, sustenta saúde e felicidade e favorece áreas verdes e recuperação ambiental.',
    under100Summary: 'Poluição acumula rápido, queda de felicidade e menos áreas verdes.',
    at100Summary: 'Controle ambiental e saúde urbana em equilíbrio.',
    over100Summary: 'Até +28% absorção de poluição, mais parques orgânicos e bônus de saúde (+6 pts máx.).',
    breakthroughHint:
      'Próximo Salto: Revolução Ecológica com parques, arborização e ar puro (150%/200% acelera)',
    color: '#66d98c',
    defaultMonthly: 280,
  },
  entertainment: {
    key: 'entertainment',
    label: 'Cultura & Lazer',
    roleTag: 'Vitalidade & Retenção',
    shortDesc:
      'Impulsiona atração e crescimento populacional, vitalidade comercial/noturna e retenção de moradores nos bairros.',
    under100Summary: 'Desacelera chegada de moradores e esfria o comércio noturno.',
    at100Summary: 'Atratividade urbana e ritmo comercial padrão.',
    over100Summary: 'Até +28% atração residencial/comercial, bônus de migração mensal e retenção.',
    breakthroughHint:
      'Próximo Salto: Salto de Cultura & Lazer — cria praças e aquece o comércio (150%/200% acelera)',
    color: '#ff8ec7',
    defaultMonthly: 260,
  },
  tourism: {
    key: 'tourism',
    label: 'Turismo & Comércio',
    roleTag: 'Receita Externa',
    shortDesc:
      'Gera receita externa e atividade comercial. Se Segurança estiver baixa, sofre penalidade e o fluxo intenso adiciona tráfego e custo.',
    under100Summary: 'Retorno turístico reduzido e menor dinamismo comercial.',
    at100Summary: 'Fluxo turístico e receita comercial em equilíbrio.',
    over100Summary: 'Até +28% retorno turístico/comercial (penalizado se Segurança < 85%) + leve pressão viária.',
    breakthroughHint:
      'Próximo Salto: Boom de Turismo & Comércio, visitantes e receita extra (150%/200% acelera)',
    color: '#f5b73b',
    defaultMonthly: 180,
  },
};

export interface EmergencyTierSpec {
  tier: number;
  tierLabel: string;
  title: string;
  summary: string;
  effectHint: string;
  baseCost: number;
  revScalePct: number; // Extra coherent scaling proportional to monthly revenue
  durationMonths: number;
  minPopulation?: number;
}

export interface EmergencyLineSpec {
  id: EmergencyActionId;
  accentColor: string;
  tiers: EmergencyTierSpec[];
}

export const EMERGENCY_LINES: EmergencyLineSpec[] = [
  {
    id: 'port_evolution',
    accentColor: '#38bdf8',
    tiers: [
      {
        tier: 1,
        tierLabel: 'Fase I · Nv. 1',
        title: 'Desbloquear Porto Fluvial (Píer & Farol)',
        summary: 'Constrói o Porto Fluvial Nv. 1 na margem do rio com píer, armazém, guindaste e farol.',
        effectHint: 'Desbloqueia Porto Nv. 1 · Libera navegação de barcos e receita de Comércio Exterior',
        baseCost: 7500,
        revScalePct: 0.26,
        durationMonths: 2,
        minPopulation: 1200,
      },
      {
        tier: 2,
        tierLabel: 'Fase II · Nv. 2',
        title: 'Terminal de Contêineres & Navio Cargueiro',
        summary: 'Evolui o Porto para Nível 2 com navio cargueiro atracado no cais, pátio de contêineres e pórticos duplos.',
        effectHint: 'Evolui Porto para Nv. 2 · +85% receita portuária e nova frota de barcaças no rio',
        baseCost: 24000,
        revScalePct: 0.35,
        durationMonths: 3,
        minPopulation: 8000,
      },
      {
        tier: 3,
        tierLabel: 'Fase III · Nv. 3',
        title: 'Terminal Internacional de Cruzeiros 2×4',
        summary: 'Expande o Porto para 2×4 (Nv. 3) em trecho fluvial livre de pontes para receber navios de cruzeiro de até 2×3.',
        effectHint: 'Expande Porto para 2×4 Nv. 3 · Recebe Cruzeiros de até 2×3 e dobra o comércio marítimo',
        baseCost: 58000,
        revScalePct: 0.45,
        durationMonths: 4,
        minPopulation: 18000,
      },
      {
        tier: 4,
        tierLabel: 'Fase IV · Hub',
        title: 'Zona Franca & Hub Marítimo Global',
        summary: 'Integra toda a orla portuária e o terminal de cruzeiros 2×4 ao comércio mundial, modernizando empresas e indústrias.',
        effectHint: 'Expansão máxima do Porto Nv. 3 (2×4) · Evolui 3 prédios comerciais + bônus comercial (5 meses)',
        baseCost: 96000,
        revScalePct: 0.50,
        durationMonths: 5,
        minPopulation: 28000,
      },
    ],
  },
  {
    id: 'sports_center_project',
    accentColor: '#34d399',
    tiers: [
      {
        tier: 1,
        tierLabel: '1º Centro · 2×2 · 2.000 hab.',
        title: 'Centro de Esporte 2×2',
        summary: 'Constrói o primeiro Centro de Esporte (área 2×2) com ginásio poliesportivo coberto, quadra iluminada e arquibancadas.',
        effectHint: 'Constrói Centro de Esporte 2×2 · +felicidade, saúde e lazer nos bairros',
        baseCost: 8500,
        revScalePct: 0.25,
        durationMonths: 2,
        minPopulation: 2000,
      },
      {
        tier: 2,
        tierLabel: '2º Centro · 4×4 · 6.000 hab.',
        title: 'Complexo de Esporte Olímpico 4×4',
        summary: 'Constrói o próximo Centro de Esporte em área 4×4 com arena coberta, piscina semiolímpica, pista de atletismo e quadras.',
        effectHint: 'Constrói Centro de Esporte 4×4 · +cultura, esporte, saúde e turismo regional',
        baseCost: 16500,
        revScalePct: 0.30,
        durationMonths: 3,
        minPopulation: 6000,
      },
    ],
  },
  {
    id: 'clean_energy_project',
    accentColor: '#4ade80',
    tiers: [
      {
        tier: 1,
        tierLabel: 'Solar 2×2 · 3.200 hab.',
        title: 'Usina de Energia Limpa Solar 2×2',
        summary: 'Constrói a Usina Solar Fotovoltaica 2×2 com painéis espelhados e banco de baterias, reduzindo emissões e custos municipais.',
        effectHint: 'Constrói Usina Solar 2×2 · -12% poluição média e -8% custos fixos da Prefeitura (2 meses)',
        baseCost: 9800,
        revScalePct: 0.26,
        durationMonths: 2,
        minPopulation: 3200,
      },
      {
        tier: 2,
        tierLabel: 'Eólico & Solar 3×3 · 11k hab.',
        title: 'Parque Eólico & Solar Integrado 3×3',
        summary: 'Expande a geração limpa com turbinas eólicas animadas em conjunto com matriz solar 3×3 de alta eficiência.',
        effectHint: 'Constrói Parque Eólico & Solar 3×3 · -20% poluição e -14% custos fixos municipais (3 meses)',
        baseCost: 22500,
        revScalePct: 0.34,
        durationMonths: 3,
        minPopulation: 11000,
      },
    ],
  },
  {
    id: 'bus_transit_project',
    accentColor: '#38bdf8',
    tiers: [
      {
        tier: 1,
        tierLabel: 'Fase I · Marco 4.000 hab.',
        title: 'Sistema de Ônibus Urbano',
        summary: 'Constrói 2 Terminais de Ônibus conectados às avenidas principais e libera a frota municipal circulando pelos bairros.',
        effectHint: '2 Terminais + frota de ônibus urbanos · +felicidade, valorização e fluxo comercial',
        baseCost: 11500,
        revScalePct: 0.28,
        durationMonths: 3,
        minPopulation: 4000,
      },
      {
        tier: 2,
        tierLabel: 'Fase II · Corredor BRT',
        title: 'Corredores Expressos BRT',
        summary: 'Expande a rede com +2 Terminais integrados às avenidas largas 2×2 e amplia a frota de ônibus expressos.',
        effectHint: '+2 Terminais BRT · Mais ônibus circulando e alívio de tráfego nos bairros (4 meses)',
        baseCost: 22000,
        revScalePct: 0.34,
        durationMonths: 4,
        minPopulation: 9000,
      },
      {
        tier: 3,
        tierLabel: 'Fase III · Frota Elétrica',
        title: 'Frota Elétrica Metropolitana',
        summary: 'Instala +2 Terminais modernos e eletrifica os ônibus urbanos, cortando emissões e elevando a qualidade de vida.',
        effectHint: '+2 Terminais Elétricos · Reduz poluição viária e impulsiona turismo e comércio (6 meses)',
        baseCost: 36000,
        revScalePct: 0.40,
        durationMonths: 6,
        minPopulation: 16000,
      },
    ],
  },
  {
    id: 'hospital_project',
    accentColor: '#38bdf8',
    tiers: [
      {
        tier: 1,
        tierLabel: 'Hospital 3×3 · 4.800 hab.',
        title: 'Hospital Central 3×3 (Com Heliponto)',
        summary: 'Constrói o Hospital Central 3×3 com pronto-socorro, torre clínica espelhada e heliponto médico ("H") no topo.',
        effectHint: 'Constrói Hospital Central 3×3 · +5% felicidade, heliponto ativo e valorização nos bairros (3 meses)',
        baseCost: 16500,
        revScalePct: 0.31,
        durationMonths: 3,
        minPopulation: 4800,
      },
      {
        tier: 2,
        tierLabel: 'Centro Médico 3×3 · 15k hab.',
        title: 'Centro Médico Regional & Pesquisa 3×3',
        summary: 'Inaugura o segundo complexo hospitalar 3×3 de alta complexidade com heliponto aeromédico e instituto biomédico.',
        effectHint: 'Constrói Centro Médico Regional 3×3 · +8% felicidade, +saúde e proteção sanitária (4 meses)',
        baseCost: 36000,
        revScalePct: 0.38,
        durationMonths: 4,
        minPopulation: 15000,
      },
    ],
  },
  {
    id: 'airport_evolution',
    accentColor: '#ffe066',
    tiers: [
      {
        tier: 1,
        tierLabel: 'Pequeno · 5k hab.',
        title: 'Aeroporto Pequeno (Regional · 4×10 · Nv. 1)',
        summary: 'Inaugura o Aeroporto Pequeno (4×10) com pista regional, galpões/hangares, torre ATC e acesso rodoviário garantido.',
        effectHint: 'Desbloqueia Aeroporto Pequeno Nv. 1 · Aviões pousam, entram nos hangares e geram receita aérea',
        baseCost: 22000,
        revScalePct: 0.34,
        durationMonths: 3,
        minPopulation: 5000,
      },
      {
        tier: 2,
        tierLabel: 'Médio · 15k hab.',
        title: 'Aeroporto Médio (Nacional · Nv. 2)',
        summary: 'Amplia o aeroporto para porte médio (8×16) com terminal de vidro, galpões duplos e torre de radar ATC.',
        effectHint: 'Expande Aeroporto para Médio Nv. 2 · +90% receita aérea, mais voos e impulso comercial',
        baseCost: 54000,
        revScalePct: 0.44,
        durationMonths: 4,
        minPopulation: 15000,
      },
      {
        tier: 3,
        tierLabel: 'Grande · 30k hab.',
        title: 'Aeroporto Grande (Internacional · Nv. 3)',
        summary: 'Consagra o grande hub internacional com terminal duplo espelhado, fingers de embarque e jatos de longo alcance.',
        effectHint: 'Evolui Aeroporto para Grande Nv. 3 · Dispara turismo global e negócios de alta renda',
        baseCost: 115000,
        revScalePct: 0.55,
        durationMonths: 5,
        minPopulation: 30000,
      },
      {
        tier: 4,
        tierLabel: 'Megahub · 42k hab.',
        title: 'Megahub Aeroespacial & Ponte Aérea Mundial',
        summary: 'Conecta a metrópole às maiores capitais do planeta, erguendo torres corporativas ao redor.',
        effectHint: 'Capacidade aérea máxima · Evolui 4 torres + +18% felicidade (6 meses)',
        baseCost: 180000,
        revScalePct: 0.60,
        durationMonths: 6,
        minPopulation: 42000,
      },
    ],
  },
  {
    id: 'tech_university_project',
    accentColor: '#60a5fa',
    tiers: [
      {
        tier: 1,
        tierLabel: 'Campus 3×3 · 6.500 hab.',
        title: 'Campus Universitário 3×3',
        summary: 'Constrói o Campus Universitário 3×3 com alas acadêmicas espelhadas, domo científico e praça central arborizada.',
        effectHint: 'Constrói Campus Universitário 3×3 · +8% eficiência fiscal comercial/industrial e +educação (3 meses)',
        baseCost: 21000,
        revScalePct: 0.33,
        durationMonths: 3,
        minPopulation: 6500,
      },
      {
        tier: 2,
        tierLabel: 'Parque Tec. 4×4 · 18k hab.',
        title: 'Parque Tecnológico & Inovação 4×4',
        summary: 'Inaugura o Parque Tecnológico 4×4 com laboratórios de P&D, observatório geodésico e heliponto executivo.',
        effectHint: 'Constrói Parque Tecnológico 4×4 · +15% receita de alta tecnologia e heliponto executivo (4 meses)',
        baseCost: 48000,
        revScalePct: 0.42,
        durationMonths: 4,
        minPopulation: 18000,
      },
    ],
  },
  {
    id: 'shopping_evolution',
    accentColor: '#f472b6',
    tiers: [
      {
        tier: 1,
        tierLabel: 'Pequeno 5×5 · 7,5k hab.',
        title: 'Shopping Pequeno (Moderno 5×5 · Nv. 1)',
        summary:
          'Constrói o Shopping Center Moderno Pequeno (5×5) com fachada de vidro espelhado, parte alta panorâmica, claraboia central e estacionamento frontal com vagas.',
        effectHint:
          'Constrói Shopping Pequeno 5×5 · +comércio, +lazer, +turismo e valorização nos bairros (3 meses)',
        baseCost: 26000,
        revScalePct: 0.35,
        durationMonths: 3,
        minPopulation: 7500,
      },
      {
        tier: 2,
        tierLabel: 'Médio 7×7 · 16k hab.',
        title: 'Shopping Médio (Metropolitano 7×7 · Nv. 2)',
        summary:
          'Expande para o Shopping Metropolitano Moderno (7×7) com parte alta elevada, cúpula de vidro em cruz, cinemas multiplex e amplo estacionamento.',
        effectHint:
          'Expande para Shopping Médio 7×7 · +95% receita comercial do shopping, +turismo e +felicidade (4 meses)',
        baseCost: 58000,
        revScalePct: 0.44,
        durationMonths: 4,
        minPopulation: 16000,
      },
      {
        tier: 3,
        tierLabel: 'Grande 9×9 · 26k hab.',
        title: 'Shopping Grande (Grand Megamall 9×9 · Nv. 3)',
        summary:
          'Consagra o Shopping Grande (9×9) em arquitetura moderna com parte alta monumental, domo geodésico de cristal, terraço sky-garden, heliponto VIP e estacionamento.',
        effectHint:
          'Evolui para Shopping Grande 9×9 · Atrai fluxo regional máximo, +turismo global e alta renda (5 meses)',
        baseCost: 108000,
        revScalePct: 0.52,
        durationMonths: 5,
        minPopulation: 26000,
      },
    ],
  },
  {
    id: 'amusement_park_project',
    accentColor: '#f472b6',
    tiers: [
      {
        tier: 1,
        tierLabel: 'Roda-Gigante 3×3 · 8.500 hab.',
        title: 'Parque de Diversões & Roda-Gigante Iluminada 3×3',
        summary: 'Inaugura o Parque de Diversões 3×3 com Roda-Gigante iluminada em neon girando em tempo real, carrossel e montanha-russa.',
        effectHint: 'Constrói Parque de Diversões 3×3 · +6% felicidade, forte salto em turismo e lazer (3 meses)',
        baseCost: 28500,
        revScalePct: 0.36,
        durationMonths: 3,
        minPopulation: 8500,
      },
      {
        tier: 2,
        tierLabel: 'Mundo Temático 4×4 · 22k hab.',
        title: 'Mundo Temático & Roda-Gigante Gigante 4×4',
        summary: 'Expande o entretenimento com o Mundo Temático 4×4, Roda-Gigante monumental e atrações internacionais.',
        effectHint: 'Constrói Mundo Temático 4×4 · +9% felicidade e explosão de visitantes e turismo (4 meses)',
        baseCost: 64000,
        revScalePct: 0.46,
        durationMonths: 4,
        minPopulation: 22000,
      },
    ],
  },
  {
    id: 'rail_freight_project',
    accentColor: '#f97316',
    tiers: [
      {
        tier: 1,
        tierLabel: 'Ferrovia 3×2 · 9.500 hab.',
        title: 'Ferrovia de Carga & Pátio Intermodal 3×2',
        summary: 'Constrói o Pátio Ferroviário Intermodal 3×2 com locomotiva de carga e ativa Comboios de Carga entre a Indústria e o Porto.',
        effectHint: 'Constrói Ferrovia de Carga 3×2 · +35% receita comercial/portuária e comboios de carga no mapa (3 meses)',
        baseCost: 31000,
        revScalePct: 0.38,
        durationMonths: 3,
        minPopulation: 9500,
      },
      {
        tier: 2,
        tierLabel: 'Monotrilho 3×3 · 19k hab.',
        title: 'Monotrilho Elevado & Hub Logístico 3×3',
        summary: 'Amplia para 3×3 integrando ferrovia de carga e viaduto de Monotrilho Elevado de alta capacidade.',
        effectHint: 'Evolui para Monotrilho & Hub 3×3 · +65% receita logística e bônus de mobilidade urbana (4 meses)',
        baseCost: 59000,
        revScalePct: 0.46,
        durationMonths: 4,
        minPopulation: 19000,
      },
    ],
  },
  {
    id: 'metro_transit_project',
    accentColor: '#a855f7',
    tiers: [
      {
        tier: 1,
        tierLabel: 'Fase I · Marco 14.000 hab.',
        title: 'Metrô Metropolitano · Linha 1',
        summary: 'Escava a Linha 1 subterrânea com 2 Estações de Metrô ligando os bairros centrais ao núcleo comercial.',
        effectHint: '2 Estações de Metrô conectadas · Grande valorização imobiliária, menos poluição e alta mobilidade',
        baseCost: 34000,
        revScalePct: 0.42,
        durationMonths: 4,
        minPopulation: 14000,
      },
      {
        tier: 2,
        tierLabel: 'Fase II · Linha 2',
        title: 'Expansão Linha 2 do Metrô',
        summary: 'Inaugura +2 Estações subterrâneas conectando bairros residenciais e o distrito industrial à malha metroviária.',
        effectHint: '+2 Estações de Metrô · Multiplica passageiros e acelera evolução dos bairros (5 meses)',
        baseCost: 52000,
        revScalePct: 0.46,
        durationMonths: 5,
        minPopulation: 21000,
      },
      {
        tier: 3,
        tierLabel: 'Fase III · Malha Total',
        title: 'Malha Metroviária Integrada',
        summary: 'Completa a rede com +2 Estações integradas aos terminais de ônibus e avenidas largas 2×2.',
        effectHint: '+2 Estações Integradas · Cobertura máxima de transporte público e bônus de metrópole (6 meses)',
        baseCost: 72000,
        revScalePct: 0.50,
        durationMonths: 6,
        minPopulation: 28000,
      },
    ],
  },
  {
    id: 'toll_plaza_project',
    accentColor: '#fbbf24',
    tiers: [
      {
        tier: 1,
        tierLabel: 'Marco 20.000 hab.',
        title: 'Praça de Pedágio na Rodovia Externa',
        summary: 'Constrói o Pedágio na rodovia de entrada/saída da cidade com tarifa ajustável (Baixa, Média ou Alta) afetando visitantes e receita.',
        effectHint: 'Instala Pedágio na Rodovia Externa · Nova receita mensal com tarifa configurável em Finanças',
        baseCost: 48000,
        revScalePct: 0.35,
        durationMonths: 0,
        minPopulation: TOLL_MIN_POPULATION,
      },
    ],
  },
  {
    id: 'landmark_project',
    accentColor: '#ff8ec7',
    tiers: [
      {
        tier: 1,
        tierLabel: 'Estádio · 1 / 100k hab.',
        title: 'Grande Estádio Monumental',
        summary: 'Constrói a grande arena esportiva 4×3 com arquibancadas cobertas e torres de refletores (limite de 1 estádio a cada 100.000 habitantes).',
        effectHint: 'Constrói Estádio 4×3 (1 a cada 100 mil hab.) · +felicidade, turismo e prestígio',
        baseCost: 72000,
        revScalePct: 0.45,
        durationMonths: 3,
        minPopulation: 20000,
      },
      {
        tier: 2,
        tierLabel: 'Cultura & Lazer · 25k',
        title: 'Grande Parque de Diversões',
        summary: 'Complexo de entretenimento 3×3 de grande porte atraindo visitantes regionais pela rodovia externa.',
        effectHint: 'Constrói Parque de Diversões 3×3 · Grande salto em turismo e felicidade',
        baseCost: 92000,
        revScalePct: 0.48,
        durationMonths: 4,
        minPopulation: 25000,
      },
      {
        tier: 3,
        tierLabel: 'Novo Estádio · 1 / 100k hab.',
        title: 'Novo Estádio Monumental & Arena Global',
        summary: 'Libera e constrói +1 Estádio Monumental 4×3 a cada novo marco de 100.000 habitantes e moderniza o distrito metropolitano.',
        effectHint: 'Constrói +1 Estádio 4×3 (1 a cada 100 mil hab.) + +16% felicidade e turismo',
        baseCost: 145000,
        revScalePct: 0.55,
        durationMonths: 5,
        minPopulation: 100000,
      },
    ],
  },
];

export interface BudgetCampaignProgramSpec {
  id: 'environmental_cleanup' | 'revitalization' | 'tourism_festival';
  accentColor: string;
  primaryArea: BudgetAreaKey;
  secondaryArea: BudgetAreaKey;
  primaryWeight: number;
  secondaryWeight: number;
  minPrimaryPct: number;
  minSecondaryPct: number;
  minWeightedPct: number;
  summary: string;
  effectHint: string;
  tierTitles: [string, string, string, string];
}

export const BUDGET_CAMPAIGN_PROGRAMS: BudgetCampaignProgramSpec[] = [
  {
    id: 'environmental_cleanup',
    accentColor: '#66d98c',
    primaryArea: 'wellbeing',
    secondaryArea: 'education',
    primaryWeight: 0.65,
    secondaryWeight: 0.35,
    minPrimaryPct: 95,
    minSecondaryPct: 85,
    minWeightedPct: 100,
    summary: 'Limpeza contínua de focos de fumaça e plantio gradual de praças urbanas.',
    effectHint: '-45% a -75% poluição · Cria praças quando a cidade precisa',
    tierTitles: [
      'Mutirão Ambiental',
      'Reflorestamento Metropolitano',
      'Usina de Filtragem Ecológica',
      'Cinturão Verde Carbono Zero',
    ],
  },
  {
    id: 'revitalization',
    accentColor: '#c28bff',
    primaryArea: 'security',
    secondaryArea: 'infrastructure',
    primaryWeight: 0.65,
    secondaryWeight: 0.35,
    minPrimaryPct: 95,
    minSecondaryPct: 85,
    minWeightedPct: 100,
    summary: 'Restaura imóveis abandonados automaticamente e blinda bairros contra degradação.',
    effectHint: 'Recupera imóveis abandonados · Escudo anti-abandono',
    tierTitles: [
      'Reforma de Revitalização',
      'Requalificação de Bairros',
      'Renovação Urbana Integrada',
      'Programa Metrópole Renovada',
    ],
  },
  {
    id: 'tourism_festival',
    accentColor: '#f5b73b',
    primaryArea: 'tourism',
    secondaryArea: 'entertainment',
    primaryWeight: 0.60,
    secondaryWeight: 0.40,
    minPrimaryPct: 95,
    minSecondaryPct: 85,
    minWeightedPct: 100,
    summary: 'Programação cultural e eventos para atrair visitantes e aquecer o comércio.',
    effectHint: 'Turismo +25% a +125% · +felicidade · +fluxo de visitantes',
    tierTitles: [
      'Festival / Campanha Turística',
      'Temporada Cultural & Esportiva',
      'Bienal Internacional',
      'Expo Global & Jogos da Metrópole',
    ],
  },
];

export interface EvaluatedBudgetCampaign {
  spec: BudgetCampaignProgramSpec;
  primaryPct: number;
  secondaryPct: number;
  weightedPct: number;
  eligible: boolean;
  tier: 0 | 1 | 2 | 3 | 4;
  tierTitle: string;
}

export function evaluateBudgetCampaignStatus(
  coverage: Record<BudgetAreaKey, BudgetAreaStatus>,
  money: number
): EvaluatedBudgetCampaign[] {
  return BUDGET_CAMPAIGN_PROGRAMS.map((spec) => {
    const primaryPct = coverage[spec.primaryArea]?.coveragePct ?? 0;
    const secondaryPct = coverage[spec.secondaryArea]?.coveragePct ?? 0;
    const weightedPct = Math.round(
      primaryPct * spec.primaryWeight + secondaryPct * spec.secondaryWeight
    );
    const eligible =
      money >= 0 &&
      primaryPct >= spec.minPrimaryPct &&
      secondaryPct >= spec.minSecondaryPct &&
      weightedPct >= spec.minWeightedPct;

    let tier: 0 | 1 | 2 | 3 | 4 = 0;
    if (eligible) {
      if (weightedPct >= 185) tier = 4;
      else if (weightedPct >= 155) tier = 3;
      else if (weightedPct >= 125) tier = 2;
      else tier = 1;
    }

    return {
      spec,
      primaryPct,
      secondaryPct,
      weightedPct,
      eligible,
      tier,
      tierTitle: tier > 0 ? spec.tierTitles[tier - 1] : spec.tierTitles[0],
    };
  });
}

/** Minimum Manhattan tile distance required between two river bridges */
export const MIN_BRIDGE_SPACING_TILES = 11;

/** Population provided per building tile (higher per-building capacity for realistic 2k -> 30k+ urban scale) */
export const POPULATION_BY_BUILDING = {
  rural: [0, 12, 26, 48],
  residential: [0, 24, 90, 240, 520],
  commercial: [0, 8, 28, 72, 145],
  industrial: [0, 14, 34, 68],
  port: 35,
  airport: 45,
  stadium: 60,
  shopping: 50,
  clean_energy: 20,
  rail_terminal: 38,
};

/** Monthly taxable base per building tile (at 10% tax rate — reduced to prevent runaway millions) */
export const MONTHLY_TAX_BASE_AT_10PCT = {
  rural: [0, 245, 315, 440],
  residential: [0, 255, 395, 740, 1180],
  commercial: [0, 375, 565, 1060, 1650],
  industrial: [0, 495, 630, 920],
};

/** Monthly commercial tax base (at 10% commercial tax) added per Shopping Mall level (Lv. 1–3) */
export const SHOPPING_COMMERCIAL_REVENUE_PER_LEVEL = 1150;

/** Direct pollution source strength emitted by each tile type */
export const POLLUTION_EMISSION = {
  rural: -4,
  industrial: 48,
  road: 3,
  commercialLv3: 6,
  airport: 10,
  port: 8,
  shopping: 4,
  railTerminal: 5,
  parkReduction: -24,
  forestReduction: -10,
  busStationReduction: -8,
  metroStationReduction: -18,
  cleanEnergyReduction: -26,
};

/** Organic growth & breakthrough tuning parameters (calibrated for slower, long-term urban maturation) */
export const GROWTH_CONFIG = {
  evaluationsPerTick: 2,
  baseRoadExpandChance: 0.028,
  infraRoadBonus: 0.056,
  bridgeMinInfraCoverage: 0.52,
  baseBridgeChance: 0.036,
  baseZoneChance: 0.026,
  baseUpgradeChance: 0.015,
  baseRecoveryChance: 0.045,
  dangerPollutionThreshold: 38,
  minAgeForUpgrade: 28,
  minAgeForUpgradeLv3: 60,
  minAgeForUpgradeLv4: 92,
  upgradeCooldownLv1To2: 18,
  upgradeCooldownLv2To3: 40,
  upgradeCooldownLv3To4: 58,
  requiredProgressLv2: 140,
  requiredProgressLv3: 235,
  requiredProgressLv4: 330,
  maxUpgradesPerTick: 1,
  maxCars: 54,
  maxBoats: 7,
  maxPlanes: 5,
  maxHelicopters: 4,
  particlePoolSize: 220,
  /** Coverage % threshold above normal that charges an Evolutionary Breakthrough */
  overInvestThresholdPct: 140,
};

/**
 * Dynamic evolution cap per tick scaled by city population & map area
 * so mid/large metropolises don't bottleneck on 1 building per tick:
 * - <= 5,000 hab.: 1 upgrade/tick
 * - <= 20,000 hab.: 2 upgrades/tick
 * - > 20,000 hab.: 4 upgrades/tick (5 on large expanded maps >= 52×52)
 */
export function getScaledMaxUpgradesPerTick(
  population: number,
  gridWidth: number = GRID_SIZE,
  gridHeight: number = GRID_SIZE
): number {
  const baseByPop = population > 20000 ? 4 : population > 5000 ? 2 : GROWTH_CONFIG.maxUpgradesPerTick;
  const mapBonus = gridWidth * gridHeight >= 52 * 52 && population >= 20000 ? 1 : 0;
  return baseByPop + mapBonus;
}

export const CITY_TRAITS: CityTrait[] = [
  {
    id: 'gold_rush',
    name: 'Febre do Ouro',
    summary: 'Cofre reforçado e arrecadação +20%, mas poluição e abandono crescem mais rápido.',
    accentColor: '#f5b73b',
    modifiers: {
      startingMoneyBonus: 1200,
      taxMultiplier: 1.2,
      roadExpandMultiplier: 1.15,
      residentialWeightMultiplier: 1.0,
      commercialWeightMultiplier: 1.35,
      industrialWeightMultiplier: 1.25,
      parkWeightMultiplier: 0.85,
      upgradeMultiplier: 1.1,
      decayMultiplier: 1.2,
      pollutionMultiplier: 1.15,
      happinessBonus: 0,
    },
  },
  {
    id: 'fertile_soil',
    name: 'Solo Fértil',
    summary: 'Parques surgem com facilidade, poluição dissipa rápido e moradores são mais felizes.',
    accentColor: '#66d98c',
    modifiers: {
      startingMoneyBonus: 400,
      taxMultiplier: 1.0,
      roadExpandMultiplier: 1.0,
      residentialWeightMultiplier: 1.3,
      commercialWeightMultiplier: 0.95,
      industrialWeightMultiplier: 0.8,
      parkWeightMultiplier: 1.6,
      upgradeMultiplier: 1.15,
      decayMultiplier: 0.85,
      pollutionMultiplier: 0.78,
      happinessBonus: 8,
    },
  },
  {
    id: 'tech_boom',
    name: 'Boom Tecnológico',
    summary: 'Comércio moderno e evolução para Nível 3 acelerados, com menos indústrias poluentes.',
    accentColor: '#56c2ff',
    modifiers: {
      startingMoneyBonus: 650,
      taxMultiplier: 1.12,
      roadExpandMultiplier: 1.25,
      residentialWeightMultiplier: 1.05,
      commercialWeightMultiplier: 1.45,
      industrialWeightMultiplier: 0.72,
      parkWeightMultiplier: 1.1,
      upgradeMultiplier: 1.4,
      decayMultiplier: 0.95,
      pollutionMultiplier: 0.9,
      happinessBonus: 4,
    },
  },
  {
    id: 'tourist_climate',
    name: 'Clima Turístico',
    summary: 'Comércio, turismo, lazer e parques florescem com alta felicidade, mas a indústria é menor.',
    accentColor: '#ff8ec7',
    modifiers: {
      startingMoneyBonus: 500,
      taxMultiplier: 1.08,
      roadExpandMultiplier: 1.05,
      residentialWeightMultiplier: 1.15,
      commercialWeightMultiplier: 1.4,
      industrialWeightMultiplier: 0.65,
      parkWeightMultiplier: 1.45,
      upgradeMultiplier: 1.2,
      decayMultiplier: 0.9,
      pollutionMultiplier: 0.95,
      happinessBonus: 10,
    },
  },
  {
    id: 'initial_crisis',
    name: 'Crise Inicial',
    summary: 'Orçamento inicial apertado e risco maior de abandono — exige gestão fiscal precisa.',
    accentColor: '#ff6b6b',
    modifiers: {
      startingMoneyBonus: -1000,
      taxMultiplier: 0.95,
      roadExpandMultiplier: 0.9,
      residentialWeightMultiplier: 0.95,
      commercialWeightMultiplier: 0.9,
      industrialWeightMultiplier: 1.2,
      parkWeightMultiplier: 0.85,
      upgradeMultiplier: 0.95,
      decayMultiplier: 1.3,
      pollutionMultiplier: 1.05,
      happinessBonus: -5,
    },
  },
  {
    id: 'industrial_heart',
    name: 'Polo Siderúrgico',
    summary: 'Expansão viária e fábricas aceleradas geram caixa forte, mas exigem combate à fumaça.',
    accentColor: '#ff9f43',
    modifiers: {
      startingMoneyBonus: 700,
      taxMultiplier: 1.15,
      roadExpandMultiplier: 1.2,
      residentialWeightMultiplier: 0.95,
      commercialWeightMultiplier: 0.95,
      industrialWeightMultiplier: 1.55,
      parkWeightMultiplier: 0.8,
      upgradeMultiplier: 1.05,
      decayMultiplier: 1.05,
      pollutionMultiplier: 1.25,
      happinessBonus: -3,
    },
  },
];

export interface CivicMilestoneDef {
  id: string;
  populationTarget: number;
  kind: CivicMilestoneKind;
  title: string;
  subtitle: string;
  rewardCash: number;
  actionId?: EmergencyActionId;
}

/**
 * Population-based Civic Milestones (1.200 -> 30.000+ inhabitants):
 * Unlock iconic civic projects in Obras; the player chooses when to pay and order construction!
 */
export const CIVIC_MILESTONES: CivicMilestoneDef[] = [
  {
    id: 'civic_port_lv1',
    populationTarget: 1200,
    kind: 'port',
    title: 'Porto Fluvial Nv. 1 Liberado',
    subtitle: 'Libera o Porto Fluvial em Obras — pague e ordene a obra quando quiser iniciar o escoamento fluvial.',
    rewardCash: 1500,
    actionId: 'port_evolution',
  },
  {
    id: 'civic_sports_small',
    populationTarget: 2000,
    kind: 'sports',
    title: 'Centro Esportivo Pequeno Liberado',
    subtitle: 'Aos 2.000 habitantes, libera o Centro Esportivo Pequeno para construção sob seu comando em Obras.',
    rewardCash: 2000,
    actionId: 'sports_center_project',
  },
  {
    id: 'civic_bridge_lv2',
    populationTarget: 3500,
    kind: 'bridge',
    title: 'Pontes de Arcos Metálicos Nv. 2',
    subtitle: 'Aos 3.500 habitantes, as pontes do rio evoluem automaticamente para Arcos de Aço (Nv. 2)!',
    rewardCash: 2500,
  },
  {
    id: 'civic_bus_system',
    populationTarget: 4000,
    kind: 'bus',
    title: 'Sistema de Ônibus Urbano Liberado',
    subtitle: 'Aos 4.000 habitantes, desbloqueia Terminais e a Frota de Ônibus Urbano para construção em Obras!',
    rewardCash: 3000,
    actionId: 'bus_transit_project',
  },
  {
    id: 'civic_airport_lv1',
    populationTarget: 5000,
    kind: 'airport',
    title: 'Aeroporto Pequeno (4×10) Liberado',
    subtitle: 'Aos 5.000 habitantes, desbloqueia o Aeroporto Regional Pequeno (4×10 · Nv. 1) para construção em Obras.',
    rewardCash: 3500,
    actionId: 'airport_evolution',
  },
  {
    id: 'civic_shopping_lv1',
    populationTarget: 7500,
    kind: 'shopping',
    title: 'Shopping Pequeno (5×5) Liberado',
    subtitle: 'Aos 7.500 habitantes, desbloqueia o Shopping Center Moderno Pequeno (5×5 · Nv. 1) para construção em Obras!',
    rewardCash: 4200,
    actionId: 'shopping_evolution',
  },
  {
    id: 'civic_port_lv2',
    populationTarget: 8000,
    kind: 'port',
    title: 'Porto Comercial Nv. 2 Liberado',
    subtitle: 'Libera a expansão para Terminal de Contêineres com navios cargueiros em Obras.',
    rewardCash: 4500,
    actionId: 'port_evolution',
  },
  {
    id: 'civic_vertical_10k',
    populationTarget: URBAN_MATURITY_CONFIG.largeBuildingMinPopulation,
    kind: 'megapolis',
    title: 'Verticalização · Prédios Grandes (Nv. 3)',
    subtitle: 'Aos 10.000 habitantes, libera a evolução orgânica de Prédios Grandes (Nv. 3) em bairros 12×12 já consolidados!',
    rewardCash: 5000,
  },
  {
    id: 'civic_bridge_lv3',
    populationTarget: 12000,
    kind: 'bridge',
    title: 'Pontes Estaiadas Monumentais Nv. 3',
    subtitle: 'Aos 12.000 habitantes, as travessias do rio evoluem automaticamente para Pontes Estaiadas (Nv. 3)!',
    rewardCash: 5500,
  },
  {
    id: 'civic_metro_system',
    populationTarget: 14000,
    kind: 'metro',
    title: 'Sistema de Metrô Metropolitano Liberado',
    subtitle: 'Aos 14.000 habitantes, desbloqueia a Linha 1 do Metrô Subterrâneo e suas Estações em Obras!',
    rewardCash: 6500,
    actionId: 'metro_transit_project',
  },
  {
    id: 'civic_airport_lv2',
    populationTarget: 15000,
    kind: 'airport',
    title: 'Aeroporto Médio Liberado',
    subtitle: 'Aos 15.000 habitantes, libera a ampliação para o Aeroporto Nacional Médio (Nv. 2) em Obras.',
    rewardCash: 7000,
    actionId: 'airport_evolution',
  },
  {
    id: 'civic_shopping_lv2',
    populationTarget: 16000,
    kind: 'shopping',
    title: 'Shopping Médio (7×7) Liberado',
    subtitle: 'Aos 16.000 habitantes, desbloqueia o Shopping Metropolitano Médio (7×7 · Nv. 2) em Obras!',
    rewardCash: 7800,
    actionId: 'shopping_evolution',
  },
  {
    id: 'civic_port_lv3',
    populationTarget: 18000,
    kind: 'port',
    title: 'Porto de Cruzeiros 2×4 Liberado',
    subtitle: 'Desbloqueia o Terminal Internacional de Cruzeiros 2×4 para construção em Obras.',
    rewardCash: 8500,
    actionId: 'port_evolution',
  },
  {
    id: 'civic_toll_20k',
    populationTarget: TOLL_MIN_POPULATION,
    kind: 'toll',
    title: 'Praça de Pedágio na Rodovia Liberada',
    subtitle: 'Aos 20.000 habitantes, libera a Praça de Pedágio na rodovia externa para construção em Obras!',
    rewardCash: 4000,
    actionId: 'toll_plaza_project',
  },
  {
    id: 'civic_stadium_20k',
    populationTarget: 20000,
    kind: 'stadium',
    title: 'Grande Estádio Monumental Liberado',
    subtitle: 'Aos 20.000 habitantes, libera o Grande Estádio 4×3 para construção sob seu comando em Obras!',
    rewardCash: 6000,
    actionId: 'landmark_project',
  },
  {
    id: 'civic_bridge_lv4',
    populationTarget: 22000,
    kind: 'bridge',
    title: 'Megaponte de 2 Espaços (Nv. 4)',
    subtitle: 'Aos 22.000 habitantes, as travessias do rio evoluem automaticamente para Megapontes duplas (Nv. 4)!',
    rewardCash: 11500,
  },
  {
    id: 'civic_shopping_lv3',
    populationTarget: 26000,
    kind: 'shopping',
    title: 'Shopping Grande (9×9) Liberado',
    subtitle: 'Aos 26.000 habitantes, libera o Grand Shopping Megamall (9×9 · Nv. 3) para construção em Obras!',
    rewardCash: 13500,
    actionId: 'shopping_evolution',
  },
  {
    id: 'civic_airport_lv3',
    populationTarget: URBAN_MATURITY_CONFIG.skyscraperMinPopulation,
    kind: 'megapolis',
    title: 'Metrópole 30k · Arranha-Céus & Aeroporto Grande',
    subtitle: 'Aos 30.000 habitantes, libera Arranha-Céus 2×2 (Nv. 4) em Avenidas Largas e o Aeroporto Grande Nv. 3 em Obras!',
    rewardCash: 15000,
    actionId: 'airport_evolution',
  },
];

export const MONTH_NAMES = [
  'Jan',
  'Fev',
  'Mar',
  'Abr',
  'Mai',
  'Jun',
  'Jul',
  'Ago',
  'Set',
  'Out',
  'Nov',
  'Dez',
];

/**
 * Evolving Airport Complex Dimensions:
 * - Level 1 (Primeiro Aeroporto): 4×10 (40 tiles) — Pista Regional de 10 blocos, Pátio, Torre ATC & Galpões
 * - Level 2 (Evoluído): 8×16 (128 tiles) — Pista Expandida, Galpões Duplos, Terminal de Vidro & Radar ATC
 * - Level 3 (Internacional): 8×16 (128 tiles) — Megahub Internacional com Fingers & Pista Iluminada
 */
export const AIRPORT_FOOTPRINT_BY_LEVEL: Record<1 | 2 | 3, { w: number; h: number }> = {
  1: { w: 4, h: 10 },
  2: { w: 8, h: 16 },
  3: { w: 8, h: 16 },
};

/**
 * Evolving Shopping Mall Complex Dimensions (conquistados com marcos de população):
 * - Level 1 (Shopping Pequeno): 5×5 (25 tiles) — Shopping Moderno com estacionamento, parte alta e claraboia (Marco 7.500 hab.)
 * - Level 2 (Shopping Médio): 7×7 (49 tiles) — Shopping Metropolitano com parte alta, cúpula em cruz e amplo estacionamento (Marco 16.000 hab.)
 * - Level 3 (Shopping Grande): 9×9 (81 tiles) — Grand Megamall com parte alta monumental, domo geodésico, sky-garden, heliponto VIP e estacionamento (Marco 26.000 hab.)
 */
export const SHOPPING_FOOTPRINT_BY_LEVEL: Record<1 | 2 | 3, { w: number; h: number }> = {
  1: { w: 5, h: 5 },
  2: { w: 7, h: 7 },
  3: { w: 9, h: 9 },
};

export interface EstablishmentSpec {
  id: EstablishmentId;
  label: string;
  categoryLabel: string;
  hostTileType: TileType;
  hostLevel: number;
  /** Default multi-tile width & height (e.g. 1×1, 2×1, 2×2, 3×2, 3×3, 4×3) */
  footprintW: number;
  footprintH: number;
  /** Minimum distance radius in tiles (Manhattan/Euclidean guard) before another establishment of the same type can be generated */
  minDistanceRadius: number;
  /** Number of visual variations (3 variations per establishment) */
  variationCount: 3;
  /** Primary budget driver that boosts organic emergence */
  driverArea: BudgetAreaKey;
  /** Minimum city population required before this establishment can emerge organically */
  minPopulation: number;
  /** Mandatory shoreline adjacency rule (e.g. Marina na Beira do Rio) */
  requiresWaterAdjacent?: boolean;
  /** Prioritize dense/central urban cores (e.g. Hotel com Piscina no Terraço) */
  prefersCentralDense?: boolean;
  /** Gameplay metrics impact */
  happinessBonus: number;
  landValueBonus: number;
  landValueRadius: number;
  pollutionDelta: number;
  monthlyRevenueBonus: number;
  tourismBonus: number;
  populationBonus: number;
}

/**
 * Complete Catalog of the 20 Iconic Establishments from the Reference Sheet:
 * Each entry defines its 3 architectural variations, distinct multi-tile dimensions (`footprintW × footprintH`),
 * minimum distance radius (`minDistanceRadius`), special terrain rules, and coherent city metrics.
 */
export const ESTABLISHMENT_CATALOG: EstablishmentSpec[] = [
  // ---- Serviços Locais e Cultura/Lazer Frequente (Raio curto) ----
  {
    id: 'fountain_plaza',
    label: 'Praça com Chafariz',
    categoryLabel: 'Serviços Locais & Cultura',
    hostTileType: 'park',
    hostLevel: 1,
    footprintW: 1,
    footprintH: 1,
    minDistanceRadius: 9,
    variationCount: 3,
    driverArea: 'wellbeing',
    minPopulation: 0,
    happinessBonus: 2.0,
    landValueBonus: 18,
    landValueRadius: 3,
    pollutionDelta: -9,
    monthlyRevenueBonus: 60,
    tourismBonus: 55,
    populationBonus: 0,
  },
  {
    id: 'health_clinic',
    label: 'Posto de Saúde',
    categoryLabel: 'Serviços Locais & Saúde',
    hostTileType: 'commercial',
    hostLevel: 1,
    footprintW: 1,
    footprintH: 1,
    minDistanceRadius: 11,
    variationCount: 3,
    driverArea: 'wellbeing',
    minPopulation: 0,
    happinessBonus: 2.5,
    landValueBonus: 15,
    landValueRadius: 3,
    pollutionDelta: -5,
    monthlyRevenueBonus: 70,
    tourismBonus: 18,
    populationBonus: 18,
  },
  {
    id: 'sports_court',
    label: 'Quadra Esportiva',
    categoryLabel: 'Quadra 2×1 & Esporte Local',
    hostTileType: 'park',
    hostLevel: 1,
    footprintW: 2,
    footprintH: 1,
    minDistanceRadius: 8,
    variationCount: 3,
    driverArea: 'entertainment',
    minPopulation: 0,
    happinessBonus: 2.8,
    landValueBonus: 16,
    landValueRadius: 3,
    pollutionDelta: -4,
    monthlyRevenueBonus: 80,
    tourismBonus: 55,
    populationBonus: 12,
  },
  {
    id: 'municipal_school',
    label: 'Escola Municipal',
    categoryLabel: 'Educação Básica',
    hostTileType: 'residential',
    hostLevel: 2,
    footprintW: 2,
    footprintH: 1,
    minDistanceRadius: 13,
    variationCount: 3,
    driverArea: 'education',
    minPopulation: 0,
    happinessBonus: 2.8,
    landValueBonus: 19,
    landValueRadius: 4,
    pollutionDelta: -3,
    monthlyRevenueBonus: 95,
    tourismBonus: 18,
    populationBonus: 36,
  },

  // ---- Serviços de Bairro e Comércio (Raio médio) ----
  {
    id: 'public_library',
    label: 'Biblioteca Pública',
    categoryLabel: 'Educação & Cultura',
    hostTileType: 'commercial',
    hostLevel: 2,
    footprintW: 1,
    footprintH: 1,
    minDistanceRadius: 16,
    variationCount: 3,
    driverArea: 'education',
    minPopulation: 800,
    happinessBonus: 3.0,
    landValueBonus: 20,
    landValueRadius: 4,
    pollutionDelta: -3,
    monthlyRevenueBonus: 115,
    tourismBonus: 55,
    populationBonus: 24,
  },
  {
    id: 'police_station',
    label: 'Delegacia de Polícia',
    categoryLabel: 'Segurança Pública',
    hostTileType: 'commercial',
    hostLevel: 2,
    footprintW: 2,
    footprintH: 1,
    minDistanceRadius: 18,
    variationCount: 3,
    driverArea: 'security',
    minPopulation: 1000,
    happinessBonus: 3.2,
    landValueBonus: 22,
    landValueRadius: 4,
    pollutionDelta: 0,
    monthlyRevenueBonus: 125,
    tourismBonus: 30,
    populationBonus: 28,
  },
  {
    id: 'fire_station',
    label: 'Corpo de Bombeiros',
    categoryLabel: 'Segurança & Emergência',
    hostTileType: 'commercial',
    hostLevel: 2,
    footprintW: 2,
    footprintH: 1,
    minDistanceRadius: 18,
    variationCount: 3,
    driverArea: 'security',
    minPopulation: 1000,
    happinessBonus: 3.2,
    landValueBonus: 20,
    landValueRadius: 4,
    pollutionDelta: -3,
    monthlyRevenueBonus: 120,
    tourismBonus: 25,
    populationBonus: 28,
  },
  {
    id: 'retro_cinema',
    label: 'Cinema Retrô',
    categoryLabel: 'Comércio & Cultura',
    hostTileType: 'commercial',
    hostLevel: 2,
    footprintW: 1,
    footprintH: 1,
    minDistanceRadius: 18,
    variationCount: 3,
    driverArea: 'entertainment',
    minPopulation: 2200,
    happinessBonus: 3.0,
    landValueBonus: 18,
    landValueRadius: 3,
    pollutionDelta: 1,
    monthlyRevenueBonus: 195,
    tourismBonus: 120,
    populationBonus: 26,
  },
  {
    id: 'municipal_market',
    label: 'Mercado',
    categoryLabel: 'Mercado 2×2 · Distribuição Comercial Local',
    hostTileType: 'commercial',
    hostLevel: 1,
    footprintW: 2,
    footprintH: 2,
    minDistanceRadius: 8,
    variationCount: 3,
    driverArea: 'entertainment',
    minPopulation: 0,
    happinessBonus: 2.8,
    landValueBonus: 19,
    landValueRadius: 4,
    pollutionDelta: 1,
    monthlyRevenueBonus: 245,
    tourismBonus: 140,
    populationBonus: 36,
  },
  {
    id: 'rooftop_hotel',
    label: 'Hotel com Piscina no Terraço',
    categoryLabel: 'Hotelaria & Turismo Central',
    hostTileType: 'commercial',
    hostLevel: 3,
    footprintW: 1,
    footprintH: 2,
    minDistanceRadius: 21,
    variationCount: 3,
    driverArea: 'tourism',
    minPopulation: 4500,
    prefersCentralDense: true,
    happinessBonus: 2.8,
    landValueBonus: 25,
    landValueRadius: 4,
    pollutionDelta: 1,
    monthlyRevenueBonus: 310,
    tourismBonus: 260,
    populationBonus: 54,
  },

  // ---- Grandes Infraestruturas e Cultura (Raio amplo) ----
  {
    id: 'general_hospital',
    label: 'Hospital Geral',
    categoryLabel: 'Alta Complexidade Médica',
    hostTileType: 'commercial',
    hostLevel: 3,
    footprintW: 3,
    footprintH: 2,
    minDistanceRadius: 27,
    variationCount: 3,
    driverArea: 'wellbeing',
    minPopulation: 4000,
    happinessBonus: 4.8,
    landValueBonus: 24,
    landValueRadius: 5,
    pollutionDelta: -7,
    monthlyRevenueBonus: 210,
    tourismBonus: 55,
    populationBonus: 72,
  },
  {
    id: 'municipal_theater',
    label: 'Teatro Municipal',
    categoryLabel: 'Alta Cultura & Artes',
    hostTileType: 'commercial',
    hostLevel: 3,
    footprintW: 2,
    footprintH: 2,
    minDistanceRadius: 27,
    variationCount: 3,
    driverArea: 'entertainment',
    minPopulation: 7500,
    happinessBonus: 4.2,
    landValueBonus: 26,
    landValueRadius: 4,
    pollutionDelta: 0,
    monthlyRevenueBonus: 230,
    tourismBonus: 220,
    populationBonus: 42,
  },
  {
    id: 'botanical_garden',
    label: 'Jardim Botânico',
    categoryLabel: 'Meio Ambiente & Ciência',
    hostTileType: 'park',
    hostLevel: 2,
    footprintW: 3,
    footprintH: 2,
    minDistanceRadius: 28,
    variationCount: 3,
    driverArea: 'wellbeing',
    minPopulation: 6000,
    happinessBonus: 4.5,
    landValueBonus: 28,
    landValueRadius: 5,
    pollutionDelta: -18,
    monthlyRevenueBonus: 150,
    tourismBonus: 235,
    populationBonus: 22,
  },
  {
    id: 'modern_art_museum',
    label: 'Museu de Arte Moderna',
    categoryLabel: 'Cultura & Arquitetura',
    hostTileType: 'commercial',
    hostLevel: 3,
    footprintW: 2,
    footprintH: 2,
    minDistanceRadius: 31,
    variationCount: 3,
    driverArea: 'tourism',
    minPopulation: 9000,
    happinessBonus: 4.2,
    landValueBonus: 28,
    landValueRadius: 5,
    pollutionDelta: -3,
    monthlyRevenueBonus: 235,
    tourismBonus: 270,
    populationBonus: 38,
  },
  {
    id: 'municipal_planetarium',
    label: 'Planetário Municipal',
    categoryLabel: 'Ciência & Astronomia',
    hostTileType: 'commercial',
    hostLevel: 3,
    footprintW: 2,
    footprintH: 2,
    minDistanceRadius: 32,
    variationCount: 3,
    driverArea: 'education',
    minPopulation: 12000,
    happinessBonus: 4.4,
    landValueBonus: 26,
    landValueRadius: 5,
    pollutionDelta: -4,
    monthlyRevenueBonus: 205,
    tourismBonus: 245,
    populationBonus: 42,
  },
  {
    id: 'court_of_justice',
    label: 'Tribunal de Justiça',
    categoryLabel: 'Justiça & Cidadania',
    hostTileType: 'commercial',
    hostLevel: 3,
    footprintW: 2,
    footprintH: 2,
    minDistanceRadius: 34,
    variationCount: 3,
    driverArea: 'security',
    minPopulation: 14000,
    happinessBonus: 4.5,
    landValueBonus: 30,
    landValueRadius: 5,
    pollutionDelta: 0,
    monthlyRevenueBonus: 255,
    tourismBonus: 95,
    populationBonus: 54,
  },
  {
    id: 'tech_university',
    label: 'Universidade Tecnológica',
    categoryLabel: 'Ensino Superior & Inovação',
    hostTileType: 'commercial',
    hostLevel: 3,
    footprintW: 3,
    footprintH: 3,
    minDistanceRadius: 36,
    variationCount: 3,
    driverArea: 'education',
    minPopulation: 10000,
    happinessBonus: 5.0,
    landValueBonus: 32,
    landValueRadius: 5,
    pollutionDelta: -10,
    monthlyRevenueBonus: 340,
    tourismBonus: 165,
    populationBonus: 95,
  },

  // ---- Marcos Urbanos e Terreno Específico (Raio grande / Regras especiais) ----
  {
    id: 'river_marina',
    label: 'Marina na Beira do Rio',
    categoryLabel: 'Orla Fluvial & Náutica',
    hostTileType: 'park',
    hostLevel: 2,
    footprintW: 2,
    footprintH: 1,
    minDistanceRadius: 21,
    variationCount: 3,
    driverArea: 'tourism',
    minPopulation: 3200,
    requiresWaterAdjacent: true,
    happinessBonus: 3.8,
    landValueBonus: 26,
    landValueRadius: 4,
    pollutionDelta: -4,
    monthlyRevenueBonus: 270,
    tourismBonus: 290,
    populationBonus: 28,
  },
  {
    id: 'amusement_park',
    label: 'Parque de Diversões',
    categoryLabel: 'Grande Marco de Cultura & Lazer',
    hostTileType: 'park',
    hostLevel: 3,
    footprintW: 3,
    footprintH: 3,
    minDistanceRadius: 52,
    variationCount: 3,
    driverArea: 'entertainment',
    minPopulation: 25000,
    happinessBonus: 6.5,
    landValueBonus: 28,
    landValueRadius: 5,
    pollutionDelta: 2,
    monthlyRevenueBonus: 380,
    tourismBonus: 420,
    populationBonus: 65,
  },
  {
    id: 'soccer_stadium',
    label: 'Estádio de Futebol',
    categoryLabel: 'Grande Marco Esportivo',
    hostTileType: 'stadium',
    hostLevel: 1,
    footprintW: 4,
    footprintH: 3,
    minDistanceRadius: 56,
    variationCount: 3,
    driverArea: 'entertainment',
    minPopulation: 20000,
    happinessBonus: 7.5,
    landValueBonus: 30,
    landValueRadius: 5,
    pollutionDelta: 3,
    monthlyRevenueBonus: 420,
    tourismBonus: 460,
    populationBonus: 95,
  },
];

export const ESTABLISHMENT_MAP: Record<EstablishmentId, EstablishmentSpec> =
  Object.fromEntries(ESTABLISHMENT_CATALOG.map((spec) => [spec.id, spec])) as Record<
    EstablishmentId,
    EstablishmentSpec
  >;

export interface MandateMissionSpec {
  id: MandateMissionId;
  title: string;
  categoryLabel: string;
  description: string;
  rewardCash: number;
  accentColor: string;
}

export const MANDATE_MISSIONS_CATALOG: MandateMissionSpec[] = [
  {
    id: 'mission_local_market',
    title: 'Abastecimento & Esporte de Bairro',
    categoryLabel: '1ª Meta · Comércio & Esporte',
    description: 'Garanta ao menos 1 Mercado 2×2 ativo e inaugure o 1º Centro de Esporte (2×2).',
    rewardCash: 6500,
    accentColor: '#fb923c',
  },
  {
    id: 'mission_clean_energy',
    title: 'Transição para Energia Limpa',
    categoryLabel: '2ª Meta · Sustentabilidade',
    description: 'Construa a Usina Solar 2×2 (ou Parque Eólico 3×3) e mantenha a poluição média em até 22%.',
    rewardCash: 9500,
    accentColor: '#4ade80',
  },
  {
    id: 'mission_hospital_care',
    title: 'Escudo de Saúde Regional 3×3',
    categoryLabel: '3ª Meta · Alta Complexidade',
    description: 'Inaugure o Hospital Central 3×3 com heliponto médico e cobertura de Saúde/Bem-Estar ≥ 95%.',
    rewardCash: 12500,
    accentColor: '#38bdf8',
  },
  {
    id: 'mission_tech_campus',
    title: 'Polo Universitário & Tecnológico',
    categoryLabel: '4ª Meta · Inovação & P&D',
    description: 'Construa o Campus Universitário 3×3 (ou Parque Tecnológico 4×4) com Educação ≥ 95%.',
    rewardCash: 15500,
    accentColor: '#60a5fa',
  },
  {
    id: 'mission_amusement_wheel',
    title: 'Capital do Turismo & Roda-Gigante',
    categoryLabel: '5ª Meta · Lazer & Turismo',
    description: 'Inaugure o Parque de Diversões com Roda-Gigante Iluminada e alcance 78% de felicidade.',
    rewardCash: 18500,
    accentColor: '#f472b6',
  },
  {
    id: 'mission_freight_corridor',
    title: 'Corredor Logístico Porto-Ferrovia',
    categoryLabel: '6ª Meta · Comboios de Carga',
    description: 'Opere simultaneamente o Porto Fluvial e a Ferrovia de Carga 3×2 integrando a indústria.',
    rewardCash: 22000,
    accentColor: '#f97316',
  },
  {
    id: 'mission_skyline_helipads',
    title: 'Rota Aérea de Helipontos',
    categoryLabel: '7ª Meta · Mobilidade Aérea VIP',
    description: 'Tenha ao menos 3 helipontos ativos na cidade (Hospital 3×3, Parque Tec. 4×4, Shopping 9×9 ou Arranha-céus).',
    rewardCash: 26000,
    accentColor: '#38bdf8',
  },
  {
    id: 'mission_stadium_match_night',
    title: 'Noite de Jogo & Fogos no Estádio',
    categoryLabel: '8ª Meta · Grande Espetáculo',
    description: 'Construa o Grande Estádio Monumental e realize um Dia de Jogo com fogos e refletores.',
    rewardCash: 35000,
    accentColor: '#ffe066',
  },
];



