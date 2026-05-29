package com.naufal.dananotif

import android.app.Notification
import android.content.Context
import android.content.Intent
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import java.util.regex.Pattern

class DanaListenerService : NotificationListenerService() {

    companion object {
        private const val TAG = "DanaListenerService"
        
        // Broadcast Action untuk mengabari MainActivity agar memuat ulang log
        const val ACTION_NOTIFICATION_PROCESSED = "com.naufal.dananotif.NOTIFICATION_PROCESSED"
    }

    private lateinit var dbHelper: DatabaseHelper
    private lateinit var webhookSender: WebhookSender

    override fun onCreate() {
        super.onCreate()
        dbHelper = DatabaseHelper(this)
        webhookSender = WebhookSender(this)
        Log.d(TAG, "DanaListenerService Dibuat")
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        Log.d(TAG, "Notification Listener Terhubung & Aktif")
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        Log.d(TAG, "Notification Listener Terputus")
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        try {
            val packageName = sbn.packageName ?: ""
            val notification = sbn.notification ?: return
            val extras = notification.extras ?: return
            
            val title = extras.getString(Notification.EXTRA_TITLE) ?: ""
            val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""
            
            val fullContent = "$title $text"
            Log.d(TAG, "Notifikasi masuk dari [$packageName]: Title: $title | Text: $text")

            // Ambil preferensi filter dari SharedPreferences
            val prefs = getSharedPreferences("DanaNotifConfig", Context.MODE_PRIVATE)
            val keywordsString = prefs.getString("filter_keywords", "DANA,DANA Bisnis,Menerima,transfer,Rp") ?: ""
            val keywords = keywordsString.split(",").map { it.trim() }.filter { it.isNotEmpty() }

            val targetPackagesString = prefs.getString("target_packages", "id.dana") ?: "id.dana"
            val allowedPackages = targetPackagesString.split(",")
                .map { it.trim() }
                .filter { it.isNotEmpty() }
                .ifEmpty { listOf("id.dana") }

            val isAllowedApp = allowedPackages.any { packageName.equals(it, ignoreCase = true) }
            if (!isAllowedApp) {
                Log.d(TAG, "Notifikasi dari [$packageName] diabaikan karena tidak ada di daftar Aplikasi Target.")
                return
            }

            val isDanaApp = packageName == "id.dana"
            var matchesKeyword = false
            for (keyword in keywords) {
                if (fullContent.contains(keyword, ignoreCase = true)) {
                    matchesKeyword = true
                    break
                }
            }

            if (isDanaApp || matchesKeyword) {
                Log.d(TAG, "⚠️ Notifikasi cocok dengan kriteria filter. Mengekstrak nominal...")
                
                // Cari nominal dalam teks notifikasi
                val amount = extractAmount(fullContent)
                
                if (amount != null && amount > 0) {
                    Log.d(TAG, "💰 Nominal terdeteksi: Rp $amount")
                    
                    // Ambil konfigurasi Webhook
                    val webhookUrl = prefs.getString("webhook_url", "") ?: ""
                    val apiKey = prefs.getString("api_key", "") ?: ""

                    if (webhookUrl.isEmpty()) {
                        Log.w(TAG, "Gagal meneruskan: URL Webhook kosong!")
                        dbHelper.insertLog(
                            amount = amount,
                            source = "$packageName / $title",
                            message = text,
                            status = "FAILED (URL Kosong)"
                        )
                        notifyUI()
                        return
                    }

                    // Kirim ke Webhook Bot Telegram
                    webhookSender.sendPaymentNotification(
                        webhookUrl = webhookUrl,
                        apiKey = apiKey,
                        amount = amount,
                        source = if (isDanaApp) "DANA App" else "Filter: $title",
                        message = text,
                        callback = object : WebhookSender.WebhookCallback {
                            override fun onSuccess(responseString: String) {
                                Log.i(TAG, "✅ Webhook Berhasil: $responseString")
                                dbHelper.insertLog(
                                    amount = amount,
                                    source = if (isDanaApp) "DANA App" else title,
                                    message = text,
                                    status = "SENT"
                                )
                                notifyUI()
                            }

                            override fun onFailure(errorMessage: String) {
                                Log.e(TAG, "❌ Webhook Gagal: $errorMessage")
                                dbHelper.insertLog(
                                    amount = amount,
                                    source = if (isDanaApp) "DANA App" else title,
                                    message = "$text (Error: $errorMessage)",
                                    status = "FAILED"
                                )
                                notifyUI()
                            }
                        }
                    )
                } else {
                    Log.d(TAG, "Abaikan notifikasi: Tidak menemukan pola nominal uang (Rp [angka])")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error processing notification: ${e.message}", e)
        }
    }

    /**
     * Regex parser pintar untuk mengambil angka nominal uang dari sebuah teks
     * Dapat mengenali: "Rp 50.023", "Rp.100.000", "Rp 5,000", "menerima Rp10.000"
     */
    private fun extractAmount(text: String): Int? {
        // Regex untuk mencari pola "Rp" diikuti dengan angka dan pemisah ribuan/desimal
        val patterns = arrayOf(
            Pattern.compile("(?:Rp\\.?|rp\\.?)\\s*([\\d.,]+)"), // Rp 50.000 atau Rp.10.000
            Pattern.compile("([\\d.,]+)\\s*(?:Rupiah|rupiah)"), // 50.000 Rupiah
            Pattern.compile("menerima\\s+([\\d.,]+)")          // menerima 50.000
        )

        for (pattern in patterns) {
            val matcher = pattern.matcher(text)
            if (matcher.find()) {
                val match = matcher.group(1) ?: continue
                
                // Bersihkan string dari pemisah ribuan titik (.) atau koma (,)
                // Di Indonesia, titik sering menjadi pemisah ribuan (Rp 50.000)
                // Kita hilangkan semua karakter non-angka
                val cleanNumber = match.replace(".", "").replace(",", "").replace(" ", "")
                try {
                    return cleanNumber.toInt()
                } catch (e: NumberFormatException) {
                    Log.e(TAG, "Gagal mengkonversi nominal: $match -> $cleanNumber", e)
                }
            }
        }
        
        // Backup: Cari pola angka yang terlihat seperti nominal jika mengandung kata "Rp"
        if (text.contains("Rp", ignoreCase = true) || text.contains("menerima", ignoreCase = true)) {
            val backupPattern = Pattern.compile("([\\d]{1,3}(?:\\.[\\d]{3})+)") // Pola angka ribuan misal 10.000 atau 1.000.000
            val matcher = backupPattern.matcher(text)
            if (matcher.find()) {
                val match = matcher.group(1) ?: return null
                val cleanNumber = match.replace(".", "")
                return cleanNumber.toIntOrNull()
            }
        }

        return null
    }

    /**
     * Kirim broadcast local untuk memberitahu UI agar refresh data log
     */
    private fun notifyUI() {
        val intent = Intent(ACTION_NOTIFICATION_PROCESSED)
        sendBroadcast(intent)
    }
}
