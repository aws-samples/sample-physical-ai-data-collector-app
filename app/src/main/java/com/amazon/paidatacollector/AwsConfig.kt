package com.amazon.paidatacollector

/**
 * CDK deploy output values — paste your stack outputs here after `cdk deploy`.
 * Run: cdk deploy PAIDataStack --outputs-file outputs.json
 */
object AwsConfig {
    const val REGION = "ap-northeast-2"
    const val BUCKET_NAME = "pai-raw-data-YOUR_ACCOUNT_ID"
    const val USER_POOL_ID = "ap-northeast-2_XXXXXXXXX"
    const val USER_POOL_CLIENT = "XXXXXXXXXXXXXXXXXXXXXXXXXX"
    const val IDENTITY_POOL_ID = "ap-northeast-2:00000000-0000-0000-0000-000000000000"
}
