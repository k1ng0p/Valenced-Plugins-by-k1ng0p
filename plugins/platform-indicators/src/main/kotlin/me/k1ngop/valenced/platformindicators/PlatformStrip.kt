package me.k1ngop.valenced.platformindicators

import android.content.Context
import android.graphics.PorterDuff
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.LinearLayout

private const val ICON_SIZE_DP = 16f
private const val ICON_GAP_DP = 4f
// The tag's text sits a little above its box's center, so the icons are lifted to match
private const val ICON_LIFT_DP = 2f

/** A platform's icon, as the name of its drawable resource and its ARGB color. */
internal data class PlatformIcon(val resource: String, val color: Int)

/** The icons shown next to the author of a chat message. */
internal class PlatformStrip(
    context: Context,
    private val onMissingResource: (String) -> Unit,
) : LinearLayout(context) {
    var messageId: String? = null
        private set
    var showsAuthor = false
        private set

    private var shown = emptyList<PlatformIcon>()

    private val density = context.resources.displayMetrics.density

    private var host: View? = null
    private var anchor: View? = null

    init {
        orientation = HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        visibility = GONE
        addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> reposition() }
    }

    /** Draws the strip over [host] where [anchor] starts, and moves [anchor] along to make room. */
    fun takePlaceOf(host: View, anchor: View) {
        this.host = host
        this.anchor = anchor
        anchor.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> reposition() }
    }

    fun detach() {
        anchor?.translationX = 0f
        (parent as? ViewGroup)?.removeView(this)
    }

    private fun reposition() {
        val host = host ?: return
        val anchor = anchor ?: return
        if (visibility != VISIBLE) {
            anchor.translationX = 0f
            return
        }
        if (width == 0) return

        val row = anchor.parent as? ViewGroup ?: return
        var x = 0
        var y = 0
        var view: View = row
        while (view !== host) {
            x += view.left
            y += view.top
            view = view.parent as? View ?: return
        }

        var previous: View? = null
        for (i in 0 until row.childCount) {
            val child = row.getChildAt(i)
            if (child === anchor || child === this || child.visibility != VISIBLE) continue
            if (child.right <= anchor.left && child.right >= (previous?.right ?: 0)) previous = child
        }

        val gap = ICON_GAP_DP * density
        translationX = x + (previous?.right ?: 0) + gap
        // Centered on the view before the anchor (the server tag), not the timestamp, which sits lower
        val line = previous ?: anchor
        translationY = y + line.top + (line.height - height) / 2f - ICON_LIFT_DP * density
        anchor.translationX = width + gap
    }

    /** Returns whether the icons changed, which means the row needs to be laid out again. */
    fun bind(messageId: String?, showsAuthor: Boolean, icons: List<PlatformIcon>): Boolean {
        this.messageId = messageId
        this.showsAuthor = showsAuthor

        val next = if (showsAuthor) icons else emptyList()
        if (next == shown) return false
        shown = next

        removeAllViews()
        for (icon in next) {
            val view = newIcon(icon) ?: continue
            val first = childCount == 0

            addView(view, LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, (ICON_SIZE_DP * density).toInt()).apply {
                if (!first) marginStart = (ICON_GAP_DP * density).toInt()
            })
        }

        visibility = if (childCount > 0) VISIBLE else GONE
        reposition()
        return true
    }

    // Bundled JS assets are drawable resources of the app, named by what JS sent
    @Suppress("DiscouragedApi")
    private fun newIcon(icon: PlatformIcon): ImageView? {
        val id = resources.getIdentifier(icon.resource, "drawable", context.packageName)
        if (id == 0) {
            onMissingResource(icon.resource)
            return null
        }

        return ImageView(context).apply {
            setImageResource(id)
            setColorFilter(icon.color, PorterDuff.Mode.SRC_IN)
            adjustViewBounds = true
            scaleType = ImageView.ScaleType.FIT_CENTER
        }
    }
}
