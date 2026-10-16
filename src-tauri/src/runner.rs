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
    CreateBot {
        name: String,
        model_id: String,
        instructions: String,
        cwd: String,
        thinking_level: String,
        extensions: Vec<String>,
        tools: Vec<String>,
    },
    UpdateBot {
        bot_id: String,
        name: String,
        model_id: String,
        instructions: String,
        cwd: String,
        thinking_level: String,
        extensions: Vec<String>,
        tools: Vec<String>,
    },
    ArchiveBot {
        bot_id: String,
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
    SetProviderCredential {
        api_key: Option<String>,
    },
    Close,
}

impl RunnerRequest {
    pub fn validate(&self) -> Result<(), String> {
        let valid_text = |value: &str, max: usize| value.len() <= max;
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
            Self::ArchiveBot { bot_id } => {
                if bot_id.trim().is_empty() || !valid_text(bot_id, 400) {
                    return Err("Bot ID 无效".to_owned());
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
            Self::SetProviderCredential { api_key } => {
                if api_key
                    .as_ref()
                    .is_some_and(|key| key.trim().is_empty() || !valid_text(key, 8_000))
                {
                    return Err("Provider 凭据无效".to_owned());
                }
            }
            Self::Initialize
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

#[derive(Debug, Serialize)]
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

pub struct RunnerState {
    process: Mutex<Option<RunnerProcess>>,
    startup_error: Mutex<Option<String>>,
    credential_warning: Mutex<Option<String>>,
    data_dir: PathBuf,
    resource_dir: PathBuf,
}

impl RunnerState {
    pub fn new(
        data_dir: PathBuf,
        resource_dir: PathBuf,
        api_key: Option<String>,
        credential_warning: Option<String>,
    ) -> Self {
        let (process, startup_error) = match RunnerProcess::spawn(&data_dir, &resource_dir, api_key)
        {
            Ok(process) => (Some(process), None),
            Err(error) => (None, Some(error)),
        };
        Self {
            process: Mutex::new(process),
            startup_error: Mutex::new(startup_error),
            credential_warning: Mutex::new(credential_warning),
            data_dir,
            resource_dir,
        }
    }

    pub fn process(&self) -> Result<RunnerProcess, String> {
        let process = self
            .process
            .lock()
            .map_err(|_| "Runner 状态不可用".to_owned())?;
        process.as_ref().cloned().ok_or_else(|| {
            self.startup_error
                .lock()
                .ok()
                .and_then(|error| error.clone())
                .unwrap_or_else(|| "Runner 尚未启动".to_owned())
        })
    }

    pub fn credential_warning(&self) -> Option<String> {
        self.credential_warning
            .lock()
            .ok()
            .and_then(|warning| warning.clone())
    }

    pub fn set_credential_warning(&self, value: Option<String>) {
        if let Ok(mut warning) = self.credential_warning.lock() {
            *warning = value;
        }
    }

    pub fn clear_credential_warning(&self) {
        self.set_credential_warning(None);
    }

    pub fn restart(&self, api_key: Option<String>) -> Result<(), String> {
        let mut process = self
            .process
            .lock()
            .map_err(|_| "Runner 状态不可用".to_owned())?;
        if let Some(previous) = process.take() {
            previous.shutdown();
        }
        match RunnerProcess::spawn(&self.data_dir, &self.resource_dir, api_key) {
            Ok(next) => {
                *process = Some(next);
                if let Ok(mut error) = self.startup_error.lock() {
                    *error = None;
                }
                self.clear_credential_warning();
                Ok(())
            }
            Err(error) => {
                if let Ok(mut startup_error) = self.startup_error.lock() {
                    *startup_error = Some(error.clone());
                }
                Err(error)
            }
        }
    }

    pub fn shutdown(&self) {
        let process = self
            .process
            .lock()
            .ok()
            .and_then(|mut process| process.take());
        if let Some(process) = process {
            process.shutdown();
        }
    }
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
        let packaged_node = find_node_runtime(resource_dir.join("runner"));
        let development_node =
            find_node_runtime(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../runner/runtime"));
        let node = match std::env::var_os("AGENTCHAT_NODE") {
            Some(node) => node.into(),
            None => match packaged_node.or(development_node) {
                Some(path) => path,
                None if cfg!(debug_assertions) => "node".into(),
                None => return Err("当前打包目标缺少随包 Node Runner runtime".to_owned()),
            },
        };
        let mut command = Command::new(node);
        command
            .arg(&entry)
            .arg("--data-dir")
            .arg(data_dir)
            .env_remove("OPENAI_API_KEY")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        let mut child = command
            .spawn()
            .map_err(|error| format!("启动 Node Runner 失败：{error}"))?;
        let stdin = child.stdin.take().ok_or("Runner 标准输入不可用")?;
        let stdout = child.stdout.take().ok_or("Runner 标准输出不可用")?;
        let pending: Pending = Arc::default();
        let closed = Arc::new(AtomicBool::new(false));
        let pending_reader = Arc::clone(&pending);
        let closed_reader = Arc::clone(&closed);
        let reader = thread::Builder::new()
            .name("agentchat-runner-reader".to_owned())
            .spawn(move || read_responses(stdout, pending_reader, closed_reader));
        if let Err(error) = reader {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("启动 Runner 响应读取线程失败：{error}"));
        }

        let process = Self {
            stdin: Arc::new(Mutex::new(stdin)),
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
        self.pending
            .lock()
            .map_err(|_| "Runner 响应队列不可用".to_owned())?
            .insert(id, sender);

        let message = match serde_json::to_vec(&WireRequest { id, request }) {
            Ok(message) => message,
            Err(error) => {
                self.remove_pending(id);
                return Err(format!("编码 Runner 请求失败：{error}"));
            }
        };
        let write_result = self
            .stdin
            .lock()
            .map_err(|_| "Runner 输入通道不可用".to_owned())
            .and_then(|mut stdin| {
                if self.closed.load(Ordering::Acquire) && !allow_closing {
                    return Err("Runner 已关闭".to_owned());
                }
                stdin
                    .write_all(&message)
                    .and_then(|()| stdin.write_all(b"\n"))
                    .and_then(|()| stdin.flush())
                    .map_err(|error| format!("发送 Runner 请求失败：{error}"))
            });
        if let Err(error) = write_result {
            self.remove_pending(id);
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

fn find_node_runtime(directory: PathBuf) -> Option<PathBuf> {
    [directory.join("node"), directory.join("node.exe")]
        .into_iter()
        .find(|candidate| candidate.is_file())
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

fn read_responses(stdout: impl std::io::Read, pending: Pending, closed: Arc<AtomicBool>) {
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
        let response = match serde_json::from_slice::<WireResponse>(&line) {
            Ok(response) => response,
            Err(error) => {
                closed.store(true, Ordering::Release);
                fail_waiters(&pending, format!("Runner 返回了无效协议消息：{error}"));
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

fn read_bounded_line(reader: &mut impl BufRead) -> std::io::Result<Option<Vec<u8>>> {
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
