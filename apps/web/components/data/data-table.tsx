"use client";
// T4.4 — Generic DataTable. Sortable, sticky header, mobile card-list at <600px.
import React from "react";
import Link from "next/link";

export type Column<T> = {
  id: string;
  header: string;
  accessor: (row: T) => unknown;
  cell?: (row: T) => React.ReactNode;
  sortable?: boolean;
  align?: "left" | "right";
  width?: string;
  mobilePrimary?: boolean;
};

type Sort = { id: string; dir: "asc" | "desc" };

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  initialSort,
  rowHref,
  emptyMessage = "No data",
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  initialSort?: Sort;
  rowHref?: (row: T) => string | undefined;
  emptyMessage?: string;
}): React.ReactElement {
  const [sort, setSort] = React.useState<Sort | undefined>(initialSort);
  const sortedRows = React.useMemo(() => {
    if (!sort) return rows;
    const col = columns.find(c => c.id === sort.id);
    if (!col) return rows;
    const copy = rows.slice();
    copy.sort((a, b) => {
      const av = col.accessor(a);
      const bv = col.accessor(b);
      const cmp =
        av == null ? 1 : bv == null ? -1 : typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, columns, sort]);

  if (rows.length === 0) {
    return (
      <div className="mk-table-cell text-(--muted-foreground) p-6 text-center">{emptyMessage}</div>
    );
  }

  const toggleSort = (id: string) => {
    setSort(prev => {
      if (!prev || prev.id !== id) return { id, dir: "desc" };
      return { id, dir: prev.dir === "desc" ? "asc" : "desc" };
    });
  };

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10 bg-(--card)">
          <tr className="border-b border-(--border)">
            {columns.map(c => {
              const isSort = sort?.id === c.id;
              const align = c.align === "right" ? "text-right" : "text-left";
              return (
                <th
                  key={c.id}
                  className={`mk-table-cell px-3 py-2 font-medium text-(--muted-foreground) ${align}`}
                  style={{ width: c.width }}
                >
                  {c.sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(c.id)}
                      className="inline-flex items-center gap-1 hover:text-(--foreground)"
                      aria-sort={isSort ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"}
                    >
                      {c.header}
                      {isSort ? <span aria-hidden="true">{sort!.dir === "asc" ? "▲" : "▼"}</span> : null}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map(row => {
            const href = rowHref?.(row);
            const k = rowKey(row);
            const body = columns.map(c => {
              const align = c.align === "right" ? "text-right" : "text-left";
              return (
                <td key={c.id} className={`mk-table-cell px-3 py-2 ${align}`}>
                  {c.cell ? c.cell(row) : String(c.accessor(row) ?? "")}
                </td>
              );
            });
            if (href) {
              return (
                <tr key={k} className="border-b border-(--border) hover:bg-(--secondary)">
                  {body.map((cell, i) => (
                    <React.Fragment key={i}>
                      {React.cloneElement(cell as React.ReactElement<any>, {
                        children: (
                          <Link href={href} className="block w-full h-full">
                            {(cell as React.ReactElement<any>).props.children}
                          </Link>
                        ),
                      })}
                    </React.Fragment>
                  ))}
                </tr>
              );
            }
            return (
              <tr key={k} className="border-b border-(--border)">
                {body}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
