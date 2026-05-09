#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
#  🚀 deploy.sh — Déploiement complet Telegram Shop
#  Usage : ./deploy.sh
# ═══════════════════════════════════════════════════════════
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $*${NC}"; }
err()  { echo -e "${RED}❌ $*${NC}"; exit 1; }
ask()  { read -rp "$(echo -e "${YELLOW}➜ $1 : ${NC}")" "$2"; }

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  🛍️  Déploiement Telegram Shop Bot + Mini App"
echo "═══════════════════════════════════════════════════════"
echo ""

# ── Prérequis ─────────────────────────────────────────────
for cmd in node npm git curl; do
  command -v "$cmd" &>/dev/null || err "'$cmd' est requis. Installez-le d'abord."
done
ok "Prérequis vérifiés"

# ── Collecte des infos ────────────────────────────────────
echo ""
echo "📋 Informations requises :"
echo ""

ask "BOT_TOKEN (de @BotFather)"          BOT_TOKEN
ask "GITHUB_TOKEN (Personal Access Token)" GITHUB_TOKEN
ask "Nom du repo GitHub (ex: mon-shop)"  REPO_NAME
ask "Votre username GitHub"              GITHUB_USER
ask "Votre Telegram ID (de @userinfobot)" ADMIN_TG_ID

echo ""

# ── 1. Créer le repo GitHub ───────────────────────────────
echo "📦 Création du repo GitHub..."

HTTP=$(curl -s -o /tmp/gh_create.json -w "%{http_code}" \
  -H "Authorization: token ${GITHUB_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"${REPO_NAME}\",\"private\":false,\"auto_init\":false}" \
  https://api.github.com/user/repos)

if [ "$HTTP" = "201" ]; then
  ok "Repo GitHub créé : https://github.com/${GITHUB_USER}/${REPO_NAME}"
elif [ "$HTTP" = "422" ]; then
  warn "Le repo existe déjà, on continue..."
else
  err "Erreur GitHub API (HTTP $HTTP) : $(cat /tmp/gh_create.json)"
fi

# ── 2. Ajouter le secret API_URL (on le mettra après Railway) ──
# (sera ajouté après le déploiement Railway)

# ── 3. Push vers GitHub ───────────────────────────────────
echo ""
echo "📤 Push du code vers GitHub..."

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_DIR"

# .gitignore
cat > .gitignore << 'GITIGNORE'
node_modules/
bot/.env
bot/shop.db
*.db
.DS_Store
GITIGNORE

git init -q
git config user.email "deploy@telegram-shop.local"
git config user.name "Deploy Script"
git add -A
git commit -q -m "chore: initial deploy 🚀" 2>/dev/null || true

REMOTE="https://${GITHUB_TOKEN}@github.com/${GITHUB_USER}/${REPO_NAME}.git"
git remote remove origin 2>/dev/null || true
git remote add origin "$REMOTE"
git branch -M main
git push -u origin main -f -q

ok "Code poussé vers GitHub"

# ── 4. Activer GitHub Pages ───────────────────────────────
echo ""
echo "🌐 Activation de GitHub Pages..."

curl -s -X PUT \
  -H "Authorization: token ${GITHUB_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"source":{"branch":"main","path":"/"},"build_type":"workflow"}' \
  "https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/pages" > /dev/null 2>&1 || true

PAGES_URL="https://${GITHUB_USER}.github.io/${REPO_NAME}"
ok "GitHub Pages activé → ${PAGES_URL}"

# ── 5. Railway ────────────────────────────────────────────
echo ""
echo "🚂 Déploiement Railway..."

# Installer Railway CLI si absent
if ! command -v railway &>/dev/null; then
  echo "   Installation de Railway CLI..."
  npm install -g @railway/cli -q
fi

# Connexion Railway
echo "   Connectez-vous à Railway (une fenêtre va s'ouvrir)..."
railway login --browserless 2>/dev/null || railway login

# Créer le projet Railway
railway init --name "${REPO_NAME}" -q 2>/dev/null || true

# Variables d'environnement
railway variables set \
  BOT_TOKEN="${BOT_TOKEN}" \
  MINI_APP_URL="${PAGES_URL}/index.html" \
  ADMIN_TG_ID="${ADMIN_TG_ID}" \
  PORT="3000" \
  NODE_ENV="production" -q

# Déployer
railway up --detach -q

# Récupérer l'URL du service
sleep 5
RAILWAY_URL=$(railway domain 2>/dev/null | grep "https" | head -1 | tr -d ' ') || true

if [ -z "$RAILWAY_URL" ]; then
  warn "URL Railway non récupérée automatiquement."
  ask "Collez l'URL Railway (ex: https://xxx.railway.app)" RAILWAY_URL
fi

ok "API Railway déployée → ${RAILWAY_URL}"

# ── 6. Injecter l'URL API dans la Mini App ────────────────
echo ""
echo "🔗 Connexion Mini App ↔ API..."

# Ajouter le secret GitHub pour l'injection dans Pages
curl -s \
  -H "Authorization: token ${GITHUB_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"encrypted_value\":\"${RAILWAY_URL}\",\"key_id\":\"$(curl -s -H "Authorization: token ${GITHUB_TOKEN}" https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/actions/secrets/public-key | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["key_id"])')\"}" \
  "https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/actions/secrets/API_URL" > /dev/null 2>&1 || \
  warn "Ajout du secret API_URL manuel nécessaire (Settings → Secrets → API_URL = ${RAILWAY_URL})"

# Re-déployer Pages pour injecter l'URL
curl -s -X POST \
  -H "Authorization: token ${GITHUB_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"ref":"main"}' \
  "https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/actions/workflows/deploy.yml/dispatches" > /dev/null

ok "Redéploiement Pages déclenché avec l'URL de l'API"

# ── 7. Configurer le Menu Button du bot ──────────────────
echo ""
echo "🤖 Configuration du bouton Menu bot..."

MINI_FULL_URL="${PAGES_URL}/index.html?api=${RAILWAY_URL}"

curl -s "https://api.telegram.org/bot${BOT_TOKEN}/setChatMenuButton" \
  -d "menu_button={\"type\":\"web_app\",\"text\":\"🛒 Boutique\",\"web_app\":{\"url\":\"${MINI_FULL_URL}\"}}" > /dev/null

ok "Menu Button configuré → Boutique"

# ── 8. Mettre à jour MINI_APP_URL sur Railway ─────────────
railway variables set MINI_APP_URL="${MINI_FULL_URL}" -q 2>/dev/null || true
railway up --detach -q 2>/dev/null || true

# ── Résumé ────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════"
echo -e "  ${GREEN}🎉 DÉPLOIEMENT TERMINÉ${NC}"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  🤖 Bot Telegram  : https://t.me/VOTRE_BOT_USERNAME"
echo "  🌐 Mini App      : ${PAGES_URL}"
echo "  🚂 API Railway   : ${RAILWAY_URL}"
echo ""
echo "  ⏳ GitHub Pages peut prendre 2-3 min à être actif."
echo ""
echo "  Testez en envoyant /start à votre bot sur Telegram !"
echo "═══════════════════════════════════════════════════════"
