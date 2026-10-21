//! The UI owns a connection address; the independent host owns Node and credentials.
use crate::runner::{RunnerProcess, RunnerReply, RunnerRequest};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

#[derive(Clone)]
pub struct RunnerConnection {
    data_dir: PathBuf,
    resource_dir: PathBuf,
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum HostRequest {
    Ping,
    Runner { request: Box<RunnerRequest> },
    Stop,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct RequestFrame {
    id: u64,
    request: HostRequest,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ResponseFrame {
    id: u64,
    result: Result<Value, String>,
}

struct HostState {
    process: Result<RunnerProcess, String>,
    warning: Mutex<Option<String>>,
    stopping: AtomicBool,
}

impl HostState {
    fn new(process: Result<RunnerProcess, String>, warning: Option<String>) -> Self {
        Self {
            process,
            warning: Mutex::new(warning),
            stopping: AtomicBool::new(false),
        }
    }

    fn handle(&self, request: HostRequest) -> Result<Value, String> {
        if self.stopping.load(Ordering::Acquire) {
            return Err("Runner 正在停止".to_owned());
        }
        match request {
            HostRequest::Ping => Ok(Value::Bool(true)),
            HostRequest::Stop => {
                if self.stopping.swap(true, Ordering::AcqRel) {
                    return Err("Runner 正在停止".to_owned());
                }
                if let Ok(process) = &self.process {
                    process.shutdown();
                }
                Ok(Value::Null)
            }
            HostRequest::Runner { request } => {
                validate_public_request(&request)?;
                let initialize = matches!(*request, RunnerRequest::Initialize);
                let mut reply = self
                    .process
                    .as_ref()
                    .map_err(Clone::clone)?
                    .request(*request)?;
                if initialize {
                    if let Some(warning) =
                        self.warning.lock().map_err(|_| "凭据状态不可用")?.as_ref()
                    {
                        if let Value::Object(result) = &mut reply.result {
                            result.insert(
                                "credentialWarning".to_owned(),
                                Value::String(warning.clone()),
                            );
                        }
                    }
                }
                Ok(reply.result)
            }
        }
    }
}

impl RunnerConnection {
    pub fn new(data_dir: PathBuf, resource_dir: PathBuf) -> Self {
        Self {
            data_dir,
            resource_dir,
        }
    }

    pub fn start(&self) -> Result<(), String> {
        crate::runtime::require_ready()?;
        #[cfg(unix)]
        {
            unix::prepare_run_dir(&self.data_dir)?;
            match unix::probe(&self.data_dir)? {
                true => return Ok(()),
                false => self.spawn_host()?,
            }
            let deadline = Instant::now() + Duration::from_secs(20);
            while Instant::now() < deadline {
                if unix::probe(&self.data_dir)? {
                    return Ok(());
                }
                thread::sleep(Duration::from_millis(50));
            }
            Err("后台 Runner 未能启动，请检查 logs/host.log".to_owned())
        }
        #[cfg(windows)]
        {
            std::fs::create_dir_all(self.data_dir.join("run"))
                .map_err(|error| format!("创建 Runner 目录失败：{error}"))?;
            let deadline = Instant::now() + Duration::from_secs(20);
            loop {
                match windows::status(&self.data_dir)? {
                    windows::HostStatus::Ready => return Ok(()),
                    windows::HostStatus::Missing => break,
                    windows::HostStatus::Stopping if Instant::now() < deadline => {
                        thread::sleep(Duration::from_millis(50));
                    }
                    windows::HostStatus::Stopping => {
                        return Err("现有后台 Runner 仍在停止".to_owned());
                    }
                }
            }
            self.spawn_host()?;
            let deadline = Instant::now() + Duration::from_secs(20);
            while Instant::now() < deadline {
                if windows::status(&self.data_dir)? == windows::HostStatus::Ready {
                    return Ok(());
                }
                thread::sleep(Duration::from_millis(50));
            }
            return Err("后台 Runner 未能启动，请检查 logs/host.log".to_owned());
        }
        #[cfg(not(any(unix, windows)))]
        Err("当前平台尚未实现受限本机 IPC；Runner 不会开放网络端口".to_owned())
    }

    #[cfg(unix)]
    fn spawn_host(&self) -> Result<(), String> {
        let logs = self.data_dir.join("logs");
        unix::prepare_private_dir(&logs)?;
        let log = unix::private_file(&logs.join("host.log"), true)?;
        let log_error = log.try_clone().map_err(|error| error.to_string())?;
        let executable = std::env::current_exe().map_err(|error| error.to_string())?;
        let mut command = Command::new(executable);
        command
            .arg("--runner-host")
            .arg("--data-dir")
            .arg(&self.data_dir)
            .arg("--resource-dir")
            .arg(&self.resource_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::from(log))
            .stderr(Stdio::from(log_error));
        // A session independent of the UI survives terminal/UI termination.
        use std::os::unix::process::CommandExt;
        unsafe {
            command.pre_exec(|| {
                if libc::setsid() == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let mut child = command
            .spawn()
            .map_err(|error| format!("启动后台 Runner 失败：{error}"))?;
        thread::spawn(move || {
            if let Err(error) = child.wait() {
                eprintln!("等待后台 Runner 失败：{error}");
            }
        });
        Ok(())
    }

    #[cfg(windows)]
    fn spawn_host(&self) -> Result<(), String> {
        let logs = self.data_dir.join("logs");
        std::fs::create_dir_all(&logs)
            .map_err(|error| format!("创建 Runner 日志目录失败：{error}"))?;
        let log = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(logs.join("host.log"))
            .map_err(|error| format!("打开 Runner 日志失败：{error}"))?;
        let log_error = log.try_clone().map_err(|error| error.to_string())?;
        let executable = std::env::current_exe().map_err(|error| error.to_string())?;
        let mut command = Command::new(executable);
        command
            .arg("--runner-host")
            .arg("--data-dir")
            .arg(&self.data_dir)
            .arg("--resource-dir")
            .arg(&self.resource_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::from(log))
            .stderr(Stdio::from(log_error));
        let mut child = command
            .spawn()
            .map_err(|error| format!("启动后台 Runner 失败：{error}"))?;
        thread::spawn(move || {
            if let Err(error) = child.wait() {
                eprintln!("等待后台 Runner 失败：{error}");
            }
        });
        Ok(())
    }

    fn send(&self, request: HostRequest) -> Result<Value, String> {
        #[cfg(unix)]
        {
            unix::send(&self.data_dir, request)
        }
        #[cfg(windows)]
        {
            windows::send(&self.data_dir, request)
        }
        #[cfg(not(any(unix, windows)))]
        {
            let _ = request;
            Err("当前平台尚未实现受限本机 IPC".to_owned())
        }
    }

    pub fn request(&self, request: RunnerRequest) -> Result<RunnerReply, String> {
        validate_public_request(&request)?;
        self.send(HostRequest::Runner {
            request: Box::new(request),
        })
        .map(|result| RunnerReply { result })
    }

    pub fn stop(&self) -> Result<(), String> {
        #[cfg(unix)]
        {
            self.send(HostRequest::Stop)?;
            let deadline = Instant::now() + Duration::from_secs(15);
            while Instant::now() < deadline {
                if !unix::instance_running(&self.data_dir)? {
                    return Ok(());
                }
                thread::sleep(Duration::from_millis(25));
            }
            Err("后台 Runner 收尾超时".to_owned())
        }
        #[cfg(windows)]
        {
            match windows::status(&self.data_dir)? {
                windows::HostStatus::Missing => return Ok(()),
                windows::HostStatus::Stopping => {}
                windows::HostStatus::Ready => {
                    self.send(HostRequest::Stop)?;
                }
            }
            let deadline = Instant::now() + Duration::from_secs(15);
            while Instant::now() < deadline {
                if windows::status(&self.data_dir)? == windows::HostStatus::Missing {
                    return Ok(());
                }
                thread::sleep(Duration::from_millis(25));
            }
            Err("后台 Runner 收尾超时".to_owned())
        }
        #[cfg(not(any(unix, windows)))]
        Ok(())
    }

    pub fn restart(&self) -> Result<(), String> {
        #[cfg(unix)]
        if unix::instance_running(&self.data_dir)? {
            self.stop()?;
        }
        #[cfg(windows)]
        if windows::status(&self.data_dir)? != windows::HostStatus::Missing {
            self.stop()?;
        }
        self.start()
    }
}

fn validate_public_request(request: &RunnerRequest) -> Result<(), String> {
    if matches!(
        request,
        RunnerRequest::Close | RunnerRequest::SetProviderCredential { .. }
    ) {
        return Err("此操作只能由后台宿主发起".to_owned());
    }
    request.validate()
}

pub fn data_dir() -> Result<PathBuf, String> {
    let path = match std::env::var_os("AGENTCHAT_DATA_DIR") {
        Some(path) => PathBuf::from(path),
        None => std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(PathBuf::from)
            .ok_or("无法确定用户主目录")?
            .join(".agentchat"),
    };
    if !path.is_absolute() {
        return Err("Runner 数据目录必须是绝对路径".to_owned());
    }
    Ok(path)
}

/// Branch before Tauri initialization: the host never creates a webview/event loop.
pub fn run_if_host() -> Option<Result<(), String>> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.first().is_none_or(|arg| arg != "--runner-host") {
        return None;
    }
    let result = (|| {
        if args.len() != 5 || args[1] != "--data-dir" || args[3] != "--resource-dir" {
            return Err("后台宿主需要 --data-dir PATH --resource-dir PATH".to_owned());
        }
        let data_dir = PathBuf::from(&args[2]);
        let resource_dir = PathBuf::from(&args[4]);
        if !data_dir.is_absolute() || !resource_dir.is_absolute() {
            return Err("后台宿主路径必须为绝对路径".to_owned());
        }
        run_host(&data_dir, &resource_dir)
    })();
    Some(result)
}

fn run_host(data_dir: &Path, resource_dir: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        let Some(instance) = unix::Instance::bind(data_dir)? else {
            return Ok(());
        };
        let process = crate::runner::RunnerProcess::spawn(data_dir, resource_dir, None);
        unix::serve(instance, HostState::new(process, None))
    }
    #[cfg(windows)]
    {
        let Some(instance) = windows::Instance::bind(data_dir)? else {
            return Ok(());
        };
        let process = crate::runner::RunnerProcess::spawn(data_dir, resource_dir, None);
        windows::serve(instance, HostState::new(process, None))
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (data_dir, resource_dir);
        Err("当前平台尚未实现受限本机 IPC".to_owned())
    }
}

#[cfg(windows)]
#[path = "host/windows.rs"]
mod windows;

#[cfg(unix)]
mod unix {
    use super::*;
    use crate::runner::read_bounded_line;
    use std::fs::{File, OpenOptions};
    use std::io::{BufReader, Write};
    use std::os::unix::fs::{
        DirBuilderExt, FileTypeExt, MetadataExt, OpenOptionsExt, PermissionsExt,
    };
    use std::os::unix::net::{UnixListener, UnixStream};
    use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
    use std::sync::Arc;

    const MAX_MESSAGE: usize = 1_048_576;
    const MAX_CLIENTS: usize = 32;
    const TIMEOUT: Duration = Duration::from_secs(130);
    static NEXT_ID: AtomicU64 = AtomicU64::new(1);

    fn owned(metadata: &std::fs::Metadata) -> bool {
        // geteuid has no preconditions and is used only for filesystem ownership checks.
        metadata.uid() == unsafe { libc::geteuid() }
    }

    pub(super) fn prepare_private_dir(path: &Path) -> Result<(), String> {
        let mut builder = std::fs::DirBuilder::new();
        builder.recursive(true).mode(0o700);
        builder
            .create(path)
            .map_err(|error| format!("创建私有目录失败：{error}"))?;
        let metadata = std::fs::symlink_metadata(path).map_err(|error| error.to_string())?;
        if !metadata.is_dir() || !owned(&metadata) {
            return Err("Runner 目录类型或所有者无效".to_owned());
        }
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
            .map_err(|error| error.to_string())
    }

    pub(super) fn prepare_run_dir(data_dir: &Path) -> Result<PathBuf, String> {
        prepare_private_dir(data_dir)?;
        let run = data_dir.join("run");
        prepare_private_dir(&run)?;
        Ok(run)
    }

    pub(super) fn private_file(path: &Path, append: bool) -> Result<File, String> {
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .append(append)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(path)
            .map_err(|error| format!("打开私有文件失败：{error}"))?;
        let metadata = file.metadata().map_err(|error| error.to_string())?;
        if !metadata.is_file() || !owned(&metadata) || metadata.nlink() != 1 {
            return Err("Runner 文件类型、链接数或所有者无效".to_owned());
        }
        file.set_permissions(std::fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())?;
        Ok(file)
    }

    fn lock_file(data_dir: &Path) -> Result<File, String> {
        let run = prepare_run_dir(data_dir)?;
        private_file(&run.join("host.lock"), false)
    }

    pub(super) fn instance_running(data_dir: &Path) -> Result<bool, String> {
        let lock = lock_file(data_dir)?;
        match lock.try_lock() {
            Ok(()) => {
                lock.unlock().map_err(|error| error.to_string())?;
                Ok(false)
            }
            Err(std::fs::TryLockError::WouldBlock) => Ok(true),
            Err(error) => Err(format!("检查 Runner 实例锁失败：{error}")),
        }
    }

    struct InstanceLock(File);

    impl Drop for InstanceLock {
        fn drop(&mut self) {
            // Explicit unlock also releases inherited descriptors during concurrent fork/exec.
            if let Err(error) = self.0.unlock() {
                eprintln!("释放 Runner 实例锁失败：{error}");
            }
        }
    }

    pub(super) struct Instance {
        listener: UnixListener,
        socket: PathBuf,
        // Never unlink the lock file: another contender may already have it open.
        _lock: InstanceLock,
    }

    impl Instance {
        pub(super) fn bind(data_dir: &Path) -> Result<Option<Self>, String> {
            let lock = lock_file(data_dir)?;
            match lock.try_lock() {
                Ok(()) => (),
                Err(std::fs::TryLockError::WouldBlock) => return Ok(None),
                Err(error) => return Err(format!("锁定 Runner 实例失败：{error}")),
            }
            let lock = InstanceLock(lock);
            let socket = data_dir.join("run/host.sock");
            match std::fs::symlink_metadata(&socket) {
                Ok(metadata) => {
                    if !metadata.file_type().is_socket() || !owned(&metadata) {
                        return Err("Runner socket 路径类型或所有者无效".to_owned());
                    }
                    match UnixStream::connect(&socket) {
                        Ok(_) => {
                            return Err("已有未受实例锁管理的 Runner socket，拒绝删除".to_owned())
                        }
                        Err(error)
                            if matches!(
                                error.kind(),
                                std::io::ErrorKind::ConnectionRefused
                                    | std::io::ErrorKind::NotFound
                            ) =>
                        {
                            std::fs::remove_file(&socket).map_err(|error| error.to_string())?;
                        }
                        Err(error) => return Err(format!("检查失效 socket 失败：{error}")),
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
                Err(error) => return Err(error.to_string()),
            }
            let listener = UnixListener::bind(&socket)
                .map_err(|error| format!("绑定本机 Runner socket 失败：{error}"))?;
            let instance = Self {
                listener,
                socket,
                _lock: lock,
            };
            std::fs::set_permissions(&instance.socket, std::fs::Permissions::from_mode(0o600))
                .map_err(|error| error.to_string())?;
            instance
                .listener
                .set_nonblocking(true)
                .map_err(|error| error.to_string())?;
            Ok(Some(instance))
        }
    }

    impl Drop for Instance {
        fn drop(&mut self) {
            if let Err(error) = std::fs::remove_file(&self.socket) {
                if error.kind() != std::io::ErrorKind::NotFound {
                    eprintln!("清理 Runner socket 失败：{error}");
                }
            }
        }
    }

    pub(super) fn probe(data_dir: &Path) -> Result<bool, String> {
        if !instance_running(data_dir)? {
            return Ok(false);
        }
        // A held lock can mean the owner is still loading Node/keyring.
        Ok(send(data_dir, HostRequest::Ping).is_ok())
    }

    fn write_frame(stream: &mut UnixStream, value: &impl Serialize) -> Result<(), String> {
        let mut bytes = serde_json::to_vec(value).map_err(|error| error.to_string())?;
        if bytes.len() >= MAX_MESSAGE {
            return Err("本机 IPC 消息超过大小限制".to_owned());
        }
        bytes.push(b'\n');
        stream
            .write_all(&bytes)
            .map_err(|error| format!("本机 IPC 写入失败：{error}"))
    }

    pub(super) fn send(data_dir: &Path, request: HostRequest) -> Result<Value, String> {
        let mut stream = UnixStream::connect(data_dir.join("run/host.sock"))
            .map_err(|error| format!("无法连接后台 Runner：{error}"))?;
        let timeout = if matches!(request, HostRequest::Ping) {
            Duration::from_secs(1)
        } else {
            TIMEOUT
        };
        stream
            .set_read_timeout(Some(timeout))
            .map_err(|error| error.to_string())?;
        stream
            .set_write_timeout(Some(timeout))
            .map_err(|error| error.to_string())?;
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        write_frame(&mut stream, &RequestFrame { id, request })?;
        let line = read_bounded_line(&mut BufReader::new(stream))
            .map_err(|error| format!("本机 IPC 响应失败：{error}"))?
            .ok_or("后台 Runner 连接已关闭")?;
        let response: ResponseFrame =
            serde_json::from_slice(&line).map_err(|error| format!("无效宿主响应：{error}"))?;
        if response.id != id {
            return Err("宿主响应 ID 不匹配".to_owned());
        }
        response.result
    }

    pub(super) fn serve(instance: Instance, state: HostState) -> Result<(), String> {
        let state = Arc::new(state);
        let clients = Arc::new(AtomicUsize::new(0));
        let mut workers: Vec<thread::JoinHandle<()>> = Vec::new();
        let mut result = Ok(());
        while !state.stopping.load(Ordering::Acquire) {
            // Reap completed threads so repeated UI polling has bounded memory usage.
            let mut index = 0;
            while index < workers.len() {
                if workers[index].is_finished() {
                    if workers.swap_remove(index).join().is_err() {
                        eprintln!("Runner 客户端线程异常退出");
                    }
                } else {
                    index += 1;
                }
            }
            match instance.listener.accept() {
                Ok((mut stream, _)) => {
                    if clients.load(Ordering::Acquire) >= MAX_CLIENTS {
                        continue;
                    }
                    clients.fetch_add(1, Ordering::AcqRel);
                    let state = Arc::clone(&state);
                    let clients = Arc::clone(&clients);
                    let worker = thread::Builder::new()
                        .name("runner-client".to_owned())
                        .spawn(move || {
                            struct ActiveClient(Arc<AtomicUsize>);
                            impl Drop for ActiveClient {
                                fn drop(&mut self) {
                                    self.0.fetch_sub(1, Ordering::AcqRel);
                                }
                            }
                            let _active = ActiveClient(clients);
                            if let Err(error) = handle_client(&mut stream, &state) {
                                eprintln!("Runner 客户端连接结束：{error}");
                            }
                        });
                    match worker {
                        Ok(worker) => workers.push(worker),
                        Err(error) => {
                            result = Err(format!("创建宿主连接线程失败：{error}"));
                            break;
                        }
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(10))
                }
                Err(error) => {
                    result = Err(format!("接受本机 IPC 连接失败：{error}"));
                    break;
                }
            }
        }
        state.stopping.store(true, Ordering::Release);
        if let Ok(process) = &state.process {
            process.shutdown();
        }
        // The stop response is flushed before releasing the instance lock.
        for worker in workers {
            if worker.join().is_err() {
                eprintln!("Runner 客户端线程异常退出");
            }
        }
        result
    }

    fn handle_client(stream: &mut UnixStream, state: &HostState) -> Result<(), String> {
        // Accepted sockets can inherit O_NONBLOCK on BSD/macOS.
        stream
            .set_nonblocking(false)
            .map_err(|error| error.to_string())?;
        // One request per connection: no frontend-controlled IDs share Node's ID space.
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .map_err(|error| error.to_string())?;
        stream
            .set_write_timeout(Some(Duration::from_secs(5)))
            .map_err(|error| error.to_string())?;
        let line = read_bounded_line(&mut BufReader::new(&mut *stream))
            .map_err(|error| error.to_string())?
            .ok_or("空请求")?;
        let frame: RequestFrame =
            serde_json::from_slice(&line).map_err(|_| "无效本机请求".to_owned())?;
        if frame.id == 0 {
            return Err("请求 ID 无效".to_owned());
        }
        let mut response = ResponseFrame {
            id: frame.id,
            result: state.handle(frame.request),
        };
        if serde_json::to_vec(&response)
            .map_err(|error| error.to_string())?
            .len()
            >= MAX_MESSAGE
        {
            response.result = Err("宿主响应超过大小限制".to_owned());
        }
        write_frame(stream, &response)
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::unix::*;
    use super::*;
    use crate::runner::RunnerProcess;
    use std::io::Write;
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    use std::os::unix::net::{UnixListener, UnixStream};
    use std::sync::atomic::{AtomicU64, Ordering};

    static SEQUENCE: AtomicU64 = AtomicU64::new(1);
    // fork/exec briefly inherits other tests' sockets, even with close-on-exec.
    static SOCKET_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    struct Directory(PathBuf);
    impl Directory {
        fn new() -> Self {
            // /tmp keeps socket paths below macOS's sockaddr_un limit.
            let path = PathBuf::from(format!(
                "/tmp/agentchat-host-{}-{}",
                std::process::id(),
                SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Directory {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.0).unwrap();
        }
    }

    fn mock_runner(directory: &Path) -> RunnerProcess {
        let script = r#"
const fs = require('node:fs');
const readline = require('node:readline');
readline.createInterface({input:process.stdin}).on('line', line => {
  const request = JSON.parse(line);
  fs.appendFileSync(process.argv[1], request.op + '\n');
  const result = request.op === 'submit' ? {text:request.text} : {op:request.op};
  const reply = () => process.stdout.write(JSON.stringify({id:request.id,ok:true,result})+'\n', () => {
    if (request.op === 'close') process.exit(0);
  });
  if (request.op === 'submit') setTimeout(reply, Number(request.text) % 7 * 3);
  else reply();
});
"#;
        let mut command = Command::new("node");
        command
            .arg("-e")
            .arg(script)
            .arg(directory.join("operations"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        RunnerProcess::spawn_command(&mut command, None, directory).unwrap()
    }

    #[test]
    fn instance_lock_excludes_contenders_and_socket_is_private() {
        let _guard = SOCKET_TEST_LOCK.lock().unwrap();
        let directory = Directory::new();
        let instance = Instance::bind(&directory.0).unwrap().unwrap();
        assert!(Instance::bind(&directory.0).unwrap().is_none());
        let socket = directory.0.join("run/host.sock");
        assert_eq!(
            std::fs::metadata(&socket).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(
            std::fs::metadata(directory.0.join("run"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        let lock_inode = std::fs::metadata(directory.0.join("run/host.lock"))
            .unwrap()
            .ino();
        drop(instance);
        assert!(!socket.exists());
        let instance = Instance::bind(&directory.0).unwrap().unwrap();
        assert_eq!(
            lock_inode,
            std::fs::metadata(directory.0.join("run/host.lock"))
                .unwrap()
                .ino()
        );
        drop(instance);
    }

    #[test]
    fn recovers_only_a_dead_socket_and_refuses_other_files_or_symlinks() {
        let _guard = SOCKET_TEST_LOCK.lock().unwrap();
        let directory = Directory::new();
        prepare_run_dir(&directory.0).unwrap();
        let socket = directory.0.join("run/host.sock");
        drop(UnixListener::bind(&socket).unwrap());
        drop(Instance::bind(&directory.0).unwrap().unwrap());
        std::fs::write(&socket, "keep me").unwrap();
        assert!(Instance::bind(&directory.0).is_err());
        assert_eq!(std::fs::read_to_string(&socket).unwrap(), "keep me");
        std::fs::remove_file(&socket).unwrap();
        std::os::unix::fs::symlink(directory.0.join("outside"), &socket).unwrap();
        assert!(Instance::bind(&directory.0).is_err());
    }

    #[test]
    fn live_socket_without_lock_is_never_deleted() {
        let _guard = SOCKET_TEST_LOCK.lock().unwrap();
        let directory = Directory::new();
        prepare_run_dir(&directory.0).unwrap();
        let socket = directory.0.join("run/host.sock");
        let listener = UnixListener::bind(&socket).unwrap();
        assert!(Instance::bind(&directory.0).is_err());
        assert!(socket.exists());
        drop(listener);
    }

    #[test]
    fn clients_are_correlated_disconnect_keeps_running_and_stop_uses_close() {
        let _guard = SOCKET_TEST_LOCK.lock().unwrap();
        let directory = Directory::new();
        let instance = Instance::bind(&directory.0).unwrap().unwrap();
        let state = HostState::new(Ok(mock_runner(&directory.0)), None);
        let server = thread::spawn(move || serve(instance, state));
        // Disconnect while a complete request is already running.
        let mut disconnected = UnixStream::connect(directory.0.join("run/host.sock")).unwrap();
        writeln!(disconnected, "{}", serde_json::json!({"id":1,"request":{"kind":"runner","request":{"op":"submit","conversationId":1,"requestId":"gone","text":"6"}}})).unwrap();
        drop(disconnected);
        let mut clients = Vec::new();
        for index in 0..16 {
            let path = directory.0.clone();
            clients.push(thread::spawn(move || {
                let text = index.to_string();
                let reply = send(
                    &path,
                    HostRequest::Runner {
                        request: Box::new(RunnerRequest::Submit {
                            conversation_id: 1,
                            text: text.clone(),
                            request_id: format!("request-{index}"),
                            attachments: Vec::new(),
                        }),
                    },
                )
                .unwrap();
                assert_eq!(reply["text"], text);
            }));
        }
        for client in clients {
            client.join().unwrap();
        }
        assert_eq!(
            send(&directory.0, HostRequest::Ping).unwrap(),
            Value::Bool(true)
        );
        // A fresh client can join after every previous connection was dropped.
        assert_eq!(
            send(
                &directory.0,
                HostRequest::Runner {
                    request: Box::new(RunnerRequest::Initialize)
                }
            )
            .unwrap()["op"],
            "initialize"
        );
        send(&directory.0, HostRequest::Stop).unwrap();
        server.join().unwrap().unwrap();
        let operations = std::fs::read_to_string(directory.0.join("operations")).unwrap();
        assert_eq!(operations.lines().filter(|op| *op == "close").count(), 1);
        assert!(!operations.lines().any(|op| op == "abort"));
        assert!(!instance_running(&directory.0).unwrap());
    }

    #[test]
    fn public_boundary_rejects_raw_credentials_and_close() {
        assert!(validate_public_request(&RunnerRequest::BotSummaries).is_ok());
        assert!(validate_public_request(&RunnerRequest::Close).is_err());
        assert!(
            validate_public_request(&RunnerRequest::SetProviderCredential {
                api_key: Some("secret".to_owned())
            })
            .is_err()
        );
        assert!(validate_public_request(&RunnerRequest::ProviderRequest {
            request: serde_json::json!({"action":"list"})
        })
        .is_ok());
        assert!(validate_public_request(&RunnerRequest::ProviderRequest {
            request: serde_json::json!({"action":"readCredential"})
        })
        .is_err());
        let request: RunnerRequest = serde_json::from_value(serde_json::json!({
            "op":"saveConfiguration", "path":"runner.json", "version":"hash", "content":"{}"
        }))
        .unwrap();
        assert!(request.validate().is_ok());
        assert!(serde_json::from_value::<RunnerRequest>(serde_json::json!({
            "op":"saveConfiguration", "path":"runner.json", "version":"hash", "content":{}
        }))
        .is_err());
        assert!(serde_json::from_value::<RunnerRequest>(serde_json::json!({
            "op":"archiveBot", "botId":"bot"
        }))
        .is_err());
    }
}
