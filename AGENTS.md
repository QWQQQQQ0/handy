<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project rules

- When a change affects the project architecture or adds new files, update `docs/PROJECT.md` to keep the architecture documentation in sync.
- Static system prompts must not be hardcoded. Place them in `src/config/system-prompts.json` instead.

# Android 构建

## 环境设置

每次新窗口构建前，先加载环境变量：

```bash
source scripts/android-env.sh
```

否则 `rustup`、`cargo`、Android SDK 都找不到。

## 构建 Debug APK

```bash
npm run android:build:debug
```

输出：`src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`

## 关键注意事项

- **不要跑 `tsc`**：前端有类型错误，直接用 `npx vite build`
- **不要跑 `rustBuild*` Gradle 任务**：Tauri 的 `android-studio-script` 命令需要连接 Android Studio WebSocket，命令行必然失败。复用上次构建的 `.so` 文件，放在 `app/src/main/jniLibs/<arch>/libapp_lib.so`
- **Android SDK 位置异常**：`ANDROID_HOME` = `D:/software/android_studio/JDK`（虽然叫 JDK，实际上是 SDK）
- **Rust 路径已迁移**：`CARGO_HOME` = `C:/.cargo`，`RUSTUP_HOME` = `C:/.rustup`（从 `C:\Users\吴清\.rustup` 迁出，避免中文路径问题）

