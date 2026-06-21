#!/usr/bin/env bash
# Android 构建环境设置
# 用法: source scripts/android-env.sh

# Android SDK (实际路径在 JDK 目录下)
export ANDROID_HOME="D:/software/android_studio/JDK"
export ANDROID_SDK_ROOT="D:/software/android_studio/JDK"

# Java
export JAVA_HOME="C:/Program Files/Java/jdk17"

# Rust (已从 C:\Users\吴清\.rustup 迁移到 C:\.rustup 避免中文路径)
export RUSTUP_HOME="C:/.rustup"
export CARGO_HOME="C:/.cargo"

# Git Bash 自带工具 + Rust
export PATH="/d/software/Git/usr/bin:/d/software/Git/bin:/c/.cargo/bin:$PATH"

# NDK (可选，cargo-ndk 需要)
export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/28.2.13676358"

echo "[android-env] 环境已就绪"
echo "  ANDROID_HOME=$ANDROID_HOME"
echo "  RUSTUP_HOME=$RUSTUP_HOME"
echo "  CARGO_HOME=$CARGO_HOME"
