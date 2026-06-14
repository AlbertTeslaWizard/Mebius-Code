package com.mebiuscode.mobile.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

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
    secondary = Blue,
    onSecondary = Color.White,
    tertiary = Brass,
    error = Red,
    background = Paper,
    onBackground = Ink,
    surface = Panel,
    onSurface = Ink,
    surfaceVariant = Color(0xFFE7E0D2),
    onSurfaceVariant = Color(0xFF4B524C),
    outline = Color(0xFF9B927F),
)

private val DarkScheme: ColorScheme = darkColorScheme(
    primary = Color(0xFF75C69D),
    onPrimary = Color(0xFF062414),
    secondary = Color(0xFF8BB8DD),
    onSecondary = Color(0xFF0C2233),
    tertiary = Color(0xFFE1BF71),
    error = Color(0xFFFFA0A0),
    background = Color(0xFF101418),
    onBackground = Color(0xFFE9ECE5),
    surface = Color(0xFF171C20),
    onSurface = Color(0xFFE9ECE5),
    surfaceVariant = Color(0xFF243036),
    onSurfaceVariant = Color(0xFFC7CDC5),
    outline = Color(0xFF657078),
)

@Composable
fun MebiusTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkScheme else LightScheme,
        typography = MaterialTheme.typography,
        content = content,
    )
}
