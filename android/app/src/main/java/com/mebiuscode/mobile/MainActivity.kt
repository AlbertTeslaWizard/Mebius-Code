package com.mebiuscode.mobile

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
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
        setContent {
            MebiusTheme {
                MebiusApp(viewModel = viewModel)
            }
        }
    }
}
