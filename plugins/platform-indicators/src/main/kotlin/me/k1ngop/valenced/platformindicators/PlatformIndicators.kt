@file:JvmName("PlatformIndicators")

package me.k1ngop.valenced.platformindicators

import app.valenced.bridge.asDelegate
import app.valenced.plugins.plugin
import app.valenced.xposed.api.registerNativeMethod

/** Shows the platforms a user is on next to their name above chat messages. */
@Suppress("UNUSED")
val platformIndicators = plugin {
    var hooks: ChatHooks? = null

    start {
        registerNativeMethod("k1ngop.platformindicators.put") { args ->
            val json by args.asDelegate().string()
            hooks?.put(json)
            null
        }

        registerNativeMethod("k1ngop.platformindicators.clear") {
            hooks?.clear()
            null
        }

        // After the methods, so a failing lookup is reported instead of leaving them unregistered
        try {
            hooks = ChatHooks(dexFinder) { errors.tryEmit(it) }
        } catch (e: Exception) {
            errors.tryEmit(e)
        }
    }

    stop {
        hooks?.dispose()
        hooks = null
    }
}
