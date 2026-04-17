// Bitbucket webhook payload → GitEventRow. Event types come from the
// `X-Event-Key` header (`pullrequest:created`, `repo:push`, etc.).
import type { GitEventRow } from "./gitEventsStore";

type Any = Record<string, unknown>;

function repoUuid(body: Any): string {
  const repo = body.repository as Any | undefined;
  const uuid = repo?.uuid;
  if (typeof uuid !== "string" || uuid.length === 0) {
    throw new Error("bitbucket:bad-payload");
  }
  return uuid;
}

function asString(v: unknown): string | null {
  if (typeof v === "string" && v.length > 0) return v;
  if (typeof v === "number") return String(v);
  return null;
}

export function parseBitbucketWebhook(event: string, body: unknown): GitEventRow | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Any;

  if (event.startsWith("pullrequest:")) {
    const repo_id = repoUuid(b);
    const pr = b.pullrequest as Any | undefined;
    const action = event.slice("pullrequest:".length);
    const idStr = asString(pr?.id);
    return {
      source: "bitbucket",
      event_kind: `pullrequest.${action}`,
      pr_node_id: idStr,
      repo_id,
      ...(typeof pr?.id === "number" ? { pr_number: pr.id as number } : {}),
      commit_sha: asString((pr?.merge_commit as Any | undefined)?.hash),
      merged_at: asString((pr?.updated_on as unknown) ?? null),
      payload: body,
    };
  }

  if (event === "repo:push") {
    const repo_id = repoUuid(b);
    const push = b.push as Any | undefined;
    const changes = (push?.changes as Any[] | undefined) ?? [];
    const newHash =
      changes.length > 0
        ? asString(
            ((changes[0] as Any).new as Any | undefined)?.target &&
              ((((changes[0] as Any).new as Any).target as Any).hash as unknown),
          )
        : null;
    return {
      source: "bitbucket",
      event_kind: "push",
      pr_node_id: null,
      repo_id,
      commit_sha: newHash,
      payload: body,
    };
  }

  return null;
}
