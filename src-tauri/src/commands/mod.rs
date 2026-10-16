use crate::credentials;
use crate::runner::{RunnerReply, RunnerRequest, RunnerState};
use serde::Serialize;
use serde_json::Value;
use tauri::{Manager, State};

#[tauri::command]
pub async fn runner_request(
    runner: State<'_, RunnerState>,
    request: RunnerRequest,
) -> Result<RunnerReply, String> {
    if matches!(
        &request,
        RunnerRequest::Close | RunnerRequest::SetProviderCredential { .. }
    ) {
        return Err("此 Runner 操作仅允许由桌面宿主发起".to_owned());
    }
    request.validate()?;
    let process = runner.process()?;
    let is_initialize = matches!(&request, RunnerRequest::Initialize);
    let credential_warning = runner.credential_warning();
    let mut reply = tauri::async_runtime::spawn_blocking(move || process.request(request))
        .await
        .map_err(|error| format!("Runner IPC 任务失败：{error}"))??;
    if is_initialize {
        if let Some(warning) = &credential_warning {
            if let Value::Object(result) = &mut reply.result {
                result.insert(
                    "credentialWarning".to_owned(),
                    Value::String(warning.clone()),
                );
            }
        }
    }
    Ok(reply)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCredentialReply {
    configured: bool,
    runner_updated: bool,
}

#[tauri::command]
pub async fn set_provider_credential(
    runner: State<'_, RunnerState>,
    api_key: Option<String>,
) -> Result<ProviderCredentialReply, String> {
    let api_key = api_key
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    if api_key.as_ref().is_some_and(|value| value.len() > 8_000) {
        return Err("Provider 凭据长度超出限制".to_owned());
    }

    let persisted_key = api_key.clone();
    tauri::async_runtime::spawn_blocking(move || {
        credentials::write_openai_api_key(persisted_key.as_deref())
    })
    .await
    .map_err(|error| format!("系统凭据存储任务失败：{error}"))??;
    runner.clear_credential_warning();

    let runner_key = api_key
        .clone()
        .or_else(|| std::env::var("OPENAI_API_KEY").ok());
    let configured = runner_key.is_some();
    let Ok(process) = runner.process() else {
        return Ok(ProviderCredentialReply {
            configured,
            runner_updated: false,
        });
    };
    let updated = tauri::async_runtime::spawn_blocking(move || {
        process.request(RunnerRequest::SetProviderCredential {
            api_key: runner_key,
        })
    })
    .await
    .map_err(|error| format!("Runner 凭据更新任务失败：{error}"))?;
    match updated {
        Ok(reply) => Ok(ProviderCredentialReply {
            configured: reply
                .result
                .get("configured")
                .and_then(Value::as_bool)
                .unwrap_or(configured),
            runner_updated: true,
        }),
        Err(_) => Ok(ProviderCredentialReply {
            configured,
            runner_updated: false,
        }),
    }
}

#[tauri::command]
pub async fn restart_runner(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (api_key, credential_warning) = credentials::effective_openai_api_key();
        let runner = app.state::<RunnerState>();
        runner.restart(api_key)?;
        runner.set_credential_warning(credential_warning);
        Ok(())
    })
    .await
    .map_err(|error| format!("Runner 重启任务失败：{error}"))?
}
