// index.js — Bot Telegram Shop (Telegraf + Express + sql.js)
import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import express from 'express';
import cors from 'cors';
import {
  initDb, upsertUser, getCategories, getProductsByCat,
  getProductById, getProducts, createOrder, getOrdersByUser, getUserByTgId
} from './db.js';

const BOT_TOKEN    = process.env.BOT_TOKEN;
const MINI_APP_URL = process.env.MINI_APP_URL || 'https://your-domain.com/shop';
const PORT         = parseInt(process.env.PORT || '3000');

if (!BOT_TOKEN) { console.error('❌ BOT_TOKEN manquant'); process.exit(1); }

// ── Démarrage async ───────────────────────────────────────────────────────
await initDb();

const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// ── Middleware user ───────────────────────────────────────────────────────
bot.use((ctx, next) => {
  if (ctx.from) upsertUser({ tg_id: ctx.from.id, username: ctx.from.username||null, first_name: ctx.from.first_name||'Utilisateur' });
  return next();
});

// ── /start ────────────────────────────────────────────────────────────────
bot.start(async (ctx) => {
  const name = ctx.from.first_name || 'là';
  await ctx.replyWithPhoto(
    { url: 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=700&q=80' },
    {
      caption: `🛍️ *Bienvenue ${name} !*\n\nNotre boutique est directement dans Telegram.\nCommandez en quelques secondes sans quitter l'application.`,
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.webApp('🛒 Ouvrir la boutique', MINI_APP_URL)],
        [Markup.button.callback('📂 Catégories', 'show_cats'), Markup.button.callback('📋 Mes commandes', 'my_orders')],
        [Markup.button.callback('❓ Aide', 'help')]
      ])
    }
  );
});

bot.command('shop', async (ctx) => {
  await ctx.reply('🛒 Accédez à la boutique :', {
    ...Markup.inlineKeyboard([[Markup.button.webApp('🛍️ Boutique', MINI_APP_URL)]])
  });
});

// ── Catégories ────────────────────────────────────────────────────────────
async function showCats(ctx) {
  if (ctx.callbackQuery) await ctx.answerCbQuery();
  const cats = getCategories();
  const btns = cats.map(c => [Markup.button.callback(`${c.emoji} ${c.name}`, `cat_${c.id}`)]);
  btns.push([Markup.button.webApp('🛒 Tout voir', MINI_APP_URL)]);
  await ctx.reply('📂 *Choisissez une catégorie :*', { parse_mode:'Markdown', ...Markup.inlineKeyboard(btns) });
}
bot.command('categories', showCats);
bot.action('show_cats', showCats);

bot.action(/^cat_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const prods = getProductsByCat(parseInt(ctx.match[1]));
  if (!prods.length) return ctx.reply('Aucun produit dans cette catégorie.');
  for (const p of prods.slice(0,4)) {
    await ctx.replyWithPhoto({ url: p.image_url }, {
      caption: `*${p.name}*\n${p.description}\n\n💰 *${p.price.toFixed(2)} €*`,
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.webApp('🛒 Ajouter', `${MINI_APP_URL}?product=${p.id}`)]])
    });
  }
  if (prods.length > 4) {
    await ctx.reply(`_+ ${prods.length-4} autres..._`, { parse_mode:'Markdown', ...Markup.inlineKeyboard([[Markup.button.webApp('Voir tout', MINI_APP_URL)]]) });
  }
});

// ── Commandes ─────────────────────────────────────────────────────────────
const SE = { pending:'⏳', paid:'✅', shipped:'📦', cancelled:'❌' };

async function showOrders(ctx) {
  if (ctx.callbackQuery) await ctx.answerCbQuery();
  const orders = getOrdersByUser(ctx.from.id);
  if (!orders.length) return ctx.reply("📋 Aucune commande pour l'instant.", {
    ...Markup.inlineKeyboard([[Markup.button.webApp('🛒 Boutique', MINI_APP_URL)]])
  });
  let msg = '📋 *Vos dernières commandes :*\n\n';
  for (const o of orders)
    msg += `🔖 *#${o.id}* — ${SE[o.status]||'❓'} ${o.status} · *${Number(o.total).toFixed(2)} €*\n   ${o.created_at.slice(0,10)}\n\n`;
  await ctx.reply(msg, { parse_mode:'Markdown' });
}
bot.command('orders', showOrders);
bot.action('my_orders', showOrders);

async function showHelp(ctx) {
  if (ctx.callbackQuery) await ctx.answerCbQuery();
  await ctx.reply('📖 *Commandes :*\n/start · /shop · /categories · /orders · /help', { parse_mode:'Markdown' });
}
bot.command('help', showHelp);
bot.action('help', showHelp);

// ── API REST ──────────────────────────────────────────────────────────────
app.get('/api/products',    (_,res) => res.json(getProducts()));
app.get('/api/categories',  (_,res) => res.json(getCategories()));
app.get('/api/products/:id',(req,res) => {
  const p = getProductById(parseInt(req.params.id));
  p ? res.json(p) : res.status(404).json({ error:'Introuvable' });
});

app.post('/api/order', async (req, res) => {
  try {
    const { tg_user_id, items, total } = req.body;
    if (!tg_user_id || !Array.isArray(items) || !items.length)
      return res.status(400).json({ error:'Payload invalide' });
    const user = getUserByTgId(tg_user_id);
    if (!user) return res.status(404).json({ error:'Utilisateur non trouvé' });
    const { lastInsertRowid: orderId } = createOrder(user.id, total, JSON.stringify(items));
    const lines = items.map(i => `• ${i.name} ×${i.qty} — ${(i.price*i.qty).toFixed(2)} €`).join('\n');
    await bot.telegram.sendMessage(
      tg_user_id,
      `✅ *Commande #${orderId} reçue !*\n\n${lines}\n\n💰 *Total : ${Number(total).toFixed(2)} €*\n\nMerci ! 🎉`,
      { parse_mode:'Markdown' }
    ).catch(e => console.warn('Notif échouée:', e.message));
    res.json({ success:true, order_id:orderId });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error:'Erreur serveur' });
  }
});

app.get('/health', (_,res) => res.json({ ok:true, ts:new Date().toISOString() }));

// ── Lancement ─────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`🚀 API sur http://localhost:${PORT}`));
bot.launch({ dropPendingUpdates:true })
   .then(() => console.log('🤖 Bot démarré'))
   .catch(e => { console.error(e); process.exit(1); });

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
