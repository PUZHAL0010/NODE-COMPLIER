# Multi-Stage Build for Distributed Node.js Execution Platform
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency definitions
COPY package*.json tsconfig.json ./

# Install all dependencies including devDependencies for build
RUN npm install

# Copy source files
COPY shared/ ./shared/
COPY server/ ./server/

# Compile TypeScript
RUN npm run build

# --- Production Runtime Stage ---
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Install docker CLI inside container if running in docker-out-of-docker mode
RUN apk add --no-cache docker-cli

# Copy package files and install production-only dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy compiled JavaScript output and public assets
COPY --from=builder /app/dist ./dist
COPY public/ ./public/

EXPOSE 3000

CMD ["node", "dist/server/gateway.js"]
