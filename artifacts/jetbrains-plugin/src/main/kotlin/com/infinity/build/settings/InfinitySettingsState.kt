package com.infinity.build.settings

import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.components.StoragePathMacros
import com.intellij.util.xmlb.XmlSerializerUtil
import org.jetbrains.annotations.NotNull
import org.jetbrains.annotations.Nullable

/**
 * Persistent settings state for Infinity Build plugin.
 * Stored in IDE's configuration directory.
 */
@State(
    name = "InfinityBuildSettings",
    storages = [Storage(StoragePathMacros.APP_CONFIG + "/infinity-build-settings.xml")]
)
@Service(Service.Level.APP)
class InfinitySettingsState : PersistentStateComponent<InfinitySettingsState> {

    var apiBaseUrl: String = "http://localhost:8080"
    var apiKey: String = ""
    var projectId: String = ""
    var autoConnect: Boolean = true
    var showNotifications: Boolean = true
    var chatFontSize: Int = 13
    var enableInlineDiff: Boolean = true
    var enableAutoComplete: Boolean = true
    var autoCompleteDelay: Int = 150
    var maxContextTokens: Int = 8000
    var preferredModel: String = "claude-3-5-sonnet"
    var theme: String = "system" // system, light, dark

    // WebSocket settings
    var wsReconnectAttempts: Int = 5
    var wsReconnectDelay: Long = 2000
    var wsHeartbeatInterval: Long = 30000

    // Terminal bridge settings
    var terminalBridgeUrl: String = "ws://localhost:3001"
    var terminalBridgeSecret: String = ""

    // Advanced
    var logLevel: String = "INFO" // DEBUG, INFO, WARN, ERROR
    var enableDebugLogging: Boolean = false
    var requestTimeout: Int = 60000

    override fun getState(): InfinitySettingsState = this

    override fun loadState(state: InfinitySettingsState) {
        XmlSerializerUtil.copyBean(state, this)
    }

    val isConfigured: Boolean
        get() = apiKey.isNotBlank() && projectId.isNotBlank()

    val hasValidApiUrl: Boolean
        get() = apiBaseUrl.startsWith("http://") || apiBaseUrl.startsWith("https://")

    fun reset() {
        apiBaseUrl = "http://localhost:8080"
        apiKey = ""
        projectId = ""
        autoConnect = true
        showNotifications = true
        chatFontSize = 13
        enableInlineDiff = true
        enableAutoComplete = true
        autoCompleteDelay = 150
        maxContextTokens = 8000
        preferredModel = "claude-3-5-sonnet"
        theme = "system"
        wsReconnectAttempts = 5
        wsReconnectDelay = 2000
        wsHeartbeatInterval = 30000
        terminalBridgeUrl = "ws://localhost:3001"
        terminalBridgeSecret = ""
        logLevel = "INFO"
        enableDebugLogging = false
        requestTimeout = 60000
    }

    companion object {
        fun getInstance(): InfinitySettingsState {
            return com.intellij.openapi.application.ApplicationManager.getApplication()
                .getService(InfinitySettingsState::class.java)
        }
    }
}

/**
 * Project-specific settings (stored per project).
 */
@State(
    name = "InfinityBuildProjectSettings",
    storages = [Storage(StoragePathMacros.PROJECT_CONFIG_DIR + "/infinity-build-project-settings.xml")]
)
@Service(Service.Level.PROJECT)
class InfinityProjectSettings : PersistentStateComponent<InfinityProjectSettings> {

    var projectSpecificApiKey: String = ""
    var projectSpecificProjectId: String = ""
    var excludedPaths: MutableList<String> = mutableListOf()
    var includedPaths: MutableList<String> = mutableListOf()
    var customInstructions: String = ""
    var enableCodebaseIndexing: Boolean = true
    var indexingDepth: Int = 3

    override fun getState(): InfinityProjectSettings = this

    override fun loadState(state: InfinityProjectSettings) {
        XmlSerializerUtil.copyBean(state, this)
    }

    companion object {
        fun getInstance(project: com.intellij.openapi.project.Project): InfinityProjectSettings {
            return project.getService(InfinityProjectSettings::class.java)
        }
    }
}

/**
 * Settings configurable for the Settings dialog.
 */
class InfinitySettingsConfigurable : com.intellij.openapi.options.Configurable {

    private val logger = com.intellij.openapi.diagnostic.Logger.getInstance(InfinitySettingsConfigurable::class.java)
    private var panel: InfinitySettingsPanel? = null

    override fun getDisplayName(): String = "Infinity Build"

    override fun getHelpTopic(): String? = "reference.settings.infinity.build"

    override fun createComponent(): @NotNull javax.swing.JComponent {
        panel = InfinitySettingsPanel()
        return panel!!.mainPanel
    }

    override fun isModified(): Boolean {
        val settings = InfinitySettingsState.getInstance()
        val panel = this.panel ?: return false
        return settings.apiBaseUrl != panel.apiUrlField.text
            || settings.apiKey != panel.apiKeyField.password.toString()
            || settings.projectId != panel.projectIdField.text
            || settings.autoConnect != panel.autoConnectCheckBox.isSelected
            || settings.showNotifications != panel.showNotificationsCheckBox.isSelected
            || settings.chatFontSize != panel.fontSizeSpinner.value
            || settings.enableInlineDiff != panel.inlineDiffCheckBox.isSelected
            || settings.enableAutoComplete != panel.autoCompleteCheckBox.isSelected
            || settings.autoCompleteDelay != panel.autoCompleteDelaySpinner.value
            || settings.maxContextTokens != panel.maxTokensSpinner.value
            || settings.preferredModel != panel.modelComboBox.selectedItem.toString()
            || settings.theme != panel.themeComboBox.selectedItem.toString()
            || settings.wsReconnectAttempts != panel.wsReconnectAttemptsSpinner.value
            || settings.wsReconnectDelay != panel.wsReconnectDelaySpinner.value
            || settings.wsHeartbeatInterval != panel.wsHeartbeatSpinner.value
            || settings.terminalBridgeUrl != panel.terminalBridgeUrlField.text
            || settings.terminalBridgeSecret != panel.terminalBridgeSecretField.password.toString()
            || settings.logLevel != panel.logLevelComboBox.selectedItem.toString()
            || settings.enableDebugLogging != panel.debugLoggingCheckBox.isSelected
            || settings.requestTimeout != panel.requestTimeoutSpinner.value
    }

    override fun apply() {
        val settings = InfinitySettingsState.getInstance()
        val panel = this.panel ?: return

        settings.apiBaseUrl = panel.apiUrlField.text.trim()
        settings.apiKey = panel.apiKeyField.password.toString().trim()
        settings.projectId = panel.projectIdField.text.trim()
        settings.autoConnect = panel.autoConnectCheckBox.isSelected
        settings.showNotifications = panel.showNotificationsCheckBox.isSelected
        settings.chatFontSize = panel.fontSizeSpinner.value as Int
        settings.enableInlineDiff = panel.inlineDiffCheckBox.isSelected
        settings.enableAutoComplete = panel.autoCompleteCheckBox.isSelected
        settings.autoCompleteDelay = panel.autoCompleteDelaySpinner.value as Int
        settings.maxContextTokens = panel.maxTokensSpinner.value as Int
        settings.preferredModel = panel.modelComboBox.selectedItem.toString()
        settings.theme = panel.themeComboBox.selectedItem.toString()
        settings.wsReconnectAttempts = panel.wsReconnectAttemptsSpinner.value as Int
        settings.wsReconnectDelay = panel.wsReconnectDelaySpinner.value as Long
        settings.wsHeartbeatInterval = panel.wsHeartbeatSpinner.value as Long
        settings.terminalBridgeUrl = panel.terminalBridgeUrlField.text.trim()
        settings.terminalBridgeSecret = panel.terminalBridgeSecretField.password.toString().trim()
        settings.logLevel = panel.logLevelComboBox.selectedItem.toString()
        settings.enableDebugLogging = panel.debugLoggingCheckBox.isSelected
        settings.requestTimeout = panel.requestTimeoutSpinner.value as Int

        logger.info("Infinity Build settings applied")
    }

    override fun reset() {
        val settings = InfinitySettingsState.getInstance()
        val panel = this.panel ?: return

        panel.apiUrlField.text = settings.apiBaseUrl
        panel.apiKeyField.password = settings.apiKey.toCharArray()
        panel.projectIdField.text = settings.projectId
        panel.autoConnectCheckBox.isSelected = settings.autoConnect
        panel.showNotificationsCheckBox.isSelected = settings.showNotifications
        panel.fontSizeSpinner.value = settings.chatFontSize
        panel.inlineDiffCheckBox.isSelected = settings.enableInlineDiff
        panel.autoCompleteCheckBox.isSelected = settings.enableAutoComplete
        panel.autoCompleteDelaySpinner.value = settings.autoCompleteDelay
        panel.maxTokensSpinner.value = settings.maxContextTokens
        panel.modelComboBox.setSelectedItem(settings.preferredModel)
        panel.themeComboBox.setSelectedItem(settings.theme)
        panel.wsReconnectAttemptsSpinner.value = settings.wsReconnectAttempts
        panel.wsReconnectDelaySpinner.value = settings.wsReconnectDelay
        panel.wsHeartbeatSpinner.value = settings.wsHeartbeatInterval
        panel.terminalBridgeUrlField.text = settings.terminalBridgeUrl
        panel.terminalBridgeSecretField.password = settings.terminalBridgeSecret.toCharArray()
        panel.logLevelComboBox.setSelectedItem(settings.logLevel)
        panel.debugLoggingCheckBox.isSelected = settings.enableDebugLogging
        panel.requestTimeoutSpinner.value = settings.requestTimeout
    }

    override fun disposeUIResources() {
        panel = null
    }
}

/**
 * Settings panel UI.
 */
class InfinitySettingsPanel {
    val mainPanel: javax.swing.JPanel = com.intellij.ui.components.JBPanel()
    val apiUrlField: com.intellij.ui.components.JBTextField = com.intellij.ui.components.JBTextField()
    val apiKeyField: com.intellij.ui.components.JBPasswordField = com.intellij.ui.components.JBPasswordField()
    val projectIdField: com.intellij.ui.components.JBTextField = com.intellij.ui.components.JBTextField()
    val autoConnectCheckBox: com.intellij.ui.components.JBCheckBox = com.intellij.ui.components.JBCheckBox("Auto-connect on startup")
    val showNotificationsCheckBox: com.intellij.ui.components.JBCheckBox = com.intellij.ui.components.JBCheckBox("Show notifications")
    val fontSizeSpinner: com.intellij.ui.components.JBSpinner = com.intellij.ui.components.JBSpinner(
        javax.swing.SpinnerNumberModel(13, 8, 24, 1)
    )
    val inlineDiffCheckBox: com.intellij.ui.components.JBCheckBox = com.intellij.ui.components.JBCheckBox("Enable inline diffs")
    val autoCompleteCheckBox: com.intellij.ui.components.JBCheckBox = com.intellij.ui.components.JBCheckBox("Enable autocomplete")
    val autoCompleteDelaySpinner: com.intellij.ui.components.JBSpinner = com.intellij.ui.components.JBSpinner(
        javax.swing.SpinnerNumberModel(150, 50, 1000, 50)
    )
    val maxTokensSpinner: com.intellij.ui.components.JBSpinner = com.intellij.ui.components.JBSpinner(
        javax.swing.SpinnerNumberModel(8000, 1000, 100000, 1000)
    )
    val modelComboBox: com.intellij.ui.components.JBComboBox<String> = com.intellij.ui.components.JBComboBox(
        arrayOf("claude-3-5-sonnet", "claude-3-opus", "gpt-4o", "gpt-4-turbo", "gemini-1.5-pro", "custom")
    )
    val themeComboBox: com.intellij.ui.components.JBComboBox<String> = com.intellij.ui.components.JBComboBox(
        arrayOf("system", "light", "dark")
    )
    val wsReconnectAttemptsSpinner: com.intellij.ui.components.JBSpinner = com.intellij.ui.components.JBSpinner(
        javax.swing.SpinnerNumberModel(5, 1, 20, 1)
    )
    val wsReconnectDelaySpinner: com.intellij.ui.components.JBSpinner = com.intellij.ui.components.JBSpinner(
        javax.swing.SpinnerNumberModel(2000, 500, 30000, 500)
    )
    val wsHeartbeatSpinner: com.intellij.ui.components.JBSpinner = com.intellij.ui.components.JBSpinner(
        javax.swing.SpinnerNumberModel(30000, 5000, 120000, 5000)
    )
    val terminalBridgeUrlField: com.intellij.ui.components.JBTextField = com.intellij.ui.components.JBTextField()
    val terminalBridgeSecretField: com.intellij.ui.components.JBPasswordField = com.intellij.ui.components.JBPasswordField()
    val logLevelComboBox: com.intellij.ui.components.JBComboBox<String> = com.intellij.ui.components.JBComboBox(
        arrayOf("DEBUG", "INFO", "WARN", "ERROR")
    )
    val debugLoggingCheckBox: com.intellij.ui.components.JBCheckBox = com.intellij.ui.components.JBCheckBox("Enable debug logging")
    val requestTimeoutSpinner: com.intellij.ui.components.JBSpinner = com.intellij.ui.components.JBSpinner(
        javax.swing.SpinnerNumberModel(60000, 5000, 300000, 5000)
    )

    init {
        mainPanel.layout = java.awt.GridBagLayout()
        val gbc = java.awt.GridBagConstraints()
        gbc.insets = java.awt.Insets(4, 4, 4, 4)
        gbc.anchor = java.awt.GridBagConstraints.WEST
        gbc.fill = java.awt.GridBagConstraints.HORIZONTAL

        var row = 0

        fun addLabel(text: String, column: Int = 0) {
            gbc.gridx = column
            gbc.gridy = row
            gbc.weightx = 0.0
            mainPanel.add(javax.swing.JLabel(text), gbc)
        }

        fun addField(component: javax.swing.JComponent, column: Int = 1, weightx: Double = 1.0) {
            gbc.gridx = column
            gbc.gridy = row
            gbc.weightx = weightx
            mainPanel.add(component, gbc)
        }

        // Connection section
        addSectionLabel("Connection", row)
        row++

        addLabel("API Base URL:")
        addField(apiUrlField)
        apiUrlField.columns = 30
        row++

        addLabel("API Key:")
        addField(apiKeyField)
        apiKeyField.columns = 30
        row++

        addLabel("Project ID:")
        addField(projectIdField)
        projectIdField.columns = 30
        row++

        gbc.gridx = 0
        gbc.gridy = row
        gbc.gridwidth = 2
        mainPanel.add(autoConnectCheckBox, gbc)
        gbc.gridwidth = 1
        row++

        gbc.gridx = 0
        gbc.gridy = row
        gbc.gridwidth = 2
        mainPanel.add(showNotificationsCheckBox, gbc)
        gbc.gridwidth = 1
        row++

        // Terminal Bridge section
        addSectionLabel("Terminal Bridge", row)
        row++

        addLabel("Bridge URL:")
        addField(terminalBridgeUrlField)
        terminalBridgeUrlField.columns = 30
        row++

        addLabel("Bridge Secret:")
        addField(terminalBridgeSecretField)
        terminalBridgeSecretField.columns = 30
        row++

        // Chat section
        addSectionLabel("Chat", row)
        row++

        addLabel("Font Size:")
        addField(fontSizeSpinner)
        row++

        gbc.gridx = 0
        gbc.gridy = row
        gbc.gridwidth = 2
        mainPanel.add(inlineDiffCheckBox, gbc)
        gbc.gridwidth = 1
        row++

        // Autocomplete section
        addSectionLabel("Autocomplete", row)
        row++

        gbc.gridx = 0
        gbc.gridy = row
        gbc.gridwidth = 2
        mainPanel.add(autoCompleteCheckBox, gbc)
        gbc.gridwidth = 1
        row++

        addLabel("Delay (ms):")
        addField(autoCompleteDelaySpinner)
        row++

        // Model section
        addSectionLabel("Model", row)
        row++

        addLabel("Preferred Model:")
        addField(modelComboBox)
        modelComboBox.isEditable = true
        row++

        addLabel("Max Context Tokens:")
        addField(maxTokensSpinner)
        row++

        addLabel("Theme:")
        addField(themeComboBox)
        row++

        // WebSocket section
        addSectionLabel("WebSocket", row)
        row++

        addLabel("Reconnect Attempts:")
        addField(wsReconnectAttemptsSpinner)
        row++

        addLabel("Reconnect Delay (ms):")
        addField(wsReconnectDelaySpinner)
        row++

        addLabel("Heartbeat Interval (ms):")
        addField(wsHeartbeatSpinner)
        row++

        // Logging section
        addSectionLabel("Logging", row)
        row++

        addLabel("Log Level:")
        addField(logLevelComboBox)
        row++

        gbc.gridx = 0
        gbc.gridy = row
        gbc.gridwidth = 2
        mainPanel.add(debugLoggingCheckBox, gbc)
        gbc.gridwidth = 1
        row++

        addLabel("Request Timeout (ms):")
        addField(requestTimeoutSpinner)
        row++
    }

    private fun addSectionLabel(text: String, row: Int) {
        gbc.gridx = 0
        gbc.gridy = row
        gbc.gridwidth = 2
        gbc.insets = java.awt.Insets(12, 4, 4, 4)
        val label = javax.swing.JLabel("<html><b>$text</b></html>")
        label.font = label.font.deriveFont(java.awt.Font.BOLD, 12f)
        mainPanel.add(label, gbc)
        gbc.gridwidth = 1
        gbc.insets = java.awt.Insets(4, 4, 4, 4)
    }
}