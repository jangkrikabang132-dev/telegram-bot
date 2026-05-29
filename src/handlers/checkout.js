const { createDirectOrder, orderQueries, productQueries } = require('../database');
const { generateQRIS } = require('../qris-service');
const { formatRupiah, generateOrderId } = require('../utils/formatter');
const { mainMenuKeyboard } = require('../utils/keyboard');

/**
 * Handler untuk pembayaran langsung via QRIS
 *
 * Flow: Pilih Produk → Atur Qty → Bayar Sekarang → QRIS QR Code
 * Tanpa keranjang, langsung checkout.
 */
function registerCheckoutHandlers(bot) {

  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    // ==================== DIRECT BUY ====================
    // buy_now_{productId}_{qty}
    if (data.startsWith('buy_now_')) {
      const parts = data.replace('buy_now_', '').split('_');
      const productId = parseInt(parts[0]);
      const qty = parseInt(parts[1]);

      if (isNaN(productId) || isNaN(qty) || qty < 1) {
        bot.answerCallbackQuery(query.id, { text: '❌ Data tidak valid', show_alert: true });
        return;
      }

      // Cek produk dulu
      const product = productQueries.getById.get(productId);
      if (!product) {
        bot.answerCallbackQuery(query.id, { text: '❌ Produk tidak ditemukan', show_alert: true });
        return;
      }

      if (product.stock < qty) {
        bot.answerCallbackQuery(query.id, {
          text: `⚠️ Stok tidak cukup! Tersedia: ${product.stock}`,
          show_alert: true,
        });
        return;
      }

      bot.answerCallbackQuery(query.id, { text: '⏳ Membuat QR pembayaran...' });

      try {
        const orderId = generateOrderId();
        const username = query.from.username || '';
        const fullName = [query.from.first_name, query.from.last_name].filter(Boolean).join(' ');

        // Buat order langsung (tanpa keranjang)
        const order = createDirectOrder(orderId, chatId, username, fullName, productId, qty);

        // Generate QRIS dinamis dengan UNIQUE AMOUNT (nominal unik)
        const { qrBuffer } = await generateQRIS(order.uniqueAmount);
        // Susun caption
        let caption =
          `*Invoice Pembayaran QRIS*\n\n` +
          `• ID Order: \`${orderId}\`\n` +
          `• Produk: ${product.name} (x${qty})\n` +
          `• Nominal Bayar: *${formatRupiah(order.uniqueAmount)}*\n\n` +
          `───\n` +
          `*Petunjuk Transfer:*\n` +
          `1. Scan QR Code QRIS ini.\n` +
          `2. Pastikan nominal pembayaran *SAMA PERSIS* yaitu *${formatRupiah(order.uniqueAmount)}* (termasuk kode unik).\n` +
          `3. Pembayaran akan terverifikasi otomatis dalam 5-10 detik.\n\n` +
          `⌛ _Berlaku 30 menit. Pesanan otomatis batal jika belum dibayar._`;

        // Kirim QR code
        const sentMessage = await bot.sendPhoto(chatId, qrBuffer, {
          caption: caption,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔄 Cek Status Pembayaran', callback_data: `check_payment_${orderId}` }],
              [{ text: '📋 Pesanan Saya', callback_data: 'my_orders' }],
              [{ text: '🛍️ Belanja Lagi', callback_data: 'catalog' }],
            ],
          },
        });

        // Update order status dengan menyimpan message ID QRIS di kolom payment_url
        orderQueries.updatePayment.run('QRIS', String(sentMessage.message_id), orderId);

        // Hapus pesan produk sebelumnya
        bot.deleteMessage(chatId, messageId).catch(() => {});

        // Notifikasi admin
        const adminChatId = process.env.ADMIN_CHAT_ID;
        if (adminChatId) {
          bot.sendMessage(adminChatId,
            `*Pesanan Baru Masuk*\n\n` +
            `• ID Order: \`${orderId}\`\n` +
            `• Pembeli: ${fullName || '-'} (@${username || '-'})\n` +
            `• Item: ${product.name} (x${qty})\n` +
            `• Nominal QRIS: *${formatRupiah(order.uniqueAmount)}*\n\n` +
            `Status: Menunggu Pembayaran`,
            {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '📋 Lihat Detail', callback_data: `admin_order_${orderId}` }],
                ],
              },
            }
          ).catch(console.error);
        }

      } catch (error) {
        console.error('Direct buy error:', error);

        bot.editMessageText(
          `❌ *Gagal memproses pembelian*\n\n` +
          `Alasan: ${error.message}\n\n` +
          `Silakan coba lagi beberapa saat lagi.`,
          {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔙 Kembali', callback_data: `prod_${productId}` }],
                [{ text: '🛍️ Katalog', callback_data: 'catalog' }],
              ],
            },
          }
        ).catch(() => {
          bot.sendMessage(chatId,
            `❌ Gagal: ${error.message}\nSilakan coba lagi.`,
            { reply_markup: mainMenuKeyboard() }
          ).catch(() => {});
        });
      }

      return;
    }

    // noop (untuk display qty)
    if (data === 'noop') {
      bot.answerCallbackQuery(query.id);
      return;
    }
  });
}

module.exports = { registerCheckoutHandlers };
