# iOS platform

Regenerate scaffolding after cloning:

```bash
flutter create --platforms=ios --org dev.lodestar --project-name lodestar_mobile .
```

The repo tracks `ios/Runner/Info.plist` as the curated override (display
name, orientations, ATS local-networking exception for the sandbox gateway).
