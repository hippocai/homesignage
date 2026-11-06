FROM node:22-bookworm AS admin-build
WORKDIR /app/admin
COPY admin/package*.json ./
RUN npm ci
COPY admin/ ./
COPY shared/ /app/shared/
COPY client/ /app/client/
RUN npm run build

FROM node:22-bookworm AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim

WORKDIR /app

# Install backend dependencies
COPY package*.json ./
COPY --from=dependencies /app/node_modules ./node_modules

# Copy source code
COPY src/ ./src/
COPY shared/ ./shared/
COPY guest-chat/ ./guest-chat/

# Copy pre-built admin dashboard
COPY --from=admin-build /app/admin-dist/ ./admin-dist/

# Copy display client
COPY client/ ./client/

# Create required directories
RUN mkdir -p data uploads logs

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "src/index.js"]
