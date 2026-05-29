const { orderQueries } = require('./database');
const { formatRupiah } = require('./utils/formatter');

/**
 * Payment Checker — Auto-confirm pembayaran QRIS
 *
 * Flow:
 * 1. User scan & bayar QRIS
 * 2. User tekan tombol "✅ Sudah Bayar"
 * 3. Bot auto-confirm → status jadi "paid"
 * 4. Notifikasi ke pembeli & admin
 */

function registerPaymentChecker(bot) {

  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    // ==================== SUDAH BAYAR ====================
    if (data.startsWith('confirm_self_paid_')) {
      const orderId = data.replace('confirm_self_paid_', '');

      const order = orderQueries.getById.get(orderId);

      if (!order) {
        bot.answerCallbackQuery(query.id, {
          text: '❌ Order tidak ditemukan',
          show_alert: true,
        });
        return;
      }

      // Cek apakah order masih pending
      if (order.status !== 'pending') {
        const statusMsg = order.status === 'paid'
          ? '✅ Pembayaran sudah dikonfirmasi sebelumnya!'
          : `ℹ️ Status order: ${order.status}`;

        bot.answerCallbackQuery(query.id, {
          text: statusMsg,
          show_alert: true,
        });
        return;
      }

      // Cek apakah order milik user ini
      if (String(order.chat_id) !== String(chatId)) {
        bot.answerCallbackQuery(query.id, {
          text: '❌ Order ini bukan milik Anda',
          show_alert: true,
        });
        return;
      }

      // Auto-confirm pembayaran
      orderQueries.confirmPayment.run(orderId);

      bot.answerCallbackQuery(query.id, {
        text: '✅ Pembayaran dikonfirmasi!',
      });

      // Kirim notifikasi ke pembeli
      const items = orderQueries.getItems.all(orderId);
      const itemList = items.map(i =>
        `  • ${i.product_name} x${i.quantity} — ${formatRupiah(i.price * i.quantity)}`
      ).join('\n');

      // Update pesan QRIS lama
      try {
        await bot.editMessageCaption(
          `✅ Pembayaran Dikonfirmasi!\n\n` +
          `📋 Order: ${orderId}\n` +
          `💰 Total: ${formatRupiah(order.unique_amount || order.total_amount)}\n\n` +
          `📦 Item:\n${itemList}\n\n` +
          `Terima kasih sudah berbelanja! 🙏`,
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
              inline_keyboard: [
                [{ text: '📋 Pesanan Saya', callback_data: 'my_orders' }],
                [{ text: '🛍️ Belanja Lagi', callback_data: 'catalog' }],
              ],
            },
          }
        );
      } catch (e) {
        // Jika gagal edit caption (misal sudah dihapus), kirim pesan baru
        await bot.sendMessage(chatId,
          `✅ Pembayaran Dikonfirmasi!\n\n` +
          `📋 Order: ${orderId}\n` +
          `💰 Total: ${formatRupiah(order.unique_amount || order.total_amount)}\n\n` +
          `📦 Item:\n${itemList}\n\n` +
          `Terima kasih sudah berbelanja! 🙏`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '📋 Pesanan Saya', callback_data: 'my_orders' }],
                [{ text: '🛍️ Belanja Lagi', callback_data: 'catalog' }],
              ],
            },
          }
        ).catch(console.error);
      }

      // Kirim notifikasi ke admin
      const adminChatId = process.env.ADMIN_CHAT_ID;
      if (adminChatId) {
        const fullName = order.full_name || '-';
        const username = order.username || '-';

        bot.sendMessage(adminChatId,
          `💰 Pembayaran Masuk (Auto-Confirm)\n\n` +
          `📋 Order: ${orderId}\n` +
          `👤 Dari: ${fullName} (@${username})\n` +
          `💰 Total: ${formatRupiah(order.total_amount)}\n` +
          `💲 Nominal QRIS: ${formatRupiah(order.unique_amount || order.total_amount)}\n\n` +
          `📦 Item:\n${itemList}\n\n` +
          `✅ Status: DIBAYAR (auto-confirm oleh pembeli)`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '📋 Lihat Detail', callback_data: `admin_order_${orderId}` }],
                [{ text: '📋 Semua Pesanan', callback_data: 'admin_orders' }],
              ],
            },
          }
        ).catch(console.error);
      }

      console.log(`✅ Auto-confirm pembayaran: ${orderId} oleh ${chatId}`);
      return;
    }

    // ==================== CEK STATUS PEMBAYARAN ====================
    if (data.startsWith('check_payment_')) {
      const orderId = data.replace('check_payment_', '');
      const order = orderQueries.getById.get(orderId);

      if (!order) {
        bot.answerCallbackQuery(query.id, { text: '❌ Order tidak ditemukan', show_alert: true });
        return;
      }

      if (order.status === 'paid') {
        bot.answerCallbackQuery(query.id, { text: '✅ Pembayaran sudah dikonfirmasi!', show_alert: true });
      } else if (order.status === 'pending') {
        bot.answerCallbackQuery(query.id, { text: '⏳ Menunggu pembayaran...', show_alert: true });
      } else {
        bot.answerCallbackQuery(query.id, { text: `ℹ️ Status: ${order.status}`, show_alert: true });
      }
      return;
    }
  });
}

module.exports = { registerPaymentChecker };
