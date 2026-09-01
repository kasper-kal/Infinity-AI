package com.infinity.build.actions

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindowManager
import com.infinity.build.ui.InfinityToolWindowFactory

/**
 * Action to open/focus the Chat tab in Infinity Build tool window.
 */
class ChatAction : AnAction() {

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.getData(CommonDataKeys.PROJECT) ?: return
        openChatTab(project)
    }

    override fun update(e: AnActionEvent) {
        val project = e.getData(CommonDataKeys.PROJECT)
        e.presentation.isEnabled = project != null
        e.presentation.isVisible = project != null
    }

    private fun openChatTab(project: Project) {
        val toolWindowManager = ToolWindowManager.getInstance(project)
        val toolWindow = toolWindowManager.getToolWindow("InfinityBuild")
        toolWindow?.activate {
            // Select the Chat tab (first tab)
            val chatPanel = InfinityToolWindowFactory.getChatPanel(project)
            chatPanel?.let { panel ->
                // The tool window uses JBTabs, we need to select the first tab
                // This is handled by the tool window factory
            }
        }
    }
}