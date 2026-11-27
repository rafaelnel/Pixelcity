import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface PixelModalProps {
  title: string;
  subtitle?: string;
  headerSummary?: ReactNode;
  accentColor?: string;
  maxWidthClass?: string;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
}

export function PixelModal({
  title,
  subtitle,
  headerSummary,
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
      className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 pb-[68px] md:pb-4 md:pl-[116px]"
      style={{ backgroundColor: 'rgba(7, 11, 20, 0.62)' }}
    >
      <div
        className={`pixel-panel w-full ${maxWidthClass} max-h-[calc(100dvh-88px)] md:max-h-[calc(100dvh-84px)] flex flex-col overflow-hidden text-[#eef2f7]`}
      >
        {/* Modal Header */}
        <div className="shrink-0 px-3.5 sm:px-4 py-2.5 sm:py-3 bg-[#151d2e] border-b-2 border-[#0b0f19] flex flex-col gap-1.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2
                className="font-pixel text-[10px] sm:text-[13px] pixel-text-shadow leading-snug"
                style={{ color: accentColor }}
              >
                {title}
              </h2>
              {subtitle ? (
                <p className="text-[14.5px] sm:text-[16px] text-[#9eb0c9] leading-tight mt-0.5 break-words">
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

          {headerSummary ? (
            <div className="pt-1.5 border-t border-[#23314d] flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[14.5px] sm:text-[15.5px] tabular-nums">
              {headerSummary}
            </div>
          ) : null}
        </div>

        {/* Scrollable Modal Body */}
        <div className="flex-1 min-h-0 overflow-y-auto pixel-scroll p-3 sm:p-4">
          {children}
        </div>
      </div>
    </div>
  );
}

