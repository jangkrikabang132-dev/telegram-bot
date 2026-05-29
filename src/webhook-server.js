const express = require('express');
const { orderQueries, productQueries, digitalItemQueries } = require('./database');
const { formatRupiah, statusEmoji } = require('./utils/formatter');

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
  // Android app mengirim nominal yang masuk ke DANA
  // Bot mencocokkan dengan order pending berdasarkan unique_amount
  //
  // POST /api/payment-notify
  // Header: x-api-key: <API_SECRET_KEY>
  // Body: { "amount": 50023 }
  //   atau { "amount": 50023, "source": "DANA", "message": "..." }
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

      // Cocok! Auto-confirm pembayaran
      orderQueries.confirmPayment.run(order.order_id);

      console.log(`  ✅ Order ${order.order_id} auto-confirmed! (${formatRupiah(amount)})`);

      // Kirim notifikasi ke pembeli via Telegram dengan animasi hancur jika ID QRIS tersedia
      if (botInstance) {
        const qrisMessageId = order.payment_url;

        if (qrisMessageId && !isNaN(parseInt(qrisMessageId))) {
          // Jalankan animasi hancur secara asinkron (background) agar HTTP 200 terkirim ke Android secara instan
          runQRISDestruction(botInstance, parseInt(order.chat_id), parseInt(qrisMessageId), () => {
            sendFinalConfirmation(botInstance, order, amount);
          });
        } else {
          // Jika tidak ada pesan QRIS (misal link manual), langsung kirim pesan sukses
          sendFinalConfirmation(botInstance, order, amount);
        }
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

    // Update status ke paid
    orderQueries.confirmPayment.run(orderId);

    // Kirim notifikasi ke pembeli via Telegram
    if (botInstance) {
      const items = orderQueries.getItems.all(orderId);
      const itemList = items.map(i =>
        `  • ${i.product_name} x${i.quantity} — ${formatRupiah(i.price * i.quantity)}`
      ).join('\n');

      await botInstance.sendMessage(order.chat_id,
        `🎉 Pembayaran Dikonfirmasi!\n\n` +
        `📋 Order: ${orderId}\n` +
        `💰 Total: ${formatRupiah(order.total_amount)}\n\n` +
        `📦 Item:\n${itemList}\n\n` +
        `Terima kasih sudah berbelanja! 🙏`
      ).catch(console.error);
    }

    console.log(`✅ Pembayaran dikonfirmasi via API: ${orderId}`);
    res.json({ status: 'ok', message: 'Pembayaran dikonfirmasi' });
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

/**
 * Simulasi animasi kehancuran QRIS di chat Telegram (hitunng mundur)
 * kemudian menghapusnya dari chat untuk keamanan dan efek visual premium.
 */
function runQRISDestruction(bot, chatId, messageId, onComplete) {
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  
  (async () => {
    try {
      // Frame 1: Menghancurkan dalam 3
      await bot.editMessageCaption(
        `⚠️ PEMBAYARAN TERDETEKSI! ⚠️\n\n💥 Menghancurkan QRIS dalam 3...`,
        { chat_id: chatId, message_id: messageId }
      ).catch(() => {});
      await delay(800);
      
      // Frame 2: Menghancurkan dalam 2
      await bot.editMessageCaption(
        `⚠️ PEMBAYARAN TERDETEKSI! ⚠️\n\n💥 Menghancurkan QRIS dalam 2...`,
        { chat_id: chatId, message_id: messageId }
      ).catch(() => {});
      await delay(800);
      
      // Frame 3: Menghancurkan dalam 1
      await bot.editMessageCaption(
        `⚠️ PEMBAYARAN TERDETEKSI! ⚠️\n\n💥 Menghancurkan QRIS dalam 1...`,
        { chat_id: chatId, message_id: messageId }
      ).catch(() => {});
      await delay(800);
      
      // Frame 4: Meledak / Hancur
      await bot.editMessageCaption(
        `💥 BOOMM! QRIS TELAH HANCUR LEBUR! 💥\n\n💨 Menghapus bukti pembayaran usang...`,
        { chat_id: chatId, message_id: messageId }
      ).catch(() => {});
      await delay(800);
      
      // Hapus pesan foto QRIS asli
      await bot.deleteMessage(chatId, messageId).catch(() => {});
    } catch (e) {
      console.error('QRIS Destruction Animation error:', e);
    } finally {
      // Panggil callback untuk memicu pesan sukses final
      onComplete();
    }
  })();
}

/**
 * Mengirimkan pesan sukses final dan stiker/celebration ke pembeli & admin
 */
async function sendFinalConfirmation(bot, order, amount) {
  try {
    const items = orderQueries.getItems.all(order.order_id);
    const itemList = items.map(i =>
      `  • ${i.product_name} x${i.quantity} — ${formatRupiah(i.price * i.quantity)}`
    ).join('\n');

    // Ambil dan klaim produk digital jika ada di database
    let digitalItemsText = '';
    const claimedDigitalItems = [];

    for (const item of items) {
      // Dapatkan akun yang belum terpakai sebanyak quantity pesanan
      const unusedAccounts = digitalItemQueries.getUnused.all(item.product_id, item.quantity);
      
      if (unusedAccounts.length > 0) {
        for (const account of unusedAccounts) {
          // Tandai akun telah digunakan oleh order ini
          digitalItemQueries.claim.run(order.order_id, account.id);
          claimedDigitalItems.push({
            productName: item.product_name,
            content: account.content
          });
        }
      }
    }

    // Format tampilan produk digital untuk dikirim ke pembeli
    if (claimedDigitalItems.length > 0) {
      digitalItemsText = `\n🔑 *DETAIL AKUN PRODUK ANDA:* 🔑\n` +
        `━━━━━━━━━━━━━━━━━━\n`;
      
      claimedDigitalItems.forEach((acc, idx) => {
        const parts = acc.content.split(':');
        if (parts.length >= 2) {
          const username = parts[0].trim();
          const password = parts.slice(1).join(':').trim(); // Menangani password yang mungkin mengandung titik dua (:)
          
          digitalItemsText += `📂 *Akun ${idx + 1} (${acc.productName}):*\n` +
            `👤 *Username/Email:* \`${username}\`\n` +
            `🔑 *Password:* \`${password}\`\n` +
            `----------------------------------\n`;
        } else {
          // Jika format bukan username:password (misal voucher/lisensi biasa)
          digitalItemsText += `📂 *Item ${idx + 1} (${acc.productName}):*\n` +
            `📝 *Detail:* \`${acc.content}\`\n` +
            `----------------------------------\n`;
        }
      });
      digitalItemsText += `*Tips:* Ketuk/klik tulisan abu-abu di atas untuk menyalin Username atau Password secara otomatis! 📋\n\n`;
    }

    // Kirim notifikasi sukses pembeli
    await bot.sendMessage(parseInt(order.chat_id),
      `🎉 PEMBAYARAN DITERIMA & DIKONFIRMASI! 🎉\n\n` +
      `📋 Order ID: ${order.order_id}\n` +
      `💰 Total Belanja: ${formatRupiah(order.total_amount)}\n` +
      `💲 Nominal Dibayar: ${formatRupiah(amount)}\n\n` +
      `📦 Detail Pesanan:\n${itemList}\n` +
      digitalItemsText +
      `✅ Status: Sukses Terverifikasi Otomatis.\n` +
      `Terima kasih telah berbelanja! Pembelian Anda sudah otomatis terkonfirmasi. 🙏`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📋 Pesanan Saya', callback_data: 'my_orders' }],
            [{ text: '🛍️ Belanja Lagi', callback_data: 'catalog' }],
          ],
        },
      }
    ).catch(console.error);

    // Kirim notifikasi sukses admin
    const adminChatId = process.env.ADMIN_CHAT_ID;
    if (adminChatId) {
      let adminDigitalDetails = '';
      if (claimedDigitalItems.length > 0) {
        adminDigitalDetails = `\n🔑 *Detail Akun Terkirim:* \n` +
          claimedDigitalItems.map(a => `• ${a.productName}: \`${a.content}\``).join('\n') + `\n`;
      }

      bot.sendMessage(parseInt(adminChatId),
        `💰 Pembayaran Masuk — AUTO-CONFIRMED! 💰\n\n` +
        `📋 Order ID: ${order.order_id}\n` +
        `👤 Pembeli: ${order.full_name || '-'} (@${order.username || '-'})\n` +
        `💰 Total: ${formatRupiah(order.total_amount)}\n` +
        `💲 Nominal Masuk: ${formatRupiah(amount)}\n` +
        `📱 Metode: QRIS (DANA Auto-Detect)\n\n` +
        `📦 Detail Item:\n${itemList}\n` +
        adminDigitalDetails +
        `\n✅ Status: LUNAS / SELESAI`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📋 Lihat Detail', callback_data: `admin_order_${order.order_id}` }],
            ],
          },
        }
      ).catch(console.error);
    }
  } catch (error) {
    console.error('Error sending final confirmation:', error);
  }
}

module.exports = { createWebhookServer, setBotInstance };
