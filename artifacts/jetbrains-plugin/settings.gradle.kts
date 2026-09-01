pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
        maven("https://packages.jetbrains.team/maven/p/ij/intellij-dependencies")
    }
    resolutionStrategy {
        eachPlugin {
            if (requested.id.id == "org.jetbrains.intellij") {
                useModule("org.jetbrains.intellij.plugins:gradle-intellij-plugin:1.19.0")
            }
        }
    }
}

rootProject.name = "infinity-build-plugin"