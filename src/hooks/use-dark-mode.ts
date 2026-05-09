"use client";

import { useEffect, useState } from "react";

/**
 * Watches the `dark` class on <html> and returns true when it's set. Used
 * by chart overlays (calendar brush, scheduled occurrence trend line)
 * that need to flip a colour value at runtime — Tailwind `dark:` variants
 * don't reach Recharts SVG props.
 *
 * Defaults to false on SSR + first paint to avoid hydration mismatch; the
 * first effect tick sets the real value on the client.
 */
export function useDarkMode(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const update = () => setDark(root.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}
