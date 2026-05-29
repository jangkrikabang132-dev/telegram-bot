package com.naufal.dananotif

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.SharedPreferences
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.TextUtils
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.LinearLayoutManager
import com.naufal.dananotif.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var dbHelper: DatabaseHelper
    private lateinit var logAdapter: LogAdapter
    private lateinit var prefs: SharedPreferences
    private lateinit var webhookSender: WebhookSender

    // BroadcastReceiver untuk menerima update dari DanaListenerService secara real-time
    private val notificationReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == DanaListenerService.ACTION_NOTIFICATION_PROCESSED) {
                loadLogs()
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        dbHelper = DatabaseHelper(this)
        webhookSender = WebhookSender(this)
        prefs = getSharedPreferences("DanaNotifConfig", Context.MODE_PRIVATE)

        setupUI()
        loadConfig()
        setupRecyclerView()
        loadLogs()
        
        // Registrasi broadcast receiver secara aman untuk Android 14+ (API 34)
        ContextCompat.registerReceiver(
            this,
            notificationReceiver,
            IntentFilter(DanaListenerService.ACTION_NOTIFICATION_PROCESSED),
            ContextCompat.RECEIVER_NOT_EXPORTED
        )
    }

    override fun onResume() {
        super.onResume()
        checkServiceStatus()
        loadLogs()
    }

    override fun onDestroy() {
        super.onDestroy()
        unregisterReceiver(notificationReceiver)
    }

    private fun setupUI() {
        // Tombol Simpan Konfigurasi
        binding.btnSave.setOnClickListener {
            saveConfig()
        }

        // Tombol Request Izin Akses Notifikasi
        binding.btnPermission.setOnClickListener {
            try {
                val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1) {
                    Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
                } else {
                    Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS")
                }
                startActivity(intent)
            } catch (e: Exception) {
                Toast.makeText(this, "Gagal membuka pengaturan: ${e.message}", Toast.LENGTH_LONG).show()
            }
        }

        // Tombol Kirim Uji Coba Manual
        binding.btnSendTest.setOnClickListener {
            sendManualTest()
        }

        // Tombol Hapus Semua Log
        binding.btnClearLogs.setOnClickListener {
            dbHelper.clearAllLogs()
            loadLogs()
            Toast.makeText(this, "Log berhasil dihapus", Toast.LENGTH_SHORT).show()
        }
    }

    private fun setupRecyclerView() {
        binding.rvLogs.layoutManager = LinearLayoutManager(this)
        logAdapter = LogAdapter(ArrayList())
        binding.rvLogs.adapter = logAdapter
    }

    /**
     * Memuat konfigurasi yang tersimpan di SharedPreferences ke kolom UI
     */
    private fun loadConfig() {
        val webhookUrl = prefs.getString("webhook_url", "https://decidable-unlucky-upscale.ngrok-free.dev") ?: ""
        val apiKey = prefs.getString("api_key", "rahasia-bot-toko-2026") ?: ""
        val filterKeywords = prefs.getString("filter_keywords", "DANA,DANA Bisnis,Menerima,transfer,Rp") ?: ""

        binding.etWebhookUrl.setText(webhookUrl)
        binding.etApiKey.setText(apiKey)
        binding.etFilterKeywords.setText(filterKeywords)
    }

    /**
     * Menyimpan konfigurasi dari UI ke SharedPreferences
     */
    private fun saveConfig() {
        val url = binding.etWebhookUrl.text.toString().trim()
        val key = binding.etApiKey.text.toString().trim()
        val keywords = binding.etFilterKeywords.text.toString().trim()

        if (url.isEmpty()) {
            binding.etWebhookUrl.error = "URL Webhook wajib diisi!"
            return
        }

        prefs.edit().apply {
            putString("webhook_url", url)
            putString("api_key", key)
            putString("filter_keywords", keywords)
            apply()
        }

        Toast.makeText(this, "Konfigurasi Berhasil Disimpan!", Toast.LENGTH_SHORT).show()
    }

    /**
     * Mengecek apakah izin Notification Listener sudah diberikan oleh user
     */
    private fun isNotificationServiceEnabled(): Boolean {
        val pkgName = packageName
        val flat = Settings.Secure.getString(contentResolver, "enabled_notification_listeners")
        if (!TextUtils.isEmpty(flat)) {
            val names = flat.split(":")
            for (name in names) {
                val cn = android.content.ComponentName.unflattenFromString(name)
                if (cn != null && TextUtils.equals(pkgName, cn.packageName)) {
                    return true
                }
            }
        }
        return false
    }

    /**
     * Memperbarui status Service di UI berdasarkan izin yang diberikan
     */
    private fun checkServiceStatus() {
        val isEnabled = isNotificationServiceEnabled()
        if (isEnabled) {
            binding.tvServiceStatus.text = getString(R.string.status_service_running)
            binding.tvServiceStatus.setTextColor(ContextCompat.getColor(this, R.color.status_success))
            binding.imgStatusIndicator.setImageResource(android.R.drawable.presence_online)
            binding.imgStatusIndicator.setColorFilter(ContextCompat.getColor(this, R.color.status_success))
            binding.btnPermission.text = "Izin Sudah Aktif"
            binding.btnPermission.isEnabled = true // Tetap izinkan user masuk pengaturan jika ingin mematikan
        } else {
            binding.tvServiceStatus.text = getString(R.string.status_service_stopped)
            binding.tvServiceStatus.setTextColor(ContextCompat.getColor(this, R.color.status_failed))
            binding.imgStatusIndicator.setImageResource(android.R.drawable.presence_offline)
            binding.imgStatusIndicator.setColorFilter(ContextCompat.getColor(this, R.color.status_failed))
            binding.btnPermission.text = getString(R.string.btn_grant_permission)
            binding.btnPermission.isEnabled = true
        }
    }

    /**
     * Mengirim payload nominal manual ke Webhook untuk simulasi/testing
     */
    private fun sendManualTest() {
        val amountStr = binding.etTestAmount.text.toString().trim()
        if (amountStr.isEmpty()) {
            binding.etTestAmount.error = "Masukkan nominal!"
            return
        }

        val amount = amountStr.toIntOrNull()
        if (amount == null || amount <= 0) {
            binding.etTestAmount.error = "Nominal tidak valid!"
            return
        }

        val url = binding.etWebhookUrl.text.toString().trim()
        val key = binding.etApiKey.text.toString().trim()

        if (url.isEmpty()) {
            Toast.makeText(this, "Simpan URL Webhook terlebih dahulu!", Toast.LENGTH_LONG).show()
            return
        }

        binding.btnSendTest.isEnabled = false
        Toast.makeText(this, "Mengirim uji coba Rp $amount...", Toast.LENGTH_SHORT).show()

        webhookSender.sendPaymentNotification(
            webhookUrl = url,
            apiKey = key,
            amount = amount,
            source = "Manual Test (App)",
            message = "Pengujian manual pengiriman pembayaran sebesar Rp $amount dari aplikasi.",
            callback = object : WebhookSender.WebhookCallback {
                override fun onSuccess(responseString: String) {
                    binding.btnSendTest.isEnabled = true
                    Toast.makeText(this@MainActivity, "✅ Sukses Terkirim & Terkonfirmasi!", Toast.LENGTH_LONG).show()
                    
                    // Simpan ke database log lokal
                    dbHelper.insertLog(
                        amount = amount,
                        source = "Manual Test",
                        message = "Uji coba sukses: $responseString",
                        status = "SENT"
                    )
                    loadLogs()
                }

                override fun onFailure(errorMessage: String) {
                    binding.btnSendTest.isEnabled = true
                    Toast.makeText(this@MainActivity, "❌ Gagal: $errorMessage", Toast.LENGTH_LONG).show()
                    
                    // Simpan ke database log lokal
                    dbHelper.insertLog(
                        amount = amount,
                        source = "Manual Test",
                        message = "Gagal kirim: $errorMessage",
                        status = "FAILED"
                    )
                    loadLogs()
                }
            }
        )
    }

    /**
     * Mengambil log dari SQLite dan memperbarui RecyclerView
     */
    private fun loadLogs() {
        val logs = dbHelper.getAllLogs()
        if (logs.isEmpty()) {
            binding.tvNoLogs.visibility = View.VISIBLE
            binding.rvLogs.visibility = View.GONE
        } else {
            binding.tvNoLogs.visibility = View.GONE
            binding.rvLogs.visibility = View.VISIBLE
            logAdapter.updateData(logs)
        }
    }
}
