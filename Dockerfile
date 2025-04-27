FROM node:18-slim

WORKDIR /app

# Instalar Chromium, xvfb e outras dependências necessárias
RUN apt-get update && apt-get install -y \
    chromium \
    xvfb \
    x11vnc \
    x11-utils \
    libgbm1 \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

# Instalar pnpm
RUN npm install -g pnpm

# Configurar variáveis de ambiente para o Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Copiar arquivos de dependências
COPY package.json pnpm-lock.yaml ./

# Instalar dependências
RUN pnpm install

# Copiar código fonte
COPY . .

# Expor portas
EXPOSE 3000 3006

# Comando padrão (será sobrescrito no docker-compose)
CMD ["pnpm", "start"]
