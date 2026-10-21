// server/index.ts
import 'dotenv/config';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { GoogleGenAI, Type, type Schema } from '@google/genai';

const app = new Hono();
app.use('/*', cors());

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const modeASchema: Schema = {
    type: Type.OBJECT,
    properties: {
        category: {
            type: Type.STRING,
            enum: ['SYNTAX_TYPE', 'POINTER_MEMORY', 'STL_CONTAINER', 'SCOPE_RETURN'],
        },
        isValidSyntax: {
            type: Type.BOOLEAN,
            description: 'True ONLY if there is no syntax, type, or pointer issue on the selected line.',
        },
        explanation: {
            type: Type.STRING,
            description:
                'Clear, formal, beginner-friendly explanation (2-3 sentences max). Explain WHAT went wrong on this line and WHY C++ rejects it in simple terms without compiler jargon. Do NOT give away the full problem algorithm.',
        },
        minimalFix: {
            type: Type.STRING,
            description:
                'ONLY the 1-to-2 line corrected C++ code for the selected line(s). Never write the rest of the function.',
        },
    },
    required: ['category', 'isValidSyntax', 'explanation', 'minimalFix'],
};

const modeBSchema: Schema = {
    type: Type.OBJECT,
    properties: {
        category: {
            type: Type.STRING,
            enum: ['SYNTAX_TYPE', 'POINTER_MEMORY', 'STL_CONTAINER', 'SCOPE_RETURN'],
        },
        tldr: {
            type: Type.STRING,
            description:
                'Clear, formal, beginner-friendly explanation (1-2 sentences) of why the program crashed at runtime and what mistake in the pointer/index logic caused it.',
        },
        traceSteps: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description:
                'Exactly 3 short step-by-step lines showing how the variables changed on the failing testcase, formatted like: "L15: temp = head ──► Both point to first node"',
        },
        culpritLine: {
            type: Type.INTEGER,
            description: 'The exact integer line number (from the Lxx prefix) where the mistake happens.',
        },
        minimalFix: {
            type: Type.STRING,
            description:
                'A 1-to-2 line hint or corrected statement for the culprit line ONLY (will be blurred in UI until learner clicks to reveal).',
        },
    },
    required: ['category', 'tldr', 'traceSteps', 'culpritLine', 'minimalFix'],
};

app.post('/diagnose', async (c) => {
    const startTime = Date.now();
    try {
        const body = await c.req.json();
        const {
            mode,
            structDefinitions,
            numberedAnonymizedCode,
            focusLines,
            diagnostics,
        } = body;

        if (mode === 'MODE_A_SYNTAX') {
            const prompt = `
You are CodeCheck, a supportive, formal C++ mentor for beginners practicing on LeetCode.
The learner highlighted Line(s) ${focusLines?.startLine}-${focusLines?.endLine}.

STRUCT DEFINITIONS:
${structDefinitions || 'Standard C++ STL'}

USER'S NUMBERED C++ CODE (>>> marks the highlighted line):
${numberedAnonymizedCode}

HIGHLIGHTED LINE(S):
${focusLines?.selectedSnippet}

EXACT COMPILER / RUNTIME DIAGNOSTIC FROM LEETCODE:
- Squiggle Error: ${diagnostics?.squiggleMessage || 'None'}
- Full Compiler Error: ${diagnostics?.compileError || 'None'}
- Runtime Error (if any): ${diagnostics?.runtimeError || 'None'}

INSTRUCTIONS:
1. Read the Exact Compiler / Runtime Diagnostic carefully so your answer is 100% specific to their actual mistake.
2. Write "explanation" in clear, formal, beginner-friendly English (2-3 sentences). Avoid cryptic compiler jargon. Explain specifically why their C++ statement on Line ${focusLines?.startLine} fails and how to think about fixing it, WITHOUT solving the overall algorithm.
3. Put the corrected 1-2 line C++ syntax for Line ${focusLines?.startLine} in "minimalFix".
`;

            const response = await ai.models.generateContent({
                model: 'gemini-3.8-flash',
                contents: prompt,
                config: {
                    // CRITICAL SPEED FIX: Disable hidden thinking tokens (drops latency from 30s -> ~1s!)
                    thinkingConfig: { thinkingBudget: 0 },
                    responseMimeType: 'application/json',
                    responseSchema: modeASchema,
                    temperature: 0.1,
                },
            });

            console.log(`[CodeCheck Server] Mode A answered in ${Date.now() - startTime}ms`);
            const parsed = JSON.parse(response.text || '{}');
            return c.json({ ok: true, mode: 'MODE_A_SYNTAX', data: parsed });
        }

        if (mode === 'MODE_B_RUNTIME') {
            const prompt = `
You are CodeCheck, a supportive, formal C++ mentor for beginners.
The learner's code compiled, but crashed at runtime.

STRUCT DEFINITIONS:
${structDefinitions || 'Standard C++ STL'}

USER'S NUMBERED C++ CODE:
${numberedAnonymizedCode}

FAILING TESTCASE INPUT:
${diagnostics?.lastTestcase || 'Default testcase'}

EXACT RUNTIME / SANITIZER ERROR:
${diagnostics?.runtimeError || 'Runtime Error'}

INSTRUCTIONS:
1. Translate the crash into clear, formal, beginner-friendly language in "tldr" (e.g., instead of saying "heap-use-after-free", explain that a pointer was deleted or pointed back to itself in a loop, or head was null when head -> next was accessed).
2. In "traceSteps", show 3 simple steps (using exact Lxx line numbers) tracing what their variables actually did.
3. Set "culpritLine" to the exact line number where the bug occurred.
4. In "minimalFix", give ONLY the 1-2 line safe check or pointer fix for that specific culprit line (do NOT write the whole algorithm).
`;

            const response = await ai.models.generateContent({
                model: 'gemini-3.8-flash',
                contents: prompt,
                config: {
                    // CRITICAL SPEED FIX: Disable hidden thinking tokens (drops latency from 30s -> ~1s!)
                    thinkingConfig: { thinkingBudget: 0 },
                    responseMimeType: 'application/json',
                    responseSchema: modeBSchema,
                    temperature: 0.1,
                },
            });

            console.log(`[CodeCheck Server] Mode B answered in ${Date.now() - startTime}ms`);
            const parsed = JSON.parse(response.text || '{}');
            return c.json({ ok: true, mode: 'MODE_B_RUNTIME', data: parsed });
        }

        return c.json({ ok: false, error: 'Invalid mode' }, 400);
    } catch (err: any) {
        console.error('[CodeCheck Server Error]:', err);
        return c.json({ ok: false, error: err?.message || 'Internal Server Error' }, 500);
    }
});

const port = Number(process.env.PORT) || 8787;
console.log(`🚀 CodeCheck Fast Hono Server running on http://localhost:${port}`);
serve({ fetch: app.fetch, port });