import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(FileInputStream(keystorePropertiesFile))
}

fun signingValue(name: String, envName: String): String? {
    return (keystoreProperties[name] as String?) ?: System.getenv(envName)
}

val releaseStoreFile = signingValue("storeFile", "OPENLEASH_ANDROID_KEYSTORE")
val hasReleaseSigning = !releaseStoreFile.isNullOrBlank() &&
    !signingValue("storePassword", "OPENLEASH_ANDROID_KEYSTORE_PASSWORD").isNullOrBlank() &&
    !signingValue("keyAlias", "OPENLEASH_ANDROID_KEY_ALIAS").isNullOrBlank() &&
    !signingValue("keyPassword", "OPENLEASH_ANDROID_KEY_PASSWORD").isNullOrBlank()

android {
    namespace = "com.openleash.mobile"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.openleash.mobile"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        create("release") {
            if (hasReleaseSigning) {
                storeFile = file(releaseStoreFile!!)
                storePassword = signingValue("storePassword", "OPENLEASH_ANDROID_KEYSTORE_PASSWORD")
                keyAlias = signingValue("keyAlias", "OPENLEASH_ANDROID_KEY_ALIAS")
                keyPassword = signingValue("keyPassword", "OPENLEASH_ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }
}

flutter {
    source = "../.."
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")
}
