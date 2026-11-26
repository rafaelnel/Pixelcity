import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface PixelModalProps {
  title: string;
  subtitle?: string;
  accentColor?: string;
  maxWidthClass?: string;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
}

export function PixelModal({
  title,
  subtitle,
  accentColor = '#f5b73b',
  maxWidthClass = 'max-w-[760px]',
  onClose,
  children,
  testId,
}: PixelModalProps) {
  // ESC key closes the modal cleanly
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid={testId}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 pb-[68px] md:pb-4 md:pl-[96px]"
      style={{ backgroundColor: 'rgba(7, 11, 20, 0.62)' }}
    >
      <div
        className={`pixel-panel w-full ${maxWidthClass} max-h-[calc(100vh-88px)] md:max-h-[calc(100vh-84px)] flex flex-col overflow-hidden text-[#eef2f7]`}
      >
        {/* Modal Header */}
        <div className="shrink-0 px-4 py-3 bg-[#151d2e] border-b-2 border-[#0b0f19] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2
              className="font-pixel text-[11px] sm:text-[13px] pixel-text-shadow truncate"
              style={{ color: accentColor }}
            >
              {title}
            </h2>
            {subtitle ? (
              <p className="text-[16px] text-[#9eb0c9] leading-tight mt-0.5 truncate">
                {subtitle}
              </p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={`Fechar ${title}`}
            title="Fechar (ESC)"
            className="pixel-btn w-9 h-9 shrink-0 flex items-center justify-center bg-[#25314a] hover:bg-[#3a4b6e] text-[#eef2f7]"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Scrollable Modal Body */}
        <div className="flex-1 min-h-0 overflow-y-auto pixel-scroll p-3.5 sm:p-4">
          {children}
        </div>
      </div>
    </div>
  );
}
