import Link from "next/link";
import { Repeat } from "lucide-react";
import { colourForFrequency, freqLabel } from "@/lib/schedule-colours";
import { diffDaysISO, formatDate } from "@/lib/utils";

interface Props {
  scheduledId: string;
  frequency: string;
  interval: number;
  realDate: string;
  scheduledDate: string;
  schedulePayee?: string | null;
}

function driftWords(drift: number): string {
  if (drift === 0) return "on time";
  const abs = Math.abs(drift);
  const noun = abs === 1 ? "day" : "days";
  return `${abs} ${noun} ${drift > 0 ? "late" : "early"}`;
}

export function ScheduledMatchPill({
  scheduledId,
  frequency,
  interval,
  realDate,
  scheduledDate,
  schedulePayee,
}: Props) {
  const drift = diffDaysISO(realDate, scheduledDate);
  const driftSuffix = drift !== 0 ? ` · ${drift > 0 ? "+" : ""}${drift}d` : "";
  const name = schedulePayee?.trim() ? `'${schedulePayee.trim()}'` : "this schedule";
  const tooltip = `Matched to ${name} (${freqLabel(frequency, interval)}) · scheduled ${formatDate(
    scheduledDate,
  )}, posted ${formatDate(realDate)} — ${driftWords(drift)}`;
  return (
    <Link
      href={`/scheduled?id=${scheduledId}`}
      title={tooltip}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-white text-[10px] font-medium whitespace-nowrap hover:opacity-80 transition-opacity shrink-0"
      style={{ backgroundColor: colourForFrequency(frequency) }}
    >
      <Repeat className="h-2.5 w-2.5" aria-hidden="true" />
      <span>{freqLabel(frequency, interval)}{driftSuffix}</span>
    </Link>
  );
}
