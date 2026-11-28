import { useState } from 'react';
import { Check, Download, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export function PWAInstallButton() {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showInstructions, setShowInstructions] = useState(false);
  const [installFeedback, setInstallFeedback] = useState<string | null>(null);

  if (isInstalled) {
    return null;
  }

  const isInIframe =
    typeof window !== 'undefined' &&
    (() => {
      try {
        return window.self !== window.top;
      } catch {
        return true;
      }
    })();

  const handleClick = async () => {
    if (isInstallable) {
      const outcome = await install();
      if (outcome === 'accepted') {
        setInstallFeedback('App instalado! Abra Pixópolis pela tela inicial.');
      }
      return;
    }
    setShowInstructions(true);
  };

  return (
    <>
      <button
        type="button"
        data-testid="title-install-pwa-btn"
        onClick={handleClick}
        className="pixel-btn w-full py-2.5 px-4 bg-[#173931] hover:bg-[#1e4d42] text-[#b9ffd9] font-pixel text-[10px] flex items-center justify-center gap-2.5"
      >
        <img
          src="./pwa-192x192.png"
          alt=""
          aria-hidden="true"
          className="w-5 h-5 pixelated border border-[#3a6b5e] shrink-0"
        />
        <Download className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>Baixar App (PWA)</span>
      </button>

      {installFeedback ? (
        <p className="text-[14px] text-[#66d98c] flex items-center justify-center gap-1.5">
          <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>{installFeedback}</span>
        </p>
      ) : null}

      {showInstructions ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#070b14]/80"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-modal-title"
          onClick={() => setShowInstructions(false)}
        >
          <div
            className="pixel-panel w-full max-w-[420px] p-4 sm:p-5 text-left"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 pb-2.5 mb-3 border-b border-[#25324c]">
              <div className="flex items-center gap-2.5">
                <img
                  src="./pwa-192x192.png"
                  alt="Ícone Pixópolis"
                  className="w-9 h-9 pixelated border-2 border-[#f5b73b]"
                />
                <div>
                  <h2
                    id="pwa-install-modal-title"
                    className="font-pixel text-[10px] text-[#f5b73b]"
                  >
                    INSTALAR PIXÓPOLIS
                  </h2>
                  <p className="text-[14px] text-[#9eb0c9] leading-tight">
                    Jogue em tela cheia e offline como app
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Fechar instruções de instalação"
                onClick={() => setShowInstructions(false)}
                className="pixel-btn p-1.5 bg-[#25314a] hover:bg-[#314161] text-[#cfd9e8]"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>

            {isIOS ? (
              <div className="pixel-inset p-3 space-y-2 text-[16px] text-[#dce6f2] leading-snug mb-3">
                <p className="font-pixel text-[8px] text-[#68c8ff] flex items-center gap-1.5">
                  <Share className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>IPHONE / IPAD (SAFARI)</span>
                </p>
                <ol className="list-decimal list-inside space-y-1.5 text-[15px]">
                  <li>
                    Toque no botão <strong className="text-[#ffe066]">Compartilhar</strong> na
                    barra do Safari.
                  </li>
                  <li>
                    Role e toque em{' '}
                    <strong className="text-[#ffe066]">Adicionar à Tela de Início</strong>.
                  </li>
                  <li>
                    Confirme tocando em <strong className="text-[#66d98c]">Adicionar</strong>.
                  </li>
                </ol>
              </div>
            ) : (
              <div className="pixel-inset p-3 space-y-2 text-[16px] text-[#dce6f2] leading-snug mb-3">
                <p className="font-pixel text-[8px] text-[#66d98c] flex items-center gap-1.5">
                  <Smartphone className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>COMO INSTALAR NO SEU DISPOSITIVO</span>
                </p>
                <ul className="space-y-1.5 text-[15px]">
                  <li>
                    <strong className="text-[#ffe066]">Android (Chrome/Edge):</strong> abra o menu{' '}
                    <strong className="text-white">⋮</strong> e toque em{' '}
                    <strong className="text-[#66d98c]">Instalar aplicativo</strong> ou{' '}
                    <strong className="text-[#66d98c]">Adicionar à tela inicial</strong>.
                  </li>
                  <li>
                    <strong className="text-[#ffe066]">Computador (Chrome/Edge):</strong> clique no
                    ícone de instalação na barra de endereço do navegador.
                  </li>
                  <li>
                    <strong className="text-[#ffe066]">iOS (Safari):</strong> toque em{' '}
                    <strong className="text-white">Compartilhar</strong> e depois em{' '}
                    <strong className="text-[#66d98c]">Adicionar à Tela de Início</strong>.
                  </li>
                </ul>
                {isInIframe ? (
                  <p className="text-[14px] text-[#9eb0c9] pt-1.5 border-t border-[#24324d]">
                    Dica: abra o app diretamente em uma aba do navegador para ativar o botão de
                    instalação automática em 1 clique.
                  </p>
                ) : null}
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowInstructions(false)}
              className="pixel-btn w-full py-2 px-4 bg-[#f5b73b] hover:bg-[#ffc652] text-[#111622] font-pixel text-[9px]"
            >
              Entendi
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
