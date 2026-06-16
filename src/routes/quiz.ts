import { Router, Request, Response } from "express";
import { getSession, deleteSession } from "../services/sessionStore";
import { QuizResult } from "../types/mcq";

const router = Router();

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
    sampleSize: session.sampleSize,
    questionCount: session.questions.length,
    questions: session.questions.map((q) => ({
      id: q.id,
      question: q.question,
      options: q.options,
    })),
  });
});

router.post("/:sessionId/submit", (req: Request, res: Response) => {
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

  for (const answer of answers) {
    const question = questionMap.get(answer.questionId);
    if (!question) continue;

    const selected = answer.selected.trim().toUpperCase().charAt(0);
    const isCorrect = selected === question.correct_answer;
    if (isCorrect) correctCount++;

    results.push({
      questionId: question.id,
      question: question.question,
      selected,
      correctAnswer: question.correct_answer,
      isCorrect,
      explanation: question.explanation,
    });
  }

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
