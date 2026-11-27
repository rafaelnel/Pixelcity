import { useState } from 'react';
import {
  Activity,
  ArrowRight,
  Award,
  Building2,
  Check,
  History,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {
  BUDGET_AREA_META,
  BUDGET_AREA_ORDER,
} from '../game/simulationConfig';
import type { HudSnapshot, ModalTab } from '../game/types';
import { PixelModal } from './PixelModal';

interface ReportModalProps {
  hud: HudSnapshot;
  onNavigateNeed: (tab: ModalTab) => void;
  onClose: () => void;
}

type ReportInnerTab = 'overview' | 'city' | 'history';

interface MiniChartProps {
  title: string;
  currentValueLabel: string;
  accentColor: string;
  values: number[];
  labels: string[];
  fixedMin?: number;
  fixedMax?: number;
  secondaryValues?: number[];
  secondaryColor?: string;
  secondaryLabel?: string;
}

function MiniLineChart({
  title,
  currentValueLabel,
  accentColor,
  values,
  labels,
  fixedMin,
  fixedMax,
  secondaryValues,
  secondaryColor,
  secondaryLabel,
}: MiniChartProps) {
  const width = 260;
  const height = 84;
  const padX = 8;
  const padY = 10;

  const allVals = secondaryValues ? [...values, ...secondaryValues] : values;
  const rawMin = fixedMin ?? Math.min(...allVals, 0);
  const rawMax = fixedMax ?? Math.max(...allVals, 10);
  const span = Math.max(1, rawMax - rawMin);

  const toPoints = (arr: number[]) => {
    if (arr.length === 0) return '';
    if (arr.length === 1) {
      const y = height - padY - ((arr[0] - rawMin) / span) * (height - padY * 2);
      return `${padX},${y} ${width - padX},${y}`;
    }
    return arr
      .map((v, i) => {
        const x = padX + (i / (arr.length - 1)) * (width - padX * 2);
        const y = height - padY - ((v - rawMin) / span) * (height - padY * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  };

  const mainPoints = toPoints(values);
  const areaPoints = mainPoints
    ? `${padX},${height - padY} ${mainPoints} ${width - padX},${height - padY}`
    : '';
  const secPoints = secondaryValues ? toPoints(secondaryValues) : '';

  const firstLabel = labels[0] ?? '';
  const lastLabel = labels[labels.length - 1] ?? '';

  return (
    <div className="pixel-inset p-2.5 flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-pixel text-[8px] text-[#9eb0c9]">{title}</span>
        <span
          className="text-[19px] font-bold tabular-nums leading-none"
          style={{ color: accentColor }}
        >
          {currentValueLabel}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-[80px] bg-[#0b101b] border border-[#22304a]"
        role="img"
        aria-label={`Gráfico de ${title}`}
      >
        <line
          x1={padX}
          y1={padY}
          x2={width - padX}
          y2={padY}
          stroke="#1d2940"
          strokeDasharray="3 3"
        />
        <line
          x1={padX}
          y1={height / 2}
          x2={width - padX}
          y2={height / 2}
          stroke="#1d2940"
          strokeDasharray="3 3"
        />
        <line
          x1={padX}
          y1={height - padY}
          x2={width - padX}
          y2={height - padY}
          stroke="#1d2940"
        />

        {areaPoints ? (
          <polygon points={areaPoints} fill={accentColor} fillOpacity={0.14} />
        ) : null}

        {secPoints && secondaryColor ? (
          <polyline
            fill="none"
            stroke={secondaryColor}
            strokeWidth={2}
            strokeDasharray="4 2"
            points={secPoints}
          />
        ) : null}

        {mainPoints ? (
          <polyline
            fill="none"
            stroke={accentColor}
            strokeWidth={2.5}
            points={mainPoints}
          />
        ) : null}
      </svg>

      <div className="flex items-center justify-between text-[13.5px] text-[#8fa4bf] tabular-nums">
        <span>{firstLabel}</span>
        {secondaryLabel ? (
          <span style={{ color: secondaryColor }}>{secondaryLabel}</span>
        ) : (
          <span>
            Últimos {values.length} {values.length === 1 ? 'mês' : 'meses'}
          </span>
        )}
        <span>{lastLabel}</span>
      </div>
    </div>
  );
}

export function ReportModal({
  hud,
  onNavigateNeed,
  onClose,
}: ReportModalProps) {
  const [activeTab, setActiveTab] = useState<ReportInnerTab>('overview');

  const mig = hud.lastMigrationDelta;
  const hist = hud.history;
  const labels = hist.map((h) => h.dateLabel);
  const popVals = hist.map((h) => h.population);
  const moneyVals = hist.map((h) => h.money);
  const revVals = hist.map((h) => h.revenue);
  const happyVals = hist.map((h) => h.happiness);
  const netBalance = hud.financials.netBalance;

  const milestones = hud.civicMilestones ?? [];
  const unlockedCount = milestones.filter((m) => m.unlocked).length;
  const nextMilestone = milestones.find((m) => !m.unlocked);
  const readyMilestonesCount = milestones.filter(
    (m) => m.unlocked && !m.built && m.actionId
  ).length;
  // Order milestones by First Necessity: ready-to-build unlocked first, then next upcoming by lowest populationTarget, then already completed
  const sortedMilestones = [...milestones].sort((a, b) => {
    const rank = (m: (typeof milestones)[number]) =>
      m.unlocked && !m.built ? 0 : !m.unlocked ? 1 : 2;
    const rankDiff = rank(a) - rank(b);
    if (rankDiff !== 0) return rankDiff;
    return a.populationTarget - b.populationTarget;
  });
  const criticalOrWarningNeedsCount = hud.needs.filter(
    (n) => n.severity !== 'info'
  ).length;

  const avgSegmentPct = Math.round(
    BUDGET_AREA_ORDER.reduce(
      (acc, k) => acc + hud.stats.coverage[k].coveragePct,
      0
    ) / BUDGET_AREA_ORDER.length
  );

  return (
    <PixelModal
      title="RELATÓRIO · DIAGNÓSTICO E CRESCIMENTO"
      subtitle={`Diagnóstico prioritário · Histórico dos últimos ${hist.length} ${hist.length === 1 ? 'mês' : 'meses'}`}
      accentColor="#66d98c"
      maxWidthClass="max-w-[880px]"
      onClose={onClose}
      testId="report-modal"
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
                className={
                  netBalance >= 0 ? 'text-[#66d98c]' : 'text-[#ff6b6b]'
                }
              >
                {netBalance >= 0 ? '+' : '-'}$
                {Math.abs(netBalance).toLocaleString('pt-BR')}/mês
              </strong>
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[#cfd9e8]">
            <span>
              Pop:{' '}
              <strong className="text-[#56c2ff]">
                {hud.totalPopulation.toLocaleString('pt-BR')}
              </strong>
            </span>
            <span>
              Serviços:{' '}
              <strong className="text-[#ffe066]">
                {hud.globalServiceCoverage}%
              </strong>
            </span>
            <span>
              Imposto justo:{' '}
              <strong className="text-[#56c2ff]">
                ~{hud.financials.fairTaxRate.toFixed(1)}%
              </strong>
            </span>
          </div>
        </div>
      }
    >
      {/* Internal Sub-Tab Bar */}
      <div
        role="tablist"
        aria-label="Seções do Relatório da Cidade"
        className="grid grid-cols-3 gap-1.5 mb-3"
      >
        <button
          type="button"
          role="tab"
          data-testid="report-tab-overview"
          aria-selected={activeTab === 'overview'}
          onClick={() => setActiveTab('overview')}
          className={`pixel-btn px-2 py-2 flex items-center justify-center gap-1.5 font-pixel text-[7.5px] sm:text-[8px] ${
            activeTab === 'overview'
              ? 'bg-[#1c3829] text-[#66d98c] ring-2 ring-[#66d98c]'
              : 'bg-[#141c2c] hover:bg-[#1c283e] text-[#9eb0c9]'
          }`}
        >
          <Activity className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">Visão Geral</span>
          {criticalOrWarningNeedsCount > 0 ? (
            <span className="px-1.5 py-0.2 bg-[#3b1922] border border-[#ff6b6b] text-[#ff6b6b] text-[6.5px] shrink-0">
              {criticalOrWarningNeedsCount}
            </span>
          ) : null}
        </button>

        <button
          type="button"
          role="tab"
          data-testid="report-tab-city"
          aria-selected={activeTab === 'city'}
          onClick={() => setActiveTab('city')}
          className={`pixel-btn px-2 py-2 flex items-center justify-center gap-1.5 font-pixel text-[7.5px] sm:text-[8px] ${
            activeTab === 'city'
              ? 'bg-[#1e324a] text-[#ffe066] ring-2 ring-[#ffe066]'
              : 'bg-[#141c2c] hover:bg-[#1c283e] text-[#9eb0c9]'
          }`}
        >
          <Building2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">Cidade &amp; Marcos</span>
          <span className="px-1.5 py-0.2 bg-[#0c1322] border border-[#38bdf8] text-[#56c2ff] text-[6.5px] shrink-0">
            {readyMilestonesCount > 0
              ? `${readyMilestonesCount} liber.`
              : `${unlockedCount}/${milestones.length}`}
          </span>
        </button>

        <button
          type="button"
          role="tab"
          data-testid="report-tab-history"
          aria-selected={activeTab === 'history'}
          onClick={() => setActiveTab('history')}
          className={`pixel-btn px-2 py-2 flex items-center justify-center gap-1.5 font-pixel text-[7.5px] sm:text-[8px] ${
            activeTab === 'history'
              ? 'bg-[#1a2e47] text-[#56c2ff] ring-2 ring-[#56c2ff]'
              : 'bg-[#141c2c] hover:bg-[#1c283e] text-[#9eb0c9]'
          }`}
        >
          <History className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">Histórico 12m</span>
        </button>
      </div>

      {/* TAB 1: VISÃO GERAL (Necessidades prioritárias + Gráficos 12m + Resumo compacto) */}
      {activeTab === 'overview' ? (
        <div className="flex flex-col gap-3">
          {/* 1. Prioritized Dynamic City Needs RIGHT AT THE TOP */}
          <section aria-label="Necessidades prioritárias da cidade">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
              <h3 className="font-pixel text-[9px] text-[#ffe066]">
                NECESSIDADES DA CIDADE (POR URGÊNCIA)
              </h3>
              <span className="text-[13px] text-[#9eb0c9]">
                Atalhos diretos para corrigir gargalos
              </span>
            </div>
            <div data-testid="city-needs-list" className="flex flex-col gap-2">
              {hud.needs.map((need) => {
                const sevMeta =
                  need.severity === 'critical'
                    ? { label: 'CRÍTICO', color: '#ff6b6b', bg: 'bg-[#3b1922]' }
                    : need.severity === 'warning'
                      ? { label: 'ATENÇÃO', color: '#f5b73b', bg: 'bg-[#332a17]' }
                      : { label: 'ESTÁVEL', color: '#66d98c', bg: 'bg-[#173024]' };

                return (
                  <div
                    key={need.id}
                    className="pixel-inset p-2.5 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`font-pixel text-[7px] px-1.5 py-0.5 border border-[#0b0f19] ${sevMeta.bg}`}
                          style={{ color: sevMeta.color }}
                        >
                          {sevMeta.label}
                        </span>
                        <span className="text-[17px] font-bold text-[#eef2f7] leading-tight">
                          {need.title}
                        </span>
                      </div>
                      <p className="text-[14.5px] text-[#9eb0c9] leading-tight mt-0.5">
                        {need.detail}
                      </p>
                    </div>

                    {need.severity !== 'info' ? (
                      <button
                        type="button"
                        onClick={() => onNavigateNeed(need.targetTab)}
                        className="pixel-btn px-2.5 py-1.5 bg-[#25314a] hover:bg-[#314161] text-[#eef2f7] font-pixel text-[7px] shrink-0 flex items-center gap-1"
                      >
                        <span>Resolver</span>
                        <ArrowRight className="w-3 h-3" aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>

          {/* 2. 12-Month Growth Mini-Charts & Migration Summary */}
          <section aria-label="Gráficos de crescimento dos últimos 12 meses">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
              <h3 className="font-pixel text-[9px] text-[#56c2ff]">
                EVOLUÇÃO DOS ÚLTIMOS 12 MESES
              </h3>
              <div className="flex items-center gap-1.5">
                {mig >= 0 ? (
                  <TrendingUp
                    className={`w-4 h-4 ${mig > 0 ? 'text-[#66d98c]' : 'text-[#56c2ff]'}`}
                    aria-hidden="true"
                  />
                ) : (
                  <TrendingDown className="w-4 h-4 text-[#ff6b6b]" aria-hidden="true" />
                )}
                <span
                  data-testid="report-migration-summary"
                  className={`text-[15px] font-bold tabular-nums ${
                    mig > 0
                      ? 'text-[#66d98c]'
                      : mig < 0
                        ? 'text-[#ff6b6b]'
                        : 'text-[#dce6f2]'
                  }`}
                >
                  {mig > 0
                    ? `+${mig.toLocaleString('pt-BR')} novos moradores no último mês`
                    : mig < 0
                      ? `${mig.toLocaleString('pt-BR')} moradores saíram no último mês`
                      : 'Migração estável no último mês'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
              <MiniLineChart
                title="POPULAÇÃO"
                currentValueLabel={hud.totalPopulation.toLocaleString('pt-BR')}
                accentColor="#56c2ff"
                values={popVals}
                labels={labels}
                fixedMin={0}
              />
              <MiniLineChart
                title="CAIXA & RECEITA"
                currentValueLabel={`$${hud.money.toLocaleString('pt-BR')}`}
                accentColor="#ffe066"
                values={moneyVals}
                labels={labels}
                secondaryValues={revVals}
                secondaryColor="#66d98c"
                secondaryLabel="--- Receita/mês"
              />
              <MiniLineChart
                title="FELICIDADE"
                currentValueLabel={`${hud.globalHappiness}%`}
                accentColor="#66d98c"
                values={happyVals}
                labels={labels}
                fixedMin={0}
                fixedMax={100}
              />
            </div>
          </section>

          {/* 3. Compact Single-Row Summary of 6 Segments + Next Civic Milestone Preview */}
          <section
            data-testid="report-segments-overview"
            aria-label="Resumo compacto de cobertura dos segmentos"
            className="pixel-inset p-2.5 flex flex-col gap-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-pixel text-[8px] text-[#56c2ff]">
                  COBERTURA ORÇAMENTÁRIA (RESUMO)
                </h3>
                <span className="font-pixel text-[7.5px] text-[#ffe066] tabular-nums">
                  MÉDIA: {avgSegmentPct}%
                </span>
              </div>
              <button
                type="button"
                onClick={() => onNavigateNeed('budget')}
                className="pixel-btn px-2 py-1 bg-[#1e3a5f] hover:bg-[#274c7d] text-[#e6f4ff] font-pixel text-[6.5px] flex items-center gap-1"
              >
                <span>Ajustar Orçamento</span>
                <ArrowRight className="w-2.5 h-2.5" aria-hidden="true" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-1.5">
              {BUDGET_AREA_ORDER.map((areaKey) => {
                const meta = BUDGET_AREA_META[areaKey];
                const pct = hud.stats.coverage[areaKey].coveragePct;
                const color =
                  pct > 100
                    ? '#56c2ff'
                    : pct >= 85
                      ? '#66d98c'
                      : pct >= 55
                        ? '#f5b73b'
                        : '#ff6b6b';

                return (
                  <div
                    key={areaKey}
                    className="bg-[#0b101b] border border-[#24324d] px-2 py-1 flex items-center justify-between gap-1"
                  >
                    <span
                      className="font-pixel text-[6.5px] truncate"
                      style={{ color: meta.color }}
                      title={meta.label}
                    >
                      {meta.label}
                    </span>
                    <span
                      className="font-pixel text-[7.5px] tabular-nums shrink-0"
                      style={{ color }}
                    >
                      {pct}%
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}

      {/* TAB 2: CIDADE & MARCOS (Marcos Cívicos + Transporte Público + Malha Viária + Zoneamento) */}
      {activeTab === 'city' ? (
        <div className="flex flex-col gap-3">
          {/* Marcos Cívicos (Desbloqueio Automático por População) */}
          <section
            data-testid="report-civic-milestones"
            aria-label="Marcos Cívicos por População"
            className="pixel-inset p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-1.5">
                <Award className="w-4 h-4 text-[#ffe066]" aria-hidden="true" />
                <h3 className="font-pixel text-[9px] text-[#ffe066]">
                  MARCOS CÍVICOS POR POPULAÇÃO (1.200 → 30.000 HAB)
                </h3>
              </div>
              <span className="font-pixel text-[8px] text-[#66d98c] tabular-nums">
                {unlockedCount}/{milestones.length} ALCANÇADOS
              </span>
            </div>

            {nextMilestone ? (
              <div className="bg-[#0b101b] border border-[#2a3854] p-2.5 mb-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                  <span className="text-[16px] font-bold text-[#eef2f7]">
                    Próximo marco:{' '}
                    <span className="text-[#ffe066]">{nextMilestone.title}</span>
                  </span>
                  <span className="text-[15px] text-[#56c2ff] tabular-nums">
                    {hud.totalPopulation.toLocaleString('pt-BR')} /{' '}
                    {nextMilestone.populationTarget.toLocaleString('pt-BR')} hab (
                    {nextMilestone.progressPct}%)
                  </span>
                </div>
                <div className="w-full h-2.5 bg-[#111929] border border-[#2c3b57] overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[#38bdf8] to-[#ffe066]"
                    style={{ width: `${Math.max(2, nextMilestone.progressPct)}%` }}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 mt-1 text-[13.5px] text-[#9eb0c9]">
                  <span>{nextMilestone.subtitle}</span>
                  <span className="text-[#66d98c] font-bold tabular-nums shrink-0">
                    Bônus: +${nextMilestone.rewardCash.toLocaleString('pt-BR')}
                  </span>
                </div>
              </div>
            ) : (
              <div className="bg-[#132f23] border border-[#66d98c] px-2.5 py-1.5 mb-2.5 text-[15px] text-[#66d98c]">
                Todos os Marcos Cívicos de Pixópolis foram alcançados!
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {sortedMilestones.map((m) => (
                <div
                  key={m.id}
                  data-testid={`civic-milestone-${m.id}`}
                  className={`p-2 border flex flex-col justify-between gap-1.5 ${
                    m.unlocked && m.built
                      ? 'bg-[#12261e] border-[#3d8c61]'
                      : m.unlocked
                        ? 'bg-[#14263b] border-[#38bdf8]'
                        : nextMilestone?.id === m.id
                          ? 'bg-[#172338] border-[#f5b73b]'
                          : 'bg-[#0b101b] border-[#24314a]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-pixel text-[7px] text-[#56c2ff] tabular-nums">
                      {m.populationTarget.toLocaleString('pt-BR')} HAB
                    </span>
                    {m.unlocked && m.built ? (
                      <span className="inline-flex items-center gap-0.5 font-pixel text-[6.5px] text-[#66d98c]">
                        <Check className="w-3 h-3" aria-hidden="true" />
                        CONSTRUÍDO
                      </span>
                    ) : m.unlocked ? (
                      <span className="font-pixel text-[6.5px] text-[#ffe066]">
                        LIBERADO
                      </span>
                    ) : (
                      <span className="font-pixel text-[6.5px] text-[#ffe066] tabular-nums">
                        +${m.rewardCash.toLocaleString('pt-BR')}
                      </span>
                    )}
                  </div>
                  <div className="text-[14.5px] font-bold text-[#eef2f7] leading-tight">
                    {m.title}
                  </div>
                  {m.unlocked && !m.built && m.actionId ? (
                    <button
                      type="button"
                      onClick={() => onNavigateNeed('emergencies')}
                      className="pixel-btn mt-0.5 px-2 py-1 bg-[#1e4e79] hover:bg-[#276399] text-[#e6f4ff] font-pixel text-[6.5px] flex items-center justify-center gap-1"
                    >
                      <span>Construir em Obras</span>
                      <ArrowRight className="w-2.5 h-2.5" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </section>

          {/* Mobilidade Urbana: Sistema de Ônibus & Metrô Metropolitano */}
          <section
            data-testid="report-public-transit"
            aria-label="Transporte público coletivo (ônibus e metrô)"
            className="pixel-inset p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h3 className="font-pixel text-[9px] text-[#38bdf8]">
                TRANSPORTE PÚBLICO COLETIVO (ÔNIBUS &amp; METRÔ)
              </h3>
              <span className="text-[13px] text-[#9eb0c9]">
                Bairros coesos + Avenidas Largas 2×2 (obrigatórias para Arranha-Céus Nv.4)
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center tabular-nums">
              <div className="bg-[#0b101b] border border-[#2a3854] px-2 py-1.5">
                <div className="font-pixel text-[6.5px] text-[#0ea5e9]">TERMINAIS ÔNIBUS</div>
                <div
                  data-testid="report-bus-count"
                  className="text-[19px] font-bold text-[#38bdf8] leading-tight"
                >
                  {hud.stats.busStationCount}
                </div>
              </div>
              <div className="bg-[#0b101b] border border-[#2a3854] px-2 py-1.5">
                <div className="font-pixel text-[6.5px] text-[#a78bfa]">ESTAÇÕES METRÔ</div>
                <div
                  data-testid="report-metro-count"
                  className="text-[19px] font-bold text-[#c084fc] leading-tight"
                >
                  {hud.stats.metroStationCount}
                </div>
              </div>
              <div className="bg-[#0b101b] border border-[#2a3854] px-2 py-1.5">
                <div className="font-pixel text-[6.5px] text-[#66d98c]">PASSAGEIROS/MÊS</div>
                <div className="text-[19px] font-bold text-[#66d98c] leading-tight">
                  {hud.stats.monthlyTransitRiders.toLocaleString('pt-BR')}
                </div>
              </div>
              <div className="bg-[#0b101b] border border-[#2a3854] px-2 py-1.5">
                <div className="font-pixel text-[6.5px] text-[#ffe066]">COBERTURA REDE</div>
                <div className="text-[19px] font-bold text-[#ffe066] leading-tight">
                  {hud.stats.transitCoveragePct}%
                </div>
              </div>
            </div>
          </section>

          {/* Malha Viária Planejada (Plano Diretor) */}
          <section
            data-testid="report-road-hierarchy"
            aria-label="Malha viária planejada da cidade"
            className="pixel-inset p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h3 className="font-pixel text-[9px] text-[#66d98c]">
                PLANO DIRETOR VIÁRIO (MALHA ORGANIZADA)
              </h3>
              <span className="text-[13px] text-[#9eb0c9]">
                Quarteirões 2×2 · Eixos Arteriais · Anel Rodoviário · Trevos Automáticos
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-center tabular-nums">
              <div className="bg-[#0b101b] border border-[#2a3854] px-2 py-1.5">
                <div className="font-pixel text-[6.5px] text-[#9eb0c9]">RUAS LOCAIS</div>
                <div className="text-[19px] font-bold text-[#eef2f7] leading-tight">
                  {hud.stats.streetCount}
                </div>
              </div>
              <div className="bg-[#0b101b] border border-[#2a3854] px-2 py-1.5">
                <div className="font-pixel text-[6.5px] text-[#66d98c]">AVENIDAS</div>
                <div className="text-[19px] font-bold text-[#66d98c] leading-tight">
                  {hud.stats.avenueCount}
                </div>
              </div>
              <div className="bg-[#0b101b] border border-[#2a3854] px-2 py-1.5">
                <div className="font-pixel text-[6.5px] text-[#38bdf8]">AV. LARGA 2×2</div>
                <div
                  data-testid="report-wide-avenue-count"
                  className="text-[19px] font-bold text-[#38bdf8] leading-tight"
                >
                  {hud.stats.wideAvenueTileCount}
                </div>
              </div>
              <div className="bg-[#0b101b] border border-[#2a3854] px-2 py-1.5">
                <div className="font-pixel text-[6.5px] text-[#f5b73b]">ESTRADAS</div>
                <div className="text-[19px] font-bold text-[#f5b73b] leading-tight">
                  {hud.stats.highwayCount}
                </div>
              </div>
              <div className="bg-[#0b101b] border border-[#2a3854] px-2 py-1.5">
                <div className="font-pixel text-[6.5px] text-[#56c2ff]">TREVOS</div>
                <div className="text-[19px] font-bold text-[#56c2ff] leading-tight">
                  {hud.stats.interchangeCount}
                </div>
              </div>
              <div className="bg-[#0b101b] border border-[#2a3854] px-2 py-1.5">
                <div className="font-pixel text-[6.5px] text-[#c28bff]">PONTES NO RIO</div>
                <div className="text-[19px] font-bold text-[#c28bff] leading-tight">
                  {hud.stats.bridgeSpanCount}
                </div>
              </div>
            </div>
          </section>

          {/* Zoneamento Inteligente & Valor Imobiliário */}
          <section
            data-testid="report-zoning-summary"
            aria-label="Zoneamento inteligente e valor imobiliário"
            className="pixel-inset p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h3 className="font-pixel text-[9px] text-[#56c2ff]">
                ZONEAMENTO INTELIGENTE &amp; ESTABELECIMENTOS (20 TIPOS)
              </h3>
              <span className="text-[13px] text-[#9eb0c9]">
                Rural Periférico · Res. Baixo/Médio/Alto Valor · Multi-Lotes
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 text-center tabular-nums">
              <div className="bg-[#0b101b] border border-[#2a3854] px-2 py-1.5">
                <div className="font-pixel text-[6.5px] text-[#a3e635]">ZONA RURAL</div>
                <div className="text-[19px] font-bold text-[#a3e635] leading-tight">
                  {hud.stats.ruralCount}
                </div>
              </div>
              <div className="bg-[#0b101b] border border-[#2a3854] px-2 py-1.5">
                <div className="font-pixel text-[6.5px] text-[#d97706]">RES. BAIXO</div>
                <div className="text-[19px] font-bold text-[#fbbf24] leading-tight">
                  {hud.stats.resLowValueCount}
                </div>
              </div>
              <div className="bg-[#0b101b] border border-[#2a3854] px-2 py-1.5">
                <div className="font-pixel text-[6.5px] text-[#66d98c]">RES. MÉDIO</div>
                <div className="text-[19px] font-bold text-[#66d98c] leading-tight">
                  {hud.stats.resMedValueCount}
                </div>
              </div>
              <div className="bg-[#0b101b] border border-[#2a3854] px-2 py-1.5">
                <div className="font-pixel text-[6.5px] text-[#38bdf8]">RES. ALTO</div>
                <div className="text-[19px] font-bold text-[#38bdf8] leading-tight">
                  {hud.stats.resHighValueCount}
                </div>
              </div>
              <div className="bg-[#0b101b] border border-[#2a3854] px-2 py-1.5">
                <div className="font-pixel text-[6.5px] text-[#56c2ff]">COMERCIAL</div>
                <div className="text-[19px] font-bold text-[#56c2ff] leading-tight">
                  {hud.stats.commercialCount}
                </div>
              </div>
              <div className="bg-[#0b101b] border border-[#2a3854] px-2 py-1.5">
                <div className="font-pixel text-[6.5px] text-[#f5b73b]">INDUSTRIAL</div>
                <div className="text-[19px] font-bold text-[#f5b73b] leading-tight">
                  {hud.stats.industrialCount}
                </div>
              </div>
              <div className="bg-[#0b101b] border border-[#2a3854] px-2 py-1.5">
                <div className="font-pixel text-[6.5px] text-[#c28bff]">MULTI-LOTE</div>
                <div className="text-[19px] font-bold text-[#c28bff] leading-tight">
                  {hud.stats.multiTileBuildingCount}
                </div>
              </div>
              <div className="bg-[#0b101b] border border-[#2a3854] px-2 py-1.5">
                <div className="font-pixel text-[6.5px] text-[#ff8ec7]">ESTABELECIM.</div>
                <div
                  data-testid="report-establishment-count"
                  className="text-[19px] font-bold text-[#ff8ec7] leading-tight"
                >
                  {hud.stats.establishmentCount}
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {/* TAB 3: HISTÓRICO 12M (Gráficos + Tabela Mensal dos últimos 12 meses) */}
      {activeTab === 'history' ? (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
            <MiniLineChart
              title="POPULAÇÃO"
              currentValueLabel={hud.totalPopulation.toLocaleString('pt-BR')}
              accentColor="#56c2ff"
              values={popVals}
              labels={labels}
              fixedMin={0}
            />
            <MiniLineChart
              title="CAIXA & RECEITA"
              currentValueLabel={`$${hud.money.toLocaleString('pt-BR')}`}
              accentColor="#ffe066"
              values={moneyVals}
              labels={labels}
              secondaryValues={revVals}
              secondaryColor="#66d98c"
              secondaryLabel="--- Receita/mês"
            />
            <MiniLineChart
              title="FELICIDADE"
              currentValueLabel={`${hud.globalHappiness}%`}
              accentColor="#66d98c"
              values={happyVals}
              labels={labels}
              fixedMin={0}
              fixedMax={100}
            />
          </div>

          <section
            data-testid="report-history-table"
            aria-label="Histórico mensal registrado"
            className="pixel-inset p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h3 className="font-pixel text-[9px] text-[#56c2ff]">
                REGISTRO MENSAL ({hist.length} {hist.length === 1 ? 'MÊS' : 'MESES'})
              </h3>
              <span className="text-[13.5px] text-[#9eb0c9]">
                Evolução de população, caixa, arrecadação e felicidade
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 tabular-nums">
              {[...hist].reverse().map((entry, idx) => (
                <div
                  key={`${entry.dateLabel}-${idx}`}
                  className="bg-[#0b101b] border border-[#24324d] px-2.5 py-2 flex flex-col gap-0.5 text-[14px]"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-pixel text-[7.5px] text-[#ffe066]">
                      {entry.dateLabel}
                    </span>
                    <span className="text-[13px] text-[#66d98c] font-bold">
                      Fel. {entry.happiness}%
                    </span>
                  </div>
                  <div className="text-[#dce6f2]">
                    Pop:{' '}
                    <strong className="text-[#56c2ff]">
                      {entry.population.toLocaleString('pt-BR')}
                    </strong>
                  </div>
                  <div className="text-[#9eb0c9] text-[13px]">
                    Caixa: <strong className="text-[#eef2f7]">${entry.money.toLocaleString('pt-BR')}</strong> · Rec:{' '}
                    <strong className="text-[#66d98c]">+${entry.revenue.toLocaleString('pt-BR')}</strong>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </PixelModal>
  );
}

