// index.js — Bot Telegram Shop (Telegraf + Express + better-sqlite3)
import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  upsertUser, getCategories, getProductsByCat,
  getProductById, getProducts, createOrder, getOrdersByUser,
  getUserByTgId, all, get, run
} from './db.js';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const BOT_TOKEN    = process.env.BOT_TOKEN;
const MINI_APP_URL = process.env.MINI_APP_URL || 'https://dr33r1.github.io/telegram-shop/index.html';
const ADMIN_TOKEN  = process.env.ADMIN_TOKEN  || 'changeme-admin-2025';
const ADMIN_TG_ID  = process.env.ADMIN_TG_ID ? process.env.ADMIN_TG_ID.trim() : '8609341246';
const PORT         = parseInt(process.env.PORT || '3000');

if (!BOT_TOKEN) { console.error('❌ BOT_TOKEN manquant'); process.exit(1); }

// ── 1. EXPRESS EN PREMIER ─────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());
app.get('/health', (_,res) => res.json({ ok:true, ts:new Date().toISOString() }));

// ── Notification commande → admin (utilisé par le bouton Telegram de la mini app)
app.post('/api/notify', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'message requis' });
    if (!ADMIN_TG_ID) return res.status(503).json({ error: 'ADMIN_TG_ID non configuré' });
    await bot.telegram.sendMessage(ADMIN_TG_ID, message);
    res.json({ ok: true });
  } catch(e) {
    console.error('notify error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

await new Promise(resolve => app.listen(PORT, () => {
  console.log(`🚀 API en écoute sur le port ${PORT}`);
  resolve();
}));

// ── 2. BASE DE DONNÉES ────────────────────────────────────────────────────
await initDb();

// ── 3. BOT TELEGRAM ───────────────────────────────────────────────────────
const bot = new Telegraf(BOT_TOKEN);

bot.use((ctx, next) => {
  if (ctx.from) upsertUser({ tg_id:ctx.from.id, username:ctx.from.username||null, first_name:ctx.from.first_name||'Utilisateur' });
  return next();
});

bot.start(async (ctx) => {
  const name = ctx.from.first_name || 'là';
  await ctx.replyWithPhoto(
    { url:'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=700&q=80' },
    {
      caption:`🛍️ *Bienvenue ${name} !*\n\nNotre boutique est directement dans Telegram.\nCommandez en quelques secondes sans quitter l'application.`,
      parse_mode:'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.webApp('🛒 Ouvrir la boutique', MINI_APP_URL)],
        [Markup.button.callback('📂 Catégories','show_cats'), Markup.button.callback('📋 Mes commandes','my_orders')],
        [Markup.button.callback('❓ Aide','help')]
      ])
    }
  );
});

bot.command('shop', async (ctx) => ctx.reply('🛒 Boutique :', Markup.inlineKeyboard([[Markup.button.webApp('🛍️ Ouvrir',MINI_APP_URL)]])));

async function showCats(ctx) {
  if (ctx.callbackQuery) await ctx.answerCbQuery();
  const cats = getCategories();
  const btns = cats.map(c => [Markup.button.callback(`${c.emoji} ${c.name}`,`cat_${c.id}`)]);
  btns.push([Markup.button.webApp('🛒 Tout voir',MINI_APP_URL)]);
  await ctx.reply('📂 *Choisissez une catégorie :*',{ parse_mode:'Markdown',...Markup.inlineKeyboard(btns) });
}
bot.command('categories', showCats);
bot.action('show_cats', showCats);

bot.action(/^cat_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const prods = getProductsByCat(parseInt(ctx.match[1]));
  if (!prods.length) return ctx.reply('Aucun produit dans cette catégorie.');
  for (const p of prods.slice(0,4))
    await ctx.replyWithPhoto({ url:p.image_url },{
      caption:`*${p.name}*\n${p.description}\n\n💰 *${p.price.toFixed(2)} €*`,
      parse_mode:'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.webApp('🛒 Ajouter',`${MINI_APP_URL}?product=${p.id}`)]])
    });
  if (prods.length>4) await ctx.reply(`_+ ${prods.length-4} autres..._`,{parse_mode:'Markdown',...Markup.inlineKeyboard([[Markup.button.webApp('Voir tout',MINI_APP_URL)]])});
});

const SE = { pending:'⏳', paid:'✅', shipped:'📦', cancelled:'❌' };

async function showOrders(ctx) {
  if (ctx.callbackQuery) await ctx.answerCbQuery();
  const orders = getOrdersByUser(ctx.from.id);
  if (!orders.length) return ctx.reply("📋 Aucune commande pour l'instant.",Markup.inlineKeyboard([[Markup.button.webApp('🛒 Boutique',MINI_APP_URL)]]));
  let msg = '📋 *Vos dernières commandes :*\n\n';
  for (const o of orders)
    msg += `🔖 *#${o.id}* — ${SE[o.status]||'❓'} ${o.status} · *${Number(o.total).toFixed(2)} €*\n   ${o.created_at.slice(0,10)}\n\n`;
  await ctx.reply(msg,{parse_mode:'Markdown'});
}
bot.command('orders', showOrders);
bot.action('my_orders', showOrders);

async function showHelp(ctx) {
  if (ctx.callbackQuery) await ctx.answerCbQuery();
  await ctx.reply('📖 *Commandes :*\n/start · /shop · /categories · /orders · /help',{parse_mode:'Markdown'});
}
bot.command('help', showHelp);
bot.action('help', showHelp);

// ── Commande admin /admin ─────────────────────────────────────────────────
bot.command('admin', async (ctx) => {
  if (ctx.from.id !== 8609341246)
    return ctx.reply('⛔ Accès refusé.');

  // PUBLIC_URL à définir dans Railway Variables (ex: https://xxx.railway.app)
  const RAILWAY_URL = process.env.PUBLIC_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null)
    || `http://localhost:${PORT}`;

  await ctx.reply(
    `🔐 *Panneau d'administration*\n\n` +
    `Accédez à l'interface admin pour gérer vos produits, catégories et commandes.\n\n` +
    `🔑 Token admin : \`${ADMIN_TOKEN}\`\n` +
    `🌐 URL API : \`${RAILWAY_URL}\``,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[
        Markup.button.webApp('🛠️ Ouvrir l\'admin',
          MINI_APP_URL.replace('index.html','admin.html')
        )
      ]])
    }
  );
});

// ── API REST publique ─────────────────────────────────────────────────────
app.get('/api/products',    (_,res) => res.json(getProducts()));
app.get('/api/categories',  (_,res) => res.json(getCategories()));
app.get('/api/products/:id',(req,res) => {
  const p = getProductById(parseInt(req.params.id));
  p ? res.json(p) : res.status(404).json({error:'Introuvable'});
});

app.post('/api/order', async (req,res) => {
  try {
    const { tg_user_id, tg_username, tg_first_name, items, total, delivery_mode, client_info } = req.body;
    if (!tg_user_id||!Array.isArray(items)||!items.length)
      return res.status(400).json({error:'Payload invalide'});
    const user = getUserByTgId(tg_user_id);
    if (!user) return res.status(404).json({error:'Utilisateur non trouvé'});

    const orderData = JSON.stringify({ items, delivery_mode, client_info });
    const { lastInsertRowid:orderId } = createOrder(user.id, total, orderData);

    // ── Lignes articles
    const lines = items.map(i=>`• ${i.name} ×${i.qty} — ${(i.price*i.qty).toFixed(2)} €`).join('\n');

    // ── Infos livraison formatées
    let deliveryBlock = '';
    if (delivery_mode === 'pickup') {
      deliveryBlock =
        `🏪 *Mode : Sur place*\n` +
        `👤 ${client_info.name}\n` +
        `📞 ${client_info.phone}` +
        (client_info.note ? `\n💬 ${client_info.note}` : '');
    } else {
      deliveryBlock =
        `📦 *Mode : Livraison*\n` +
        `👤 ${client_info.firstname} ${client_info.lastname}\n` +
        `📍 ${client_info.address}, ${client_info.zip} ${client_info.city}\n` +
        `📞 ${client_info.phone}` +
        (client_info.note ? `\n💬 ${client_info.note}` : '');
    }

    const clientMsg =
      `✅ *Commande #${orderId} confirmée !*\n\n` +
      `${lines}\n\n` +
      `💰 *Total : ${Number(total).toFixed(2)} €*\n\n` +
      `${deliveryBlock}\n\n` +
      `Nous allons vous contacter rapidement. Merci ! 🙏`;

    const adminMsg =
      `🔔 *Nouvelle commande #${orderId}*\n\n` +
      `👤 Client : ${tg_first_name||'Inconnu'}${tg_username ? ' (@'+tg_username+')' : ''} [ID: ${tg_user_id}]\n\n` +
      `🛍️ *Articles :*\n${lines}\n\n` +
      `💰 *Total : ${Number(total).toFixed(2)} €*\n\n` +
      `${deliveryBlock}`;

    // Notifier le client
    await bot.telegram.sendMessage(tg_user_id, clientMsg, {parse_mode:'Markdown'})
      .catch(e=>console.warn('Notif client échouée:',e.message));

    // Notifier l'admin
    if (ADMIN_TG_ID) {
      await bot.telegram.sendMessage(ADMIN_TG_ID, adminMsg, {parse_mode:'Markdown'})
        .catch(e=>console.warn('Notif admin échouée:',e.message));
    }

    res.json({success:true, order_id:orderId});
  } catch(e) { console.error(e); res.status(500).json({error:'Erreur serveur'}); }
});

// ── API Admin (protégée par token) ────────────────────────────────────────
const adminAuth = (req,res,next) => {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token !== ADMIN_TOKEN) return res.status(401).json({error:'Non autorisé'});
  next();
};

app.get('/admin/api/products',   adminAuth, (_,res) => res.json(getProducts()));
app.get('/admin/api/categories', adminAuth, (_,res) => res.json(getCategories()));
app.get('/admin/api/orders',     adminAuth, (_,res) => res.json(
  all('SELECT o.*,u.tg_id,u.first_name,u.username FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.created_at DESC LIMIT 50')
));

app.post('/admin/api/products', adminAuth, (req,res) => {
  const {category_id,name,description,price,image_url,stock,variants} = req.body;
  if (!name||price===undefined) return res.status(400).json({error:'name et price requis'});
  const r = run('INSERT INTO products (category_id,name,description,price,image_url,stock,variants) VALUES (?,?,?,?,?,?,?)',
    [category_id||1,name,description||'',parseFloat(price),image_url||'',parseInt(stock)||999,JSON.stringify(variants||[])]);
  res.json({success:true,id:r.lastInsertRowid});
});

app.put('/admin/api/products/:id', adminAuth, (req,res) => {
  const id = parseInt(req.params.id);
  const p  = get('SELECT * FROM products WHERE id=?',[id]);
  if (!p) return res.status(404).json({error:'Produit introuvable'});
  const {name,description,price,image_url,stock,active,category_id,variants} = req.body;
  run(`UPDATE products SET name=?,description=?,price=?,image_url=?,stock=?,active=?,category_id=?,variants=? WHERE id=?`,
    [name??p.name, description??p.description,
     price!==undefined?parseFloat(price):p.price,
     image_url??p.image_url,
     stock!==undefined?parseInt(stock):p.stock,
     active!==undefined?(active?1:0):p.active,
     category_id??p.category_id,
     variants!==undefined?JSON.stringify(variants):(p.variants||'[]'),
     id]);
  res.json({success:true});
});

app.delete('/admin/api/products/:id', adminAuth, (req,res) => {
  run('UPDATE products SET active=0 WHERE id=?',[parseInt(req.params.id)]);
  res.json({success:true});
});

app.post('/admin/api/categories', adminAuth, (req,res) => {
  const {name,emoji} = req.body;
  if (!name) return res.status(400).json({error:'name requis'});
  const r = run('INSERT INTO categories (name,emoji) VALUES (?,?)',[name,emoji||'📦']);
  res.json({success:true,id:r.lastInsertRowid});
});

app.put('/admin/api/categories/:id', adminAuth, (req,res) => {
  const id = parseInt(req.params.id);
  const {name,emoji} = req.body;
  if (!name) return res.status(400).json({error:'name requis'});
  run('UPDATE categories SET name=?,emoji=? WHERE id=?',[name,emoji||'📦',id]);
  res.json({success:true});
});

app.delete('/admin/api/categories/:id', adminAuth, (req,res) => {
  const id = parseInt(req.params.id);
  // Désactiver les produits liés
  run('UPDATE products SET active=0 WHERE category_id=?',[id]);
  run('DELETE FROM categories WHERE id=?',[id]);
  res.json({success:true});
});

app.put('/admin/api/orders/:id', adminAuth, (req,res) => {
  const {status} = req.body;
  if (!['pending','paid','shipped','cancelled'].includes(status))
    return res.status(400).json({error:'Statut invalide'});
  run('UPDATE orders SET status=? WHERE id=?',[status,parseInt(req.params.id)]);
  res.json({success:true});
});

// ── Lancer le bot ─────────────────────────────────────────────────────────
bot.launch({dropPendingUpdates:true})
   .then(()=>console.log('🤖 Bot Telegram démarré'))
   .catch(e=>console.error('⚠️ Bot error:',e.message));

process.once('SIGINT',  ()=>bot.stop('SIGINT'));
process.once('SIGTERM', ()=>bot.stop('SIGTERM'));
