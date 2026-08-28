import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { cookies } from "next/headers";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Budgets",
  description: "Household budget tracker",
};

// Theme is read from a server-side cookie so the dark class is rendered into the
// initial HTML — no FOUC, no inline <script> (React 19 warns on those), no
// hydration mismatch. ThemeToggle writes the cookie when the user toggles.
// The `theme-family` cookie mirrors the same pattern for the visual identity
// pick (default vs terminal, added 0.345) — set on <html> as a data attribute
// so globals.css can scope the Terminal token overrides.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const isDark = jar.get("theme")?.value === "dark";
  const family = jar.get("theme-family")?.value === "terminal" ? "terminal" : "default";
  return (
    <html
      lang="en"
      className={`h-full${isDark ? " dark" : ""}`}
      data-theme-family={family}
    >
      <body className={`${geist.className} h-full antialiased`}>
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
