package com.mebiuscode.mobile.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
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
import com.mebiuscode.mobile.data.contentDelta
import com.mebiuscode.mobile.data.statusText
import com.mebiuscode.mobile.data.userMessage
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class UiState(
    val route: Route = Route.Login,
    val loginApi: String = "http://10.0.2.2:3000/api",
    val loginEmail: String = "",
    val loginPassword: String = "",
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
    data class ProjectSessions(val projectId: String) : Route
    data class Session(val sessionId: String) : Route
}

enum class ComposerMode { Build, Plan }

class MebiusViewModel(
    private val repository: MebiusRepository,
    private val sseClient: SseClient = SseClient(),
) : ViewModel() {
    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state
    private var streamJob: Job? = null

    init {
        repository.currentSession?.let { stored ->
            _state.update {
                it.copy(
                    loginApi = stored.apiBaseUrl,
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
                    it.copy(
                        route = Route.Dashboard,
                        overview = LoadState.Ready(overview),
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

    fun createSession(project: Project) {
        _state.update { it.copy(error = null) }
        viewModelScope.launch {
            runCatching { repository.createSession(project.id, "Mobile session") }
                .onSuccess { session ->
                    refreshOverview()
                    openSession(session.id)
                }
                .onFailure { error -> _state.update { it.copy(error = error.userMessage()) } }
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
        _state.value.selectedSessionId?.let(::openSession)
    }

    private fun subscribeSession(sessionId: String) {
        streamJob?.cancel()
        streamJob = viewModelScope.launch {
            sseClient.stream(repository.eventUrl(sessionId)).collect { event ->
                when (event.type) {
                    "token" -> {
                        val delta = event.contentDelta().orEmpty()
                        _state.update {
                            it.copy(streamStatus = "responding", streamingText = it.streamingText + delta)
                        }
                    }
                    "message_created", "plan_updated", "tool_call_result", "done" -> {
                        _state.update { it.copy(streamStatus = event.type) }
                        if (event.type != "done") reloadCurrentSession()
                    }
                    "agent_status" -> {
                        _state.update { it.copy(streamStatus = event.statusText() ?: "active") }
                    }
                    "session_deleted" -> backToDashboard()
                    else -> _state.update { it.copy(streamStatus = event.type) }
                }
            }
        }
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
