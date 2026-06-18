import { Router, Request, Response, NextFunction } from "express";
import fs from "fs/promises";
import multer from "multer";
import { upload } from "../middleware/upload";
import { extractTextFromFile, extractTextFromRawInput } from "../services/textExtractor";
import { parseMcqs } from "../services/geminiService";
import {
  generateQuestionsFromContent,
  OPEN_COMMAND_WORDS,
  type OpenCommandWord,
} from "../services/questionGenerator";
import { createSession } from "../services/sessionStore";
import { sampleQuestions } from "../services/quizSampler";
import { mcqToQuizQuestion } from "../types/mcq";

const router = Router();

function parseOpenTypes(raw: string | undefined): OpenCommandWord[] {
  if (!raw?.trim()) return [...OPEN_COMMAND_WORDS];
  const allowed = new Set<string>(OPEN_COMMAND_WORDS);
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is OpenCommandWord => allowed.has(s));
}

function mapQuestionForClient(q: {
  id: number;
  type: string;
  question: string;
  command_word: string;
  cognitive_level: string;
  options: string[];
  correct_answer: string;
}) {
  return {
    id: q.id,
    type: q.type,
    question: q.question,
    commandWord: q.command_word,
    cognitiveLevel: q.cognitive_level,
    options: q.type === "mcq" ? q.options : [],
    correctAnswer: q.type === "mcq" ? q.correct_answer : undefined,
  };
}

router.post("/", (req: Request, res: Response, next: NextFunction) => {
  upload.single("file")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      res.status(400).json({ error: `Upload error: ${err.message}` });
      return;
    }
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    next();
  });
}, async (req: Request, res: Response) => {
  try {
    const mode = (req.body.mode as string) === "random" ? "random" : "all";
    const sampleSize = req.body.sampleSize
      ? parseInt(req.body.sampleSize as string, 10)
      : undefined;
    const pastedText = req.body.text as string | undefined;
    const inputMode = req.body.inputMode === "generate" ? "generate" : "extract";
    const generateCount = Math.min(
      30,
      Math.max(3, parseInt(req.body.generateCount as string, 10) || 10)
    );
    const includeMcq = req.body.includeMcq !== "false";
    const includeOpen = req.body.includeOpen !== "false";
    const openTypes = parseOpenTypes(req.body.openTypes as string | undefined);

    let rawText: string;

    if (req.file) {
      rawText = await extractTextFromFile(req.file.path, req.file.originalname);
      await fs.unlink(req.file.path).catch(() => {});
    } else if (pastedText?.trim()) {
      rawText = await extractTextFromRawInput(pastedText);
    } else {
      res.status(400).json({ error: "Provide a file or pasted text" });
      return;
    }

    if (!rawText.trim()) {
      res.status(400).json({ error: "No text could be extracted from the input" });
      return;
    }

    let parsed;
    let method: "regex" | "gemini" | "regex+gemini" | "generate";

    if (inputMode === "generate") {
      const openSelection = includeOpen ? openTypes : [];
      parsed = await generateQuestionsFromContent(
        rawText,
        generateCount,
        includeMcq,
        openSelection
      );
      method = "generate";
    } else {
      const { questions: extracted, method: extractMethod } = await parseMcqs(rawText);
      if (extracted.length === 0) {
        res.status(422).json({
          error: "Could not extract any MCQs from the provided content",
          hint: "Ensure questions follow a numbered format with A/B/C/D options, or switch to Generate mode",
        });
        return;
      }
      parsed = extracted.map((q, i) => mcqToQuizQuestion(q, i + 1));
      method = extractMethod;
    }

    const quizQuestions = sampleQuestions(parsed, mode, sampleSize);
    const session = createSession(quizQuestions, mode, inputMode, sampleSize);

    res.json({
      sessionId: session.id,
      totalAvailable: parsed.length,
      questionCount: quizQuestions.length,
      parseMethod: method,
      inputMode,
      questions: quizQuestions.map(mapQuestionForClient),
    });
  } catch (error) {
    console.error("Upload error:", error);
    const message = error instanceof Error ? error.message : "Upload failed";
    res.status(500).json({ error: message });
  }
});

export default router;
