package dev.lodestar.mobile

import io.flutter.embedding.android.FlutterActivity

/**
 * Android host activity for the Lodestar on-call companion.
 * All app behaviour lives in the Dart layer (lib/); this host exists so the
 * platform channel plumbing (push notifications in the roadmap) has a
 * Kotlin entry point.
 */
class MainActivity : FlutterActivity()
