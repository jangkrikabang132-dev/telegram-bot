const express = require('express');
const { orderQueries } = require('./database');
const { formatRupiah } = require('./utils/formatter');
const { processOrderDelivery } = require('./delivery-service');

let botInstance = null;

/**
 * Set referensi bot Telegram untuk mengirim notifikasi
 */
function setBotInstance(bot) {
  botInstance = bot;
}

/**
 * Middleware: Cek API secret key
 */
function authMiddleware(req, res, next) {
  const apiKey = process.env.API_SECRET_KEY;
  if (!apiKey) {
    // Jika belum diset, terima semua (untuk development)
    return next();
  }

  const providedKey = req.headers['x-api-key'] || req.query.key;
  if (providedKey !== apiKey) {
    return res.status(401).json({ status: 'unauthorized', message: 'API key salah' });
  }
  next();
}

/**
 * Buat Express webhook server
 * Digunakan untuk health check, payment notification, dan API admin
 */
function createWebhookServer() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // ============================================================
  // HEALTH CHECK
  // ============================================================
  app.get('/', (req, res) => {
    res.json({
      status: 'ok',
      bot: 'Bot Telegram Toko Online',
      payment: 'QRIS Dinamis + Auto-Detect',
      timestamp: new Date().toISOString(),
    });
  });

  // ============================================================
  // API: Notifikasi Pembayaran Masuk (dari Android App)
  // ============================================================
  app.post('/api/payment-notify', authMiddleware, async (req, res) => {
    try {
      let { amount, source, message } = req.body;

      if (!amount) {
        return res.status(400).json({
          status: 'error',
          message: 'Parameter "amount" wajib diisi',
        });
      }

      // Bersihkan amount — hapus "Rp", titik, koma, spasi
      if (typeof amount === 'string') {
        amount = parseInt(amount.replace(/[^0-9]/g, ''));
      } else {
        amount = parseInt(amount);
      }

      if (isNaN(amount) || amount <= 0) {
        return res.status(400).json({
          status: 'error',
          message: 'Amount tidak valid',
        });
      }

      // Filter untuk mencegah bypass dari notifikasi push Telegram/chat sendiri
      const lowerMessage = (message || '').toLowerCase();
      const lowerSource = (source || '').toLowerCase();

      if (
        lowerSource.includes('telegram') ||
        lowerSource.includes('whatsapp') ||
        lowerSource.includes('discord') ||
        lowerMessage.includes('invoice') ||
        lowerMessage.includes('pesanan') ||
        lowerMessage.includes('menunggu') ||
        lowerMessage.includes('cara penggunaan') ||
        lowerMessage.includes('qris') ||
        lowerMessage.includes('lunas') ||
        lowerMessage.includes('detail')
      ) {
        console.log(`⚠️  [PAYMENT-NOTIFY] Mengabaikan notifikasi palsu / chat bot: Source = ${source}, Message = ${message}`);
        return res.status(400).json({
          status: 'ignored',
          message: 'Notifikasi diabaikan karena terindikasi berasal dari aplikasi chat atau pesan sistem bot'
        });
      }

      console.log(`💰 [PAYMENT-NOTIFY] Amount masuk: ${formatRupiah(amount)} (source: ${source || 'unknown'})`);

      // Cari order pending dengan unique_amount yang cocok
      const order = orderQueries.getPendingByAmount.get(amount);

      if (!order) {
        console.log(`  ⚠️ Tidak ada order pending dengan nominal ${formatRupiah(amount)}`);
        return res.json({
          status: 'no_match',
          message: `Tidak ada order pending dengan nominal ${formatRupiah(amount)}`,
          amount: amount,
        });
      }

      console.log(`  ✅ Order ${order.order_id} cocok! Memulai pengiriman...`);

      // Pemicu pengiriman produk secara terpadu
      if (botInstance) {
        // Jalankan secara asinkron agar HTTP 200 terkirim ke Android secara instan tanpa menunggu animasi
        processOrderDelivery(botInstance, order.order_id, amount, {
          useAnimation: true
        }).catch(err => console.error('Error during delivery handling:', err));
      } else {
        // Jika botInstance tidak ada (fall back), update status secara manual
        orderQueries.confirmPayment.run(order.order_id);
      }

      res.json({
        status: 'confirmed',
        message: `Order ${order.order_id} berhasil dikonfirmasi`,
        order: {
          orderId: order.order_id,
          totalAmount: order.total_amount,
          uniqueAmount: order.unique_amount,
          buyer: order.full_name || order.username || order.chat_id,
        },
      });

    } catch (error) {
      console.error('❌ Payment notify error:', error);
      res.status(500).json({ status: 'error', message: error.message });
    }
  });

  // ============================================================
  // API: Lihat semua order pending (untuk debugging Android app)
  // ============================================================
  app.get('/api/pending-orders', authMiddleware, (req, res) => {
    const orders = orderQueries.getAllPending.all();
    res.json({
      count: orders.length,
      orders: orders.map(o => ({
        orderId: o.order_id,
        totalAmount: o.total_amount,
        uniqueAmount: o.unique_amount,
        buyer: o.full_name || o.username || o.chat_id,
        createdAt: o.created_at,
      })),
    });
  });

  // ============================================================
  // API: Konfirmasi pembayaran manual (untuk integrasi eksternal)
  // ============================================================
  app.post('/api/confirm-payment/:orderId', authMiddleware, async (req, res) => {
    const { orderId } = req.params;
    const order = orderQueries.getById.get(orderId);

    if (!order) {
      return res.status(404).json({ status: 'not_found', message: 'Order tidak ditemukan' });
    }

    if (order.status !== 'pending') {
      return res.json({ status: 'already_processed', currentStatus: order.status });
    }

    if (botInstance) {
      await processOrderDelivery(botInstance, orderId, order.unique_amount || order.total_amount, {
        useAnimation: false
      });
    } else {
      orderQueries.confirmPayment.run(orderId);
    }

    console.log(`✅ Pembayaran dikonfirmasi via API: ${orderId}`);
    res.json({ status: 'ok', message: 'Pembayaran dikonfirmasi dan produk berhasil dikirim' });
  });

  // ============================================================
  // API: Lihat status order
  // ============================================================
  app.get('/api/order/:orderId', (req, res) => {
    const { orderId } = req.params;
    const order = orderQueries.getById.get(orderId);

    if (!order) {
      return res.status(404).json({ status: 'not_found' });
    }

    const items = orderQueries.getItems.all(orderId);

    res.json({
      orderId: order.order_id,
      status: order.status,
      totalAmount: order.total_amount,
      uniqueAmount: order.unique_amount,
      buyer: {
        chatId: order.chat_id,
        username: order.username,
        fullName: order.full_name,
      },
      items: items.map(i => ({
        name: i.product_name,
        quantity: i.quantity,
        price: i.price,
        subtotal: i.price * i.quantity,
      })),
      createdAt: order.created_at,
    });
  });

  return app;
}

module.exports = { createWebhookServer, setBotInstance };
