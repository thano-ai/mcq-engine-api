import { generateWithGemini } from "./geminiService";
import { QuizQuestion } from "../types/mcq";

interface GradeResult {
  id: number;
  score: number;
  is_correct: boolean;
  feedback: string;
}

const GRADE_PROMPT = `You are an expert grader for short-answer exam questions.

You will receive a JSON array of student responses. For each item:
1. Compare the student response to the model answer and rubric.
2. Assign a score 0–100 based on accuracy, completeness, and use of concepts.
3. Set is_correct to true if score >= 70.
4. Give brief constructive feedback (1–2 sentences).

Return ONLY a JSON array:
[
  { "id": 1, "score": 85, "is_correct": true, "feedback": "…" }
]

No markdown outside the JSON.`;

function extractJsonArray<T>(text: string): T[] {
  const cleaned = text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("Grader returned invalid JSON");
  return JSON.parse(cleaned.slice(start, end + 1));
}

export async function gradeOpenAnswers(
  items: Array<{
    id: number;
    question: string;
    command_word: string;
    model_answer: string;
    explanation?: string;
    student_answer: string;
  }>
): Promise<Map<number, GradeResult>> {
  if (items.length === 0) return new Map();

  const payload = items.map((item) => ({
    id: item.id,
    question: item.question,
    command_word: item.command_word,
    model_answer: item.model_answer,
    rubric: item.explanation ?? "",
    student_answer: item.student_answer,
  }));

  const text = await generateWithGemini(
    GRADE_PROMPT,
    `Grade these responses:\n${JSON.stringify(payload)}`,
    Math.min(4096, 256 * items.length + 128)
  );

  const grades = extractJsonArray<GradeResult>(text);
  const map = new Map<number, GradeResult>();

  for (const grade of grades) {
    if (grade.id != null) {
      map.set(Number(grade.id), {
        id: Number(grade.id),
        score: Number(grade.score) || 0,
        is_correct: Boolean(grade.is_correct),
        feedback: String(grade.feedback ?? "").trim(),
      });
    }
  }

  return map;
}

export function fallbackGradeOpen(
  question: QuizQuestion,
  studentAnswer: string
): GradeResult {
  const normalized = studentAnswer.trim().toLowerCase();
  const model = (question.model_answer ?? "").trim().toLowerCase();
  const overlap =
    model.length > 0
      ? model.split(/\s+/).filter((w) => w.length > 4 && normalized.includes(w)).length /
        Math.max(model.split(/\s+/).length, 1)
      : 0;
  const isCorrect = overlap >= 0.25 && normalized.length >= 20;

  return {
    id: question.id,
    score: Math.round(overlap * 100),
    is_correct: isCorrect,
    feedback: isCorrect
      ? "Your answer covers key points from the model response."
      : "Compare your answer with the model response and rubric below.",
  };
}
