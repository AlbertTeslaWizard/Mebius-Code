package com.mebiuscode.mobile

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.SideEffect
import androidx.core.view.WindowCompat
import com.mebiuscode.mobile.data.MebiusRepository
import com.mebiuscode.mobile.data.SessionStore
import com.mebiuscode.mobile.ui.MebiusApp
import com.mebiuscode.mobile.ui.MebiusTheme
import com.mebiuscode.mobile.ui.MebiusViewModel
import com.mebiuscode.mobile.ui.MebiusViewModelFactory

class MainActivity : ComponentActivity() {
    private val viewModel: MebiusViewModel by viewModels {
        MebiusViewModelFactory(MebiusRepository(SessionStore(applicationContext)))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            val dark = isSystemInDarkTheme()
            SideEffect {
                val controller = WindowCompat.getInsetsController(window, window.decorView)
                controller.isAppearanceLightStatusBars = !dark
                controller.isAppearanceLightNavigationBars = !dark
            }
            MebiusTheme {
                MebiusApp(viewModel = viewModel)
            }
        }
    }
}
