import {
  BUDGET_AREA_META,
  BUDGET_AREA_ORDER,
  DIFFICULTY_CONFIGS,
} from '../game/simulationConfig';
import type { BudgetAreaKey, CondoPolicy, HudSnapshot } from '../game/types';
import { PixelModal } from './PixelModal';

interface BudgetModalProps {
  hud: HudSnapshot;
  onSetBudget: (area: BudgetAreaKey, amount: number) => void;
  onSetBudgetTargetPct?: (area: BudgetAreaKey, targetPct: number) => void;
  onSetCondoPolicy?: (policy: CondoPolicy) => void;
  onClose: () => void;
}

export function BudgetModal({
  hud,
  onSetBudget,
  onSetBudgetTargetPct,
  onSetCondoPolicy,
  onClose,
}: BudgetModalProps) {
  const st = hud.stats;
  const diffCfg = DIFFICULTY_CONFIGS[hud.difficulty];
  const needPctDiff = Math.round((diffCfg.budgetNeedMultiplier - 1) * 100);
  const maxMonthlyRevenue = Math.max(1, Math.round(hud.financials.revenue.total));
  const netProjected = hud.financials.netBalance;
  const totalSharePct = Math.round((st.budgetTotal / maxMonthlyRevenue) * 100);

  const covColor = (pct: number) =>
    pct >= 85 ? '#66d98c' : pct >= 55 ? '#f5b73b' : '#ff6b6b';

  const applyTargetPct = (area: BudgetAreaKey, pct: number) => {
    if (onSetBudgetTargetPct) {
      onSetBudgetTargetPct(area, pct);
    } else {
      const needed = st.coverage[area].needed;
      onSetBudget(area, Math.round((needed * pct) / 100));
    }
  };

  const applyAllTargetPct = (pct: number) => {
    for (const areaKey of BUDGET_AREA_ORDER) {
      applyTargetPct(areaKey, pct);
    }
  };

  const overallSegmentAvgPct = Math.round(
    BUDGET_AREA_ORDER.reduce((sum, key) => sum + st.coverage[key].coveragePct, 0) /
      BUDGET_AREA_ORDER.length
  );

  return (
    <PixelModal
      title="ORÇAMENTO GERAL DA CIDADE"
      subtitle={`Meta em % da necessidade (auto-ajustável conforme a cidade cresce) · Receita: $${maxMonthlyRevenue.toLocaleString('pt-BR')}/mês · Saldo projetado: ${netProjected >= 0 ? '+' : '-'}$${Math.abs(netProjected).toLocaleString('pt-BR')}/mês`}
      accentColor="#56c2ff"
      maxWidthClass="max-w-[900px]"
      onClose={onClose}
      testId="budget-modal"
    >
      {/* Unified City Summary Bar */}
      <div className="pixel-inset p-2.5 mb-2.5 grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
        <div>
          <div className="font-pixel text-[7px] text-[#8fa4bf]">RECEITA / MÊS</div>
          <div
            data-testid="budget-max-revenue"
            className="text-[22px] font-bold text-[#66d98c] tabular-nums leading-tight"
          >
            ${maxMonthlyRevenue.toLocaleString('pt-BR')}
          </div>
        </div>
        <div>
          <div className="font-pixel text-[7px] text-[#8fa4bf]">INVESTIDO</div>
          <div className="text-[22px] font-bold text-[#ffe066] tabular-nums leading-tight">
            ${st.budgetTotal.toLocaleString('pt-BR')}
            <span className="text-[14px] text-[#9eb0c9] font-normal ml-1">
              ({totalSharePct}%)
            </span>
          </div>
        </div>
        <div>
          <div className="font-pixel text-[7px] text-[#8fa4bf]">MÉDIA GERAL</div>
          <div
            data-testid="budget-overall-avg-pct"
            className="text-[22px] font-bold tabular-nums leading-tight"
            style={{ color: covColor(overallSegmentAvgPct) }}
          >
            {overallSegmentAvgPct}%
          </div>
        </div>
        <div>
          <div className="font-pixel text-[7px] text-[#8fa4bf]">SALDO / MÊS</div>
          <div
            data-testid="budget-net-projected"
            className={`text-[22px] font-bold tabular-nums leading-tight ${
              netProjected >= 0 ? 'text-[#66d98c]' : 'text-[#ff6b6b]'
            }`}
          >
            {netProjected >= 0 ? '+' : '-'}${Math.abs(netProjected).toLocaleString('pt-BR')}
          </div>
        </div>
        <div className="col-span-2 sm:col-span-1 border-t sm:border-t-0 sm:border-l border-[#24324d] pt-1 sm:pt-0">
          <div className="font-pixel text-[7px] text-[#8fa4bf]">FELICIDADE</div>
          <div
            className={`text-[22px] font-bold tabular-nums leading-tight ${
              st.happiness >= 70
                ? 'text-[#66d98c]'
                : st.happiness >= 46
                  ? 'text-[#f5b73b]'
                  : 'text-[#ff6b6b]'
            }`}
          >
            {st.happiness}%
          </div>
        </div>
      </div>

      {/* Difficulty Economic Profile Banner */}
      <div
        data-testid="budget-difficulty-banner"
        className="mb-2.5 px-3 py-2 bg-[#101828] border flex flex-wrap items-center justify-between gap-2 text-[15px] text-[#d5e0ee]"
        style={{ borderColor: diffCfg.accentColor }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span
            data-testid="budget-difficulty-badge"
            className="font-pixel text-[7.5px] px-1.5 py-0.5 bg-[#0a101b] border shrink-0"
            style={{
              borderColor: diffCfg.accentColor,
              color: diffCfg.accentColor,
            }}
          >
            MODO {diffCfg.shortLabel}
          </span>
          <span className="leading-snug">{diffCfg.budgetHint}</span>
        </div>
        <span className="font-pixel text-[7px] text-[#9eb0c9] whitespace-nowrap">
          CUSTOS:{' '}
          <strong style={{ color: diffCfg.accentColor }}>
            {needPctDiff === 0
              ? 'PADRÃO'
              : `${needPctDiff > 0 ? '+' : ''}${needPctDiff}%`}
          </strong>
        </span>
      </div>

      {/* Real Fiscal Trade-off Banner when in Deficit */}
      {netProjected < 0 ? (
        <div
          data-testid="budget-deficit-alert"
          className="mb-2.5 px-3 py-2 bg-[#361620] border-2 border-[#ff6b6b] text-[15px] text-[#ffd6dc] leading-snug"
        >
          <strong className="font-pixel text-[8px] text-[#ff6b6b] mr-1.5">DÉFICIT MENSAL:</strong>
          Despesas superam a arrecadação em{' '}
          <strong className="text-[#ffe066]">
            -${Math.abs(netProjected).toLocaleString('pt-BR')}/mês
          </strong>
          .{' '}
          {hud.difficulty === 'hard'
            ? 'No modo Difícil, manter todos os recursos em 100% causa déficit — reduza sliders menos urgentes abaixo de 100% ou ajuste impostos com cautela em Finanças.'
            : 'Priorize segmentos, ajuste impostos em Finanças (cuidado com a felicidade!) ou invista em Turismo/Porto/Aeroporto.'}
        </div>
      ) : null}

      {/* VISÃO GERAL DE COBERTURA POR SEGMENTO (% DA NECESSIDADE) */}
      <section
        data-testid="budget-segments-overview"
        aria-label="Visão geral de porcentagem de cada segmento"
        className="pixel-inset p-2.5 mb-2.5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-pixel text-[8px] text-[#56c2ff]">
              VISÃO GERAL POR SEGMENTO (% DA NECESSIDADE)
            </span>
            <span className="px-1.5 py-0.5 bg-[#132b22] border border-[#2e7d52] font-pixel text-[6px] text-[#66d98c]">
              AUTO-AJUSTE ATIVO · MANTÉM A % QUANDO A DEMANDA SOBE
            </span>
          </div>

          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[13px] text-[#8fa4bf] mr-1">Todos:</span>
            <button
              type="button"
              data-testid="budget-all-75"
              onClick={() => applyAllTargetPct(75)}
              className="pixel-btn px-2 py-1 bg-[#25314a] hover:bg-[#314161] text-[#eef2f7] font-pixel text-[7px]"
              title="Fixar todos os segmentos em 75% da necessidade (gestão econômica)"
            >
              Todos 75%
            </button>
            <button
              type="button"
              data-testid="budget-all-100"
              onClick={() => applyAllTargetPct(100)}
              className="pixel-btn px-2 py-1 bg-[#2e7d52] hover:bg-[#389462] text-white font-pixel text-[7px]"
              title="Fixar todos os segmentos em 100% da necessidade (auto-ajustável)"
            >
              Todos 100%
            </button>
            <button
              type="button"
              data-testid="budget-all-150"
              onClick={() => applyAllTargetPct(150)}
              className="pixel-btn px-2 py-1 bg-[#2b6cb0] hover:bg-[#3582d4] text-white font-pixel text-[7px]"
              title="Fixar todos os segmentos em 150% da necessidade"
            >
              Todos 150%
            </button>
            <button
              type="button"
              data-testid="budget-all-200"
              onClick={() => applyAllTargetPct(200)}
              className="pixel-btn px-2 py-1 bg-[#b7791f] hover:bg-[#d69e2e] text-[#111622] font-pixel text-[7px]"
              title="Fixar todos os segmentos em 200% da necessidade"
            >
              Todos 200%
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
          {BUDGET_AREA_ORDER.map((areaKey) => {
            const meta = BUDGET_AREA_META[areaKey];
            const cov = st.coverage[areaKey];
            const pct = cov.coveragePct;
            const color = covColor(pct);
            const barWidth = Math.min(100, pct);

            return (
              <div
                key={areaKey}
                data-testid={`budget-overview-pill-${areaKey}`}
                className="bg-[#0b101b] border border-[#2a3854] px-2 py-1.5 flex flex-col gap-1"
              >
                <div className="flex items-center justify-between gap-1">
                  <span
                    className="font-pixel text-[7px] truncate"
                    style={{ color: meta.color }}
                  >
                    {meta.label}
                  </span>
                  <span
                    data-testid={`budget-overview-pct-${areaKey}`}
                    className="font-pixel text-[8px] tabular-nums shrink-0"
                    style={{ color }}
                  >
                    {pct}%
                  </span>
                </div>
                <div className="w-full h-2 bg-[#070a12] border border-[#1f2b42] overflow-hidden">
                  <div
                    className="h-full"
                    style={{ width: `${barWidth}%`, backgroundColor: color }}
                  />
                </div>
                <div className="text-[12px] text-[#8fa4bf] tabular-nums leading-none truncate">
                  ${cov.invested.toLocaleString('pt-BR')} / ${cov.needed.toLocaleString('pt-BR')}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Plano Habitacional: Prédio Médio -> Condomínio Control */}
      {onSetCondoPolicy ? (
        <section
          data-testid="budget-condo-policy"
          aria-label="Plano Habitacional de Prédios Médios e Condomínios"
          className="pixel-inset p-2.5 mb-2.5 flex flex-wrap items-center justify-between gap-2.5"
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-pixel text-[8px] text-[#66d98c]">
                PLANO HABITACIONAL (PRÉDIO MÉDIO → CONDOMÍNIO)
              </span>
              <span className="text-[14px] text-[#cfd9e8] tabular-nums">
                Prédios Médios:{' '}
                <strong className="text-[#ffe066]">{st.midRiseCount}</strong> · Condomínios:{' '}
                <strong className="text-[#56c2ff]">{st.condoCount}</strong>
              </span>
            </div>
            <p className="text-[14px] text-[#9eb0c9] leading-tight mt-0.5">
              {hud.condoPolicy === 'manual'
                ? 'Modo Manual: residências evoluem até Prédio Médio (Nv. 2). Clique em qualquer Prédio Médio no mapa para convertê-lo em Condomínio.'
                : 'Modo Automático: Prédios Médios podem evoluir sozinhos para Condomínios (Nv. 3 / 2×2) conforme a cidade amadurece.'}
            </p>
          </div>
          <div
            role="group"
            aria-label="Política de evolução para condomínios"
            className="flex items-center gap-1.5 shrink-0"
          >
            <button
              type="button"
              data-testid="condo-policy-manual"
              aria-pressed={hud.condoPolicy === 'manual'}
              onClick={() => onSetCondoPolicy('manual')}
              className={`pixel-btn px-2.5 py-1.5 font-pixel text-[7px] ${
                hud.condoPolicy === 'manual'
                  ? 'bg-[#66d98c] text-[#111622] ring-2 ring-[#eef2f7]'
                  : 'bg-[#1c263b] hover:bg-[#273552] text-[#cfd9e8]'
              }`}
            >
              Manual (No Mapa)
            </button>
            <button
              type="button"
              data-testid="condo-policy-auto"
              aria-pressed={hud.condoPolicy === 'auto'}
              onClick={() => onSetCondoPolicy('auto')}
              className={`pixel-btn px-2.5 py-1.5 font-pixel text-[7px] ${
                hud.condoPolicy === 'auto'
                  ? 'bg-[#56c2ff] text-[#111622] ring-2 ring-[#eef2f7]'
                  : 'bg-[#1c263b] hover:bg-[#273552] text-[#cfd9e8]'
              }`}
            >
              Auto Condomínios
            </button>
          </div>
        </section>
      ) : null}

      {/* City Structure Metadata */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[15px] text-[#9eb0c9] mb-2 px-0.5 tabular-nums">
        <span>
          Mapa <strong className="text-[#eef2f7]">{hud.gridWidth}×{hud.gridHeight}</strong> · Res{' '}
          <strong className="text-[#eef2f7]">{st.residentialCount}</strong> · Com{' '}
          <strong className="text-[#eef2f7]">{st.commercialCount}</strong> · Ind{' '}
          <strong className="text-[#eef2f7]">{st.industrialCount}</strong> · Parques{' '}
          <strong className="text-[#eef2f7]">{st.parkCount}</strong> · Ruas{' '}
          <strong className="text-[#cbd5e1]">{st.streetCount}</strong> · Avenidas{' '}
          <strong className="text-[#66d98c]">{st.avenueCount}</strong> · Estradas{' '}
          <strong className="text-[#f5b73b]">{st.highwayCount}</strong> · Trevos{' '}
          <strong className="text-[#56c2ff]">{st.interchangeCount}</strong>
          {st.bridgeSpanCount > 0 ? (
            <>
              {' '}
              · Pontes <strong className="text-[#eef2f7]">{st.bridgeSpanCount}</strong>
            </>
          ) : null}
          {st.portCount > 0 ? (
            <>
              {' '}
              · Portos <strong className="text-[#56c2ff]">{st.portCount}</strong>
            </>
          ) : null}
          {st.stadiumCount > 0 ? (
            <>
              {' '}
              · Estádios <strong className="text-[#ff8ec7]">{st.stadiumCount}</strong>
            </>
          ) : null}
          {st.airportCount > 0 ? (
            <>
              {' '}
              · Aeroportos <strong className="text-[#ffe066]">{st.airportCount}</strong>
            </>
          ) : null}
          {st.abandonedCount > 0 ? (
            <>
              {' '}
              · Abandonados{' '}
              <strong className="text-[#ff6b6b]">{st.abandonedCount}</strong>
            </>
          ) : null}
        </span>
        <span>
          Turismo:{' '}
          <strong className="text-[#f5b73b]">
            +${st.tourismRevenue.toLocaleString('pt-BR')}/mês
          </strong>
          {st.tradeRevenue > 0 ? (
            <>
              {' '}
              · Portos/Aéreo:{' '}
              <strong className="text-[#56c2ff]">
                +${st.tradeRevenue.toLocaleString('pt-BR')}/mês
              </strong>
            </>
          ) : null}
        </span>
      </div>

      {/* 6 Unified Variable Monthly Investment Areas */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {BUDGET_AREA_ORDER.map((areaKey) => {
          const meta = BUDGET_AREA_META[areaKey];
          const cov = st.coverage[areaKey];
          const invested = hud.budgets[areaKey];
          const barPct = Math.min(100, cov.coveragePct);
          const color = covColor(cov.coveragePct);
          const revenueSharePct = Math.round((invested / maxMonthlyRevenue) * 100);
          const sliderValue = Math.min(invested, maxMonthlyRevenue);

          const amt100 = cov.needed;
          const amt150 = Math.round(cov.needed * 1.5);
          const amt200 = Math.round(cov.needed * 2.0);
          const targetPctRounded = Math.round(cov.targetPct);

          const paceLabel =
            cov.coveragePct >= 180
              ? 'RITMO TURBO (200%)'
              : cov.coveragePct >= 135
                ? 'ACELERADO (150%)'
                : cov.coveragePct >= 70
                  ? 'RITMO NATURAL'
                  : 'PAUSADO (<70%)';

          return (
            <div
              key={areaKey}
              data-testid={`budget-card-${areaKey}`}
              className="pixel-inset p-3 flex flex-col gap-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div
                    className="font-pixel text-[9px]"
                    style={{ color: meta.color }}
                  >
                    {meta.label}
                  </div>
                  <p className="text-[15px] text-[#9eb0c9] leading-tight mt-0.5">
                    {meta.shortDesc}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <span
                    data-testid={`budget-card-pct-${areaKey}`}
                    className="font-pixel text-[9px] tabular-nums block"
                    style={{ color }}
                  >
                    {cov.coveragePct}%
                  </span>
                  <span className="font-pixel text-[6px] text-[#8fa4bf]">
                    META AUTO: {targetPctRounded}%
                  </span>
                </div>
              </div>

              {/* Investido vs Necessário explicit line */}
              <div className="text-[16px] text-[#dce6f2] tabular-nums leading-tight">
                Investido:{' '}
                <strong className="text-[#ffe066]">
                  ${invested.toLocaleString('pt-BR')}/mês
                </strong>{' '}
                <span className="text-[#627594]">|</span> Necessário:{' '}
                <strong className="text-[#eef2f7]">
                  ${cov.needed.toLocaleString('pt-BR')}/mês
                </strong>{' '}
                <span className="text-[#627594]">—</span> Cobertura:{' '}
                <strong style={{ color }}>{cov.coveragePct}% da necessidade</strong>
              </div>

              {/* Coverage Bar */}
              <div className="w-full h-2.5 bg-[#090d16] border border-[#2a3854] overflow-hidden">
                <div
                  className="h-full"
                  style={{ width: `${barPct}%`, backgroundColor: color }}
                />
              </div>

              {/* Salto Evolutivo Progress Bar */}
              <div
                data-testid={`breakthrough-box-${areaKey}`}
                className="bg-[#121c30] border border-[#3c4f73] px-2 py-1.5 flex flex-col gap-1"
              >
                <div className="flex items-center justify-between text-[13px] tabular-nums">
                  <span className="font-pixel text-[7px] text-[#ffe066]">
                    SALTO EVOLUTIVO · {paceLabel}
                  </span>
                  <span className="text-[#ffe066] font-bold">
                    {cov.breakthroughPct}%
                  </span>
                </div>
                <div className="w-full h-2 bg-[#090d16] border border-[#2a3854] overflow-hidden">
                  <div
                    className="h-full bg-[#ffe066]"
                    style={{ width: `${Math.min(100, cov.breakthroughPct)}%` }}
                  />
                </div>
                <div className="text-[13px] text-[#b9cae0] leading-tight">
                  {meta.breakthroughHint}
                </div>
              </div>

              {/* Continuous Variable Slider (0 to Current Monthly Revenue) */}
              <div className="flex flex-col gap-1">
                <input
                  type="range"
                  min={0}
                  max={maxMonthlyRevenue}
                  step={1}
                  value={sliderValue}
                  data-testid={`budget-slider-${areaKey}`}
                  aria-label={`Investimento mensal de ${meta.label}`}
                  onChange={(e) => onSetBudget(areaKey, Number(e.target.value))}
                  className="pixel-range w-full"
                />
                <div className="flex items-center justify-between text-[13px] text-[#8fa4bf] tabular-nums leading-none">
                  <span>$0</span>
                  <span>{revenueSharePct}% da receita · Mantém {targetPctRounded}% da necessidade</span>
                  <span>Máx: ${maxMonthlyRevenue.toLocaleString('pt-BR')}</span>
                </div>
              </div>

              {/* Direct Variable Dollar Input + Persistent 100% / 150% / 200% of Need Buttons */}
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <label className="flex-1 min-w-[130px] flex items-center bg-[#0b101b] border-2 border-[#2a3854] focus-within:border-[#56c2ff] px-2 py-1">
                  <span className="text-[16px] text-[#ffe066] font-bold mr-1">$</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={invested}
                    data-testid={`budget-input-${areaKey}`}
                    aria-label={`Valor exato mensal de ${meta.label}`}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === '') {
                        onSetBudget(areaKey, 0);
                        return;
                      }
                      const parsed = Number.parseInt(raw, 10);
                      if (Number.isFinite(parsed) && parsed >= 0) {
                        onSetBudget(areaKey, parsed);
                      }
                    }}
                    className="w-full bg-transparent text-[18px] font-bold text-[#eef2f7] tabular-nums focus:outline-none"
                  />
                  <span className="text-[14px] text-[#8fa4bf] ml-1 shrink-0">/mês</span>
                </label>

                <div
                  role="group"
                  aria-label={`Meta percentual automática para ${meta.label}`}
                  className="flex items-center gap-1 shrink-0"
                >
                  <button
                    type="button"
                    aria-pressed={targetPctRounded === 100}
                    data-testid={`budget-quick-100-${areaKey}`}
                    aria-label={`Manter 100% da necessidade em ${meta.label} ($${amt100})`}
                    title={`Manter automaticamente em 100% da necessidade ($${amt100.toLocaleString('pt-BR')}/mês atual)`}
                    onClick={() => applyTargetPct(areaKey, 100)}
                    className={`pixel-btn px-2 py-1.5 font-pixel text-[7px] whitespace-nowrap ${
                      targetPctRounded === 100
                        ? 'bg-[#66d98c] text-[#111622] ring-2 ring-[#eef2f7]'
                        : 'bg-[#2e7d52] hover:bg-[#389462] text-white'
                    }`}
                  >
                    100%
                  </button>
                  <button
                    type="button"
                    aria-pressed={targetPctRounded === 150}
                    data-testid={`budget-quick-150-${areaKey}`}
                    aria-label={`Manter 150% da necessidade em ${meta.label} ($${amt150})`}
                    title={`Manter automaticamente em 150% da necessidade ($${amt150.toLocaleString('pt-BR')}/mês atual)`}
                    onClick={() => applyTargetPct(areaKey, 150)}
                    className={`pixel-btn px-2 py-1.5 font-pixel text-[7px] whitespace-nowrap ${
                      targetPctRounded === 150
                        ? 'bg-[#56c2ff] text-[#111622] ring-2 ring-[#eef2f7]'
                        : 'bg-[#2b6cb0] hover:bg-[#3582d4] text-white'
                    }`}
                  >
                    150%
                  </button>
                  <button
                    type="button"
                    aria-pressed={targetPctRounded === 200}
                    data-testid={`budget-quick-200-${areaKey}`}
                    aria-label={`Manter 200% da necessidade em ${meta.label} ($${amt200})`}
                    title={`Manter automaticamente em 200% da necessidade ($${amt200.toLocaleString('pt-BR')}/mês atual)`}
                    onClick={() => applyTargetPct(areaKey, 200)}
                    className={`pixel-btn px-2 py-1.5 font-pixel text-[7px] whitespace-nowrap ${
                      targetPctRounded === 200
                        ? 'bg-[#ffe066] text-[#111622] ring-2 ring-[#eef2f7]'
                        : 'bg-[#b7791f] hover:bg-[#d69e2e] text-[#111622]'
                    }`}
                  >
                    200%
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </PixelModal>
  );
}
