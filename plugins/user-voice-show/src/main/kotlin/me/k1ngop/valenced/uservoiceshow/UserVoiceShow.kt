@file:JvmName("UserVoiceShow")

package me.k1ngop.valenced.uservoiceshow

import app.valenced.bridge.asDelegate
import app.valenced.plugins.plugin
import app.valenced.xposed.api.registerNativeMethod
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

@Suppress("UNUSED")
val userVoiceShow = plugin {
    var hooks: VoiceHooks? = null
    var scope: CoroutineScope? = null

    start {
        registerNativeMethod("k1ngop.voice.put") { args ->
            val json by args.asDelegate().string()
            hooks?.put(json)
            null
        }

        registerNativeMethod("k1ngop.voice.clear") {
            hooks?.clear()
            null
        }

        val jsScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        scope = jsScope

        try {
            hooks = VoiceHooks(dexFinder, { errors.tryEmit(it) }) { messageId ->
                jsScope.launch {
                    try {
                        if (bridge.isReady) bridge.callJSMethod("k1ngop.voice.open", listOf(messageId))
                    } catch (e: Exception) {
                        errors.tryEmit(e)
                    }
                }
            }
        } catch (e: Exception) {
            errors.tryEmit(e)
        }
    }

    stop {
        hooks?.dispose()
        hooks = null
        scope?.cancel()
        scope = null
    }
}
