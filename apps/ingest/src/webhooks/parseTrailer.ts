// AI-Assisted commit-trailer parser (CLAUDE.md §Outcome Attribution, Layer 2).
//
// A commit message with an opt-in `bematist` trailer looks like:
//
//   fix(auth): token rotation bug
//
//   We now refresh the token before each retry — prevents the 401 loop.
//
//   AI-Assisted: bematist-c4a0b3b8-7c4c-4f71-9b4a-21d5f8e65e1e
//   Co-Authored-By: dev@example.com
//
// Per Git's `interpret-trailers` rules:
//   · Trailers live in the LAST paragraph (blank-line-separated tail block).
//   · One per line: `<Key>: <value>` or `<Key>:<value>`.
//   · Keys are case-insensitive; values are literal.
//
// We go further and hard-cap the sessionId regex to `[A-Za-z0-9_-]{8,128}`
// so anything that looks like a SQL-injection or a shell-escape attempt falls
// through `null`. The server NEVER interpolates sessionId into a query; the
// regex is belt-and-suspenders on top of parameterized SQL.
//
// This module intentionally does NOT throw. Malformed input → null so the
// caller can treat "no trailer" and "garbage" identically.

/**
 * Charset + length bound for an accepted sessionId. Collector-emitted ids are
 * UUIDv7s (36 chars with hyphens, 32 without) but we accept the broader
 * `[A-Za-z0-9_-]{8,128}` set to stay forward-compatible with a future
 * `nanoid`-style id. Anything outside this alphabet is rejected — in
 * particular: whitespace, quotes, semicolons, backslashes, newlines, NULs.
 */
const SESSION_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * Trailer key is case-insensitive per git convention; value after `:` may
 * have optional leading whitespace. Prefix `bematist-` is case-sensitive — we
 * do not want to accept `BEMATIST-…` as equivalent because the collector
 * emits lowercase only and any case variance on the wire is almost certainly
 * a typo or an impersonator.
 *
 * Split into two matching stages: a case-INSENSITIVE key match followed by a
 * case-SENSITIVE `bematist-` prefix match on the value side.
 */
const TRAILER_KEY_RE = /^AI-Assisted[ \t]*:[ \t]*/i;
const TRAILER_VALUE_RE = /^bematist-([A-Za-z0-9_-]+)[ \t]*$/;

export interface AiAssistedTrailer {
  sessionId: string;
  tool: "bematist";
}

/**
 * Parse the last-paragraph trailer block of a git commit message. Returns the
 * first `AI-Assisted: bematist-<sessionId>` trailer found there, or null.
 *
 * Handles CRLF vs LF, leading/trailing whitespace, mixed-case key,
 * multi-trailer blocks, and ignores any `AI-Assisted:` line that lives
 * OUTSIDE the last paragraph (git's `interpret-trailers` would reject those
 * too — trailers are a tail-block-only convention).
 */
export function parseAiAssistedTrailer(commitMessage: string): AiAssistedTrailer | null {
  if (typeof commitMessage !== "string" || commitMessage.length === 0) return null;

  // Normalize line endings first so CRLF / CR-only messages all collapse to
  // LF-separated lines before paragraph split.
  const normalized = commitMessage.replace(/\r\n?/g, "\n").replace(/\s+$/u, "");
  if (normalized.length === 0) return null;

  // Last paragraph = tail block after the final blank line. If the message is
  // a single paragraph, the whole thing is the tail block.
  const lastBlank = normalized.lastIndexOf("\n\n");
  const tail = lastBlank === -1 ? normalized : normalized.slice(lastBlank + 2);

  // A trailer BLOCK must be entirely trailer-shaped lines — any interleaved
  // prose disqualifies the block per git's parser. We emulate the rule by
  // checking every non-empty line of the tail matches the key/value shape.
  // Relaxed rule: we only require the line that STARTS with "AI-Assisted:"
  // (case-insensitive) to match our strict pattern, but we DO skip the whole
  // block if it opens with something that doesn't look like a trailer line at
  // all (prose paragraph misinterpreted as trailers).
  const lines = tail.split("\n");

  let blockLooksLikeTrailers = true;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;
    // A trailer line starts with `Token:` where the value side is NOT a bare
    // URL (`://`). Git's interpret-trailers uses a similar URL guard to
    // tolerate `See: https://…` not being mistaken for a trailer — we go
    // stricter: if ANY line in the tail looks like a URL, treat the whole
    // block as prose.
    if (!/^[A-Za-z][A-Za-z0-9-]*[ \t]*:/.test(line) || /:\/\//.test(line)) {
      blockLooksLikeTrailers = false;
      break;
    }
  }
  if (!blockLooksLikeTrailers) return null;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const keyMatch = TRAILER_KEY_RE.exec(line);
    if (!keyMatch) continue;
    const valueSide = line.slice(keyMatch[0].length);
    const valueMatch = TRAILER_VALUE_RE.exec(valueSide);
    if (!valueMatch) continue;
    const sessionId = valueMatch[1];
    if (!sessionId || !SESSION_ID_RE.test(sessionId)) continue;
    return { sessionId, tool: "bematist" };
  }
  return null;
}

/**
 * Render a commit message for log lines without leaking prompt text. Matches
 * the CLAUDE.md log-sanitize rule ("redact commit messages in logs to
 * <truncated:N-chars>"). We count chars, not bytes, since multi-byte UTF-8
 * would otherwise confuse a reader skimming logs.
 */
export function sanitizeCommitMessageForLog(msg: string): string {
  if (typeof msg !== "string") return "<truncated:0-chars>";
  return `<truncated:${msg.length}-chars>`;
}
