import fs from "fs/promises";
import path from "path";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";

const SUPPORTED_EXTENSIONS = [".pdf", ".docx", ".doc", ".txt"];

export function getSupportedExtensions(): string[] {
  return SUPPORTED_EXTENSIONS;
}

export async function extractTextFromFile(
  filePath: string,
  originalName: string
): Promise<string> {
  const ext = path.extname(originalName).toLowerCase();

  switch (ext) {
    case ".pdf": {
      const buffer = await fs.readFile(filePath);
      const data = await pdfParse(buffer);
      return data.text;
    }
    case ".docx":
    case ".doc": {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value;
    }
    case ".txt": {
      return fs.readFile(filePath, "utf-8");
    }
    default:
      throw new Error(`Unsupported file type: ${ext}`);
  }
}

export async function extractTextFromRawInput(input: string): Promise<string> {
  return input.trim();
}
