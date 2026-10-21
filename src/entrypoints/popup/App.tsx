// entrypoints/popup/App.tsx
import { useEffect, useState } from 'react';
import { type ErrorCategory, CATEGORY_LABELS } from '../../../utils/types';
import type { RecentErrorItem } from '../background';

const DEFAULT_STATS: Record<ErrorCategory, number> = {
  SYNTAX_TYPE: 0,
  POINTER_MEMORY: 0,
  STL_CONTAINER: 0,
  SCOPE_RETURN: 0,
};

const CATEGORY_META: Record<
  ErrorCategory,
  { dotColor: string; barColor: string; hint: string }
> = {
  SYNTAX_TYPE: {
    dotColor: 'bg-sky-400',
    barColor: 'bg-sky-400',
    hint: 'Constructor args, types & undeclared identifiers',
  },
  POINTER_MEMORY: {
    dotColor: 'bg-rose-500',
    barColor: 'bg-rose-500',
    hint: 'Nullptr dereference, cycles & AddressSanitizer',
  },
  STL_CONTAINER: {
    dotColor: 'bg-amber-400',
    barColor: 'bg-amber-400',
    hint: 'Vector bounds, iterators & custom comparators',
  },
  SCOPE_RETURN: {
    dotColor: 'bg-emerald-400',
    barColor: 'bg-emerald-400',
    hint: 'Missing return paths & loop variable shadowing',
  },
};

export default function App() {
  const [enabled, setEnabled] = useState(true);
  const [stats, setStats] = useState<Record<ErrorCategory, number>>(DEFAULT_STATS);
  const [recent, setRecent] = useState<RecentErrorItem[]>([]);

  useEffect(() => {
    chrome.storage.local.get(
      ['codecheckEnabled', 'categoryStats', 'recentErrors'],
      (res) => {
        if (typeof res.codecheckEnabled === 'boolean') {
          setEnabled(res.codecheckEnabled);
        }
        if (res.categoryStats) {
          setStats({ ...DEFAULT_STATS, ...res.categoryStats });
        }
        if (res.recentErrors) {
          setRecent(res.recentErrors as RecentErrorItem[]);
        }
      }
    );

    const onStorage = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.codecheckEnabled) {
        setEnabled(Boolean(changes.codecheckEnabled.newValue));
      }
      if (changes.categoryStats?.newValue) {
        setStats({ ...DEFAULT_STATS, ...changes.categoryStats.newValue });
      }
      if (changes.recentErrors?.newValue) {
        setRecent(changes.recentErrors.newValue as RecentErrorItem[]);
      }
    };

    chrome.storage.onChanged.addListener(onStorage);
    return () => chrome.storage.onChanged.removeListener(onStorage);
  }, []);

  const toggleEnabled = () => {
    const next = !enabled;
    setEnabled(next);
    chrome.storage.local.set({ codecheckEnabled: next });
  };

  const resetStats = () => {
    chrome.storage.local.set({
      categoryStats: DEFAULT_STATS,
      recentErrors: [],
    });
  };

  const totalErrors = Object.values(stats).reduce((a, b) => a + b, 0);

  // Identify the user's #1 weak spot
  const topCategory = (Object.keys(stats) as ErrorCategory[]).reduce((a, b) =>
    stats[a] >= stats[b] ? a : b
  );

  return (
    <div className="w-[360px] bg-[#141517] p-3 font-sans text-zinc-100 select-none">
      {/* Top Header Bar */}
      <div className="flex items-center justify-between px-1 pb-2.5">
        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${enabled
              ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
              : 'bg-zinc-500'
              }`}
          />
          <span className="text-sm font-semibold tracking-tight text-zinc-100">
            CodeCheck C++
          </span>
        </div>

        <button
          onClick={toggleEnabled}
          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium cursor-pointer transition ${enabled
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
            : 'border-white/10 bg-[#1c1d21] text-zinc-400 hover:text-zinc-200'
            }`}
        >
          {enabled ? 'Active on LeetCode' : 'Paused'}
        </button>
      </div>

      {/* Main Recessed Box (Matches Screenshot Aesthetic) */}
      <div className="rounded-lg border border-white/[0.07] bg-[#1c1d21] p-3.5">
        {/* Top Quote-Style Summary */}
        <div className="flex gap-3">
          <div className="w-[2px] shrink-0 rounded-full bg-zinc-200" />
          <div>
            <p className="text-xs leading-relaxed text-zinc-200">
              {totalErrors === 0 ? (
                'No C++ errors recorded yet. Highlight code or trace a runtime crash on LeetCode to track your weak spots.'
              ) : (
                <>
                  Your #1 focus area is{' '}
                  <span className="font-semibold text-white">
                    {CATEGORY_LABELS[topCategory]}
                  </span>{' '}
                  ({Math.round((stats[topCategory] / totalErrors) * 100)}% of{' '}
                  {totalErrors} diagnoses).
                </>
              )}
            </p>
          </div>
        </div>

        {/* 4 Category Progress Rows */}
        <div className="mt-4 space-y-3">
          {(Object.keys(CATEGORY_LABELS) as ErrorCategory[]).map((cat) => {
            const count = stats[cat] || 0;
            const pct = totalErrors > 0 ? Math.round((count / totalErrors) * 100) : 0;
            const meta = CATEGORY_META[cat];

            return (
              <div key={cat} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${meta.dotColor}`} />
                    <span className="font-medium text-zinc-200">
                      {CATEGORY_LABELS[cat]}
                    </span>
                  </div>
                  <span className="font-mono text-[11px] text-zinc-400">
                    {count} ({pct}%)
                  </span>
                </div>

                {/* Progress Bar */}
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#121316]">
                  <div
                    style={{ width: `${pct}%` }}
                    className={`h-full rounded-full ${meta.barColor} transition-all duration-300`}
                  />
                </div>
                <p className="text-[10.5px] text-zinc-500">{meta.hint}</p>
              </div>
            );
          })}
        </div>

        {/* Recent Mistakes Mini-List */}
        {recent.length > 0 && (
          <div className="mt-4 border-t border-white/[0.06] pt-3">
            <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400">
              Recent Diagnoses
            </div>
            <div className="space-y-1.5 max-h-28 overflow-y-auto pr-1">
              {recent.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start justify-between gap-2 rounded border border-white/[0.05] bg-[#141517] px-2.5 py-1.5 text-[11px]"
                >
                  <span className="line-clamp-1 text-zinc-300">{item.summary}</span>
                  <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                    L{item.line}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Footer Bar */}
      <div className="mt-2.5 flex items-center justify-between px-1 pt-0.5">
        <span className="text-[11px] text-zinc-400">
          Total Tracked: <b className="text-zinc-200">{totalErrors}</b>
        </span>

        <button
          onClick={resetStats}
          className="rounded-md border border-white/15 bg-[#1c1d21] hover:bg-[#25262b] px-2.5 py-1 text-[11px] font-medium text-zinc-200 cursor-pointer"
        >
          Reset Stats
        </button>
      </div>
    </div>
  );
}