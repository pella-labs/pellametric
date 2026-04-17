import type { Metadata } from "next";
import { BILL_OF_RIGHTS, BILL_OF_RIGHTS_VERSION } from "./bill-of-rights";

export const metadata: Metadata = {
  title: "Bill of Rights",
  description:
    "The six guarantees Bematist makes to every engineer whose machine runs the collector.",
};

export default function BillOfRightsPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
          Bematist · Bill of Rights ·{" "}
          <span data-version={BILL_OF_RIGHTS_VERSION}>{BILL_OF_RIGHTS_VERSION}</span>
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">What we promise every engineer</h1>
        <p className="text-sm text-muted-foreground">
          These six rules are load-bearing — they show up in the code (display gates, audit writes,
          tier defaults) and in our works-council templates. They are not marketing. If you ever see
          the product behave contrary to one of them, file a ticket: that is a bug.
        </p>
      </header>

      <ol className="flex flex-col gap-6">
        {BILL_OF_RIGHTS.map((item, i) => (
          <li
            key={item.id}
            id={item.id}
            className="flex flex-col gap-2 border-l-2 border-primary pl-4"
          >
            <h2 className="flex items-baseline gap-3 text-lg font-semibold">
              <span className="font-mono text-sm text-muted-foreground" aria-hidden>
                {String(i + 1).padStart(2, "0")}
              </span>
              {item.title}
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">{item.body}</p>
          </li>
        ))}
      </ol>

      <footer className="border-t border-border pt-4 text-xs text-muted-foreground">
        <p>
          Wording version <code className="font-mono">{BILL_OF_RIGHTS_VERSION}</code>. If these
          promises change, the version bumps — external links keep pointing at the wording they were
          written against.
        </p>
      </footer>
    </main>
  );
}
