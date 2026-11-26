import { Check, Home, Save } from 'lucide-react';
import { DIFFICULTY_CONFIGS, DIFFICULTY_ORDER } from '../game/simulationConfig';
import type { DifficultyLevel, HudSnapshot } from '../game/types';

interface PauseModalProps {
  hud: HudSnapshot;
  justSaved?: boolean;
  onChangeDifficulty: (difficulty: DifficultyLevel) => void;
  onResume: () => void;
  onQuickSave: () => void;
  onOpenSaves: () => void;
  onRequestReturnMenu: () => void;
}

export function PauseModal({
  hud,
  justSaved = false,
  onChangeDifficulty,
  onResume,
  onQuickSave,
  onOpenSaves,
  onRequestReturnMenu,
}: PauseModalProps) {
  const activeDiff = DIFFICULTY_CONFIGS[hud.difficulty];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pause-title"
      data-testid="pause-modal"
      className="fixed inset-0 z-40 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(9, 13, 22, 0.78)' }}
    >
      <div className="pixel-panel w-full max-w-[440px] p-6 text-center">
        <h2
          id="pause-title"
          className="font-pixel text-[15px] text-[#f5b73b] pixel-text-shadow mb-1"
        >
          SIMULAÇÃO PAUSADA
        </h2>
        <p className="text-[17px] text-[#cfe0f5] mb-4">
          {hud.cityName} · Seed #{hud.seed}
        </p>

        <div className="pixel-inset p-3 grid grid-cols-3 gap-2 mb-4">
          <div>
            <div className="font-pixel text-[8px] text-[#8fa4bf] mb-1">
              POPULAÇÃO
            </div>
            <div className="text-[22px] font-bold text-[#eef2f7] tabular-nums">
              {hud.totalPopulation}
            </div>
          </div>
          <div className="border-x border-[#26324a]">
            <div className="font-pixel text-[8px] text-[#8fa4bf] mb-1">
              CAIXA
            </div>
            <div className="text-[22px] font-bold text-[#ffe066] tabular-nums">
              ${hud.money.toLocaleString('pt-BR')}
            </div>
          </div>
          <div>
            <div className="font-pixel text-[8px] text-[#8fa4bf] mb-1">
              FELICID.
            </div>
            <div className="text-[22px] font-bold text-[#66d98c] tabular-nums">
              {hud.globalHappiness}%
            </div>
          </div>
        </div>

        {/* Live Difficulty Control */}
        <div className="pixel-inset p-3 mb-5 text-left">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="font-pixel text-[8px] text-[#8fa4bf]">
              DIFICULDADE ECONÔMICA
            </span>
            <span
              className="font-pixel text-[8px]"
              style={{ color: activeDiff.accentColor }}
            >
              {activeDiff.shortLabel}
            </span>
          </div>
          <div
            role="group"
            aria-label="Alterar dificuldade da cidade"
            className="grid grid-cols-3 gap-1.5 mb-2"
          >
            {DIFFICULTY_ORDER.map((level) => {
              const cfg = DIFFICULTY_CONFIGS[level];
              const active = hud.difficulty === level;
              return (
                <button
                  key={level}
                  type="button"
                  data-testid={`pause-difficulty-${level}`}
                  aria-pressed={active}
                  onClick={() => onChangeDifficulty(level)}
                  className={`pixel-btn py-1.5 px-2 font-pixel text-[8px] ${
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
          <p className="text-[15px] text-[#cfd9e8] leading-snug">
            {activeDiff.tagline}.
          </p>
        </div>

        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={onResume}
            className="pixel-btn w-full py-2.5 bg-[#f5b73b] hover:bg-[#ffc652] text-[#111622] font-pixel text-[10px]"
          >
            Continuar
          </button>
          <button
            type="button"
            data-testid="pause-quick-save-btn"
            onClick={onQuickSave}
            className={`pixel-btn w-full py-2.5 font-pixel text-[10px] flex items-center justify-center gap-2 ${
              justSaved
                ? 'bg-[#2e7d52] text-[#fffbeb]'
                : 'bg-[#2b6cb0] hover:bg-[#3582d4] text-white'
            }`}
          >
            {justSaved ? (
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <Save className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            <span>{justSaved ? 'Jogo Salvo!' : 'Salvar Jogo Atual'}</span>
          </button>
          <button
            type="button"
            onClick={onOpenSaves}
            className="pixel-btn w-full py-2.5 bg-[#25314a] hover:bg-[#314161] text-[#cfd9e8] font-pixel text-[10px]"
          >
            Gerenciar Cidades Salvas
          </button>
          <button
            type="button"
            data-testid="pause-return-menu-btn"
            onClick={onRequestReturnMenu}
            className="pixel-btn w-full py-2.5 bg-[#4a2328] hover:bg-[#692f36] text-[#ffd6d6] font-pixel text-[10px] flex items-center justify-center gap-2"
          >
            <Home className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Voltar ao Menu Inicial</span>
          </button>
        </div>
      </div>
    </div>
  );
}
