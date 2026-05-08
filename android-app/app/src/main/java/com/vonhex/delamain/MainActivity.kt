package com.vonhex.delamain

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        findViewById<Button>(R.id.btnOpenAA).setOnClickListener {
            val launched = listOf(
                "com.google.android.projection.gearhead.app.NavContextActivity",
                "com.google.android.apps.auto.components.home.HomeActivity",
                "com.google.android.projection.gearhead.app.GearheadActivity",
            ).any { cls ->
                try {
                    startActivity(Intent().apply {
                        setClassName("com.google.android.projection.gearhead", cls)
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    })
                    true
                } catch (_: Exception) { false }
            }
            if (!launched) {
                startActivity(Intent(Intent.ACTION_MAIN).apply {
                    setPackage("com.google.android.projection.gearhead")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                })
            }
        }
    }
}
