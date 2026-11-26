import { useEffect, useRef, useState } from 'react';
import { renderLandmarkArtworkCanvas } from '../game/pixelRenderer';
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

function LandmarkArtPreview({ kind, level, builtCount }: LandmarkArtPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const maxArtLevel = kind === 'bridge' ? 4 : 3;
  const [previewLevel, setPreviewLevel] = useState<number>(Math.max(1, Math.min(maxArtLevel, level)));

  useEffect(() => {
    setPreviewLevel(Math.max(1, Math.min(maxArtLevel, level)));
  }, [level, maxArtLevel]);

  useEffect(() => {
    let rafId = 0;
    const start = performance.now();
    let lastDraw = -100;

    const draw = (now: number) => {
      if (now - lastDraw >= 55) {
        lastDraw = now;
        const canvas = canvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            renderLandmarkArtworkCanvas(
              ctx,
              kind,
              previewLevel,
              builtCount > 0,
              (now - start) / 1000
            );
          }
        }
      }
      rafId = window.requestAnimationFrame(draw);
    };

    rafId = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(rafId);
  }, [kind, previewLevel, builtCount]);

  return (
    <div className="relative border-2 border-[#0b0f19] bg-[#0b101b] overflow-hidden">
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
            className={`px-1.5 py-0.5 font-pixel text-[6.5px] border ${
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
  const incidentOffer = hud.emergencyOffers.find((o) => o.id === 'incident_response') ?? null;
  const featuredTransportOffers = hud.emergencyOffers.filter(
    (o) =>
      o.id === 'port_evolution' ||
      o.id === 'airport_evolution' ||
      o.id === 'shopping_evolution' ||
      o.id === 'emergency_roadworks' ||
      o.id === 'bus_transit_project' ||
      o.id === 'metro_transit_project'
  );
  const standardOffers = hud.emergencyOffers.filter(
    (o) =>
      o.id !== 'incident_response' &&
      o.id !== 'port_evolution' &&
      o.id !== 'airport_evolution' &&
      o.id !== 'shopping_evolution' &&
      o.id !== 'emergency_roadworks' &&
      o.id !== 'bus_transit_project' &&
      o.id !== 'metro_transit_project'
  );

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
    const activeBoost = hud.activeBoosts.find((b) => b.actionId === offer.id);
    const isExecuting = Boolean(activeBoost);
    const isReadyToClick = !isExecuting && offer.unlocked && canAfford;
    const disabled = isExecuting || !offer.unlocked || !canAfford;
    const progressPct = activeBoost
      ? computeWorkProgressPct(activeBoost, hud.monthProgress)
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
          <LandmarkArtPreview kind={kind} level={artLevel} builtCount={builtCount} />

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
          {activeBoost ? (
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
                <span>EM EXECUÇÃO · {progressPct}%</span>
                <span>
                  {activeBoost.remainingMonths}{' '}
                  {activeBoost.remainingMonths === 1 ? 'mês restante' : 'meses restantes'}
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
      title="EMERGÊNCIAS, OBRAS EVOLUTIVAS E TERRENOS"
      subtitle={`Evolua Shopping, Ônibus, Metrô, Porto, Aeroporto e Pontes em arte 64-bit · Caixa: $${hud.money.toLocaleString('pt-BR')} · Mapa: ${hud.gridWidth}×${hud.gridHeight}`}
      accentColor="#ff785a"
      maxWidthClass="max-w-[920px]"
      onClose={onClose}
      testId="emergencies-modal"
    >
      {/* City Condition Summary Strip */}
      <div className="pixel-inset px-3 py-2 mb-3.5 flex flex-wrap items-center justify-between gap-2 text-[16px] tabular-nums">
        <span className="text-[#cfd9e8]">
          Poluição média:{' '}
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
        <span className="text-[#cfd9e8]">
          Abandonados:{' '}
          <strong className={st.abandonedCount > 0 ? 'text-[#ff6b6b]' : 'text-[#66d98c]'}>
            {st.abandonedCount}
          </strong>
        </span>
        <span className="text-[#cfd9e8]">
          Marcos:{' '}
          <strong className="text-[#34d399]">{st.sportsCenterCount} Esporte</strong> ·{' '}
          <strong className="text-[#0ea5e9]">{st.busStationCount} Ônibus</strong> ·{' '}
          <strong className="text-[#a78bfa]">{st.metroStationCount} Metrô</strong> ·{' '}
          <strong className="text-[#f472b6]">
            {st.shoppingCount} Shopping{st.shoppingLevel > 0 ? ` (Nv.${st.shoppingLevel})` : ''}
          </strong>{' '}
          · <strong className="text-[#38bdf8]">{st.portCount} Porto</strong> ·{' '}
          <strong className="text-[#ff8ec7]">{st.stadiumCount} Estádio</strong> ·{' '}
          <strong className="text-[#ffe066]">{st.airportCount} Aeroporto</strong>
          {hud.tollPlaza.built ? (
            <>
              {' '}
              · <strong className="text-[#fbbf24]">Pedágio Ativo</strong>
            </>
          ) : null}
        </span>
      </div>

      {/* Urgent Contextual Urban Incident Intervention Card */}
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
            className={`pixel-btn px-3.5 py-2.5 font-pixel text-[8px] shrink-0 ${
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

      {/* Feedback Banner */}
      {feedbackMsg ? (
        <div
          data-testid="emergency-feedback"
          className="pixel-inset px-3 py-2 mb-3.5 text-[17px] text-[#66d98c] border-[#2e7d52]"
        >
          {feedbackMsg}
        </div>
      ) : null}

      {/* Featured Section: Port, Airport, Shopping, River Bridges, Bus & Metro Evolution with 64-bit Art */}
      <section
        aria-label="Desbloqueio e evolução do Shopping, Porto, Aeroporto, Ônibus, Metrô e Pontes do Rio"
        data-testid="transport-landmarks-section"
        className="mb-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div>
            <h3 className="font-pixel text-[9px] text-[#38bdf8]">
              OBRAS EVOLUTIVAS: SHOPPING (6×6 / 8×8 / 9×9), ÔNIBUS, METRÔ, PORTO, AEROPORTO &amp; PONTES (ARTE 64-BIT)
            </h3>
            <p className="text-[15px] text-[#9eb0c9] leading-tight mt-0.5">
              Quando uma obra estiver desbloqueada e houver caixa disponível, o botão fica <strong className="text-[#4ade80]">verde</strong>. Enquanto a obra estiver em execução, o botão vira uma <strong className="text-[#ffe066]">barra de progresso</strong> até concluir.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {featuredTransportOffers.map(renderTransportEvolutionCard)}
        </div>
      </section>

      {/* 4-Direction Adjacent Land Expansion Section */}
      <section
        aria-label="Expansão de terreno nas 4 direções"
        data-testid="land-expansion-section"
        className="pixel-inset p-3.5 mb-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div>
            <h3 className="font-pixel text-[9px] text-[#66d98c]">
              COMPRAR TERRENOS ADJACENTES (+8 FAIXAS)
            </h3>
            <p className="text-[15px] text-[#9eb0c9] leading-tight mt-0.5">
              Expanda o território da cidade em qualquer direção — rios e florestas continuam naturalmente.
            </p>
          </div>
          <span
            data-testid="map-size-badge"
            className="font-pixel text-[8px] text-[#ffe066] bg-[#162033] border border-[#334361] px-2 py-1 tabular-nums"
          >
            MAPA {hud.gridWidth}×{hud.gridHeight}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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
                className="pixel-btn p-2.5 bg-[#1b293f] hover:bg-[#243754] text-left flex flex-col justify-between gap-1"
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="font-pixel text-[8px] text-[#66d98c]">
                    {DIRECTION_ARROWS[exp.direction]} {exp.label}
                  </span>
                  <span className="text-[14px] text-[#9eb0c9] tabular-nums">
                    {exp.expansionsDone}/{exp.maxExpansions}
                  </span>
                </div>
                <div className="text-[16px] font-bold tabular-nums text-[#ffe066]">
                  {!exp.canExpand
                    ? 'Máximo'
                    : `$${exp.cost.toLocaleString('pt-BR')}`}
                </div>
                <div className="text-[13px] text-[#9eb0c9] leading-tight">
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

      {/* Other Progressive Evolving Works & Emergencies */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        {standardOffers.map((offer) => {
          const canAfford = hud.money >= offer.cost;
          const noAbandoned =
            offer.id === 'revitalization' && offer.tier <= 2 && st.abandonedCount === 0;
          const activeBoost = hud.activeBoosts.find((b) => b.actionId === offer.id);
          const isExecuting = Boolean(activeBoost);
          const isReadyToClick = !isExecuting && offer.unlocked && canAfford && !noAbandoned;
          const disabled = isExecuting || !offer.unlocked || !canAfford || noAbandoned;
          const progressPct = activeBoost
            ? computeWorkProgressPct(activeBoost, hud.monthProgress)
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

                <p className="text-[16px] text-[#dce6f2] leading-snug mb-1">
                  {offer.summary}
                </p>
                <p className="text-[15px] text-[#66d98c] leading-snug mb-1">
                  {offer.effectHint}
                </p>
                <p className="text-[13px] text-[#8fa4bf] leading-snug">
                  {offer.nextEvolutionHint}
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                {activeBoost ? (
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
                      <span>EM EXECUÇÃO · {progressPct}%</span>
                      <span>
                        {activeBoost.remainingMonths}{' '}
                        {activeBoost.remainingMonths === 1 ? 'mês restante' : 'meses restantes'}
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
                        : noAbandoned
                          ? 'Sem imóveis abandonados'
                          : !canAfford
                            ? `Falta caixa ($${offer.cost.toLocaleString('pt-BR')})`
                            : `Construir / Executar (-$${offer.cost.toLocaleString('pt-BR')})`}
                    </span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Currently Active Timed Boosts */}
      <div className="pixel-inset p-3">
        <div className="font-pixel text-[8px] text-[#8fa4bf] mb-1.5">
          CAMPANHAS E OBRAS EM ANDAMENTO
        </div>
        {hud.activeBoosts.length === 0 ? (
          <p className="text-[16px] text-[#8fa4bf]">
            Nenhuma obra emergencial ou festival ativo no momento.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2 text-[16px] tabular-nums">
            {hud.activeBoosts.map((b) => {
              const pct = computeWorkProgressPct(b, hud.monthProgress);
              return (
                <div
                  key={b.id}
                  className="px-2.5 py-1 bg-[#1b263c] border border-[#334361] text-[#eef2f7]"
                >
                  {b.label} · <strong className="text-[#4ade80]">{pct}%</strong> ·{' '}
                  <strong className="text-[#ffe066]">
                    {b.remainingMonths} {b.remainingMonths === 1 ? 'mês' : 'meses'}
                  </strong>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PixelModal>
  );
}
