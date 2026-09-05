# CampusOS

Unified digital platform for colleges — admins, teachers and students in one
professional SaaS workspace. Built per the **CampusOS Final Technical
Blueprint v1.0** (the source of truth for architecture decisions).

## Stack

- **Web**: Next.js (App Router), React, TypeScript, Tailwind CSS — `apps/web` (port 3000)
- **API**: NestJS REST (`/api/v1`), TypeScript — `apps/api` (port 4000)
- **Database**: PostgreSQL 16 + Prisma ORM (port 5432)
- **Shared**: `packages/shared` — Zod schemas, enums, permission matrix, event contracts

## Operations

Production deployment, backups, restores, secret rotation, seed-guard rules
and rollback are documented in the operations runbook:
**[docs/OPERATIONS.md](docs/OPERATIONS.md)**.

The complete milestone-by-milestone development history is maintained in
**[docs/CAMPUSOS_DEVELOPMENT_HISTORY.md](docs/CAMPUSOS_DEVELOPMENT_HISTORY.md)**.

## Run (Alloy / Docker)

```sh
bash .alloy/populate-env.sh
docker compose -f docker-compose.alloy.yaml up -d
```

The API container installs dependencies, builds the shared package, applies
Prisma migrations, runs the system + demo seeds and starts in watch mode. The
web app starts once shared artifacts exist. In an Alloy session, open the
preview at `http://localhost:8080`.

- Web: `http://localhost:3000` (login at `/login`)
- API health: `http://localhost:4000/api/v1/health`

## Demo accounts (development only)

| Role | Email | Password |
|---|---|---|
| Admin | `admin@campusos.dev` | `CampusOS!demo1` |
| Teacher | `teacher@campusos.dev` | `CampusOS!demo1` |
| Student | `student@campusos.dev` | `CampusOS!demo1` |

Sign-in is delivered in Milestone M1 (Authentication & Access).

## Milestone status

- **M0 — Foundation**: complete (monorepo, full schema + migration, seeds,
  API bootstrap with envelopes + health, web shell + login page, Docker/Alloy)
- M1+ — pending approval per blueprint §13
