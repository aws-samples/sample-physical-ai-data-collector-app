package com.amazon.paidatacollector.data

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase

// ── Entity ──────────────────────────────────────────────────────────────────

@Entity(tableName = "capture_queue")
data class CaptureItem(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val localPath: String, // absolute path on device
    val s3Key: String, // target S3 key
    val mediaType: String, // "video" | "data"
    val scenario: String,
    val location: String,
    val taskType: String,
    val capturedAt: Long = System.currentTimeMillis(),
    val status: String = "PENDING", // PENDING | UPLOADING | DONE | FAILED
    val retryCount: Int = 0,
)

// ── DAO ─────────────────────────────────────────────────────────────────────

@Dao
interface CaptureDao {
    @Insert suspend fun insert(item: CaptureItem): Long

    @Query("SELECT * FROM capture_queue WHERE status = 'PENDING' OR status = 'FAILED' ORDER BY capturedAt ASC")
    suspend fun getPending(): List<CaptureItem>

    @Query("UPDATE capture_queue SET status = :status, retryCount = retryCount + 1 WHERE id = :id")
    suspend fun updateStatus(
        id: Long,
        status: String,
    )

    @Query("SELECT COUNT(*) FROM capture_queue WHERE status = 'PENDING' OR status = 'UPLOADING'")
    suspend fun pendingCount(): Int
}

// ── Database ─────────────────────────────────────────────────────────────────

@Database(entities = [CaptureItem::class], version = 2, exportSchema = false)
abstract class AppDatabase : RoomDatabase() {
    abstract fun captureDao(): CaptureDao

    companion object {
        @Volatile private var instance: AppDatabase? = null

        fun getInstance(context: android.content.Context): AppDatabase =
            instance ?: synchronized(this) {
                Room
                    .databaseBuilder(context, AppDatabase::class.java, "pai_db")
                    .fallbackToDestructiveMigration()
                    .build()
                    .also { instance = it }
            }
    }
}
