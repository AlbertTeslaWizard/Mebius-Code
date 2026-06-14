package com.mebiuscode.mobile.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

private val Ink = Color(0xFF101418)
private val Paper = Color(0xFFF4F0E8)
private val Panel = Color(0xFFFFFBF3)
private val Green = Color(0xFF2F7D58)
private val Red = Color(0xFFB23B3B)
private val Blue = Color(0xFF2E5F8A)
private val Brass = Color(0xFFB58A3B)

private val LightScheme: ColorScheme = lightColorScheme(
    primary = Green,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFCDEBD9),
    onPrimaryContainer = Color(0xFF0C3D26),
    secondary = Blue,
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFCFE0F0),
    onSecondaryContainer = Color(0xFF11324C),
    tertiary = Brass,
    onTertiary = Color.White,
    error = Red,
    errorContainer = Color(0xFFF6D7D2),
    onErrorContainer = Color(0xFF5C1A1A),
    background = Paper,
    onBackground = Ink,
    surface = Panel,
    onSurface = Ink,
    surfaceVariant = Color(0xFFE7E0D2),
    onSurfaceVariant = Color(0xFF4B524C),
    surfaceContainerHighest = Color(0xFFEDE6D8),
    outline = Color(0xFF9B927F),
    outlineVariant = Color(0xFFD8CFBE),
)

private val DarkScheme: ColorScheme = darkColorScheme(
    primary = Color(0xFF75C69D),
    onPrimary = Color(0xFF062414),
    primaryContainer = Color(0xFF1C4633),
    onPrimaryContainer = Color(0xFFB8EBCE),
    secondary = Color(0xFF8BB8DD),
    onSecondary = Color(0xFF0C2233),
    secondaryContainer = Color(0xFF1E3A52),
    onSecondaryContainer = Color(0xFFCBE2F6),
    tertiary = Color(0xFFE1BF71),
    onTertiary = Color(0xFF3A2D08),
    error = Color(0xFFFFA0A0),
    errorContainer = Color(0xFF5C2424),
    onErrorContainer = Color(0xFFFFD6D2),
    background = Color(0xFF101418),
    onBackground = Color(0xFFE9ECE5),
    surface = Color(0xFF171C20),
    onSurface = Color(0xFFE9ECE5),
    surfaceVariant = Color(0xFF243036),
    onSurfaceVariant = Color(0xFFC7CDC5),
    surfaceContainerHighest = Color(0xFF222A30),
    outline = Color(0xFF657078),
    outlineVariant = Color(0xFF333E45),
)

private val MebiusTypography: Typography = Typography().run {
    copy(
        headlineMedium = headlineMedium.copy(fontWeight = FontWeight.Bold, letterSpacing = (-0.5).sp),
        titleLarge = titleLarge.copy(fontWeight = FontWeight.Bold, letterSpacing = (-0.3).sp),
        titleMedium = titleMedium.copy(fontWeight = FontWeight.SemiBold),
        labelLarge = labelLarge.copy(fontWeight = FontWeight.SemiBold),
    )
}

/** Semantic colors for a status-like label, resolved against the active scheme. */
data class StatusColors(val container: Color, val content: Color, val accent: Color)

@Composable
fun statusColorsFor(label: String): StatusColors {
    val scheme = MaterialTheme.colorScheme
    val key = label.lowercase()
    return when {
        key.contains("wait") || key.contains("pending") || key.contains("connect") ||
            key.contains("queue") || key.contains("draft") || key.contains("review") ->
            StatusColors(scheme.tertiary.copy(alpha = 0.18f), scheme.tertiary, scheme.tertiary)

        key.contains("active") || key.contains("running") || key.contains("stream") ||
            key.contains("connected") || key.contains("working") || key.contains("build") ->
            StatusColors(scheme.primaryContainer, scheme.onPrimaryContainer, scheme.primary)

        key.contains("approv") || key.contains("complete") || key.contains("done") ||
            key.contains("ready") || key.contains("success") || key.contains("finish") ->
            StatusColors(scheme.secondaryContainer, scheme.onSecondaryContainer, scheme.secondary)

        key.contains("cancel") || key.contains("reject") || key.contains("fail") ||
            key.contains("error") || key.contains("denied") ->
            StatusColors(scheme.errorContainer, scheme.onErrorContainer, scheme.error)

        else ->
            StatusColors(scheme.surfaceVariant, scheme.onSurfaceVariant, scheme.outline)
    }
}

@Composable
fun MebiusTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkScheme else LightScheme,
        typography = MebiusTypography,
        content = content,
    )
}
