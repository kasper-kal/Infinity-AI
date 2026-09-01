package com.infinity.build.ui

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.editor.Document
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.editor.EditorSettings
import com.intellij.openapi.editor.colors.EditorColorsScheme
import com.intellij.openapi.editor.ex.EditorEx
import com.intellij.openapi.editor.markup.TextAttributes
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Splitter
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBPanel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import com.intellij.util.ui.JBUI
import com.infinity.build.InfinityPlugin
import com.infinity.build.api.ChatRequest
import com.infinity.build.api.ChatResponse
import com.infinity.build.api.Conversation
import com.infinity.build.api.Message
import com.infinity.build.api.WebSocketEvent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
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
import javax.swing.JComboBox
import javax.swing.JComponent
import javax.swing.JList
import javax.swing.JPopupMenu
import javax.swing.JScrollPane
import javax.swing.JTextPane
import javax.swing.ListSelectionModel
import javax.swing.SwingUtilities
import javax.swing.text.BadLocationException
import javax.swing.text.DefaultStyledDocument
import javax.swing.text.SimpleAttributeSet
import javax.swing.text.StyleConstants
import javax.swing.text.StyleContext

/**
 * Chat Panel - Main chat interface with @codebase context support.
 */
class ChatPanel(private val project: Project) {

    private val logger = Logger.getInstance(ChatPanel::class.java)
    private val apiClient = InfinityPlugin.getInstance().getApiClient()
    private val scope = InfinityPlugin.getInstance().getCoroutineScope()

    // UI Components
    val mainPanel: JBPanel = JBPanel()
    private val conversationList: JList<Conversation> = JList()
    private val messagePane: JTextPane = JTextPane()
    private val inputArea: JBTextArea = JBTextArea()
    private val sendButton: JButton = JButton("Send")
    private val modelComboBox: JComboBox<String> = JComboBox()
    private val modeComboBox: JComboBox<String> = JComboBox()
    private val useCodebaseCheckBox: com.intellij.ui.components.JBCheckBox = com.intellij.ui.components.JBCheckBox("Use @codebase")
    private val conversationComboBox: JComboBox<Conversation> = JComboBox()
    private val newConversationButton: JButton = JButton("New Chat")

    // State
    private var currentConversationId: String? = null
    private var isStreaming = false
    private val messageDocument = DefaultStyledDocument()
    private val conversations = mutableListOf<Conversation>()

    init {
        setupUI()
        loadConversations()
        setupWebSocket()
    }

    private fun setupUI() {
        mainPanel.layout = BorderLayout()
        mainPanel.border = JBUI.Borders.empty(4)

        // Left sidebar - Conversations
        val leftPanel = createConversationSidebar()
        val leftScroll = JBScrollPane(leftPanel)
        leftScroll.preferredSize = Dimension(280, 0)
        leftScroll.minimumSize = Dimension(200, 0)

        // Center - Chat messages
        val centerPanel = createChatArea()
        val centerScroll = JBScrollPane(centerPanel)
        centerScroll.preferredSize = Dimension(600, 0)

        // Right sidebar - Settings/Context
        val rightPanel = createSettingsSidebar()
        val rightScroll = JBScrollPane(rightPanel)
        rightScroll.preferredSize = Dimension(250, 0)
        rightScroll.minimumSize = Dimension(200, 0)

        // Split panes
        val horizontalSplitter = Splitter(true, 0.3f)
        horizontalSplitter.firstComponent = leftScroll
        horizontalSplitter.secondComponent = centerScroll
        horizontalSplitter.honorComponentsMinimumSize = true

        val mainSplitter = Splitter(false, 0.75f)
        mainSplitter.firstComponent = horizontalSplitter
        mainSplitter.secondComponent = rightScroll
        mainSplitter.honorComponentsMinimumSize = true

        mainPanel.add(mainSplitter, BorderLayout.CENTER)

        // Input area at bottom
        val inputPanel = createInputPanel()
        mainPanel.add(inputPanel, BorderLayout.SOUTH)
    }

    private fun createConversationSidebar(): JComponent {
        val panel = JBPanel()
        panel.layout = BorderLayout()
        panel.border = BorderFactory.createTitledBorder("Conversations")

        // Toolbar
        val toolbar = JBPanel()
        toolbar.layout = BorderLayout()
        newConversationButton.addActionListener { createNewConversation() }
        toolbar.add(newConversationButton, BorderLayout.WEST)
        panel.add(toolbar, BorderLayout.NORTH)

        // Conversation list
        conversationList.selectionMode = ListSelectionModel.SINGLE_SELECTION
        conversationList.addListSelectionListener { e ->
            if (!e.valueIsAdjusting) {
                val selected = conversationList.selectedValue
                if (selected != null) {
                    switchConversation(selected.id)
                }
            }
        }

        // Context menu
        val popupMenu = JPopupMenu()
        val deleteItem = javax.swing.JMenuItem("Delete")
        deleteItem.addActionListener { deleteSelectedConversation() }
        popupMenu.add(deleteItem)
        conversationList.componentPopupMenu = popupMenu

        panel.add(JBScrollPane(conversationList), BorderLayout.CENTER)
        return panel
    }

    private fun createChatArea(): JComponent {
        val panel = JBPanel()
        panel.layout = BorderLayout()
        panel.border = BorderFactory.createTitledBorder("Chat")

        // Message display
        messagePane.document = messageDocument
        messagePane.isEditable = false
        messagePane.contentType = "text/html"
        messagePane.setBackground(JBColor.namedColor("Panel.background", Color.WHITE))
        messagePane.putClientProperty("html.disable", Boolean.FALSE)

        val messageScroll = JBScrollPane(messagePane)
        messageScroll.verticalScrollBarPolicy = JScrollPane.VERTICAL_SCROLLBAR_AS_NEEDED
        panel.add(messageScroll, BorderLayout.CENTER)

        return panel
    }

    private fun createSettingsSidebar(): JComponent {
        val panel = JBPanel()
        panel.layout = BoxLayout(panel, BoxLayout.Y_AXIS)
        panel.border = BorderFactory.createTitledBorder("Settings")

        // Model selection
        val modelPanel = JBPanel()
        modelPanel.layout = BorderLayout()
        modelPanel.add(JBLabel("Model:"), BorderLayout.WEST)
        modelComboBox.addItem("claude-3-5-sonnet")
        modelComboBox.addItem("claude-3-opus")
        modelComboBox.addItem("gpt-4o")
        modelComboBox.addItem("gpt-4-turbo")
        modelComboBox.addItem("gemini-1.5-pro")
        modelComboBox.isEditable = true
        modelPanel.add(modelComboBox, BorderLayout.CENTER)
        panel.add(modelPanel)

        panel.add(JBUI.Panels.emptyPanel(0, 8))

        // Mode selection
        val modePanel = JBPanel()
        modePanel.layout = BorderLayout()
        modePanel.add(JBLabel("Mode:"), BorderLayout.WEST)
        modeComboBox.addItem("chat")
        modeComboBox.addItem("build")
        modeComboBox.addItem("composer")
        modeComboBox.addItem("agent")
        modePanel.add(modeComboBox, BorderLayout.CENTER)
        panel.add(modePanel)

        panel.add(JBUI.Panels.emptyPanel(0, 8))

        // Codebase checkbox
        useCodebaseCheckBox.isSelected = true
        panel.add(useCodebaseCheckBox)

        panel.add(JBUI.Panels.emptyPanel(0, 8))

        // Context info
        val contextLabel = JBLabel("<html><b>Context:</b><br/>Project-scoped<br/>Codebase indexing: ON</html>")
        contextLabel.border = JBUI.Borders.empty(4)
        panel.add(contextLabel)

        return panel
    }

    private fun createInputPanel(): JComponent {
        val panel = JBPanel()
        panel.layout = BorderLayout()
        panel.border = JBUI.Borders.empty(4)

        // Input area
        inputArea.rows = 3
        inputArea.font = Font(Font.MONOSPACED, Font.PLAIN, 13)
        inputArea.lineWrap = true
        inputArea.wrapStyleWord = true
        inputArea.border = BorderFactory.createCompoundBorder(
            BorderFactory.createLineBorder(JBColor.namedColor("TextField.borderColor", Color.GRAY)),
            JBUI.Borders.empty(4)
        )

        // Enter to send, Shift+Enter for newline
        inputArea.addKeyListener(object : java.awt.event.KeyAdapter() {
            override fun keyPressed(e: java.awt.event.KeyEvent) {
                if (e.keyCode == KeyEvent.VK_ENTER && !e.isShiftDown) {
                    e.consume()
                    sendMessage()
                }
            }
        })

        val inputScroll = JBScrollPane(inputArea)
        inputScroll.preferredSize = Dimension(0, 80)
        inputScroll.maximumSize = Dimension(Integer.MAX_VALUE, 150)

        // Send button
        sendButton.addActionListener { sendMessage() }
        sendButton.preferredSize = Dimension(80, 0)

        val buttonPanel = JBPanel()
        buttonPanel.layout = BorderLayout()
        buttonPanel.add(sendButton, BorderLayout.EAST)

        val inputContainer = JBPanel()
        inputContainer.layout = BorderLayout()
        inputContainer.add(inputScroll, BorderLayout.CENTER)
        inputContainer.add(buttonPanel, BorderLayout.EAST)

        panel.add(inputContainer, BorderLayout.CENTER)
        return panel
    }

    private fun loadConversations() {
        scope.launch {
            try {
                val list = apiClient.getConversations()
                ApplicationManager.getApplication().invokeLater {
                    conversations.clear()
                    conversations.addAll(list)
                    updateConversationList()
                }
            } catch (e: Exception) {
                logger.error("Failed to load conversations", e)
            }
        }
    }

    private fun updateConversationList() {
        val model = conversationList.model as? javax.swing.DefaultListModel<Conversation>
            ?: javax.swing.DefaultListModel<Conversation>().also { conversationList.model = it }
        model.clear()
        conversations.forEach { model.addElement(it) }
        conversationComboBox.removeAllItems()
        conversations.forEach { conversationComboBox.addItem(it) }
    }

    private fun createNewConversation() {
        scope.launch {
            try {
                val conversation = apiClient.createConversation("New Chat")
                ApplicationManager.getApplication().invokeLater {
                    conversations.add(0, conversation)
                    updateConversationList()
                    conversationList.setSelectedIndex(0)
                    switchConversation(conversation.id)
                }
            } catch (e: Exception) {
                logger.error("Failed to create conversation", e)
            }
        }
    }

    private fun deleteSelectedConversation() {
        val selected = conversationList.selectedValue
        if (selected != null) {
            // TODO: Implement delete conversation API
            conversations.remove(selected)
            updateConversationList()
            if (currentConversationId == selected.id) {
                currentConversationId = null
                clearMessages()
            }
        }
    }

    private fun switchConversation(conversationId: String) {
        currentConversationId = conversationId
        loadMessages(conversationId)
    }

    private fun loadMessages(conversationId: String) {
        scope.launch {
            try {
                val messages = apiClient.getConversationMessages(conversationId)
                ApplicationManager.getApplication().invokeLater {
                    displayMessages(messages)
                }
            } catch (e: Exception) {
                logger.error("Failed to load messages", e)
            }
        }
    }

    private fun displayMessages(messages: List<Message>) {
        clearMessages()
        messages.forEach { message ->
            appendMessage(message.role, message.content, message.timestamp)
        }
        scrollToBottom()
    }

    private fun clearMessages() {
        try {
            messageDocument.remove(0, messageDocument.length)
        } catch (e: BadLocationException) {
            logger.error("Failed to clear messages", e)
        }
    }

    private fun appendMessage(role: String, content: String, timestamp: String?) {
        val attrs = SimpleAttributeSet()
        val timeStr = timestamp?.let { formatTimestamp(it) } ?: ""

        when (role) {
            "user" -> {
                StyleConstants.setBold(attrs, true)
                StyleConstants.setForeground(attrs, JBColor.namedColor("Label.foreground", Color.BLUE))
                insertText("You $timeStr\n", attrs)
                StyleConstants.setBold(attrs, false)
                StyleConstants.setForeground(attrs, JBColor.namedColor("Label.foreground", Color.BLACK))
                insertText("$content\n\n", attrs)
            }
            "assistant" -> {
                StyleConstants.setBold(attrs, true)
                StyleConstants.setForeground(attrs, JBColor.namedColor("Label.foreground", Color.GREEN.darker()))
                insertText("Infinity $timeStr\n", attrs)
                StyleConstants.setBold(attrs, false)
                StyleConstants.setForeground(attrs, JBColor.namedColor("Label.foreground", Color.BLACK))
                insertText("$content\n\n", attrs)
            }
            "system" -> {
                StyleConstants.setItalic(attrs, true)
                StyleConstants.setForeground(attrs, JBColor.GRAY)
                insertText("[System] $content\n\n", attrs)
            }
            else -> {
                insertText("[$role] $content\n\n", attrs)
            }
        }
    }

    private fun insertText(text: String, attrs: SimpleAttributeSet) {
        try {
            val len = messageDocument.length
            messageDocument.insertString(len, text, attrs)
        } catch (e: BadLocationException) {
            logger.error("Failed to insert text", e)
        }
    }

    private fun formatTimestamp(isoTimestamp: String): String {
        return try {
            val instant = Instant.parse(isoTimestamp)
            val formatter = DateTimeFormatter.ofPattern("HH:mm")
                .withZone(ZoneId.systemDefault())
            formatter.format(instant)
        } catch (e: Exception) {
            ""
        }
    }

    private fun scrollToBottom() {
        SwingUtilities.invokeLater {
            messagePane.caretPosition = messageDocument.length
        }
    }

    private fun sendMessage() {
        val text = inputArea.text.trim()
        if (text.isBlank() || isStreaming) return

        inputArea.text = ""
        isStreaming = true
        sendButton.isEnabled = false

        // Display user message immediately
        appendMessage("user", text, Instant.now().toString())
        scrollToBottom()

        val request = ChatRequest(
            message = text,
            conversationId = currentConversationId,
            mode = modeComboBox.selectedItem.toString(),
            useCodebase = useCodebaseCheckBox.isSelected,
            projectId = InfinityPlugin.getInstance().apiClient.projectId
        )

        scope.launch {
            apiClient.sendChatMessage(
                message = text,
                conversationId = currentConversationId,
                mode = modeComboBox.selectedItem.toString(),
                useCodebase = useCodebaseCheckBox.isSelected,
                onChunk = { chunk ->
                    ApplicationManager.getApplication().invokeLater {
                        appendStreamingChunk(chunk)
                    }
                },
                onComplete = { response ->
                    ApplicationManager.getApplication().invokeLater {
                        finishStreaming(response)
                    }
                },
                onError = { error ->
                    ApplicationManager.getApplication().invokeLater {
                        handleStreamingError(error)
                    }
                }
            )
        }
    }

    private fun appendStreamingChunk(chunk: String) {
        try {
            val len = messageDocument.length
            val attrs = SimpleAttributeSet()
            StyleConstants.setForeground(attrs, JBColor.namedColor("Label.foreground", Color.BLACK))
            messageDocument.insertString(len, chunk, attrs)
            scrollToBottom()
        } catch (e: BadLocationException) {
            logger.error("Failed to append chunk", e)
        }
    }

    private fun finishStreaming(response: ChatResponse) {
        isStreaming = false
        sendButton.isEnabled = true
        appendMessage("assistant", "", Instant.now().toString()) // Add spacing
        scrollToBottom()

        // Refresh conversation list in case title changed
        loadConversations()
    }

    private fun handleStreamingError(error: Throwable) {
        isStreaming = false
        sendButton.isEnabled = true
        appendMessage("system", "Error: ${error.message}", Instant.now().toString())
        scrollToBottom()
        logger.error("Chat streaming error", error)
    }

    private fun setupWebSocket() {
        apiClient.connectWebSocket(
            onMessage = { event ->
                when (event) {
                    is WebSocketEvent.Notification -> {
                        ApplicationManager.getApplication().invokeLater {
                            showNotification(event.title, event.message, event.level)
                        }
                    }
                    is WebSocketEvent.BuildProgress -> {
                        // Handle build progress if in build mode
                    }
                    is WebSocketEvent.AgentProgress -> {
                        // Handle agent progress if in agent mode
                    }
                    is WebSocketEvent.IndexProgress -> {
                        // Handle indexing progress
                    }
                }
            },
            onError = { error ->
                logger.warn("WebSocket error", error)
            },
            onClose = {
                logger.info("WebSocket closed, attempting reconnect...")
                // Reconnect handled by client
            }
        )
    }

    private fun showNotification(title: String, message: String, level: String) {
        val notificationGroup = com.intellij.notification.NotificationGroupManager.getInstance()
            .getNotificationGroup("Infinity Build")
        val notification = notificationGroup.createNotification(
            title,
            message,
            when (level) {
                "ERROR" -> com.intellij.notification.NotificationType.ERROR
                "WARN" -> com.intellij.notification.NotificationType.WARNING
                else -> com.intellij.notification.NotificationType.INFORMATION
            }
        )
        notification.notify(project)
    }

    fun refresh() {
        loadConversations()
        if (currentConversationId != null) {
            loadMessages(currentConversationId!!)
        }
    }
}