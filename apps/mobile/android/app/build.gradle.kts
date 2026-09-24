import java.util.Properties

plugins {
    id("com.android.application")
    id("kotlin-android")
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "dev.lodestar.mobile"
    compileSdk = 34
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    defaultConfig {
        applicationId = "dev.lodestar.mobile"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
    }

    signingConfigs {
        create("release") {
            // CI injects these; local builds fall back to debug keys.
            storeFile = file(System.getenv("LODESTAR_KEYSTORE") ?: "debug.keystore")
            storePassword = System.getenv("LODESTAR_KEY_PASSWORD") ?: "android"
            keyAlias = System.getenv("LODESTAR_KEY_ALIAS") ?: "androiddebugkey"
            keyPassword = System.getenv("LODESTAR_KEY_PASSWORD") ?: "android"
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
            isShrinkResources = true
        }
    }
}

flutter {
    source = "../.."
}
