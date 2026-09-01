import org.jetbrains.intellij.plugins.gradle.IntellijPlugin
import org.jetbrains.kotlin.gradle.tasks.KotlinCompile

plugins {
    id("org.jetbrains.intellij") version "1.17.1"
    id("org.jetbrains.kotlin.jvm") version "1.9.22"
    id("org.jetbrains.kotlin.plugin.serialization") version "1.9.22"
}

group = "com.infinity.build"
version = "1.0.0-SNAPSHOT"

repositories {
    mavenCentral()
    maven("https://packages.jetbrains.team/maven/p/ij/intellij-dependencies")
    gradlePluginPortal()
}

dependencies {
    // IntelliJ Platform
    intellijPlatform(platforms.IJ)

    // Kotlin stdlib
    implementation(kotlin("stdlib-jdk8"))
    implementation(kotlin("reflect"))

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-swing:1.7.3")

    // Serialization
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.0")

    // HTTP Client (Ktor)
    implementation("io.ktor:ktor-client-core:2.3.8")
    implementation("io.ktor:ktor-client-cio:2.3.8")
    implementation("io.ktor:ktor-client-websockets:2.3.8")
    implementation("io.ktor:ktor-client-content-negotiation:2.3.8")
    implementation("io.ktor:ktor-serialization-kotlinx-json:2.3.8")

    // Logging
    implementation("org.slf4j:slf4j-api:2.0.9")
    implementation("ch.qos.logback:logback-classic:1.5.0")

    // Icons
    implementation("com.github.kwhat:jnativehook:2.2.2")

    // Testing
    testImplementation(kotlin("test"))
    testImplementation("org.junit.jupiter:junit-jupiter:5.10.1")
    testImplementation("org.mockito:mockito-core:5.11.0")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.7.3")
}

intellij {
    version.set("2023.1")
    type.set("IC") // IntelliJ IDEA Community

    // Support all IntelliJ-based IDEs
    plugins = listOf(
        "JavaScriptLanguage",   // WebStorm
        "PythonCore",           // PyCharm
        "org.jetbrains.kotlin", // IntelliJ
        "Go",                   // GoLand
        "com.intellij.rider",   // Rider
        "com.intellij.modules.platform",
        "com.intellij.modules.lang",
        "com.intellij.modules.java",
        "com.intellij.modules.vcs",
        "com.intellij.modules.terminal"
    )

    downloadSources.set(true)
    sandboxDirectory.set(File(project.buildDir, "sandbox"))
}

tasks.withType<KotlinCompile> {
    kotlinOptions {
        jvmTarget = "17"
        freeCompilerArgs = listOf(
            "-Xopt-in=kotlin.RequiresOptIn",
            "-Xopt-in=kotlinx.coroutines.ExperimentalCoroutinesApi",
            "-Xopt-in=io.ktor.util.ExperimentalKtorApi"
        )
    }
}

tasks.named("buildPlugin") {
    dependsOn("jar")
}

tasks.jar {
    manifest {
        attributes(
            "Implementation-Title" to "Infinity Build",
            "Implementation-Version" to project.version.toString(),
            "Implementation-Vendor" to "Infinity AI",
            "Main-Class" to "com.infinity.build.InfinityPlugin"
        )
    }
}

// Generate plugin.xml from template
tasks.register("generatePluginXml") {
    doLast {
        val pluginXml = project.file("src/main/resources/META-INF/plugin.xml")
        val content = pluginXml.readText()
            .replace("${project.version}", project.version.toString())
            .replace("${project.group}", project.group.toString())
        pluginXml.writeText(content)
    }
}

tasks.named("buildPlugin").configure {
    dependsOn("generatePluginXml")
}

// Run IDE for testing
tasks.register("runIde", org.jetbrains.intellij.plugins.gradle.tasks.RunIde::class) {
    ideDir.set(project.file("build/idea-sandbox"))
}

tasks.register("verifyPlugin", org.jetbrains.intellij.plugins.gradle.tasks.VerifyPlugin::class)