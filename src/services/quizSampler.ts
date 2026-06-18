import { QuizQuestion } from "../types/mcq";

export function sampleQuestions(
  questions: QuizQuestion[],
  mode: "all" | "random",
  sampleSize?: number
): QuizQuestion[] {
  if (mode === "all" || !sampleSize || sampleSize >= questions.length) {
    return [...questions];
  }

  const shuffled = [...questions];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled.slice(0, sampleSize).map((q, index) => ({
    ...q,
    id: index + 1,
  }));
}
