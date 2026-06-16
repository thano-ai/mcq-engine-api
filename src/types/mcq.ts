export interface McqQuestion {
  id: number;
  question: string;
  options: string[];
  correct_answer: string;
  explanation?: string;
}

export interface QuizSession {
  id: string;
  questions: McqQuestion[];
  mode: "all" | "random";
  sampleSize?: number;
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
    selected: string;
    correctAnswer: string;
    isCorrect: boolean;
    explanation?: string;
  }>;
}
