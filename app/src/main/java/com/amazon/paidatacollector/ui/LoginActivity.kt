package com.amazon.paidatacollector.ui

import android.content.Intent
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.View
import android.widget.Button
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.amazon.paidatacollector.R
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import com.amazonaws.mobile.client.AWSMobileClient
import com.amazonaws.mobile.client.Callback
import com.amazonaws.mobile.client.UserState
import com.amazonaws.mobile.client.UserStateDetails
import com.amazonaws.mobile.client.results.SignInResult
import com.amazonaws.mobile.client.results.SignInState

private const val PREFS_AUTH = "pai_auth"
private const val KEY_USER_SUB = "user_sub"

class LoginActivity : AppCompatActivity() {
    private lateinit var tilUsername: TextInputLayout
    private lateinit var tilPassword: TextInputLayout
    private lateinit var etUsername: TextInputEditText
    private lateinit var etPassword: TextInputEditText
    private lateinit var btnLogin: Button
    private lateinit var btnScanQr: Button
    private lateinit var progress: ProgressBar

    private val qrScanLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            // RESULT_OK means sign-in completed inside QRScanActivity (legacy path).
            // RESULT_CANCELED means registration succeeded but user must log in manually.
            if (result.resultCode == RESULT_OK) {
                goToMain()
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_login)

        tilUsername = findViewById(R.id.tilUsername)
        tilPassword = findViewById(R.id.tilPassword)
        etUsername = findViewById(R.id.etUsername)
        etPassword = findViewById(R.id.etPassword)
        btnLogin = findViewById(R.id.btnLogin)
        btnScanQr = findViewById(R.id.btnScanQr)
        progress = findViewById(R.id.progressLogin)

        checkExistingSession()

        btnLogin.setOnClickListener { doLogin() }
        btnScanQr.setOnClickListener {
            qrScanLauncher.launch(Intent(this, QRScanActivity::class.java))
        }
    }

    private fun checkExistingSession() {
        setLoading(true)
        AWSMobileClient.getInstance().currentUserState(object : Callback<UserStateDetails> {
            override fun onResult(result: UserStateDetails?) {
                runOnUiThread {
                    setLoading(false)
                    when (result?.userState) {
                        UserState.SIGNED_IN -> {
                            Thread { cacheUserSub() }.start()
                            goToMain()
                        }
                        else -> { /* stay on login screen */ }
                    }
                }
            }

            override fun onError(e: Exception?) {
                runOnUiThread { setLoading(false) }
            }
        })
    }

    private fun doLogin() {
        val username = etUsername.text.toString().trim()
        val password = etPassword.text.toString()
        if (username.isEmpty() || password.isEmpty()) {
            toast("Please enter your email and password")
            return
        }

        setLoading(true)
        AWSMobileClient.getInstance().signIn(
            username,
            password,
            null,
            object : Callback<SignInResult> {
                override fun onResult(result: SignInResult) {
                    when (result.signInState) {
                        SignInState.DONE -> {
                            cacheUserSub()
                            runOnUiThread { setLoading(false); goToMain() }
                        }
                        SignInState.NEW_PASSWORD_REQUIRED ->
                            runOnUiThread { setLoading(false); showNewPasswordDialog() }
                        else ->
                            runOnUiThread { setLoading(false); toast("Additional authentication required: ${result.signInState}") }
                    }
                }

                override fun onError(e: Exception) {
                    runOnUiThread {
                        setLoading(false)
                        if (e.message?.contains("UserNotConfirmedException") == true ||
                            e.javaClass.simpleName == "UserNotConfirmedException"
                        ) {
                            showConfirmationCodeDialog(username, password)
                        } else {
                            toast("Login failed: ${e.message}")
                        }
                    }
                }
            },
        )
    }

    private fun showConfirmationCodeDialog(username: String, password: String) {
        val etCode = android.widget.EditText(this).apply {
            hint = "6-digit verification code"
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            setTextColor(android.graphics.Color.BLACK)
            setHintTextColor(android.graphics.Color.GRAY)
            setPadding(48, 32, 48, 32)
        }
        AlertDialog.Builder(this)
            .setTitle("Email Verification Required")
            .setMessage("Enter the verification code sent to $username.")
            .setView(etCode)
            .setPositiveButton("Verify") { _, _ ->
                val code = etCode.text.toString().trim()
                if (code.isEmpty()) { toast("Please enter the code"); return@setPositiveButton }
                setLoading(true)
                confirmSignUpAndLogin(username, password, code)
            }
            .setNeutralButton("Resend") { _, _ ->
                AWSMobileClient.getInstance().resendSignUp(
                    username,
                    object : Callback<com.amazonaws.mobile.client.results.SignUpResult> {
                        override fun onResult(r: com.amazonaws.mobile.client.results.SignUpResult?) {
                            runOnUiThread { toast("Verification code resent"); showConfirmationCodeDialog(username, password) }
                        }
                        override fun onError(e: Exception?) {
                            runOnUiThread { toast("Resend failed: ${e?.message}"); showConfirmationCodeDialog(username, password) }
                        }
                    }
                )
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun confirmSignUpAndLogin(username: String, password: String, code: String) {
        AWSMobileClient.getInstance().confirmSignUp(
            username,
            code,
            object : Callback<com.amazonaws.mobile.client.results.SignUpResult> {
                override fun onResult(r: com.amazonaws.mobile.client.results.SignUpResult?) {
                    android.util.Log.d("LoginActivity", "ConfirmSignUp success, re-login")
                    AWSMobileClient.getInstance().signIn(
                        username, password, null,
                        object : Callback<SignInResult> {
                            override fun onResult(result: SignInResult) {
                                if (result.signInState == SignInState.DONE) {
                                    cacheUserSub()
                                    runOnUiThread { setLoading(false); goToMain() }
                                } else {
                                    runOnUiThread { setLoading(false); toast("Sign-in state: ${result.signInState}") }
                                }
                            }
                            override fun onError(e: Exception) {
                                runOnUiThread { setLoading(false); toast("Login failed: ${e.message}") }
                            }
                        }
                    )
                }
                override fun onError(e: Exception?) {
                    runOnUiThread { setLoading(false); toast("Verification failed: ${e?.message}") }
                }
            }
        )
    }

    private fun showNewPasswordDialog() {
        val dialogView = layoutInflater.inflate(R.layout.dialog_new_password, null)
        val etNewPw = dialogView.findViewById<TextInputEditText>(R.id.etNewPassword)
        val tvReq8 = dialogView.findViewById<TextView>(R.id.tvReq8chars)
        val tvReqUp = dialogView.findViewById<TextView>(R.id.tvReqUpper)
        val tvReqNum = dialogView.findViewById<TextView>(R.id.tvReqNumber)
        val tvReqSpc = dialogView.findViewById<TextView>(R.id.tvReqSpecial)

        fun updateChecklist(pw: String) {
            fun mark(tv: TextView, ok: Boolean) {
                val icon = if (ok) "✓" else "✗"
                val color = if (ok) android.graphics.Color.parseColor("#00AA44") else android.graphics.Color.parseColor("#999999")
                tv.text = tv.text.toString().replaceFirst(Regex("^[✓✗]"), icon)
                tv.setTextColor(color)
            }
            mark(tvReq8, pw.length >= 8)
            mark(tvReqUp, pw.any { it.isUpperCase() })
            mark(tvReqNum, pw.any { it.isDigit() })
            mark(tvReqSpc, pw.any { "!@#\$%^&*()_+-=[]{}|;':\",./<>?".contains(it) })
        }

        etNewPw.addTextChangedListener(object : TextWatcher {
            override fun afterTextChanged(s: Editable?) = updateChecklist(s.toString())
            override fun beforeTextChanged(s: CharSequence?, st: Int, c: Int, a: Int) {}
            override fun onTextChanged(s: CharSequence?, st: Int, b: Int, c: Int) {}
        })

        val dialog = AlertDialog.Builder(this)
            .setTitle("Set New Password")
            .setView(dialogView)
            .setPositiveButton("Set", null)
            .setNegativeButton("Cancel", null)
            .create()

        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val newPw = etNewPw.text.toString()
                when {
                    newPw.length < 8 -> toast("Password must be at least 8 characters")
                    !newPw.any { it.isUpperCase() } -> toast("Password must contain an uppercase letter")
                    !newPw.any { it.isDigit() } -> toast("Password must contain a number")
                    !newPw.any { "!@#\$%^&*()_+-=[]{}|;':\",./<>?".contains(it) } -> toast("Password must contain a special character")
                    else -> {
                        dialog.dismiss()
                        setLoading(true)
                        AWSMobileClient.getInstance().confirmSignIn(
                            newPw,
                            null,
                            object : Callback<SignInResult> {
                                override fun onResult(result: SignInResult) {
                                    runOnUiThread {
                                        setLoading(false)
                                        if (result.signInState == SignInState.DONE) {
                                            goToMain()
                                        } else {
                                            toast("Error: ${result.signInState}")
                                        }
                                    }
                                }
                                override fun onError(e: Exception) {
                                    runOnUiThread {
                                        setLoading(false)
                                        toast("Password change failed: ${e.message}")
                                    }
                                }
                            },
                        )
                    }
                }
            }
        }
        dialog.show()
    }

    private fun cacheUserSub() {
        try {
            val idToken = AWSMobileClient.getInstance().tokens?.idToken?.tokenString ?: return
            val payload = idToken.split(".")
                .getOrNull(1) ?: return
            val json = String(
                android.util.Base64.decode(
                    payload.replace('-', '+').replace('_', '/'),
                    android.util.Base64.NO_PADDING or android.util.Base64.URL_SAFE
                )
            )
            val sub = org.json.JSONObject(json).getString("sub")
            getSharedPreferences(PREFS_AUTH, MODE_PRIVATE)
                .edit().putString(KEY_USER_SUB, sub).apply()
            android.util.Log.i("LoginActivity", "Cached user sub: $sub")
        } catch (e: Exception) {
            android.util.Log.e("LoginActivity", "Failed to cache user sub", e)
        }
    }

    private fun goToMain() {
        startActivity(Intent(this, MainActivity::class.java))
        finish()
    }

    private fun setLoading(on: Boolean) {
        progress.visibility = if (on) View.VISIBLE else View.GONE
        btnLogin.isEnabled = !on
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
}
