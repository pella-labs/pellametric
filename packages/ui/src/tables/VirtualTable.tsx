// biome-ignore-all lint/a11y/useSemanticElements: native <table> breaks the virtualizer — see the doc comment on VirtualTable below.
// biome-ignore-all lint/a11y/useFocusableInteractive: rows receive tabIndex=0 when clickable; header rows intentionally non-focusable.
"use client";

import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import { cn } from "../lib/cn";

export interface VirtualTableProps<T> {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  /** Fixed pixel height of each row; picks virtualization buffer windows. */
  rowHeight?: number;
  /** Height of the scrollable viewport. Virtualization only pays off when set. */
  height?: number | string;
  /** Stable row id — default is index-based, fine for fixture lists. */
  getRowId?: (row: T, index: number) => string;
  /** Called when a row is clicked; rows become keyboard-focusable if passed. */
  onRowClick?: (row: T) => void;
  /** Renders when `data.length === 0`. */
  empty?: React.ReactNode;
  /** Aria label for the table; defaults to "Table". */
  ariaLabel?: string;
  className?: string;
}

/**
 * Virtualized list styled as a table. TanStack v8 builds the row/column model;
 * `@tanstack/react-virtual` paints only the rows inside the scroll window.
 *
 * Built on divs + ARIA `role="table|rowgroup|row|columnheader|cell"` rather
 * than native `<table>` — absolute-positioned virtualized rows fight with
 * `<table>`'s auto-column sizing (each row starts a fresh table context and
 * tracks don't line up with the header). Semantics hold via ARIA; column
 * widths flow from `columnDef.size` so header and rows share the layout.
 *
 * Plain native overflow container — Radix ScrollArea's inner content
 * wrapper (`display:table; min-width:100%`) fights with absolute-positioned
 * virtualized rows, so we keep the scroll primitive simple and dress up the
 * native scrollbar with `::-webkit-scrollbar` utilities to match shadcn's
 * overlay look.
 */
export function VirtualTable<T>({
  data,
  columns,
  rowHeight = 44,
  height = 560,
  getRowId,
  onRowClick,
  empty,
  ariaLabel = "Table",
  className,
}: VirtualTableProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    ...(getRowId ? { getRowId: (row: T, index: number) => getRowId(row, index) } : {}),
  });

  const rows = table.getRowModel().rows;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
  });

  if (rows.length === 0 && empty) {
    return (
      <div className={cn("rounded-xl border border-border bg-card p-6", className)}>{empty}</div>
    );
  }

  const totalSize = virtualizer.getTotalSize();

  return (
    <div
      ref={scrollRef}
      role="table"
      aria-label={ariaLabel}
      className={cn(
        "relative overflow-y-auto overflow-x-hidden rounded-xl border border-border text-sm",
        // Thin overlay-style scrollbar matching the shadcn ScrollArea look.
        "[&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/60",
        className,
      )}
      style={{ height }}
    >
      <div role="rowgroup" className="sticky top-0 z-10 bg-background">
        {table.getHeaderGroups().map((headerGroup) => (
          <div key={headerGroup.id} role="row" className="flex border-b border-border">
            {headerGroup.headers.map((header) => (
              <div
                key={header.id}
                role="columnheader"
                style={{
                  flex: `${header.getSize()} 1 ${header.getSize()}px`,
                  minWidth: 60,
                }}
                className="truncate px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"
              >
                {header.isPlaceholder
                  ? null
                  : flexRender(header.column.columnDef.header, header.getContext())}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div
        role="rowgroup"
        style={{
          position: "relative",
          height: totalSize,
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (!row) return null;
          const clickable = Boolean(onRowClick);
          return (
            <div
              key={row.id}
              role="row"
              data-index={virtualRow.index}
              tabIndex={clickable ? 0 : undefined}
              onClick={clickable ? () => onRowClick?.(row.original) : undefined}
              onKeyDown={
                clickable
                  ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onRowClick?.(row.original);
                      }
                    }
                  : undefined
              }
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: virtualRow.size,
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className={cn(
                "flex border-b border-border/60 text-foreground",
                clickable &&
                  "cursor-pointer transition-colors hover:bg-muted focus:bg-muted focus:outline-none",
              )}
            >
              {row.getVisibleCells().map((cell) => (
                <div
                  key={cell.id}
                  role="cell"
                  style={{
                    flex: `${cell.column.getSize()} 1 ${cell.column.getSize()}px`,
                    minWidth: 60,
                  }}
                  className="flex items-center truncate px-3"
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export type { ColumnDef } from "@tanstack/react-table";
