package com.infinity.build.ui

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.editor.Document
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Splitter
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBPanel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import com.intellij.ui.treeStructure.Tree
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.tree.TreeUtil
import com.infinity.build.InfinityPlugin
import com.infinity.build.api.ComposerApplyResult
import com.infinity.build.api.ComposerPlan
import com.infinity.build.api.ComposerRequest
import com.infinity.build.api.ComposerStep
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import javax.swing.BorderFactory
import javax.swing.BoxLayout
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.JScrollPane
import javax.swing.JSplitPane
import javax.swing.JTree
import javax.swing.SwingUtilities
import javax.swing.tree.DefaultMutableTreeNode
import javax.swing.tree.DefaultTreeModel
import javax.swing.tree.TreeSelectionModel
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Dimension
import java.awt.Font
import java.awt.event.KeyEvent

/**
 * Composer Panel - Multi-file task planning with diff preview.
 */
class ComposerPanel(private val project: Project) {

    private val logger = Logger.getInstance(ComposerPanel::class.java)
    private val apiClient = InfinityPlugin.getInstance().getApiClient()
    private val scope = InfinityPlugin.getInstance().getCoroutineScope()

    // UI Components
    val mainPanel: JBPanel = JBPanel()
    private val goalTextArea: JBTextArea = JBTextArea()
    private val generateButton: JButton = JButton("Generate Plan")
    private val applyButton: JButton = JButton("Apply Changes")
    private val planTree: JTree = JTree()
    private val diffPane: javax.swing.JTextPane = javax.swing.JTextPane()
    private val statusLabel: JBLabel = JBLabel("Ready")
    private val progressBar: javax.swing.JProgressBar = javax.swing.JProgressBar()

    // State
    private var currentPlan: ComposerPlan? = null
    private var selectedSteps = mutableSetOf<String>()
    private val stepNodes = mutableMapOf<String, DefaultMutableTreeNode>()

    init {
        setupUI()
    }

    private fun setupUI() {
        mainPanel.layout = BorderLayout()
        mainPanel.border = JBUI.Borders.empty(4)

        // Top toolbar
        val toolbar = createToolbar()
        mainPanel.add(toolbar, BorderLayout.NORTH)

        // Main content area - split between plan tree and diff view
        val contentSplitter = Splitter(true, 0.5f)

        // Left - Plan Tree
        val leftPanel = createPlanTreePanel()
        contentSplitter.firstComponent = leftPanel

        // Right - Diff Preview
        val rightPanel = createDiffPreviewPanel()
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
        goalPanel.border = BorderFactory.createTitledBorder("Task Goal")

        goalTextArea.rows = 4
        goalTextArea.font = Font(Font.MONOSPACED, Font.PLAIN, 13)
        goalTextArea.lineWrap = true
        goalTextArea.wrapStyleWord = true
        goalTextArea.border = BorderFactory.createCompoundBorder(
            BorderFactory.createLineBorder(JBColor.namedColor("TextField.borderColor", Color.GRAY)),
            JBUI.Borders.empty(4)
        )
        goalTextArea.setPlaceholderText("Describe what you want to accomplish...\n\nExample: Create a REST API for user management with authentication, including endpoints for register, login, profile, and password reset.")

        val goalScroll = JBScrollPane(goalTextArea)
        goalScroll.preferredSize = Dimension(0, 100)
        goalPanel.add(goalScroll, BorderLayout.CENTER)

        // Buttons
        val buttonPanel = JBPanel()
        buttonPanel.layout = java.awt.FlowLayout(java.awt.FlowLayout.RIGHT)
        generateButton.addActionListener { generatePlan() }
        applyButton.addActionListener { applyPlan() }
        applyButton.isEnabled = false
        buttonPanel.add(generateButton)
        buttonPanel.add(applyButton)

        goalPanel.add(buttonPanel, BorderLayout.SOUTH)
        panel.add(goalPanel, BorderLayout.CENTER)

        return panel
    }

    private fun createPlanTreePanel(): JComponent {
        val panel = JBPanel()
        panel.layout = BorderLayout()
        panel.border = BorderFactory.createTitledBorder("Plan Steps")

        // Tree setup
        val rootNode = DefaultMutableTreeNode("Plan")
        val treeModel = DefaultTreeModel(rootNode)
        planTree.model = treeModel
        planTree.rootVisible = false
        planTree.showsRootHandles = true
        planTree.cellRenderer = ComposerTreeCellRenderer()
        planTree.getSelectionModel().selectionMode = TreeSelectionModel.DISCONTIGUOUS_TREE_SELECTION
        planTree.addTreeSelectionListener { e ->
            updateDiffPreview()
            updateApplyButton()
        }

        // Context menu
        val popupMenu = javax.swing.JPopupMenu()
        val selectAllItem = javax.swing.JMenuItem("Select All")
        selectAllItem.addActionListener { selectAllSteps() }
        val deselectAllItem = javax.swing.JMenuItem("Deselect All")
        deselectAllItem.addActionListener { deselectAllSteps() }
        val applySelectedItem = javax.swing.JMenuItem("Apply Selected")
        applySelectedItem.addActionListener { applySelectedSteps() }
        popupMenu.add(selectAllItem)
        popupMenu.add(deselectAllItem)
        popupMenu.addSeparator()
        popupMenu.add(applySelectedItem)
        planTree.componentPopupMenu = popupMenu

        val treeScroll = JBScrollPane(planTree)
        panel.add(treeScroll, BorderLayout.CENTER)

        // Step info panel
        val infoPanel = JBPanel()
        infoPanel.layout = BorderLayout()
        val infoLabel = JBLabel("Select steps to view diff preview")
        infoLabel.border = JBUI.Borders.empty(4)
        infoPanel.add(infoLabel, BorderLayout.CENTER)
        panel.add(infoPanel, BorderLayout.SOUTH)

        return panel
    }

    private fun createDiffPreviewPanel(): JComponent {
        val panel = JBPanel()
        panel.layout = BorderLayout()
        panel.border = BorderFactory.createTitledBorder("Diff Preview")

        diffPane.isEditable = false
        diffPane.contentType = "text/html"
        diffPane.setBackground(JBColor.namedColor("Panel.background", Color.WHITE))

        val diffScroll = JBScrollPane(diffPane)
        panel.add(diffScroll, BorderLayout.CENTER)

        // File selector for multi-file diffs
        val fileSelectorPanel = JBPanel()
        fileSelectorPanel.layout = BorderLayout()
        val fileLabel = JBLabel("File: ")
        val fileComboBox = javax.swing.JComboBox<String>()
        fileComboBox.addActionListener {
            val selectedFile = fileComboBox.selectedItem as String?
            if (selectedFile != null) {
                showDiffForFile(selectedFile)
            }
        }
        fileSelectorPanel.add(fileLabel, BorderLayout.WEST)
        fileSelectorPanel.add(fileComboBox, BorderLayout.CENTER)
        fileSelectorPanel.border = JBUI.Borders.empty(4)
        panel.add(fileSelectorPanel, BorderLayout.NORTH)

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

    private fun generatePlan() {
        val goal = goalTextArea.text.trim()
        if (goal.isBlank()) {
            showError("Please enter a task goal")
            return
        }

        setStatus("Generating plan...", true)
        generateButton.isEnabled = false

        scope.launch {
            try {
                val request = ComposerRequest(
                    goal = goal,
                    contextFiles = getCurrentContextFiles(),
                    constraints = getConstraints()
                )

                val plan = apiClient.createComposerPlan(request)

                ApplicationManager.getApplication().invokeLater {
                    displayPlan(plan)
                    setStatus("Plan generated: ${plan.steps.size} steps", false)
                    generateButton.isEnabled = true
                    applyButton.isEnabled = true
                }
            } catch (e: Exception) {
                ApplicationManager.getApplication().invokeLater {
                    setStatus("Error: ${e.message}", false)
                    generateButton.isEnabled = true
                    showError("Failed to generate plan: ${e.message}")
                    logger.error("Failed to generate composer plan", e)
                }
            }
        }
    }

    private fun displayPlan(plan: ComposerPlan) {
        currentPlan = plan
        selectedSteps.clear()
        stepNodes.clear()

        val rootNode = DefaultMutableTreeNode("Plan")
        val treeModel = DefaultTreeModel(rootNode)

        plan.steps.forEach { step ->
            val stepNode = DefaultMutableTreeNode(ComposerStepNode(step))
            stepNodes[step.id] = stepNode
            rootNode.add(stepNode)
        }

        planTree.model = treeModel
        TreeUtil.expandAll(planTree)
    }

    private fun updateDiffPreview() {
        val selectedPaths = planTree.getSelectionPaths()
        if (selectedPaths == null || selectedPaths.isEmpty()) {
            showEmptyDiff()
            return
        }

        // Show combined diff for all selected steps
        val diffs = selectedPaths.mapNotNull { path ->
            val node = path.lastPathComponent as? DefaultMutableTreeNode
            val stepNode = node?.userObject as? ComposerStepNode
            stepNode?.step?.diff
        }

        if (diffs.isEmpty()) {
            showEmptyDiff()
        } else {
            showCombinedDiff(diffs)
        }
    }

    private fun showDiffForFile(file: String) {
        currentPlan?.steps?.firstOrNull { it.file == file }?.diff?.let { diff ->
            renderDiff(diff)
        } ?: showEmptyDiff()
    }

    private fun showCombinedDiff(diffs: List<String>) {
        val combined = diffs.joinToString("\n\n---\n\n")
        renderDiff(combined)
    }

    private fun showEmptyDiff() {
        diffPane.text = "<html><body style='color: gray; padding: 20px; text-align: center;'>Select a plan step to preview changes</body></html>"
    }

    private fun renderDiff(diff: String) {
        // Simple diff rendering with colors
        val html = StringBuilder()
        html.append("<html><body style='font-family: monospace; font-size: 12px; padding: 8px;'>")

        diff.lines().forEach { line ->
            when {
                line.startsWith("+++") || line.startsWith("---") -> {
                    html.append("<div style='color: #0066cc;'>${escapeHtml(line)}</div>")
                }
                line.startsWith("+") -> {
                    html.append("<div style='color: #22863a; background-color: #f0fff4;'>${escapeHtml(line)}</div>")
                }
                line.startsWith("-") -> {
                    html.append("<div style='color: #cb2431; background-color: #fff5f5;'>${escapeHtml(line)}</div>")
                }
                line.startsWith("@@") -> {
                    html.append("<div style='color: #6f42c1; font-weight: bold;'>${escapeHtml(line)}</div>")
                }
                else -> {
                    html.append("<div>${escapeHtml(line)}</div>")
                }
            }
        }

        html.append("</body></html>")
        diffPane.text = html.toString()
    }

    private fun escapeHtml(text: String): String {
        return text
            .replace("&", "&")
            .replace("<", "<")
            .replace(">", ">")
            .replace("\"", """)
            .replace("'", "'")
    }

    private fun applyPlan() {
        applySelectedSteps()
    }

    private fun applySelectedSteps() {
        val selectedSteps = getSelectedStepIds()
        if (selectedSteps.isEmpty()) {
            showError("No steps selected")
            return
        }

        val planId = currentPlan?.planId ?: return

        setStatus("Applying changes...", true)
        applyButton.isEnabled = false
        generateButton.isEnabled = false

        scope.launch {
            try {
                val result = apiClient.applyComposerPlan(planId, selectedSteps)

                ApplicationManager.getApplication().invokeLater {
                    setStatus("Applied: ${result.appliedFiles.size} files", false)
                    applyButton.isEnabled = true
                    generateButton.isEnabled = true

                    if (result.errors.isNotEmpty()) {
                        showError("Some steps failed:\n${result.errors.joinToString("\n")}")
                    } else {
                        showInfo("Successfully applied ${result.appliedFiles.size} files")
                        // Refresh plan to show updated status
                        generatePlan()
                    }

                    // Open changed files in editor
                    result.appliedFiles.forEach { file ->
                        openFileInEditor(file)
                    }
                }
            } catch (e: Exception) {
                ApplicationManager.getApplication().invokeLater {
                    setStatus("Error: ${e.message}", false)
                    applyButton.isEnabled = true
                    generateButton.isEnabled = true
                    showError("Failed to apply plan: ${e.message}")
                    logger.error("Failed to apply composer plan", e)
                }
            }
        }
    }

    private fun selectAllSteps() {
        val rootNode = planTree.model.root as? DefaultMutableTreeNode
        rootNode?.children()?.forEach { node ->
            planTree.addSelectionPath(javax.swing.tree.TreePath(node.getPath()))
        }
    }

    private fun deselectAllSteps() {
        planTree.clearSelection()
    }

    private fun getSelectedStepIds(): List<String> {
        return planTree.getSelectionPaths()?.mapNotNull { path ->
            val node = path.lastPathComponent as? DefaultMutableTreeNode
            val stepNode = node?.userObject as? ComposerStepNode
            stepNode?.step?.id
        } ?: emptyList()
    }

    private fun updateApplyButton() {
        applyButton.isEnabled = currentPlan != null && getSelectedStepIds().isNotEmpty()
    }

    private fun getCurrentContextFiles(): List<String> {
        // Get currently open files as context
        return FileEditorManager.getInstance(project).openFiles
            .map { it.path }
            .filterNotNull()
            .take(10)
    }

    private fun getConstraints(): List<String> {
        // TODO: Add constraints UI
        return emptyList()
    }

    private fun openFileInEditor(filePath: String) {
        val virtualFile = com.intellij.openapi.vfs.VfsUtilCore.findFileByIoFile(
            java.io.File(filePath), true
        )
        virtualFile?.let {
            FileEditorManager.getInstance(project).openFile(it, true)
        }
    }

    private fun setStatus(message: String, isProgress: Boolean) {
        statusLabel.text = message
        progressBar.isVisible = isProgress
        progressBar.isIndeterminate = isProgress
    }

    private fun showError(message: String) {
        com.intellij.notification.NotificationGroupManager.getInstance()
            .getNotificationGroup("Infinity Build")
            .createNotification("Composer Error", message, com.intellij.notification.NotificationType.ERROR)
            .notify(project)
    }

    private fun showInfo(message: String) {
        com.intellij.notification.NotificationGroupManager.getInstance()
            .getNotificationGroup("Infinity Build")
            .createNotification("Composer", message, com.intellij.notification.NotificationType.INFORMATION)
            .notify(project)
    }

    fun refresh() {
        // Refresh current plan if exists
        if (currentPlan != null) {
            generatePlan()
        }
    }
}

/**
 * Tree node wrapper for composer steps.
 */
data class ComposerStepNode(val step: ComposerStep) {
    override fun toString(): String {
        val statusIcon = when (step.action) {
            "create" -> "➕ "
            "edit" -> "✏️ "
            "delete" -> "🗑️ "
            else -> "📄 "
        }
        return "$statusIcon${step.file} - ${step.description}"
    }
}

/**
 * Custom tree cell renderer for composer steps.
 */
class ComposerTreeCellRenderer : javax.swing.tree.DefaultTreeCellRenderer() {

    override fun getTreeCellRendererComponent(
        tree: JTree?,
        value: Any?,
        selected: Boolean,
        expanded: Boolean,
        leaf: Boolean,
        row: Int,
        hasFocus: Boolean
    ): JComponent {
        val label = super.getTreeCellRendererComponent(tree, value, selected, expanded, leaf, row, hasFocus) as JLabel

        if (value is DefaultMutableTreeNode) {
            val userObject = value.userObject
            if (userObject is ComposerStepNode) {
                val step = userObject.step
                label.text = userObject.toString()
                label.toolTipText = "Action: ${step.action}\nFile: ${step.file}\n${step.description}"

                // Color by action type
                when (step.action) {
                    "create" -> label.foreground = JBColor(new Color(0x22863a), new Color(0x3fb950))
                    "edit" -> label.foreground = JBColor(new Color(0x0969da), new Color(0x58a6ff))
                    "delete" -> label.foreground = JBColor(new Color(0xcb2431), new Color(0xf85149))
                }
            }
        }

        return label
    }
}