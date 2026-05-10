// db.js — SQLite via sql.js (wasm auto-résolu, compatible local + Railway)
import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Sur Railway avec volume monté sur /app/bot, DB_PATH = /app/bot/shop.db
// En local, fallback sur le dossier du script
const VOLUME_PATH = '/app/bot/shop.db';
const LOCAL_PATH  = path.join(__dirname, 'shop.db');
const DB_PATH     = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'shop.db')
  : (existsSync('/app/bot') ? VOLUME_PATH : LOCAL_PATH);

// Résoudre le fichier WASM : chercher dans bot/node_modules puis node_modules racine
function findWasm() {
  const candidates = [
    path.join(__dirname, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return readFileSync(p);
  }
  return undefined; // sql.js trouvera le wasm tout seul en dernier recours
}

let db;

export async function initDb() {
  // Créer le dossier si nécessaire (volume Railway)
  const dbDir = path.dirname(DB_PATH);
  if (!existsSync(dbDir)) {
    try { mkdirSync(dbDir, { recursive: true }); } catch(e) {}
  }
  console.log('📁 DB_PATH:', DB_PATH);
  const SQL    = await initSqlJs({ wasmBinary: findWasm() });
  const buffer = existsSync(DB_PATH) ? readFileSync(DB_PATH) : null;
  db           = buffer ? new SQL.Database(buffer) : new SQL.Database();

  db.run('PRAGMA foreign_keys = ON;');
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tg_id INTEGER UNIQUE NOT NULL,
      username TEXT, first_name TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL, emoji TEXT DEFAULT '📦'
    );
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER REFERENCES categories(id),
      name TEXT NOT NULL, description TEXT,
      price REAL NOT NULL, image_url TEXT,
      stock INTEGER DEFAULT 999, active INTEGER DEFAULT 1,
      variants TEXT DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      status TEXT DEFAULT 'pending', total REAL, items_json TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Migration : ajouter la colonne variants si elle n'existe pas encore
  try {
    db.run("ALTER TABLE products ADD COLUMN variants TEXT DEFAULT '[]'");
    console.log('✅ Colonne variants ajoutée');
  } catch(e) { /* colonne existe déjà */ }

  const catCount = db.exec('SELECT COUNT(*) FROM categories')[0]?.values[0][0] || 0;
  if (catCount === 0) {
    const seed = [
      { cat: ['Électronique','📱'], prods: [
        ['iPhone 15 Pro','Titane. Le plus pro des iPhone.',1299,'https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=400'],
        ['AirPods Pro 2','Réduction de bruit active gen 2.',279,'https://images.unsplash.com/photo-1600294037681-c80b4cb5b434?w=400'],
        ['MacBook Air M3','Puissant, léger, silencieux.',1299,'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=400'],
      ]},
      { cat: ['Mode','👗'], prods: [
        ['Sneakers Urban','Style minimaliste, confort max.',129,'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400'],
        ['Hoodie Premium','Coton brossé 400g oversized.',89,'https://images.unsplash.com/photo-1556821840-3a63f15732ce?w=400'],
        ['Montre Classique','Mouvement automatique, acier.',349,'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400'],
      ]},
      { cat: ['Maison','🏠'], prods: [
        ['Lampe Neon LED','RGB 16M couleurs, télécommande.',59,'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400'],
        ['Cafetière Espresso','15 bars de pression.',199,'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=400'],
        ['Diffuseur Huiles','Aromathérapie ultrasons 500ml.',45,'https://images.unsplash.com/photo-1603006905003-be475563bc59?w=400'],
      ]},
    ];
    for (const { cat, prods } of seed) {
      db.run('INSERT INTO categories (name,emoji) VALUES (?,?)', cat);
      const catId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
      for (const [n,d,p,i] of prods)
        db.run('INSERT INTO products (category_id,name,description,price,image_url) VALUES (?,?,?,?,?)',[catId,n,d,p,i]);
    }
    persist();
    console.log('✅ DB initialisée avec 9 produits de démo');
  }
  return db;
}

export function persist() {
  if (!db) return;
  writeFileSync(DB_PATH, Buffer.from(db.export()));
}

function toObjs(res) {
  if (!res?.length) return [];
  const { columns, values } = res[0];
  return values.map(row => Object.fromEntries(columns.map((c,i) => [c, row[i]])));
}

export const all = (sql, p=[]) => toObjs(db.exec(sql, p));
export const get = (sql, p=[]) => all(sql, p)[0] || null;
export function run(sql, p=[]) {
  db.run(sql, p);
  const id = db.exec('SELECT last_insert_rowid()')[0]?.values[0][0];
  persist();
  return { lastInsertRowid: id };
}

export const upsertUser      = ({tg_id, username, first_name}) =>
  run('INSERT INTO users (tg_id,username,first_name) VALUES (?,?,?) ON CONFLICT(tg_id) DO UPDATE SET username=excluded.username, first_name=excluded.first_name',[tg_id,username,first_name]);
export const getCategories    = ()      => all('SELECT * FROM categories ORDER BY name');
export const getProducts      = ()      => all('SELECT p.*,c.name AS category_name,c.emoji AS category_emoji FROM products p JOIN categories c ON c.id=p.category_id WHERE p.active=1 ORDER BY c.name,p.name');
export const getProductsByCat = (catId) => all('SELECT * FROM products WHERE category_id=? AND active=1',[catId]);
export const getProductById   = (id)    => get('SELECT * FROM products WHERE id=?',[id]);
export const createOrder      = (uid,total,json) => run('INSERT INTO orders (user_id,total,items_json) VALUES (?,?,?)',[uid,total,json]);
export const getOrdersByUser  = (tgId)  => all('SELECT o.* FROM orders o JOIN users u ON u.id=o.user_id WHERE u.tg_id=? ORDER BY o.created_at DESC LIMIT 10',[tgId]);
export const getUserByTgId    = (tgId)  => get('SELECT * FROM users WHERE tg_id=?',[tgId]);
