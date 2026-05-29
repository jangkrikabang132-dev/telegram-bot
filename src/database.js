const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Pastikan folder data/ ada
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'shop.db');
const db = new Database(dbPath);

// Aktifkan WAL mode untuk performa lebih baik
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Prepared statements — diisi saat initDatabase() dipanggil
let productQueries = {};
let cartQueries = {};
let orderQueries = {};
let digitalItemQueries = {};

// ============================================================
// INISIALISASI TABEL
// ============================================================
function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      price INTEGER NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0,
      image_url TEXT DEFAULT '',
      category TEXT DEFAULT 'Umum',
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT UNIQUE NOT NULL,
      chat_id TEXT NOT NULL,
      username TEXT DEFAULT '',
      full_name TEXT DEFAULT '',
      total_amount INTEGER NOT NULL,
      unique_amount INTEGER NOT NULL DEFAULT 0,
      status TEXT DEFAULT 'pending',
      dana_reference TEXT DEFAULT '',
      payment_url TEXT DEFAULT '',
      paid_at DATETIME DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      price INTEGER NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(order_id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS cart (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      UNIQUE(chat_id, product_id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE INDEX IF NOT EXISTS idx_orders_chat_id ON orders(chat_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_cart_chat_id ON cart(chat_id);

    CREATE TABLE IF NOT EXISTS digital_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      order_id TEXT DEFAULT NULL,
      used_at DATETIME DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
    CREATE INDEX IF NOT EXISTS idx_digital_items_product_id ON digital_items(product_id);
    CREATE INDEX IF NOT EXISTS idx_digital_items_order_id ON digital_items(order_id);
  `);

  // ============================================================
  // MIGRASI: Tambah kolom baru ke tabel lama (jika belum ada)
  // ============================================================
  try {
    db.exec(`ALTER TABLE orders ADD COLUMN unique_amount INTEGER NOT NULL DEFAULT 0`);
    console.log('  ✅ Migrasi: kolom unique_amount ditambahkan');
  } catch (e) {
    // Kolom sudah ada, skip
  }
  try {
    db.exec(`ALTER TABLE orders ADD COLUMN paid_at DATETIME DEFAULT NULL`);
    console.log('  ✅ Migrasi: kolom paid_at ditambahkan');
  } catch (e) {
    // Kolom sudah ada, skip
  }
  try {
    db.exec(`ALTER TABLE products ADD COLUMN usage_instructions TEXT DEFAULT ''`);
    console.log('  ✅ Migrasi: kolom usage_instructions ditambahkan');
  } catch (e) {
    // Kolom sudah ada, skip
  }

  // Index untuk unique_amount (setelah migrasi)
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_orders_unique_amount ON orders(unique_amount)`);
  } catch (e) {
    // Skip jika error
  }

  // ============================================================
  // PREPARED STATEMENTS (setelah tabel dibuat)
  // ============================================================

  // PRODUCT QUERIES
  productQueries.getAll = db.prepare(`
    SELECT * FROM products WHERE is_active = 1 ORDER BY category, name
  `);
  productQueries.getById = db.prepare(`
    SELECT * FROM products WHERE id = ?
  `);
  productQueries.getByCategory = db.prepare(`
    SELECT * FROM products WHERE is_active = 1 AND category = ? ORDER BY name
  `);
  productQueries.getCategories = db.prepare(`
    SELECT DISTINCT category FROM products WHERE is_active = 1 ORDER BY category
  `);
  productQueries.getAllIncludeInactive = db.prepare(`
    SELECT * FROM products ORDER BY category, name
  `);
  productQueries.insert = db.prepare(`
    INSERT INTO products (name, description, price, stock, image_url, category, usage_instructions)
    VALUES (@name, @description, @price, @stock, @image_url, @category, @usage_instructions)
  `);
  productQueries.update = db.prepare(`
    UPDATE products SET
      name = @name,
      description = @description,
      price = @price,
      stock = @stock,
      image_url = @image_url,
      category = @category,
      is_active = @is_active,
      usage_instructions = @usage_instructions,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `);
  productQueries.updateStock = db.prepare(`
    UPDATE products SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `);
  productQueries.reduceStock = db.prepare(`
    UPDATE products SET stock = stock - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND stock >= ?
  `);
  productQueries.delete = db.prepare(`
    DELETE FROM products WHERE id = ?
  `);
  productQueries.toggleActive = db.prepare(`
    UPDATE products SET is_active = NOT is_active, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `);
  productQueries.search = db.prepare(`
    SELECT * FROM products WHERE is_active = 1 AND (name LIKE ? OR description LIKE ?) ORDER BY name
  `);
  productQueries.getLowStock = db.prepare(`
    SELECT * FROM products WHERE is_active = 1 AND stock <= 5 ORDER BY stock ASC
  `);

  // CART QUERIES
  cartQueries.getByChat = db.prepare(`
    SELECT c.*, p.name, p.price, p.stock, p.image_url
    FROM cart c
    JOIN products p ON c.product_id = p.id
    WHERE c.chat_id = ? AND p.is_active = 1
  `);
  cartQueries.addItem = db.prepare(`
    INSERT INTO cart (chat_id, product_id, quantity)
    VALUES (?, ?, ?)
    ON CONFLICT(chat_id, product_id) DO UPDATE SET quantity = quantity + excluded.quantity
  `);
  cartQueries.updateQuantity = db.prepare(`
    UPDATE cart SET quantity = ? WHERE chat_id = ? AND product_id = ?
  `);
  cartQueries.removeItem = db.prepare(`
    DELETE FROM cart WHERE chat_id = ? AND product_id = ?
  `);
  cartQueries.clearCart = db.prepare(`
    DELETE FROM cart WHERE chat_id = ?
  `);
  cartQueries.getItemCount = db.prepare(`
    SELECT COALESCE(SUM(quantity), 0) as count FROM cart WHERE chat_id = ?
  `);

  // ORDER QUERIES
  orderQueries.create = db.prepare(`
    INSERT INTO orders (order_id, chat_id, username, full_name, total_amount, unique_amount, status)
    VALUES (@order_id, @chat_id, @username, @full_name, @total_amount, @unique_amount, @status)
  `);
  orderQueries.addItem = db.prepare(`
    INSERT INTO order_items (order_id, product_id, product_name, quantity, price)
    VALUES (@order_id, @product_id, @product_name, @quantity, @price)
  `);
  orderQueries.getById = db.prepare(`
    SELECT * FROM orders WHERE order_id = ?
  `);
  orderQueries.getByChat = db.prepare(`
    SELECT * FROM orders WHERE chat_id = ? ORDER BY created_at DESC LIMIT 10
  `);
  orderQueries.getAllPending = db.prepare(`
    SELECT * FROM orders WHERE status = 'pending' ORDER BY created_at DESC
  `);
  orderQueries.getAll = db.prepare(`
    SELECT * FROM orders ORDER BY created_at DESC LIMIT 50
  `);
  orderQueries.getItems = db.prepare(`
    SELECT * FROM order_items WHERE order_id = ?
  `);
  orderQueries.updateStatus = db.prepare(`
    UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE order_id = ?
  `);
  orderQueries.confirmPayment = db.prepare(`
    UPDATE orders SET status = 'paid', paid_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE order_id = ?
  `);
  orderQueries.updatePayment = db.prepare(`
    UPDATE orders SET
      dana_reference = ?,
      payment_url = ?,
      status = 'pending',
      updated_at = CURRENT_TIMESTAMP
    WHERE order_id = ?
  `);
  orderQueries.getPendingByAmount = db.prepare(`
    SELECT * FROM orders WHERE status = 'pending' AND unique_amount = ? ORDER BY created_at DESC LIMIT 1
  `);
  orderQueries.getTodaySales = db.prepare(`
    SELECT
      COUNT(*) as total_orders,
      COALESCE(SUM(total_amount), 0) as total_revenue
    FROM orders
    WHERE status = 'paid' AND DATE(created_at) = DATE('now')
  `);
  orderQueries.getExpired = db.prepare(`
    SELECT * FROM orders
    WHERE status = 'pending'
    AND created_at < datetime('now', '-30 minutes')
  `);

  digitalItemQueries.insert = db.prepare(`
    INSERT INTO digital_items (product_id, content) VALUES (?, ?)
  `);
  digitalItemQueries.getUnused = db.prepare(`
    SELECT * FROM digital_items WHERE product_id = ? AND order_id IS NULL LIMIT ?
  `);
  digitalItemQueries.claim = db.prepare(`
    UPDATE digital_items SET order_id = ?, used_at = CURRENT_TIMESTAMP WHERE id = ?
  `);
  digitalItemQueries.getByOrder = db.prepare(`
    SELECT * FROM digital_items WHERE order_id = ?
  `);
  digitalItemQueries.countUnused = db.prepare(`
    SELECT COUNT(*) as count FROM digital_items WHERE product_id = ? AND order_id IS NULL
  `);

  console.log('✅ Database berhasil diinisialisasi');
}

// ============================================================
// TRANSACTION HELPERS
// ============================================================

/**
 * Buat order dari keranjang
 */
function createOrderFromCart(orderId, chatId, username, fullName) {
  const createOrderTransaction = db.transaction(() => {
    const cartItems = cartQueries.getByChat.all(String(chatId));

    if (cartItems.length === 0) {
      throw new Error('Keranjang kosong');
    }

    let totalAmount = 0;
    const orderItems = [];

    // Validasi stok dan hitung total
    for (const item of cartItems) {
      if (item.stock < item.quantity) {
        throw new Error(`Stok "${item.name}" tidak cukup. Tersedia: ${item.stock}, diminta: ${item.quantity}`);
      }
      totalAmount += item.price * item.quantity;
      orderItems.push({
        order_id: orderId,
        product_id: item.product_id,
        product_name: item.name,
        quantity: item.quantity,
        price: item.price,
      });
    }

    // Generate unique amount (tambah 1-99 rupiah)
    const uniqueAdd = Math.floor(Math.random() * 99) + 1;
    const uniqueAmount = totalAmount + uniqueAdd;

    // Buat order
    orderQueries.create.run({
      order_id: orderId,
      chat_id: String(chatId),
      username: username || '',
      full_name: fullName || '',
      total_amount: totalAmount,
      unique_amount: uniqueAmount,
      status: 'pending',
    });

    // Masukkan item order dan kurangi stok
    for (const item of orderItems) {
      orderQueries.addItem.run(item);
      const result = productQueries.reduceStock.run(item.quantity, item.product_id, item.quantity);
      if (result.changes === 0) {
        throw new Error(`Gagal mengurangi stok untuk "${item.product_name}"`);
      }
    }

    // Kosongkan keranjang
    cartQueries.clearCart.run(String(chatId));

    return { orderId, totalAmount, uniqueAmount, items: orderItems };
  });

  return createOrderTransaction();
}

/**
 * Buat order langsung dari produk (tanpa keranjang)
 * @param {string} orderId - ID order
 * @param {number} chatId - Chat ID pembeli
 * @param {string} username - Username Telegram
 * @param {string} fullName - Nama lengkap
 * @param {number} productId - ID produk
 * @param {number} quantity - Jumlah yang dibeli
 */
function createDirectOrder(orderId, chatId, username, fullName, productId, quantity) {
  const directOrderTransaction = db.transaction(() => {
    const product = productQueries.getById.get(productId);

    if (!product) {
      throw new Error('Produk tidak ditemukan');
    }

    if (!product.is_active) {
      throw new Error('Produk tidak tersedia');
    }

    if (product.stock < quantity) {
      throw new Error(`Stok "${product.name}" tidak cukup. Tersedia: ${product.stock}, diminta: ${quantity}`);
    }

    const totalAmount = product.price * quantity;

    // Generate unique amount (tambah 1-99 rupiah)
    const uniqueAdd = Math.floor(Math.random() * 99) + 1;
    const uniqueAmount = totalAmount + uniqueAdd;

    const orderItem = {
      order_id: orderId,
      product_id: product.id,
      product_name: product.name,
      quantity: quantity,
      price: product.price,
    };

    // Buat order
    orderQueries.create.run({
      order_id: orderId,
      chat_id: String(chatId),
      username: username || '',
      full_name: fullName || '',
      total_amount: totalAmount,
      unique_amount: uniqueAmount,
      status: 'pending',
    });

    // Masukkan item dan kurangi stok
    orderQueries.addItem.run(orderItem);
    const result = productQueries.reduceStock.run(quantity, product.id, quantity);
    if (result.changes === 0) {
      throw new Error(`Gagal mengurangi stok untuk "${product.name}"`);
    }

    return { orderId, totalAmount, uniqueAmount, items: [orderItem], productName: product.name };
  });

  return directOrderTransaction();
}

/**
 * Batalkan order dan kembalikan stok
 */
function cancelOrder(orderId) {
  const cancelTransaction = db.transaction(() => {
    const order = orderQueries.getById.get(orderId);
    if (!order) throw new Error('Order tidak ditemukan');
    if (order.status === 'paid') throw new Error('Order yang sudah dibayar tidak bisa dibatalkan');

    const items = orderQueries.getItems.all(orderId);

    // Kembalikan stok
    for (const item of items) {
      productQueries.updateStock.run(item.quantity, item.product_id);
    }

    // Kembalikan status digital items (unclaim) agar bisa dibeli lagi
    db.prepare('UPDATE digital_items SET order_id = NULL, used_at = NULL WHERE order_id = ?').run(orderId);

    // Update status
    orderQueries.updateStatus.run('cancelled', orderId);

    return order;
  });

  return cancelTransaction();
}

/**
 * Expire pending orders yang sudah lewat waktu
 */
function expireOldOrders() {
  const expireTransaction = db.transaction(() => {
    const expiredOrders = orderQueries.getExpired.all();

    for (const order of expiredOrders) {
      const items = orderQueries.getItems.all(order.order_id);

      // Kembalikan stok
      for (const item of items) {
        productQueries.updateStock.run(item.quantity, item.product_id);
      }

      // Update status
      orderQueries.updateStatus.run('expired', order.order_id);
    }

    return expiredOrders;
  });

  return expireTransaction();
}

/**
 * Hapus produk beserta seluruh riwayat transaksi, keranjang, dan stok terkait
 */
function deleteProductWithHistory(productId) {
  const deleteTransaction = db.transaction(() => {
    // 1. Hapus dari keranjang
    db.prepare('DELETE FROM cart WHERE product_id = ?').run(productId);
    // 2. Hapus dari digital_items
    db.prepare('DELETE FROM digital_items WHERE product_id = ?').run(productId);
    // 3. Hapus dari order_items
    db.prepare('DELETE FROM order_items WHERE product_id = ?').run(productId);
    // 4. Hapus dari products
    db.prepare('DELETE FROM products WHERE id = ?').run(productId);
    // 5. Bersihkan orders yang tidak memiliki items lagi
    db.prepare('DELETE FROM orders WHERE order_id NOT IN (SELECT DISTINCT order_id FROM order_items)').run();
  });

  deleteTransaction();
}

module.exports = {
  db,
  initDatabase,
  productQueries,
  cartQueries,
  orderQueries,
  digitalItemQueries,
  createOrderFromCart,
  createDirectOrder,
  cancelOrder,
  expireOldOrders,
  deleteProductWithHistory,
};
