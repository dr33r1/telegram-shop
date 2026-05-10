FROM node:20-slim

# Outils nécessaires pour compiler better-sqlite3
RUN apt-get update && \
    apt-get install -y python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Installer les dépendances
COPY package*.json ./
RUN npm install

# Copier le code
COPY . .

EXPOSE 3000
CMD ["node", "bot/index.js"]
