package me.k1ngop.valenced.uservoiceshow

import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.RelativeLayout
import app.valenced.xposed.api.DexFinder
import de.robv.android.xposed.XC_MethodHook
import de.robv.android.xposed.XposedBridge
import org.json.JSONArray
import org.json.JSONObject
import java.util.WeakHashMap

private const val MESSAGE_VIEW = "com.discord.chat.presentation.message.MessageView"
private const val MESSAGE = "com.discord.chat.bridge.Message"
private const val CHAT_LIST_VIEW_MANAGER = "com.discord.chat.presentation.list.ChatListViewManager"

private const val CACHE_CAPACITY = 2000

internal class VoiceHooks(
    dexFinder: DexFinder,
    private val onError: (Throwable) -> Unit,
    private val open: (messageId: String) -> Unit,
) {
    private val badges = object : LinkedHashMap<String, VoiceBadge>(256, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, VoiceBadge>) = size > CACHE_CAPACITY
    }

    // The fields below are only used on the main thread
    private val icons = WeakHashMap<RelativeLayout, VoiceIcon>()
    private val reported = mutableSetOf<String>()
    private var ids: ViewIds? = null

    private val mainHandler = Handler(Looper.getMainLooper())

    private val chatListView = dexFinder.classLoader.loadClass(CHAT_LIST_VIEW_MANAGER).declaredMethods
        .single { it.name == "setFloatingChatInputEnabled" && !it.isBridge }
        .parameterTypes[0]

    private val messageIdField = dexFinder.classLoader.loadClass(MESSAGE).getDeclaredField("id")
        .apply { isAccessible = true }

    private val unhook: XC_MethodHook.Unhook

    init {
        val setMessage = dexFinder.findMethod {
            matcher {
                declaredClass(MESSAGE_VIEW)
                usingEqStrings("message", "messageContext", "eventHandler")
            }
        } ?: error("MessageView.setMessage not found")

        unhook = XposedBridge.hookMethod(setMessage, object : XC_MethodHook() {
            override fun afterHookedMethod(param: MethodHookParam) {
                val view = param.thisObject as RelativeLayout
                val id = messageIdField.get(param.args[0]) as String
                val ids = ids ?: ViewIds(view).also { ids = it }
                if (ids.header == 0 || ids.authorName == 0) {
                    report("Message view has no header or author_name id")
                    return
                }

                val header = view.childWithId(ids.header) as? ViewGroup ?: return
                val author = header.findViewById<View>(ids.authorName) ?: return

                // Only the first message of a group shows its author
                val showsAuthor = author.visibility == View.VISIBLE
                val badge = synchronized(badges) { badges[id] }

                val icon = icons[view] ?: run {
                    if (!showsAuthor || badge == null) return
                    insertIcon(view, author, ids.timestamp) ?: return
                }
                if (icon.bind(id, showsAuthor, badge)) relayout(view)
            }
        })
    }

    // Discord's view binding classes are merged by R8, but the IDs keep their names
    private class ViewIds(view: View) {
        val header = view.idOf("header")
        val authorName = view.idOf("author_name")
        val timestamp = view.idOf("timestamp")
    }

    fun put(json: String) {
        val updates = JSONObject(json).let { obj ->
            obj.keys().asSequence().associateWith { parseBadge(obj.getJSONArray(it)) }
        }

        synchronized(badges) {
            for ((id, badge) in updates) {
                if (badge != null) badges[id] = badge else badges.remove(id)
            }
        }

        mainHandler.post {
            for ((view, icon) in icons) {
                val id = icon.messageId ?: continue
                if (id in updates && icon.bind(id, icon.showsAuthor, updates[id])) relayout(view)
            }
        }
    }

    fun clear() {
        synchronized(badges) { badges.clear() }
        mainHandler.post {
            for ((view, icon) in icons) if (icon.bind(null, false, null)) relayout(view)
        }
    }

    fun dispose() {
        unhook.unhook()
        synchronized(badges) { badges.clear() }
        mainHandler.post {
            for ((view, icon) in icons) {
                icon.detach()
                relayout(view)
            }
            icons.clear()
        }
    }

    private fun parseBadge(array: JSONArray) =
        if (array.length() == 0) null else VoiceBadge(array.getString(0), array.getInt(1))

    private fun report(message: String) {
        if (reported.add(message)) onError(IllegalStateException(message))
    }

    private fun insertIcon(view: RelativeLayout, author: View, timestampId: Int): VoiceIcon? {
        val parent = author.parent as? ViewGroup ?: return null
        val icon = VoiceIcon(view.context, open) { report("No drawable resource named \"$it\"") }
        val density = view.resources.displayMetrics.density
        val size = (ICON_SIZE_DP * density).toInt()

        if (parent is LinearLayout && parent.orientation == LinearLayout.HORIZONTAL) {
            parent.addView(icon, parent.indexOfChild(author) + 1, LinearLayout.LayoutParams(size, size).apply {
                marginStart = (ICON_GAP_DP * density).toInt()
                gravity = Gravity.CENTER_VERTICAL
            })
        } else {
            val timestamp = parent.findViewById<View>(timestampId)
            if (timestamp == null) {
                report("The author name is in ${parent.javaClass.name} and there is no timestamp next to it")
                return null
            }
            view.addView(icon, RelativeLayout.LayoutParams(size, size))
            icon.takePlaceOf(view, timestamp)
        }

        icons[view] = icon
        return icon
    }

    // React Native ignores layout requests from native views, so the list has to be laid out again
    private fun relayout(view: View) {
        val list = generateSequence(view.parent) { it.parent }.firstOrNull(chatListView::isInstance) as View? ?: return
        list.post { list.measureAndLayout() }
    }
}

@Suppress("DiscouragedApi")
private fun View.idOf(name: String) = resources.getIdentifier(name, "id", context.packageName)

// Not findViewById, nested messages such as replies have views with the same IDs
private fun ViewGroup.childWithId(id: Int): View? =
    (0 until childCount).asSequence().map(::getChildAt).firstOrNull { it.id == id }

private fun View.measureAndLayout() {
    measure(
        View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
        View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY),
    )
    layout(left, top, right, bottom)
}
