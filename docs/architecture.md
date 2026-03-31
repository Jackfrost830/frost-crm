# Architecture

## Core design decisions

### 1. Supabase is the system of record

Postgres should own:

- canonical CRM records
- audit history
- archive state
- renewals derivation
- role enforcement through RLS

Do not build business-critical logic only in the frontend.

### 2. Soft delete first, hard delete rarely

Operational users should archive records, not delete them. Every core table includes:

- `archived_at`
- `archived_by`
- `archive_reason`

Default queries should exclude archived rows. Admin tooling can restore them.

### 3. Reporting starts with stable SQL views

Do not try to build a generic report builder in MVP. Start with SQL views or RPCs for:

- open pipeline
- closed won ARR
- renewals due in next 120 days
- stage conversion

That gives leadership usable numbers quickly and avoids rebuilding logic twice.

### 4. Ownership is explicit

Medcurity's workflow depends on team handoff. Opportunities carry:

- `owner_user_id`
- `team`
- `kind`

When a new business opportunity is marked `closed_won`, downstream renewals logic can derive the next renewal queue.

### 5. Auditability is built in from day one

Every insert, update, and delete on core tables writes to `audit_logs`. This keeps recovery and debugging possible when the system is under rapid iteration.

## Suggested application layers

### Database

- schema and constraints
- RLS policies
- triggers for audit logging and stage history
- reporting views and RPCs

### Frontend

- auth shell
- list/detail screens
- forms with explicit validation
- reports dashboard

### Optional server layer later

If you need private integrations or scheduled jobs, add an edge function or a small API later. Do not introduce it before the MVP demands it.
