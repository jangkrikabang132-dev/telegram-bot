const { productQueries } = require('../database');
const { formatRupiah } = require('../utils/formatter');
const { categoryKeyboard, mainMenuKeyboard } = require('../utils/keyboard');

const ITEMS_PER_PAGE = 5;

/**
 * Handler untuk katalog produk
 * Flow: List → Detail + Atur Jumlah → Bayar Sekarang (langsung, tanpa keranjang)
 */
function registerCatalogHandlers(bot) {

  // /katalog command
  bot.onText(/\/katalog/, (msg) => {
    showCatalogMenu(bot, msg.chat.id);
  });

  bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    // Tampilkan menu katalog (kategori)
    if (data === 'catalog') {
      bot.answerCallbackQuery(query.id);
      showCatalogMenu(bot, chatId, messageId);
      return;
    }

    // Tampilkan semua produk
    if (data === 'catalog_all' || data.match(/^catalog_page_(\d+)$/)) {
      bot.answerCallbackQuery(query.id);
      const pageMatch = data.match(/^catalog_page_(\d+)$/);
      const page = pageMatch ? parseInt(pageMatch[1]) : 1;
      showAllProducts(bot, chatId, messageId, page);
      return;
    }

    // Tampilkan produk per kategori
    if (data.startsWith('cat_')) {
      bot.answerCallbackQuery(query.id);
      const category = data.replace('cat_', '');
      showCategoryProducts(bot, chatId, messageId, category);
      return;
    }

    // Tampilkan detail produk (qty default = 1)
    if (data.startsWith('prod_')) {
      bot.answerCallbackQuery(query.id);
      const productId = parseInt(data.replace('prod_', ''));
      showProductBuy(bot, chatId, messageId, productId, 1);
      return;
    }

    // ==================== QUANTITY SELECTOR ====================

    // Tambah qty: qty_inc_{productId}_{currentQty}
    if (data.startsWith('qty_inc_')) {
      const parts = data.replace('qty_inc_', '').split('_');
      const productId = parseInt(parts[0]);
      const currentQty = parseInt(parts[1]);
      const product = productQueries.getById.get(productId);

      if (!product) {
        bot.answerCallbackQuery(query.id, { text: '❌ Produk tidak ditemukan', show_alert: true });
        return;
      }

      const newQty = Math.min(currentQty + 1, product.stock);
      if (newQty === currentQty) {
        bot.answerCallbackQuery(query.id, { text: `⚠️ Maksimal ${product.stock} (stok habis)`, show_alert: false });
        return;
      }

      bot.answerCallbackQuery(query.id);
      showProductBuy(bot, chatId, messageId, productId, newQty);
      return;
    }

    // Kurangi qty: qty_dec_{productId}_{currentQty}
    if (data.startsWith('qty_dec_')) {
      const parts = data.replace('qty_dec_', '').split('_');
      const productId = parseInt(parts[0]);
      const currentQty = parseInt(parts[1]);

      const newQty = Math.max(currentQty - 1, 1);
      if (newQty === currentQty) {
        bot.answerCallbackQuery(query.id, { text: '⚠️ Minimal 1', show_alert: false });
        return;
      }

      bot.answerCallbackQuery(query.id);
      showProductBuy(bot, chatId, messageId, productId, newQty);
      return;
    }

    // Out of stock notification
    if (data === 'out_of_stock') {
      bot.answerCallbackQuery(query.id, { text: '🔴 Maaf, stok produk ini sudah habis!', show_alert: true });
      return;
    }
  });
}

// ============================================================
// CATALOG VIEWS
// ============================================================

/**
 * Tampilkan menu kategori
 */
function showCatalogMenu(bot, chatId, messageId) {
  // Langsung tampilkan semua produk, hilangkan langkah kategori yang tidak perlu!
  showAllProducts(bot, chatId, messageId, 1);
}

/**
 * Tampilkan semua produk dengan pagination
 */
function showAllProducts(bot, chatId, messageId, page = 1) {
  const allProducts = productQueries.getAll.all();

  if (allProducts.length === 0) {
    bot.editMessageText('😕 *Katalog Kosong:*\nBelum ada produk yang didaftarkan di toko saat ini.', {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard(),
    }).catch(() => {});
    return;
  }

  const totalPages = Math.ceil(allProducts.length / ITEMS_PER_PAGE);
  const start = (page - 1) * ITEMS_PER_PAGE;
  const products = allProducts.slice(start, start + ITEMS_PER_PAGE);
  let text =
    `*Katalog Produk Tersedia*\n\n` +
    `Silakan pilih produk untuk melihat rincian detail:\n\n`;

  const buttons = [];
  for (const p of products) {
    const stockIcon = p.stock <= 0 ? '🔴' : p.stock <= 5 ? '🟡' : '🟢';
    const stockText = p.stock <= 0 ? 'Habis' : `${p.stock} unit`;
    
    text += `${stockIcon} *${p.name}*\n` +
            `   Harga: *${formatRupiah(p.price)}* | Stok: *${stockText}*\n`;
    if (p.description) {
      const shortDesc = p.description.length > 60 ? p.description.substring(0, 57) + '...' : p.description;
      text += `   _${shortDesc}_\n`;
    }
    text += `\n`;

    buttons.push([{
      text: `${stockIcon} ${p.name} — ${formatRupiah(p.price)}`,
      callback_data: `prod_${p.id}`,
    }]);
  }

  text += `📄 Halaman *${page}* dari *${totalPages}*`;

  // Pagination
  const navButtons = [];
  if (page > 1) navButtons.push({ text: '⬅️ Sebelumnya', callback_data: `catalog_page_${page - 1}` });
  if (page < totalPages) navButtons.push({ text: '➡️ Selanjutnya', callback_data: `catalog_page_${page + 1}` });
  if (navButtons.length) buttons.push(navButtons);

  buttons.push([{ text: '🔙 Menu Utama', callback_data: 'main_menu' }]);

  bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons },
  }).catch(() => {
    bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons },
    }).catch(() => {});
  });
}

/**
 * Tampilkan produk per kategori
 */
function showCategoryProducts(bot, chatId, messageId, category) {
  const products = productQueries.getByCategory.all(category);

  if (products.length === 0) {
    bot.editMessageText(`Tidak ada produk di kategori "${category}".`, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'catalog' }]] },
    }).catch(() => {});
    return;
  }

  let text =
    `📁 *Kategori: ${category.toUpperCase()}*\n\n` +
    `Silakan pilih produk di bawah ini:\n\n`;

  const buttons = [];
  for (const p of products) {
    const stockIcon = p.stock <= 0 ? '🔴' : p.stock <= 5 ? '🟡' : '🟢';
    const stockText = p.stock <= 0 ? 'Habis' : `${p.stock} unit`;
    
    text += `${stockIcon} *${p.name}*\n` +
            `   Harga: *${formatRupiah(p.price)}* | Stok: *${stockText}*\n\n`;

    buttons.push([{
      text: `${stockIcon} ${p.name} — ${formatRupiah(p.price)}`,
      callback_data: `prod_${p.id}`,
    }]);
  }

  buttons.push([{ text: '🔙 Menu Utama', callback_data: 'main_menu' }]);

  bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons },
  }).catch(() => {
    bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons },
    }).catch(() => {});
  });
}

// ============================================================
// DIRECT BUY — PRODUCT DETAIL + QTY SELECTOR + BAYAR SEKARANG
// ============================================================

/**
 * Tampilkan detail produk dengan qty selector dan tombol bayar langsung
 */
function showProductBuy(bot, chatId, messageId, productId, qty) {
  const product = productQueries.getById.get(productId);

  if (!product) {
    bot.sendMessage(chatId, '❌ Produk tidak ditemukan.').catch(() => {});
    return;
  }

  if (product.stock <= 0) {
    const text =
      `*${product.name}* (Stok Habis)\n\n` +
      `• Kategori: _${product.category}_\n` +
      `• Harga: *${formatRupiah(product.price)}*\n` +
      `• Status: Stok Kosong / Habis\n\n` +
      `${product.description ? `*Deskripsi:*\n_${product.description}_\n\n` : ''}` +
      `⚠️ Maaf, produk ini sedang kosong. Silakan pilih produk lain di katalog!`;

    const keyboard = {
      inline_keyboard: [
        [{ text: '🔴 Stok Habis', callback_data: 'out_of_stock' }],
        [{ text: '🔙 Kembali ke Katalog', callback_data: 'catalog' }],
      ],
    };

    if (messageId) {
      bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      }).catch(() => {
        bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: keyboard }).catch(() => {});
      });
    } else {
      bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: keyboard }).catch(() => {});
    }
    return;
  }

  // Pastikan qty valid
  qty = Math.max(1, Math.min(qty, product.stock));

  const subtotal = product.price * qty;

  const text =
    `*${product.name}*\n\n` +
    `• Kategori: _${product.category}_\n` +
    `• Harga Satuan: *${formatRupiah(product.price)}*\n` +
    `• Stok Tersedia: *${product.stock} unit*\n\n` +
    `${product.description ? `*Deskripsi:*\n_${product.description}_\n\n` : ''}` +
    `───\n` +
    `*Rincian Pembelian:*\n` +
    `• Jumlah: *${qty}* unit\n` +
    `• Total Bayar: *${formatRupiah(subtotal)}*`;

  const keyboard = {
    inline_keyboard: [
      // Qty selector
      [
        { text: '➖', callback_data: `qty_dec_${productId}_${qty}` },
        { text: `📦 ${qty} unit`, callback_data: 'noop' },
        { text: '➕', callback_data: `qty_inc_${productId}_${qty}` },
      ],
      // Bayar langsung
      [
        { text: `💳 Bayar ${formatRupiah(subtotal)}`, callback_data: `buy_now_${productId}_${qty}` },
      ],
      // Navigasi
      [
        { text: '🔙 Kembali ke Katalog', callback_data: 'catalog' },
      ],
    ],
  };

  if (messageId) {
    bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }).catch(() => {
      bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: keyboard }).catch(() => {});
    });
  } else {
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: keyboard }).catch(() => {});
  }
}

module.exports = { registerCatalogHandlers };
