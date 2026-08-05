import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Convert BigInt values to Number for safe JSON serialization */
export function safeJsonParse(data: any): any {
  return JSON.parse(JSON.stringify(data, (_, v) => (typeof v === 'bigint' ? Number(v) : v)));
}
