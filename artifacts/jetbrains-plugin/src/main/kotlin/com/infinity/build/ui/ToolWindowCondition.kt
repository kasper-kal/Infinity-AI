package com.infinity.build.ui

import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.openapi.wm.ex.ToolWindowCondition

/**
 * Condition to show/hide the Infinity Build tool window based on project state.
 */
class ToolWindowCondition : ToolWindowCondition {

    override fun shouldBeAvailable(project: Project?): Boolean {
        return project != null && !project.isDisposed && !project.isDefault
    }

    override fun shouldBeVisible(project: Project?): Boolean {
        return shouldBeAvailable(project)
    }
}