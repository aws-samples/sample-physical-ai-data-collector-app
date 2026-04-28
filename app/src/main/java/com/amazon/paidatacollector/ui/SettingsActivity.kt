package com.amazon.paidatacollector.ui

import android.os.Bundle
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.Spinner
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.amazon.paidatacollector.R
import com.google.android.material.switchmaterial.SwitchMaterial

class SettingsActivity : AppCompatActivity() {
    companion object {
        const val PREFS_NAME = "pai_settings"
        const val KEY_SPLIT_INTERVAL_MS = "split_interval_ms"
        const val KEY_SKIP_IDLE = "skip_idle_segments"

        // 0 = disabled
        val INTERVAL_LABELS = arrayOf("None", "30 sec", "1 min", "5 min", "10 min", "30 min", "45 min")
        val INTERVAL_MS = longArrayOf(0L, 30_000L, 60_000L, 300_000L, 600_000L, 1_800_000L, 2_700_000L)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)

        val spinner = findViewById<Spinner>(R.id.spinnerInterval)
        val switchSkipIdle = findViewById<SwitchMaterial>(R.id.switchSkipIdle)
        val btnSave = findViewById<Button>(R.id.btnSaveSettings)

        val adapter = ArrayAdapter(this, R.layout.spinner_item, INTERVAL_LABELS)
        adapter.setDropDownViewResource(R.layout.spinner_dropdown_item)
        spinner.adapter = adapter

        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        val savedMs = prefs.getLong(KEY_SPLIT_INTERVAL_MS, 0L)
        val idx = INTERVAL_MS.indexOfFirst { it == savedMs }.coerceAtLeast(0)
        spinner.setSelection(idx)
        switchSkipIdle.isChecked = prefs.getBoolean(KEY_SKIP_IDLE, false)

        btnSave.setOnClickListener {
            val selectedMs = INTERVAL_MS[spinner.selectedItemPosition]
            prefs.edit()
                .putLong(KEY_SPLIT_INTERVAL_MS, selectedMs)
                .putBoolean(KEY_SKIP_IDLE, switchSkipIdle.isChecked)
                .apply()
            Toast.makeText(this, "Saved", Toast.LENGTH_SHORT).show()
            finish()
        }
    }
}
