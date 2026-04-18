import { log } from "../../logger";
import { readLinesFromOffset } from "./safeRead";
import type {
  ContinueChatInteractionLine,
  ContinueEditOutcomeLine,
  ContinueTokensGeneratedLine,
  ContinueToolUsageLine,
} from "./types";

export interface ParsedStream<T> {
  lines: T[];
  nextOffset: number;
  rotated: boolean;
  malformedCount: number;
}

async function readAndParse<T>(
  path: string,
  offset: number,
  streamName: string,
): Promise<ParsedStream<T>> {
  const { lines, nextOffset, rotated } = await readLinesFromOffset(path, offset);
  const parsed: T[] = [];
  let malformedCount = 0;
  for (const raw of lines) {
    try {
      parsed.push(JSON.parse(raw) as T);
    } catch (e) {
      malformedCount++;
      log.warn({ err: String(e), stream: streamName }, "continue-dev: skipping malformed line");
    }
  }
  return { lines: parsed, nextOffset, rotated, malformedCount };
}

export function parseChatInteractionStream(
  path: string,
  offset: number,
): Promise<ParsedStream<ContinueChatInteractionLine>> {
  return readAndParse(path, offset, "chatInteraction");
}

export function parseTokensGeneratedStream(
  path: string,
  offset: number,
): Promise<ParsedStream<ContinueTokensGeneratedLine>> {
  return readAndParse(path, offset, "tokensGenerated");
}

export function parseEditOutcomeStream(
  path: string,
  offset: number,
): Promise<ParsedStream<ContinueEditOutcomeLine>> {
  return readAndParse(path, offset, "editOutcome");
}

export function parseToolUsageStream(
  path: string,
  offset: number,
): Promise<ParsedStream<ContinueToolUsageLine>> {
  return readAndParse(path, offset, "toolUsage");
}
