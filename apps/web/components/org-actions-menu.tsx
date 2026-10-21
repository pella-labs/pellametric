"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { disconnectOrg } from "@/app/org/[provider]/[slug]/actions";
import { orgHref } from "@/lib/orgs/href";

type Provider = "github" | "gitlab";

export default function OrgActionsMenu({
  provider, slug, orgName, canInvite,
}: {
  provider: Provider;
  slug: string;
  orgName: string;
  canInvite: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [stage, setStage] = useState<"confirm" | "done" | "error">("confirm");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && stage !== "done") setModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [modalOpen, stage]);

  function closeModal() {
    if (stage === "done") return;
    setModalOpen(false);
    setStage("confirm");
    setErrorMsg(null);
  }

  function confirmDisconnect() {
    startTransition(async () => {
      const res = await disconnectOrg({ provider, slug });
      if (res.ok) {
        setStage("done");
      } else {
        setStage("error");
        setErrorMsg(res.error);
      }
    });
  }

  function reconnect() {
    if (provider === "gitlab") {
      router.push("/setup/org/gitlab/oauth");
    } else {
      router.push("/setup/org");
    }
  }

  return (
    <>
      <div ref={ref} className="relative inline-flex items-center gap-1 p-1 rounded-md border border-border bg-card">
        <button
          type="button"
          aria-label="Org actions"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(v => !v)}
          className={`px-3 py-1 rounded text-[11px] font-mono font-semibold transition flex items-center gap-2 ${
            open ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
          title={`${orgName} actions`}
        >
          <span aria-hidden className="inline-block w-0 overflow-hidden">{"​"}</span>
          <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
              d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z"
              stroke="currentColor"
              strokeWidth="1.4"
            />
            <path
              d="M13.3 9.4a5.6 5.6 0 0 0 0-2.8l1.4-1.1-1.4-2.4-1.7.6a5.6 5.6 0 0 0-2.4-1.4L8.9 0h-1.8l-.3 2.3a5.6 5.6 0 0 0-2.4 1.4l-1.7-.6L1.3 5.5l1.4 1.1a5.6 5.6 0 0 0 0 2.8L1.3 10.5l1.4 2.4 1.7-.6a5.6 5.6 0 0 0 2.4 1.4l.3 2.3h1.8l.3-2.3a5.6 5.6 0 0 0 2.4-1.4l1.7.6 1.4-2.4-1.4-1.1Z"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
          </svg>
          <svg
            className={`w-3 h-3 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden
          >
            <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {open && (
          <div
            role="menu"
            className="absolute right-0 top-full mt-2 w-56 origin-top-right border border-border bg-background/95 backdrop-blur shadow-xl rounded-lg overflow-hidden z-40 animate-[fadeIn_120ms_ease-out]"
          >
            <div className="py-1">
              <Link
                role="menuitem"
                href={orgHref(provider, slug, "members")}
                onClick={() => setOpen(false)}
                className="block px-4 py-2 text-sm hover:bg-card transition"
              >
                Members
              </Link>
              {canInvite ? (
                <Link
                  role="menuitem"
                  href={orgHref(provider, slug, "invite")}
                  data-onboarding="invite"
                  onClick={() => setOpen(false)}
                  className="block px-4 py-2 text-sm hover:bg-card transition"
                >
                  Invite
                </Link>
              ) : (
                <span
                  role="menuitem"
                  title="This GitLab token is read-only. Add `api` scope (or rotate the token) to enable invites from here."
                  className="flex items-center justify-between gap-2 px-4 py-2 text-sm text-muted-foreground cursor-not-allowed"
                >
                  <span>Invite</span>
                  <span className="text-[10px] uppercase tracking-wider">read-only</span>
                </span>
              )}
              <Link
                role="menuitem"
                href={orgHref(provider, slug, "policy")}
                onClick={() => setOpen(false)}
                className="block px-4 py-2 text-sm hover:bg-card transition"
              >
                Policy & exports
              </Link>
            </div>
            <div className="border-t border-border py-1">
              <button
                type="button"
                role="menuitem"
                onClick={() => { setOpen(false); setModalOpen(true); }}
                className="w-full text-left block px-4 py-2 text-sm text-destructive hover:bg-destructive/10 transition"
              >
                Disconnect
              </button>
            </div>
          </div>
        )}
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-md bg-black/55"
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="disconnect-modal-title"
        >
          <div className="bg-card border border-border rounded-md shadow-2xl w-[min(440px,92vw)] p-5">
            {stage === "confirm" && (
              <>
                <h2 id="disconnect-modal-title" className="text-base font-semibold leading-snug">
                  Disconnect {orgName}?
                </h2>
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                  This removes the {provider === "gitlab" ? "GitLab" : "GitHub"} credentials, all
                  members, invitations, and ingested session data for this org from Telemetryc.
                  You can reconnect at any time — historical sessions will be re-uploaded by your
                  collector on the next run.
                </p>
                <div className="mt-5 flex items-center justify-end gap-2">
                  <button
                    onClick={closeModal}
                    disabled={isPending}
                    className="text-xs h-8 px-3 rounded-md border border-border text-foreground hover:border-accent transition leading-none disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmDisconnect}
                    disabled={isPending}
                    className="text-xs h-8 px-3 rounded-md bg-destructive text-destructive-foreground hover:opacity-90 transition leading-none disabled:opacity-50"
                  >
                    {isPending ? "Disconnecting…" : "Disconnect"}
                  </button>
                </div>
              </>
            )}

            {stage === "done" && (
              <>
                <h2 id="disconnect-modal-title" className="text-base font-semibold leading-snug">
                  Disconnected
                </h2>
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                  {orgName} is no longer connected to Telemetryc. Reconnect to set it back up
                  with fresh credentials, or head back to the dashboard.
                </p>
                <div className="mt-5 flex items-center justify-end gap-2">
                  <button
                    onClick={() => router.push("/dashboard")}
                    className="text-xs h-8 px-3 rounded-md border border-border text-foreground hover:border-accent transition leading-none"
                  >
                    Back to dashboard
                  </button>
                  <button
                    onClick={reconnect}
                    className="text-xs h-8 px-3 rounded-md bg-accent text-accent-foreground hover:opacity-90 transition leading-none"
                  >
                    Reconnect →
                  </button>
                </div>
              </>
            )}

            {stage === "error" && (
              <>
                <h2 id="disconnect-modal-title" className="text-base font-semibold leading-snug">
                  Couldn't disconnect
                </h2>
                <p className="text-xs text-destructive mt-2 leading-relaxed">{errorMsg}</p>
                <div className="mt-5 flex items-center justify-end gap-2">
                  <button
                    onClick={closeModal}
                    className="text-xs h-8 px-3 rounded-md border border-border text-foreground hover:border-accent transition leading-none"
                  >
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
