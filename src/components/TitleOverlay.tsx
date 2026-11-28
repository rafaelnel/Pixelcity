import { useState } from 'react';
import {
  ArrowLeft,
  FolderOpen,
  MapPin,
  Play,
  PlusCircle,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import {
  formatDateLabel,
  sanitizeDifficulty,
  type CitySaveRecord,
} from '../game/cityEngine';
import { DIFFICULTY_CONFIGS, DIFFICULTY_ORDER } from '../game/simulationConfig';
import type { CityTrait, DifficultyLevel } from '../game/types';
import { PWAInstallButton } from './PWAInstallButton';

type TitleView = 'menu' | 'new_game' | 'load_game';

interface TitleOverlayProps {
  seed: number;
  cityName: string;
  trait: CityTrait;
  difficulty: DifficultyLevel;
  savedGames: CitySaveRecord[];
  onChangeCityName: (name: string) => void;
  onSelectDifficulty: (difficulty: DifficultyLevel) => void;
  onStart: () => void;
  onRerollSeed: () => void;
  onLoadSavedGame: (saveId: string) => void;
  onDeleteSavedGame: (saveId: string) => void;
}

function formatPctModifier(mult: number): string {
  const pct = Math.round((mult - 1) * 100);
  if (pct === 0) return 'Padrão';
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

export function TitleOverlay({
  seed,
  cityName,
  trait,
  difficulty,
  savedGames,
  onChangeCityName,
  onSelectDifficulty,
  onStart,
  onRerollSeed,
  onLoadSavedGame,
  onDeleteSavedGame,
}: TitleOverlayProps) {
  const [view, setView] = useState<TitleView>('menu');
  const activeDiff = DIFFICULTY_CONFIGS[difficulty];
  const hasSaves = savedGames.length > 0;

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col items-center justify-between p-4 sm:p-6 select-none overflow-y-auto"
      style={{
        background:
          'radial-gradient(circle at 50% 45%, rgba(14, 19, 31, 0.72) 0%, rgba(10, 14, 24, 0.90) 100%)',
      }}
    >
      <div className="h-2 shrink-0" aria-hidden="true" />

      {/* Center Plaque & Custom 16-bit Pixel Skyline SVG Emblem */}
      <div className="pixel-panel max-w-[600px] w-full p-5 sm:p-6 flex flex-col items-center text-center my-auto">
        {/* Bespoke inline SVG pixel-art skyline emblem */}
        <svg
          viewBox="0 0 180 48"
          className="w-36 h-10 mb-2 pixelated"
          aria-hidden="true"
        >
          <rect x="14" y="6" width="3" height="3" fill="#ffe066" />
          <rect x="160" y="8" width="3" height="3" fill="#ffe066" />
          <rect x="46" y="4" width="2" height="2" fill="#79d0ff" />
          <rect x="132" y="5" width="2" height="2" fill="#79d0ff" />
          <rect x="16" y="28" width="20" height="14" fill="#f2e8d5" />
          <rect x="14" y="24" width="24" height="4" fill="#c9533c" />
          <rect x="18" y="20" width="16" height="4" fill="#e0664c" />
          <rect x="20" y="32" width="4" height="4" fill="#ffe066" />
          <rect x="28" y="34" width="4" height="8" fill="#6e472b" />
          <rect x="42" y="22" width="24" height="20" fill="#9e543d" />
          <rect x="60" y="10" width="6" height="12" fill="#525d6e" />
          <rect x="62" y="4" width="4" height="4" fill="#c4ccd8" />
          <rect x="66" y="2" width="4" height="3" fill="#8fa4bf" />
          <rect x="46" y="28" width="4" height="4" fill="#ffb703" />
          <rect x="54" y="28" width="4" height="4" fill="#ffb703" />
          <rect x="74" y="8" width="32" height="34" fill="#2563a8" />
          <rect x="98" y="8" width="8" height="34" fill="#184273" />
          <rect x="88" y="2" width="4" height="6" fill="#d8f3ff" />
          <rect x="78" y="12" width="6" height="4" fill="#c9f0ff" />
          <rect x="86" y="12" width="8" height="4" fill="#58b4f5" />
          <rect x="78" y="20" width="8" height="4" fill="#58b4f5" />
          <rect x="88" y="20" width="6" height="4" fill="#c9f0ff" />
          <rect x="78" y="28" width="6" height="4" fill="#58b4f5" />
          <rect x="86" y="28" width="8" height="4" fill="#ffe066" />
          <rect x="84" y="36" width="12" height="6" fill="#f5b73b" />
          <rect x="112" y="16" width="24" height="26" fill="#dce6f2" />
          <rect x="130" y="16" width="6" height="26" fill="#a8b9cf" />
          <rect x="112" y="13" width="24" height="3" fill="#4ea854" />
          <rect x="116" y="20" width="4" height="4" fill="#68c8ff" />
          <rect x="124" y="20" width="4" height="4" fill="#ffe066" />
          <rect x="116" y="28" width="4" height="4" fill="#ffe066" />
          <rect x="124" y="28" width="4" height="4" fill="#68c8ff" />
          <rect x="148" y="32" width="4" height="10" fill="#6e472b" />
          <rect x="142" y="22" width="16" height="10" fill="#2d7a3e" />
          <rect x="145" y="18" width="10" height="5" fill="#4ec45a" />
          <rect x="8" y="42" width="164" height="4" fill="#343b48" />
          <rect x="20" y="43" width="12" height="2" fill="#f4c95d" />
          <rect x="52" y="43" width="12" height="2" fill="#f4c95d" />
          <rect x="84" y="43" width="12" height="2" fill="#f4c95d" />
          <rect x="116" y="43" width="12" height="2" fill="#f4c95d" />
          <rect x="148" y="43" width="12" height="2" fill="#f4c95d" />
        </svg>

        <h1 className="font-pixel text-[24px] sm:text-[30px] tracking-wider text-[#f5b73b] pixel-text-shadow mt-0.5 mb-1.5 flex items-center justify-center">
          <span>PIX</span>
          <span className="relative inline-block">
            <span
              aria-hidden="true"
              className="absolute -top-2.5 left-1/2 -translate-x-1/2 w-3 h-1.5 bg-[#f5b73b] -skew-x-12 shadow-[2px_2px_0px_#090d16]"
            />
            O
          </span>
          <span>POLIS</span>
        </h1>

        {view === 'menu' ? (
          <>
            <p className="text-[19px] text-[#cfd9e8] leading-snug max-w-[44ch] mb-5">
              Construa e gerencie sua metrópole em vista isométrica 3D 64-bit, atravesse
              as 4 estações do ano e acompanhe a cidade evoluir.
            </p>

            <div className="flex flex-col gap-3 w-full max-w-[340px]">
              <button
                type="button"
                data-testid="title-new-game-btn"
                onClick={() => setView('new_game')}
                className="pixel-btn w-full py-3 px-5 bg-[#f5b73b] hover:bg-[#ffc652] text-[#111622] font-pixel text-[11px] flex items-center justify-center gap-2.5"
              >
                <PlusCircle className="w-4 h-4" aria-hidden="true" />
                <span>Novo Jogo</span>
              </button>

              {hasSaves ? (
                <button
                  type="button"
                  data-testid="title-load-game-btn"
                  onClick={() => setView('load_game')}
                  className="pixel-btn w-full py-3 px-5 bg-[#2b6cb0] hover:bg-[#3582d4] text-white font-pixel text-[11px] flex items-center justify-center gap-2.5"
                >
                  <FolderOpen className="w-4 h-4" aria-hidden="true" />
                  <span>Carregar Jogo ({savedGames.length})</span>
                </button>
              ) : null}

              <PWAInstallButton />
            </div>
          </>
        ) : null}

        {view === 'new_game' ? (
          <div className="w-full text-left mt-1">
            <div className="flex items-center justify-between gap-2 mb-3 pb-2 border-b border-[#25324c]">
              <h2 className="font-pixel text-[11px] text-[#f5b73b]">
                NOVA CIDADE
              </h2>
              <button
                type="button"
                data-testid="title-back-btn"
                onClick={() => setView('menu')}
                className="pixel-btn px-2.5 py-1 bg-[#25314a] hover:bg-[#314161] text-[#cfd9e8] font-pixel text-[8px] flex items-center gap-1.5"
              >
                <ArrowLeft className="w-3 h-3" aria-hidden="true" />
                <span>Voltar</span>
              </button>
            </div>

            {/* City Name Input */}
            <div className="pixel-inset p-3 mb-3">
              <label className="block">
                <span className="font-pixel text-[8px] text-[#8fa4bf] block mb-1.5">
                  NOME DA CIDADE
                </span>
                <input
                  type="text"
                  maxLength={32}
                  value={cityName}
                  data-testid="new-city-name-input"
                  aria-label="Nome da nova cidade"
                  onChange={(e) => onChangeCityName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      onStart();
                    }
                  }}
                  placeholder="Ex: Nova Horizonte"
                  className="w-full bg-[#0b101b] border-2 border-[#2a3854] focus:border-[#f5b73b] px-3 py-1.5 text-[18px] text-[#eef2f7] focus:outline-none select-text"
                />
              </label>
            </div>

            {/* Difficulty Selector */}
            <div className="pixel-inset p-3 mb-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="font-pixel text-[8px] text-[#8fa4bf]">
                  DIFICULDADE
                </span>
                <span
                  data-testid="title-difficulty-tagline"
                  className="text-[15px] font-bold"
                  style={{ color: activeDiff.accentColor }}
                >
                  {activeDiff.tagline}
                </span>
              </div>

              <div
                role="group"
                aria-label="Selecionar modo de dificuldade"
                className="grid grid-cols-3 gap-2 mb-2"
              >
                {DIFFICULTY_ORDER.map((level) => {
                  const cfg = DIFFICULTY_CONFIGS[level];
                  const active = difficulty === level;
                  return (
                    <button
                      key={level}
                      type="button"
                      data-testid={`title-difficulty-${level}`}
                      aria-pressed={active}
                      onClick={() => onSelectDifficulty(level)}
                      className={`pixel-btn py-2 px-2 font-pixel text-[9px] transition-colors ${
                        active
                          ? 'text-[#111622] ring-2 ring-[#eef2f7]'
                          : 'bg-[#1c263b] hover:bg-[#273552] text-[#cfd9e8]'
                      }`}
                      style={active ? { backgroundColor: cfg.accentColor } : undefined}
                    >
                      {cfg.label}
                    </button>
                  );
                })}
              </div>

              <p
                data-testid="title-difficulty-desc"
                className="text-[15px] text-[#d5e0ee] leading-snug mb-2"
              >
                {activeDiff.description}
              </p>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-[#9eb0c9] border-t border-[#24324d] pt-1.5 tabular-nums">
                <span>
                  Receita:{' '}
                  <strong style={{ color: activeDiff.accentColor }}>
                    {formatPctModifier(activeDiff.taxRevenueMultiplier)}
                  </strong>
                </span>
                <span>
                  Manutenção:{' '}
                  <strong style={{ color: activeDiff.accentColor }}>
                    {formatPctModifier(activeDiff.budgetNeedMultiplier)}
                  </strong>
                </span>
                <span>
                  Caixa Inicial:{' '}
                  <strong style={{ color: activeDiff.accentColor }}>
                    {formatPctModifier(activeDiff.startingMoneyMultiplier)}
                  </strong>
                </span>
              </div>
            </div>

            {/* Map Seed & City Trait Preview */}
            <div className="pixel-inset p-2.5 mb-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-pixel text-[7px] text-[#8fa4bf]">
                    TRAÇO DO TERRENO
                  </span>
                  <span className="text-[13px] text-[#8fa4bf] tabular-nums">
                    Seed #{seed}
                  </span>
                </div>
                <div
                  className="font-pixel text-[9px] mb-0.5"
                  style={{ color: trait.accentColor }}
                >
                  {trait.name}
                </div>
                <p className="text-[14px] text-[#cfd9e8] leading-snug">
                  {trait.summary}
                </p>
              </div>
              <button
                type="button"
                data-testid="title-reroll-btn"
                onClick={onRerollSeed}
                className="pixel-btn px-3 py-2 bg-[#25314a] hover:bg-[#314161] text-[#eef2f7] font-pixel text-[8px] flex items-center gap-1.5 shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Novo Mapa</span>
              </button>
            </div>

            <button
              type="button"
              data-start="true"
              data-testid="title-start-btn"
              onClick={onStart}
              className="pixel-btn w-full py-3 px-6 bg-[#f5b73b] hover:bg-[#ffc652] text-[#111622] font-pixel text-[11px] flex items-center justify-center gap-2"
            >
              <Play className="w-4 h-4 fill-current" aria-hidden="true" />
              <span>Começar</span>
            </button>
          </div>
        ) : null}

        {view === 'load_game' ? (
          <div className="w-full text-left mt-1">
            <div className="flex items-center justify-between gap-2 mb-3 pb-2 border-b border-[#25324c]">
              <h2 className="font-pixel text-[11px] text-[#56c2ff]">
                CARREGAR JOGO ({savedGames.length})
              </h2>
              <button
                type="button"
                data-testid="title-back-btn"
                onClick={() => setView('menu')}
                className="pixel-btn px-2.5 py-1 bg-[#25314a] hover:bg-[#314161] text-[#cfd9e8] font-pixel text-[8px] flex items-center gap-1.5"
              >
                <ArrowLeft className="w-3 h-3" aria-hidden="true" />
                <span>Voltar</span>
              </button>
            </div>

            {savedGames.length === 0 ? (
              <div className="pixel-inset p-6 text-center">
                <p className="text-[18px] text-[#9eb0c9] mb-4">
                  Nenhuma cidade salva na memória no momento.
                </p>
                <button
                  type="button"
                  onClick={() => setView('new_game')}
                  className="pixel-btn px-5 py-2.5 bg-[#f5b73b] hover:bg-[#ffc652] text-[#111622] font-pixel text-[10px] inline-flex items-center gap-2"
                >
                  <PlusCircle className="w-4 h-4" aria-hidden="true" />
                  <span>Criar Novo Jogo</span>
                </button>
              </div>
            ) : (
              <div
                data-testid="saved-games-list"
                className="max-h-[360px] overflow-y-auto space-y-2.5 pr-1"
              >
                {savedGames.map((record, idx) => {
                  const diff = DIFFICULTY_CONFIGS[sanitizeDifficulty(record.difficulty)];
                  return (
                    <div
                      key={record.saveId}
                      data-testid={`saved-game-item-${idx}`}
                      className="pixel-inset p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className="font-pixel text-[10px] text-[#ffe066] flex items-center gap-1.5 truncate">
                            <MapPin className="w-3 h-3 shrink-0" aria-hidden="true" />
                            <span>{record.name}</span>
                          </span>
                          <span
                            data-testid={`saved-game-difficulty-${idx}`}
                            className="font-pixel text-[7px] px-1.5 py-0.5 bg-[#0a101b] border"
                            style={{
                              borderColor: diff.accentColor,
                              color: diff.accentColor,
                            }}
                          >
                            {diff.label}
                          </span>
                          {record.isAutoSave ? (
                            <span className="font-pixel text-[6.5px] px-1.5 py-0.5 bg-[#12263a] border border-[#3a6ea5] text-[#7cc4ff]">
                              AUTO-SAVE
                            </span>
                          ) : null}
                        </div>

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[15px] text-[#dce6f2] tabular-nums">
                          <span>
                            Data:{' '}
                            <strong className="text-[#eef2f7]">
                              {formatDateLabel(record.month, record.year)}
                            </strong>
                          </span>
                          <span>
                            Pop:{' '}
                            <strong className="text-[#66d98c]">
                              {record.population.toLocaleString('pt-BR')}
                            </strong>
                          </span>
                          <span>
                            Caixa:{' '}
                            <strong className="text-[#ffe066]">
                              ${record.money.toLocaleString('pt-BR')}
                            </strong>
                          </span>
                          <span className="text-[#8fa4bf] text-[13px]">
                            Salvo em {record.savedAtLabel}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          data-testid={`load-saved-btn-${idx}`}
                          onClick={() => onLoadSavedGame(record.saveId)}
                          className="pixel-btn px-3.5 py-2 bg-[#2b6cb0] hover:bg-[#3582d4] text-white font-pixel text-[9px] flex items-center gap-1.5"
                        >
                          <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Carregar</span>
                        </button>
                        <button
                          type="button"
                          data-testid={`delete-saved-btn-${idx}`}
                          aria-label={`Excluir save de ${record.name}`}
                          title="Excluir save"
                          onClick={() => onDeleteSavedGame(record.saveId)}
                          className="pixel-btn p-2 bg-[#4a2328] hover:bg-[#692f36] text-[#ff9b9b]"
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Flat borderless bottom control hint */}
      <p className="text-[17px] text-[#b4c4db] text-center mt-2 shrink-0">
        Scroll: Zoom · Arrastar/WASD: Mover · Q/E: Girar 90° · Espaço: Pausar
      </p>
    </div>
  );
}
