import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TriggerCondition {
  field: string;
  operator: "eq" | "neq" | "contains" | "gt" | "lt" | "gte" | "lte";
  value: string;
}

export interface AutomationAction {
  type: "update_field" | "create_activity" | "send_notification";
  // update_field
  entity?: string;
  field?: string;
  value?: string;
  // create_activity
  activity_type?: string;
  subject?: string;
  due_offset_days?: number;
  // send_notification
  message?: string;
}

export interface AutomationRule {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  trigger_entity: "accounts" | "contacts" | "opportunities" | "leads";
  trigger_event: "created" | "updated" | "stage_changed" | "status_changed";
  trigger_conditions: TriggerCondition[];
  actions: AutomationAction[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutomationLogEntry {
  id: number;
  rule_id: string;
  trigger_record_id: string;
  trigger_entity: string;
  actions_executed: AutomationAction[];
  success: boolean;
  error_message: string | null;
  executed_at: string;
}

export type CreateAutomationInput = Pick<
  AutomationRule,
  "name" | "description" | "trigger_entity" | "trigger_event" | "trigger_conditions" | "actions" | "is_active"
>;

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Fetch all automation rules. */
export function useAutomationRules() {
  return useQuery({
    queryKey: ["automation_rules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("automation_rules")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AutomationRule[];
    },
  });
}

/** Create a new automation rule. */
export function useCreateAutomationRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateAutomationInput) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("automation_rules")
        .insert({ ...input, created_by: user?.id ?? null })
        .select()
        .single();
      if (error) throw error;
      return data as AutomationRule;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["automation_rules"] });
    },
  });
}

/** Update an existing automation rule (partial update). */
export function useUpdateAutomationRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...values
    }: Partial<AutomationRule> & { id: string }) => {
      const { data, error } = await supabase
        .from("automation_rules")
        .update(values)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as AutomationRule;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["automation_rules"] });
    },
  });
}

/** Delete an automation rule. */
export function useDeleteAutomationRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("automation_rules")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["automation_rules"] });
    },
  });
}

/** Fetch execution log for a specific rule (or all rules). */
export function useAutomationLog(ruleId?: string) {
  return useQuery({
    queryKey: ["automation_log", ruleId],
    queryFn: async () => {
      let query = supabase
        .from("automation_log")
        .select("*")
        .order("executed_at", { ascending: false })
        .limit(50);

      if (ruleId) {
        query = query.eq("rule_id", ruleId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as AutomationLogEntry[];
    },
  });
}
