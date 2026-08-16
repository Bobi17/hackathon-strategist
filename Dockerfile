# Base image with Node.js
FROM node:22-bookworm-slim

# Install dependencies for Playwright + gosu (privilege drop in entrypoint)
RUN apt-get update && apt-get install -y \
    gosu \
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

# Install pnpm globally
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy project files
COPY . .

# Build the control-room UI (outputs to dist/)
RUN pnpm build

# Create non-root user and ensure ownership of /app
RUN useradd -m strategist && chown -R strategist:strategist /app

# pnpm store/temp directory writable by strategist
USER strategist
ENV PNPM_HOME=/home/strategist/.local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN mkdir -p /home/strategist/.local/share/pnpm

# Drop back to root for the entrypoint layer: the container starts as root so
# the entrypoint can chown the host bind-mounted /app/output (owned by root in
# CI or the host user locally) to the strategist user, then gosu drops to
# strategist before exec'ing the command. See docker-entrypoint.sh.
USER root
COPY --chmod=0755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

# Default command
CMD ["pnpm", "strategist:run"]
