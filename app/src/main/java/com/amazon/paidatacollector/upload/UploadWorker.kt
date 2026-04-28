package com.amazon.paidatacollector.upload

import android.content.Context
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import com.amazon.paidatacollector.PAIApp
import com.amazon.paidatacollector.data.AppDatabase
import com.amazon.paidatacollector.data.CaptureItem
import com.amazonaws.mobile.client.AWSMobileClient
import com.amazonaws.mobileconnectors.s3.transferutility.TransferListener
import com.amazonaws.mobileconnectors.s3.transferutility.TransferState
import com.amazonaws.mobileconnectors.s3.transferutility.TransferUtility
import com.amazonaws.regions.Region
import com.amazonaws.services.s3.AmazonS3Client
import kotlinx.coroutines.suspendCancellableCoroutine
import java.io.File
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class UploadWorker(
    ctx: Context,
    params: WorkerParameters,
    private val db: AppDatabase,
) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        Log.i(TAG, "UploadWorker started. Run attempt: $runAttemptCount")

        val pending = db.captureDao().getPending()
        if (pending.isEmpty()) {
            Log.i(TAG, "No pending uploads. Exiting.")
            return Result.success()
        }

        Log.i(TAG, "Found ${pending.size} pending items to upload")

        val workspaceConfig = (applicationContext as PAIApp).workspaceManager.getActive()
            ?: run {
                Log.e(TAG, "No active workspace found — cannot upload")
                return Result.failure()
            }

        val s3Client =
            AmazonS3Client(
                AWSMobileClient.getInstance(),
                Region.getRegion(workspaceConfig.region),
            )
        Log.d(TAG, "S3 Client initialized for region: ${workspaceConfig.region}, bucket: ${workspaceConfig.bucketName}")

        val transferUtility =
            TransferUtility
                .builder()
                .context(applicationContext)
                .s3Client(s3Client)
                .defaultBucket(workspaceConfig.bucketName)
                .build()

        var anyFailed = false
        for (item in pending) {
            try {
                Log.i(TAG, "Starting upload for item ${item.id}: ${item.s3Key}")
                db.captureDao().updateStatus(item.id, "UPLOADING")
                uploadFile(transferUtility, item)
                db.captureDao().updateStatus(item.id, "DONE")
                Log.i(TAG, "Successfully uploaded item ${item.id}: ${item.s3Key}")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to upload item ${item.id}: ${item.s3Key}", e)
                db.captureDao().updateStatus(item.id, "FAILED")
                anyFailed = true
            }
        }
        
        val result = if (anyFailed && runAttemptCount < 3) {
            Log.w(TAG, "Some uploads failed. Will retry. Attempt $runAttemptCount/3")
            Result.retry()
        } else {
            Log.i(TAG, "Upload work completed. AnyFailed: $anyFailed")
            Result.success()
        }
        return result
    }

    /** Suspends until TransferUtility completes or throws. */
    private suspend fun uploadFile(
        tu: TransferUtility,
        item: CaptureItem,
    ) = suspendCancellableCoroutine { cont ->
        val file = File(item.localPath)
        if (!file.exists()) {
            Log.e(TAG, "Local file does not exist: ${item.localPath}")
            cont.resumeWithException(Exception("Local file not found: ${item.localPath}"))
            return@suspendCancellableCoroutine
        }
        
        Log.d(TAG, "Uploading file: ${file.name} (${file.length()} bytes) to s3Key: ${item.s3Key}")
        
        val observer = tu.upload(item.s3Key, file)
        observer.setTransferListener(
            object : TransferListener {
                override fun onStateChanged(
                    id: Int,
                    state: TransferState,
                ) {
                    Log.d(TAG, "Transfer $id state changed to: $state for ${item.s3Key}")
                    when (state) {
                        TransferState.COMPLETED -> {
                            Log.i(TAG, "Transfer $id COMPLETED: ${item.s3Key}")
                            if (cont.isActive) cont.resume(Unit)
                        }
                        TransferState.FAILED -> {
                            Log.e(TAG, "Transfer $id FAILED: ${item.s3Key}")
                            if (cont.isActive) cont.resumeWithException(
                                Exception("Transfer failed for ${item.s3Key}")
                            )
                        }
                        else -> Unit
                    }
                }

                override fun onProgressChanged(
                    id: Int,
                    bytesCurrent: Long,
                    bytesTotal: Long,
                ) {
                    val progress = if (bytesTotal > 0) (bytesCurrent * 100 / bytesTotal) else 0
                    Log.v(TAG, "Transfer $id progress: $progress% ($bytesCurrent/$bytesTotal bytes)")
                }

                override fun onError(
                    id: Int,
                    ex: Exception,
                ) {
                    Log.e(TAG, "Transfer $id ERROR: ${item.s3Key}", ex)
                    if (cont.isActive) cont.resumeWithException(ex)
                }
            },
        )
        cont.invokeOnCancellation {
            Log.w(TAG, "Transfer cancelled for ${item.s3Key}")
        }
    }

    companion object {
        private const val TAG = "UploadWorker"
        
        fun enqueue(context: Context) {
            Log.i(TAG, "Enqueueing upload work")
            val request =
                OneTimeWorkRequestBuilder<UploadWorker>()
                    .setConstraints(
                        Constraints
                            .Builder()
                            .setRequiredNetworkType(NetworkType.CONNECTED)
                            .build(),
                    ).setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                    .build()
            WorkManager
                .getInstance(context)
                .enqueueUniqueWork("pai_upload", ExistingWorkPolicy.APPEND_OR_REPLACE, request)
        }
    }
}

// ── Custom WorkerFactory ──────────────────────────────────────────────────────

class UploadWorkerFactory(
    private val db: AppDatabase,
) : WorkerFactory() {
    override fun createWorker(
        ctx: Context,
        workerClassName: String,
        params: WorkerParameters,
    ) = if (workerClassName == UploadWorker::class.java.name) {
        UploadWorker(ctx, params, db)
    } else {
        null
    }
}
