# Medcurity CRM

Internal CRM replacement for Salesforce focused on Medcurity's sales and renewals workflows.

## Why this project exists

The goal is not Salesforce parity in two weeks. The goal is a credible MVP that proves Medcurity can run:

- new business pipeline management
- renewals ownership transfer and tracking
- reliable reporting on core revenue metrics
- safe archival and restore workflows

## Stack

- Frontend: React + TypeScript + Vite
- Backend: Supabase Postgres + Auth + Row Level Security
- Deployment target: Vercel for frontend, Supabase for data/auth

## Project layout

- `src/`: frontend starter app
- `docs/`: architecture, setup, and delivery guidance
- `supabase/migrations/`: database schema and security
- `supabase/seed.sql`: starter reference data

## First run

1. Copy `.env.example` to `.env`.
2. Fill in the Supabase project URL and anon key.
3. Install dependencies with `npm install`.
4. Run the frontend with `npm run dev`.

## Database setup

Use the SQL in `supabase/migrations/20260331_initial_schema.sql` in Supabase SQL Editor or via the Supabase CLI once installed.

Apply `supabase/seed.sql` after the migration if you want starter products and pipeline stages.

## MVP boundary

Ship first:

- auth and role-aware access
- accounts, contacts, opportunities
- stage history and ownership changes
- renewals queue
- archive and restore flows
- 3 to 5 fixed reports

Delay:

- email sync
- custom report builder
- forecasting
- broad automation
