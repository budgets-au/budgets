"use client";

import useSWR from "swr";
import { Card, CardContent } from "@/components/ui/card";
import { ExternalLink, AlertCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface NewsItem {
  uuid: string;
  title: string;
  publisher: string | null;
  link: string;
  publishedAt: number | null;
  thumbnail: string | null;
}

interface NewsResponse {
  news: NewsItem[];
  fetchedAt: number | null;
  stale: boolean;
}

/** Recent announcements panel for the investment detail page.
 *  Fetches `/api/investments/<id>/news` which caches for 24h server-
 *  side. The list is read-only — clicking a row opens the source
 *  publisher's page in a new tab. */
export function AnnouncementsPanel({ investmentId }: { investmentId: string }) {
  const { data, isLoading } = useSWR<NewsResponse>(
    `/api/investments/${investmentId}/news`,
    fetcher,
    {
      // Yahoo's news refreshes infrequently; refocus revalidation
      // would just hit our 24h server cache. Off.
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    },
  );

  const items = data?.news ?? [];

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center justify-between mb-2 gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Recent announcements
          </p>
          {data?.fetchedAt && (
            <p className="text-[10px] text-muted-foreground tabular-nums">
              Updated{" "}
              {formatDistanceToNow(new Date(data.fetchedAt), {
                addSuffix: true,
              })}
              {data.stale && " · upstream offline"}
            </p>
          )}
        </div>
        {isLoading ? (
          <p className="text-xs text-muted-foreground py-2">Loading…</p>
        ) : items.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <AlertCircle className="h-3.5 w-3.5" />
            <span>No recent announcements found for this ticker.</span>
          </div>
        ) : (
          <ul className="divide-y">
            {items.map((n) => (
              <li key={n.uuid}>
                <a
                  href={n.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-3 py-2 text-sm hover:bg-muted/30 -mx-2 px-2 rounded transition-colors group"
                >
                  {n.thumbnail ? (
                    // Plain <img> intentionally — Next/Image needs
                    // `remotePatterns` registration in next.config
                    // for every Yahoo CDN host these come from, and
                    // the thumbnails are tiny (140×140) so the lazy-
                    // loaded native <img> is fine.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={n.thumbnail}
                      alt=""
                      className="w-12 h-12 rounded object-cover shrink-0 bg-muted"
                      loading="lazy"
                    />
                  ) : (
                    <span className="w-12 h-12 rounded bg-muted shrink-0 inline-block" />
                  )}
                  <span className="flex-1 min-w-0">
                    <span className="block font-medium leading-snug group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                      {n.title}
                    </span>
                    <span className="block text-[11px] text-muted-foreground mt-0.5 tabular-nums">
                      {n.publisher ?? "Unknown source"}
                      {n.publishedAt && (
                        <>
                          {" · "}
                          {formatDistanceToNow(new Date(n.publishedAt), {
                            addSuffix: true,
                          })}
                        </>
                      )}
                    </span>
                  </span>
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
