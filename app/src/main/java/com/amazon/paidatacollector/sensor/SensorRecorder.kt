package com.amazon.paidatacollector.sensor

import android.annotation.SuppressLint
import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.util.Log
import java.io.BufferedWriter
import java.io.File

class SensorRecorder(
    private val context: Context,
) : SensorEventListener,
    LocationListener {
    private val sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val locationManager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager

    // Streaming writer — each sensor row is written directly to disk to avoid in-memory
    // accumulation. Opened in start(), flushed+closed in stop(). No row buffering.
    private var writer: BufferedWriter? = null
    private var sensorFile: File? = null

    // sensor buffers
    private var accel: FloatArray? = null
    private var gyro: FloatArray? = null
    private var mag: FloatArray? = null
    private var gravity: FloatArray? = null
    private var linearAccel: FloatArray? = null
    private var rotVec: FloatArray? = null
    private var pressure: Float? = null
    private var light: Float? = null
    private var proximity: Float? = null

    // GPS buffer
    private var gpsLocation: Location? = null

    // Rolling window of (timestampMs, linearAccelMagnitude) for idle detection
    private val motionBuffer = ArrayDeque<Pair<Long, Float>>()

    /**
     * Returns true if linear acceleration magnitude has stayed below [threshold] m/s²
     * for the entire [windowMs] period. Thread-safe via synchronized.
     */
    fun isIdle(windowMs: Long = IDLE_WINDOW_MS, threshold: Float = IDLE_THRESHOLD): Boolean {
        synchronized(motionBuffer) {
            val cutoff = System.currentTimeMillis() - windowMs
            val window = motionBuffer.filter { it.first >= cutoff }
            if (window.isEmpty()) return false
            return window.all { it.second < threshold }
        }
    }

    private val sensorTypes =
        listOf(
            Sensor.TYPE_ACCELEROMETER,
            Sensor.TYPE_GYROSCOPE,
            Sensor.TYPE_MAGNETIC_FIELD,
            Sensor.TYPE_GRAVITY,
            Sensor.TYPE_LINEAR_ACCELERATION,
            Sensor.TYPE_ROTATION_VECTOR,
            Sensor.TYPE_PRESSURE,
            Sensor.TYPE_LIGHT,
            Sensor.TYPE_PROXIMITY,
        )

    @SuppressLint("MissingPermission")
    fun start(
        dir: File,
        prefix: String,
    ) {
        synchronized(motionBuffer) { motionBuffer.clear() }
        sensorFile = File(dir, "${prefix}_sensor.csv").also { f ->
            writer = f.bufferedWriter().also { w -> w.write(CSV_HEADER + "\n") }
        }
        sensorTypes.forEach { type ->
            sensorManager.getDefaultSensor(type)?.let {
                sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME)
            }
        }
        try {
            locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, this)
        } catch (_: SecurityException) {
            // permission not granted
        }
    }

    fun stop() {
        sensorManager.unregisterListener(this)
        locationManager.removeUpdates(this)
        try {
            writer?.flush()
            writer?.close()
        } catch (e: Exception) {
            Log.e(TAG, "Error closing sensor writer", e)
        } finally {
            writer = null
        }
    }

    /** Returns the sensor CSV file written during the most recent [start]/[stop] cycle. */
    fun getFile(): File? = sensorFile

    override fun onSensorChanged(event: SensorEvent) {
        when (event.sensor.type) {
            Sensor.TYPE_ACCELEROMETER -> accel = event.values.clone()
            Sensor.TYPE_GYROSCOPE -> gyro = event.values.clone()
            Sensor.TYPE_MAGNETIC_FIELD -> mag = event.values.clone()
            Sensor.TYPE_GRAVITY -> gravity = event.values.clone()
            Sensor.TYPE_LINEAR_ACCELERATION -> {
                linearAccel = event.values.clone()
                val (x, y, z) = event.values
                val mag = Math.sqrt((x * x + y * y + z * z).toDouble()).toFloat()
                val now = System.currentTimeMillis()
                synchronized(motionBuffer) {
                    motionBuffer.addLast(now to mag)
                    // keep only last IDLE_WINDOW_MS * 2 worth of data
                    val cutoff = now - IDLE_WINDOW_MS * 2
                    while (motionBuffer.isNotEmpty() && motionBuffer.first().first < cutoff)
                        motionBuffer.removeFirst()
                }
            }
            Sensor.TYPE_ROTATION_VECTOR -> rotVec = event.values.clone()
            Sensor.TYPE_PRESSURE -> pressure = event.values[0]
            Sensor.TYPE_LIGHT -> light = event.values[0]
            Sensor.TYPE_PROXIMITY -> proximity = event.values[0]
        }
        // require at least accel + gyro to emit a row
        val a = accel ?: return
        val g = gyro ?: return
        val m = mag
        val gr = gravity
        val la = linearAccel
        val rv = rotVec
        val loc = gpsLocation
        val row =
            buildString {
                append(System.currentTimeMillis())
                append(',')
                append(a[0])
                append(',')
                append(a[1])
                append(',')
                append(a[2])
                append(',')
                append(g[0])
                append(',')
                append(g[1])
                append(',')
                append(g[2])
                append(',')
                append(m?.get(0) ?: "")
                append(',')
                append(m?.get(1) ?: "")
                append(',')
                append(m?.get(2) ?: "")
                append(',')
                append(gr?.get(0) ?: "")
                append(',')
                append(gr?.get(1) ?: "")
                append(',')
                append(gr?.get(2) ?: "")
                append(',')
                append(la?.get(0) ?: "")
                append(',')
                append(la?.get(1) ?: "")
                append(',')
                append(la?.get(2) ?: "")
                append(',')
                append(rv?.get(0) ?: "")
                append(',')
                append(rv?.get(1) ?: "")
                append(',')
                append(rv?.get(2) ?: "")
                append(',')
                append(if (rv != null && rv.size > 3) rv[3] else "")
                append(',')
                append(if (rv != null && rv.size > 4) rv[4] else "")
                append(',')
                append(pressure ?: "")
                append(',')
                append(light ?: "")
                append(',')
                append(proximity ?: "")
                append(',')
                append(loc?.latitude ?: "")
                append(',')
                append(loc?.longitude ?: "")
                append(',')
                append(loc?.altitude ?: "")
                append(',')
                append(loc?.speed ?: "")
                append(',')
                append(loc?.bearing ?: "")
                append(',')
                append(loc?.accuracy ?: "")
            }
        try {
            writer?.write(row + "\n")
        } catch (e: Exception) {
            Log.e(TAG, "Error writing sensor row", e)
        }
    }

    override fun onLocationChanged(location: Location) {
        gpsLocation = location
    }

    @Deprecated("Deprecated in Java")
    override fun onStatusChanged(
        provider: String?,
        status: Int,
        extras: Bundle?,
    ) = Unit

    override fun onAccuracyChanged(
        sensor: Sensor,
        accuracy: Int,
    ) = Unit

    companion object {
        private const val TAG = "SensorRecorder"
        const val IDLE_WINDOW_MS = 5_000L   // 5s of stillness → idle
        const val IDLE_THRESHOLD = 0.15f    // m/s² (gravity-removed linear accel)
        const val CSV_HEADER =
            "timestampMs,accel_x,accel_y,accel_z,gyro_x,gyro_y,gyro_z," +
                "mag_x,mag_y,mag_z,gravity_x,gravity_y,gravity_z," +
                "linear_accel_x,linear_accel_y,linear_accel_z," +
                "rot_x,rot_y,rot_z,rot_w,rot_heading_accuracy," +
                "pressure,light,proximity,lat,lng,alt,speed,bearing,gps_accuracy"
    }
}
