// admin.js — Routes API d'administration (protégées par token)
import express from 'express';
import { all, get, run, getCategories, getProducts } from './db.js';

export const adminRouter = express.Router();

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'changeme';

// Middleware auth
adminRouter.use((req, res, next) => {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token !== ADMIN_TOKEN) return res.status(401).json({ error: 'Non autorisé' });
  next();
});

// GET /admin/api/products
adminRouter.get('/products', (_,res) => res.json(getProducts()));

// GET /admin/api/categories
adminRouter.get('/categories', (_,res) => res.json(getCategories()));

// POST /admin/api/products — créer un produit
adminRouter.post('/products', (req, res) => {
  const { category_id, name, description, price, image_url, stock } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'name et price requis' });
  const r = run(
    'INSERT INTO products (category_id,name,description,price,image_url,stock) VALUES (?,?,?,?,?,?)',
    [category_id||1, name, description||'', parseFloat(price), image_url||'', parseInt(stock)||999]
  );
  res.json({ success: true, id: r.lastInsertRowid });
});

// PUT /admin/api/products/:id — modifier un produit
adminRouter.put('/products/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const p  = get('SELECT * FROM products WHERE id=?', [id]);
  if (!p) return res.status(404).json({ error: 'Produit introuvable' });

  const { name, description, price, image_url, stock, active, category_id } = req.body;
  run(
    `UPDATE products SET
      name=?, description=?, price=?, image_url=?, stock=?, active=?, category_id=?
    WHERE id=?`,
    [
      name        ?? p.name,
      description ?? p.description,
      price       !== undefined ? parseFloat(price) : p.price,
      image_url   ?? p.image_url,
      stock       !== undefined ? parseInt(stock)   : p.stock,
      active      !== undefined ? (active ? 1 : 0)  : p.active,
      category_id ?? p.category_id,
      id
    ]
  );
  res.json({ success: true });
});

// DELETE /admin/api/products/:id — désactiver (soft delete)
adminRouter.delete('/products/:id', (req, res) => {
  run('UPDATE products SET active=0 WHERE id=?', [parseInt(req.params.id)]);
  res.json({ success: true });
});

// POST /admin/api/categories — créer une catégorie
adminRouter.post('/categories', (req, res) => {
  const { name, emoji } = req.body;
  if (!name) return res.status(400).json({ error: 'name requis' });
  const r = run('INSERT INTO categories (name,emoji) VALUES (?,?)', [name, emoji||'📦']);
  res.json({ success: true, id: r.lastInsertRowid });
});

// GET /admin/api/orders — toutes les commandes
adminRouter.get('/orders', (_,res) => {
  const orders = all(`
    SELECT o.*, u.tg_id, u.first_name, u.username
    FROM orders o JOIN users u ON u.id=o.user_id
    ORDER BY o.created_at DESC LIMIT 50
  `);
  res.json(orders);
});

// PUT /admin/api/orders/:id — changer le statut
adminRouter.put('/orders/:id', (req, res) => {
  const { status } = req.body;
  const valid = ['pending','paid','shipped','cancelled'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Statut invalide' });
  run('UPDATE orders SET status=? WHERE id=?', [status, parseInt(req.params.id)]);
  res.json({ success: true });
});
