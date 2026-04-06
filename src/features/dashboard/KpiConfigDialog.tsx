import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { AppRole } from "@/types/crm";
import {
  KPI_REGISTRY,
  DEFAULT_KPIS,
  saveKpiConfig,
  getAvailableKpis,
} from "./kpi-registry";

// ---------------------------------------------------------------------------
// Category metadata
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<string, string> = {
  sales: "Sales Metrics",
  renewals: "Renewals Metrics",
  team: "Team Metrics (Admin Only)",
};

const CATEGORY_ORDER = ["sales", "renewals", "team"] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function KpiConfigDialog({
  open,
  onOpenChange,
  role,
  selectedKpis,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: AppRole;
  selectedKpis: string[];
  onSave: (selected: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(selectedKpis),
  );

  const availableKpis = getAvailableKpis(role);

  function handleToggle(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  function handleReset() {
    setSelected(new Set(DEFAULT_KPIS[role]));
  }

  function handleSave() {
    // Preserve ordering from KPI_REGISTRY
    const ordered = KPI_REGISTRY.filter((k) => selected.has(k.id)).map(
      (k) => k.id,
    );
    saveKpiConfig(ordered);
    onSave(ordered);
    onOpenChange(false);
  }

  // Reset local state when dialog opens
  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setSelected(new Set(selectedKpis));
    }
    onOpenChange(nextOpen);
  }

  // Group available KPIs by category
  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    label: CATEGORY_LABELS[cat],
    kpis: availableKpis.filter((k) => k.category === cat),
  })).filter((g) => g.kpis.length > 0);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Configure KPI Dashboard</DialogTitle>
          <DialogDescription>
            Select the metrics you want to see on your dashboard.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4 max-h-[60vh] overflow-y-auto">
          {grouped.map((group) => (
            <div key={group.category} className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground">
                {group.label}
              </h3>
              <div className="space-y-2">
                {group.kpis.map((kpi) => (
                  <div
                    key={kpi.id}
                    className="flex items-center gap-3"
                  >
                    <Checkbox
                      id={`kpi-${kpi.id}`}
                      checked={selected.has(kpi.id)}
                      onCheckedChange={(checked) =>
                        handleToggle(kpi.id, !!checked)
                      }
                    />
                    <Label
                      htmlFor={`kpi-${kpi.id}`}
                      className="cursor-pointer text-sm"
                    >
                      {kpi.label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <DialogFooter className="flex justify-between sm:justify-between">
          <Button variant="ghost" onClick={handleReset}>
            Reset to Default
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
