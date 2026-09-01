package com.infinity.build.ui

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBPanel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import com.intellij.util.ui.JBUI
import com.infinity.build.InfinityPlugin
import com.infinity.build.api.AgentRequest
import com.infinity.build.api.AgentTask
import com.infinity.build.api.AgentTaskStatus
import com.infinity.build.api.WebSocketEvent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Dimension
import java.awt.Font
import java.awt.event.KeyEvent
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import javax.swing.BorderFactory
import javax.swing.BoxLayout
import javax.swing.JButton
import javax.swing.JCheckBox
import javax.swing.JComponent
import javax.swing.JList
import javax.swing.JPanel
import javax.swing.JScrollPane
import javax.swing.JSplitPane
import javax.swing.ListSelectionModel
import javax.swing.SwingUtilities
import javax.swing.border.TitledBorder

/**
 * Agent Panel - Autonomous coding agent with approval workflow.
 */
class AgentPanel(private val project: Project) {

    private val logger = Logger.getInstance(AgentPanel::class.java)
    private val apiClient = InfinityPlugin.getInstance().getApiClient()
    private val scope = InfinityPlugin.getInstance().getCoroutineScope()

    // UI Components
    val mainPanel: JBPanel = JBPanel()
    private val goalTextArea: JBTextArea = JBTextArea()
    private val startButton: JButton = JButton("Start Agent")
    private val stopButton: JButton = JButton("Stop")
    private val pauseButton: JButton = JButton("Pause")
    private val stepLogList: JList<AgentStepLog> = JList()
    private val detailPane: javax.swing.JTextPane = javax.swing.JTextPane()
    private val statusLabel: JBLabel = JBLabel("Ready")
    private val progressBar: javax.swing.JProgressBar = javax.swing.JProgressBar()

    // Settings
    private val modeComboBox: javax.swing.JComboBox<String> = javax.swing.JComboBox()
    private val maxStepsSpinner: javax.swing.JSpinner = javax.swing.JSpinner(javax.swing.SpinnerNumberModel(50, 1, 200, 1))
    private val autoApproveCheckBox: JCheckBox = JCheckBox("Auto-approve safe actions")
    private val showDiffCheckBox: JCheckBox = JCheckBox("Show diffs before apply")

    // State
    private var currentTaskId: String? = null
    private var currentTask: AgentTask? = null
    private var taskStatus: AgentTaskStatus? = null
    private var statusPollJob: Job? = null
    private val stepLogs = mutableListOf<AgentStepLog>()
    private var isRunning = false
    private var isPaused = false

    init {
        setupUI()
    }

    private fun setupUI() {
        mainPanel.layout = BorderLayout()
        mainPanel.border = JBUI.Borders.empty(4)

        // Top toolbar
        val toolbar = createToolbar()
        mainPanel.add(toolbar, BorderLayout.NORTH)

        // Main content - split between step log and detail view
        val contentSplitter = com.intellij.openapi.ui.Splitter(true, 0.5f)

        // Left - Step Log
        val leftPanel = createStepLogPanel()
        contentSplitter.firstComponent = leftPanel

        // Right - Detail View
        val rightPanel = createDetailPanel()
        contentSplitter.secondComponent = rightPanel

        contentSplitter.honorComponentsMinimumSize = true
        mainPanel.add(contentSplitter, BorderLayout.CENTER)

        // Bottom status bar
        val statusPanel = createStatusPanel()
        mainPanel.add(statusPanel, BorderLayout.SOUTH)
    }

    private fun createToolbar(): JComponent {
        val panel = JBPanel()
        panel.layout = BorderLayout()
        panel.border = JBUI.Borders.emptyBottom(8)

        // Goal input
        val goalPanel = JBPanel()
        goalPanel.layout = BorderLayout()
        goalPanel.border = BorderFactory.createTitledBorder("Agent Goal")

        goalTextArea.rows = 3
        goalTextArea.font = Font(Font.MONOSPACED, Font.PLAIN, 13)
        goalTextArea.lineWrap = true
        goalTextArea.wrapStyleWord = true
        goalTextArea.border = BorderFactory.createCompoundBorder(
            BorderFactory.createLineBorder(JBColor.namedColor("TextField.borderColor", Color.GRAY)),
            JBUI.Borders.empty(4)
        )
        goalTextArea.setPlaceholderText("Describe the task for the autonomous agent...\n\nExample: Refactor the authentication module to use JWT tokens with refresh token rotation, update all dependent services, and add integration tests.")

        val goalScroll = JBScrollPane(goalTextArea)
        goalScroll.preferredSize = Dimension(0, 80)
        goalPanel.add(goalScroll, BorderLayout.CENTER)

        // Control buttons
        val buttonPanel = JBPanel()
        buttonPanel.layout = java.awt.FlowLayout(java.awt.FlowLayout.LEFT)
        startButton.addActionListener { startAgent() }
        stopButton.addActionListener { stopAgent() }
        stopButton.isEnabled = false
        pauseButton.addActionListener { togglePause() }
        pauseButton.isEnabled = false
        buttonPanel.add(startButton)
        buttonPanel.add(stopButton)
        buttonPanel.add(pauseButton)
        goalPanel.add(buttonPanel, BorderLayout.SOUTH)

        panel.add(goalPanel, BorderLayout.CENTER)

        // Settings panel (collapsible)
        val settingsPanel = createSettingsPanel()
        panel.add(settingsPanel, BorderLayout.SOUTH)

        return panel
    }

    private fun createSettingsPanel(): JComponent {
        val panel = JBPanel()
        panel.layout = BoxLayout(panel, BoxLayout.Y_AXIS)
        panel.border = BorderFactory.createTitledBorder("Settings")

        // Row 1: Mode and Max Steps
        val row1 = JBPanel()
        row1.layout = java.awt.FlowLayout(java.awt.FlowLayout.LEFT)

        row1.add(JBLabel("Mode:"))
        modeComboBox.addItem("autonomous")
        modeComboBox.addItem("guided")
        modeComboBox.addItem("review")
        row1.add(modeComboBox)

        row1.add(JBUI.Panels.emptyPanel(16, 0))
        row1.add(JBLabel("Max Steps:"))
        row1.add(maxStepsSpinner)

        panel.add(row1)

        // Row 2: Checkboxes
        val row2 = JBPanel()
        row2.layout = java.awt.FlowLayout(java.awt.FlowLayout.LEFT)

        autoApproveCheckBox.isSelected = false
        row2.add(autoApproveCheckBox)

        row2.add(JBUI.Panels.emptyPanel(16, 0))
        showDiffCheckBox.isSelected = true
        row2.add(showDiffCheckBox)

        panel.add(row2)

        return panel
    }

    private fun createStepLogPanel(): JComponent {
        val panel = JBPanel()
        panel.layout = BorderLayout()
        panel.border = BorderFactory.createTitledBorder("Execution Log")

        // Step log list
        stepLogList.selectionMode = ListSelectionModel.SINGLE_SELECTION
        stepLogList.cellRenderer = AgentStepLogRenderer()
        stepLogList.addListSelectionListener { e ->
            if (!e.valueIsAdjusting) {
                val selected = stepLogList.selectedValue
                if (selected != null) {
                    showStepDetail(selected)
                }
            }
        }

        val logScroll = JBScrollPane(stepLogList)
        panel.add(logScroll, BorderLayout.CENTER)

        // Summary
        val summaryLabel = JBLabel("Steps: 0 | Completed: 0 | Pending: 0")
        summaryLabel.border = JBUI.Borders.empty(4)
        panel.add(summaryLabel, BorderLayout.SOUTH)

        return panel
    }

    private fun createDetailPanel(): JComponent {
        val panel = JBPanel()
        panel.layout = BorderLayout()
        panel.border = BorderFactory.createTitledBorder("Step Details")

        detailPane.isEditable = false
        detailPane.contentType = "text/html"
        detailPane.setBackground(JBColor.namedColor("Panel.background", Color.WHITE))

        val detailScroll = JBScrollPane(detailPane)
        panel.add(detailScroll, BorderLayout.CENTER)

        // Action buttons for approval
        val actionPanel = JBPanel()
        actionPanel.layout = java.awt.FlowLayout(java.awt.FlowLayout.RIGHT)
        actionPanel.border = JBUI.Borders.empty(4)

        val approveButton = JButton("Approve")
        approveButton.addActionListener { approveCurrentStep() }
        val rejectButton = JButton("Reject")
        rejectButton.addActionListener { rejectCurrentStep() }
        val modifyButton = JButton("Modify")
        modifyButton.addActionListener { modifyCurrentStep() }

        actionPanel.add(approveButton)
        actionPanel.add(rejectButton)
        actionPanel.add(modifyButton)
        panel.add(actionPanel, BorderLayout.SOUTH)

        return panel
    }

    private fun createStatusPanel(): JComponent {
        val panel = JBPanel()
        panel.layout = BorderLayout()
        panel.border = JBUI.Borders.emptyTop(4)

        statusLabel.border = JBUI.Borders.empty(0, 8, 0, 0)
        panel.add(statusLabel, BorderLayout.WEST)

        progressBar.isIndeterminate = false
        progressBar.stringPainted = true
        progressBar.preferredSize = Dimension(200, 20)
        progressBar.isVisible = false
        panel.add(progressBar, BorderLayout.EAST)

        return panel
    }

    private fun startAgent() {
        val goal = goalTextArea.text.trim()
        if (goal.isBlank()) {
            showError("Please enter a goal for the agent")
            return
        }

        isRunning = true
        isPaused = false
        stepLogs.clear()
        updateStepLogList()
        detailPane.text = ""
        startButton.isEnabled = false
        stopButton.isEnabled = true
        pauseButton.isEnabled = true
        pauseButton.text = "Pause"

        setStatus("Starting agent...", true)

        scope.launch {
            try {
                val request = AgentRequest(
                    goal = goal,
                    mode = modeComboBox.selectedItem.toString(),
                    maxSteps = maxStepsSpinner.value as Int,
                    allowedTools = getAllowedTools()
                )

                val task = apiClient.startAgentTask(request)
                currentTaskId = task.taskId
                currentTask = task

                ApplicationManager.getApplication().invokeLater {
                    setStatus("Agent running: ${task.taskId}", true)
                    startStatusPolling()
                }
            } catch (e: Exception) {
                ApplicationManager.getApplication().invokeLater {
                    setStatus("Error: ${e.message}", false)
                    startButton.isEnabled = true
                    stopButton.isEnabled = false
                    pauseButton.isEnabled = false
                    isRunning = false
                    showError("Failed to start agent: ${e.message}")
                    logger.error("Failed to start agent", e)
                }
            }
        }
    }

    private fun stopAgent() {
        val taskId = currentTaskId ?: return

        stopButton.isEnabled = false
        setStatus("Stopping agent...", true)

        scope.launch {
            try {
                apiClient.stopAgentTask(taskId)
                statusPollJob?.cancel()
                statusPollJob = null

                ApplicationManager.getApplication().invokeLater {
                    setStatus("Agent stopped", false)
                    resetUI()
                }
            } catch (e: Exception) {
                ApplicationManager.getApplication().invokeLater {
                    setStatus("Error stopping agent: ${e.message}", false)
                    stopButton.isEnabled = true
                    logger.error("Failed to stop agent", e)
                }
            }
        }
    }

    private fun togglePause() {
        isPaused = !isPaused
        pauseButton.text = if (isPaused) "Resume" else "Pause"
        setStatus(if (isPaused) "Agent paused" else "Agent running", false)
        // TODO: Implement pause/resume API
    }

    private fun startStatusPolling() {
        statusPollJob?.cancel()
        currentTaskId?.let { taskId ->
            statusPollJob = scope.launch {
                while (isRunning && !isPaused) {
                    try {
                        val status = apiClient.getAgentTaskStatus(taskId)
                        taskStatus = status

                        ApplicationManager.getApplication().invokeLater {
                            updateFromStatus(status)
                        }

                        if (status.status == "completed" || status.status == "failed" || status.status == "cancelled") {
                            isRunning = false
                            ApplicationManager.getApplication().invokeLater {
                                onTaskComplete(status)
                            }
                            break
                        }

                        delay(2000) // Poll every 2 seconds
                    } catch (e: Exception) {
                        logger.warn("Status polling error", e)
                        delay(5000)
                    }
                }
            }
        }
    }

    private fun updateFromStatus(status: AgentTaskStatus) {
        progressBar.isVisible = true
        progressBar.progress = (status.progress * 100).toInt()
        progressBar.string = "${(status.progress * 100).toInt()}%"

        setStatus("${status.currentStep ?: "Running..."} (${status.stepsCompleted}/${status.totalSteps})", false)

        // Update step logs
        status.logs.forEachIndexed { index, log ->
            if (index >= stepLogs.size) {
                stepLogs.add(AgentStepLog(
                    step = status.stepsCompleted,
                    message = log,
                    timestamp = Instant.now(),
                    type = "info"
                ))
            } else if (stepLogs[index].message != log) {
                stepLogs[index] = stepLogs[index].copy(message = log)
            }
        }
        updateStepLogList()
    }

    private fun onTaskComplete(status: AgentTaskStatus) {
        progressBar.isVisible = false
        resetUI()

        when (status.status) {
            "completed" -> {
                setStatus("Task completed successfully", false)
                showInfo("Agent task completed!\n${status.logs.lastOrNull() ?: ""}")
            }
            "failed" -> {
                setStatus("Task failed", false)
                showError("Agent task failed:\n${status.logs.lastOrNull() ?: "Unknown error"}")
            }
            "cancelled" -> {
                setStatus("Task cancelled", false)
                showInfo("Agent task was cancelled")
            }
        }
    }

    private fun updateStepLogList() {
        val model = stepLogList.model as? javax.swing.DefaultListModel<AgentStepLog>
            ?: javax.swing.DefaultListModel<AgentStepLog>().also { stepLogList.model = it }
        model.clear()
        stepLogs.forEach { model.addElement(it) }

        // Update summary
        val completed = stepLogs.count { it.type == "completed" }
        val pending = stepLogs.count { it.type == "pending" }
        val summaryLabel = (mainPanel.getComponent(1) as? com.intellij.openapi.ui.Splitter)
            ?.firstComponent?.getComponent(0) as? javax.swing.JPanel
            ?.getComponent(1) as? JBLabel
        summaryLabel?.text = "Steps: ${stepLogs.size} | Completed: $completed | Pending: $pending"
    }

    private fun showStepDetail(log: AgentStepLog) {
        val html = StringBuilder()
        html.append("<html><body style='font-family: monospace; font-size: 12px; padding: 8px;'>")
        html.append("<h3>Step ${log.step}</h3>")
        html.append("<p><b>Time:</b> ${formatTimestamp(log.timestamp)}</p>")
        html.append("<p><b>Type:</b> <span style='color: ${log.typeColor};'>${log.type}</span></p>")
        html.append("<pre style='white-space: pre-wrap;'>${escapeHtml(log.message)}</pre>")
        html.append("</body></html>")
        detailPane.text = html.toString()
    }

    private fun approveCurrentStep() {
        val selected = stepLogList.selectedValue
        if (selected != null && selected.type == "pending_approval") {
            // TODO: Implement approval API
            selected.type = "approved"
            updateStepLogList()
            showStepDetail(selected)
        }
    }

    private fun rejectCurrentStep() {
        val selected = stepLogList.selectedValue
        if (selected != null && selected.type == "pending_approval") {
            val result = Messages.showYesNoDialog(
                project,
                "Reject this step? The agent will try an alternative approach.",
                "Reject Step",
                Messages.getQuestionIcon()
            )
            if (result == Messages.YES) {
                selected.type = "rejected"
                updateStepLogList()
                showStepDetail(selected)
            }
        }
    }

    private fun modifyCurrentStep() {
        val selected = stepLogList.selectedValue
        if (selected != null) {
            val input = Messages.showInputDialog(
                project,
                "Enter modification instructions:",
                "Modify Step",
                Messages.getQuestionIcon()
            )
            input?.let { modification ->
                // TODO: Send modification to agent
                selected.message += "\n\n[Modified: $modification]"
                updateStepLogList()
                showStepDetail(selected)
            }
        }
    }

    private fun getAllowedTools(): List<String> {
        // Return allowed tools based on settings
        return listOf("read_file", "write_file", "edit_file", "run_command", "git_diff", "search_files")
    }

    private fun resetUI() {
        startButton.isEnabled = true
        stopButton.isEnabled = false
        pauseButton.isEnabled = false
        pauseButton.text = "Pause"
        isRunning = false
        isPaused = false
        currentTaskId = null
        currentTask = null
        taskStatus = null
        statusPollJob?.cancel()
        statusPollJob = null
    }

    private fun setStatus(message: String, isProgress: Boolean) {
        statusLabel.text = message
        progressBar.isVisible = isProgress
        progressBar.isIndeterminate = isProgress && progressBar.progress == 0
    }

    private fun showError(message: String) {
        com.intellij.notification.NotificationGroupManager.getInstance()
            .getNotificationGroup("Infinity Build")
            .createNotification("Agent Error", message, com.intellij.notification.NotificationType.ERROR)
            .notify(project)
    }

    private fun showInfo(message: String) {
        com.intellij.notification.NotificationGroupManager.getInstance()
            .getNotificationGroup("Infinity Build")
            .createNotification("Agent", message, com.intellij.notification.NotificationType.INFORMATION)
            .notify(project)
    }

    private fun formatTimestamp(instant: Instant): String {
        val formatter = DateTimeFormatter.ofPattern("HH:mm:ss")
            .withZone(ZoneId.systemDefault())
        return formatter.format(instant)
    }

    private fun escapeHtml(text: String): String {
        return text
            .replace("&", "&")
            .replace("<", "<")
            .replace(">", ">")
            .replace("\"", """)
            .replace("'", "'")
    }

    fun refresh() {
        // Refresh current task status if running
        if (isRunning && currentTaskId != null) {
            scope.launch {
                try {
                    val status = apiClient.getAgentTaskStatus(currentTaskId!!)
                    ApplicationManager.getApplication().invokeLater {
                        updateFromStatus(status)
                    }
                } catch (e: Exception) {
                    logger.warn("Failed to refresh agent status", e)
                }
            }
        }
    }
}

/**
 * Agent step log entry.
 */
data class AgentStepLog(
    val step: Int,
    val message: String,
    val timestamp: Instant,
    var type: String = "info" // info, pending_approval, approved, rejected, completed, error
) {
    val typeColor: String
        get() = when (type) {
            "pending_approval" -> "#f0ad4e"
            "approved" -> "#5cb85c"
            "rejected" -> "#d9534f"
            "completed" -> "#5bc0de"
            "error" -> "#d9534f"
            else -> "#337ab7"
        }
}

/**
 * Custom renderer for agent step logs.
 */
class AgentStepLogRenderer : javax.swing.DefaultListCellRenderer() {

    override fun getListCellRendererComponent(
        list: JList<*>?,
        value: Any?,
        index: Int,
        isSelected: Boolean,
        cellHasFocus: Boolean
    ): JComponent {
        val label = super.getListCellRendererComponent(list, value, index, isSelected, cellHasFocus) as JLabel

        if (value is AgentStepLog) {
            val icon = when (value.type) {
                "pending_approval" -> "⏳ "
                "approved" -> "✅ "
                "rejected" -> "❌ "
                "completed" -> "✓ "
                "error" -> "⚠ "
                else -> "ℹ️ "
            }
            label.text = "$icon Step ${value.step}: ${value.message.take(80)}${if (value.message.length > 80) "..." else ""}"
            label.toolTipText = value.message

            if (!isSelected) {
                label.foreground = JBColor(Color.decode(value.typeColor), Color.decode(value.typeColor))
            }
        }

        return label
    }
}