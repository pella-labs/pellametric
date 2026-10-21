"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "@/lib/auth-client";

const AUTHED_PREFIXES = ["/dashboard", "/org", "/setup", "/onboarding"];

export default function AppBrand() {
  const pathname = usePathname() ?? "";
  const { data, isPending } = useSession();

  const onAuthedRoute = AUTHED_PREFIXES.some(p => pathname === p || pathname.startsWith(p + "/"));
  if (!onAuthedRoute) return null;
  if (isPending || !data?.user) return null;

  const isOnDashboard = pathname === "/dashboard";

  return (
    <Link
      href="/dashboard"
      title="Telemetryc — dashboard"
      aria-label="Telemetryc — go to dashboard"
      aria-current={isOnDashboard ? "page" : undefined}
      className="fixed top-3 left-3 sm:top-4 sm:left-4 z-50 group flex items-center justify-center size-10 rounded-full border border-border bg-background/70 backdrop-blur hover:border-accent/60 hover:bg-card/80 transition shadow-sm"
    >
      <span className="absolute inset-0 rounded-full ring-1 ring-accent/0 group-hover:ring-accent/30 transition" aria-hidden />
      <img
        src="/primary-logo.svg"
        alt=""
        aria-hidden
        className="h-4 w-auto opacity-90 group-hover:opacity-100 transition"
      />
    </Link>
  );
}
