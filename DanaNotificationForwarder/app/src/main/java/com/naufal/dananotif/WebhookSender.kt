package com.naufal.dananotif

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

class WebhookSender(private val context: Context) {

    companion object {
        private const val TAG = "WebhookSender"
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaTypeOrNull()
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    interface WebhookCallback {
        fun onSuccess(responseString: String)
        fun onFailure(errorMessage: String)
    }

    /**
     * Mengirim notifikasi nominal ke Webhook bot Telegram secara Asynchronous
     */
    fun sendPaymentNotification(
        webhookUrl: String,
        apiKey: String,
        amount: Int,
        source: String,
        message: String,
        callback: WebhookCallback
    ) {
        // Normalisasi URL
        var targetUrl = webhookUrl.trim()
        if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
            targetUrl = "https://$targetUrl"
        }
        
        // Pastikan endpoint path sesuai
        if (!targetUrl.endsWith("/api/payment-notify")) {
            targetUrl = if (targetUrl.endsWith("/")) {
                targetUrl + "api/payment-notify"
            } else {
                targetUrl + "/api/payment-notify"
            }
        }

        Log.d(TAG, "Mengirim ke URL: $targetUrl, Amount: $amount")

        // Buat body JSON menggunakan JSONObject bawaan Android (tanpa GSON)
        val jsonPayload = JSONObject().apply {
            put("amount", amount)
            put("source", source)
            put("message", message)
        }

        val requestBody = jsonPayload.toString().toRequestBody(JSON_MEDIA_TYPE)

        val request = Request.Builder()
            .url(targetUrl)
            .post(requestBody)
            .addHeader("x-api-key", apiKey)
            .addHeader("Content-Type", "application/json")
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                val errorMsg = e.message ?: "Koneksi ke server gagal"
                Log.e(TAG, "Request gagal: $errorMsg", e)
                
                // Kembalikan ke main thread
                Handler(Looper.getMainLooper()).post {
                    callback.onFailure(errorMsg)
                }
            }

            override fun onResponse(call: Call, response: Response) {
                val responseBody = response.body?.string() ?: ""
                Log.d(TAG, "Response Code: ${response.code}, Body: $responseBody")

                Handler(Looper.getMainLooper()).post {
                    if (response.isSuccessful) {
                        callback.onSuccess(responseBody)
                    } else {
                        val errorDetail = when (response.code) {
                            401 -> "API Key salah (Unauthorized)"
                            404 -> "Endpoint /api/payment-notify tidak ditemukan"
                            400 -> "Request tidak valid"
                            else -> "Server error (${response.code})"
                        }
                        callback.onFailure(errorDetail)
                    }
                }
            }
        })
    }
}
