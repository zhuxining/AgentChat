use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum RunnerRequest {
    Initialize,
    ReloadConfiguration,
    ReadConfiguration {
        path: String,
    },
    SaveConfiguration {
        path: String,
        version: String,
        content: String,
    },
    CreateBot {
        name: String,
        model_id: String,
        provider: String,
        instructions: String,
        cwd: String,
        thinking_level: String,
        extensions: Vec<String>,
        tools: Vec<String>,
    },
    UpdateBot {
        bot_id: String,
        config_version: String,
        name: String,
        model_id: String,
        provider: String,
        instructions: String,
        cwd: String,
        thinking_level: String,
        extensions: Vec<String>,
        tools: Vec<String>,
    },
    ArchiveBot {
        bot_id: String,
        config_version: String,
    },
    CreateConversation {
        bot_id: String,
        cwd: String,
        goal: String,
    },
    ApplyBotSettings {
        conversation_id: u64,
    },
    SaveGoal {
        conversation_id: u64,
        description: String,
    },
    SetGoalStatus {
        conversation_id: u64,
        status: String,
    },
    Submit {
        conversation_id: u64,
        text: String,
        request_id: String,
    },
    AbortSubmission {
        conversation_id: u64,
        submission_id: u64,
    },
    Snapshot {
        conversation_id: u64,
    },
    Abort {
        conversation_id: u64,
    },
    ProviderRequest {
        request: Value,
    },
    SetProviderCredential {
        api_key: Option<String>,
    },
    Close,
}

impl RunnerRequest {
    pub fn validate(&self) -> Result<(), String> {
        let valid_text = |value: &str, max: usize| value.len() <= max;
        if let Self::CreateBot { provider, .. } | Self::UpdateBot { provider, .. } = self {
            if provider.trim().is_empty() || provider.len() > 480 {
                return Err("Provider 名称无效".to_owned());
            }
        }
        if let Self::UpdateBot { config_version, .. } = self {
            if config_version.is_empty() || config_version.len() > 256 {
                return Err("配置版本无效".to_owned());
            }
        }
        let valid_bot = |name: &str,
                         model_id: &str,
                         instructions: &str,
                         cwd: &str,
                         thinking_level: &str,
                         extensions: &[String],
                         tools: &[String]| {
            if name.trim().is_empty()
                || !valid_text(name, 320)
                || model_id.trim().is_empty()
                || !valid_text(model_id, 480)
            {
                return Err("Bot 名称或模型无效".to_owned());
            }
            if !valid_text(instructions, 32_000)
                || !valid_text(cwd, 8_000)
                || !["minimal", "low", "medium", "high", "xhigh"].contains(&thinking_level)
                || extensions.len() > 30
                || tools.len() > 100
                || extensions
                    .iter()
                    .chain(tools)
                    .any(|value| value.trim().is_empty() || !valid_text(value, 480))
            {
                return Err("Bot 配置无效或过长".to_owned());
            }
            if extensions
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len()
                != extensions.len()
                || tools.iter().collect::<std::collections::HashSet<_>>().len() != tools.len()
            {
                return Err("Extension 或 Tool 不能重复".to_owned());
            }
            Ok(())
        };
        match self {
            Self::CreateBot {
                name,
                model_id,
                instructions,
                cwd,
                thinking_level,
                extensions,
                tools,
                ..
            } => valid_bot(
                name,
                model_id,
                instructions,
                cwd,
                thinking_level,
                extensions,
                tools,
            )?,
            Self::UpdateBot {
                bot_id,
                name,
                model_id,
                instructions,
                cwd,
                thinking_level,
                extensions,
                tools,
                ..
            } => {
                if bot_id.trim().is_empty() || !valid_text(bot_id, 400) {
                    return Err("Bot ID 无效".to_owned());
                }
                valid_bot(
                    name,
                    model_id,
                    instructions,
                    cwd,
                    thinking_level,
                    extensions,
                    tools,
                )?;
            }
            Self::ArchiveBot {
                bot_id,
                config_version,
            } => {
                if bot_id.trim().is_empty()
                    || !valid_text(bot_id, 400)
                    || config_version.is_empty()
                    || config_version.len() > 256
                {
                    return Err("Bot ID 或配置版本无效".to_owned());
                }
            }
            Self::CreateConversation { bot_id, cwd, goal } => {
                if bot_id.trim().is_empty() || !valid_text(bot_id, 400) {
                    return Err("Bot ID 无效".to_owned());
                }
                if !valid_text(cwd, 8_000) || !valid_text(goal, 32_000) {
                    return Err("Conversation 配置过长".to_owned());
                }
            }
            Self::SaveGoal { description, .. } => {
                if !valid_text(description, 32_000) {
                    return Err("工作目标描述过长".to_owned());
                }
            }
            Self::SetGoalStatus { status, .. } => {
                if status != "open" && status != "completed" {
                    return Err("工作目标状态无效".to_owned());
                }
            }
            Self::Submit {
                text, request_id, ..
            } => {
                if text.trim().is_empty()
                    || !valid_text(text, 64_000)
                    || request_id.trim().is_empty()
                    || !valid_text(request_id, 400)
                {
                    return Err("输入或请求 ID 无效".to_owned());
                }
            }
            Self::ProviderRequest { request } => {
                let action = request.get("action").and_then(Value::as_str);
                if !request.is_object()
                    || !action.is_some_and(|action| {
                        [
                            "list",
                            "save",
                            "remove",
                            "test",
                            "writeCredential",
                            "deleteCredential",
                            "login",
                            "loginStatus",
                            "loginRespond",
                            "cancelLogin",
                            "logout",
                            "refreshModels",
                        ]
                        .contains(&action)
                    })
                    || serde_json::to_vec(request).map_or(true, |value| value.len() > 900_000)
                {
                    return Err("Provider 操作无效或超过大小限制".to_owned());
                }
            }
            Self::SetProviderCredential { api_key } => {
                if api_key
                    .as_ref()
                    .is_some_and(|key| key.trim().is_empty() || !valid_text(key, 8_000))
                {
                    return Err("Provider 凭据无效".to_owned());
                }
            }
            Self::ReadConfiguration { path } | Self::SaveConfiguration { path, .. } => {
                if path.is_empty() || !valid_text(path, 8_000) {
                    return Err("配置路径无效".to_owned());
                }
                if let Self::SaveConfiguration {
                    version, content, ..
                } = self
                {
                    if version.is_empty() || version.len() > 256 || content.len() > 900_000 {
                        return Err("配置版本或内容无效".to_owned());
                    }
                }
            }
            Self::Initialize
            | Self::ReloadConfiguration
            | Self::ApplyBotSettings { .. }
            | Self::AbortSubmission { .. }
            | Self::Snapshot { .. }
            | Self::Abort { .. }
            | Self::Close => {}
        }
        Ok(())
    }
}

#[derive(Serialize)]
struct WireRequest {
    id: u64,
    #[serde(flatten)]
    request: RunnerRequest,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireResponse {
    id: u64,
    ok: bool,
    result: Option<Value>,
    error: Option<String>,
}

impl WireResponse {
    fn into_result(self) -> Result<(u64, Result<Value, String>), String> {
        if self.id == 0 {
            return Err("Runner 响应 ID 无效".to_owned());
        }
        let result = match (self.ok, self.result, self.error) {
            (true, Some(result), None) => Ok(result),
            (false, None, Some(error)) if !error.is_empty() => Err(error),
            _ => return Err("Runner 响应字段不符合协议".to_owned()),
        };
        Ok((self.id, result))
    }
}

#[derive(Debug, Deserialize, Serialize)]
pub struct RunnerReply {
    pub result: Value,
}

type Pending = Arc<Mutex<HashMap<u64, mpsc::Sender<Result<Value, String>>>>>;

#[derive(Clone)]
pub struct RunnerProcess {
    stdin: Arc<Mutex<ChildStdin>>,
    child: Arc<Mutex<Child>>,
    pending: Pending,
    next_id: Arc<AtomicU64>,
    closed: Arc<AtomicBool>,
    shutdown_started: Arc<AtomicBool>,
}

impl RunnerProcess {
    pub fn spawn(
        data_dir: &Path,
        resource_dir: &Path,
        api_key: Option<String>,
    ) -> Result<Self, String> {
        std::fs::create_dir_all(data_dir)
            .map_err(|error| format!("创建 Runner 数据目录失败：{error}"))?;
        let entry = runner_entry(resource_dir)?;
        let node = crate::runtime::require_ready()?;
        let mut command = Command::new(node);
        command
            .arg(&entry)
            .arg("--native-rpc")
            .arg("--data-dir")
            .arg(data_dir)
            .env_remove("DEEPSEEK_API_KEY")
            .env_remove("OPENAI_API_KEY")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        Self::spawn_command(&mut command, api_key, data_dir)
    }

    pub(crate) fn spawn_command(
        command: &mut Command,
        api_key: Option<String>,
        data_dir: &Path,
    ) -> Result<Self, String> {
        let mut child = command
            .spawn()
            .map_err(|error| format!("启动 Node Runner 失败：{error}"))?;
        let stdin = child.stdin.take().ok_or("Runner 标准输入不可用")?;
        let stdout = child.stdout.take().ok_or("Runner 标准输出不可用")?;
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            // Nonblocking pipes keep a stalled Node process from blocking host shutdown.
            let fd = stdin.as_raw_fd();
            let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
            if flags == -1
                || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } == -1
            {
                let error = std::io::Error::last_os_error();
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("设置 Runner 输入通道失败：{error}"));
            }
        }
        let stdin = Arc::new(Mutex::new(stdin));
        let stdin_reader = Arc::clone(&stdin);
        let credential_dir = data_dir.to_owned();
        let pending: Pending = Arc::default();
        let closed = Arc::new(AtomicBool::new(false));
        let pending_reader = Arc::clone(&pending);
        let closed_reader = Arc::clone(&closed);
        let reader = thread::Builder::new()
            .name("agentchat-runner-reader".to_owned())
            .spawn(move || {
                read_responses(
                    stdout,
                    pending_reader,
                    closed_reader,
                    stdin_reader,
                    credential_dir,
                )
            });
        if let Err(error) = reader {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("启动 Runner 响应读取线程失败：{error}"));
        }

        let process = Self {
            stdin,
            child: Arc::new(Mutex::new(child)),
            pending,
            next_id: Arc::new(AtomicU64::new(1)),
            closed,
            shutdown_started: Arc::new(AtomicBool::new(false)),
        };
        if let Some(api_key) = api_key {
            if let Err(error) = process.request(RunnerRequest::SetProviderCredential {
                api_key: Some(api_key),
            }) {
                process.shutdown();
                return Err(format!("向 Runner 传递 Provider 凭据失败：{error}"));
            }
        }
        Ok(process)
    }

    pub fn request(&self, request: RunnerRequest) -> Result<RunnerReply, String> {
        self.request_inner(request, false, Duration::from_secs(120))
    }

    fn request_inner(
        &self,
        request: RunnerRequest,
        allow_closing: bool,
        timeout: Duration,
    ) -> Result<RunnerReply, String> {
        if self.closed.load(Ordering::Acquire) && !allow_closing {
            return Err("Runner 已关闭".to_owned());
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = mpsc::channel();
        {
            let mut pending = self
                .pending
                .lock()
                .map_err(|_| "Runner 响应队列不可用".to_owned())?;
            if pending.len() >= 64 {
                return Err("Runner 请求过多，请稍后重试".to_owned());
            }
            pending.insert(id, sender);
        }

        let message = match serde_json::to_vec(&WireRequest { id, request }) {
            Ok(message) => message,
            Err(error) => {
                self.remove_pending(id);
                return Err(format!("编码 Runner 请求失败：{error}"));
            }
        };
        if message.len() >= 1_048_576 {
            self.remove_pending(id);
            return Err("Runner 请求超过大小限制".to_owned());
        }
        let write_result = self.write_message(&message, allow_closing);
        if let Err(error) = write_result {
            self.closed.store(true, Ordering::Release);
            self.fail_pending("Runner 输入通道已失效".to_owned());
            return Err(error);
        }

        let result = match receiver.recv_timeout(timeout) {
            Ok(result) => result?,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.remove_pending(id);
                return Err("等待 Runner 响应超时".to_owned());
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                self.remove_pending(id);
                return Err("Runner 响应通道已关闭".to_owned());
            }
        };
        Ok(RunnerReply { result })
    }

    fn write_message(&self, message: &[u8], allow_closing: bool) -> Result<(), String> {
        write_frame(&self.stdin, &self.closed, message, allow_closing)
    }

    pub fn shutdown(&self) {
        if self.shutdown_started.swap(true, Ordering::AcqRel) {
            return;
        }
        let already_closed = self.closed.swap(true, Ordering::AcqRel);
        let deadline = Instant::now() + Duration::from_secs(10);
        if !already_closed {
            let close_request =
                self.request_inner(RunnerRequest::Close, true, Duration::from_secs(5));
            if close_request.is_err() {
                self.fail_pending("Runner 正在关闭".to_owned());
            }
            while Instant::now() < deadline {
                let status = {
                    let Ok(mut child) = self.child.lock() else {
                        break;
                    };
                    child.try_wait()
                };
                match status {
                    Ok(Some(_)) => return,
                    Ok(None) => thread::sleep(Duration::from_millis(25)),
                    Err(_) => break,
                }
            }
        }
        eprintln!("Runner 未能正常收尾，终止失效的子进程；下次启动由 Harness 检查恢复状态");
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    fn remove_pending(&self, id: u64) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(&id);
        }
    }

    fn fail_pending(&self, error: String) {
        if let Ok(mut pending) = self.pending.lock() {
            for (_, sender) in pending.drain() {
                let _ = sender.send(Err(error.clone()));
            }
        }
    }
}

fn write_frame(
    input: &Mutex<ChildStdin>,
    closed: &AtomicBool,
    message: &[u8],
    allow_closing: bool,
) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut stdin = loop {
        match input.try_lock() {
            Ok(stdin) => break stdin,
            Err(std::sync::TryLockError::Poisoned(_)) => {
                return Err("Runner 输入通道不可用".to_owned())
            }
            Err(std::sync::TryLockError::WouldBlock) if Instant::now() < deadline => {
                thread::sleep(Duration::from_millis(5))
            }
            Err(_) => return Err("等待 Runner 输入通道超时".to_owned()),
        }
    };
    if closed.load(Ordering::Acquire) && !allow_closing {
        return Err("Runner 已关闭".to_owned());
    }
    let mut frame = message.to_vec();
    frame.push(b'\n');
    let mut remaining = frame.as_slice();
    while !remaining.is_empty() {
        if Instant::now() >= deadline {
            return Err("发送 Runner 请求超时".to_owned());
        }
        match stdin.write(remaining) {
            Ok(0) => return Err("Runner 输入通道已关闭".to_owned()),
            Ok(written) => remaining = &remaining[written..],
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(5))
            }
            Err(error) => return Err(format!("发送 Runner 请求失败：{error}")),
        }
    }
    Ok(())
}

fn runner_entry(resource_dir: &Path) -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("AGENTCHAT_RUNNER_ENTRY") {
        return Ok(PathBuf::from(path));
    }
    let packaged = resource_dir.join("runner").join("entry.js");
    if packaged.is_file() {
        return Ok(packaged);
    }
    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../runner/dist/entry.js");
    if development.is_file() {
        return Ok(development);
    }
    Err("Runner 尚未构建，请先运行根目录 build 命令".to_owned())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NativeRequest {
    native_id: u64,
    method: String,
    params: Value,
}

fn native_response(data_dir: &Path, frame: Value) -> Result<Value, String> {
    let native_id = frame
        .get("nativeId")
        .and_then(Value::as_u64)
        .filter(|id| *id > 0 && *id <= 9_007_199_254_740_991)
        .ok_or("内部凭据请求 ID 无效")?;
    let result = match serde_json::from_value::<NativeRequest>(frame) {
        Ok(request) if request.native_id == native_id && request.params.is_object() => {
            crate::credentials::native_request(data_dir, &request.method, request.params)
        }
        _ => Err("内部凭据请求格式无效".to_owned()),
    };
    Ok(match result {
        Ok(result) => serde_json::json!({"nativeId":native_id,"ok":true,"result":result}),
        Err(error) => serde_json::json!({"nativeId":native_id,"ok":false,"error":error}),
    })
}

fn read_responses(
    stdout: impl std::io::Read,
    pending: Pending,
    closed: Arc<AtomicBool>,
    stdin: Arc<Mutex<ChildStdin>>,
    data_dir: PathBuf,
) {
    let mut reader = BufReader::new(stdout);
    loop {
        let line = match read_bounded_line(&mut reader) {
            Ok(Some(line)) => line,
            Ok(None) => break,
            Err(error) => {
                closed.store(true, Ordering::Release);
                fail_waiters(&pending, format!("Runner 协议读取失败：{error}"));
                return;
            }
        };
        let frame = match serde_json::from_slice::<Value>(&line) {
            Ok(frame) => frame,
            Err(_) => {
                closed.store(true, Ordering::Release);
                fail_waiters(&pending, "Runner 返回了无效协议消息".to_owned());
                return;
            }
        };
        if frame.get("nativeId").is_some() {
            let response = native_response(&data_dir, frame)
                .and_then(|response| {
                    serde_json::to_vec(&response).map_err(|_| "内部凭据响应编码失败".to_owned())
                })
                // Closing still allows the child's final credential persistence.
                .and_then(|message| write_frame(&stdin, &closed, &message, true));
            if response.is_err() {
                closed.store(true, Ordering::Release);
                fail_waiters(&pending, "Runner 内部凭据通道已失效".to_owned());
                return;
            }
            continue;
        }
        let response = match serde_json::from_value::<WireResponse>(frame) {
            Ok(response) => response,
            Err(_) => {
                closed.store(true, Ordering::Release);
                fail_waiters(&pending, "Runner 返回了无效协议消息".to_owned());
                return;
            }
        };
        let (response_id, result) = match response.into_result() {
            Ok(response) => response,
            Err(error) => {
                closed.store(true, Ordering::Release);
                fail_waiters(&pending, error);
                return;
            }
        };
        let Ok(mut pending) = pending.lock() else {
            return;
        };
        if let Some(sender) = pending.remove(&response_id) {
            let _ = sender.send(result);
        }
    }
    closed.store(true, Ordering::Release);
    fail_waiters(&pending, "Runner 已断开".to_owned());
}

pub(crate) fn read_bounded_line(reader: &mut impl BufRead) -> std::io::Result<Option<Vec<u8>>> {
    const MAX_LINE_BYTES: usize = 1_048_576;
    let mut line = Vec::new();
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return if line.is_empty() {
                Ok(None)
            } else {
                Err(std::io::Error::new(
                    std::io::ErrorKind::UnexpectedEof,
                    "incomplete protocol frame",
                ))
            };
        }
        let consumed = available
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(available.len(), |index| index + 1);
        if line.len() + consumed > MAX_LINE_BYTES {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "message exceeds size limit",
            ));
        }
        let complete = available.get(consumed.saturating_sub(1)) == Some(&b'\n');
        line.extend_from_slice(&available[..consumed]);
        reader.consume(consumed);
        if complete {
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            return Ok(Some(line));
        }
    }
}

fn fail_waiters(pending: &Pending, error: String) {
    if let Ok(mut pending) = pending.lock() {
        for (_, sender) in pending.drain() {
            let _ = sender.send(Err(error.clone()));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn accepts_a_complete_crlf_frame() {
        let mut input = Cursor::new(b"{\"id\":1}\r\n".to_vec());
        assert_eq!(
            read_bounded_line(&mut input).unwrap(),
            Some(b"{\"id\":1}".to_vec())
        );
    }

    #[test]
    fn rejects_an_incomplete_frame_at_eof() {
        let mut input = Cursor::new(b"{\"id\":1}".to_vec());
        assert_eq!(
            read_bounded_line(&mut input).unwrap_err().kind(),
            std::io::ErrorKind::UnexpectedEof
        );
    }

    #[test]
    fn rejects_frames_over_the_byte_limit() {
        let mut input = Cursor::new(vec![b'x'; 1_048_577]);
        assert_eq!(
            read_bounded_line(&mut input).unwrap_err().kind(),
            std::io::ErrorKind::InvalidData
        );
    }

    #[test]
    fn serializes_requests_with_the_frontend_wire_names() {
        let request = WireRequest {
            id: 7,
            request: RunnerRequest::CreateBot {
                name: "助手".to_owned(),
                model_id: "test-model".to_owned(),
                provider: "deepseek".to_owned(),
                instructions: "".to_owned(),
                cwd: "".to_owned(),
                thinking_level: "medium".to_owned(),
                extensions: vec!["coding-tools".to_owned()],
                tools: vec!["read".to_owned()],
            },
        };
        let value = serde_json::to_value(request).unwrap();
        assert_eq!(value["id"], 7);
        assert_eq!(value["op"], "createBot");
        assert_eq!(value["modelId"], "test-model");
    }

    #[test]
    fn provider_request_allows_only_public_actions() {
        for action in [
            "list",
            "save",
            "remove",
            "test",
            "writeCredential",
            "deleteCredential",
            "login",
            "loginStatus",
            "loginRespond",
            "cancelLogin",
            "logout",
            "refreshModels",
        ] {
            let request: RunnerRequest = serde_json::from_value(serde_json::json!({
                "op":"providerRequest", "request":{"action":action}
            }))
            .unwrap();
            assert!(request.validate().is_ok(), "{action}");
            assert_eq!(
                serde_json::to_value(request).unwrap()["op"],
                "providerRequest"
            );
        }
        for request in [
            Value::Null,
            serde_json::json!({}),
            serde_json::json!({"action":"readCredential"}),
            serde_json::json!({"action":"env"}),
            serde_json::json!({"action":7}),
            serde_json::json!({"action":"save", "extra":"x".repeat(900_000)}),
        ] {
            assert!(RunnerRequest::ProviderRequest { request }
                .validate()
                .is_err());
        }
    }

    #[test]
    fn native_frames_reject_unknown_fields_methods_and_invalid_ids_without_leaking_params() {
        let root = Path::new("/unused");
        for native_id in [
            Value::Null,
            serde_json::json!(0),
            serde_json::json!(-1),
            serde_json::json!(9_007_199_254_740_992u64),
        ] {
            assert!(native_response(
                root,
                serde_json::json!({"nativeId":native_id,"method":"env","params":{"name":"HOME"}})
            )
            .is_err());
        }
        for frame in [
            serde_json::json!({"nativeId":1,"method":"readSecret","params":{"key":"private-value"}}),
            serde_json::json!({"nativeId":1,"method":"env","params":{"name":"INVALID=private-value"}}),
            serde_json::json!({"nativeId":1,"method":"env","params":[],"unexpected":"private-value"}),
        ] {
            let response = native_response(root, frame).unwrap();
            assert_eq!(response["ok"], false);
            assert_eq!(response["nativeId"], 1);
            assert!(!response.to_string().contains("private-value"));
        }
    }

    #[test]
    fn native_startup_and_interleaved_requests_survive_a_request_timeout() {
        static NEXT_TEST: AtomicU64 = AtomicU64::new(1);
        let directory = std::env::temp_dir().join(format!(
            "agentchat-native-pipe-{}-{}",
            std::process::id(),
            NEXT_TEST.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir(&directory).unwrap();
        let script = r#"
const readline = require('node:readline');
const waiting = new Map(); let nextNative = 1;
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
const native = (method, params) => new Promise(resolve => {
  const nativeId = nextNative++; waiting.set(nativeId, resolve);
  send({nativeId, method, params});
});
const source = {type:'file',path:'credentials/providers.json',entry:'instance'};
const startup = native('writeCredential', {source, credential:{type:'api_key',key:'test-key'}});
readline.createInterface({input:process.stdin}).on('line', async line => {
  const request = JSON.parse(line);
  if (request.nativeId) { const resolve = waiting.get(request.nativeId); waiting.delete(request.nativeId); resolve(request); return; }
  if (request.op === 'close') { send({id:request.id,ok:true,result:{closed:true}}); process.exit(0); }
  await startup;
  const value = await native('readCredential', {source});
  const denied = await native('deleteCredential', {source:{type:'env',variable:'HOME'}});
  const reply = () => send({id:request.id,ok:true,result:{nativeOk:value.ok,key:value.result.key,denied:!denied.ok}});
  if (request.op === 'submit') setTimeout(reply, 50); else reply();
});
"#;
        let mut command = Command::new("node");
        command
            .arg("-e")
            .arg(script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        let process = RunnerProcess::spawn_command(&mut command, None, &directory).unwrap();
        let initialized = process.request(RunnerRequest::Initialize).unwrap().result;
        assert_eq!(initialized["key"], "test-key");
        assert_eq!(initialized["denied"], true);
        assert!(process
            .request_inner(
                RunnerRequest::Submit {
                    conversation_id: 1,
                    text: "delayed".to_owned(),
                    request_id: "delayed".to_owned(),
                },
                false,
                Duration::from_millis(10)
            )
            .is_err());
        let mut callers = Vec::new();
        for id in 0..16 {
            let process = process.clone();
            callers.push(thread::spawn(move || {
                process
                    .request(RunnerRequest::Snapshot {
                        conversation_id: id,
                    })
                    .unwrap()
                    .result
            }));
        }
        for caller in callers {
            let result = caller.join().unwrap();
            assert_eq!(result["nativeOk"], true);
            assert_eq!(result["denied"], true);
        }
        process.shutdown();
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn rejects_success_responses_with_ambiguous_fields() {
        let response = WireResponse {
            id: 1,
            ok: true,
            result: Some(Value::Null),
            error: Some("unexpected".to_owned()),
        };
        assert!(response.into_result().is_err());
    }
}
