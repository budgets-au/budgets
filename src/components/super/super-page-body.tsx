"use client";

import { useState } from "react";
import useSWR, { mutate } from "swr";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/use-confirm-dialog";
import { SuperView } from "./super-view";
import type { SuperPerson } from "@/db/schema";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface PeopleResponse {
  people: SuperPerson[];
}

/** Client wrapper for the super page. Renders one `<SuperView>` per
 *  person and offers an "Add person" affordance + a delete callback
 *  threaded through to each view's header. The initial list is
 *  server-rendered so the first paint shows the right people; SWR
 *  takes over for live updates after that. */
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

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const confirmDialog = useConfirm();

  async function add() {
    const label = draft.trim();
    if (!label || saving) return;
    setSaving(true);
    const res = await fetch("/api/super/people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    setSaving(false);
    if (res.ok) {
      const body = (await res.json()) as PeopleResponse;
      mutate("/api/super/people", body, false);
      setAdding(false);
      setDraft("");
      toast.success(`${label} added`);
    } else {
      toast.error("Couldn't add person");
    }
  }

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
    <>
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
      <div className="mt-6 flex items-center gap-2">
        {adding ? (
          <>
            <Input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") add();
                if (e.key === "Escape") {
                  setAdding(false);
                  setDraft("");
                }
              }}
              placeholder="Their name — e.g. Sarah"
              maxLength={60}
              className="max-w-xs"
            />
            <Button onClick={add} size="sm" disabled={saving || !draft.trim()}>
              Add
            </Button>
            <Button
              onClick={() => {
                setAdding(false);
                setDraft("");
              }}
              size="sm"
              variant="outline"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </>
        ) : (
          <Button
            onClick={() => setAdding(true)}
            size="sm"
            variant="outline"
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> Add person
          </Button>
        )}
      </div>
    </>
  );
}
