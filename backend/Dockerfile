# Multi-stage Dockerfile for NestJS Backend with Prisma & Shared Package

FROM node:20-alpine AS builder

WORKDIR /app

# Copy root and workspace package files
COPY package*.json ./
COPY packages/package*.json ./packages/
COPY backend/package*.json ./backend/
COPY application/package*.json ./application/

# Install dependencies across monorepo
RUN npm ci

# Copy full source code
COPY packages ./packages
COPY backend ./backend

# Build shared package and backend
RUN npm run build --workspace packages
RUN npm run build --workspace backend

# Runner Stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package*.json ./
COPY packages/package*.json ./packages/
COPY backend/package*.json ./backend/

# Install production dependencies only
RUN npm ci --omit=dev

# Copy built dist files and Prisma schema
COPY --from=builder /app/packages/dist ./packages/dist
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/prisma ./backend/prisma

# Generate Prisma Client for production runtime
WORKDIR /app/backend
RUN npx prisma generate

EXPOSE 3000

CMD ["node", "dist/main.js"]
