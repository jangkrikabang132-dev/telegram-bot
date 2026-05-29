const { orderQueries } = require('./database');
const { formatRupiah } = require('./utils/formatter');
const { processOrderDelivery } = require('./delivery-service');

/**
 * Payment Checker — Auto-confirm pembayaran QRIS
 *
 * Flow:
 * 1. User scan & bayar QRIS
 * 2. User tekan tombol "🔄 Cek Status Pembayaran" atau trigger konfirmasi manual
 * 3. Bot auto-confirm / verifikasi
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

      bot.answerCallbackQuery(query.id, {
        text: '⏳ Memproses pembayaran...',
      });

      // Panggil delivery service terpadu
      await processOrderDelivery(bot, orderId, order.unique_amount || order.total_amount, {
        qrisMessageId: messageId,
        useAnimation: true,
      });

      console.log(`✅ Auto-confirm pembayaran & delivery: ${orderId} oleh user ${chatId}`);
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

      if (order.status === 'paid' || order.status === 'confirmed') {
        bot.answerCallbackQuery(query.id, {
          text: '✅ Pembayaran SUDAH terverifikasi & lunas! Detail pesanan Anda telah dikirim.',
          show_alert: true,
        });
      } else if (order.status === 'pending') {
        bot.answerCallbackQuery(query.id, {
          text: '⏳ Pembayaran BELUM terdeteksi oleh sistem. Pastikan Anda sudah transfer ke QRIS dengan nominal yang tepat.',
          show_alert: true,
        });
      } else {
        bot.answerCallbackQuery(query.id, {
          text: `ℹ️ Status pesanan Anda saat ini: ${order.status.toUpperCase()}`,
          show_alert: true,
        });
      }
      return;
    }
  });
}

module.exports = { registerPaymentChecker };
