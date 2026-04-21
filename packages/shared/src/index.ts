export interface IngestSession {
  externalSessionId: string;
  repo: string;                          // "owner/name"
  cwd?: string;
  startedAt: string;                     // ISO
  endedAt: string;
  model?: string;
  tokensIn: number;
  tokensOut: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  tokensReasoning: number;
  messages: number;
  userTurns: number;
  errors: number;
  filesEdited: string[];
  toolHist: Record<string, number>;
  skillsUsed: string[];
  mcpsUsed: string[];
  intentTop?: string;
  isSidechain: boolean;
  teacherMoments?: number;
  frustrationSpikes?: number;
  promptWordsMedian?: number;
  promptWordsP95?: number;
}

export interface IngestPayload {
  source: "claude" | "codex";
  collectorVersion?: string;
  sessions: IngestSession[];
}
