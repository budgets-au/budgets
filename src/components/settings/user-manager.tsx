"use client";

import { useEffect, useState } from "react";
import useSWR, { mutate } from "swr";
import { useSession } from "next-auth/react";
import { Loader2, Plus, Trash2, KeyRound, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirm } from "@/hooks/use-confirm-dialog";
import { toast } from "sonner";
import { formatDate } from "@/lib/utils";

interface User {
  id: string;
  name: string;
  username: string;
  role: "admin" | "member";
  createdAt: number;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json()).error ?? "Failed to load");
  return res.json();
};

export function UserManager() {
  const { data: session } = useSession();
  const meId = session?.user?.id;
  const { data: users, isLoading } = useSWR<User[]>("/api/users", fetcher, {
    revalidateOnFocus: false,
  });
  const confirm = useConfirm();
  const [creating, setCreating] = useState(false);

  async function deleteUser(u: User) {
    const isMe = u.id === meId;
    if (isMe) {
      toast.error("You can't delete your own account.");
      return;
    }
    const ok = await confirm({
      title: `Delete ${u.username}?`,
      description: `Removes the account permanently. This can't be undone.`,
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (!ok) return;
    const res = await fetch(`/api/users/${u.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error((await res.json()).error ?? "Delete failed");
      return;
    }
    toast.success(`Deleted ${u.username}`);
    mutate("/api/users");
  }

  async function changePassword(u: User) {
    const next = window.prompt(`New password for ${u.username}:`);
    if (!next) return;
    const res = await fetch(`/api/users/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: next }),
    });
    if (!res.ok) {
      toast.error((await res.json()).error ?? "Update failed");
      return;
    }
    toast.success(`Password updated for ${u.username}`);
  }

  async function toggleRole(u: User) {
    const newRole = u.role === "admin" ? "member" : "admin";
    const res = await fetch(`/api/users/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole }),
    });
    if (!res.ok) {
      toast.error((await res.json()).error ?? "Update failed");
      return;
    }
    toast.success(`${u.username} is now ${newRole}`);
    mutate("/api/users");
  }

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="font-medium">Users</h2>
        <Button
          type="button"
          size="sm"
          onClick={() => setCreating(true)}
          disabled={creating}
        >
          <Plus className="mr-1 h-3.5 w-3.5" /> Add user
        </Button>
      </div>
      {creating && (
        <CreateUserForm
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            mutate("/api/users");
          }}
        />
      )}
      {isLoading ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          Loading…
        </p>
      ) : !users || users.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          No users.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium">Username</th>
              <th className="px-3 py-2 text-left font-medium">Name</th>
              <th className="px-3 py-2 text-left font-medium">Role</th>
              <th className="px-3 py-2 text-left font-medium">Created</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-muted/30">
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                  {u.username}
                  {u.id === meId && (
                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                      you
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{u.name}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
                      u.role === "admin"
                        ? "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {u.role}
                  </span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                  {formatDate(new Date(u.createdAt))}
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="inline-flex gap-1">
                    <button
                      type="button"
                      onClick={() => changePassword(u)}
                      className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                      title="Change password"
                    >
                      <KeyRound className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleRole(u)}
                      className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                      title={u.role === "admin" ? "Demote to member" : "Promote to admin"}
                    >
                      <Shield className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteUser(u)}
                      disabled={u.id === meId}
                      className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground hover:bg-red-500/10 hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
                      title={u.id === meId ? "Can't delete yourself" : "Delete"}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function CreateUserForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-fill name from username if the user hasn't typed one yet —
  // saves a step for "just give me a login" creation.
  useEffect(() => {
    if (!name) setName(username);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, name, password, role }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Create failed");
        return;
      }
      toast.success(`Created ${body.username}`);
      onCreated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-b px-4 py-4 bg-muted/20">
      <div className="space-y-1">
        <Label htmlFor="new-username" className="text-xs">Username</Label>
        <Input
          id="new-username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="new-name" className="text-xs">Display name</Label>
        <Input
          id="new-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="new-password" className="text-xs">Password</Label>
        <Input
          id="new-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="new-role" className="text-xs">Role</Label>
        <select
          id="new-role"
          value={role}
          onChange={(e) => setRole(e.target.value as "admin" | "member")}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      {error && (
        <p className="sm:col-span-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      <div className="sm:col-span-2 flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={busy || !username || !password}>
          {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
          Create
        </Button>
      </div>
    </form>
  );
}
