require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const { initDatabase, expireOldOrders } = require('./database');
const { createWebhookServer, setBotInstance } = require('./webhook-server');

// Handlers
const { registerStartHandlers } = require('./handlers/start');
const { registerCatalogHandlers } = require('./handlers/catalog');
const { registerCheckoutHandlers } = require('./handlers/checkout');
const { registerOrderHandlers } = require('./handlers/orders');
const { registerAdminHandlers } = require('./handlers/admin');
const { registerPaymentChecker } = require('./payment-checker');

// ============================================================
// VALIDASI ENVIRONMENT
// ============================================================
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN tidak ditemukan di .env!');
  console.error('   Pastikan file .env sudah diisi dengan token bot dari @BotFather');
  process.exit(1);
}

console.log('');
console.log('╔══════════════════════════════════════════╗');
console.log('║    🤖 Bot Telegram Toko Online           ║');
console.log('║    📱 Payment: QRIS Dinamis              ║');
console.log('╚══════════════════════════════════════════╝');
console.log('');

// ============================================================
// INISIALISASI
// ============================================================

// 1. Database
console.log('📦 Menginisialisasi database...');
initDatabase();

// 2. Telegram Bot
console.log('🤖 Menginisialisasi Telegram Bot...');
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// 3. Webhook Server
const PORT = process.env.PORT || 3000;
const app = createWebhookServer();
setBotInstance(bot);

app.listen(PORT, () => {
  console.log(`🌐 Webhook server berjalan di port ${PORT}`);
});

// ============================================================
// REGISTER HANDLERS
// ============================================================
console.log('📝 Mendaftarkan handlers...');

registerStartHandlers(bot);
registerCatalogHandlers(bot);
registerCheckoutHandlers(bot);
registerOrderHandlers(bot);
registerAdminHandlers(bot);
registerPaymentChecker(bot);

// ============================================================
// SCHEDULED TASKS
// ============================================================

// Expire pending orders setiap 5 menit
setInterval(() => {
  try {
    const expired = expireOldOrders();
    if (expired.length > 0) {
      console.log(`⏰ ${expired.length} order expired`);

      // Notifikasi pembeli bahwa ordernya expired
      for (const order of expired) {
        bot.sendMessage(order.chat_id,
          `⌛ Order \`${order.order_id}\` kedaluwarsa karena belum dibayar dalam 30 menit.\n` +
          `Stok sudah dikembalikan. Silakan buat pesanan baru jika masih ingin membeli.`,
          { parse_mode: 'Markdown' }
        ).catch(console.error);
      }
    }
  } catch (error) {
    console.error('Error expiring orders:', error);
  }
}, 5 * 60 * 1000); // 5 menit

// ============================================================
// ERROR HANDLING
// ============================================================
bot.on('polling_error', (error) => {
  console.error('❌ Polling error:', error.code, error.message);
});

bot.on('error', (error) => {
  console.error('❌ Bot error:', error.message);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled Rejection:', error);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Mematikan bot...');
  bot.stopPolling();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Mematikan bot...');
  bot.stopPolling();
  process.exit(0);
});

// ============================================================
// STARTUP INFO
// ============================================================
console.log('');
console.log('✅ Bot berhasil dijalankan!');
console.log('');

const adminId = process.env.ADMIN_CHAT_ID;
if (!adminId) {
  console.log('⚠️  ADMIN_CHAT_ID belum diset di .env');
  console.log('   Semua user bisa akses menu admin (untuk setup awal)');
  console.log('   Dapatkan Chat ID dari @userinfobot, lalu isi di .env');
} else {
  console.log(`👑 Admin Chat ID: ${adminId}`);
}

console.log('');
console.log('📱 Buka Telegram dan cari bot Anda, lalu kirim /start');
console.log('👑 Kirim /admin untuk menu pengelolaan produk & stok');
console.log('');
