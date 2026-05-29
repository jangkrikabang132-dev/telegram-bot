const { cartQueries } = require('../database');
const { formatRupiah } = require('../utils/formatter');
const { cartMainKeyboard, mainMenuKeyboard } = require('../utils/keyboard');

/**
 * Handler untuk keranjang belanja
 */
function registerCartHandlers(bot) {

  // /keranjang command
  bot.onText(/\/keranjang/, (msg) => {
    showCart(bot, msg.chat.id);
  });

  bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    // Tampilkan keranjang
    if (data === 'cart') {
      bot.answerCallbackQuery(query.id);
      showCart(bot, chatId, messageId);
      return;
    }

    // Tambah quantity
    if (data.startsWith('cart_inc_')) {
      const productId = parseInt(data.replace('cart_inc_', ''));
      updateCartItem(bot, query, chatId, productId, 1);
      return;
    }

    // Kurangi quantity
    if (data.startsWith('cart_dec_')) {
      const productId = parseInt(data.replace('cart_dec_', ''));
      updateCartItem(bot, query, chatId, productId, -1);
      return;
    }

    // Hapus item
    if (data.startsWith('cart_rm_')) {
      const productId = parseInt(data.replace('cart_rm_', ''));
      removeCartItem(bot, query, chatId, productId);
      return;
    }

    // Kosongkan keranjang
    if (data === 'cart_clear') {
      bot.answerCallbackQuery(query.id);
      bot.editMessageText(
        '🗑️ Yakin ingin mengosongkan keranjang?',
        {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Ya, Kosongkan', callback_data: 'cart_clear_confirm' },
                { text: '❌ Batal', callback_data: 'cart' },
              ],
            ],
          },
        }
      ).catch(() => {});
      return;
    }

    // Konfirmasi kosongkan
    if (data === 'cart_clear_confirm') {
      cartQueries.clearCart.run(String(chatId));
      bot.answerCallbackQuery(query.id, { text: '🗑️ Keranjang dikosongkan' });
      showCart(bot, chatId, messageId);
      return;
    }
  });
}

/**
 * Tampilkan isi keranjang
 */
function showCart(bot, chatId, messageId) {
  const items = cartQueries.getByChat.all(String(chatId));

  if (items.length === 0) {
    const text = '🛒 Keranjang Belanja\n\nKeranjang kamu masih kosong.\nYuk belanja dulu! 🛍️';
    const keyboard = cartMainKeyboard(false);

    if (messageId) {
      bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard,
      }).catch(() => bot.sendMessage(chatId, text, { reply_markup: keyboard }).catch(() => {}));
    } else {
      bot.sendMessage(chatId, text, { reply_markup: keyboard }).catch(() => {});
    }
    return;
  }

  let total = 0;
  let text = '🛒 Keranjang Belanja\n\n';

  const allButtons = [];

  for (const item of items) {
    const subtotal = item.price * item.quantity;
    total += subtotal;

    const stockWarning = item.quantity > item.stock ? ' ⚠️ stok kurang' : '';

    text += `📦 ${item.name}\n`;
    text += `   ${item.quantity}x ${formatRupiah(item.price)} = ${formatRupiah(subtotal)}${stockWarning}\n\n`;

    allButtons.push([
      { text: `➖`, callback_data: `cart_dec_${item.product_id}` },
      { text: `${item.name} (${item.quantity})`, callback_data: `prod_${item.product_id}` },
      { text: `➕`, callback_data: `cart_inc_${item.product_id}` },
      { text: `🗑️`, callback_data: `cart_rm_${item.product_id}` },
    ]);
  }

  text += `━━━━━━━━━━━━━━━━━━\n`;
  text += `💰 Total: ${formatRupiah(total)}\n`;
  text += `📦 ${items.length} jenis produk`;

  // Tambah tombol checkout/clear/lanjut belanja
  allButtons.push([{ text: '💳 Checkout & Bayar', callback_data: 'checkout' }]);
  allButtons.push([
    { text: '🗑️ Kosongkan', callback_data: 'cart_clear' },
    { text: '🛍️ Lanjut Belanja', callback_data: 'catalog' },
  ]);
  allButtons.push([{ text: '🔙 Menu Utama', callback_data: 'main_menu' }]);

  const keyboard = { inline_keyboard: allButtons };

  if (messageId) {
    bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: keyboard,
    }).catch(() => {
      bot.sendMessage(chatId, text, { reply_markup: keyboard }).catch(() => {});
    });
  } else {
    bot.sendMessage(chatId, text, { reply_markup: keyboard }).catch(() => {});
  }
}

/**
 * Update jumlah item di keranjang
 */
function updateCartItem(bot, query, chatId, productId, delta) {
  const items = cartQueries.getByChat.all(String(chatId));
  const item = items.find(i => i.product_id === productId);

  if (!item) {
    bot.answerCallbackQuery(query.id, { text: '❌ Item tidak ditemukan', show_alert: true });
    return;
  }

  const newQty = item.quantity + delta;

  if (newQty <= 0) {
    cartQueries.removeItem.run(String(chatId), productId);
    bot.answerCallbackQuery(query.id, { text: `🗑️ ${item.name} dihapus dari keranjang` });
  } else if (newQty > item.stock) {
    bot.answerCallbackQuery(query.id, {
      text: `⚠️ Stok maksimal: ${item.stock}`,
      show_alert: true,
    });
    return;
  } else {
    cartQueries.updateQuantity.run(newQty, String(chatId), productId);
    bot.answerCallbackQuery(query.id, { text: `${item.name}: ${newQty} item` });
  }

  showCart(bot, chatId, query.message.message_id);
}

/**
 * Hapus item dari keranjang
 */
function removeCartItem(bot, query, chatId, productId) {
  cartQueries.removeItem.run(String(chatId), productId);
  bot.answerCallbackQuery(query.id, { text: '🗑️ Item dihapus' });
  showCart(bot, chatId, query.message.message_id);
}

module.exports = { registerCartHandlers };
