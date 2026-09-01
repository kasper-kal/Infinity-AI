package com.infinity.build.actions

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindowManager
import com.infinity.build.ui.InfinityToolWindowFactory

/**
 * Action to open/focus the Composer tab in Infinity Build tool window.
 */
class ComposerAction : AnAction() {

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.getData(CommonDataKeys.PROJECT) ?: return
        openComposerTab(project)
    }

    override fun update(e: AnActionEvent) {
        val project = e.getData(CommonDataKeys.PROJECT)
        e.presentation.isEnabled = project != null
        e.presentation.isVisible = project != null
    }

    private fun openComposerTab(project: Project) {
        val toolWindowManager = ToolWindowManager.getInstance(project)
        val toolWindow = toolWindowManager.getToolWindow("InfinityBuild")
        toolWindow?.activate {
            // Select the Composer tab (second tab)
            val composerPanel = InfinityToolWindowFactory.getComposerPanel(project)
            composerPanel?.refresh()
        }
    }
}