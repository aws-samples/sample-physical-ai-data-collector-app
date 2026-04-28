package com.amazon.paidatacollector.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RectF
import android.util.AttributeSet
import android.view.View

class ScanOverlayView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : View(context, attrs) {

    private val dimPaint = Paint().apply {
        color = Color.argb(160, 0, 0, 0)
    }
    private val clearPaint = Paint().apply {
        xfermode = PorterDuffXfermode(PorterDuff.Mode.CLEAR)
    }
    private val cornerPaint = Paint().apply {
        color = Color.WHITE
        style = Paint.Style.STROKE
        strokeWidth = 8f
        strokeCap = Paint.Cap.ROUND
        isAntiAlias = true
    }
    private val textPaint = Paint().apply {
        color = Color.WHITE
        textSize = 40f
        textAlign = Paint.Align.CENTER
        isAntiAlias = true
    }

    private val frameRect = RectF()
    private val cornerLen = 60f

    init {
        setLayerType(LAYER_TYPE_SOFTWARE, null)
    }

    override fun onDraw(canvas: Canvas) {
        val cx = width / 2f
        val cy = height / 2f
        val half = minOf(width, height) * 0.35f

        frameRect.set(cx - half, cy - half, cx + half, cy + half)

        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), dimPaint)
        canvas.drawRect(frameRect, clearPaint)

        val l = frameRect.left
        val t = frameRect.top
        val r = frameRect.right
        val b = frameRect.bottom

        canvas.drawLine(l, t + cornerLen, l, t, cornerPaint)
        canvas.drawLine(l, t, l + cornerLen, t, cornerPaint)
        canvas.drawLine(r - cornerLen, t, r, t, cornerPaint)
        canvas.drawLine(r, t, r, t + cornerLen, cornerPaint)
        canvas.drawLine(l, b - cornerLen, l, b, cornerPaint)
        canvas.drawLine(l, b, l + cornerLen, b, cornerPaint)
        canvas.drawLine(r - cornerLen, b, r, b, cornerPaint)
        canvas.drawLine(r, b, r, b - cornerLen, cornerPaint)

        canvas.drawText("Align QR code within the frame", cx, b + 60f, textPaint)
    }
}
