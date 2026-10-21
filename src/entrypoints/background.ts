// entrypoints/background.ts
import type { HarvestedContext, ErrorCategory } from '../../utils/types';

export interface RecentErrorItem {
  id: string;
  category: ErrorCategory;
  summary: string;
  line: number;
  timestamp: number;
}

export default defineBackground(() => {
  console.log('[CodeCheck Background] Service worker initialized.');

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'DIAGNOSE_CPP') {
      const payload = message.payload as HarvestedContext;

      fetch('http://localhost:8787/diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then((res) => res.json())
        .then(async (result) => {
          // Automatically track the 4 error categories in local storage for the dashboard!
          if (result?.ok && result?.data?.category && !result?.data?.isValidSyntax) {
            const cat = result.data.category as ErrorCategory;
            const stored = await chrome.storage.local.get(['categoryStats']);
            const stats: Record<ErrorCategory, number> = (stored.categoryStats as Record<ErrorCategory, number>) || {
              SYNTAX_TYPE: 0,
              POINTER_MEMORY: 0,
              STL_CONTAINER: 0,
              SCOPE_RETURN: 0,
            };

            stats[cat] = (stats[cat] || 0) + 1;
            const recent: RecentErrorItem[] = (stored.recentErrors || []) as RecentErrorItem[];
            const summaryText =
              result.mode === 'MODE_B_RUNTIME'
                ? result.data.tldr
                : result.data.explanation;
            const lineNum =
              result.mode === 'MODE_B_RUNTIME'
                ? result.data.culpritLine || 1
                : payload.focusLines?.startLine || 1;

            const newEntry: RecentErrorItem = {
              id: `${Date.now()}`,
              category: cat,
              summary: summaryText,
              line: lineNum,
              timestamp: Date.now(),
            };

            const updatedRecent = [newEntry, ...recent].slice(0, 5);
            await chrome.storage.local.set({ categoryStats: stats, recentErrors: updatedRecent, });
          }

          sendResponse(result);
        })
        .catch((err) => {
          sendResponse({
            ok: false,
            error: `Cannot reach Hono server at localhost:8787 (${err.message})`,
          });
        });

      return true; // Keeps the message channel open for async fetch!
    }
  });
});