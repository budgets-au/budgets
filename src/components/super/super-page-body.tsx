"use client";

import useSWR, { mutate } from "swr";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/use-confirm-dialog";
import { SuperView } from "./super-view";
import type { SuperPerson } from "@/db/schema";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface PeopleResponse {
  people: SuperPerson[];
}

/** Client wrapper for the super page. Renders one `<SuperView>` per
 *  person plus a delete callback threaded through to each view's
 *  header. The "Add person" affordance lives in the page Topbar
 *  (see `<AddPersonButton/>`), not here — both subscribe to the same
 *  `/api/super/people` SWR key so an add over there refreshes this
 *  grid automatically. */
export function SuperPageBody({
  initialPeople,
}: {
  initialPeople: SuperPerson[];
}) {
  const { data } = useSWR<PeopleResponse>("/api/super/people", fetcher, {
    fallbackData: { people: initialPeople },
    revalidateOnFocus: false,
  });
  const people = data?.people ?? initialPeople;
  const confirmDialog = useConfirm();

  async function remove(key: string) {
    if (people.length <= 1) {
      toast.error(
        "Can't remove the last person — the super page needs at least one.",
      );
      return;
    }
    const target = people.find((p) => p.key === key);
    const ok = await confirmDialog({
      title: `Remove ${target?.label ?? key}?`,
      description:
        "All of their yearly snapshots will be permanently deleted. " +
        "This can't be undone (other than restoring from a backup).",
      confirmLabel: "Remove",
    });
    if (!ok) return;
    const res = await fetch(
      `/api/super/people/${encodeURIComponent(key)}`,
      { method: "DELETE" },
    );
    if (res.ok) {
      const body = (await res.json()) as PeopleResponse;
      mutate("/api/super/people", body, false);
      mutate(
        (k) => typeof k === "string" && k.startsWith("/api/super?person="),
        undefined,
        { revalidate: true },
      );
      toast.success(`${target?.label ?? key} removed`);
    } else {
      toast.error("Couldn't remove person");
    }
  }

  // Layout: a grid that scales sensibly with N. Up to 2 columns on
  // lg screens — three SuperViews side-by-side gets squeezed past
  // ~1800px. Stack vertically below lg.
  const gridClass =
    people.length === 1
      ? "grid grid-cols-1 gap-6"
      : "grid grid-cols-1 lg:grid-cols-2 gap-6";

  return (
    <div className={gridClass}>
      {people.map((p) => (
        <SuperView
          key={p.key}
          person={p.key}
          label={p.label}
          // The last remaining person can't be deleted (the page
          // would have nothing to render). Withhold the callback
          // entirely so the trash icon doesn't appear.
          onDelete={people.length > 1 ? remove : undefined}
        />
      ))}
    </div>
  );
}
