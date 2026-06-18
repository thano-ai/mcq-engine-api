import { Router, Request, Response } from "express";
import { getSession, deleteSession } from "../services/sessionStore";
import { QuizResult } from "../types/mcq";
import { fallbackGradeOpen, gradeOpenAnswers } from "../services/openAnswerGrader";
import { getApiKeyOptional } from "../services/geminiService";

const router = Router();

function mapQuestionForClient(q: {
  id: number;
  type: string;
  question: string;
  command_word: string;
  cognitive_level: string;
  options: string[];
}) {
  return {
    id: q.id,
    type: q.type,
    question: q.question,
    commandWord: q.command_word,
    cognitiveLevel: q.cognitive_level,
    options: q.type === "mcq" ? q.options : [],
  };
}

router.get("/:sessionId", (req: Request, res: Response) => {
  const sessionId = String(req.params.sessionId);
  const session = getSession(sessionId);

  if (!session) {
    res.status(404).json({ error: "Session not found or expired" });
    return;
  }

  res.json({
    sessionId: session.id,
    mode: session.mode,
    inputMode: session.inputMode,
    sampleSize: session.sampleSize,
    questionCount: session.questions.length,
    questions: session.questions.map(mapQuestionForClient),
  });
});

router.post("/:sessionId/submit", async (req: Request, res: Response) => {
  const sessionId = String(req.params.sessionId);
  const session = getSession(sessionId);

  if (!session) {
    res.status(404).json({ error: "Session not found or expired" });
    return;
  }

  const answers = req.body.answers as Array<{ questionId: number; selected: string }>;

  if (!Array.isArray(answers)) {
    res.status(400).json({ error: "answers array is required" });
    return;
  }

  const questionMap = new Map(session.questions.map((q) => [q.id, q]));
  const results: QuizResult["answers"] = [];
  let correctCount = 0;

  const openToGrade: Array<{
    id: number;
    question: string;
    command_word: string;
    model_answer: string;
    explanation?: string;
    student_answer: string;
  }> = [];

  for (const answer of answers) {
    const question = questionMap.get(answer.questionId);
    if (!question) continue;

    if (question.type === "open") {
      openToGrade.push({
        id: question.id,
        question: question.question,
        command_word: question.command_word,
        model_answer: question.model_answer ?? "",
        explanation: question.explanation,
        student_answer: answer.selected.trim(),
      });
    } else {
      const selected = answer.selected.trim().toUpperCase().charAt(0);
      const isCorrect = selected === question.correct_answer;
      if (isCorrect) correctCount++;

      results.push({
        questionId: question.id,
        question: question.question,
        type: "mcq",
        commandWord: question.command_word,
        selected,
        correctAnswer: question.correct_answer,
        isCorrect,
        explanation: question.explanation,
      });
    }
  }

  let gradeMap = new Map<number, { is_correct: boolean; feedback: string }>();

  if (openToGrade.length > 0) {
    try {
      if (getApiKeyOptional()) {
        gradeMap = await gradeOpenAnswers(openToGrade);
      } else {
        for (const item of openToGrade) {
          const q = questionMap.get(item.id)!;
          gradeMap.set(item.id, fallbackGradeOpen(q, item.student_answer));
        }
      }
    } catch (err) {
      console.error("Open answer grading failed, using fallback:", err);
      for (const item of openToGrade) {
        const q = questionMap.get(item.id)!;
        gradeMap.set(item.id, fallbackGradeOpen(q, item.student_answer));
      }
    }

    for (const item of openToGrade) {
      const question = questionMap.get(item.id)!;
      const grade = gradeMap.get(item.id) ?? fallbackGradeOpen(question, item.student_answer);
      if (grade.is_correct) correctCount++;

      results.push({
        questionId: question.id,
        question: question.question,
        type: "open",
        commandWord: question.command_word,
        selected: item.student_answer,
        correctAnswer: question.model_answer ?? "",
        isCorrect: grade.is_correct,
        explanation: question.explanation,
        aiFeedback: grade.feedback,
      });
    }
  }

  results.sort((a, b) => a.questionId - b.questionId);

  const total = results.length;
  const result: QuizResult = {
    total,
    correct: correctCount,
    percentage: total > 0 ? Math.round((correctCount / total) * 100) : 0,
    answers: results,
  };

  deleteSession(sessionId);
  res.json(result);
});

export default router;
