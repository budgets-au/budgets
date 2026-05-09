import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, parseISO } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatAUD(amount: number | string): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
  }).format(num);
}

export function formatDate(date: string | Date): string {
  if (typeof date === "string") {
    return format(parseISO(date), "d MMM yyyy");
  }
  return format(date, "d MMM yyyy");
}

export function formatDateShort(date: string | Date): string {
  if (typeof date === "string") {
    return format(parseISO(date), "d MMM");
  }
  return format(date, "d MMM");
}

export function formatMonthYear(date: string | Date): string {
  if (typeof date === "string") {
    return format(parseISO(date), "MMMM yyyy");
  }
  return format(date, "MMMM yyyy");
}

export function amountClass(amount: number | string): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return num >= 0 ? "text-emerald-600" : "text-red-500";
}

export function diffDaysISO(a: string, b: string): number {
  return Math.round(
    (new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) /
      86_400_000,
  );
}
