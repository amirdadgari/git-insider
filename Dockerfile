FROM node:18-alpine

# Set working directory
WORKDIR /usr/src/app

# Install OS packages (git for simple-git, ssh for private repos)
RUN apk add --no-cache git openssh ca-certificates && update-ca-certificates

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY . .

# Create necessary directories
RUN mkdir -p database public/css repos

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3201
ENV DB_PATH=/usr/src/app/database/app.db
ENV GIT_REPOS_PATH=/usr/src/app/repos

# Create a non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Change ownership of the app directory
RUN chown -R nodejs:nodejs /usr/src/app
USER nodejs

# Expose port
EXPOSE 3201

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node healthcheck.js

# Start the application
CMD ["node", "server.js"]
