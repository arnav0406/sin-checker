// utils/cppHarvester.ts
import type { HarvestedContext, SelectionPayload, RunResultPayload } from './types';

// C++ keywords that should never be mistaken for a function name
const CPP_KEYWORDS = new Set([
    'if', 'else', 'while', 'for', 'switch', 'case', 'return', 'catch',
    'sizeof', 'alignof', 'decltype', 'typeid', 'static_cast', 'dynamic_cast',
    'const_cast', 'reinterpret_cast', 'Solution', 'ListNode', 'TreeNode', 'Node',
]);

/**
 * 1. Extracts top comment blocks that contain struct/class definitions
 *    (e.g., struct ListNode, struct TreeNode, class Node)
 */
export function extractStructComments(fullCode: string): string {
    const commentBlocks = fullCode.match(/\/\*[\s\S]*?\*\//g) || [];
    const relevantBlocks = commentBlocks.filter(
        (block) =>
            block.includes('struct ') ||
            block.includes('class ') ||
            block.includes('Definition for')
    );
    return relevantBlocks.join('\n\n').trim();
}

/**
 * 2. Strips comments (while preserving line count) so regex/brace matching
 *    never gets tricked by commented-out code
 */
function blankOutCommentsPreserveLines(code: string): string {
    return code
        .replace(/\/\*[\s\S]*?\*\//g, (match) =>
            match
                .split('\n')
                .map(() => '')
                .join('\n')
        )
        .replace(/\/\/.*$/gm, '');
}

/**
 * 3. Finds the primary LeetCode method name inside `class Solution`
 *    (or the method surrounding `targetLine`)
 */
export function detectTargetFunctionName(fullCode: string, targetLine?: number): string {
    const cleanCode = blankOutCommentsPreserveLines(fullCode);
    const lines = cleanCode.split('\n');

    // Regex matching C++ method signature inside Solution:
    // e.g., `ListNode* mergeTwoLists(ListNode* list1, ListNode* list2) {`
    // or `vector<vector<int>> threeSum(vector<int>& nums) {`
    const methodRegex =
        /^\s*(?:[\w:<>[\]*&,\s]+?)\s+([a-zA-Z_]\w*)\s*\(([^;{}]*)\)\s*(?:const\s*)?\{/;

    let detectedName = 'unknownFunction';

    for (let i = 0; i < lines.length; i++) {
        const lineNum = i + 1;
        // Check 2-line window in case return type or `{` wraps to next line
        const windowStr = (lines[i] + ' ' + (lines[i + 1] || '')).replace(/\s+/g, ' ');
        const match = windowStr.match(methodRegex);

        if (match) {
            const candidateName = match[1];
            if (candidateName && !CPP_KEYWORDS.has(candidateName)) {
                detectedName = candidateName;
                // If we don't have a specific targetLine, or if this method starts before/at targetLine, keep it
                if (!targetLine || lineNum <= targetLine) {
                    detectedName = candidateName;
                }
            }
        }
    }

    return detectedName;
}

/**
 * 4. Replaces the problem-specific function name with `targetFunction`
 *    and prefixes every code line with its exact Monaco line number
 */
export function buildNumberedAnonymizedCode(
    fullCode: string,
    originalFuncName: string,
    highlightRange?: { startLine: number; endLine: number }
): string {
    const rawLines = fullCode.split('\n');
    const wordBoundaryRegex =
        originalFuncName !== 'unknownFunction'
            ? new RegExp(`\\b${originalFuncName}\\b`, 'g')
            : null;

    const outputLines: string[] = [];
    let insideTopComment = false;

    for (let i = 0; i < rawLines.length; i++) {
        const lineNum = i + 1;
        let lineText = rawLines[i];

        // Skip the giant top `/* struct ListNode ... */` comment in the numbered code
        // (since we already extract it cleanly into `structDefinitions`),
        // BUT keep the exact Monaco line numbers intact!
        if (lineText?.trim().startsWith('/*')) insideTopComment = true;
        if (insideTopComment) {
            if (lineText?.includes('*/')) insideTopComment = false;
            continue;
        }

        // Anonymize the LeetCode problem function name
        if (wordBoundaryRegex) {
            lineText = lineText?.replace(wordBoundaryRegex, 'targetFunction');
        }

        const isHighlighted =
            highlightRange &&
            lineNum >= highlightRange.startLine &&
            lineNum <= highlightRange.endLine;

        const prefix = isHighlighted
            ? `>>> L${String(lineNum).padStart(2, ' ')} | `
            : `    L${String(lineNum).padStart(2, ' ')} | `;

        outputLines.push(`${prefix}${lineText}`);
    }

    return outputLines.join('\n');
}

/**
 * 5. Master Harvester for Mode A (Syntax / STL Selection or Squiggle)
 */
// Replace harvestModeAContext in utils/cppHarvester.ts with this:
export function harvestModeAContext(
    selection: SelectionPayload,
    lastCompileError?: string,
    lastRuntimeError?: string
): HarvestedContext {
    const structDefinitions = extractStructComments(selection.fullCode);
    const originalFunctionName = detectTargetFunctionName(
        selection.fullCode,
        selection.startLine
    );

    const numberedAnonymizedCode = buildNumberedAnonymizedCode(
        selection.fullCode,
        originalFunctionName,
        { startLine: selection.startLine, endLine: selection.endLine }
    );

    const anonymizedSnippet =
        originalFunctionName !== 'unknownFunction'
            ? selection.selectedText.replace(
                new RegExp(`\\b${originalFunctionName}\\b`, 'g'),
                'targetFunction'
            )
            : selection.selectedText;

    return {
        mode: 'MODE_A_SYNTAX',
        anonymizedFunctionName: 'targetFunction',
        originalFunctionName,
        structDefinitions,
        numberedAnonymizedCode,
        focusLines: {
            startLine: selection.startLine,
            endLine: selection.endLine,
            selectedSnippet: anonymizedSnippet,
        },
        diagnostics: {
            squiggleMessage: selection.markersOnSelectedLines[0]?.message,
            compileError: lastCompileError,
            runtimeError: lastRuntimeError,
        },
    };
}

/**
 * 6. Master Harvester for Mode B (Runtime / AddressSanitizer Crash)
 */
export function harvestModeBContext(runResult: RunResultPayload): HarvestedContext {
    const structDefinitions = extractStructComments(runResult.fullCode);
    const originalFunctionName = detectTargetFunctionName(runResult.fullCode);

    const numberedAnonymizedCode = buildNumberedAnonymizedCode(
        runResult.fullCode,
        originalFunctionName
    );

    // Also scrub the original function name from the AddressSanitizer stack trace!
    const cleanRuntimeError =
        runResult.runtimeError && originalFunctionName !== 'unknownFunction'
            ? runResult.runtimeError.replace(
                new RegExp(`\\b${originalFunctionName}\\b`, 'g'),
                'targetFunction'
            )
            : runResult.runtimeError;

    return {
        mode: 'MODE_B_RUNTIME',
        anonymizedFunctionName: 'targetFunction',
        originalFunctionName,
        structDefinitions,
        numberedAnonymizedCode,
        diagnostics: {
            runtimeError: cleanRuntimeError,
            lastTestcase: runResult.lastTestcase,
        },
    };
}
// Add to the bottom of utils/cppHarvester.ts

/**
 * Normalizes C++ code into a canonical token string so accidental spaces,
 * tabs, blank lines, or operator spacing never trigger a duplicate API call.
 * Example: "ListNode * temp =  new ListNode( sn , sns ) ;"
 *       -> "ListNode*temp=new ListNode(sn,sns);"
 */
export function normalizeCppForCache(code: string): string {
    return blankOutCommentsPreserveLines(code)
        // 1. Collapse all whitespace (spaces, tabs, newlines) into a single space
        .replace(/\s+/g, ' ')
        // 2. Remove spaces around C++ punctuation & operators where whitespace is insignificant
        .replace(/\s*(->|::|<<|>>|<=|>=|==|!=|&&|\|\||[=+\-*/%&|^<>!~?:;,()[\]{}])\s*/g, '$1')
        .trim();
}