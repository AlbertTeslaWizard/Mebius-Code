package com.mebiuscode.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Send
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.Terminal
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.mebiuscode.mobile.data.Approval
import com.mebiuscode.mobile.data.CommandRunView
import com.mebiuscode.mobile.data.FilePatch
import com.mebiuscode.mobile.data.LoadState
import com.mebiuscode.mobile.data.Message
import com.mebiuscode.mobile.data.MobileOverview
import com.mebiuscode.mobile.data.PlanBundle
import com.mebiuscode.mobile.data.Project
import com.mebiuscode.mobile.data.RecentSession
import com.mebiuscode.mobile.data.SessionDetails

@Composable
fun MebiusApp(viewModel: MebiusViewModel) {
    val state by viewModel.state.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(state.error) {
        val error = state.error ?: return@LaunchedEffect
        snackbarHostState.showSnackbar(error)
        viewModel.clearError()
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            MebiusTopBar(
                state = state,
                onBack = viewModel::backToDashboard,
                onRefresh = viewModel::refreshOverview,
                onLogout = viewModel::logout,
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            when (val route = state.route) {
                Route.Login -> LoginScreen(state, viewModel)
                Route.Dashboard -> DashboardScreen(state, viewModel)
                is Route.ProjectSessions -> ProjectSessionsScreen(state, viewModel, route.projectId)
                is Route.Session -> SessionScreen(state, viewModel)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MebiusTopBar(
    state: UiState,
    onBack: () -> Unit,
    onRefresh: () -> Unit,
    onLogout: () -> Unit,
) {
    TopAppBar(
        title = {
            Column {
                Text("Mebius Code", fontWeight = FontWeight.SemiBold)
                Text(
                    when (state.route) {
                        Route.Login -> "Android companion"
                        Route.Dashboard -> "Tasks and approvals"
                        is Route.ProjectSessions -> state.selectedProject?.name ?: "Project"
                        is Route.Session -> state.streamStatus
                    },
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        },
        navigationIcon = {
            if (state.route !is Route.Login && state.route !is Route.Dashboard) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Back")
                }
            }
        },
        actions = {
            if (state.route !is Route.Login) {
                IconButton(onClick = onRefresh) {
                    Icon(Icons.Rounded.Refresh, contentDescription = "Refresh")
                }
                IconButton(onClick = onLogout) {
                    Icon(Icons.Rounded.Settings, contentDescription = "Logout")
                }
            }
        },
        colors = TopAppBarDefaults.topAppBarColors(
            containerColor = MaterialTheme.colorScheme.surface,
        ),
    )
}

@Composable
private fun LoginScreen(state: UiState, viewModel: MebiusViewModel) {
    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item {
            Text(
                "Move active coding work forward from your phone.",
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                "Use Android for task status, Plan decisions, and one-time approvals. Keep code editing on Web or TUI.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        item {
            Panel {
                OutlinedTextField(
                    value = state.loginApi,
                    onValueChange = viewModel::setLoginApi,
                    label = { Text("API base URL") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = state.loginEmail,
                    onValueChange = viewModel::setLoginEmail,
                    label = { Text("Email") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = state.loginPassword,
                    onValueChange = viewModel::setLoginPassword,
                    label = { Text("Password") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(16.dp))
                Button(
                    onClick = viewModel::login,
                    enabled = state.overview !is LoadState.Loading,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Sign in")
                }
            }
        }
        item {
            Text(
                "Emulator default: http://10.0.2.2:3000/api. Physical devices need a LAN or HTTPS address.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun DashboardScreen(state: UiState, viewModel: MebiusViewModel) {
    when (val overview = state.overview) {
        LoadState.Idle, LoadState.Loading -> LoadingPane("Loading mobile overview")
        is LoadState.Failed -> ErrorPane(overview.message, viewModel::refreshOverview)
        is LoadState.Ready -> DashboardContent(overview.value, viewModel)
    }
}

@Composable
private fun DashboardContent(overview: MobileOverview, viewModel: MebiusViewModel) {
    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                MetricChip("${overview.recentSessions.count { it.pendingApprovalCount > 0 }}", "waiting")
                MetricChip("${overview.recentSessions.count { it.agentActivity != null }}", "active")
                MetricChip("${overview.projects.size}", "projects")
            }
        }
        if (overview.pendingApprovals.isNotEmpty()) {
            item { SectionTitle("Needs Decision") }
            items(overview.pendingApprovals, key = { it.id }) { approval ->
                ApprovalCard(approval, viewModel::approveTool, viewModel::rejectTool)
            }
        }
        item { SectionTitle("Recent Sessions") }
        items(overview.recentSessions, key = { it.id }) { session ->
            RecentSessionCard(session, onClick = { viewModel.openSession(session.id) })
        }
        item { SectionTitle("Projects") }
        items(overview.projects, key = { it.id }) { project ->
            ProjectCard(project, onOpen = { viewModel.openProject(project) }, onNewSession = { viewModel.createSession(project) })
        }
    }
}

@Composable
private fun ProjectSessionsScreen(state: UiState, viewModel: MebiusViewModel, projectId: String) {
    val overview = (state.overview as? LoadState.Ready)?.value
    val project = state.selectedProject ?: overview?.projects?.firstOrNull { it.id == projectId }
    val sessions = overview?.recentSessions?.filter { it.projectId == projectId }.orEmpty()
    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Panel {
                Text(project?.name ?: "Project", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text(
                    "${project?.sourceType ?: "workspace"} / ${project?.workspaceMode ?: "managed"}",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(12.dp))
                Button(
                    onClick = { project?.let(viewModel::createSession) },
                    enabled = project != null,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("New mobile session")
                }
            }
        }
        item { SectionTitle("Sessions") }
        items(sessions, key = { it.id }) { session ->
            RecentSessionCard(session, onClick = { viewModel.openSession(session.id) })
        }
    }
}

@Composable
private fun SessionScreen(state: UiState, viewModel: MebiusViewModel) {
    when (val details = state.sessionDetails) {
        LoadState.Idle, LoadState.Loading -> LoadingPane("Loading session")
        is LoadState.Failed -> ErrorPane(details.message) { state.selectedSessionId?.let(viewModel::openSession) }
        is LoadState.Ready -> SessionContent(state, details.value, viewModel)
    }
}

@Composable
private fun SessionContent(state: UiState, details: SessionDetails, viewModel: MebiusViewModel) {
    Column(modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier
                .weight(1f)
                .padding(horizontal = 14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item {
                SessionHeader(details, state.streamStatus)
            }
            details.plan?.let { plan ->
                item { PlanCard(plan, viewModel) }
            }
            if (details.approvals.isNotEmpty()) {
                item { SectionTitle("Approvals") }
                items(details.approvals, key = { it.id }) { approval ->
                    ApprovalCard(approval, viewModel::approveTool, viewModel::rejectTool)
                }
            }
            if (state.streamingText.isNotBlank()) {
                item {
                    MessageBubble(Message("streaming", "assistant", state.streamingText, createdAt = ""), streaming = true)
                }
            }
            items(details.messages, key = { it.id }) { message ->
                MessageBubble(message)
            }
            if (details.patches.isNotEmpty()) {
                item { SectionTitle("Diffs") }
                items(details.patches, key = { it.id }) { patch -> PatchCard(patch) }
            }
            if (details.commandRuns.isNotEmpty()) {
                item { SectionTitle("Runs") }
                items(details.commandRuns, key = { it.id }) { run -> CommandRunCard(run) }
            }
        }
        ComposerBar(state, viewModel)
    }
}

@Composable
private fun SessionHeader(details: SessionDetails, streamStatus: String) {
    Panel {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text(details.session.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text(
                    details.session.activeModelConfig?.displayName ?: "No model selected",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            StatusPill(streamStatus)
        }
    }
}

@Composable
private fun PlanCard(plan: PlanBundle, viewModel: MebiusViewModel) {
    Panel {
        Text(plan.plan.summary.ifBlank { plan.plan.goal ?: "Plan" }, fontWeight = FontWeight.SemiBold)
        Text(plan.plan.status, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelLarge)
        Spacer(Modifier.height(8.dp))
        plan.steps.take(5).forEach { step ->
            Text("${step.order + 1}. ${step.title}", style = MaterialTheme.typography.bodyMedium)
            step.detail?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        val questions = plan.questions.ifEmpty { plan.plan.questions }
        if (questions.isNotEmpty()) {
            Spacer(Modifier.height(10.dp))
            val question = questions.first()
            Text(question.prompt, fontWeight = FontWeight.Medium)
            question.choices.take(3).forEach { choice ->
                TextButton(onClick = { viewModel.answerFirstPlanQuestion(plan, choice.id) }) {
                    Text(choice.label)
                }
            }
        }
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { viewModel.approvePlan(plan) }) {
                Icon(Icons.Rounded.Check, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("Approve")
            }
            OutlinedButton(onClick = { viewModel.cancelPlan(plan) }) {
                Text("Cancel")
            }
        }
    }
}

@Composable
private fun ApprovalCard(
    approval: Approval,
    onApprove: (Approval) -> Unit,
    onReject: (Approval) -> Unit,
) {
    Panel {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Rounded.Terminal, contentDescription = null, tint = MaterialTheme.colorScheme.secondary)
            Spacer(Modifier.width(8.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(approval.toolCall.name, fontWeight = FontWeight.SemiBold)
                Text(
                    approval.reason ?: approval.preview?.command ?: approval.preview?.path ?: "Tool approval requested",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        approval.preview?.let { preview ->
            Spacer(Modifier.height(8.dp))
            CodeBlock(
                when (preview.kind) {
                    "command" -> preview.command.orEmpty()
                    "patch" -> preview.diffText.orEmpty()
                    "patch_set" -> preview.files.joinToString("\n") { "${it.path}\n${it.diffText}" }
                    else -> approval.toolCall.arguments.toString()
                },
            )
        }
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { onApprove(approval) }) {
                Icon(Icons.Rounded.Check, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("Allow once")
            }
            OutlinedButton(onClick = { onReject(approval) }) {
                Icon(Icons.Rounded.Close, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("Reject")
            }
        }
    }
}

@Composable
private fun RecentSessionCard(session: RecentSession, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(modifier = Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text(session.title, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(session.projectName, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (session.pendingApprovalCount > 0) {
                StatusPill("${session.pendingApprovalCount} waiting")
            } else {
                StatusPill(session.latestPlanStatus ?: session.status)
            }
        }
    }
}

@Composable
private fun ProjectCard(project: Project, onOpen: () -> Unit, onNewSession: () -> Unit) {
    Panel {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text(project.name, fontWeight = FontWeight.SemiBold)
                Text(
                    "${project.sourceType} / ${project.workspaceMode ?: "managed"}",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            TextButton(onClick = onOpen) { Text("Open") }
        }
        OutlinedButton(onClick = onNewSession, modifier = Modifier.fillMaxWidth()) {
            Text("Start session")
        }
    }
}

@Composable
private fun MessageBubble(message: Message, streaming: Boolean = false) {
    val isUser = message.role == "user"
    val color = if (isUser) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface
    val textColor = if (isUser) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start,
    ) {
        Surface(
            color = color,
            shape = RoundedCornerShape(8.dp),
            tonalElevation = if (streaming) 4.dp else 0.dp,
            modifier = Modifier.fillMaxWidth(if (isUser) 0.86f else 0.94f),
        ) {
            Text(
                message.content,
                modifier = Modifier.padding(12.dp),
                color = textColor,
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }
}

@Composable
private fun PatchCard(patch: FilePatch) {
    Panel {
        Text(patch.relativePath, fontWeight = FontWeight.SemiBold)
        Text(patch.status, color = MaterialTheme.colorScheme.primary)
        CodeBlock(patch.diffText)
    }
}

@Composable
private fun CommandRunCard(run: CommandRunView) {
    Panel {
        Text(run.command, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.SemiBold)
        Text("${run.status}${run.exitCode?.let { " / exit $it" } ?: ""}", color = MaterialTheme.colorScheme.primary)
        if (run.stdout.isNotBlank()) CodeBlock(run.stdout.take(1600))
        if (run.stderr.isNotBlank()) CodeBlock(run.stderr.take(1600))
    }
}

@Composable
private fun ComposerBar(state: UiState, viewModel: MebiusViewModel) {
    Column(
        modifier = Modifier
            .background(MaterialTheme.colorScheme.surface)
            .padding(12.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(
                selected = state.composerMode == ComposerMode.Build,
                onClick = { viewModel.setComposerMode(ComposerMode.Build) },
                label = { Text("Build") },
            )
            FilterChip(
                selected = state.composerMode == ComposerMode.Plan,
                onClick = { viewModel.setComposerMode(ComposerMode.Plan) },
                label = { Text("Plan") },
            )
        }
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = state.composerText,
                onValueChange = viewModel::setComposerText,
                placeholder = { Text(if (state.composerMode == ComposerMode.Plan) "Create a plan..." else "Send a task update...") },
                modifier = Modifier.weight(1f),
                minLines = 1,
                maxLines = 4,
            )
            Spacer(Modifier.width(8.dp))
            IconButton(onClick = viewModel::submitComposer) {
                Icon(Icons.Rounded.Send, contentDescription = "Send")
            }
        }
    }
}

@Composable
private fun Panel(content: @Composable ColumnScope.() -> Unit) {
    Card(
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(14.dp), content = content)
    }
}

@Composable
private fun CodeBlock(text: String) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = RoundedCornerShape(6.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 8.dp),
    ) {
        Text(
            text.ifBlank { "No preview" },
            modifier = Modifier.padding(10.dp),
            fontFamily = FontFamily.Monospace,
            style = MaterialTheme.typography.bodySmall,
            maxLines = 18,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun SectionTitle(label: String) {
    Text(label, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
}

@Composable
private fun MetricChip(value: String, label: String) {
    AssistChip(
        onClick = {},
        label = { Text("$value $label") },
    )
}

@Composable
private fun StatusPill(label: String) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = RoundedCornerShape(999.dp),
    ) {
        Text(
            label,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
            style = MaterialTheme.typography.labelMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun LoadingPane(label: String) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text(label, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(12.dp))
        LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
    }
}

@Composable
private fun ErrorPane(message: String, retry: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.Start,
    ) {
        Text("Could not load", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(12.dp))
        Button(onClick = retry) { Text("Retry") }
    }
}
