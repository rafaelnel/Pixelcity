import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { NewsItem } from '../game/types';

interface NewsTickerProps {
  news: NewsItem[];
}

export function NewsTicker({ news }: NewsTickerProps) {
  const [offset, setOffset] = useState(0);
  const safeIdx = news.length > 0 ? Math.min(offset, news.length - 1) : 0;
  const current = news[safeIdx];

  const toneBadge =
    current?.tone === 'milestone'
      ? { label: 'MARCO', cls: 'bg-[#f5b73b] text-[#111622]' }
      : current?.tone === 'good'
        ? { label: 'ALTA', cls: 'bg-[#4ea854] text-[#0c131d]' }
        : current?.tone === 'warning'
          ? { label: 'ALERTA', cls: 'bg-[#e05252] text-white' }
          : { label: 'BOLETIM', cls: 'bg-[#3c6e9c] text-white' };

  return (
    <footer
      aria-label="Letreiro de notícias da cidade"
      className="fixed bottom-[64px] left-2 right-2 md:bottom-3 md:left-[116px] md:right-[536px] z-20 pixel-panel-glass px-2.5 py-1 flex items-center justify-between gap-2 select-none"
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span
          className={`font-pixel text-[7px] px-1.5 py-0.5 border border-[#0b0f19] whitespace-nowrap shrink-0 ${toneBadge.cls}`}
        >
          {toneBadge.label}
        </span>
        {current ? (
          <p
            data-testid="news-ticker-text"
            className="text-[16px] sm:text-[18px] leading-none text-[#eef2f7] truncate"
          >
            <span className="text-[#8fa4bf] mr-1.5 tabular-nums">
              [{current.dateLabel}]
            </span>
            {current.text}
          </p>
        ) : (
          <p className="text-[16px] sm:text-[18px] leading-none text-[#9eb0c9] truncate">
            Aguardando boletins da cidade...
          </p>
        )}
      </div>

      {/* History step controls */}
      <div className="flex items-center gap-1 shrink-0">
        <span className="text-[15px] text-[#8fa4bf] mr-0.5 tabular-nums hidden sm:inline">
          {news.length > 0 ? `${safeIdx + 1}/${news.length}` : '0/0'}
        </span>
        <button
          type="button"
          disabled={safeIdx <= 0}
          aria-label="Notícia mais recente"
          onClick={() => setOffset((v) => Math.max(0, v - 1))}
          className="pixel-btn p-1 bg-[#25314a] text-[#eef2f7]"
        >
          <ChevronLeft className="w-3 h-3" aria-hidden="true" />
        </button>
        <button
          type="button"
          disabled={safeIdx >= news.length - 1}
          aria-label="Notícia anterior"
          onClick={() => setOffset((v) => Math.min(news.length - 1, v + 1))}
          className="pixel-btn p-1 bg-[#25314a] text-[#eef2f7]"
        >
          <ChevronRight className="w-3 h-3" aria-hidden="true" />
        </button>
      </div>
    </footer>
  );
}
