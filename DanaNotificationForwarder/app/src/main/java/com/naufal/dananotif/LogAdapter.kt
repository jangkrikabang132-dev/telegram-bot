package com.naufal.dananotif

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.RecyclerView
import java.text.NumberFormat
import java.util.Locale

class LogAdapter(private var logsList: List<DatabaseHelper.PaymentLog>) :
    RecyclerView.Adapter<LogAdapter.LogViewHolder>() {

    class LogViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        val tvAmount: TextView = itemView.findViewById(R.id.tvLogAmount)
        val tvStatus: TextView = itemView.findViewById(R.id.tvLogStatus)
        val tvSource: TextView = itemView.findViewById(R.id.tvLogSource)
        val tvTime: TextView = itemView.findViewById(R.id.tvLogTime)
        val tvMessage: TextView = itemView.findViewById(R.id.tvLogMessage)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): LogViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_log, parent, false)
        return LogViewHolder(view)
    }

    override fun onBindViewHolder(holder: LogViewHolder, position: Int) {
        val log = logsList[position]
        
        // Format nominal Rupiah
        holder.tvAmount.text = formatRupiah(log.amount)
        holder.tvSource.text = log.source
        holder.tvMessage.text = log.message
        
        // Ekstrak jam dan tanggal (Ambil bagian waktu dari tanggal lengkap)
        holder.tvTime.text = log.timestamp
        
        // Atur Status dan Warna Badge
        holder.tvStatus.text = log.status
        val context = holder.itemView.context
        
        when {
            log.status.startsWith("SENT") -> {
                holder.tvStatus.setTextColor(ContextCompat.getColor(context, R.color.status_success))
                holder.tvStatus.text = "TERKIRIM"
            }
            log.status.startsWith("FAILED") -> {
                holder.tvStatus.setTextColor(ContextCompat.getColor(context, R.color.status_failed))
                holder.tvStatus.text = "GAGAL"
            }
            else -> {
                holder.tvStatus.setTextColor(ContextCompat.getColor(context, R.color.status_ignored))
                holder.tvStatus.text = log.status
            }
        }
    }

    override fun getItemCount(): Int = logsList.size

    /**
     * Memperbarui data list log baru
     */
    fun updateData(newLogs: List<DatabaseHelper.PaymentLog>) {
        this.logsList = newLogs
        notifyDataSetChanged()
    }

    private fun formatRupiah(number: Int): String {
        val localeID = Locale("in", "ID")
        val numberFormat = NumberFormat.getCurrencyInstance(localeID)
        numberFormat.maximumFractionDigits = 0
        return numberFormat.format(number).replace("Rp", "Rp ")
    }
}
