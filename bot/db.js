// db.js — PostgreSQL via Supabase (pg)
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id         SERIAL PRIMARY KEY,
      tg_id      BIGINT UNIQUE NOT NULL,
      username   TEXT,
      first_name TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS categories (
      id    SERIAL PRIMARY KEY,
      name  TEXT UNIQUE NOT NULL,
      emoji TEXT DEFAULT '📦'
    );
    CREATE TABLE IF NOT EXISTS products (
      id          SERIAL PRIMARY KEY,
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
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER REFERENCES users(id),
      status     TEXT DEFAULT 'pending',
      total      REAL,
      items_json TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Seed si vide
  const { rows } = await pool.query('SELECT COUNT(*) as n FROM categories');
  if (parseInt(rows[0].n) === 0) {
    const seed = [
      { cat:['Électronique','📱'], prods:[
        ['iPhone 15 Pro','Titane. Le plus pro.',1299,'https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=400'],
        ['AirPods Pro 2','Réduction de bruit active.',279,'https://images.unsplash.com/photo-1600294037681-c80b4cb5b434?w=400'],
        ['MacBook Air M3','Puissant et silencieux.',1299,'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=400'],
      ]},
      { cat:['Mode','👗'], prods:[
        ['Sneakers Urban','Style minimaliste.',129,'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400'],
        ['Hoodie Premium','Coton brossé 400g.',89,'https://images.unsplash.com/photo-1556821840-3a63f15732ce?w=400'],
        ['Montre Classique','Mouvement automatique.',349,'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400'],
      ]},
      { cat:['Maison','🏠'], prods:[
        ['Lampe Neon LED','RGB 16M couleurs.',59,'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400'],
        ['Cafetière Espresso','15 bars de pression.',199,'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=400'],
        ['Diffuseur Huiles','Aromathérapie 500ml.',45,'https://images.unsplash.com/photo-1603006905003-be475563bc59?w=400'],
      ]},
    ];
    for (const { cat, prods } of seed) {
      const { rows: cr } = await pool.query(
        'INSERT INTO categories (name,emoji) VALUES ($1,$2) RETURNING id', cat
      );
      const catId = cr[0].id;
      for (const [n,d,p,img] of prods)
        await pool.query(
          'INSERT INTO products (category_id,name,description,price,image_url) VALUES ($1,$2,$3,$4,$5)',
          [catId,n,d,p,img]
        );
    }
    console.log('✅ DB Supabase initialisée avec produits de démo');
  }
  console.log('✅ Supabase PostgreSQL prêt');
}

// ── Helpers ────────────────────────────────────────────────────────────────
export const all = async (sql, p=[]) => (await pool.query(sql, p)).rows;
export const get = async (sql, p=[]) => (await pool.query(sql, p)).rows[0] || null;
export const run = async (sql, p=[]) => {
  const r = await pool.query(sql, p);
  return { lastInsertRowid: r.rows[0]?.id };
};

export const upsertUser = (u) => pool.query(
  `INSERT INTO users (tg_id,username,first_name) VALUES ($1,$2,$3)
   ON CONFLICT(tg_id) DO UPDATE SET username=EXCLUDED.username,first_name=EXCLUDED.first_name`,
  [u.tg_id, u.username, u.first_name]
);

export const getCategories    = ()      => all('SELECT * FROM categories ORDER BY name');
export const getProducts      = ()      => all(`
  SELECT p.*,c.name AS category_name,c.emoji AS category_emoji
  FROM products p JOIN categories c ON c.id=p.category_id
  WHERE p.active=1 ORDER BY c.name,p.name`);
export const getProductsByCat = (catId) => all('SELECT * FROM products WHERE category_id=$1 AND active=1',[catId]);
export const getProductById   = (id)    => get('SELECT * FROM products WHERE id=$1',[id]);
export const createOrder      = (uid,total,json) => run(
  'INSERT INTO orders (user_id,total,items_json) VALUES ($1,$2,$3) RETURNING id',[uid,total,json]);
export const getOrdersByUser  = (tgId)  => all(`
  SELECT o.* FROM orders o JOIN users u ON u.id=o.user_id
  WHERE u.tg_id=$1 ORDER BY o.created_at DESC LIMIT 10`,[tgId]);
export const getUserByTgId    = (tgId)  => get('SELECT * FROM users WHERE tg_id=$1',[tgId]);
