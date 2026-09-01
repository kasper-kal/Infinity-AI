package com.infinity.build.ui

import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.ActionToolbar
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.Content
import com.intellij.ui.content.ContentFactory
import com.intellij.ui.tabs.JBTabs
import com.intellij.ui.tabs.TabInfo
import com.infinity.build.InfinityPlugin
import com.infinity.build.actions.*
import org.jetbrains.annotations.NotNull

/**
 * Tool Window Factory for Infinity Build.
 * Creates a tool window with tabs for Chat, Composer, and Agent.
 */
class InfinityToolWindowFactory : ToolWindowFactory {

    private val logger = Logger.getInstance(InfinityToolWindowFactory::class.java)

    override fun createToolWindowContent(@NotNull project: Project, @NotNull toolWindow: ToolWindow) {
        logger.info("Creating Infinity Build tool window for project: ${project.name}")

        // Create tabbed interface
        val tabs = JBTabs()
        tabs.isShowTabsInSingleMode = true
        tabs.placement = com.intellij.ui.tabs.JBTabsPlacement.TOP

        // Create panels for each tab
        val chatPanel = ChatPanel(project)
        val composerPanel = ComposerPanel(project)
        val agentPanel = AgentPanel(project)

        // Add tabs
        addTab(tabs, "Chat", chatPanel.mainPanel, "/icons/chat.svg", "Infinity Chat with @codebase context")
        addTab(tabs, "Composer", composerPanel.mainPanel, "/icons/composer.svg", "Multi-file task planning")
        addTab(tabs, "Agent", agentPanel.mainPanel, "/icons/agent.svg", "Autonomous coding agent")

        // Create content
        val contentFactory = ContentFactory.getInstance()
        val content = contentFactory.createContent(tabs, "", false)
        content.setCloseable(false)
        toolWindow.contentManager.addContent(content)

        // Add toolbar actions
        setupToolbar(toolWindow, project)

        // Store references for refresh
        toolWindow.putUserData(InfinityToolWindowFactory.CHAT_PANEL_KEY, chatPanel)
        toolWindow.putUserData(InfinityToolWindowFactory.COMPOSER_PANEL_KEY, composerPanel)
        toolWindow.putUserData(InfinityToolWindowFactory.AGENT_PANEL_KEY, agentPanel)
    }

    private fun addTab(
        tabs: JBTabs,
        title: String,
        component: javax.swing.JComponent,
        iconPath: String,
        tooltip: String
    ) {
        val tabInfo = TabInfo(component)
        tabInfo.text = title
        tabInfo.tooltip = tooltip
        try {
            tabInfo.icon = com.intellij.util.IconLoader.getIcon(iconPath, this::class.java.classLoader)
        } catch (e: Exception) {
            // Icon not found, use default
        }
        tabs.addTab(tabInfo)
    }

    private fun setupToolbar(toolWindow: ToolWindow, project: Project) {
        val actionManager = ActionManager.getInstance()
        val actionGroup = DefaultActionGroup()

        // Add actions to toolbar
        val actions = listOf(
            "Infinity.Chat.Action",
            "Infinity.Composer.Action",
            "Infinity.Agent.Action",
            "Infinity.SendToInfinity.Action",
            "Infinity.Settings.Action",
            "Infinity.Refresh.Action"
        )

        actions.forEach { actionId ->
            val action = actionManager.getAction(actionId)
            if (action != null) {
                actionGroup.add(action)
            }
        }

        val toolbar = ActionManager.getInstance().createActionToolbar(
            "InfinityBuildToolWindowToolbar",
            actionGroup,
            true
        )
        toolbar.targetComponent = toolWindow.component
        toolWindow.setTitleActions(toolbar.component)
    }

    companion object {
        val CHAT_PANEL_KEY = com.intellij.openapi.util.Key.create<ChatPanel>("InfinityChatPanel")
        val COMPOSER_PANEL_KEY = com.intellij.openapi.util.Key.create<ComposerPanel>("InfinityComposerPanel")
        val AGENT_PANEL_KEY = com.intellij.openapi.util.Key.create<AgentPanel>("InfinityAgentPanel")

        fun refreshToolWindow(project: Project) {
            val toolWindow = com.intellij.openapi.wm.ToolWindowManager.getInstance(project)
                .getToolWindow("InfinityBuild")
            toolWindow?.let { tw ->
                val chatPanel = tw.getUserData(CHAT_PANEL_KEY)
                val composerPanel = tw.getUserData(COMPOSER_PANEL_KEY)
                val agentPanel = tw.getUserData(AGENT_PANEL_KEY)

                chatPanel?.refresh()
                composerPanel?.refresh()
                agentPanel?.refresh()
            }
        }

        fun getChatPanel(project: Project): ChatPanel? {
            val toolWindow = com.intellij.openapi.wm.ToolWindowManager.getInstance(project)
                .getToolWindow("InfinityBuild")
            return toolWindow?.getUserData(CHAT_PANEL_KEY)
        }

        fun getComposerPanel(project: Project): ComposerPanel? {
            val toolWindow = com.intellij.openapi.wm.ToolWindowManager.getInstance(project)
                .getToolWindow("InfinityBuild")
            return toolWindow?.getUserData(COMPOSER_PANEL_KEY)
        }

        fun getAgentPanel(project: Project): AgentPanel? {
            val toolWindow = com.intellij.openapi.wm.ToolWindowManager.getInstance(project)
                .getToolWindow("InfinityBuild")
            return toolWindow?.getUserData(AGENT_PANEL_KEY)
        }
    }
}

/**
 * Tool window registration - called during project initialization.
 */
class ToolWindowRegistrar : com.intellij.openapi.project.ProjectComponent {

    override fun projectOpened() {
        // Tool window is registered via plugin.xml
    }

    override fun projectClosed() {
        // Cleanup if needed
    }

    override fun initComponent() {}

    override fun disposeComponent() {}

    override fun getComponentName(): String = "InfinityBuildToolWindowRegistrar"
}