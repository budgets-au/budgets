"use client";

import { useCallback, useState } from "react";

/** Pure Set-transition helpers — exported so the update logic
 *  can be unit-tested without spinning up a React renderer.
 *  All three return the previous reference when the operation
 *  would be a no-op, so the hook's setter can short-circuit
 *  re-renders for redundant calls. */
export function toggleInSet(prev: Set<string>, id: string): Set<string> {
  const next = new Set(prev);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
export function addToSet(prev: Set<string>, id: string): Set<string> {
  if (prev.has(id)) return prev;
  const next = new Set(prev);
  next.add(id);
  return next;
}
export function removeFromSet(prev: Set<string>, id: string): Set<string> {
  if (!prev.has(id)) return prev;
  const next = new Set(prev);
  next.delete(id);
  return next;
}

/** Membership toggle over a `Set<string>` — the most common
 *  "collapsed parent ids" / "expanded rows" / "selected ids"
 *  pattern in the report views. Every call site used to declare
 *  `useState<Set<string>>(new Set())` plus a hand-rolled
 *  `toggle(id) → next = new Set(prev); next.has(id) ?
 *  next.delete(id) : next.add(id); return next;`. This hook
 *  centralises the immutable-update boilerplate and exposes the
 *  five operations the call sites actually use. */
export interface ToggleSet {
  /** Live Set — reference-stable within a render; treat as
   *  read-only and call the helpers below to mutate. */
  ids: Set<string>;
  has: (id: string) => boolean;
  /** Toggle membership of `id` in one click. */
  toggle: (id: string) => void;
  add: (id: string) => void;
  remove: (id: string) => void;
  /** Replace the whole set — used by reset-on-data-change
   *  effects (e.g. envelope-report collapsing every parent
   *  whenever the period changes). */
  set: (next: Set<string>) => void;
  clear: () => void;
}

export function useToggleSet(
  initial?: Iterable<string>,
): ToggleSet {
  const [ids, setIds] = useState<Set<string>>(
    () => new Set(initial ?? []),
  );
  const toggle = useCallback((id: string) => {
    setIds((prev) => toggleInSet(prev, id));
  }, []);
  const add = useCallback((id: string) => {
    setIds((prev) => addToSet(prev, id));
  }, []);
  const remove = useCallback((id: string) => {
    setIds((prev) => removeFromSet(prev, id));
  }, []);
  const set = useCallback((next: Set<string>) => {
    setIds(next);
  }, []);
  const clear = useCallback(() => {
    setIds(new Set());
  }, []);
  // `has` is a pure read; no need to memoise.
  return { ids, has: (id) => ids.has(id), toggle, add, remove, set, clear };
}
