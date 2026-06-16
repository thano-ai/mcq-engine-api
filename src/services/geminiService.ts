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

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key === "your_gemini_api_key_here") {
    throw new Error(
      "GEMINI_API_KEY is not configured. Set it in back/.env (get a free key at https://aistudio.google.com/apikey)"
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
  const apiKey = getApiKey();

  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

  if (regexQuestions.length > 0 && !needsAiNormalization(regexQuestions, rawText)) {
    return { questions: regexQuestions, method: "regex" };
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
    if (regexQuestions.length > 0) {
      console.warn("Gemini normalization failed, falling back to regex results:", error);
      return { questions: regexQuestions, method: "regex" };
    }
    throw error;
  }

  return { questions: regexQuestions, method: "regex" };
}
