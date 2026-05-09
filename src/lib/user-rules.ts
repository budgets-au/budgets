/**
 * Validation + decision rules for the user manager. Pure functions
 * so the API route + UI can share one source of truth, and the
 * rules can be exercised without spinning up a DB.
 *
 * `username` is the login identifier. We restrict it to a sensible
 * subset rather than allow arbitrary strings — keeping it ASCII +
 * mostly-printable means it survives URL params, log lines, and
 * shells without surprises, and disallowing whitespace dodges the
 * common "I typed a trailing space" footgun.
 */

const USERNAME_MIN = 1;
const USERNAME_MAX = 32;
const PASSWORD_MIN = 4; // weak by design — local-only LAN tool, the
                        // SQLCipher passphrase is the real perimeter.
                        // Anyone wanting more can pick a longer one.

/** Allowed username shape: ASCII letters / digits / `._-`. No
 * whitespace, no `@` (avoids confusion with email-shaped logins),
 * no path separators. */
const USERNAME_RE = /^[A-Za-z0-9._-]+$/;

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

export function validateUsername(raw: unknown): ValidationResult {
  if (typeof raw !== "string") return { ok: false, error: "Username is required." };
  const v = raw.trim();
  if (v.length < USERNAME_MIN) return { ok: false, error: "Username is required." };
  if (v.length > USERNAME_MAX) {
    return { ok: false, error: `Username must be ${USERNAME_MAX} characters or fewer.` };
  }
  if (!USERNAME_RE.test(v)) {
    return {
      ok: false,
      error: "Username may only contain letters, digits, dot, underscore, or dash.",
    };
  }
  return { ok: true };
}

export function validatePassword(raw: unknown): ValidationResult {
  if (typeof raw !== "string") return { ok: false, error: "Password is required." };
  if (raw.length < PASSWORD_MIN) {
    return { ok: false, error: `Password must be at least ${PASSWORD_MIN} characters.` };
  }
  return { ok: true };
}

/** Roles the UI exposes. Anything else is a client-side bug or a
 * forged request — the route handler should reject. */
export const VALID_ROLES = ["admin", "member"] as const;
export type Role = (typeof VALID_ROLES)[number];

export function validateRole(raw: unknown): ValidationResult {
  if (typeof raw !== "string" || !VALID_ROLES.includes(raw as Role)) {
    return { ok: false, error: "Role must be 'admin' or 'member'." };
  }
  return { ok: true };
}

/**
 * Decide whether a delete/role-change request is safe. The server
 * MUST reject any operation that would leave the system without an
 * admin — otherwise a careless click could lock everyone out.
 *
 * `targetUserId` — the user being modified.
 * `requesterUserId` — the user making the request (so we can
 *   reject "demoting yourself" as a separate, clearer error).
 * `currentAdmins` — the list of admin user IDs in the DB right now.
 * `action` — what's being asked.
 */
export type LastAdminGuardInput =
  | { action: "delete"; targetUserId: string; requesterUserId: string; currentAdmins: string[] }
  | { action: "demote"; targetUserId: string; requesterUserId: string; currentAdmins: string[] };

export function lastAdminGuard(input: LastAdminGuardInput): ValidationResult {
  const { action, targetUserId, requesterUserId, currentAdmins } = input;
  // Self-delete is its own foot-gun message — separate from the
  // "no admins left" case so the error tells the user exactly
  // which check they tripped.
  if (action === "delete" && targetUserId === requesterUserId) {
    return { ok: false, error: "You can't delete your own account." };
  }
  // Last-admin check: only kicks in when the action is on someone
  // who's currently an admin.
  if (!currentAdmins.includes(targetUserId)) return { ok: true };
  if (currentAdmins.length > 1) return { ok: true };
  return {
    ok: false,
    error:
      action === "delete"
        ? "Can't delete the last admin — promote another user first."
        : "Can't demote the last admin — promote another user first.",
  };
}
