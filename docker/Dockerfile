FROM node:18-alpine

WORKDIR /app

# Install backend dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source code
COPY src/ ./src/

# Copy pre-built admin dashboard
COPY admin-dist/ ./admin-dist/

# Copy display client
COPY client/ ./client/

# Create required directories
RUN mkdir -p data uploads logs

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "src/index.js"]
