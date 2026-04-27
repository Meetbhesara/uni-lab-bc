# Use a Debian-based image (required for Puppeteer)
FROM node:20-slim

# Install Chromium and its dependencies for PDF generation and WhatsApp
RUN apt-get update && apt-get install -y \
    git \
	openssh-client \
    wget \
    gnupg \
    libnss3 \
    libatk-bridge2.0-0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
	libxfixes3 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libcups2 \
	libxkbcommon0 \
    fonts-liberation \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency files
COPY package*.json ./

# Install ALL dependencies
RUN npm install

# Copy the rest of the application
COPY . .

# Create the critical persistent folders
RUN mkdir -p uploads whatsapp_auth

EXPOSE 5001
CMD ["npm", "start"]

