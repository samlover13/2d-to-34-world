package com.cartoonaistudio.app.viewmodel

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.cartoonaistudio.app.data.ApiClient
import com.cartoonaistudio.app.data.ConversionHistoryEntity
import com.cartoonaistudio.app.data.HistoryDatabase
import com.cartoonaistudio.app.data.JobStatusDto
import com.cartoonaistudio.app.util.LocalVideoInfo
import com.cartoonaistudio.app.util.VideoUtils
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import java.io.File
import java.io.FileOutputStream

enum class ScreenRoute {
    HOME,
    PROCESSING,
    RESULT
}

data class StudioUiState(
    val route: ScreenRoute = ScreenRoute.HOME,
    val selectedVideo: LocalVideoInfo? = null,
    val activeJob: JobStatusDto? = null,
    val isUploading: Boolean = false,
    val isDownloading: Boolean = false,
    val errorMessage: String? = null,
    val statusNotice: String? = null,
    val downloadedMp4File: File? = null
)

class StudioViewModel(application: Application) : AndroidViewModel(application) {
    private val historyDao = HistoryDatabase.getInstance(application).historyDao()

    private val _uiState = MutableStateFlow(StudioUiState())
    val uiState: StateFlow<StudioUiState> = _uiState.asStateFlow()

    val recentHistory: StateFlow<List<ConversionHistoryEntity>> = historyDao
        .observeRecent()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    private var pollingJob: Job? = null

    fun onVideoSelected(uri: Uri) {
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) {
                VideoUtils.inspectLocalVideo(getApplication(), uri)
            }
            result.onSuccess { info ->
                _uiState.update {
                    it.copy(selectedVideo = info, errorMessage = null, statusNotice = null)
                }
            }.onFailure { err ->
                _uiState.update {
                    it.copy(errorMessage = err.message ?: "Invalid video selected.")
                }
            }
        }
    }

    fun startConversion() {
        val selected = _uiState.value.selectedVideo ?: return
        if (_uiState.value.isUploading) return

        viewModelScope.launch {
            _uiState.update { it.copy(isUploading = true, errorMessage = null, downloadedMp4File = null) }
            try {
                val tempFile = withContext(Dispatchers.IO) {
                    VideoUtils.copyUriToTempFile(getApplication(), selected.uri, selected.displayName)
                }
                val requestBody = tempFile.asRequestBody(selected.mimeType.toMediaTypeOrNull())
                val multipart = MultipartBody.Part.createFormData("video", selected.displayName, requestBody)

                val response = withContext(Dispatchers.IO) {
                    ApiClient.service.createJob(multipart)
                }
                tempFile.delete()

                if (!response.isSuccessful || response.body() == null) {
                    val errText = response.errorBody()?.string() ?: "Upload failed (${response.code()})"
                    throw IllegalStateException(errText)
                }

                val body = response.body()!!
                val jobId = body.jobId
                val initialJob = body.job ?: withContext(Dispatchers.IO) {
                    ApiClient.service.getJobStatus(jobId).body()
                } ?: throw IllegalStateException("Server did not return job status.")

                saveHistory(initialJob, selected.uri.toString())
                _uiState.update {
                    it.copy(
                        isUploading = false,
                        activeJob = initialJob,
                        route = ScreenRoute.PROCESSING
                    )
                }
                beginPolling(jobId)
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isUploading = false,
                        errorMessage = e.message ?: "Failed to upload video."
                    )
                }
            }
        }
    }

    fun openHistoryJob(jobId: String) {
        viewModelScope.launch {
            try {
                val res = withContext(Dispatchers.IO) { ApiClient.service.getJobStatus(jobId) }
                val job = res.body() ?: throw IllegalStateException("Job not found on server.")
                saveHistory(job, null)
                _uiState.update {
                    it.copy(
                        activeJob = job,
                        downloadedMp4File = null,
                        errorMessage = null,
                        route = if (job.status == "completed") ScreenRoute.RESULT else ScreenRoute.PROCESSING
                    )
                }
                if (job.status == "queued" || job.status == "processing") {
                    beginPolling(job.jobId)
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(errorMessage = e.message ?: "Unable to load job.") }
            }
        }
    }

    fun resumeActiveJob() {
        val jobId = _uiState.value.activeJob?.jobId ?: return
        viewModelScope.launch {
            try {
                val res = withContext(Dispatchers.IO) { ApiClient.service.resumeJob(jobId) }
                val updated = res.body()?.job ?: throw IllegalStateException("Resume request failed.")
                saveHistory(updated, null)
                _uiState.update { it.copy(activeJob = updated, errorMessage = null) }
                beginPolling(jobId)
            } catch (e: Exception) {
                _uiState.update { it.copy(errorMessage = e.message ?: "Unable to resume job.") }
            }
        }
    }

    private fun beginPolling(jobId: String) {
        pollingJob?.cancel()
        pollingJob = viewModelScope.launch {
            while (true) {
                delay(2500L)
                try {
                    val res = withContext(Dispatchers.IO) { ApiClient.service.getJobStatus(jobId) }
                    val job = res.body() ?: continue
                    saveHistory(job, null)
                    _uiState.update { state ->
                        val nextRoute = if (job.status == "completed") ScreenRoute.RESULT else state.route
                        state.copy(activeJob = job, route = nextRoute)
                    }
                    if (job.status == "completed" || job.status == "failed") {
                        break
                    }
                } catch (_: Exception) {
                    // Continue polling through temporary network drops
                }
            }
        }
    }

    fun downloadAndSaveToGallery(saveToGallery: Boolean) {
        val job = _uiState.value.activeJob ?: return
        viewModelScope.launch {
            _uiState.update { it.copy(isDownloading = true, statusNotice = null) }
            try {
                val localFile = ensureLocalConvertedFile(job)
                if (saveToGallery) {
                    val displayName = "${job.originalFilename.substringBeforeLast('.')}_3d_anime.mp4"
                    VideoUtils.saveMp4ToGallery(getApplication(), localFile, displayName).getOrThrow()
                    _uiState.update {
                        it.copy(
                            isDownloading = false,
                            downloadedMp4File = localFile,
                            statusNotice = "Saved to Gallery (Movies/CartoonAIStudio/$displayName)"
                        )
                    }
                } else {
                    _uiState.update {
                        it.copy(
                            isDownloading = false,
                            downloadedMp4File = localFile,
                            statusNotice = "Downloaded MP4 ready (${VideoUtils.formatBytes(localFile.length())})"
                        )
                    }
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(isDownloading = false, errorMessage = e.message ?: "Download failed.")
                }
            }
        }
    }

    fun shareConvertedVideo(onReadyToShare: (File) -> Unit) {
        val job = _uiState.value.activeJob ?: return
        viewModelScope.launch {
            _uiState.update { it.copy(isDownloading = true) }
            try {
                val file = ensureLocalConvertedFile(job)
                _uiState.update { it.copy(isDownloading = false, downloadedMp4File = file) }
                onReadyToShare(file)
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(isDownloading = false, errorMessage = e.message ?: "Share preparation failed.")
                }
            }
        }
    }

    private suspend fun ensureLocalConvertedFile(job: JobStatusDto): File {
        _uiState.value.downloadedMp4File?.takeIf { it.exists() }?.let { return it }
        return withContext(Dispatchers.IO) {
            val res = ApiClient.service.downloadConvertedVideo(job.jobId)
            val body = res.body() ?: throw IllegalStateException("Download failed (${res.code()}).")
            val dir = File(getApplication<Application>().cacheDir, "converted").apply { mkdirs() }
            val target = File(dir, "${job.jobId}_3d_anime.mp4")
            body.byteStream().use { input ->
                FileOutputStream(target).use { out -> input.copyTo(out) }
            }
            target
        }
    }

    fun navigateHome(clearSelection: Boolean = false) {
        pollingJob?.cancel()
        _uiState.update {
            it.copy(
                route = ScreenRoute.HOME,
                selectedVideo = if (clearSelection) null else it.selectedVideo,
                errorMessage = null,
                statusNotice = null
            )
        }
    }

    private suspend fun saveHistory(job: JobStatusDto, originalUri: String?) {
        withContext(Dispatchers.IO) {
            historyDao.upsert(
                ConversionHistoryEntity(
                    jobId = job.jobId,
                    originalFilename = job.originalFilename,
                    originalLocalUri = originalUri,
                    durationSec = job.metadata.durationSec,
                    width = job.metadata.width,
                    height = job.metadata.height,
                    status = job.status,
                    progress = job.progress,
                    currentStageLabel = job.currentStageLabel,
                    updatedAtEpochMs = System.currentTimeMillis()
                )
            )
        }
    }
}
