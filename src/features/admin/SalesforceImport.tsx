import { useState, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Upload,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  Info,
  XCircle,
  Download,
  Clock,
} from "lucide-react";

/* ================================================================
   Types
   ================================================================ */

type EntityType = "accounts" | "contacts" | "opportunities" | "leads";

type MappingConfidence = "exact" | "fuzzy" | "unmapped";

interface ColumnMapping {
  csvColumn: string;
  crmField: string;
  confidence: MappingConfidence;
}

interface FailedRow {
  rowNumber: number;
  csvData: Record<string, string>;
  error: string;
}

interface ImportResult {
  imported: number;
  skipped: number;
  failed: number;
  errors: string[];
  failedRows: FailedRow[];
}

interface ValidationIssue {
  rowNumber: number;
  type: "warning" | "skip";
  message: string;
}

interface ValidationSummary {
  willImport: number;
  warnings: ValidationIssue[];
  willSkip: ValidationIssue[];
}

/* ================================================================
   CSV Parser - handles quoted fields, newlines inside quotes, etc.
   ================================================================ */

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let current = "";
  let inQuotes = false;
  let row: string[] = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        current += '"';
        i++; // skip next quote
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(current.trim());
        current = "";
      } else if (ch === "\n" || (ch === "\r" && next === "\n")) {
        row.push(current.trim());
        if (row.some((cell) => cell !== "")) {
          rows.push(row);
        }
        row = [];
        current = "";
        if (ch === "\r") i++; // skip \n after \r
      } else {
        current += ch;
      }
    }
  }

  // Last field / row
  row.push(current.trim());
  if (row.some((cell) => cell !== "")) {
    rows.push(row);
  }

  return rows;
}

/* ================================================================
   Field mappings per entity
   ================================================================ */

const ACCOUNT_FIELDS: Record<string, string> = {
  "account name": "name",
  "account id": "sf_id",
  industry: "industry",
  website: "website",
  phone: "notes",
  "billing street": "billing_street",
  "billing city": "billing_city",
  "billing state/province": "billing_state",
  "billing state": "billing_state",
  "billing zip/postal code": "billing_zip",
  "billing zip": "billing_zip",
  "billing country": "billing_country",
  "account owner": "owner_user_id",
  type: "account_type",
  "annual revenue": "annual_revenue",
  employees: "employees",
};

const CONTACT_FIELDS: Record<string, string> = {
  "first name": "first_name",
  "last name": "last_name",
  email: "email",
  title: "title",
  phone: "phone",
  "account id": "account_id_sf_lookup",
  "contact id": "sf_id",
};

const OPPORTUNITY_FIELDS: Record<string, string> = {
  "opportunity name": "name",
  "account id": "account_id_sf_lookup",
  stage: "stage",
  amount: "amount",
  "close date": "close_date",
  "opportunity id": "sf_id",
  type: "kind",
};

const LEAD_FIELDS: Record<string, string> = {
  "first name": "first_name",
  "last name": "last_name",
  email: "email",
  company: "company",
  status: "status",
  "lead source": "source",
  "lead id": "sf_id",
  phone: "phone",
  title: "title",
  industry: "industry",
  website: "website",
  employees: "employees",
  "annual revenue": "annual_revenue",
  street: "street",
  city: "city",
  state: "state",
  "zip/postal code": "zip",
  zip: "zip",
  country: "country",
};

function getFieldMap(entity: EntityType): Record<string, string> {
  switch (entity) {
    case "accounts":
      return ACCOUNT_FIELDS;
    case "contacts":
      return CONTACT_FIELDS;
    case "opportunities":
      return OPPORTUNITY_FIELDS;
    case "leads":
      return LEAD_FIELDS;
  }
}

/** All possible CRM target fields for a given entity. */
function getCRMFields(entity: EntityType): string[] {
  switch (entity) {
    case "accounts":
      return [
        "name",
        "sf_id",
        "industry",
        "website",
        "notes",
        "billing_street",
        "billing_city",
        "billing_state",
        "billing_zip",
        "billing_country",
        "owner_user_id",
        "account_type",
        "annual_revenue",
        "employees",
        "lifecycle_status",
        "status",
        "timezone",
        "fte_count",
        "fte_range",
        "locations",
      ];
    case "contacts":
      return [
        "first_name",
        "last_name",
        "email",
        "title",
        "phone",
        "sf_id",
        "account_id_sf_lookup",
        "is_primary",
        "department",
        "linkedin_url",
      ];
    case "opportunities":
      return [
        "name",
        "sf_id",
        "account_id_sf_lookup",
        "stage",
        "amount",
        "close_date",
        "kind",
        "expected_close_date",
        "notes",
        "probability",
        "description",
      ];
    case "leads":
      return [
        "first_name",
        "last_name",
        "email",
        "company",
        "status",
        "source",
        "sf_id",
        "phone",
        "title",
        "industry",
        "website",
        "employees",
        "annual_revenue",
        "street",
        "city",
        "state",
        "zip",
        "country",
        "description",
      ];
  }
}

/** Human-readable label for a CRM field key. */
function fieldLabel(key: string): string {
  return key
    .replace(/_sf_lookup$/, " (SF Lookup)")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ================================================================
   Fuzzy matching helpers
   ================================================================ */

/** Compute similarity between two strings (Dice coefficient on bigrams). */
function stringSimilarity(a: string, b: string): number {
  const s1 = a.toLowerCase().replace(/[^a-z0-9]/g, "");
  const s2 = b.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (s1 === s2) return 1;
  if (s1.length < 2 || s2.length < 2) return 0;

  const bigrams1 = new Map<string, number>();
  for (let i = 0; i < s1.length - 1; i++) {
    const bigram = s1.substring(i, i + 2);
    bigrams1.set(bigram, (bigrams1.get(bigram) ?? 0) + 1);
  }

  let intersections = 0;
  for (let i = 0; i < s2.length - 1; i++) {
    const bigram = s2.substring(i, i + 2);
    const count = bigrams1.get(bigram) ?? 0;
    if (count > 0) {
      bigrams1.set(bigram, count - 1);
      intersections++;
    }
  }

  return (2 * intersections) / (s1.length + s2.length - 2);
}

/** Try to fuzzy-match a CSV header to a CRM field. */
function fuzzyMatchField(
  header: string,
  crmFields: string[]
): { field: string; confidence: MappingConfidence } | null {
  const normalized = header.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  let bestField = "";
  let bestScore = 0;

  for (const field of crmFields) {
    const fieldWords = field.replace(/_/g, " ");
    const score = stringSimilarity(normalized, fieldWords);
    if (score > bestScore) {
      bestScore = score;
      bestField = field;
    }
  }

  if (bestScore >= 0.6) {
    return { field: bestField, confidence: "fuzzy" };
  }
  return null;
}

/* ================================================================
   Validation helpers
   ================================================================ */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateRow(
  _rowIndex: number,
  mapped: Record<string, string>,
  entity: EntityType
): { type: "warning" | "skip"; message: string } | null {
  // Check email format if present
  if (mapped.email && !EMAIL_REGEX.test(mapped.email)) {
    return {
      type: "warning",
      message: `Invalid email format "${mapped.email}"`,
    };
  }

  // Check required fields
  if (entity === "accounts" && !mapped.name) {
    return { type: "skip", message: "Missing required field \"name\"" };
  }
  if (entity === "contacts" && (!mapped.first_name || !mapped.last_name)) {
    return { type: "skip", message: "Missing required field \"first_name\" or \"last_name\"" };
  }
  if (entity === "leads" && (!mapped.first_name || !mapped.last_name)) {
    return { type: "skip", message: "Missing required field \"first_name\" or \"last_name\"" };
  }
  if (entity === "opportunities" && !mapped.name) {
    return { type: "skip", message: "Missing required field \"name\"" };
  }

  return null;
}

/* ================================================================
   CSV export for error report
   ================================================================ */

function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function downloadErrorReport(failedRows: FailedRow[]) {
  if (failedRows.length === 0) return;

  const csvHeaders = Object.keys(failedRows[0].csvData);
  const header = [...csvHeaders.map(escapeCsvField), "Error"].join(",");
  const rows = failedRows.map((fr) => {
    const values = csvHeaders.map((h) => escapeCsvField(fr.csvData[h] ?? ""));
    return [...values, escapeCsvField(fr.error)].join(",");
  });
  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const link = document.createElement("a");
  link.href = url;
  link.download = `import-errors-${timestamp}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/* ================================================================
   Component
   ================================================================ */

export function SalesforceImport() {
  const [entity, setEntity] = useState<EntityType>("accounts");
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [currentBatch, setCurrentBatch] = useState({ batch: 0, totalBatches: 0 });
  const [estimatedTimeRemaining, setEstimatedTimeRemaining] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [validation, setValidation] = useState<ValidationSummary | null>(null);
  const [duplicateAction, setDuplicateAction] = useState<"skip" | "update">(
    "skip"
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importStartTimeRef = useRef<number>(0);

  /* ---------- File handling ---------- */

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setResult(null);
      setValidation(null);

      const reader = new FileReader();
      reader.onload = (evt) => {
        const text = evt.target?.result as string;
        const parsed = parseCSV(text);
        if (parsed.length < 2) {
          toast.error("CSV must have a header row and at least one data row.");
          return;
        }

        const headers = parsed[0];
        const dataRows = parsed.slice(1);
        setCsvHeaders(headers);
        setCsvRows(dataRows);

        // Auto-map columns with confidence tracking
        const fieldMap = getFieldMap(entity);
        const crmFields = getCRMFields(entity);
        const autoMappings: ColumnMapping[] = headers.map((h) => {
          const normalized = h.toLowerCase().trim();
          const exactMatch = fieldMap[normalized];
          if (exactMatch) {
            return { csvColumn: h, crmField: exactMatch, confidence: "exact" as MappingConfidence };
          }
          // Try fuzzy match
          const fuzzy = fuzzyMatchField(h, crmFields);
          if (fuzzy) {
            return { csvColumn: h, crmField: fuzzy.field, confidence: fuzzy.confidence };
          }
          return { csvColumn: h, crmField: "", confidence: "unmapped" as MappingConfidence };
        });
        setMappings(autoMappings);
        toast.success(`Loaded ${dataRows.length} rows from ${file.name}`);
      };
      reader.readAsText(file);
    },
    [entity]
  );

  const updateMapping = useCallback(
    (csvColumn: string, crmField: string) => {
      setMappings((prev) =>
        prev.map((m) =>
          m.csvColumn === csvColumn
            ? { ...m, crmField, confidence: crmField ? "exact" : "unmapped" }
            : m
        )
      );
    },
    []
  );

  /* ---------- Build mapped data for preview ---------- */

  function buildMappedRow(
    rowValues: string[],
    headers: string[],
    columnMappings: ColumnMapping[]
  ): Record<string, string> {
    const mapped: Record<string, string> = {};
    headers.forEach((header, idx) => {
      const mapping = columnMappings.find((m) => m.csvColumn === header);
      if (mapping?.crmField) {
        mapped[mapping.crmField] = rowValues[idx] ?? "";
      }
    });
    return mapped;
  }

  function buildCsvDataRow(
    rowValues: string[],
    headers: string[]
  ): Record<string, string> {
    const data: Record<string, string> = {};
    headers.forEach((header, idx) => {
      data[header] = rowValues[idx] ?? "";
    });
    return data;
  }

  const previewRows = csvRows.slice(0, 5).map((row) =>
    buildMappedRow(row, csvHeaders, mappings)
  );

  const activeMappings = mappings.filter((m) => m.crmField !== "");

  // Mapping stats
  const autoMappedCount = mappings.filter(
    (m) => m.confidence === "exact" || m.confidence === "fuzzy"
  ).length;
  const manualNeededCount = mappings.filter(
    (m) => m.confidence === "unmapped" && m.crmField === ""
  ).length;
  const skippedCount = mappings.filter((m) => m.crmField === "").length;

  /* ---------- Validation ---------- */

  function runValidation(): ValidationSummary {
    const warnings: ValidationIssue[] = [];
    const willSkip: ValidationIssue[] = [];

    // Check for duplicate SF IDs
    const sfIdMapping = mappings.find((m) => m.crmField === "sf_id");
    const sfIdColIndex = sfIdMapping
      ? csvHeaders.indexOf(sfIdMapping.csvColumn)
      : -1;
    const seenSfIds = new Set<string>();

    for (let i = 0; i < csvRows.length; i++) {
      const row = csvRows[i];
      const mapped = buildMappedRow(row, csvHeaders, mappings);

      // Check for duplicate SF IDs within the file
      if (sfIdColIndex >= 0) {
        const sfId = row[sfIdColIndex];
        if (sfId && seenSfIds.has(sfId)) {
          willSkip.push({
            rowNumber: i + 1,
            type: "skip",
            message: `Duplicate SF ID "${sfId}" within file`,
          });
          continue;
        }
        if (sfId) seenSfIds.add(sfId);
      }

      const issue = validateRow(i + 1, mapped, entity);
      if (issue) {
        if (issue.type === "skip") {
          willSkip.push({ rowNumber: i + 1, ...issue });
        } else {
          warnings.push({ rowNumber: i + 1, ...issue });
        }
      }
    }

    const willImport = csvRows.length - willSkip.length;
    return { willImport, warnings, willSkip };
  }

  function handleValidate() {
    const summary = runValidation();
    setValidation(summary);
  }

  /* ---------- Import ---------- */

  async function handleImport() {
    if (activeMappings.length === 0) {
      toast.error("Map at least one column before importing.");
      return;
    }

    setImporting(true);
    setResult(null);
    importStartTimeRef.current = Date.now();

    const imported: number[] = [0];
    const skippedArr: number[] = [0];
    const failedCount: number[] = [0];
    const errors: string[] = [];
    const failedRows: FailedRow[] = [];

    try {
      // Pre-fetch lookup data
      const { data: users } = await supabase
        .from("user_profiles")
        .select("id, full_name");

      let accountSfMap: Map<string, string> | null = null;
      if (
        entity === "contacts" ||
        entity === "opportunities"
      ) {
        const { data: accounts } = await supabase
          .from("accounts")
          .select("id, sf_id")
          .not("sf_id", "is", null);
        accountSfMap = new Map(
          (accounts ?? []).map((a) => [a.sf_id as string, a.id as string])
        );
      }

      const tableName = entity;
      const batchSize = 50;
      const total = csvRows.length;
      const totalBatches = Math.ceil(total / batchSize);
      setProgress({ current: 0, total });
      setCurrentBatch({ batch: 0, totalBatches });

      for (let i = 0; i < total; i += batchSize) {
        const batchNum = Math.floor(i / batchSize) + 1;
        setCurrentBatch({ batch: batchNum, totalBatches });

        const batch = csvRows.slice(i, i + batchSize);
        const records: Record<string, unknown>[] = [];
        const recordRowIndices: number[] = [];

        for (let j = 0; j < batch.length; j++) {
          const rowIndex = i + j;
          const row = batch[j];
          const mapped = buildMappedRow(row, csvHeaders, mappings);
          const csvData = buildCsvDataRow(row, csvHeaders);

          const record: Record<string, unknown> = {};
          let skipRow = false;

          for (const [field, value] of Object.entries(mapped)) {
            if (!value && value !== "0") continue;

            if (field === "owner_user_id") {
              // Lookup user by name
              const user = users?.find(
                (u) =>
                  u.full_name?.toLowerCase() === value.toLowerCase()
              );
              if (user) {
                record.owner_user_id = user.id;
              }
              continue;
            }

            if (field === "account_id_sf_lookup") {
              // Lookup account by SF ID
              if (accountSfMap) {
                const accountId = accountSfMap.get(value);
                if (accountId) {
                  record.account_id = accountId;
                } else {
                  const errMsg = `Account SF ID "${value}" not found in CRM`;
                  errors.push(`Row ${rowIndex + 1}: ${errMsg}`);
                  failedRows.push({ rowNumber: rowIndex + 1, csvData, error: errMsg });
                  failedCount[0]++;
                  skipRow = true;
                }
              }
              continue;
            }

            // Numeric fields
            if (
              [
                "annual_revenue",
                "employees",
                "amount",
                "probability",
                "fte_count",
                "locations",
              ].includes(field)
            ) {
              const num = Number(value.replace(/[,$]/g, ""));
              if (!isNaN(num)) {
                record[field] = num;
              }
              continue;
            }

            // Boolean fields
            if (field === "is_primary") {
              record[field] = value.toLowerCase() === "true" || value === "1";
              continue;
            }

            record[field] = value;
          }

          if (skipRow) {
            continue;
          }

          // Check for required fields
          if (entity === "accounts" && !record.name) {
            const errMsg = "Missing account name";
            errors.push(`Row ${rowIndex + 1}: ${errMsg}`);
            failedRows.push({ rowNumber: rowIndex + 1, csvData, error: errMsg });
            failedCount[0]++;
            continue;
          }
          if (entity === "contacts" && (!record.first_name || !record.last_name)) {
            const errMsg = "Missing first or last name";
            errors.push(`Row ${rowIndex + 1}: ${errMsg}`);
            failedRows.push({ rowNumber: rowIndex + 1, csvData, error: errMsg });
            failedCount[0]++;
            continue;
          }
          if (entity === "contacts" && !record.account_id) {
            const errMsg = "Missing account reference";
            errors.push(`Row ${rowIndex + 1}: ${errMsg}`);
            failedRows.push({ rowNumber: rowIndex + 1, csvData, error: errMsg });
            failedCount[0]++;
            continue;
          }
          if (entity === "opportunities" && (!record.name || !record.account_id)) {
            const errMsg = "Missing name or account reference";
            errors.push(`Row ${rowIndex + 1}: ${errMsg}`);
            failedRows.push({ rowNumber: rowIndex + 1, csvData, error: errMsg });
            failedCount[0]++;
            continue;
          }
          if (entity === "leads" && (!record.first_name || !record.last_name)) {
            const errMsg = "Missing first or last name";
            errors.push(`Row ${rowIndex + 1}: ${errMsg}`);
            failedRows.push({ rowNumber: rowIndex + 1, csvData, error: errMsg });
            failedCount[0]++;
            continue;
          }

          // Email validation
          if (
            record.email &&
            typeof record.email === "string" &&
            !EMAIL_REGEX.test(record.email)
          ) {
            const errMsg = `Invalid email format "${record.email}"`;
            errors.push(`Row ${rowIndex + 1}: ${errMsg}`);
            failedRows.push({ rowNumber: rowIndex + 1, csvData, error: errMsg });
            failedCount[0]++;
            continue;
          }

          // Defaults
          if (entity === "accounts") {
            record.lifecycle_status = record.lifecycle_status ?? "prospect";
            record.status = record.status ?? "discovery";
          }
          if (entity === "opportunities") {
            record.stage = record.stage ?? "lead";
            record.amount = record.amount ?? 0;
            record.team = record.team ?? "sales";
            record.kind = record.kind ?? "new_business";
          }
          if (entity === "leads") {
            record.status = record.status ?? "new";
          }

          records.push(record);
          recordRowIndices.push(rowIndex);
        }

        if (records.length === 0) {
          setProgress({ current: Math.min(i + batchSize, total), total });
          // Update ETA
          updateETA(Math.min(i + batchSize, total), total);
          continue;
        }

        // Check for duplicates by sf_id
        const sfIds = records
          .map((r) => r.sf_id)
          .filter((id): id is string => typeof id === "string" && id !== "");

        let existingSfIds = new Set<string>();
        if (sfIds.length > 0) {
          const { data: existing } = await supabase
            .from(tableName)
            .select("id, sf_id")
            .in("sf_id", sfIds);
          existingSfIds = new Set(
            (existing ?? []).map((e) => e.sf_id as string)
          );
        }

        const toInsert: Record<string, unknown>[] = [];
        const toUpdate: { id: string; data: Record<string, unknown> }[] = [];

        for (const record of records) {
          const sfId = record.sf_id as string | undefined;
          if (sfId && existingSfIds.has(sfId)) {
            if (duplicateAction === "skip") {
              skippedArr[0]++;
            } else {
              // Find existing record id
              const { data: existing } = await supabase
                .from(tableName)
                .select("id")
                .eq("sf_id", sfId)
                .limit(1)
                .single();
              if (existing) {
                const { sf_id: _removed, ...updateData } = record;
                toUpdate.push({ id: existing.id, data: updateData });
              }
            }
          } else {
            toInsert.push(record);
          }
        }

        // Insert new records
        if (toInsert.length > 0) {
          const { error: insertError } = await supabase
            .from(tableName)
            .insert(toInsert);
          if (insertError) {
            errors.push(
              `Batch at row ${i + 1}: ${insertError.message}`
            );
          } else {
            imported[0] += toInsert.length;
          }
        }

        // Update existing records
        for (const { id: recordId, data } of toUpdate) {
          const { error: updateError } = await supabase
            .from(tableName)
            .update(data)
            .eq("id", recordId);
          if (updateError) {
            errors.push(
              `Update sf_id ${data.sf_id ?? recordId}: ${updateError.message}`
            );
          } else {
            imported[0]++;
          }
        }

        setProgress({ current: Math.min(i + batchSize, total), total });
        updateETA(Math.min(i + batchSize, total), total);
      }
    } catch (err) {
      errors.push(`Unexpected error: ${(err as Error).message}`);
    }

    setImporting(false);
    setEstimatedTimeRemaining(null);
    setResult({
      imported: imported[0],
      skipped: skippedArr[0],
      failed: failedCount[0],
      errors,
      failedRows,
    });

    if (errors.length === 0) {
      toast.success(
        `Import complete: ${imported[0]} records imported, ${skippedArr[0]} skipped.`
      );
    } else {
      toast.warning(
        `Import finished with ${errors.length} issue(s). See details below.`
      );
    }
  }

  function updateETA(processed: number, total: number) {
    if (processed === 0) {
      setEstimatedTimeRemaining(null);
      return;
    }
    const elapsed = Date.now() - importStartTimeRef.current;
    const rate = processed / elapsed; // rows per ms
    const remaining = total - processed;
    const etaMs = remaining / rate;

    if (etaMs < 1000) {
      setEstimatedTimeRemaining("< 1 second");
    } else if (etaMs < 60000) {
      setEstimatedTimeRemaining(`~${Math.ceil(etaMs / 1000)} seconds`);
    } else {
      const mins = Math.ceil(etaMs / 60000);
      setEstimatedTimeRemaining(`~${mins} minute${mins > 1 ? "s" : ""}`);
    }
  }

  /* ---------- Reset ---------- */

  function handleReset() {
    setCsvHeaders([]);
    setCsvRows([]);
    setMappings([]);
    setResult(null);
    setValidation(null);
    setProgress({ current: 0, total: 0 });
    setCurrentBatch({ batch: 0, totalBatches: 0 });
    setEstimatedTimeRemaining(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  /* ---------- Render ---------- */

  const crmFields = getCRMFields(entity);
  const progressPercent =
    progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0;

  return (
    <div className="space-y-6">
      {/* Instructions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Info className="h-4 w-4 text-blue-500" />
            How to Import from Salesforce
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
            <li>
              Export your data from Salesforce using Data Loader or Reports (CSV
              format).
            </li>
            <li>Select the entity type you want to import below.</li>
            <li>Upload your CSV file.</li>
            <li>
              Review the column mapping -- common Salesforce field names are
              auto-detected.
            </li>
            <li>Preview your data, validate, and click Import.</li>
          </ol>
        </CardContent>
      </Card>

      {/* Step 1: Entity Type */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Step 1: Select Entity Type
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-w-xs">
            <Label htmlFor="entity-type">Entity</Label>
            <Select
              value={entity}
              onValueChange={(v) => {
                setEntity(v as EntityType);
                handleReset();
              }}
            >
              <SelectTrigger id="entity-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="accounts">Accounts</SelectItem>
                <SelectItem value="contacts">Contacts</SelectItem>
                <SelectItem value="opportunities">Opportunities</SelectItem>
                <SelectItem value="leads">Leads</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Step 2: Upload CSV */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Step 2: Upload CSV</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <Input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="max-w-sm"
            />
            {csvRows.length > 0 && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileSpreadsheet className="h-4 w-4" />
                {csvRows.length} rows, {csvHeaders.length} columns
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Step 3: Column Mapping */}
      {csvHeaders.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              <span>Step 3: Column Mapping</span>
              <div className="flex items-center gap-3 text-xs font-normal">
                <span className="inline-flex items-center gap-1 text-green-600">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {autoMappedCount} auto-mapped
                </span>
                {manualNeededCount > 0 && (
                  <span className="inline-flex items-center gap-1 text-yellow-600">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {manualNeededCount} unmapped
                  </span>
                )}
                {skippedCount > 0 && (
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    {skippedCount} skipped
                  </span>
                )}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">Match</TableHead>
                    <TableHead>CSV Column</TableHead>
                    <TableHead>CRM Field</TableHead>
                    <TableHead>Sample Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mappings.map((m, idx) => (
                    <TableRow key={m.csvColumn}>
                      <TableCell>
                        {m.crmField ? (
                          m.confidence === "exact" ? (
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                          ) : m.confidence === "fuzzy" ? (
                            <AlertTriangle className="h-4 w-4 text-yellow-500" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                          )
                        ) : (
                          <XCircle className="h-4 w-4 text-muted-foreground/40" />
                        )}
                      </TableCell>
                      <TableCell className="font-medium">
                        {m.csvColumn}
                        {m.confidence === "fuzzy" && m.crmField && (
                          <Badge variant="outline" className="ml-2 text-[10px] px-1 py-0 text-yellow-600 border-yellow-300">
                            fuzzy
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={m.crmField || "__skip__"}
                          onValueChange={(v) =>
                            updateMapping(
                              m.csvColumn,
                              v === "__skip__" ? "" : v
                            )
                          }
                        >
                          <SelectTrigger className="w-[200px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__skip__">
                              -- Skip this column --
                            </SelectItem>
                            {crmFields.map((f) => (
                              <SelectItem key={f} value={f}>
                                {fieldLabel(f)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground truncate max-w-[200px]">
                        {csvRows[0]?.[idx] ?? ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Preview */}
      {previewRows.length > 0 && activeMappings.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Step 4: Preview (first {previewRows.length} rows)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {activeMappings.map((m) => (
                      <TableHead key={m.crmField}>
                        {fieldLabel(m.crmField)}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRows.map((row, idx) => (
                    <TableRow key={idx}>
                      {activeMappings.map((m) => (
                        <TableCell
                          key={m.crmField}
                          className="truncate max-w-[200px]"
                        >
                          {row[m.crmField] ?? ""}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Validation Preview */}
      {csvRows.length > 0 && activeMappings.length > 0 && !result && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Step 5: Validate & Import
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Validate button */}
            {!validation && (
              <Button variant="outline" onClick={handleValidate}>
                <CheckCircle2 className="h-4 w-4 mr-1.5" />
                Validate Before Import
              </Button>
            )}

            {/* Validation summary */}
            {validation && (
              <div className="rounded-md border p-4 space-y-3">
                <h4 className="text-sm font-medium">Validation Summary</h4>
                <div className="flex items-center gap-4 text-sm">
                  <span className="inline-flex items-center gap-1.5 text-green-600">
                    <CheckCircle2 className="h-4 w-4" />
                    {validation.willImport} rows will be imported
                  </span>
                  {validation.warnings.length > 0 && (
                    <span className="inline-flex items-center gap-1.5 text-yellow-600">
                      <AlertTriangle className="h-4 w-4" />
                      {validation.warnings.length} rows have warnings
                    </span>
                  )}
                  {validation.willSkip.length > 0 && (
                    <span className="inline-flex items-center gap-1.5 text-destructive">
                      <XCircle className="h-4 w-4" />
                      {validation.willSkip.length} rows will be skipped
                    </span>
                  )}
                </div>

                {/* Warning details */}
                {validation.warnings.length > 0 && (
                  <div className="bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 rounded-md p-3">
                    <p className="text-xs font-medium text-yellow-700 dark:text-yellow-400 mb-1">
                      Warnings:
                    </p>
                    <ul className="text-xs text-yellow-600 dark:text-yellow-500 space-y-0.5 max-h-32 overflow-y-auto">
                      {validation.warnings.map((w, idx) => (
                        <li key={idx}>
                          Row {w.rowNumber}: {w.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Skip details */}
                {validation.willSkip.length > 0 && (
                  <div className="bg-destructive/5 border border-destructive/20 rounded-md p-3">
                    <p className="text-xs font-medium text-destructive mb-1">
                      Will be skipped:
                    </p>
                    <ul className="text-xs text-destructive space-y-0.5 max-h-32 overflow-y-auto">
                      {validation.willSkip.map((s, idx) => (
                        <li key={idx}>
                          Row {s.rowNumber}: {s.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Import controls */}
            <div className="flex items-center gap-4">
              <div className="space-y-1">
                <Label>Duplicate Handling (by SF ID)</Label>
                <Select
                  value={duplicateAction}
                  onValueChange={(v) =>
                    setDuplicateAction(v as "skip" | "update")
                  }
                >
                  <SelectTrigger className="w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="skip">Skip Duplicates</SelectItem>
                    <SelectItem value="update">
                      Update Existing
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2 pt-5">
                <Button
                  onClick={handleImport}
                  disabled={importing}
                >
                  <Upload className="h-4 w-4 mr-1" />
                  {importing
                    ? `Importing...`
                    : `Import ${csvRows.length} rows`}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleReset}
                  disabled={importing}
                >
                  Reset
                </Button>
              </div>
            </div>

            {/* Progress bar */}
            {importing && (
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>
                    Importing row {progress.current} of {progress.total}
                  </span>
                  <span>{progressPercent}%</span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300 rounded-full"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <FileSpreadsheet className="h-3 w-3" />
                    Batch {currentBatch.batch} of {currentBatch.totalBatches}
                  </span>
                  {estimatedTimeRemaining && (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {estimatedTimeRemaining} remaining
                    </span>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Import Results Summary */}
      {result && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              {result.failed === 0 && result.errors.length === 0 ? (
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-yellow-600" />
              )}
              Import Complete
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-green-600">
                <CheckCircle2 className="h-4 w-4" />
                {result.imported} records imported successfully
              </div>
              {result.skipped > 0 && (
                <div className="flex items-center gap-2 text-sm text-yellow-600">
                  <AlertTriangle className="h-4 w-4" />
                  {result.skipped} records skipped (duplicate SF ID)
                </div>
              )}
              {result.failed > 0 && (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <XCircle className="h-4 w-4" />
                  {result.failed} records failed (details below)
                </div>
              )}
            </div>

            {/* Failed rows details */}
            {result.failedRows.length > 0 && (
              <div className="space-y-3">
                <div className="bg-destructive/5 border border-destructive/20 rounded-md p-3 max-h-48 overflow-y-auto">
                  <p className="text-sm font-medium text-destructive mb-2">
                    Failed rows:
                  </p>
                  <ul className="text-xs text-destructive space-y-1">
                    {result.failedRows.map((fr, idx) => (
                      <li key={idx}>
                        <span className="font-medium">Row {fr.rowNumber}:</span>{" "}
                        {fr.error}
                      </li>
                    ))}
                  </ul>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => downloadErrorReport(result.failedRows)}
                >
                  <Download className="h-4 w-4 mr-1.5" />
                  Download Error Report
                </Button>
              </div>
            )}

            {/* Non-row-specific errors (batch errors) */}
            {result.errors.length > 0 && result.errors.some((e) => !result.failedRows.some((fr) => e.includes(`Row ${fr.rowNumber}`))) && (
              <div className="bg-destructive/5 border border-destructive/20 rounded-md p-3 max-h-48 overflow-y-auto">
                <p className="text-sm font-medium text-destructive mb-1">
                  Other errors:
                </p>
                <ul className="text-xs text-destructive space-y-0.5">
                  {result.errors
                    .filter((e) => !result.failedRows.some((fr) => e.startsWith(`Row ${fr.rowNumber}:`)))
                    .map((err, idx) => (
                      <li key={idx}>{err}</li>
                    ))}
                </ul>
              </div>
            )}

            <Button
              variant="outline"
              onClick={handleReset}
            >
              Start New Import
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
