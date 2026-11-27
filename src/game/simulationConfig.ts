import type {
  BudgetAreaKey,
  CityTrait,
  CivicMilestoneKind,
  DifficultyConfig,
  DifficultyLevel,
  EconomicEventId,
  EmergencyActionId,
  EstablishmentId,
  ExpandDirection,
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
    id: 'sports_center_project',
    accentColor: '#34d399',
    tiers: [
      {
        tier: 1,
        tierLabel: 'Marco 2.000 hab.',
        title: 'Centro Esportivo Pequeno',
        summary: 'Constrói um Centro Esportivo Comunitário (quadra poliesportiva e área de lazer) liberado a partir de 2.000 habitantes.',
        effectHint: 'Constrói Centro Esportivo Pequeno · +felicidade, valorização e lazer nos bairros',
        baseCost: 8500,
        revScalePct: 0.25,
        durationMonths: 2,
        minPopulation: 2000,
      },
      {
        tier: 2,
        tierLabel: 'Ampliação Esportiva',
        title: 'Rede de Centros Esportivos de Bairro',
        summary: 'Instala um novo Centro Esportivo Pequeno em outro bairro da cidade e amplia escolinhas esportivas.',
        effectHint: 'Novo Centro Esportivo Pequeno · +lazer e +turismo local (3 meses)',
        baseCost: 16500,
        revScalePct: 0.30,
        durationMonths: 3,
        minPopulation: 6000,
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
    id: 'shopping_evolution',
    accentColor: '#f472b6',
    tiers: [
      {
        tier: 1,
        tierLabel: 'Pequeno 6×6 · 7,5k hab.',
        title: 'Shopping Pequeno (Galleria 6×6 · Nv. 1)',
        summary:
          'Constrói o Shopping Center Regional Pequeno (6×6) com claraboia central de vidro, praça de alimentação, lojas âncora e estacionamento arborizado.',
        effectHint:
          'Constrói Shopping Pequeno 6×6 · +comércio, +lazer, +turismo e valorização nos bairros (3 meses)',
        baseCost: 26000,
        revScalePct: 0.35,
        durationMonths: 3,
        minPopulation: 7500,
      },
      {
        tier: 2,
        tierLabel: 'Médio 8×8 · 16k hab.',
        title: 'Shopping Médio (Metropolitano 8×8 · Nv. 2)',
        summary:
          'Expande para o Shopping Metropolitano Médio (8×8) com cúpula de vidro em cruz, cinemas multiplex, boulevard iluminado e terraço panorâmico.',
        effectHint:
          'Expande para Shopping Médio 8×8 · +95% receita comercial do shopping, +turismo e +felicidade (4 meses)',
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
          'Consagra o Shopping Grande (9×9) com domo geodésico de cristal, passarelas suspensas, jardins no terraço, heliponto VIP e fontes luminosas.',
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
        tierLabel: 'Estádio · 20k hab.',
        title: 'Grande Estádio Monumental',
        summary: 'Constrói a grande arena esportiva cercada por arquibancadas, liberada apenas para cidades acima de 20.000 habitantes.',
        effectHint: 'Constrói Estádio 4×3 · +felicidade, turismo e prestígio metropolitano',
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
        tierLabel: 'Arena Global · 35k',
        title: 'Distrito Metropolitano & Arena Global',
        summary: 'Programa monumental que moderniza grandes edifícios e consagra a cidade no cenário internacional.',
        effectHint: 'Moderniza 4 grandes edifícios + +16% felicidade e turismo (5 meses)',
        baseCost: 145000,
        revScalePct: 0.55,
        durationMonths: 5,
        minPopulation: 35000,
      },
    ],
  },
  {
    id: 'environmental_cleanup',
    accentColor: '#66d98c',
    tiers: [
      {
        tier: 1,
        tierLabel: 'Fase I',
        title: 'Mutirão Ambiental',
        summary: 'Limpeza rápida de focos de fumaça e plantio de praças urbanas.',
        effectHint: '-45% poluição (3 meses) · Cria até 2 parques',
        baseCost: 2200,
        revScalePct: 0.22,
        durationMonths: 3,
      },
      {
        tier: 2,
        tierLabel: 'Fase II',
        title: 'Reflorestamento Metropolitano',
        summary: 'Corredores verdes integrados e filtros industriais modernos.',
        effectHint: '-60% poluição (4 meses) · Cria até 4 parques · +6% felicidade',
        baseCost: 5600,
        revScalePct: 0.30,
        durationMonths: 4,
      },
      {
        tier: 3,
        tierLabel: 'Fase III',
        title: 'Usina de Filtragem Ecológica',
        summary: 'Engenharia ambiental pesada purificando o ar e valorizando terrenos.',
        effectHint: '-72% poluição (5 meses) · Cria até 6 parques · +10% felicidade',
        baseCost: 14000,
        revScalePct: 0.36,
        durationMonths: 5,
      },
      {
        tier: 4,
        tierLabel: 'Fase IV',
        title: 'Cinturão Verde Carbono Zero',
        summary: 'Programa permanente de biourbanismo de última geração em toda a cidade.',
        effectHint: '-82% poluição (6 meses) · Cria até 8 parques · Grande salto de valor',
        baseCost: 28000,
        revScalePct: 0.42,
        durationMonths: 6,
      },
    ],
  },
  {
    id: 'revitalization',
    accentColor: '#c28bff',
    tiers: [
      {
        tier: 1,
        tierLabel: 'Fase I',
        title: 'Reforma de Revitalização',
        summary: 'Restaura imóveis abandonados e recupera áreas degradadas à vista.',
        effectHint: 'Recupera até 6 imóveis abandonados · Estabilidade (2 meses)',
        baseCost: 2400,
        revScalePct: 0.22,
        durationMonths: 2,
      },
      {
        tier: 2,
        tierLabel: 'Fase II',
        title: 'Requalificação de Bairros',
        summary: 'Restaura imóveis vazios já evoluídos para Prédio Médio (Nv. 2) e blinda a cidade.',
        effectHint: 'Recupera até 10 imóveis (Nv. 2) · Escudo anti-abandono (3 meses)',
        baseCost: 6200,
        revScalePct: 0.30,
        durationMonths: 3,
      },
      {
        tier: 3,
        tierLabel: 'Fase III',
        title: 'Renovação Urbana Integrada',
        summary: 'Reconstrói imóveis abandonados e moderniza edifícios vizinhos.',
        effectHint: 'Recupera todos os abandonados + evolui 2 prédios · Escudo (4 meses)',
        baseCost: 15000,
        revScalePct: 0.36,
        durationMonths: 4,
      },
      {
        tier: 4,
        tierLabel: 'Fase IV',
        title: 'Programa Metrópole Renovada',
        summary: 'Reestruturação completa com edifícios de alto padrão e segurança plena.',
        effectHint: 'Recuperação total em Nv. 2 + evolui 4 prédios · Escudo (6 meses)',
        baseCost: 30000,
        revScalePct: 0.42,
        durationMonths: 6,
      },
    ],
  },
  {
    id: 'tourism_festival',
    accentColor: '#f5b73b',
    tiers: [
      {
        tier: 1,
        tierLabel: 'Fase I',
        title: 'Festival / Campanha Turística',
        summary: 'Programação cultural para atrair visitantes externos e aquecer o comércio.',
        effectHint: 'Turismo +90% · +8% felicidade · +fluxo de visitantes (3 meses)',
        baseCost: 2600,
        revScalePct: 0.24,
        durationMonths: 3,
      },
      {
        tier: 2,
        tierLabel: 'Fase II',
        title: 'Temporada Cultural & Esportiva',
        summary: 'Campeonatos e shows impulsionam lazer, hotéis e arrecadação.',
        effectHint: 'Turismo +130% · +12% felicidade · Mais visitantes na rodovia (4 meses)',
        baseCost: 6800,
        revScalePct: 0.32,
        durationMonths: 4,
      },
      {
        tier: 3,
        tierLabel: 'Fase III',
        title: 'Bienal Internacional',
        summary: 'Evento de porte continental que impulsiona comércio e serviços culturais.',
        effectHint: 'Turismo +175% · +15% felicidade · Evolui comércios (5 meses)',
        baseCost: 16500,
        revScalePct: 0.38,
        durationMonths: 5,
      },
      {
        tier: 4,
        tierLabel: 'Fase IV',
        title: 'Expo Global & Jogos da Metrópole',
        summary: 'Megaevento mundial que transforma a cidade em vitrine internacional.',
        effectHint: 'Turismo +220% · +18% felicidade · Grande onda de evolução (6 meses)',
        baseCost: 34000,
        revScalePct: 0.45,
        durationMonths: 6,
      },
    ],
  },
  {
    id: 'emergency_roadworks',
    accentColor: '#56c2ff',
    tiers: [
      {
        tier: 1,
        tierLabel: 'Fase I · Ponte Nv.1',
        title: 'Obra Viária & Ponte Histórica de Pedra',
        summary: 'Abre novas ruas e constrói ponte de pedra e madeira sobre o rio.',
        effectHint: 'Abre 4 ruas + Ponte Nv. 1 no rio · Expansão viária 1,8x mais rápida (3 meses)',
        baseCost: 2200,
        revScalePct: 0.22,
        durationMonths: 3,
      },
      {
        tier: 2,
        tierLabel: 'Fase II · Ponte Nv.2',
        title: 'Avenidas Expressas & Ponte de Arcos Metálicos',
        summary: 'Moderniza as pontes do rio para Nível 2 com arcos de aço estrutural e abre avenidas largas.',
        effectHint: 'Evolui Pontes para Nv. 2 (Arcos Metálicos) + 6 ruas · Expansão 2,1x (4 meses)',
        baseCost: 7200,
        revScalePct: 0.32,
        durationMonths: 4,
        minPopulation: 3500,
      },
      {
        tier: 3,
        tierLabel: 'Fase III · Ponte Nv.3',
        title: 'Anel Metropolitano & Ponte Estaiada Monumental',
        summary: 'Transforma as pontes em Pontes Estaiadas Nível 3 com torres iluminadas e cabos tensores.',
        effectHint: 'Evolui Pontes para Nv. 3 (Estaiada) + 8 ruas · Evolui 2 prédios (5 meses)',
        baseCost: 21000,
        revScalePct: 0.40,
        durationMonths: 5,
        minPopulation: 12000,
      },
      {
        tier: 4,
        tierLabel: 'Fase IV · Ponte 2× Nv.4',
        title: 'Megaponte Expressa de 2 Espaços (Nv. 4)',
        summary: 'Última evolução de pontes: alarga travessias do rio para 2 espaços de largura (pista dupla monumental) sempre que houver margem livre e abre corredores expressos.',
        effectHint: 'Alarga pontes para 2 espaços de largura (Nv. 4) + 10 ruas + evolui 3 prédios · Logística máxima (6 meses)',
        baseCost: 42000,
        revScalePct: 0.46,
        durationMonths: 6,
        minPopulation: 22000,
      },
    ],
  },
];

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
  parkReduction: -24,
  forestReduction: -10,
  busStationReduction: -8,
  metroStationReduction: -18,
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
  maxBoats: 12,
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
    title: 'Pontes de Arcos Metálicos Nv. 2 Liberadas',
    subtitle: 'Libera a modernização das pontes do rio para Arcos de Aço (Nv. 2) ao investir em Obras.',
    rewardCash: 2500,
    actionId: 'emergency_roadworks',
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
    title: 'Shopping Pequeno (6×6) Liberado',
    subtitle: 'Aos 7.500 habitantes, desbloqueia o Shopping Center Pequeno (6×6 · Nv. 1) para construção em Obras!',
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
    title: 'Pontes Estaiadas Nv. 3 Liberadas',
    subtitle: 'Libera a evolução das travessias do rio para Pontes Estaiadas Monumentais (Nv. 3) em Obras.',
    rewardCash: 5500,
    actionId: 'emergency_roadworks',
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
    title: 'Shopping Médio (8×8) Liberado',
    subtitle: 'Aos 16.000 habitantes, desbloqueia o Shopping Metropolitano Médio (8×8 · Nv. 2) em Obras!',
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
    id: 'civic_stadium_20k',
    populationTarget: 20000,
    kind: 'stadium',
    title: 'Grande Estádio Monumental Liberado',
    subtitle: 'Aos 20.000 habitantes, libera o Grande Estádio 4×3 para construção sob seu comando em Obras!',
    rewardCash: 6000,
    actionId: 'landmark_project',
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
    id: 'civic_bridge_lv4',
    populationTarget: 22000,
    kind: 'bridge',
    title: 'Megaponte de 2 Espaços (Nv. 4) Liberada',
    subtitle: 'Aos 22.000 habitantes, libera a última evolução de pontes: travessias duplas com 2 espaços de largura em Obras!',
    rewardCash: 11500,
    actionId: 'emergency_roadworks',
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
 * - Level 1 (Shopping Pequeno): 6×6 (36 tiles) — Galleria Comercial com claraboia, lojas âncora e estacionamento (Marco 7.500 hab.)
 * - Level 2 (Shopping Médio): 8×8 (64 tiles) — Shopping Metropolitano com cúpula em cruz, cinemas e boulevard (Marco 16.000 hab.)
 * - Level 3 (Shopping Grande): 9×9 (81 tiles) — Grand Megamall com domo geodésico de cristal, sky-garden e heliponto VIP (Marco 26.000 hab.)
 */
export const SHOPPING_FOOTPRINT_BY_LEVEL: Record<1 | 2 | 3, { w: number; h: number }> = {
  1: { w: 6, h: 6 },
  2: { w: 8, h: 8 },
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
    label: 'Centro Esportivo Pequeno',
    categoryLabel: 'Serviços Locais & Esporte',
    hostTileType: 'park',
    hostLevel: 1,
    footprintW: 1,
    footprintH: 1,
    minDistanceRadius: 11,
    variationCount: 3,
    driverArea: 'entertainment',
    minPopulation: 2000,
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
    label: 'Mercado Municipal',
    categoryLabel: 'Comércio & Gastronomia',
    hostTileType: 'commercial',
    hostLevel: 2,
    footprintW: 2,
    footprintH: 2,
    minDistanceRadius: 20,
    variationCount: 3,
    driverArea: 'infrastructure',
    minPopulation: 2600,
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

