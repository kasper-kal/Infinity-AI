package com.infinity.build.actions

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindowManager
import com.infinity.build.ui.InfinityToolWindowFactory

/**
 * Action to refresh the Infinity Build tool window.
 */
class RefreshAction : AnAction() {

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.getData(CommonDataKeys.PROJECT) ?: return
        refreshToolWindow(project)
    }

    override fun update(e: AnActionEvent) {
        val project = e.getData(CommonDataKeys.PROJECT)
        e.presentation.isEnabled = project != null
        e.presentation.isVisible = project != null
    }

    private fun refreshToolWindow(project: Project) {
        val toolWindowManager = ToolWindowManager.getInstance(project)
        val toolWindow = toolWindowManager.getToolWindow("InfinityBuild")
        toolWindow?.let {
            InfinityToolWindowFactory.refreshToolWindow(project)
        }
    }
}