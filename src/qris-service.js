const QRCode = require('qrcode');

/**
 * QRIS Service — Generate QRIS Dinamis dari payload statis
 *
 * Payload statis di-extract dari src/qris/qris.jpg
 * Dimodifikasi agar support custom nominal (QRIS dinamis)
 */

// Payload statis ORIGINAL (tanpa CRC / tag 63)
// Tag 01 = "11" (statis), akan diubah ke "12" (dinamis) saat generate
const STATIC_PAYLOAD_BASE =
  '00020101021126570011ID.DANA.WWW011893600915325018775602092501877560303UMI' +
  '51440014ID.CO.QRIS.WWW0215ID10254497674130303UMI' +
  '5204549953033605802ID5906Naufal60043615610532382';

// ============================================================
// TLV PARSER & BUILDER
// ============================================================

/**
 * Parse EMV QR TLV payload menjadi array of { tag, value }
 * @param {string} payload - Raw TLV string
 * @returns {Array<{tag: string, value: string}>}
 */
function parseTLV(payload) {
  const tags = [];
  let pos = 0;

  while (pos < payload.length) {
    if (pos + 4 > payload.length) break;

    const tag = payload.substring(pos, pos + 2);
    const len = parseInt(payload.substring(pos + 2, pos + 4), 10);

    if (isNaN(len) || pos + 4 + len > payload.length) break;

    const value = payload.substring(pos + 4, pos + 4 + len);
    tags.push({ tag, value });

    pos += 4 + len;
  }

  return tags;
}

/**
 * Build TLV string dari array of { tag, value }
 * @param {Array<{tag: string, value: string}>} tags
 * @returns {string}
 */
function buildTLV(tags) {
  return tags.map(({ tag, value }) => {
    const len = String(value.length).padStart(2, '0');
    return `${tag}${len}${value}`;
  }).join('');
}

// ============================================================
// CRC-16/CCITT-FALSE
// ============================================================

/**
 * Hitung CRC-16/CCITT-FALSE
 * Polynomial: 0x1021, Init: 0xFFFF
 * @param {string} str - Input string
 * @returns {string} CRC sebagai 4-char uppercase hex
 */
function calculateCRC16(str) {
  let crc = 0xFFFF;

  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc = crc << 1;
      }
      crc &= 0xFFFF;
    }
  }

  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// ============================================================
// QRIS DYNAMIC GENERATOR
// ============================================================

/**
 * Generate payload QRIS dinamis dengan nominal tertentu
 *
 * Perubahan dari statis:
 * - Tag 01: "11" (static) → "12" (dynamic, nominal fixed)
 * - Tag 54: Ditambahkan dengan nilai nominal
 * - Tag 63: CRC di-recalculate
 *
 * @param {number} amount - Nominal pembayaran dalam Rupiah (integer)
 * @returns {string} QRIS payload string lengkap (siap dijadikan QR code)
 */
function generateDynamicQRIS(amount) {
  // Parse payload statis
  const tags = parseTLV(STATIC_PAYLOAD_BASE);

  // Hapus CRC jika ada (tag 63)
  const filteredTags = tags.filter(t => t.tag !== '63');

  // Ubah tag 01 dari "11" (static) ke "12" (dynamic)
  for (const tag of filteredTags) {
    if (tag.tag === '01') {
      tag.value = '12';
    }
  }

  // Sisipkan tag 54 (Transaction Amount) setelah tag 53 (Currency)
  const amountStr = String(amount);
  const tag54 = { tag: '54', value: amountStr };

  // Cari posisi tag 53, sisipkan tag 54 setelahnya
  const idx53 = filteredTags.findIndex(t => t.tag === '53');
  if (idx53 !== -1) {
    // Hapus tag 54 lama jika ada
    const idx54 = filteredTags.findIndex(t => t.tag === '54');
    if (idx54 !== -1) filteredTags.splice(idx54, 1);

    // Sisipkan setelah tag 53
    const insertPos = filteredTags.findIndex(t => t.tag === '53');
    filteredTags.splice(insertPos + 1, 0, tag54);
  } else {
    filteredTags.push(tag54);
  }

  // Build payload tanpa CRC
  let payload = buildTLV(filteredTags);

  // Tambahkan tag 63 placeholder (6304) lalu hitung CRC
  payload += '6304';
  const crc = calculateCRC16(payload);
  payload += crc;

  return payload;
}

/**
 * Generate QR code image buffer (PNG) dari QRIS payload
 *
 * @param {string} payload - QRIS payload string
 * @returns {Promise<Buffer>} PNG image buffer
 */
async function generateQRImage(payload) {
  const buffer = await QRCode.toBuffer(payload, {
    type: 'png',
    width: 512,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#000000',
      light: '#FFFFFF',
    },
  });

  return buffer;
}

/**
 * Generate QRIS dinamis lengkap — payload + QR image
 *
 * @param {number} amount - Nominal pembayaran dalam Rupiah
 * @returns {Promise<{payload: string, qrBuffer: Buffer}>}
 */
async function generateQRIS(amount) {
  const payload = generateDynamicQRIS(amount);
  const qrBuffer = await generateQRImage(payload);

  return { payload, qrBuffer };
}

module.exports = {
  generateDynamicQRIS,
  generateQRImage,
  generateQRIS,
  parseTLV,
  buildTLV,
  calculateCRC16,
};
