package me.k1ngop.valenced.uservoiceshow

import android.content.Context
import android.graphics.PorterDuff
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView

internal const val ICON_SIZE_DP = 16f
internal const val ICON_GAP_DP = 4f

internal data class VoiceBadge(val resource: String, val color: Int)

internal class VoiceIcon(
    context: Context,
    onClick: (messageId: String) -> Unit,
    private val onMissingResource: (String) -> Unit,
) : ImageView(context) {
    var messageId: String? = null
        private set
    var showsAuthor = false
        private set

    private var shown: VoiceBadge? = null

    private val gap = ICON_GAP_DP * context.resources.displayMetrics.density

    private var host: View? = null
    private var anchor: View? = null

    private val update = Runnable { reposition() }

    init {
        visibility = GONE
        scaleType = ScaleType.FIT_CENTER
        setOnClickListener { messageId?.let(onClick) }
        addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> post(update) }
    }

    fun takePlaceOf(host: View, anchor: View) {
        this.host = host
        this.anchor = anchor
        anchor.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> post(update) }
    }

    fun detach() {
        anchor?.translationX = 0f
        (parent as? ViewGroup)?.removeView(this)
    }

    fun bind(messageId: String?, showsAuthor: Boolean, badge: VoiceBadge?): Boolean {
        this.messageId = messageId
        this.showsAuthor = showsAuthor

        val next = badge.takeIf { showsAuthor }
        if (next == shown) return false
        shown = next

        if (next != null) {
            @Suppress("DiscouragedApi")
            val id = resources.getIdentifier(next.resource, "drawable", context.packageName)
            if (id == 0) onMissingResource(next.resource) else setImageResource(id)
            setColorFilter(next.color, PorterDuff.Mode.SRC_IN)
            visibility = if (id == 0) GONE else VISIBLE
        } else {
            visibility = GONE
        }

        post(update)
        return true
    }

    // Runs after the layout listeners of the other views that move the anchor, so it gets the last word
    private fun reposition() {
        val host = host ?: return
        val anchor = anchor ?: return
        val row = anchor.parent as? ViewGroup ?: return

        var x = 0
        var y = 0
        var topLevel: View = row
        var view: View = row
        while (view !== host) {
            x += view.left
            y += view.top
            topLevel = view
            view = view.parent as? View ?: return
        }

        val anchorLeft = x + anchor.left
        val rowTop = y + anchor.top
        val rowBottom = rowTop + anchor.height

        // Other icons drawn over the row are placed with translation
        var overlayRight = 0f
        for (i in 0 until host.childCount) {
            val child = host.getChildAt(i)
            if (child === this || child === topLevel || child.visibility != VISIBLE || child.translationX == 0f) continue
            val top = child.top + child.translationY
            if (top < rowBottom && top + child.height > rowTop) {
                overlayRight = maxOf(overlayRight, child.left + child.translationX + child.width)
            }
        }

        if (visibility != VISIBLE) {
            anchor.translationX = if (overlayRight > 0f) overlayRight + gap - anchorLeft else 0f
            return
        }
        if (width == 0) return

        var previousRight = 0
        for (i in 0 until row.childCount) {
            val child = row.getChildAt(i)
            if (child === anchor || child === this || child.visibility != VISIBLE) continue
            if (child.right <= anchor.left) previousRight = maxOf(previousRight, child.right)
        }

        val left = maxOf(x + previousRight.toFloat(), overlayRight) + gap
        translationX = left
        translationY = rowTop + (anchor.height - height) / 2f
        anchor.translationX = maxOf(anchor.translationX, left + width + gap - anchorLeft)
    }
}
