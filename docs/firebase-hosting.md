# Deploying ERP to Firebase

This guide explains step-by-step how to deploy your **React Frontend** to **Firebase Hosting** and your **NestJS Backend** to **Firebase / Google Cloud Run**.

---

## 1. Prerequisites

1. Create a project at [Firebase Console](https://console.firebase.google.com).
2. Install the Firebase CLI:
   ```bash
   npm install -g firebase-tools
   ```
3. Log in to Firebase in your terminal:
   ```bash
   firebase login
   ```

---

## 2. Deploying NestJS Backend to Firebase (Cloud Run)

Firebase integrates directly with Google Cloud Run to run Docker containers (like `@erp/backend`).

1. Enable Google Cloud Run in your Firebase project:
   ```bash
   gcloud run deploy erp-backend \
     --source backend \
     --region us-central1 \
     --allow-unauthenticated \
     --set-env-vars DATABASE_URL="your-supabase-pooled-url",DIRECT_URL="your-supabase-direct-url",SESSION_SECRET="your-secret",PORT=3000
   ```

---

## 3. Deploying React Frontend to Firebase Hosting

1. Build the monorepo frontend:
   ```bash
   npm run build
   ```

2. Link your Firebase Project ID:
   Update `.firebaserc` with your Firebase project ID:
   ```json
   {
     "projects": {
       "default": "your-firebase-project-id"
     }
   }
   ```

3. Deploy to Firebase Hosting:
   ```bash
   firebase deploy --only hosting
   ```

Your app will be live on Firebase Hosting at `https://your-firebase-project-id.web.app`!
