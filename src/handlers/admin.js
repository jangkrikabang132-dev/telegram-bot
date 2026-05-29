const { productQueries, orderQueries, digitalItemQueries } = require('../database');
const { formatRupiah, formatDate, statusEmoji, statusLabel } = require('../utils/formatter');
const { adminMenuKeyboard, productListKeyboard, stockManageKeyboard, quickStockKeyboard } = require('../utils/keyboard');

// State sementara untuk wizard tambah/edit produk
const adminState = new Map();

/**
 * Cek apakah user adalah admin
 */
function isAdmin(chatId) {
  const adminId = process.env.ADMIN_CHAT_ID;
  if (!adminId) return true; // Jika belum diset, semua bisa akses (untuk setup awal)
  return String(chatId) === String(adminId);
}

/**
 * Handler admin untuk kelola produk dan stok
 */
function registerAdminHandlers(bot) {

  // /admin command
  bot.onText(/\/admin/, (msg) => {
    if (!isAdmin(msg.chat.id)) {
      bot.sendMessage(msg.chat.id, '🔒 Akses ditolak. Hanya admin yang bisa mengakses menu ini.').catch(() => {});
      return;
    }
    console.log(`👑 /admin dari ${msg.chat.id}`);
    showAdminMenu(bot, msg.chat.id);
  });

  // /stok command — quick view
  bot.onText(/\/stok/, (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    showStockOverview(bot, msg.chat.id);
  });

  // /tambahistok [id] [jumlah]
  bot.onText(/\/tambahistok (\d+) (\d+)/, (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;
    const productId = parseInt(match[1]);
    const amount = parseInt(match[2]);
    quickAddStock(bot, msg.chat.id, productId, amount);
  });

  // /tambahakun [id] (Untuk tambah akun digital massal seperti ChatGPT, Netflix, dll)
  bot.onText(/\/tambahakun (\d+)/, (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;
    const productId = parseInt(match[1]);
    
    // Cek produk
    const product = productQueries.getById.get(productId);
    if (!product) {
      bot.sendMessage(msg.chat.id, `❌ Produk dengan ID ${productId} tidak ditemukan.`).catch(() => {});
      return;
    }

    adminState.set(String(msg.chat.id), { step: 'add_digital_items', productId });
    bot.sendMessage(msg.chat.id,
      `🔑 *Tambah Akun Digital: ${product.name}* 🔑\n\n` +
      `Silakan kirim detail akun/voucher (satu per baris). Contoh:\n` +
      `\`email1:password1\`\n` +
      `\`email2:password2\`\n\n` +
      `*Catatan:* Setiap baris akan dihitung sebagai 1 stok tambahan otomatis.\n` +
      `Ketik \`/batal\` untuk membatalkan.`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  });

  // Handle text input berdasarkan state admin
  bot.on('message', (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    if (!isAdmin(msg.chat.id)) return;

    const state = adminState.get(String(msg.chat.id));
    if (!state) return;

    handleAdminInput(bot, msg, state);
  });

  // Handle photo input (untuk gambar produk)
  bot.on('photo', (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    const state = adminState.get(String(msg.chat.id));
    if (!state || !['add_image', 'edit_image'].includes(state.step)) return;

    const photo = msg.photo[msg.photo.length - 1]; // Ambil resolusi tertinggi
    const fileId = photo.file_id;

    if (state.step === 'add_image') {
      state.product.image_url = fileId;
      state.step = 'add_category';
      adminState.set(String(msg.chat.id), state);

      bot.sendMessage(msg.chat.id,
        `🖼️ Gambar tersimpan!\n\n` +
        `🏷️ Masukkan kategori produk:\n` +
        `(contoh: Makanan, Minuman, Elektronik, dll)\n\n` +
        `Atau ketik "Umum" untuk kategori default.`
      ).catch(() => {});
    } else if (state.step === 'edit_image') {
      const product = productQueries.getById.get(state.productId);
      if (product) {
        productQueries.update.run({
          ...product,
          image_url: fileId,
        });
        bot.sendMessage(msg.chat.id, `✅ Gambar produk "${product.name}" berhasil diperbarui!`).catch(() => {});
      }
      adminState.delete(String(msg.chat.id));
    }
  });

  // Callback queries admin
  bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    if (!isAdmin(chatId) && data.startsWith('admin')) {
      bot.answerCallbackQuery(query.id, { text: '🔒 Akses ditolak', show_alert: true });
      return;
    }

    // Menu admin
    if (data === 'admin_menu') {
      bot.answerCallbackQuery(query.id);
      adminState.delete(String(chatId));
      showAdminMenu(bot, chatId, messageId);
      return;
    }

    // ==================== TAMBAH PRODUK ====================
    if (data === 'admin_add_product') {
      bot.answerCallbackQuery(query.id);
      startAddProduct(bot, chatId);
      return;
    }

    // ==================== KELOLA STOK ====================
    if (data === 'admin_stock') {
      bot.answerCallbackQuery(query.id);
      showStockList(bot, chatId, messageId);
      return;
    }

    // ==================== TAMBAH STOK CEPAT ====================
    if (data === 'admin_quick_stock') {
      bot.answerCallbackQuery(query.id);
      showQuickStockList(bot, chatId, messageId);
      return;
    }

    // Quick stock — pilih jumlah untuk produk
    if (data.startsWith('quick_stock_')) {
      bot.answerCallbackQuery(query.id);
      const productId = parseInt(data.replace('quick_stock_', ''));
      showQuickStockAmount(bot, chatId, messageId, productId);
      return;
    }

    // Quick stock — tambah jumlah
    if (data.startsWith('qstock_add_')) {
      const parts = data.replace('qstock_add_', '').split('_');
      const productId = parseInt(parts[0]);
      const amount = parseInt(parts[1]);
      quickAddStockInline(bot, query, chatId, messageId, productId, amount);
      return;
    }

    // Quick stock — set manual
    if (data.startsWith('qstock_set_')) {
      bot.answerCallbackQuery(query.id);
      const productId = parseInt(data.replace('qstock_set_', ''));
      adminState.set(String(chatId), { step: 'quick_set_stock', productId });
      bot.sendMessage(chatId, '✏️ Masukkan jumlah stok yang ingin DITAMBAHKAN (angka):').catch(() => {});
      return;
    }

    // Stok detail per produk
    if (data.startsWith('stock_manage_')) {
      bot.answerCallbackQuery(query.id);
      const productId = parseInt(data.replace('stock_manage_', ''));
      showStockManage(bot, chatId, messageId, productId);
      return;
    }

    // Tambah akun digital via menu visual
    if (data.startsWith('stock_add_digital_')) {
      bot.answerCallbackQuery(query.id);
      const productId = parseInt(data.replace('stock_add_digital_', ''));
      
      const product = productQueries.getById.get(productId);
      if (!product) {
        bot.sendMessage(chatId, `❌ Produk tidak ditemukan.`).catch(() => {});
        return;
      }

      adminState.set(String(chatId), { step: 'add_digital_items', productId });
      bot.sendMessage(chatId,
        `🔑 *Tambah Akun Digital: ${product.name}* 🔑\n\n` +
        `Silakan kirim detail akun/voucher (satu per baris). Contoh:\n` +
        `\`email1:password1\`\n` +
        `\`email2:password2\`\n\n` +
        `*Catatan:* Setiap baris akan dihitung sebagai 1 stok tambahan otomatis.\n` +
        `Ketik \`/batal\` untuk membatalkan.`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
      return;
    }

    // Tambah link produk via menu visual
    if (data.startsWith('stock_add_link_')) {
      bot.answerCallbackQuery(query.id);
      const productId = parseInt(data.replace('stock_add_link_', ''));
      
      const product = productQueries.getById.get(productId);
      if (!product) {
        bot.sendMessage(chatId, `❌ Produk tidak ditemukan.`).catch(() => {});
        return;
      }

      adminState.set(String(chatId), { step: 'add_digital_link_url', productId });
      bot.sendMessage(chatId,
        `🔗 *Tambah Link Produk: ${product.name}* 🔗\n\n` +
        `Silakan kirimkan link/URL produk Anda (contoh: \`https://google-drive.com/share\`):\n\n` +
        `Ketik \`/batal\` untuk membatalkan.`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
      return;
    }

    // Tambah stok
    if (data.startsWith('stock_add_')) {
      const parts = data.replace('stock_add_', '').split('_');
      const productId = parseInt(parts[0]);
      const amount = parseInt(parts[1]);
      addStock(bot, query, chatId, messageId, productId, amount);
      return;
    }

    // Kurangi stok
    if (data.startsWith('stock_sub_')) {
      const parts = data.replace('stock_sub_', '').split('_');
      const productId = parseInt(parts[0]);
      const amount = parseInt(parts[1]);
      addStock(bot, query, chatId, messageId, productId, -amount);
      return;
    }

    // Set stok manual
    if (data.startsWith('stock_set_')) {
      bot.answerCallbackQuery(query.id);
      const productId = parseInt(data.replace('stock_set_', ''));
      adminState.set(String(chatId), { step: 'set_stock', productId });
      bot.sendMessage(chatId, '✏️ Masukkan jumlah stok baru (angka):').catch(() => {});
      return;
    }

    // ==================== EDIT PRODUK ====================
    if (data === 'admin_edit_list') {
      bot.answerCallbackQuery(query.id);
      showEditList(bot, chatId, messageId);
      return;
    }

    if (data.startsWith('admin_edit_')) {
      bot.answerCallbackQuery(query.id);
      const productId = parseInt(data.replace('admin_edit_', ''));
      showEditProduct(bot, chatId, messageId, productId);
      return;
    }

    // Edit field spesifik
    if (data.startsWith('edit_name_')) {
      bot.answerCallbackQuery(query.id);
      const productId = parseInt(data.replace('edit_name_', ''));
      adminState.set(String(chatId), { step: 'edit_name', productId });
      bot.sendMessage(chatId, '✏️ Masukkan nama baru:').catch(() => {});
      return;
    }

    if (data.startsWith('edit_desc_')) {
      bot.answerCallbackQuery(query.id);
      const productId = parseInt(data.replace('edit_desc_', ''));
      adminState.set(String(chatId), { step: 'edit_desc', productId });
      bot.sendMessage(chatId, '✏️ Masukkan deskripsi baru:').catch(() => {});
      return;
    }

    if (data.startsWith('edit_price_')) {
      bot.answerCallbackQuery(query.id);
      const productId = parseInt(data.replace('edit_price_', ''));
      adminState.set(String(chatId), { step: 'edit_price', productId });
      bot.sendMessage(chatId, '✏️ Masukkan harga baru (angka, dalam Rupiah):').catch(() => {});
      return;
    }

    if (data.startsWith('edit_stock_')) {
      bot.answerCallbackQuery(query.id);
      const productId = parseInt(data.replace('edit_stock_', ''));
      adminState.set(String(chatId), { step: 'edit_stock', productId });
      bot.sendMessage(chatId, '✏️ Masukkan jumlah stok baru (angka):').catch(() => {});
      return;
    }

    if (data.startsWith('edit_cat_')) {
      bot.answerCallbackQuery(query.id);
      const productId = parseInt(data.replace('edit_cat_', ''));
      adminState.set(String(chatId), { step: 'edit_category', productId });
      bot.sendMessage(chatId, '✏️ Masukkan kategori baru:').catch(() => {});
      return;
    }

    if (data.startsWith('edit_img_')) {
      bot.answerCallbackQuery(query.id);
      const productId = parseInt(data.replace('edit_img_', ''));
      adminState.set(String(chatId), { step: 'edit_image', productId });
      bot.sendMessage(chatId, '🖼️ Kirim foto baru untuk produk ini:').catch(() => {});
      return;
    }

    if (data.startsWith('edit_toggle_')) {
      const productId = parseInt(data.replace('edit_toggle_', ''));
      productQueries.toggleActive.run(productId);
      const product = productQueries.getById.get(productId);
      const status = product.is_active ? 'diaktifkan 🟢' : 'dinonaktifkan 🔴';
      bot.answerCallbackQuery(query.id, { text: `Produk ${status}` });
      showEditProduct(bot, chatId, messageId, productId);
      return;
    }

    // ==================== HAPUS PRODUK ====================
    if (data === 'admin_delete_list') {
      bot.answerCallbackQuery(query.id);
      showDeleteList(bot, chatId, messageId);
      return;
    }

    if (data.startsWith('admin_delete_')) {
      bot.answerCallbackQuery(query.id);
      const productId = parseInt(data.replace('admin_delete_', ''));
      confirmDeleteProduct(bot, chatId, messageId, productId);
      return;
    }

    if (data.startsWith('admin_del_yes_')) {
      const productId = parseInt(data.replace('admin_del_yes_', ''));
      deleteProduct(bot, query, chatId, messageId, productId);
      return;
    }

    // ==================== LAPORAN ====================
    if (data === 'admin_report') {
      bot.answerCallbackQuery(query.id);
      showDailyReport(bot, chatId, messageId);
      return;
    }

    // ==================== PESANAN ADMIN ====================
    if (data === 'admin_orders') {
      bot.answerCallbackQuery(query.id);
      showAdminOrders(bot, chatId, messageId);
      return;
    }

    if (data.startsWith('admin_order_')) {
      bot.answerCallbackQuery(query.id);
      const orderId = data.replace('admin_order_', '');
      showAdminOrderDetail(bot, chatId, messageId, orderId);
      return;
    }

    if (data.startsWith('confirm_order_')) {
      const orderId = data.replace('confirm_order_', '');
      orderQueries.updateStatus.run('confirmed', orderId);
      bot.answerCallbackQuery(query.id, { text: '✅ Pesanan dikonfirmasi' });
      showAdminOrderDetail(bot, chatId, messageId, orderId);
      return;
    }

    // Konfirmasi pembayaran QRIS (pending → paid)
    if (data.startsWith('confirm_paid_')) {
      const orderId = data.replace('confirm_paid_', '');
      const order = orderQueries.getById.get(orderId);

      if (!order || order.status !== 'pending') {
        bot.answerCallbackQuery(query.id, { text: '❌ Order tidak valid atau sudah diproses', show_alert: true });
        return;
      }

      orderQueries.updateStatus.run('paid', orderId);
      bot.answerCallbackQuery(query.id, { text: '✅ Pembayaran dikonfirmasi!' });

      // Notifikasi ke pembeli
      const items = orderQueries.getItems.all(orderId);
      const itemList = items.map(i => `  • ${i.product_name} x${i.quantity} — ${formatRupiah(i.price * i.quantity)}`).join('\n');

      bot.sendMessage(order.chat_id,
        `🎉 Pembayaran Dikonfirmasi!\n\n` +
        `📋 Order: ${orderId}\n` +
        `💰 Total: ${formatRupiah(order.total_amount)}\n\n` +
        `📦 Item:\n${itemList}\n\n` +
        `Terima kasih sudah berbelanja! 🙏`
      ).catch(console.error);

      showAdminOrderDetail(bot, chatId, messageId, orderId);
      return;
    }

    // ==================== STOK MENIPIS ====================
    if (data === 'admin_low_stock') {
      bot.answerCallbackQuery(query.id);
      showLowStock(bot, chatId, messageId);
      return;
    }
  });
}

// ============================================================
// ADMIN MENU
// ============================================================
function showAdminMenu(bot, chatId, messageId) {
  const products = productQueries.getAllIncludeInactive.all();
  const lowStock = productQueries.getLowStock.all();
  const pendingOrders = orderQueries.getAllPending.all();
  const todaySales = orderQueries.getTodaySales.get();

  let text = '👑 Panel Admin\n\n';
  text += `📦 Total Produk: ${products.length}\n`;
  text += `⚠️ Stok Menipis: ${lowStock.length}\n`;
  text += `⏳ Pesanan Pending: ${pendingOrders.length}\n`;
  text += `💰 Penjualan Hari Ini: ${todaySales.total_orders} pesanan (${formatRupiah(todaySales.total_revenue)})\n`;

  if (messageId) {
    bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: adminMenuKeyboard(),
    }).catch(() => bot.sendMessage(chatId, text, { reply_markup: adminMenuKeyboard() }).catch(() => {}));
  } else {
    bot.sendMessage(chatId, text, { reply_markup: adminMenuKeyboard() }).catch(() => {});
  }
}

// ============================================================
// TAMBAH PRODUK (Wizard Step-by-Step)
// ============================================================
function startAddProduct(bot, chatId) {
  adminState.set(String(chatId), {
    step: 'add_name',
    product: {
      name: '',
      description: '',
      price: 0,
      stock: 0,
      image_url: '',
      category: 'Umum',
    },
  });

  bot.sendMessage(chatId,
    '➕ Tambah Produk Baru\n\n' +
    'Langkah 1/6: Masukkan nama produk:\n\n' +
    'Ketik /batal untuk membatalkan'
  ).catch(() => {});
}

function handleAdminInput(bot, msg, state) {
  const chatId = msg.chat.id;
  const text = msg.text.trim();

  // Batal
  if (text === '/batal') {
    adminState.delete(String(chatId));
    bot.sendMessage(chatId, '❌ Dibatalkan.', { reply_markup: adminMenuKeyboard() }).catch(() => {});
    return;
  }

  switch (state.step) {
    // ==================== ADD PRODUCT WIZARD ====================
    case 'add_name':
      state.product.name = text;
      state.step = 'add_description';
      adminState.set(String(chatId), state);
      bot.sendMessage(chatId,
        `✅ Nama: ${text}\n\n` +
        `Langkah 2/6: Masukkan deskripsi produk:\n` +
        `(atau ketik "-" untuk skip)`
      ).catch(() => {});
      break;

    case 'add_description':
      state.product.description = text === '-' ? '' : text;
      state.step = 'add_price';
      adminState.set(String(chatId), state);
      bot.sendMessage(chatId,
        `Langkah 3/6: Masukkan harga (angka dalam Rupiah):\n` +
        `Contoh: 50000`
      ).catch(() => {});
      break;

    case 'add_price': {
      const price = parseInt(text.replace(/[^0-9]/g, ''));
      if (isNaN(price) || price <= 0) {
        bot.sendMessage(chatId, '❌ Harga harus angka positif. Coba lagi:').catch(() => {});
        return;
      }
      state.product.price = price;
      state.step = 'add_stock';
      adminState.set(String(chatId), state);
      bot.sendMessage(chatId,
        `✅ Harga: ${formatRupiah(price)}\n\n` +
        `Langkah 4/6: Masukkan jumlah stok awal:`
      ).catch(() => {});
      break;
    }

    case 'add_stock': {
      const stock = parseInt(text);
      if (isNaN(stock) || stock < 0) {
        bot.sendMessage(chatId, '❌ Stok harus angka >= 0. Coba lagi:').catch(() => {});
        return;
      }
      state.product.stock = stock;
      state.step = 'add_image';
      adminState.set(String(chatId), state);
      bot.sendMessage(chatId,
        `✅ Stok: ${stock}\n\n` +
        `Langkah 5/6: Kirim foto produk:\n` +
        `(atau ketik "-" untuk skip)`
      ).catch(() => {});
      break;
    }

    case 'add_image':
      state.product.image_url = '';
      state.step = 'add_category';
      adminState.set(String(chatId), state);
      bot.sendMessage(chatId,
        `Langkah 6/6: Masukkan kategori produk:\n` +
        `(contoh: Makanan, Minuman, Elektronik)\n` +
        `Atau ketik "-" untuk "Umum"`
      ).catch(() => {});
      break;

    case 'add_category': {
      state.product.category = (text === '-') ? 'Umum' : text;

      // Simpan produk
      try {
        const result = productQueries.insert.run(state.product);
        const p = state.product;

        bot.sendMessage(chatId,
          `✅ Produk Berhasil Ditambahkan!\n\n` +
          `📦 Nama: ${p.name}\n` +
          `📝 Deskripsi: ${p.description || '-'}\n` +
          `💰 Harga: ${formatRupiah(p.price)}\n` +
          `📊 Stok: ${p.stock}\n` +
          `🏷️ Kategori: ${p.category}\n` +
          `🆔 ID: ${result.lastInsertRowid}`,
          {
            reply_markup: adminMenuKeyboard(),
          }
        ).catch(() => {});
      } catch (error) {
        bot.sendMessage(chatId, `❌ Gagal menyimpan: ${error.message}`).catch(() => {});
      }

      adminState.delete(String(chatId));
      break;
    }

    // ==================== EDIT PRODUCT FIELDS ====================
    case 'edit_name': {
      const product = productQueries.getById.get(state.productId);
      if (product) {
        productQueries.update.run({ ...product, name: text });
        bot.sendMessage(chatId, `✅ Nama diubah menjadi: ${text}`).catch(() => {});
      }
      adminState.delete(String(chatId));
      break;
    }

    case 'edit_desc': {
      const product = productQueries.getById.get(state.productId);
      if (product) {
        productQueries.update.run({ ...product, description: text === '-' ? '' : text });
        bot.sendMessage(chatId, `✅ Deskripsi diperbarui.`).catch(() => {});
      }
      adminState.delete(String(chatId));
      break;
    }

    case 'edit_price': {
      const price = parseInt(text.replace(/[^0-9]/g, ''));
      if (isNaN(price) || price <= 0) {
        bot.sendMessage(chatId, '❌ Harga harus angka positif. Coba lagi:').catch(() => {});
        return;
      }
      const product = productQueries.getById.get(state.productId);
      if (product) {
        productQueries.update.run({ ...product, price });
        bot.sendMessage(chatId, `✅ Harga diubah menjadi: ${formatRupiah(price)}`).catch(() => {});
      }
      adminState.delete(String(chatId));
      break;
    }

    case 'edit_stock': {
      const stock = parseInt(text);
      if (isNaN(stock) || stock < 0) {
        bot.sendMessage(chatId, '❌ Stok harus angka >= 0. Coba lagi:').catch(() => {});
        return;
      }
      const product = productQueries.getById.get(state.productId);
      if (product) {
        productQueries.update.run({ ...product, stock });
        bot.sendMessage(chatId, `✅ Stok diubah menjadi: ${stock}`).catch(() => {});
      }
      adminState.delete(String(chatId));
      break;
    }

    case 'edit_category': {
      const product = productQueries.getById.get(state.productId);
      if (product) {
        productQueries.update.run({ ...product, category: text });
        bot.sendMessage(chatId, `✅ Kategori diubah menjadi: ${text}`).catch(() => {});
      }
      adminState.delete(String(chatId));
      break;
    }

    case 'set_stock': {
      const stock = parseInt(text);
      if (isNaN(stock) || stock < 0) {
        bot.sendMessage(chatId, '❌ Stok harus angka >= 0. Coba lagi:').catch(() => {});
        return;
      }
      const product = productQueries.getById.get(state.productId);
      if (product) {
        productQueries.update.run({ ...product, stock });
        bot.sendMessage(chatId,
          `✅ Stok ${product.name} diubah menjadi: ${stock}`,
          {
            reply_markup: {
              inline_keyboard: [[{ text: '🔙 Kelola Stok', callback_data: 'admin_stock' }]],
            },
          }
        ).catch(() => {});
      }
      adminState.delete(String(chatId));
      break;
    }

    case 'quick_set_stock': {
      const amount = parseInt(text);
      if (isNaN(amount) || amount <= 0) {
        bot.sendMessage(chatId, '❌ Jumlah harus angka positif. Coba lagi:').catch(() => {});
        return;
      }
      const product = productQueries.getById.get(state.productId);
      if (product) {
        productQueries.updateStock.run(amount, state.productId);
        const newStock = product.stock + amount;
        bot.sendMessage(chatId,
          `✅ Stok ${product.name} ditambahkan!\n\n` +
          `📦 Sebelum: ${product.stock}\n` +
          `➕ Ditambah: +${amount}\n` +
          `📦 Sekarang: ${newStock}`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '📥 Tambah Stok Lagi', callback_data: 'admin_quick_stock' }],
                [{ text: '🔙 Menu Admin', callback_data: 'admin_menu' }],
              ],
            },
          }
        ).catch(() => {});
      }
      adminState.delete(String(chatId));
      break;
    }

    case 'add_digital_items': {
      const product = productQueries.getById.get(state.productId);
      if (!product) {
        bot.sendMessage(chatId, '❌ Produk tidak ditemukan.').catch(() => {});
        adminState.delete(String(chatId));
        return;
      }

      // Split baris untuk mengambil list akun
      const accounts = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
      
      if (accounts.length === 0) {
        bot.sendMessage(chatId, '❌ Format salah / tidak ada akun terdeteksi. Coba lagi atau ketik /batal:').catch(() => {});
        return;
      }

      try {
        // Masukkan ke digital_items
        for (const account of accounts) {
          digitalItemQueries.insert.run(state.productId, account);
        }

        // Tambah nominal stock di tabel products
        productQueries.updateStock.run(accounts.length, state.productId);
        const newStock = product.stock + accounts.length;

        bot.sendMessage(chatId,
          `✅ *Berhasil Menambahkan Akun Digital!* ✅\n\n` +
          `📦 Produk: *${product.name}*\n` +
          `➕ Jumlah Ditambahkan: *+${accounts.length} akun*\n` +
          `📊 Total Stok Sekarang: *${newStock}*\n\n` +
          `🔑 Detail akun berhasil di-input secara rapi di database.`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔙 Kelola Stok', callback_data: 'admin_stock' }],
                [{ text: '🔙 Menu Admin', callback_data: 'admin_menu' }],
              ],
            },
          }
        ).catch(() => {});
      } catch (error) {
        console.error('Error adding digital items:', error);
        bot.sendMessage(chatId, `❌ Gagal menyimpan akun digital: ${error.message}`).catch(() => {});
      }

      adminState.delete(String(chatId));
      break;
    }

    case 'add_digital_link_url': {
      const product = productQueries.getById.get(state.productId);
      if (!product) {
        bot.sendMessage(chatId, '❌ Produk tidak ditemukan.').catch(() => {});
        adminState.delete(String(chatId));
        return;
      }

      let url = text.trim();
      // Tambahkan https:// jika belum ada
      if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('www.')) {
        url = 'https://' + url;
      }

      state.linkUrl = url;
      state.step = 'add_digital_link_stock';
      adminState.set(String(chatId), state);

      bot.sendMessage(chatId,
        `🔗 *Link Produk:* \`${url}\`\n\n` +
        `Langkah 2/2: 📊 *Berapa kapasitas/stok untuk link ini?*\n` +
        `Ketikkan angka jumlah pembelian yang diizinkan (contoh: \`100\`):`
      ).catch(() => {});
      break;
    }

    case 'add_digital_link_stock': {
      const product = productQueries.getById.get(state.productId);
      if (!product) {
        bot.sendMessage(chatId, '❌ Produk tidak ditemukan.').catch(() => {});
        adminState.delete(String(chatId));
        return;
      }

      const amount = parseInt(text.replace(/[^0-9]/g, ''));
      if (isNaN(amount) || amount <= 0) {
        bot.sendMessage(chatId, '❌ Jumlah stok harus berupa angka positif. Coba lagi:').catch(() => {});
        return;
      }

      try {
        // Masukkan link berulang kali sebanyak nominal stok
        for (let i = 0; i < amount; i++) {
          digitalItemQueries.insert.run(state.productId, state.linkUrl);
        }

        // Tambah nominal stock di tabel products
        productQueries.updateStock.run(amount, state.productId);
        const newStock = product.stock + amount;

        bot.sendMessage(chatId,
          `✅ *Berhasil Menambahkan Tautan & Mengisi Stok!* ✅\n\n` +
          `📦 Produk: *${product.name}*\n` +
          `🔗 Tautan: \`${state.linkUrl}\`\n` +
          `➕ Kapasitas/Stok Ditambah: *+${amount} pembelian*\n` +
          `📊 Total Stok Sekarang: *${newStock}*\n\n` +
          `Pembeli selanjutnya akan otomatis mendapatkan link ini saat sukses membayar.`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔙 Kelola Stok', callback_data: 'admin_stock' }],
                [{ text: '🔙 Menu Admin', callback_data: 'admin_menu' }],
              ],
            },
          }
        ).catch(() => {});
      } catch (error) {
        console.error('Error adding digital link:', error);
        bot.sendMessage(chatId, `❌ Gagal menyimpan link digital: ${error.message}`).catch(() => {});
      }

      adminState.delete(String(chatId));
      break;
    }
  }
}

// ============================================================
// STOK MANAGEMENT
// ============================================================
function showStockList(bot, chatId, messageId) {
  const products = productQueries.getAllIncludeInactive.all();

  if (products.length === 0) {
    const text = '📦 Belum ada produk. Tambahkan produk dulu!';
    bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: adminMenuKeyboard(),
    }).catch(() => {});
    return;
  }

  let text = '📦 Kelola Stok\n\nPilih produk untuk atur stok:\n\n';

  const buttons = [];
  for (const p of products) {
    const stockIcon = p.stock <= 0 ? '🔴' : p.stock <= 5 ? '🟡' : '🟢';
    text += `${stockIcon} ${p.name} — Stok: ${p.stock} — ${formatRupiah(p.price)}\n`;

    buttons.push([{
      text: `${stockIcon} ${p.name} (Stok: ${p.stock})`,
      callback_data: `stock_manage_${p.id}`,
    }]);
  }

  buttons.push([{ text: '🔙 Menu Admin', callback_data: 'admin_menu' }]);

  bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: buttons },
  }).catch(() => {
    bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: buttons } }).catch(() => {});
  });
}

function showStockManage(bot, chatId, messageId, productId) {
  const product = productQueries.getById.get(productId);
  if (!product) return;

  const stockIcon = product.stock <= 0 ? '🔴' : product.stock <= 5 ? '🟡' : '🟢';

  const text =
    `📦 Kelola Stok: ${product.name}\n\n` +
    `${stockIcon} Stok saat ini: ${product.stock}\n` +
    `💰 Harga: ${formatRupiah(product.price)}\n\n` +
    `Gunakan tombol untuk mengatur stok:`;

  bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: stockManageKeyboard(productId),
  }).catch(() => {
    bot.sendMessage(chatId, text, { reply_markup: stockManageKeyboard(productId) }).catch(() => {});
  });
}

function addStock(bot, query, chatId, messageId, productId, amount) {
  const product = productQueries.getById.get(productId);
  if (!product) {
    bot.answerCallbackQuery(query.id, { text: '❌ Produk tidak ditemukan', show_alert: true });
    return;
  }

  const newStock = product.stock + amount;
  if (newStock < 0) {
    bot.answerCallbackQuery(query.id, { text: '❌ Stok tidak boleh negatif', show_alert: true });
    return;
  }

  productQueries.update.run({ ...product, stock: newStock });
  bot.answerCallbackQuery(query.id, {
    text: `${amount > 0 ? '➕' : '➖'} ${product.name}: ${product.stock} → ${newStock}`,
  });

  showStockManage(bot, chatId, messageId, productId);
}

function showStockOverview(bot, chatId) {
  const products = productQueries.getAllIncludeInactive.all();

  if (products.length === 0) {
    bot.sendMessage(chatId, '📦 Belum ada produk.').catch(() => {});
    return;
  }

  let text = '📊 Ringkasan Stok\n\n';
  for (const p of products) {
    const stockIcon = p.stock <= 0 ? '🔴' : p.stock <= 5 ? '🟡' : '🟢';
    const active = p.is_active ? '' : ' (nonaktif)';
    text += `${stockIcon} ${p.name}${active}\n   Stok: ${p.stock} | ${formatRupiah(p.price)}\n\n`;
  }

  bot.sendMessage(chatId, text, {
    reply_markup: adminMenuKeyboard(),
  }).catch(() => {});
}

function quickAddStock(bot, chatId, productId, amount) {
  const product = productQueries.getById.get(productId);
  if (!product) {
    bot.sendMessage(chatId, '❌ Produk tidak ditemukan.').catch(() => {});
    return;
  }

  productQueries.updateStock.run(amount, productId);
  const newStock = product.stock + amount;
  bot.sendMessage(chatId,
    `✅ Stok ${product.name} ditambahkan: ${product.stock} → ${newStock}`
  ).catch(() => {});
}

// ============================================================
// QUICK STOCK (Tambah Stok Cepat)
// ============================================================
function showQuickStockList(bot, chatId, messageId) {
  const products = productQueries.getAllIncludeInactive.all();

  if (products.length === 0) {
    const text = '📦 Belum ada produk. Tambahkan produk dulu!';
    bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: adminMenuKeyboard(),
    }).catch(() => {});
    return;
  }

  let text = '📥 Tambah Stok Cepat\n\nPilih produk untuk tambah stok:\n\n';

  for (const p of products) {
    const stockIcon = p.stock <= 0 ? '🔴' : p.stock <= 5 ? '🟡' : '🟢';
    text += `${stockIcon} ${p.name} — Stok: ${p.stock}\n`;
  }

  bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: quickStockKeyboard(products),
  }).catch(() => {
    bot.sendMessage(chatId, text, { reply_markup: quickStockKeyboard(products) }).catch(() => {});
  });
}

function showQuickStockAmount(bot, chatId, messageId, productId) {
  const product = productQueries.getById.get(productId);
  if (!product) return;

  const stockIcon = product.stock <= 0 ? '🔴' : product.stock <= 5 ? '🟡' : '🟢';

  const text =
    `📥 Tambah Stok: ${product.name}\n\n` +
    `${stockIcon} Stok saat ini: ${product.stock}\n` +
    `💰 Harga: ${formatRupiah(product.price)}\n\n` +
    `Pilih jumlah yang ingin ditambahkan:`;

  bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: {
      inline_keyboard: [
        [
          { text: '+1', callback_data: `qstock_add_${productId}_1` },
          { text: '+5', callback_data: `qstock_add_${productId}_5` },
          { text: '+10', callback_data: `qstock_add_${productId}_10` },
        ],
        [
          { text: '+25', callback_data: `qstock_add_${productId}_25` },
          { text: '+50', callback_data: `qstock_add_${productId}_50` },
          { text: '+100', callback_data: `qstock_add_${productId}_100` },
        ],
        [
          { text: '✏️ Ketik Jumlah Manual', callback_data: `qstock_set_${productId}` },
        ],
        [
          { text: '🔙 Pilih Produk Lain', callback_data: 'admin_quick_stock' },
          { text: '🔙 Menu Admin', callback_data: 'admin_menu' },
        ],
      ],
    },
  }).catch(() => {});
}

function quickAddStockInline(bot, query, chatId, messageId, productId, amount) {
  const product = productQueries.getById.get(productId);
  if (!product) {
    bot.answerCallbackQuery(query.id, { text: '❌ Produk tidak ditemukan', show_alert: true });
    return;
  }

  productQueries.updateStock.run(amount, productId);
  const newStock = product.stock + amount;

  bot.answerCallbackQuery(query.id, {
    text: `➕ ${product.name}: ${product.stock} → ${newStock} (+${amount})`,
  });

  // Refresh tampilan
  showQuickStockAmount(bot, chatId, messageId, productId);
}

// ============================================================
// EDIT PRODUCT
// ============================================================
function showEditList(bot, chatId, messageId) {
  const products = productQueries.getAllIncludeInactive.all();

  if (products.length === 0) {
    bot.editMessageText('📦 Belum ada produk.', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: adminMenuKeyboard(),
    }).catch(() => {});
    return;
  }

  bot.editMessageText('✏️ Edit Produk\n\nPilih produk yang ingin diedit:', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: productListKeyboard(products, 'admin_edit'),
  }).catch(() => {});
}

function showEditProduct(bot, chatId, messageId, productId) {
  const product = productQueries.getById.get(productId);
  if (!product) return;

  const statusText = product.is_active ? '🟢 Aktif' : '🔴 Nonaktif';

  const text =
    `✏️ Edit Produk\n\n` +
    `📦 Nama: ${product.name}\n` +
    `📝 Deskripsi: ${product.description || '-'}\n` +
    `💰 Harga: ${formatRupiah(product.price)}\n` +
    `📊 Stok: ${product.stock}\n` +
    `🏷️ Kategori: ${product.category}\n` +
    `📌 Status: ${statusText}\n\n` +
    `Pilih field yang ingin diedit:`;

  const toggleText = product.is_active ? '🔴 Nonaktifkan' : '🟢 Aktifkan';

  bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: {
      inline_keyboard: [
        [
          { text: '📝 Nama', callback_data: `edit_name_${productId}` },
          { text: '📄 Deskripsi', callback_data: `edit_desc_${productId}` },
        ],
        [
          { text: '💰 Harga', callback_data: `edit_price_${productId}` },
          { text: '📦 Stok', callback_data: `edit_stock_${productId}` },
        ],
        [
          { text: '🏷️ Kategori', callback_data: `edit_cat_${productId}` },
          { text: '🖼️ Gambar', callback_data: `edit_img_${productId}` },
        ],
        [
          { text: toggleText, callback_data: `edit_toggle_${productId}` },
        ],
        [
          { text: '🔙 Menu Admin', callback_data: 'admin_menu' },
        ],
      ],
    },
  }).catch(() => {});
}

// ============================================================
// DELETE PRODUCT
// ============================================================
function showDeleteList(bot, chatId, messageId) {
  const products = productQueries.getAllIncludeInactive.all();

  if (products.length === 0) {
    bot.editMessageText('📦 Belum ada produk.', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: adminMenuKeyboard(),
    }).catch(() => {});
    return;
  }

  bot.editMessageText('🗑️ Hapus Produk\n\nPilih produk yang ingin dihapus:', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: productListKeyboard(products, 'admin_delete'),
  }).catch(() => {});
}

function confirmDeleteProduct(bot, chatId, messageId, productId) {
  const product = productQueries.getById.get(productId);
  if (!product) return;

  bot.editMessageText(
    `⚠️ Yakin ingin menghapus produk ${product.name}?\n\n` +
    `💰 Harga: ${formatRupiah(product.price)}\n` +
    `📊 Stok: ${product.stock}\n\n` +
    `⚠️ Tindakan ini tidak bisa dibatalkan!`,
    {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Ya, Hapus', callback_data: `admin_del_yes_${productId}` },
            { text: '❌ Batal', callback_data: 'admin_delete_list' },
          ],
        ],
      },
    }
  ).catch(() => {});
}

function deleteProduct(bot, query, chatId, messageId, productId) {
  const product = productQueries.getById.get(productId);
  if (!product) {
    bot.answerCallbackQuery(query.id, { text: '❌ Produk tidak ditemukan', show_alert: true });
    return;
  }

  productQueries.delete.run(productId);
  bot.answerCallbackQuery(query.id, { text: `🗑️ ${product.name} dihapus` });
  showDeleteList(bot, chatId, messageId);
}

// ============================================================
// LAPORAN
// ============================================================
function showDailyReport(bot, chatId, messageId) {
  const sales = orderQueries.getTodaySales.get();
  const pending = orderQueries.getAllPending.all();
  const products = productQueries.getAllIncludeInactive.all();
  const lowStock = productQueries.getLowStock.all();

  let text = `📊 Laporan Hari Ini\n\n`;
  text += `💰 Pendapatan: ${formatRupiah(sales.total_revenue)}\n`;
  text += `📦 Pesanan Selesai: ${sales.total_orders}\n`;
  text += `⏳ Pesanan Pending: ${pending.length}\n\n`;
  text += `📊 Produk\n`;
  text += `Total: ${products.length}\n`;
  text += `Stok Menipis: ${lowStock.length}\n`;

  if (lowStock.length > 0) {
    text += `\n⚠️ Stok Menipis:\n`;
    for (const p of lowStock) {
      text += `  🟡 ${p.name}: ${p.stock} tersisa\n`;
    }
  }

  bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: {
      inline_keyboard: [[{ text: '🔙 Menu Admin', callback_data: 'admin_menu' }]],
    },
  }).catch(() => {
    bot.sendMessage(chatId, text, {
      reply_markup: adminMenuKeyboard(),
    }).catch(() => {});
  });
}

// ============================================================
// ADMIN ORDERS
// ============================================================
function showAdminOrders(bot, chatId, messageId) {
  const orders = orderQueries.getAll.all();

  if (orders.length === 0) {
    bot.editMessageText('📋 Belum ada pesanan.', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: adminMenuKeyboard(),
    }).catch(() => {});
    return;
  }

  let text = '📋 Semua Pesanan\n\n';

  const buttons = [];
  for (const order of orders.slice(0, 20)) {
    const emoji = statusEmoji(order.status);
    const label = statusLabel(order.status);
    text += `${emoji} ${order.order_id}\n`;
    text += `   👤 ${order.full_name || order.username || order.chat_id}\n`;
    text += `   💰 ${formatRupiah(order.total_amount)} — ${label}\n\n`;

    buttons.push([{
      text: `${emoji} ${order.order_id} — ${formatRupiah(order.total_amount)}`,
      callback_data: `admin_order_${order.order_id}`,
    }]);
  }

  buttons.push([{ text: '🔙 Menu Admin', callback_data: 'admin_menu' }]);

  bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: buttons },
  }).catch(() => {
    bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: buttons } }).catch(() => {});
  });
}

function showAdminOrderDetail(bot, chatId, messageId, orderId) {
  const order = orderQueries.getById.get(orderId);
  if (!order) return;

  const items = orderQueries.getItems.all(orderId);
  const emoji = statusEmoji(order.status);
  const label = statusLabel(order.status);

  let text = `📋 Detail Pesanan (Admin)\n\n`;
  text += `🆔 Order: ${orderId}\n`;
  text += `${emoji} Status: ${label}\n`;
  text += `👤 Pembeli: ${order.full_name || '-'} (@${order.username || '-'})\n`;
  text += `💬 Chat ID: ${order.chat_id}\n`;
  text += `📅 Tanggal: ${formatDate(order.created_at)}\n\n`;

  text += `📦 Item:\n`;
  for (const item of items) {
    text += `  • ${item.product_name} x${item.quantity} — ${formatRupiah(item.price * item.quantity)}\n`;
  }
  text += `\n💰 Total: ${formatRupiah(order.total_amount)}`;

  const buttons = [];
  if (order.status === 'pending') {
    buttons.push([{ text: '💰 Konfirmasi Pembayaran QRIS', callback_data: `confirm_paid_${orderId}` }]);
  }
  if (order.status === 'paid') {
    buttons.push([{ text: '✅ Konfirmasi Pesanan', callback_data: `confirm_order_${orderId}` }]);
  }
  buttons.push([{ text: '🔙 Semua Pesanan', callback_data: 'admin_orders' }]);

  bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: buttons },
  }).catch(() => {});
}

// ============================================================
// LOW STOCK ALERT
// ============================================================
function showLowStock(bot, chatId, messageId) {
  const products = productQueries.getLowStock.all();

  if (products.length === 0) {
    bot.editMessageText('✅ Semua produk stoknya aman!', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: adminMenuKeyboard(),
    }).catch(() => {});
    return;
  }

  let text = '⚠️ Produk Stok Menipis\n\n';

  const buttons = [];
  for (const p of products) {
    const icon = p.stock <= 0 ? '🔴' : '🟡';
    text += `${icon} ${p.name} — Stok: ${p.stock}\n`;
    buttons.push([{
      text: `${icon} ${p.name} (${p.stock}) — Tambah Stok`,
      callback_data: `stock_manage_${p.id}`,
    }]);
  }

  buttons.push([{ text: '🔙 Menu Admin', callback_data: 'admin_menu' }]);

  bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: buttons },
  }).catch(() => {
    bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: buttons } }).catch(() => {});
  });
}

module.exports = { registerAdminHandlers };
