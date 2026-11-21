package com.cartoonaistudio.app.util

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import android.provider.OpenableColumns
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream

data class LocalVideoInfo(
    val uri: Uri,
    val displayName: String,
    val durationSec: Double,
    val fileSizeBytes: Long,
    val width: Int,
    val height: Int,
    val mimeType: String
)

object VideoUtils {
    const val MAX_DURATION_SEC = 60.5
    private val ALLOWED_EXTENSIONS = setOf("mp4", "mov")

    fun inspectLocalVideo(context: Context, uri: Uri): Result<LocalVideoInfo> {
        return runCatching {
            val contentResolver = context.contentResolver
            val mimeType = contentResolver.getType(uri) ?: "video/mp4"
            var displayName = "cartoon_video.mp4"
            var fileSize = 0L

            contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                    if (nameIndex >= 0) displayName = cursor.getString(nameIndex) ?: displayName
                    if (sizeIndex >= 0) fileSize = cursor.getLong(sizeIndex)
                }
            }

            val ext = displayName.substringAfterLast('.', "").lowercase()
            if (ext !in ALLOWED_EXTENSIONS && mimeType != "video/mp4" && mimeType != "video/quicktime") {
                throw IllegalArgumentException("Unsupported format. Select an MP4 or MOV video.")
            }

            val retriever = MediaMetadataRetriever()
            try {
                retriever.setDataSource(context, uri)
                val durationMs = retriever.extractMetadata(
                    MediaMetadataRetriever.METADATA_KEY_DURATION
                )?.toLongOrNull() ?: 0L
                val width = retriever.extractMetadata(
                    MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH
                )?.toIntOrNull() ?: 0
                val height = retriever.extractMetadata(
                    MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT
                )?.toIntOrNull() ?: 0
                val rotation = retriever.extractMetadata(
                    MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION
                )?.toIntOrNull() ?: 0

                val durationSec = durationMs / 1000.0
                if (durationSec <= 0.0) {
                    throw IllegalArgumentException("Could not read video duration.")
                }
                if (durationSec > MAX_DURATION_SEC) {
                    throw IllegalArgumentException(
                        "Video is %.1fs long. Maximum supported duration is 60 seconds.".format(durationSec)
                    )
                }

                val effectiveW = if (rotation == 90 || rotation == 270) height else width
                val effectiveH = if (rotation == 90 || rotation == 270) width else height

                LocalVideoInfo(
                    uri = uri,
                    displayName = displayName,
                    durationSec = durationSec,
                    fileSizeBytes = fileSize,
                    width = effectiveW,
                    height = effectiveH,
                    mimeType = mimeType
                )
            } finally {
                retriever.release()
            }
        }
    }

    fun copyUriToTempFile(context: Context, uri: Uri, filename: String): File {
        val safeName = filename.replace(Regex("[^a-zA-Z0-9._-]"), "_")
        val outFile = File(context.cacheDir, "upload_${System.currentTimeMillis()}_$safeName")
        context.contentResolver.openInputStream(uri)?.use { input ->
            FileOutputStream(outFile).use { output ->
                input.copyTo(output)
            }
        } ?: throw IllegalStateException("Unable to read selected video stream.")
        return outFile
    }

    fun saveMp4ToGallery(context: Context, sourceFile: File, displayName: String): Result<Uri> {
        return runCatching {
            val resolver = context.contentResolver
            val values = ContentValues().apply {
                put(MediaStore.Video.Media.DISPLAY_NAME, displayName)
                put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
                put(
                    MediaStore.Video.Media.RELATIVE_PATH,
                    "${Environment.DIRECTORY_MOVIES}/CartoonAIStudio"
                )
                put(MediaStore.Video.Media.IS_PENDING, 1)
            }

            val collection = MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            val targetUri = resolver.insert(collection, values)
                ?: throw IllegalStateException("MediaStore failed to allocate output video entry.")

            resolver.openOutputStream(targetUri)?.use { out ->
                sourceFile.inputStream().use { input ->
                    input.copyTo(out)
                }
            } ?: throw IllegalStateException("Unable to open gallery output stream.")

            values.clear()
            values.put(MediaStore.Video.Media.IS_PENDING, 0)
            resolver.update(targetUri, values, null, null)
            targetUri
        }
    }

    fun shareVideoFile(context: Context, mp4File: File) {
        val uri = FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            mp4File
        )
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "video/mp4"
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_SUBJECT, "Cartoon AI Studio — 3D Anime Video")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(Intent.createChooser(intent, "Share 3D Anime Video"))
    }

    fun formatBytes(bytes: Long): String = when {
        bytes < 1024L -> "$bytes B"
        bytes < 1024L * 1024L -> "%.1f KB".format(bytes / 1024.0)
        else -> "%.2f MB".format(bytes / (1024.0 * 1024.0))
    }

    fun formatDuration(seconds: Double): String {
        val total = seconds.toInt().coerceAtLeast(0)
        return "%d:%02d".format(total / 60, total % 60)
    }
}
