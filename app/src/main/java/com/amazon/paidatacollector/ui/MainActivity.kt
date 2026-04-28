package com.amazon.paidatacollector.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.CountDownTimer
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import android.widget.ArrayAdapter
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.video.FileOutputOptions
import androidx.camera.video.Quality
import androidx.camera.video.QualitySelector
import androidx.camera.video.Recorder
import androidx.camera.video.Recording
import androidx.camera.video.VideoCapture
import androidx.camera.video.VideoRecordEvent
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.amazon.paidatacollector.PAIApp
import com.amazon.paidatacollector.data.CaptureItem
import com.amazon.paidatacollector.databinding.ActivityMainBinding
import com.amazon.paidatacollector.sensor.SensorRecorder
import com.amazon.paidatacollector.upload.UploadWorker
import com.amazonaws.mobile.client.AWSMobileClient
import com.amazonaws.mobile.client.Callback
import com.amazonaws.mobile.client.UserState
import com.amazonaws.mobile.client.UserStateDetails
import com.amazonaws.mobile.client.UserStateListener
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    private lateinit var sensorRecorder: SensorRecorder
    private var videoCapture: VideoCapture<Recorder>? = null
    private var recording: Recording? = null
    private val db by lazy { (application as PAIApp).database }

    companion object {
        private const val TAG = "MainActivity"
    }

    // segment state
    private var sessionPrefix: String = "" // yyyyMMdd_HHmmss — fixed for the whole session
    private var segmentIndex: Int = 0
    private var splitTimer: CountDownTimer? = null

    // WakeLock — keeps CPU alive during recording so CameraX doesn't get killed
    private var wakeLock: PowerManager.WakeLock? = null

    // Idle detection job
    private var idleMonitorJob: Job? = null

    // Flag set when idle-skip discards a segment without uploading
    private var segmentDiscarded: Boolean = false

    // Flag set when auto-split triggers so onVideoFinalized knows to start the next segment
    private var isAutoSplitting: Boolean = false

    private var userStateListener: UserStateListener? = null

    // User Pool sub – written to SharedPreferences by LoginActivity right after
    // sign-in (while getTokens() is valid). Reading from prefs is safe on any thread.
    private val userSub: String by lazy {
        getSharedPreferences("pai_auth", MODE_PRIVATE)
            .getString("user_sub", null)
            ?.also { Log.i(TAG, "userSub loaded from prefs: $it") }
            ?: run {
                Log.e(TAG, "user_sub not found in prefs – sub will be 'unknown'")
                "unknown"
            }
    }

    // deviceId is kept for metadata traceability but is NOT used as S3 prefix
    private val deviceId: String by lazy {
        Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID)
    }

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { grants ->
            val cameraOk = grants[Manifest.permission.CAMERA] == true
            val audioOk = grants[Manifest.permission.RECORD_AUDIO] == true
            if (cameraOk && audioOk) {
                startCamera()
                if (grants[Manifest.permission.ACCESS_FINE_LOCATION] != true) {
                    toast("GPS permission denied — location data will not be recorded")
                }
            } else {
                toast("Camera and Microphone permissions are required")
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        sensorRecorder = SensorRecorder(this)

        // Initialize session monitoring and display user info
        initUserSession()

        val cameraAudioGranted = arrayOf(
            Manifest.permission.CAMERA,
            Manifest.permission.RECORD_AUDIO,
        ).all { ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED }

        if (cameraAudioGranted) {
            startCamera()
        } else {
            // Request camera+audio (required) and GPS (optional) together
            permissionLauncher.launch(arrayOf(
                Manifest.permission.CAMERA,
                Manifest.permission.RECORD_AUDIO,
                Manifest.permission.ACCESS_FINE_LOCATION,
            ))
        }

        binding.btnRecord.setOnClickListener { toggleRecording() }
        binding.btnSettings.setOnClickListener {
            startActivity(Intent(this, SettingsActivity::class.java))
        }
        binding.btnLogout.setOnClickListener { logout() }
        binding.btnWorkspace.setOnClickListener {
            startActivity(Intent(this, WorkspaceListActivity::class.java))
        }

        // Setup scenario spinner with proper text colors
        setupScenarioSpinner()
    }

    private fun setupScenarioSpinner() {
        val scenarios = resources.getStringArray(com.amazon.paidatacollector.R.array.scenarios)
        val adapter = ArrayAdapter(
            this,
            com.amazon.paidatacollector.R.layout.spinner_item,
            scenarios
        ).apply {
            setDropDownViewResource(com.amazon.paidatacollector.R.layout.spinner_dropdown_item)
        }
        binding.spinnerScenario.adapter = adapter
    }

    private fun initUserSession() {
        // Display current user
        displayUserInfo()

        // Monitor session state changes
        userStateListener = UserStateListener { userStateDetails ->
            Log.d(TAG, "User state changed: ${userStateDetails.userState}")
            when (userStateDetails.userState) {
                UserState.SIGNED_OUT,
                UserState.SIGNED_OUT_USER_POOLS_TOKENS_INVALID,
                UserState.SIGNED_OUT_FEDERATED_TOKENS_INVALID -> {
                    // Session expired or user signed out, redirect to login
                    runOnUiThread {
                        toast("Session expired. Please log in again.")
                        goToLogin()
                    }
                }
                else -> {
                    // Still signed in or other states
                }
            }
        }
        AWSMobileClient.getInstance().addUserStateListener(userStateListener!!)
    }

    private fun displayUserInfo() {
        try {
            val username = AWSMobileClient.getInstance().username ?: "Unknown"
            binding.tvUsername.text = "Logged in as: $username"
            Log.i(TAG, "User: $username, IdentityId: ${AWSMobileClient.getInstance().identityId}")
        } catch (e: Exception) {
            Log.e(TAG, "Error getting user info", e)
            binding.tvUsername.text = "User: Unknown"
        }

        // Display active workspace name
        try {
            val workspaceName = (application as PAIApp).workspaceManager.getActive()?.workspaceName
            binding.tvWorkspace.text = "Workspace: ${workspaceName ?: "—"}"
        } catch (e: Exception) {
            Log.e(TAG, "Error getting workspace info", e)
            binding.tvWorkspace.text = "Workspace: —"
        }
    }

    private fun logout() {
        try {
            AWSMobileClient.getInstance().signOut()
            toast("Logged out successfully")
            goToLogin()
        } catch (e: Exception) {
            Log.e(TAG, "Logout error", e)
            toast("Logout error: ${e.message}")
            // Even on error, go to login
            goToLogin()
        }
    }

    private fun goToLogin() {
        startActivity(Intent(this, LoginActivity::class.java))
        finish()
    }

    override fun onDestroy() {
        super.onDestroy()
        // Clean up listener
        userStateListener?.let {
            AWSMobileClient.getInstance().removeUserStateListener(it)
        }
    }

    private fun startCamera() {
        ProcessCameraProvider.getInstance(this).addListener({
            val provider = ProcessCameraProvider.getInstance(this).get()
            val recorder =
                Recorder
                    .Builder()
                    .setQualitySelector(QualitySelector.from(Quality.HD))
                    .build()
            videoCapture = VideoCapture.withOutput(recorder)
            provider.unbindAll()
            provider.bindToLifecycle(
                this,
                CameraSelector.DEFAULT_BACK_CAMERA,
                videoCapture,
                androidx.camera.core.Preview.Builder().build().also {
                    it.setSurfaceProvider(binding.previewView.surfaceProvider)
                },
            )
        }, ContextCompat.getMainExecutor(this))
    }

    private fun toggleRecording() {
        if (recording != null) stopSession() else startSession()
    }

    private fun startSession() {
        sessionPrefix = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
        segmentIndex = 0
        startSegment()
    }

    private fun startSegment() {
        segmentIndex++
        segmentDiscarded = false
        val segLabel = "%03d".format(segmentIndex)
        val prefix = "${sessionPrefix}_$segLabel"
        val videoFile = File(getExternalFilesDir(null), "$prefix.mp4")

        // Keep CPU alive so recording continues with screen off
        if (wakeLock == null || wakeLock?.isHeld == false) {
            val pm = getSystemService(POWER_SERVICE) as PowerManager
            wakeLock = pm.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "PAIDataCollector::RecordingWakeLock"
            ).also { it.acquire(12 * 60 * 60 * 1000L) } // max 12h
        }

        recording =
            videoCapture!!
                .output
                .prepareRecording(this, FileOutputOptions.Builder(videoFile).build())
                .withAudioEnabled()
                .start(ContextCompat.getMainExecutor(this)) { event ->
                    if (event is VideoRecordEvent.Finalize) onVideoFinalized(event, videoFile, prefix)
                }

        sensorRecorder.start(getExternalFilesDir(null)!!, prefix)
        binding.btnRecord.text = "⏹ Stop"
        updateSegmentUi(segmentIndex, -1L)

        val prefs = getSharedPreferences(SettingsActivity.PREFS_NAME, MODE_PRIVATE)
        val intervalMs = prefs.getLong(SettingsActivity.KEY_SPLIT_INTERVAL_MS, 0L)
        if (intervalMs > 0L) {
            splitTimer =
                object : CountDownTimer(intervalMs, 1000L) {
                    override fun onTick(remaining: Long) = updateSegmentUi(segmentIndex, remaining)
                    override fun onFinish() = autoSplitSegment()
                }.start()
        }

        // Idle detection: poll every 2s; discard segment if idle throughout
        val skipIdle = prefs.getBoolean(SettingsActivity.KEY_SKIP_IDLE, false)
        if (skipIdle) {
            idleMonitorJob?.cancel()
            idleMonitorJob = lifecycleScope.launch {
                // Wait at least IDLE_WINDOW_MS before first check so the buffer fills
                delay(SensorRecorder.IDLE_WINDOW_MS)
                while (recording != null) {
                    if (sensorRecorder.isIdle()) {
                        Log.i(TAG, "Idle detected — discarding segment $segmentIndex")
                        segmentDiscarded = true
                        autoSplitSegment()
                        break
                    }
                    delay(2_000L)
                }
            }
        }
    }

    private fun autoSplitSegment() {
        idleMonitorJob?.cancel()
        idleMonitorJob = null
        isAutoSplitting = true
        recording?.stop()
        recording = null
        sensorRecorder.stop()
        splitTimer?.cancel()
        splitTimer = null
        // onVideoFinalized decides whether to upload or discard based on segmentDiscarded
    }

    private fun stopSession() {
        idleMonitorJob?.cancel()
        idleMonitorJob = null
        splitTimer?.cancel()
        splitTimer = null
        recording?.stop()
        recording = null
        sensorRecorder.stop()
        wakeLock?.release()
        wakeLock = null
        binding.btnRecord.text = "⏺ Record"
        binding.tvSegmentInfo.text = ""
    }

    private fun onVideoFinalized(
        event: VideoRecordEvent.Finalize,
        videoFile: File,
        prefix: String,
    ) {
        if (event.hasError()) {
            toast("Recording error: ${event.error}")
            return
        }

        val wasDiscarded = segmentDiscarded
        segmentDiscarded = false

        // Idle-skip: delete local files and start next segment without uploading
        if (wasDiscarded) {
            isAutoSplitting = false
            videoFile.delete()
            lifecycleScope.launch {
                Log.i(TAG, "Idle segment discarded: $prefix")
                // Session is still active — start the next segment
                startSegment()
            }
            return
        }

        val scenario = binding.spinnerScenario.selectedItem.toString()
        val location =
            binding.etLocation.text
                .toString()
                .ifBlank { "unknown" }
        val taskType =
            binding.etTaskType.text
                .toString()
                .ifBlank { "unknown" }
        val capturedUserSub = userSub   // User Pool sub – matches lambda filter prefix
        val capturedDeviceId = deviceId // Android hardware ID – stored in metadata only
        val isSessionActive = isAutoSplitting  // true when CountDownTimer or idle-skip triggered split
        isAutoSplitting = false

        lifecycleScope.launch {
            val zipFile =
                withContext(Dispatchers.IO) {
                    val dir = getExternalFilesDir(null)!!
                    val sensorFile = sensorRecorder.getFile()
                        ?: error("sensor file not available for prefix $prefix")
                    val metaFile =
                        File(dir, "${prefix}_metadata.csv").also { f ->
                            f.bufferedWriter().use { w ->
                                w.write("prefix,scenario,location,taskType,deviceId,capturedAt\n")
                                w.write("$prefix,$scenario,$location,$taskType,$capturedDeviceId,${System.currentTimeMillis()}\n")
                            }
                        }
                    File(dir, "${prefix}_data.zip").also { zip ->
                        ZipOutputStream(zip.outputStream()).use { zos ->
                            zos.putNextEntry(ZipEntry("sensor.csv"))
                            sensorFile.inputStream().copyTo(zos)
                            zos.closeEntry()
                            zos.putNextEntry(ZipEntry("metadata.csv"))
                            metaFile.inputStream().copyTo(zos)
                            zos.closeEntry()
                        }
                    }
                }

            // S3 key: video/{sub}/{bucketPrefix?}/... so IAM policy video/${sub}/* always matches.
            // bucketPrefix (workspace slug) is placed AFTER sub, not before video/.
            val bucketPrefix = (application as PAIApp).workspaceManager.getActive()
                ?.bucketPrefix?.trimEnd('/') ?: ""
            val subDir = if (bucketPrefix.isNotEmpty()) "$capturedUserSub/$bucketPrefix" else capturedUserSub
            listOf(
                CaptureItem(
                    localPath = videoFile.absolutePath,
                    s3Key = "video/$subDir/$prefix.mp4",
                    mediaType = "video",
                    scenario = scenario,
                    location = location,
                    taskType = taskType,
                ),
                CaptureItem(
                    localPath = zipFile.absolutePath,
                    s3Key = "data/$subDir/${prefix}_data.zip",
                    mediaType = "data",
                    scenario = scenario,
                    location = location,
                    taskType = taskType,
                ),
            ).forEach { db.captureDao().insert(it) }

            Log.i(TAG, "Enqueuing upload for prefix: $prefix, s3 subDir: $subDir")
            UploadWorker.enqueue(this@MainActivity)

            // Monitor upload status
            observeUploadWork()

            // if this was an auto-split (session still active), start next segment
            if (isSessionActive && recording == null) {
                toast("Segment saved — uploading…")
                startSegment()
            } else if (recording == null) {
                toast("Saved — upload queued")
            }
        }
    }
    
    private fun observeUploadWork() {
        WorkManager.getInstance(this)
            .getWorkInfosForUniqueWorkLiveData("pai_upload")
            .observe(this) { workInfos ->
                val workInfo = workInfos?.firstOrNull()
                workInfo?.let {
                    Log.d(TAG, "Upload work state: ${it.state}")
                    when (it.state) {
                        WorkInfo.State.SUCCEEDED -> {
                            Log.i(TAG, "Upload work completed successfully")
                            toast("✓ Upload completed successfully")
                        }
                        WorkInfo.State.FAILED -> {
                            Log.e(TAG, "Upload work failed")
                            toast("✗ Upload failed - check logs")
                        }
                        WorkInfo.State.RUNNING -> {
                            Log.d(TAG, "Upload in progress...")
                        }
                        else -> Unit
                    }
                }
            }
    }

    private fun updateSegmentUi(
        seg: Int,
        remainingMs: Long,
    ) {
        binding.tvSegmentInfo.text =
            if (remainingMs < 0L) {
                "Segment $seg"
            } else {
                val secs = (remainingMs / 1000).toInt()
                "Segment $seg  |  Next split in %02d:%02d".format(secs / 60, secs % 60)
            }
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
}
