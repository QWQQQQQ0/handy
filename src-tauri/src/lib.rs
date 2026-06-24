mod commands;

use tauri::Manager;
use tauri::Emitter;
#[cfg(desktop)]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
#[cfg(desktop)]
use tauri::menu::{MenuBuilder, MenuItemBuilder};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // Force UTF-8 console output on Windows (avoids garbled Chinese text)
  #[cfg(windows)]
  let _ = unsafe { windows::Win32::System::Console::SetConsoleOutputCP(65001) };

  tauri::Builder::default()
    .plugin(tauri_plugin_sql::Builder::new().build())
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .manage(commands::bridge::BridgeState {
      bridge: std::sync::Arc::new(std::sync::Mutex::new(None)),
    })
    .invoke_handler(tauri::generate_handler![
      #[cfg(windows)] commands::screenshot::desktop_screenshot,
      #[cfg(windows)] commands::screenshot::screenshot_window,
      #[cfg(windows)] commands::screenshot::screenshot_window_region,
      #[cfg(windows)] commands::screenshot::get_screen_size,
      #[cfg(windows)] commands::input::desktop_click,
      #[cfg(windows)] commands::input::desktop_double_click,
      #[cfg(windows)] commands::input::desktop_right_click,
      #[cfg(windows)] commands::input::desktop_middle_click,
      #[cfg(windows)] commands::input::desktop_mouse_down,
      #[cfg(windows)] commands::input::desktop_mouse_up,
      #[cfg(windows)] commands::input::desktop_drag,
      #[cfg(windows)] commands::input::desktop_move_cursor,
      #[cfg(windows)] commands::input::desktop_type_text,
      #[cfg(windows)] commands::input::desktop_press_key,
      #[cfg(windows)] commands::input::desktop_key_down,
      #[cfg(windows)] commands::input::desktop_key_up,
      #[cfg(windows)] commands::input::desktop_scroll,
      #[cfg(windows)] commands::input::desktop_move_mouse,
      #[cfg(windows)] commands::input::desktop_get_clipboard,
      #[cfg(windows)] commands::input::desktop_set_clipboard,
      #[cfg(windows)] commands::window::desktop_list_windows,
      #[cfg(windows)] commands::window::desktop_focus_window,
      #[cfg(windows)] commands::window::get_window_bounds,
      #[cfg(windows)] commands::window::get_foreground_window_bounds,
      #[cfg(windows)] commands::window::restore_window,
      #[cfg(windows)] commands::window::desktop_minimize_window,
      #[cfg(windows)] commands::window::desktop_maximize_window,
      #[cfg(windows)] commands::window::desktop_close_window,
      #[cfg(windows)] commands::window::desktop_resize_window,
      #[cfg(windows)] commands::app::desktop_list_apps,
      #[cfg(windows)] commands::app::desktop_open_app,
      #[cfg(windows)] commands::app::desktop_find_app,
      #[cfg(windows)] commands::app::desktop_find_app_by_title,
      #[cfg(windows)] commands::app::desktop_refresh_apps,
      commands::bridge::uia_get_interactive,
      commands::bridge::uia_click,
      commands::bridge::uia_type_text,
      commands::bridge::uia_find_element,
      commands::bridge::uia_get_property,
      commands::bridge::uia_fingerprint,
      commands::bridge::uia_find_element_at_point,
      commands::bridge::web_launch,
      commands::bridge::web_connect_cdp,
      commands::bridge::web_navigate,
      commands::bridge::web_get_interactive,
      commands::bridge::ext_get_recorded_events,
      commands::bridge::ext_set_capture,
      commands::bridge::web_click_selector,
      commands::bridge::web_click_role,
      commands::bridge::web_fill,
      commands::bridge::web_scroll,
      commands::bridge::web_close,
      commands::bridge::web_launch_browser,
      commands::bridge::web_start_recording,
      commands::bridge::web_stop_recording,
      commands::bridge::web_get_recorded_events,
      commands::bridge::screenshot_full,
      commands::bridge::screenshot_region,
      commands::bridge::ocr_recognize,
      commands::bridge::word_generate,
      commands::bridge::excel_generate,
      commands::bridge::ppt_generate,
      commands::bridge::office_detect,
      commands::bridge::word_com_read,
      commands::bridge::word_com_edit,
      commands::bridge::excel_com_read,
      commands::bridge::excel_com_edit,
      commands::bridge::ppt_com_read,
      commands::bridge::ppt_com_edit,
      commands::bridge::web_search,
      commands::bridge::web_fetch,
      commands::bridge::doc_code_exec,
      commands::bridge::web_code_exec,
      commands::bridge::exec_python,
      #[cfg(windows)] commands::capture::capture_region,
      commands::image_process::visual_diff,
      commands::image_process::ocr_text_diff,
      commands::image_process::crop_image,
      commands::image_process::compress_to_jpeg,
      commands::image_process::extract_motion_region,
      commands::image_process::compress_uia_tree,
      commands::file_util::save_llm_images,
      commands::file_util::get_app_data_dir,
      commands::file_util::write_file,
      commands::file_util::read_file,
      commands::file_util::read_file_as_data_url,
      #[cfg(windows)] commands::global_listener::start_global_listener,
      #[cfg(windows)] commands::global_listener::stop_global_listener,
      #[cfg(windows)] commands::global_listener::is_global_listener_running,
      commands::bridge::global_listener_start,
      commands::bridge::global_listener_stop,
      commands::bridge::global_listener_poll,
      commands::bridge::event_collector_poll,
      commands::bridge::event_collector_start,
      commands::bridge::event_collector_stop,
      commands::bridge::prewarm_python_engine,
      commands::bridge::get_extension_status,
      // 全局状态管理
      commands::global_state::init_global_state,
      commands::global_state::get_global_state,
      commands::global_state::get_active_window_state,
      commands::global_state::get_current_task,
      commands::global_state::get_recent_agent_actions,
      commands::global_state::get_recent_changes,
      commands::global_state::record_input_event,
      commands::global_state::set_active_window,
      commands::global_state::set_current_task,
      commands::global_state::add_agent_action,
      commands::global_state::update_agent_action_status,
      commands::global_state::set_screenshot,
      commands::global_state::clear_global_state,
    ])
    .setup(|app| {
      // Build app index on startup (Windows only)
      #[cfg(windows)]
      std::thread::spawn(|| {
        commands::app_index::build_and_persist();
      });

      // Pre-warm Python engine so Chrome extension WebSocket (port 19840) is ready
      let handle = app.handle().clone();
      tauri::async_runtime::spawn(async move {
        // Small delay to let the window initialize first
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        match handle.emit("python-engine-status", "starting") {
          Ok(_) => {},
          Err(e) => eprintln!("[tauri] Failed to emit python-engine-status: {}", e),
        }
        // Call the prewarm command via the bridge
        let bridge_state = handle.try_state::<commands::bridge::BridgeState>();
        if let Some(state) = bridge_state {
          match commands::bridge::prewarm_python_engine(state).await {
            Ok(msg) => {
              eprintln!("[tauri] {}", msg);
              let _ = handle.emit("python-engine-status", "ready");
            },
            Err(e) => {
              eprintln!("[tauri] Python engine prewarm failed: {}", e);
              let _ = handle.emit("python-engine-status", "error");
            },
          }
        }
      });

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // ── 主窗口关闭拦截：X 按钮隐藏到托盘而非真正关闭 ──
      #[cfg(desktop)]
      if let Some(main_window) = app.get_webview_window("main") {
        let window = main_window.clone();
        main_window.on_window_event(move |event| {
          if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = window.hide();
          }
        });
      }

      // ── System tray (desktop only) ──
      #[cfg(desktop)]
      {
        let toggle_float_item = MenuItemBuilder::with_id("toggle_float", "Show / Hide Assistant")
          .build(app)?;
        let show_main_item = MenuItemBuilder::with_id("show_main", "Open Main Panel")
          .build(app)?;
        let quit_item = MenuItemBuilder::with_id("quit", "Quit Handy")
          .build(app)?;
        let tray_menu = MenuBuilder::new(app)
          .item(&toggle_float_item)
          .item(&show_main_item)
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
              "show_main" => {
                if let Some(main) = app.get_webview_window("main") {
                  let _ = main.show();
                  let _ = main.set_focus();
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
      }

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
