FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PORT=8080

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    libreoffice \
    poppler-utils \
    zip \
    unzip \
    fonts-dejavu \
    fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

COPY . .

EXPOSE 8080

CMD ["npm", "start"]
