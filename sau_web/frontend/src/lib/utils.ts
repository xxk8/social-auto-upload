import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** shadcn/ui className merge helper. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const escapeQuotes = (s: string): string =>
  s.replace(/"/g, '\\"').replace(/'/g, "\\'")

export default cn
