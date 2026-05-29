const { mainMenuKeyboard, replyMenuKeyboard } = require('../utils/keyboard');
const { productQueries, orderQueries } = require('../database');
const { formatRupiah, formatDate, statusEmoji, statusLabel } = require('../utils/formatter');

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
      `*Selamat Datang di Toko Digital*\n\n` +
      `Halo *${name}*! 👋\n\n` +
      `Kami menyediakan berbagai produk digital berkualitas tinggi dengan pengiriman instan secara otomatis.\n\n` +
      `Layanan Kami:\n` +
      `• Lihat & beli katalog produk\n` +
      `• Pembayaran otomatis via QRIS\n` +
      `• Cek riwayat status pesanan\n\n` +
      `Silakan gunakan menu di bawah untuk bernavigasi.`,
      {
        parse_mode: 'Markdown',
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
      `*Panduan Penggunaan Bot*\n\n` +
      `Perintah Tersedia:\n` +
      `• /start — Kembali ke menu utama\n` +
      `• /katalog — Lihat daftar produk\n` +
      `• /pesanan — Riwayat pesanan Anda\n` +
      `• /help — Tampilkan bantuan ini\n\n` +
      `Cara Berbelanja:\n` +
      `1. Tekan tombol *List Produk*\n` +
      `2. Pilih produk yang ingin Anda beli\n` +
      `3. Tentukan jumlah dengan tombol ➕ dan ➖\n` +
      `4. Tekan *Bayar*\n` +
      `5. Scan QRIS yang dikirimkan bot\n` +
      `6. Transfer dengan nominal yang tepat\n` +
      `7. Pembayaran Anda akan diverifikasi otomatis!\n\n` +
      `💬 *Layanan Pengaduan & Komplain Kendala:*\n` +
      `Hubungi Telegram: @Naufal_090`,
      {
        parse_mode: 'Markdown',
        reply_markup: replyMenuKeyboard(),
      }
    ).catch((err) => {
      console.error(`❌ Gagal kirim /help:`, err.message);
    });
  });

  // ============================================================
  // REPLY KEYBOARD HANDLERS (menu bawah chat)
  // ============================================================

  // 📁 Katalog Produk
  bot.onText(/^📁 Katalog Produk$/, (msg) => {
    const chatId = msg.chat.id;
    const products = productQueries.getAll.all();

    if (products.length === 0) {
      bot.sendMessage(chatId,
        'Belum ada produk tersedia saat ini. Silakan cek kembali nanti!',
        { parse_mode: 'Markdown' }
      ).catch(() => {});
      return;
    }

    let text =
      `*Katalog Produk Tersedia*\n\n` +
      `Silakan pilih produk dengan menekan nomor tombol di bawah:\n\n`;

    products.forEach((p, i) => {
      const stockIcon = p.stock <= 0 ? '🔴' : p.stock <= 5 ? '🟡' : '🟢';
      const stockText = p.stock <= 0 ? 'Habis' : `${p.stock} pcs`;
      text += `${stockIcon} *[ ${i + 1} ]* ${p.name}\n` +
              `   Harga: *${formatRupiah(p.price)}* | Stok: *${stockText}*\n\n`;
    });

    text += `📄 Halaman 1 dari 1`;

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
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons },
    }).catch(() => {});
  });

  // 📦 Pesanan Saya
  bot.onText(/^📦 Pesanan Saya$/, (msg) => {
    const chatId = msg.chat.id;
    const orders = orderQueries.getByChat.all(String(chatId));

    if (orders.length === 0) {
      bot.sendMessage(chatId,
        'Belum ada riwayat pesanan. Yuk mulai belanja sekarang!',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🛍️ Lihat Produk', callback_data: 'catalog' }],
            ],
          },
        }
      ).catch(() => {});
      return;
    }

    let text =
      `*Pesanan Saya*\n\n` +
      `Berikut adalah riwayat transaksi belanja Anda:\n\n`;

    const buttons = [];
    for (const order of orders) {
      const emoji = statusEmoji(order.status);
      const label = statusLabel(order.status);
      text += `${emoji} *ID Order:* \`${order.order_id}\`\n` +
              `   Total: *${formatRupiah(order.total_amount)}* — _${label}_\n` +
              `   Tanggal: ${formatDate(order.created_at)}\n\n`;

      buttons.push([{
        text: `${emoji} Detail: ${order.order_id}`,
        callback_data: `order_detail_${order.order_id}`,
      }]);
    }

    text += `💡 *Tips:* Klik salah satu tombol di bawah untuk melihat rincian item atau credentials produk Anda!`;

    buttons.push([{ text: '🛍️ Belanja Lagi', callback_data: 'catalog' }]);

    bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons },
    }).catch(() => {});
  });

  // 📱 Cara Belanja
  bot.onText(/^📱 Cara Belanja$/, (msg) => {
    const chatId = msg.chat.id;

    bot.sendMessage(chatId,
      `*Panduan Cara Berbelanja*\n\n` +
      `1. Tekan tombol *Katalog Produk* untuk membuka katalog.\n` +
      `2. Pilih produk digital yang ingin Anda beli.\n` +
      `3. Atur jumlah pembelian dengan tombol ➕ dan ➖.\n` +
      `4. Tekan tombol *Bayar*.\n` +
      `5. Bot akan mengirimkan gambar QRIS dinamis.\n` +
      `6. Scan QR menggunakan E-Wallet atau M-Banking Anda.\n` +
      `7. Kirim pembayaran sesuai nominal (termasuk kode unik).\n` +
      `8. Sistem akan memverifikasi lunas dalam beberapa detik dan detail produk langsung terkirim otomatis!\n\n` +
      `⌛ *Batas Waktu Pembayaran:* 30 Menit.\n` +
      `💡 _Catatan: Jika melewati batas waktu, pesanan otomatis kedaluwarsa & stok dikembalikan ke sistem._`,
      {
        parse_mode: 'Markdown',
      }
    ).catch(() => {});
  });

  // ℹ️ Informasi Toko
  bot.onText(/^ℹ️ Informasi Toko$/, (msg) => {
    const chatId = msg.chat.id;

    const products = productQueries.getAll.all();
    const totalProducts = products.length;
    const totalStock = products.reduce((sum, p) => sum + p.stock, 0);

    bot.sendMessage(chatId,
      `*Informasi Layanan Toko*\n\n` +
      `• Status Toko: Aktif & Auto-Delivery\n` +
      `• Varian Produk: *${totalProducts}* kategori\n` +
      `• Total Stok Digital: *${totalStock}* unit\n` +
      `• Metode Pembayaran: QRIS Dinamis (Auto-Detect)\n\n` +
      `💬 *Layanan Bantuan Admin:*\n` +
      `• Hubungi: @Naufal_090\n` +
      `• Operasional: 24 Jam (Komplain & Kendala)\n\n` +
      `Terima kasih telah berbelanja di toko kami!`,
      {
        parse_mode: 'Markdown',
      }
    ).catch(() => {});
  });

  // ============================================================
  // INLINE CALLBACK HANDLERS
  // ============================================================

  bot.on('callback_query', (query) => {
    if (query.data === 'main_menu') {
      const name = query.from.first_name || 'Kak';
      const text =
        `*Menu Utama Toko Digital*\n\n` +
        `Halo *${name}*! 👋\n` +
        `Silakan pilih menu transaksi Anda di bawah ini:`;

      bot.editMessageText(text, {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard(),
      }).catch(() => {
        bot.sendMessage(query.message.chat.id, text, {
          parse_mode: 'Markdown',
          reply_markup: mainMenuKeyboard(),
        });
      });
      bot.answerCallbackQuery(query.id);
    }

    if (query.data === 'help') {
      bot.answerCallbackQuery(query.id);
      bot.sendMessage(query.message.chat.id,
        `*Panduan Ringkas Belanja*\n\n` +
        `1. Pilih produk dari tombol *List Produk*.\n` +
        `2. Atur jumlah belanja lalu tekan *Bayar*.\n` +
        `3. Scan QRIS dan bayar sesuai nominal unik.\n` +
        `4. Detail pesanan langsung dikirim otomatis!\n\n` +
        `💬 *Komplain & Kendala:* Hubungi Telegram @Naufal_090`,
        {
          parse_mode: 'Markdown',
        }
      ).catch(() => {});
    }
  });
}

module.exports = { registerStartHandlers };
