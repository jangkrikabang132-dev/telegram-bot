package com.naufal.dananotif

import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.service.notification.NotificationListenerService
import android.util.Log

class BootReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "BootReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        Log.d(TAG, "Menerima broadcast: $action")

        if (Intent.ACTION_BOOT_COMPLETED == action || "android.intent.action.QUICKBOOT_POWERON" == action) {
            Log.i(TAG, "Sistem Android selesai melakukan booting. Memulai ulang DanaListenerService...")
            
            // Re-bind listener service untuk memastikan koneksi berjalan kembali setelah HP reboot
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                try {
                    val componentName = ComponentName(context, DanaListenerService::class.java)
                    NotificationListenerService.requestRebind(componentName)
                    Log.i(TAG, "RequestRebind berhasil dipicu untuk DanaListenerService")
                } catch (e: Exception) {
                    Log.e(TAG, "Gagal memicu requestRebind: ${e.message}", e)
                }
            }
        }
    }
}
