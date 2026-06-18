import { v4 as uuidv4 } from "uuid";
import { QuizQuestion, QuizSession } from "../types/mcq";

const sessions = new Map<string, QuizSession>();

function getTtl(): number {
  return parseInt(process.env.SESSION_TTL_MS ?? "3600000", 10);
}

function purgeExpired(): void {
  const now = Date.now();
  const ttl = getTtl();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > ttl) {
      sessions.delete(id);
    }
  }
}

export function createSession(
  questions: QuizQuestion[],
  mode: "all" | "random",
  inputMode: "extract" | "generate",
  sampleSize?: number
): QuizSession {
  purgeExpired();

  const session: QuizSession = {
    id: uuidv4(),
    questions,
    mode,
    sampleSize,
    inputMode,
    createdAt: Date.now(),
  };

  sessions.set(session.id, session);
  return session;
}

export function getSession(id: string): QuizSession | undefined {
  purgeExpired();
  return sessions.get(id);
}

export function deleteSession(id: string): boolean {
  return sessions.delete(id);
}
