# Hosting ERP on Supabase & Cloud Platforms

This guide walks you step-by-step through setting up **Supabase PostgreSQL** as your database and deploying the full-stack ERP monorepo to production.

---

## 1. Setting Up Supabase Database

1. **Create a Supabase Project**:
   - Log into [Supabase Console](https://database.new).
   - Create a new project. Choose a strong database password and select a region near your users.

2. **Retrieve Connection Strings**:
   - Go to **Project Settings** -> **Database**.
   - Under **Connection Strings**, copy:
     - **Transaction Pooler URL** (Port `6543`, appended with `?pgbouncer=true` or Supavisor pooler mode). This will be your `DATABASE_URL`.
     - **Direct Connection URL** (Port `5432`). This will be your `DIRECT_URL`.

---

## 2. Environment Variables Setup

Configure the backend environment variables on your server or host platform:

```env
# Supabase Transaction Pooler (Port 6543) for runtime queries
DATABASE_URL="postgres://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true"

# Supabase Direct Connection (Port 5432) for Prisma migrations
DIRECT_URL="postgres://postgres.[PROJECT-REF]:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres"

PORT=3000

# Secret key for session signing (Generate using: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
SESSION_SECRET="your-generated-32-byte-hex-secret"

# Optional: CORS allowed origin (if backend & frontend have different domains)
CORS_ORIGIN="https://your-frontend.vercel.app"
```

---

## 3. Running Prisma Migrations on Supabase

Apply database migrations to your Supabase PostgreSQL instance:

```bash
# Run from the repository root
npm run build --workspace packages

# Run Prisma migrations against Supabase using DIRECT_URL
cd backend
npx prisma migrate deploy
```

---

## 4. Deploying the NestJS Backend

You can deploy `@erp/backend` to any Node.js host or Docker container service:

### Option A: Render / Railway / Fly.io (Docker)
1. Push your repository to GitHub (`https://github.com/CaptainBangladesh/ERP-.git`).
2. Create a **New Web Service** on Render or Railway.
3. Point to `backend/Dockerfile` as the build context.
4. Set environment variables (`DATABASE_URL`, `DIRECT_URL`, `SESSION_SECRET`, `CORS_ORIGIN`).
5. Deploy service. Note your backend URL (e.g. `https://erp-backend.onrender.com`).

---

## 5. Deploying the React Frontend

Deploy the Vite React frontend (`@erp/application`) to Vercel, Netlify, or Cloudflare Pages:

### Option A: Vercel
1. Import your GitHub repository on Vercel.
2. Select root directory or set build settings:
   - **Build Command**: `npm run build`
   - **Output Directory**: `application/dist`
3. Update `vercel.json` rewrite target to point to your deployed backend URL:
   ```json
   {
     "source": "/api/:path*",
     "destination": "https://your-backend-url.com/api/:path*"
   }
   ```
4. Deploy frontend.

---

## Summary Command Checklist

```bash
# 1. Typecheck and verify modules
npm run check:modules
npm run check:tenancy
npm run build

# 2. Deploy Prisma migrations to Supabase
cd backend
npx prisma migrate deploy

# 3. Push latest code to GitHub
git add .
git commit -m "feat: setup supabase database hosting and deployment config"
git push -u origin main
```
