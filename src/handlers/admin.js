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
      bot.sendMessage(msg.chat.id, 'Akses ditolak. Hanya admin yang bisa mengakses menu ini.').catch(() => {});
      return;
    }
    console.log(`👑 /admin dari ${msg.chat.id}`);
    adminState.delete(String(msg.chat.id)); // Clear state
    showAdminMenu(bot, msg.chat.id);
  });

  // /stok command — quick view
  bot.onText(/\/stok/, (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    adminState.delete(String(msg.chat.id)); // Clear state
    showStockOverview(bot, msg.chat.id);
  });

  // /tambahistok [id] [jumlah]
  bot.onText(/\/tambahistok (\d+) (\d+)/, (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;
    adminState.delete(String(msg.chat.id)); // Clear state
    const productId = parseInt(match[1]);
    const amount = parseInt(match[2]);
    quickAddStock(bot, msg.chat.id, productId, amount);
  });

  // /tambahakun [id] (Untuk tambah akun digital massal seperti ChatGPT, Netflix, dll)
  bot.onText(/\/tambahakun (\d+)/, (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;
    adminState.delete(String(msg.chat.id)); // Clear state
    const productId = parseInt(match[1]);
    
    // Cek produk
    const product = productQueries.getById.get(productId);
    if (!product) {
      bot.sendMessage(msg.chat.id, `❌ Produk dengan ID ${productId} tidak ditemukan.`).catch(() => {});
      return;
    }

    adminState.set(String(msg.chat.id), { step: 'add_digital_items', productId });
    bot.sendMessage(msg.chat.id,
      `*🔑 Tambah Stok Akun*\n` +
      `───\n` +
      `Produk: *${product.name}*\n\n` +
      `Silakan kirim detail akun (satu akun per baris) dengan format:\n` +
      `\`email:password\` atau \`username:password\`\n\n` +
      `Contoh:\n` +
      `\`budi@gmail.com:rahasiabudi123\`\n` +
      `\`andi@gmail.com:rahasiaandi456\`\n\n` +
      `💡 _Setiap baris akan diinput sebagai 1 unit stok secara otomatis._\n` +
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
      saveProductWizard(bot, msg.chat.id, state.product);
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
  bot.on('callback_query', async (query) => {
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
      adminState.delete(String(chatId)); // Clear existing state
      startAddProduct(bot, chatId);
      return;
    }

    // ==================== KELOLA STOK ====================
    if (data === 'admin_stock') {
      bot.answerCallbackQuery(query.id);
      adminState.delete(String(chatId)); // Clear existing state
      showStockList(bot, chatId, messageId);
      return;
    }

    // ==================== TAMBAH STOK CEPAT ====================
    if (data === 'admin_quick_stock') {
      bot.answerCallbackQuery(query.id);
      adminState.delete(String(chatId)); // Clear existing state
      showQuickStockList(bot, chatId, messageId);
      return;
    }

    // Quick stock — pilih jumlah untuk produk
    if (data.startsWith('quick_stock_')) {
      bot.answerCallbackQuery(query.id);
      adminState.delete(String(chatId)); // Clear existing state
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
      adminState.delete(String(chatId)); // Clear existing state
      const productId = parseInt(data.replace('qstock_set_', ''));
      adminState.set(String(chatId), { step: 'quick_set_stock', productId });
      bot.sendMessage(chatId, 'Masukkan jumlah stok yang ingin ditambahkan:').catch(() => {});
      return;
    }

    // Stok detail per produk
    if (data.startsWith('stock_manage_')) {
      bot.answerCallbackQuery(query.id);
      adminState.delete(String(chatId)); // Clear existing state
      const productId = parseInt(data.replace('stock_manage_', ''));
      showStockManage(bot, chatId, messageId, productId);
      return;
    }

    // Tambah akun digital via menu visual
    if (data.startsWith('stock_add_digital_')) {
      bot.answerCallbackQuery(query.id);
      adminState.delete(String(chatId)); // Clear existing state
      const productId = parseInt(data.replace('stock_add_digital_', ''));
      
      const product = productQueries.getById.get(productId);
      if (!product) {
        bot.sendMessage(chatId, `❌ Produk tidak ditemukan.`).catch(() => {});
        return;
      }

      adminState.set(String(chatId), { step: 'add_digital_items', productId });
      bot.sendMessage(chatId,
        `*🔑 Tambah Stok Akun*\n` +
        `───\n` +
        `Produk: *${product.name}*\n\n` +
        `Silakan kirim detail akun (satu akun per baris) dengan format:\n` +
        `\`email:password\` atau \`username:password\`\n\n` +
        `Contoh:\n` +
        `\`budi@gmail.com:rahasiabudi123\`\n` +
        `\`andi@gmail.com:rahasiaandi456\`\n\n` +
        `💡 _Setiap baris akan diinput sebagai 1 unit stok secara otomatis._\n` +
        `Ketik \`/batal\` untuk membatalkan.`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
      return;
    }

    // Tambah link produk via menu visual
    if (data.startsWith('stock_add_link_')) {
      bot.answerCallbackQuery(query.id);
      adminState.delete(String(chatId)); // Clear existing state
      const productId = parseInt(data.replace('stock_add_link_', ''));
      
      const product = productQueries.getById.get(productId);
      if (!product) {
        bot.sendMessage(chatId, `❌ Produk tidak ditemukan.`).catch(() => {});
        return;
      }

      adminState.set(String(chatId), { step: 'add_digital_link_url', productId });
      bot.sendMessage(chatId,
        `*🔗 Tambah Link Produk*\n` +
        `───\n` +
        `Produk: *${product.name}*\n\n` +
        `Silakan kirimkan link/tautan download atau akses produk Anda:\n` +
        `💡 _Contoh: https://google-drive.com/share/folder-id_\n\n` +
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
      adminState.delete(String(chatId)); // Clear existing state
      const productId = parseInt(data.replace('stock_set_', ''));
      adminState.set(String(chatId), { step: 'set_stock', productId });
      bot.sendMessage(chatId, 'Masukkan jumlah stok baru:').catch(() => {});
      return;
    }

    // ==================== EDIT PRODUK ====================
    if (data === 'admin_edit_list') {
      bot.answerCallbackQuery(query.id);
      adminState.delete(String(chatId)); // Clear existing state
      showEditList(bot, chatId, messageId);
      return;
    }

    if (data.startsWith('admin_edit_')) {
      bot.answerCallbackQuery(query.id);
      adminState.delete(String(chatId)); // Clear existing state
      const productId = parseInt(data.replace('admin_edit_', ''));
      showEditProduct(bot, chatId, messageId, productId);
      return;
    }

    // Edit field spesifik
    if (data.startsWith('edit_name_')) {
      bot.answerCallbackQuery(query.id);
      adminState.delete(String(chatId)); // Clear existing state
      const productId = parseInt(data.replace('edit_name_', ''));
      adminState.set(String(chatId), { step: 'edit_name', productId });
      bot.sendMessage(chatId, 'Masukkan nama baru:').catch(() => {});
      return;
    }

    if (data.startsWith('edit_desc_')) {
      bot.answerCallbackQuery(query.id);
      adminState.delete(String(chatId)); // Clear existing state
      const productId = parseInt(data.replace('edit_desc_', ''));
      adminState.set(String(chatId), { step: 'edit_desc', productId });
      bot.sendMessage(chatId, 'Masukkan deskripsi baru:').catch(() => {});
      return;
    }

    if (data.startsWith('edit_price_')) {
      bot.answerCallbackQuery(query.id);
      adminState.delete(String(chatId)); // Clear existing state
      const productId = parseInt(data.replace('edit_price_', ''));
      adminState.set(String(chatId), { step: 'edit_price', productId });
      bot.sendMessage(chatId, 'Masukkan harga baru (angka, dalam Rupiah):').catch(() => {});
      return;
    }

    if (data.startsWith('edit_stock_')) {
      bot.answerCallbackQuery(query.id);
      adminState.delete(String(chatId)); // Clear existing state
      const productId = parseInt(data.replace('edit_stock_', ''));
      adminState.set(String(chatId), { step: 'edit_stock', productId });
      bot.sendMessage(chatId, 'Masukkan jumlah stok baru:').catch(() => {});
      return;
    }

    if (data.startsWith('edit_instructions_')) {
      bot.answerCallbackQuery(query.id);
      adminState.delete(String(chatId)); // Clear existing state
      const productId = parseInt(data.replace('edit_instructions_', ''));
      adminState.set(String(chatId), { step: 'edit_instructions', productId });
      bot.sendMessage(chatId, 'Masukkan petunjuk / cara penggunaan baru:\n_(Ketik `-` untuk mengosongkan)_').catch(() => {});
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

      const { processOrderDelivery } = require('../delivery-service');

      bot.answerCallbackQuery(query.id, { text: '⏳ Memproses pengiriman...' });
      
      // Panggil delivery service terpadu
      await processOrderDelivery(bot, orderId, order.unique_amount || order.total_amount, {
        useAnimation: false
      });

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

  let text =
    `*👑 Panel Kontrol Admin*\n` +
    `───\n` +
    `Ringkasan Performa Hari Ini:\n` +
    `• Total Produk: *${products.length} item*\n` +
    `• Stok Menipis: *${lowStock.length} produk*\n` +
    `• Pesanan Pending: *${pendingOrders.length} order*\n` +
    `• Penjualan: *${todaySales.total_orders} transaksi* (${formatRupiah(todaySales.total_revenue)})\n\n` +
    `Pilih menu pengelolaan di bawah ini:`;

  if (messageId) {
    bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: adminMenuKeyboard(),
    }).catch(() => bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: adminMenuKeyboard() }).catch(() => {}));
  } else {
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: adminMenuKeyboard() }).catch(() => {});
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
      category: 'Digital',
      usage_instructions: '',
    },
  });

  bot.sendMessage(chatId,
    `*Tambah Produk Baru (1/4)*\n\n` +
    `Masukkan nama produk:\n` +
    `_(Contoh: ChatGPT Premium 1 Bulan)_\n\n` +
    `Ketik \`/batal\` untuk membatalkan.`,
    { parse_mode: 'Markdown' }
  ).catch(() => {});
}

function saveProductWizard(bot, chatId, productData) {
  try {
    const result = productQueries.insert.run(productData);
    bot.sendMessage(chatId,
      `*✅ Produk Berhasil Ditambahkan*\n` +
      `───\n` +
      `• ID Produk: \`${result.lastInsertRowid}\`\n` +
      `• Nama: *${productData.name}*\n` +
      `• Deskripsi: _${productData.description || '-'}_\n` +
      `• Harga: *${formatRupiah(productData.price)}*\n` +
      `• Cara Penggunaan: _${productData.usage_instructions || '-'}_\n\n` +
      `💡 _Tips: Silakan kelola stok produk untuk mengisi credentials akun digital atau link download._`,
      {
        parse_mode: 'Markdown',
        reply_markup: adminMenuKeyboard(),
      }
    ).catch(() => {});
  } catch (error) {
    bot.sendMessage(chatId, `❌ Gagal menyimpan produk: ${error.message}`).catch(() => {});
  }
  adminState.delete(String(chatId));
}

function handleAdminInput(bot, msg, state) {
  const chatId = msg.chat.id;
  const text = msg.text.trim();

  // Batal
  if (text === '/batal') {
    adminState.delete(String(chatId));
    bot.sendMessage(chatId, 'Pembuatan produk dibatalkan.', { reply_markup: adminMenuKeyboard() }).catch(() => {});
    return;
  }

  switch (state.step) {
    // ==================== ADD PRODUCT WIZARD (4 STEPS) ====================
    case 'add_name':
      state.product.name = text;
      state.step = 'add_description';
      adminState.set(String(chatId), state);
      bot.sendMessage(chatId,
        `*Tambah Produk Baru (2/4)*\n\n` +
        `Nama Produk: *${text}*\n\n` +
        `Masukkan deskripsi produk:\n` +
        `_(Ketik \`-\` jika ingin mengosongkan deskripsi)_`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
      break;

    case 'add_description':
      state.product.description = text === '-' ? '' : text;
      state.step = 'add_price';
      adminState.set(String(chatId), state);
      bot.sendMessage(chatId,
        `*Tambah Produk Baru (3/4)*\n\n` +
        `Deskripsi: _${state.product.description || '-'}_\n\n` +
        `Masukkan harga produk (angka saja, tanpa titik/koma):\n` +
        `_(Contoh: \`50000\` untuk Rp 50.000)_`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
      break;

    case 'add_price': {
      const price = parseInt(text.replace(/[^0-9]/g, ''));
      if (isNaN(price) || price <= 0) {
        bot.sendMessage(chatId, '❌ Harga harus berupa angka positif. Coba lagi:').catch(() => {});
        return;
      }
      state.product.price = price;
      state.step = 'add_instructions';
      adminState.set(String(chatId), state);
      bot.sendMessage(chatId,
        `*Tambah Produk Baru (4/4)*\n\n` +
        `Harga: *${formatRupiah(price)}*\n\n` +
        `Masukkan petunjuk / cara penggunaan produk:\n` +
        `_(Ketik \`-\` jika ingin mengosongkan cara penggunaan)_`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
      break;
    }

    case 'add_instructions':
      state.product.usage_instructions = text === '-' ? '' : text;
      saveProductWizard(bot, chatId, state.product);
      break;

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

    case 'edit_instructions': {
      const product = productQueries.getById.get(state.productId);
      if (product) {
        productQueries.update.run({ ...product, usage_instructions: text === '-' ? '' : text });
        bot.sendMessage(chatId, `✅ Petunjuk cara penggunaan berhasil diperbarui.`).catch(() => {});
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
          `✅ *Stok Akun Berhasil Ditambahkan!*\n\n` +
          `• Produk: *${product.name}*\n` +
          `• Jumlah Akun Baru: \`+${accounts.length} unit\`\n` +
          `• Total Stok Sekarang: *${newStock} unit*\n\n` +
          `🔑 Akun digital telah dimasukkan ke database dan siap dikirim otomatis ke pembeli!`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '📦 Kelola Stok', callback_data: `stock_manage_${product.id}` }],
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
        `*🔗 Input Tautan Produk*\n` +
        `───\n` +
        `Tautan: \`${url}\`\n\n` +
        `Langkah 2/2: *Tentukan Kapasitas Stok*\n` +
        `Ketikkan angka jumlah unit pembelian yang diizinkan (contoh: \`100\`):`
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
          `*🔗 Tautan Berhasil Disimpan*\n` +
          `───\n` +
          `• Produk: *${product.name}*\n` +
          `• Tautan: \`${state.linkUrl}\`\n` +
          `• Kapasitas Stok Ditambah: \`+${amount} unit\`\n` +
          `• Total Stok Sekarang: *${newStock} unit*\n\n` +
          `💡 _Pembeli selanjutnya akan otomatis menerima tautan ini setelah pembayaran lunas!_`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '📦 Kelola Stok', callback_data: `stock_manage_${product.id}` }],
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
    const text = 'Belum ada produk. Tambahkan produk terlebih dahulu!';
    bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: adminMenuKeyboard(),
    }).catch(() => {});
    return;
  }

  let text =
    `*📦 Kelola Stok Produk*\n` +
    `───\n` +
    `Pilih produk di bawah ini untuk mengelola stok:\n\n`;

  const buttons = [];
  for (const p of products) {
    const stockIcon = p.stock <= 0 ? '🔴' : p.stock <= 5 ? '🟡' : '🟢';
    const statusText = p.is_active ? '' : ' (Nonaktif)';
    text += `${stockIcon} *${p.name}*${statusText}\n` +
            `   Stok: *${p.stock} unit* | Harga: *${formatRupiah(p.price)}*\n\n`;

    buttons.push([{
      text: `${stockIcon} ${p.name} (${p.stock} unit)`,
      callback_data: `stock_manage_${p.id}`,
    }]);
  }

  buttons.push([{ text: '🔙 Menu Admin', callback_data: 'admin_menu' }]);

  bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons },
  }).catch(() => {
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } }).catch(() => {});
  });
}

function showStockManage(bot, chatId, messageId, productId) {
  const product = productQueries.getById.get(productId);
  if (!product) return;

  const stockIcon = product.stock <= 0 ? '🔴' : product.stock <= 5 ? '🟡' : '🟢';
  const stockText = product.stock <= 0 ? 'Habis (Silakan Restock)' : `${product.stock} unit`;

  const text =
    `*📦 Kelola Stok Produk*\n` +
    `───\n` +
    `Produk: *${product.name}*\n` +
    `• Harga: *${formatRupiah(product.price)}*\n` +
    `• Kategori: *${product.category}*\n` +
    `• Sisa Stok: ${stockIcon} *${stockText}*\n\n` +
    `*Instruksi:*\n` +
    `• Gunakan tombol *+1 / -1* untuk update stok manual.\n` +
    `• Klik *Input Akun* untuk menambah akun digital massal.\n` +
    `• Klik *Input Link* untuk mengisi link download/akses produk.`;

  bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: stockManageKeyboard(productId),
  }).catch(() => {
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: stockManageKeyboard(productId) }).catch(() => {});
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
    bot.sendMessage(chatId, 'Belum ada produk di database.').catch(() => {});
    return;
  }

  let text =
    `*📊 Status Stok Produk*\n` +
    `───\n`;
  for (const p of products) {
    const stockIcon = p.stock <= 0 ? '🔴' : p.stock <= 5 ? '🟡' : '🟢';
    const activeText = p.is_active ? '' : ' _(Nonaktif)_';
    text += `${stockIcon} *${p.name}*${activeText}\n` +
            `   Stok: *${p.stock} unit* | Harga: *${formatRupiah(p.price)}*\n\n`;
  }

  bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
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
    const text = 'Belum ada produk. Silakan tambahkan produk terlebih dahulu!';
    bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: adminMenuKeyboard(),
    }).catch(() => {});
    return;
  }

  let text =
    `*⚡ Tambah Stok Cepat*\n` +
    `───\n` +
    `Pilih produk di bawah untuk mengisi stok:\n\n`;

  for (const p of products) {
    const stockIcon = p.stock <= 0 ? '🔴' : p.stock <= 5 ? '🟡' : '🟢';
    const activeText = p.is_active ? '' : ' (Nonaktif)';
    text += `${stockIcon} *${p.name}*${activeText}\n` +
            `   Stok: *${p.stock} unit*\n\n`;
  }

  bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: quickStockKeyboard(products),
  }).catch(() => {
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: quickStockKeyboard(products) }).catch(() => {});
  });
}

function showQuickStockAmount(bot, chatId, messageId, productId) {
  const product = productQueries.getById.get(productId);
  if (!product) return;

  const stockIcon = product.stock <= 0 ? '🔴' : product.stock <= 5 ? '🟡' : '🟢';

  const text =
    `*⚡ Tambah Stok Cepat*\n` +
    `───\n` +
    `Produk: *${product.name}*\n` +
    `• Sisa Stok: ${stockIcon} *${product.stock} unit*\n` +
    `• Harga: *${formatRupiah(product.price)}*\n\n` +
    `Pilih nominal jumlah stok yang ingin ditambahkan:`;

  bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '➕ +1', callback_data: `qstock_add_${productId}_1` },
          { text: '➕ +5', callback_data: `qstock_add_${productId}_5` },
          { text: '➕ +10', callback_data: `qstock_add_${productId}_10` },
        ],
        [
          { text: '➕ +25', callback_data: `qstock_add_${productId}_25` },
          { text: '➕ +50', callback_data: `qstock_add_${productId}_50` },
          { text: '➕ +100', callback_data: `qstock_add_${productId}_100` },
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
    bot.editMessageText('Belum ada produk di database.', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: adminMenuKeyboard(),
    }).catch(() => {});
    return;
  }

  let text =
    `*✏️ Pilih Produk untuk Diedit*\n` +
    `───\n` +
    `Silakan pilih produk yang ingin diubah detail informasinya:`;

  bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: productListKeyboard(products, 'admin_edit'),
  }).catch(() => {});
}

function showEditProduct(bot, chatId, messageId, productId) {
  const product = productQueries.getById.get(productId);
  if (!product) return;

  const statusText = product.is_active ? 'Aktif' : 'Nonaktif';

  const text =
    `*✏️ Detail Produk (Mode Edit)*\n` +
    `───\n` +
    `• Nama: *${product.name}*\n` +
    `• Deskripsi: _${product.description || '-'}_\n` +
    `• Harga: *${formatRupiah(product.price)}*\n` +
    `• Sisa Stok: *${product.stock} unit*\n` +
    `• Cara Penggunaan: _${product.usage_instructions || '-'}_\n` +
    `• Status: *${statusText}*\n\n` +
    `Silakan pilih bagian data produk yang ingin diubah:`;

  const toggleText = product.is_active ? '🔴 Nonaktifkan' : '🟢 Aktifkan';

  bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
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
          { text: '📖 Cara Penggunaan', callback_data: `edit_instructions_${productId}` },
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
    bot.editMessageText('Belum ada produk di database.', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: adminMenuKeyboard(),
    }).catch(() => {});
    return;
  }

  let text =
    `*🗑️ Pilih Produk untuk Dihapus*\n` +
    `───\n` +
    `Silakan pilih produk yang ingin dihapus secara permanen dari katalog:`;

  bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: productListKeyboard(products, 'admin_delete'),
  }).catch(() => {});
}

function confirmDeleteProduct(bot, chatId, messageId, productId) {
  const product = productQueries.getById.get(productId);
  if (!product) return;

  bot.editMessageText(
    `*⚠️ Konfirmasi Hapus Produk*\n` +
    `───\n` +
    `Apakah Anda yakin ingin menghapus produk *${product.name}*?\n\n` +
    `• Harga: *${formatRupiah(product.price)}*\n` +
    `• Sisa Stok: *${product.stock} unit*\n\n` +
    `⚠️ _Tindakan ini bersifat permanen dan tidak dapat dibatalkan!_`,
    {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🗑️ Ya, Hapus', callback_data: `admin_del_yes_${productId}` },
            { text: '🔙 Batal', callback_data: 'admin_delete_list' },
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

  try {
    productQueries.delete.run(productId);
    bot.answerCallbackQuery(query.id, { text: `✅ ${product.name} berhasil dihapus` });
    showDeleteList(bot, chatId, messageId);
  } catch (error) {
    console.error('Delete product error:', error.message);
    bot.answerCallbackQuery(query.id, {
      text: `⚠️ Tidak dapat menghapus "${product.name}" secara permanen karena sudah memiliki riwayat transaksi/stok. Silakan NONAKTIFKAN produk ini saja melalui menu Edit agar tidak muncul di katalog.`,
      show_alert: true
    });
  }
}

// ============================================================
// LAPORAN
// ============================================================
function showDailyReport(bot, chatId, messageId) {
  const sales = orderQueries.getTodaySales.get();
  const pending = orderQueries.getAllPending.all();
  const products = productQueries.getAllIncludeInactive.all();
  const lowStock = productQueries.getLowStock.all();

  let text =
    `*📊 Laporan Statistik Harian*\n` +
    `───\n` +
    `• Pendapatan Hari Ini: *${formatRupiah(sales.total_revenue)}*\n` +
    `• Transaksi Sukses: *${sales.total_orders} transaksi*\n` +
    `• Pesanan Pending: *${pending.length} order*\n\n` +
    `*Status Inventaris Produk:*\n` +
    `• Total Varian Produk: *${products.length} item*\n` +
    `• Produk Stok Menipis: *${lowStock.length} item*\n`;

  if (lowStock.length > 0) {
    text += `\n⚠️ *Daftar Produk Butuh Restock:*\n`;
    for (const p of lowStock) {
      const icon = p.stock <= 0 ? '🔴' : '🟡';
      text += `  ${icon} ${p.name} (Sisa: *${p.stock} unit*)\n`;
    }
  }

  bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [[{ text: '🔙 Menu Admin', callback_data: 'admin_menu' }]],
    },
  }).catch(() => {
    bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
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
    bot.editMessageText('Belum ada riwayat pesanan masuk.', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: adminMenuKeyboard(),
    }).catch(() => {});
    return;
  }

  let text =
    `*📋 Daftar Pesanan Masuk*\n` +
    `───\n` +
    `Menampilkan 20 transaksi terbaru toko:\n\n`;

  const buttons = [];
  for (const order of orders.slice(0, 20)) {
    const emoji = statusEmoji(order.status);
    const label = statusLabel(order.status);
    text += `${emoji} *ID Order:* \`${order.order_id}\`\n` +
            `   Pembeli: ${order.full_name || '-'} (@${order.username || '-'})\n` +
            `   Total: *${formatRupiah(order.total_amount)}* — _${label}_\n\n`;

    buttons.push([{
      text: `${emoji} Detail: ${order.order_id}`,
      callback_data: `admin_order_${order.order_id}`,
    }]);
  }

  buttons.push([{ text: '🔙 Menu Admin', callback_data: 'admin_menu' }]);

  bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons },
  }).catch(() => {
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } }).catch(() => {});
  });
}

function showAdminOrderDetail(bot, chatId, messageId, orderId) {
  const order = orderQueries.getById.get(orderId);
  if (!order) return;

  const items = orderQueries.getItems.all(orderId);
  const emoji = statusEmoji(order.status);
  const label = statusLabel(order.status);

  let text =
    `*📋 Detail Transaksi (Admin)*\n` +
    `───\n` +
    `• ID Order: \`${orderId}\`\n` +
    `• Status: ${emoji} *${label}*\n` +
    `• Tanggal: _${formatDate(order.created_at)}_\n` +
    `• Pembeli: *${order.full_name || '-'}* (@${order.username || '-'})\n` +
    `• Chat ID: \`${order.chat_id}\`\n\n` +
    `*Rincian Item Belanja:*\n`;

  for (const item of items) {
    text += `  • ${item.product_name} (x${item.quantity}) — _${formatRupiah(item.price * item.quantity)}_\n`;
  }
  text += `\nTotal Pembayaran: *${formatRupiah(order.total_amount)}*`;

  const buttons = [];
  if (order.status === 'pending') {
    buttons.push([{ text: '💰 Konfirmasi Pembayaran QRIS (Manual)', callback_data: `confirm_paid_${orderId}` }]);
  }
  if (order.status === 'paid') {
    buttons.push([{ text: '✅ Konfirmasi Pesanan', callback_data: `confirm_order_${orderId}` }]);
  }
  buttons.push([{ text: '🔙 Semua Pesanan', callback_data: 'admin_orders' }]);

  bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons },
  }).catch(() => {});
}

// ============================================================
// LOW STOCK ALERT
// ============================================================
function showLowStock(bot, chatId, messageId) {
  const products = productQueries.getLowStock.all();

  if (products.length === 0) {
    bot.editMessageText('Semua produk memiliki stok aman!', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: adminMenuKeyboard(),
    }).catch(() => {});
    return;
  }

  let text =
    `*⚠️ Produk Stok Menipis*\n` +
    `───\n` +
    `Daftar produk dengan stok kurang dari 5 unit:\n\n`;

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
