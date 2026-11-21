package com.cartoonaistudio.app.data

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import kotlinx.coroutines.flow.Flow

@Entity(tableName = "conversion_history")
data class ConversionHistoryEntity(
    @PrimaryKey val jobId: String,
    val originalFilename: String,
    val originalLocalUri: String?,
    val durationSec: Double,
    val width: Int,
    val height: Int,
    val status: String,
    val progress: Int,
    val currentStageLabel: String,
    val updatedAtEpochMs: Long
)

@Dao
interface ConversionHistoryDao {
    @Query("SELECT * FROM conversion_history ORDER BY updatedAtEpochMs DESC LIMIT 30")
    fun observeRecent(): Flow<List<ConversionHistoryEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entry: ConversionHistoryEntity)
}

@Database(entities = [ConversionHistoryEntity::class], version = 1, exportSchema = false)
abstract class HistoryDatabase : RoomDatabase() {
    abstract fun historyDao(): ConversionHistoryDao

    companion object {
        @Volatile
        private var INSTANCE: HistoryDatabase? = null

        fun getInstance(context: Context): HistoryDatabase {
            return INSTANCE ?: synchronized(this) {
                Room.databaseBuilder(
                    context.applicationContext,
                    HistoryDatabase::class.java,
                    "cartoon_ai_studio_history.db"
                ).build().also { INSTANCE = it }
            }
        }
    }
}
