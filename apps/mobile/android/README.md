# Android platform

The repo tracks curated platform overrides (manifest, Gradle Kotlin DSL,
Kotlin host activity). To (re)generate the full platform scaffolding after
cloning:

```bash
flutter create --platforms=android --org dev.lodestar --project-name lodestar_mobile .
```

Then the committed files act as the source of truth overrides:

- `app/src/main/AndroidManifest.xml` — INTERNET permission, single-activity, Lobestar label
- `app/src/main/kotlin/dev/lodestar/mobile/MainActivity.kt` — Kotlin host (FlutterActivity)
- `app/build.gradle.kts` / `settings.gradle.kts` — AGP 8.5.2, Kotlin 1.9.24, minSdk 24, Java 17
- `gradle.properties` — AndroidX + jetifier

Release signing reads from environment variables so CI can inject secrets:

| Variable | Purpose |
| --- | --- |
| `LODESTAR_KEYSTORE` | keystore path |
| `LODESTAR_KEY_ALIAS` | key alias |
| `LODESTAR_KEY_PASSWORD` | keystore/key password |
