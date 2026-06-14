package com.mebiuscode.mobile.data

import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import okhttp3.MediaType.Companion.toMediaType

interface MebiusApi {
    @POST("auth/login")
    suspend fun login(@Body body: LoginRequest): AuthResponse

    @GET("auth/me")
    suspend fun me(@Header("Authorization") authorization: String): User

    @GET("mobile/overview")
    suspend fun overview(@Header("Authorization") authorization: String): MobileOverview

    @GET("projects/{projectId}/sessions")
    suspend fun sessions(
        @Header("Authorization") authorization: String,
        @Path("projectId") projectId: String,
    ): ListResponse<Session>

    @POST("projects/{projectId}/sessions")
    suspend fun createSession(
        @Header("Authorization") authorization: String,
        @Path("projectId") projectId: String,
        @Body body: CreateSessionRequest,
    ): Session

    @GET("sessions/{sessionId}")
    suspend fun session(
        @Header("Authorization") authorization: String,
        @Path("sessionId") sessionId: String,
    ): Session

    @PATCH("sessions/{sessionId}")
    suspend fun updateSession(
        @Header("Authorization") authorization: String,
        @Path("sessionId") sessionId: String,
        @Body body: UpdateSessionRequest,
    ): Session

    @DELETE("sessions/{sessionId}")
    suspend fun deleteSession(
        @Header("Authorization") authorization: String,
        @Path("sessionId") sessionId: String,
    ): Response<ResponseBody>

    @GET("sessions/{sessionId}/messages")
    suspend fun messages(
        @Header("Authorization") authorization: String,
        @Path("sessionId") sessionId: String,
    ): List<Message>

    @POST("sessions/{sessionId}/run")
    suspend fun runAgent(
        @Header("Authorization") authorization: String,
        @Path("sessionId") sessionId: String,
        @Body body: RunAgentRequest,
    ): Response<ResponseBody>

    @POST("sessions/{sessionId}/plan")
    suspend fun createPlan(
        @Header("Authorization") authorization: String,
        @Path("sessionId") sessionId: String,
        @Body body: CreatePlanRequest,
    ): PlanBundle

    @GET("sessions/{sessionId}/plans/latest")
    suspend fun latestPlan(
        @Header("Authorization") authorization: String,
        @Path("sessionId") sessionId: String,
    ): PlanBundle?

    @POST("plans/{planId}/approve")
    suspend fun approvePlan(
        @Header("Authorization") authorization: String,
        @Path("planId") planId: String,
    ): Plan

    @POST("plans/{planId}/revise")
    suspend fun revisePlan(
        @Header("Authorization") authorization: String,
        @Path("planId") planId: String,
        @Body body: RevisePlanRequest,
    ): PlanBundle

    @POST("plans/{planId}/discuss")
    suspend fun discussPlan(
        @Header("Authorization") authorization: String,
        @Path("planId") planId: String,
        @Body body: DiscussPlanRequest,
    ): Message

    @PATCH("plans/{planId}/answers")
    suspend fun updatePlanAnswers(
        @Header("Authorization") authorization: String,
        @Path("planId") planId: String,
        @Body body: UpdatePlanAnswersRequest,
    ): PlanBundle

    @POST("plans/{planId}/finalize")
    suspend fun finalizePlan(
        @Header("Authorization") authorization: String,
        @Path("planId") planId: String,
    ): PlanBundle

    @POST("plans/{planId}/cancel")
    suspend fun cancelPlan(
        @Header("Authorization") authorization: String,
        @Path("planId") planId: String,
    ): Plan

    @GET("approvals/pending")
    suspend fun pendingApprovals(@Header("Authorization") authorization: String): List<Approval>

    @POST("approvals/{approvalId}/approve")
    suspend fun approve(
        @Header("Authorization") authorization: String,
        @Path("approvalId") approvalId: String,
        @Body body: ApprovalDecisionRequest = ApprovalDecisionRequest(),
    ): Response<ResponseBody>

    @POST("approvals/{approvalId}/reject")
    suspend fun reject(
        @Header("Authorization") authorization: String,
        @Path("approvalId") approvalId: String,
    ): Response<ResponseBody>

    @GET("sessions/{sessionId}/patches")
    suspend fun patches(
        @Header("Authorization") authorization: String,
        @Path("sessionId") sessionId: String,
    ): List<FilePatch>

    @GET("sessions/{sessionId}/command-runs")
    suspend fun commandRuns(
        @Header("Authorization") authorization: String,
        @Path("sessionId") sessionId: String,
    ): List<CommandRunView>

    @DELETE("sessions/{sessionId}/command-authorization")
    suspend fun revokeCommandAuthorization(
        @Header("Authorization") authorization: String,
        @Path("sessionId") sessionId: String,
    ): Response<ResponseBody>
}

object MebiusJson {
    val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
    }
}

fun createMebiusApi(apiBaseUrl: String): MebiusApi {
    val contentType = "application/json".toMediaType()
    val client = OkHttpClient.Builder()
        .addInterceptor(ErrorInterceptor)
        .build()
    return Retrofit.Builder()
        .baseUrl(normalizeApiBaseUrl(apiBaseUrl))
        .client(client)
        .addConverterFactory(MebiusJson.json.asConverterFactory(contentType))
        .build()
        .create(MebiusApi::class.java)
}

fun bearer(token: String): String = "Bearer $token"

fun normalizeApiBaseUrl(value: String): String {
    val trimmed = value.trim().ifBlank { "http://10.0.2.2:3000/api" }
    return if (trimmed.endsWith("/")) trimmed else "$trimmed/"
}

private object ErrorInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): okhttp3.Response {
        val response = chain.proceed(chain.request())
        if (response.isSuccessful) return response
        val message = response.body?.string()?.let(::extractErrorMessage)
            ?: "HTTP ${response.code}"
        response.close()
        throw RuntimeException(message)
    }
}

private fun extractErrorMessage(raw: String): String {
    val parsed = runCatching { MebiusJson.json.parseToJsonElement(raw).jsonObject }.getOrNull()
    val message = parsed?.get("message")?.toString()?.trim('"')
    val error = parsed?.get("error")?.toString()?.trim('"')
    return message?.takeIf { it.isNotBlank() } ?: error?.takeIf { it.isNotBlank() } ?: raw
}
