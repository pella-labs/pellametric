"use client";

import { useEffect, useState } from "react";
import { CardPage } from "./CardPage";
import type { CardData } from "./card-utils";

/**
 * Client-only mount wrapper. CardPage reads browser-only globals during
 * render, so we suppress the server render. Pre-hydration we return null
 * — the card itself handles its own intro animation once data is ready.
 */
export function CardMount({
  demoData,
  compact,
  autoAdvanceMs,
}: {
  demoData?: CardData;
  compact?: boolean;
  autoAdvanceMs?: number;
} = {}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  const props: { demoData?: CardData; compact?: boolean; autoAdvanceMs?: number } = {};
  if (demoData !== undefined) props.demoData = demoData;
  if (compact !== undefined) props.compact = compact;
  if (autoAdvanceMs !== undefined) props.autoAdvanceMs = autoAdvanceMs;
  return <CardPage {...props} />;
}
