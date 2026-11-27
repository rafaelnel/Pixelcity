import { useEffect, useRef, useState } from 'react';
import { renderLandmarkArtworkCanvas } from '../game/pixelRenderer';
import {
  BUDGET_AREA_META,
  evaluateBudgetCampaignStatus,
} from '../game/simulationConfig';
import type {
  EmergencyActionId,
  EmergencyOfferView,
  ExpandDirection,
  HudSnapshot,
} from '../game/types';
import { PixelModal } from './PixelModal';

interface EmergenciesModalProps {
  hud: HudSnapshot;
  feedbackMsg: string | null;
  onExecuteAction: (actionId: EmergencyActionId) => void;
  onExpandLand: (direction: ExpandDirection) => void;
  onClose: () => void;
}

type WorksInternalTab = 'works' | 'terrain' | 'urgent';

const DIRECTION_ARROWS: Record<ExpandDirection, string> = {
  norte: '↑',
  leste: '→',
  sul: '↓',
  oeste: '←',
};

interface LandmarkArtPreviewProps {
  kind: 'port' | 'airport' | 'bridge' | 'bus' | 'metro' | 'shopping';
  level: number;
  builtCount: number;
  active: boolean;
}

function computeWorkProgressPct(
  boost: { remainingMonths: number; totalMonths?: number },
  monthProgress: number
): number {
  const total = Math.max(1, boost.totalMonths ?? boost.remainingMonths ?? 1);
  const clampedMonth = Math.max(0, Math.min(1, monthProgress || 0));
  const elapsed = Math.max(0, total - boost.remainingMonths + clampedMonth);
  return Math.min(99, Math.max(6, Math.round((elapsed / total) * 100)));
}

function LandmarkArtPreview({ kind, level, builtCount, active }: LandmarkArtPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const maxArtLevel = kind === 'bridge' ? 4 : 3;
  const [previewLevel, setPreviewLevel] = useState<number>(Math.max(1, Math.min(maxArtLevel, level)));
  const [isInView, setIsInView] = useState<boolean>(true);

  useEffect(() => {
    setPreviewLevel(Math.max(1, Math.min(maxArtLevel, level)));
  }, [level, maxArtLevel]);

  // Pause continuous RAF loop when the card is scrolled out of view
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          setIsInView(entry.isIntersecting);
        }
      },
      { threshold: 0.05 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Always draw at least one crisp frame immediately
    renderLandmarkArtworkCanvas(ctx, kind, previewLevel, builtCount > 0, 0);

    if (!active || !isInView) {
      return;
    }

    let rafId = 0;
    const start = performance.now();
    let lastDraw = -100;

    const draw = (now: number) => {
      if (now - lastDraw >= 65) {
        lastDraw = now;
        renderLandmarkArtworkCanvas(
          ctx,
          kind,
          previewLevel,
          builtCount > 0,
          (now - start) / 1000
        );
      }
      rafId = window.requestAnimationFrame(draw);
    };

    rafId = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(rafId);
  }, [kind, previewLevel, builtCount, active, isInView]);

  return (
    <div
      ref={containerRef}
      className="relative border-2 border-[#0b0f19] bg-[#0b101b] overflow-hidden"
    >
      <canvas
        ref={canvasRef}
        width={216}
        height={102}
        data-testid={`${kind}-art-canvas`}
        aria-label={
          kind === 'port'
            ? `Arte 64-bit do Complexo Portuário Nível ${previewLevel}`
            : kind === 'airport'
              ? `Arte 64-bit do Complexo Aeroportuário Nível ${previewLevel}`
              : kind === 'bus'
                ? `Arte 64-bit do Sistema de Ônibus Urbano Nível ${previewLevel}`
                : kind === 'metro'
                  ? `Arte 64-bit do Sistema de Metrô Metropolitano Nível ${previewLevel}`
                  : kind === 'shopping'
                    ? `Arte 64-bit do Shopping Center Nível ${previewLevel}`
                    : `Arte 64-bit da Ponte Fluvial Nível ${previewLevel}`
        }
        className="w-full h-[106px] block"
      />
      {/* Quick level art preview switcher */}
      <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 bg-[#0b101b]/85 px-1.5 py-0.5 border border-[#334361]">
        <span className="font-pixel text-[6px] text-[#9eb0c9] mr-0.5">ARTE:</span>
        {(kind === 'bridge' ? [1, 2, 3, 4] : [1, 2, 3]).map((lv) => (
          <button
            key={lv}
            type="button"
            data-testid={`${kind}-art-lv-${lv}`}
            onClick={() => setPreviewLevel(lv)}
            className={`px-1.5 py-0.5 font-pixel text-[6.5px] border whitespace-nowrap ${
              previewLevel === lv
                ? 'bg-[#2b6cb0] text-white border-[#7dd3fc]'
                : 'bg-[#151e30] text-[#9eb0c9] border-[#2c3a57] hover:text-white'
            }`}
          >
            {kind === 'bridge' && lv === 4
              ? '2× Nv.4'
              : kind === 'shopping'
                ? lv === 1
                  ? '6×6 Nv.1'
                  : lv === 2
                    ? '8×8 Nv.2'
                    : '9×9 Nv.3'
                : `Nv.${lv}`}
          </button>
        ))}
      </div>
    </div>
  );
}

export function EmergenciesModal({
  hud,
  feedbackMsg,
  onExecuteAction,
  onExpandLand,
  onClose,
}: EmergenciesModalProps) {
  const st = hud.stats;
  const netBalance = hud.financials.netBalance;
  const incidentOffer = hud.emergencyOffers.find((o) => o.id === 'incident_response') ?? null;

  const [activeSubTab, setActiveSubTab] = useState<WorksInternalTab>(() =>
    incidentOffer ? 'urgent' : 'works'
  );

  // Structural & Landmark evolution works (Tab 1: Obras & Marcos)
  const featuredTransportOffers = hud.emergencyOffers.filter(
    (o) =>
      o.id === 'port_evolution' ||
      o.id === 'airport_evolution' ||
      o.id === 'shopping_evolution' ||
      o.id === 'bus_transit_project' ||
      o.id === 'metro_transit_project'
  );
  const civicStructureOffers = hud.emergencyOffers.filter(
    (o) =>
      o.id === 'sports_center_project' ||
      o.id === 'toll_plaza_project' ||
      o.id === 'landmark_project'
  );

  // Automatic budget-driven programs (read-only status in Tab 3: Ações & Urgências)
  const budgetPrograms = evaluateBudgetCampaignStatus(st.coverage, hud.money);

  const pendingWorks = hud.pendingWorks ?? [];
  const readyStructuralCount = [...featuredTransportOffers, ...civicStructureOffers].filter(
    (o) =>
      o.unlocked &&
      !o.inProgress &&
      hud.money >= o.cost &&
      !pendingWorks.some((w) => w.actionId === o.id)
  ).length;
  const expandableDirsCount = hud.landExpansions.filter(
    (e) => e.canExpand && hud.money >= e.cost
  ).length;
  const activeAutoProgramsCount = budgetPrograms.filter(
    (p) => p.eligible || hud.activeBoosts.some((b) => b.actionId === p.spec.id)
  ).length;
  const urgentCount =
    (incidentOffer ? 1 : 0) + activeAutoProgramsCount;

  const renderStandardOfferCard = (offer: EmergencyOfferView) => {
    const canAfford = hud.money >= offer.cost;
    const pendingWork = pendingWorks.find((w) => w.actionId === offer.id);
    const isExecuting = Boolean(pendingWork);
    const isReadyToClick = !isExecuting && offer.unlocked && canAfford;
    const disabled = isExecuting || !offer.unlocked || !canAfford;
    const progressPct = pendingWork
      ? computeWorkProgressPct(pendingWork, hud.monthProgress)
      : 0;
    const isLandmark = offer.id === 'landmark_project';

    return (
      <div
        key={offer.id}
        data-testid={`emergency-card-${offer.id}`}
        className={`pixel-inset p-3.5 flex flex-col justify-between gap-2.5 ${
          isLandmark ? 'sm:col-span-2 border-[#ff8ec7]/50' : ''
        }`}
      >
        <div>
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                data-testid={`emergency-tier-${offer.id}`}
                className="font-pixel text-[7px] px-1.5 py-0.5 bg-[#0f1624] border border-[#334361] text-[#ffe066]"
              >
                {offer.tierLabel}
              </span>
              <h3
                className="font-pixel text-[9px] leading-relaxed"
                style={{ color: offer.accentColor }}
              >
                {offer.title}
              </h3>
            </div>
            <span className="text-[19px] font-bold text-[#ffe066] tabular-nums shrink-0 leading-none">
              ${offer.cost.toLocaleString('pt-BR')}
            </span>
          </div>

          <p className="text-[15.5px] text-[#dce6f2] leading-snug mb-1">
            {offer.summary}
          </p>
          <p className="text-[14.5px] text-[#66d98c] leading-snug mb-1">
            {offer.effectHint}
          </p>
          <p className="text-[13px] text-[#8fa4bf] leading-snug">
            {offer.nextEvolutionHint}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          {pendingWork ? (
            <button
              type="button"
              disabled
              role="progressbar"
              aria-valuenow={progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
              data-testid={`emergency-exec-${offer.id}`}
              data-work-state="in_progress"
              className="relative w-full py-2.5 px-3 font-pixel text-[7.5px] border-2 border-[#4ade80] bg-[#0f172a] text-white overflow-hidden select-none"
            >
              <div
                data-testid={`emergency-progress-fill-${offer.id}`}
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#15803d] via-[#16a34a] to-[#22c55e] transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
              <span className="relative z-10 flex items-center justify-between gap-2 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                <span>EM CONSTRUÇÃO · {progressPct}%</span>
                <span>
                  {pendingWork.remainingMonths}{' '}
                  {pendingWork.remainingMonths === 1 ? 'mês restante' : 'meses restantes'}
                </span>
              </span>
            </button>
          ) : (
            <button
              type="button"
              disabled={disabled}
              data-testid={`emergency-exec-${offer.id}`}
              data-work-state={isReadyToClick ? 'ready' : 'normal'}
              onClick={() => onExecuteAction(offer.id)}
              className={`pixel-btn w-full py-2 px-3 font-pixel text-[8px] flex items-center justify-center gap-2 transition-colors ${
                isReadyToClick
                  ? 'bg-[#16a34a] hover:bg-[#15803d] border-[#4ade80] text-white shadow-[0_0_12px_rgba(22,163,74,0.45)]'
                  : 'bg-[#25314a] hover:bg-[#314161] text-[#eef2f7]'
              }`}
            >
              <span>
                {!offer.unlocked
                  ? offer.lockReason ?? 'Bloqueado'
                  : !canAfford
                    ? `Falta caixa ($${offer.cost.toLocaleString('pt-BR')})`
                    : `Construir / Executar (-$${offer.cost.toLocaleString('pt-BR')})`}
              </span>
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderTransportEvolutionCard = (offer: EmergencyOfferView) => {
    const isPort = offer.id === 'port_evolution';
    const isBridge = offer.id === 'emergency_roadworks';
    const isBus = offer.id === 'bus_transit_project';
    const isMetro = offer.id === 'metro_transit_project';
    const isShopping = offer.id === 'shopping_evolution';
    const kind: 'port' | 'airport' | 'bridge' | 'bus' | 'metro' | 'shopping' = isPort
      ? 'port'
      : isBridge
        ? 'bridge'
        : isBus
          ? 'bus'
          : isMetro
            ? 'metro'
            : isShopping
              ? 'shopping'
              : 'airport';
    const builtCount = isPort
      ? st.portCount
      : isBridge
        ? st.bridgeSpanCount
        : isBus
          ? st.busStationCount
          : isMetro
            ? st.metroStationCount
            : isShopping
              ? st.shoppingCount
              : st.airportCount;
    const isBuilt = builtCount > 0;
    const artLevel = isBridge
      ? Math.max(1, Math.min(4, isBuilt ? Math.max(st.bridgeLevel, offer.tier) : offer.tier))
      : isShopping
        ? Math.max(1, Math.min(3, isBuilt ? Math.max(st.shoppingLevel || 1, offer.tier) : offer.tier))
        : Math.max(1, Math.min(3, isBuilt ? Math.max(1, offer.tier - 1) : offer.tier));
    const canAfford = hud.money >= offer.cost;
    const pendingWork = pendingWorks.find((w) => w.actionId === offer.id);
    const isExecuting = Boolean(pendingWork);
    const isReadyToClick = !isExecuting && offer.unlocked && canAfford;
    const disabled = isExecuting || !offer.unlocked || !canAfford;
    const progressPct = pendingWork
      ? computeWorkProgressPct(pendingWork, hud.monthProgress)
      : 0;
    const stepLabels = isBridge
      ? ['Pedra Nv.1', 'Arcos Nv.2', 'Estaiada 3', 'Dupla 2× 4']
      : isBus
        ? ['Frota Nv.1', 'Corredor 2', 'BRT Hub 3']
        : isMetro
          ? ['Linha 1', 'Anel Nv.2', 'Expresso 3']
          : isShopping
            ? ['Pequeno 6×6', 'Médio 8×8', 'Grande 9×9']
            : ['Fase I · Nv.1', 'Fase II · Nv.2', 'Fase III · Nv.3', 'Fase IV · Hub'];

    return (
      <div
        key={offer.id}
        data-testid={`emergency-card-${offer.id}`}
        className="pixel-inset p-3.5 flex flex-col justify-between gap-2.5 border-2"
        style={{
          borderColor: isPort
            ? 'rgba(56, 189, 248, 0.45)'
            : isBridge
              ? 'rgba(102, 217, 140, 0.45)'
              : isBus
                ? 'rgba(14, 165, 233, 0.5)'
                : isMetro
                  ? 'rgba(139, 92, 246, 0.52)'
                  : isShopping
                    ? 'rgba(244, 114, 182, 0.55)'
                    : 'rgba(255, 224, 102, 0.45)',
        }}
      >
        <div className="flex flex-col gap-2">
          {/* Header with status badge & evolutionary tier */}
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                <span
                  data-testid={`emergency-tier-${offer.id}`}
                  className="font-pixel text-[7px] px-1.5 py-0.5 bg-[#0f1624] border border-[#334361] text-[#ffe066]"
                >
                  {offer.tierLabel}
                </span>
                <span
                  className={`font-pixel text-[6.5px] px-1.5 py-0.5 border ${
                    isBuilt
                      ? 'bg-[#132f23] border-[#66d98c] text-[#66d98c]'
                      : offer.unlocked
                        ? 'bg-[#14283b] border-[#38bdf8] text-[#7dd3fc]'
                        : 'bg-[#2a1f16] border-[#f5b73b] text-[#ffe066]'
                  }`}
                >
                  {isBridge
                    ? `${st.bridgeSpanCount} ${st.bridgeSpanCount === 1 ? 'PONTE' : 'PONTES'} · NV.${st.bridgeLevel}`
                    : isBuilt
                      ? isBus
                        ? `${builtCount} ${builtCount === 1 ? 'TERMINAL' : 'TERMINAIS'} ATIVO`
                        : isMetro
                          ? `${builtCount} ${builtCount === 1 ? 'ESTAÇÃO' : 'ESTAÇÕES'} ATIVA`
                          : isShopping
                            ? `SHOPPING NV.${st.shoppingLevel || 1} (${st.shoppingLevel === 3 ? '9×9' : st.shoppingLevel === 2 ? '8×8' : '6×6'})`
                            : `CONSTRUÍDO (${builtCount} no mapa)`
                      : offer.unlocked
                        ? 'LIBERADO · AGUARDANDO ORDEM'
                        : 'BLOQUEADO · MARCO POPULACIONAL'}
                </span>
              </div>
              <h4
                className="font-pixel text-[9px] leading-relaxed"
                style={{ color: offer.accentColor }}
              >
                {offer.title}
              </h4>
            </div>
            <span className="text-[19px] font-bold text-[#ffe066] tabular-nums shrink-0 leading-none">
              ${offer.cost.toLocaleString('pt-BR')}
            </span>
          </div>

          {/* 64-Bit Pixel Art Scenic Illustration + Isometric Diorama Preview */}
          <LandmarkArtPreview
            kind={kind}
            level={artLevel}
            builtCount={builtCount}
            active={activeSubTab === 'works'}
          />

          {/* Evolutionary Progress Steps */}
          <div className={`grid gap-1 ${stepLabels.length === 3 ? 'grid-cols-3' : 'grid-cols-4'}`}>
            {stepLabels.map((stepLabel, idx) => {
              const stepNum = idx + 1;
              const done =
                offer.tier > stepNum ||
                (isShopping ? st.shoppingLevel >= stepNum : stepNum === 1 && isBuilt);
              const current = offer.tier === stepNum;
              return (
                <div
                  key={stepLabel}
                  className={`px-1 py-0.5 text-center font-pixel text-[6px] border truncate ${
                    done
                      ? 'bg-[#143326] border-[#66d98c] text-[#66d98c]'
                      : current
                        ? 'bg-[#1f2e4d] border-[#ffe066] text-[#ffe066]'
                        : 'bg-[#101726] border-[#26324a] text-[#6f829e]'
                  }`}
                >
                  {stepLabel}
                </div>
              );
            })}
          </div>

          <p className="text-[15.5px] text-[#dce6f2] leading-snug">
            {offer.summary}
          </p>
          <p className="text-[14.5px] text-[#66d98c] leading-snug">
            {offer.effectHint}
          </p>
          <p className="text-[13px] text-[#8fa4bf] leading-snug">
            {offer.nextEvolutionHint}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          {pendingWork ? (
            <button
              type="button"
              disabled
              role="progressbar"
              aria-valuenow={progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
              data-testid={`emergency-exec-${offer.id}`}
              data-work-state="in_progress"
              className="relative w-full py-2.5 px-3 font-pixel text-[7.5px] border-2 border-[#4ade80] bg-[#0f172a] text-white overflow-hidden select-none"
            >
              <div
                data-testid={`emergency-progress-fill-${offer.id}`}
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#15803d] via-[#16a34a] to-[#22c55e] transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
              <span className="relative z-10 flex items-center justify-between gap-2 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                <span>EM CONSTRUÇÃO · {progressPct}%</span>
                <span>
                  {pendingWork.remainingMonths}{' '}
                  {pendingWork.remainingMonths === 1 ? 'mês restante' : 'meses restantes'}
                </span>
              </span>
            </button>
          ) : (
            <button
              type="button"
              disabled={disabled}
              data-testid={`emergency-exec-${offer.id}`}
              data-work-state={isReadyToClick ? 'ready' : 'normal'}
              onClick={() => onExecuteAction(offer.id)}
              className={`pixel-btn w-full py-2.5 px-3 font-pixel text-[8px] flex items-center justify-center gap-2 transition-colors ${
                isReadyToClick
                  ? 'bg-[#16a34a] hover:bg-[#15803d] border-[#4ade80] text-white shadow-[0_0_12px_rgba(22,163,74,0.45)]'
                  : 'bg-[#25314a] hover:bg-[#314161] text-[#eef2f7]'
              }`}
            >
              <span>
                {!offer.unlocked
                  ? `${offer.lockReason ?? 'Bloqueado'} para desbloquear`
                  : !canAfford
                    ? `Falta caixa ($${offer.cost.toLocaleString('pt-BR')})`
                    : isBridge
                      ? `Executar ${offer.tierLabel} (-$${offer.cost.toLocaleString('pt-BR')})`
                      : offer.tier === 1 && !isBuilt
                        ? `Construir ${
                            isPort
                              ? 'Porto Fluvial'
                              : isBus
                                ? 'Terminais de Ônibus'
                                : isMetro
                                  ? 'Metrô Metropolitano'
                                  : isShopping
                                    ? 'Shopping Pequeno 6×6'
                                    : 'Aeroporto'
                          } (-$${offer.cost.toLocaleString('pt-BR')})`
                        : `Pagar e Evoluir ${offer.tierLabel} (-$${offer.cost.toLocaleString('pt-BR')})`}
              </span>
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <PixelModal
      title="OBRAS & AÇÕES · MARCOS, TERRENOS E URGÊNCIAS"
      subtitle="Evolua Shopping, Ônibus, Metrô, Porto e Aeroporto em arte 64-bit, expanda o mapa ou acione intervenções urbanas."
      headerSummary={
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span>
              Caixa atual:{' '}
              <strong className="text-[#ffe066]">
                ${hud.money.toLocaleString('pt-BR')}
              </strong>
            </span>
            <span className="text-[#4a5d7a]">·</span>
            <span>
              Saldo projetado:{' '}
              <strong className={netBalance >= 0 ? 'text-[#66d98c]' : 'text-[#ff6b6b]'}>
                {netBalance >= 0 ? '+' : '-'}${Math.abs(netBalance).toLocaleString('pt-BR')}/mês
              </strong>
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[#cfd9e8]">
            <span>
              Mapa: <strong className="text-[#eef2f7]">{hud.gridWidth}×{hud.gridHeight}</strong>
            </span>
            {pendingWorks.length > 0 ? (
              <>
                <span className="text-[#4a5d7a]">·</span>
                <span className="text-[#4ade80] font-bold">
                  {pendingWorks.length} {pendingWorks.length === 1 ? 'obra em andamento' : 'obras em andamento'}
                </span>
              </>
            ) : null}
          </div>
        </>
      }
      accentColor="#ff785a"
      maxWidthClass="max-w-[920px]"
      onClose={onClose}
      testId="emergencies-modal"
    >
      {/* Internal Navigation Tabs (Obras & Marcos | Terreno | Ações & Urgências) */}
      <div
        role="tablist"
        aria-label="Seções de Obras e Ações"
        className="grid grid-cols-3 gap-1.5 mb-3"
      >
        <button
          type="button"
          role="tab"
          data-testid="works-tab-works"
          aria-selected={activeSubTab === 'works'}
          onClick={() => setActiveSubTab('works')}
          className={`pixel-btn py-2 px-2 font-pixel text-[7px] sm:text-[8px] flex items-center justify-center gap-1.5 whitespace-nowrap ${
            activeSubTab === 'works'
              ? 'bg-[#2c3c5c] text-[#38bdf8] border-[#38bdf8]'
              : 'bg-[#161f33] text-[#bfd0e6] hover:bg-[#22304d]'
          }`}
        >
          <span>Obras &amp; Marcos</span>
          {pendingWorks.length > 0 ? (
            <span className="px-1 py-0.5 bg-[#15803d] text-white text-[6.5px] tabular-nums">
              {pendingWorks.length} em obra
            </span>
          ) : readyStructuralCount > 0 ? (
            <span className="px-1 py-0.5 bg-[#16a34a] text-white text-[6.5px] tabular-nums">
              {readyStructuralCount}
            </span>
          ) : null}
        </button>

        <button
          type="button"
          role="tab"
          data-testid="works-tab-terrain"
          aria-selected={activeSubTab === 'terrain'}
          onClick={() => setActiveSubTab('terrain')}
          className={`pixel-btn py-2 px-2 font-pixel text-[7px] sm:text-[8px] flex items-center justify-center gap-1.5 whitespace-nowrap ${
            activeSubTab === 'terrain'
              ? 'bg-[#2c3c5c] text-[#66d98c] border-[#66d98c]'
              : 'bg-[#161f33] text-[#bfd0e6] hover:bg-[#22304d]'
          }`}
        >
          <span>Terreno ({hud.gridWidth}×{hud.gridHeight})</span>
          {expandableDirsCount > 0 ? (
            <span className="px-1 py-0.5 bg-[#1f5f3b] text-[#a7f3d0] text-[6.5px] tabular-nums">
              +{expandableDirsCount}
            </span>
          ) : null}
        </button>

        <button
          type="button"
          role="tab"
          data-testid="works-tab-urgent"
          aria-selected={activeSubTab === 'urgent'}
          onClick={() => setActiveSubTab('urgent')}
          className={`pixel-btn py-2 px-2 font-pixel text-[7px] sm:text-[8px] flex items-center justify-center gap-1.5 whitespace-nowrap ${
            activeSubTab === 'urgent'
              ? 'bg-[#2c3c5c] text-[#ff785a] border-[#ff785a]'
              : 'bg-[#161f33] text-[#bfd0e6] hover:bg-[#22304d]'
          }`}
        >
          <span>Ações &amp; Urgências</span>
          {incidentOffer ? (
            <span className="px-1 py-0.5 bg-[#e05252] text-white text-[6.5px]">
              !
            </span>
          ) : urgentCount > 0 ? (
            <span className="px-1 py-0.5 bg-[#2b6cb0] text-white text-[6.5px] tabular-nums">
              {urgentCount}
            </span>
          ) : null}
        </button>
      </div>

      {/* Feedback Banner */}
      {feedbackMsg ? (
        <div
          data-testid="emergency-feedback"
          className="pixel-inset px-3 py-2 mb-3 text-[16px] text-[#66d98c] border-[#2e7d52]"
        >
          {feedbackMsg}
        </div>
      ) : null}

      {/* Urgent Contextual Urban Incident Intervention Card (Always visible at top if an incident is active!) */}
      {incidentOffer ? (
        <div
          data-testid="emergency-card-incident_response"
          className="mb-3.5 p-3.5 bg-[#2a1420] border-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
          style={{ borderColor: incidentOffer.accentColor }}
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span
                className="font-pixel text-[7px] px-1.5 py-0.5 bg-[#0f1624] border"
                style={{
                  borderColor: incidentOffer.accentColor,
                  color: incidentOffer.accentColor,
                }}
              >
                IMPREVISTO ATIVO · {incidentOffer.tierLabel}
              </span>
              <h3 className="font-pixel text-[9px] text-[#ffe066]">
                {incidentOffer.title}
              </h3>
            </div>
            <p className="text-[15.5px] text-[#ffd6dc] leading-snug">
              {incidentOffer.summary}
            </p>
            <p className="text-[14px] text-[#66d98c] mt-0.5">{incidentOffer.effectHint}</p>
          </div>
          <button
            type="button"
            disabled={hud.money < incidentOffer.cost}
            data-testid="emergency-exec-incident_response"
            data-work-state={hud.money >= incidentOffer.cost ? 'ready' : 'normal'}
            onClick={() => onExecuteAction('incident_response')}
            className={`pixel-btn px-3.5 py-2.5 font-pixel text-[8px] shrink-0 whitespace-nowrap ${
              hud.money >= incidentOffer.cost
                ? 'bg-[#16a34a] hover:bg-[#15803d] border-[#4ade80] text-white'
                : 'bg-[#25314a] text-[#eef2f7]'
            }`}
          >
            {hud.money < incidentOffer.cost
              ? `Falta caixa ($${incidentOffer.cost.toLocaleString('pt-BR')})`
              : `Resolver Agora (-$${incidentOffer.cost.toLocaleString('pt-BR')})`}
          </button>
        </div>
      ) : null}

      {/* TAB 1: OBRAS & MARCOS */}
      {activeSubTab === 'works' ? (
        <div className="flex flex-col gap-3.5">
          {/* Active Construction Sites Bar (when works are running) */}
          {pendingWorks.length > 0 ? (
            <div
              data-testid="active-pending-works-banner"
              className="pixel-inset p-2.5 flex flex-wrap items-center justify-between gap-2"
            >
              <span className="font-pixel text-[7.5px] text-[#4ade80]">
                CANTEIROS EM ANDAMENTO NO MAPA:
              </span>
              <div className="flex flex-wrap gap-2 text-[14.5px] tabular-nums">
                {pendingWorks.map((w) => {
                  const pct = computeWorkProgressPct(w, hud.monthProgress);
                  return (
                    <span
                      key={w.id}
                      className="px-2 py-0.5 bg-[#142a24] border border-[#4ade80]/70 text-[#eef2f7]"
                    >
                      {w.title} · <strong className="text-[#4ade80]">{pct}%</strong> (
                      <strong className="text-[#ffe066]">
                        {w.remainingMonths} {w.remainingMonths === 1 ? 'mês' : 'meses'}
                      </strong>
                      )
                    </span>
                  );
                })}
              </div>
            </div>
          ) : null}

          <section
            aria-label="Desbloqueio e evolução do Shopping, Porto, Aeroporto, Ônibus e Metrô"
            data-testid="transport-landmarks-section"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div>
                <h3 className="font-pixel text-[9px] text-[#38bdf8]">
                  OBRAS EVOLUTIVAS: SHOPPING (6×6 / 8×8 / 9×9), ÔNIBUS, METRÔ, PORTO &amp; AEROPORTO
                </h3>
                <p className="text-[14.5px] text-[#9eb0c9] leading-tight mt-0.5">
                  Botão <strong className="text-[#4ade80]">verde</strong> indica obra liberada com caixa suficiente. Em execução, vira uma <strong className="text-[#ffe066]">barra de progresso</strong> e abre canteiro no mapa.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {featuredTransportOffers.map(renderTransportEvolutionCard)}
            </div>
          </section>

          {/* Civic Structures & Landmarks (Sports Center, Toll Plaza, Monumental Stadium) */}
          <section aria-label="Marcos urbanos e infraestrutura especial">
            <h3 className="font-pixel text-[9px] text-[#ff8ec7] mb-2">
              MARCOS URBANOS &amp; INFRAESTRUTURA ESPECIAL
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {civicStructureOffers.map(renderStandardOfferCard)}
            </div>
          </section>
        </div>
      ) : null}

      {/* TAB 2: TERRENO */}
      {activeSubTab === 'terrain' ? (
        <section
          aria-label="Expansão de terreno nas 4 direções"
          data-testid="land-expansion-section"
          className="pixel-inset p-3.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <h3 className="font-pixel text-[9px] text-[#66d98c]">
                COMPRAR TERRENOS ADJACENTES (+8 FAIXAS POR EXPANSÃO)
              </h3>
              <p className="text-[15px] text-[#9eb0c9] leading-tight mt-0.5">
                Expanda o território da cidade nas 4 direções — rios, florestas e a rodovia externa acompanham naturalmente.
              </p>
            </div>
            <span
              data-testid="map-size-badge"
              className="font-pixel text-[8px] text-[#ffe066] bg-[#162033] border border-[#334361] px-2.5 py-1 tabular-nums"
            >
              MAPA {hud.gridWidth}×{hud.gridHeight}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {hud.landExpansions.map((exp) => {
              const canAfford = hud.money >= exp.cost;
              const disabled = !exp.canExpand || !canAfford;

              return (
                <button
                  key={exp.direction}
                  type="button"
                  disabled={disabled}
                  data-testid={`expand-btn-${exp.direction}`}
                  aria-label={`Expandir terreno ao ${exp.label} por $${exp.cost}`}
                  onClick={() => onExpandLand(exp.direction)}
                  className={`pixel-btn p-3 text-left flex flex-col justify-between gap-1.5 ${
                    exp.canExpand && canAfford
                      ? 'bg-[#173328] hover:bg-[#1e4536] border-[#4ade80]'
                      : 'bg-[#1b293f] hover:bg-[#243754]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-pixel text-[8px] text-[#66d98c]">
                      {DIRECTION_ARROWS[exp.direction]} {exp.label}
                    </span>
                    <span className="text-[14px] text-[#9eb0c9] tabular-nums">
                      {exp.expansionsDone}/{exp.maxExpansions}
                    </span>
                  </div>
                  <div className="text-[18px] font-bold tabular-nums text-[#ffe066]">
                    {!exp.canExpand
                      ? 'Máximo'
                      : `$${exp.cost.toLocaleString('pt-BR')}`}
                  </div>
                  <div className="text-[13.5px] text-[#9eb0c9] leading-tight">
                    {!exp.canExpand
                      ? 'Limite atingido'
                      : !canAfford
                        ? 'Caixa insuficiente'
                        : '+8 faixas de terra'}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* TAB 3: AÇÕES & URGÊNCIAS */}
      {activeSubTab === 'urgent' ? (
        <div className="flex flex-col gap-3.5">
          {!incidentOffer ? (
            <div className="pixel-inset px-3 py-2.5 text-[15px] text-[#9eb0c9]">
              Nenhum imprevisto urbano ativo no momento. Tempestades, apagões e reparos emergenciais aparecem aqui quando ocorrerem.
            </div>
          ) : null}

          {/* Automatic Budget-Driven Programs Status (Read-Only) */}
          <section
            aria-label="Programas urbanos automáticos via orçamento"
            data-testid="budget-driven-programs-section"
            className="pixel-inset p-3 flex flex-col gap-2.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-pixel text-[9px] text-[#66d98c]">
                  PROGRAMAS AUTOMÁTICOS (VIA ORÇAMENTO)
                </h3>
                <p className="text-[14px] text-[#9eb0c9] leading-tight mt-0.5">
                  Acontecem automaticamente todo mês conforme a qualidade dos investimentos nas áreas de orçamento ligadas a cada programa.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[14px] tabular-nums text-[#cfd9e8]">
                <span>
                  Poluição:{' '}
                  <strong
                    className={
                      st.avgPollution >= 30
                        ? 'text-[#ff6b6b]'
                        : st.avgPollution >= 16
                          ? 'text-[#f5b73b]'
                          : 'text-[#66d98c]'
                    }
                  >
                    {st.avgPollution}%
                  </strong>
                </span>
                <span>
                  Abandonados:{' '}
                  <strong className={st.abandonedCount > 0 ? 'text-[#ff6b6b]' : 'text-[#66d98c]'}>
                    {st.abandonedCount}
                  </strong>
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
              {budgetPrograms.map((prog) => {
                const activeBoost = hud.activeBoosts.find((b) => b.actionId === prog.spec.id);
                const primaryMeta = BUDGET_AREA_META[prog.spec.primaryArea];
                const secondaryMeta = BUDGET_AREA_META[prog.spec.secondaryArea];
                const isRunning = Boolean(activeBoost) || prog.eligible;

                return (
                  <div
                    key={prog.spec.id}
                    data-testid={`auto-program-${prog.spec.id}`}
                    className={`p-2.5 border flex flex-col justify-between gap-1.5 ${
                      isRunning
                        ? 'bg-[#11241e] border-[#3d8c61]'
                        : 'bg-[#0b101b] border-[#26344f]'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1.5 mb-1">
                        <span
                          className="font-pixel text-[7.5px]"
                          style={{ color: prog.spec.accentColor }}
                        >
                          {prog.tierTitle}
                        </span>
                        <span
                          className={`font-pixel text-[6.5px] px-1.5 py-0.5 border shrink-0 ${
                            activeBoost
                              ? 'bg-[#143326] border-[#66d98c] text-[#66d98c]'
                              : prog.eligible
                                ? 'bg-[#162b3d] border-[#56c2ff] text-[#7dd3fc]'
                                : 'bg-[#161c2b] border-[#334361] text-[#8fa4bf]'
                          }`}
                        >
                          {activeBoost
                            ? `ATIVO · FASE ${activeBoost.tier}`
                            : prog.eligible
                              ? `PRONTO · FASE ${prog.tier}`
                              : 'INATIVO'}
                        </span>
                      </div>
                      <p className="text-[13.5px] text-[#dce6f2] leading-snug">
                        {prog.spec.summary}
                      </p>
                      <p className="text-[12.5px] text-[#66d98c] leading-snug mt-0.5">
                        {prog.spec.effectHint}
                      </p>
                    </div>

                    <div className="pt-1.5 border-t border-[#1e2a42] flex flex-wrap items-center justify-between gap-1 text-[12.5px] tabular-nums">
                      <span className="text-[#9eb0c9]">
                        <strong style={{ color: primaryMeta.color }}>{primaryMeta.label}</strong>{' '}
                        {prog.primaryPct}% ·{' '}
                        <strong style={{ color: secondaryMeta.color }}>{secondaryMeta.label}</strong>{' '}
                        {prog.secondaryPct}%
                      </span>
                      <span
                        className={`font-bold ${
                          prog.eligible ? 'text-[#66d98c]' : 'text-[#f5b73b]'
                        }`}
                      >
                        Média {prog.weightedPct}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Currently Active Construction Works & Active Programs */}
          <div className="pixel-inset p-3">
            <div className="font-pixel text-[8px] text-[#8fa4bf] mb-1.5">
              OBRAS EM CONSTRUÇÃO E PROGRAMAS ATIVOS
            </div>
            {pendingWorks.length === 0 && hud.activeBoosts.length === 0 ? (
              <p className="text-[15px] text-[#8fa4bf]">
                Nenhuma obra em construção ou programa ativo no momento.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2 text-[15px] tabular-nums">
                {pendingWorks.map((w) => {
                  const pct = computeWorkProgressPct(w, hud.monthProgress);
                  return (
                    <div
                      key={w.id}
                      className="px-2.5 py-1 bg-[#142a24] border border-[#4ade80]/70 text-[#eef2f7]"
                    >
                      Em obra: {w.title} · <strong className="text-[#4ade80]">{pct}%</strong> ·{' '}
                      <strong className="text-[#ffe066]">
                        {w.remainingMonths} {w.remainingMonths === 1 ? 'mês' : 'meses'}
                      </strong>
                    </div>
                  );
                })}
                {hud.activeBoosts
                  .filter((b) => !pendingWorks.some((w) => w.actionId === b.actionId))
                  .map((b) => {
                    const pct = computeWorkProgressPct(b, hud.monthProgress);
                    return (
                      <div
                        key={b.id}
                        className="px-2.5 py-1 bg-[#1b263c] border border-[#334361] text-[#eef2f7]"
                      >
                        Programa: {b.label} · <strong className="text-[#4ade80]">{pct}%</strong> ·{' '}
                        <strong className="text-[#ffe066]">
                          {b.remainingMonths} {b.remainingMonths === 1 ? 'mês' : 'meses'}
                        </strong>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </PixelModal>
  );
}

