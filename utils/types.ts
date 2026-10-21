// utils/types.ts

export interface SquiggleMarker {
    startLineNumber: number;
    endLineNumber: number;
    message: string;
    severity: number;
}

export interface SelectionPayload {
    language: string;
    fullCode: string;
    selectedText: string;
    startLine: number;
    endLine: number;
    cursorCoords: { top: number; left: number; visible: boolean };
    markersOnSelectedLines: SquiggleMarker[];
    markersElsewhere: SquiggleMarker[];
    triggerSource?: 'USER_SELECTION' | 'AUTO_SQUIGGLE';
}

export interface RunResultPayload {
    statusMsg: 'Compile Error' | 'Runtime Error' | 'Wrong Answer' | 'Time Limit Exceeded' | 'Accepted' | string;
    compileError?: string;
    runtimeError?: string;
    lastTestcase?: string;
    fullCode: string;
    language: string;
}

export type BridgeMessage =
    | { source: 'CODECHECK_MAIN'; type: 'SELECTION_CHANGED'; payload: SelectionPayload | null }
    | { source: 'CODECHECK_MAIN'; type: 'SQUIGGLES_DETECTED'; payload: SelectionPayload | null }
    | { source: 'CODECHECK_MAIN'; type: 'RUN_RESULT'; payload: RunResultPayload }
    | { source: 'CODECHECK_MAIN'; type: 'LANGUAGE_CHANGED'; payload: { language: string } }
    | { source: 'CODECHECK_MAIN'; type: 'JUMP_TO_LINE'; payload: { lineNumber: number } };

// utils/types.ts (Add this interface at the bottom of your existing file)

export type ErrorCategory =
    | 'SYNTAX_TYPE'
    | 'POINTER_MEMORY'
    | 'STL_CONTAINER'
    | 'SCOPE_RETURN';

export interface HarvestedContext {
    mode: 'MODE_A_SYNTAX' | 'MODE_B_RUNTIME';
    anonymizedFunctionName: string; // Always "targetFunction"
    originalFunctionName: string;   // Stored locally only (never sent to LLM!)
    structDefinitions: string;      // Extracted top comment /* struct ListNode ... */
    numberedAnonymizedCode: string; // Line-numbered C++ code with function name stripped
    focusLines?: {
        startLine: number;
        endLine: number;
        selectedSnippet: string;
    };
    diagnostics: {
        squiggleMessage?: string;
        compileError?: string;
        runtimeError?: string;
        lastTestcase?: string;
    };
}
// Add to bottom of utils/types.ts

export interface ModeAResponse {
    category: ErrorCategory;
    isValidSyntax: boolean;
    explanation: string;
    minimalFix: string;
}

export interface ModeBResponse {
    category: ErrorCategory;
    tldr: string;
    traceSteps: string[];
    culpritLine: number;
    minimalFix?: string;
}

export const CATEGORY_LABELS: Record<ErrorCategory, string> = {
    SYNTAX_TYPE: 'Syntax & Types',
    POINTER_MEMORY: 'Pointers & Memory',
    STL_CONTAINER: 'STL & Containers',
    SCOPE_RETURN: 'Scope & Return',
};