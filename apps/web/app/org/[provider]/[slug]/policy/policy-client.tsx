"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updatePromptRetention } from "@/app/org/[provider]/[slug]/actions";

type Member = { userId: string; name: string; login: string | null; role: string };

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    if (ch !== "\r") cell += ch;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

export default function PolicyClient({
  provider,
  slug,
  retentionDays,
  members,
}: {
  provider: "github" | "gitlab";
  slug: string;
  retentionDays: number;
  members: Member[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [retention, setRetention] = useState(String(retentionDays));
  const [retentionMsg, setRetentionMsg] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [cooldownOpen, setCooldownOpen] = useState(false);
  const [cooldownTitle, setCooldownTitle] = useState("Retention Update Locked");
  const [cooldownBody, setCooldownBody] = useState("");

  const [rangeMode, setRangeMode] = useState<"days" | "custom">("days");
  const [days, setDays] = useState("30");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [viewMode, setViewMode] = useState<"team" | "member">("team");
  const [selected, setSelected] = useState<string[]>(members.map((m) => m.userId));
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTab, setPreviewTab] = useState<"pdf" | "excel">("pdf");
  const [csvPreviewLoading, setCsvPreviewLoading] = useState(false);
  const [csvPreviewErr, setCsvPreviewErr] = useState<string | null>(null);
  const [csvMetaRows, setCsvMetaRows] = useState<string[][]>([]);
  const [csvSummaryHeaders, setCsvSummaryHeaders] = useState<string[]>([]);
  const [csvSummaryRows, setCsvSummaryRows] = useState<string[][]>([]);
  const [csvSessionHeaders, setCsvSessionHeaders] = useState<string[]>([]);
  const [csvSessionRows, setCsvSessionRows] = useState<string[][]>([]);
  const groupedSessionRows = useMemo(() => {
    const userIdx = csvSessionHeaders.indexOf("user_name");
    if (userIdx < 0) return [] as Array<{ member: string; rows: string[][] }>;
    const map = new Map<string, string[][]>();
    for (const r of csvSessionRows) {
      const key = r[userIdx] || "Unknown";
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    return [...map.entries()].map(([member, rows]) => ({ member, rows }));
  }, [csvSessionHeaders, csvSessionRows]);

  const allSelected = useMemo(() => selected.length === members.length, [selected.length, members.length]);

  function toggleMember(userId: string) {
    setSelected((prev) => (prev.includes(userId) ? prev.filter((x) => x !== userId) : [...prev, userId]));
  }

  function toggleAll() {
    setSelected(allSelected ? [] : members.map((m) => m.userId));
  }

  function saveRetention() {
    const raw = Number(retention);
    if (!Number.isFinite(raw)) {
      setRetentionMsg("Enter a valid number (7-365).");
      setToast({ kind: "error", text: "Please enter a valid retention value between 7 and 365 days." });
      return;
    }
    if (raw < 7) {
      setRetention("7");
      setRetentionMsg("Minimum retention is 7 days.");
      setToast({ kind: "error", text: "Minimum retention is 7 days. Value reset to 7." });
      return;
    }
    if (raw > 365) {
      setRetention("365");
      setRetentionMsg("Maximum retention is 365 days.");
      setToast({ kind: "error", text: "Maximum retention is 365 days. Value reset to 365." });
      return;
    }
    const n = Math.trunc(raw);
    setRetentionMsg(null);
    startTransition(async () => {
      const res = await updatePromptRetention({ provider, slug, retentionDays: n });
      if (!res.ok) {
        if (res.code === "cooldown") {
          const retry = res.retryAt ? new Date(res.retryAt) : null;
          const when = retry
            ? retry.toLocaleString(undefined, {
                year: "numeric",
                month: "short",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "in 24 hours";
          setCooldownTitle("Retention Update Locked");
          setCooldownBody(`Prompt retention can be changed once every 24 hours. You can update it again on ${when}.`);
          setCooldownOpen(true);
        }
        setRetentionMsg(res.error);
        setToast({ kind: "error", text: res.error });
        return;
      }
      setRetention(String(res.retentionDays));
      setRetentionMsg("Retention updated.");
      setToast({ kind: "success", text: "Prompt retention updated successfully." });
      router.refresh();
    });
  }

  function buildQs(format?: "csv" | "pdf" | "xlsx", inline = false) {
    const qs = new URLSearchParams();
    if (format) qs.set("format", format);
    if (inline) qs.set("inline", "1");
    qs.set("mode", viewMode);
    if (rangeMode === "days") {
      qs.set("days", days);
    } else {
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
    }
    for (const m of selected) qs.append("member", m);
    return qs.toString();
  }

  async function loadCsvPreview() {
    setCsvPreviewLoading(true);
    setCsvPreviewErr(null);
    setCsvMetaRows([]);
    setCsvSummaryHeaders([]);
    setCsvSummaryRows([]);
    setCsvSessionHeaders([]);
    setCsvSessionRows([]);
    try {
      const q = buildQs("csv", true);
      const r = await fetch(`/api/org/${provider}/${encodeURIComponent(slug)}/export?${q}`, { cache: "no-store" });
      if (!r.ok) {
        setCsvPreviewErr("Could not load CSV preview.");
        return;
      }
      const text = await r.text();
      const rows = parseCsv(text);
      const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));

      const meta = nonEmpty.slice(0, 4);
      const summaryHeaderIdx = nonEmpty.findIndex((r) => r[0] === "summary" || r[0] === "member");
      const sessionHeaderIdx = nonEmpty.findIndex((r) => r[0] === "user_name");

      setCsvMetaRows(meta);

      if (summaryHeaderIdx >= 0) {
        setCsvSummaryHeaders(nonEmpty[summaryHeaderIdx]);
        const sRows = nonEmpty.slice(summaryHeaderIdx + 1, sessionHeaderIdx >= 0 ? sessionHeaderIdx : summaryHeaderIdx + 6);
        setCsvSummaryRows(sRows);
      }

      if (sessionHeaderIdx >= 0) {
        const headers = nonEmpty[sessionHeaderIdx];
        const detailRows: string[][] = [];
        const perMemberLimit = 120;
        const seenPerMember = new Map<string, number>();
        for (let i = sessionHeaderIdx + 1; i < nonEmpty.length; i++) {
          const row = nonEmpty[i];
          if (row[0] === "user_name") continue;
          if (row[0]?.startsWith("member:")) continue;
          if (row[0] === "member" && row[1] === "user_id") continue;
          if (row[0] === "summary") continue;
          if (row[0] === "team") continue;
          if (!(row.length >= 2 && row[0] && row[1] && row[1].length > 10)) continue;

          const member = row[0];
          const current = seenPerMember.get(member) ?? 0;
          if (current >= perMemberLimit) continue;
          detailRows.push(row);
          seenPerMember.set(member, current + 1);
        }
        setCsvSessionHeaders(headers);
        setCsvSessionRows(detailRows);
      }
    } catch {
      setCsvPreviewErr("Could not load CSV preview.");
    } finally {
      setCsvPreviewLoading(false);
    }
  }

  function openPreview() {
    setPreviewTab("pdf");
    setPreviewOpen(true);
    setCsvMetaRows([]);
    setCsvSummaryHeaders([]);
    setCsvSummaryRows([]);
    setCsvSessionHeaders([]);
    setCsvSessionRows([]);
    setCsvPreviewErr(null);
  }

  function download(format: "pdf" | "xlsx") {
    const q = buildQs(format);
    window.location.href = `/api/org/${provider}/${encodeURIComponent(slug)}/export?${q}`;
  }

  return (
    <div className="space-y-6">
      <section className="border border-red-300/30 rounded-md bg-red-500/5 p-5">
        <h2 className="text-sm font-semibold">Prompt Retention</h2>
        <p className="text-xs text-red-200/80 mt-1">Encrypted prompts and responses older than this are eligible for cleanup. This setting can be changed once every 24 hours.</p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-xs text-muted-foreground">
            Days
            <input
              type="number"
              min={7}
              max={365}
              value={retention}
              onChange={(e) => setRetention(e.target.value)}
              onBlur={() => {
                const raw = Number(retention);
                if (!Number.isFinite(raw)) return;
                if (raw < 7) {
                  setRetention("7");
                  setRetentionMsg("Minimum retention is 7 days.");
                  setToast({ kind: "error", text: "Minimum retention is 7 days. Value reset to 7." });
                } else if (raw > 365) {
                  setRetention("365");
                  setRetentionMsg("Maximum retention is 365 days.");
                  setToast({ kind: "error", text: "Maximum retention is 365 days. Value reset to 365." });
                }
              }}
              className="block mt-1 h-9 w-32 px-3 rounded-md border border-red-300/30 bg-background text-sm"
            />
          </label>
          <button
            type="button"
            onClick={saveRetention}
            disabled={isPending}
            className="text-xs h-9 px-4 rounded-md bg-accent text-accent-foreground hover:opacity-90 transition disabled:opacity-50"
          >
            {isPending ? "Saving..." : "Save retention"}
          </button>
        </div>
        {retentionMsg && <p className="text-xs mt-2 text-red-200/80">{retentionMsg}</p>}
      </section>

      <section className="border border-border rounded-md bg-card p-5">
        <h2 className="text-sm font-semibold">Report Export</h2>
        <p className="text-xs text-muted-foreground mt-1">Choose date range and team scope. Preview first, then download PDF or Excel.</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <label className="text-xs text-muted-foreground">
            Display mode
            <select value={viewMode} onChange={(e) => setViewMode(e.target.value as "team" | "member")} className="block mt-1 h-9 w-full px-3 rounded-md border border-border bg-background text-sm">
              <option value="team">Combined team</option>
              <option value="member">Split by member</option>
            </select>
          </label>
        </div>

        <div className="mt-4 border border-border rounded-md p-4">
          <div className="flex items-center gap-4 text-sm">
            <label className="inline-flex items-center gap-2">
              <input type="radio" checked={rangeMode === "days"} onChange={() => setRangeMode("days")} />
              Last N days
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="radio" checked={rangeMode === "custom"} onChange={() => setRangeMode("custom")} />
              Custom range
            </label>
          </div>

          {rangeMode === "days" ? (
            <div className="mt-3">
              <input
                type="number"
                min={1}
                max={365}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                className="h-9 w-32 px-3 rounded-md border border-border bg-background text-sm"
              />
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-xs text-muted-foreground">
                From
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="block mt-1 h-9 w-full px-3 rounded-md border border-border bg-background text-sm" />
              </label>
              <label className="text-xs text-muted-foreground">
                To
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="block mt-1 h-9 w-full px-3 rounded-md border border-border bg-background text-sm" />
              </label>
            </div>
          )}
        </div>

        <div className="mt-4 border border-border rounded-md p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Team Scope</h3>
            <button type="button" onClick={toggleAll} className="text-xs text-accent hover:underline">
              {allSelected ? "Clear all" : "Select all"}
            </button>
          </div>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-auto">
            {members.map((m) => (
              <label key={m.userId} className="flex items-center gap-2 text-sm border border-border rounded px-2 py-1.5 bg-background">
                <input type="checkbox" checked={selected.includes(m.userId)} onChange={() => toggleMember(m.userId)} />
                <span className="truncate">{m.name} {m.login ? `(@${m.login})` : ""}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={openPreview}
            disabled={selected.length === 0}
            className="text-xs h-9 px-4 rounded-md bg-accent text-accent-foreground hover:opacity-90 transition disabled:opacity-50"
          >
            Preview report
          </button>
        </div>
      </section>

      {previewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-md bg-black/55" onClick={(e) => { if (e.target === e.currentTarget) setPreviewOpen(false); }}>
          <div className="bg-card border border-border rounded-md shadow-2xl w-[min(960px,94vw)] max-h-[90vh] overflow-auto p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <img src="/icon.png" alt="Telemetryc" className="h-8 w-8 rounded-sm mt-0.5" />
                <div>
                <h3 className="text-base font-semibold">Report preview</h3>
                <p className="text-xs text-muted-foreground mt-1">Preview PDF or Excel before download.</p>
                </div>
              </div>
              <button className="text-xs h-8 px-3 rounded-md border border-border" onClick={() => setPreviewOpen(false)}>Close</button>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <button
                className={`text-xs h-8 px-3 rounded-md border ${previewTab === "pdf" ? "bg-accent text-accent-foreground border-accent" : "border-border"}`}
                onClick={() => setPreviewTab("pdf")}
              >
                PDF view
              </button>
              <button
                className={`text-xs h-8 px-3 rounded-md border ${previewTab === "excel" ? "bg-accent text-accent-foreground border-accent" : "border-border"}`}
                onClick={() => {
                  setPreviewTab("excel");
                  if (csvMetaRows.length === 0 && csvSessionRows.length === 0 && !csvPreviewLoading) void loadCsvPreview();
                }}
              >
                Excel view
              </button>
            </div>

            <div className="mt-3">
              {previewTab === "pdf" ? (
                <div className="border border-border rounded-md overflow-hidden bg-background">
                  <iframe
                    title="PDF preview"
                    src={`/api/org/${provider}/${encodeURIComponent(slug)}/export?${buildQs("pdf", true)}`}
                    className="w-full h-[62vh]"
                  />
                </div>
              ) : (
                <div className="border border-border rounded-md bg-background p-3">
                  {csvPreviewLoading && <p className="text-sm p-4">Loading Excel preview...</p>}
                  {csvPreviewErr && <p className="text-sm p-4 text-destructive">{csvPreviewErr}</p>}
                  {!csvPreviewLoading && !csvPreviewErr && (
                    <div className="space-y-3">
                      {csvMetaRows.length > 0 && (
                        <div className="overflow-auto">
                          <table className="text-xs min-w-[440px] w-full">
                            <tbody>
                              {csvMetaRows.map((r, i) => (
                                <tr key={i} className="border-b border-border">
                                  <td className="px-2 py-1.5 font-medium text-muted-foreground w-24">{r[0]}</td>
                                  <td className="px-2 py-1.5">{r[1] ?? ""}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {csvSummaryHeaders.length > 0 && (
                        <div className="overflow-auto rounded border border-border">
                          <table className="text-xs min-w-[760px] w-full">
                            <thead className="sticky top-0 bg-muted/70">
                              <tr>
                                {csvSummaryHeaders.map((h, i) => <th key={i} className="text-left px-2 py-1.5 font-semibold whitespace-nowrap border-b border-border">{h}</th>)}
                              </tr>
                            </thead>
                            <tbody>
                              {csvSummaryRows.map((r, i) => (
                                <tr key={i} className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                                  {csvSummaryHeaders.map((_, ci) => <td key={ci} className="px-2 py-1.5 whitespace-nowrap border-b border-border">{r[ci] ?? ""}</td>)}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {csvSessionHeaders.length > 0 && (
                        <div className="rounded border border-border overflow-auto max-h-[42vh] p-2 space-y-3">
                          {groupedSessionRows.map((g, gi) => (
                            <section key={`${g.member}-${gi}`} className="rounded border border-border overflow-auto">
                              <div className="px-2 py-1.5 text-xs font-semibold bg-muted/40 border-b border-border">
                                {g.member} ({g.rows.length} sessions)
                              </div>
                              <table className="text-xs min-w-[1200px] w-full">
                                <thead className="sticky top-0 bg-muted/80 z-10">
                                  <tr>
                                    {csvSessionHeaders.map((h, i) => <th key={i} className="text-left px-2 py-1.5 font-semibold whitespace-nowrap border-b border-border">{h}</th>)}
                                  </tr>
                                </thead>
                                <tbody>
                                  {g.rows.map((r, i) => (
                                    <tr key={i} className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                                      {csvSessionHeaders.map((_, ci) => <td key={ci} className="px-2 py-1.5 whitespace-nowrap border-b border-border">{r[ci] ?? ""}</td>)}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </section>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="text-xs h-9 px-4 rounded-md border border-border" onClick={() => download("xlsx")}>Download Excel</button>
              <button className="text-xs h-9 px-4 rounded-md bg-accent text-accent-foreground" onClick={() => download("pdf")}>Download PDF</button>
            </div>
          </div>
        </div>
      )}

      {cooldownOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 backdrop-blur-md" onClick={(e) => { if (e.target === e.currentTarget) setCooldownOpen(false); }}>
          <div className="w-[min(560px,92vw)] rounded-lg border border-border bg-card p-5 shadow-2xl">
            <h3 className="text-base font-semibold">{cooldownTitle}</h3>
            <p className="text-sm text-muted-foreground mt-2 leading-6">{cooldownBody}</p>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                className="text-xs h-9 px-4 rounded-md bg-accent text-accent-foreground"
                onClick={() => setCooldownOpen(false)}
              >
                Understood
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed left-1/2 top-4 -translate-x-1/2 z-[80] w-[min(460px,88vw)]">
          <div className={`rounded-md border px-4 py-3 shadow-xl backdrop-blur-sm ${
            toast.kind === "error"
              ? "bg-red-500/15 border-red-300/30 text-red-100"
              : "bg-emerald-500/15 border-emerald-300/30 text-emerald-100"
          }`}>
            <div className="flex items-start gap-3">
              <p className="text-xs leading-5 flex-1">{toast.text}</p>
              <button
                type="button"
                aria-label="Dismiss notification"
                className="text-sm leading-none opacity-80 hover:opacity-100"
                onClick={() => setToast(null)}
              >
                ×
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
