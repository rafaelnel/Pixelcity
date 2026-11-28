import {
  Volume2,
  VolumeX,
  Pause,
  Play,
  TrendingUp,
  TrendingDown,
  Save,
  Check,
  Home,
  Sun,
  CloudSun,
  CloudRain,
  CloudLightning,
  Snowflake,
} from 'lucide-react';
import { formatDateLabel } from '../game/cityEngine';
import { getSeasonLabel, getWeatherLabel } from '../game/pixelArtHelpers';
import { DIFFICULTY_CONFIGS } from '../game/simulationConfig';
import type { HudSnapshot, MapFilter, SimSpeed } from '../game/types';

interface TopHudProps {
  hud: HudSnapshot;
  speed: SimSpeed;
  mapFilter: MapFilter;
  muted: boolean;
  justSaved?: boolean;
  onSetSpeed: (s: SimSpeed) => void;
  onSetFilter: (f: MapFilter) => void;
  onToggleMute: () => void;
  onQuickSave: () => void;
  onRequestReturnMenu: () => void;
  onOpenPauseMenu: () => void;
  onCycleSeason?: () => void;
  onOpenFinances?: () => void;
}

export function TopHud({
  hud,
  speed,
  mapFilter,
  muted,
  justSaved = false,
  onSetSpeed,
  onSetFilter,
  onToggleMute,
  onQuickSave,
  onRequestReturnMenu,
  onOpenPauseMenu,
  onCycleSeason,
  onOpenFinances,
}: TopHudProps) {
  const happyColor =
    hud.globalHappiness >= 70
      ? 'text-[#66d98c]'
      : hud.globalHappiness >= 46
        ? 'text-[#f5b73b]'
        : 'text-[#ff6b6b]';

  const net = hud.financials.netBalance;
  const netPositive = net >= 0;
  const mig = hud.lastMigrationDelta;
  const progressPct = Math.round(hud.monthProgress * 100);
  const diffCfg = DIFFICULTY_CONFIGS[hud.difficulty];
  const seasonLabel = getSeasonLabel(hud.weather.season);
  const weatherLabel = getWeatherLabel(hud.weather.kind);
  const seasonAccent =
    hud.weather.season === 'summer'
      ? 'text-[#fde047]'
      : hud.weather.season === 'autumn'
        ? 'text-[#fb923c]'
        : hud.weather.season === 'winter'
          ? 'text-[#bae6fd]'
          : 'text-[#86efac]';

  return (
    <header
      className="fixed top-0 left-0 right-0 z-30 pixel-panel-glass px-2 sm:px-3 py-1.5 flex flex-wrap sm:flex-nowrap items-center justify-between gap-x-2 gap-y-1 select-none"
      aria-label="Painel superior da cidade"
    >
      {/* Brand + Active Difficulty Badge (row 1 left on mobile, left on desktop) */}
      <div className="order-1 flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={(e) => {
            e.currentTarget.blur();
            onOpenPauseMenu();
          }}
          className="font-pixel text-[9px] sm:text-[10px] tracking-wider text-[#f5b73b] pixel-text-shadow hover:text-[#ffe082] transition-colors whitespace-nowrap shrink-0 px-1 py-1"
          aria-label="Abrir menu de pausa"
        >
          PIXOPOLIS
        </button>
        <span
          data-testid="hud-city-name"
          title={`Cidade atual: ${hud.cityName}`}
          className="hidden xl:inline text-[15px] font-bold text-[#dce6f2] max-w-[120px] truncate"
        >
          {hud.cityName}
        </span>
        <button
          type="button"
          data-testid="hud-difficulty"
          onClick={(e) => {
            e.currentTarget.blur();
            onOpenPauseMenu();
          }}
          title={`Dificuldade: ${diffCfg.label} — ${diffCfg.tagline}. Clique para consultar ou ajustar no menu de pausa.`}
          aria-label={`Dificuldade ativa: ${diffCfg.label}. Clique para ajustar no menu de pausa`}
          className="px-1.5 py-0.5 bg-[#0f1624] border font-pixel text-[7px] leading-tight whitespace-nowrap hover:brightness-115 transition-all"
          style={{
            borderColor: diffCfg.accentColor,
            color: diffCfg.accentColor,
          }}
        >
          {diffCfg.shortLabel}
        </button>
      </div>

      {/* Compact Metrics Strip (row 2 full-width on mobile, center-left on desktop) */}
      <div className="order-3 sm:order-2 w-full sm:w-auto sm:flex-1 sm:min-w-0">
        <div className="pixel-inset px-2 py-1 flex items-center justify-between sm:justify-start gap-1.5 text-[15px] sm:text-[16px] leading-none overflow-x-auto no-scrollbar">
          {/* Cash & Projected Monthly Balance */}
          <div className="flex items-baseline gap-1 whitespace-nowrap shrink-0">
            <span className="hidden sm:inline font-pixel text-[7px] text-[#8fa4bf]">
              CAIXA
            </span>
            <span
              data-testid="hud-money"
              className={`tabular-nums font-bold ${
                hud.money < 0 ? 'text-[#ff6b6b]' : 'text-[#ffe066]'
              }`}
            >
              ${hud.money.toLocaleString('pt-BR')}
            </span>
            <span
              data-testid="hud-net"
              className={`tabular-nums text-[13px] sm:text-[14px] ${
                netPositive ? 'text-[#66d98c]' : 'text-[#ff6b6b]'
              }`}
              title={`Receita projetada: +$${hud.financials.revenue.total.toLocaleString('pt-BR')}/mês · Despesas: -$${hud.financials.expenses.total.toLocaleString('pt-BR')}/mês`}
            >
              ({netPositive ? '+' : '-'}${Math.abs(net).toLocaleString('pt-BR')}<span className="hidden 2xl:inline">/mês</span>)
            </span>
          </div>

          <span className="text-[#334361]" aria-hidden="true">
            |
          </span>

          {/* Total Population + Migration Indicator */}
          <div className="flex items-center gap-0.5 sm:gap-1 whitespace-nowrap shrink-0">
            <span className="hidden sm:inline font-pixel text-[7px] text-[#8fa4bf]">
              POP
            </span>
            <span
              data-testid="hud-population"
              className="tabular-nums text-[#eef2f7] font-bold"
            >
              {hud.totalPopulation.toLocaleString('pt-BR')}
            </span>
            {mig !== 0 ? (
              <span
                data-testid="hud-migration"
                title={
                  mig > 0
                    ? `Migração do último mês: +${mig} novos moradores`
                    : `Migração do último mês: ${mig} moradores saíram`
                }
                className={`inline-flex items-center gap-0.5 text-[13px] sm:text-[14px] tabular-nums ${
                  mig > 0 ? 'text-[#66d98c]' : 'text-[#ff6b6b]'
                }`}
              >
                {mig > 0 ? (
                  <TrendingUp className="w-3 h-3" aria-hidden="true" />
                ) : (
                  <TrendingDown className="w-3 h-3" aria-hidden="true" />
                )}
                <span>
                  {mig > 0 ? `+${mig}` : mig}
                </span>
              </span>
            ) : null}
          </div>

          <span className="text-[#334361]" aria-hidden="true">
            |
          </span>

          {/* Global Happiness */}
          <div className="flex items-baseline gap-1 whitespace-nowrap shrink-0">
            <span className="hidden md:inline font-pixel text-[7px] text-[#8fa4bf]">
              FELIC.
            </span>
            <span
              data-testid="hud-happiness"
              className={`tabular-nums font-bold ${happyColor}`}
            >
              {hud.globalHappiness}%
            </span>
          </div>

          <span className="text-[#334361]" aria-hidden="true">
            |
          </span>

          {/* Live R / C / I Demand Bars (Clickable to adjust Taxes & view Cause-Effect) */}
          <button
            type="button"
            data-testid="hud-rci-demand"
            onClick={(e) => {
              e.currentTarget.blur();
              onOpenFinances?.();
            }}
            title={`Demanda R/C/I — Residencial: ${hud.rciDemand.residential.demand > 0 ? '+' : ''}${hud.rciDemand.residential.demand} (${hud.rciDemand.residential.statusLabel}) · Comercial: ${hud.rciDemand.commercial.demand > 0 ? '+' : ''}${hud.rciDemand.commercial.demand} (${hud.rciDemand.commercial.statusLabel}) · Industrial: ${hud.rciDemand.industrial.demand > 0 ? '+' : ''}${hud.rciDemand.industrial.demand} (${hud.rciDemand.industrial.statusLabel}). ${hud.rciDemand.summary} Clique para ajustar impostos.`}
            aria-label={`Demanda RCI: Residencial ${hud.rciDemand.residential.demand}, Comercial ${hud.rciDemand.commercial.demand}, Industrial ${hud.rciDemand.industrial.demand}. Clique para abrir Finanças`}
            className="px-1.5 py-0.5 bg-[#0f1624] border border-[#2a3854] hover:border-[#f5b73b] transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer"
          >
            {(
              [
                {
                  code: 'R',
                  val: hud.rciDemand.residential.demand,
                  posColor: '#66d98c',
                  labelColor: 'text-[#66d98c]',
                },
                {
                  code: 'C',
                  val: hud.rciDemand.commercial.demand,
                  posColor: '#56c2ff',
                  labelColor: 'text-[#56c2ff]',
                },
                {
                  code: 'I',
                  val: hud.rciDemand.industrial.demand,
                  posColor: '#f5b73b',
                  labelColor: 'text-[#f5b73b]',
                },
              ] as const
            ).map(({ code, val, posColor, labelColor }) => {
              const clamped = Math.max(-100, Math.min(100, val));
              const halfPct = Math.max(clamped === 0 ? 0 : 12, Math.round(Math.abs(clamped) * 0.5));
              const isPos = clamped >= 0;
              return (
                <div key={code} className="flex items-center gap-0.5">
                  <span className={`font-pixel text-[6.5px] leading-none ${labelColor}`}>
                    {code}
                  </span>
                  <div className="relative w-[7px] h-[18px] bg-[#080d17] border border-[#2c3b57] overflow-hidden">
                    {/* Zero equilibrium midline */}
                    <div className="absolute left-0 right-0 top-1/2 h-[1px] bg-[#475569] z-10" />
                    {clamped !== 0 ? (
                      <div
                        className="absolute left-0 right-0 transition-all duration-300"
                        style={{
                          backgroundColor: isPos ? posColor : '#ff6b6b',
                          height: `${halfPct}%`,
                          ...(isPos ? { bottom: '50%' } : { top: '50%' }),
                        }}
                      />
                    ) : null}
                  </div>
                </div>
              );
            })}
          </button>

          <span className="text-[#334361]" aria-hidden="true">
            |
          </span>

          {/* Date + Thin Month Closing Progress Bar */}
          <div
            className="flex flex-col justify-center min-w-[58px] sm:min-w-[64px] shrink-0"
            title={`Progresso do mês: ${progressPct}% até o fechamento financeiro`}
          >
            <div className="flex items-baseline justify-between gap-1 whitespace-nowrap">
              <span className="hidden 2xl:inline font-pixel text-[6px] text-[#8fa4bf]">
                DATA
              </span>
              <span
                data-testid="hud-date"
                className="tabular-nums text-[14px] sm:text-[15px] text-[#dce6f2] leading-none"
              >
                {formatDateLabel(hud.month, hud.year)}
              </span>
            </div>
            <div
              className="w-full h-[4px] bg-[#0b0f19] border border-[#2a3854] mt-0.5 overflow-hidden"
              role="progressbar"
              aria-label="Progresso do mês financeiro"
              aria-valuenow={progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                data-testid="month-progress-bar"
                className="h-full bg-[#56c2ff]"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          <span className="text-[#334361]" aria-hidden="true">
            |
          </span>

          {/* Dynamic 4-Season & Weather Readout */}
          <button
            type="button"
            data-testid="hud-weather"
            onClick={(e) => {
              e.currentTarget.blur();
              onCycleSeason?.();
            }}
            title={`Estação: ${seasonLabel} (${hud.seasonMode === 'auto' ? 'Automático pelo calendário' : 'Modo fixo'}) · Clima: ${weatherLabel} · ${hud.weather.temperatureC}°C. Clique para alternar estação (K).`}
            aria-label={`Estação ${seasonLabel}, clima ${weatherLabel}, ${hud.weather.temperatureC} graus`}
            className="px-1.5 py-0.5 bg-[#0f1624] border border-[#2a3854] hover:border-[#56c2ff] transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
          >
            {hud.weather.kind === 'storm' ? (
              <CloudLightning className="w-3.5 h-3.5 text-[#c4b5fd] shrink-0" aria-hidden="true" />
            ) : hud.weather.kind === 'rain' ? (
              <CloudRain className="w-3.5 h-3.5 text-[#60a5fa] shrink-0" aria-hidden="true" />
            ) : hud.weather.kind === 'snow' ? (
              <Snowflake className="w-3.5 h-3.5 text-[#e0f2fe] shrink-0" aria-hidden="true" />
            ) : hud.weather.kind === 'partly_cloudy' ? (
              <CloudSun className="w-3.5 h-3.5 text-[#cbd5e1] shrink-0" aria-hidden="true" />
            ) : (
              <Sun className="w-3.5 h-3.5 text-[#fde047] shrink-0" aria-hidden="true" />
            )}
            <span className={`text-[14px] sm:text-[15px] font-bold leading-none ${seasonAccent}`}>
              {seasonLabel}
            </span>
            <span className="hidden 2xl:inline text-[13px] text-[#a8bad4] leading-none">
              · {weatherLabel}
            </span>
            <span className="tabular-nums text-[13px] sm:text-[14px] text-[#dce6f2] leading-none">
              {hud.weather.temperatureC}°C
            </span>
          </button>

          {/* City Trait (Desktop xl+) */}
          <span className="hidden 2xl:inline text-[#334361]" aria-hidden="true">
            |
          </span>
          <div
            className="hidden 2xl:flex items-baseline gap-1 whitespace-nowrap shrink-0"
            title={hud.trait.summary}
          >
            <span className="font-pixel text-[7px] text-[#8fa4bf]">TRAÇO</span>
            <span
              data-testid="hud-trait"
              className="text-[16px] font-bold max-w-[130px] truncate"
              style={{ color: hud.trait.accentColor }}
            >
              {hud.trait.name}
            </span>
          </div>
        </div>
      </div>

      {/* Right: Speed, Map Filters, Mute, New City (row 1 right on mobile, right on desktop) */}
      <div className="order-2 sm:order-3 flex items-center gap-1 sm:gap-1.5 shrink-0">
        {/* Speed Controls */}
        <div
          className="flex items-center gap-0.5 sm:gap-1 bg-[#101624] p-0.5 border-2 border-[#0b0f19]"
          role="group"
          aria-label="Velocidade da simulação"
        >
          {(
            [
              { s: 0 as SimSpeed, label: 'Pausa', aria: 'Pausar simulação' },
              { s: 1 as SimSpeed, label: '1x', aria: 'Velocidade 1x (30s/mês)' },
              { s: 2 as SimSpeed, label: '2x', aria: 'Velocidade 2x (15s/mês)' },
              { s: 4 as SimSpeed, label: '4x', aria: 'Velocidade 4x (7,5s/mês)' },
            ] as const
          ).map(({ s, label, aria }) => {
            const active = speed === s;
            return (
              <button
                key={s}
                type="button"
                aria-label={aria}
                aria-pressed={active}
                title={aria}
                onClick={(e) => {
                  e.currentTarget.blur();
                  onSetSpeed(s);
                }}
                className={`pixel-btn px-1.5 py-1 font-pixel text-[7px] sm:text-[8px] whitespace-nowrap shrink-0 flex items-center gap-1 ${
                  active
                    ? s === 0
                      ? 'bg-[#e05252] text-white'
                      : 'bg-[#f5b73b] text-[#111622]'
                    : 'bg-[#25314a] text-[#cfd9e8] hover:bg-[#314161]'
                }`}
              >
                {s === 0 ? (
                  <Pause className="w-2.5 h-2.5" aria-hidden="true" />
                ) : s === 1 ? (
                  <Play className="w-2.5 h-2.5" aria-hidden="true" />
                ) : null}
                <span className={s === 0 ? 'hidden sm:inline' : ''}>{label}</span>
              </button>
            );
          })}
        </div>

        {/* Map Filter Controls */}
        <div
          className="hidden sm:flex items-center gap-0.5 sm:gap-1 bg-[#101624] p-0.5 border-2 border-[#0b0f19]"
          role="group"
          aria-label="Filtros do mapa"
        >
          {(
            [
              { f: 'normal' as MapFilter, label: 'Normal', color: 'bg-[#56c2ff] text-[#111622]' },
              { f: 'pollution' as MapFilter, label: 'Poluição', color: 'bg-[#e05252] text-white' },
              { f: 'value' as MapFilter, label: 'Valor', color: 'bg-[#66d98c] text-[#111622]' },
            ] as const
          ).map(({ f, label, color }) => {
            const active = mapFilter === f;
            return (
              <button
                key={f}
                type="button"
                aria-pressed={active}
                onClick={(e) => {
                  e.currentTarget.blur();
                  onSetFilter(f);
                }}
                className={`pixel-btn px-1.5 py-1 font-pixel text-[7px] sm:text-[8px] whitespace-nowrap shrink-0 ${
                  active
                    ? color
                    : 'bg-[#25314a] text-[#cfd9e8] hover:bg-[#314161]'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Mute Toggle */}
        <button
          type="button"
          onClick={(e) => {
            e.currentTarget.blur();
            onToggleMute();
          }}
          aria-label={muted ? 'Ativar som 8-bit' : 'Silenciar som 8-bit'}
          aria-pressed={muted}
          title={muted ? 'Som mudo (M)' : 'Som ligado (M)'}
          className={`pixel-btn px-1.5 sm:px-2 py-1 font-pixel text-[8px] whitespace-nowrap shrink-0 flex items-center gap-1 ${
            muted
              ? 'bg-[#394154] text-[#9aa5b5]'
              : 'bg-[#25314a] text-[#eef2f7] hover:bg-[#314161]'
          }`}
        >
          {muted ? (
            <VolumeX className="w-3 h-3" aria-hidden="true" />
          ) : (
            <Volume2 className="w-3 h-3" aria-hidden="true" />
          )}
          <span className="hidden 2xl:inline">{muted ? 'Mudo' : 'Som'}</span>
        </button>

        {/* One-Click Instant Save to Current Save */}
        <button
          type="button"
          data-testid="hud-save-btn"
          onClick={(e) => {
            e.currentTarget.blur();
            onQuickSave();
          }}
          aria-label="Salvar jogo atual imediatamente"
          title={`Salvar "${hud.cityName}" agora no save atual`}
          className={`pixel-btn px-1.5 sm:px-2 py-1 font-pixel text-[8px] whitespace-nowrap shrink-0 flex items-center gap-1 transition-colors ${
            justSaved
              ? 'bg-[#2e7d52] text-[#fffbeb]'
              : 'bg-[#2b6cb0] text-white hover:bg-[#3582d4]'
          }`}
        >
          {justSaved ? (
            <Check className="w-3 h-3" aria-hidden="true" />
          ) : (
            <Save className="w-3 h-3" aria-hidden="true" />
          )}
          <span className="hidden sm:inline">{justSaved ? 'Salvo!' : 'Salvar'}</span>
        </button>

        {/* Return to Main Menu (opens Sair sem Salvar / Salvar e Sair prompt) */}
        <button
          type="button"
          data-testid="hud-return-menu-btn"
          onClick={(e) => {
            e.currentTarget.blur();
            onRequestReturnMenu();
          }}
          aria-label="Voltar ao menu inicial"
          title="Voltar ao menu inicial"
          className="pixel-btn px-1.5 sm:px-2 py-1 font-pixel text-[8px] bg-[#25314a] text-[#eef2f7] hover:bg-[#314161] whitespace-nowrap shrink-0 flex items-center gap-1"
        >
          <Home className="w-3 h-3" aria-hidden="true" />
          <span className="hidden md:inline">Menu Inicial</span>
        </button>
      </div>
    </header>
  );
}
