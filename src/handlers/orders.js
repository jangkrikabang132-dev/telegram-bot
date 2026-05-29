const { orderQueries } = require('../database');
const { formatRupiah, formatDate, statusEmoji, statusLabel } = require('../utils/formatter');
const { mainMenuKeyboard } = require('../utils/keyboard');

/**
 * Handler untuk riwayat pesanan pembeli
 */
function registerOrderHandlers(bot) {

  // /pesanan command
  bot.onText(/\/pesanan/, (msg) => {
    showOrders(bot, msg.chat.id);
  });

  bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    // Tampilkan daftar pesanan
    if (data === 'my_orders') {
      bot.answerCallbackQuery(query.id);
      showOrders(bot, chatId, messageId);
      return;
    }

    // Tampilkan detail pesanan
    if (data.startsWith('order_detail_')) {
      bot.answerCallbackQuery(query.id);
      const orderId = data.replace('order_detail_', '');
      showOrderDetail(bot, chatId, messageId, orderId);
      return;
    }

    // Batalkan pesanan
    if (data.startsWith('order_cancel_')) {
      bot.answerCallbackQuery(query.id);
      const orderId = data.replace('order_cancel_', '');
      confirmCancelOrder(bot, chatId, messageId, orderId);
      return;
    }

    // Konfirmasi batal
    if (data.startsWith('order_cancel_yes_')) {
      const orderId = data.replace('order_cancel_yes_', '');
      cancelOrderHandler(bot, query, chatId, messageId, orderId);
      return;
    }
  });
}

/**
 * Tampilkan daftar pesanan pembeli
 */
function showOrders(bot, chatId, messageId) {
  const orders = orderQueries.getByChat.all(String(chatId));

  if (orders.length === 0) {
    const text = '📋 Pesanan Saya\n\nBelum ada pesanan.\nYuk mulai belanja! 🛍️';
    if (messageId) {
      bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: [
            [{ text: '🛍️ Lihat Produk', callback_data: 'catalog' }],
            [{ text: '🔙 Menu Utama', callback_data: 'main_menu' }],
          ],
        },
      }).catch(() => bot.sendMessage(chatId, text, { reply_markup: mainMenuKeyboard() }).catch(() => {}));
    } else {
      bot.sendMessage(chatId, text, { reply_markup: mainMenuKeyboard() }).catch(() => {});
    }
    return;
  }

  let text = '📋 Pesanan Saya\n\n';

  const buttons = [];
  for (const order of orders) {
    const emoji = statusEmoji(order.status);
    const label = statusLabel(order.status);
    text += `${emoji} ${order.order_id}\n`;
    text += `   💰 ${formatRupiah(order.total_amount)} — ${label}\n`;
    text += `   📅 ${formatDate(order.created_at)}\n\n`;

    buttons.push([{
      text: `${emoji} ${order.order_id} — ${formatRupiah(order.total_amount)}`,
      callback_data: `order_detail_${order.order_id}`,
    }]);
  }

  buttons.push([{ text: '🔙 Menu Utama', callback_data: 'main_menu' }]);

  if (messageId) {
    bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: buttons },
    }).catch(() => {
      bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: buttons } }).catch(() => {});
    });
  } else {
    bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: buttons } }).catch(() => {});
  }
}

/**
 * Tampilkan detail pesanan
 */
function showOrderDetail(bot, chatId, messageId, orderId) {
  const order = orderQueries.getById.get(orderId);

  if (!order) {
    bot.editMessageText('❌ Pesanan tidak ditemukan.', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'my_orders' }]] },
    }).catch(() => {});
    return;
  }

  const items = orderQueries.getItems.all(orderId);
  const emoji = statusEmoji(order.status);
  const label = statusLabel(order.status);

  let text = `📋 Detail Pesanan\n\n`;
  text += `🆔 Order: ${orderId}\n`;
  text += `${emoji} Status: ${label}\n`;
  text += `📅 Tanggal: ${formatDate(order.created_at)}\n\n`;
  text += `📦 Item:\n`;

  for (const item of items) {
    text += `  • ${item.product_name} x${item.quantity} — ${formatRupiah(item.price * item.quantity)}\n`;
  }

  text += `\n━━━━━━━━━━━━━━━━━━\n`;
  text += `💰 Total: ${formatRupiah(order.total_amount)}`;

  if (order.dana_reference) {
    text += `\n💳 Ref DANA: ${order.dana_reference}`;
  }

  const buttons = [];

  // Tombol bayar jika pending dan ada payment URL
  if (order.status === 'pending' && order.payment_url) {
    buttons.push([{ text: '💳 Bayar Sekarang', url: order.payment_url }]);
    buttons.push([{ text: '❌ Batalkan Pesanan', callback_data: `order_cancel_${orderId}` }]);
  }

  buttons.push([{ text: '🔙 Kembali', callback_data: 'my_orders' }]);

  bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: buttons },
  }).catch(() => {
    bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: buttons } }).catch(() => {});
  });
}

/**
 * Konfirmasi pembatalan pesanan
 */
function confirmCancelOrder(bot, chatId, messageId, orderId) {
  bot.editMessageText(
    `⚠️ Yakin ingin membatalkan pesanan ${orderId}?\nStok akan dikembalikan.`,
    {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Ya, Batalkan', callback_data: `order_cancel_yes_${orderId}` },
            { text: '❌ Tidak', callback_data: `order_detail_${orderId}` },
          ],
        ],
      },
    }
  ).catch(() => {});
}

/**
 * Proses pembatalan pesanan
 */
function cancelOrderHandler(bot, query, chatId, messageId, orderId) {
  try {
    const { cancelOrder } = require('../database');
    cancelOrder(orderId);
    bot.answerCallbackQuery(query.id, { text: '✅ Pesanan dibatalkan, stok dikembalikan' });
    showOrders(bot, chatId, messageId);
  } catch (error) {
    bot.answerCallbackQuery(query.id, { text: `❌ ${error.message}`, show_alert: true });
  }
}

module.exports = { registerOrderHandlers };
