# Supabase Setup

## 1. Create the Supabase project

In Supabase:

1. Create a new project for `medcurity-crm`.
2. Save the project URL and anon key.
3. Put both values into `.env`.

## 2. Configure auth

Start simple:

- email/password auth only
- invite internal users manually
- disable self-serve signup if this is internal-only

After each user is created, add a matching row in `public.user_profiles` with one of:

- `sales`
- `renewals`
- `admin`

For the very first admin user, do this from Supabase SQL Editor or Table Editor, not from the app. Until an admin profile exists, the RLS policies intentionally do not allow self-assignment.

## 3. Apply the schema

Use one of these approaches:

### SQL editor

Paste `supabase/migrations/20260331_initial_schema.sql` into Supabase SQL Editor and run it.

### CLI later

Once the Supabase CLI is installed:

1. `supabase login`
2. `supabase link --project-ref <your-project-ref>`
3. `supabase db push`

## 4. Seed starter data

Run `supabase/seed.sql` after the main migration if you want baseline products.

## 5. RLS model

Current policy design is intentionally simple for MVP:

- authenticated users can read active records
- only admins can manage user roles
- sales, renewals, and admins can create or update CRM records
- archived records are visible to admins by default

This is enough to get moving. If you later need per-owner restrictions, add them after the workflow is stable.

## 6. Safe deletion model

Use `select public.archive_record('accounts', '<uuid>', 'reason');`

And restore with:

`select public.restore_record('accounts', '<uuid>');`

Do not expose direct hard delete actions in the UI for MVP.
