package com.vonhex.delamain

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import okhttp3.*
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

sealed class WsEvent {
    data class Greeting(val text: String, val audioUrl: String?) : WsEvent()
    data class Response(val text: String, val audioUrl: String?) : WsEvent()
    object Connected : WsEvent()
    object Disconnected : WsEvent()
}

object WebSocketManager {
    private val client = OkHttpClient.Builder()
        .pingInterval(30, TimeUnit.SECONDS)
        .build()

    private val clientId = "android-auto-${UUID.randomUUID()}"
    private var webSocket: WebSocket? = null

    private val _events = MutableSharedFlow<WsEvent>(extraBufferCapacity = 16)
    val events: SharedFlow<WsEvent> = _events

    fun connect() {
        val request = Request.Builder()
            .url("${Config.WS_URL}/ws/$clientId")
            .build()

        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                _events.tryEmit(WsEvent.Connected)
            }

            override fun onMessage(ws: WebSocket, text: String) {
                runCatching {
                    val msg = JSONObject(text)
                    val audioUrl = msg.optString("audio_url").takeIf { it.isNotBlank() }
                    when (msg.getString("type")) {
                        "greeting" -> _events.tryEmit(WsEvent.Greeting(msg.getString("text"), audioUrl))
                        "response" -> _events.tryEmit(WsEvent.Response(msg.getString("text"), audioUrl))
                    }
                }
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                _events.tryEmit(WsEvent.Disconnected)
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                _events.tryEmit(WsEvent.Disconnected)
            }
        })
    }

    fun sendTalk(text: String) {
        webSocket?.send(
            JSONObject()
                .put("type", "talk")
                .put("text", text)
                .put("user_name", "passenger")
                .toString()
        )
    }

    fun disconnect() {
        webSocket?.close(1000, "App closed")
        webSocket = null
    }
}
