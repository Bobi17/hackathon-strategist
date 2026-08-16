# Base image with Node.js
FROM node:22-bookworm-slim

# Install dependencies for Playwright
RUN apt-get update && apt-get install -y \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libpango-1.0-0 \
    libx11-xcb1 \
    libx11-6 \
    libxcb1 \
    libxfixes3 \
    libxcursor1 \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy project files
COPY . .

# Run as non-root user for security
RUN useradd -m strategist
USER strategist

# Default command
CMD ["pnpm", "strategist:run"]
