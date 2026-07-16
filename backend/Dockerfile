FROM node:18-alpine

WORKDIR /app

# Install system dependencies for Sharp (libvips) and real HEIC/HEIF support.
# Alpine's vips-dev bundles a libheif with AVIF-only codec support; libheif-dev
# and libde265-dev add the HEVC decoder that real iPhone HEIC photos need.
RUN apk add --no-cache \
    vips-dev \
    vips-heif \
    libheif-dev \
    libde265-dev \
    pkgconfig \
    python3 \
    make \
    g++ \
    libc6-compat

# Force Sharp to compile its native addon against the system libvips/libheif
# (with HEVC support) instead of using its own bundled prebuilt binary, which
# excludes HEVC decoding for patent-licensing reasons.
ENV SHARP_FORCE_GLOBAL_LIBVIPS=1
ENV CXXFLAGS="-std=c++17"

# Copy package files first for better caching
COPY package*.json ./

# Install production dependencies, then rebuild sharp from source now that
# node-addon-api/node-gyp are available, linking against the system libvips.
RUN npm ci --omit=dev \
    && npm install --no-save node-addon-api node-gyp \
    && npm rebuild sharp \
    && npm cache clean --force

# Copy application code
COPY . .

# Create directories for logs
RUN mkdir -p logs

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

# Cloud Run uses PORT env var
EXPOSE 3001

# Health check using the readiness endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 3001) + '/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

CMD ["node", "server.js"]
