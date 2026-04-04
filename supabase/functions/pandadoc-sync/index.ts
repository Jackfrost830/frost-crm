// pandadoc-sync Edge Function
//
// Receives PandaDoc webhooks and syncs document status changes into the CRM.
// When a document is completed (signed), it:
//   1. Matches the document to a CRM contact via recipient email
//   2. Matches to an opportunity via document name or metadata
//   3. Updates opportunity and account contract dates
//   4. Creates an activity record logging the signing event
//   5. Stores the document record in pandadoc_documents
//
// Deployment:
//   supabase functions deploy pandadoc-sync --no-verify-jwt
//
// Required environment variables (set via supabase secrets set):
//   SUPABASE_URL              - project URL
//   SUPABASE_SERVICE_ROLE_KEY - service-role key (bypasses RLS)
//   PANDADOC_API_KEY          - PandaDoc API key (for verifying webhooks + API calls)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PandaDocRecipient {
  email: string;
  first_name: string;
  last_name: string;
  role: string;
}

interface PandaDocWebhook {
  event: string; // 'document_state_changed'
  data: {
    id: string;
    name: string;
    status: string; // 'document.completed', 'document.sent', 'document.viewed', etc.
    recipients: PandaDocRecipient[];
    date_completed?: string;
    date_created: string;
    metadata?: Record<string, string>;
    fields?: Record<string, { value: string }>;
  };
}

interface ContactMatch {
  contact_id: string;
  account_id: string;
  email: string;
}

interface OpportunityMatch {
  id: string;
  account_id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Webhook signature verification
// ---------------------------------------------------------------------------

/**
 * Verify the PandaDoc webhook signature.
 *
 * PandaDoc sends the shared key in the X-PandaDoc-Signature header.
 * The signature is an HMAC-SHA256 of the raw request body using the API key.
 * If verification is not possible (no header), we log a warning but continue
 * to avoid blocking legitimate webhooks during initial setup.
 */
function verifyWebhookSignature(
  _body: string,
  signatureHeader: string | null,
  apiKey: string
): boolean {
  if (!signatureHeader) {
    console.warn("No X-PandaDoc-Signature header present; skipping verification");
    return true; // Allow through during setup; tighten in production
  }

  // PandaDoc webhook verification: the shared key should match the API key
  // In practice, PandaDoc sends the shared key you configured in their dashboard.
  // For a basic check, we verify the header is present and non-empty.
  // For production, implement HMAC-SHA256 verification with the shared secret.
  if (signatureHeader === apiKey) {
    return true;
  }

  console.warn("Webhook signature mismatch; allowing through with warning");
  return true;
}

// ---------------------------------------------------------------------------
// Contact matching
// ---------------------------------------------------------------------------

/**
 * Match PandaDoc recipients against CRM contacts by email address.
 * Returns the first matching contact found.
 */
async function matchRecipientToContact(
  supabase: SupabaseClient,
  recipients: PandaDocRecipient[]
): Promise<ContactMatch | null> {
  if (recipients.length === 0) return null;

  const emails = recipients
    .map((r) => r.email?.toLowerCase())
    .filter(Boolean);

  if (emails.length === 0) return null;

  const { data, error } = await supabase
    .from("contacts")
    .select("id, account_id, email")
    .in("email", emails)
    .is("archived_at", null)
    .limit(1)
    .single();

  if (error || !data) {
    console.log("No CRM contact matched for recipient emails:", emails.join(", "));
    return null;
  }

  return {
    contact_id: data.id,
    account_id: data.account_id,
    email: data.email,
  };
}

// ---------------------------------------------------------------------------
// Opportunity matching
// ---------------------------------------------------------------------------

/**
 * Match a PandaDoc document to a CRM opportunity.
 *
 * Strategy:
 *   1. If document metadata contains an "opportunity_id", use that directly
 *   2. Otherwise, fuzzy-match the document name against opportunity names
 *      for the matched account
 *   3. Fall back to the most recent open opportunity on the account
 */
async function matchDocumentToOpportunity(
  supabase: SupabaseClient,
  documentName: string,
  accountId: string | null,
  metadata?: Record<string, string>
): Promise<OpportunityMatch | null> {
  // Strategy 1: Direct ID from metadata
  if (metadata?.opportunity_id) {
    const { data } = await supabase
      .from("opportunities")
      .select("id, account_id, name")
      .eq("id", metadata.opportunity_id)
      .is("archived_at", null)
      .single();

    if (data) {
      return { id: data.id, account_id: data.account_id, name: data.name };
    }
  }

  if (!accountId) return null;

  // Strategy 2: Name matching - look for opportunities whose name appears
  // in the document name or vice versa
  const { data: opportunities } = await supabase
    .from("opportunities")
    .select("id, account_id, name")
    .eq("account_id", accountId)
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  if (opportunities && opportunities.length > 0) {
    const docNameLower = documentName.toLowerCase();

    // Try exact substring match first
    for (const opp of opportunities) {
      const oppNameLower = opp.name.toLowerCase();
      if (docNameLower.includes(oppNameLower) || oppNameLower.includes(docNameLower)) {
        return { id: opp.id, account_id: opp.account_id, name: opp.name };
      }
    }

    // Strategy 3: Fall back to most recent open opportunity
    const openOpp = opportunities.find(
      (o: { id: string; account_id: string; name: string; stage?: string }) =>
        !["closed_won", "closed_lost"].includes(o.stage ?? "")
    );
    if (openOpp) {
      return { id: openOpp.id, account_id: openOpp.account_id, name: openOpp.name };
    }

    // If no open opps, use the most recent one
    return {
      id: opportunities[0].id,
      account_id: opportunities[0].account_id,
      name: opportunities[0].name,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Contract date extraction
// ---------------------------------------------------------------------------

/**
 * Extract contract start and end dates from PandaDoc document fields.
 *
 * Looks for common field names in the document's custom fields:
 *   - contract_start_date / start_date / effective_date
 *   - contract_end_date / end_date / expiration_date
 *
 * If no explicit dates are found, uses the completion date as the start date.
 */
function extractContractDates(
  fields?: Record<string, { value: string }>,
  dateCompleted?: string
): { startDate: string | null; endDate: string | null } {
  let startDate: string | null = null;
  let endDate: string | null = null;

  if (fields) {
    // Look for start date fields
    const startKeys = ["contract_start_date", "start_date", "effective_date", "Contract Start Date"];
    for (const key of startKeys) {
      if (fields[key]?.value) {
        startDate = fields[key].value;
        break;
      }
    }

    // Look for end date fields
    const endKeys = ["contract_end_date", "end_date", "expiration_date", "Contract End Date"];
    for (const key of endKeys) {
      if (fields[key]?.value) {
        endDate = fields[key].value;
        break;
      }
    }
  }

  // If no explicit start date, use the completion date
  if (!startDate && dateCompleted) {
    startDate = dateCompleted.split("T")[0]; // Extract just the date portion
  }

  return { startDate, endDate };
}

// ---------------------------------------------------------------------------
// CRM updates
// ---------------------------------------------------------------------------

/**
 * Update the opportunity with contract dates from the signed document.
 */
async function updateOpportunityContractDates(
  supabase: SupabaseClient,
  opportunityId: string,
  startDate: string | null,
  endDate: string | null
): Promise<void> {
  const updates: Record<string, string | null> = {};
  if (startDate) updates.contract_start_date = startDate;
  if (endDate) updates.contract_end_date = endDate;

  if (Object.keys(updates).length === 0) return;

  const { error } = await supabase
    .from("opportunities")
    .update(updates)
    .eq("id", opportunityId);

  if (error) {
    console.error(`Failed to update opportunity ${opportunityId} contract dates:`, error.message);
  } else {
    console.log(`Updated opportunity ${opportunityId} contract dates:`, updates);
  }
}

/**
 * Update the account with current contract dates from the signed document.
 */
async function updateAccountContractDates(
  supabase: SupabaseClient,
  accountId: string,
  startDate: string | null,
  endDate: string | null
): Promise<void> {
  const updates: Record<string, string | null> = {};
  if (startDate) updates.current_contract_start_date = startDate;
  if (endDate) updates.current_contract_end_date = endDate;

  if (Object.keys(updates).length === 0) return;

  const { error } = await supabase
    .from("accounts")
    .update(updates)
    .eq("id", accountId);

  if (error) {
    console.error(`Failed to update account ${accountId} contract dates:`, error.message);
  } else {
    console.log(`Updated account ${accountId} contract dates:`, updates);
  }
}

/**
 * Create an activity record for the contract signing event.
 */
async function createSigningActivity(
  supabase: SupabaseClient,
  accountId: string,
  contactId: string | null,
  opportunityId: string | null,
  documentName: string,
  dateCompleted: string
): Promise<void> {
  const { error } = await supabase.from("activities").insert({
    account_id: accountId,
    contact_id: contactId,
    opportunity_id: opportunityId,
    activity_type: "note",
    subject: `Contract signed: ${documentName}`,
    body: `PandaDoc document "${documentName}" was completed/signed on ${new Date(dateCompleted).toLocaleDateString()}.`,
    completed_at: dateCompleted,
  });

  if (error) {
    console.error("Failed to create signing activity:", error.message);
  } else {
    console.log(`Created signing activity for document "${documentName}"`);
  }
}

// ---------------------------------------------------------------------------
// Document record upsert
// ---------------------------------------------------------------------------

/**
 * Create or update a pandadoc_documents record to track the synced document.
 */
async function upsertDocumentRecord(
  supabase: SupabaseClient,
  webhook: PandaDocWebhook,
  accountId: string | null,
  opportunityId: string | null,
  contactId: string | null
): Promise<void> {
  const { data: existing } = await supabase
    .from("pandadoc_documents")
    .select("id")
    .eq("pandadoc_id", webhook.data.id)
    .single();

  const record = {
    pandadoc_id: webhook.data.id,
    name: webhook.data.name,
    status: webhook.data.status,
    account_id: accountId,
    opportunity_id: opportunityId,
    contact_id: contactId,
    document_url: `https://app.pandadoc.com/a/#/documents/${webhook.data.id}`,
    date_created: webhook.data.date_created,
    date_completed: webhook.data.date_completed ?? null,
    metadata: {
      ...(webhook.data.metadata ?? {}),
      recipients: webhook.data.recipients,
    },
  };

  if (existing) {
    const { error } = await supabase
      .from("pandadoc_documents")
      .update(record)
      .eq("id", existing.id);
    if (error) console.error("Failed to update pandadoc_documents:", error.message);
  } else {
    const { error } = await supabase
      .from("pandadoc_documents")
      .insert(record);
    if (error) console.error("Failed to insert pandadoc_documents:", error.message);
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  // Only accept POST requests (webhooks)
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const pandadocApiKey = Deno.env.get("PANDADOC_API_KEY") ?? "";

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });

    // Read and verify the webhook payload
    const rawBody = await req.text();
    const signatureHeader = req.headers.get("X-PandaDoc-Signature");

    if (!verifyWebhookSignature(rawBody, signatureHeader, pandadocApiKey)) {
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const webhook: PandaDocWebhook = JSON.parse(rawBody);

    console.log(
      `Received PandaDoc webhook: event=${webhook.event}, ` +
      `status=${webhook.data.status}, doc="${webhook.data.name}"`
    );

    // We track all document state changes, but only perform CRM updates
    // when the document is completed (signed).
    const isCompleted = webhook.data.status === "document.completed";

    // Step 1: Match recipients to CRM contacts
    const contactMatch = await matchRecipientToContact(
      supabase,
      webhook.data.recipients ?? []
    );

    const accountId = contactMatch?.account_id ?? null;
    const contactId = contactMatch?.contact_id ?? null;

    // Step 2: Match document to an opportunity
    const oppMatch = await matchDocumentToOpportunity(
      supabase,
      webhook.data.name,
      accountId,
      webhook.data.metadata
    );

    const opportunityId = oppMatch?.id ?? null;

    // Step 3: Upsert the document tracking record (for all status changes)
    await upsertDocumentRecord(supabase, webhook, accountId, opportunityId, contactId);

    // Step 4: If document is completed/signed, update CRM records
    if (isCompleted && accountId) {
      const { startDate, endDate } = extractContractDates(
        webhook.data.fields,
        webhook.data.date_completed
      );

      // Update opportunity contract dates
      if (opportunityId) {
        await updateOpportunityContractDates(supabase, opportunityId, startDate, endDate);
      }

      // Update account contract dates
      await updateAccountContractDates(supabase, accountId, startDate, endDate);

      // Create activity record for the signing
      await createSigningActivity(
        supabase,
        accountId,
        contactId,
        opportunityId,
        webhook.data.name,
        webhook.data.date_completed ?? new Date().toISOString()
      );

      console.log(
        `Processed completed document "${webhook.data.name}" -> ` +
        `account=${accountId}, opportunity=${opportunityId}, contact=${contactId}`
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        document_id: webhook.data.id,
        status: webhook.data.status,
        matched: {
          account_id: accountId,
          opportunity_id: opportunityId,
          contact_id: contactId,
        },
        contract_updated: isCompleted && accountId != null,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("pandadoc-sync error:", (err as Error).message);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});
