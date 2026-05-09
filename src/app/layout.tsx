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
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get("theme")?.value;
  const isDark = theme === "dark";
  return (
    <html lang="en" className={`h-full${isDark ? " dark" : ""}`}>
      <body className={`${geist.className} h-full antialiased`}>
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
