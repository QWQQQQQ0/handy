mod commands;

use tauri::Manager;
use tauri::Emitter;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::menu::{MenuBuilder, MenuItemBuilder};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_sql::Builder::new().build())
    .plugin(tauri_plugin_shell::init())
    .invoke_handler(tauri::generate_handler![
      commands::screenshot::desktop_screenshot,
      commands::input::desktop_click,
      commands::input::desktop_double_click,
      commands::input::desktop_right_click,
      commands::input::desktop_type_text,
      commands::input::desktop_press_key,
      commands::input::desktop_scroll,
      commands::input::desktop_move_mouse,
      commands::window::desktop_list_windows,
      commands::window::desktop_focus_window,
      commands::app::desktop_list_apps,
      commands::app::desktop_open_app,
      commands::app::desktop_refresh_apps,
    ])
    .setup(|app| {
      // Build app index on startup (background, non-blocking)
      std::thread::spawn(|| {
        commands::app_index::build_and_persist();
      });

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // ── System tray ──
      let toggle_item = MenuItemBuilder::with_id("toggle_float", "Show / Hide Assistant")
        .build(app)?;
      let quit_item = MenuItemBuilder::with_id("quit", "Quit OpenPaw")
        .build(app)?;
      let tray_menu = MenuBuilder::new(app)
        .item(&toggle_item)
        .separator()
        .item(&quit_item)
        .build()?;

      let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().cloned().unwrap())
        .menu(&tray_menu)
        .on_menu_event(|app, event| {
          match event.id().as_ref() {
            "toggle_float" => {
              if let Some(main) = app.get_webview_window("main") {
                let _ = main.emit("tray-toggle-float", ());
              }
            }
            "quit" => {
              app.exit(0);
            }
            _ => {}
          }
        })
        .on_tray_icon_event(|tray, event| {
          if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
          } = event
          {
            if let Some(main) = tray.app_handle().get_webview_window("main") {
              let _ = main.emit("tray-toggle-float", ());
            }
          }
        })
        .build(app)?;

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
