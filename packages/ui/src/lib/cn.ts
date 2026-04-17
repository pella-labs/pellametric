import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combine conditional class names and dedupe conflicting Tailwind utilities.
 * Standard shadcn-style helper used everywhere in this package.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
