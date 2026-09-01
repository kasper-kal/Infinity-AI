package com.infinity.build.api

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.Task
import com.infinity.build.settings.InfinitySettingsState
import io.ktor.client.*
import io.ktor.client.call.*
import io.ktor.client.engine.cio.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.plugins.logging.*
import io.ktor.client.plugins.websocket.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.*
import kotlinx.serialization.*
import kotlinx.serialization.json.*
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * Infinity API Client - Handles REST and WebSocket communication with Infinity backend.
 */
class InfinityApiClient {

    private val logger = Logger.getInstance(InfinityApiClient::class.java)
    private val clientRef = AtomicReference<HttpClient?>(null)
    private val webSocketSessionRef = AtomicReference<WebSocketSession?>(null)
    private val isConnected = AtomicBoolean(false)
    private val reconnectJob = AtomicReference<Job?>(null)
    private val messageHandlers = ConcurrentHashMap<String, MutableList<(String) -> Unit>>()
    private val pendingRequests = ConcurrentHashMap<String, CompletableDeferred<HttpResponse>>()
    private var requestIdCounter = 0L

    // Configuration
    private var baseUrl: String = "http://localhost:8080"
    private var apiKey: String = ""
    private var projectId: String = ""
    private var wsReconnectAttempts = 5
    private var wsReconnectDelay = 2000L
    private var wsHeartbeatInterval = 30000L
    private var requestTimeout = 60000

    /**
     * Configure the API client with settings.
     */
    fun configure(
        baseUrl: String,
        apiKey: String,
        projectId: String,
        wsReconnectAttempts: Int = 5,
        wsReconnectDelay: Long = 2000L,
        wsHeartbeatInterval: Long = 30000L,
        requestTimeout: Int = 60000
    ) {
        this.baseUrl = baseUrl.removeTrailingSlash()
        this.apiKey = apiKey
        this.projectId = projectId
        this.wsReconnectAttempts = wsReconnectAttempts
        this.wsReconnectDelay = wsReconnectDelay
        this.wsHeartbeatInterval = wsHeartbeatInterval
        this.requestTimeout = requestTimeout

        // Recreate HTTP client with new config
        createHttpClient()
    }

    private fun createHttpClient() {
        val oldClient = clientRef.getAndSet(null)
        oldClient?.close()

        val client = HttpClient(CIO) {
            install(ContentNegotiation) {
                json(Json {
                    ignoreUnknownKeys = true
                    isLenient = true
                    encodeDefaults = false
                    prettyPrint = false
                })
            }
            install(Logging) {
                logger = object : io.ktor.client.plugins.logging.Logger {
                    override fun log(message: String) {
                        logger.debug(message)
                    }
                }
                level = LogLevel.HEADERS
            }
            expectSuccess = false
            defaultRequest {
                url(baseUrl)
                header(HttpHeaders.Authorization, "Bearer $apiKey")
                header("X-Project-ID", projectId)
                header(HttpHeaders.ContentType, ContentType.Application.Json.toString())
                header(HttpHeaders.Accept, ContentType.Application.Json.toString())
                timeout {
                    connectTimeoutMillis = requestTimeout
                    requestTimeoutMillis = requestTimeout
                    socketTimeoutMillis = requestTimeout
                }
            }
        }

        clientRef.set(client)
        logger.info("HTTP client configured for: $baseUrl")
    }

    /**
     * Test connection to the API.
     */
    suspend fun testConnection(): Boolean {
        return try {
            val client = getClient()
            val response = client.get("$baseUrl/api/infinity-ai/auth/me") {
                timeout {
                    connectTimeoutMillis = 10000
                    requestTimeoutMillis = 10000
                }
            }
            response.status == HttpStatusCode.OK
        } catch (e: Exception) {
            logger.warn("Connection test failed", e)
            false
        }
    }

    private fun getClient(): HttpClient {
        return clientRef.get() ?: throw IllegalStateException("HTTP client not initialized. Call configure() first.")
    }

    // ============ REST API Methods ============

    /**
     * Generic GET request.
     */
    suspend fun <T : Any> get(path: String, type: KClass<T>): T {
        val client = getClient()
        val response = client.get(path)
        return handleResponse(response, type)
    }

    /**
     * Generic POST request with body.
     */
    suspend fun <T : Any, R : Any> post(path: String, body: T, responseType: KClass<R>): R {
        val client = getClient()
        val response = client.post(path) {
            setBody(body)
        }
        return handleResponse(response, responseType)
    }

    /**
     * Generic PUT request with body.
     */
    suspend fun <T : Any, R : Any> put(path: String, body: T, responseType: KClass<R>): R {
        val client = getClient()
        val response = client.put(path) {
            setBody(body)
        }
        return handleResponse(response, responseType)
    }

    /**
     * Generic DELETE request.
     */
    suspend fun delete(path: String): HttpResponse {
        val client = getClient()
        return client.delete(path)
    }

    private fun <T : Any> handleResponse(response: HttpResponse, type: KClass<T>): T {
        if (response.status.isSuccess()) {
            return response.body()
        } else {
            val errorBody = response.bodyAsText()
            throw InfinityApiException(response.status.value, errorBody)
        }
    }

    // ============ Chat API ============

    /**
     * Send chat message and get streaming response.
     */
    suspend fun sendChatMessage(
        message: String,
        conversationId: String?,
        mode: String = "chat",
        useCodebase: Boolean = true,
        onChunk: (String) -> Unit,
        onComplete: (ChatResponse) -> Unit,
        onError: (Throwable) -> Unit
    ) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val client = getClient()
                val request = ChatRequest(
                    message = message,
                    conversationId = conversationId,
                    mode = mode,
                    useCodebase = useCodebase,
                    projectId = projectId
                )

                client.webSocket(
                    method = HttpMethod.Get,
                    path = "/api/infinity-ai/chat/stream",
                    headers = buildAuthHeaders()
                ) { session ->
                    webSocketSessionRef.set(session)
                    isConnected.set(true)

                    // Send request
                    session.send(Frame.Text(Json.encodeToString(request)))

                    // Listen for messages
                    session.incoming.consumeEach { frame ->
                        when (frame) {
                            is Frame.Text -> {
                                handleWebSocketMessage(frame.readText(), onChunk, onComplete, onError)
                            }
                            is Frame.Binary -> {
                                logger.warn("Received binary frame, ignoring")
                            }
                            is Frame.Close -> {
                                isConnected.set(false)
                                logger.debug("WebSocket closed: ${frame.reason}")
                            }
                            is Frame.Pong -> {
                                // Heartbeat response
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                logger.error("Chat WebSocket error", e)
                onError(e)
            }
        }
    }

    /**
     * Non-streaming chat completion.
     */
    suspend fun completeChat(request: ChatRequest): ChatResponse {
        return post("/api/infinity-ai/chat/complete", request, ChatResponse::class)
    }

    /**
     * Get conversation history.
     */
    suspend fun getConversations(): List<Conversation> {
        return get("/api/infinity-ai/conversations", ConversationList::class).conversations
    }

    /**
     * Get conversation messages.
     */
    suspend fun getConversationMessages(conversationId: String): List<Message> {
        return get("/api/infinity-ai/conversations/$conversationId/messages", MessageList::class).messages
    }

    /**
     * Create new conversation.
     */
    suspend fun createConversation(title: String): Conversation {
        return post("/api/infinity-ai/conversations", mapOf("title" to title), Conversation::class)
    }

    // ============ Build API ============

    /**
     * Start a build.
     */
    suspend fun startBuild(request: BuildRequest): BuildResponse {
        return post("/api/infinity/build/start", request, BuildResponse::class)
    }

    /**
     * Get build status.
     */
    suspend fun getBuildStatus(buildId: String): BuildStatus {
        return get("/api/infinity/build/$buildId/status", BuildStatus::class)
    }

    /**
     * Execute build plan step.
     */
    suspend fun executeBuildStep(buildId: String, stepId: String): BuildStepResult {
        return post("/api/infinity/build/$buildId/step/$stepId/execute", mapOf(), BuildStepResult::class)
    }

    /**
     * Iterate on build.
     */
    suspend fun iterateBuild(buildId: String, feedback: String): BuildResponse {
        return post("/api/infinity/build/$buildId/iterate", mapOf("feedback" to feedback), BuildResponse::class
    }

    // ============ Codebase Index API ============

    /**
     * Trigger codebase indexing.
     */
    suspend fun triggerIndexing(): IndexingResponse {
        return post("/api/infinity/codebase/index", mapOf("projectId" to projectId), IndexingResponse::class)
    }

    /**
     * Get indexing status.
     */
    suspend fun getIndexingStatus(): IndexingStatus {
        return get("/api/infinity/codebase/index/status", IndexingStatus::class)
    }

    /**
     * Search codebase.
     */
    suspend fun searchCodebase(query: String, limit: Int = 20): CodebaseSearchResult {
        return post("/api/infinity/codebase/search", mapOf("query" to query, "limit" to limit), CodebaseSearchResult::class)
    }

    // ============ Composer API ============

    /**
     * Create composer plan.
     */
    suspend fun createComposerPlan(request: ComposerRequest): ComposerPlan {
        return post("/api/infinity/composer/plan", request, ComposerPlan::class)
    }

    /**
     * Apply composer plan.
     */
    suspend fun applyComposerPlan(planId: String, files: List<String> = emptyList()): ComposerApplyResult {
        return post("/api/infinity/composer/$planId/apply", mapOf("files" to files), ComposerApplyResult::class)
    }

    // ============ Agent API ============

    /**
     * Start agent task.
     */
    suspend fun startAgentTask(request: AgentRequest): AgentTask {
        return post("/api/infinity/agent/start", request, AgentTask::class)
    }

    /**
     * Get agent task status.
     */
    suspend fun getAgentTaskStatus(taskId: String): AgentTaskStatus {
        return get("/api/infinity/agent/$taskId/status", AgentTaskStatus::class)
    }

    /**
     * Stop agent task.
     */
    suspend fun stopAgentTask(taskId: String): Unit {
        delete("/api/infinity/agent/$taskId/stop")
    }

    // ============ Terminal Bridge API ============

    /**
     * Connect to terminal bridge WebSocket.
     */
    fun connectTerminalBridge(
        sessionId: String,
        onOutput: (String) -> Unit,
        onError: (Throwable) -> Unit,
        onClose: () -> Unit
    ) {
        val settings = InfinitySettingsState.getInstance()
        val bridgeUrl = settings.terminalBridgeUrl
        val secret = settings.terminalBridgeSecret

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val client = HttpClient(CIO) {
                    install(WebSockets)
                }

                client.webSocket(
                    url = "$bridgeUrl?session=$sessionId&secret=$secret",
                    headers = Headers.build {
                        append("Origin", "jetbrains-plugin")
                    }
                ) { session ->
                    session.incoming.consumeEach { frame ->
                        when (frame) {
                            is Frame.Text -> onOutput(frame.readText())
                            is Frame.Close -> onClose()
                        }
                    }
                }
            } catch (e: Exception) {
                onError(e)
            }
        }
    }

    /**
     * Send terminal input.
     */
    fun sendTerminalInput(sessionId: String, input: String) {
        // Implementation depends on terminal bridge protocol
    }

    // ============ WebSocket Management ============

    /**
     * Connect to main WebSocket for real-time events.
     */
    fun connectWebSocket(
        onMessage: (WebSocketEvent) -> Unit,
        onError: (Throwable) -> Unit,
        onClose: () -> Unit
    ) {
        reconnectJob.get()?.cancel()

        val job = CoroutineScope(Dispatchers.IO).launch {
            var attempts = 0
            while (attempts < wsReconnectAttempts && !isConnected.get()) {
                try {
                    connectWebSocketInternal(onMessage, onError, onClose)
                    return@launch
                } catch (e: Exception) {
                    attempts++
                    logger.warn("WebSocket connection attempt $attempts failed", e)
                    if (attempts < wsReconnectAttempts) {
                        delay(wsReconnectDelay * attempts)
                    }
                }
            }
            logger.error("Failed to connect WebSocket after $wsReconnectAttempts attempts")
        }

        reconnectJob.set(job)
    }

    private suspend fun connectWebSocketInternal(
        onMessage: (WebSocketEvent) -> Unit,
        onError: (Throwable) -> Unit,
        onClose: () -> Unit
    ) {
        val client = HttpClient(CIO) {
            install(WebSockets)
        }

        val wsUrl = baseUrl.replace("http", "ws") + "/api/infinity-ai/ws?projectId=$projectId"

        client.webSocket(
            url = wsUrl,
            headers = buildAuthHeaders()
        ) { session ->
            webSocketSessionRef.set(session)
            isConnected.set(true)

            // Heartbeat
            val heartbeatJob = launch {
                while (isConnected.get()) {
                    delay(wsHeartbeatInterval)
                    if (isConnected.get()) {
                        try {
                            session.send(Frame.Ping)
                        } catch (e: Exception) {
                            logger.debug("Heartbeat failed", e)
                            break
                        }
                    }
                }
            }

            session.incoming.consumeEach { frame ->
                when (frame) {
                    is Frame.Text -> {
                        try {
                            val event = Json.decodeFromString<WebSocketEvent>(frame.readText())
                            onMessage(event)
                        } catch (e: Exception) {
                            logger.warn("Failed to parse WebSocket message", e)
                        }
                    }
                    is Frame.Close -> {
                        heartbeatJob.cancel()
                        isConnected.set(false)
                        onClose()
                    }
                    is Frame.Pong -> {
                        // Heartbeat response
                    }
                }
            }
        }
    }

    /**
     * Send message over WebSocket.
     */
    fun sendWebSocketMessage(message: Any) {
        val session = webSocketSessionRef.get()
        if (session != null && isConnected.get()) {
            session.send(Frame.Text(Json.encodeToString(message)))
        }
    }

    /**
     * Register handler for specific event type.
     */
    fun registerEventHandler(eventType: String, handler: (String) -> Unit) {
        messageHandlers.computeIfAbsent(eventType) { mutableListOf() }.add(handler)
    }

    /**
     * Unregister handler.
     */
    fun unregisterEventHandler(eventType: String, handler: (String) -> Unit) {
        messageHandlers[eventType]?.remove(handler)
    }

    private fun handleWebSocketMessage(
        text: String,
        onChunk: (String) -> Unit,
        onComplete: (ChatResponse) -> Unit,
        onError: (Throwable) -> Unit
    ) {
        try {
            val json = Json.parseToJsonElement(text)
            val obj = json.jsonObject

            val type = obj["type"]?.jsonPrimitive?.content ?: ""

            when (type) {
                "chunk" -> {
                    val content = obj["content"]?.jsonPrimitive?.content ?: ""
                    onChunk(content)
                }
                "complete" -> {
                    val response = Json.decodeFromString<ChatResponse>(text)
                    onComplete(response)
                }
                "error" -> {
                    val errorMsg = obj["error"]?.jsonPrimitive?.content ?: "Unknown error"
                    onError(Exception(errorMsg))
                }
                else -> {
                    // Dispatch to registered handlers
                    messageHandlers[type]?.forEach { handler ->
                        try {
                            handler(text)
                        } catch (e: Exception) {
                            logger.warn("Event handler error for $type", e)
                        }
                    }
                }
            }
        } catch (e: Exception) {
            logger.warn("Failed to handle WebSocket message", e)
        }
    }

    private fun buildAuthHeaders(): Headers {
        return Headers.build {
            append(HttpHeaders.Authorization, "Bearer $apiKey")
            append("X-Project-ID", projectId)
        }
    }

    /**
     * Disconnect and cleanup.
     */
    fun disconnect() {
        reconnectJob.get()?.cancel()
        webSocketSessionRef.get()?.close(CloseReason(CloseReason.Codes.NORMAL, "Client disconnect"))
        isConnected.set(false)
        logger.info("Disconnected from Infinity API")
    }

    /**
     * Shutdown client.
     */
    fun shutdown() {
        disconnect()
        clientRef.get()?.close()
        logger.info("API client shutdown complete")
    }

    val isConnectedNow: Boolean
        get() = isConnected.get()
}

// ============ Data Classes ============

@Serializable
data class ChatRequest(
    val message: String,
    val conversationId: String?,
    val mode: String,
    val useCodebase: Boolean,
    val projectId: String
)

@Serializable
data class ChatResponse(
    val id: String,
    val conversationId: String,
    val content: String,
    val model: String,
    val usage: Usage?,
    val metadata: Map<String, Any>?
)

@Serializable
data class Usage(
    val promptTokens: Int,
    val completionTokens: Int,
    val totalTokens: Int
)

@Serializable
data class Conversation(
    val id: String,
    val title: String,
    val createdAt: String,
    val updatedAt: String,
    val messageCount: Int
)

@Serializable
data class ConversationList(
    val conversations: List<Conversation>
)

@Serializable
data class Message(
    val id: String,
    val role: String,
    val content: String,
    val timestamp: String,
    val metadata: Map<String, Any>?
)

@Serializable
data class MessageList(
    val messages: List<Message>
)

// Build types
@Serializable
data class BuildRequest(
    val goal: String,
    val projectId: String,
    val context: Map<String, Any>? = null,
    val options: BuildOptions? = null
)

@Serializable
data class BuildOptions(
    val maxIterations: Int = 10,
    val enableVerification: Boolean = true,
    val parallelAgents: Int = 1
)

@Serializable
data class BuildResponse(
    val buildId: String,
    val status: String,
    val plan: BuildPlan?
)

@Serializable
data class BuildPlan(
    val steps: List<BuildStep>
)

@Serializable
data class BuildStep(
    val id: String,
    val description: String,
    val type: String,
    val status: String,
    val files: List<String>
)

@Serializable
data class BuildStatus(
    val buildId: String,
    val status: String,
    val progress: Double,
    val currentStep: String?,
    val steps: List<BuildStep>,
    val logs: List<String>
)

@Serializable
data class BuildStepResult(
    val success: Boolean,
    val output: String,
    val diff: String?,
    val filesChanged: List<String>
)

// Codebase Index types
@Serializable
data class IndexingResponse(
    val jobId: String,
    val status: String
)

@Serializable
data class IndexingStatus(
    val status: String,
    val progress: Double,
    val filesIndexed: Int,
    val totalFiles: Int,
    val startedAt: String?,
    val completedAt: String?
)

@Serializable
data class CodebaseSearchResult(
    val results: List<CodebaseSearchItem>
)

@Serializable
data class CodebaseSearchItem(
    val file: String,
    val line: Int,
    val symbol: String,
    val snippet: String,
    val score: Double,
    val type: String
)

// Composer types
@Serializable
data class ComposerRequest(
    val goal: String,
    val contextFiles: List<String> = emptyList(),
    val constraints: List<String> = emptyList()
)

@Serializable
data class ComposerPlan(
    val planId: String,
    val steps: List<ComposerStep>,
    val estimatedFiles: Int
)

@Serializable
data class ComposerStep(
    val id: String,
    val file: String,
    val action: String, // create, edit, delete
    val description: String,
    val diff: String?
)

@Serializable
data class ComposerApplyResult(
    val success: Boolean,
    val appliedFiles: List<String>,
    val errors: List<String>
)

// Agent types
@Serializable
data class AgentRequest(
    val goal: String,
    val mode: String = "autonomous", // autonomous, guided
    val maxSteps: Int = 50,
    val allowedTools: List<String> = emptyList()
)

@Serializable
data class AgentTask(
    val taskId: String,
    val status: String,
    val createdAt: String
)

@Serializable
data class AgentTaskStatus(
    val taskId: String,
    val status: String,
    val progress: Double,
    val currentStep: String?,
    val stepsCompleted: Int,
    val totalSteps: Int,
    val logs: List<String>
)

// WebSocket Event
@Serializable
sealed class WebSocketEvent {
    @Serializable
    data class ChatChunk(
        val conversationId: String,
        val content: String,
        val metadata: Map<String, Any>?
    ) : WebSocketEvent()

    @Serializable
    data class BuildProgress(
        val buildId: String,
        val progress: Double,
        val step: String,
        val message: String
    ) : WebSocketEvent()

    @Serializable
    data class AgentProgress(
        val taskId: String,
        val progress: Double,
        val step: String,
        val message: String
    ) : WebSocketEvent()

    @Serializable
    data class IndexProgress(
        val progress: Double,
        val filesIndexed: Int,
        val currentFile: String?
    ) : WebSocketEvent()

    @Serializable
    data class Notification(
        val title: String,
        val message: String,
        val level: String
    ) : WebSocketEvent()

    @Serializable
    data class Error(
        val code: String,
        val message: String
    ) : WebSocketEvent()
}

// Exception
class InfinityApiException(
    val statusCode: Int,
    val message: String
) : Exception("API Error $statusCode: $message")

// Extension
private fun String.removeTrailingSlash(): String {
    return if (endsWith("/")) substring(0, length - 1) else this
}