package com.vonhex.delamain

import android.media.AudioAttributes
import android.media.MediaPlayer
import android.util.Log

object AudioPlayer {
    private const val TAG = "AudioPlayer"
    private var mediaPlayer: MediaPlayer? = null

    fun play(audioPath: String, onComplete: (() -> Unit)? = null) {
        stop()
        val url = if (audioPath.startsWith("http")) audioPath else "${Config.BASE_URL}$audioPath"

        mediaPlayer = MediaPlayer().apply {
            setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            )
            runCatching {
                setDataSource(url)
                prepareAsync()
                setOnPreparedListener { start() }
                setOnCompletionListener {
                    onComplete?.invoke()
                    release()
                    mediaPlayer = null
                }
                setOnErrorListener { _, what, extra ->
                    Log.e(TAG, "MediaPlayer error: what=$what extra=$extra")
                    release()
                    mediaPlayer = null
                    true
                }
            }.onFailure {
                Log.e(TAG, "Failed to set data source: $url", it)
                release()
                mediaPlayer = null
            }
        }
    }

    fun stop() {
        mediaPlayer?.apply {
            runCatching { if (isPlaying) stop() }
            release()
        }
        mediaPlayer = null
    }
}
