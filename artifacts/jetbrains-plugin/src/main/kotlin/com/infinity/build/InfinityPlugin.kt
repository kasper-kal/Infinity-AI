package com.infinity.build

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.project.ProjectManagerListener
import com.intellij.openapi.startup.StartupManager
import com.infinity.build.api.InfinityApiClient
import com.infinity.build.settings.InfinitySettingsState
import com.infinity.build.ui.InfinityToolWindowFactory
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Main plugin class for Infinity Build JetBrains Plugin.
 *
 * This plugin provides AI-powered development features for JetBrains IDEs:
 * - Chat sidebar with @codebase context
 * - Composer for multi-file task planning
 * - Agent for autonomous coding
 * - Tool window with tabbed interface
 * - Settings configuration
 * - Keybindings for quick access
 */
@Service(Service.Level.APP)
final class InfinityPlugin : ProjectManagerListener {

    private val logger = Logger.getInstance(InfinityPlugin::class.java)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val apiClient = InfinityApiClient()

    companion object {
        private var instance: InfinityPlugin? = null

        fun getInstance(): InfinityPlugin {
            return instance ?: throw IllegalStateException("InfinityPlugin not initialized")
        }
    }

    init {
        instance = this
        logger.info("Infinity Build Plugin initialized")
    }

    override fun projectOpened(project: Project) {
        logger.info("Project opened: ${project.name}")
        initializeProject(project)
    }

    override fun projectClosed(project: Project) {
        logger.info("Project closed: ${project.name}")
        cleanupProject(project)
    }

    private fun initializeProject(project: Project) {
        scope.launch {
            try {
                // Initialize API client with project settings
                val settings = InfinitySettingsState.getInstance()
                if (settings.isConfigured) {
                    apiClient.configure(
                        baseUrl = settings.apiBaseUrl,
                        apiKey = settings.apiKey,
                        projectId = settings.projectId
                    )

                    // Test connection
                    val connected = apiClient.testConnection()
                    if (connected) {
                        logger.info("Successfully connected to Infinity API for project: ${project.name}")
                    } else {
                        logger.warn("Failed to connect to Infinity API for project: ${project.name}")
                    }
                }
            } catch (e: Exception) {
                logger.error("Error initializing project: ${project.name}", e)
            }
        }
    }

    private fun cleanupProject(project: Project) {
        // Cleanup any project-specific resources
        scope.launch {
            apiClient.disconnect()
        }
    }

    fun getApiClient(): InfinityApiClient = apiClient

    fun getCoroutineScope(): CoroutineScope = scope

    fun shutdown() {
        logger.info("Shutting down Infinity Build Plugin")
        scope.coroutineContext.cancelChildren()
        apiClient.shutdown()
        instance = null
    }

    // Startup initialization
    fun registerPostStartupActivity(project: Project) {
        StartupManager.getInstance(project).runWhenProjectIsInitialized {
            // Refresh tool window if needed
            InfinityToolWindowFactory.refreshToolWindow(project)
        }
    }
}

/**
 * Application-level service for plugin lifecycle management.
 */
@Service(Service.Level.APP)
class PluginLifecycleService {

    private val logger = Logger.getInstance(PluginLifecycleService::class.java)
    private val plugin = InfinityPlugin.getInstance()

    init {
        logger.info("PluginLifecycleService initialized")
    }

    fun onPluginUnload() {
        logger.info("Plugin unloading...")
        plugin.shutdown()
    }
}