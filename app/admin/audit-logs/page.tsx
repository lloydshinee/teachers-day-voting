import type { Metadata } from "next";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdminSession } from "@/lib/auth/admin-session";

export const metadata: Metadata = {
  title: "Audit Logs · Admin",
  description: "Read-only list of immutable system and election audit logs.",
};

interface AuditLogRow {
  id: string;
  election_id: string | null;
  actor_admin_id: string | null;
  action: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

export default async function AdminAuditLogsPage() {
  const auth = await requireAdminSession({
    unauthenticatedMessage: "Sign in as an admin to view audit logs.",
  });

  if (!auth.ok) {
    return (
      <section aria-labelledby="audit-heading" className="flex flex-col gap-4">
        <div>
          <h1 id="audit-heading" className="text-2xl font-semibold tracking-tight">
            Audit Logs
          </h1>
        </div>
        <p role="alert" className="text-sm font-medium text-destructive">
          {auth.message}
        </p>
      </section>
    );
  }

  const supabase = auth.session.supabase;
  const { data: rawRows, error } = await supabase
    .from("audit_logs")
    .select("id, election_id, actor_admin_id, action, details, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return (
      <section aria-labelledby="audit-heading" className="flex flex-col gap-4">
        <div>
          <h1 id="audit-heading" className="text-2xl font-semibold tracking-tight">
            Audit Logs
          </h1>
        </div>
        <p role="alert" className="text-sm font-medium text-destructive">
          Could not load audit logs. Try again.
        </p>
      </section>
    );
  }

  const logs = (rawRows ?? []) as AuditLogRow[];

  return (
    <section aria-labelledby="audit-heading" className="flex flex-col gap-6">
      <div>
        <h1 id="audit-heading" className="text-2xl font-semibold tracking-tight">
          Audit Logs
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Immutable, read-only record of election lifecycle events, code generations,
          tie resolutions, and published results. Never records voter identity paired with choice.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Recent Events ({logs.length})</CardTitle>
          <span className="text-xs text-muted-foreground">Last 100 entries</span>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No audit logs recorded yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border/80 text-muted-foreground">
                    <th className="py-2.5 px-3 font-semibold">Timestamp</th>
                    <th className="py-2.5 px-3 font-semibold">Action</th>
                    <th className="py-2.5 px-3 font-semibold">Actor / Election</th>
                    <th className="py-2.5 px-3 font-semibold">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {logs.map((log) => {
                    const formattedDate = new Date(log.created_at).toLocaleString();
                    return (
                      <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                        <td className="py-3 px-3 text-muted-foreground whitespace-nowrap tabular-nums">
                          {formattedDate}
                        </td>
                        <td className="py-3 px-3">
                          <span className="inline-block rounded-md bg-primary/10 border border-primary/20 px-2 py-0.5 text-[11px] font-bold text-primary font-mono">
                            {log.action}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-muted-foreground">
                          {log.actor_admin_id ? (
                            <div className="truncate max-w-[140px]" title={log.actor_admin_id}>
                              Admin: {log.actor_admin_id.slice(0, 8)}…
                            </div>
                          ) : (
                            <span className="text-muted-foreground/60">System</span>
                          )}
                          {log.election_id ? (
                            <div className="truncate max-w-[140px] text-[10px]" title={log.election_id}>
                              Elec: {log.election_id.slice(0, 8)}…
                            </div>
                          ) : null}
                        </td>
                        <td className="py-3 px-3 max-w-md">
                          <pre className="font-mono text-[11px] text-muted-foreground whitespace-pre-wrap break-all bg-muted/30 p-2 rounded max-h-24 overflow-y-auto">
                            {JSON.stringify(log.details, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
