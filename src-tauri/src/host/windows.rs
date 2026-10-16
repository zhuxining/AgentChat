use super::{HostRequest, HostState, RequestFrame, ResponseFrame};
use serde_json::Value;
use std::future::Future;
use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeServer, PipeMode, ServerOptions};
use tokio::task::JoinSet;
use tokio::time::timeout;
use windows_sys::Win32::Foundation::LocalFree;
use windows_sys::Win32::Security::Authorization::{
    ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
};
use windows_sys::Win32::Security::{PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES};

const MAX_MESSAGE: usize = 1_048_576;
const MAX_CLIENTS: usize = 32;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(130);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

pub(super) struct Instance {
    name: String,
    server: NamedPipeServer,
}

impl Instance {
    pub(super) fn bind(data_dir: &Path) -> Result<Option<Self>, String> {
        std::fs::create_dir_all(data_dir.join("run"))
            .map_err(|error| format!("创建 Runner 目录失败：{error}"))?;
        let name = pipe_name(data_dir)?;
        match create_server(&name, true) {
            Ok(server) => Ok(Some(Self { name, server })),
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::AlreadyExists | io::ErrorKind::PermissionDenied
                ) =>
            {
                // The first-instance flag prevents a second host from taking over this pipe.
                Ok(None)
            }
            Err(error) => Err(format!("绑定受限本机命名管道失败：{error}")),
        }
    }
}

fn pipe_name(data_dir: &Path) -> Result<String, String> {
    let path = std::fs::canonicalize(data_dir)
        .map_err(|error| format!("解析 Runner 数据目录失败：{error}"))?;
    let path = path.to_string_lossy().to_lowercase();
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in path.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    Ok(format!(r"\\.\pipe\agentchat-{hash:016x}"))
}

fn create_server(name: &str, first: bool) -> io::Result<NamedPipeServer> {
    let mut options = ServerOptions::new();
    options
        .first_pipe_instance(first)
        .max_instances(MAX_CLIENTS + 1)
        .pipe_mode(PipeMode::Byte)
        .reject_remote_clients(true);

    let descriptor_text: Vec<u16> = "D:P(A;;GA;;;OW)(A;;GA;;;SY)(A;;GA;;;BA)\0"
        .encode_utf16()
        .collect();
    let descriptor = std::ptr::null_mut::<PSECURITY_DESCRIPTOR>();
    // SAFETY: the SDDL is a valid NUL-terminated UTF-16 string and `descriptor`
    // points to writable storage for the API's allocated security descriptor.
    let converted = unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            descriptor_text.as_ptr(),
            SDDL_REVISION_1,
            descriptor,
            std::ptr::null_mut(),
        )
    };
    if converted == 0 {
        return Err(io::Error::last_os_error());
    }
    if descriptor.is_null() {
        return Err(io::Error::other("创建命名管道安全描述符失败"));
    }
    // SAFETY: a successful conversion returned a non-null allocated descriptor.
    let security_descriptor = unsafe { *descriptor };

    let mut attributes = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: security_descriptor,
        bInheritHandle: 0,
    };
    // SAFETY: both `attributes` and its security descriptor remain valid for the
    // duration of `create_with_security_attributes_raw`; the descriptor is freed
    // immediately after the synchronous CreateNamedPipe call returns.
    let server = unsafe {
        options.create_with_security_attributes_raw(
            name,
            (&mut attributes as *mut SECURITY_ATTRIBUTES).cast(),
        )
    };
    // SAFETY: the descriptor was allocated by ConvertStringSecurityDescriptor... .
    unsafe {
        LocalFree(security_descriptor);
    }
    server
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum HostStatus {
    Ready,
    Stopping,
    Missing,
}

pub(super) fn status(data_dir: &Path) -> Result<HostStatus, String> {
    match send_with_timeout(data_dir, HostRequest::Ping, CONNECT_TIMEOUT) {
        Ok(_) => Ok(HostStatus::Ready),
        Err(error) if error == "Runner 正在停止" => Ok(HostStatus::Stopping),
        Err(_) => Ok(HostStatus::Missing),
    }
}

pub(super) fn send(data_dir: &Path, request: HostRequest) -> Result<Value, String> {
    send_with_timeout(data_dir, request, REQUEST_TIMEOUT)
}

fn send_with_timeout(
    data_dir: &Path,
    request: HostRequest,
    request_timeout: Duration,
) -> Result<Value, String> {
    let name = pipe_name(data_dir)?;
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let frame = RequestFrame { id, request };
    let mut bytes = serde_json::to_vec(&frame).map_err(|error| error.to_string())?;
    if bytes.len() >= MAX_MESSAGE {
        return Err("本机 IPC 消息超过大小限制".to_owned());
    }
    bytes.push(b'\n');

    block_on(async move {
        let deadline = Instant::now() + request_timeout;
        let mut client = loop {
            match ClientOptions::new().open(&name) {
                Ok(client) => break client,
                Err(error)
                    if error.kind() == io::ErrorKind::WouldBlock && Instant::now() < deadline =>
                {
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
                Err(error) => return Err(format!("无法连接后台 Runner：{error}")),
            }
        };

        let exchange = async {
            client
                .write_all(&bytes)
                .await
                .map_err(|error| format!("本机 IPC 写入失败：{error}"))?;
            client
                .flush()
                .await
                .map_err(|error| format!("本机 IPC 刷新失败：{error}"))?;
            let response_bytes = read_frame(&mut client).await?;
            let response: ResponseFrame = serde_json::from_slice(&response_bytes)
                .map_err(|error| format!("无效宿主响应：{error}"))?;
            if response.id != id {
                return Err("宿主响应 ID 不匹配".to_owned());
            }
            response.result
        };
        timeout(deadline.saturating_duration_since(Instant::now()), exchange)
            .await
            .map_err(|_| "后台 Runner 响应超时".to_owned())?
    })?
}

fn block_on<F: Future>(future: F) -> Result<F::Output, String> {
    match tokio::runtime::Handle::try_current() {
        Ok(handle) => Ok(handle.block_on(future)),
        Err(_) => tokio::runtime::Builder::new_current_thread()
            .enable_io()
            .enable_time()
            .build()
            .map(|runtime| runtime.block_on(future))
            .map_err(|error| format!("创建 Runner IPC runtime 失败：{error}")),
    }
}

async fn read_frame(reader: &mut (impl AsyncRead + Unpin)) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    let mut chunk = [0_u8; 8192];
    loop {
        let count = reader
            .read(&mut chunk)
            .await
            .map_err(|error| format!("本机 IPC 读取失败：{error}"))?;
        if count == 0 {
            return Err("后台 Runner 连接已关闭".to_owned());
        }
        let end = chunk[..count]
            .iter()
            .position(|byte| *byte == b'\n')
            .unwrap_or(count);
        if bytes.len() + end >= MAX_MESSAGE {
            return Err("本机 IPC 消息超过大小限制".to_owned());
        }
        bytes.extend_from_slice(&chunk[..end]);
        if end < count {
            if end + 1 != count {
                return Err("本机 IPC 每个连接只允许一条消息".to_owned());
            }
            return Ok(bytes);
        }
    }
}

pub(super) fn serve(instance: Instance, state: HostState) -> Result<(), String> {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("创建 Runner IPC runtime 失败：{error}"))?;
    runtime.block_on(serve_async(instance, Arc::new(state)))
}

async fn serve_async(instance: Instance, state: Arc<HostState>) -> Result<(), String> {
    let mut server = instance.server;
    let mut workers = JoinSet::new();
    let mut result = Ok(());

    while !state.stopping.load(Ordering::Acquire) {
        tokio::select! {
            connected = server.connect() => {
                if let Err(error) = connected {
                    result = Err(format!("接受本机命名管道连接失败：{error}"));
                    break;
                }
                let next_server = match create_server(&instance.name, false) {
                    Ok(server) => server,
                    Err(error) => {
                        result = Err(format!("创建本机命名管道实例失败：{error}"));
                        break;
                    }
                };
                let client = std::mem::replace(&mut server, next_server);
                if workers.len() >= MAX_CLIENTS {
                    drop(client);
                    continue;
                }
                let state = Arc::clone(&state);
                workers.spawn(async move {
                    if let Err(error) = handle_client(client, state).await {
                        eprintln!("Runner 客户端连接结束：{error}");
                    }
                });
            }
            worker = workers.join_next(), if !workers.is_empty() => {
                if let Some(Err(error)) = worker {
                    eprintln!("Runner 客户端任务异常退出：{error}");
                }
            }
            _ = tokio::time::sleep(Duration::from_millis(20)) => {}
        }
    }

    drop(server);
    while let Some(worker) = workers.join_next().await {
        if let Err(error) = worker {
            eprintln!("Runner 客户端任务异常退出：{error}");
        }
    }
    if let Ok(process) = &state.process {
        process.shutdown();
    }
    result
}

async fn handle_client(mut client: NamedPipeServer, state: Arc<HostState>) -> Result<(), String> {
    let line = timeout(Duration::from_secs(5), read_frame(&mut client))
        .await
        .map_err(|_| "本机 IPC 请求读取超时".to_owned())??;
    let frame: RequestFrame =
        serde_json::from_slice(&line).map_err(|_| "无效本机请求".to_owned())?;
    if frame.id == 0 {
        return Err("请求 ID 无效".to_owned());
    }
    let result = tokio::task::spawn_blocking(move || state.handle(frame.request))
        .await
        .map_err(|error| format!("处理 Runner 请求失败：{error}"))?;
    let mut response = ResponseFrame {
        id: frame.id,
        result,
    };
    let mut bytes = serde_json::to_vec(&response).map_err(|error| error.to_string())?;
    if bytes.len() >= MAX_MESSAGE {
        response.result = Err("宿主响应超过大小限制".to_owned());
        bytes = serde_json::to_vec(&response).map_err(|error| error.to_string())?;
    }
    bytes.push(b'\n');
    timeout(Duration::from_secs(5), async {
        client
            .write_all(&bytes)
            .await
            .map_err(|error| format!("本机 IPC 写入失败：{error}"))?;
        client
            .flush()
            .await
            .map_err(|error| format!("本机 IPC 刷新失败：{error}"))
    })
    .await
    .map_err(|_| "本机 IPC 响应写入超时".to_owned())??;
    Ok(())
}
