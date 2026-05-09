"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface Props {
  transactionId: string;
  notes: string | null;
  onSaved?: () => void;
}

export function NotesCell({ transactionId, notes, onSaved }: Props) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(notes ?? "");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync display value when the underlying row's notes change (e.g. after a
  // re-fetch from another edit).
  useEffect(() => {
    if (!editing) setValue(notes ?? "");
  }, [notes, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  async function commit() {
    const next = value.trim();
    const current = (notes ?? "").trim();
    if (next === current) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const res = await fetch(`/api/transactions/${transactionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: next }),
    });
    setSaving(false);
    if (res.ok) {
      setEditing(false);
      onSaved?.();
    } else {
      toast.error("Failed to save note");
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            setValue(notes ?? "");
            setEditing(false);
          }
        }}
        disabled={saving}
        placeholder="Add note…"
        className="w-full bg-transparent outline-none border-b border-indigo-400 text-xs px-0 py-0.5"
      />
    );
  }

  const display = notes?.trim();
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={`w-full text-left truncate text-xs ${display ? "text-muted-foreground hover:text-foreground" : "text-muted-foreground/40 italic hover:text-muted-foreground"} transition-colors`}
      title={display || "Click to add a note"}
    >
      {display || "Add note…"}
    </button>
  );
}
