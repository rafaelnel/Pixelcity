import { Building2, Coins, Siren, BarChart3 } from 'lucide-react';
import type { ModalTab } from '../game/types';

interface NavMenuProps {
  activeModal: ModalTab | null;
  criticalNeedsCount: number;
  onToggleTab: (tab: ModalTab) => void;
}

const NAV_ITEMS: Array<{
  id: ModalTab;
  label: string;
  shortLabel: string;
  accent: string;
  Icon: typeof Building2;
}> = [
  {
    id: 'budget',
    label: 'Orçamento',
    shortLabel: 'Orçamento',
    accent: '#56c2ff',
    Icon: Building2,
  },
  {
    id: 'finances',
    label: 'Finanças',
    shortLabel: 'Finanças',
    accent: '#f5b73b',
    Icon: Coins,
  },
  {
    id: 'emergencies',
    label: 'Emergências',
    shortLabel: 'Emerg.',
    accent: '#ff785a',
    Icon: Siren,
  },
  {
    id: 'report',
    label: 'Relatório',
    shortLabel: 'Relatório',
    accent: '#66d98c',
    Icon: BarChart3,
  },
];

export function NavMenu({
  activeModal,
  criticalNeedsCount,
  onToggleTab,
}: NavMenuProps) {
  return (
    <>
      {/* Desktop: Fixed Narrow Left Vertical Navigation Rail */}
      <nav
        aria-label="Menu principal de gestão da cidade"
        data-testid="desktop-nav"
        className="hidden md:flex fixed left-3 top-1/2 -translate-y-1/2 z-30 pixel-panel-glass p-1.5 flex-col gap-1.5 w-[98px] select-none"
      >
        {NAV_ITEMS.map(({ id, label, accent, Icon }) => {
          const isOpen = activeModal === id;
          const showAlert = id === 'report' && criticalNeedsCount > 0;

          return (
            <button
              key={id}
              type="button"
              aria-label={`Abrir ${label}`}
              aria-pressed={isOpen}
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleTab(id);
              }}
              className={`relative pixel-btn w-full py-2.5 px-1 flex flex-col items-center justify-center gap-1.5 ${
                isOpen
                  ? 'bg-[#2c3c5c] text-white'
                  : 'bg-[#1b2438] text-[#bfd0e6] hover:bg-[#263450]'
              }`}
              style={isOpen ? { borderColor: accent } : undefined}
            >
              <Icon
                className="w-5 h-5 shrink-0"
                style={{ color: isOpen ? accent : '#cfd9e8' }}
                aria-hidden="true"
              />
              <span
                className="font-pixel text-[6.5px] leading-tight text-center whitespace-nowrap"
                style={{ color: isOpen ? accent : '#dce6f2' }}
              >
                {label}
              </span>
              {showAlert ? (
                <span
                  aria-label={`${criticalNeedsCount} alertas críticos`}
                  className="absolute top-1 right-1 px-1 min-w-[16px] h-[16px] bg-[#e05252] border border-[#0b0f19] font-pixel text-[7px] text-white flex items-center justify-center tabular-nums"
                >
                  {criticalNeedsCount}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      {/* Mobile: Fixed Bottom Navigation Bar (Large Touch Targets >= 48px) */}
      <nav
        aria-label="Menu inferior de gestão da cidade"
        data-testid="mobile-nav"
        className="flex md:hidden fixed bottom-0 left-0 right-0 z-30 pixel-panel-glass px-1.5 py-1 items-center justify-around gap-1.5 h-[60px] select-none"
      >
        {NAV_ITEMS.map(({ id, label, shortLabel, accent, Icon }) => {
          const isOpen = activeModal === id;
          const showAlert = id === 'report' && criticalNeedsCount > 0;

          return (
            <button
              key={id}
              type="button"
              aria-label={`Abrir ${label}`}
              aria-pressed={isOpen}
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleTab(id);
              }}
              className={`relative pixel-btn flex-1 min-h-[48px] px-1 py-1.5 flex flex-col items-center justify-center gap-1 ${
                isOpen
                  ? 'bg-[#2c3c5c] text-white'
                  : 'bg-[#1b2438] text-[#bfd0e6]'
              }`}
              style={isOpen ? { borderColor: accent } : undefined}
            >
              <Icon
                className="w-5 h-5 shrink-0"
                style={{ color: isOpen ? accent : '#cfd9e8' }}
                aria-hidden="true"
              />
              <span
                className="font-pixel text-[7px] leading-none whitespace-nowrap"
                style={{ color: isOpen ? accent : '#dce6f2' }}
              >
                {shortLabel}
              </span>
              {showAlert ? (
                <span
                  aria-label={`${criticalNeedsCount} alertas críticos`}
                  className="absolute top-0.5 right-1 px-1 min-w-[15px] h-[15px] bg-[#e05252] border border-[#0b0f19] font-pixel text-[6px] text-white flex items-center justify-center tabular-nums"
                >
                  {criticalNeedsCount}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>
    </>
  );
}
