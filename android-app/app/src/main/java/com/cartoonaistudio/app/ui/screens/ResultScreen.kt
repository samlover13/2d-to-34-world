package com.cartoonaistudio.app.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.cartoonaistudio.app.data.ApiClient
import com.cartoonaistudio.app.data.JobStatusDto

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ResultScreen(
    job: JobStatusDto,
    isDownloading: Boolean,
    statusNotice: String?,
    errorMessage: String?,
    onDownloadMp4: () -> Unit,
    onSaveToGallery: () -> Unit,
    onShareVideo: () -> Unit,
    onConvertAnother: () -> Unit
) {
    val context = LocalContext.current
    var sideBySide by remember { mutableStateOf(true) }
    var isPlaying by remember { mutableStateOf(false) }

    val convertedPlayer = remember(job.jobId) {
        ExoPlayer.Builder(context).build().apply {
            setMediaItem(MediaItem.fromUri(ApiClient.convertedVideoStreamUrl(job.jobId)))
            prepare()
        }
    }

    val originalPlayer = remember(job.jobId) {
        ExoPlayer.Builder(context).build().apply {
            setMediaItem(MediaItem.fromUri(ApiClient.originalVideoStreamUrl(job.jobId)))
            volume = 0f // Keep original synced audio on the converted 3D Anime player
            prepare()
        }
    }

    DisposableEffect(convertedPlayer, originalPlayer) {
        onDispose {
            convertedPlayer.release()
            originalPlayer.release()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("3D Anime Result", fontWeight = FontWeight.Bold) }
            )
        }
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                SegmentedButton(
                    selected = sideBySide,
                    onClick = { sideBySide = true },
                    shape = SegmentedButtonDefaults.itemShape(0, 2)
                ) {
                    Text("Side by Side")
                }
                SegmentedButton(
                    selected = !sideBySide,
                    onClick = { sideBySide = false },
                    shape = SegmentedButtonDefaults.itemShape(1, 2)
                ) {
                    Text("3D Anime Only")
                }
            }

            if (sideBySide) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Original 2D", style = MaterialTheme.typography.labelMedium)
                        Spacer(modifier = Modifier.height(4.dp))
                        AndroidView(
                            factory = { ctx ->
                                PlayerView(ctx).apply {
                                    player = originalPlayer
                                    useController = false
                                }
                            },
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(220.dp)
                                .clip(RoundedCornerShape(14.dp))
                        )
                    }
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            "3D Anime",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.primary
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        AndroidView(
                            factory = { ctx ->
                                PlayerView(ctx).apply {
                                    player = convertedPlayer
                                    useController = false
                                }
                            },
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(220.dp)
                                .clip(RoundedCornerShape(14.dp))
                        )
                    }
                }

                Button(
                    onClick = {
                        if (isPlaying) {
                            convertedPlayer.pause()
                            originalPlayer.pause()
                            isPlaying = false
                        } else {
                            originalPlayer.seekTo(convertedPlayer.currentPosition)
                            convertedPlayer.play()
                            originalPlayer.play()
                            isPlaying = true
                        }
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(48.dp),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Icon(
                        if (isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                        contentDescription = null
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(if (isPlaying) "Pause Synced Playback" else "Play Side-by-Side Synced")
                }
            } else {
                AndroidView(
                    factory = { ctx ->
                        PlayerView(ctx).apply {
                            player = convertedPlayer
                            useController = true
                        }
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(280.dp)
                        .clip(RoundedCornerShape(16.dp))
                )
            }

            if (!statusNotice.isNullOrBlank()) {
                Text(
                    text = statusNotice,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary
                )
            }

            if (!errorMessage.isNullOrBlank()) {
                Text(
                    text = errorMessage,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error
                )
            }

            Button(
                onClick = onDownloadMp4,
                enabled = !isDownloading,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(50.dp),
                shape = RoundedCornerShape(14.dp)
            ) {
                Icon(Icons.Default.Download, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text(if (isDownloading) "Downloading MP4..." else "Download MP4")
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                OutlinedButton(
                    onClick = onSaveToGallery,
                    enabled = !isDownloading,
                    modifier = Modifier
                        .weight(1f)
                        .height(48.dp),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Icon(Icons.Default.PhotoLibrary, contentDescription = null)
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Save to Gallery")
                }

                OutlinedButton(
                    onClick = onShareVideo,
                    enabled = !isDownloading,
                    modifier = Modifier
                        .weight(1f)
                        .height(48.dp),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Icon(Icons.Default.Share, contentDescription = null)
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Share Video")
                }
            }

            FilledTonalButton(
                onClick = onConvertAnother,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
                shape = RoundedCornerShape(12.dp)
            ) {
                Icon(Icons.Default.Refresh, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text("Convert Another Video")
            }
        }
    }
}
