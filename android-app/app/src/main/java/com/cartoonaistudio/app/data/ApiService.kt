package com.cartoonaistudio.app.data

import com.cartoonaistudio.app.BuildConfig
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.RequestBody
import okhttp3.ResponseBody
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.Part
import retrofit2.http.Path
import retrofit2.http.Streaming
import java.util.concurrent.TimeUnit

interface CartoonApiService {
    @Multipart
    @POST("api/jobs")
    suspend fun createJob(
        @Part video: MultipartBody.Part,
        @Part("visual_style") visualStyle: RequestBody
    ): Response<CreateJobResponse>

    @GET("api/jobs")
    suspend fun listJobs(): Response<JobListResponse>

    @GET("api/jobs/{jobId}")
    suspend fun getJobStatus(
        @Path("jobId") jobId: String
    ): Response<JobStatusDto>

    @POST("api/jobs/{jobId}/resume")
    suspend fun resumeJob(
        @Path("jobId") jobId: String
    ): Response<ResumeJobResponse>

    @Streaming
    @GET("api/jobs/{jobId}/download")
    suspend fun downloadConvertedVideo(
        @Path("jobId") jobId: String
    ): Response<ResponseBody>
}

object ApiClient {
    val baseUrl: String
        get() = BuildConfig.BACKEND_BASE_URL.let { if (it.endsWith("/")) it else "$it/" }

    private val okHttpClient: OkHttpClient by lazy {
        val logging = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BASIC
        }
        OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(180, TimeUnit.SECONDS)
            .readTimeout(180, TimeUnit.SECONDS)
            .addInterceptor(logging)
            .build()
    }

    val service: CartoonApiService by lazy {
        Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(CartoonApiService::class.java)
    }

    fun convertedVideoStreamUrl(jobId: String): String =
        "${baseUrl}api/jobs/$jobId/download?inline=1"

    fun originalVideoStreamUrl(jobId: String): String =
        "${baseUrl}api/jobs/$jobId/original"

    fun characterAssetUrl(jobId: String, assetName: String): String =
        "${baseUrl}api/jobs/$jobId/assets/$assetName"
}
