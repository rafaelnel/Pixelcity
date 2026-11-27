import {
  DIFFICULTY_CONFIGS,
  MAX_TAX_RATE,
  MIN_TAX_RATE,
  TOLL_MIN_POPULATION,
  TOLL_TARIFF_CONFIGS,
  TOLL_TARIFF_ORDER,
} from '../game/simulationConfig';
import type { HudSnapshot, TaxRates, TollTariffLevel } from '../game/types';
import { PixelModal } from './PixelModal';

interface FinancesModalProps {
  hud: HudSnapshot;
  onSetTaxRate: (sector: keyof TaxRates, rate: number) => void;
  onSetTollTariff?: (tariff: TollTariffLevel) => void;
  onClose: () => void;
}

const TAX_SECTORS: Array<{
  key: keyof TaxRates;
  label: string;
  desc: string;
  color: string;
  fairOffset: number;
}> = [
  {
    key: 'residential',
    label: 'Imposto Residencial',
    desc: 'Afeta diretamente a felicidade, chegada ou saída (êxodo) de moradores.',
    color: '#66d98c',
    fairOffset: 0,
  },
  {
    key: 'commercial',
    label: 'Imposto Comercial',
    desc: 'Regula a abertura de lojas, galerias e arranha-céus comerciais.',
    color: '#56c2ff',
    fairOffset: 0.5,
  },
  {
    key: 'industrial',
    label: 'Imposto Industrial',
    desc: 'Controla o apetite de fábricas por novos lotes industriais.',
    color: '#f5b73b',
    fairOffset: 1.0,
  },
];

export function FinancesModal({
  hud,
  onSetTaxRate,
  onSetTollTariff,
  onClose,
}: FinancesModalProps) {
  const fin = hud.financials;
  const netPos = fin.netBalance >= 0;
  const diffCfg = DIFFICULTY_CONFIGS[hud.difficulty];
  const revPct = Math.round((diffCfg.taxRevenueMultiplier - 1) * 100);
  const fixedPct = Math.round((diffCfg.fixedCostMultiplier - 1) * 100);
  const toll = hud.tollPlaza;
  const tollSpec = TOLL_TARIFF_CONFIGS[toll.tariff] ?? TOLL_TARIFF_CONFIGS.medium;

  const getTaxMood = (rate: number, fairLimit: number) => {
    const diff = rate - fairLimit;
    if (diff <= -2) {
      return { text: 'Atrativo (atrai novos moradores/empresas)', color: '#66d98c' };
    }
    if (diff <= 0.8) {
      return { text: 'Justo para os serviços atuais', color: '#56c2ff' };
    }
    if (diff <= 2.4) {
      return { text: 'Pesado (desacelera crescimento)', color: '#f5b73b' };
    }
    return { text: 'Abusivo (causa abandono e saída da cidade!)', color: '#ff6b6b' };
  };

  return (
    <PixelModal
      title="FINANÇAS · IMPOSTOS E EXTRATO MENSAL"
      subtitle={`Modo ${diffCfg.label} · Fechamento automático ao fim de cada mês`}
      accentColor="#f5b73b"
      maxWidthClass="max-w-[820px]"
      onClose={onClose}
      testId="finances-modal"
      headerSummary={
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[14.5px] sm:text-[15.5px] tabular-nums">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span>
              Caixa atual:{' '}
              <strong className="text-[#ffe066]">
                ${hud.money.toLocaleString('pt-BR')}
              </strong>
            </span>
            <span className="text-[#354666]">|</span>
            <span>
              Saldo projetado:{' '}
              <strong
                className={netPos ? 'text-[#66d98c]' : 'text-[#ff6b6b]'}
              >
                {netPos ? '+' : '-'}$
                {Math.abs(fin.netBalance).toLocaleString('pt-BR')}/mês
              </strong>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[#cfd9e8]">
            <span>
              Serviços:{' '}
              <strong
                style={{
                  color:
                    hud.globalServiceCoverage >= 80
                      ? '#66d98c'
                      : hud.globalServiceCoverage >= 55
                        ? '#f5b73b'
                        : '#ff6b6b',
                }}
              >
                {hud.globalServiceCoverage}%
              </strong>
            </span>
            <span>
              Alíquota justa:{' '}
              <strong className="text-[#ffe066]">
                até ~{fin.fairTaxRate.toFixed(1)}%
              </strong>
            </span>
          </div>
        </div>
      }
    >
      {/* Compact Difficulty & Economic Event Strip */}
      <div className="pixel-inset px-3 py-2 mb-3 flex flex-wrap items-center justify-between gap-2 text-[14px] text-[#9eb0c9] tabular-nums">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            data-testid="finances-difficulty-badge"
            className="font-pixel text-[7px] px-1.5 py-0.5 bg-[#0a101b] border"
            style={{
              borderColor: diffCfg.accentColor,
              color: diffCfg.accentColor,
            }}
          >
            MODO {diffCfg.shortLabel}
          </span>
          <span>{diffCfg.tagline}</span>
        </div>
        <span>
          Receita{' '}
          <strong style={{ color: diffCfg.accentColor }}>
            {revPct === 0 ? 'Padrão' : `${revPct > 0 ? '+' : ''}${revPct}%`}
          </strong>{' '}
          · Fixos{' '}
          <strong style={{ color: diffCfg.accentColor }}>
            {fixedPct === 0 ? 'Padrão' : `${fixedPct > 0 ? '+' : ''}${fixedPct}%`}
          </strong>
        </span>
      </div>

      {/* Active Economic Cycle Banner */}
      {hud.activeEconomicEvent ? (
        <div
          data-testid="finances-active-events"
          className="mb-3 px-3 py-2 bg-[#141a2b] border-2 flex flex-wrap items-center justify-between gap-2 text-[15px]"
          style={{ borderColor: hud.activeEconomicEvent.accentColor }}
        >
          <div>
            <span
              className="font-pixel text-[7.5px] mr-2"
              style={{ color: hud.activeEconomicEvent.accentColor }}
            >
              {hud.activeEconomicEvent.title.toUpperCase()}
            </span>
            <span className="text-[#dce6f2]">{hud.activeEconomicEvent.effectHint}</span>
          </div>
          <span className="font-pixel text-[7px] text-[#ffe066] tabular-nums">
            {hud.activeEconomicEvent.remainingMonths}{' '}
            {hud.activeEconomicEvent.remainingMonths === 1 ? 'MÊS' : 'MESES'}
          </span>
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: 3 Tax Sliders (0% to 25%) */}
        <section aria-label="Controle de impostos" className="flex flex-col gap-3">
          <h3 className="font-pixel text-[9px] text-[#ffe066]">
            ALÍQUOTAS DE IMPOSTOS (0% – 25%)
          </h3>

          {TAX_SECTORS.map(({ key, label, desc, color, fairOffset }) => {
            const rate = hud.taxes[key];
            const fairLimit = fin.fairTaxRate + fairOffset;
            const mood = getTaxMood(rate, fairLimit);
            const revVal =
              key === 'residential'
                ? fin.revenue.residentialTax
                : key === 'commercial'
                  ? fin.revenue.commercialTax
                  : fin.revenue.industrialTax;

            return (
              <div
                key={key}
                data-testid={`tax-control-${key}`}
                className="pixel-inset p-3 flex flex-col gap-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-pixel text-[9px]" style={{ color }}>
                    {label}
                  </span>
                  <span className="text-[22px] font-bold text-[#ffe066] tabular-nums leading-none">
                    {rate}%
                  </span>
                </div>

                <p className="text-[15px] text-[#9eb0c9] leading-tight">{desc}</p>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={rate <= MIN_TAX_RATE}
                    aria-label={`Reduzir ${label}`}
                    onClick={() => onSetTaxRate(key, rate - 1)}
                    className="pixel-btn w-9 h-8 bg-[#25314a] text-[#eef2f7] font-bold text-[18px]"
                  >
                    -
                  </button>
                  <input
                    type="range"
                    min={MIN_TAX_RATE}
                    max={MAX_TAX_RATE}
                    step={1}
                    value={rate}
                    aria-label={`${label} em porcentagem`}
                    onChange={(e) => onSetTaxRate(key, Number(e.target.value))}
                    className="pixel-range flex-1"
                  />
                  <button
                    type="button"
                    disabled={rate >= MAX_TAX_RATE}
                    aria-label={`Aumentar ${label}`}
                    onClick={() => onSetTaxRate(key, rate + 1)}
                    className="pixel-btn w-9 h-8 bg-[#2e7d52] text-white font-bold text-[18px]"
                  >
                    +
                  </button>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-1 text-[15px] tabular-nums">
                  <span style={{ color: mood.color }}>{mood.text}</span>
                  <span className="text-[#dce6f2]">
                    Est.: +${revVal.toLocaleString('pt-BR')}/mês
                  </span>
                </div>
              </div>
            );
          })}
        </section>

        {/* Right: Detailed Monthly Financial Statement */}
        <section
          aria-label="Extrato mensal detalhado"
          className="flex flex-col gap-3"
        >
          <h3 className="font-pixel text-[9px] text-[#56c2ff]">
            EXTRATO MENSAL PROJETADO
          </h3>

          <div className="pixel-inset p-3.5 flex flex-col gap-3 text-[18px] tabular-nums">
            {/* Receitas */}
            <div>
              <div className="font-pixel text-[8px] text-[#66d98c] mb-1.5">
                RECEITAS MENSAIS
              </div>
              <div className="space-y-1 text-[#dce6f2]">
                <div className="flex justify-between">
                  <span>Imposto Residencial ({hud.taxes.residential}%)</span>
                  <span className="text-[#66d98c]">
                    +${fin.revenue.residentialTax.toLocaleString('pt-BR')}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Imposto Comercial ({hud.taxes.commercial}%)</span>
                  <span className="text-[#66d98c]">
                    +${fin.revenue.commercialTax.toLocaleString('pt-BR')}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Imposto Industrial ({hud.taxes.industrial}%)</span>
                  <span className="text-[#66d98c]">
                    +${fin.revenue.industrialTax.toLocaleString('pt-BR')}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Receita de Turismo &amp; Comércio</span>
                  <span className="text-[#f5b73b]">
                    +${fin.revenue.tourismIncome.toLocaleString('pt-BR')}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Comércio Portuário / Aéreo</span>
                  <span className="text-[#56c2ff]">
                    +${fin.revenue.tradeIncome.toLocaleString('pt-BR')}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Pedágio Rodoviário</span>
                  <span className="text-[#fbbf24]">
                    +${(fin.revenue.tollIncome ?? 0).toLocaleString('pt-BR')}
                  </span>
                </div>
                <div className="flex justify-between pt-1.5 border-t border-[#263550] font-bold">
                  <span>Total de Receitas</span>
                  <span className="text-[#66d98c]">
                    +${fin.revenue.total.toLocaleString('pt-BR')}/mês
                  </span>
                </div>
              </div>
            </div>

            {/* Despesas */}
            <div className="pt-2 border-t-2 border-[#1f2c44]">
              <div className="font-pixel text-[8px] text-[#ff785a] mb-1.5">
                DESPESAS MENSAIS
              </div>
              <div className="space-y-1 text-[#dce6f2]">
                <div className="flex justify-between">
                  <span>Investimentos Gerais (Variável)</span>
                  <span className="text-[#ff785a]">
                    -${fin.expenses.variableBudgets.toLocaleString('pt-BR')}
                  </span>
                </div>
                <div className="flex justify-between text-[#a7bad4]">
                  <span>Manutenção de Ruas e Pontes (Fixo)</span>
                  <span className="text-[#ff785a]">
                    -${fin.expenses.fixedRoadsAndBridges.toLocaleString('pt-BR')}
                  </span>
                </div>
                <div className="flex justify-between text-[#a7bad4]">
                  <span>Estrutura da Prefeitura (Fixo)</span>
                  <span className="text-[#ff785a]">
                    -${fin.expenses.fixedCityHall.toLocaleString('pt-BR')}
                  </span>
                </div>
                <div className="flex justify-between pt-1.5 border-t border-[#263550] font-bold">
                  <span>Total de Despesas</span>
                  <span className="text-[#ff6b6b]">
                    -${fin.expenses.total.toLocaleString('pt-BR')}/mês
                  </span>
                </div>
              </div>
            </div>

            {/* Net Projected Monthly Balance */}
            <div className="pt-2.5 border-t-2 border-[#334361] flex items-center justify-between">
              <span className="font-pixel text-[9px] text-[#eef2f7]">
                BALANÇO PROJETADO
              </span>
              <span
                data-testid="finances-net-balance"
                className={`text-[24px] font-bold ${
                  netPos ? 'text-[#66d98c]' : 'text-[#ff6b6b]'
                }`}
              >
                {netPos ? '+' : '-'}${Math.abs(fin.netBalance).toLocaleString('pt-BR')}/mês
              </span>
            </div>
          </div>

          {/* External Highway Toll Plaza Control Card */}
          <div
            data-testid="finances-toll-panel"
            className="pixel-inset p-3 flex flex-col gap-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-pixel text-[8px] text-[#fbbf24]">
                PEDÁGIO DA RODOVIA EXTERNA
              </span>
              <span className="font-pixel text-[7px] px-1.5 py-0.5 bg-[#0f1624] border border-[#334361] text-[#66d98c] tabular-nums">
                VISITANTES: {toll.visitorFlowPct}%
              </span>
            </div>

            {toll.built ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[15px] text-[#dce6f2] tabular-nums">
                  <span>
                    Fluxo: <strong>{toll.monthlyVehicles.toLocaleString('pt-BR')}</strong> veíc/mês
                  </span>
                  <span>
                    Receita:{' '}
                    <strong className="text-[#fbbf24]">
                      +${toll.monthlyRevenue.toLocaleString('pt-BR')}/mês
                    </strong>
                  </span>
                </div>

                <div
                  role="group"
                  aria-label="Tarifa do Pedágio Rodoviário"
                  className="grid grid-cols-3 gap-1.5"
                >
                  {TOLL_TARIFF_ORDER.map((level) => {
                    const cfg = TOLL_TARIFF_CONFIGS[level];
                    const active = toll.tariff === level;
                    return (
                      <button
                        key={level}
                        type="button"
                        data-testid={`toll-tariff-${level}`}
                        aria-pressed={active}
                        onClick={() => onSetTollTariff?.(level)}
                        className={`pixel-btn py-1.5 px-2 font-pixel text-[7px] flex flex-col items-center gap-0.5 ${
                          active
                            ? 'bg-[#2a3b5c] text-white ring-2 ring-[#ffe066]'
                            : 'bg-[#141d2e] hover:bg-[#1e2c45] text-[#9eb0c9]'
                        }`}
                      >
                        <span style={{ color: cfg.accentColor }}>{cfg.shortLabel}</span>
                        <span className="font-sans text-[12px] text-[#cfd9e8]">
                          {Math.round(cfg.visitorFlowMult * 100)}% fluxo
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[14px] text-[#9eb0c9] leading-tight">
                  {tollSpec.description}
                </p>
              </>
            ) : (
              <div className="text-[14.5px] text-[#9eb0c9] leading-snug tabular-nums">
                {hud.totalPopulation >= TOLL_MIN_POPULATION ? (
                  <span className="text-[#66d98c]">
                    Marco de {TOLL_MIN_POPULATION.toLocaleString('pt-BR')} hab. atingido! Construa a Praça de Pedágio em <strong>Obras</strong> para iniciar a cobrança de visitantes.
                  </span>
                ) : (
                  <>
                    A rodovia externa já conecta visitantes à cidade. O Pedágio libera em{' '}
                    <strong className="text-[#ffe066]">
                      {TOLL_MIN_POPULATION.toLocaleString('pt-BR')} hab.
                    </strong>{' '}
                    ({hud.totalPopulation.toLocaleString('pt-BR')} /{' '}
                    {TOLL_MIN_POPULATION.toLocaleString('pt-BR')}).
                  </>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </PixelModal>
  );
}
