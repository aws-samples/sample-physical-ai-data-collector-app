package com.amazon.paidatacollector.ui

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.View
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.amazon.paidatacollector.PAIApp
import com.amazon.paidatacollector.R
import com.amazon.paidatacollector.databinding.ActivityQrScanBinding
import com.amazon.paidatacollector.databinding.BottomSheetRegisterBinding
import com.amazon.paidatacollector.workspace.WorkspaceConfig
import com.amazonaws.mobile.client.AWSMobileClient
import com.amazonaws.mobile.client.Callback
import com.amazonaws.mobile.client.UserStateDetails
import com.amazonaws.mobile.client.results.SignInResult
import com.amazonaws.mobile.client.results.SignInState
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.textfield.TextInputEditText
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class QRScanActivity : AppCompatActivity() {

    private lateinit var binding: ActivityQrScanBinding
    private lateinit var cameraExecutor: ExecutorService
    private var isProcessing = false

    companion object {
        private const val TAG = "QRScanActivity"
    }

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) startCamera() else { toast("Camera permission is required"); finish() }
        }

    private val galleryLauncher =
        registerForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
            uri?.let { decodeQrFromGallery(it) }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityQrScanBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setSupportActionBar(binding.toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        supportActionBar?.title = "Scan QR Code"
        binding.toolbar.setNavigationOnClickListener { finish() }

        cameraExecutor = Executors.newSingleThreadExecutor()

        binding.btnJsonInput.setOnClickListener { showJsonInputDialog() }
        binding.btnGalleryQr.setOnClickListener { galleryLauncher.launch("image/*") }

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
            == PackageManager.PERMISSION_GRANTED
        ) {
            startCamera()
        } else {
            permissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    // ── Camera ────────────────────────────────────────────────────────────────

    private fun startCamera() {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(this)
        cameraProviderFuture.addListener({
            val cameraProvider = cameraProviderFuture.get()
            val preview = Preview.Builder().build().also {
                it.setSurfaceProvider(binding.previewView.surfaceProvider)
            }
            val imageAnalysis = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
                .also { analysis ->
                    analysis.setAnalyzer(cameraExecutor, BarcodeAnalyzer { rawValue ->
                        if (!isProcessing) {
                            isProcessing = true
                            runOnUiThread { binding.progressBar.visibility = View.VISIBLE }
                            onQrDetected(rawValue)
                        }
                    })
                }
            try {
                cameraProvider.unbindAll()
                cameraProvider.bindToLifecycle(
                    this, CameraSelector.DEFAULT_BACK_CAMERA, preview, imageAnalysis
                )
            } catch (e: Exception) {
                Log.e(TAG, "Camera bind failed", e)
                toast("Camera initialization failed: ${e.message}")
                finish()
            }
        }, ContextCompat.getMainExecutor(this))
    }

    // ── Gallery QR decode ─────────────────────────────────────────────────────

    private fun decodeQrFromGallery(uri: Uri) {
        if (isProcessing) return
        isProcessing = true
        binding.progressBar.visibility = View.VISIBLE
        lifecycleScope.launch {
            val rawValue = withContext(Dispatchers.IO) {
                try {
                    val image = InputImage.fromFilePath(this@QRScanActivity, uri)
                    val scanner = BarcodeScanning.getClient(
                        BarcodeScannerOptions.Builder()
                            .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                            .build()
                    )
                    val task = scanner.process(image)
                    com.google.android.gms.tasks.Tasks.await(task)
                    task.result?.firstOrNull()?.rawValue
                } catch (e: Exception) {
                    Log.e(TAG, "Gallery QR decode error", e)
                    null
                }
            }
            binding.progressBar.visibility = View.GONE
            if (rawValue != null) {
                onQrDetected(rawValue)
            } else {
                toast("No QR code found in the image")
                isProcessing = false
            }
        }
    }

    // ── JSON input dialog ─────────────────────────────────────────────────────

    private fun showJsonInputDialog() {
        if (isProcessing) return
        val etJson = TextInputEditText(this).apply {
            hint = "Paste QR JSON here"
            minLines = 4
            maxLines = 8
            isSingleLine = false
            setTextColor(0xFFFFFFFF.toInt())
            setHintTextColor(0xFF888888.toInt())
            setPadding(48, 32, 48, 32)
        }
        MaterialAlertDialogBuilder(this)
            .setTitle("Enter JSON")
            .setMessage("Paste the QR JSON copied from the Admin Console.")
            .setView(etJson)
            .setPositiveButton("OK") { _, _ ->
                val json = etJson.text?.toString()?.trim() ?: ""
                if (json.isEmpty()) return@setPositiveButton
                isProcessing = true
                binding.progressBar.visibility = View.VISIBLE
                onQrDetected(json)
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    // ── QR processing ─────────────────────────────────────────────────────────

    private fun onQrDetected(rawValue: String) {
        Log.d(TAG, "QR detected: $rawValue")
        try {
            val json = JSONObject(rawValue)

            val expiresAtStr = json.optString("expiresAt", "")
            if (expiresAtStr.isNotEmpty()) {
                val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
                    timeZone = TimeZone.getTimeZone("UTC")
                }
                val expiresAt = sdf.parse(expiresAtStr)
                if (expiresAt != null && expiresAt.before(Date())) {
                    runOnUiThread {
                        binding.progressBar.visibility = View.GONE
                        showExpiredDialog()
                    }
                    return
                }
            }

            val scannedConfig = WorkspaceConfig(
                id = UUID.randomUUID().toString(),
                workspaceName = json.getString("workspaceName"),
                orgName = json.getString("orgName"),
                region = json.getString("region"),
                bucketName = json.getString("bucketName"),
                bucketPrefix = json.optString("bucketPrefix", ""),
                userPoolId = json.getString("userPoolId"),
                userPoolClientId = json.getString("userPoolClientId"),
                identityPoolId = json.getString("identityPoolId"),
                inviteApiEndpoint = json.optString("inviteApiEndpoint", ""),
                isGlobal = false,
            )
            val inviteToken = json.optString("inviteToken", "")
            val requireEmailVerification = json.optBoolean("requireEmailVerification", false)

            runOnUiThread {
                binding.progressBar.visibility = View.GONE
                showConfirmDialog(scannedConfig, inviteToken, requireEmailVerification)
            }
        } catch (e: Exception) {
            Log.e(TAG, "QR JSON parsing failed", e)
            runOnUiThread {
                binding.progressBar.visibility = View.GONE
                toast("Invalid QR code")
                isProcessing = false
            }
        }
    }

    // ── Dialogs ───────────────────────────────────────────────────────────────

    private fun showExpiredDialog() {
        MaterialAlertDialogBuilder(this)
            .setTitle("QR Code Expired")
            .setMessage("This QR code has expired. Please request a new invite QR.")
            .setPositiveButton("OK") { _, _ -> isProcessing = false }
            .setOnCancelListener { isProcessing = false }
            .show()
    }

    private fun showConfirmDialog(
        config: WorkspaceConfig,
        inviteToken: String,
        requireEmailVerification: Boolean
    ) {
        MaterialAlertDialogBuilder(this)
            .setTitle("Add Workspace")
            .setMessage(
                "Workspace: ${config.workspaceName}\n" +
                "Organization: ${config.orgName}\n" +
                "Region: ${config.region}\n\n" +
                "Register to this workspace?"
            )
            .setPositiveButton("Register") { _, _ ->
                validateInviteAndRegister(config, inviteToken, requireEmailVerification)
            }
            .setNegativeButton("Cancel") { _, _ -> isProcessing = false }
            .setOnCancelListener { isProcessing = false }
            .show()
    }

    private fun validateInviteAndRegister(
        config: WorkspaceConfig,
        inviteToken: String,
        requireEmailVerification: Boolean
    ) {
        val originalWorkspace = (application as PAIApp).workspaceManager.getActive()
        lifecycleScope.launch {
            runOnUiThread { binding.progressBar.visibility = View.VISIBLE }
            if (config.inviteApiEndpoint.isNotEmpty() && inviteToken.isNotEmpty()) {
                val valid = withContext(Dispatchers.IO) {
                    validateInviteToken(config.inviteApiEndpoint, inviteToken)
                }
                if (!valid) {
                    runOnUiThread {
                        binding.progressBar.visibility = View.GONE
                        toast("Invite token is invalid or expired")
                        isProcessing = false
                    }
                    return@launch
                }
            }
            runOnUiThread {
                binding.progressBar.visibility = View.GONE
                showRegistrationSheet(config, originalWorkspace, requireEmailVerification)
            }
        }
    }

    private suspend fun validateInviteToken(endpoint: String, token: String): Boolean {
        return try {
            val url = URL("$endpoint/invite/validate")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json")
            conn.doOutput = true
            conn.connectTimeout = 10_000
            conn.readTimeout = 10_000
            val body = JSONObject().put("inviteToken", token).toString()
            OutputStreamWriter(conn.outputStream).use { it.write(body) }
            val code = conn.responseCode
            Log.d(TAG, "Invite validate response: $code")
            code == 200
        } catch (e: Exception) {
            Log.e(TAG, "Invite validation error", e)
            false
        }
    }

    // ── Registration Bottom Sheet ─────────────────────────────────────────────

    private fun showRegistrationSheet(
        config: WorkspaceConfig,
        originalWorkspace: WorkspaceConfig?,
        @Suppress("UNUSED_PARAMETER") requireEmailVerification: Boolean
    ) {
        val sheet = BottomSheetDialog(this, R.style.Theme_PAIDataCollector_BottomSheet)
        val sheetBinding = BottomSheetRegisterBinding.inflate(layoutInflater)

        sheetBinding.tvRegisterTitle.text = "Create Account"
        sheetBinding.tvRegisterSubtitle.text = "Enter your email. A temporary password will be sent to you."
        sheetBinding.tilUsername.hint = "Email"

        sheetBinding.btnRegisterConfirm.setOnClickListener {
            val email = sheetBinding.etUsername.text?.toString()?.trim() ?: ""
            if (email.isEmpty()) {
                toast("Please enter your email")
                return@setOnClickListener
            }
            sheet.dismiss()
            binding.progressBar.visibility = View.VISIBLE
            registerWithEmailOnly(config, originalWorkspace, email)
        }
        sheetBinding.btnRegisterCancel.setOnClickListener {
            sheet.dismiss()
            isProcessing = false
        }
        sheet.setOnCancelListener { isProcessing = false }
        sheet.setContentView(sheetBinding.root)
        sheet.show()
    }

    private fun registerWithEmailOnly(
        config: WorkspaceConfig,
        originalWorkspace: WorkspaceConfig?,
        email: String
    ) {
        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) {
                callRegisterApi(config.inviteApiEndpoint, email)
            }
            runOnUiThread { binding.progressBar.visibility = View.GONE }
            when (result) {
                "OK" -> {
                    MaterialAlertDialogBuilder(this@QRScanActivity)
                        .setTitle("Registration Complete")
                        .setMessage("A temporary password has been sent to $email.\nPlease log in with your email and the temporary password.")
                        .setPositiveButton("Go to Login") { _, _ ->
                            // Save workspace config without setting it active.
                            // setActive triggers AWS re-init which auto-signs-in,
                            // bypassing the login screen entirely.
                            val manager = (application as PAIApp).workspaceManager
                            manager.add(config)
                            setResult(Activity.RESULT_CANCELED)
                            finish()
                        }
                        .setCancelable(false)
                        .show()
                }
                "EMAIL_EXISTS" -> {
                    restoreOriginalWorkspace(originalWorkspace)
                    MaterialAlertDialogBuilder(this@QRScanActivity)
                        .setTitle("Email Already Registered")
                        .setMessage("$email is already registered.\nPlease log in from the login screen.")
                        .setPositiveButton("OK") { _, _ -> isProcessing = false }
                        .show()
                }
                else -> {
                    restoreOriginalWorkspace(originalWorkspace)
                    toast("Registration failed: $result")
                    isProcessing = false
                }
            }
        }
    }

    private fun callRegisterApi(inviteApiEndpoint: String, email: String): String {
        return try {
            val url = URL("$inviteApiEndpoint/invite/register")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json")
            conn.doOutput = true
            conn.connectTimeout = 15_000
            conn.readTimeout = 15_000
            val body = JSONObject().put("email", email).toString()
            OutputStreamWriter(conn.outputStream).use { it.write(body) }
            val code = conn.responseCode
            Log.d(TAG, "Register API response: $code")
            when (code) {
                200 -> "OK"
                409 -> "EMAIL_EXISTS"
                else -> {
                    val msg = conn.errorStream?.bufferedReader()?.readText() ?: "HTTP $code"
                    Log.e(TAG, "Register API error: $msg")
                    "Server error ($code)"
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Register API call failed", e)
            e.message ?: "Network error"
        }
    }

    // ── Account operations ────────────────────────────────────────────────────

    private fun registerInWorkspace(
        config: WorkspaceConfig,
        originalWorkspace: WorkspaceConfig?,
        username: String,
        password: String,
        requireEmailVerification: Boolean
    ) {
        PAIApp.initAwsWithConfig(
            applicationContext,
            config,
            object : Callback<UserStateDetails> {
                override fun onResult(result: UserStateDetails?) {
                    if (requireEmailVerification) signUpUser(config, originalWorkspace, username, password)
                    else signInUser(config, originalWorkspace, username, password)
                }
                override fun onError(e: Exception?) {
                    Log.e(TAG, "AWS re-init error for workspace ${config.id}", e)
                    restoreOriginalWorkspace(originalWorkspace)
                    runOnUiThread {
                        binding.progressBar.visibility = View.GONE
                        toast("Workspace initialization failed: ${e?.message}")
                        isProcessing = false
                    }
                }
            }
        )
    }

    private fun signInUser(
        config: WorkspaceConfig,
        originalWorkspace: WorkspaceConfig?,
        username: String,
        password: String
    ) {
        AWSMobileClient.getInstance().signIn(
            username, password, null,
            object : Callback<SignInResult> {
                override fun onResult(result: SignInResult?) {
                    when (result?.signInState) {
                        SignInState.DONE -> saveWorkspaceAndFinish(config)
                        SignInState.NEW_PASSWORD_REQUIRED -> runOnUiThread {
                            binding.progressBar.visibility = View.GONE
                            showNewPasswordDialog(config, originalWorkspace, username)
                        }
                        else -> {
                            Log.w(TAG, "Unexpected sign-in state: ${result?.signInState}")
                            restoreOriginalWorkspace(originalWorkspace)
                            runOnUiThread {
                                binding.progressBar.visibility = View.GONE
                                toast("Unexpected sign-in state: ${result?.signInState}")
                                isProcessing = false
                            }
                        }
                    }
                }
                override fun onError(e: Exception?) {
                    Log.e(TAG, "Sign-in error", e)
                    restoreOriginalWorkspace(originalWorkspace)
                    runOnUiThread {
                        binding.progressBar.visibility = View.GONE
                        toast("Login failed: ${e?.message}")
                        isProcessing = false
                    }
                }
            }
        )
    }

    private fun showNewPasswordDialog(
        config: WorkspaceConfig,
        originalWorkspace: WorkspaceConfig?,
        @Suppress("UNUSED_PARAMETER") username: String
    ) {
        val etNewPassword = TextInputEditText(this).apply {
            hint = "New password"
            inputType = android.text.InputType.TYPE_CLASS_TEXT or
                android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
            setTextColor(0xFFFFFFFF.toInt())
            setHintTextColor(0xFF888888.toInt())
            setPadding(48, 32, 48, 32)
        }
        MaterialAlertDialogBuilder(this)
            .setTitle("Set New Password")
            .setMessage("First login. Please set your new password.")
            .setView(etNewPassword)
            .setPositiveButton("Set") { _, _ ->
                val newPassword = etNewPassword.text?.toString() ?: ""
                if (newPassword.isEmpty()) { toast("Please enter a new password"); isProcessing = false; return@setPositiveButton }
                binding.progressBar.visibility = View.VISIBLE
                AWSMobileClient.getInstance().confirmSignIn(
                    newPassword, null,
                    object : Callback<SignInResult> {
                        override fun onResult(result: SignInResult?) {
                            if (result?.signInState == SignInState.DONE) saveWorkspaceAndFinish(config)
                            else { restoreOriginalWorkspace(originalWorkspace); runOnUiThread { binding.progressBar.visibility = View.GONE; toast("Password change failed"); isProcessing = false } }
                        }
                        override fun onError(e: Exception?) {
                            restoreOriginalWorkspace(originalWorkspace)
                            runOnUiThread { binding.progressBar.visibility = View.GONE; toast("Password change error: ${e?.message}"); isProcessing = false }
                        }
                    }
                )
            }
            .setNegativeButton("Cancel") { _, _ -> restoreOriginalWorkspace(originalWorkspace); isProcessing = false }
            .show()
    }

    private fun signUpUser(
        config: WorkspaceConfig,
        originalWorkspace: WorkspaceConfig?,
        email: String,
        password: String
    ) {
        AWSMobileClient.getInstance().signUp(
            email, password, mapOf("email" to email), null,
            object : Callback<com.amazonaws.mobile.client.results.SignUpResult> {
                override fun onResult(result: com.amazonaws.mobile.client.results.SignUpResult?) {
                    Log.d(TAG, "SignUp confirmationState=${result?.confirmationState}")
                    runOnUiThread {
                        binding.progressBar.visibility = View.GONE
                        if (result?.confirmationState == true) signInUser(config, originalWorkspace, email, password)
                        else showEmailConfirmationDialog(config, originalWorkspace, email, password)
                    }
                }
                override fun onError(e: Exception?) {
                    Log.e(TAG, "Sign-up error", e)
                    restoreOriginalWorkspace(originalWorkspace)
                    runOnUiThread { binding.progressBar.visibility = View.GONE; toast("Sign-up failed: ${e?.message}"); isProcessing = false }
                }
            }
        )
    }

    private fun showEmailConfirmationDialog(
        config: WorkspaceConfig,
        originalWorkspace: WorkspaceConfig?,
        email: String,
        password: String
    ) {
        val etCode = TextInputEditText(this).apply {
            hint = "6-digit verification code"
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            setTextColor(0xFFFFFFFF.toInt())
            setHintTextColor(0xFF888888.toInt())
            setPadding(48, 32, 48, 32)
        }
        MaterialAlertDialogBuilder(this)
            .setTitle("Email Verification")
            .setMessage("A verification code has been sent to $email.")
            .setView(etCode)
            .setPositiveButton("Verify") { _, _ ->
                val code = etCode.text?.toString()?.trim() ?: ""
                if (code.isEmpty()) { toast("Please enter the verification code"); isProcessing = false; return@setPositiveButton }
                binding.progressBar.visibility = View.VISIBLE
                confirmAndLogin(config, originalWorkspace, email, password, code)
            }
            .setNeutralButton("Resend") { _, _ -> resendCode(config, originalWorkspace, email, password) }
            .setNegativeButton("Cancel") { _, _ -> restoreOriginalWorkspace(originalWorkspace); isProcessing = false }
            .setOnCancelListener { restoreOriginalWorkspace(originalWorkspace); isProcessing = false }
            .show()
    }

    private fun confirmAndLogin(
        config: WorkspaceConfig,
        originalWorkspace: WorkspaceConfig?,
        email: String, password: String, code: String
    ) {
        AWSMobileClient.getInstance().confirmSignUp(
            email, code,
            object : Callback<com.amazonaws.mobile.client.results.SignUpResult> {
                override fun onResult(result: com.amazonaws.mobile.client.results.SignUpResult?) {
                    signInUser(config, originalWorkspace, email, password)
                }
                override fun onError(e: Exception?) {
                    Log.e(TAG, "ConfirmSignUp error", e)
                    restoreOriginalWorkspace(originalWorkspace)
                    runOnUiThread { binding.progressBar.visibility = View.GONE; toast("Verification failed: ${e?.message}"); isProcessing = false }
                }
            }
        )
    }

    private fun resendCode(
        config: WorkspaceConfig,
        originalWorkspace: WorkspaceConfig?,
        email: String, password: String
    ) {
        binding.progressBar.visibility = View.VISIBLE
        AWSMobileClient.getInstance().resendSignUp(
            email,
            object : Callback<com.amazonaws.mobile.client.results.SignUpResult> {
                override fun onResult(result: com.amazonaws.mobile.client.results.SignUpResult?) {
                    runOnUiThread {
                        binding.progressBar.visibility = View.GONE
                        toast("Verification code resent")
                        showEmailConfirmationDialog(config, originalWorkspace, email, password)
                    }
                }
                override fun onError(e: Exception?) {
                    runOnUiThread {
                        binding.progressBar.visibility = View.GONE
                        toast("Resend failed: ${e?.message}")
                        showEmailConfirmationDialog(config, originalWorkspace, email, password)
                    }
                }
            }
        )
    }

    private fun saveWorkspaceAndFinish(config: WorkspaceConfig) {
        val manager = (application as PAIApp).workspaceManager
        manager.add(config)
        manager.setActive(config.id)
        Log.i(TAG, "Workspace saved: ${config.id} (${config.workspaceName})")
        runOnUiThread {
            binding.progressBar.visibility = View.GONE
            toast("Workspace '${config.workspaceName}' registered")
            setResult(Activity.RESULT_OK)
            finish()
        }
    }

    private fun restoreOriginalWorkspace(originalWorkspace: WorkspaceConfig?) {
        if (originalWorkspace == null) return
        PAIApp.initAwsWithConfig(
            applicationContext, originalWorkspace,
            object : Callback<UserStateDetails> {
                override fun onResult(result: UserStateDetails?) { Log.d(TAG, "Restored workspace: ${originalWorkspace.id}") }
                override fun onError(e: Exception?) { Log.e(TAG, "Failed to restore workspace", e) }
            }
        )
    }

    override fun onDestroy() {
        super.onDestroy()
        cameraExecutor.shutdown()
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()

    // ── BarcodeAnalyzer ────────────────────────────────────────────────────────

    private inner class BarcodeAnalyzer(
        private val onResult: (String) -> Unit
    ) : ImageAnalysis.Analyzer {
        private val scanner: BarcodeScanner = BarcodeScanning.getClient(
            BarcodeScannerOptions.Builder()
                .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                .build()
        )

        @androidx.camera.core.ExperimentalGetImage
        override fun analyze(imageProxy: ImageProxy) {
            val mediaImage = imageProxy.image ?: run { imageProxy.close(); return }
            val inputImage = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
            scanner.process(inputImage)
                .addOnSuccessListener { barcodes -> barcodes.firstOrNull()?.rawValue?.let { onResult(it) } }
                .addOnCompleteListener { imageProxy.close() }
        }
    }
}
