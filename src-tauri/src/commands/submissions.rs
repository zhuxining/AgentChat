use crate::host::RunnerConnection;
use crate::runner::{AttachmentReference, RunnerReply, RunnerRequest};
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn submit_with_attachments(
    runner: State<'_, RunnerConnection>,
    conversation_id: u64,
    text: String,
    request_id: String,
    attachments: Vec<AttachmentReference>,
) -> Result<RunnerReply, String> {
    let attachment_ids = attachments
        .iter()
        .map(|attachment| attachment.id.clone())
        .collect::<Vec<_>>();
    let request = RunnerRequest::Submit {
        conversation_id,
        text,
        request_id,
        attachments,
    };
    request.validate()?;
    let runner = runner.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let reply = runner.request(request)?;
        if submission_accepted(&reply.result)? && !attachment_ids.is_empty() {
            if let Err(error) = crate::host::data_dir().and_then(|data_dir| {
                crate::commands::attachments::delete_staged_ids(&data_dir, attachment_ids)
            }) {
                eprintln!("提交已接纳，但暂存附件清理失败：{error}");
            }
        }
        Ok(reply)
    })
    .await
    .map_err(|error| format!("提交任务失败：{error}"))?
}

fn submission_accepted(result: &Value) -> Result<bool, String> {
    let object = result
        .as_object()
        .ok_or_else(|| "Runner 返回无效的提交结果".to_owned())?;

    if object.len() == 2
        && object.get("rejected").and_then(Value::as_bool) == Some(true)
        && object
            .get("message")
            .and_then(Value::as_str)
            .is_some_and(|message| !message.trim().is_empty())
    {
        return Ok(false);
    }

    if object.len() == 1
        && object
            .get("id")
            .and_then(Value::as_u64)
            .is_some_and(|id| id > 0)
    {
        return Ok(true);
    }

    Err("Runner 返回无效的提交结果".to_owned())
}
