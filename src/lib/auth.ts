import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

// Issue #94: `@/db` is loaded LAZILY inside the authorize() callback,
// not at module-evaluation time. `auth.ts` is reachable from
// `src/proxy.ts` (the middleware) which the unlock-path bundle drags
// in eagerly; a top-level `import { db } from "@/db"` here re-trips
// the production TDZ cycle that bit 0.213/0.214
// (`ReferenceError: Cannot access 'al' before initialization`).
// Mirrors the lazy-require pattern in `src/lib/backup/scheduler.ts`.

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    Credentials({
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null;

        const { db } = require("@/db") as typeof import("@/db");
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.username, credentials.username as string))
          .limit(1);

        if (!user) return null;

        const valid = await compare(credentials.password as string, user.passwordHash);
        if (!valid) return null;

        // Detect the default admin/admin seed and surface it via a
        // session flag so the UI can nag the operator into rotating
        // it. bcrypt hashes are non-deterministic so we have to
        // re-compare the seed string against the stored hash rather
        // than comparing hashes directly. One extra ~80 ms compare
        // per login is acceptable cost.
        const mustChangePassword = await compare("admin", user.passwordHash);

        return {
          id: user.id,
          name: user.name,
          username: user.username,
          role: user.role,
          mustChangePassword,
        };
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role;
        token.mustChangePassword = (user as { mustChangePassword?: boolean })
          .mustChangePassword;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        (session.user as { role?: string }).role = token.role as string;
        (session.user as { mustChangePassword?: boolean }).mustChangePassword =
          token.mustChangePassword as boolean | undefined;
      }
      return session;
    },
  },
});

/** True when the supplied session belongs to an `admin`-role user.
 * Tolerates `null` / unauthenticated sessions (returns false). Used
 * by privileged API routes (rekey, lock, backup management, user
 * management) to gate the writes behind the admin role rather than
 * just "any logged-in user". Member users can still read everything;
 * they just can't perform shared-state destructive operations. */
export function isAdmin(session: unknown): boolean {
  const role = (session as { user?: { role?: string } } | null)?.user?.role;
  return role === "admin";
}
