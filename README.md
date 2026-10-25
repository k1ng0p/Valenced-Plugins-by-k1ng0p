# k1ng0p Valenced Plugins

Valenced plugin repository.

## Install

In Revenge: **Settings → General → Plugins → Add repository**, then paste:

```
https://k1ng0p.github.io/revenge-next-plugins/
```

## Plugins

### Original

| Plugin | Description | Source |
|---|---|---|
| **Platform Spoof** | Spoofs your Discord gateway platform so others see a different client icon (Desktop, Web, VR, Console) on your profile. | Written by [k1ng0p](https://github.com/k1ng0p) for Revenge Next |
| **LastOnlineTracker** | Shows "Active X ago" under usernames in the member list once they go offline. | Written by [k1ng0p](https://github.com/k1ng0p) for Revenge Next |
| **Instant Actions** | Skips confirmation prompts for destructive actions - deleting messages, embeds, channels, leaving servers and groups.| Written by [k1ng0p](https://github.com/k1ng0p) for Revenge Next |
| **Plugin Browser** | Browse third-party repositories, see what they offer, and add them to Revenge Next.| Written by [k1ng0p](https://github.com/k1ng0p) for Revenge Next |
| **Disable Call Idle** | Prevents automatic disconnects from idle DM calls.| Written by [k1ng0p](https://github.com/k1ng0p) for Revenge Next |
| **Junk Cleanup** | Hides useless Discord UI: Nitro and quest upsells, extra message menu rows, settings sections, server header buttons, voice call clutter and profile cosmetics. | Written by [k1ng0p](https://github.com/k1ng0p) for Revenge Next |
| **Watchlist** | Shows toasts when your friends or tracked users change status, start typing, or send a message.| Written by [k1ng0p](https://github.com/k1ng0p) for Revenge Next |
| **Status Reply** | Reply to friends' custom statuses straight from their profile, just like the desktop app.| Written by [k1ng0p](https://github.com/k1ng0p) for Revenge Next |


### Ported

| Plugin | Description | Source |
|---|---|---|
| **Platform Indicators** | Adds platform indicators (Desktop, Mobile, Web) next to usernames in DMs, member list, and profiles. | Original [Vendetta plugin](https://github.com/Martinz64/vendetta-plugins/tree/master/plugins/PlatformIndicators) by [Martinz64](https://github.com/Martinz64), ported by [k1ng0p](https://github.com/k1ng0p) to Revenge Next |
| **No Idle** | Prevent status from idling when Discord is in the background. | Original [Vendetta plugin](https://github.com/amsryq/letup/tree/main/plugins/NoIdle) by [amsryq](https://github.com/amsryq), ported by [k1ng0p](https://github.com/k1ng0p) to Revenge Next |
| **Anonymous File Names** | Randomizes file names before you upload them. | Original [Revenge Plugin](https://github.com/shipwr3ckd/revengeplugin#anonymousfilenames) by [Siguma](https://github.com/shipwr3ckd), ported by [k1ng0p](https://github.com/k1ng0p) to Revenge Next |
| **ValidUser** | Fixes unresolved user mentions like @unknown-user to a normal clickable mention.. | Original [Revenge Plugin](https://github.com/fshinz/Revenge-Plugins/tree/master/plugins/ValidUser) by [fshinz](https://github.com/fshinz), ported by [k1ng0p](https://github.com/k1ng0p) to Revenge Next |
| **Dashless** | Changes dashes in text channel names to spaces. | Original [Revenge Plugin](https://github.com/Awesomegamergame/bunny-plugins/tree/master/plugins/dashless) by [Awesomegamergame](https://github.com/Awesomegamergame), ported by [k1ng0p](https://github.com/k1ng0p) to Revenge Next |
akes the first `PluginBuilder` value it exposes. You import and use a Ktor plugin value the same
way.

```kotlin
@file:JvmName("MyPlugin") // makes dist.android.class read as com.example.plugin.MyPlugin

package com.example.plugin

import app.valenced.plugins.plugin
import app.valenced.xposed.api.registerMethod

val myPlugin = plugin {
    start {
        log.i("Loaded ${manifest.id} in ${appInfo.packageName}")
        registerMethod("${manifest.id}.ping") { "pong" }
    }
    stop {
        log.i("Unloaded ${manifest.id}")
    }
}
```

A Kotlin top-level `val` compiles into a file-facade class. `MyPlugin.kt` becomes `MyPluginKt`.
The `@file:JvmName("MyPlugin")` annotation renames that facade. `dist.android.class` can then use the clean name `com.example.plugin.MyPlugin`.

If you omit the annotation, point `dist.android.class` at `...MyPluginKt`.
Declare exactly one `plugin {}` val in the file that the manifest names.

The host provides the Valenced API, the Xposed API, coroutines and the Kotlin standard library. The
build marks them `compileOnly`. The host class loader supplies them at runtime, so the JAR must not
contain them.

> **Note:** `d8` can print a `malformed kotlin.Metadata` warning. This warning is not fatal.
> The SDK metadata library is older than the Kotlin compiler. `d8` still writes a correct DEX, and the DEX loads.
> Only the rewrite of Kotlin reflection metadata stops.

## Distribution

This template is also a **plugin repository**. A repository is a static host that serves `index.json`
describing every published plugin channels, versions, absolute artifact URLs, and SHA-256 digests.

A user can add the repository URL in Valenced. Browsing, dependency resolution and updates all run on the client.

### Channels

A **channel is a named pointer into the published versions of one plugin**. In `index.json` each plugin carries both maps:

```jsonc
"channels": { "latest": "1.2.0", "beta": "1.3.0-beta" },
"versions": { "1.2.0": { /* … */ }, "1.3.0-beta": { /* … */ } }
```

`versions` holds the artifact data. `channels` only states which published version an audience gets.

The client picks a channel at install time, and it follows that pointer for update checks.
A stable user never sees a beta, because the `latest` pointer never points at one.

**Automatic pointers**:

- `latest` is the newest version with **no label**. `1.2.0` qualifies. `1.3.0-beta` never does.
- `beta` is the newest version **overall**. The generator emits it only when it differs from `latest`.
  When your newest release is stable, no `beta` pointer exists.

**Manual overrides**: Use the `channels` key in `repo.config.json`, keyed by plugin ID:

```jsonc
{
    "name": "My Plugin Repository",
    "channels": {
        "com.example.plugin": {
            "latest": "1.1.4", // keep latest on 1.1.4, for example when 1.2.0 shipped broken
            "lts": "1.0.9" // or add a channel of your own
        }
    }
}
```

These rules apply:

- The generator computes `latest` and `beta` first. It then applies your overrides.
- An override must point at a published version of that plugin. Otherwise the generator fails.
- A channel name carries no version semantics. An `lts` version is the same artifact as its plain version.
  You only point at it for longer. To promote `beta` to `latest`, edit the pointer. No rebuilds or republishes.
- **A dependency never references a channel.** A dependency constrains versions only, so a mixed-channel install can resolve.

### The pool

Every published artifact lives in one flat directory on the published branch, next to the index:

```
pool/com.example.plugin@1.0.0.zip
pool/com.example.plugin@1.2.0.zip
pool/palmdevs.silent-typing@1.0.0.zip
index.json
```

The branch is `gh-pages` by default. To use a different one, set the `POOL_BRANCH` repository
variable under Settings, Secrets and variables, Actions. All three workflows read it, so one
variable moves the pool, the index and the migration together.

The pool is the **only** record of what is published. A version is published when its artifact is in
the pool, and `index.json` is a pure function of the directory. Regenerating it can never invent or
lose a version. To unpublish a version, delete its file and regenerate.

The `@` separator is in neither the ID charset nor the version charset, so both halves always parse.
The generator also opens every archive and compares the file name against the manifest inside it. A
mislabeled artifact fails the build instead of entering the index under the wrong version.

Git tags and GitHub Releases are written for changelogs only. Nothing reads them.

### Automated releases

> [!IMPORTANT]  
> You'll need to setup a **personal access token** with `read:packages` and put it in **Repository Settings > Secrets and variables > Actions** as `READ_PACKAGES_TOKEN`.  
> The workflows use it to download the Valenced API dependency. You may encounter a `401` error during build if you don't set it up.

Two workflows publish the repository. The CLI holds the release logic, and it never talks to a Git
host. Both workflows call it with local files. To port the repository to another host, you rewrite
the workflow steps and change no CLI code.

The workflows declare triggers, permissions and inputs only. Each step runs a script in
`.github/scripts/`, so you can run the same code on your machine and read a failure as a shell
error rather than a rendered YAML block.

`release.yml` runs on a push to `main`. It checks out the pool, then calls `plan-releases`, which
reads every `manifest.json` and lists the plugins whose version is not in the pool yet. The command
also refuses a downgrade. It fails when a manifest version is below the newest published version of
that plugin. The comparison uses the same order as the client, so a bare version wins over a labeled
one. You can promote `1.2.0-rc` to `1.2.0` without a failure.

The workflow then builds the planned plugins, copies the artifacts into the pool, regenerates the
index, and pushes **artifacts and index in one commit**. The branch never holds an index that points
at a file it does not have, and a run that fails part way publishes nothing. Re-running it is safe.

Because the pool is keyed by plugin ID, renaming a plugin folder keeps its release history.

Run the planner against a checkout of the published branch to see what a push would release:

```sh
git clone --branch gh-pages <your repo url> published
bun run plan-releases -- --pool published/pool
bun run plan-releases -- --pool published/pool --out plan.json
```

The planner writes nothing to the pool. `--pool` is required, because an absent directory looks like
an empty pool and would republish every version.

`publish-index.yml` runs on dispatch only. It regenerates `index.json` from the artifacts already in
the pool and commits it when it changed. Use it after you edit the `repo.config.json` channel
overrides, or after you delete an artifact to unpublish a version. Releasing does not need it.

### PR validation security warning

Pull requests from forks run in the context of the base repository. This workflow uses `pull_request_target`, which means it runs with the base repository's permissions and secrets.
This can be a security risk if the workflow executes untrusted code from the fork. You should configure pull requests to require maintainer approval by going to **Settings > Actions > General**, and set **Require approval for all external contributors**.

> [!NOTE]  
> By default, validation will fail for pull requests from forks. To acknowledge the security warning and allow the workflow to run, you must set the `ACKNOWLEDGE_PR_SECURITY_WARNING` repository variable to `true` in your repository settings.


### Serve a repository on your machine

You can test the full repository flow against your own builds: add the repository, browse it, install, and update.  
Build the ZIPs first, then start the dev server. The server regenerates the index and serves it beside the artifacts:

```sh
./gradlew packageAllPlugins   # or one package task
bun run serve                 # http://<your-lan-ip>:8080
```

Add the URL on the device as a repository. If the device cannot reach your IP, or if it blocks cleartext traffic, use loopback through ADB:

```sh
bun run serve -- --base-url http://127.0.0.1:8080
adb reverse tcp:8080 tcp:8080
```

The server rescans the dist folder on every index request.
Bump a manifest version, rebuild that plugin, and check for updates on the device. The new version will appear.
