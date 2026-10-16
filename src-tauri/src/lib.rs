#[cfg(desktop)]
mod commands;
#[cfg(desktop)]
mod credentials;
#[cfg(desktop)]
mod host;
#[cfg(desktop)]
mod runner;

#[cfg(desktop)]
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(desktop)]
    if let Some(result) = host::run_if_host() {
        if let Err(error) = result {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
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
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        & !tauri_plugin_window_state::StateFlags::DECORATIONS,
                )
                .build(),
        )
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::runner_request,
            commands::set_provider_credential,
            commands::restart_runner,
            commands::stop_runner
        ])
        .setup(|app| {
            let data_dir = host::data_dir().map_err(std::io::Error::other)?;
            let connection = host::RunnerConnection::new(data_dir, app.path().resource_dir()?);
            // Startup failure remains repairable through restart_runner; UI still opens.
            if let Err(error) = connection.start() {
                eprintln!("{error}");
            }
            app.manage(connection);
            Ok(())
        });

    let app = builder
        .build(tauri::generate_context!())
        .expect("failed to build AgentChat");

    app.run(|_, _| {});
}
