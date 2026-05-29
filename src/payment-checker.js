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

    // ==================== SUDAH BAYAR (LEGACY) ====================
    if (data.startsWith('confirm_self_paid_')) {
      bot.answerCallbackQuery(query.id, {
        text: '⚠️ Fitur konfirmasi mandiri dinonaktifkan demi keamanan. Pembayaran Anda akan diverifikasi otomatis oleh sistem. Silakan klik tombol "Cek Status Pembayaran" untuk mengecek status terbaru.',
        show_alert: true,
      });
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
