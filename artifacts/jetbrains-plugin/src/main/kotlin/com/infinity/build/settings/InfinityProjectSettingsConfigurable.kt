package com.infinity.build.settings

import com.intellij.openapi.options.Configurable
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBPanel
import com.intellij.ui.components.JBTextField
import com.intellij.util.ui.JBUI
import org.jetbrains.annotations.Nls
import org.jetbrains.annotations.NotNull
import org.jetbrains.annotations.Nullable
import javax.swing.BorderFactory
import javax.swing.BoxLayout

/**
 * Project-specific settings configurable for Infinity Build.
 */
class InfinityProjectSettingsConfigurable(private val project: Project) : Configurable {

    private val settings = InfinityProjectSettings.getInstance(project)
    private var panel: ProjectSettingsPanel? = null

    override fun getDisplayName(): String = "Infinity Build"

    override fun getHelpTopic(): String? = "reference.settings.infinity.build.project"

    override fun createComponent(): @NotNull javax.swing.JComponent {
        panel = ProjectSettingsPanel()
        return panel!!.mainPanel
    }

    override fun isModified(): Boolean {
        val panel = this.panel ?: return false
        return settings.projectSpecificApiKey != panel.apiKeyField.text
            || settings.projectSpecificProjectId != panel.projectIdField.text
            || settings.customInstructions != panel.instructionsArea.text
            || settings.enableCodebaseIndexing != panel.indexingCheckBox.isSelected
            || settings.indexingDepth != panel.indexingDepthSpinner.value
    }

    override fun apply() {
        val settings = this.settings
        val panel = this.panel ?: return

        settings.projectSpecificApiKey = panel.apiKeyField.text.trim()
        settings.projectSpecificProjectId = panel.projectIdField.text.trim()
        settings.customInstructions = panel.instructionsArea.text.trim()
        settings.enableCodebaseIndexing = panel.indexingCheckBox.isSelected
        settings.indexingDepth = panel.indexingDepthSpinner.value as Int

        // Save excluded/included paths
        settings.excludedPaths.clear()
        settings.excludedPaths.addAll(panel.excludedPathsArea.text.lines().filter { it.isNotBlank() }.toList())

        settings.includedPaths.clear()
        settings.includedPaths.addAll(panel.includedPathsArea.text.lines().filter { it.isNotBlank() }.toList())
    }

    override fun reset() {
        val settings = this.settings
        val panel = this.panel ?: return

        panel.apiKeyField.text = settings.projectSpecificApiKey
        panel.projectIdField.text = settings.projectSpecificProjectId
        panel.instructionsArea.text = settings.customInstructions
        panel.indexingCheckBox.isSelected = settings.enableCodebaseIndexing
        panel.indexingDepthSpinner.value = settings.indexingDepth
        panel.excludedPathsArea.text = settings.excludedPaths.joinToString("\n")
        panel.includedPathsArea.text = settings.includedPaths.joinToString("\n")
    }

    override fun disposeUIResources() {
        panel = null
    }

    private class ProjectSettingsPanel {
        val mainPanel: JBPanel = JBPanel()
        val apiKeyField: JBTextField = JBTextField()
        val projectIdField: JBTextField = JBTextField()
        val instructionsArea: com.intellij.ui.components.JBTextArea = com.intellij.ui.components.JBTextArea()
        val indexingCheckBox: com.intellij.ui.components.JBCheckBox = com.intellij.ui.components.JBCheckBox("Enable codebase indexing")
        val indexingDepthSpinner: com.intellij.ui.components.JBSpinner = com.intellij.ui.components.JBSpinner(
            javax.swing.SpinnerNumberModel(3, 1, 10, 1)
        )
        val excludedPathsArea: com.intellij.ui.components.JBTextArea = com.intellij.ui.components.JBTextArea()
        val includedPathsArea: com.intellij.ui.components.JBTextArea = com.intellij.ui.components.JBTextArea()
        val testConnectionButton: com.intellij.ui.components.JBButton = com.intellij.ui.components.JBButton("Test Connection")

        init {
            mainPanel.layout = BoxLayout(mainPanel, BoxLayout.Y_AXIS)
            mainPanel.border = JBUI.Borders.empty(8)

            // API Key
            val apiKeyPanel = JBPanel()
            apiKeyPanel.layout = BoxLayout(apiKeyPanel, BoxLayout.X_AXIS)
            apiKeyPanel.add(JBLabel("Project API Key: "))
            apiKeyPanel.add(apiKeyField)
            apiKeyField.columns = 30
            mainPanel.add(apiKeyPanel)
            mainPanel.add(JBUI.Panels.emptyPanel(0, 8))

            // Project ID
            val projectIdPanel = JBPanel()
            projectIdPanel.layout = BoxLayout(projectIdPanel, BoxLayout.X_AXIS)
            projectIdPanel.add(JBLabel("Project ID:      "))
            projectIdPanel.add(projectIdField)
            projectIdField.columns = 30
            mainPanel.add(projectIdPanel)
            mainPanel.add(JBUI.Panels.emptyPanel(0, 8))

            // Test connection
            val testPanel = JBPanel()
            testPanel.layout = BoxLayout(testPanel, BoxLayout.X_AXIS)
            testConnectionButton.addActionListener { testConnection() }
            testPanel.add(testConnectionButton)
            mainPanel.add(testPanel)
            mainPanel.add(JBUI.Panels.emptyPanel(0, 16))

            // Custom Instructions
            val instructionsLabel = JBLabel("Custom Instructions (appended to agent prompts):")
            mainPanel.add(instructionsLabel)
            mainPanel.add(JBUI.Panels.emptyPanel(0, 4))

            instructionsArea.rows = 6
            instructionsArea.lineWrap = true
            instructionsArea.wrapStyleWord = true
            instructionsArea.border = BorderFactory.createCompoundBorder(
                BorderFactory.createLineBorder(JBUI.CurrentTheme.TextField.borderColor),
                JBUI.Borders.empty(4)
            )
            val instructionsScroll = com.intellij.ui.components.JBScrollPane(instructionsArea)
            instructionsScroll.preferredSize = java.awt.Dimension(0, 120)
            mainPanel.add(instructionsScroll)
            mainPanel.add(JBUI.Panels.emptyPanel(0, 16))

            // Indexing Settings
            val indexingPanel = JBPanel()
            indexingPanel.layout = BoxLayout(indexingPanel, BoxLayout.X_AXIS)
            indexingPanel.add(indexingCheckBox)
            indexingPanel.add(JBUI.Panels.emptyPanel(16, 0))
            indexingPanel.add(JBLabel("Depth: "))
            indexingPanel.add(indexingDepthSpinner)
            mainPanel.add(indexingPanel)
            mainPanel.add(JBUI.Panels.emptyPanel(0, 16))

            // Excluded Paths
            val excludedLabel = JBLabel("Excluded Paths (one per line, glob patterns):")
            mainPanel.add(excludedLabel)
            mainPanel.add(JBUI.Panels.emptyPanel(0, 4))

            excludedPathsArea.rows = 4
            excludedPathsArea.lineWrap = false
            excludedPathsArea.border = BorderFactory.createCompoundBorder(
                BorderFactory.createLineBorder(JBUI.CurrentTheme.TextField.borderColor),
                JBUI.Borders.empty(4)
            )
            val excludedScroll = com.intellij.ui.components.JBScrollPane(excludedPathsArea)
            mainPanel.add(excludedScroll)
            mainPanel.add(JBUI.Panels.emptyPanel(0, 8))

            // Included Paths
            val includedLabel = JBLabel("Included Paths (one per line, glob patterns, empty = all):")
            mainPanel.add(includedLabel)
            mainPanel.add(JBUI.Panels.emptyPanel(0, 4))

            includedPathsArea.rows = 4
            includedPathsArea.lineWrap = false
            includedPathsArea.border = BorderFactory.createCompoundBorder(
                BorderFactory.createLineBorder(JBUI.CurrentTheme.TextField.borderColor),
                JBUI.Borders.empty(4)
            )
            val includedScroll = com.intellij.ui.components.JBScrollPane(includedPathsArea)
            mainPanel.add(includedScroll)
        }

        private fun testConnection() {
            // Use global settings for connection test
            val globalSettings = InfinitySettingsState.getInstance()
            if (!globalSettings.isConfigured) {
                Messages.showErrorDialog(mainPanel, "Global settings not configured. Please configure API URL and key in global settings.", "Connection Test")
                return
            }

            // TODO: Actually test connection with project-specific settings
            Messages.showInfoMessage(mainPanel, "Connection test would use project-specific settings if provided, otherwise falls back to global settings.", "Connection Test")
        }
    }
}