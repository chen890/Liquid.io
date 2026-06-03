# ──────────────────────────────────────────────────────────────────────────────
# Stage 1 — Build the React / Vite frontend
# Build context: project root (..)
# ──────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

# ──────────────────────────────────────────────────────────────────────────────
# Stage 2 — Serve with nginx
# ──────────────────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
# nginx.conf lives in docker/ which is included in the build context root
COPY docker/nginx.conf /etc/nginx/nginx.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
