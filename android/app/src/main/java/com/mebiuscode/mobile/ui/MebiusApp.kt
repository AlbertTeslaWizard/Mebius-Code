package com.mebiuscode.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.ArrowDownward
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Bolt
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.Folder
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Send
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.Terminal
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
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
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
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
import com.mikepenz.markdown.m3.Markdown
import com.mikepenz.markdown.m3.markdownColor
import com.mikepenz.markdown.m3.markdownTypography
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

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

@Composable
private fun LogoBadge(size: Int = 36) {
    Box(
        modifier = Modifier
            .size(size.dp)
            .clip(RoundedCornerShape((size / 3).dp))
            .background(
                Brush.linearGradient(
                    listOf(
                        MaterialTheme.colorScheme.primary,
                        MaterialTheme.colorScheme.secondary,
                    ),
                ),
            ),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            Icons.Rounded.AutoAwesome,
            contentDescription = null,
            tint = Color.White,
            modifier = Modifier.size((size * 0.55f).dp),
        )
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
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (state.route !is Route.Session && state.route !is Route.ProjectSessions) {
                    LogoBadge()
                    Spacer(Modifier.width(10.dp))
                }
                Column {
                    Text("Mebius Code", fontWeight = FontWeight.Bold)
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
            .padding(horizontal = 20.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        item { Spacer(Modifier.height(8.dp)) }
        item {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(20.dp))
                    .background(
                        Brush.linearGradient(
                            listOf(
                                MaterialTheme.colorScheme.primary,
                                MaterialTheme.colorScheme.secondary,
                            ),
                        ),
                    )
                    .padding(22.dp),
            ) {
                Column {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Rounded.Bolt, contentDescription = null, tint = Color.White, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(
                            "MEBIUS CODE",
                            color = Color.White.copy(alpha = 0.85f),
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                    Spacer(Modifier.height(12.dp))
                    Text(
                        "Move active coding work forward from your phone.",
                        style = MaterialTheme.typography.headlineMedium,
                        fontWeight = FontWeight.Bold,
                        color = Color.White,
                    )
                    Spacer(Modifier.height(10.dp))
                    Text(
                        "Track task status, make Plan decisions, and grant one-time approvals. Keep code editing on Web or TUI.",
                        color = Color.White.copy(alpha = 0.88f),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
        }
        item {
            Panel {
                Text("Sign in", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(14.dp))
                OutlinedTextField(
                    value = state.loginApi,
                    onValueChange = viewModel::setLoginApi,
                    label = { Text("API base URL") },
                    singleLine = true,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = state.loginEmail,
                    onValueChange = viewModel::setLoginEmail,
                    label = { Text("Email") },
                    singleLine = true,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = state.loginPassword,
                    onValueChange = viewModel::setLoginPassword,
                    label = { Text("Password") },
                    singleLine = true,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(18.dp))
                Button(
                    onClick = viewModel::login,
                    enabled = state.overview !is LoadState.Loading,
                    shape = RoundedCornerShape(14.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(52.dp),
                ) {
                    Text("Sign in", fontWeight = FontWeight.SemiBold)
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
    var sessionPendingDelete by remember { mutableStateOf<RecentSession?>(null) }
    var sessionPendingRename by remember { mutableStateOf<RecentSession?>(null) }
    var projectPendingSession by remember { mutableStateOf<Project?>(null) }

    sessionPendingDelete?.let { session ->
        DeleteSessionDialog(
            title = session.title,
            onDismiss = { sessionPendingDelete = null },
            onConfirm = {
                sessionPendingDelete = null
                viewModel.deleteSession(session.id)
            },
        )
    }

    sessionPendingRename?.let { session ->
        SessionTitleDialog(
            title = "Rename session",
            initialValue = session.title,
            confirmLabel = "Save",
            onDismiss = { sessionPendingRename = null },
            onConfirm = { title ->
                sessionPendingRename = null
                viewModel.renameSession(session.id, title)
            },
        )
    }

    projectPendingSession?.let { project ->
        SessionTitleDialog(
            title = "New session",
            initialValue = "Session for ${project.name}",
            confirmLabel = "Create",
            onDismiss = { projectPendingSession = null },
            onConfirm = { title ->
                projectPendingSession = null
                viewModel.createSession(project, title)
            },
        )
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { Spacer(Modifier.height(2.dp)) }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                MetricCard(
                    "${overview.recentSessions.count { it.pendingApprovalCount > 0 }}",
                    "waiting",
                    MaterialTheme.colorScheme.tertiary,
                    Modifier.weight(1f),
                )
                MetricCard(
                    "${overview.recentSessions.count { it.agentActivity != null }}",
                    "active",
                    MaterialTheme.colorScheme.primary,
                    Modifier.weight(1f),
                )
                MetricCard(
                    "${overview.projects.size}",
                    "projects",
                    MaterialTheme.colorScheme.secondary,
                    Modifier.weight(1f),
                )
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
            RecentSessionCard(
                session = session,
                onClick = { viewModel.openSession(session.id) },
                onRename = { sessionPendingRename = session },
                onDelete = { sessionPendingDelete = session },
            )
        }
        item { SectionTitle("Projects") }
        items(overview.projects, key = { it.id }) { project ->
            ProjectCard(
                project = project,
                onOpen = { viewModel.openProject(project) },
                onNewSession = { projectPendingSession = project },
            )
        }
        item { Spacer(Modifier.height(8.dp)) }
    }
}

@Composable
private fun ProjectSessionsScreen(state: UiState, viewModel: MebiusViewModel, projectId: String) {
    val overview = (state.overview as? LoadState.Ready)?.value
    val project = state.selectedProject ?: overview?.projects?.firstOrNull { it.id == projectId }
    val sessions = overview?.recentSessions?.filter { it.projectId == projectId }.orEmpty()
    var sessionPendingDelete by remember { mutableStateOf<RecentSession?>(null) }
    var sessionPendingRename by remember { mutableStateOf<RecentSession?>(null) }
    var showNewSessionDialog by remember { mutableStateOf(false) }

    sessionPendingDelete?.let { session ->
        DeleteSessionDialog(
            title = session.title,
            onDismiss = { sessionPendingDelete = null },
            onConfirm = {
                sessionPendingDelete = null
                viewModel.deleteSession(session.id)
            },
        )
    }

    sessionPendingRename?.let { session ->
        SessionTitleDialog(
            title = "Rename session",
            initialValue = session.title,
            confirmLabel = "Save",
            onDismiss = { sessionPendingRename = null },
            onConfirm = { title ->
                sessionPendingRename = null
                viewModel.renameSession(session.id, title)
            },
        )
    }

    if (showNewSessionDialog && project != null) {
        SessionTitleDialog(
            title = "New session",
            initialValue = "Session for ${project.name}",
            confirmLabel = "Create",
            onDismiss = { showNewSessionDialog = false },
            onConfirm = { title ->
                showNewSessionDialog = false
                viewModel.createSession(project, title)
            },
        )
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { Spacer(Modifier.height(2.dp)) }
        item {
            Panel {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier
                            .size(40.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(MaterialTheme.colorScheme.secondaryContainer),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.Rounded.Folder, contentDescription = null, tint = MaterialTheme.colorScheme.onSecondaryContainer, modifier = Modifier.size(22.dp))
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(project?.name ?: "Project", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                        Text(
                            "${project?.sourceType ?: "workspace"} / ${project?.workspaceMode ?: "managed"}",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
                Spacer(Modifier.height(14.dp))
                Button(
                    onClick = { showNewSessionDialog = true },
                    enabled = project != null,
                    shape = RoundedCornerShape(14.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(50.dp),
                ) {
                    Text("New mobile session", fontWeight = FontWeight.SemiBold)
                }
            }
        }
        item { SectionTitle("Sessions") }
        items(sessions, key = { it.id }) { session ->
            RecentSessionCard(
                session = session,
                onClick = { viewModel.openSession(session.id) },
                onRename = { sessionPendingRename = session },
                onDelete = { sessionPendingDelete = session },
            )
        }
        item { Spacer(Modifier.height(8.dp)) }
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
    val listState = rememberLazyListState()
    val coroutineScope = rememberCoroutineScope()
    val totalItemCount = sessionListItemCount(state, details)
    val lastIndex = (totalItemCount - 1).coerceAtLeast(0)
    var shouldFollowBottom by remember(details.session.id) { mutableStateOf(true) }
    var showDeleteDialog by remember(details.session.id) { mutableStateOf(false) }
    var showRenameDialog by remember(details.session.id) { mutableStateOf(false) }
    val isAtBottom by remember {
        derivedStateOf {
            val visibleItems = listState.layoutInfo.visibleItemsInfo
            visibleItems.lastOrNull()?.index == listState.layoutInfo.totalItemsCount - 1
        }
    }
    val showScrollToBottom by remember {
        derivedStateOf {
            listState.layoutInfo.totalItemsCount > 0 && !shouldFollowBottom && !isAtBottom
        }
    }

    LaunchedEffect(details.session.id) {
        if (lastIndex > 0) {
            listState.scrollToItem(lastIndex)
        }
        shouldFollowBottom = true
    }
    LaunchedEffect(listState) {
        snapshotFlow { isAtBottom }.collect { atBottom ->
            shouldFollowBottom = atBottom || shouldFollowBottom && !listState.isScrollInProgress
        }
    }
    LaunchedEffect(totalItemCount, state.streamingText.length) {
        if (shouldFollowBottom && lastIndex > 0) {
            listState.scrollToItem(lastIndex)
        }
    }

    if (showDeleteDialog) {
        DeleteSessionDialog(
            title = details.session.title,
            onDismiss = { showDeleteDialog = false },
            onConfirm = {
                showDeleteDialog = false
                viewModel.deleteSession(details.session.id)
            },
        )
    }

    if (showRenameDialog) {
        SessionTitleDialog(
            title = "Rename session",
            initialValue = details.session.title,
            confirmLabel = "Save",
            onDismiss = { showRenameDialog = false },
            onConfirm = { title ->
                showRenameDialog = false
                viewModel.renameSession(details.session.id, title)
            },
        )
    }

    Column(modifier = Modifier.fillMaxSize()) {
        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
        ) {
            LazyColumn(
                state = listState,
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                item { Spacer(Modifier.height(2.dp)) }
                item {
                    SessionHeader(
                        details = details,
                        streamStatus = state.streamStatus,
                        onRename = { showRenameDialog = true },
                        onDelete = { showDeleteDialog = true },
                    )
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
                    item(key = "streaming-message") {
                        MessageBubble(Message("streaming", "assistant", state.streamingText, createdAt = ""), streaming = true)
                    }
                }
                itemsIndexed(
                    items = details.messages,
                    key = { index, message -> "message-${message.id.ifBlank { index.toString() }}-$index" },
                ) { _, message ->
                    MessageBubble(message)
                }
                if (details.patches.isNotEmpty()) {
                    item { SectionTitle("Diffs") }
                    itemsIndexed(
                        items = details.patches,
                        key = { index, patch -> "patch-${patch.id.ifBlank { index.toString() }}-$index" },
                    ) { _, patch -> PatchCard(patch) }
                }
                if (details.commandRuns.isNotEmpty()) {
                    item { SectionTitle("Runs") }
                    itemsIndexed(
                        items = details.commandRuns,
                        key = { index, run -> "run-${run.id.ifBlank { index.toString() }}-$index" },
                    ) { _, run -> CommandRunCard(run) }
                }
                item { Spacer(Modifier.height(4.dp)) }
            }
            if (showScrollToBottom) {
                FilledIconButton(
                    onClick = {
                        shouldFollowBottom = true
                        coroutineScope.launch {
                            listState.animateScrollToItem(lastIndex)
                        }
                    },
                    shape = CircleShape,
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .padding(end = 18.dp, bottom = 14.dp)
                        .offset(y = (-2).dp),
                ) {
                    Icon(Icons.Rounded.ArrowDownward, contentDescription = "Scroll to bottom")
                }
            }
        }
        ComposerBar(state, viewModel)
    }
}

private fun sessionListItemCount(state: UiState, details: SessionDetails): Int {
    var count = 2
    if (details.plan != null) count += 1
    if (details.approvals.isNotEmpty()) count += 1 + details.approvals.size
    if (state.streamingText.isNotBlank()) count += 1
    count += details.messages.size
    if (details.patches.isNotEmpty()) count += 1 + details.patches.size
    if (details.commandRuns.isNotEmpty()) count += 1 + details.commandRuns.size
    return count + 1
}

@Composable
private fun SessionHeader(details: SessionDetails, streamStatus: String, onRename: () -> Unit, onDelete: () -> Unit) {
    Panel {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text(details.session.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text(
                    details.session.activeModelConfig?.displayName ?: "No model selected",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Spacer(Modifier.width(8.dp))
            StatusPill(streamStatus)
            Spacer(Modifier.width(6.dp))
            IconButton(onClick = onRename) {
                Icon(Icons.Rounded.Edit, contentDescription = "Rename session")
            }
            Spacer(Modifier.width(2.dp))
            IconButton(onClick = onDelete) {
                Icon(Icons.Rounded.Delete, contentDescription = "Delete session")
            }
        }
    }
}
@Composable
private fun PlanCard(plan: PlanBundle, viewModel: MebiusViewModel) {
    AccentPanel(accent = MaterialTheme.colorScheme.tertiary) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                Icons.Rounded.AutoAwesome,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.tertiary,
                modifier = Modifier.size(18.dp),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                plan.plan.summary.ifBlank { plan.plan.goal ?: "Plan" },
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f),
            )
            StatusPill(plan.plan.status)
        }
        Spacer(Modifier.height(10.dp))
        plan.steps.take(5).forEach { step ->
            Row(modifier = Modifier.padding(vertical = 3.dp)) {
                Text(
                    "${step.order + 1}",
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.width(20.dp),
                )
                Column {
                    Text(step.title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                    step.detail?.let {
                        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
        val questions = plan.questions.ifEmpty { plan.plan.questions }
        if (questions.isNotEmpty()) {
            Spacer(Modifier.height(10.dp))
            val question = questions.first()
            Text(question.prompt, fontWeight = FontWeight.Medium)
            Spacer(Modifier.height(4.dp))
            question.choices.take(3).forEach { choice ->
                OutlinedButton(
                    onClick = { viewModel.answerFirstPlanQuestion(plan, choice.id) },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(10.dp),
                ) {
                    Text(choice.label, modifier = Modifier.fillMaxWidth())
                }
                Spacer(Modifier.height(4.dp))
            }
        }
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { viewModel.approvePlan(plan) }, shape = RoundedCornerShape(12.dp)) {
                Icon(Icons.Rounded.Check, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("Approve")
            }
            OutlinedButton(onClick = { viewModel.cancelPlan(plan) }, shape = RoundedCornerShape(12.dp)) {
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
    AccentPanel(accent = MaterialTheme.colorScheme.secondary) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(34.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(MaterialTheme.colorScheme.secondaryContainer),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Rounded.Terminal,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSecondaryContainer,
                    modifier = Modifier.size(18.dp),
                )
            }
            Spacer(Modifier.width(10.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(approval.toolCall.name, fontWeight = FontWeight.SemiBold)
                Text(
                    approval.reason ?: approval.preview?.command ?: approval.preview?.path ?: "Tool approval requested",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
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
            Button(onClick = { onApprove(approval) }, shape = RoundedCornerShape(12.dp)) {
                Icon(Icons.Rounded.Check, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("Allow once")
            }
            OutlinedButton(onClick = { onReject(approval) }, shape = RoundedCornerShape(12.dp)) {
                Icon(Icons.Rounded.Close, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("Reject")
            }
        }
    }
}
@Composable
private fun MessageBubble(message: Message, streaming: Boolean = false) {
    val isUser = message.role == "user"
    val isTool = message.role == "tool"
    val bubbleColor = if (isUser) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface
    val textColor = if (isUser) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface
    val shape = if (isUser) {
        RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp, bottomStart = 18.dp, bottomEnd = 4.dp)
    } else {
        RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp, bottomStart = 4.dp, bottomEnd = 18.dp)
    }
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start,
    ) {
        Surface(
            color = bubbleColor,
            shape = shape,
            tonalElevation = if (isUser) 0.dp else 2.dp,
            shadowElevation = if (streaming) 4.dp else 1.dp,
            modifier = Modifier.fillMaxWidth(if (isUser) 0.86f else 0.94f),
        ) {
            Column(modifier = Modifier.padding(horizontal = 14.dp, vertical = 11.dp)) {
                if (isTool) {
                    ToolMessageContent(message, textColor)
                } else if (isUser) {
                    Text(
                        message.content,
                        color = textColor,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                } else {
                    val codeBackground = MaterialTheme.colorScheme.surfaceVariant
                    Markdown(
                        content = message.content,
                        colors = markdownColor(
                            text = textColor,
                            codeText = textColor,
                            codeBackground = codeBackground,
                            inlineCodeText = textColor,
                            inlineCodeBackground = codeBackground,
                        ),
                        typography = markdownTypography(
                            text = MaterialTheme.typography.bodyMedium,
                            code = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                            paragraph = MaterialTheme.typography.bodyMedium,
                        ),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                if (streaming) {
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "typing…",
                        color = textColor.copy(alpha = 0.6f),
                        style = MaterialTheme.typography.labelSmall,
                    )
                }
            }
        }
    }
}

@Composable
private fun ToolMessageContent(message: Message, textColor: Color) {
    val expandedStates = remember { mutableStateMapOf<String, Boolean>() }
    val expanded = expandedStates[message.id] == true
    Column {
        Row(verticalAlignment = Alignment.Top) {
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .background(MaterialTheme.colorScheme.secondaryContainer)
                    .padding(horizontal = 8.dp, vertical = 5.dp),
            ) {
                Text(
                    "Tool",
                    color = MaterialTheme.colorScheme.onSecondaryContainer,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Bold,
                )
            }
            Spacer(Modifier.width(8.dp))
            Text(
                toolSummary(message),
                color = textColor,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f),
            )
        }
        if (message.content.isNotBlank()) {
            Spacer(Modifier.height(8.dp))
            TextButton(onClick = { expandedStates[message.id] = !expanded }) {
                Text(if (expanded) "Hide details" else "Details")
            }
            if (expanded) {
                CodeBlock(message.content.take(2400))
            }
        }
    }
}

@Composable
private fun PatchCard(patch: FilePatch) {
    val sc = statusColorsFor(patch.status)
    AccentPanel(accent = sc.accent) {
        Text(patch.relativePath, fontWeight = FontWeight.SemiBold, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodyMedium)
        StatusPill(patch.status)
        CodeBlock(patch.diffText)
    }
}

@Composable
private fun CommandRunCard(run: CommandRunView) {
    val sc = statusColorsFor(run.status)
    AccentPanel(accent = sc.accent) {
        Text(run.command, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)
        StatusPill("${run.status}${run.exitCode?.let { " · exit $it" } ?: ""}")
        if (run.stdout.isNotBlank()) CodeBlock(run.stdout.take(1600))
        if (run.stderr.isNotBlank()) CodeBlock(run.stderr.take(1600))
    }
}
@Composable
private fun RecentSessionCard(session: RecentSession, onClick: () -> Unit, onRename: () -> Unit, onDelete: () -> Unit) {
    val label = if (session.pendingApprovalCount > 0) "${session.pendingApprovalCount} waiting" else (session.latestPlanStatus ?: session.status)
    val sc = statusColorsFor(label)
    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .width(4.dp)
                    .height(58.dp)
                    .background(sc.accent),
            )
            Row(
                modifier = Modifier
                    .weight(1f)
                    .clickable(onClick = onClick)
                    .padding(start = 12.dp, top = 14.dp, bottom = 14.dp, end = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(session.title, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        session.projectName,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Spacer(Modifier.width(8.dp))
                StatusPill(label)
                Spacer(Modifier.width(4.dp))
                IconButton(onClick = onRename) {
                    Icon(Icons.Rounded.Edit, contentDescription = "Rename session")
                }
                Spacer(Modifier.width(2.dp))
                IconButton(onClick = onDelete) {
                    Icon(Icons.Rounded.Delete, contentDescription = "Delete session")
                }
            }
        }
    }
}

@Composable
private fun ProjectCard(project: Project, onOpen: () -> Unit, onNewSession: () -> Unit) {
    Panel {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(38.dp)
                    .clip(RoundedCornerShape(11.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Rounded.Folder, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(20.dp))
            }
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(project.name, fontWeight = FontWeight.SemiBold)
                Text(
                    "${project.sourceType} / ${project.workspaceMode ?: "managed"}",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            TextButton(onClick = onOpen) { Text("Open") }
        }
        Spacer(Modifier.height(10.dp))
        OutlinedButton(
            onClick = onNewSession,
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Start session")
        }
    }
}

@Composable
private fun SessionTitleDialog(
    title: String,
    initialValue: String,
    confirmLabel: String,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    var value by remember(initialValue) { mutableStateOf(initialValue) }
    val trimmed = value.trim()
    val canSubmit = trimmed.length in 2..120

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column {
                OutlinedTextField(
                    value = value,
                    onValueChange = { if (it.length <= 120) value = it },
                    label = { Text("Session title") },
                    singleLine = true,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    "2-120 characters",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(trimmed) },
                enabled = canSubmit,
            ) {
                Text(confirmLabel)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        },
    )
}

@Composable
private fun DeleteSessionDialog(
    title: String,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Delete session?") },
        text = {
            Text("Delete session \"$title\"? This cannot be undone.")
        },
        confirmButton = {
            TextButton(onClick = onConfirm) {
                Text("Delete")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        },
    )
}

@Composable
private fun MetricCard(value: String, label: String, accent: Color, modifier: Modifier = Modifier) {
    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = modifier,
    ) {
        Column(modifier = Modifier.padding(vertical = 14.dp, horizontal = 12.dp)) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(accent),
            )
            Spacer(Modifier.height(8.dp))
            Text(value, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ComposerBar(state: UiState, viewModel: MebiusViewModel) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shadowElevation = 8.dp,
    ) {
        Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(
                    selected = state.composerMode == ComposerMode.Build,
                    onClick = { viewModel.setComposerMode(ComposerMode.Build) },
                    label = { Text("Build") },
                    leadingIcon = if (state.composerMode == ComposerMode.Build) {
                        { Icon(Icons.Rounded.Bolt, contentDescription = null, modifier = Modifier.size(16.dp)) }
                    } else null,
                    shape = RoundedCornerShape(10.dp),
                )
                FilterChip(
                    selected = state.composerMode == ComposerMode.Plan,
                    onClick = { viewModel.setComposerMode(ComposerMode.Plan) },
                    label = { Text("Plan") },
                    leadingIcon = if (state.composerMode == ComposerMode.Plan) {
                        { Icon(Icons.Rounded.AutoAwesome, contentDescription = null, modifier = Modifier.size(16.dp)) }
                    } else null,
                    shape = RoundedCornerShape(10.dp),
                )
            }
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.Bottom) {
                OutlinedTextField(
                    value = state.composerText,
                    onValueChange = viewModel::setComposerText,
                    placeholder = { Text(if (state.composerMode == ComposerMode.Plan) "Create a plan..." else "Send a task update...") },
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(20.dp),
                    minLines = 1,
                    maxLines = 4,
                )
                Spacer(Modifier.width(8.dp))
                FilledIconButton(
                    onClick = viewModel::submitComposer,
                    enabled = state.composerText.isNotBlank(),
                    shape = CircleShape,
                    modifier = Modifier.size(52.dp),
                ) {
                    Icon(Icons.Rounded.Send, contentDescription = "Send")
                }
            }
        }
    }
}

@Composable
private fun Panel(content: @Composable ColumnScope.() -> Unit) {
    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(16.dp), content = content)
    }
}

@Composable
private fun AccentPanel(accent: Color, content: @Composable ColumnScope.() -> Unit) {
    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row {
            Box(
                modifier = Modifier
                    .width(4.dp)
                    .fillMaxHeight()
                    .background(accent),
            )
            Column(modifier = Modifier.padding(16.dp), content = content)
        }
    }
}

@Composable
private fun CodeBlock(text: String) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = RoundedCornerShape(10.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 8.dp),
    ) {
        Text(
            text.ifBlank { "No preview" },
            modifier = Modifier.padding(12.dp),
            fontFamily = FontFamily.Monospace,
            style = MaterialTheme.typography.bodySmall,
            maxLines = 18,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun SectionTitle(label: String) {
    Text(
        label,
        style = MaterialTheme.typography.titleMedium,
        fontWeight = FontWeight.Bold,
        modifier = Modifier.padding(top = 4.dp, start = 2.dp),
    )
}

@Composable
private fun StatusPill(label: String) {
    val sc = statusColorsFor(label)
    Surface(
        color = sc.container,
        shape = RoundedCornerShape(999.dp),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(7.dp)
                    .clip(CircleShape)
                    .background(sc.accent),
            )
            Spacer(Modifier.width(6.dp))
            Text(
                label,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Medium,
                color = sc.content,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

private fun toolSummary(message: Message): String {
    val parsedContent = runCatching { com.mebiuscode.mobile.data.MebiusJson.json.parseToJsonElement(message.content) }.getOrNull()
    val parsedObject = parsedContent as? kotlinx.serialization.json.JsonObject
    val name = message.metadata.stringValue("toolName")
        ?: inferredToolName(parsedObject)
        ?: "Tool result"
    val detail = message.metadata.stringValue("query")
        ?: parsedObject?.stringValue("query")
        ?: message.metadata.stringValue("command")
        ?: parsedObject?.stringValue("command")
        ?: message.metadata.stringListValue("targetPaths")?.joinToString(", ")
        ?: parsedObject?.stringValue("provider")
        ?: compactPreview(message.content)
    val status = message.metadata.stringValue("status")
    return listOfNotNull(name, detail, status).filter { it.isNotBlank() }.joinToString(" · ")
}

private fun inferredToolName(parsedObject: kotlinx.serialization.json.JsonObject?): String? {
    if (parsedObject?.containsKey("query") == true || parsedObject?.containsKey("provider") == true) return "web_search"
    return null
}

private fun kotlinx.serialization.json.JsonObject.stringValue(key: String): String? {
    return this[key]?.jsonPrimitive?.contentOrNull?.trim()?.takeIf { it.isNotBlank() }
}

private fun kotlinx.serialization.json.JsonObject.stringListValue(key: String): List<String>? {
    val array = this[key] as? JsonArray ?: return null
    return array.mapNotNull { item -> item.jsonPrimitive.contentOrNull?.trim()?.takeIf { it.isNotBlank() } }
        .takeIf { it.isNotEmpty() }
}

private fun compactPreview(value: String): String? {
    val compact = value.replace(Regex("\\s+"), " ").trim()
    if (compact.isBlank()) return null
    return if (compact.length > 96) "${compact.take(96)}..." else compact
}

@Composable
private fun LoadingPane(label: String) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        LogoBadge(48)
        Spacer(Modifier.height(16.dp))
        Text(label, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(12.dp))
        LinearProgressIndicator(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(999.dp)),
        )
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
        Spacer(Modifier.height(4.dp))
        Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(16.dp))
        Button(onClick = retry, shape = RoundedCornerShape(12.dp)) {
            Icon(Icons.Rounded.Refresh, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text("Retry")
        }
    }
}
