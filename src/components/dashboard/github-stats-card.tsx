"use client";

import useSWR from "swr";
import { Download, Package, Star } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const fetcher = async <T,>(url: string): Promise<T> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
};

interface StatsResp {
  downloads?: number | null;
  stars?: number | null;
  error?: string;
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | null | undefined;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-0.5">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
        {icon}
        {label}
      </span>
      <span className="text-2xl font-bold tabular-nums">
        {value == null ? "—" : value.toLocaleString()}
      </span>
    </div>
  );
}

/** Dashboard widget — scrapes the public GHCR package page for
 *  the budgets container's total downloads + the repo's star
 *  count. No auth required; both numbers are visible in the
 *  page HTML. See `/api/github-stats` for the extractor +
 *  hourly cache. */
export function GithubStatsCard() {
  const { data, isLoading } = useSWR<StatsResp>(
    "/api/github-stats",
    fetcher,
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  return (
    <Card data-size="sm" className="h-full flex flex-col">
      <CardHeader className="pb-1 shrink-0">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
          <Package className="h-3.5 w-3.5" />
          <a
            href="https://github.com/budgets-au/budgets"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            budgets · GitHub
          </a>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 flex flex-col justify-between">
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : data?.error ? (
          <p className="text-xs text-muted-foreground leading-snug">
            Unavailable ({data.error}).
          </p>
        ) : (
          <div className="flex-1 grid grid-cols-2 gap-2 items-center">
            <Stat
              icon={<Download className="h-3 w-3" />}
              label="Downloads"
              value={data?.downloads ?? null}
            />
            <Stat
              icon={<Star className="h-3 w-3" />}
              label="Stars"
              value={data?.stars ?? null}
            />
          </div>
        )}
        <p className="text-[10px] text-muted-foreground tabular-nums truncate mt-1">
          <a
            href="https://github.com/budgets-au/budgets/pkgs/container/budgets"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            ghcr.io/budgets-au/budgets
          </a>
        </p>
      </CardContent>
    </Card>
  );
}
