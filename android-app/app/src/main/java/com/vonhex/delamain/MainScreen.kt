package com.vonhex.delamain

import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.content.Intent
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.*
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import kotlinx.coroutines.*

class MainScreen(carContext: CarContext) : Screen(carContext), DefaultLifecycleObserver {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var recognizer: SpeechRecognizer? = null

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
        recognizer?.destroy()
        recognizer = null
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

        if (!SpeechRecognizer.isRecognitionAvailable(carContext)) {
            statusLine = "Speech recognition unavailable"
            invalidate()
            return
        }

        isListening = true
        statusLine = "Listening..."
        invalidate()

        recognizer?.destroy()
        recognizer = SpeechRecognizer.createSpeechRecognizer(carContext).also { sr ->
            sr.setRecognitionListener(object : RecognitionListener {
                override fun onResults(results: Bundle) {
                    val text = results
                        .getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        ?.firstOrNull()
                    if (!text.isNullOrBlank()) {
                        statusLine = "Delamain Online"
                        WebSocketManager.sendTalk(text)
                    } else {
                        isListening = false
                        statusLine = "Delamain Online"
                        invalidate()
                    }
                    sr.destroy()
                }
                override fun onError(error: Int) {
                    isListening = false
                    statusLine = "Delamain Online"
                    invalidate()
                    sr.destroy()
                }
                override fun onReadyForSpeech(params: Bundle) {
                    statusLine = "Listening..."
                    invalidate()
                }
                override fun onBeginningOfSpeech() {}
                override fun onRmsChanged(rmsdB: Float) {}
                override fun onBufferReceived(buffer: ByteArray?) {}
                override fun onEndOfSpeech() {
                    statusLine = "Processing..."
                    invalidate()
                }
                override fun onPartialResults(partialResults: Bundle) {}
                override fun onEvent(eventType: Int, params: Bundle?) {}
            })

            sr.startListening(
                Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                    putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, carContext.packageName)
                }
            )
        }
    }
}
