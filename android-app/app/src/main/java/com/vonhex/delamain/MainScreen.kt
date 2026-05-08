package com.vonhex.delamain

import android.content.Intent
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.*
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import kotlinx.coroutines.*

class MainScreen(carContext: CarContext) : Screen(carContext), DefaultLifecycleObserver {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    private var statusLine = "Connecting to Delamain..."
    private var responseText = ""
    private var isListening = false

    init {
        lifecycle.addObserver(this)
    }

    override fun onStart(owner: LifecycleOwner) {
        WebSocketManager.connect()
        scope.launch {
            WebSocketManager.events.collect { event ->
                when (event) {
                    is WsEvent.Connected -> {
                        statusLine = "Delamain Online"
                        invalidate()
                    }
                    is WsEvent.Greeting -> {
                        statusLine = "Delamain Online"
                        responseText = event.text
                        event.audioUrl?.let { AudioPlayer.play(it) }
                        invalidate()
                    }
                    is WsEvent.Response -> {
                        isListening = false
                        responseText = event.text
                        event.audioUrl?.let { AudioPlayer.play(it) { invalidate() } }
                        invalidate()
                    }
                    WsEvent.Disconnected -> {
                        statusLine = "Offline — retrying..."
                        responseText = ""
                        invalidate()
                        delay(5_000)
                        WebSocketManager.connect()
                    }
                }
            }
        }
    }

    override fun onStop(owner: LifecycleOwner) {
        scope.cancel()
        AudioPlayer.stop()
        WebSocketManager.disconnect()
    }

    override fun onGetTemplate(): Template {
        val talkAction = Action.Builder()
            .setTitle(if (isListening) "Listening..." else "Talk to Delamain")
            .setOnClickListener(::onTalkPressed)
            .build()

        val row = Row.Builder()
            .setTitle(statusLine)
            .apply { if (responseText.isNotBlank()) addText(responseText) }
            .build()

        val pane = Pane.Builder()
            .addRow(row)
            .addAction(talkAction)
            .build()

        return PaneTemplate.Builder(pane)
            .setHeaderAction(Action.APP_ICON)
            .build()
    }

    private fun onTalkPressed() {
        if (isListening) return
        isListening = true
        invalidate()
        carContext.startActivity(
            Intent(carContext, VoiceActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }
}
