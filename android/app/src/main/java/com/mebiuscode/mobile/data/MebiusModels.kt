package com.mebiuscode.mobile.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

@Serializable
data class LoginRequest(
    val email: String,
    val password: String,
)

@Serializable
data class LocalPairRequest(
    val code: String,
)

@Serializable
data class AuthResponse(
    val user: User,
    val accessToken: String,
)

@Serializable
data class User(
    val id: String,
    val email: String,
    val nickname: String,
    val role: String,
    val preferences: UserPreferences? = null,
    val createdAt: String,
    val updatedAt: String,
)

@Serializable
data class UserPreferences(
    val layout: JsonObject? = null,
    val theme: JsonObject? = null,
)

@Serializable
data class SystemCapabilities(
    val version: String,
    val serverMode: String,
    val localWorkspacesEnabled: Boolean,
    val workspaceModes: List<String> = emptyList(),
    val sourceTypes: List<String> = emptyList(),
    val features: Map<String, Boolean> = emptyMap(),
)

@Serializable
data class MobileOverview(
    val user: User,
    val capabilities: SystemCapabilities,
    val projects: List<Project> = emptyList(),
    val recentSessions: List<RecentSession> = emptyList(),
    val pendingApprovals: List<Approval> = emptyList(),
)

@Serializable
data class Project(
    val id: String,
    val name: String,
    val description: String? = null,
    val sourceType: String,
    val workspaceMode: String? = null,
    val deletePolicy: String? = null,
    val gitUrl: String? = null,
    val workspacePath: String? = null,
    val createdAt: String,
    val updatedAt: String,
)

@Serializable
data class RecentSession(
    val id: String,
    val projectId: String,
    val projectName: String,
    val title: String,
    val status: String,
    val permissionMode: String,
    val activeModelConfig: ModelConfig? = null,
    val agentActivity: AgentActivity? = null,
    val latestPlanStatus: String? = null,
    val pendingApprovalCount: Int = 0,
    val createdAt: String,
    val updatedAt: String,
)

@Serializable
data class Session(
    val id: String,
    val projectId: String,
    val title: String,
    val status: String,
    val permissionMode: String,
    val activeModelConfig: ModelConfig? = null,
    val agentActivity: AgentActivity? = null,
    val createdAt: String,
    val updatedAt: String,
)

@Serializable
data class ModelConfig(
    val id: String,
    val providerId: String? = null,
    val displayName: String,
    val baseUrl: String,
    val modelName: String,
    val supportsTools: Boolean,
    val isDefault: Boolean,
    val createdAt: String,
    val updatedAt: String,
)

@Serializable
data class AgentActivity(
    val status: String,
    val toolName: String? = null,
    val activity: String? = null,
    val targetPaths: List<String> = emptyList(),
    val command: String? = null,
    val message: String? = null,
)

@Serializable
data class ListResponse<T>(
    val items: List<T> = emptyList(),
    val total: Int = 0,
    val limit: Int = 0,
    val offset: Int = 0,
)

@Serializable
data class CreateSessionRequest(
    val title: String? = null,
    val modelConfigId: String? = null,
)

@Serializable
data class UpdateSessionRequest(
    val title: String,
)

@Serializable
data class Message(
    val id: String,
    val role: String,
    val content: String,
    val metadata: JsonObject = JsonObject(emptyMap()),
    val createdAt: String,
    val streaming: Boolean = false,
)

@Serializable
data class RunAgentRequest(
    val message: String? = null,
    val approvedPlanId: String? = null,
)

@Serializable
data class CreatePlanRequest(
    val goal: String,
    val clientRequestId: String? = null,
)

@Serializable
data class RevisePlanRequest(
    val instruction: String,
)

@Serializable
data class DiscussPlanRequest(
    val message: String,
)

@Serializable
data class UpdatePlanAnswersRequest(
    val answers: List<PlanQuestionAnswer>,
)

@Serializable
data class PlanBundle(
    val plan: Plan,
    val steps: List<PlanStep> = emptyList(),
    val questions: List<PlanQuestion> = emptyList(),
    val answers: List<PlanQuestionAnswer> = emptyList(),
)

@Serializable
data class Plan(
    val id: String,
    val goal: String? = null,
    val summary: String,
    val status: String,
    val draftMarkdown: String? = null,
    val finalMarkdown: String? = null,
    val questions: List<PlanQuestion> = emptyList(),
    val answers: List<PlanQuestionAnswer> = emptyList(),
    val createdAt: String,
    val updatedAt: String,
)

@Serializable
data class PlanStep(
    val id: String,
    val order: Int,
    val title: String,
    val detail: String? = null,
    val status: String,
)

@Serializable
data class PlanQuestion(
    val id: String,
    val title: String,
    val prompt: String,
    val choices: List<PlanQuestionChoice> = emptyList(),
    val recommendedChoiceId: String? = null,
    val allowCustomAnswer: Boolean = false,
    val notes: String? = null,
    val required: Boolean = false,
    val multiSelect: Boolean = false,
)

@Serializable
data class PlanQuestionChoice(
    val id: String,
    val label: String,
    val description: String? = null,
    val notes: String? = null,
)

@Serializable
data class PlanQuestionAnswer(
    val questionId: String,
    val choiceId: String? = null,
    val choiceIds: List<String>? = null,
    val customAnswer: String? = null,
    val notes: String? = null,
)

@Serializable
data class Approval(
    val id: String,
    val status: String,
    val reason: String? = null,
    val createdAt: String,
    val preview: ApprovalPreview? = null,
    val toolCall: ToolCall,
)

@Serializable
data class ApprovalPreview(
    val kind: String,
    val path: String? = null,
    val diffText: String? = null,
    val files: List<ApprovalPreviewFile> = emptyList(),
    val command: String? = null,
    val cwd: String? = null,
    val policyAllowed: Boolean? = null,
    val policySource: String? = null,
    val executionMode: String? = null,
    val shellTokens: List<String> = emptyList(),
    val sessionAutoRunActive: Boolean? = null,
    val canGrantSessionAutoRun: Boolean? = null,
    val truncated: Boolean = false,
)

@Serializable
data class ApprovalPreviewFile(
    val path: String,
    val diffText: String,
    val truncated: Boolean,
    val status: String,
)

@Serializable
data class ToolCall(
    val id: String,
    val name: String,
    val arguments: JsonObject = JsonObject(emptyMap()),
    val session: ApprovalSession? = null,
)

@Serializable
data class ApprovalSession(
    val id: String,
    val project: Project? = null,
)

@Serializable
data class ApprovalDecisionRequest(
    val mode: String = "once",
)

@Serializable
data class FilePatch(
    val id: String,
    val relativePath: String,
    val diffText: String,
    val status: String,
    val createdAt: String,
)

@Serializable
data class CommandRunView(
    val id: String,
    val command: String,
    val cwd: String? = null,
    val status: String,
    val exitCode: Int? = null,
    val stdout: String = "",
    val stderr: String = "",
    val createdAt: String,
)

@Serializable
data class SseEvent(
    val type: String,
    val data: JsonElement,
)

data class SessionDetails(
    val session: Session,
    val messages: List<Message>,
    val plan: PlanBundle?,
    val approvals: List<Approval>,
    val patches: List<FilePatch>,
    val commandRuns: List<CommandRunView>,
)

data class StoredSession(
    val apiBaseUrl: String,
    val accessToken: String,
    val userName: String,
)

sealed interface LoadState<out T> {
    data object Idle : LoadState<Nothing>
    data object Loading : LoadState<Nothing>
    data class Ready<T>(val value: T) : LoadState<T>
    data class Failed(val message: String) : LoadState<Nothing>
}

fun Throwable.userMessage(): String = message?.takeIf { it.isNotBlank() } ?: "Request failed"
