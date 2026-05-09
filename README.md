# 🛍️ Telegram Shop Bot + Mini App

Bot Telegram complet avec Mini App e-commerce intégrée.
Catalogue produits · Panier · Commandes · Notifications bot.

---

## 📁 Structure du projet

```
telegram-shop/
├── bot/
│   ├── index.js          ← Bot Telegram + API REST (Telegraf + Express)
│   ├── db.js             ← Base de données SQLite (auto-seeded)
│   ├── package.json
│   └── .env.example      ← Variables d'environnement
└── miniapp/
    └── index.html        ← Mini App (HTML/CSS/JS autonome)
```

---

## 🚀 Démarrage rapide

### Étape 1 — Créer le bot sur Telegram

1. Ouvrez [@BotFather](https://t.me/BotFather) sur Telegram
2. Envoyez `/newbot`
3. Choisissez un nom : ex. `Ma Boutique`
4. Choisissez un username : ex. `ma_boutique_bot`
5. **Copiez le token** (format `123456789:ABCdefGHI...`)

### Étape 2 — Héberger la Mini App

La Mini App (`miniapp/index.html`) doit être accessible via **HTTPS**.

**Option A — GitHub Pages (gratuit, recommandé pour démarrer) :**
```bash
# 1. Créer un repo GitHub
# 2. Mettre miniapp/index.html à la racine ou dans /docs
# 3. Activer GitHub Pages dans les Settings du repo
# URL résultante: https://votre-user.github.io/votre-repo/index.html
```

**Option B — Vercel (gratuit) :**
```bash
npm i -g vercel
cd miniapp
vercel --prod
# URL résultante: https://votre-app.vercel.app
```

**Option C — Netlify :**
```bash
# Glisser-déposer le dossier miniapp/ sur https://app.netlify.com/drop
```

**Option D — Votre propre serveur avec Nginx :**
```nginx
server {
    listen 443 ssl;
    server_name shop.votre-domaine.com;
    root /var/www/telegram-shop/miniapp;
    index index.html;

    ssl_certificate     /etc/letsencrypt/live/shop.votre-domaine.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/shop.votre-domaine.com/privkey.pem;

    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        add_header 'Access-Control-Allow-Origin' '*';
    }
}
```

### Étape 3 — Configurer l'environnement

```bash
cd bot
cp .env.example .env
```

Éditez `.env` :
```env
BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
MINI_APP_URL=https://votre-user.github.io/votre-repo/index.html
PORT=3000
ADMIN_TG_ID=votre_telegram_id
```

> 💡 Pour connaître votre Telegram ID : [@userinfobot](https://t.me/userinfobot)

### Étape 4 — Installer & Lancer le bot

```bash
cd bot
npm install
npm start
```

Vous devriez voir :
```
✅ Base de données initialisée avec les produits de démo
🚀 API sur http://localhost:3000
🤖 Bot démarré (polling)
```

### Étape 5 — Lier la Mini App au bot via BotFather

1. Retournez sur [@BotFather](https://t.me/BotFather)
2. Envoyez `/mybots` → sélectionnez votre bot
3. **Bot Settings → Menu Button**
4. Entrez l'URL de votre Mini App
5. Entrez le texte du bouton : `🛒 Boutique`

---

## 🔧 Configuration avancée

### Connecter l'API à la Mini App

Dans `miniapp/index.html`, ligne :
```javascript
const API_BASE = new URLSearchParams(location.search).get('api') || 'http://localhost:3000';
```

Deux options :
- **Via l'URL** : `https://votre-site.com/index.html?api=https://api.votre-domaine.com`
- **Directement dans le code** : remplacez `'http://localhost:3000'` par votre URL d'API

### Configurer MINI_APP_URL avec le paramètre API

Dans `.env` :
```env
MINI_APP_URL=https://votre-user.github.io/repo/index.html?api=https://api.votre-domaine.com
```

### Webhook en production (recommandé)

Au lieu du polling, utilisez un webhook pour la production :

```javascript
// Dans index.js, remplacez bot.launch() par :
const WEBHOOK_URL = process.env.WEBHOOK_URL; // https://api.votre-domaine.com

app.use(bot.webhookCallback('/webhook'));

app.listen(PORT, async () => {
  await bot.telegram.setWebhook(`${WEBHOOK_URL}/webhook`);
  console.log('Webhook configuré:', WEBHOOK_URL);
});
```

---

## 📦 Ajouter des produits

### Via SQLite directement

```bash
# Installer sqlite3
sudo apt install sqlite3
cd bot
sqlite3 shop.db

# Voir les catégories
SELECT * FROM categories;

# Ajouter un produit
INSERT INTO products (category_id, name, description, price, image_url)
VALUES (1, 'Nouveau Produit', 'Description', 49.99, 'https://images.unsplash.com/...');

.quit
```

### Via l'API REST

```bash
# Lister les produits
curl http://localhost:3000/api/products

# Lister les catégories
curl http://localhost:3000/api/categories
```

---

## 🌐 Commandes du bot disponibles

| Commande | Description |
|----------|-------------|
| `/start` | Page d'accueil avec bouton Mini App |
| `/shop` | Ouvrir la boutique directement |
| `/categories` | Parcourir les catégories |
| `/orders` | Voir ses commandes |
| `/help` | Aide |

---

## 💳 Intégrer les paiements Telegram

Telegram supporte les paiements natifs (Stripe, etc.) via BotFather :

1. BotFather → `/mybots` → Votre bot → **Payments**
2. Connectez un fournisseur (ex: Stripe en mode test)
3. Ajoutez dans `index.js` :

```javascript
// Envoyer une facture de paiement
bot.command('pay', async (ctx) => {
  await ctx.replyWithInvoice({
    title: 'Commande #001',
    description: 'Votre commande',
    payload: 'order_001',
    provider_token: process.env.PAYMENT_TOKEN, // depuis BotFather
    currency: 'EUR',
    prices: [{ label: 'Total', amount: 1299 * 100 }] // en centimes
  });
});

bot.on('pre_checkout_query', ctx => ctx.answerPreCheckoutQuery(true));
bot.on('successful_payment', async ctx => {
  // Marquer la commande comme payée
  await ctx.reply('✅ Paiement reçu ! Merci 🎉');
});
```

---

## 🚢 Déploiement production (VPS)

### Avec PM2 (process manager)

```bash
npm install -g pm2
cd bot
pm2 start index.js --name telegram-shop
pm2 save
pm2 startup
```

### Avec Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY bot/package*.json ./
RUN npm ci --omit=dev
COPY bot/ .
CMD ["node", "index.js"]
```

```bash
docker build -t telegram-shop .
docker run -d --env-file bot/.env -p 3000:3000 telegram-shop
```

---

## 🔐 Sécurité

- Ne committez **jamais** votre `.env` → ajoutez-le au `.gitignore`
- En production, validez les données `initData` de Telegram :
  ```javascript
  import crypto from 'crypto';
  function validateTelegramWebAppData(initData, botToken) {
    const data = Object.fromEntries(new URLSearchParams(initData));
    const hash = data.hash; delete data.hash;
    const dataStr = Object.keys(data).sort().map(k => `${k}=${data[k]}`).join('\n');
    const key = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computed = crypto.createHmac('sha256', key).update(dataStr).digest('hex');
    return computed === hash;
  }
  ```
- Configurez le CORS pour n'autoriser que votre domaine Mini App
- Utilisez un webhook avec HTTPS en production plutôt que le polling

---

## 📚 Ressources

- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Telegram Mini Apps Docs](https://core.telegram.org/bots/webapps)
- [Telegraf.js](https://telegraf.js.org/)
- Inspiré de [indmdev/Telegram-Store-MiniApp](https://github.com/indmdev/Telegram-Store-MiniApp)
- Inspiré de [DaniilDonskoy/Shop-bot](https://github.com/DaniilDonskoy/Shop-bot)
- Inspiré de [mini-woo/mini-woo](https://github.com/mini-woo/mini-woo)
