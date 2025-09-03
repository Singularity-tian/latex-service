# TeX Live 
FROM texlive/texlive:latest

# Node.js 18
RUN apt-get update && \
    apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Workdir
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node dependencies
RUN npm ci --only=production

# Copy server code
COPY server.js ./

# Expose port (Railway will automatically assign)
EXPOSE 3000

# Start service
CMD ["node", "server.js"]