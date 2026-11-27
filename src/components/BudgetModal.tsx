import {
  BUDGET_AREA_META,
  BUDGET_AREA_ORDER,
  DIFFICULTY_CONFIGS,
  getSegmentEffectCurve,
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
      subtitle="Meta em % da necessidade (auto-ajustável conforme a cidade cresce)"
      accentColor="#56c2ff"
      maxWidthClass="max-w-[900px]"
      onClose={onClose}
      testId="budget-modal"
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
              Receita:{' '}
              <strong
                data-testid="budget-max-revenue"
                className="text-[#66d98c]"
              >
                ${maxMonthlyRevenue.toLocaleString('pt-BR')}/mês
              </strong>
            </span>
            <span className="text-[#354666]">|</span>
            <span>
              Investido:{' '}
              <strong className="text-[#ffe066]">
                ${st.budgetTotal.toLocaleString('pt-BR')}
              </strong>{' '}
              <span className="text-[#9eb0c9]">({totalSharePct}%)</span>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span>
              Média:{' '}
              <strong
                data-testid="budget-overall-avg-pct"
                style={{ color: covColor(overallSegmentAvgPct) }}
              >
                {overallSegmentAvgPct}%
              </strong>
            </span>
            <span className="text-[#354666]">|</span>
            <span>
              Saldo projetado:{' '}
              <strong
                data-testid="budget-net-projected"
                className={
                  netProjected >= 0 ? 'text-[#66d98c]' : 'text-[#ff6b6b]'
                }
              >
                {netProjected >= 0 ? '+' : '-'}$
                {Math.abs(netProjected).toLocaleString('pt-BR')}/mês
              </strong>
            </span>
          </div>
        </div>
      }
    >
      {/* Compact Global Presets & Difficulty Toolbar (Immediately above the 6 cards) */}
      <section
        data-testid="budget-segments-overview"
        aria-label="Atalhos rápidos de orçamento e perfil de dificuldade"
        className="pixel-inset p-2.5 mb-2.5 flex flex-col gap-2"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div
            data-testid="budget-difficulty-banner"
            className="flex items-center gap-2 flex-wrap text-[14px] text-[#d5e0ee]"
          >
            <span
              data-testid="budget-difficulty-badge"
              className="font-pixel text-[7px] px-1.5 py-0.5 bg-[#0a101b] border shrink-0"
              style={{
                borderColor: diffCfg.accentColor,
                color: diffCfg.accentColor,
              }}
            >
              MODO {diffCfg.shortLabel}
            </span>
            <span className="px-1.5 py-0.5 bg-[#132b22] border border-[#2e7d52] font-pixel text-[6px] text-[#66d98c]">
              AUTO-AJUSTE ATIVO
            </span>
            <span className="text-[13px] text-[#9eb0c9]">
              Custos:{' '}
              <strong style={{ color: diffCfg.accentColor }}>
                {needPctDiff === 0
                  ? 'Padrão'
                  : `${needPctDiff > 0 ? '+' : ''}${needPctDiff}%`}
              </strong>{' '}
              · Felicidade:{' '}
              <strong
                className={
                  st.happiness >= 70
                    ? 'text-[#66d98c]'
                    : st.happiness >= 46
                      ? 'text-[#f5b73b]'
                      : 'text-[#ff6b6b]'
                }
              >
                {st.happiness}%
              </strong>
            </span>
          </div>

          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[13px] text-[#8fa4bf] mr-1">Aplicar a todos:</span>
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

        {/* Real Fiscal Trade-off Banner when in Deficit */}
        {netProjected < 0 ? (
          <div
            data-testid="budget-deficit-alert"
            className="px-2.5 py-1.5 bg-[#361620] border border-[#ff6b6b] text-[14px] text-[#ffd6dc] leading-snug"
          >
            <strong className="font-pixel text-[7.5px] text-[#ff6b6b] mr-1.5">
              DÉFICIT MENSAL:
            </strong>
            Despesas superam a arrecadação em{' '}
            <strong className="text-[#ffe066]">
              -${Math.abs(netProjected).toLocaleString('pt-BR')}/mês
            </strong>
            . Reduza segmentos menos urgentes para 75% ou ajuste impostos em Finanças.
          </div>
        ) : null}
      </section>

      {/* 6 Unified Variable Monthly Investment Areas (Immediately accessible) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 mb-2.5">
        {BUDGET_AREA_ORDER.map((areaKey) => {
          const meta = BUDGET_AREA_META[areaKey];
          const cov = st.coverage[areaKey];
          const invested = hud.budgets[areaKey];
          const barPct = Math.min(100, cov.coveragePct);
          const color = covColor(cov.coveragePct);
          const revenueSharePct = Math.round((invested / maxMonthlyRevenue) * 100);
          const sliderValue = Math.min(invested, maxMonthlyRevenue);

          const curve = getSegmentEffectCurve(cov.coveragePct);
          const amt75 = Math.round(cov.needed * 0.75);
          const amt100 = cov.needed;
          const amt150 = Math.round(cov.needed * 1.5);
          const amt200 = Math.round(cov.needed * 2.0);
          const targetPctRounded = Math.round(cov.targetPct);

          const paceLabel =
            cov.coveragePct >= 180
              ? 'TURBO (200%)'
              : cov.coveragePct >= 135
                ? 'ACELERADO (150%)'
                : cov.coveragePct >= 70
                  ? 'NATURAL'
                  : 'PAUSADO (<65%)';

          const bandLabel =
            curve.band === 'deficit'
              ? `<100% (${Math.round(curve.effectiveFactor * 100)}%)`
              : curve.band === 'balanced'
                ? '100% EQUILÍBRIO'
                : `${cov.coveragePct >= 180 ? '200%' : '150%+'} (+${curve.overBonusPct}%)`;
          const bandSummary =
            curve.band === 'deficit'
              ? meta.under100Summary
              : curve.band === 'balanced'
                ? meta.at100Summary
                : meta.over100Summary;
          const bandColor =
            curve.band === 'deficit'
              ? '#ff7b8a'
              : curve.band === 'balanced'
                ? '#66d98c'
                : '#56c2ff';

          return (
            <div
              key={areaKey}
              data-testid={`budget-card-${areaKey}`}
              className="pixel-inset p-2.5 flex flex-col gap-1.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className="font-pixel text-[8.5px]"
                      style={{ color: meta.color }}
                    >
                      {meta.label}
                    </span>
                    <span className="font-pixel text-[6px] px-1.5 py-0.5 bg-[#0b101b] border border-[#2a3854] text-[#cfd9e8]">
                      {meta.roleTag}
                    </span>
                  </div>
                  <p className="text-[13.5px] text-[#9eb0c9] leading-tight mt-0.5">
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
                    META: {targetPctRounded}%
                  </span>
                </div>
              </div>

              {/* Investido vs Necessário + Coverage Bar */}
              <div className="flex items-center justify-between gap-2 text-[14.5px] text-[#dce6f2] tabular-nums leading-tight">
                <span>
                  Inv:{' '}
                  <strong className="text-[#ffe066]">
                    ${invested.toLocaleString('pt-BR')}
                  </strong>{' '}
                  / Nec:{' '}
                  <strong className="text-[#eef2f7]">
                    ${cov.needed.toLocaleString('pt-BR')}
                  </strong>
                </span>
                <span className="text-[12.5px] text-[#8fa4bf]">
                  {revenueSharePct}% da receita
                </span>
              </div>

              <div className="w-full h-2 bg-[#090d16] border border-[#2a3854] overflow-hidden relative">
                <div
                  className="h-full"
                  style={{ width: `${barPct}%`, backgroundColor: color }}
                />
                {cov.coveragePct > 100 ? (
                  <div
                    className="h-full bg-[#56c2ff] absolute top-0 left-0 opacity-65"
                    style={{ width: `${Math.min(100, cov.coveragePct - 100)}%` }}
                  />
                ) : null}
              </div>

              {/* Continuous Variable Slider + Quick 75% / 100% / 150% / 200% + Direct Input */}
              <input
                type="range"
                min={0}
                max={maxMonthlyRevenue}
                step={1}
                value={sliderValue}
                data-testid={`budget-slider-${areaKey}`}
                aria-label={`Investimento mensal de ${meta.label}`}
                onChange={(e) => onSetBudget(areaKey, Number(e.target.value))}
                className="pixel-range w-full my-0.5"
              />

              <div className="flex flex-wrap items-center gap-1.5">
                <label className="flex-1 min-w-[115px] flex items-center bg-[#0b101b] border-2 border-[#2a3854] focus-within:border-[#56c2ff] px-2 py-0.5">
                  <span className="text-[15px] text-[#ffe066] font-bold mr-1">$</span>
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
                    className="w-full bg-transparent text-[17px] font-bold text-[#eef2f7] tabular-nums focus:outline-none"
                  />
                  <span className="text-[13px] text-[#8fa4bf] ml-1 shrink-0">/mês</span>
                </label>

                <div
                  role="group"
                  aria-label={`Meta percentual automática para ${meta.label}`}
                  className="flex items-center gap-1 shrink-0"
                >
                  <button
                    type="button"
                    aria-pressed={targetPctRounded === 75}
                    data-testid={`budget-quick-75-${areaKey}`}
                    aria-label={`Manter 75% da necessidade em ${meta.label} ($${amt75})`}
                    title={`Manter automaticamente em 75% da necessidade ($${amt75.toLocaleString('pt-BR')}/mês atual)`}
                    onClick={() => applyTargetPct(areaKey, 75)}
                    className={`pixel-btn px-1.5 py-1 font-pixel text-[6.5px] whitespace-nowrap ${
                      targetPctRounded === 75
                        ? 'bg-[#f5b73b] text-[#111622] ring-2 ring-[#eef2f7]'
                        : 'bg-[#25314a] hover:bg-[#314161] text-[#cfd9e8]'
                    }`}
                  >
                    75%
                  </button>
                  <button
                    type="button"
                    aria-pressed={targetPctRounded === 100}
                    data-testid={`budget-quick-100-${areaKey}`}
                    aria-label={`Manter 100% da necessidade em ${meta.label} ($${amt100})`}
                    title={`Manter automaticamente em 100% da necessidade ($${amt100.toLocaleString('pt-BR')}/mês atual)`}
                    onClick={() => applyTargetPct(areaKey, 100)}
                    className={`pixel-btn px-1.5 py-1 font-pixel text-[6.5px] whitespace-nowrap ${
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
                    className={`pixel-btn px-1.5 py-1 font-pixel text-[6.5px] whitespace-nowrap ${
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
                    className={`pixel-btn px-1.5 py-1 font-pixel text-[6.5px] whitespace-nowrap ${
                      targetPctRounded === 200
                        ? 'bg-[#ffe066] text-[#111622] ring-2 ring-[#eef2f7]'
                        : 'bg-[#b7791f] hover:bg-[#d69e2e] text-[#111622]'
                    }`}
                  >
                    200%
                  </button>
                </div>
              </div>

              {/* Compact Active Band Effect & Salto Evolutivo Footer */}
              <div
                data-testid={`budget-band-effect-${areaKey}`}
                className="bg-[#0b111e] border border-[#293856] px-2 py-1 text-[12.5px] leading-tight"
              >
                <span className="font-pixel text-[6px] mr-1.5" style={{ color: bandColor }}>
                  {bandLabel}:
                </span>
                <span className="text-[#cfd9e8]">{bandSummary}</span>
              </div>

              <div
                data-testid={`breakthrough-box-${areaKey}`}
                className="bg-[#121c30] border border-[#3c4f73] px-2 py-1 flex flex-col gap-0.5"
                title={meta.breakthroughHint}
              >
                <div className="flex items-center justify-between text-[12px] tabular-nums">
                  <span className="font-pixel text-[6.5px] text-[#ffe066]">
                    SALTO · {paceLabel}
                  </span>
                  <span className="text-[#ffe066] font-bold">
                    {cov.breakthroughPct}%
                  </span>
                </div>
                <div className="w-full h-1.5 bg-[#090d16] border border-[#2a3854] overflow-hidden">
                  <div
                    className="h-full bg-[#ffe066]"
                    style={{ width: `${Math.min(100, cov.breakthroughPct)}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom: Plano Habitacional + Compact 3-Band Guide */}
      <div className="flex flex-col gap-2">
        {onSetCondoPolicy ? (
          <section
            data-testid="budget-condo-policy"
            aria-label="Plano Habitacional de Prédios Médios e Condomínios"
            className="pixel-inset p-2.5 flex flex-wrap items-center justify-between gap-2.5"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-pixel text-[8px] text-[#66d98c]">
                  PLANO HABITACIONAL (PRÉDIO MÉDIO → CONDOMÍNIO)
                </span>
                <span className="text-[13.5px] text-[#cfd9e8] tabular-nums">
                  Prédios Médios:{' '}
                  <strong className="text-[#ffe066]">{st.midRiseCount}</strong> · Condomínios:{' '}
                  <strong className="text-[#56c2ff]">{st.condoCount}</strong>
                </span>
              </div>
              <p className="text-[13.5px] text-[#9eb0c9] leading-tight mt-0.5">
                {hud.condoPolicy === 'manual'
                  ? 'Modo Manual: residências evoluem até Prédio Médio (Nv. 2). Clique no mapa para converter em Condomínio.'
                  : 'Modo Automático: Prédios Médios evoluem sozinhos para Condomínios (Nv. 3 / 2×2).'}
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

        <div
          data-testid="budget-tier-guide"
          className="grid grid-cols-1 md:grid-cols-3 gap-1.5 text-[12.5px] leading-snug"
        >
          <div className="bg-[#1b141c] border border-[#592b39] px-2 py-1 text-[#f3b6c0]">
            <strong className="font-pixel text-[6.5px] text-[#ff6b6b] mr-1">&lt; 100% (75%):</strong>
            Penalidade progressiva nos serviços e carga lenta do Salto.
          </div>
          <div className="bg-[#11231b] border border-[#2c6648] px-2 py-1 text-[#b7ebd0]">
            <strong className="font-pixel text-[6.5px] text-[#66d98c] mr-1">100%:</strong>
            Equilíbrio padrão da necessidade calculada, sem penalidades.
          </div>
          <div className="bg-[#112036] border border-[#2d5b8e] px-2 py-1 text-[#cde6ff]">
            <strong className="font-pixel text-[6.5px] text-[#56c2ff] mr-1">150%–200%:</strong>
            Acelera o Salto Evolutivo e aplica bônus real (+16% em 150%, +28% em 200%).
          </div>
        </div>
      </div>
    </PixelModal>
  );
}

