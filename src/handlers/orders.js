const { orderQueries, digitalItemQueries } = require('../database');
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
    const text =
      `*Riwayat Pesanan*\n\n` +
      `Belum ada riwayat pesanan di akun Anda.\n\n` +
      `Yuk mulai belanja sekarang!`;

    const keyboard = {
      inline_keyboard: [
        [{ text: '🛍️ Lihat Produk', callback_data: 'catalog' }],
        [{ text: '🔙 Menu Utama', callback_data: 'main_menu' }],
      ],
    };

    if (messageId) {
      bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      }).catch(() => bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() }).catch(() => {}));
    } else {
      bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() }).catch(() => {});
    }
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

  buttons.push([{ text: '🔙 Menu Utama', callback_data: 'main_menu' }]);

  if (messageId) {
    bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons },
    }).catch(() => {
      bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } }).catch(() => {});
    });
  } else {
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } }).catch(() => {});
  }
}

/**
 * Tampilkan detail pesanan
 */
function showOrderDetail(bot, chatId, messageId, orderId) {
  const order = orderQueries.getById.get(orderId);

  if (!order) {
    bot.editMessageText('Pesanan tidak ditemukan.', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'my_orders' }]] },
    }).catch(() => {});
    return;
  }

  const items = orderQueries.getItems.all(orderId);
  const emoji = statusEmoji(order.status);
  const label = statusLabel(order.status);

  // Ambil data credential digital yang terikat jika order sudah sukses dibayar
  let digitalItemsText = '';
  if (order.status === 'paid' || order.status === 'confirmed') {
    const claimedDigitalItems = digitalItemQueries.getByOrder.all(orderId);
    if (claimedDigitalItems.length > 0) {
      digitalItemsText = `\n🔑 *Credentials / Detail Produk Digital:*\n` +
        `───\n`;
      
      claimedDigitalItems.forEach((acc, idx) => {
        const parts = acc.content.split(':');
        if (parts.length >= 2) {
          const username = parts[0].trim();
          const password = parts.slice(1).join(':').trim();
          digitalItemsText += `📂 *Item #${idx + 1}:*\n` +
            `👤 Username/Email: \`${username}\`\n` +
            `🔑 Password: \`${password}\`\n` +
            `───\n`;
        } else {
          digitalItemsText += `📂 *Item #${idx + 1}:*\n` +
            `🔗 Detail/Tautan: \`${acc.content}\`\n` +
            `───\n`;
        }
      });
      digitalItemsText += `💡 _Ketuk tulisan abu-abu di atas untuk menyalin._\n`;
    }
  }

  let text =
    `*Rincian Detail Pesanan*\n\n` +
    `• ID Order: \`${orderId}\`\n` +
    `• Status: ${emoji} *${label}*\n` +
    `• Tanggal: _${formatDate(order.created_at)}_\n\n` +
    `*Item Yang Dibeli:*\n`;

  for (const item of items) {
    text += `• ${item.product_name} (x${item.quantity}) — _${formatRupiah(item.price * item.quantity)}_\n`;
  }

  text += `\nTotal Belanja: *${formatRupiah(order.total_amount)}*\n`;

  if (order.dana_reference) {
    text += `Ref DANA: \`${order.dana_reference}\`\n`;
  }

  text += digitalItemsText;

  const buttons = [];

  // Tombol bayar jika pending dan ada payment URL
  if (order.status === 'pending' && order.payment_url) {
    // Tombol bayar menggunakan callback untuk mengecek atau instruksi
    buttons.push([{ text: '💳 Bayar Sekarang', callback_data: `check_payment_${orderId}` }]);
    buttons.push([{ text: '❌ Batalkan Pesanan', callback_data: `order_cancel_${orderId}` }]);
  }

  buttons.push([{ text: '🔙 Kembali', callback_data: 'my_orders' }]);

  bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons },
  }).catch(() => {
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } }).catch(() => {});
  });
}

/**
 * Konfirmasi pembatalan pesanan
 */
function confirmCancelOrder(bot, chatId, messageId, orderId) {
  bot.editMessageText(
    `*Konfirmasi Pembatalan*\n\n` +
    `Apakah Anda yakin ingin membatalkan pesanan \`${orderId}\`?\n\n` +
    `Stok produk akan dikembalikan ke sistem otomatis.`,
    {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Ya, Batalkan', callback_data: `order_cancel_yes_${orderId}` },
            { text: 'Tidak', callback_data: `order_detail_${orderId}` },
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
