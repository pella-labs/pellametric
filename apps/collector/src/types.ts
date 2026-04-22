// In-memory session accumulator shape. Richer than the wire type in
// `@pella/shared` (Sets instead of arrays, Date instead of ISO string,
// carries per-session prompt+intent state) so the fold functions can
// cheaply merge new events into an existing session across ticks.

export interface SessionState {
  sid: string;
  cwd: string;
  start: Date | null;
  end: Date | null;
  isSidechain: boolean;
  tokensIn: number;
  tokensOut: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  tokensReasoning: number;
  messages: number;
  userTurns: number;
  errors: number;
  filesEdited: Set<string>;
  toolHist: Record<string, number>;
  skillsUsed: Set<string>;
  mcpsUsed: Set<string>;
  intents: Record<string, number>;
  model?: string;
  teacherMoments: number;
  frustrationSpikes: number;
  promptWords: number[];
  prompts: Array<{ ts: Date; text: string; wordCount: number }>;
  responses: Array<{ ts: Date; text: string; wordCount: number }>;
}

export type SessionMap = Map<string, SessionState>;

export function newSessionState(
  sid: string,
  cwd: string,
  isSidechain = false,
  model?: string,
): SessionState {
  return {
    sid,
    cwd,
    start: null,
    end: null,
    isSidechain,
    tokensIn: 0,
    tokensOut: 0,
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    tokensReasoning: 0,
    messages: 0,
    userTurns: 0,
    errors: 0,
    filesEdited: new Set(),
    toolHist: {},
    skillsUsed: new Set(),
    mcpsUsed: new Set(),
    intents: {},
    model,
    teacherMoments: 0,
    frustrationSpikes: 0,    promptWords: [],
    prompts: [],
    responses: [],
  };
}
