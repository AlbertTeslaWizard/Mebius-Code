package com.mebiuscode.mobile.data

import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources

class SseClient {
    private val client = OkHttpClient.Builder().build()
    private val factory = EventSources.createFactory(client)

    fun stream(url: String): Flow<SseEvent> = callbackFlow {
        val request = Request.Builder().url(url).build()
        val source = factory.newEventSource(
            request,
            object : EventSourceListener() {
                override fun onOpen(eventSource: EventSource, response: Response) {
                    trySend(SseEvent("connected", JsonObject(emptyMap())))
                }

                override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                    val parsed: JsonElement = runCatching {
                        MebiusJson.json.parseToJsonElement(data)
                    }.getOrElse { JsonPrimitive(data) }
                    trySend(SseEvent(type ?: "message", parsed))
                }

                override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                    val statusCode = response?.code
                    val message = when {
                        statusCode != null && !t?.message.isNullOrBlank() -> "HTTP $statusCode: ${t?.message}"
                        statusCode != null -> "Event stream failed with HTTP $statusCode"
                        !t?.message.isNullOrBlank() -> t?.message ?: "Event stream failed"
                        else -> "Event stream failed"
                    }
                    close(SseStreamException(statusCode, message, t))
                }

                override fun onClosed(eventSource: EventSource) {
                    close()
                }
            },
        )
        awaitClose { source.cancel() }
    }
}

class SseStreamException(
    val statusCode: Int?,
    message: String,
    cause: Throwable? = null,
) : RuntimeException(message, cause)

fun SseEvent.contentDelta(): String? =
    runCatching { data.jsonObject["delta"]?.toString()?.trim('"') }.getOrNull()

fun SseEvent.statusText(): String? =
    runCatching { data.jsonObject["status"]?.toString()?.trim('"') }.getOrNull()
