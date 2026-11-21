import { Clock, Code2, Film, Layers, Upload } from 'lucide-react';
import { AppScreen } from '../types';

interface TopBarProps {
  activeScreen: AppScreen;
  hasActiveJob: boolean;
  onNavigate: (screen: AppScreen) => void;
  onTriggerUpload: () => void;
}

export function TopBar({
  activeScreen,
  hasActiveJob,
  onNavigate,
  onTriggerUpload,
}: TopBarProps) {
  const isStudioActive =
    activeScreen === 'home' || activeScreen === 'processing' || activeScreen === 'result';

  return (
    <>
      {/* Desktop & Mobile Top Bar: Strict 3-Zone Contract */}
      <header className="sticky top-0 z-30 h-14 border-b border-zinc-200/80 dark:border-white/8 bg-white/90 dark:bg-[#0B0D12]/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-8">
          {/* Zone 1: Single-line Brand Wordmark */}
          <button
            type="button"
            onClick={() => onNavigate('home')}
            className="flex items-center gap-2.5 text-left whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-lg py-1"
          >
            <span className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0">
              <svg
                viewBox="0 0 24 24"
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2" />
                <polyline points="12 22 12 12" />
                <polyline points="22 8.5 12 12 2 8.5" />
              </svg>
            </span>
            <span className="font-display font-bold text-base tracking-tight text-zinc-900 dark:text-zinc-50">
              Cartoon AI Studio
            </span>
          </button>

          {/* Zone 2: Clean Single-Line Nav Links */}
          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-6 text-sm font-medium"
          >
            <button
              type="button"
              onClick={() => onNavigate('home')}
              className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                activeScreen === 'home'
                  ? 'border-blue-600 text-zinc-900 dark:text-white'
                  : 'border-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
              }`}
            >
              Studio
            </button>
            {hasActiveJob && (
              <button
                type="button"
                onClick={() => onNavigate('processing')}
                className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                  activeScreen === 'processing' || activeScreen === 'result'
                    ? 'border-blue-600 text-zinc-900 dark:text-white'
                    : 'border-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                }`}
              >
                Active Job
              </button>
            )}
            <button
              type="button"
              onClick={() => onNavigate('history')}
              className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                activeScreen === 'history'
                  ? 'border-blue-600 text-zinc-900 dark:text-white'
                  : 'border-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
              }`}
            >
              History
            </button>
            <button
              type="button"
              onClick={() => onNavigate('deliverables')}
              className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                activeScreen === 'deliverables'
                  ? 'border-blue-600 text-zinc-900 dark:text-white'
                  : 'border-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
              }`}
            >
              Android &amp; API
            </button>
          </nav>

          {/* Zone 3: Single Primary Action */}
          <div className="shrink-0">
            <button
              type="button"
              onClick={onTriggerUpload}
              className="inline-flex items-center gap-2 px-4 py-2 min-h-[40px] rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white text-sm font-medium transition-all whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#0B0D12]"
            >
              <Upload className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Upload Video</span>
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Bottom Navigation Bar (Material 3 Thumb Zone, <= 15% sticky height with top bar) */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-zinc-200 dark:border-white/8 bg-white/95 dark:bg-[#0B0D12]/95 backdrop-blur-md pb-safe"
      >
        <div className="grid grid-cols-4 h-14 items-center">
          <button
            type="button"
            onClick={() => onNavigate('home')}
            className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
              isStudioActive && activeScreen === 'home'
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-zinc-500 dark:text-zinc-400'
            }`}
          >
            <Film className="w-5 h-5" aria-hidden="true" />
            <span>Studio</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate(hasActiveJob ? 'processing' : 'home')}
            className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
              activeScreen === 'processing' || activeScreen === 'result'
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-zinc-500 dark:text-zinc-400'
            }`}
          >
            <Layers className="w-5 h-5" aria-hidden="true" />
            <span>Pipeline</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('history')}
            className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
              activeScreen === 'history'
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-zinc-500 dark:text-zinc-400'
            }`}
          >
            <Clock className="w-5 h-5" aria-hidden="true" />
            <span>History</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('deliverables')}
            className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
              activeScreen === 'deliverables'
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-zinc-500 dark:text-zinc-400'
            }`}
          >
            <Code2 className="w-5 h-5" aria-hidden="true" />
            <span>Android</span>
          </button>
        </div>
      </nav>
    </>
  );
}
