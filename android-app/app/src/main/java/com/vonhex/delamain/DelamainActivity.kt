package com.vonhex.delamain

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.net.Uri
import android.view.View
import android.webkit.*
import android.widget.Button
import android.widget.LinearLayout
import androidx.appcompat.app.AppCompatActivity
import kotlinx.coroutines.*

class DelamainActivity : AppCompatActivity() {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    private lateinit var webView: WebView
    private lateinit var talkButton: Button
    private lateinit var buttonContainer: LinearLayout
    private var recognizer: SpeechRecognizer? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_delamain)

        webView         = findViewById(R.id.delamainWebView)
        talkButton      = findViewById(R.id.talkButton)
        buttonContainer = findViewById(R.id.buttonContainer)

        webView.settings.apply {
            javaScriptEnabled                = true
            domStorageEnabled                = true
            mediaPlaybackRequiresUserGesture = false   // allow video autoplay
            allowContentAccess               = true
            allowFileAccess                  = true
            mixedContentMode                 = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            userAgentString                  = userAgentString.replace("Mobile", "eliTablet")
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                // Grant microphone + camera to the WebView
                request.grant(request.resources)
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                // Kick all video elements to start (bypass browser autoplay gate)
                webView.evaluateJavascript("""
                    (function() {
                        document.querySelectorAll('video').forEach(function(v) {
                            v.muted = true;
                            v.play().catch(function(){});
                        });
                    })();
                """.trimIndent(), null)
            }

        }

        // Add JavaScript interface so web page can call back to native (future use)
        webView.addJavascriptInterface(DelamainJsBridge(), "DelamainNative")

        webView.loadUrl(Config.BASE_URL)

        talkButton.setOnClickListener { onTalkPressed() }
    }

    private fun onTalkPressed() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            talkButton.text = "MIC UNAVAILABLE"
            return
        }
        talkButton.isEnabled = false
        talkButton.text = "LISTENING..."

        recognizer?.destroy()
        recognizer = SpeechRecognizer.createSpeechRecognizer(this).also { sr ->
            sr.setRecognitionListener(object : RecognitionListener {
                override fun onResults(results: Bundle) {
                    val text = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                    if (!text.isNullOrBlank()) {
                        talkButton.text = "PROCESSING..."
                        // Inject the voice input into the web app's text field and submit
                        val escaped = text.replace("'", "\\'")
                        webView.evaluateJavascript("""
                            (function() {
                                var input = document.querySelector('input[type=text]');
                                if (input) {
                                    var nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                                        window.HTMLInputElement.prototype, 'value').set;
                                    nativeInputValueSetter.call(input, '$escaped');
                                    input.dispatchEvent(new Event('input', { bubbles: true }));
                                    setTimeout(function() {
                                        var btn = document.querySelector('button[disabled=""], button:not([disabled])');
                                        var sendBtn = Array.from(document.querySelectorAll('button')).find(
                                            b => b.querySelector('svg') && !b.disabled
                                        );
                                        if (sendBtn) sendBtn.click();
                                    }, 100);
                                }
                            })();
                        """.trimIndent(), null)
                    }
                    talkButton.isEnabled = true
                    talkButton.text = "TALK TO DELAMAIN"
                    sr.destroy()
                }
                override fun onError(error: Int) {
                    talkButton.isEnabled = true
                    talkButton.text = "TALK TO DELAMAIN"
                    sr.destroy()
                }
                override fun onReadyForSpeech(params: Bundle) {}
                override fun onEndOfSpeech() { talkButton.text = "PROCESSING..." }
                override fun onBeginningOfSpeech() {}
                override fun onRmsChanged(rmsdB: Float) {}
                override fun onBufferReceived(buffer: ByteArray?) {}
                override fun onPartialResults(partialResults: Bundle) {}
                override fun onEvent(eventType: Int, params: Bundle?) {}
            })
            sr.startListening(
                Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                    putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, packageName)
                }
            )
        }
    }

    inner class DelamainJsBridge {
        @JavascriptInterface
        fun onResponse(text: String) {
            // Called from JS when Delamain responds (future hook)
        }

        @JavascriptInterface
        fun setPanelOpen(open: Boolean) {
            runOnUiThread {
                buttonContainer.visibility = if (open) View.GONE else View.VISIBLE
            }
        }

        @JavascriptInterface
        fun navigateToCoords(lat: String, lon: String, label: String) {
            runOnUiThread {
                try {
                    val intent = Intent(Intent.ACTION_VIEW,
                        Uri.parse("google.navigation:q=$lat,$lon")).apply {
                        setPackage("com.google.android.apps.maps")
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    }
                    startActivity(intent)
                } catch (e: Exception) {
                    try {
                        val intent = Intent(Intent.ACTION_VIEW,
                            Uri.parse("geo:$lat,$lon?q=${Uri.encode(label)}")).apply {
                            flags = Intent.FLAG_ACTIVITY_NEW_TASK
                        }
                        startActivity(intent)
                    } catch (_: Exception) {}
                }
            }
        }
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        super.onDestroy()
        scope.cancel()
        recognizer?.destroy()
        webView.destroy()
    }
}
