import { Building2, Coins, Siren, BarChart3 } from 'lucide-react';
import type { ModalTab } from '../game/types';

export interface NavBadgeSpec {
  text: string;
  ariaLabel: string;
  tone: 'critical' | 'warning' | 'active' | 'ready';
}

interface NavMenuProps {
  activeModal: ModalTab | null;
  criticalNeedsCount: number;
  financesBadge?: NavBadgeSpec | null;
  worksBadge?: NavBadgeSpec | null;
  onToggleTab: (tab: ModalTab) => void;
}

const NAV_ITEMS: Array<{
  id: ModalTab;
  label: string;
  shortLabel: string;
  shortcutHint: string;
  accent: string;
  Icon: typeof Building2;
}> = [
  {
    id: 'budget',
    label: 'Orçamento',
    shortLabel: 'Orçamento',
    shortcutHint: 'B / F1',
    accent: '#56c2ff',
    Icon: Building2,
  },
  {
    id: 'finances',
    label: 'Finanças',
    shortLabel: 'Finanças',
    shortcutHint: 'F / F2',
    accent: '#f5b73b',
    Icon: Coins,
  },
  {
    id: 'emergencies',
    label: 'Obras & Ações',
    shortLabel: 'Obras',
    shortcutHint: 'O / F3',
    accent: '#ff785a',
    Icon: Siren,
  },
  {
    id: 'report',
    label: 'Relatório',
    shortLabel: 'Relatório',
    shortcutHint: 'R / F4',
    accent: '#66d98c',
    Icon: BarChart3,
  },
];

function getBadgeStyle(tone: NavBadgeSpec['tone']): string {
  switch (tone) {
    case 'critical':
      return 'bg-[#e05252] text-white border-[#0b0f19]';
    case 'warning':
      return 'bg-[#f5b73b] text-[#111622] border-[#0b0f19]';
    case 'active':
      return 'bg-[#2b6cb0] text-white border-[#7dd3fc]';
    case 'ready':
      return 'bg-[#16a34a] text-white border-[#0b0f19]';
  }
}

export function NavMenu({
  activeModal,
  criticalNeedsCount,
  financesBadge,
  worksBadge,
  onToggleTab,
}: NavMenuProps) {
  const resolveBadge = (id: ModalTab): NavBadgeSpec | null => {
    if (id === 'finances') {
      return financesBadge ?? null;
    }
    if (id === 'emergencies') {
      return worksBadge ?? null;
    }
    if (id === 'report' && criticalNeedsCount > 0) {
      return {
        text: String(criticalNeedsCount),
        ariaLabel: `${criticalNeedsCount} alertas críticos`,
        tone: 'critical',
      };
    }
    return null;
  };

  return (
    <>
      {/* Desktop: Fixed Narrow Left Vertical Navigation Rail (z-[60] stays clickable over modal backdrop) */}
      <nav
        aria-label="Menu principal de gestão da cidade"
        data-testid="desktop-nav"
        className="hidden md:flex fixed left-3 top-1/2 -translate-y-1/2 z-[60] pixel-panel-glass p-1.5 flex-col gap-1.5 w-[98px] select-none"
      >
        {NAV_ITEMS.map(({ id, label, shortcutHint, accent, Icon }) => {
          const isOpen = activeModal === id;
          const badge = resolveBadge(id);

          return (
            <button
              key={id}
              type="button"
              data-testid={`nav-btn-${id}`}
              aria-label={`Abrir ${label}`}
              title={`${label} (Atalho: ${shortcutHint})`}
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
                className="font-pixel text-[6px] leading-tight text-center whitespace-nowrap"
                style={{ color: isOpen ? accent : '#dce6f2' }}
              >
                {label}
              </span>
              {badge ? (
                <span
                  data-testid={`nav-badge-${id}`}
                  aria-label={badge.ariaLabel}
                  className={`absolute top-1 right-1 px-1 min-w-[16px] h-[16px] border font-pixel text-[7px] flex items-center justify-center tabular-nums ${getBadgeStyle(
                    badge.tone
                  )}`}
                >
                  {badge.text}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      {/* Mobile: Fixed Bottom Navigation Bar (Large Touch Targets >= 48px, z-[60] clickable over modal backdrop) */}
      <nav
        aria-label="Menu inferior de gestão da cidade"
        data-testid="mobile-nav"
        className="flex md:hidden fixed bottom-0 left-0 right-0 z-[60] pixel-panel-glass px-1.5 py-1 items-center justify-around gap-1.5 h-[60px] select-none"
      >
        {NAV_ITEMS.map(({ id, label, shortLabel, accent, Icon }) => {
          const isOpen = activeModal === id;
          const badge = resolveBadge(id);

          return (
            <button
              key={id}
              type="button"
              data-testid={`mobile-nav-btn-${id}`}
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
              {badge ? (
                <span
                  data-testid={`mobile-nav-badge-${id}`}
                  aria-label={badge.ariaLabel}
                  className={`absolute top-0.5 right-1 px-1 min-w-[15px] h-[15px] border font-pixel text-[6px] flex items-center justify-center tabular-nums ${getBadgeStyle(
                    badge.tone
                  )}`}
                >
                  {badge.text}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>
    </>
  );
}

