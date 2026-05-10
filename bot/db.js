// db.js — SQLite via better-sqlite3 (natif, synchrone, fiable sur Railway)
import { createRequire } from 'module';
import { existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const require    = createRequire(import.meta.url);
const Database   = require('better-sqlite3');
const __dirname  = path.dirname(fileURLToPath(import.meta.url));

// DB_PATH : volume Railway si monté, sinon dossier local
function resolveDbPath() {
  // Railway injecte RAILWAY_VOLUME_MOUNT_PATH automatiquement si volume attaché
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) {
    return path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'shop.db');
  }
  // Tester les chemins courants Railway sans variable
  const candidates = ['/data/shop.db', '/mnt/shop.db'];
  for (const p of candidates) {
    if (existsSync(path.dirname(p))) return p;
  }
  // Fallback local
  return path.join(__dirname, 'shop.db');
}

const DB_PATH = resolveDbPath();
console.log('📁 DB_PATH:', DB_PATH);

// Créer le dossier si nécessaire
const dbDir = path.dirname(DB_PATH);
if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });

// Ouvrir/créer la DB
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schéma ────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    tg_id      INTEGER UNIQUE NOT NULL,
    username   TEXT,
    first_name TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS categories (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT UNIQUE NOT NULL,
    emoji TEXT DEFAULT '📦'
  );
  CREATE TABLE IF NOT EXISTS products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER REFERENCES categories(id),
    name        TEXT NOT NULL,
    description TEXT,
    price       REAL NOT NULL,
    image_url   TEXT,
    stock       INTEGER DEFAULT 999,
    active      INTEGER DEFAULT 1,
    variants    TEXT DEFAULT '[]'
  );
  CREATE TABLE IF NOT EXISTS orders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER REFERENCES users(id),
    status     TEXT DEFAULT 'pending',
    total      REAL,
    items_json TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Migration : colonne variants si absente (DB existante)
try {
  db.exec("ALTER TABLE products ADD COLUMN variants TEXT DEFAULT '[]'");
  console.log('✅ Migration : colonne variants ajoutée');
} catch { /* existe déjà */ }

// ── Seed (uniquement si DB vide) ─────────────────────────────────────────
const catCount = db.prepare('SELECT COUNT(*) as n FROM categories').get().n;
if (catCount === 0) {
  const insC = db.prepare('INSERT INTO categories (name,emoji) VALUES (?,?)');
  const insP = db.prepare('INSERT INTO products (category_id,name,description,price,image_url) VALUES (?,?,?,?,?)');
  const seed = db.transaction(() => {
    const cats = [
      { name:'Électronique', emoji:'📱', prods:[
        ['iPhone 15 Pro','Titane. Le plus pro des iPhone.',1299,'https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=400'],
        ['AirPods Pro 2','Réduction de bruit active gen 2.',279,'https://images.unsplash.com/photo-1600294037681-c80b4cb5b434?w=400'],
        ['MacBook Air M3','Puissant, léger, silencieux.',1299,'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=400'],
      ]},
      { name:'Mode', emoji:'👗', prods:[
        ['Sneakers Urban','Style minimaliste, confort max.',129,'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400'],
        ['Hoodie Premium','Coton brossé 400g oversized.',89,'https://images.unsplash.com/photo-1556821840-3a63f15732ce?w=400'],
        ['Montre Classique','Mouvement automatique, acier.',349,'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400'],
      ]},
      { name:'Maison', emoji:'🏠', prods:[
        ['Lampe Neon LED','RGB 16M couleurs, télécommande.',59,'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400'],
        ['Cafetière Espresso','15 bars de pression.',199,'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=400'],
        ['Diffuseur Huiles','Aromathérapie ultrasons 500ml.',45,'https://images.unsplash.com/photo-1603006905003-be475563bc59?w=400'],
      ]},
    ];
    for (const { name, emoji, prods } of cats) {
      const { lastInsertRowid: catId } = insC.run(name, emoji);
      for (const [n,d,p,img] of prods) insP.run(catId, n, d, p, img);
    }
  });
  seed();
  console.log('✅ DB initialisée avec les produits de démo');
}

// ── Helpers ───────────────────────────────────────────────────────────────
export const all = (sql, p=[]) => db.prepare(sql).all(...p);
export const get = (sql, p=[]) => db.prepare(sql).get(...p);
export const run = (sql, p=[]) => db.prepare(sql).run(...p);

export const upsertUser = ({tg_id, username, first_name}) =>
  db.prepare(`INSERT INTO users (tg_id,username,first_name) VALUES (?,?,?)
    ON CONFLICT(tg_id) DO UPDATE SET username=excluded.username,first_name=excluded.first_name`)
    .run(tg_id, username, first_name);

export const getCategories    = ()      => db.prepare('SELECT * FROM categories ORDER BY name').all();
export const getProducts      = ()      => db.prepare(`SELECT p.*,c.name AS category_name,c.emoji AS category_emoji FROM products p JOIN categories c ON c.id=p.category_id WHERE p.active=1 ORDER BY c.name,p.name`).all();
export const getProductsByCat = (catId) => db.prepare('SELECT * FROM products WHERE category_id=? AND active=1').all(catId);
export const getProductById   = (id)    => db.prepare('SELECT * FROM products WHERE id=?').get(id);
export const createOrder      = (uid,total,json) => db.prepare('INSERT INTO orders (user_id,total,items_json) VALUES (?,?,?)').run(uid, total, json);
export const getOrdersByUser  = (tgId)  => db.prepare(`SELECT o.* FROM orders o JOIN users u ON u.id=o.user_id WHERE u.tg_id=? ORDER BY o.created_at DESC LIMIT 10`).all(tgId);
export const getUserByTgId    = (tgId)  => db.prepare('SELECT * FROM users WHERE tg_id=?').get(tgId);

export default db;
