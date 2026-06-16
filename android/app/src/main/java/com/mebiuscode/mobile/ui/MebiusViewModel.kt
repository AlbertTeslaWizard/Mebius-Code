package com.mebiuscode.mobile.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.mebiuscode.mobile.BuildConfig
import com.mebiuscode.mobile.data.Approval
import com.mebiuscode.mobile.data.LoadState
import com.mebiuscode.mobile.data.MebiusRepository
import com.mebiuscode.mobile.data.Message
import com.mebiuscode.mobile.data.MobileOverview
import com.mebiuscode.mobile.data.PlanBundle
import com.mebiuscode.mobile.data.PlanQuestionAnswer
import com.mebiuscode.mobile.data.Project
import com.mebiuscode.mobile.data.SessionDetails
import com.mebiuscode.mobile.data.SseClient
import com.mebiuscode.mobile.data.SseStreamException
import com.mebiuscode.mobile.data.contentDelta
import com.mebiuscode.mobile.data.statusText
import com.mebiuscode.mobile.data.userMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

data class UiState(
    val route: Route = Route.Login,
    val loginApi: String = BuildConfig.DEFAULT_API_BASE_URL,
    val loginEmail: String = "",
    val loginPassword: String = "",
    val settingsApi: String = "",
    val settingsSaving: Boolean = false,
    val settingsReturnRoute: Route = Route.Dashboard,
    val userName: String = "",
    val overview: LoadState<MobileOverview> = LoadState.Idle,
    val sessionDetails: LoadState<SessionDetails> = LoadState.Idle,
    val selectedProject: Project? = null,
    val selectedSessionId: String? = null,
    val composerText: String = "",
    val composerMode: ComposerMode = ComposerMode.Build,
    val streamStatus: String = "idle",
    val streamingText: String = "",
    val error: String? = null,
)

sealed interface Route {
    data object Login : Route
    data object Dashboard : Route
    data object Settings : Route
    data class ProjectSessions(val projectId: String) : Route
    data class Session(val sessionId: String) : Route
}

enum class ComposerMode { Build, Plan }

class MebiusViewModel(
    private val repository: MebiusRepository,
    private val sseClient: SseClient = SseClient(),
) : ViewModel() {
    private companion object {
        const val SILENT_STREAM_RETRY_LIMIT = 5
        val STREAM_RETRY_DELAYS_MS = longArrayOf(1_000, 2_000, 4_000, 8_000, 15_000)
    }

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state
    private var streamJob: Job? = null

    init {
        repository.currentSession?.let { stored ->
            _state.update {
                it.copy(
                    loginApi = stored.apiBaseUrl,
                    settingsApi = stored.apiBaseUrl,
                    userName = stored.userName,
                    route = Route.Dashboard,
                    overview = LoadState.Loading,
                )
            }
            refreshOverview()
        }
    }

    fun setLoginApi(value: String) = _state.update { it.copy(loginApi = value) }
    fun setLoginEmail(value: String) = _state.update { it.copy(loginEmail = value) }
    fun setLoginPassword(value: String) = _state.update { it.copy(loginPassword = value) }
    fun setSettingsApi(value: String) = _state.update { it.copy(settingsApi = value) }
    fun setComposerText(value: String) = _state.update { it.copy(composerText = value) }
    fun setComposerMode(mode: ComposerMode) = _state.update { it.copy(composerMode = mode) }
    fun clearError() = _state.update { it.copy(error = null) }

    fun login() {
        val snapshot = _state.value
        _state.update { it.copy(overview = LoadState.Loading, error = null) }
        viewModelScope.launch {
            runCatching {
                repository.login(snapshot.loginApi, snapshot.loginEmail, snapshot.loginPassword)
            }.onSuccess { overview ->
                _state.update {
                    val currentApi = repository.currentSession?.apiBaseUrl ?: snapshot.loginApi
                    it.copy(
                        route = Route.Dashboard,
                        overview = LoadState.Ready(overview),
                        loginApi = currentApi,
                        settingsApi = currentApi,
                        userName = repository.currentSession?.userName.orEmpty(),
                        loginPassword = "",
                        error = null,
                    )
                }
            }.onFailure { error ->
                _state.update { it.copy(overview = LoadState.Failed(error.userMessage()), error = error.userMessage()) }
            }
        }
    }

    fun logout() {
        streamJob?.cancel()
        repository.logout()
        _state.value = UiState()
    }

    fun openSettings() {
        streamJob?.cancel()
        val snapshot = _state.value
        val returnRoute = when (snapshot.route) {
            Route.Login, Route.Settings -> Route.Dashboard
            else -> snapshot.route
        }
        _state.update {
            it.copy(
                route = Route.Settings,
                settingsApi = repository.currentSession?.apiBaseUrl ?: it.loginApi,
                settingsReturnRoute = returnRoute,
                settingsSaving = false,
                error = null,
            )
        }
    }

    fun closeSettings() {
        val returnRoute = _state.value.settingsReturnRoute
        when (returnRoute) {
            is Route.Session -> openSession(returnRoute.sessionId)
            is Route.ProjectSessions -> {
                _state.update { it.copy(route = returnRoute, error = null) }
                refreshOverview()
            }
            Route.Dashboard, Route.Login, Route.Settings -> {
                _state.update { it.copy(route = Route.Dashboard, error = null) }
                refreshOverview()
            }
        }
    }

    fun saveSettingsApi() {
        val snapshot = _state.value
        _state.update { it.copy(settingsSaving = true, error = null) }
        viewModelScope.launch {
            runCatching {
                repository.updateApiBaseUrl(snapshot.settingsApi)
            }.onSuccess { overview ->
                val currentApi = repository.currentSession?.apiBaseUrl ?: snapshot.settingsApi
                _state.update {
                    it.copy(
                        loginApi = currentApi,
                        settingsApi = currentApi,
                        settingsSaving = false,
                        overview = LoadState.Ready(overview),
                        userName = repository.currentSession?.userName.orEmpty(),
                        error = null,
                    )
                }
            }.onFailure { error ->
                _state.update {
                    it.copy(
                        settingsSaving = false,
                        error = error.userMessage(),
                    )
                }
            }
        }
    }

    fun navigateBack() {
        when (_state.value.route) {
            Route.Login, Route.Dashboard -> Unit
            Route.Settings -> closeSettings()
            is Route.ProjectSessions, is Route.Session -> backToDashboard()
        }
    }

    fun refreshOverview() {
        _state.update { it.copy(overview = LoadState.Loading, error = null) }
        viewModelScope.launch {
            runCatching { repository.overview() }
                .onSuccess { overview -> _state.update { it.copy(overview = LoadState.Ready(overview), error = null) } }
                .onFailure { error ->
                    _state.update {
                        it.copy(overview = LoadState.Failed(error.userMessage()), error = error.userMessage())
                    }
                }
        }
    }

    fun openProject(project: Project) {
        _state.update {
            it.copy(route = Route.ProjectSessions(project.id), selectedProject = project)
        }
    }

    fun openSession(sessionId: String) {
        streamJob?.cancel()
        _state.update {
            it.copy(
                route = Route.Session(sessionId),
                selectedSessionId = sessionId,
                sessionDetails = LoadState.Loading,
                streamStatus = "connecting",
                streamingText = "",
            )
        }
        viewModelScope.launch {
            runCatching { repository.loadSession(sessionId) }
                .onSuccess { details ->
                    _state.update { it.copy(sessionDetails = LoadState.Ready(details), error = null) }
                    subscribeSession(sessionId)
                }
                .onFailure { error ->
                    _state.update {
                        it.copy(sessionDetails = LoadState.Failed(error.userMessage()), error = error.userMessage())
                    }
                }
        }
    }

    fun backToDashboard() {
        streamJob?.cancel()
        _state.update {
            it.copy(
                route = Route.Dashboard,
                selectedProject = null,
                selectedSessionId = null,
                sessionDetails = LoadState.Idle,
                streamStatus = "idle",
                streamingText = "",
            )
        }
        refreshOverview()
    }

    fun createSession(project: Project, title: String) {
        val normalizedTitle = title.trim()
        if (normalizedTitle.length !in 2..120) {
            _state.update { it.copy(error = "Session title must be 2-120 characters.") }
            return
        }
        _state.update { it.copy(error = null) }
        viewModelScope.launch {
            runCatching { repository.createSession(project.id, normalizedTitle) }
                .onSuccess { session ->
                    refreshOverview()
                    openSession(session.id)
                }
                .onFailure { error -> _state.update { it.copy(error = error.userMessage()) } }
        }
    }

    fun renameSession(sessionId: String, title: String) {
        val normalizedTitle = title.trim()
        if (normalizedTitle.length !in 2..120) {
            _state.update { it.copy(error = "Session title must be 2-120 characters.") }
            return
        }
        _state.update { it.copy(error = null) }
        viewModelScope.launch {
            runCatching { repository.updateSessionTitle(sessionId, normalizedTitle) }
                .onSuccess {
                    refreshOverview()
                    if (isCurrentSession(sessionId)) {
                        refreshSessionDetails(sessionId)
                    }
                }
                .onFailure { error -> _state.update { it.copy(error = error.userMessage()) } }
        }
    }

    fun deleteSession(sessionId: String) {
        val wasCurrent = _state.value.selectedSessionId == sessionId
        if (wasCurrent) {
            streamJob?.cancel()
            _state.update { it.copy(error = null, streamStatus = "deleting") }
        } else {
            _state.update { it.copy(error = null) }
        }
        viewModelScope.launch {
            runCatching { repository.deleteSession(sessionId) }
                .onSuccess {
                    val snapshot = _state.value
                    if (snapshot.selectedSessionId == sessionId) {
                        clearCurrentSession()
                    }
                    refreshOverview()
                }
                .onFailure { error ->
                    _state.update {
                        it.copy(
                            error = error.userMessage(),
                            streamStatus = if (wasCurrent) "error" else it.streamStatus,
                        )
                    }
                    if (wasCurrent && isCurrentSession(sessionId)) {
                        subscribeSession(sessionId)
                    }
                }
        }
    }

    fun submitComposer() {
        val snapshot = _state.value
        val sessionId = snapshot.selectedSessionId ?: return
        val text = snapshot.composerText.trim()
        if (text.isEmpty()) return
        _state.update { it.copy(composerText = "", streamStatus = "sending", streamingText = "", error = null) }
        viewModelScope.launch {
            val result: Result<Unit> = if (snapshot.composerMode == ComposerMode.Plan) {
                runCatching {
                    repository.createPlan(sessionId, text)
                    Unit
                }
            } else {
                runCatching {
                    repository.runAgent(sessionId, text)
                    Unit
                }
            }
            result.onFailure { error -> _state.update { it.copy(error = error.userMessage(), streamStatus = "error") } }
        }
    }

    fun approveTool(approval: Approval) {
        viewModelScope.launch {
            runCatching { repository.approveTool(approval.id) }
                .onSuccess { reloadCurrentSession() }
                .onFailure { error -> _state.update { it.copy(error = error.userMessage()) } }
        }
    }

    fun rejectTool(approval: Approval) {
        viewModelScope.launch {
            runCatching { repository.rejectTool(approval.id) }
                .onSuccess { reloadCurrentSession() }
                .onFailure { error -> _state.update { it.copy(error = error.userMessage()) } }
        }
    }

    fun approvePlan(plan: PlanBundle) {
        val sessionId = _state.value.selectedSessionId ?: return
        viewModelScope.launch {
            runCatching {
                repository.approvePlan(plan.plan.id)
                repository.executeApprovedPlan(sessionId, plan.plan.id)
            }.onSuccess { reloadCurrentSession() }
                .onFailure { error -> _state.update { it.copy(error = error.userMessage()) } }
        }
    }

    fun cancelPlan(plan: PlanBundle) {
        viewModelScope.launch {
            runCatching { repository.cancelPlan(plan.plan.id) }
                .onSuccess { reloadCurrentSession() }
                .onFailure { error -> _state.update { it.copy(error = error.userMessage()) } }
        }
    }

    fun answerFirstPlanQuestion(plan: PlanBundle, choiceId: String) {
        val questions = plan.questions.ifEmpty { plan.plan.questions }
        val question = questions.firstOrNull() ?: return
        viewModelScope.launch {
            runCatching {
                repository.updatePlanAnswer(
                    plan.plan.id,
                    PlanQuestionAnswer(questionId = question.id, choiceId = choiceId),
                )
                if (questions.size == 1) {
                    repository.finalizePlan(plan.plan.id)
                }
            }.onSuccess { reloadCurrentSession() }
                .onFailure { error -> _state.update { it.copy(error = error.userMessage()) } }
        }
    }

    private fun reloadCurrentSession() {
        _state.value.selectedSessionId?.let { sessionId ->
            viewModelScope.launch {
                refreshSessionDetails(sessionId)
            }
        }
    }

    private fun subscribeSession(sessionId: String) {
        streamJob?.cancel()
        streamJob = viewModelScope.launch {
            var consecutiveFailures = 0
            while (isActive && isCurrentSession(sessionId)) {
                try {
                    _state.update {
                        it.copy(streamStatus = if (consecutiveFailures == 0) "connecting" else "reconnecting")
                    }
                    sseClient.stream(repository.eventUrl(sessionId)).collect { event ->
                        when (event.type) {
                            "connected" -> {
                                val shouldRefresh = consecutiveFailures > 0
                                consecutiveFailures = 0
                                _state.update { it.copy(streamStatus = "connected", error = null) }
                                if (shouldRefresh) {
                                    refreshSessionDetails(sessionId, clearStreamingText = true)
                                }
                            }
                            "token" -> {
                                val delta = event.contentDelta().orEmpty()
                                _state.update {
                                    it.copy(streamStatus = "responding", streamingText = it.streamingText + delta)
                                }
                            }
                            "message_created", "plan_updated", "tool_call_result" -> {
                                _state.update {
                                    it.copy(streamStatus = event.type, streamingText = "")
                                }
                                refreshSessionDetails(sessionId)
                            }
                            "done" -> {
                                _state.update { it.copy(streamStatus = event.type, streamingText = "") }
                            }
                            "keepalive" -> Unit
                            "agent_status" -> {
                                val status = event.statusText() ?: "active"
                                if (status == "session_deleted") {
                                    handleMissingSession("Session was deleted.")
                                    throw CancellationException("Session was deleted.")
                                }
                                _state.update { it.copy(streamStatus = status) }
                            }
                            "session_deleted" -> {
                                handleMissingSession("Session was deleted.")
                                throw CancellationException("Session was deleted.")
                            }
                            else -> _state.update { it.copy(streamStatus = event.type) }
                        }
                    }
                    throw SseStreamException(null, "Event stream closed")
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Throwable) {
                    if (!isCurrentSession(sessionId)) return@launch
                    if (handleTerminalStreamError(error)) return@launch

                    consecutiveFailures += 1
                    _state.update {
                        it.copy(
                            streamStatus = "reconnecting",
                            error = if (consecutiveFailures == SILENT_STREAM_RETRY_LIMIT) {
                                "Session stream disconnected. Retrying..."
                            } else {
                                it.error
                            },
                        )
                    }
                    delay(streamRetryDelay(consecutiveFailures))
                }
            }
        }
    }

    private suspend fun refreshSessionDetails(sessionId: String, clearStreamingText: Boolean = false) {
        runCatching { repository.loadSession(sessionId) }
            .onSuccess { details ->
                if (isCurrentSession(sessionId)) {
                    _state.update {
                        it.copy(
                            sessionDetails = LoadState.Ready(details),
                            streamingText = if (clearStreamingText) "" else it.streamingText,
                        )
                    }
                }
            }
            .onFailure { error ->
                if (isCurrentSession(sessionId)) {
                    _state.update { it.copy(error = error.userMessage()) }
                }
            }
    }

    private fun isCurrentSession(sessionId: String): Boolean {
        val state = _state.value
        return state.selectedSessionId == sessionId && state.route is Route.Session
    }

    private fun handleTerminalStreamError(error: Throwable): Boolean {
        return when ((error as? SseStreamException)?.statusCode) {
            401, 403 -> {
                _state.update {
                    it.copy(
                        streamStatus = "auth_error",
                        error = "Session stream authorization failed. Please sign in again.",
                    )
                }
                true
            }
            404 -> {
                handleMissingSession("Session no longer exists.")
                true
            }
            else -> false
        }
    }

    private fun handleMissingSession(message: String) {
        streamJob?.cancel()
        _state.update {
            it.copy(
                route = Route.Dashboard,
                selectedProject = null,
                selectedSessionId = null,
                sessionDetails = LoadState.Idle,
                streamStatus = "idle",
                streamingText = "",
                error = message,
            )
        }
        refreshOverview()
    }

    private fun clearCurrentSession() {
        streamJob?.cancel()
        _state.update {
            it.copy(
                route = Route.Dashboard,
                selectedProject = null,
                selectedSessionId = null,
                sessionDetails = LoadState.Idle,
                composerText = "",
                streamStatus = "idle",
                streamingText = "",
            )
        }
    }

    private fun streamRetryDelay(failureCount: Int): Long {
        val index = (failureCount - 1).coerceIn(0, STREAM_RETRY_DELAYS_MS.lastIndex)
        return STREAM_RETRY_DELAYS_MS[index]
    }
}

class MebiusViewModelFactory(
    private val repository: MebiusRepository,
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        return MebiusViewModel(repository) as T
    }
}
