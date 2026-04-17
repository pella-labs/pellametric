"use client";

import type { schemas } from "@bematist/api";
import { type ColumnDef, CostEstimatedChip, FidelityChip, VirtualTable } from "@bematist/ui";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

type Row = schemas.SessionListItem;

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});
const TIME = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function SessionsTable({ rows }: { rows: Row[] }) {
  const router = useRouter();

  const columns = useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      {
        id: "started_at",
        header: "Started",
        size: 200,
        cell: ({ row }) => (
          <time dateTime={row.original.started_at} className="text-muted-foreground">
            {TIME.format(new Date(row.original.started_at))}
          </time>
        ),
      },
      {
        id: "source",
        header: "Source",
        size: 220,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="font-medium">{row.original.source}</span>
            <FidelityChip fidelity={row.original.fidelity} />
          </div>
        ),
      },
      {
        id: "engineer_id",
        header: "Engineer",
        size: 160,
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {row.original.engineer_id}
          </span>
        ),
      },
      {
        id: "duration",
        header: "Duration",
        size: 110,
        cell: ({ row }) =>
          row.original.duration_s === null ? "—" : formatDuration(row.original.duration_s),
      },
      {
        id: "cost",
        header: "Cost",
        size: 160,
        cell: ({ row }) => (
          <span className="flex items-center gap-2 tabular-nums">
            {row.original.cost_estimated && row.original.cost_usd === 0
              ? "—"
              : USD.format(row.original.cost_usd)}
            {row.original.cost_estimated ? <CostEstimatedChip /> : null}
          </span>
        ),
      },
      {
        id: "tokens",
        header: "Tokens (in / out)",
        size: 220,
        cell: ({ row }) => (
          <span className="tabular-nums text-muted-foreground">
            {row.original.input_tokens.toLocaleString()} /{" "}
            {row.original.output_tokens.toLocaleString()}
          </span>
        ),
      },
      {
        id: "accepted_edits",
        header: "Accepts",
        size: 90,
        cell: ({ row }) => <span className="tabular-nums">{row.original.accepted_edits}</span>,
      },
    ],
    [],
  );

  return (
    <VirtualTable
      data={rows}
      columns={columns}
      ariaLabel="Sessions"
      getRowId={(row) => row.session_id}
      onRowClick={(row) => router.push(`/sessions/${row.session_id}`)}
      height="70vh"
      empty={<p className="text-sm text-muted-foreground">No sessions in this window.</p>}
    />
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s === 0 ? `${m}m` : `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm === 0 ? `${h}h` : `${h}h ${mm}m`;
}
