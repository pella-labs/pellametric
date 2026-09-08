export type ProviderName = "github" | "gitlab";

export interface IngestSession {
  externalSessionId: string;
  /** "ownerPath/name". Server splits on the last "/" — multi-segment ownerPath supported for GitLab subgroups. */
  repo: string;
  /** Provider hosting the repo. Defaults to 'github' on the server when unset (back-compat). */
  provider?: ProviderName;
  cwd?: string;
  /** Git branch captured at session start (`git rev-parse --abbrev-ref HEAD`). Insights revamp P9. */
  branch?: string;
  /** Collector's resolved repo from cwd walk-up (owner/name). Insights revamp P14. */
  cwdResolvedRepo?: string;
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

export interface IngestPrompt {
  externalSessionId: string;
  tsPrompt: string;   // ISO
  text: string;       // plaintext; server encrypts before storing
  wordCount: number;
}

export interface IngestResponse {
  externalSessionId: string;
  tsResponse: string; // ISO
  text: string;       // assistant text reply; server encrypts before storing
  wordCount: number;
}

export interface IngestPayload {
  source: "claude" | "codex" | "cursor";
  collectorVersion?: string;
  sessions: IngestSession[];
  prompts?: IngestPrompt[];
  responses?: IngestResponse[];
}
