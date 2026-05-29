const { mainMenuKeyboard, replyMenuKeyboard } = require('../utils/keyboard');
const { productQueries, orderQueries } = require('../database');
const { formatRupiah, statusEmoji, statusLabel } = require('../utils/formatter');

/**
 * Handler untuk /start, /help, dan reply keyboard menu bawah
 */
function registerStartHandlers(bot) {

  // /start — kirim pesan sambutan + pasang reply keyboard di bawah chat
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const name = msg.from.first_name || 'Kak';

    console.log(`📩 /start dari ${name} (${chatId})`);

    bot.sendMessage(chatId,
      `Halo ${name}! 👋\n\n` +
      `Selamat datang di Toko Online kami! 🛍️\n\n` +
      `Di sini kamu bisa:\n` +
      `📁 Lihat dan beli produk\n` +
      `📱 Bayar langsung via QRIS\n` +
      `📋 Cek status pesanan\n\n` +
      `Gunakan menu di bawah untuk navigasi 👇`,
      {
        reply_markup: replyMenuKeyboard(),
      }
    ).then(() => {
      console.log(`✅ Pesan /start terkirim ke ${chatId}`);
    }).catch((err) => {
      console.error(`❌ Gagal kirim /start ke ${chatId}:`, err.message);
    });
  });

  // /help
  bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    console.log(`📩 /help dari ${chatId}`);

    bot.sendMessage(chatId,
      `📖 Panduan Penggunaan Bot\n\n` +
      `Perintah Tersedia:\n` +
      `/start — Mulai & Menu Utama\n` +
      `/katalog — Lihat daftar produk\n` +
      `/pesanan — Riwayat pesanan kamu\n` +
      `/help — Tampilkan bantuan ini\n\n` +
      `Cara Berbelanja:\n` +
      `1️⃣ Tekan "📁 List Produk"\n` +
      `2️⃣ Pilih produk yang diinginkan\n` +
      `3️⃣ Atur jumlah dengan ➕ dan ➖\n` +
      `4️⃣ Tekan "💳 Bayar [Total]"\n` +
      `5️⃣ Scan QR Code QRIS yang dikirim bot\n` +
      `6️⃣ Bayar pakai e-wallet / m-banking\n` +
      `7️⃣ Pembayaran otomatis terkonfirmasi ✅\n\n` +
      `Ada masalah? Hubungi admin kami.`,
      {
        reply_markup: replyMenuKeyboard(),
      }
    ).catch((err) => {
      console.error(`❌ Gagal kirim /help:`, err.message);
    });
  });

  // ============================================================
  // REPLY KEYBOARD HANDLERS (menu bawah chat)
  // ============================================================

  // 📁 List Produk
  bot.onText(/^📁 List Produk$/, (msg) => {
    const chatId = msg.chat.id;
    const products = productQueries.getAll.all();

    if (products.length === 0) {
      bot.sendMessage(chatId,
        '😕 Belum ada produk tersedia saat ini.\nSilakan cek kembali nanti!'
      ).catch(() => {});
      return;
    }

    let text = '🛍️ LIST PRODUK\n\n';
    products.forEach((p, i) => {
      const stockIcon = p.stock <= 0 ? '🔴' : p.stock <= 5 ? '🟡' : '🟢';
      text += `[${i + 1}]. ${p.name} ( ${p.stock} )\n`;
    });

    text += `\n📄 Halaman 1 / 1`;

    // Buat inline keyboard untuk pilih produk
    const buttons = [];
    const row = [];
    products.forEach((p, i) => {
      row.push({ text: `${i + 1}`, callback_data: `prod_${p.id}` });
      if (row.length === 6 || i === products.length - 1) {
        buttons.push([...row]);
        row.length = 0;
      }
    });

    bot.sendMessage(chatId, text, {
      reply_markup: { inline_keyboard: buttons },
    }).catch(() => {});
  });

  // 📋 Pesanan
  bot.onText(/^📋 Pesanan$/, (msg) => {
    const chatId = msg.chat.id;
    const orders = orderQueries.getByChat.all(String(chatId));

    if (orders.length === 0) {
      bot.sendMessage(chatId,
        '📋 Belum ada pesanan.\n\nMulai belanja sekarang!',
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🛍️ Lihat Produk', callback_data: 'catalog' }],
            ],
          },
        }
      ).catch(() => {});
      return;
    }

    let text = '📋 Pesanan Kamu\n\n';
    for (const order of orders) {
      const emoji = statusEmoji(order.status);
      const label = statusLabel(order.status);
      text += `${emoji} ${order.order_id}\n`;
      text += `   💰 ${formatRupiah(order.total_amount)} — ${label}\n\n`;
    }

    bot.sendMessage(chatId, text).catch(() => {});
  });

  // 📱 Cara Order
  bot.onText(/^📱 Cara Order$/, (msg) => {
    const chatId = msg.chat.id;

    bot.sendMessage(chatId,
      `📱 Cara Order\n\n` +
      `1️⃣ Tekan "📁 List Produk" untuk lihat katalog\n` +
      `2️⃣ Pilih produk yang kamu mau\n` +
      `3️⃣ Atur jumlah dengan tombol ➕ dan ➖\n` +
      `4️⃣ Tekan "💳 Bayar [Total]"\n` +
      `5️⃣ Bot mengirim QR Code QRIS\n` +
      `6️⃣ Scan QR pakai e-wallet (GoPay, OVO, DANA, ShopeePay, dll) atau m-banking\n` +
      `7️⃣ Pembayaran otomatis terkonfirmasi ✅\n\n` +
      `⏰ Batas pembayaran: 30 menit\n` +
      `📌 Jika lewat, order otomatis dibatalkan & stok dikembalikan.`
    ).catch(() => {});
  });

  // ℹ️ Informasi
  bot.onText(/^ℹ️ Informasi$/, (msg) => {
    const chatId = msg.chat.id;

    const products = productQueries.getAll.all();
    const totalProducts = products.length;
    const totalStock = products.reduce((sum, p) => sum + p.stock, 0);

    bot.sendMessage(chatId,
      `ℹ️ Informasi Toko\n\n` +
      `🏪 Toko Online Bot\n` +
      `📦 Total Produk: ${totalProducts}\n` +
      `📊 Total Stok: ${totalStock}\n` +
      `💳 Pembayaran: QRIS (semua e-wallet & m-banking)\n\n` +
      `📞 Butuh bantuan? Hubungi admin.\n` +
      `⏰ Respon admin: 09:00 - 22:00 WIB`
    ).catch(() => {});
  });

  // ============================================================
  // INLINE CALLBACK HANDLERS
  // ============================================================

  bot.on('callback_query', (query) => {
    if (query.data === 'main_menu') {
      const name = query.from.first_name || 'Kak';
      bot.editMessageText(
        `Halo ${name}! 👋\n\nPilih menu di bawah:`,
        {
          chat_id: query.message.chat.id,
          message_id: query.message.message_id,
          reply_markup: mainMenuKeyboard(),
        }
      ).catch(() => {
        bot.sendMessage(query.message.chat.id,
          `Pilih menu di bawah:`,
          { reply_markup: mainMenuKeyboard() }
        );
      });
      bot.answerCallbackQuery(query.id);
    }

    if (query.data === 'help') {
      bot.answerCallbackQuery(query.id);
      bot.sendMessage(query.message.chat.id,
        `📖 Cara Belanja:\n` +
        `1️⃣ Pilih produk dari "📁 List Produk"\n` +
        `2️⃣ Atur jumlah lalu "💳 Bayar"\n` +
        `3️⃣ Scan QR Code QRIS\n` +
        `4️⃣ Pembayaran otomatis terkonfirmasi ✅`
      ).catch(() => {});
    }
  });
}

module.exports = { registerStartHandlers };
