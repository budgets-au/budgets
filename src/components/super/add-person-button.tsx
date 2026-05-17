"use client";

import { useState } from "react";
import { mutate } from "swr";
import { Plus, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { SuperPerson } from "@/db/schema";

interface PeopleResponse {
  people: SuperPerson[];
}

/** Topbar action for the Superannuation page. Mirrors the Import
 *  button's placement / styling on the Transactions page: indigo CTA
 *  next to the profile dropdown. Click flips the button into an inline
 *  input so the operator can name the new person without a modal,
 *  matching the previous bottom-of-page UX.
 *
 *  The component is unaware of the current people list — it just POSTs
 *  to /api/super/people and seeds the SWR cache with the response.
 *  Other consumers (SuperPageBody) re-render via the same SWR key. */
export function AddPersonButton() {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

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

  if (adding) {
    return (
      <div className="flex items-center gap-1.5">
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
          className="h-8 w-44 text-sm"
        />
        <Button
          onClick={add}
          size="sm"
          variant="indigo"
          disabled={saving || !draft.trim()}
        >
          Add
        </Button>
        <Button
          onClick={() => {
            setAdding(false);
            setDraft("");
          }}
          size="sm"
          variant="outline"
          aria-label="Cancel"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setAdding(true)}
      className={cn(buttonVariants({ variant: "indigo", size: "sm" }))}
    >
      <Plus className="h-4 w-4 mr-1" /> Add person
    </button>
  );
}
