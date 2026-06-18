export type QuestionType = "mcq" | "open";

export type ParseMethod = "regex" | "gemini" | "regex+gemini" | "generate";

export interface QuizQuestion {
  id: number;
  type: QuestionType;
  question: string;
  command_word: string;
  cognitive_level: string;
  options: string[];
  correct_answer: string;
  model_answer?: string;
  explanation?: string;
}

/** @deprecated use QuizQuestion — kept for regex parser output */
export interface McqQuestion {
  id: number;
  question: string;
  options: string[];
  correct_answer: string;
  explanation?: string;
}

export function mcqToQuizQuestion(q: McqQuestion, id?: number): QuizQuestion {
  return {
    id: id ?? q.id,
    type: "mcq",
    question: q.question,
    command_word: "recall",
    cognitive_level: "remember",
    options: q.options,
    correct_answer: q.correct_answer,
    explanation: q.explanation,
  };
}

export interface QuizSession {
  id: string;
  questions: QuizQuestion[];
  mode: "all" | "random";
  sampleSize?: number;
  inputMode: "extract" | "generate";
  createdAt: number;
}

export interface UserAnswer {
  questionId: number;
  selected: string;
  correct: boolean;
}

export interface QuizResult {
  total: number;
  correct: number;
  percentage: number;
  answers: Array<{
    questionId: number;
    question: string;
    type: QuestionType;
    commandWord: string;
    selected: string;
    correctAnswer: string;
    isCorrect: boolean;
    explanation?: string;
    aiFeedback?: string;
  }>;
}
