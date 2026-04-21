import * as React from "react";
import { cn } from "@/lib/utils";

export function Separator({ className, orientation = "horizontal" }: { className?: string; orientation?: "horizontal" | "vertical" }) {
  return <div role="separator" className={cn(orientation === "horizontal" ? "h-px w-full bg-border" : "w-px h-full bg-border", className)} />;
}
