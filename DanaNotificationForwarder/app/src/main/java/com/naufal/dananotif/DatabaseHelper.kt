package com.naufal.dananotif

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class DatabaseHelper(context: Context) : SQLiteOpenHelper(context, DATABASE_NAME, null, DATABASE_VERSION) {

    companion object {
        private const val DATABASE_NAME = "DanaNotificationLogs.db"
        private const val DATABASE_VERSION = 1

        const val TABLE_LOGS = "payment_logs"
        const val COLUMN_ID = "id"
        const val COLUMN_AMOUNT = "amount"
        const val COLUMN_SOURCE = "source"
        const val COLUMN_MESSAGE = "message"
        const val COLUMN_STATUS = "status" // SENT, FAILED, IGNORED
        const val COLUMN_TIMESTAMP = "timestamp"
    }

    data class PaymentLog(
        val id: Long,
        val amount: Int,
        val source: String,
        val message: String,
        val status: String,
        val timestamp: String
    )

    override fun onCreate(db: SQLiteDatabase) {
        val createTableQuery = ("CREATE TABLE " + TABLE_LOGS + " ("
                + COLUMN_ID + " INTEGER PRIMARY KEY AUTOINCREMENT, "
                + COLUMN_AMOUNT + " INTEGER, "
                + COLUMN_SOURCE + " TEXT, "
                + COLUMN_MESSAGE + " TEXT, "
                + COLUMN_STATUS + " TEXT, "
                + COLUMN_TIMESTAMP + " TEXT)")
        db.execSQL(createTableQuery)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        db.execSQL("DROP TABLE IF EXISTS $TABLE_LOGS")
        onCreate(db)
    }

    /**
     * Memasukkan log pembayaran baru ke database
     */
    fun insertLog(amount: Int, source: String, message: String, status: String): Long {
        val db = this.writableDatabase
        val values = ContentValues().apply {
            put(COLUMN_AMOUNT, amount)
            put(COLUMN_SOURCE, source)
            put(COLUMN_MESSAGE, message)
            put(COLUMN_STATUS, status)
            put(COLUMN_TIMESTAMP, getCurrentTime())
        }
        val id = db.insert(TABLE_LOGS, null, values)
        db.close()
        return id
    }

    /**
     * Mengambil semua log terurut dari yang terbaru
     */
    fun getAllLogs(): List<PaymentLog> {
        val logsList = ArrayList<PaymentLog>()
        val db = this.readableDatabase
        val selectQuery = "SELECT * FROM $TABLE_LOGS ORDER BY $COLUMN_ID DESC"
        val cursor = db.rawQuery(selectQuery, null)

        if (cursor.moveToFirst()) {
            do {
                val log = PaymentLog(
                    id = cursor.getLong(cursor.getColumnIndexOrThrow(COLUMN_ID)),
                    amount = cursor.getInt(cursor.getColumnIndexOrThrow(COLUMN_AMOUNT)),
                    source = cursor.getString(cursor.getColumnIndexOrThrow(COLUMN_SOURCE)),
                    message = cursor.getString(cursor.getColumnIndexOrThrow(COLUMN_MESSAGE)),
                    status = cursor.getString(cursor.getColumnIndexOrThrow(COLUMN_STATUS)),
                    timestamp = cursor.getString(cursor.getColumnIndexOrThrow(COLUMN_TIMESTAMP))
                )
                logsList.add(log)
            } while (cursor.moveToNext())
        }
        cursor.close()
        db.close()
        return logsList
    }

    /**
     * Menghapus semua log
     */
    fun clearAllLogs() {
        val db = this.writableDatabase
        db.execSQL("DELETE FROM $TABLE_LOGS")
        db.close()
    }

    private fun getCurrentTime(): String {
        val sdf = SimpleDateFormat("dd MMM yyyy, HH:mm:ss", Locale.getDefault())
        return sdf.format(Date())
    }
}
