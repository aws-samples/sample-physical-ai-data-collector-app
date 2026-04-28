package com.amazon.paidatacollector.workspace

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.amazon.paidatacollector.AwsConfig
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken

class WorkspaceManager(private val context: Context) {

    companion object {
        private const val TAG = "WorkspaceManager"
        private const val PREFS_NAME = "pai_workspaces"
        private const val PREFS_PLAIN_NAME = "pai_workspaces_plain"
        private const val KEY_WORKSPACES = "workspaces"
        private const val KEY_ACTIVE_ID = "active_id"
        private const val DEFAULT_ID = "default"
    }

    private val gson = Gson()

    private val prefs: SharedPreferences by lazy {
        try {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            EncryptedSharedPreferences.create(
                context,
                PREFS_NAME,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        } catch (e: Exception) {
            Log.w(TAG, "EncryptedSharedPreferences creation failed, falling back to plain prefs", e)
            context.getSharedPreferences(PREFS_PLAIN_NAME, Context.MODE_PRIVATE)
        }
    }

    init {
        // Seed default workspace on first run
        if (getAll().isEmpty()) {
            val defaultWorkspace = WorkspaceConfig(
                id = DEFAULT_ID,
                workspaceName = "byochong Lab (ap-northeast-2)",
                orgName = "byochong-lab",
                region = AwsConfig.REGION,
                bucketName = AwsConfig.BUCKET_NAME,
                userPoolId = AwsConfig.USER_POOL_ID,
                userPoolClientId = AwsConfig.USER_POOL_CLIENT,
                identityPoolId = AwsConfig.IDENTITY_POOL_ID,
                inviteApiEndpoint = "",
                isGlobal = true,
            )
            saveAll(listOf(defaultWorkspace))
            prefs.edit().putString(KEY_ACTIVE_ID, DEFAULT_ID).apply()
            Log.d(TAG, "Seeded default workspace")
        }
    }

    fun getAll(): List<WorkspaceConfig> {
        val json = prefs.getString(KEY_WORKSPACES, null) ?: return emptyList()
        return try {
            val type = object : TypeToken<List<WorkspaceConfig>>() {}.type
            gson.fromJson(json, type) ?: emptyList()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to deserialize workspaces", e)
            emptyList()
        }
    }

    fun getActive(): WorkspaceConfig? {
        val activeId = prefs.getString(KEY_ACTIVE_ID, DEFAULT_ID) ?: DEFAULT_ID
        return getAll().find { it.id == activeId }
            ?: getAll().firstOrNull()
    }

    fun setActive(id: String) {
        prefs.edit().putString(KEY_ACTIVE_ID, id).apply()
        Log.d(TAG, "Active workspace set to: $id")
    }

    fun add(config: WorkspaceConfig) {
        val current = getAll().toMutableList()
        // Remove if already exists (update)
        current.removeAll { it.id == config.id }
        current.add(config)
        saveAll(current)
        Log.d(TAG, "Added workspace: ${config.id} (${config.workspaceName})")
    }

    fun remove(id: String): Boolean {
        if (id == DEFAULT_ID) {
            Log.w(TAG, "Cannot remove default workspace")
            return false
        }
        val current = getAll().toMutableList()
        val removed = current.removeAll { it.id == id }
        if (removed) {
            saveAll(current)
            // If we removed the active workspace, switch to default
            if (prefs.getString(KEY_ACTIVE_ID, null) == id) {
                prefs.edit().putString(KEY_ACTIVE_ID, DEFAULT_ID).apply()
            }
            Log.d(TAG, "Removed workspace: $id")
        }
        return removed
    }

    private fun saveAll(workspaces: List<WorkspaceConfig>) {
        val json = gson.toJson(workspaces)
        prefs.edit().putString(KEY_WORKSPACES, json).apply()
    }
}
