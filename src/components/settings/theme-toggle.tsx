"use client";

import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";

// Read on the server via the `theme` cookie (see app/layout.tsx). Writes happen
// here on click; the cookie path covers every page and the max-age is 1 year.
function writeThemeCookie(value: "dark" | "light") {
  document.cookie = `theme=${value}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

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
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <p className="font-medium text-sm">Appearance</p>
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Dark mode</span>
        <Switch checked={dark} onCheckedChange={toggle} aria-label="Dark mode" />
      </div>
    </div>
  );
}
