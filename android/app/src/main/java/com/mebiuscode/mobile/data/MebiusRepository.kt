package com.mebiuscode.mobile.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.UUID

class MebiusRepository(
    private val store: SessionStore,
) {
    private var storedSession: StoredSession? = store.read()
    private var api: MebiusApi? = storedSession?.let { createMebiusApi(it.apiBaseUrl) }

    val currentSession: StoredSession?
        get() = storedSession

    suspend fun login(apiBaseUrl: String, email: String, password: String): MobileOverview = withContext(Dispatchers.IO) {
        val normalized = normalizeApiBaseUrl(apiBaseUrl)
        val client = createMebiusApi(normalized)
        val auth = client.login(LoginRequest(email.trim(), password))
        val session = StoredSession(normalized, auth.accessToken, auth.user.name)
        store.save(session)
        storedSession = session
        api = client
        client.overview(bearer(session.accessToken))
    }

    suspend fun restore(): MobileOverview? = withContext(Dispatchers.IO) {
        val session = storedSession ?: return@withContext null
        val client = api ?: createMebiusApi(session.apiBaseUrl).also { api = it }
        client.overview(bearer(session.accessToken))
    }

    suspend fun updateApiBaseUrl(apiBaseUrl: String): MobileOverview = withContext(Dispatchers.IO) {
        val session = storedSession ?: error("Not logged in")
        val normalized = normalizeApiBaseUrl(apiBaseUrl)
        val client = createMebiusApi(normalized)
        val overview = client.overview(bearer(session.accessToken))
        val updatedSession = session.copy(apiBaseUrl = normalized)
        store.save(updatedSession)
        storedSession = updatedSession
        api = client
        overview
    }

    fun logout() {
        store.clear()
        storedSession = null
        api = null
    }

    suspend fun overview(): MobileOverview = withApi { client, token ->
        client.overview(bearer(token))
    }

    suspend fun createSession(projectId: String, title: String?): Session = withApi { client, token ->
        client.createSession(bearer(token), projectId, CreateSessionRequest(title = title?.ifBlank { null }))
    }

    suspend fun updateSessionTitle(sessionId: String, title: String): Session = withApi { client, token ->
        client.updateSession(bearer(token), sessionId, UpdateSessionRequest(title.trim()))
    }

    suspend fun loadSession(sessionId: String): SessionDetails = withApi { client, token ->
        val auth = bearer(token)
        val session = client.session(auth, sessionId)
        val messages = client.messages(auth, sessionId)
        val plan = runCatching { client.latestPlan(auth, sessionId) }.getOrNull()
        val approvals = client.pendingApprovals(auth).filter { it.toolCall.session?.id == sessionId }
        val patches = runCatching { client.patches(auth, sessionId) }.getOrDefault(emptyList())
        val runs = runCatching { client.commandRuns(auth, sessionId) }.getOrDefault(emptyList())
        SessionDetails(session, messages, plan, approvals, patches, runs)
    }

    suspend fun deleteSession(sessionId: String) = withApi { client, token ->
        client.deleteSession(bearer(token), sessionId)
    }

    suspend fun runAgent(sessionId: String, message: String) = withApi { client, token ->
        client.runAgent(bearer(token), sessionId, RunAgentRequest(message = message))
    }

    suspend fun executeApprovedPlan(sessionId: String, planId: String) = withApi { client, token ->
        client.runAgent(bearer(token), sessionId, RunAgentRequest(approvedPlanId = planId))
    }

    suspend fun createPlan(sessionId: String, goal: String): PlanBundle = withApi { client, token ->
        client.createPlan(
            bearer(token),
            sessionId,
            CreatePlanRequest(goal = goal, clientRequestId = UUID.randomUUID().toString()),
        )
    }

    suspend fun updatePlanAnswer(planId: String, answer: PlanQuestionAnswer): PlanBundle = withApi { client, token ->
        client.updatePlanAnswers(bearer(token), planId, UpdatePlanAnswersRequest(listOf(answer)))
    }

    suspend fun finalizePlan(planId: String): PlanBundle = withApi { client, token ->
        client.finalizePlan(bearer(token), planId)
    }

    suspend fun approvePlan(planId: String): Plan = withApi { client, token ->
        client.approvePlan(bearer(token), planId)
    }

    suspend fun cancelPlan(planId: String): Plan = withApi { client, token ->
        client.cancelPlan(bearer(token), planId)
    }

    suspend fun revisePlan(planId: String, instruction: String): PlanBundle = withApi { client, token ->
        client.revisePlan(bearer(token), planId, RevisePlanRequest(instruction))
    }

    suspend fun discussPlan(planId: String, message: String): Message = withApi { client, token ->
        client.discussPlan(bearer(token), planId, DiscussPlanRequest(message))
    }

    suspend fun approveTool(approvalId: String) = withApi { client, token ->
        client.approve(bearer(token), approvalId, ApprovalDecisionRequest("once"))
    }

    suspend fun rejectTool(approvalId: String) = withApi { client, token ->
        client.reject(bearer(token), approvalId)
    }

    fun eventUrl(sessionId: String): String {
        val session = storedSession ?: error("Not logged in")
        val token = URLEncoder.encode(session.accessToken, StandardCharsets.UTF_8.toString())
        return "${normalizeApiBaseUrl(session.apiBaseUrl)}sessions/$sessionId/events?access_token=$token"
    }

    private suspend fun <T> withApi(block: suspend (MebiusApi, String) -> T): T = withContext(Dispatchers.IO) {
        val session = storedSession ?: error("Not logged in")
        val client = api ?: createMebiusApi(session.apiBaseUrl).also { api = it }
        block(client, session.accessToken)
    }
}
