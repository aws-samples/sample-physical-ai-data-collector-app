package com.amazon.paidatacollector

import android.app.Application
import android.content.Context
import androidx.work.Configuration
import com.amazon.paidatacollector.data.AppDatabase
import com.amazon.paidatacollector.upload.UploadWorkerFactory
import com.amazon.paidatacollector.workspace.WorkspaceConfig
import com.amazon.paidatacollector.workspace.WorkspaceManager
import com.amazonaws.mobile.client.AWSMobileClient
import com.amazonaws.mobile.client.Callback
import com.amazonaws.mobile.client.UserStateDetails
import com.amazonaws.mobile.config.AWSConfiguration
import com.amazonaws.mobileconnectors.s3.transferutility.TransferNetworkLossHandler
import org.json.JSONObject

class PAIApp :
    Application(),
    Configuration.Provider {
    val database by lazy { AppDatabase.getInstance(this) }
    val workspaceManager by lazy { WorkspaceManager(this) }

    override fun onCreate() {
        super.onCreate()
        // Required by TransferUtility to handle network-loss events properly
        TransferNetworkLossHandler.getInstance(this)
        initAwsClient()
    }

    private fun initAwsClient() {
        // Initialize with active workspace config; falls back to AwsConfig constants
        // if no workspace is configured yet (first run before WorkspaceManager is seeded)
        val activeWorkspace = try {
            workspaceManager.getActive()
        } catch (e: Exception) {
            android.util.Log.w("PAIApp", "WorkspaceManager not ready, using AwsConfig defaults", e)
            null
        }

        if (activeWorkspace != null) {
            initAwsWithConfig(
                this,
                activeWorkspace,
                object : Callback<UserStateDetails> {
                    override fun onResult(result: UserStateDetails?) {
                        android.util.Log.d("PAIApp", "AWS initialized with workspace '${activeWorkspace.workspaceName}', state: ${result?.userState}")
                    }
                    override fun onError(e: Exception?) {
                        android.util.Log.e("PAIApp", "AWS initialization error for workspace '${activeWorkspace.workspaceName}'", e)
                    }
                }
            )
        } else {
            // Fallback: build config from AwsConfig constants directly
            val config = JSONObject().apply {
                put("Version", "1.0")
                put(
                    "CredentialsProvider",
                    JSONObject().apply {
                        put(
                            "CognitoIdentity",
                            JSONObject().apply {
                                put(
                                    "Default",
                                    JSONObject().apply {
                                        put("PoolId", AwsConfig.IDENTITY_POOL_ID)
                                        put("Region", AwsConfig.REGION)
                                    },
                                )
                            },
                        )
                    },
                )
                put(
                    "CognitoUserPool",
                    JSONObject().apply {
                        put(
                            "Default",
                            JSONObject().apply {
                                put("PoolId", AwsConfig.USER_POOL_ID)
                                put("AppClientId", AwsConfig.USER_POOL_CLIENT)
                                put("Region", AwsConfig.REGION)
                            },
                        )
                    },
                )
            }
            AWSMobileClient.getInstance().initialize(
                this,
                AWSConfiguration(config),
                object : Callback<UserStateDetails> {
                    override fun onResult(result: UserStateDetails?) {
                        android.util.Log.d("PAIApp", "AWS initialized with AwsConfig defaults, state: ${result?.userState}")
                    }
                    override fun onError(e: Exception?) {
                        android.util.Log.e("PAIApp", "AWS initialization error", e)
                    }
                }
            )
        }
    }

    override val workManagerConfiguration: Configuration
        get() =
            Configuration
                .Builder()
                .setWorkerFactory(UploadWorkerFactory(database))
                .build()

    companion object {
        fun initAwsWithConfig(
            context: Context,
            config: WorkspaceConfig,
            callback: Callback<UserStateDetails>
        ) {
            val json = JSONObject().apply {
                put("Version", "1.0")
                put("CredentialsProvider", JSONObject().apply {
                    put("CognitoIdentity", JSONObject().apply {
                        put("Default", JSONObject().apply {
                            put("PoolId", config.identityPoolId)
                            put("Region", config.region)
                        })
                    })
                })
                put("CognitoUserPool", JSONObject().apply {
                    put("Default", JSONObject().apply {
                        put("PoolId", config.userPoolId)
                        put("AppClientId", config.userPoolClientId)
                        put("Region", config.region)
                    })
                })
            }
            AWSMobileClient.getInstance().initialize(context, AWSConfiguration(json), callback)
        }
    }
}
