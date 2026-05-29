/**
 * Helper untuk membuat inline keyboard & reply keyboard Telegram
 */

/**
 * Reply keyboard persistent di bawah chat (menu utama)
 * Mirip tampilan bot premium — selalu tampil di bawah chat
 */
function replyMenuKeyboard() {
  return {
    keyboard: [
      [
        { text: '📁 List Produk' },
        { text: '📋 Pesanan' },
      ],
      [
        { text: '📱 Cara Order' },
        { text: 'ℹ️ Informasi' },
      ],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

/**
 * Menu utama untuk pembeli
 */
function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🛍️ Lihat Produk', callback_data: 'catalog' },
        { text: '🛒 Keranjang', callback_data: 'cart' },
      ],
      [
        { text: '📋 Pesanan Saya', callback_data: 'my_orders' },
        { text: '❓ Bantuan', callback_data: 'help' },
      ],
    ],
  };
}

/**
 * Menu admin
 */
function adminMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '➕ Tambah Produk', callback_data: 'admin_add_product' },
        { text: '📦 Kelola Stok', callback_data: 'admin_stock' },
      ],
      [
        { text: '✏️ Edit Produk', callback_data: 'admin_edit_list' },
        { text: '🗑️ Hapus Produk', callback_data: 'admin_delete_list' },
      ],
      [
        { text: '📋 Semua Pesanan', callback_data: 'admin_orders' },
        { text: '📊 Laporan Toko', callback_data: 'admin_report' },
      ],
      [
        { text: '⚠️ Stok Menipis', callback_data: 'admin_low_stock' },
        { text: '🔙 Menu Utama', callback_data: 'main_menu' },
      ],
    ],
  };
}

/**
 * Daftar kategori sebagai tombol
 */
function categoryKeyboard(categories) {
  const buttons = categories.map((cat) => [
    { text: `📁 ${cat.category}`, callback_data: `cat_${cat.category}` },
  ]);
  buttons.push([
    { text: '📋 Semua Produk', callback_data: 'catalog_all' },
  ]);
  buttons.push([
    { text: '🔙 Menu Utama', callback_data: 'main_menu' },
  ]);
  return { inline_keyboard: buttons };
}

/**
 * Tombol produk (beli / tambah ke keranjang)
 */
function productKeyboard(productId, inStock) {
  const buttons = [];
  if (inStock) {
    buttons.push([
      { text: '🛒 Tambah ke Keranjang', callback_data: `add_cart_${productId}` },
    ]);
  } else {
    buttons.push([
      { text: '🔴 Stok Habis', callback_data: 'out_of_stock' },
    ]);
  }
  buttons.push([
    { text: '🔙 Kembali ke Katalog', callback_data: 'catalog' },
  ]);
  return { inline_keyboard: buttons };
}

/**
 * Tombol keranjang item
 */
function cartItemKeyboard(productId) {
  return {
    inline_keyboard: [
      [
        { text: '➕', callback_data: `cart_inc_${productId}` },
        { text: '➖', callback_data: `cart_dec_${productId}` },
        { text: '🗑️ Hapus', callback_data: `cart_rm_${productId}` },
      ],
    ],
  };
}

/**
 * Tombol keranjang utama
 */
function cartMainKeyboard(hasItems) {
  if (!hasItems) {
    return {
      inline_keyboard: [
        [{ text: '🛍️ Lihat Produk', callback_data: 'catalog' }],
        [{ text: '🔙 Menu Utama', callback_data: 'main_menu' }],
      ],
    };
  }
  return {
    inline_keyboard: [
      [
        { text: '💳 Checkout & Bayar', callback_data: 'checkout' },
      ],
      [
        { text: '🗑️ Kosongkan Keranjang', callback_data: 'cart_clear' },
        { text: '🛍️ Lanjut Belanja', callback_data: 'catalog' },
      ],
      [
        { text: '🔙 Menu Utama', callback_data: 'main_menu' },
      ],
    ],
  };
}

/**
 * Tombol konfirmasi
 */
function confirmKeyboard(yesData, noData) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Ya', callback_data: yesData },
        { text: '❌ Tidak', callback_data: noData },
      ],
    ],
  };
}

/**
 * Daftar produk sebagai tombol (untuk admin edit/hapus)
 */
function productListKeyboard(products, actionPrefix) {
  const buttons = products.map((p) => [
    {
      text: `${p.is_active ? '🟢' : '🔴'} ${p.name} (Stok: ${p.stock})`,
      callback_data: `${actionPrefix}_${p.id}`,
    },
  ]);
  buttons.push([{ text: '🔙 Menu Admin', callback_data: 'admin_menu' }]);
  return { inline_keyboard: buttons };
}

/**
 * Tombol edit produk
 */
function editProductKeyboard(productId) {
  return {
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
        { text: product => product.is_active ? '🔴 Nonaktifkan' : '🟢 Aktifkan', callback_data: `edit_toggle_${productId}` },
      ],
      [
        { text: '🔙 Menu Admin', callback_data: 'admin_menu' },
      ],
    ],
  };
}

/**
 * Tombol navigasi pagination
 */
function paginationKeyboard(currentPage, totalPages, prefix) {
  const buttons = [];
  if (currentPage > 1) {
    buttons.push({ text: '⬅️ Sebelumnya', callback_data: `${prefix}_page_${currentPage - 1}` });
  }
  if (currentPage < totalPages) {
    buttons.push({ text: '➡️ Selanjutnya', callback_data: `${prefix}_page_${currentPage + 1}` });
  }
  return buttons.length > 0 ? [buttons] : [];
}

/**
 * Tombol admin untuk stok produk
 */
function stockManageKeyboard(productId) {
  return {
    inline_keyboard: [
      [
        { text: '➕ +1', callback_data: `stock_add_${productId}_1` },
        { text: '➕ +5', callback_data: `stock_add_${productId}_5` },
        { text: '➕ +10', callback_data: `stock_add_${productId}_10` },
      ],
      [
        { text: '➕ +25', callback_data: `stock_add_${productId}_25` },
        { text: '➕ +50', callback_data: `stock_add_${productId}_50` },
        { text: '➕ +100', callback_data: `stock_add_${productId}_100` },
      ],
      [
        { text: '➖ -1', callback_data: `stock_sub_${productId}_1` },
        { text: '➖ -5', callback_data: `stock_sub_${productId}_5` },
        { text: '✏️ Set Manual', callback_data: `stock_set_${productId}` },
      ],
      [
        { text: '🔑 Input Akun', callback_data: `stock_add_digital_${productId}` },
        { text: '🔗 Input Link', callback_data: `stock_add_link_${productId}` },
      ],
      [
        { text: '🔙 Kembali', callback_data: 'admin_stock' },
      ],
    ],
  };
}

/**
 * Keyboard untuk quick stock — pilih produk untuk tambah stok cepat
 */
function quickStockKeyboard(products) {
  const buttons = products.map((p) => {
    const stockIcon = p.stock <= 0 ? '🔴' : p.stock <= 5 ? '🟡' : '🟢';
    return [{
      text: `${stockIcon} ${p.name} (Stok: ${p.stock})`,
      callback_data: `quick_stock_${p.id}`,
    }];
  });
  buttons.push([{ text: '🔙 Menu Admin', callback_data: 'admin_menu' }]);
  return { inline_keyboard: buttons };
}

module.exports = {
  replyMenuKeyboard,
  mainMenuKeyboard,
  adminMenuKeyboard,
  categoryKeyboard,
  productKeyboard,
  cartItemKeyboard,
  cartMainKeyboard,
  confirmKeyboard,
  productListKeyboard,
  editProductKeyboard,
  paginationKeyboard,
  stockManageKeyboard,
  quickStockKeyboard,
};
