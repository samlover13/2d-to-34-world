package com.cartoonaistudio.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import com.cartoonaistudio.app.ui.screens.HomeScreen
import com.cartoonaistudio.app.ui.screens.ProcessingScreen
import com.cartoonaistudio.app.ui.screens.ResultScreen
import com.cartoonaistudio.app.ui.theme.CartoonAIStudioTheme
import com.cartoonaistudio.app.util.VideoUtils
import com.cartoonaistudio.app.viewmodel.ScreenRoute
import com.cartoonaistudio.app.viewmodel.StudioViewModel

class MainActivity : ComponentActivity() {
    private val viewModel: StudioViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setContent {
            val systemDark = isSystemInDarkTheme()
            var isDarkTheme by rememberSaveable { mutableStateOf(systemDark) }
            val uiState by viewModel.uiState.collectAsState()
            val history by viewModel.recentHistory.collectAsState()

            CartoonAIStudioTheme(darkTheme = isDarkTheme) {
                when (uiState.route) {
                    ScreenRoute.HOME -> HomeScreen(
                        selectedVideo = uiState.selectedVideo,
                        selectedStyleId = uiState.selectedStyleId,
                        recentHistory = history,
                        isUploading = uiState.isUploading,
                        errorMessage = uiState.errorMessage,
                        isDarkTheme = isDarkTheme,
                        onToggleTheme = { isDarkTheme = !isDarkTheme },
                        onVideoPicked = viewModel::onVideoSelected,
                        onStyleSelected = viewModel::onStyleSelected,
                        onConvertClick = viewModel::startConversion,
                        onOpenHistoryJob = viewModel::openHistoryJob
                    )

                    ScreenRoute.PROCESSING -> {
                        val activeJob = uiState.activeJob
                        if (activeJob != null) {
                            ProcessingScreen(
                                job = activeJob,
                                onBack = { viewModel.navigateHome(clearSelection = false) },
                                onResume = viewModel::resumeActiveJob
                            )
                        }
                    }

                    ScreenRoute.RESULT -> {
                        val activeJob = uiState.activeJob
                        if (activeJob != null) {
                            ResultScreen(
                                job = activeJob,
                                isDownloading = uiState.isDownloading,
                                statusNotice = uiState.statusNotice,
                                errorMessage = uiState.errorMessage,
                                onDownloadMp4 = { viewModel.downloadAndSaveToGallery(saveToGallery = false) },
                                onSaveToGallery = { viewModel.downloadAndSaveToGallery(saveToGallery = true) },
                                onShareVideo = {
                                    viewModel.shareConvertedVideo { file ->
                                        VideoUtils.shareVideoFile(this@MainActivity, file)
                                    }
                                },
                                onConvertAnother = { viewModel.navigateHome(clearSelection = true) }
                            )
                        }
                    }
                }
            }
        }
    }
}
