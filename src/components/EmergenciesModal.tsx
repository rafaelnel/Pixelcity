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
  kind: 'port' | 'airport' | 'bridge';
  level: number;
  builtCount: number;
}

function LandmarkArtPreview({ kind, level, builtCount }: LandmarkArtPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [previewLevel, setPreviewLevel] = useState<number>(level);

  useEffect(() => {
    setPreviewLevel(Math.max(1, Math.min(3, level)));
  }, [level]);

  useEffect(() => {
    let rafId = 0;
    const start = performance.now();

    const draw = (now: number) => {
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
              : `Arte 64-bit da Ponte Fluvial Nível ${previewLevel}`
        }
        className="w-full h-[106px] block"
      />
      {/* Quick level art preview switcher */}
      <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 bg-[#0b101b]/85 px-1.5 py-0.5 border border-[#334361]">
        <span className="font-pixel text-[6px] text-[#9eb0c9] mr-0.5">ARTE:</span>
        {[1, 2, 3].map((lv) => (
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
            Nv.{lv}
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
      o.id === 'emergency_roadworks'
  );
  const standardOffers = hud.emergencyOffers.filter(
    (o) =>
      o.id !== 'incident_response' &&
      o.id !== 'port_evolution' &&
      o.id !== 'airport_evolution' &&
      o.id !== 'emergency_roadworks'
  );

  const renderTransportEvolutionCard = (offer: EmergencyOfferView) => {
    const isPort = offer.id === 'port_evolution';
    const isBridge = offer.id === 'emergency_roadworks';
    const kind: 'port' | 'airport' | 'bridge' = isPort
      ? 'port'
      : isBridge
        ? 'bridge'
        : 'airport';
    const builtCount = isPort
      ? st.portCount
      : isBridge
        ? st.bridgeSpanCount
        : st.airportCount;
    const isBuilt = builtCount > 0;
    const artLevel = isBridge
      ? Math.max(1, Math.min(3, isBuilt ? st.bridgeLevel : offer.tier))
      : Math.max(1, Math.min(3, isBuilt ? Math.max(1, offer.tier - 1) : offer.tier));
    const canAfford = hud.money >= offer.cost;
    const disabled = !offer.unlocked || !canAfford;
    const activeBoost = hud.activeBoosts.find((b) => b.actionId === offer.id);

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
                      : 'bg-[#2a1f16] border-[#f5b73b] text-[#ffe066]'
                  }`}
                >
                  {isBridge
                    ? `${st.bridgeSpanCount} ${st.bridgeSpanCount === 1 ? 'PONTE' : 'PONTES'} · NV.${st.bridgeLevel}`
                    : isBuilt
                      ? `DESBLOQUEADO (${builtCount} no mapa)`
                      : 'BLOQUEADO · OBRA EVOLUTIVA'}
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

          {/* 32-Bit Pixel Art Scenic Illustration + Isometric Diorama Preview */}
          <LandmarkArtPreview kind={kind} level={artLevel} builtCount={builtCount} />

          {/* 4-Phase Evolutionary Progress Steps */}
          <div className="grid grid-cols-4 gap-1">
            {(isBridge
              ? ['Pedra Nv.1', 'Arcos Nv.2', 'Estaiada 3', 'Hub Viário']
              : ['Fase I · Nv.1', 'Fase II · Nv.2', 'Fase III · Nv.3', 'Fase IV · Hub']
            ).map((stepLabel, idx) => {
              const stepNum = idx + 1;
              const done = offer.tier > stepNum || (stepNum === 1 && isBuilt);
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
            <div className="text-[14.5px] text-[#66d98c] tabular-nums">
              Ativo: {activeBoost.label} · {activeBoost.remainingMonths}{' '}
              {activeBoost.remainingMonths === 1 ? 'mês' : 'meses'}
            </div>
          ) : null}

          <button
            type="button"
            disabled={disabled}
            data-testid={`emergency-exec-${offer.id}`}
            onClick={() => onExecuteAction(offer.id)}
            className={`pixel-btn w-full py-2.5 px-3 font-pixel text-[8px] flex items-center justify-center gap-2 ${
              isPort
                ? 'bg-[#174873] hover:bg-[#1e5c91] text-white'
                : isBridge
                  ? 'bg-[#1e5642] hover:bg-[#286e55] text-white'
                  : 'bg-[#5c4813] hover:bg-[#785e19] text-[#fff6d6]'
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
                      ? `Desbloquear ${isPort ? 'Porto Fluvial' : 'Aeroporto'} (-$${offer.cost.toLocaleString('pt-BR')})`
                      : `Investir ${offer.tierLabel} (-$${offer.cost.toLocaleString('pt-BR')})`}
            </span>
          </button>
        </div>
      </div>
    );
  };

  return (
    <PixelModal
      title="EMERGÊNCIAS, OBRAS EVOLUTIVAS E TERRENOS"
      subtitle={`Evolua Porto, Aeroporto e Pontes em arte 64-bit · Caixa: $${hud.money.toLocaleString('pt-BR')} · Mapa: ${hud.gridWidth}×${hud.gridHeight}`}
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
          <strong className="text-[#38bdf8]">{st.portCount} Porto</strong> ·{' '}
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
            onClick={() => onExecuteAction('incident_response')}
            className="pixel-btn px-3.5 py-2.5 bg-[#9b2c2c] hover:bg-[#c53030] text-white font-pixel text-[8px] shrink-0"
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

      {/* Featured Section: Port, Airport & River Bridges Evolution with 64-bit Art */}
      <section
        aria-label="Desbloqueio e evolução do Porto, Aeroporto e Pontes do Rio"
        data-testid="transport-landmarks-section"
        className="mb-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div>
            <h3 className="font-pixel text-[9px] text-[#38bdf8]">
              OBRAS EVOLUTIVAS: PORTO, AEROPORTO &amp; PONTES DO RIO (ARTE 64-BIT)
            </h3>
            <p className="text-[15px] text-[#9eb0c9] leading-tight mt-0.5">
              Liberadas gradualmente por marcos populacionais: Porto (1,2k / 8k / 18k) · Centro Esportivo (2k) · Aeroporto (5k / 15k / 30k) · Estádio e Pedágio (20k).
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
          const disabled = !offer.unlocked || !canAfford || noAbandoned;
          const activeBoost = hud.activeBoosts.find((b) => b.actionId === offer.id);
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
                  <div className="text-[15px] text-[#66d98c] tabular-nums">
                    Ativo na cidade: {activeBoost.label} · {activeBoost.remainingMonths}{' '}
                    {activeBoost.remainingMonths === 1 ? 'mês restante' : 'meses restantes'}
                  </div>
                ) : null}

                <button
                  type="button"
                  disabled={disabled}
                  data-testid={`emergency-exec-${offer.id}`}
                  onClick={() => onExecuteAction(offer.id)}
                  className="pixel-btn w-full py-2 px-3 bg-[#25314a] hover:bg-[#314161] text-[#eef2f7] font-pixel text-[8px] flex items-center justify-center gap-2"
                >
                  <span>
                    {!offer.unlocked
                      ? offer.lockReason ?? 'Bloqueado'
                      : noAbandoned
                        ? 'Sem imóveis abandonados'
                        : !canAfford
                          ? `Falta caixa ($${offer.cost.toLocaleString('pt-BR')})`
                          : `Executar ${offer.tierLabel} (-$${offer.cost.toLocaleString('pt-BR')})`}
                  </span>
                </button>
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
            {hud.activeBoosts.map((b) => (
              <div
                key={b.id}
                className="px-2.5 py-1 bg-[#1b263c] border border-[#334361] text-[#eef2f7]"
              >
                {b.label} ·{' '}
                <strong className="text-[#ffe066]">
                  {b.remainingMonths} {b.remainingMonths === 1 ? 'mês' : 'meses'}
                </strong>
              </div>
            ))}
          </div>
        )}
      </div>
    </PixelModal>
  );
}
