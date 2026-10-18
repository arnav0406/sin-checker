// entrypoints/CodeCheckOverlay.tsx
import React, { useEffect, useRef, useState } from 'react';
import type { BridgeMessage, SelectionPayload, RunResultPayload } from '../../utils/types';

type CardState =
    | { mode: 'CLOSED' }
    | { mode: 'REDIRECT'; selectedLine: number; targetLine: number }
    | { mode: 'MODE_A_SYNTAX'; selection: SelectionPayload; lastCompileError?: string }
    | { mode: 'MODE_B_RUNTIME'; runResult: RunResultPayload }
    | { mode: 'LOGIC_ERROR'; statusMsg: string };

export default function CodeCheckOverlay() {
    const [enabled, setEnabled] = useState(true);
    const [language, setLanguage] = useState<string>('cpp');

    const [userSelection, setUserSelection] = useState<SelectionPayload | null>(null);
    const [squiggleSelection, setSquiggleSelection] = useState<SelectionPayload | null>(null);

    const [card, setCard] = useState<CardState>({ mode: 'CLOSED' });
    const [lastCompileError, setLastCompileError] = useState<string | undefined>(undefined);
    const [copied, setCopied] = useState(false);

    // Draggable Card State (Defaults to top-right / bottom-right, user can drag anywhere!)
    const [cardPos, setCardPos] = useState<{ x: number; y: number }>({
        x: Math.max(20, window.innerWidth - 460),
        y: 90,
    });
    const dragRef = useRef<{ isDragging: boolean; offsetX: number; offsetY: number }>({
        isDragging: false,
        offsetX: 0,
        offsetY: 0,
    });

    // User selection overrides Auto-Squiggle popup
    const activePill = userSelection || squiggleSelection;

    const jumpToLine = (lineNumber: number) => {
        window.postMessage(
            { source: 'CODECHECK_MAIN', type: 'JUMP_TO_LINE', payload: { lineNumber } },
            window.location.origin
        );
    };

    // Drag handlers so the user can move the card anywhere on screen
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

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (event.source !== window) return;
            const data = event.data as BridgeMessage;
            if (!data || data.source !== 'CODECHECK_MAIN') return;

            if (data.type === 'LANGUAGE_CHANGED') {
                setLanguage(data.payload.language);
                return;
            }

            // 1. User Selection (Updated on select AND on scroll!)
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

            // 2. Auto-Squiggle (Updated on marker change, scroll, AND drawer resize!)
            if (data.type === 'SQUIGGLES_DETECTED') {
                const payload = data.payload;
                if (!payload || payload.language !== 'cpp') {
                    setSquiggleSelection(null);
                    return;
                }
                setSquiggleSelection(payload);
            }

            // 3. LeetCode "Run" Result
            if (data.type === 'RUN_RESULT') {
                const res = data.payload;
                setLanguage(res.language);
                if (res.language !== 'cpp') return;

                if (res.statusMsg === 'Compile Error') {
                    setLastCompileError(res.compileError);
                } else if (res.statusMsg === 'Runtime Error') {
                    setUserSelection(null);
                    setCardPos({
                        x: Math.max(20, window.innerWidth - 465),
                        y: Math.max(80, window.innerHeight - 310),
                    });
                    setCard({ mode: 'MODE_B_RUNTIME', runResult: res });
                } else if (res.statusMsg === 'Wrong Answer' || res.statusMsg === 'Time Limit Exceeded') {
                    setUserSelection(null);
                    setCardPos({
                        x: Math.max(20, window.innerWidth - 390),
                        y: Math.max(80, window.innerHeight - 200),
                    });
                    setCard({ mode: 'LOGIC_ERROR', statusMsg: res.statusMsg });
                } else if (res.statusMsg === 'Accepted') {
                    setLastCompileError(undefined);
                    setSquiggleSelection(null);
                    setCard({ mode: 'CLOSED' });
                }
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    const handlePillClick = () => {
        if (!activePill) return;
        const sel = activePill;
        setUserSelection(null);

        // Default initial position on the right side (user can drag anywhere from there!)
        setCardPos({
            x: Math.max(20, window.innerWidth - 460),
            y: Math.max(64, Math.min(window.innerHeight - 300, sel.cursorCoords.top)),
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

        setCard({ mode: 'MODE_A_SYNTAX', selection: sel, lastCompileError });
    };

    const handleCopy = (code: string) => {
        navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    const isCpp = language === 'cpp';

    return (
        <div className="font-sans text-zinc-100 select-none">
            {/* =====================================================================
          1. EXTENSION STATUS LIGHT PILL (Top Bar)
         ===================================================================== */}
            <button
                onClick={() => {
                    setEnabled((prev) => !prev);
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
                    {/* =================================================================
              2. TRIGGER PILL:
                 - User Selection -> Appears ABOVE the selected line
                 - Auto Squiggle  -> Appears ON THE SAME LINE right next to code
                 - Follows scroll in real time!
             ================================================================= */}
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

                    {/* =================================================================
              3. REDIRECT CARD (Draggable anywhere on screen)
             ================================================================= */}
                    {card.mode === 'REDIRECT' && (
                        <div
                            style={{ left: cardPos.x, top: cardPos.y }}
                            className="fixed z-[99999] w-[410px] rounded-xl border border-white/10 bg-[#141517] p-2.5 shadow-[0_20px_50px_rgba(0,0,0,0.85)]"
                        >
                            {/* Drag Handle Bar */}
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

                    {/* =================================================================
              4. MODE A: SYNTAX & STL CARD (Draggable anywhere on screen)
             ================================================================= */}
                    {card.mode === 'MODE_A_SYNTAX' && (
                        <div
                            style={{ left: cardPos.x, top: cardPos.y }}
                            className="fixed z-[99999] w-[430px] rounded-xl border border-white/10 bg-[#141517] p-2.5 shadow-[0_20px_50px_rgba(0,0,0,0.85)]"
                        >
                            {/* Drag Handle Bar */}
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
                                    <div className="w-[2px] shrink-0 rounded-full bg-zinc-200" />
                                    <p className="text-[13px] leading-relaxed text-zinc-100">
                                        {card.selection.markersOnSelectedLines[0]
                                            ? card.selection.markersOnSelectedLines[0].message
                                            : `Undeclared identifiers passed to ListNode constructor. Expects (int, ListNode*).`}
                                    </p>
                                </div>

                                <div className="mt-3 rounded-md border border-white/[0.06] bg-[#121316] px-3 py-2 font-mono text-[11.5px] text-emerald-400 overflow-x-auto">
                                    {`ListNode* temp = new ListNode(0, nullptr);`}
                                </div>

                                <div className="mt-3.5 flex items-center justify-between">
                                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-[#141517] px-2.5 py-0.5 text-[11px] text-zinc-400">
                                        <span>🔗</span>
                                        <span>
                                            Line {card.selection.startLine} ·{' '}
                                            {card.selection.selectedText.slice(0, 26)}
                                            {card.selection.selectedText.length > 26 ? '…' : ''}
                                        </span>
                                    </span>
                                    <span className="text-[10px] text-zinc-500">Mock Preview (Phase 3)</span>
                                </div>
                            </div>

                            <div className="mt-2.5 flex items-center justify-between px-1.5 pt-0.5">
                                <div className="flex items-center gap-2 text-xs text-zinc-400">
                                    <span className="h-2 w-2 rounded-full bg-sky-400" />
                                    <span>Syntax & Types</span>
                                </div>

                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setCard({ mode: 'CLOSED' })}
                                        className="rounded-md px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer"
                                    >
                                        Close
                                    </button>
                                    <button
                                        onClick={() => handleCopy('ListNode* temp = new ListNode(0, nullptr);')}
                                        className="rounded-md border border-white/15 bg-[#1c1d21] hover:bg-[#25262b] px-3 py-1 text-xs font-medium text-zinc-100 cursor-pointer"
                                    >
                                        {copied ? 'Copied ✓' : 'Copy Fix'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* =================================================================
              5. MODE B: RUNTIME CRASH CARD (Draggable anywhere on screen)
             ================================================================= */}
                    {card.mode === 'MODE_B_RUNTIME' && (
                        <div
                            style={{ left: cardPos.x, top: cardPos.y }}
                            className="fixed z-[99999] w-[440px] rounded-xl border border-white/10 bg-[#141517] p-2.5 shadow-[0_20px_50px_rgba(0,0,0,0.85)]"
                        >
                            {/* Drag Handle Bar */}
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
                                    <div className="w-[2px] shrink-0 rounded-full bg-rose-500" />
                                    <p className="text-[13px] leading-relaxed text-zinc-100">
                                        Infinite Pointer Cycle: Node next pointer points back to itself, crashing memory cleanup.
                                    </p>
                                </div>

                                <pre className="mt-3 rounded-md border border-white/[0.06] bg-[#121316] px-3 py-2 font-mono text-[11px] text-zinc-300 leading-relaxed overflow-x-auto">
                                    {`L15: temp = head       ──► Same node alias\nL16: head->next = null ──► Severed list\nL18: temp->next = head ──► 🔴 Self-loop cycle`}
                                </pre>

                                <div className="mt-3 flex items-center justify-between">
                                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-[#141517] px-2.5 py-0.5 text-[11px] text-zinc-400">
                                        <span>💥</span>
                                        <span>AddressSanitizer · heap-use-after-free</span>
                                    </span>
                                </div>
                            </div>

                            <div className="mt-2.5 flex items-center justify-between px-1.5 pt-0.5">
                                <div className="flex items-center gap-2 text-xs text-zinc-400">
                                    <span className="h-2 w-2 rounded-full bg-rose-500" />
                                    <span>Pointers & Memory</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setCard({ mode: 'CLOSED' })}
                                        className="rounded-md px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer"
                                    >
                                        Close
                                    </button>
                                    <button
                                        onClick={() => jumpToLine(18)}
                                        className="rounded-md border border-white/15 bg-[#1c1d21] hover:bg-[#25262b] px-3 py-1 text-xs font-medium text-zinc-100 cursor-pointer"
                                    >
                                        Culprit Line 18 ↗
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* =================================================================
              6. LOGICAL ERROR NOTICE (Draggable anywhere on screen)
             ================================================================= */}
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