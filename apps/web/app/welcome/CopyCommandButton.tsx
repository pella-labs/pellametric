"use client";

import { Button } from "@bematist/ui";
import { useState } from "react";

/**
 * Copy the install command string to clipboard. Receives the command as a
 * prop straight from the RSC parent — never fetched or stored client-side
 * beyond the live button render. A page reload unmounts the component and
 * the prop is gone.
 */
export function CopyCommandButton({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard denied → surface a tiny error. Falling back to an alert
      // would interrupt the flow; users who can't copy can select the pre
      // block manually.
      setCopied(false);
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={handleCopy}
      className="cursor-pointer"
      aria-label="Copy install command"
    >
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}
