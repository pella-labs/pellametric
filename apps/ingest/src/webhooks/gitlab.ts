// GitLab webhook payload → GitEventRow. Uses `object_kind` dispatch.
import type { GitEventRow } from "./gitEventsStore";

type Any = Record<string, unknown>;

function projectId(body: Any): string {
  const project = body.project as Any | undefined;
  const id = project?.id;
  if (typeof id !== "number" && typeof id !== "string") {
    throw new Error("gitlab:bad-payload");
  }
  return String(id);
}

function asString(v: unknown): string | null {
  if (typeof v === "string" && v.length > 0) return v;
  if (typeof v === "number") return String(v);
  return null;
}

export function parseGitLabWebhook(_event: string, body: unknown): GitEventRow | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Any;
  const kind = typeof b.object_kind === "string" ? (b.object_kind as string) : null;
  if (!kind) return null;

  if (kind === "merge_request") {
    const repo_id = projectId(b);
    const attrs = b.object_attributes as Any | undefined;
    const action = typeof attrs?.action === "string" ? (attrs.action as string) : "unknown";
    return {
      source: "gitlab",
      event_kind: `merge_request.${action}`,
      pr_node_id: asString(attrs?.id),
      repo_id,
      ...(typeof attrs?.iid === "number" ? { pr_number: attrs.iid as number } : {}),
      commit_sha: asString((attrs?.last_commit as Any | undefined)?.id),
      merged_at: asString(attrs?.merged_at),
      payload: body,
    };
  }

  if (kind === "push") {
    const repo_id = projectId(b);
    return {
      source: "gitlab",
      event_kind: "push",
      pr_node_id: null,
      repo_id,
      commit_sha: asString(b.after),
      payload: body,
    };
  }

  if (kind === "pipeline") {
    const repo_id = projectId(b);
    const attrs = b.object_attributes as Any | undefined;
    const status = typeof attrs?.status === "string" ? (attrs.status as string) : "unknown";
    return {
      source: "gitlab",
      event_kind: `pipeline.${status}`,
      pr_node_id: null,
      repo_id,
      commit_sha: asString(attrs?.sha),
      payload: body,
    };
  }

  return null;
}
