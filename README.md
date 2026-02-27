# AIKOL Ops Hub

Multi-account X publishing and management hub built with Next.js + Prisma.

## Stack

- Next.js (App Router)
- PostgreSQL
- Prisma ORM

## Quick Start

1. Copy `.env.example` to `.env.local` and fill values.
2. Install packages:
   - `npm install`
3. Generate Prisma client:
   - `npm run prisma:generate`
4. Apply migration (requires PostgreSQL):
   - `npm run prisma:migrate`
5. Run app:
   - `npm run dev`

## Core Features

- Multi-account storage with encrypted tokens
- Per-account proxy configuration (http/https)
- Account tagging and grouping
- Bulk account import endpoint
- Content matrix with account-specific variants
- Rule-based or manual multi-account dispatch
- Queue/schedule management
- Background publisher endpoint (`/api/cron/publish`)
- Risk controls:
  - min publish interval
  - daily/monthly quota guard
  - similarity blocking
  - rate-limit snapshot tracking
- Analytics overview endpoint

## Key Endpoints

- `GET/POST /api/accounts`
- `POST /api/accounts/bulk-import`
- `GET /api/accounts/:id/health`
- `GET/POST /api/contents`
- `POST /api/dispatch`
- `GET/POST /api/schedules`
- `POST /api/cron/publish`
- `GET /api/analytics/overview`
- `GET /api/activity`

## Vercel Hobby Cron Note

If you deploy on Vercel Hobby, cron jobs are limited and frequent expressions like `*/5 * * * *` are not available.
This project defaults to once daily (`0 2 * * *`) in `vercel.json`.
