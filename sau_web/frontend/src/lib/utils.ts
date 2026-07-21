import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Escape double quotes in a string so it can be safely placed inside
 * double-quoted CLI arguments.
 */
export function escapeQuotes(s: string): string {
  return s.replace(/"/g, '\\"')
}
