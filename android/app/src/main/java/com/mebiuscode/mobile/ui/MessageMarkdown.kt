package com.mebiuscode.mobile.ui

import android.annotation.SuppressLint
import android.graphics.Color as AndroidColor
import android.os.Handler
import android.os.Looper
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import java.io.ByteArrayInputStream
import java.util.Locale
import kotlin.math.roundToInt

private const val KATEX_ASSET_BASE_URL = "file:///android_asset/katex/"
private const val MATH_HEIGHT_BRIDGE_NAME = "AndroidMath"

@Composable
fun MessageMarkdown(
    content: String,
    textColor: Color,
    modifier: Modifier = Modifier,
) {
    val blocks = remember(content) { parseMarkdownBlocks(content) }

    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        blocks.forEach { block ->
            when (block) {
                is MarkdownBlock.Code -> MarkdownCodeBlock(block.code)
                is MarkdownBlock.Heading -> MarkdownHeading(block, textColor)
                MarkdownBlock.HorizontalRule -> MarkdownHorizontalRule()
                is MarkdownBlock.ListItems -> MarkdownListItems(block, textColor)
                is MarkdownBlock.MathDisplay -> MarkdownMathBlock(block.latex, textColor)
                is MarkdownBlock.Paragraph -> InlineMarkdownText(
                    block.text,
                    color = textColor,
                    style = MaterialTheme.typography.bodyMedium,
                )
                is MarkdownBlock.Quote -> MarkdownQuote(block.text, textColor)
                is MarkdownBlock.Table -> MarkdownTable(block, textColor)
            }
        }
    }
}

@Composable
private fun MarkdownHeading(block: MarkdownBlock.Heading, textColor: Color) {
    val style = when (block.level) {
        1 -> MaterialTheme.typography.titleLarge
        2 -> MaterialTheme.typography.titleMedium
        else -> MaterialTheme.typography.titleSmall
    }.copy(
        fontWeight = FontWeight.Bold,
        lineHeight = when (block.level) {
            1 -> 28.sp
            2 -> 24.sp
            else -> 21.sp
        },
    )

    InlineMarkdownText(block.text, color = textColor, style = style)
}

@Composable
private fun MarkdownCodeBlock(code: String) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.72f),
        shape = RoundedCornerShape(8.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(
            code.ifBlank { " " },
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 10.dp, vertical = 9.dp),
            fontFamily = FontFamily.Monospace,
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

@Composable
private fun MarkdownHorizontalRule() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(MaterialTheme.colorScheme.outlineVariant),
    )
}

@Composable
@SuppressLint("SetJavaScriptEnabled")
private fun MarkdownMathBlock(latex: String, textColor: Color) {
    val density = LocalDensity.current
    val cssColor = remember(textColor) { textColor.toCssRgba() }
    val html = remember(latex, cssColor) { katexDocument(latex, cssColor) }
    var height by remember(latex) { mutableStateOf(54.dp) }

    AndroidView(
        modifier = Modifier
            .fillMaxWidth()
            .height(height),
        factory = { context ->
            WebView(context).apply {
                setBackgroundColor(AndroidColor.TRANSPARENT)
                isHorizontalScrollBarEnabled = false
                isVerticalScrollBarEnabled = false
                overScrollMode = View.OVER_SCROLL_NEVER
                settings.allowContentAccess = false
                settings.allowFileAccess = true
                settings.allowFileAccessFromFileURLs = false
                settings.allowUniversalAccessFromFileURLs = false
                settings.blockNetworkLoads = true
                settings.domStorageEnabled = false
                settings.javaScriptEnabled = true
                settings.loadsImagesAutomatically = false
                settings.mediaPlaybackRequiresUserGesture = true
                settings.useWideViewPort = true
                webViewClient = LocalKatexWebViewClient()
                addJavascriptInterface(
                    MathHeightBridge { heightPx ->
                        height = (with(density) { heightPx.toDp() } + 6.dp).coerceAtLeast(54.dp)
                    },
                    MATH_HEIGHT_BRIDGE_NAME,
                )
            }
        },
        update = { webView ->
            if (webView.tag != html) {
                webView.tag = html
                webView.loadDataWithBaseURL(KATEX_ASSET_BASE_URL, html, "text/html", "UTF-8", null)
            }
        },
    )
}

private class MathHeightBridge(private val onHeightChanged: (Int) -> Unit) {
    private val mainHandler = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun onHeightChanged(heightPx: Int) {
        if (heightPx <= 0) return
        mainHandler.post { onHeightChanged(heightPx) }
    }
}

private class LocalKatexWebViewClient : WebViewClient() {
    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = true

    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        val uri = request.url
        val path = uri.path.orEmpty()
        return if (uri.scheme == "file" && path.startsWith("/android_asset/katex/")) {
            null
        } else {
            emptyWebResponse()
        }
    }
}

private fun emptyWebResponse(): WebResourceResponse =
    WebResourceResponse("text/plain", "utf-8", ByteArrayInputStream(ByteArray(0)))

private fun katexDocument(latex: String, cssColor: String): String {
    val latexLiteral = latex.toJavaScriptString()
    return """
        <!doctype html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
          <link rel="stylesheet" href="katex.min.css">
          <style>
            html,
            body {
              background: transparent;
              color: $cssColor;
              margin: 0;
              overflow: hidden;
              padding: 0;
            }

            #math {
              box-sizing: border-box;
              color: $cssColor;
              min-width: 100%;
              overflow-x: auto;
              overflow-y: hidden;
              padding: 6px 0;
            }

            .katex {
              color: inherit;
              font-size: 1.08em;
            }

            .katex-display {
              margin: 0;
              overflow-x: auto;
              overflow-y: hidden;
              text-align: center;
            }

            .math-error {
              font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
              font-size: 14px;
              line-height: 1.45;
              white-space: pre-wrap;
            }
          </style>
        </head>
        <body>
          <div id="math"></div>
          <script src="katex.min.js"></script>
          <script>
            (function () {
              var latex = $latexLiteral;
              var root = document.getElementById("math");

              function reportHeight() {
                var height = Math.ceil(Math.max(
                  document.documentElement.scrollHeight,
                  document.body.scrollHeight,
                  root.scrollHeight
                ));
                if (window.$MATH_HEIGHT_BRIDGE_NAME && window.$MATH_HEIGHT_BRIDGE_NAME.onHeightChanged) {
                  window.$MATH_HEIGHT_BRIDGE_NAME.onHeightChanged(height);
                }
              }

              try {
                katex.render(latex, root, {
                  displayMode: true,
                  output: "htmlAndMathml",
                  strict: "ignore",
                  throwOnError: false
                });
              } catch (error) {
                root.className = "math-error";
                root.textContent = latex;
              }

              requestAnimationFrame(function () {
                reportHeight();
                setTimeout(reportHeight, 50);
                setTimeout(reportHeight, 200);
              });
            }());
          </script>
        </body>
        </html>
    """.trimIndent()
}

private fun Color.toCssRgba(): String {
    val redValue = (red * 255).roundToInt().coerceIn(0, 255)
    val greenValue = (green * 255).roundToInt().coerceIn(0, 255)
    val blueValue = (blue * 255).roundToInt().coerceIn(0, 255)
    val alphaValue = alpha.coerceIn(0f, 1f)
    return String.format(Locale.US, "rgba(%d, %d, %d, %.3f)", redValue, greenValue, blueValue, alphaValue)
}

private fun String.toJavaScriptString(): String = buildString {
    append('"')
    for (char in this@toJavaScriptString) {
        when (char) {
            '\\' -> append("\\\\")
            '"' -> append("\\\"")
            '\b' -> append("\\b")
            '\u000C' -> append("\\f")
            '\n' -> append("\\n")
            '\r' -> append("\\r")
            '\t' -> append("\\t")
            '<' -> append("\\u003C")
            '>' -> append("\\u003E")
            '&' -> append("\\u0026")
            '\u2028' -> append("\\u2028")
            '\u2029' -> append("\\u2029")
            else -> {
                if (char.code < 0x20) {
                    append(String.format(Locale.US, "\\u%04x", char.code))
                } else {
                    append(char)
                }
            }
        }
    }
    append('"')
}

@Composable
private fun MarkdownQuote(text: String, textColor: Color) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            modifier = Modifier
                .width(3.dp)
                .fillMaxHeight()
                .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.7f)),
        )
        Spacer(Modifier.width(9.dp))
        MessageMarkdown(
            content = text,
            textColor = textColor.copy(alpha = 0.86f),
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun MarkdownListItems(block: MarkdownBlock.ListItems, textColor: Color) {
    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
        block.items.forEachIndexed { index, item ->
            Row(verticalAlignment = Alignment.Top) {
                Text(
                    if (block.ordered) "${index + 1}." else "\u2022",
                    color = textColor.copy(alpha = 0.78f),
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.width(if (block.ordered) 28.dp else 18.dp),
                    textAlign = TextAlign.End,
                )
                Spacer(Modifier.width(7.dp))
                InlineMarkdownText(
                    item,
                    color = textColor,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun MarkdownTable(table: MarkdownBlock.Table, textColor: Color) {
    val columnCount = table.headers.size
    val cellWidth = if (columnCount <= 2) 150.dp else 136.dp
    val borderColor = MaterialTheme.colorScheme.outlineVariant
    val headerBackground = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.82f)
    val rowBackground = MaterialTheme.colorScheme.surface.copy(alpha = 0.35f)

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState()),
    ) {
        MarkdownTableRow(
            cells = table.headers,
            alignments = table.alignments,
            cellWidth = cellWidth,
            textColor = textColor,
            borderColor = borderColor,
            background = headerBackground,
            textStyle = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold),
        )
        table.rows.forEach { row ->
            MarkdownTableRow(
                cells = row,
                alignments = table.alignments,
                cellWidth = cellWidth,
                textColor = textColor,
                borderColor = borderColor,
                background = rowBackground,
                textStyle = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

@Composable
private fun MarkdownTableRow(
    cells: List<String>,
    alignments: List<TableAlignment>,
    cellWidth: androidx.compose.ui.unit.Dp,
    textColor: Color,
    borderColor: Color,
    background: Color,
    textStyle: TextStyle,
) {
    Row {
        cells.forEachIndexed { index, cell ->
            Box(
                modifier = Modifier
                    .width(cellWidth)
                    .border(1.dp, borderColor)
                    .background(background)
                    .padding(horizontal = 8.dp, vertical = 7.dp),
            ) {
                InlineMarkdownText(
                    cell.ifBlank { " " },
                    color = textColor,
                    style = textStyle,
                    textAlign = alignments.getOrElse(index) { TableAlignment.Start }.textAlign,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

@Composable
private fun InlineMarkdownText(
    text: String,
    color: Color,
    style: TextStyle,
    modifier: Modifier = Modifier,
    textAlign: TextAlign? = null,
) {
    Text(
        text = inlineMarkdown(text, color),
        color = color,
        style = style,
        modifier = modifier,
        textAlign = textAlign,
    )
}

@Composable
private fun inlineMarkdown(text: String, color: Color): AnnotatedString {
    val codeBackground = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.85f)
    val linkColor = MaterialTheme.colorScheme.secondary
    return buildAnnotatedString {
        appendInlineRange(
            text = text,
            start = 0,
            end = text.length,
            baseColor = color,
            codeBackground = codeBackground,
            linkColor = linkColor,
        )
    }
}

private fun AnnotatedString.Builder.appendInlineRange(
    text: String,
    start: Int,
    end: Int,
    baseColor: Color,
    codeBackground: Color,
    linkColor: Color,
) {
    var index = start
    while (index < end) {
        when {
            text.startsWith("`", index) -> {
                val close = text.indexOf('`', startIndex = index + 1)
                if (close in (index + 1) until end) {
                    pushStyle(SpanStyle(fontFamily = FontFamily.Monospace, color = baseColor, background = codeBackground))
                    append(decodeMarkdownEntities(text.substring(index + 1, close)))
                    pop()
                    index = close + 1
                } else {
                    appendDecodedPlain(text.substring(index, index + 1))
                    index += 1
                }
            }
            text.startsWith("\\(", index) -> {
                val close = text.indexOf("\\)", startIndex = index + 2)
                if (close in (index + 2) until end) {
                    pushStyle(SpanStyle(fontFamily = FontFamily.Monospace, color = baseColor, background = codeBackground))
                    append(decodeMarkdownEntities(text.substring(index + 2, close)))
                    pop()
                    index = close + 2
                } else {
                    appendDecodedPlain(text.substring(index, index + 2))
                    index += 2
                }
            }
            text.startsWith("**", index) || text.startsWith("__", index) -> {
                val marker = text.substring(index, index + 2)
                val close = text.indexOf(marker, startIndex = index + 2)
                if (close in (index + 2) until end) {
                    pushStyle(SpanStyle(fontWeight = FontWeight.Bold))
                    appendInlineRange(text, index + 2, close, baseColor, codeBackground, linkColor)
                    pop()
                    index = close + 2
                } else {
                    appendDecodedPlain(marker)
                    index += 2
                }
            }
            text[index] == '*' || text[index] == '_' -> {
                val marker = text[index]
                val close = text.indexOf(marker, startIndex = index + 1)
                if (close in (index + 1) until end) {
                    pushStyle(SpanStyle(fontStyle = FontStyle.Italic))
                    appendInlineRange(text, index + 1, close, baseColor, codeBackground, linkColor)
                    pop()
                    index = close + 1
                } else {
                    appendDecodedPlain(text.substring(index, index + 1))
                    index += 1
                }
            }
            text[index] == '[' -> {
                val closeLabel = text.indexOf("](", startIndex = index + 1)
                val closeUrl = if (closeLabel >= 0) text.indexOf(')', startIndex = closeLabel + 2) else -1
                if (closeLabel in (index + 1) until end && closeUrl in (closeLabel + 2) until end) {
                    val url = text.substring(closeLabel + 2, closeUrl)
                    pushStringAnnotation(tag = "URL", annotation = url)
                    pushStyle(SpanStyle(color = linkColor, textDecoration = TextDecoration.Underline))
                    appendInlineRange(text, index + 1, closeLabel, baseColor, codeBackground, linkColor)
                    pop()
                    pop()
                    index = closeUrl + 1
                } else {
                    appendDecodedPlain(text.substring(index, index + 1))
                    index += 1
                }
            }
            else -> {
                val next = nextInlineMarker(text, index + 1, end)
                appendDecodedPlain(text.substring(index, next))
                index = next
            }
        }
    }
}

private fun nextInlineMarker(text: String, start: Int, end: Int): Int {
    val marker = text.indexOfAny(charArrayOf('`', '*', '_', '[', '\\'), startIndex = start)
        .takeIf { it >= 0 && it < end }
        ?: return end
    return if (text[marker] == '\\' && !text.startsWith("\\(", marker)) {
        nextInlineMarker(text, marker + 1, end)
    } else {
        marker
    }
}

private fun AnnotatedString.Builder.appendDecodedPlain(text: String) {
    append(decodeMarkdownEscapes(decodeMarkdownEntities(text)))
}

private sealed interface MarkdownBlock {
    data class Heading(val level: Int, val text: String) : MarkdownBlock
    data class Paragraph(val text: String) : MarkdownBlock
    data class Code(val code: String) : MarkdownBlock
    data class ListItems(val ordered: Boolean, val items: List<String>) : MarkdownBlock
    data class MathDisplay(val latex: String) : MarkdownBlock
    data class Quote(val text: String) : MarkdownBlock
    data class Table(val headers: List<String>, val alignments: List<TableAlignment>, val rows: List<List<String>>) : MarkdownBlock
    data object HorizontalRule : MarkdownBlock
}

private enum class TableAlignment(val textAlign: TextAlign) {
    Start(TextAlign.Start),
    Center(TextAlign.Center),
    End(TextAlign.End),
}

private fun parseMarkdownBlocks(content: String): List<MarkdownBlock> {
    val lines = content.replace("\r\n", "\n").replace('\r', '\n').split('\n')
    val blocks = mutableListOf<MarkdownBlock>()
    var index = 0

    while (index < lines.size) {
        val line = lines[index]
        if (line.isBlank()) {
            index += 1
            continue
        }

        val fence = fenceMarker(line)
        if (fence != null) {
            val codeLines = mutableListOf<String>()
            index += 1
            while (index < lines.size && !lines[index].trimStart().startsWith(fence)) {
                codeLines += lines[index]
                index += 1
            }
            if (index < lines.size) index += 1
            blocks += MarkdownBlock.Code(codeLines.joinToString("\n"))
            continue
        }

        val table = parseTable(lines, index)
        if (table != null) {
            blocks += table.block
            index = table.nextIndex
            continue
        }

        val displayMath = parseDisplayMath(lines, index)
        if (displayMath != null) {
            blocks += displayMath.block
            index = displayMath.nextIndex
            continue
        }

        val heading = headingRegex.matchEntire(line)
        if (heading != null) {
            blocks += MarkdownBlock.Heading(
                level = heading.groupValues[1].length,
                text = heading.groupValues[2].trim().trimEnd('#').trim(),
            )
            index += 1
            continue
        }

        if (horizontalRuleRegex.matches(line)) {
            blocks += MarkdownBlock.HorizontalRule
            index += 1
            continue
        }

        val firstListItem = listItemRegex.matchEntire(line)
        if (firstListItem != null) {
            val ordered = firstListItem.groupValues[1].first().isDigit()
            val items = mutableListOf<String>()
            while (index < lines.size) {
                val match = listItemRegex.matchEntire(lines[index]) ?: break
                items += match.groupValues[2].trim()
                index += 1
                while (index < lines.size && lines[index].startsWith("  ") && !listItemRegex.matches(lines[index])) {
                    items[items.lastIndex] = "${items.last()}\n${lines[index].trim()}"
                    index += 1
                }
            }
            blocks += MarkdownBlock.ListItems(ordered = ordered, items = items)
            continue
        }

        if (quoteRegex.containsMatchIn(line)) {
            val quoteLines = mutableListOf<String>()
            while (index < lines.size) {
                val match = quoteRegex.matchEntire(lines[index]) ?: break
                quoteLines += match.groupValues[1]
                index += 1
            }
            blocks += MarkdownBlock.Quote(quoteLines.joinToString("\n"))
            continue
        }

        val paragraphLines = mutableListOf<String>()
        while (index < lines.size && lines[index].isNotBlank() && !startsSpecialBlock(lines, index)) {
            paragraphLines += lines[index].trim()
            index += 1
        }
        blocks += MarkdownBlock.Paragraph(paragraphLines.joinToString("\n"))
    }

    return blocks
}

private data class ParsedTable(val block: MarkdownBlock.Table, val nextIndex: Int)

private data class ParsedMathDisplay(val block: MarkdownBlock.MathDisplay, val nextIndex: Int)

private fun parseDisplayMath(lines: List<String>, index: Int): ParsedMathDisplay? {
    val trimmed = lines[index].trim()
    return when {
        trimmed == "\\[" -> parseDelimitedMathBlock(lines, index, "\\]", firstLineContent = "")
        trimmed.startsWith("\\[") && trimmed.endsWith("\\]") -> parseSingleLineBracketMath(trimmed, index)
        trimmed.startsWith("\\[") -> parseDelimitedMathBlock(lines, index, "\\]", firstLineContent = trimmed.removePrefix("\\[").trim())
        trimmed == "$$" -> parseDelimitedMathBlock(lines, index, "$$", firstLineContent = "")
        trimmed.startsWith("$$") && trimmed.endsWith("$$") -> parseSingleLineDollarMath(trimmed, index)
        trimmed.startsWith("$$") -> parseDelimitedMathBlock(lines, index, "$$", firstLineContent = trimmed.removePrefix("$$").trim())
        else -> null
    }
}

private fun parseDelimitedMathBlock(
    lines: List<String>,
    index: Int,
    closingDelimiter: String,
    firstLineContent: String,
): ParsedMathDisplay {
    val mathLines = mutableListOf<String>()
    if (firstLineContent.isNotBlank()) {
        mathLines += firstLineContent
    }
    var cursor = index + 1
    while (cursor < lines.size && lines[cursor].trim() != closingDelimiter) {
        mathLines += lines[cursor]
        cursor += 1
    }
    val nextIndex = if (cursor < lines.size) cursor + 1 else cursor
    return ParsedMathDisplay(
        block = MarkdownBlock.MathDisplay(mathLines.joinToString("\n").trim()),
        nextIndex = nextIndex,
    )
}

private fun parseSingleLineBracketMath(trimmed: String, index: Int): ParsedMathDisplay? {
    if (!trimmed.endsWith("\\]") || trimmed.length < 4) return null
    return ParsedMathDisplay(
        block = MarkdownBlock.MathDisplay(trimmed.removePrefix("\\[").removeSuffix("\\]").trim()),
        nextIndex = index + 1,
    )
}

private fun parseSingleLineDollarMath(trimmed: String, index: Int): ParsedMathDisplay? {
    if (!trimmed.endsWith("$$") || trimmed.length < 4) return null
    return ParsedMathDisplay(
        block = MarkdownBlock.MathDisplay(trimmed.removePrefix("$$").removeSuffix("$$").trim()),
        nextIndex = index + 1,
    )
}

private fun parseTable(lines: List<String>, index: Int): ParsedTable? {
    if (index + 1 >= lines.size || !lines[index].contains('|') || !lines[index + 1].contains('|')) return null

    val headers = splitMarkdownTableRow(lines[index])
    val separator = splitMarkdownTableRow(lines[index + 1])
    if (headers.size < 2 || separator.size < 2 || separator.any { !tableSeparatorCellRegex.matches(it) }) return null

    val columnCount = headers.size
    val alignments = List(columnCount) { tableAlignment(separator.getOrElse(it) { "" }) }
    val rows = mutableListOf<List<String>>()
    var cursor = index + 2
    while (cursor < lines.size && lines[cursor].isNotBlank() && lines[cursor].contains('|')) {
        if (horizontalRuleRegex.matches(lines[cursor])) break
        rows += normalizeTableCells(splitMarkdownTableRow(lines[cursor]), headers.size)
        cursor += 1
    }

    return ParsedTable(
        block = MarkdownBlock.Table(
            headers = normalizeTableCells(headers, columnCount),
            alignments = alignments,
            rows = rows,
        ),
        nextIndex = cursor,
    )
}

private fun normalizeTableCells(cells: List<String>, size: Int): List<String> =
    List(size) { index -> cells.getOrElse(index) { "" }.trim() }

private fun splitMarkdownTableRow(line: String): List<String> {
    val cells = mutableListOf<String>()
    val current = StringBuilder()
    var escaped = false
    var inCode = false

    line.forEach { char ->
        when {
            escaped -> {
                current.append(char)
                escaped = false
            }
            char == '\\' -> {
                current.append(char)
                escaped = true
            }
            char == '`' -> {
                current.append(char)
                inCode = !inCode
            }
            char == '|' && !inCode -> {
                cells += current.toString()
                current.clear()
            }
            else -> current.append(char)
        }
    }
    cells += current.toString()

    val trimmed = line.trim()
    if (trimmed.startsWith("|") && cells.firstOrNull()?.isBlank() == true) cells.removeAt(0)
    if (trimmed.endsWith("|") && cells.lastOrNull()?.isBlank() == true) cells.removeAt(cells.lastIndex)
    return cells.map { it.trim() }
}

private fun tableAlignment(separator: String): TableAlignment {
    val trimmed = separator.trim()
    return when {
        trimmed.startsWith(":") && trimmed.endsWith(":") -> TableAlignment.Center
        trimmed.endsWith(":") -> TableAlignment.End
        else -> TableAlignment.Start
    }
}

private fun startsSpecialBlock(lines: List<String>, index: Int): Boolean =
    fenceMarker(lines[index]) != null ||
        parseTable(lines, index) != null ||
        parseDisplayMath(lines, index) != null ||
        headingRegex.matches(lines[index]) ||
        horizontalRuleRegex.matches(lines[index]) ||
        listItemRegex.matches(lines[index]) ||
        quoteRegex.matches(lines[index])

private fun fenceMarker(line: String): String? {
    val trimmed = line.trimStart()
    return when {
        trimmed.startsWith("```") -> "```"
        trimmed.startsWith("~~~") -> "~~~"
        else -> null
    }
}

private fun decodeMarkdownEntities(value: String): String =
    htmlEntityRegex.replace(value) { match ->
        val entity = match.groupValues[1]
        when {
            entity == "nbsp" -> "\u00A0"
            entity == "amp" -> "&"
            entity == "lt" -> "<"
            entity == "gt" -> ">"
            entity == "quot" -> "\""
            entity == "apos" -> "'"
            entity.startsWith("#x", ignoreCase = true) ->
                entity.drop(2).toIntOrNull(16)?.let { String(Character.toChars(it)) } ?: match.value
            entity.startsWith("#") ->
                entity.drop(1).toIntOrNull()?.let { String(Character.toChars(it)) } ?: match.value
            else -> match.value
        }
    }

private fun decodeMarkdownEscapes(value: String): String =
    markdownEscapeRegex.replace(value) { match ->
        val escaped = match.groupValues[1]
        if (escaped == "[" || escaped == "]" || escaped == "(" || escaped == ")") match.value else escaped
    }

private val headingRegex = Regex("""^\s{0,3}(#{1,6})\s+(.+?)\s*$""")
private val horizontalRuleRegex = Regex("""^\s{0,3}([-*_])(?:\s*\1){2,}\s*$""")
private val listItemRegex = Regex("""^\s{0,6}((?:[-*+])|(?:\d+[.)]))\s+(.+?)\s*$""")
private val quoteRegex = Regex("""^\s{0,3}>\s?(.*)$""")
private val tableSeparatorCellRegex = Regex("""^\s*:?-{3,}:?\s*$""")
private val htmlEntityRegex = Regex("""&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]+);""")
private val markdownEscapeRegex = Regex("""\\([\\`*_{}\[\]()#+\-.!|>])""")
