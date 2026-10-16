#[cfg(desktop)]
mod commands;
#[cfg(desktop)]
mod credentials;
#[cfg(desktop)]
mod runner;

#[cfg(desktop)]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(desktop)]
use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_websocket::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::runner_request,
            commands::set_provider_credential,
            commands::restart_runner
        ])
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let resource_dir = app.path().resource_dir()?;
            let (api_key, credential_warning) = credentials::effective_openai_api_key();
            app.manage(runner::RunnerState::new(
                data_dir.join("runner"),
                resource_dir,
                api_key,
                credential_warning,
            ));
            Ok(())
        });

    let app = builder
        .build(tauri::generate_context!())
        .expect("failed to build AgentChat");

    #[cfg(desktop)]
    {
        let exiting = std::sync::Arc::new(AtomicBool::new(false));
        app.run(move |handle, event| {
            if let RunEvent::ExitRequested { api, .. } = event {
                api.prevent_exit();
                if exiting.swap(true, Ordering::AcqRel) {
                    return;
                }
                let app_handle = handle.clone();
                std::thread::spawn(move || {
                    {
                        let runner = app_handle.state::<runner::RunnerState>();
                        runner.shutdown();
                    }
                    app_handle.exit(0);
                });
            }
        });
    }

    #[cfg(mobile)]
    app.run(|_, _| {});
}
