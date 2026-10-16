use crate::host::RunnerConnection;
use crate::runner::{RunnerReply, RunnerRequest};
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn runner_request(
    runner: State<'_, RunnerConnection>,
    request: RunnerRequest,
) -> Result<RunnerReply, String> {
    let runner = runner.inner().clone();
    tauri::async_runtime::spawn_blocking(move || runner.request(request))
        .await
        .map_err(|error| format!("Runner IPC 任务失败：{error}"))?
}

#[tauri::command]
pub async fn set_provider_credential(
    runner: State<'_, RunnerConnection>,
    api_key: Option<String>,
) -> Result<Value, String> {
    let runner = runner.inner().clone();
    tauri::async_runtime::spawn_blocking(move || runner.set_credential(api_key))
        .await
        .map_err(|error| format!("Runner 凭据任务失败：{error}"))?
}

#[tauri::command]
pub async fn stop_runner(runner: State<'_, RunnerConnection>) -> Result<(), String> {
    let runner = runner.inner().clone();
    tauri::async_runtime::spawn_blocking(move || runner.stop())
        .await
        .map_err(|error| format!("Runner 停止任务失败：{error}"))?
}

#[tauri::command]
pub async fn restart_runner(runner: State<'_, RunnerConnection>) -> Result<(), String> {
    let runner = runner.inner().clone();
    tauri::async_runtime::spawn_blocking(move || runner.restart())
        .await
        .map_err(|error| format!("Runner 重启任务失败：{error}"))?
}
