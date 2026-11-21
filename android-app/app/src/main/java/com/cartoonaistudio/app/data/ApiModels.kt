package com.cartoonaistudio.app.data

import com.google.gson.annotations.SerializedName

data class CreateJobResponse(
    @SerializedName("job_id") val jobId: String,
    @SerializedName("job") val job: JobStatusDto? = null
)

data class ResumeJobResponse(
    @SerializedName("job") val job: JobStatusDto,
    @SerializedName("resumedFromStage") val resumedFromStage: Int? = null
)

data class JobListResponse(
    @SerializedName("jobs") val jobs: List<JobStatusDto> = emptyList()
)

data class VideoMetadataDto(
    @SerializedName("durationSec") val durationSec: Double = 0.0,
    @SerializedName("width") val width: Int = 0,
    @SerializedName("height") val height: Int = 0,
    @SerializedName("fps") val fps: Double = 24.0,
    @SerializedName("hasAudio") val hasAudio: Boolean = true,
    @SerializedName("orientation") val orientation: String = "landscape",
    @SerializedName("codec") val codec: String = "h264",
    @SerializedName("fileSizeBytes") val fileSizeBytes: Long = 0L
)

data class CharacterProfileDto(
    @SerializedName("characterId") val characterId: String,
    @SerializedName("name") val name: String,
    @SerializedName("facialFeatures") val facialFeatures: String = "",
    @SerializedName("hairStyleAndColor") val hairStyleAndColor: String = "",
    @SerializedName("eyeShapeAndColor") val eyeShapeAndColor: String = "",
    @SerializedName("clothingAndAccessories") val clothingAndAccessories: String = "",
    @SerializedName("bodyProportions") val bodyProportions: String = "",
    @SerializedName("colorPalette") val colorPalette: String = "",
    @SerializedName("distinctiveFeatures") val distinctiveFeatures: String = "",
    @SerializedName("animeRefAsset") val animeRefAsset: String? = null
)

data class SceneSegmentDto(
    @SerializedName("sceneIndex") val sceneIndex: Int,
    @SerializedName("startSec") val startSec: Double,
    @SerializedName("endSec") val endSec: Double,
    @SerializedName("summary") val summary: String,
    @SerializedName("status") val status: String,
    @SerializedName("characterIds") val characterIds: List<String> = emptyList(),
    @SerializedName("errorMessage") val errorMessage: String? = null
)

data class JobStatusDto(
    @SerializedName("jobId") val jobId: String,
    @SerializedName("originalFilename") val originalFilename: String,
    @SerializedName("status") val status: String,
    @SerializedName("progress") val progress: Int,
    @SerializedName("currentStage") val currentStage: Int,
    @SerializedName("currentStageLabel") val currentStageLabel: String,
    @SerializedName("lastCompletedStage") val lastCompletedStage: Int,
    @SerializedName("stageDetail") val stageDetail: String = "",
    @SerializedName("estimatedSecondsRemaining") val estimatedSecondsRemaining: Int? = null,
    @SerializedName("errorMessage") val errorMessage: String? = null,
    @SerializedName("resumable") val resumable: Boolean = false,
    @SerializedName("metadata") val metadata: VideoMetadataDto = VideoMetadataDto(),
    @SerializedName("characters") val characters: List<CharacterProfileDto> = emptyList(),
    @SerializedName("scenes") val scenes: List<SceneSegmentDto> = emptyList(),
    @SerializedName("hasOutputVideo") val hasOutputVideo: Boolean = false,
    @SerializedName("createdAt") val createdAt: String = ""
)

val PIPELINE_STAGE_LABELS = listOf(
    1 to "Uploading video",
    2 to "Extracting frames",
    3 to "Gemini analyzing video",
    4 to "Detecting characters",
    5 to "Creating character reference profiles",
    6 to "Detecting scenes and movements",
    7 to "Veo generating 3D Anime scenes",
    8 to "Combining generated scenes",
    9 to "Synchronizing original audio",
    10 to "Rendering final MP4"
)
