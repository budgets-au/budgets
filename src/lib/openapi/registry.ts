import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { APP_VERSION } from "@/lib/version";

// Wire zod-to-openapi's `.openapi()` extension onto every zod
// schema in the process. Called once at module load; idempotent.
extendZodWithOpenApi(z);

/** The registry is a plain in-memory catalogue of schemas +
 *  paths. `generateDocument()` snapshots it into the served
 *  OpenAPI 3 JSON. Adding a route = one `registerPath({...})`
 *  call below; adding a schema = a `.openapi(...)` chain on the
 *  underlying Zod object.
 *
 *  This first pass documents the ~15 endpoints most useful to
 *  an external consumer (auth-key management, operational
 *  routes, and the primary financial reads). The rest of the
 *  ~90 routes work but stay undocumented; extend at leisure. */
const registry = new OpenAPIRegistry();

// ── Security schemes ──────────────────────────────────────────
const bearerAuth = registry.registerComponent(
  "securitySchemes",
  "bearerAuth",
  {
    type: "http",
    scheme: "bearer",
    bearerFormat: "bk_ prefix + 32 bytes base64url",
    description:
      "Long-lived API key minted from Settings → Security → API keys. " +
      "Pass as `Authorization: Bearer bk_…` on every request. " +
      "Ops-scoped keys are restricted to a small operational allowlist.",
  },
);
registry.registerComponent("securitySchemes", "cookieAuth", {
  type: "apiKey",
  in: "cookie",
  name: "authjs.session-token",
  description:
    "NextAuth session cookie set by /login. Same auth level as a full-scope API key.",
});

// ── Reusable response schemas ─────────────────────────────────
const ErrorResponse = registry.register(
  "Error",
  z
    .object({
      error: z.string().openapi({ example: "Unauthorized" }),
    })
    .openapi({
      description: "Standard error envelope.",
    }),
);

const AccountSchema = registry.register(
  "Account",
  z
    .object({
      id: z.string().uuid(),
      name: z.string(),
      type: z.string().openapi({ example: "checking" }),
      institution: z.string().nullable(),
      accountNumberLast4: z.string().nullable(),
      currency: z.string().openapi({ example: "AUD" }),
      currentBalance: z.string(),
      startingBalance: z.string(),
      startingDate: z.string(),
      color: z.string().openapi({ example: "#22c55e" }),
      isArchived: z.boolean(),
      isExternal: z.boolean(),
      isSample: z.boolean(),
      createdAt: z.string(),
      updatedAt: z.string(),
    })
    .openapi({ description: "A funded account (checking / savings / etc.)." }),
);

const TransactionSchema = registry.register(
  "Transaction",
  z
    .object({
      id: z.string().uuid(),
      accountId: z.string().uuid(),
      date: z.string(),
      amount: z.string().openapi({ example: "-42.50" }),
      payee: z.string().nullable(),
      description: z.string().nullable(),
      categoryId: z.string().uuid().nullable(),
      notes: z.string().nullable(),
      isReconciled: z.boolean(),
    })
    .openapi({
      description:
        "A single ledger row. `amount` is a signed decimal string " +
        "(negative = out).",
    }),
);

const CategorySchema = registry.register(
  "Category",
  z
    .object({
      id: z.string().uuid(),
      name: z.string(),
      type: z.enum(["income", "expense"]),
      color: z.string(),
      parentId: z.string().uuid().nullable(),
      transferKind: z.enum(["none", "internal", "external"]),
      sortOrder: z.number().int(),
      tags: z.array(z.string()).nullable(),
    })
    .openapi({ description: "A budget category (hierarchical)." }),
);

const ApiKeyMetadata = registry.register(
  "ApiKeyMetadata",
  z
    .object({
      id: z.string().uuid(),
      name: z.string(),
      role: z.enum(["admin", "member"]),
      scope: z.enum(["full", "ops"]),
      createdAt: z.string(),
      lastUsedAt: z.string().nullable(),
    })
    .openapi({
      description:
        "Public metadata for an API key. The plaintext key is NOT in this shape — it's only returned once at creation.",
    }),
);

const ApiKeyCreateResponse = registry.register(
  "ApiKeyCreateResponse",
  ApiKeyMetadata.extend({
    key: z
      .string()
      .openapi({ example: "bk_b0Nx-NZfdKZBmdWfDARMHjhaBt8aAvvoVwa1dR56ZXc" }),
  }).openapi({
    description:
      "Includes the plaintext `key` — this is the ONLY time it's returned. Store it now.",
  }),
);

const HealthResponse = registry.register(
  "Health",
  z.object({
    version: z.string(),
    uptimeSeconds: z.number().int(),
    dbUnlocked: z.boolean(),
    activeProfile: z.string().nullable(),
    memory: z.object({
      rss: z.number(),
      heapUsed: z.number(),
      heapTotal: z.number(),
    }),
    nodeVersion: z.string(),
  }),
);

const LogsResponse = registry.register(
  "Logs",
  z.object({
    lines: z.array(
      z.object({
        ts: z.string(),
        level: z.enum(["log", "info", "warn", "error", "debug"]),
        msg: z.string(),
      }),
    ),
  }),
);

const CashflowResponse = registry.register(
  "CashflowReport",
  z
    .object({
      months: z.array(z.string()),
      income: z.array(z.record(z.string(), z.unknown())),
      expenses: z.array(z.record(z.string(), z.unknown())),
      totals: z.record(z.string(), z.record(z.string(), z.number())),
      closingBalance: z.record(z.string(), z.number()),
      openingBalance: z.number(),
    })
    .openapi({
      description:
        "The Cashflow report payload — see the app's Cashflow page for the exact row shape.",
    }),
);

// ── Path registrations ────────────────────────────────────────

const AUTH = [{ [bearerAuth.name]: [] }, { cookieAuth: [] }];

// Ops surface — reachable by ops-scoped keys
registry.registerPath({
  method: "get",
  path: "/api/health",
  summary: "Service health snapshot",
  description:
    "Version, uptime, DB-unlocked flag, memory, node runtime. No financial data — safe for an ops-scoped key.",
  tags: ["Ops"],
  security: AUTH,
  responses: {
    200: {
      description: "Health payload",
      content: { "application/json": { schema: HealthResponse } },
    },
    401: { description: "Missing / invalid credentials", content: { "application/json": { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/logs",
  summary: "Recent console output",
  description:
    "Reads from the in-process ring buffer (max 1000 lines, memory-only). Query with `?limit=N&level=warn,error`.",
  tags: ["Ops"],
  security: AUTH,
  request: {
    query: z.object({
      limit: z.string().optional().openapi({ example: "200" }),
      level: z
        .string()
        .optional()
        .openapi({ example: "warn,error", description: "Comma-separated levels." }),
    }),
  },
  responses: {
    200: {
      description: "Log lines",
      content: { "application/json": { schema: LogsResponse } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/version-check",
  summary: "Running app version",
  tags: ["Ops"],
  security: AUTH,
  responses: {
    200: {
      description: "Latest version this server reports as running.",
      content: {
        "application/json": {
          schema: z.object({ latest: z.string() }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/github-stats",
  summary: "Project GitHub stats",
  description: "Star / fork counts scraped from GitHub. Non-sensitive.",
  tags: ["Ops"],
  security: AUTH,
  responses: {
    200: {
      description: "Stats payload",
      content: {
        "application/json": {
          schema: z.object({
            stars: z.number().int(),
            forks: z.number().int(),
          }),
        },
      },
    },
  },
});

// Admin-only control-plane
registry.registerPath({
  method: "post",
  path: "/api/restart",
  summary: "Exit the process (orchestrator restarts it)",
  description:
    "Requires admin role. Non-scoped: any key with `full` scope + admin role can call this.",
  tags: ["Admin"],
  security: AUTH,
  responses: {
    200: {
      description: "Restart scheduled",
      content: {
        "application/json": {
          schema: z.object({ ok: z.boolean(), message: z.string() }),
        },
      },
    },
    403: {
      description: "Not admin, or scope disallows",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/lock",
  summary: "Drop the SQLCipher key",
  description:
    "Locks the DB — every device on the LAN bounces to /unlock until someone re-enters the passphrase.",
  tags: ["Admin"],
  security: AUTH,
  responses: {
    200: {
      description: "Locked",
      content: {
        "application/json": {
          schema: z.object({ ok: z.boolean() }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/unlock",
  summary: "Provide the SQLCipher passphrase",
  description: "No auth — the DB is required to reach the auth machinery.",
  tags: ["Admin"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ passphrase: z.string() }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Unlocked",
      content: {
        "application/json": {
          schema: z.object({ ok: z.boolean() }),
        },
      },
    },
    401: {
      description: "Wrong passphrase",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

// API-key management
registry.registerPath({
  method: "get",
  path: "/api/settings/api-keys",
  summary: "List API keys",
  description: "Metadata only — plaintext is never returned after creation.",
  tags: ["API keys"],
  security: AUTH,
  responses: {
    200: {
      description: "List",
      content: {
        "application/json": {
          schema: z.array(ApiKeyMetadata),
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/settings/api-keys",
  summary: "Mint a new API key",
  description: "Response body contains the plaintext `key` — copy it now.",
  tags: ["API keys"],
  security: AUTH,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            name: z.string().min(1).max(64),
            role: z.enum(["admin", "member"]).default("admin"),
            scope: z.enum(["full", "ops"]).default("full"),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: "Key minted",
      content: { "application/json": { schema: ApiKeyCreateResponse } },
    },
    403: {
      description: "Not admin",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/settings/api-keys/{id}",
  summary: "Revoke an API key",
  description: "Hard delete — the row is gone; the key stops working immediately.",
  tags: ["API keys"],
  security: AUTH,
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: {
      description: "Revoked",
      content: {
        "application/json": {
          schema: z.object({ ok: z.boolean() }),
        },
      },
    },
    404: {
      description: "Not found",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

// Core financial reads
registry.registerPath({
  method: "get",
  path: "/api/accounts",
  summary: "List accounts",
  tags: ["Accounts"],
  security: AUTH,
  request: {
    query: z.object({
      includeArchived: z
        .string()
        .optional()
        .openapi({ example: "true", description: "`true` to include archived rows." }),
    }),
  },
  responses: {
    200: {
      description: "Accounts",
      content: {
        "application/json": { schema: z.array(AccountSchema) },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/transactions",
  summary: "List transactions",
  description:
    "Windowed by `from`/`to` (defaults ~30 days back). Supports account filter, search, category filter.",
  tags: ["Transactions"],
  security: AUTH,
  request: {
    query: z.object({
      from: z.string().optional(),
      to: z.string().optional(),
      accountIds: z.string().optional().openapi({ description: "Comma-separated." }),
      categoryId: z.string().optional(),
      search: z.string().optional(),
      limit: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Transactions",
      content: {
        "application/json": { schema: z.array(TransactionSchema) },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/categories",
  summary: "List categories",
  tags: ["Categories"],
  security: AUTH,
  request: {
    query: z.object({
      type: z
        .enum(["income", "expense"])
        .optional()
        .openapi({ description: "Filter by category type." }),
    }),
  },
  responses: {
    200: {
      description: "Categories",
      content: {
        "application/json": { schema: z.array(CategorySchema) },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/reports/cashflow",
  summary: "Cashflow report",
  description:
    "Monthly signed totals per category. Feeds the Cashflow tab on /reports.",
  tags: ["Reports"],
  security: AUTH,
  request: {
    query: z.object({
      from: z.string().openapi({ example: "2026-01-01" }),
      to: z.string().openapi({ example: "2026-12-31" }),
      hideTransfers: z.string().optional(),
      accountIds: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Cashflow payload",
      content: { "application/json": { schema: CashflowResponse } },
    },
  },
});

// ── Document generation ───────────────────────────────────────

let cached: ReturnType<OpenApiGeneratorV3["generateDocument"]> | null = null;
export function getOpenApiDocument() {
  if (cached) return cached;
  const generator = new OpenApiGeneratorV3(registry.definitions);
  cached = generator.generateDocument({
    openapi: "3.0.0",
    info: {
      title: "Budgets API",
      version: APP_VERSION,
      description:
        "The Budgets HTTP API. See Settings → Security → API keys to mint a Bearer token.",
    },
    servers: [{ url: "/" }],
    tags: [
      { name: "Ops", description: "Health + logs + version. Ops-scope reachable." },
      { name: "Admin", description: "Admin-role gated control-plane." },
      { name: "API keys", description: "Mint / list / revoke long-lived tokens." },
      { name: "Accounts" },
      { name: "Transactions" },
      { name: "Categories" },
      { name: "Reports" },
    ],
  });
  return cached;
}
