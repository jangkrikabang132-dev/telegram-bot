/**
 * Format angka ke format Rupiah
 * @param {number} amount
 * @returns {string} contoh: "Rp 50.000"
 */
function formatRupiah(amount) {
  return 'Rp ' + Number(amount).toLocaleString('id-ID');
}

/**
 * Format tanggal ke lokal Indonesia
 * @param {string|Date} date
 * @returns {string} contoh: "27 Mei 2026, 22:30"
 */
function formatDate(date) {
  const d = new Date(date);
  return d.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  });
}

/**
 * Emoji status order
 * @param {string} status
 * @returns {string}
 */
function statusEmoji(status) {
  const map = {
    pending: '⏳',
    paid: '✅',
    confirmed: '📦',
    cancelled: '❌',
    expired: '⌛',
  };
  return map[status] || '❓';
}

/**
 * Label status order dalam Bahasa Indonesia
 * @param {string} status
 * @returns {string}
 */
function statusLabel(status) {
  const map = {
    pending: 'Menunggu Pembayaran',
    paid: 'Sudah Dibayar',
    confirmed: 'Dikonfirmasi',
    cancelled: 'Dibatalkan',
    expired: 'Kedaluwarsa',
  };
  return map[status] || status;
}

/**
 * Singkat teks jika terlalu panjang
 * @param {string} text
 * @param {number} maxLen
 * @returns {string}
 */
function truncate(text, maxLen = 50) {
  if (!text) return '';
  return text.length > maxLen ? text.substring(0, maxLen - 3) + '...' : text;
}

/**
 * Generate order ID yang readable
 * @returns {string} contoh: "ORD-20260527-A3F2"
 */
function generateOrderId() {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `ORD-${dateStr}-${rand}`;
}

/**
 * Format produk untuk ditampilkan di chat
 */
function formatProduct(product) {
  const stockStatus = product.stock <= 0
    ? '🔴 Habis'
    : product.stock <= 5
      ? `🟡 Sisa ${product.stock}`
      : `🟢 Stok ${product.stock}`;

  let text = `📦 *${escapeMarkdown(product.name)}*\n`;
  if (product.description) {
    text += `${escapeMarkdown(product.description)}\n`;
  }
  text += `\n💰 *${formatRupiah(product.price)}*`;
  text += `\n${stockStatus}`;
  text += `\n🏷️ ${escapeMarkdown(product.category)}`;

  return text;
}

/**
 * Escape karakter khusus MarkdownV2 Telegram
 */
function escapeMarkdown(text) {
  if (!text) return '';
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

module.exports = {
  formatRupiah,
  formatDate,
  statusEmoji,
  statusLabel,
  truncate,
  generateOrderId,
  formatProduct,
  escapeMarkdown,
};
