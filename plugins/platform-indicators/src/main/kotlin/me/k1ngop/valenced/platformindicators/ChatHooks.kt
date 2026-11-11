package me.k1ngop.valenced.platformindicators

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

// The MessageView hook and the lookups of its views follow Show Timeout Duration by Palm (GPL-3.0)
private const val MESSAGE_VIEW = "com.discord.chat.presentation.message.MessageView"
private const val MESSAGE = "com.discord.chat.bridge.Message"
private const val CHAT_LIST_VIEW_MANAGER = "com.discord.chat.presentation.list.ChatListViewManager"

/** LRU cache. */
private const val CACHE_CAPACITY = 2000

private const val MARGIN_DP = 4f

/** Adds a [PlatformStrip] next to the author of chat messages whose author is on a known platform. */
internal class ChatHooks(dexFinder: DexFinder, private val onError: (Throwable) -> Unit) {
    private val icons = object : LinkedHashMap<String, List<PlatformIcon>>(256, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, List<PlatformIcon>>) =
            size > CACHE_CAPACITY
    }

    // Main thread only
    private val strips = WeakHashMap<RelativeLayout, PlatformStrip>()
    private var ids: ViewIds? = null

    private val mainHandler = Handler(Looper.getMainLooper())

    private val chatListView: Class<*> = dexFinder.classLoader.loadClass(CHAT_LIST_VIEW_MANAGER).declaredMethods
        .single { it.name == "setFloatingChatInputEnabled" && !it.isBridge }
        .parameterTypes[0]

    private val messageIdField = dexFinder.classLoader.loadClass(MESSAGE).getDeclaredField("id")
        .apply { isAccessible = true }

    // Main thread only
    private val reported = mutableSetOf<String>()

    private val unhooks: List<XC_MethodHook.Unhook>

    init {
        val setMessage = dexFinder.findMethod {
            matcher {
                declaredClass(MESSAGE_VIEW)
                usingEqStrings("message", "messageContext", "eventHandler")
            }
        } ?: error("MessageView.setMessage not found")

        unhooks = listOf(XposedBridge.hookMethod(setMessage, object : XC_MethodHook() {
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

                // Only messages that start a group show their author
                val showsAuthor = author.visibility == View.VISIBLE
                val platforms = synchronized(icons) { icons[id] }.orEmpty()

                val strip = strips[view]
                    ?: if (showsAuthor && platforms.isNotEmpty()) insertStrip(view, author, ids.timestamp) ?: return else return
                if (strip.bind(id, showsAuthor, platforms)) relayout(view)
            }
        }))
    }

    /** IDs of the message views Discord's binding holds. R8 merged the binding classes, the IDs keep their names. */
    private class ViewIds(view: View) {
        val header = view.idOf("header")
        val authorName = view.idOf("author_name")
        val timestamp = view.idOf("timestamp")
    }

    /** Stores icons from JS, and updates the strips already showing their messages. */
    fun put(json: String) {
        val updates = JSONObject(json).let { obj -> obj.keys().asSequence().associateWith { parseIcons(obj.getJSONArray(it)) } }
        synchronized(icons) { icons.putAll(updates) }

        mainHandler.post {
            for ((view, strip) in strips) {
                val id = strip.messageId ?: continue
                val update = updates[id] ?: continue
                if (strip.bind(id, strip.showsAuthor, update)) relayout(view)
            }
        }
    }

    fun clear() {
        synchronized(icons) { icons.clear() }
        mainHandler.post {
            for ((view, strip) in strips) if (strip.bind(null, false, emptyList())) relayout(view)
        }
    }

    fun dispose() {
        for (unhook in unhooks) unhook.unhook()
        synchronized(icons) { icons.clear() }
        mainHandler.post {
            for ((view, strip) in strips) {
                strip.detach()
                relayout(view)
            }
            strips.clear()
        }
    }

    private fun parseIcons(array: JSONArray) = List(array.length()) { index ->
        val icon = array.getJSONArray(index)
        PlatformIcon(icon.getString(0), icon.getInt(1))
    }

    /** Surfaces a problem once, however many messages hit it. */
    private fun report(message: String) {
        if (reported.add(message)) onError(IllegalStateException(message))
    }

    private fun insertStrip(view: RelativeLayout, author: View, timestampId: Int): PlatformStrip? {
        val parent = author.parent as? ViewGroup ?: return null
        val strip = PlatformStrip(view.context) { report("No drawable resource named \"$it\"") }

        if (parent is LinearLayout && parent.orientation == LinearLayout.HORIZONTAL) {
            val margin = (MARGIN_DP * view.resources.displayMetrics.density).toInt()
            parent.addView(strip, parent.indexOfChild(author) + 1, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply {
                marginStart = margin
                gravity = Gravity.CENTER_VERTICAL
            })
        } else {
            val timestamp = parent.findViewById<View>(timestampId)
            if (timestamp == null) {
                report("The author name is in ${parent.javaClass.name} and there is no timestamp next to it")
                return null
            }
            view.addView(strip, RelativeLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ))
            strip.takePlaceOf(view, timestamp)
        }

        strips[view] = strip
        return strip
    }

    /**
     * React Native ignores layout requests from native views, Discord does this after its own updates too
     * (`ChatListView.measureAndLayout`). Views with a pending layout request are measured again.
     */
    private fun relayout(view: View) {
        val list = generateSequence(view.parent) { it.parent }.firstOrNull(chatListView::isInstance) as View? ?: return
        list.post { list.measureAndLayout() }
    }
}

@Suppress("DiscouragedApi")
private fun View.idOf(name: String) = resources.getIdentifier(name, "id", context.packageName)

// Not findViewById, as nested messages (such as replies) have views with the same IDs
private fun ViewGroup.childWithId(id: Int): View? =
    (0 until childCount).asSequence().map(::getChildAt).firstOrNull { it.id == id }

private fun View.measureAndLayout() {
    measure(
        View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
        View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY),
    )
    layout(left, top, right, bottom)
}
