package com.vonhex.delamain

import androidx.car.app.CarAppService
import androidx.car.app.validation.HostValidator

class DelamainCarAppService : CarAppService() {
    override fun createSession() = DelamainSession()
    override fun onCreateHostValidator() = HostValidator.ALLOW_ALL_HOSTS_VALIDATOR
}
