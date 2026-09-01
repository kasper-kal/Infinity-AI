package com.infinity.build.actions

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindowManager
import com.infinity.build.ui.InfinityToolWindowFactory

/**
 * Action to open/focus the Agent tab in Infinity Build tool window.
 */
class AgentAction : AnAction() {

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.getData(CommonDataKeys.PROJECT) ?: return
        openAgentTab(project)
    }

    override fun update(e: AnActionEvent) {
        val project = e.getData(CommonDataKeys.PROJECT)
        e.presentation.isEnabled = project != null
        e.presentation.isVisible = project != null
    }

    private fun openAgentTab(project: Project) {
        val toolWindowManager = ToolWindowManager.getInstance(project)
        val toolWindow = toolWindowManager.getToolWindow("InfinityBuild")
        toolWindow?.activate {
            // Select the Agent tab (third tab)
            val agentPanel = InfinityToolWindowFactory.getAgentPanel(project)
            agentPanel?.refresh()
        }
    }
}