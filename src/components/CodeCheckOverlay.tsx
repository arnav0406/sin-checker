// entrypoints/CodeCheckOverlay.tsx
import React, { useEffect, useRef, useState } from 'react';
import {
    type BridgeMessage,
    type SelectionPayload,
    type RunResultPayload,
    type HarvestedContext,
    type ModeAResponse,
    type ModeBResponse,
    CATEGORY_LABELS,
} from '../../utils/types';
import { harvestModeAContext, harvestModeBContext, normalizeCppForCache } from '../../utils/cppHarvester';

type CardState =
    | { mode: 'CLOSED' }
    | { mode: 'REDIRECT'; selectedLine: number; targetLine: number }
    | {
        mode: 'MODE_A_SYNTAX';
        selection: SelectionPayload;
        harvested: HarvestedContext;
        loading: boolean;
        aiData?: ModeAResponse;
        error?: string;
    }
    | {
        mode: 'MODE_B_RUNTIME';
        runResult: RunResultPayload;
        harvested: HarvestedContext;
        loading: boolean;
        aiData?: ModeBResponse;
        error?: string;
    }
    | { mode: 'LOGIC_ERROR'; statusMsg: string };

export default function CodeCheckOverlay() {
    const [enabled, setEnabled] = useState(true);

    // Add this inside CodeCheckOverlay() in entrypoints/CodeCheckOverlay.tsx
    // right below: const [enabled, setEnabled] = useState(true);

    useEffect(() => {
        // Load initial enabled state from chrome.storage.local
        chrome.storage.local.get(['codecheckEnabled'], (res) => {
            if (typeof res.codecheckEnabled === 'boolean') {
                setEnabled(res.codecheckEnabled);
            }
        });

        // Listen for changes if user toggles ON/OFF inside the Chrome Toolbar Popup
        const onStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
            if (changes.codecheckEnabled) {
                setEnabled(Boolean(changes.codecheckEnabled.newValue));
                if (!changes.codecheckEnabled.newValue) {
                    setCard({ mode: 'CLOSED' });
                }
            }
        };

        chrome.storage.onChanged.addListener(onStorageChange);
        return () => chrome.storage.onChanged.removeListener(onStorageChange);
    }, []);

    const [language, setLanguage] = useState<string>('cpp');

    const [userSelection, setUserSelection] = useState<SelectionPayload | null>(null);
    const [squiggleSelection, setSquiggleSelection] = useState<SelectionPayload | null>(null);
    // NEW: Runtime Crash Pill (So Mode B NEVER opens without user clicking first!)
    const [pendingRuntimeCrash, setPendingRuntimeCrash] = useState<RunResultPayload | null>(null);

    const [card, setCard] = useState<CardState>({ mode: 'CLOSED' });
    const [copied, setCopied] = useState(false);

    // NEW: Blurred fix state — forces learner to read explanation before clicking to unblur!
    const [isFixRevealed, setIsFixRevealed] = useState(false);

    // Use Refs for latest compiler/runtime errors so closures NEVER send undefined to AI!
    const lastCompileErrorRef = useRef<string | undefined>(undefined);
    const lastRuntimeErrorRef = useRef<string | undefined>(undefined);

    // NEW: Answer Cache so closing and re-clicking the pill is INSTANT (0ms) and doesn't re-analyze!
    const diagnosisCacheRef = useRef<Map<string, any>>(new Map());

    const [cardPos, setCardPos] = useState<{ x: number; y: number }>({
        x: Math.max(20, window.innerWidth - 460),
        y: 90,
    });
    const dragRef = useRef<{ isDragging: boolean; offsetX: number; offsetY: number }>({
        isDragging: false,
        offsetX: 0,
        offsetY: 0,
    });

    const activePill = userSelection || squiggleSelection;

    const jumpToLine = (lineNumber: number) => {
        window.postMessage(
            { source: 'CODECHECK_MAIN', type: 'JUMP_TO_LINE', payload: { lineNumber } },
            window.location.origin
        );
    };

    const startDrag = (e: React.MouseEvent<HTMLDivElement>) => {
        dragRef.current = {
            isDragging: true,
            offsetX: e.clientX - cardPos.x,
            offsetY: e.clientY - cardPos.y,
        };
    };

    useEffect(() => {
        const onMouseMove = (e: MouseEvent) => {
            if (!dragRef.current.isDragging) return;
            const nextX = Math.max(8, Math.min(window.innerWidth - 380, e.clientX - dragRef.current.offsetX));
            const nextY = Math.max(8, Math.min(window.innerHeight - 120, e.clientY - dragRef.current.offsetY));
            setCardPos({ x: nextX, y: nextY });
        };

        const onMouseUp = () => {
            dragRef.current.isDragging = false;
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        return () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
    }, []);

    const requestDiagnosis = (harvested: HarvestedContext, onResult: (res: any) => void) => {
        chrome.runtime.sendMessage({ type: 'DIAGNOSE_CPP', payload: harvested }, (response) => {
            if (chrome.runtime.lastError) {
                onResult({ ok: false, error: chrome.runtime.lastError.message });
                return;
            }
            onResult(response);
        });
    };

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (event.source !== window) return;
            const data = event.data as BridgeMessage;
            if (!data || data.source !== 'CODECHECK_MAIN') return;

            if (data.type === 'LANGUAGE_CHANGED') {
                setLanguage(data.payload.language);
                return;
            }

            if (data.type === 'SELECTION_CHANGED') {
                const payload = data.payload;
                if (!payload) {
                    setUserSelection(null);
                    return;
                }
                setLanguage(payload.language);
                if (payload.language !== 'cpp') return;
                setUserSelection(payload);
            }

            if (data.type === 'SQUIGGLES_DETECTED') {
                const payload = data.payload;
                if (!payload || payload.language !== 'cpp') {
                    setSquiggleSelection(null);
                    return;
                }
                setSquiggleSelection(payload);
            }

            if (data.type === 'RUN_RESULT') {
                const res = data.payload;
                setLanguage(res.language);
                if (res.language !== 'cpp') return;

                if (res.statusMsg === 'Compile Error') {
                    lastCompileErrorRef.current = res.compileError;
                    lastRuntimeErrorRef.current = undefined;
                    setPendingRuntimeCrash(null);
                    // FIXED: Do NOT auto-open popup! Wait for user to click the squiggle pill.
                } else if (res.statusMsg === 'Runtime Error') {
                    lastRuntimeErrorRef.current = res.runtimeError;
                    lastCompileErrorRef.current = undefined;
                    // FIXED: Do NOT auto-open Mode B card! Store crash so user can click the pill first.
                    setPendingRuntimeCrash(res);
                } else if (res.statusMsg === 'Wrong Answer' || res.statusMsg === 'Time Limit Exceeded') {
                    lastCompileErrorRef.current = undefined;
                    lastRuntimeErrorRef.current = undefined;
                    setPendingRuntimeCrash(null);
                    setCardPos({
                        x: Math.max(20, window.innerWidth - 390),
                        y: Math.max(80, window.innerHeight - 200),
                    });
                    setCard({ mode: 'LOGIC_ERROR', statusMsg: res.statusMsg });
                } else if (res.statusMsg === 'Accepted') {
                    lastCompileErrorRef.current = undefined;
                    lastRuntimeErrorRef.current = undefined;
                    setPendingRuntimeCrash(null);
                    setSquiggleSelection(null);
                    setCard({ mode: 'CLOSED' });
                }
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    // Handler when user clicks the in-editor Syntax / Squiggle Pill
    const handlePillClick = () => {
        if (!activePill) return;
        const sel = activePill;
        setUserSelection(null);
        setIsFixRevealed(false); // Always start with the fix blurred!

        setCardPos({
            x: Math.max(20, window.innerWidth - 460),
            y: Math.max(64, Math.min(window.innerHeight - 310, sel.cursorCoords.top)),
        });

        if (
            sel.triggerSource === 'USER_SELECTION' &&
            sel.markersOnSelectedLines.length === 0 &&
            sel.markersElsewhere.length > 0
        ) {
            setCard({
                mode: 'REDIRECT',
                selectedLine: sel.startLine,
                targetLine: sel.markersElsewhere[0]!.startLineNumber,
            });
            return;
        }

        // If this red squiggle came from a Runtime Error AND user didn't highlight custom text,
        // route to Mode B or pass full runtimeError + compileError!
        const harvested = harvestModeAContext(
            sel,
            lastCompileErrorRef.current,
            lastRuntimeErrorRef.current
        );

        // Cache Key: Full code + selected line + current compiler/runtime error
        // Inside handlePillClick() in entrypoints/CodeCheckOverlay.tsx:

        // Grab the full lines from fullCode (so partial mouse selection + extra spaces still match!)
        const allLines = sel.fullCode.split('\n');
        const fullTargetLines = allLines
            .slice(Math.max(0, sel.startLine - 1), sel.endLine)
            .join('\n');

        const canonicalTarget = normalizeCppForCache(fullTargetLines || sel.selectedText);
        const canonicalError = normalizeCppForCache(
            harvested.diagnostics.squiggleMessage ||
            lastCompileErrorRef.current ||
            lastRuntimeErrorRef.current ||
            ''
        );

        // Notice we do NOT include startLine/endLine or raw whitespace in the key!
        const cacheKey = `A:${canonicalTarget}:${canonicalError}`;

        const cachedData = diagnosisCacheRef.current.get(cacheKey);
        if (cachedData) {
            // INSTANT HIT: Restore previous answer without re-analyzing!
            setCard({
                mode: 'MODE_A_SYNTAX',
                selection: sel,
                harvested,
                loading: false,
                aiData: cachedData,
            });
            return;
        }

        setCard({ mode: 'MODE_A_SYNTAX', selection: sel, harvested, loading: true });

        requestDiagnosis(harvested, (resp) => {
            if (resp?.ok) {
                const rawData = resp.data as ModeAResponse;
                if (rawData.minimalFix && harvested.originalFunctionName !== 'unknownFunction') {
                    rawData.minimalFix = rawData.minimalFix.replace(
                        /\btargetFunction\b/g,
                        harvested.originalFunctionName
                    );
                }
                // Save in cache so closing & reopening pill is instant!
                diagnosisCacheRef.current.set(cacheKey, rawData);

                setCard({
                    mode: 'MODE_A_SYNTAX',
                    selection: sel,
                    harvested,
                    loading: false,
                    aiData: rawData,
                });
            } else {
                setCard({
                    mode: 'MODE_A_SYNTAX',
                    selection: sel,
                    harvested,
                    loading: false,
                    error: resp?.error || 'Failed to contact server.',
                });
            }
        });
    };

    // Handler when user clicks the "💥 Trace Runtime Crash" Pill
    const handleRuntimeCrashPillClick = () => {
        if (!pendingRuntimeCrash) return;
        const res = pendingRuntimeCrash;
        setIsFixRevealed(false);

        const harvested = harvestModeBContext(res);
        const canonicalFullCode = normalizeCppForCache(res.fullCode);
        const canonicalCrash = normalizeCppForCache(res.runtimeError || '');
        const cacheKey = `B:${canonicalFullCode}:${canonicalCrash}:${(res.lastTestcase || '').trim()}`;

        setCardPos({
            x: Math.max(20, window.innerWidth - 465),
            y: Math.max(80, window.innerHeight - 340),
        });

        const cachedData = diagnosisCacheRef.current.get(cacheKey);
        if (cachedData) {
            setCard({
                mode: 'MODE_B_RUNTIME',
                runResult: res,
                harvested,
                loading: false,
                aiData: cachedData,
            });
            return;
        }

        setCard({ mode: 'MODE_B_RUNTIME', runResult: res, harvested, loading: true });

        requestDiagnosis(harvested, (resp) => {
            if (resp?.ok) {
                const rawData = resp.data as ModeBResponse;
                diagnosisCacheRef.current.set(cacheKey, rawData);
                setCard({
                    mode: 'MODE_B_RUNTIME',
                    runResult: res,
                    harvested,
                    loading: false,
                    aiData: rawData,
                });
            } else {
                setCard({
                    mode: 'MODE_B_RUNTIME',
                    runResult: res,
                    harvested,
                    loading: false,
                    error: resp?.error || 'Failed to analyze crash.',
                });
            }
        });
    };

    const handleCopy = (code: string) => {
        navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    const isCpp = language === 'cpp';

    return (
        <div className="font-sans text-zinc-100 select-none">
            {/* 1. EXTENSION STATUS LIGHT PILL */}
            <button
                onClick={() => {
                    const nextState = !enabled;
                    setEnabled(nextState);
                    chrome.storage.local.set({ codecheckEnabled: nextState });
                    setCard({ mode: 'CLOSED' });
                }}
                title="Click to toggle CodeCheck C++ Assistant"
                className="fixed top-2.5 right-44 z-[99999] flex items-center gap-2 rounded-full border border-white/10 bg-[#1a1b1e]/95 px-3 py-1 text-[11px] font-medium text-zinc-300 shadow-md hover:border-white/20 cursor-pointer"
            >
                <span
                    className={`h-2 w-2 rounded-full ${!enabled
                        ? 'bg-zinc-500'
                        : isCpp
                            ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
                            : 'bg-amber-400'
                        }`}
                />
                <span>
                    {!enabled
                        ? 'CodeCheck OFF'
                        : isCpp
                            ? 'CodeCheck C++'
                            : `C++ Only (${language})`}
                </span>
            </button>

            {enabled && isCpp && (
                <>
                    {/* 2A. IN-EDITOR TRIGGER PILL (Selection or Red Squiggle) */}
                    {activePill && activePill.cursorCoords.visible && card.mode === 'CLOSED' && (
                        <button
                            onClick={handlePillClick}
                            style={{
                                top: activePill.cursorCoords.top,
                                left: activePill.cursorCoords.left,
                            }}
                            className="fixed z-[99999] flex items-center gap-2 rounded-lg border border-white/15 bg-[#141517] px-2.5 py-1 text-xs font-medium text-zinc-100 shadow-[0_8px_24px_rgba(0,0,0,0.65)] hover:bg-[#1c1d21] hover:border-white/25 cursor-pointer"
                        >
                            <span
                                className={`h-2 w-2 rounded-full ${activePill.triggerSource === 'AUTO_SQUIGGLE' ||
                                    activePill.markersOnSelectedLines.length > 0
                                    ? 'bg-rose-500 shadow-[0_0_6px_#f43f5e]'
                                    : 'bg-sky-400 shadow-[0_0_6px_#38bdf8]'
                                    }`}
                            />
                            <span>
                                {activePill.triggerSource === 'AUTO_SQUIGGLE' ||
                                    activePill.markersOnSelectedLines.length > 0
                                    ? `Explain Line ${activePill.startLine} Error`
                                    : `Check Line ${activePill.startLine} Syntax`}
                            </span>
                        </button>
                    )}

                    {/* 2B. RUNTIME CRASH TRIGGER PILL (Appears in bottom-right on Runtime Error; requires click!) */}
                    {pendingRuntimeCrash && card.mode === 'CLOSED' && (
                        <button
                            onClick={handleRuntimeCrashPillClick}
                            className="fixed bottom-6 right-6 z-[99999] flex items-center gap-2 rounded-lg border border-rose-500/40 bg-[#141517] px-3.5 py-2 text-xs font-medium text-zinc-100 shadow-[0_8px_24px_rgba(0,0,0,0.75)] hover:bg-[#1c1d21] hover:border-rose-500/70 cursor-pointer"
                        >
                            <span className="h-2 w-2 rounded-full bg-rose-500 shadow-[0_0_8px_#f43f5e]" />
                            <span>Trace Runtime Crash</span>
                        </button>
                    )}

                    {/* 3. REDIRECT CARD */}
                    {card.mode === 'REDIRECT' && (
                        <div
                            style={{ left: cardPos.x, top: cardPos.y }}
                            className="fixed z-[99999] w-[410px] rounded-xl border border-white/10 bg-[#141517] p-2.5 shadow-[0_20px_50px_rgba(0,0,0,0.85)]"
                        >
                            <div
                                onMouseDown={startDrag}
                                className="mb-2 flex cursor-grab active:cursor-grabbing items-center justify-between px-1.5 py-0.5 text-[10px] text-zinc-500 hover:text-zinc-300"
                            >
                                <span>⠿ Drag to move</span>
                                <button
                                    onClick={() => setCard({ mode: 'CLOSED' })}
                                    className="text-zinc-400 hover:text-white cursor-pointer"
                                >
                                    ✕
                                </button>
                            </div>

                            <div className="rounded-lg border border-white/[0.07] bg-[#1c1d21] p-3.5">
                                <div className="flex gap-3">
                                    <div className="w-[2px] shrink-0 rounded-full bg-amber-400" />
                                    <p className="text-[13px] leading-relaxed text-zinc-100">
                                        Line {card.selectedLine} has no compiler error, but the squiggly line on{' '}
                                        <span className="font-semibold text-amber-300">Line {card.targetLine}</span>{' '}
                                        contains an error. Wanna check that instead?
                                    </p>
                                </div>

                                <div className="mt-3.5 flex items-center">
                                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-[#141517] px-2.5 py-0.5 text-[11px] text-zinc-400">
                                        <span>🔗</span>
                                        <span>Line {card.selectedLine} → Line {card.targetLine}</span>
                                    </span>
                                </div>
                            </div>

                            <div className="mt-2.5 flex items-center justify-between px-1.5 pt-0.5">
                                <div className="flex items-center gap-2 text-xs text-zinc-400">
                                    <span>⚠️</span>
                                    <span>Redirect Notice</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setCard({ mode: 'CLOSED' })}
                                        className="rounded-md px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer"
                                    >
                                        Dismiss
                                    </button>
                                    <button
                                        onClick={() => {
                                            jumpToLine(card.targetLine);
                                            setCard({ mode: 'CLOSED' });
                                        }}
                                        className="rounded-md border border-white/15 bg-[#1c1d21] hover:bg-[#25262b] px-3 py-1 text-xs font-medium text-zinc-100 cursor-pointer"
                                    >
                                        Jump to Line {card.targetLine} ↗
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 4. MODE A: SYNTAX & STL CARD (With Click-to-Unblur Minimal Fix!) */}
                    {card.mode === 'MODE_A_SYNTAX' && (
                        <div
                            style={{ left: cardPos.x, top: cardPos.y }}
                            className="fixed z-[99999] w-[435px] rounded-xl border border-white/10 bg-[#141517] p-2.5 shadow-[0_20px_50px_rgba(0,0,0,0.85)]"
                        >
                            <div
                                onMouseDown={startDrag}
                                className="mb-2 flex cursor-grab active:cursor-grabbing items-center justify-between px-1.5 py-0.5 text-[10px] text-zinc-500 hover:text-zinc-300"
                            >
                                <span>⠿ Drag to move</span>
                                <button
                                    onClick={() => setCard({ mode: 'CLOSED' })}
                                    className="text-zinc-400 hover:text-white cursor-pointer"
                                >
                                    ✕
                                </button>
                            </div>

                            <div className="rounded-lg border border-white/[0.07] bg-[#1c1d21] p-3.5">
                                {card.loading ? (
                                    <div className="flex items-center gap-3 py-3 text-xs text-zinc-400">
                                        <span className="h-2 w-2 animate-ping rounded-full bg-sky-400" />
                                        <span>Diagnosing Line {card.selection.startLine}...</span>
                                    </div>
                                ) : card.error ? (
                                    <p className="text-xs text-rose-400">{card.error}</p>
                                ) : (
                                    <>
                                        {/* Clear, beginner-friendly explanation */}
                                        <div className="flex gap-3">
                                            <div
                                                className={`w-[2px] shrink-0 rounded-full ${card.aiData?.isValidSyntax ? 'bg-emerald-400' : 'bg-zinc-200'
                                                    }`}
                                            />
                                            <p className="text-[13px] leading-relaxed text-zinc-100">
                                                {card.aiData?.explanation}
                                            </p>
                                        </div>

                                        {/* Blurred Minimal Fix — User must click to reveal! */}
                                        {!card.aiData?.isValidSyntax && card.aiData?.minimalFix && (
                                            <div
                                                onClick={() => setIsFixRevealed(true)}
                                                title={isFixRevealed ? '' : 'Click to reveal minimal fix'}
                                                className={`relative mt-3 rounded-md border border-white/[0.06] bg-[#121316] px-3 py-2.5 overflow-x-auto ${!isFixRevealed ? 'cursor-pointer group' : ''
                                                    }`}
                                            >
                                                <pre
                                                    className={`font-mono text-[11.5px] text-emerald-400 transition-all duration-200 ${isFixRevealed
                                                        ? 'blur-none select-text'
                                                        : 'blur-[5px] select-none opacity-40'
                                                        }`}
                                                >
                                                    {card.aiData.minimalFix}
                                                </pre>

                                                {!isFixRevealed && (
                                                    <div className="absolute inset-0 flex items-center justify-center bg-[#121316]/40">
                                                        <span className="rounded-md border border-white/10 bg-[#1c1d21] px-2.5 py-1 text-[11px] font-medium text-zinc-200 shadow group-hover:border-white/25">
                                                            👁️ Click to reveal minimal fix
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </>
                                )}

                                <div className="mt-3.5 flex items-center justify-between">
                                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-[#141517] px-2.5 py-0.5 text-[11px] text-zinc-400">
                                        <span>🔗</span>
                                        <span>
                                            Line {card.selection.startLine} ·{' '}
                                            {card.selection.selectedText.slice(0, 26)}
                                            {card.selection.selectedText.length > 26 ? '…' : ''}
                                        </span>
                                    </span>
                                </div>
                            </div>

                            <div className="mt-2.5 flex items-center justify-between px-1.5 pt-0.5">
                                <div className="flex items-center gap-2 text-xs text-zinc-400">
                                    <span className="h-2 w-2 rounded-full bg-sky-400" />
                                    <span>
                                        {card.aiData?.category
                                            ? CATEGORY_LABELS[card.aiData.category]
                                            : 'Analyzing...'}
                                    </span>
                                </div>

                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setCard({ mode: 'CLOSED' })}
                                        className="rounded-md px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer"
                                    >
                                        Close
                                    </button>
                                    {/* Copy Fix button only unlocked AFTER user reveals the blurred fix! */}
                                    {!card.loading &&
                                        isFixRevealed &&
                                        !card.aiData?.isValidSyntax &&
                                        card.aiData?.minimalFix && (
                                            <button
                                                onClick={() => handleCopy(card.aiData!.minimalFix)}
                                                className="rounded-md border border-white/15 bg-[#1c1d21] hover:bg-[#25262b] px-3 py-1 text-xs font-medium text-zinc-100 cursor-pointer"
                                            >
                                                {copied ? 'Copied ✓' : 'Copy Fix'}
                                            </button>
                                        )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 5. MODE B: RUNTIME CRASH CARD (With Blurred Fix Option) */}
                    {card.mode === 'MODE_B_RUNTIME' && (
                        <div
                            style={{ left: cardPos.x, top: cardPos.y }}
                            className="fixed z-[99999] w-[445px] rounded-xl border border-white/10 bg-[#141517] p-2.5 shadow-[0_20px_50px_rgba(0,0,0,0.85)]"
                        >
                            <div
                                onMouseDown={startDrag}
                                className="mb-2 flex cursor-grab active:cursor-grabbing items-center justify-between px-1.5 py-0.5 text-[10px] text-zinc-500 hover:text-zinc-300"
                            >
                                <span>⠿ Drag to move</span>
                                <button
                                    onClick={() => setCard({ mode: 'CLOSED' })}
                                    className="text-zinc-400 hover:text-white cursor-pointer"
                                >
                                    ✕
                                </button>
                            </div>

                            <div className="rounded-lg border border-white/[0.07] bg-[#1c1d21] p-3.5">
                                {card.loading ? (
                                    <div className="flex items-center gap-3 py-4 text-xs text-zinc-400">
                                        <span className="h-2 w-2 animate-ping rounded-full bg-rose-500" />
                                        <span>Tracing C++ pointers & memory state...</span>
                                    </div>
                                ) : card.error ? (
                                    <p className="text-xs text-rose-400">{card.error}</p>
                                ) : (
                                    <>
                                        <div className="flex gap-3">
                                            <div className="w-[2px] shrink-0 rounded-full bg-rose-500" />
                                            <p className="text-[13px] leading-relaxed text-zinc-100">
                                                {card.aiData?.tldr}
                                            </p>
                                        </div>

                                        <pre className="mt-3 rounded-md border border-white/[0.06] bg-[#121316] px-3 py-2 font-mono text-[11px] text-zinc-300 leading-relaxed overflow-x-auto">
                                            {(card.aiData?.traceSteps || []).join('\n')}
                                        </pre>

                                        {/* Optional Blurred Minimal Fix for Culprit Line */}
                                        {card.aiData?.minimalFix && (
                                            <div
                                                onClick={() => setIsFixRevealed(true)}
                                                className={`relative mt-2.5 rounded-md border border-white/[0.06] bg-[#121316] px-3 py-2 overflow-x-auto ${!isFixRevealed ? 'cursor-pointer group' : ''
                                                    }`}
                                            >
                                                <pre
                                                    className={`font-mono text-[11.5px] text-emerald-400 transition-all duration-200 ${isFixRevealed
                                                        ? 'blur-none select-text'
                                                        : 'blur-[5px] select-none opacity-40'
                                                        }`}
                                                >
                                                    {card.aiData.minimalFix}
                                                </pre>

                                                {!isFixRevealed && (
                                                    <div className="absolute inset-0 flex items-center justify-center bg-[#121316]/40">
                                                        <span className="rounded-md border border-white/10 bg-[#1c1d21] px-2.5 py-1 text-[11px] font-medium text-zinc-200 shadow group-hover:border-white/25">
                                                            👁️ Click to reveal line fix
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </>
                                )}

                                <div className="mt-3 flex items-center justify-between">
                                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-[#141517] px-2.5 py-0.5 text-[11px] text-zinc-400">
                                        <span>💥</span>
                                        <span>
                                            Testcase: {card.harvested.diagnostics.lastTestcase || 'Default'}
                                        </span>
                                    </span>
                                </div>
                            </div>

                            <div className="mt-2.5 flex items-center justify-between px-1.5 pt-0.5">
                                <div className="flex items-center gap-2 text-xs text-zinc-400">
                                    <span className="h-2 w-2 rounded-full bg-rose-500" />
                                    <span>
                                        {card.aiData?.category
                                            ? CATEGORY_LABELS[card.aiData.category]
                                            : 'Tracing Crash...'}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setCard({ mode: 'CLOSED' })}
                                        className="rounded-md px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer"
                                    >
                                        Close
                                    </button>
                                    {!card.loading && card.aiData?.culpritLine && (
                                        <button
                                            onClick={() => jumpToLine(card.aiData!.culpritLine)}
                                            className="rounded-md border border-white/15 bg-[#1c1d21] hover:bg-[#25262b] px-3 py-1 text-xs font-medium text-zinc-100 cursor-pointer"
                                        >
                                            Culprit Line {card.aiData.culpritLine} ↗
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 6. LOGICAL ERROR NOTICE */}
                    {card.mode === 'LOGIC_ERROR' && (
                        <div
                            style={{ left: cardPos.x, top: cardPos.y }}
                            className="fixed z-[99999] w-[360px] rounded-xl border border-white/10 bg-[#141517] p-2.5 shadow-[0_20px_50px_rgba(0,0,0,0.85)]"
                        >
                            <div
                                onMouseDown={startDrag}
                                className="mb-2 flex cursor-grab active:cursor-grabbing items-center justify-between px-1.5 py-0.5 text-[10px] text-zinc-500 hover:text-zinc-300"
                            >
                                <span>⠿ Drag to move</span>
                                <button
                                    onClick={() => setCard({ mode: 'CLOSED' })}
                                    className="text-zinc-400 hover:text-white cursor-pointer"
                                >
                                    ✕
                                </button>
                            </div>

                            <div className="rounded-lg border border-white/[0.07] bg-[#1c1d21] p-3">
                                <div className="flex gap-3">
                                    <div className="w-[2px] shrink-0 rounded-full bg-amber-400" />
                                    <p className="text-[13px] text-zinc-100">
                                        There is a logical error in your code.
                                    </p>
                                </div>
                            </div>
                            <div className="mt-2 flex items-center justify-between px-1.5">
                                <span className="text-xs text-zinc-400">{card.statusMsg}</span>
                                <button
                                    onClick={() => setCard({ mode: 'CLOSED' })}
                                    className="rounded-md border border-white/15 bg-[#1c1d21] hover:bg-[#25262b] px-2.5 py-0.5 text-xs text-zinc-200 cursor-pointer"
                                >
                                    Got it
                                </button>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}