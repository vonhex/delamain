package com.vonhex.delamain

import androidx.car.app.CarAppService
import androidx.car.app.Session
import androidx.car.app.validation.HostValidator

class DelamainCarAppService : CarAppService() {
    override fun onCreateSession(): Session = DelamainSession()
    override fun createHostValidator(): HostValidator = HostValidator.ALLOW_ALL_HOSTS_VALIDATOR
}
