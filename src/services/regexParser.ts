import { McqQuestion } from "../types/mcq";

const ANSWER_KEY_PATTERNS = [
  /(?:^|\n)\s*(?:answer\s*key|answers?|key)\s*[:\-]?\s*\n/i,
  /(?:^|\n)\s*(?:correct\s*answers?)\s*[:\-]?\s*\n/i,
];

const QUESTION_PATTERN =
  /(?:^|\n)\s*(?:Q(?:uestion)?\.?\s*)?(\d+)[.)]\s*(.+?)(?=(?:\n\s*(?:Q(?:uestion)?\.?\s*)?\d+[.)])|$)/gis;

const OPTION_PATTERN =
  /(?:^|\n)\s*([a-eA-E])[.)]\s*(.+?)(?=(?:\n\s*[a-eA-E][.)]|\s+[a-eA-E][.)]|\n\s*correct\s+answer|\n\s*answer\s*:|\n\s*correct\s*:|$))/gis;

const EXPLICIT_ANSWER_PATTERNS = [
  /(?:^|\n)\s*correct\s+answer\s*:\s*([a-eA-E])\s*$/im,
  /(?:^|\n)\s*answer\s*:\s*([a-eA-E])\s*$/im,
  /(?:^|\n)\s*correct\s*:\s*([a-eA-E])\s*$/im,
];

const INLINE_ANSWER_PATTERNS = [
  /\(([a-eA-E])\)\s*(?:\*|✓)/i,
  /\*([a-eA-E])[.)]/i,
];

const ANSWER_KEY_ENTRY = /(\d+)\s*[-–:.)]\s*([A-E])/gi;

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function normalizeOptionLetter(raw: string): string {
  return raw.trim().toUpperCase().charAt(0);
}

function splitAnswerKey(text: string): { body: string; answerKey: Map<number, string> } {
  let splitIndex = -1;

  for (const pattern of ANSWER_KEY_PATTERNS) {
    const match = pattern.exec(text);
    if (match && (splitIndex === -1 || match.index < splitIndex)) {
      splitIndex = match.index;
    }
  }

  if (splitIndex === -1) {
    return { body: text, answerKey: new Map() };
  }

  const body = text.slice(0, splitIndex).trim();
  const keySection = text.slice(splitIndex);
  const answerKey = new Map<number, string>();

  let match: RegExpExecArray | null;
  const entryPattern = new RegExp(ANSWER_KEY_ENTRY.source, "gi");
  while ((match = entryPattern.exec(keySection)) !== null) {
    answerKey.set(parseInt(match[1], 10), normalizeOptionLetter(match[2]));
  }

  return { body, answerKey };
}

function stripAnswerLines(text: string): string {
  return text
    .replace(/(?:^|\n)\s*correct\s+answer\s*:\s*[a-eA-E]\s*/gi, "\n")
    .replace(/(?:^|\n)\s*answer\s*:\s*[a-eA-E]\s*/gi, "\n")
    .replace(/(?:^|\n)\s*correct\s*:\s*[a-eA-E]\s*/gi, "\n");
}

function extractExplicitAnswer(block: string): string | null {
  for (const pattern of EXPLICIT_ANSWER_PATTERNS) {
    const match = block.match(pattern);
    if (match) return normalizeOptionLetter(match[1]);
  }
  return null;
}

function detectInlineAnswer(block: string): string | null {
  for (const pattern of INLINE_ANSWER_PATTERNS) {
    const match = block.match(pattern);
    if (match) return normalizeOptionLetter(match[1]);
  }

  const markedOption = block.match(/\*+\s*([a-eA-E])[.)]/i);
  if (markedOption) return normalizeOptionLetter(markedOption[1]);

  return null;
}

function parseQuestionBlock(
  id: number,
  block: string,
  answerKey: Map<number, string>
): McqQuestion | null {
  const lines = block.trim().split("\n");
  if (lines.length === 0) return null;

  const questionLine = lines[0].replace(/^\d+[.)]\s*/, "").trim();
  const explicitAnswer = extractExplicitAnswer(block);
  const options: string[] = [];
  let markedAnswer: string | null = null;

  const optionText = stripAnswerLines(lines.slice(1).join("\n"));
  let optMatch: RegExpExecArray | null;
  const optPattern = new RegExp(OPTION_PATTERN.source, "gis");
  while ((optMatch = optPattern.exec(optionText)) !== null) {
    const letter = normalizeOptionLetter(optMatch[1]);
    const text = optMatch[2].trim().replace(/[*✓]+$/, "").trim();
    const isMarked =
      optMatch[0].includes("*") || /bold|underline/i.test(optMatch[0]);
    options.push(`${letter}) ${text}`);
    if (isMarked) markedAnswer = letter;
  }

  if (options.length < 2) return null;

  const correctAnswer =
    answerKey.get(id) ??
    explicitAnswer ??
    detectInlineAnswer(block) ??
    markedAnswer ??
    "";

  return {
    id,
    question: questionLine,
    options,
    correct_answer: correctAnswer,
  };
}

export function parseWithRegex(rawText: string): McqQuestion[] {
  const text = normalizeText(rawText);
  const { body, answerKey } = splitAnswerKey(text);
  const questions: McqQuestion[] = [];

  let match: RegExpExecArray | null;
  const qPattern = new RegExp(QUESTION_PATTERN.source, "gis");
  while ((match = qPattern.exec(body)) !== null) {
    const id = parseInt(match[1], 10);
    const block = match[2];
    const parsed = parseQuestionBlock(id, block, answerKey);
    if (parsed) questions.push(parsed);
  }

  return questions;
}

export function needsAiNormalization(questions: McqQuestion[], rawText: string): boolean {
  if (questions.length === 0) return true;

  const unanswered = questions.filter((q) => !q.correct_answer);
  if (unanswered.length > 0) return true;

  const hasFormattingHints =
    /\*+\s*[A-E][.)]/i.test(rawText) ||
    /__(.+?)__/i.test(rawText) ||
    /bold|underline|asterisk/i.test(rawText);

  if (hasFormattingHints && unanswered.length > 0) return true;

  return false;
}
