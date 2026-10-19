use crate::host::RunnerConnection;
use crate::runner::{RunnerReply, RunnerRequest};
use tauri::State;

#[tauri::command]
pub fn runtime_status() -> crate::runtime::RuntimeStatus {
    crate::runtime::detect()
}

#[tauri::command]
pub async fn install_runtime() -> Result<crate::runtime::RuntimeStatus, String> {
    tauri::async_runtime::spawn_blocking(crate::runtime::install)
        .await
        .map_err(|error| format!("Node 安装任务失败：{error}"))?
}

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
pub async fn start_runner(runner: State<'_, RunnerConnection>) -> Result<(), String> {
    let runner = runner.inner().clone();
    tauri::async_runtime::spawn_blocking(move || runner.start())
        .await
        .map_err(|error| format!("Runner 启动任务失败：{error}"))?
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
