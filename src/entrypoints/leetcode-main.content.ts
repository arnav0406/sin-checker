// entrypoints/leetcode-main.content.ts
import type { SquiggleMarker, SelectionPayload, RunResultPayload } from '../../utils/types';

export default defineContentScript({
    matches: ['*://leetcode.com/problems/*'],
    world: 'MAIN',
    runAt: 'document_start',

    main() {
        if (window.location.pathname.includes('/contest/')) return;

        let activeEditor: any = null;
        let activeDecorations: string[] = [];
        const hookedEditors = new WeakSet<any>();

        // 1. Stealth Fetch Interceptor
        const originalFetch = window.fetch;
        const patchedFetch = async function (this: any, ...args: any[]) {
            const response = await originalFetch.apply(this, args as any);

            try {
                const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request)?.url || '';

                if (url.includes('/submissions/detail/') && url.includes('/check/')) {
                    const clone = response.clone();
                    clone.json().then((data) => {
                        if (data && data.state === 'SUCCESS' && data.status_msg) {
                            const model = activeEditor?.getModel?.();
                            const payload: RunResultPayload = {
                                statusMsg: data.status_msg,
                                compileError: data.full_compile_error || data.compile_error || undefined,
                                runtimeError: data.full_runtime_error || data.runtime_error || undefined,
                                lastTestcase: data.last_testcase || data.input_formatted || undefined,
                                fullCode: model ? model.getValue() : '',
                                language: model ? model.getLanguageId() : 'unknown',
                            };

                            window.postMessage(
                                { source: 'CODECHECK_MAIN', type: 'RUN_RESULT', payload },
                                window.location.origin
                            );
                        }
                    }).catch(() => { });
                }
            } catch { }

            return response;
        };

        Object.defineProperty(patchedFetch, 'toString', {
            value: () => originalFetch.toString(),
        });
        window.fetch = patchedFetch as typeof window.fetch;

        // 2. Listen for JUMP_TO_LINE
        window.addEventListener('message', (event) => {
            if (event.source !== window || !activeEditor) return;
            if (event.data?.source === 'CODECHECK_MAIN' && event.data?.type === 'JUMP_TO_LINE') {
                const monaco = (window as any).monaco;
                const line = event.data.payload.lineNumber;
                activeEditor.revealLineInCenter(line);
                activeEditor.setPosition({ lineNumber: line, column: 1 });
                activeEditor.focus();

                if (monaco) {
                    activeDecorations = activeEditor.deltaDecorations(activeDecorations, [
                        {
                            range: new monaco.Range(line, 1, line, 1),
                            options: {
                                isWholeLine: true,
                                inlineClassName: 'codecheck-culprit-line',
                            },
                        },
                    ]);
                    setTimeout(() => {
                        if (activeEditor) activeDecorations = activeEditor.deltaDecorations(activeDecorations, []);
                    }, 3000);
                }
            }
        });

        // Helper: Calculate exact screen coordinates & check if line is inside editor bounds
        const computeCoords = (
            editor: any,
            lineNumber: number,
            column: number,
            placement: 'ABOVE' | 'SAME_LINE'
        ): { top: number; left: number; visible: boolean } => {
            const editorDom = editor.getDomNode?.();
            const scrolledPos = editor.getScrolledVisiblePosition?.({ lineNumber, column });
            if (!editorDom || !scrolledPos) {
                return { top: 0, left: 0, visible: false };
            }

            const rect = editorDom.getBoundingClientRect();
            const rawTop = rect.top + scrolledPos.top;
            const rawLeft = rect.left + scrolledPos.left;

            // Check if the line is scrolled out of view or hidden under the bottom Test Result drawer
            const isVisible =
                scrolledPos.top >= 4 &&
                scrolledPos.top <= rect.height - 22 &&
                rawTop >= 45 &&
                rawTop <= window.innerHeight - 30;

            if (placement === 'ABOVE') {
                // User Selection: Appears ABOVE the selected line
                return {
                    top: Math.max(48, rawTop - 34),
                    left: Math.min(window.innerWidth - 220, Math.max(16, rawLeft)),
                    visible: isVisible,
                };
            } else {
                // Auto-Squiggle: Appears ON THE EXACT SAME LINE, right after the code!
                return {
                    top: rawTop - 2,
                    left: Math.min(window.innerWidth - 220, Math.max(16, rawLeft + 18)),
                    visible: isVisible,
                };
            }
        };

        const getAllErrors = (monaco: any, model: any): SquiggleMarker[] => {
            const rawMarkers = monaco.editor.getModelMarkers({ resource: model.uri }) || [];
            // LeetCode uses severity 8 (Error) or 4 (Warning/Red underline on runtime line)
            return rawMarkers
                .filter((m: any) => m.severity >= 4)
                .map((m: any) => ({
                    startLineNumber: m.startLineNumber,
                    endLineNumber: m.endLineNumber,
                    message: m.message,
                    severity: m.severity,
                }));
        };

        // Broadcast updated squiggle position (runs on marker change, scroll, or drawer resize!)
        const broadcastSquiggles = () => {
            const monaco = (window as any).monaco;
            if (!monaco || !activeEditor) return;
            const model = activeEditor.getModel?.();
            if (!model) return;

            const errors = getAllErrors(monaco, model);
            if (errors.length === 0) {
                window.postMessage(
                    { source: 'CODECHECK_MAIN', type: 'SQUIGGLES_DETECTED', payload: null },
                    window.location.origin
                );
                return;
            }

            const firstErr = errors[0];
            const lineNum = firstErr!.startLineNumber;
            const lineText = model.getLineContent(lineNum) || '';
            // Place at the end of the code on that line (same horizontal row!)
            const endOfCodeColumn = lineText.trimEnd().length + 1;

            const coords = computeCoords(activeEditor, lineNum, endOfCodeColumn, 'SAME_LINE');

            const payload: SelectionPayload = {
                language: model.getLanguageId(),
                fullCode: model.getValue(),
                selectedText: lineText.trim(),
                startLine: lineNum,
                endLine: firstErr!.endLineNumber,
                cursorCoords: coords,
                markersOnSelectedLines: [firstErr!],
                markersElsewhere: errors.slice(1),
                triggerSource: 'AUTO_SQUIGGLE',
            };

            window.postMessage(
                { source: 'CODECHECK_MAIN', type: 'SQUIGGLES_DETECTED', payload },
                window.location.origin
            );
        };

        // Broadcast updated user selection position (runs on selection or scroll!)
        const broadcastSelection = (editor: any) => {
            const monaco = (window as any).monaco;
            if (!monaco) return;
            const model = editor.getModel?.();
            const selection = editor.getSelection?.();
            if (!model || !selection) return;

            const isEmpty =
                selection.startLineNumber === selection.endLineNumber &&
                selection.startColumn === selection.endColumn;

            if (isEmpty) {
                window.postMessage(
                    { source: 'CODECHECK_MAIN', type: 'SELECTION_CHANGED', payload: null },
                    window.location.origin
                );
                return;
            }

            const selectedText = model.getValueInRange(selection);
            if (!selectedText.trim()) return;

            const startLine = selection.startLineNumber;
            const endLine = selection.endLineNumber;

            // User selection appears ABOVE the selected text
            const coords = computeCoords(editor, startLine, selection.startColumn, 'ABOVE');
            const allErrors = getAllErrors(monaco, model);

            const markersOnSelectedLines = allErrors.filter(
                (m) => m.startLineNumber <= endLine && m.endLineNumber >= startLine
            );
            const markersElsewhere = allErrors.filter(
                (m) => m.startLineNumber > endLine || m.endLineNumber < startLine
            );

            const payload: SelectionPayload = {
                language: model.getLanguageId(),
                fullCode: model.getValue(),
                selectedText,
                startLine,
                endLine,
                cursorCoords: coords,
                markersOnSelectedLines,
                markersElsewhere,
                triggerSource: 'USER_SELECTION',
            };

            window.postMessage(
                { source: 'CODECHECK_MAIN', type: 'SELECTION_CHANGED', payload },
                window.location.origin
            );
        };

        const attachEditor = (monaco: any, editor: any) => {
            if (hookedEditors.has(editor)) return;
            if (editor.getOption?.(monaco.editor.EditorOption.readOnly)) return;

            hookedEditors.add(editor);
            activeEditor = editor;

            let debounceTimer: number | null = null;

            const broadcastLanguage = () => {
                const model = editor.getModel?.();
                if (model) {
                    window.postMessage(
                        {
                            source: 'CODECHECK_MAIN',
                            type: 'LANGUAGE_CHANGED',
                            payload: { language: model.getLanguageId() },
                        },
                        window.location.origin
                    );
                }
            };

            broadcastLanguage();
            editor.onDidChangeModel?.(broadcastLanguage);
            editor.onDidChangeModelLanguage?.(broadcastLanguage);

            editor.onDidFocusEditorText?.(() => {
                activeEditor = editor;
            });

            // FIXED: On scroll or layout resize (when console drawer opens!), update positions instead of hiding!
            const syncPositions = () => {
                broadcastSquiggles();
                broadcastSelection(editor);
            };

            editor.onDidScrollChange?.(syncPositions);
            editor.onDidLayoutChange?.(syncPositions);
            window.addEventListener('resize', syncPositions);

            editor.onDidChangeCursorSelection(() => {
                activeEditor = editor;
                if (debounceTimer) window.clearTimeout(debounceTimer);

                const sel = editor.getSelection?.();
                if (
                    sel &&
                    sel.startLineNumber === sel.endLineNumber &&
                    sel.startColumn === sel.endColumn
                ) {
                    window.postMessage(
                        { source: 'CODECHECK_MAIN', type: 'SELECTION_CHANGED', payload: null },
                        window.location.origin
                    );
                    return;
                }

                debounceTimer = window.setTimeout(() => {
                    broadcastSelection(editor);
                }, 180);
            });
        };

        const pollTimer = setInterval(() => {
            const monaco = (window as any).monaco;
            if (!monaco || !monaco.editor) return;

            clearInterval(pollTimer);

            monaco.editor.getEditors().forEach((ed: any) => attachEditor(monaco, ed));
            monaco.editor.onDidCreateEditor((ed: any) => attachEditor(monaco, ed));

            // Re-run at 50ms, 250ms, and 500ms after markers appear so LeetCode's bottom drawer finishes animating!
            monaco.editor.onDidChangeMarkers(() => {
                broadcastSquiggles();
                setTimeout(broadcastSquiggles, 150);
                setTimeout(broadcastSquiggles, 400);
            });
        }, 400);
    },
});