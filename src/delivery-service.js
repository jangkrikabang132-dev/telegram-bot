const { orderQueries, digitalItemQueries, productQueries } = require('./database');
const { formatRupiah, formatDate } = require('./utils/formatter');

/**
 * Simulasi animasi kehancuran QRIS di chat Telegram (hitung mundur)
 * kemudian menghapusnya dari chat untuk keamanan dan efek visual premium.
 */
function runQRISDestruction(bot, chatId, messageId, onComplete) {
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  
  (async () => {
    try {
      // Frame 1: Menghancurkan dalam 3
      await bot.editMessageCaption(
        `*Pembayaran Terdeteksi*\n\nMenghapus invoice QRIS dalam 3 detik...`,
        { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
      ).catch((err) => console.error('[QRIS-ANIMATION] Frame 1 Error:', err.message));
      await delay(1000);
      
      // Frame 2: Menghancurkan dalam 2
      await bot.editMessageCaption(
        `*Pembayaran Terdeteksi*\n\nMenghapus invoice QRIS dalam 2 detik...`,
        { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
      ).catch((err) => console.error('[QRIS-ANIMATION] Frame 2 Error:', err.message));
      await delay(1000);
      
      // Frame 3: Menghancurkan dalam 1
      await bot.editMessageCaption(
        `*Pembayaran Terdeteksi*\n\nMenghapus invoice QRIS dalam 1 detik...`,
        { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
      ).catch((err) => console.error('[QRIS-ANIMATION] Frame 3 Error:', err.message));
      await delay(1000);
      
      // Frame 4: Meledak / Hancur
      await bot.editMessageCaption(
        `*QRIS Telah Dihapus!*`,
        { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
      ).catch((err) => console.error('[QRIS-ANIMATION] Frame 4 Error:', err.message));
      await delay(1000);
      
      // Hapus pesan foto QRIS asli
      await bot.deleteMessage(chatId, messageId).catch((err) => console.error('[QRIS-ANIMATION] Delete Error:', err.message));
    } catch (e) {
      console.error('QRIS Destruction Animation error:', e);
    } finally {
      onComplete();
    }
  })();
}

/**
 * Memproses kelulusan/pembayaran order dan mengirimkan produk digital ke pembeli.
 * Fungsi ini menyatukan logika dari webhook, admin manual, api, dan manual checker.
 *
 * @param {object} bot - Instansi bot Telegram
 * @param {string} orderId - ID Pesanan
 * @param {number} paidAmount - Nominal pembayaran riil yang diterima (opsional)
 * @param {object} options - Opsi tambahan (seperti qrisMessageId)
 */
async function processOrderDelivery(bot, orderId, paidAmount = null, options = {}) {
  try {
    const order = orderQueries.getById.get(orderId);
    if (!order) {
      console.error(`❌ [DELIVERY] Order ${orderId} tidak ditemukan.`);
      return { status: 'not_found', message: 'Order tidak ditemukan' };
    }

    if (order.status === 'paid' || order.status === 'confirmed') {
      console.log(`ℹ️ [DELIVERY] Order ${orderId} sudah pernah diproses/dikirim.`);
      return { status: 'already_processed', order };
    }

    // 1. Konfirmasi Pembayaran di Database (status jadi paid)
    orderQueries.confirmPayment.run(orderId);
    const finalPaidAmount = paidAmount || order.unique_amount || order.total_amount;

    console.log(`⚡ [DELIVERY] Memproses pengiriman untuk order ${orderId} (Nominal: ${formatRupiah(finalPaidAmount)})`);

    // 2. Ambil item dalam pesanan
    const items = orderQueries.getItems.all(orderId);
    const itemList = items.map(i =>
      `• *${i.product_name}* (x${i.quantity}) — _${formatRupiah(i.price * i.quantity)}_`
    ).join('\n');

    // 3. Ambil dan klaim akun/tautan digital jika ada
    const claimedDigitalItems = [];
    for (const item of items) {
      const unusedAccounts = digitalItemQueries.getUnused.all(item.product_id, item.quantity);
      
      if (unusedAccounts.length > 0) {
        for (const account of unusedAccounts) {
          digitalItemQueries.claim.run(orderId, account.id);
          claimedDigitalItems.push({
            productName: item.product_name,
            content: account.content
          });
        }
      }
    }

    // 4. Format detail akun/layanan digital
    let digitalItemsText = '';
    if (claimedDigitalItems.length > 0) {
      digitalItemsText = `\n🔑 *Credentials / Detail Produk Digital:*\n` +
        `───\n`;
      
      claimedDigitalItems.forEach((acc, idx) => {
        const parts = acc.content.split(':');
        if (parts.length >= 2) {
          const username = parts[0].trim();
          const password = parts.slice(1).join(':').trim();
          
          digitalItemsText += `📂 *Item #${idx + 1} (${acc.productName}):*\n` +
            `👤 Username/Email: \`${username}\`\n` +
            `🔑 Password: \`${password}\`\n` +
            `───\n`;
        } else {
          // Jika format biasa (voucher / link tautan)
          digitalItemsText += `📂 *Item #${idx + 1} (${acc.productName}):*\n` +
            `🔗 Detail/Tautan: \`${acc.content}\`\n` +
            `───\n`;
        }
      });
      digitalItemsText += `💡 _Ketuk tulisan abu-abu di atas untuk menyalin._\n`;
    } else {
      digitalItemsText = `\n⚠️ *Pemberitahuan:* Stok digital sedang kosong. Admin kami akan segera memproses detail produk Anda secara manual dan mengirimkannya ke chat ini. Terima kasih atas kesabaran Anda! 🙏\n`;
    }

    // 4.5. Ambil petunjuk cara penggunaan untuk produk
    let instructionsText = '';
    for (const item of items) {
      const product = productQueries.getById.get(item.product_id);
      if (product && product.usage_instructions) {
        instructionsText += `\n📖 *Cara Penggunaan (${item.product_name}):*\n` +
          `_${product.usage_instructions}_\n`;
      }
    }

    // 5. Fungsi kirim pesan sukses akhir ke pembeli
    const sendBuyerSuccessMessage = async () => {
      const buyerText =
        `*Pembayaran Berhasil & Terverifikasi*\n\n` +
        `Terima kasih! Pembayaran Anda sebesar *${formatRupiah(finalPaidAmount)}* telah sukses diterima.\n\n` +
        `*Ringkasan Pesanan:*\n` +
        `• ID Order: \`${order.order_id}\`\n` +
        `• Tanggal: _${formatDate(new Date())}_\n` +
        `• Status: *Lunas*\n\n` +
        `*Item Yang Dibeli:*\n` +
        `${itemList}\n` +
        digitalItemsText +
        (instructionsText ? `\n` + instructionsText : '') +
        `\nTerima kasih telah berbelanja di toko kami! Jika ada kendala, hubungi admin di Telegram: @Naufal_090`;

      await bot.sendMessage(parseInt(order.chat_id), buyerText, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📋 Pesanan Saya', callback_data: 'my_orders' }],
            [{ text: '🛍️ Belanja Lagi', callback_data: 'catalog' }],
          ],
        },
      }).catch(console.error);
    };

    // 6. Jalankan dengan animasi jika ada qrisMessageId (terutama dari Webhook otomatis)
    const qrisMessageId = options.qrisMessageId || order.payment_url;
    if (qrisMessageId && !isNaN(parseInt(qrisMessageId)) && options.useAnimation) {
      runQRISDestruction(bot, parseInt(order.chat_id), parseInt(qrisMessageId), () => {
        sendBuyerSuccessMessage();
      });
    } else {
      // Jika dari konfirmasi manual admin atau qrisMessageId tidak valid, langsung kirim
      if (qrisMessageId && !isNaN(parseInt(qrisMessageId))) {
        // Hapus langsung tanpa animasi
        bot.deleteMessage(parseInt(order.chat_id), parseInt(qrisMessageId)).catch(() => {});
      }
      await sendBuyerSuccessMessage();
    }

    // 7. Kirim notifikasi sukses ke Admin
    const adminChatId = process.env.ADMIN_CHAT_ID;
    if (adminChatId) {
      let adminDigitalDetails = '';
      if (claimedDigitalItems.length > 0) {
        adminDigitalDetails = `\n🔑 *Detail Akun Terkirim:* \n` +
          claimedDigitalItems.map(a => `• ${a.productName}: \`${a.content}\``).join('\n') + `\n`;
      }

      const adminText =
        `*Pembayaran Masuk & Lunas*\n\n` +
        `• Order ID: \`${order.order_id}\`\n` +
        `• Pembeli: ${order.full_name || '-'} (@${order.username || '-'})\n` +
        `• Chat ID: \`${order.chat_id}\`\n` +
        `• Nominal Diterima: *${formatRupiah(finalPaidAmount)}*\n\n` +
        `*Item Terkait:*\n${itemList}\n` +
        adminDigitalDetails +
        `\nStatus: LUNAS / SELESAI`;

      bot.sendMessage(parseInt(adminChatId), adminText, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📋 Lihat Detail', callback_data: `admin_order_${order.order_id}` }],
          ],
        },
      }).catch(console.error);
    }

    return { status: 'success', order };
  } catch (error) {
    console.error('❌ [DELIVERY] Gagal memproses pengiriman produk:', error);
    return { status: 'error', message: error.message };
  }
}

module.exports = {
  processOrderDelivery
};
