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