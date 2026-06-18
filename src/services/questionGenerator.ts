import { generateWithGemini } from "./geminiService";
import { QuizQuestion } from "../types/mcq";

export const OPEN_COMMAND_WORDS = [
  "apply",
  "develop",
  "justify",
  "enhance",
  "analyze",
  "evaluate",
] as const;

export type OpenCommandWord = (typeof OPEN_COMMAND_WORDS)[number];

function buildGeneratePrompt(
  count: number,
  includeMcq: boolean,
  openTypes: OpenCommandWord[]
): string {
  const typeLines: string[] = [];

  if (includeMcq) {
    typeLines.push(
      `- MCQ (type: "mcq"): standard multiple choice with 4 options A–D, command_word "recall", cognitive_level "understand" or "apply"`
    );
  }

  for (const word of openTypes) {
    const level =
      word === "apply" || word === "enhance"
        ? "apply"
        : word === "develop" || word === "analyze"
          ? "analyze"
          : "evaluate";
    typeLines.push(
      `- Open-ended (type: "open"): start the question with the command word "${word.charAt(0).toUpperCase() + word.slice(1)}" (e.g. "${word.charAt(0).toUpperCase() + word.slice(1)} how…"), command_word "${word}", cognitive_level "${level}". Provide model_answer (ideal response, 2–5 sentences) and explanation (grading rubric hint). No options array.`
    );
  }

  return `You are an expert educator that creates assessment questions FROM source material (not extracting existing questions).

Rules:
1. Use ONLY facts and concepts present in the provided content. Do not invent unrelated topics.
2. Create exactly ${count} questions, mixing these types evenly:
${typeLines.join("\n")}
3. Vary difficulty and cover different sections of the content.
4. MCQ: include options as ["A) …", "B) …", "C) …", "D) …"] and correct_answer as a single letter.
5. Open: options must be [], correct_answer must be "", model_answer required.
6. Return ONLY a valid JSON array:
[
  {
    "id": 1,
    "type": "mcq",
    "question": "…",
    "command_word": "recall",
    "cognitive_level": "understand",
    "options": ["A) …", "B) …", "C) …", "D) …"],
    "correct_answer": "B",
    "explanation": "…"
  },
  {
    "id": 2,
    "type": "open",
    "question": "Justify why …",
    "command_word": "justify",
    "cognitive_level": "evaluate",
    "options": [],
    "correct_answer": "",
    "model_answer": "…",
    "explanation": "…"
  }
]

No markdown or text outside the JSON array.`;
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

function normalizeGenerated(items: unknown[]): QuizQuestion[] {
  return items
    .map((item, index) => {
      const row = item as Record<string, unknown>;
      const type = row.type === "open" ? "open" : "mcq";
      const options = Array.isArray(row.options)
        ? row.options.map((o) => String(o).trim())
        : [];

      const correctAnswer =
        type === "mcq"
          ? String(row.correct_answer ?? "")
              .trim()
              .toUpperCase()
              .charAt(0)
          : "";

      return {
        id: (row.id as number) ?? index + 1,
        type,
        question: String(row.question ?? "").trim(),
        command_word: String(row.command_word ?? (type === "mcq" ? "recall" : "apply")).toLowerCase(),
        cognitive_level: String(row.cognitive_level ?? "understand").toLowerCase(),
        options: type === "mcq" ? options : [],
        correct_answer: correctAnswer,
        model_answer: row.model_answer ? String(row.model_answer).trim() : undefined,
        explanation: row.explanation ? String(row.explanation).trim() : undefined,
      } satisfies QuizQuestion;
    })
    .filter((q) => {
      if (!q.question) return false;
      if (q.type === "mcq") return q.options.length >= 2 && q.correct_answer;
      return Boolean(q.model_answer);
    });
}

export async function generateQuestionsFromContent(
  rawText: string,
  count: number,
  includeMcq: boolean,
  openTypes: OpenCommandWord[]
): Promise<QuizQuestion[]> {
  if (!includeMcq && openTypes.length === 0) {
    throw new Error("Select at least one question type to generate");
  }

  if (rawText.trim().length < 200) {
    throw new Error(
      "Need more content to generate questions (at least ~200 characters). Add more notes or upload a longer document."
    );
  }

  const prompt = buildGeneratePrompt(count, includeMcq, openTypes);
  const text = await generateWithGemini(
    prompt,
    `Create ${count} questions from this study material:\n\n${rawText.slice(0, 80000)}`,
    Math.min(16384, 800 + count * 400)
  );

  const questions = normalizeGenerated(extractJsonArray(text));

  if (questions.length === 0) {
    throw new Error("AI could not generate valid questions from this content. Try richer source material.");
  }

  return questions.map((q, i) => ({ ...q, id: i + 1 }));
}
