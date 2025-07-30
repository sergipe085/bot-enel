FROM node:18-slim

WORKDIR /app

# Instalar Chromium, xvfb, qpdf e outras dependências necessárias
RUN apt-get update && apt-get install -y \
    chromium \
    # xvfb \
    # x11vnc \
    # x11-utils \
    dbus \
    dbus-x11 \
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
    qpdf \
    && rm -rf /var/lib/apt/lists/*

# Instalar pnpm
RUN npm install -g pnpm

# Configurar variáveis de ambiente para o Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    NODE_ENV=production

# Copiar arquivos de dependências
COPY package.json pnpm-lock.yaml ./

# Instalar dependências
RUN pnpm install

# Copiar código fonte
COPY . .

# Compilar TypeScript para JavaScript
RUN pnpm build

# Criar script para iniciar o Xvfb
# RUN echo '#!/bin/sh\nXvfb :99 -screen 0 1280x1024x24 &\nexec "$@"' > /app/start-xvfb.sh && chmod +x /app/start-xvfb.sh

# Expor portas
EXPOSE 3000 3006

# Comando padrão (será sobrescrito no docker-compose)
# CMD ["/app/start-xvfb.sh", "node", "dist/server.js"]
CMD ["node", "dist/server.js"]
