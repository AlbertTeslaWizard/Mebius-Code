package com.mebiuscode.mobile.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class SessionStore(context: Context) {
    private val preferences = EncryptedSharedPreferences.create(
        context,
        "mebius_mobile_session",
        MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun read(): StoredSession? {
        val api = preferences.getString(KEY_API, null) ?: return null
        val token = preferences.getString(KEY_TOKEN, null) ?: return null
        val userName = preferences.getString(KEY_USER_NAME, "") ?: ""
        return StoredSession(api, token, userName)
    }

    fun save(session: StoredSession) {
        preferences.edit()
            .putString(KEY_API, normalizeApiBaseUrl(session.apiBaseUrl))
            .putString(KEY_TOKEN, session.accessToken)
            .putString(KEY_USER_NAME, session.userName)
            .apply()
    }

    fun clear() {
        preferences.edit().clear().apply()
    }

    private companion object {
        const val KEY_API = "api"
        const val KEY_TOKEN = "token"
        const val KEY_USER_NAME = "user_name"
    }
}
