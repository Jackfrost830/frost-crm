# PandaDoc Sync Edge Function

Receives PandaDoc webhooks and syncs document/contract data into the CRM.

## Setup

### 1. Deploy the Edge Function

```bash
supabase functions deploy pandadoc-sync --no-verify-jwt
```

The `--no-verify-jwt` flag is required because PandaDoc webhooks do not send a Supabase JWT.

### 2. Set Environment Variables

```bash
supabase secrets set PANDADOC_API_KEY=your_pandadoc_api_key_here
```

The function also requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, which are automatically available in Supabase Edge Functions.

### 3. Configure PandaDoc Webhooks

1. Log in to PandaDoc and go to **Settings > Integrations > Webhooks** (or **Settings > API > Webhooks**)
2. Click **Add Webhook**
3. Enter the webhook URL:
   ```
   https://<your-project-ref>.supabase.co/functions/v1/pandadoc-sync
   ```
4. Subscribe to the following events:
   - `document_state_changed` (required) -- fires when a document changes status
5. Optionally subscribe to:
   - `document_updated` -- fires when document content is modified
   - `document_deleted` -- fires when a document is deleted
6. Save the webhook configuration

### 4. Run the Database Migration

Ensure the `pandadoc_documents` table exists:

```bash
supabase db push
```

Or apply the migration manually:

```bash
supabase migration up
```

## How It Works

When PandaDoc sends a webhook:

1. **Contact matching**: The function looks at recipient email addresses and matches them against CRM contacts.
2. **Opportunity matching**: It tries to match the document to an opportunity by:
   - Checking document metadata for an `opportunity_id` field
   - Matching the document name against opportunity names on the matched account
   - Falling back to the most recent open opportunity
3. **Document tracking**: Every webhook creates/updates a record in `pandadoc_documents`.
4. **Contract completion**: When a document status is `document.completed`:
   - Extracts contract start/end dates from document fields
   - Updates the opportunity's contract dates
   - Updates the account's current contract dates
   - Creates an activity record logging the signing event

## PandaDoc Document Fields

For automatic contract date extraction, add these fields to your PandaDoc templates:

| Field Name              | Purpose                    |
|-------------------------|----------------------------|
| `contract_start_date`   | Contract effective date    |
| `contract_end_date`     | Contract expiration date   |

Alternative field names are also supported: `start_date`, `effective_date`, `end_date`, `expiration_date`.

## PandaDoc Document Metadata

You can pass CRM-specific metadata when creating documents via the PandaDoc API:

```json
{
  "metadata": {
    "opportunity_id": "uuid-of-crm-opportunity"
  }
}
```

This enables direct matching without relying on name-based fuzzy matching.

## Testing

You can test the webhook locally using the Supabase CLI:

```bash
supabase functions serve pandadoc-sync --no-verify-jwt
```

Then send a test webhook:

```bash
curl -X POST http://localhost:54321/functions/v1/pandadoc-sync \
  -H "Content-Type: application/json" \
  -d '{
    "event": "document_state_changed",
    "data": {
      "id": "test-doc-123",
      "name": "Test Contract",
      "status": "document.completed",
      "recipients": [{ "email": "client@example.com", "first_name": "Jane", "last_name": "Doe", "role": "signer" }],
      "date_created": "2026-01-01T00:00:00Z",
      "date_completed": "2026-01-15T00:00:00Z"
    }
  }'
```
