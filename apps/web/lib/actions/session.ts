"use server";
import { revealSession } from "@bematist/api";
import { RevealInput } from "@bematist/api/schemas/session";
import { zodAction } from "../zodActions";

/**
 * Server Action: request a reveal of a session's prompt text.
 *
 * The action lives under `apps/web/lib/actions/` (not `app/actions/`) so the
 * `app/` tree stays routes-only. `"use server"` makes every exported function
 * callable from Client Components — Next.js serializes the invocation over the
 * wire without requiring an explicit Route Handler.
 *
 * M1: `revealSession` returns FORBIDDEN until Walid's auth + Jorge's RLS land,
 * so the action returns `{ ok: false, error: { code: "FORBIDDEN" } }`. The UI
 * `<RevealDialog>` handles that shape and shows the three-conditions copy.
 */
export const revealSessionAction = zodAction(RevealInput, revealSession);
