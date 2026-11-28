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
  MandateMissionId,
} from '../game/types';
import { PixelModal } from './PixelModal';

interface EmergenciesModalProps {
  hud: HudSnapshot;
  feedbackMsg: string | null;
  onExecuteAction: (actionId: EmergencyActionId) => void;
  onExpandLand: (direction: ExpandDirection) => void;
  onClaimMission?: (missionId: MandateMissionId) => void;
  onTriggerStadiumMatch?: () => void;
  onClose: () => void;
}

type WorksInternalTab = 'works' | 'missions' | 'terrain' | 'urgent';

const DIRECTION_ARROWS: Record<ExpandDirection, string> = {
  norte: '↑',
  leste: '→',
  sul: '↓',
  oeste: '←',
};

type PreviewArtworkKind =
  | 'port'
  | 'airport'
  | 'bridge'
  | 'bus'
  | 'metro'
  | 'shopping'
  | 'sports'
  | 'clean_energy'
  | 'hospital'
  | 'university'
  | 'amusement'
  | 'rail';

interface LandmarkArtPreviewProps {
  kind: PreviewArtworkKind;
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
  const isTwoLevelKind =
    kind === 'sports' ||
    kind === 'clean_energy' ||
    kind === 'hospital' ||
    kind === 'university' ||
    kind === 'amusement' ||
    kind === 'rail';
  const maxArtLevel = kind === 'bridge' ? 4 : isTwoLevelKind ? 2 : 3;
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
                    : kind === 'sports'
                      ? `Arte 64-bit do Centro de Esporte ${previewLevel === 1 ? '2×2' : '4×4'}`
                      : `Arte 64-bit da Ponte Fluvial Nível ${previewLevel}`
        }
        className="w-full h-[106px] block"
      />
      {/* Quick level art preview switcher */}
      <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 bg-[#0b101b]/85 px-1.5 py-0.5 border border-[#334361]">
        <span className="font-pixel text-[6px] text-[#9eb0c9] mr-0.5">ARTE:</span>
        {(kind === 'bridge' ? [1, 2, 3, 4] : isTwoLevelKind ? [1, 2] : [1, 2, 3]).map((lv) => (
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
                  ? '5×5 Nv.1'
                  : lv === 2
                    ? '7×7 Nv.2'
                    : '9×9 Nv.3'
                : kind === 'sports'
                  ? lv === 1
                    ? '2×2 Nv.1'
                    : '4×4 Nv.2'
                  : kind === 'clean_energy'
                    ? lv === 1
                      ? '2×2 Solar'
                      : '3×3 Eólico'
                    : kind === 'hospital'
                      ? '3×3 Nv.' + lv
                      : kind === 'university' || kind === 'amusement'
                        ? lv === 1
                          ? '3×3 Nv.1'
                          : '4×4 Nv.2'
                        : kind === 'rail'
                          ? lv === 1
                            ? '3×2 Carga'
                            : '3×3 Mono'
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
  onClaimMission,
  onTriggerStadiumMatch,
  onClose,
}: EmergenciesModalProps) {
  const st = hud.stats;
  const netBalance = hud.financials.netBalance;
  const incidentOffer = hud.emergencyOffers.find((o) => o.id === 'incident_response') ?? null;

  const [activeSubTab, setActiveSubTab] = useState<WorksInternalTab>(() =>
    incidentOffer ? 'urgent' : 'works'
  );

  // Structural & Landmark evolution works sorted in strict First-Necessity order (Tab 1: Obras & Marcos)
  const orderedStructuralOffers = hud.emergencyOffers.filter(
    (o) => o.id !== 'incident_response'
  );
  const isIllustratedEvolutionWork = (id: EmergencyActionId) =>
    id === 'port_evolution' ||
    id === 'sports_center_project' ||
    id === 'clean_energy_project' ||
    id === 'bus_transit_project' ||
    id === 'hospital_project' ||
    id === 'airport_evolution' ||
    id === 'tech_university_project' ||
    id === 'shopping_evolution' ||
    id === 'amusement_park_project' ||
    id === 'rail_freight_project' ||
    id === 'metro_transit_project';

  // Automatic budget-driven programs (read-only status in Tab 3: Ações & Urgências)
  const budgetPrograms = evaluateBudgetCampaignStatus(st.coverage, hud.money);

  const pendingWorks = hud.pendingWorks ?? [];
  const mandateMissions = hud.mandateMissions ?? [];
  const claimableMissionsCount = mandateMissions.filter(
    (m) => m.completed && !m.claimed
  ).length;
  const completedMissionsCount = mandateMissions.filter((m) => m.claimed).length;
  const readyStructuralCount = orderedStructuralOffers.filter(
    (o) =>
      o.id !== 'incident_response' &&
      !o.fullyApproved &&
      o.unlocked &&
      hud.money >= o.cost
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
    const isFullyApproved = Boolean(offer.fullyApproved);
    const isReadyToClick = !isFullyApproved && offer.unlocked && canAfford;
    const disabled = isFullyApproved || !offer.unlocked || !canAfford;
    const progressPct = pendingWork
      ? computeWorkProgressPct(pendingWork, hud.monthProgress)
      : 0;
    const isLandmark = offer.id === 'landmark_project';
    const areaMeta = offer.investmentArea ? BUDGET_AREA_META[offer.investmentArea] : null;
    const covOk = (offer.investmentCoveragePct ?? 100) >= 100;

    return (
      <div
        key={offer.id}
        data-testid={`emergency-card-${offer.id}`}
        className={`pixel-inset p-3.5 flex flex-col justify-between gap-2.5 border-2 ${
          isFullyApproved
            ? 'border-[#3d8c61] bg-[#0e201b]'
            : isLandmark
              ? 'border-[#ff8ec7]/50'
              : 'border-[#334361]'
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
              {isFullyApproved ? '✓' : `$${offer.cost.toLocaleString('pt-BR')}`}
            </span>
          </div>

          <p className="text-[15.5px] text-[#dce6f2] leading-snug mb-1">
            {offer.summary}
          </p>
          <p className="text-[14.5px] text-[#66d98c] leading-snug mb-1">
            {offer.effectHint}
          </p>
          {areaMeta ? (
            <div className="bg-[#0b101b] border border-[#26344f] px-2 py-1 text-[12.5px] leading-snug mb-1 tabular-nums flex flex-wrap items-center justify-between gap-1">
              <span>
                Área:{' '}
                <strong style={{ color: areaMeta.color }}>{areaMeta.label}</strong>{' '}
                (<strong className={covOk ? 'text-[#66d98c]' : 'text-[#ff7b8a]'}>
                  {offer.investmentCoveragePct ?? 100}%
                </strong>
                {!isFullyApproved && offer.monthlyNeedIncrease
                  ? ` · +$${offer.monthlyNeedIncrease}/mês`
                  : ''}
                )
              </span>
              <span className="text-[#cfd9e8]">
                Fundo: ${(offer.investmentFundBalance ?? 0).toLocaleString('pt-BR')} / $
                {(offer.unitInvestmentCost ?? 0).toLocaleString('pt-BR')}
              </span>
            </div>
          ) : null}
          <p className="text-[13px] text-[#8fa4bf] leading-snug">
            {offer.nextEvolutionHint}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          {pendingWork ? (
            <div
              role="progressbar"
              aria-valuenow={progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
              data-testid={`emergency-progress-box-${offer.id}`}
              className="relative w-full py-1.5 px-2.5 font-pixel text-[7px] border border-[#4ade80] bg-[#0f172a] text-white overflow-hidden select-none"
            >
              <div
                data-testid={`emergency-progress-fill-${offer.id}`}
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#15803d] via-[#16a34a] to-[#22c55e] transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
              <span className="relative z-10 flex items-center justify-between gap-2 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                <span>CONSTRUINDO NO MAPA · {progressPct}%</span>
                <span>
                  {pendingWork.remainingMonths}{' '}
                  {pendingWork.remainingMonths === 1 ? 'mês' : 'meses'}
                </span>
              </span>
            </div>
          ) : null}

          <button
            type="button"
            disabled={disabled}
            data-testid={`emergency-exec-${offer.id}`}
            data-work-state={
              isFullyApproved ? 'approved' : isReadyToClick ? 'ready' : 'normal'
            }
            onClick={() => onExecuteAction(offer.id)}
            className={`pixel-btn w-full py-2 px-3 font-pixel text-[8px] flex items-center justify-center gap-2 transition-colors ${
              isFullyApproved
                ? 'bg-[#123024] border-[#3d8c61] text-[#66d98c]'
                : isReadyToClick
                  ? 'bg-[#16a34a] hover:bg-[#15803d] border-[#4ade80] text-white shadow-[0_0_12px_rgba(22,163,74,0.45)]'
                  : 'bg-[#25314a] hover:bg-[#314161] text-[#eef2f7]'
            }`}
          >
            <span>
              {isFullyApproved
                ? 'APROVADO · CONSTRUÇÃO AUTOMÁTICA ATIVA'
                : !offer.unlocked
                  ? offer.lockReason ?? 'Bloqueado'
                  : !canAfford
                    ? `Falta caixa ($${offer.cost.toLocaleString('pt-BR')})`
                    : `Aprovar Evolução (-$${offer.cost.toLocaleString('pt-BR')})`}
            </span>
          </button>
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
    const isSports = offer.id === 'sports_center_project';
    const isCleanEnergy = offer.id === 'clean_energy_project';
    const isHospital = offer.id === 'hospital_project';
    const isUniversity = offer.id === 'tech_university_project';
    const isAmusement = offer.id === 'amusement_park_project';
    const isRail = offer.id === 'rail_freight_project';
    const kind: PreviewArtworkKind = isPort
      ? 'port'
      : isBridge
        ? 'bridge'
        : isBus
          ? 'bus'
          : isMetro
            ? 'metro'
            : isShopping
              ? 'shopping'
              : isSports
                ? 'sports'
                : isCleanEnergy
                  ? 'clean_energy'
                  : isHospital
                    ? 'hospital'
                    : isUniversity
                      ? 'university'
                      : isAmusement
                        ? 'amusement'
                        : isRail
                          ? 'rail'
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
              : isSports
                ? st.sportsCenterCount
                : isCleanEnergy
                  ? st.cleanEnergyCount
                  : isHospital
                    ? st.hospitalCount
                    : isUniversity
                      ? st.universityCount
                      : isAmusement
                        ? st.amusementParkCount
                        : isRail
                          ? st.railTerminalCount
                          : st.airportCount;
    const isBuilt = builtCount > 0;
    const isTwoTierNewWork =
      isSports || isCleanEnergy || isHospital || isUniversity || isAmusement || isRail;
    const artLevel = isBridge
      ? Math.max(1, Math.min(4, isBuilt ? Math.max(st.bridgeLevel, offer.tier) : offer.tier))
      : isShopping
        ? Math.max(1, Math.min(3, isBuilt ? Math.max(st.shoppingLevel || 1, offer.tier) : offer.tier))
        : isTwoTierNewWork
          ? Math.max(1, Math.min(2, offer.tier))
          : Math.max(1, Math.min(3, isBuilt ? Math.max(1, offer.tier - 1) : offer.tier));
    const canAfford = hud.money >= offer.cost;
    const pendingWork = pendingWorks.find((w) => w.actionId === offer.id);
    const isFullyApproved = Boolean(offer.fullyApproved);
    const approvedTier = offer.approvedTier ?? 0;
    const isReadyToClick = !isFullyApproved && offer.unlocked && canAfford;
    const disabled = isFullyApproved || !offer.unlocked || !canAfford;
    const progressPct = pendingWork
      ? computeWorkProgressPct(pendingWork, hud.monthProgress)
      : 0;
    const areaMeta = offer.investmentArea ? BUDGET_AREA_META[offer.investmentArea] : null;
    const covOk = (offer.investmentCoveragePct ?? 100) >= 100;
    const stepLabels = isBridge
      ? ['Pedra Nv.1', 'Arcos Nv.2', 'Estaiada 3', 'Dupla 2× 4']
      : isBus
        ? ['Frota Nv.1', 'Corredor 2', 'BRT Hub 3']
        : isMetro
          ? ['Linha 1', 'Anel Nv.2', 'Expresso 3']
          : isShopping
            ? ['Pequeno 5×5', 'Médio 7×7', 'Grande 9×9']
            : isSports
              ? ['1º Centro 2×2', '2º Complexo 4×4']
              : isCleanEnergy
                ? ['Solar 2×2', 'Eólico & Solar 3×3']
                : isHospital
                  ? ['Hospital 3×3', 'Centro Médico 3×3']
                  : isUniversity
                    ? ['Campus 3×3', 'Parque Tec. 4×4']
                    : isAmusement
                      ? ['Roda-Gigante 3×3', 'Mundo Temático 4×4']
                      : isRail
                        ? ['Ferrovia 3×2', 'Monotrilho 3×3']
                        : ['Fase I · Nv.1', 'Fase II · Nv.2', 'Fase III · Nv.3', 'Fase IV · Hub'];

    return (
      <div
        key={offer.id}
        data-testid={`emergency-card-${offer.id}`}
        className={`pixel-inset p-3.5 flex flex-col justify-between gap-2.5 border-2 ${
          isFullyApproved ? 'bg-[#0e201b]' : ''
        }`}
        style={{
          borderColor: isFullyApproved ? '#3d8c61' : `${offer.accentColor}88`,
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
                    isFullyApproved || approvedTier > 0
                      ? 'bg-[#132f23] border-[#66d98c] text-[#66d98c]'
                      : offer.unlocked
                        ? 'bg-[#14283b] border-[#38bdf8] text-[#7dd3fc]'
                        : 'bg-[#2a1f16] border-[#f5b73b] text-[#ffe066]'
                  }`}
                >
                  {isFullyApproved
                    ? `APROVADO EM DEFINITIVO · ${builtCount} NO MAPA`
                    : approvedTier > 0
                      ? `FASE ${approvedTier} APROVADA · ${builtCount} NO MAPA`
                      : offer.unlocked
                        ? 'LIBERADO P/ APROVAÇÃO ÚNICA'
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
              {isFullyApproved ? '✓' : `$${offer.cost.toLocaleString('pt-BR')}`}
            </span>
          </div>

          {/* 64-Bit Pixel Art Scenic Illustration + Isometric Diorama Preview */}
          <LandmarkArtPreview
            kind={kind}
            level={artLevel}
            builtCount={builtCount}
            active={activeSubTab === 'works'}
          />

          {/* Evolutionary Progress Steps (Approved steps) */}
          <div className={`grid gap-1 ${stepLabels.length === 2 ? 'grid-cols-2' : stepLabels.length === 3 ? 'grid-cols-3' : 'grid-cols-4'}`}>
            {stepLabels.map((stepLabel, idx) => {
              const stepNum = idx + 1;
              const done = approvedTier >= stepNum;
              const current = !isFullyApproved && offer.tier === stepNum;
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
          {areaMeta ? (
            <div className="bg-[#0b101b] border border-[#26344f] px-2 py-1 text-[12.5px] leading-snug tabular-nums flex flex-wrap items-center justify-between gap-1">
              <span>
                Investimento:{' '}
                <strong style={{ color: areaMeta.color }}>{areaMeta.label}</strong>{' '}
                (<strong className={covOk ? 'text-[#66d98c]' : 'text-[#ff7b8a]'}>
                  {offer.investmentCoveragePct ?? 100}%
                </strong>
                {!isFullyApproved && offer.monthlyNeedIncrease
                  ? ` · +$${offer.monthlyNeedIncrease}/mês`
                  : ''}
                )
              </span>
              <span className="text-[#cfd9e8]">
                Fundo: ${(offer.investmentFundBalance ?? 0).toLocaleString('pt-BR')} / $
                {(offer.unitInvestmentCost ?? 0).toLocaleString('pt-BR')}
              </span>
            </div>
          ) : null}
          <p className="text-[13px] text-[#8fa4bf] leading-snug">
            {offer.nextEvolutionHint}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          {pendingWork ? (
            <div
              role="progressbar"
              aria-valuenow={progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
              data-testid={`emergency-progress-box-${offer.id}`}
              className="relative w-full py-1.5 px-2.5 font-pixel text-[7px] border border-[#4ade80] bg-[#0f172a] text-white overflow-hidden select-none"
            >
              <div
                data-testid={`emergency-progress-fill-${offer.id}`}
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#15803d] via-[#16a34a] to-[#22c55e] transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
              <span className="relative z-10 flex items-center justify-between gap-2 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                <span>EM CONSTRUÇÃO NO MAPA · {progressPct}%</span>
                <span>
                  {pendingWork.remainingMonths}{' '}
                  {pendingWork.remainingMonths === 1 ? 'mês' : 'meses'}
                </span>
              </span>
            </div>
          ) : null}

          <button
            type="button"
            disabled={disabled}
            data-testid={`emergency-exec-${offer.id}`}
            data-work-state={
              isFullyApproved ? 'approved' : isReadyToClick ? 'ready' : 'normal'
            }
            onClick={() => onExecuteAction(offer.id)}
            className={`pixel-btn w-full py-2.5 px-3 font-pixel text-[8px] flex items-center justify-center gap-2 transition-colors ${
              isFullyApproved
                ? 'bg-[#123024] border-[#3d8c61] text-[#66d98c]'
                : isReadyToClick
                  ? 'bg-[#16a34a] hover:bg-[#15803d] border-[#4ade80] text-white shadow-[0_0_12px_rgba(22,163,74,0.45)]'
                  : 'bg-[#25314a] hover:bg-[#314161] text-[#eef2f7]'
            }`}
          >
            <span>
              {isFullyApproved
                ? 'APROVADO · EXPANSÃO AUTOMÁTICA ATIVA'
                : !offer.unlocked
                  ? `${offer.lockReason ?? 'Bloqueado'} para aprovar`
                  : !canAfford
                    ? `Falta caixa ($${offer.cost.toLocaleString('pt-BR')})`
                    : `Aprovar ${offer.tierLabel} (-$${offer.cost.toLocaleString('pt-BR')})`}
            </span>
          </button>
        </div>
      </div>
    );
  };

  return (
    <PixelModal
      title="OBRAS & AÇÕES · MARCOS, TERRENOS E URGÊNCIAS"
      subtitle="Aprovação única por evolução: ao aprovar, o custo mensal de investimento aumenta e o jogo constrói novas unidades automaticamente com o fundo da área."
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
      {/* Internal Navigation Tabs (Obras & Marcos | Missões do Mandato | Terreno | Ações & Urgências) */}
      <div
        role="tablist"
        aria-label="Seções de Obras e Ações"
        className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mb-3"
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
          data-testid="works-tab-missions"
          aria-selected={activeSubTab === 'missions'}
          onClick={() => setActiveSubTab('missions')}
          className={`pixel-btn py-2 px-2 font-pixel text-[7px] sm:text-[8px] flex items-center justify-center gap-1.5 whitespace-nowrap ${
            activeSubTab === 'missions'
              ? 'bg-[#2c3c5c] text-[#ffe066] border-[#ffe066]'
              : 'bg-[#161f33] text-[#bfd0e6] hover:bg-[#22304d]'
          }`}
        >
          <span>Missões ({completedMissionsCount}/{mandateMissions.length || 8})</span>
          {claimableMissionsCount > 0 ? (
            <span
              data-testid="missions-claimable-badge"
              className="px-1 py-0.5 bg-[#16a34a] text-white text-[6.5px] tabular-nums"
            >
              +{claimableMissionsCount}
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
            aria-label="Marcos e obras disponíveis em ordem de primeira necessidade"
            data-testid="transport-landmarks-section"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div>
                <h3 className="font-pixel text-[9px] text-[#38bdf8]">
                  MARCOS &amp; OBRAS DISPONÍVEIS (EM ORDEM DE PRIMEIRA NECESSIDADE · SHOPPING 5×5 / 7×7 / 9×9)
                </h3>
                <p className="text-[14.5px] text-[#9eb0c9] leading-tight mt-0.5">
                  Ordenados pelos marcos que serão usados primeiro. Botão <strong className="text-[#4ade80]">verde</strong> indica obra liberada com caixa suficiente.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {orderedStructuralOffers.map((offer) =>
                isIllustratedEvolutionWork(offer.id)
                  ? renderTransportEvolutionCard(offer)
                  : renderStandardOfferCard(offer)
              )}
            </div>
          </section>
        </div>
      ) : null}

      {/* TAB 1B: MISSÕES DO MANDATO & EVENTOS AO VIVO */}
      {activeSubTab === 'missions' ? (
        (() => {
          const visibleMissions = mandateMissions
            .filter((m) => !m.claimed)
            .sort((a, b) => Number(b.completed) - Number(a.completed));

          return (
            <section
              aria-label="Metas e missões do mandato com recompensas em caixa"
              data-testid="mandate-missions-section"
              className="flex flex-col gap-3"
            >
              <div className="pixel-inset p-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-pixel text-[9px] text-[#ffe066]">
                    METAS &amp; MISSÕES DO MANDATO (RECOMPENSAS EM CAIXA)
                  </h3>
                  <p className="text-[14.5px] text-[#9eb0c9] leading-tight mt-0.5">
                    Cumpra objetivos estratégicos de infraestrutura, energia limpa, saúde, educação e logística para resgatar bônus diretos no Tesouro Municipal. Recompensas resgatadas saem da lista automaticamente.
                  </p>
                </div>
                {st.stadiumCount > 0 ? (
                  <button
                    type="button"
                    data-testid="trigger-stadium-match-btn"
                    disabled={Boolean(hud.stadiumMatchActive)}
                    onClick={() => onTriggerStadiumMatch?.()}
                    className={`pixel-btn px-3 py-2 font-pixel text-[7.5px] ${
                      hud.stadiumMatchActive
                        ? 'bg-[#143326] border-[#4ade80] text-[#4ade80]'
                        : 'bg-[#1e3a8a] hover:bg-[#1d4ed8] border-[#ffe066] text-[#ffe066]'
                    }`}
                  >
                    {hud.stadiumMatchActive
                      ? '⚽ DIA DE JOGO ATIVO (FOGOS & REFLETORES NO MAPA)'
                      : '⚽ REALIZAR DIA DE JOGO NO ESTÁDIO (FOGOS & TURISMO)'}
                  </button>
                ) : null}
              </div>

              {visibleMissions.length === 0 ? (
                <div
                  data-testid="missions-all-claimed-empty"
                  className="pixel-inset p-6 border-2 border-[#2e7d52] bg-[#0e201b] text-center flex flex-col items-center gap-1.5"
                >
                  <span className="font-pixel text-[9.5px] text-[#66d98c]">
                    TODAS AS RECOMPENSAS DO MANDATO FORAM RESGATADAS!
                  </span>
                  <p className="text-[15px] text-[#cfd9e8] max-w-[520px]">
                    Você cumpriu e resgatou todas as {mandateMissions.length} metas estratégicas desta gestão. Continue expandindo Pixópolis e equilibrando impostos e demanda R · C · I.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {visibleMissions.map((mission) => {
                    const pct = Math.min(
                      100,
                      Math.round((mission.currentValue / Math.max(1, mission.targetValue)) * 100)
                    );
                    const canClaim = mission.completed && !mission.claimed;

                    return (
                      <div
                        key={mission.id}
                        data-testid={`mandate-mission-card-${mission.id}`}
                        className={`pixel-inset p-3.5 flex flex-col justify-between gap-2.5 border-2 ${
                          canClaim
                            ? 'border-[#4ade80] bg-[#11261f]'
                            : 'border-[#334361]'
                        }`}
                      >
                        <div>
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <div>
                              <span
                                className="font-pixel text-[6.5px] px-1.5 py-0.5 border"
                                style={{
                                  borderColor: mission.accentColor,
                                  color: mission.accentColor,
                                }}
                              >
                                {mission.categoryLabel}
                              </span>
                              <h4 className="font-pixel text-[9px] text-[#eef2f7] mt-1">
                                {mission.title}
                              </h4>
                            </div>
                            <span className="font-pixel text-[8px] px-2 py-1 bg-[#143326] border border-[#66d98c] text-[#ffe066] shrink-0 tabular-nums">
                              +${mission.rewardCash.toLocaleString('pt-BR')}
                            </span>
                          </div>
                          <p className="text-[14.5px] text-[#cfd9e8] leading-snug mb-2">
                            {mission.description}
                          </p>
                          <div className="w-full h-3 bg-[#0b101b] border border-[#334361] overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-[#0284c7] to-[#4ade80] transition-all duration-300"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-[13px] text-[#9eb0c9] mt-1 tabular-nums">
                            <span>Progresso: {mission.progressLabel}</span>
                            <span>{pct}%</span>
                          </div>
                        </div>

                        <button
                          type="button"
                          data-testid={`claim-mission-btn-${mission.id}`}
                          disabled={!canClaim}
                          onClick={() => onClaimMission?.(mission.id)}
                          className={`pixel-btn w-full py-2 px-3 font-pixel text-[7.5px] ${
                            canClaim
                              ? 'bg-[#16a34a] hover:bg-[#15803d] border-[#4ade80] text-white shadow-[0_0_12px_rgba(22,163,74,0.45)]'
                              : 'bg-[#1f293d] text-[#8fa4bf]'
                          }`}
                        >
                          {canClaim
                            ? `RESGATAR RECOMPENSA (+$${mission.rewardCash.toLocaleString('pt-BR')})`
                            : 'EM ANDAMENTO · CUMPRIR META'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })()
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

