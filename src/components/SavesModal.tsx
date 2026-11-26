import { useState } from 'react';
import { Download, FolderOpen, Save, Trash2, Upload } from 'lucide-react';
import {
  formatDateLabel,
  sanitizeDifficulty,
  type CitySaveRecord,
} from '../game/cityEngine';
import { DIFFICULTY_CONFIGS } from '../game/simulationConfig';
import type { HudSnapshot } from '../game/types';
import { PixelModal } from './PixelModal';

interface SavesModalProps {
  hud: HudSnapshot;
  savedGames: CitySaveRecord[];
  feedbackMsg: string | null;
  onSaveCurrentAs: (customName: string) => void;
  onLoadGame: (saveId: string) => void;
  onDeleteGame: (saveId: string) => void;
  onExportCode: () => string;
  onImportCode: (jsonCode: string) => void;
  onClose: () => void;
}

export function SavesModal({
  hud,
  savedGames,
  feedbackMsg,
  onSaveCurrentAs,
  onLoadGame,
  onDeleteGame,
  onExportCode,
  onImportCode,
  onClose,
}: SavesModalProps) {
  const [cityName, setCityName] = useState<string>(hud.cityName || 'Pixópolis');
  const [importText, setImportText] = useState<string>('');
  const [showCodeBox, setShowCodeBox] = useState<boolean>(false);
  const currentDiffCfg = DIFFICULTY_CONFIGS[hud.difficulty];

  return (
    <PixelModal
      title="CIDADES SALVAS & BACKUP"
      subtitle={`Cidade atual: ${hud.cityName} (${formatDateLabel(hud.month, hud.year)}) · Modo ${currentDiffCfg.label} · Pop ${hud.totalPopulation.toLocaleString('pt-BR')} · Caixa $${hud.money.toLocaleString('pt-BR')}`}
      accentColor="#66d98c"
      maxWidthClass="max-w-[820px]"
      onClose={onClose}
      testId="saves-modal"
    >
      {/* Rename & Save Current City */}
      <div className="pixel-inset p-3 mb-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <label className="flex-1 flex flex-col sm:flex-row sm:items-center gap-2">
          <span className="font-pixel text-[8px] text-[#8fa4bf] whitespace-nowrap">
            NOME DA CIDADE:
          </span>
          <input
            type="text"
            maxLength={32}
            value={cityName}
            data-testid="save-name-input"
            aria-label="Nome da cidade para salvar"
            onChange={(e) => setCityName(e.target.value)}
            placeholder="Ex: Metrópole do Rio"
            className="flex-1 bg-[#0b101b] border-2 border-[#2a3854] focus:border-[#66d98c] px-2.5 py-1 text-[17px] text-[#eef2f7] focus:outline-none"
          />
        </label>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            data-testid="save-current-modal-btn"
            onClick={() => onSaveCurrentAs(cityName)}
            className="pixel-btn px-3 py-1.5 bg-[#2e7d52] hover:bg-[#389462] text-white font-pixel text-[8px] flex items-center gap-1.5"
          >
            <Save className="w-3 h-3" aria-hidden="true" />
            <span>Salvar Atual</span>
          </button>

          <button
            type="button"
            onClick={() => setShowCodeBox((v) => !v)}
            className="pixel-btn px-2.5 py-1.5 bg-[#25314a] hover:bg-[#314161] text-[#cfd9e8] font-pixel text-[7px] flex items-center gap-1.5"
          >
            <Download className="w-3 h-3" aria-hidden="true" />
            <span>{showCodeBox ? 'Ocultar JSON' : 'Backup JSON'}</span>
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedbackMsg ? (
        <div
          data-testid="saves-feedback"
          className="pixel-inset px-3 py-2 mb-3.5 text-[17px] text-[#66d98c] border-[#2e7d52]"
        >
          {feedbackMsg}
        </div>
      ) : null}

      {/* Portable Save Code Box (Optional Export/Import JSON) */}
      {showCodeBox ? (
        <div className="pixel-inset p-3 mb-3.5 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-pixel text-[8px] text-[#ffe066]">
              CÓDIGO PORTÁTIL DA CIDADE (BACKUP JSON)
            </span>
            <button
              type="button"
              onClick={() => setImportText(onExportCode())}
              className="pixel-btn px-2 py-1 bg-[#2b6cb0] text-white font-pixel text-[7px]"
            >
              Gerar Código da Cidade Atual
            </button>
          </div>
          <textarea
            rows={3}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder="Cole aqui o código JSON de uma cidade salva para carregar..."
            aria-label="Código JSON da cidade"
            className="w-full bg-[#0b101b] border border-[#2a3854] p-2 text-[14px] text-[#dce6f2] font-mono focus:outline-none"
          />
          <div className="flex justify-end">
            <button
              type="button"
              disabled={importText.trim().length === 0}
              onClick={() => onImportCode(importText)}
              className="pixel-btn px-3 py-1.5 bg-[#2e7d52] text-white font-pixel text-[8px] flex items-center gap-1.5"
            >
              <Upload className="w-3 h-3" aria-hidden="true" />
              <span>Carregar deste Código</span>
            </button>
          </div>
        </div>
      ) : null}

      {/* Dynamic Saved Cities Library */}
      {savedGames.length === 0 ? (
        <div className="pixel-inset p-6 text-center text-[18px] text-[#8fa4bf]">
          Nenhuma cidade salva ainda. Clique em <strong>Salvar Atual</strong> acima para guardar esta cidade.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[380px] overflow-y-auto pr-1">
          {savedGames.map((record, idx) => {
            const slotDiff = DIFFICULTY_CONFIGS[sanitizeDifficulty(record.difficulty)];
            const isCurrent = record.saveId === hud.saveId;
            return (
              <div
                key={record.saveId}
                data-testid={`save-slot-${idx + 1}`}
                className="pixel-inset p-3.5 flex flex-col justify-between gap-3"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="min-w-0">
                      <span className="font-pixel text-[7px] text-[#8fa4bf] block mb-0.5">
                        {isCurrent ? 'SAVE ATUAL · ' : ''}SALVO EM {record.savedAtLabel}
                      </span>
                      <h3
                        data-testid={`save-slot-title-${idx + 1}`}
                        className="font-pixel text-[9px] text-[#ffe066] leading-snug"
                      >
                        {record.name}
                      </h3>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span
                        className="font-pixel text-[7px] px-1.5 py-0.5 bg-[#0f1624] border border-[#334361]"
                        style={{ color: record.traitColor }}
                      >
                        {record.traitName}
                      </span>
                      <span
                        data-testid={`save-slot-difficulty-${idx + 1}`}
                        className="font-pixel text-[6.5px] px-1.5 py-0.5 bg-[#0a101b] border"
                        style={{
                          borderColor: slotDiff.accentColor,
                          color: slotDiff.accentColor,
                        }}
                      >
                        {slotDiff.shortLabel}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5 text-[16px] text-[#dce6f2] tabular-nums mt-2 bg-[#0c121e] p-2 border border-[#1f2c44]">
                    <div>
                      Data:{' '}
                      <strong className="text-[#eef2f7]">
                        {formatDateLabel(record.month, record.year)}
                      </strong>
                    </div>
                    <div>
                      Pop:{' '}
                      <strong className="text-[#66d98c]">
                        {record.population.toLocaleString('pt-BR')}
                      </strong>
                    </div>
                    <div>
                      Caixa:{' '}
                      <strong className="text-[#ffe066]">
                        ${record.money.toLocaleString('pt-BR')}
                      </strong>
                    </div>
                    <div>
                      Mapa:{' '}
                      <strong className="text-[#56c2ff]">
                        {record.gridWidth}×{record.gridHeight}
                      </strong>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    data-testid={`load-btn-slot-${idx + 1}`}
                    aria-label={`Carregar ${record.name}`}
                    onClick={() => onLoadGame(record.saveId)}
                    className="pixel-btn flex-1 py-2 px-2.5 bg-[#2b6cb0] hover:bg-[#3582d4] text-white font-pixel text-[8px] flex items-center justify-center gap-1.5"
                  >
                    <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Carregar</span>
                  </button>

                  <button
                    type="button"
                    data-testid={`delete-btn-slot-${idx + 1}`}
                    aria-label={`Excluir save de ${record.name}`}
                    title="Excluir este save"
                    onClick={() => onDeleteGame(record.saveId)}
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
    </PixelModal>
  );
}
