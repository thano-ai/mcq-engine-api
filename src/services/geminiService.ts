import { McqQuestion } from "../types/mcq";
import { parseWithRegex, needsAiNormalization } from "./regexParser";

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

const SYSTEM_PROMPT = `You are an assistant that extracts multiple-choice questions (MCQs) from text.

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

function extractJsonFromResponse(text: string): McqQuestion[] {
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

  return parsed.map((item, index) => ({
    id: item.id ?? index + 1,
    question: String(item.question ?? "").trim(),
    options: Array.isArray(item.options)
      ? item.options.map((o: string) => String(o).trim())
      : [],
    correct_answer: String(item.correct_answer ?? "")
      .trim()
      .toUpperCase()
      .charAt(0),
    explanation: item.explanation ? String(item.explanation).trim() : undefined,
  }));
}

export async function normalizeWithGemini(rawText: string): Promise<McqQuestion[]> {
  const apiKey = requireApiKey();

  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [
        {
          parts: [
            {
              text: `Extract and structure all MCQs from the following text:\n\n${rawText.slice(0, 100000)}`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 8192,
      },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorBody}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const text =
    parts[0]?.text ?? parts.map((p) => p.text ?? "").join("");

  if (!text) {
    throw new Error("Gemini returned an empty response");
  }

  const questions = extractJsonFromResponse(text);
  return questions.filter((q) => q.question && q.options.length >= 2 && q.correct_answer);
}

export async function parseMcqs(rawText: string): Promise<{
  questions: McqQuestion[];
  method: "regex" | "gemini" | "regex+gemini";
}> {
  const regexQuestions = parseWithRegex(rawText);
  const answeredRegex = regexQuestions.filter((q) => q.correct_answer);
  const needsAi = regexQuestions.length === 0 || needsAiNormalization(regexQuestions, rawText);

  if (!needsAi && answeredRegex.length > 0) {
    return { questions: answeredRegex, method: "regex" };
  }

  if (!getApiKey()) {
    if (answeredRegex.length > 0) {
      return { questions: answeredRegex, method: "regex" };
    }
    throw new Error(
      "Could not parse MCQs from this file. Add GEMINI_API_KEY to back/.env for AI parsing (free at https://aistudio.google.com/apikey), or paste text with numbered questions and Answer: lines."
    );
  }

  try {
    const aiQuestions = await normalizeWithGemini(rawText);
    if (aiQuestions.length > 0) {
      return {
        questions: aiQuestions,
        method: regexQuestions.length > 0 ? "regex+gemini" : "gemini",
      };
    }
  } catch (error) {
    if (answeredRegex.length > 0) {
      console.warn("Gemini normalization failed, falling back to regex results:", error);
      return { questions: answeredRegex, method: "regex" };
    }
    throw error;
  }

  if (answeredRegex.length > 0) {
    return { questions: answeredRegex, method: "regex" };
  }

  return { questions: regexQuestions, method: "regex" };
}
