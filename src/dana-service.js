const { formatRupiah } = require('./utils/formatter');

/**
 * DANA Payment Gateway Service
 *
 * Jika kredensial DANA belum diisi, jalankan dalam mode simulasi.
 * Mode simulasi menghasilkan link pembayaran dummy dan otomatis
 * mengkonfirmasi pembayaran untuk testing.
 */

let danaClient = null;
let isSimulationMode = true;

/**
 * Inisialisasi DANA client
 */
function initDana() {
  const partnerId = process.env.DANA_PARTNER_ID;
  const privateKey = process.env.DANA_PRIVATE_KEY;
  const origin = process.env.DANA_ORIGIN;
  const env = process.env.DANA_ENV || 'sandbox';

  if (!partnerId || !privateKey) {
    console.log('⚠️  DANA kredensial belum diisi — berjalan dalam MODE SIMULASI');
    console.log('   Untuk mengaktifkan DANA, isi DANA_PARTNER_ID dan DANA_PRIVATE_KEY di .env');
    isSimulationMode = true;
    return;
  }

  try {
    const { Dana } = require('dana-node');
    danaClient = new Dana({
      partnerId,
      privateKey,
      origin: origin || 'http://localhost:3000',
      env,
    });
    isSimulationMode = false;
    console.log(`✅ DANA Payment Gateway terhubung (${env})`);
  } catch (error) {
    console.error('❌ Gagal menginisialisasi DANA:', error.message);
    console.log('⚠️  Fallback ke MODE SIMULASI');
    isSimulationMode = true;
  }
}

/**
 * Buat order pembayaran di DANA
 * @param {string} orderId - ID order unik
 * @param {number} amount - Total dalam Rupiah
 * @param {Array} items - Array item pesanan
 * @returns {Object} { paymentUrl, danaReference }
 */
async function createPaymentOrder(orderId, amount, items) {
  if (isSimulationMode) {
    return createSimulatedPayment(orderId, amount, items);
  }

  try {
    const { paymentGatewayApi } = danaClient;

    const webhookUrl = process.env.WEBHOOK_URL || 'http://localhost:3000';
    const merchantId = process.env.DANA_MERCHANT_ID || '';

    const orderRequest = {
      partnerReferenceNo: orderId,
      merchantId: merchantId,
      amount: {
        value: String(amount) + '.00',
        currency: 'IDR',
      },
      urlParams: [
        {
          url: `${webhookUrl}/dana/notify`,
          type: 'PAY_NOTIFY',
          isDeepLink: 'N',
        },
        {
          url: `${webhookUrl}/dana/return`,
          type: 'PAY_RETURN',
          isDeepLink: 'N',
        },
      ],
      validUpTo: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 menit
    };

    const response = await paymentGatewayApi.createOrder(orderRequest);

    return {
      paymentUrl: response.webRedirectUrl || response.paymentUrl || '',
      danaReference: response.referenceNo || response.partnerReferenceNo || orderId,
    };
  } catch (error) {
    console.error('❌ DANA createOrder error:', error);
    // Fallback ke simulasi jika API error
    return createSimulatedPayment(orderId, amount, items);
  }
}

/**
 * Pembayaran simulasi untuk testing tanpa kredensial DANA
 */
function createSimulatedPayment(orderId, amount, items) {
  console.log(`💳 [SIMULASI] Pembayaran dibuat: ${orderId} — ${formatRupiah(amount)}`);

  const simulatedUrl = `${process.env.WEBHOOK_URL || 'http://localhost:3000'}/dana/simulate/${orderId}`;

  return {
    paymentUrl: simulatedUrl,
    danaReference: `SIM-${orderId}`,
    isSimulated: true,
  };
}

/**
 * Verifikasi webhook notification dari DANA
 * @param {Object} payload - Body dari webhook
 * @returns {Object|null} Parsed notification data
 */
function verifyNotification(payload) {
  if (isSimulationMode) {
    // Di mode simulasi, terima semua notifikasi
    return {
      orderId: payload.partnerReferenceNo || payload.orderId,
      status: payload.status || 'SUCCESS',
      danaReference: payload.referenceNo || payload.danaReference || '',
      amount: payload.amount,
    };
  }

  try {
    // Gunakan dana-node WebhookParser jika tersedia
    const { WebhookParser } = require('dana-node');
    const parser = new WebhookParser();
    const notification = parser.parse(payload);

    return {
      orderId: notification.partnerReferenceNo,
      status: notification.status,
      danaReference: notification.referenceNo,
      amount: notification.amount,
    };
  } catch (error) {
    console.error('❌ Verifikasi webhook gagal:', error);
    return null;
  }
}

/**
 * Cek apakah berjalan dalam mode simulasi
 */
function isSimulation() {
  return isSimulationMode;
}

module.exports = {
  initDana,
  createPaymentOrder,
  verifyNotification,
  isSimulation,
};
