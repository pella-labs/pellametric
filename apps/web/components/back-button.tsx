import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function BackButton({ href, label = "back" }: { href: string; label?: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className="inline-flex items-center justify-center size-9 rounded-full border border-border bg-card hover:bg-popover hover:border-primary/40 text-muted-foreground hover:text-foreground transition"
    >
      <ArrowLeft className="size-4" />
    </Link>
  );
}
