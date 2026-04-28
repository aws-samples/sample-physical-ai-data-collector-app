package com.amazon.paidatacollector.workspace

data class WorkspaceConfig(
    val id: String,
    val workspaceName: String,
    val orgName: String,
    val region: String,
    val bucketName: String,
    val bucketPrefix: String = "",
    val userPoolId: String,
    val userPoolClientId: String,
    val identityPoolId: String,
    val inviteApiEndpoint: String,
    val isGlobal: Boolean = false,
    val addedAt: Long = System.currentTimeMillis(),
)
