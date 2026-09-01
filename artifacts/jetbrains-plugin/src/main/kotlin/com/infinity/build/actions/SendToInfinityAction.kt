package com.infinity.build.actions

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.actionSystem.LangDataKeys
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.psi.PsiFile
import com.intellij.psi.PsiManager
import com.infinity.build.InfinityPlugin
import com.infinity.build.ui.InfinityToolWindowFactory
import com.infinity.build.ui.ChatPanel

/**
 * Action to send selected code/files to Infinity Chat with context.
 */
class SendToInfinityAction : AnAction() {

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.getData(CommonDataKeys.PROJECT) ?: return
        val editor = e.getData(CommonDataKeys.EDITOR)
        val psiFile = e.getData(LangDataKeys.PSI_FILE)
        val virtualFile = e.getData(CommonDataKeys.VIRTUAL_FILE)

        sendToInfinity(project, editor, psiFile, virtualFile)
    }

    override fun update(e: AnActionEvent) {
        val project = e.getData(CommonDataKeys.PROJECT)
        val hasSelection = e.getData(CommonDataKeys.EDITOR)?.selectionModel?.hasSelection() == true
        val hasFile = e.getData(LangDataKeys.PSI_FILE) != null || e.getData(CommonDataKeys.VIRTUAL_FILE) != null

        e.presentation.isEnabled = project != null && (hasSelection || hasFile)
        e.presentation.isVisible = project != null
    }

    private fun sendToInfinity(
        project: Project,
        editor: Editor?,
        psiFile: PsiFile?,
        virtualFile: com.intellij.openapi.vfs.VirtualFile?
    ) {
        // Get selected text or file content
        val context = StringBuilder()
        var filePath = ""

        when {
            editor?.selectionModel?.hasSelection() == true -> {
                val selectedText = editor.selectionModel.selectedText
                filePath = psiFile?.virtualFile?.path ?: virtualFile?.path ?: "unknown"
                context.append("**Selected code from `$filePath`:**\n\n```\n$selectedText\n```")
            }
            psiFile != null -> {
                filePath = psiFile.virtualFile.path
                val fullText = psiFile.text
                context.append("**File: `$filePath`**\n\n```\n$fullText\n```")
            }
            virtualFile != null -> {
                filePath = virtualFile.path
                val content = virtualFile.contentsToByteArray().decodeToString()
                context.append("**File: `$filePath`**\n\n```\n$content\n```")
            }
        }

        // Open Infinity Build tool window and switch to Chat tab
        val toolWindowManager = ToolWindowManager.getInstance(project)
        val toolWindow = toolWindowManager.getToolWindow("InfinityBuild")
        toolWindow?.activate {
            // Get chat panel and send message
            val chatPanel = InfinityToolWindowFactory.getChatPanel(project)
            chatPanel?.let { panel ->
                // Pre-fill the input with context
                panel.inputArea.text = context.toString()
                panel.inputArea.requestFocus()

                // Optionally auto-send if user wants
                // panel.sendMessage()
            }
        }
    }
}

/**
 * Action to send current file to Infinity for analysis.
 */
class SendFileToInfinityAction : AnAction() {

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.getData(CommonDataKeys.PROJECT) ?: return
        val virtualFile = e.getData(CommonDataKeys.VIRTUAL_FILE)
        val psiFile = e.getData(LangDataKeys.PSI_FILE)

        val file = virtualFile ?: psiFile?.virtualFile ?: return

        val content = file.contentsToByteArray().decodeToString()
        val context = "**File: `${file.path}`**\n\n```\n$content\n```"

        val toolWindowManager = ToolWindowManager.getInstance(project)
        val toolWindow = toolWindowManager.getToolWindow("InfinityBuild")
        toolWindow?.activate {
            val chatPanel = InfinityToolWindowFactory.getChatPanel(project)
            chatPanel?.let { panel ->
                panel.inputArea.text = context
                panel.inputArea.requestFocus()
            }
        }
    }

    override fun update(e: AnActionEvent) {
        val project = e.getData(CommonDataKeys.PROJECT)
        val hasFile = e.getData(CommonDataKeys.VIRTUAL_FILE) != null || e.getData(LangDataKeys.PSI_FILE) != null
        e.presentation.isEnabled = project != null && hasFile
        e.presentation.isVisible = project != null
    }
}

/**
 * Action to send multiple selected files to Infinity.
 */
class SendFilesToInfinityAction : AnAction() {

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.getData(CommonDataKeys.PROJECT) ?: return
        val virtualFiles = e.getData(CommonDataKeys.VIRTUAL_FILE_ARRAY)

        if (virtualFiles == null || virtualFiles.isEmpty()) return

        val context = StringBuilder()
        context.append("**Selected files:**\n\n")

        virtualFiles.forEach { file ->
            val content = file.contentsToByteArray().decodeToString()
            context.append("### `${file.path}`\n\n```\n$content\n```\n\n")
        }

        val toolWindowManager = ToolWindowManager.getInstance(project)
        val toolWindow = toolWindowManager.getToolWindow("InfinityBuild")
        toolWindow?.activate {
            val chatPanel = InfinityToolWindowFactory.getChatPanel(project)
            chatPanel?.let { panel ->
                panel.inputArea.text = context.toString()
                panel.inputArea.requestFocus()
            }
        }
    }

    override fun update(e: AnActionEvent) {
        val project = e.getData(CommonDataKeys.PROJECT)
        val virtualFiles = e.getData(CommonDataKeys.VIRTUAL_FILE_ARRAY)
        val hasFiles = virtualFiles != null && virtualFiles.isNotEmpty()
        e.presentation.isEnabled = project != null && hasFiles
        e.presentation.isVisible = project != null
    }
}