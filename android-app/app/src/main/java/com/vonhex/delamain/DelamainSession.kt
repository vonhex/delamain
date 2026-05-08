package com.vonhex.delamain

import android.content.Intent
import androidx.car.app.Screen
import androidx.car.app.Session

class DelamainSession : Session() {
    override fun onCreateScreen(intent: Intent): Screen = MainScreen(carContext)
}
