"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { useAccountFilter } from "@/hooks/use-account-filter";
import useSWR from "swr";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  eachDayOfInterval,
  getDay,
  addDays,
  addMonths,
  subMonths,
  isSameMonth,
  isToday,
  parseISO,
  differenceInCalendarDays,
} from "date-fns";
import {
  ComposedChart,
  Area,
  AreaChart,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatAUD, formatDateShort, amountClass, cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Info } from "lucide-react";
import type { DailyBalance, AccountSeries } from "@/lib/cashflow";
import { summarizeDay } from "@/lib/cashflow";
import { colourForFrequency } from "@/lib/schedule-colours";
import { ScheduledMatchPill } from "@/components/transactions/scheduled-match-pill";
import {
  ScheduledTransactionRow,
  TransactionRow,
  TransactionsTableHeader,
  compareScheduled,
  compareTransactions,
  type ScheduledRowEvent,
  type TransactionRowData,
  type TransactionSortState,
} from "@/components/transactions/transaction-row";
import { useDisplayPrefs } from "@/hooks/use-display-prefs";

interface CashflowApi {
  daily: DailyBalance[];
  perAccount: AccountSeries[];
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function toISO(d: Date) {
  return format(d, "yyyy-MM-dd");
}

function cashflowUrl(from: string, to: string, ids: string[]) {
  const p = new URLSearchParams({ from, to });
  if (ids.length) p.set("accountIds", ids.join(","));
  return `/api/cashflow?${p}`;
}

export function CashflowCalendar({
  accounts,
}: {
  accounts: { id: string; name: string; color: string }[];
}) {
  // The account filter now lives in the global sidebar; we just consume it.
  const { ids: accountIds } = useAccountFilter();
  // Linked-counterpart detail toggle in the day-detail panel — reuses the
  // same display pref the main /transactions list reads so flipping the
  // toggle in Settings → General affects both views consistently.
  const { prefs: displayPrefs } = useDisplayPrefs();
  const [month, setMonth] = useState(new Date());
  // Day detail panel selection. Defaults to today; click a calendar cell to
  // change it. Stored as ISO date string so equality comparison is trivial.
  // The useState initializer can hydrate with the server's date if the
  // server and client timezones disagree — the mount effect below pins it
  // to the client's today on FIRST mount only. Subsequent renders (e.g.
  // navigating away and back via the App Router) keep whatever the user
  // had selected, so we don't silently throw away their navigation state.
  const [selectedDate, setSelectedDate] = useState<string>(toISO(new Date()));
  const didHydrateClientTodayRef = useRef(false);
  useEffect(() => {
    if (didHydrateClientTodayRef.current) return;
    didHydrateClientTodayRef.current = true;
    const clientToday = toISO(new Date());
    // Only override the SSR-rendered placeholder if the client's date
    // differs (timezone or post-midnight). If they already match, leave
    // the state alone so we don't trigger an unnecessary re-render.
    if (selectedDate !== clientToday) {
      setSelectedDate(clientToday);
      setMonth(new Date());
      setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }));
    }
    // Mount-only — ref guard above stops re-runs if React strict mode
    // double-invokes the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Chart visible range as ISO dates — single source of truth for what the
  // main chart paints. Preset buttons centre the window on today; the brush
  // below the chart sets it at day precision.
  const [chartFrom, setChartFrom] = useState(() =>
    toISO(addDays(new Date(), -45)),
  );
  const [chartTo, setChartTo] = useState(() =>
    toISO(addDays(new Date(), 45)),
  );
  // Snap the visible window to ±halfDays from today. Used by the 1m/3m/6m
  // quick-range buttons.
  function setWindowHalfDays(halfDays: number) {
    const today = new Date();
    setChartFrom(toISO(addDays(today, -halfDays)));
    setChartTo(toISO(addDays(today, halfDays)));
  }
  // Highlight whichever preset matches the current window (centred on today
  // with the expected half-day span). Brush edits leave none selected.
  const todayISO = useMemo(() => toISO(new Date()), []);
  function isPresetActive(halfDays: number): boolean {
    return (
      chartFrom === toISO(addDays(parseISO(todayISO), -halfDays)) &&
      chartTo === toISO(addDays(parseISO(todayISO), halfDays))
    );
  }
  const [viewMode, setViewMode] = useState<"month" | "week">("month");

  // Track lg+ via matchMedia rather than CSS @media inside a named class —
  // the latter has been dropped by Safari multiple times. isLgUp drives the
  // inline style on the calendar grid below.
  const [isLgUp, setIsLgUp] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsLgUp(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  const [weekStart, setWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 }),
  );
  // Persist the month/week toggle across sessions. Read in an effect (not in
  // the initializer) so the SSR-rendered "month" default matches the first
  // client paint and avoids a hydration mismatch.
  useEffect(() => {
    const saved = localStorage.getItem("cashflow-calendar-view");
    if (saved === "month" || saved === "week") setViewMode(saved);
  }, []);
  useEffect(() => {
    localStorage.setItem("cashflow-calendar-view", viewMode);
  }, [viewMode]);

  const calFrom = toISO(viewMode === "month" ? startOfMonth(month) : weekStart);
  const calTo = toISO(viewMode === "month" ? endOfMonth(month) : addDays(weekStart, 6));

  const { data: calData } = useSWR<CashflowApi>(
    cashflowUrl(calFrom, calTo, accountIds),
    fetcher,
  );
  const calDaily = calData?.daily ?? [];

  const { data: chartApi, isLoading: chartLoading } = useSWR<CashflowApi>(
    cashflowUrl(chartFrom, chartTo, accountIds),
    fetcher,
  );
  const chartDaily = chartApi?.daily ?? [];
  const perAccount = chartApi?.perAccount ?? [];

  // Overview/brush dataset: spans the entire transactions corpus (from=auto
  // resolves to MIN(date) on the server) through 3 months past today, with
  // accountIds applied so the running total reflects the active filter.
  // Brush window: a fixed 12-month span centred-ish on today (9 months
  // back, 3 months forward). Bounded rather than "auto"=since-first-txn
  // so the brush always shows the same horizontal density and the
  // operator can scrub through their immediate history without
  // navigating through years of older data.
  const overviewFrom = useMemo(() => toISO(subMonths(new Date(), 9)), []);
  const overviewTo = useMemo(() => toISO(addMonths(new Date(), 3)), []);
  const { data: overviewApi } = useSWR<CashflowApi>(
    cashflowUrl(overviewFrom, overviewTo, accountIds),
    fetcher,
    { keepPreviousData: true },
  );
  const overviewDaily = overviewApi?.daily ?? [];
  // Downsample the overview to a fixed budget of points. The brush strip is
  // only 60 px tall — sub-day resolution isn't visible, and rendering 600+
  // points each frame while dragging visibly lags. Always keep the last row
  // so the chart spans precisely to today+3mo, not stride-truncated.
  const OVERVIEW_TARGET_POINTS = 200;
  const overviewChartData = useMemo(() => {
    if (overviewDaily.length === 0) return [];
    const stride = Math.max(1, Math.ceil(overviewDaily.length / OVERVIEW_TARGET_POINTS));
    if (stride === 1) {
      return overviewDaily.map((d) => ({ date: d.date, balance: d.balance }));
    }
    const out: { date: string; balance: number }[] = [];
    for (let i = 0; i < overviewDaily.length; i += stride) {
      out.push({ date: overviewDaily[i].date, balance: overviewDaily[i].balance });
    }
    const lastSrc = overviewDaily[overviewDaily.length - 1];
    if (out[out.length - 1].date !== lastSrc.date) {
      out.push({ date: lastSrc.date, balance: lastSrc.balance });
    }
    return out;
  }, [overviewDaily]);
  // Map chartFrom/chartTo back to the index in overviewChartData so the
  // overlay handles know where to position. On account/date changes this
  // recomputes; the handles always reflect the current visible window.
  // While the user is dragging a brush handle, we don't update chartFrom/
  // chartTo directly — that would refetch + repaint the main chart on every
  // pointer move (a 600+-point ComposedChart with multiple series → visible
  // lag). Instead the live cursor position is held in `dragRange`; the
  // overview's handles + grey overlays read from this draft, so they track
  // the cursor smoothly. On pointerup we commit once into chartFrom/chartTo
  // and the main chart fetches/renders a single time.
  const [dragRange, setDragRange] = useState<{ from: string; to: string } | null>(null);
  const visibleFrom = dragRange?.from ?? chartFrom;
  const visibleTo = dragRange?.to ?? chartTo;

  const brushIndices = useMemo(() => {
    if (overviewChartData.length === 0) return { start: 0, end: 0 };
    let start = overviewChartData.findIndex((d) => d.date >= visibleFrom);
    if (start === -1) start = 0;
    let end = overviewChartData.length - 1;
    for (let i = overviewChartData.length - 1; i >= 0; i--) {
      if (overviewChartData[i].date <= visibleTo) { end = i; break; }
    }
    if (end < start) end = start;
    return { start, end };
  }, [overviewChartData, visibleFrom, visibleTo]);

  // Custom drag overlay. Three interaction zones:
  //   "min"    — drag the left handle, resizes the window from its start.
  //   "max"    — drag the right handle, resizes the window from its end.
  //   "window" — drag the active middle zone, translates BOTH edges by the
  //              same amount (preserves window width). Clamps so the window
  //              can't be pushed past the data boundaries.
  // Pointer events are wired to the window so a drag continues even if the
  // cursor leaves the hitbox. The draft `dragRange` is mirrored into a ref so
  // the long-lived move/up closures read live state instead of the snapshot
  // taken at startDrag.
  const overviewContainerRef = useRef<HTMLDivElement>(null);
  const dragRangeRef = useRef<{ from: string; to: string } | null>(null);
  // If the component unmounts mid-drag, the move/up listeners survive on
  // window and would fire setState on an unmounted component when the
  // pointer is finally released. Stash the cleanup callback and run it
  // from a mount-effect's cleanup phase.
  const dragCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanupRef.current?.(), []);
  function startDrag(mode: "min" | "max" | "window", e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const container = overviewContainerRef.current;
    if (!container || overviewChartData.length === 0) return;
    const rect = container.getBoundingClientRect();
    const last = overviewChartData.length - 1;
    const initial = { from: chartFrom, to: chartTo };
    dragRangeRef.current = initial;
    setDragRange(initial);

    // Window-pan needs the cursor's starting x AND the window's starting
    // indices so each move event computes an absolute delta from the
    // pointerdown position — using "since last move" deltas drifts.
    const startX = e.clientX;
    const startStart = brushIndices.start;
    const startEnd = brushIndices.end;
    const span = startEnd - startStart;

    const move = (ev: PointerEvent) => {
      const cur = dragRangeRef.current;
      if (!cur) return;
      let next: { from: string; to: string };

      if (mode === "window") {
        const dx = ev.clientX - startX;
        const fractionDelta = rect.width === 0 ? 0 : dx / rect.width;
        const idxDelta = Math.round(fractionDelta * last);
        let s = startStart + idxDelta;
        let e2 = startEnd + idxDelta;
        if (s < 0) { s = 0; e2 = span; }
        if (e2 > last) { e2 = last; s = last - span; }
        next = {
          from: overviewChartData[s]?.date ?? cur.from,
          to: overviewChartData[e2]?.date ?? cur.to,
        };
      } else {
        const x = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
        const fraction = rect.width === 0 ? 0 : x / rect.width;
        const idx = Math.round(fraction * last);
        // Clamp against the OTHER handle's current position so handles can't
        // cross. Using the live ref means a min-drag respects an in-flight
        // max change and vice versa.
        const otherStart = overviewChartData.findIndex((d) => d.date >= cur.from);
        let otherEnd = last;
        for (let i = last; i >= 0; i--) {
          if (overviewChartData[i].date <= cur.to) { otherEnd = i; break; }
        }
        if (mode === "min") {
          const safe = Math.max(0, Math.min(idx, otherEnd - 1));
          next = { from: overviewChartData[safe]?.date ?? cur.from, to: cur.to };
        } else {
          const safe = Math.min(last, Math.max(idx, otherStart + 1));
          next = { from: cur.from, to: overviewChartData[safe]?.date ?? cur.to };
        }
      }

      if (next.from === cur.from && next.to === cur.to) return;
      dragRangeRef.current = next;
      setDragRange(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      dragCleanupRef.current = null;
      // Commit final position once → single SWR refetch + main chart repaint.
      const final = dragRangeRef.current;
      dragRangeRef.current = null;
      setDragRange(null);
      if (final) {
        if (final.from !== chartFrom) setChartFrom(final.from);
        if (final.to !== chartTo) setChartTo(final.to);
      }
    };
    // Pure cleanup — used on unmount to drop the listeners without
    // touching state on the no-longer-mounted component.
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      dragRangeRef.current = null;
      dragCleanupRef.current = null;
    };
    dragCleanupRef.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }
  // Handle x-position as a percentage of container width — the chart's plot
  // area uses the full container (axes hidden, margins=0) so this lines up
  // with the data points underneath.
  const lastIdx = Math.max(1, overviewChartData.length - 1);
  const minHandlePct = (brushIndices.start / lastIdx) * 100;
  const maxHandlePct = (brushIndices.end / lastIdx) * 100;

  // Shared "select this day" handler used by both the chart-level onClick
  // (background of the plot area) and the per-Area onClick (the colored
  // band itself). Going via a single helper avoids logic drift.
  function selectChartDay(iso: string) {
    setSelectedDate(iso);
    const target = parseISO(iso);
    if (viewMode === "month") {
      setMonth(target);
    } else {
      setWeekStart(startOfWeek(target, { weekStartsOn: 1 }));
    }
  }

  // When the calendar's selected day falls outside the brush window, expand
  // chartFrom/chartTo so the indigo "Selected" highlight becomes visible.
  // The latest range is read via a ref so this effect only re-runs when
  // selectedDate itself changes — the user can still narrow the brush
  // afterwards without an auto re-expansion fight.
  const rangeRef = useRef({ chartFrom, chartTo });
  rangeRef.current = { chartFrom, chartTo };
  useEffect(() => {
    const { chartFrom: f, chartTo: t } = rangeRef.current;
    // Pad by a week so the selected day sits inside the chart instead of
    // hugging the edge — leaves visible context on either side.
    if (selectedDate < f) {
      setChartFrom(toISO(addDays(parseISO(selectedDate), -7)));
    } else if (selectedDate > t) {
      setChartTo(toISO(addDays(parseISO(selectedDate), 7)));
    }
  }, [selectedDate]);

  const byDate = useMemo(() => {
    const m = new Map<string, DailyBalance>();
    for (const d of calDaily) m.set(d.date, d);
    return m;
  }, [calDaily]);

  // Match scheduled occurrences to the real transactions that fulfilled them
  // (within ±MATCH_TOLERANCE_DAYS). Computed once over the whole loaded month
  // so the calendar grid and the day-detail panel both see the same outcome:
  //   - real txn that was claimed by a scheduled  → dot moves to its day
  //   - scheduled occurrence that was claimed     → no dot on its scheduled day
  const { claimedReal, claimedSched, realToSched } = useMemo(
    () => matchScheduledToReal(byDate),
    [byDate],
  );

  // Frequency / payee lookup so matched real rows can render the schedule pill.
  // Keyed by scheduledTransaction.id; same SWR key the transactions list uses,
  // so the response is cached across views.
  const { data: scheduledList = [] } = useSWR<
    { id: string; frequency: string; interval: number; payee: string | null }[]
  >("/api/scheduled", fetcher);
  const scheduledById = useMemo(() => {
    const m = new Map<string, { frequency: string; interval: number; payee: string | null }>();
    for (const s of scheduledList) m.set(s.id, { frequency: s.frequency, interval: s.interval, payee: s.payee });
    return m;
  }, [scheduledList]);

  const monthDays = eachDayOfInterval({
    start: startOfMonth(month),
    end: endOfMonth(month),
  });
  const firstDayOfWeek = (getDay(startOfMonth(month)) + 6) % 7;
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );
  const accountById = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts],
  );

  // Reshape into a wide-format dataset where each row is a date and each
  // account has its own column. Recharts then plots one Line per column.
  const chartData = useMemo(() => {
    const rows: Record<string, number | string>[] = [];
    const dailyByDate = new Map(chartDaily.map((d) => [d.date, d]));
    const accountSeriesByDate = new Map<string, Map<string, number>>();
    for (const a of perAccount) {
      const m = new Map<string, number>();
      for (const d of a.daily) m.set(d.date, d.balance);
      accountSeriesByDate.set(a.id, m);
    }
    // Walk the chartDaily date sequence; per-account balances are looked up
    // separately for stability when accounts have different date coverage.
    for (const d of chartDaily) {
      const row: Record<string, number | string> = {
        date: formatDateShort(d.date),
        rawDate: d.date,
        net: d.events.reduce((s, e) => s + e.amount, 0),
        total: d.balance,
      };
      for (const a of perAccount) {
        row[`a_${a.id}`] = accountSeriesByDate.get(a.id)?.get(d.date) ?? 0;
      }
      rows.push(row);
      // (referenced for completeness; dailyByDate currently unused)
      void dailyByDate;
    }
    return rows;
  }, [chartDaily, perAccount]);

  // Day-span maps to roughly the same tick density the old month-based
  // sliders produced (1mo ≈ 31d, 3mo ≈ 92d).
  const spanDays = differenceInCalendarDays(parseISO(chartTo), parseISO(chartFrom)) + 1;
  const tickInterval =
    spanDays <= 31 ? 5
    : spanDays <= 92 ? 13
    : Math.max(1, Math.floor(chartData.length / 7));

  // Domain for the Y-axis. Without an explicit domain Recharts computes
  // its own ticks against the per-account `a_*` series only and the
  // tickFormatter was hard-coded to `$Nk` — when balances sit under $1k
  // it rendered all ticks as `$0k`. Compute the real min/max across
  // every account column, pad to a "nice" round step, then format the
  // tick with a scale-aware suffix.
  const yDomain = useMemo<[number, number]>(() => {
    if (chartData.length === 0 || perAccount.length === 0) return [0, 0];
    let min = Infinity;
    let max = -Infinity;
    for (const row of chartData) {
      for (const a of perAccount) {
        const v = row[`a_${a.id}`];
        if (typeof v === "number") {
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
    }
    if (!isFinite(min) || !isFinite(max)) return [0, 0];
    if (min === max) {
      // Single-value series — pad a token range around it so the line
      // isn't flat-on-axis.
      const pad = Math.max(10, Math.abs(min) * 0.1);
      return [min - pad, max + pad];
    }
    // Round outward to a "nice" step so the tick labels land on
    // human-readable numbers ($1k, $13k, $20k, $1.2m, …) regardless
    // of the underlying scale.
    const span = max - min;
    const niceStep = Math.pow(10, Math.floor(Math.log10(span / 5)));
    const niceMin = Math.floor(min / niceStep) * niceStep;
    const niceMax = Math.ceil(max / niceStep) * niceStep;
    return [niceMin, niceMax];
  }, [chartData, perAccount]);

  // Format a single Y-axis tick with the smallest unit that keeps
  // the label crisp. `$1.2k` / `$13k` / `$1.2m` etc.
  function formatYTick(v: number): string {
    const abs = Math.abs(v);
    if (abs >= 1_000_000) {
      const m = v / 1_000_000;
      return `$${Math.abs(m) >= 10 ? m.toFixed(0) : m.toFixed(1)}m`;
    }
    if (abs >= 1_000) {
      const k = v / 1_000;
      return `$${Math.abs(k) >= 10 ? k.toFixed(0) : k.toFixed(1)}k`;
    }
    return `$${Math.round(v)}`;
  }

  // Calendar-selection highlight — when the user picks a day in the grid,
  // surface it on the chart so the two views stay in sync. Resolves to
  // undefined (no highlight rendered) when the selected day isn't in the
  // visible chart window.
  const selectedLabel = chartData.find((r) => r.rawDate === selectedDate)?.date as
    | string
    | undefined;
  // Tomorrow marks the transition between computed (past + today) and
  // projected (future, scheduled-derived) values. We anchor the divider line
  // at tomorrow's column so it visually sits to the right of today's bar —
  // i.e. "everything to the right of this line is projection".
  const tomorrowISO = toISO(addDays(new Date(), 1));
  const projectionStartLabel =
    chartData.find((r) => r.rawDate === tomorrowISO)?.date as string | undefined;
  // Fraction of the chart's horizontal extent where today sits — used
  // by the per-account gradient fills so the projected portion of each
  // area renders at a different alpha than the realised portion. When
  // today is off the visible window, the value is null and the
  // per-account fills fall back to a uniform colour.
  const todayFractionPct = useMemo<number | null>(() => {
    if (chartData.length === 0) return null;
    // Find the first row whose rawDate is on/after today.
    const idx = chartData.findIndex(
      (r) => (r.rawDate as string) >= todayISO,
    );
    if (idx === -1) return 100; // today is past the right edge — entire chart is "real"
    return (idx / Math.max(1, chartData.length - 1)) * 100;
  }, [chartData, todayISO]);

  // Overview / zoom controller. The whole dataset (earliest txn →
  // today + 3 months) is painted full-width as a coloured running total.
  // Two ReferenceAreas grey out regions the main chart isn't currently
  // showing; two custom slider handles overlay the strip and drive
  // chartFrom/chartTo when dragged. Lives above the day-detail (or week)
  // panel so the brush sits next to the content the user is steering.
  // Colours are inline hex (not theme tokens) because this theme's
  // --primary is a near-black neutral that washes out at low opacity —
  // the overview wants a vivid accent.
  //
  // The grey-out overlay is plain black at 0.65 — a transparent darken
  // layer over the indigo running-total. The earlier theme-aware variant
  // rendered solid in dark mode rather than reading as "dimmed", so this
  // stays uniform.
  const overviewBrush =
    overviewChartData.length > 0 ? (
      <div
        ref={overviewContainerRef}
        className="relative select-none overflow-visible shrink-0"
      >
        <ResponsiveContainer width="100%" height={60}>
          <AreaChart
            data={overviewChartData}
            margin={{ top: 2, right: 0, left: 0, bottom: 2 }}
          >
            <XAxis dataKey="date" hide padding={{ left: 0, right: 0 }} />
            <YAxis hide />
            <Area
              type="monotone"
              dataKey="balance"
              stroke="#6366f1"
              strokeWidth={1}
              fill="#6366f1"
              fillOpacity={0.35}
              isAnimationActive={false}
              dot={false}
              activeDot={false}
            />
            {brushIndices.start > 0 && (
              <ReferenceArea
                x1={overviewChartData[0].date}
                x2={overviewChartData[brushIndices.start].date}
                fill="#000000"
                fillOpacity={0.65}
                stroke="none"
                ifOverflow="visible"
              />
            )}
            {brushIndices.end < overviewChartData.length - 1 && (
              <ReferenceArea
                x1={overviewChartData[brushIndices.end].date}
                x2={overviewChartData[overviewChartData.length - 1].date}
                fill="#000000"
                fillOpacity={0.65}
                stroke="none"
                ifOverflow="visible"
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
        <div
          role="button"
          aria-label="Drag visible window"
          onPointerDown={(e) => startDrag("window", e)}
          className="absolute top-0 bottom-0 z-10 cursor-grab active:cursor-grabbing border border-indigo-500/50 rounded-sm"
          style={{
            left: `${minHandlePct}%`,
            width: `${maxHandlePct - minHandlePct}%`,
            touchAction: "none",
            background: "transparent",
          }}
          title={`${overviewChartData[brushIndices.start]?.date} → ${overviewChartData[brushIndices.end]?.date}`}
        />
        <div
          role="slider"
          aria-label="Chart range start"
          aria-valuemin={0}
          aria-valuemax={lastIdx}
          aria-valuenow={brushIndices.start}
          onPointerDown={(e) => startDrag("min", e)}
          className="absolute top-0 bottom-0 w-1.5 -translate-x-1/2 cursor-ew-resize z-20 rounded-sm shadow ring-1 ring-white/70 dark:ring-white/30 border border-white/40 dark:border-black/40"
          style={{
            left: `clamp(4px, ${minHandlePct}%, calc(100% - 4px))`,
            backgroundColor: "#4f46e5",
            touchAction: "none",
          }}
          title={overviewChartData[brushIndices.start]?.date}
        />
        <div
          role="slider"
          aria-label="Chart range end"
          aria-valuemin={0}
          aria-valuemax={lastIdx}
          aria-valuenow={brushIndices.end}
          onPointerDown={(e) => startDrag("max", e)}
          className="absolute top-0 bottom-0 w-1.5 -translate-x-1/2 cursor-ew-resize z-20 rounded-sm shadow ring-1 ring-white/70 dark:ring-white/30 border border-white/40 dark:border-black/40"
          style={{
            left: `clamp(4px, ${maxHandlePct}%, calc(100% - 4px))`,
            backgroundColor: "#4f46e5",
            touchAction: "none",
          }}
          title={overviewChartData[brushIndices.end]?.date}
        />
      </div>
    ) : null;

  // The chart Card is used by both month and week modes. Extracted as a JSX
  // value so both branches can drop it into their layout without duplicating
  // its content. The brush is embedded inside the CardContent (bottom-right,
  // half width) so its drag controls live next to the chart it steers.
  // The chart's title, subtitle and preset chips all live at the
  // bottom-left now, next to the brush — so the top of the card is all
  // chart and the controls are clustered with the brush they steer.
  const chartHeaderBlock = (
    <div className="flex-1 min-w-0 space-y-1.5">
      <div>
        <p className="text-sm font-medium leading-tight">Account Balances</p>
        <p className="text-xs text-muted-foreground leading-tight">
          One line per account · past = computed · future = projected
        </p>
      </div>
      {/* Quick-range presets centre the visible window on today with
          the stated total span. The brush to the right can fine-tune
          or pan from here. */}
      <div
        role="radiogroup"
        aria-label="Chart window size"
        className="inline-flex rounded-md border overflow-hidden text-xs shrink-0"
      >
        {[
          { label: "1 month", halfDays: 15 },
          { label: "3 months", halfDays: 45 },
          { label: "6 months", halfDays: 90 },
          { label: "12 months", halfDays: 180 },
        ].map((opt) => {
          const active = isPresetActive(opt.halfDays);
          return (
            <button
              key={opt.label}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setWindowHalfDays(opt.halfDays)}
              className={cn(
                "px-2.5 py-1 transition-colors",
                active
                  ? "bg-indigo-600 text-white font-medium"
                  : "bg-background text-muted-foreground hover:bg-muted",
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );

  const chartCard = (
    <Card className="flex flex-col overflow-hidden h-full">
      <CardContent className="flex-1 flex flex-col min-h-0 gap-3 p-4">
        <div className="flex-1 min-h-0 min-w-0">
          {chartLoading ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
              Loading…
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={chartData}
                  margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                  onClick={(state) => {
                    // Selecting a chart day updates the day-detail panel and
                    // pages the calendar grid/week strip so the day is in view.
                    // Recharts gives several signals depending on where you
                    // clicked — try each in order so any of them works.
                    const s = state as unknown as {
                      activePayload?: { payload?: { rawDate?: string } }[];
                      activeLabel?: string;
                      activeTooltipIndex?: number;
                    };
                    let iso: string | undefined =
                      s?.activePayload?.[0]?.payload?.rawDate;
                    if (
                      !iso &&
                      typeof s?.activeTooltipIndex === "number" &&
                      chartData[s.activeTooltipIndex]
                    ) {
                      iso = chartData[s.activeTooltipIndex].rawDate as string;
                    }
                    if (!iso && s?.activeLabel) {
                      iso = chartData.find((r) => r.date === s.activeLabel)
                        ?.rawDate as string | undefined;
                    }
                    if (!iso) return;
                    selectChartDay(iso);
                  }}
                >
                  {/* One linearGradient per account so the Area's
                      fill steps down at the today fraction — full
                      alpha for realised (left of today), much lower
                      alpha for projected (right of today). The hard
                      transition is achieved with two stops at the
                      same offset. Gradient coords are
                      objectBoundingBox-based, which is fine because
                      every account's Area spans the same x-range as
                      the chart. */}
                  <defs>
                    {todayFractionPct !== null &&
                      perAccount.map((a) => {
                        const stopAt = `${todayFractionPct}%`;
                        return (
                          <linearGradient
                            key={`grad-${a.id}`}
                            id={`grad-${a.id}`}
                            x1="0"
                            y1="0"
                            x2="1"
                            y2="0"
                          >
                            <stop
                              offset="0%"
                              stopColor={a.color}
                              stopOpacity={0.22}
                            />
                            <stop
                              offset={stopAt}
                              stopColor={a.color}
                              stopOpacity={0.22}
                            />
                            <stop
                              offset={stopAt}
                              stopColor={a.color}
                              stopOpacity={0.03}
                            />
                            <stop
                              offset="100%"
                              stopColor={a.color}
                              stopOpacity={0.03}
                            />
                          </linearGradient>
                        );
                      })}
                  </defs>
                  <CartesianGrid stroke="var(--border)" strokeWidth={1} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    interval={tickInterval}
                  />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={formatYTick}
                    domain={yDomain[0] !== yDomain[1] ? yDomain : ["auto", "auto"]}
                    width={44}
                  />
                  <Tooltip
                    formatter={(value, name) => {
                      const formatted = formatAUD(Number(value ?? 0));
                      const n = String(name ?? "");
                      if (n.startsWith("acct:")) return [formatted, n.slice(5)];
                      if (n === "net") return [formatted, "Daily net"];
                      return [formatted, n];
                    }}
                    labelStyle={{ fontSize: 11 }}
                    contentStyle={{ fontSize: 12 }}
                  />
                  {/* When the "Projected" divider and the "Selected" line
                      land on the same column, their labels stack and read
                      as one garbled string ("SelProjected"). Detect the
                      collision and either offset the labels vertically OR
                      render a single combined annotation. */}
                  {projectionStartLabel &&
                    projectionStartLabel !== selectedLabel && (
                      <ReferenceLine
                        x={projectionStartLabel}
                        stroke="var(--muted-foreground)"
                        strokeWidth={1}
                        strokeDasharray="4 4"
                        ifOverflow="hidden"
                        label={{
                          value: "Projected",
                          position: "insideTopRight",
                          fontSize: 10,
                          fill: "var(--muted-foreground)",
                        }}
                      />
                    )}
                  {/* Calendar-selection highlight — soft indigo band behind
                      the column for visibility, plus a sharper indigo line
                      on top for the precise day marker. ReferenceArea with
                      x1==x2 on a category axis renders as a single-column
                      band, which is what we want here. */}
                  {selectedLabel && (
                    <ReferenceArea
                      x1={selectedLabel}
                      x2={selectedLabel}
                      stroke="none"
                      fill="#6366f1"
                      fillOpacity={0.18}
                      ifOverflow="hidden"
                    />
                  )}
                  {selectedLabel && (
                    <ReferenceLine
                      x={selectedLabel}
                      stroke="#4f46e5"
                      strokeWidth={1.5}
                      ifOverflow="hidden"
                      label={{
                        value:
                          projectionStartLabel === selectedLabel
                            ? "Selected · Projected"
                            : "Selected",
                        position: "insideTop",
                        fontSize: 10,
                        fill: "#4f46e5",
                      }}
                    />
                  )}
                  <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1} />
                  {/* One <Area> per account: crisp account-coloured stroke
                      with a soft 8%-opacity fill below so the chart reads as
                      a band rather than just a line. Single component avoids
                      duplicate tooltip rows. */}
                  {perAccount.map((a) => (
                    <Area
                      key={a.id}
                      type="monotone"
                      dataKey={`a_${a.id}`}
                      name={`acct:${a.name}`}
                      stroke={a.color}
                      strokeWidth={2}
                      fill={
                        todayFractionPct !== null
                          ? `url(#grad-${a.id})`
                          : a.color
                      }
                      fillOpacity={todayFractionPct !== null ? 1 : 0.08}
                      dot={false}
                      activeDot={{ r: 4, cursor: "pointer" }}
                      isAnimationActive={false}
                      style={{ cursor: "pointer" }}
                      onClick={(data: unknown) => {
                        // Area onClick fires when the colored band itself is
                        // clicked. The chart-level handler above covers
                        // empty-plot clicks; this one fires for points the
                        // user actually targeted, with a less-ambiguous
                        // payload shape.
                        const d = data as { payload?: { rawDate?: string } };
                        const iso = d?.payload?.rawDate;
                        if (iso) selectChartDay(iso);
                      }}
                    />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
          )}
        </div>
        {/* Bottom row: title + subtitle + range chips on the left,
            bordered brush chart on the right. Both panels share the
            footer so the brush's drag controls live next to the
            labels they affect. */}
        <div className="shrink-0 flex gap-3 items-end">
          {chartHeaderBlock}
          <div className="w-1/2 min-w-0 rounded-md border bg-card overflow-hidden">
            {overviewBrush}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Toolbar — legend + view toggle */}
      <div className="shrink-0 flex items-center justify-end gap-1">
          <Popover>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  aria-label="Calendar legend"
                  className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-input text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                />
              }
            >
              <Info className="h-3.5 w-3.5" />
            </PopoverTrigger>
            <PopoverContent className="w-64 p-3 text-xs space-y-2">
              <p className="font-semibold text-sm">Legend</p>
              <div className="space-y-1.5">
                <span className="flex items-center gap-2">
                  <span className="inline-block w-3 h-3 rounded border border-blue-400 bg-blue-50 dark:bg-blue-950/30" />
                  Today
                </span>
                <span className="flex items-center gap-2">
                  <span className="inline-block w-3 h-3 rounded border border-dashed border-border" />
                  Projected day
                </span>
              </div>
              <div className="pt-1 border-t space-y-1.5">
                <p className="text-muted-foreground">Day-cell dots</p>
                <span className="flex items-center gap-2">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: "var(--cashflow-in)" }}
                  />
                  Income on the day
                </span>
                <span className="flex items-center gap-2">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: "var(--cashflow-out)" }}
                  />
                  Expense on the day
                </span>
                <span className="flex items-center gap-2">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: "var(--cashflow-planned)" }}
                  />
                  Scheduled / planned
                </span>
              </div>
            </PopoverContent>
          </Popover>
          <Button
            variant={viewMode === "month" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("month")}
            className="h-7 text-xs"
          >
            Month
          </Button>
          <Button
            variant={viewMode === "week" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("week")}
            className="h-7 text-xs"
          >
            Week
          </Button>
        </div>
        {viewMode === "month" ? (
        <>
        {/* Top row: calendar on the left, chart with embedded brush on
            the right. Safari has dropped Tailwind's arbitrary
            grid-cols multiple times, so the column template is set
            inline. Row is `auto` so the calendar's natural compact
            height drives the row and the chart Card stretches to
            match — both panels end up exactly the same height. */}
        <div
          className="shrink-0"
          style={{
            display: "grid",
            // Cap the calendar at ~380px so the aspect-square cells
            // stay compact (~50px each, ~270px total calendar height)
            // and the chart on the right gets more breathing room.
            // Below lg, stack into one column.
            gridTemplateColumns: isLgUp ? "minmax(0, 380px) 1fr" : "1fr",
            gridTemplateRows: "auto",
            minWidth: 0,
            gap: "12px",
          }}
        >
          {/* CALENDAR */}
          <Card className="flex flex-col overflow-hidden">
            {/* Month nav lives inside the Card header so the calendar Card's
                top edge aligns with the day-detail Card on the right. */}
            <CardHeader className="flex flex-row items-center justify-between py-2 px-3 border-b space-y-0 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMonth(subMonths(month, 1))}
                aria-label="Previous month"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              {/* Header shows the selected day — intentional even though
                  the chevrons advance the visible month, because the
                  selected day is what the day-detail panel below tracks
                  and the user explicitly wants this label tied to it. */}
              <h2 className="text-base font-semibold">
                {format(parseISO(selectedDate), "EEEE, d MMMM yyyy")}
              </h2>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const now = new Date();
                    setMonth(now);
                    setSelectedDate(toISO(now));
                  }}
                  // Disabled only when the month AND the selected day are
                  // both already today's — `isSameMonth` alone would lock
                  // the button out when you're on the right month but
                  // looking at a different day, leaving no way to jump
                  // back to today's cell.
                  disabled={
                    isSameMonth(month, new Date()) &&
                    selectedDate === toISO(new Date())
                  }
                >
                  Today
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setMonth(addMonths(month, 1))}
                  aria-label="Next month"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-2 sm:p-3 flex flex-col">
              <div className="grid grid-cols-7 mb-1 shrink-0">
                {DAYS.map((d) => (
                  <div
                    key={d}
                    className="text-center text-xs text-muted-foreground font-medium py-1"
                  >
                    {d}
                  </div>
                ))}
              </div>

              {/* alignContent:"start" pins the implicit grid rows to the
                  top with no inter-row stretching, even if the surrounding
                  Card ends up taller than the grid (the parent grid row
                  height is `max(calendar, chart)` and the chart Card's
                  h-full can make the row grow). Without it, the auto-rows
                  distribute the leftover height as extra row gap, which
                  looks like vast vertical gaps between week rows. */}
              <div
                className="grid grid-cols-7 gap-1"
                style={{ alignContent: "start", gridAutoRows: "min-content" }}
              >
                {Array.from({ length: firstDayOfWeek }).map((_, i) => (
                  // Force the empty leading cells to be square too so the
                  // row's height is unambiguously the column width. Without
                  // an aspect ratio here, the empty divs collapse to 0
                  // height and the row sizes to the day-cell's intrinsic
                  // content (number + dots) instead of the cell's
                  // declared aspect-square — which Safari has been seen to
                  // drop after a re-render. Inline style beats the
                  // Tailwind utility on specificity.
                  <div
                    key={`empty-${i}`}
                    style={{ aspectRatio: "1 / 1" }}
                  />
                ))}
                {monthDays.map((day) => {
                  const dateStr = toISO(day);
                  const data = byDate.get(dateStr);
                  const today = isToday(day);
                  const selected = dateStr === selectedDate;
                  // Drop already-matched scheduled occurrences so the
                  // planned dot only fires for genuinely-pending events.
                  const unmatchedScheduled =
                    (data?.scheduledEvents ?? []).filter(
                      (_, i) => !claimedSched.has(`${dateStr}#${i}`),
                    );
                  // A real transaction that fulfilled a scheduled
                  // occurrence still shows the planned dot — the dot
                  // follows the money to the day it actually posted.
                  const claimedRealHere = (data?.events ?? []).some(
                    (e, i) =>
                      !e.isProjected && claimedReal.has(`${dateStr}#${i}`),
                  );
                  const summary = summarizeDay(
                    data && {
                      events: data.events,
                      scheduledEvents: unmatchedScheduled,
                    },
                  );
                  const hasPlanned = summary.hasPlanned || claimedRealHere;
                  return (
                    <button
                      key={dateStr}
                      type="button"
                      onClick={() => setSelectedDate(dateStr)}
                      // Inline aspectRatio plus the Tailwind utility — the
                      // utility covers most renders, the inline rule is the
                      // last word in specificity for the cases where the
                      // browser tries to vertical-fill the cell to a flex
                      // line's grown height.
                      style={{ aspectRatio: "1 / 1" }}
                      className={cn(
                        "aspect-square min-h-0 rounded-lg p-1.5 text-left flex flex-col overflow-hidden",
                        "border transition-colors text-[10px]",
                        selected
                          ? "border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500"
                          : today
                            ? "border-blue-400 bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100/60 dark:hover:bg-blue-950/50"
                            : data?.hasProjected
                              ? "border-dashed border-border hover:bg-muted"
                              : "border-border hover:bg-muted",
                      )}
                    >
                      <span
                        className={cn(
                          "font-medium leading-none",
                          today ? "text-blue-600" : "text-foreground",
                        )}
                      >
                        {format(day, "d")}
                      </span>
                      {(summary.hasIn || summary.hasOut || hasPlanned) && (
                        <div
                          className="mt-auto flex items-center justify-center gap-1.5 pt-1"
                          aria-label={[
                            summary.hasIn && "income",
                            summary.hasOut && "expense",
                            hasPlanned && "planned",
                          ]
                            .filter(Boolean)
                            .join(", ")}
                        >
                          {summary.hasIn && (
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ backgroundColor: "var(--cashflow-in)" }}
                            />
                          )}
                          {summary.hasOut && (
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ backgroundColor: "var(--cashflow-out)" }}
                            />
                          )}
                          {hasPlanned && (
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ backgroundColor: "var(--cashflow-planned)" }}
                            />
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Chart with embedded brush, same row as the calendar so heights
              track (parent grid row is auto = max of children, calendar
              drives because its intrinsic height is the larger one once
              the cells are aspect-square). */}
          {chartCard}
        </div>

        {/* Day detail panel — full width, fills the remaining vertical
            space below the calendar/chart row. */}
        <div className="flex-1 min-h-0 min-w-0">
          <DayDetailPanel
            dateStr={selectedDate}
            byDate={byDate}
            accounts={accounts}
            accountIds={accountIds}
            claimedSched={claimedSched}
            realToSched={realToSched}
            scheduledById={scheduledById}
            showLinkedDetails={displayPrefs.transactionsShowLinkedPanel}
          />
        </div>
        </>
        ) : (
          <>
            {/* Chart with embedded brush */}
            <div className="shrink-0 h-72">{chartCard}</div>
            <Card className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between py-2 px-3 border-b space-y-0 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setWeekStart(addDays(weekStart, -7))}
                aria-label="Previous week"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <h2 className="text-base font-semibold">
                {format(weekStart, "d MMM")} – {format(addDays(weekStart, 6), "d MMM yyyy")}
              </h2>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const now = new Date();
                    setWeekStart(startOfWeek(now, { weekStartsOn: 1 }));
                    setSelectedDate(toISO(now));
                  }}
                  disabled={
                    toISO(weekStart) ===
                    toISO(startOfWeek(new Date(), { weekStartsOn: 1 }))
                  }
                >
                  Today
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setWeekStart(addDays(weekStart, 7))}
                  aria-label="Next week"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-2 flex-1 min-h-0">
              <div className="grid grid-cols-7 gap-2 h-full">
                {weekDays.map((day) => {
                  const dateStr = toISO(day);
                  const data = byDate.get(dateStr);
                  const today = isToday(day);
                  const actualEvents = data?.events.filter((e) => !e.isProjected) ?? [];
                  const scheduledEvts = data?.scheduledEvents ?? [];
                  const unmatchedScheduled = scheduledEvts.filter(
                    (_, i) => !claimedSched.has(`${dateStr}#${i}`),
                  );
                  const actualNet = actualEvents.reduce((s, e) => s + e.amount, 0);
                  return (
                    <div
                      key={dateStr}
                      className={cn(
                        "flex flex-col min-h-0 border rounded overflow-hidden",
                        today
                          ? "border-blue-400 bg-blue-50/40 dark:bg-blue-950/20"
                          : "border-border",
                      )}
                    >
                      <div className="shrink-0 px-2 py-1.5 border-b bg-muted/30">
                        <div
                          className={cn(
                            "text-xs font-medium leading-tight",
                            today ? "text-blue-600" : "",
                          )}
                        >
                          {format(day, "EEE d MMM")}
                        </div>
                        {actualNet !== 0 && (
                          <div
                            className={cn(
                              "text-[10px] tabular-nums font-semibold leading-tight",
                              actualNet > 0 ? "text-emerald-600" : "text-red-500",
                            )}
                          >
                            {actualNet > 0 ? "+" : ""}
                            {formatAUD(actualNet).replace("A$", "$")}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-h-0 overflow-y-auto p-1 space-y-1 text-[11px]">
                        {actualEvents.map((e, i) => {
                          const acct = e.accountId ? accountById.get(e.accountId) : undefined;
                          return (
                            <div key={`r-${i}`} className="rounded px-1 py-1 bg-muted/40">
                              {acct && (
                                <span
                                  className="inline-block px-1 py-0.5 rounded text-white text-[9px] mb-0.5"
                                  style={{ backgroundColor: acct.color }}
                                >
                                  {acct.name}
                                </span>
                              )}
                              <div
                                className="truncate font-medium leading-tight"
                                title={e.payee || e.description || "—"}
                              >
                                {e.payee || e.description || "—"}
                              </div>
                              <div className={cn("tabular-nums leading-tight", amountClass(e.amount))}>
                                {formatAUD(e.amount)}
                              </div>
                            </div>
                          );
                        })}
                        {unmatchedScheduled.map((e, i) => {
                          const acct = e.accountId ? accountById.get(e.accountId) : undefined;
                          return (
                            <div
                              key={`s-${i}`}
                              className="rounded px-1 py-1 bg-indigo-500/10 border-l-2 border-indigo-400"
                            >
                              {acct && (
                                <span
                                  className="inline-block px-1 py-0.5 rounded text-white text-[9px] mb-0.5"
                                  style={{ backgroundColor: acct.color }}
                                >
                                  {acct.name}
                                </span>
                              )}
                              <div
                                className="truncate text-muted-foreground leading-tight"
                                title={e.payee || e.description || "—"}
                              >
                                {e.payee || e.description || "—"}
                              </div>
                              <div className={cn("tabular-nums leading-tight", amountClass(e.amount))}>
                                {formatAUD(e.amount)}
                              </div>
                            </div>
                          );
                        })}
                        {actualEvents.length === 0 && unmatchedScheduled.length === 0 && (
                          <div className="text-[10px] text-muted-foreground text-center py-2">—</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
            </Card>
          </>
        )}
    </div>
  );
}

// How many days a real transaction can drift from its scheduled date and
// still be considered the same occurrence. Banks frequently post a day or
// two later than the scheduled date.
const MATCH_TOLERANCE_DAYS = 3;

/**
 * Greedy one-to-one assignment of scheduled occurrences ↔ real transactions
 * across the whole loaded byDate map. Each scheduled event "claims" the
 * closest unclaimed real candidate within ±MATCH_TOLERANCE_DAYS that has the
 * same accountId and amount within a cent. The returned sets key into both
 * sides as `${date}#${idx}` where `idx` is the position within that day's
 * `events.filter(e => !e.isProjected)` (for reals) or `scheduledEvents` (for
 * scheds). Both views consume the same sets so they can't disagree.
 */
function matchScheduledToReal(byDate: Map<string, DailyBalance>): {
  claimedReal: Set<string>;
  claimedSched: Set<string>;
  realToSched: Map<string, { scheduledId: string; scheduledDate: string }>;
} {
  type Pos = { date: string; idx: number; accountId?: string; amount: number; scheduledId?: string };
  const reals: Pos[] = [];
  const scheds: Pos[] = [];
  for (const [d, dd] of byDate) {
    let i = 0;
    for (const e of dd.events) {
      if (!e.isProjected) {
        reals.push({ date: d, idx: i, accountId: e.accountId, amount: e.amount });
        i++;
      }
    }
    dd.scheduledEvents.forEach((e, j) =>
      scheds.push({ date: d, idx: j, accountId: e.accountId, amount: e.amount, scheduledId: e.id }),
    );
  }
  const key = (p: Pos) => `${p.date}#${p.idx}`;
  const claimedReal = new Set<string>();
  const claimedSched = new Set<string>();
  const realToSched = new Map<string, { scheduledId: string; scheduledDate: string }>();
  for (const s of scheds) {
    let best: { r: Pos; days: number } | null = null;
    for (const r of reals) {
      if (claimedReal.has(key(r))) continue;
      if (r.accountId !== s.accountId) continue;
      if (Math.abs(r.amount - s.amount) > 0.01) continue;
      const days = Math.abs(
        Math.round(
          (new Date(`${r.date}T00:00:00Z`).getTime() -
            new Date(`${s.date}T00:00:00Z`).getTime()) /
            86_400_000,
        ),
      );
      if (days > MATCH_TOLERANCE_DAYS) continue;
      if (!best || days < best.days) best = { r, days };
    }
    if (best && s.scheduledId) {
      const realKey = key(best.r);
      claimedReal.add(realKey);
      claimedSched.add(key(s));
      realToSched.set(realKey, { scheduledId: s.scheduledId, scheduledDate: s.date });
    }
  }
  return { claimedReal, claimedSched, realToSched };
}

function DayDetailPanel({
  dateStr,
  byDate,
  accounts,
  accountIds,
  claimedSched,
  realToSched,
  scheduledById,
  showLinkedDetails,
}: {
  dateStr: string;
  byDate: Map<string, DailyBalance>;
  accounts: { id: string; name: string; color: string }[];
  accountIds: string[];
  claimedSched: Set<string>;
  realToSched: Map<string, { scheduledId: string; scheduledDate: string }>;
  scheduledById: Map<string, { frequency: string; interval: number; payee: string | null }>;
  showLinkedDetails: boolean;
}) {
  // Day's *projected* events from the cashflow API — these don't have notes
  // / category names / pair-account metadata, so the panel stays on the
  // cashflow shape for the "still pending" rows.
  const data = byDate.get(dateStr);
  const scheduledEvts = data?.scheduledEvents ?? [];
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  // Day's *actual* transactions — fetched fresh from /api/transactions so
  // we get the full row shape (notes, categoryName, isReconciled, transfer
  // pair metadata) that the cashflow projection deliberately doesn't
  // include. Scoped to the same account filter the calendar is using so
  // the panel never surfaces rows the grid wouldn't.
  const txQuery = new URLSearchParams({
    from: dateStr,
    to: dateStr,
    limit: "500",
  });
  if (accountIds.length) txQuery.set("accountIds", accountIds.join(","));
  const { data: txnResp, mutate: mutateTxns } = useSWR<TransactionRowData[]>(
    `/api/transactions?${txQuery}`,
    fetcher,
    { keepPreviousData: true },
  );
  const realTxns: TransactionRowData[] = useMemo(
    () => txnResp ?? [],
    [txnResp],
  );

  // Categories list — driven by the same SWR key the main /transactions
  // view uses, so the inline CategoryPicker inside TransactionRow has
  // the full hierarchy to pick from (and the cache is shared).
  const { data: categories = [] } = useSWR<
    { id: string; name: string; parentId: string | null }[]
  >("/api/categories", fetcher);

  // Per-row expansion state — same single-row-at-a-time pattern the
  // main list uses, isolated to this panel so opening a day's row
  // doesn't affect /transactions.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Client-side sort state for the panel's rows. The day is small
  // enough that re-sorting on click is cheap, so no server round-trip.
  const [sort, setSort] = useState<TransactionSortState>({
    by: "value",
    order: "desc",
  });
  const sortedTxns = useMemo(() => {
    return [...realTxns].sort((a, b) => compareTransactions(a, b, sort));
  }, [realTxns, sort]);
  // Scheduled events mapped to the row-component-shaped object the
  // shared `<ScheduledTransactionRow>` consumes, then sorted with the
  // same sort state the real rows use so the combined list reads as
  // one ordered table.
  const scheduledRowEvents = useMemo<ScheduledRowEvent[]>(() => {
    return scheduledEvts
      .map((e, i) => ({ e, i }))
      .filter(({ i }) => !claimedSched.has(`${dateStr}#${i}`))
      .map(({ e, i }) => ({
        id: e.id ?? `sched-${dateStr}-${i}`,
        accountId: e.accountId,
        payee: e.payee,
        description: e.description,
        amount: e.amount,
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduledEvts, claimedSched, dateStr]);
  const sortedScheduled = useMemo(() => {
    return [...scheduledRowEvents].sort((a, b) =>
      compareScheduled(a, b, sort),
    );
  }, [scheduledRowEvents, sort]);
  function handleSort(col: TransactionSortState["by"]) {
    setSort((cur) =>
      cur.by === col
        ? { by: col, order: cur.order === "asc" ? "desc" : "asc" }
        : { by: col, order: "asc" },
    );
  }

  // Drop scheduled occurrences that have already been matched to a real
  // transaction — the dot has moved with the money, the row would too.
  const matchedScheduledIdx = new Set<number>();
  scheduledEvts.forEach((_, i) => {
    if (claimedSched.has(`${dateStr}#${i}`)) matchedScheduledIdx.add(i);
  });
  const unmatchedScheduled = scheduledEvts.filter(
    (_, i) => !matchedScheduledIdx.has(i),
  );


  return (
    <Card className="flex flex-col min-h-0 max-h-full overflow-hidden">
      <CardContent className="pt-3 space-y-4 flex-1 min-h-0 overflow-y-auto">
        {realTxns.length === 0 && unmatchedScheduled.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-6">
            No transactions on this day.
          </p>
        )}

        {(realTxns.length > 0 || unmatchedScheduled.length > 0) && (
          <div>
            {/* Single table for real + scheduled rows so they share
                the sortable TransactionsTableHeader. Real rows use
                <TransactionRow> with the inline-edit features the
                main /transactions list provides; scheduled
                (forecast) rows render through <ScheduledTransactionRow>
                — same column structure, soft indigo tint, no inline
                edits since they're projections, not DB rows. */}
            <table className="w-full text-sm">
              <TransactionsTableHeader
                showDate={false}
                showCheckbox={false}
                showBalance={false}
                showLinkedPanel={false}
                sort={sort}
                onSort={handleSort}
              />
              <tbody className="divide-y">
                {sortedTxns.map((t) => {
                  const i = realTxns.findIndex((r) => r.id === t.id);
                  const matchRef = realToSched.get(`${dateStr}#${i}`);
                  const sched = matchRef
                    ? scheduledById.get(matchRef.scheduledId)
                    : undefined;
                  const match =
                    matchRef && sched
                      ? {
                          id: matchRef.scheduledId,
                          frequency: sched.frequency,
                          interval: sched.interval,
                          occurrenceDate: matchRef.scheduledDate,
                          payee: sched.payee,
                        }
                      : null;
                  return (
                    <TransactionRow
                      key={t.id}
                      t={t}
                      accounts={accounts}
                      categories={categories}
                      showLinkedPanel={false}
                      showLinkedDetails={false}
                      showDate={false}
                      showCheckbox={false}
                      showBalance={false}
                      isExpanded={expandedId === t.id}
                      onToggleExpand={() =>
                        setExpandedId((cur) =>
                          cur === t.id ? null : t.id,
                        )
                      }
                      match={match}
                      onChange={() => mutateTxns()}
                    />
                  );
                })}
                {sortedScheduled.map((e, i) => (
                  <ScheduledTransactionRow
                    key={`sched-${i}`}
                    event={e}
                    accounts={accounts}
                    showDate={false}
                    showCheckbox={false}
                    showBalance={false}
                    showLinkedPanel={false}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
