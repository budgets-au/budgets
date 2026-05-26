"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

// Read on the server via the `theme` cookie (see app/layout.tsx).
// Writes happen here on click; the cookie path covers every page and
// the max-age is 1 year.
function writeThemeCookie(value: "dark" | "light") {
  document.cookie = `theme=${value}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

/** Icon-only light/dark toggle. Lives in the Topbar next to the
 *  account dropdown — the conventional placement most webapps use
 *  for theme switches, discoverable without burying it in Settings.
 *  Sun icon = currently light (click for dark); Moon icon = currently
 *  dark (click for light). */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    if (next) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    writeThemeCookie(next ? "dark" : "light");
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
    >
      {dark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
    </button>
  );
}
