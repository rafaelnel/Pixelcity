import { AlertTriangle, LogOut, Save, X } from 'lucide-react';
import { formatDateLabel } from '../game/cityEngine';
import type { HudSnapshot } from '../game/types';

interface ReturnMenuModalProps {
  hud: HudSnapshot;
  onSaveAndExit: () => void;
  onExitWithoutSaving: () => void;
  onCancel: () => void;
}

export function ReturnMenuModal({
  hud,
  onSaveAndExit,
  onExitWithoutSaving,
  onCancel,
}: ReturnMenuModalProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="return-menu-title"
      data-testid="return-menu-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(9, 13, 22, 0.82)' }}
    >
      <div className="pixel-panel w-full max-w-[440px] p-6 text-center">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-[#f5b73b]">
            <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <h2
              id="return-menu-title"
              className="font-pixel text-[12px] pixel-text-shadow"
            >
              VOLTAR AO MENU INICIAL
            </h2>
          </div>
          <button
            type="button"
            aria-label="Cancelar e continuar jogando"
            onClick={onCancel}
            className="pixel-btn w-7 h-7 flex items-center justify-center bg-[#25314a] hover:bg-[#314161] text-[#cfd9e8]"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>

        <div className="pixel-inset p-3 mb-5 text-left">
          <p className="text-[17px] text-[#eef2f7] leading-snug mb-1">
            Deseja salvar o progresso de <strong className="text-[#ffe066]">{hud.cityName}</strong> ({formatDateLabel(hud.month, hud.year)}) antes de retornar à tela inicial?
          </p>
          <p className="text-[14px] text-[#9eb0c9]">
            Se sair sem salvar, alterações desde o último save ou auto-save anual serão descartadas.
          </p>
        </div>

        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            data-testid="exit-save-and-quit-btn"
            onClick={onSaveAndExit}
            className="pixel-btn w-full py-3 px-4 bg-[#2e7d52] hover:bg-[#389462] text-white font-pixel text-[10px] flex items-center justify-center gap-2"
          >
            <Save className="w-4 h-4" aria-hidden="true" />
            <span>Salvar e Sair</span>
          </button>

          <button
            type="button"
            data-testid="exit-without-saving-btn"
            onClick={onExitWithoutSaving}
            className="pixel-btn w-full py-3 px-4 bg-[#7f2b32] hover:bg-[#9c363e] text-[#ffe5e5] font-pixel text-[10px] flex items-center justify-center gap-2"
          >
            <LogOut className="w-4 h-4" aria-hidden="true" />
            <span>Sair sem Salvar</span>
          </button>

          <button
            type="button"
            data-testid="exit-cancel-btn"
            onClick={onCancel}
            className="pixel-btn w-full py-2 px-4 bg-[#25314a] hover:bg-[#314161] text-[#cfd9e8] font-pixel text-[9px]"
          >
            Continuar Jogando
          </button>
        </div>
      </div>
    </div>
  );
}
