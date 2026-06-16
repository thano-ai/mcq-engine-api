import { McqQuestion } from "../types/mcq";
import { parseWithRegex } from "./regexParser";

const DEFAULT_MODELS = [
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash",
];

const MIN_REQUEST_GAP_MS = 4_000;
const MAX_RETRIES_PER_MODEL = 3;

let lastRequestAt = 0;

const EXTRACT_PROMPT = `You are an assistant that extracts multiple-choice questions (MCQs) from text.

Rules:
1. Identify questions and their options (A, B, C, D, E).
2. If answers are marked by formatting (bold, asterisk, underline, parentheses), detect the correct option.
3. If an answer key exists at the bottom (e.g., "1-A, 2-C"), map those to questions.
4. If answers are completely missing, solve the questions yourself and provide the best answer.
5. Return ONLY a valid JSON array with this exact structure:
[
  {
    "id": 1,
    "question": "Question text here",
    "options": ["A) Option one", "B) Option two", "C) Option three"],
    "correct_answer": "B",
    "explanation": "Brief explanation of why B is correct"
  }
]

Do not include markdown, code fences, or any text outside the JSON array.`;

const SOLVE_PROMPT = `You are an expert that solves multiple-choice questions.

You will receive a JSON array of questions that have NO stated answer. For each one:
1. Read the question and all options carefully.
2. Pick the single best correct option letter (A, B, C, D, or E).
3. Give a brief explanation.

Return ONLY a JSON array using the same id values provided:
[
  { "id": 3, "correct_answer": "D", "explanation": "CMD specifies the default container command in a Dockerfile." }
]

Do not include markdown, code fences, or any text outside the JSON array.`;

export class GeminiRateLimitError extends Error {
  retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = "GeminiRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function getModels(): string[] {
  const preferred = process.env.GEMINI_MODEL?.trim();
  if (preferred) {
    return [preferred, ...DEFAULT_MODELS.filter((m) => m !== preferred)];
  }
  return DEFAULT_MODELS;
}

function getApiKey(): string | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key === "your_gemini_api_key_here") return null;
  return key;
}

function requireApiKey(): string {
  const key = getApiKey();
  if (!key) {
    throw new Error(
      "This file needs AI to detect answers. Add GEMINI_API_KEY to back/.env (free at https://aistudio.google.com/apikey), or use a file with an answer key."
    );
  }
  return key;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttle(): Promise<void> {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < MIN_REQUEST_GAP_MS) {
    await sleep(MIN_REQUEST_GAP_MS - elapsed);
  }
  lastRequestAt = Date.now();
}

function parseRetryDelaySeconds(errorBody: string): number {
  try {
    const json = JSON.parse(errorBody) as {
      error?: { message?: string; details?: Array<Record<string, unknown>> };
    };

    for (const detail of json.error?.details ?? []) {
      if (String(detail["@type"] ?? "").includes("RetryInfo") && detail.retryDelay) {
        const match = String(detail.retryDelay).match(/([\d.]+)s?/);
        if (match) return Math.ceil(parseFloat(match[1]));
      }
    }

    const msg = json.error?.message ?? "";
    const retryMatch = msg.match(/retry in ([\d.]+)s/i);
    if (retryMatch) return Math.ceil(parseFloat(retryMatch[1]));
  } catch {
    // use default below
  }
  return 60;
}

function rateLimitMessage(retryAfterSeconds: number): string {
  return (
    `AI rate limit reached — please wait about ${retryAfterSeconds} seconds and try again. ` +
    `To avoid AI calls, add "Answer: X" after each question. ` +
    `Check quota at https://aistudio.google.com/apikey`
  );
}

interface AiAnswer {
  id: number;
  correct_answer: string;
  explanation?: string;
}

function extractJsonArray<T>(text: string): T[] {
  const cleaned = text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  const arrayStart = cleaned.indexOf("[");
  const arrayEnd = cleaned.lastIndexOf("]");
  if (arrayStart === -1 || arrayEnd === -1) {
    throw new Error("AI response did not contain a JSON array");
  }

  const parsed = JSON.parse(cleaned.slice(arrayStart, arrayEnd + 1));
  if (!Array.isArray(parsed)) {
    throw new Error("AI response was not a JSON array");
  }
  return parsed;
}

function toMcqQuestions(items: unknown[]): McqQuestion[] {
  return items.map((item, index) => {
    const row = item as Record<string, unknown>;
    return {
      id: (row.id as number) ?? index + 1,
      question: String(row.question ?? "").trim(),
      options: Array.isArray(row.options)
        ? row.options.map((o) => String(o).trim())
        : [],
      correct_answer: String(row.correct_answer ?? "")
        .trim()
        .toUpperCase()
        .charAt(0),
      explanation: row.explanation ? String(row.explanation).trim() : undefined,
    };
  });
}

function toAiAnswers(items: unknown[]): AiAnswer[] {
  return items.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      id: Number(row.id),
      correct_answer: String(row.correct_answer ?? "")
        .trim()
        .toUpperCase()
        .charAt(0),
      explanation: row.explanation ? String(row.explanation).trim() : undefined,
    };
  });
}

async function callGemini(
  systemPrompt: string,
  userText: string,
  maxOutputTokens = 2048
): Promise<string> {
  const apiKey = requireApiKey();
  let lastRateLimit: GeminiRateLimitError | null = null;

  for (const model of getModels()) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    for (let attempt = 0; attempt < MAX_RETRIES_PER_MODEL; attempt++) {
      await throttle();

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(90_000),
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ parts: [{ text: userText }] }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens,
            },
          }),
        });

        const body = await response.text();

        if (response.status === 429) {
          const retryAfter = parseRetryDelaySeconds(body);
          lastRateLimit = new GeminiRateLimitError(
            rateLimitMessage(retryAfter),
            retryAfter
          );
          if (attempt < MAX_RETRIES_PER_MODEL - 1) {
            await sleep(retryAfter * 1000);
            continue;
          }
          break;
        }

        if (response.status === 404) {
          break;
        }

        if (!response.ok) {
          throw new Error(`Gemini API error (${response.status}): ${body}`);
        }

        const data = JSON.parse(body) as {
          candidates?: Array<{
            content?: { parts?: Array<{ text?: string }> };
          }>;
        };

        const parts = data?.candidates?.[0]?.content?.parts ?? [];
        const text = parts[0]?.text ?? parts.map((p) => p.text ?? "").join("");

        if (!text) {
          throw new Error(`Gemini ${model} returned an empty response`);
        }

        return text;
      } catch (error) {
        if (error instanceof GeminiRateLimitError) {
          lastRateLimit = error;
          break;
        }
        if (attempt === MAX_RETRIES_PER_MODEL - 1) {
          throw error;
        }
      }
    }
  }

  if (lastRateLimit) throw lastRateLimit;
  throw new Error("All Gemini models are unavailable. Try again later or add Answer: lines to your questions.");
}

export async function normalizeWithGemini(rawText: string): Promise<McqQuestion[]> {
  const text = await callGemini(
    EXTRACT_PROMPT,
    `Extract and structure all MCQs from the following text:\n\n${rawText.slice(0, 100000)}`,
    8192
  );

  const questions = toMcqQuestions(extractJsonArray(text));
  return questions.filter((q) => q.question && q.options.length >= 2 && q.correct_answer);
}

async function solveBatch(unanswered: McqQuestion[]): Promise<Map<number, AiAnswer>> {
  const payload = unanswered.map((q) => ({
    id: q.id,
    question: q.question,
    options: q.options,
  }));

  const text = await callGemini(
    SOLVE_PROMPT,
    `Solve these questions:\n${JSON.stringify(payload)}`,
    Math.min(512, 128 * unanswered.length + 64)
  );

  const answers = toAiAnswers(extractJsonArray(text));
  const map = new Map<number, AiAnswer>();

  for (const answer of answers) {
    if (answer.id && answer.correct_answer) {
      map.set(answer.id, answer);
    }
  }

  return map;
}

export async function solveUnansweredWithGemini(
  unanswered: McqQuestion[]
): Promise<Map<number, AiAnswer>> {
  if (unanswered.length === 0) return new Map();
  return solveBatch(unanswered);
}

function applyAiAnswers(
  questions: McqQuestion[],
  aiAnswers: Map<number, AiAnswer>
): McqQuestion[] {
  return questions.map((q) => {
    if (q.correct_answer) return q;
    const solved = aiAnswers.get(q.id);
    if (!solved?.correct_answer) return q;
    return {
      ...q,
      correct_answer: solved.correct_answer,
      explanation: solved.explanation,
    };
  });
}

function finalizeQuestions(questions: McqQuestion[]): McqQuestion[] {
  return questions.filter((q) => q.question && q.options.length >= 2 && q.correct_answer);
}

function missingIds(questions: McqQuestion[]): number[] {
  return questions.filter((q) => !q.correct_answer).map((q) => q.id);
}

async function fillMissingAnswers(questions: McqQuestion[]): Promise<McqQuestion[]> {
  const unanswered = questions.filter((q) => !q.correct_answer);
  if (unanswered.length === 0) return questions;

  const solved = await solveUnansweredWithGemini(unanswered);
  return applyAiAnswers(questions, solved);
}

export async function parseMcqs(rawText: string): Promise<{
  questions: McqQuestion[];
  method: "regex" | "gemini" | "regex+gemini";
}> {
  const regexQuestions = parseWithRegex(rawText);
  const unanswered = regexQuestions.filter((q) => !q.correct_answer);

  if (regexQuestions.length > 0 && unanswered.length === 0) {
    return { questions: regexQuestions, method: "regex" };
  }

  if (!getApiKey()) {
    if (unanswered.length > 0) {
      throw new Error(
        `${unanswered.length} question(s) have no answer (questions: ${unanswered.map((q) => q.id).join(", ")}). Set GEMINI_API_KEY in back/.env so the API can solve them automatically.`
      );
    }
    throw new Error(
      "Could not parse MCQs from this file. Add GEMINI_API_KEY to back/.env for AI parsing (free at https://aistudio.google.com/apikey)."
    );
  }

  if (regexQuestions.length > 0) {
    const filled = await fillMissingAnswers(regexQuestions);
    const finalized = finalizeQuestions(filled);

    if (finalized.length < regexQuestions.length) {
      const stillMissing = missingIds(filled);
      throw new Error(
        `Could not determine answers for question(s): ${stillMissing.join(", ")}. Add "Answer: X" lines or wait for AI quota to reset.`
      );
    }

    return {
      questions: finalized,
      method: unanswered.length > 0 ? "regex+gemini" : "regex",
    };
  }

  const aiQuestions = await normalizeWithGemini(rawText);
  return { questions: aiQuestions, method: "gemini" };
}
