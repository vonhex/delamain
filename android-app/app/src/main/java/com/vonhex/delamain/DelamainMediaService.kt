package com.vonhex.delamain

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.graphics.BitmapFactory
import android.os.Bundle
import android.support.v4.media.MediaBrowserCompat
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.media.MediaBrowserServiceCompat
import androidx.media.app.NotificationCompat as MediaNotificationCompat

class DelamainMediaService : MediaBrowserServiceCompat() {

    private lateinit var mediaSession: MediaSessionCompat

    companion object {
        private const val CHANNEL_ID   = "delamain_media"
        private const val NOTIF_ID     = 42
        const val ACTION_TALK = "com.vonhex.delamain.ACTION_TALK"
        private const val CUSTOM_TALK  = "DELAMAIN_TALK"
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()

        val sessionIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, DelamainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )

        mediaSession = MediaSessionCompat(this, "Delamain").also { session ->
            session.setSessionActivity(sessionIntent)
            session.setFlags(
                MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS or
                MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
            )
            session.setCallback(object : MediaSessionCompat.Callback() {
                // Mic button tapped in AA strip → wake Activity to handle voice
                override fun onCustomAction(action: String, extras: Bundle?) {
                    if (action == CUSTOM_TALK) broadcastTalk()
                }
                // Tapping the strip title/art → bring Delamain full screen
                override fun onPlay() {
                    startActivity(
                        Intent(this@DelamainMediaService, DelamainActivity::class.java).apply {
                            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
                        }
                    )
                }
            })

            val art = BitmapFactory.decodeResource(resources, R.mipmap.ic_launcher)
            session.setMetadata(
                MediaMetadataCompat.Builder()
                    .putString(MediaMetadataCompat.METADATA_KEY_TITLE,       "Delamain")
                    .putString(MediaMetadataCompat.METADATA_KEY_ARTIST,      "Excelsior Package")
                    .putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART,   art)
                    .putBitmap(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON, art)
                    .build()
            )

            val talkAction = PlaybackStateCompat.CustomAction.Builder(
                CUSTOM_TALK, "Talk", R.drawable.ic_pip_mic
            ).build()

            session.setPlaybackState(
                PlaybackStateCompat.Builder()
                    .setState(PlaybackStateCompat.STATE_PAUSED, 0, 1f)
                    .setActions(PlaybackStateCompat.ACTION_PLAY)
                    .addCustomAction(talkAction)
                    .build()
            )
            session.isActive = true
        }

        sessionToken = mediaSession.sessionToken
        startForeground(NOTIF_ID, buildNotification())
    }

    private fun broadcastTalk() {
        sendBroadcast(Intent(ACTION_TALK).setPackage(packageName))
    }

    private fun buildNotification(): Notification {
        val talkPendingIntent = PendingIntent.getBroadcast(
            this, 0,
            Intent(ACTION_TALK).setPackage(packageName),
            PendingIntent.FLAG_IMMUTABLE
        )
        val openPendingIntent = PendingIntent.getActivity(
            this, 1,
            Intent(this, DelamainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_pip_mic)
            .setContentTitle("Delamain")
            .setContentText("Standing by...")
            .setLargeIcon(BitmapFactory.decodeResource(resources, R.mipmap.ic_launcher))
            .setContentIntent(openPendingIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .addAction(R.drawable.ic_pip_mic, "Talk", talkPendingIntent)
            .setStyle(
                MediaNotificationCompat.MediaStyle()
                    .setMediaSession(mediaSession.sessionToken)
                    .setShowActionsInCompactView(0)
            )
            .setOngoing(true)
            .build()
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID, "Delamain", NotificationManager.IMPORTANCE_LOW
        ).apply { description = "Delamain AI assistant media session" }
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager)
            .createNotificationChannel(channel)
    }

    // Allow all clients to connect — AA, AAOS car media, etc.
    override fun onGetRoot(
        clientPackageName: String,
        clientUid: Int,
        rootHints: Bundle?
    ): BrowserRoot = BrowserRoot("delamain_root", null)

    override fun onLoadChildren(
        parentId: String,
        result: Result<List<MediaBrowserCompat.MediaItem>>
    ) = result.sendResult(emptyList())

    override fun onDestroy() {
        super.onDestroy()
        mediaSession.isActive = false
        mediaSession.release()
    }
}
