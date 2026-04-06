import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Database,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Loader2,
  FileBarChart,
  Upload,
} from "lucide-react";
import { formatDate } from "@/lib/formatters";

/* ---------- Types ---------- */

interface DatabaseStats {
  total_rows: number;
  database_size: string;
  database_size_bytes: number;
  largest_tables: { table: string; rows: number; size: string }[] | null;
  audit_log_count: number;
  oldest_audit_log: string | null;
}

interface DataHealthRow {
  entity: string;
  total_records: number;
  archived_records: number;
  created_last_24h: number;
  modified_last_24h: number;
  missing_name: number;
  unassigned_records: number;
}

/* ---------- Hooks ---------- */

function useDatabaseStats() {
  return useQuery({
    queryKey: ["database_stats"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_database_stats");
      if (error) throw error;
      return data as DatabaseStats;
    },
  });
}

function useDataHealthCheck() {
  return useQuery({
    queryKey: ["data_health_check"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("data_health_check")
        .select("*");
      if (error) throw error;
      return data as DataHealthRow[];
    },
  });
}

/* ---------- Constants ---------- */

const SUPABASE_FREE_TIER_BYTES = 500 * 1024 * 1024; // 500 MB

const PROTECTION_CHECKLIST = [
  { enabled: true, label: "Soft deletes enabled (all records archived, not deleted)" },
  { enabled: true, label: "Audit logging active (every change tracked with old/new values)" },
  { enabled: true, label: "Row Level Security enforced (all tables)" },
  { enabled: true, label: "SF IDs preserved (Salesforce migration IDs tracked)" },
  { enabled: true, label: "Duplicate detection active (on account/contact/lead creation)" },
  { enabled: false, label: "Automated backups (Supabase handles daily backups on Pro plan)" },
  { enabled: false, label: "Point-in-time recovery (available on Pro plan)" },
];

/* ---------- Component ---------- */

export function DataHealthDashboard() {
  const { data: stats, isLoading: statsLoading } = useDatabaseStats();
  const { data: healthRows, isLoading: healthLoading } = useDataHealthCheck();

  if (statsLoading || healthLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const sizePercent = stats
    ? Math.round((stats.database_size_bytes / SUPABASE_FREE_TIER_BYTES) * 100)
    : 0;
  const sizeWarning = sizePercent > 80;

  return (
    <div className="space-y-6">
      {/* ---- Database Stats ---- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="h-4 w-4" />
            Database Statistics
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {stats && (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Database Size</span>
                <span className="font-medium flex items-center gap-2">
                  {stats.database_size} / 500 MB ({sizePercent}% used)
                  {sizeWarning && (
                    <Badge variant="destructive" className="text-xs">Warning</Badge>
                  )}
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-2.5">
                <div
                  className={`h-2.5 rounded-full transition-all ${
                    sizeWarning ? "bg-destructive" : "bg-primary"
                  }`}
                  style={{ width: `${Math.min(sizePercent, 100)}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Total Rows</span>
                <span className="font-medium">
                  {stats.total_rows?.toLocaleString() ?? "0"}
                </span>
              </div>

              {stats.largest_tables && stats.largest_tables.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs text-muted-foreground mb-2 font-medium">
                    Largest Tables
                  </p>
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Table</TableHead>
                          <TableHead className="text-right">Rows</TableHead>
                          <TableHead className="text-right">Size</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {stats.largest_tables.map((t) => (
                          <TableRow key={t.table}>
                            <TableCell className="font-mono text-xs">
                              {t.table}
                            </TableCell>
                            <TableCell className="text-right">
                              {t.rows.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right">{t.size}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ---- Data Health Table ---- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileBarChart className="h-4 w-4" />
            Data Health
          </CardTitle>
        </CardHeader>
        <CardContent>
          {healthRows && healthRows.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Entity</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Archived</TableHead>
                    <TableHead className="text-right">Created (24h)</TableHead>
                    <TableHead className="text-right">Modified (24h)</TableHead>
                    <TableHead className="text-right">Missing Data</TableHead>
                    <TableHead className="text-right">Unassigned</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {healthRows.map((row) => (
                    <TableRow key={row.entity}>
                      <TableCell className="font-medium capitalize">
                        {row.entity}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.total_records}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.archived_records}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.created_last_24h}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.modified_last_24h}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="inline-flex items-center gap-1">
                          {row.missing_name > 0 && (
                            <AlertTriangle className="h-3 w-3 text-yellow-500" />
                          )}
                          {row.missing_name}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="inline-flex items-center gap-1">
                          {row.unassigned_records > 0 && (
                            <AlertTriangle className="h-3 w-3 text-red-500" />
                          )}
                          {row.unassigned_records}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No data health information available.</p>
          )}
        </CardContent>
      </Card>

      {/* ---- Audit Log Stats ---- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            Audit Log Statistics
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {stats && (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Total Audit Entries</span>
                <span className="font-medium">
                  {stats.audit_log_count?.toLocaleString() ?? "0"}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Oldest Audit Entry</span>
                <span className="font-medium">
                  {formatDate(stats.oldest_audit_log)}
                </span>
              </div>
              {stats.oldest_audit_log && (
                <p className="text-xs text-muted-foreground mt-1">
                  Your audit trail goes back to {formatDate(stats.oldest_audit_log)}.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ---- Data Protection Checklist ---- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            Data Protection Checklist
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {PROTECTION_CHECKLIST.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                {item.enabled ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                )}
                <span className={item.enabled ? "" : "text-muted-foreground"}>
                  {item.label}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* ---- Import Safety ---- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Import Safety
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-md bg-muted/50 border p-3 text-sm space-y-2">
            <p className="font-medium">Before importing data:</p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1">
              <li>
                Export your current data as a backup using the Report Builder and Export CSV.
              </li>
              <li>
                Use the SF ID field to prevent duplicate imports from Salesforce.
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
