import { Router, Request, Response } from "express";
import fs from "fs/promises";
import { upload } from "../middleware/upload";
import { extractTextFromFile, extractTextFromRawInput } from "../services/textExtractor";
import { parseMcqs } from "../services/geminiService";
import { createSession } from "../services/sessionStore";
import { sampleQuestions } from "../services/quizSampler";

const router = Router();

router.post("/", upload.single("file"), async (req: Request, res: Response) => {
  try {
    const mode = (req.body.mode as string) === "random" ? "random" : "all";
    const sampleSize = req.body.sampleSize
      ? parseInt(req.body.sampleSize as string, 10)
      : undefined;
    const pastedText = req.body.text as string | undefined;

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

    const { questions: parsed, method } = await parseMcqs(rawText);

    if (parsed.length === 0) {
      res.status(422).json({
        error: "Could not extract any MCQs from the provided content",
        hint: "Ensure questions follow a numbered format with A/B/C/D options",
      });
      return;
    }

    const session = createSession(parsed, mode, sampleSize);
    const quizQuestions = sampleQuestions(parsed, mode, sampleSize);

    res.json({
      sessionId: session.id,
      totalAvailable: parsed.length,
      questionCount: quizQuestions.length,
      parseMethod: method,
      questions: quizQuestions.map((q) => ({
        id: q.id,
        question: q.question,
        options: q.options,
      })),
    });
  } catch (error) {
    console.error("Upload error:", error);
    const message = error instanceof Error ? error.message : "Upload failed";
    res.status(500).json({ error: message });
  }
});

export default router;
