# Complete Step-by-Step Supabase & Cloud Deployment Guide

This document provides a complete, step-by-step guide to deploying this ERP monorepo to production using **Supabase** (Database), **Render/Railway** (Backend), and **Vercel** (Frontend).

---

## Phase 1: Supabase Database Setup & Migrations

### 1. Create a Supabase Project
1. Log in to [Supabase Console](https://database.new).
2. Click **New Project**, select an Organization, and configure:
   - **Project Name**: `ERP-Production`
   - **Database Password**: Set a strong password *(save this password securely!)*
   - **Region**: Choose a region closest to your target users.
3. Click **Create new project** and wait 1–2 minutes for provision.

### 2. Retrieve Connection Strings
1. In Supabase dashboard, go to **Project Settings** (gear icon on bottom left) $\rightarrow$ **Database**.
2. Scroll down to **Connection Strings**:
   - Copy **Transaction Pooler URL** (Port `6543` with `?pgbouncer=true`). This will be your `DATABASE_URL`.
   - Copy **Direct Connection URL** (Port `5432`). This will be your `DIRECT_URL`.
3. Replace `[YOUR-PASSWORD]` in both strings with your actual database password.

### 3. Deploy Prisma Migrations to Supabase
Run the following commands in your local terminal:

```bash
# 1. Build the shared package first
npm run build --workspace packages

# 2. Set environment variables (replace with your actual connection strings)
# On Windows PowerShell:
$env:DATABASE_URL="postgres://postgres.[REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true"
$env:DIRECT_URL="postgres://postgres.[REF]:[PASSWORD]@db.[REF].supabase.co:5432/postgres"

# On Linux / macOS / Bash:
# export DATABASE_URL="postgres://..."
# export DIRECT_URL="postgres://..."

# 3. Apply Prisma migrations directly to Supabase Postgres
cd backend
npx prisma migrate deploy
```

---

## Phase 2: Deploying the Backend (Render / Railway)

### Deploying to Render (Free / Docker Container)
1. Log in to [Render Dashboard](https://dashboard.render.com) using your GitHub account.
2. Click **New +** $\rightarrow$ **Web Service**.
3. Connect your GitHub repository: `CaptainBangladesh/ERP-`.
4. Configure service parameters:
   - **Name**: `erp-backend`
   - **Region**: Select same region as Supabase
   - **Branch**: `main`
   - **Language / Environment**: `Docker`
   - **Dockerfile Path**: `backend/Dockerfile`
5. Scroll down to **Environment Variables** and add:
   - `DATABASE_URL`: *(Your Supabase Pooled URL on port 6543)*
   - `DIRECT_URL`: *(Your Supabase Direct URL on port 5432)*
   - `PORT`: `3000`
   - `SESSION_SECRET`: *(Generate a 32-byte secret using: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)*
   - `CORS_ORIGIN`: `*` (or your Vercel URL once deployed)
6. Click **Create Web Service**.
7. Once deployed, copy your live backend URL (e.g. `https://erp-backend-xyz.onrender.com`).

---

## Phase 3: Deploying the Frontend (Vercel)

### 1. Update `vercel.json` API Proxy Target
In your local workspace, open `vercel.json` and set your backend URL as the destination:

```json
{
  "buildCommand": "npm run build --workspace packages && npm run build --workspace application",
  "outputDirectory": "application/dist",
  "framework": "vite",
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://erp-backend-xyz.onrender.com/api/:path*"
    },
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```

Commit and push to GitHub:
```bash
git add vercel.json
git commit -m "chore: set production backend URL in vercel.json"
git push origin main
```

### 2. Deploy on Vercel
1. Log in to [Vercel](https://vercel.com/new) with GitHub.
2. Import repository `CaptainBangladesh/ERP-`.
3. Configure settings:
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `application/dist`
4. Click **Deploy**.

---

## Phase 4: Verification & Security

1. Open your live Vercel URL (e.g. `https://erp-app.vercel.app`).
2. Update `CORS_ORIGIN` in Render dashboard to `https://erp-app.vercel.app` to enforce origin restriction.
3. Sign up to create the first company and owner account!
