use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fmt::Write as FmtWrite;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

const MINIMUM_MAJOR: u64 = 24;
const OFFICIAL_NODE_DIST: &str = "https://nodejs.org/dist/latest-v24.x/";
const NPMMIRROR_NODE_DIST: &str = "https://cdn.npmmirror.com/binaries/node/";
const MAX_NODE_ARCHIVE_BYTES: u64 = 300 * 1024 * 1024;
const MAX_SHASUMS_BYTES: u64 = 4 * 1024 * 1024;
static INSTALL_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub status: &'static str,
    pub path: Option<String>,
    pub version: Option<String>,
    pub source: Option<&'static str>,
    pub architecture: Option<String>,
    pub detail: Option<String>,
}

struct Candidate {
    path: PathBuf,
    source: &'static str,
}

struct Probe {
    version: String,
    major: u64,
    architecture: String,
}

pub fn detect() -> RuntimeStatus {
    let mut seen = HashSet::new();
    let candidates = candidates();
    let mut old_runtime = None;
    let mut probe_failure = None;

    for candidate in candidates {
        let Ok(path) = std::fs::canonicalize(&candidate.path) else {
            continue;
        };
        if !seen.insert(path.clone()) || !path.is_file() {
            continue;
        }
        match probe(&path) {
            Ok(probe) if probe.major >= MINIMUM_MAJOR => {
                return RuntimeStatus {
                    status: "ready",
                    path: Some(path.to_string_lossy().into_owned()),
                    version: Some(probe.version),
                    source: Some(candidate.source),
                    architecture: Some(probe.architecture),
                    detail: None,
                };
            }
            Ok(probe) => {
                old_runtime.get_or_insert((path, candidate.source, probe));
            }
            Err(error) => {
                probe_failure.get_or_insert(error);
            }
        }
    }

    if let Some((path, source, probe)) = old_runtime {
        return RuntimeStatus {
            status: "incompatible",
            path: Some(path.to_string_lossy().into_owned()),
            version: Some(probe.version.clone()),
            source: Some(source),
            architecture: Some(probe.architecture),
            detail: Some(format!(
                "AgentChat 需要 Node 24 或更新版本；当前为 Node {}",
                probe.version
            )),
        };
    }
    if let Some(detail) = probe_failure {
        return RuntimeStatus {
            status: "error",
            path: None,
            version: None,
            source: None,
            architecture: None,
            detail: Some(detail),
        };
    }
    RuntimeStatus {
        status: "missing",
        path: None,
        version: None,
        source: None,
        architecture: None,
        detail: Some("未找到 Node 24 或更新版本".to_owned()),
    }
}

pub fn require_ready() -> Result<PathBuf, String> {
    let status = detect();
    if status.status != "ready" {
        return Err(status
            .detail
            .unwrap_or_else(|| "Node runtime 未就绪".to_owned()));
    }
    status
        .path
        .map(PathBuf::from)
        .ok_or_else(|| "Node runtime 路径缺失".to_owned())
}

pub fn install() -> Result<RuntimeStatus, String> {
    let _guard = INSTALL_LOCK
        .lock()
        .map_err(|_| "Node 安装状态不可用".to_owned())?;
    let initial = detect();
    if initial.status == "ready" {
        return Ok(initial);
    }

    // Do not let a package manager replace an older or misconfigured system Node.
    // Keep that runtime intact and install a private Node 24 beside AgentChat.
    if initial.status != "missing" {
        if let Err(error) = install_downloaded_runtime() {
            let status = detect();
            if status.status == "ready" {
                return Ok(status);
            }
            return Err(error);
        }
    } else {
        let package_install = install_with_package_manager();
        if detect().status != "ready" {
            let download = install_downloaded_runtime();
            if let Err(download_error) = download {
                let status = detect();
                if status.status == "ready" {
                    return Ok(status);
                }
                if let Err(package_error) = package_install {
                    return Err(format!(
                        "包管理器安装失败：{package_error}；官方发行源与 npmmirror 下载回退失败：{download_error}"
                    ));
                }
                return Err(format!(
                    "包管理器安装后 Node 仍未就绪；官方发行源与 npmmirror 下载回退失败：{download_error}"
                ));
            }
        }
    }

    let status = detect();
    if status.status == "ready" {
        Ok(status)
    } else {
        Err(status
            .detail
            .unwrap_or_else(|| "安装结束后仍未检测到可用 Node".to_owned()))
    }
}

fn install_with_package_manager() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return install_macos();
    #[cfg(target_os = "windows")]
    return install_windows();
    #[cfg(target_os = "linux")]
    return install_linux();
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    Err("当前平台暂不支持自动安装 Node".to_owned())
}

#[cfg(target_os = "macos")]
fn install_macos() -> Result<(), String> {
    let brew = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"]
        .into_iter()
        .map(PathBuf::from)
        .find(|path| path.is_file())
        .or_else(|| executable_in_path("brew"));
    let Some(brew) = brew else {
        return bootstrap_homebrew();
    };
    let mirrors = [
        Some((
            "https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles/api",
            "https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles",
        )),
        Some((
            "https://mirrors.ustc.edu.cn/homebrew-bottles/api",
            "https://mirrors.ustc.edu.cn/homebrew-bottles",
        )),
        None,
    ];
    let mut failures = Vec::new();
    for mirror in mirrors {
        let mut command = Command::new(&brew);
        command.arg("install").arg("node");
        if let Some((api, bottles)) = mirror {
            command
                .env("HOMEBREW_API_DOMAIN", api)
                .env("HOMEBREW_BOTTLE_DOMAIN", bottles);
        }
        match command.output() {
            Ok(output) if output.status.success() => return Ok(()),
            Ok(output) => failures.push(format!(
                "Homebrew 退出码 {:?}: {}",
                output.status.code(),
                output_detail(&output)
            )),
            Err(error) => failures.push(format!("启动 Homebrew 失败：{error}")),
        }
    }
    Err(format!("Homebrew 安装 Node 失败：{}", failures.join("；")))
}

#[cfg(target_os = "macos")]
fn bootstrap_homebrew() -> Result<(), String> {
    const INSTALL_SCRIPT: &str = r#"#!/bin/bash
set +e
status_file="$1"
trap 'result=$?; printf "%s" "$result" > "$status_file"; /bin/rm -f "$installer"; exit "$result"' EXIT
installer="$(/usr/bin/mktemp)"
/usr/bin/curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh -o "$installer" || exit 10
for source in tuna ustc official; do
  case "$source" in
    tuna)
      brew_remote=https://mirrors.tuna.tsinghua.edu.cn/git/homebrew/brew.git
      api=https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles/api
      bottles=https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles
      ;;
    ustc)
      brew_remote=https://mirrors.ustc.edu.cn/brew.git
      api=https://mirrors.ustc.edu.cn/homebrew-bottles/api
      bottles=https://mirrors.ustc.edu.cn/homebrew-bottles
      ;;
    official)
      brew_remote=https://github.com/Homebrew/brew
      api=https://formulae.brew.sh/api
      bottles=https://ghcr.io/v2/homebrew/core
      ;;
  esac
  if ! command -v brew >/dev/null 2>&1; then
    HOMEBREW_BREW_GIT_REMOTE="$brew_remote" /bin/bash "$installer" || continue
    if [ -x /opt/homebrew/bin/brew ]; then eval "$(/opt/homebrew/bin/brew shellenv)"; fi
    if [ -x /usr/local/bin/brew ]; then eval "$(/usr/local/bin/brew shellenv)"; fi
  fi
  if command -v brew >/dev/null 2>&1 && HOMEBREW_API_DOMAIN="$api" HOMEBREW_BOTTLE_DOMAIN="$bottles" brew install node; then
    exit 0
  fi
done
exit 1
"#;
    let temp_dir = std::env::temp_dir();
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| format!("读取系统时间失败：{error}"))?
        .as_nanos();
    let script_path = temp_dir.join(format!(
        "agentchat-homebrew-{}-{nonce}.sh",
        std::process::id()
    ));
    let status_path = temp_dir.join(format!(
        "agentchat-homebrew-{}-{nonce}.status",
        std::process::id()
    ));
    let mut script_file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&script_path)
        .map_err(|error| format!("安全创建 Homebrew 初始化脚本失败：{error}"))?;
    script_file
        .write_all(INSTALL_SCRIPT.as_bytes())
        .map_err(|error| format!("写入 Homebrew 初始化脚本失败：{error}"))?;
    drop(script_file);
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&status_path)
        .map_err(|error| format!("安全创建 Homebrew 状态文件失败：{error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script_path, std::fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("设置 Homebrew 初始化脚本权限失败：{error}"))?;
    }
    let command = format!(
        "/bin/bash {} {}",
        shell_quote(&script_path.to_string_lossy()),
        shell_quote(&status_path.to_string_lossy())
    );
    let apple_script = r#"on run argv
 tell application "Terminal" to activate
 tell application "Terminal" to do script (item 1 of argv)
end run"#;
    let launched = Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(apple_script)
        .arg(command)
        .output()
        .map_err(|error| format!("无法打开 Terminal 执行 Homebrew 初始化：{error}"))?;
    if !launched.status.success() {
        let _ = std::fs::remove_file(&script_path);
        let _ = std::fs::remove_file(&status_path);
        return Err(format!(
            "无法打开 Terminal 执行 Homebrew 初始化：{}",
            bounded_output(&launched.stderr)
        ));
    }

    let deadline = Instant::now() + Duration::from_secs(15 * 60);
    loop {
        if let Some(status) = std::fs::read_to_string(&status_path)
            .ok()
            .filter(|status| !status.trim().is_empty())
        {
            let _ = std::fs::remove_file(&script_path);
            let _ = std::fs::remove_file(&status_path);
            if status.trim() == "0" && detect().status == "ready" {
                return Ok(());
            }
            return Err(format!(
                "Homebrew 初始化终端已结束（退出码 {}），Node 仍未就绪。",
                status.trim()
            ));
        }
        if Instant::now() >= deadline {
            return Err("Homebrew 初始化超时；请检查 Terminal 中的输出后重试。".to_owned());
        }
        thread::sleep(Duration::from_secs(2));
    }
}

#[cfg(target_os = "macos")]
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(target_os = "windows")]
fn install_windows() -> Result<(), String> {
    let winget = executable_in_path("winget.exe")
        .or_else(|| executable_in_path("winget"))
        .ok_or_else(|| {
            let _ = Command::new("explorer.exe")
                .arg("ms-windows-store://pdp/?ProductId=9NBLGGH4NNS1")
                .spawn();
            "未找到 winget，已打开 Microsoft Store 的 App Installer 页面。完成安装后点击重试。"
                .to_owned()
        })?;
    let mut command = Command::new(winget);
    command.args([
        "install",
        "--id",
        "OpenJS.NodeJS",
        "-e",
        "--source",
        "winget",
        "--accept-source-agreements",
        "--accept-package-agreements",
        "--silent",
    ]);
    let output = command
        .output()
        .map_err(|error| format!("启动 winget 失败：{error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "winget 未能安装 Node（退出码 {:?}）：{}",
            output.status.code(),
            output_detail(&output)
        ))
    }
}

#[cfg(target_os = "linux")]
fn install_linux() -> Result<(), String> {
    let apt_cache = executable_in_path("apt-cache")
        .ok_or_else(|| "未找到 apt-cache；当前 Linux 发行版不支持自动安装。".to_owned())?;
    let output = Command::new(apt_cache)
        .args(["policy", "nodejs"])
        .output()
        .map_err(|error| format!("查询 apt Node 候选版本失败：{error}"))?;
    if !output.status.success() {
        return Err("apt-cache 无法查询 nodejs 候选版本".to_owned());
    }
    let policy = String::from_utf8_lossy(&output.stdout);
    let candidate = policy
        .lines()
        .find_map(|line| line.trim().strip_prefix("Candidate:"))
        .map(str::trim)
        .filter(|version| *version != "(none)")
        .ok_or_else(|| "apt 源没有可安装的 nodejs 候选版本".to_owned())?;
    if !version_has_minimum_major(candidate, MINIMUM_MAJOR) {
        return Err(format!(
            "apt 候选 Node 版本 {candidate} 低于 24；未修改系统软件源。"
        ));
    }

    let apt_get = executable_in_path("apt-get").ok_or_else(|| "未找到 apt-get".to_owned())?;
    let privileged = unsafe { libc::geteuid() } != 0;
    run_apt_command(&apt_get, privileged, &["update"])?;
    run_apt_command(&apt_get, privileged, &["install", "-y", "nodejs"])
}

#[cfg(target_os = "linux")]
fn run_apt_command(program: &Path, privileged: bool, args: &[&str]) -> Result<(), String> {
    if !privileged {
        return run_command(program, args);
    }
    let pkexec = executable_in_path("pkexec")
        .ok_or_else(|| "缺少 pkexec，无法请求系统授权安装 Node。".to_owned())?;
    let mut command_args = vec![program.to_string_lossy().into_owned()];
    command_args.extend(args.iter().map(|arg| (*arg).to_owned()));
    let references: Vec<_> = command_args.iter().map(String::as_str).collect();
    run_command(&pkexec, &references)
}

#[cfg(target_os = "linux")]
fn run_command(program: &Path, args: &[&str]) -> Result<(), String> {
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(|error| format!("启动 {} 失败：{error}", program.display()))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "{} 失败（退出码 {:?}）：{}",
            program.display(),
            output.status.code(),
            output_detail(&output)
        ))
    }
}

fn install_downloaded_runtime() -> Result<(), String> {
    let root = crate::host::data_dir()?.join("runtimes");
    std::fs::create_dir_all(&root)
        .map_err(|error| format!("创建 Node runtime 目录失败：{error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("设置 Node runtime 目录权限失败：{error}"))?;
    }

    let (target, suffix) = download_target()?;
    let client = reqwest::blocking::Client::builder()
        .https_only(true)
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(15 * 60))
        .build()
        .map_err(|error| format!("创建 Node 下载客户端失败：{error}"))?;
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| format!("读取系统时间失败：{error}"))?
        .as_nanos();
    let managed = root.join("node-v24");
    let mut failures = Vec::new();
    let official_stage = root.join(format!(
        ".node-stage-official-{}-{nonce}",
        std::process::id()
    ));
    std::fs::create_dir(&official_stage)
        .map_err(|error| format!("创建 Node 下载暂存目录失败：{error}"))?;
    let official = install_from_source(
        &client,
        OFFICIAL_NODE_DIST,
        target,
        suffix,
        &official_stage,
        &managed,
        nonce,
    );
    if let Err(error) = std::fs::remove_dir_all(&official_stage) {
        eprintln!("清理 Node 下载暂存目录失败：{error}");
    }
    match official {
        Ok(()) => return Ok(()),
        Err(error) => failures.push(format!("Node.js 官方发行源：{error}")),
    }

    let mirror = latest_mirror_node_base(&client).and_then(|base| {
        let mirror_stage = root.join(format!(".node-stage-mirror-{}-{nonce}", std::process::id()));
        std::fs::create_dir(&mirror_stage)
            .map_err(|error| format!("创建 Node 镜像暂存目录失败：{error}"))?;
        let result = install_from_source(
            &client,
            &base,
            target,
            suffix,
            &mirror_stage,
            &managed,
            nonce,
        );
        if let Err(error) = std::fs::remove_dir_all(&mirror_stage) {
            eprintln!("清理 Node 镜像暂存目录失败：{error}");
        }
        result
    });
    if let Err(error) = mirror {
        failures.push(format!("npmmirror Node 发行源：{error}"));
        return Err(failures.join("；"));
    }
    Ok(())
}

fn latest_mirror_node_base(client: &reqwest::blocking::Client) -> Result<String, String> {
    #[derive(serde::Deserialize)]
    struct Release {
        version: String,
    }

    let index = download_metadata(client, &format!("{NPMMIRROR_NODE_DIST}index.json"))?;
    let releases: Vec<Release> = serde_json::from_str(&index)
        .map_err(|error| format!("解析 Node 镜像版本索引失败：{error}"))?;
    let latest = releases
        .into_iter()
        .filter_map(|release| {
            let version = release.version.strip_prefix('v')?;
            let parsed = parse_version(version)?;
            (parsed.0 == MINIMUM_MAJOR)
                .then_some((parsed, format!("{}.{}.{}", parsed.0, parsed.1, parsed.2)))
        })
        .max_by_key(|(version, _)| *version)
        .map(|(_, version)| version)
        .ok_or_else(|| "Node 镜像索引没有 Node 24 稳定版本".to_owned())?;
    Ok(format!("{NPMMIRROR_NODE_DIST}v{latest}/"))
}

fn install_from_source(
    client: &reqwest::blocking::Client,
    base: &str,
    target: &str,
    suffix: &str,
    stage: &Path,
    managed: &Path,
    nonce: u128,
) -> Result<(), String> {
    let manifest = download_metadata(client, &format!("{base}SHASUMS256.txt"))?;
    let (filename, version, expected_hash) = manifest_artifact(&manifest, suffix)?;
    let archive_path = stage.join(&filename);
    download_checked_archive(
        client,
        &format!("{base}{filename}"),
        &archive_path,
        &expected_hash,
    )?;

    let release_dirname = format!("node-v{version}-{target}");
    let extracted = stage.join("extracted");
    std::fs::create_dir(&extracted).map_err(|error| format!("创建 Node 解压目录失败：{error}"))?;
    extract_archive(&archive_path, &extracted, &release_dirname)?;
    let release_dir = extracted.join(&release_dirname);
    let executable = node_executable(&release_dir);
    let verified = probe(&executable).map_err(|error| format!("验证下载的 Node 失败：{error}"))?;
    if verified.major < MINIMUM_MAJOR {
        return Err(format!("下载到的 Node {} 低于 24", verified.version));
    }

    let backup = managed.with_file_name(format!(".node-v24-backup-{nonce}"));
    let had_managed = managed.exists();
    if had_managed {
        std::fs::rename(managed, &backup)
            .map_err(|error| format!("暂存已有 Node runtime 失败：{error}"))?;
    }
    if let Err(error) = std::fs::rename(&release_dir, managed) {
        if had_managed {
            if let Err(restore_error) = std::fs::rename(&backup, managed) {
                return Err(format!(
                    "发布 Node runtime 失败：{error}；恢复旧 runtime 也失败：{restore_error}"
                ));
            }
        }
        return Err(format!("发布 Node runtime 失败：{error}"));
    }
    if had_managed {
        if let Err(error) = std::fs::remove_dir_all(&backup) {
            eprintln!("清理旧 Node runtime 失败：{error}");
        }
    }
    Ok(())
}

fn download_target() -> Result<(&'static str, &'static str), String> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "x86_64") => Ok(("darwin-x64", "-darwin-x64.tar.gz")),
        ("macos", "aarch64") => Ok(("darwin-arm64", "-darwin-arm64.tar.gz")),
        ("windows", "x86_64") => Ok(("win-x64", "-win-x64.zip")),
        ("windows", "aarch64") => Ok(("win-arm64", "-win-arm64.zip")),
        ("linux", "x86_64") if linux_is_musl() => Ok(("linux-x64-musl", "-linux-x64-musl.tar.gz")),
        ("linux", "x86_64") => Ok(("linux-x64", "-linux-x64.tar.gz")),
        ("linux", "aarch64") if linux_is_musl() => {
            Err("Node 24 官方发行包目前没有 Linux arm64 musl 资产".to_owned())
        }
        ("linux", "aarch64") => Ok(("linux-arm64", "-linux-arm64.tar.gz")),
        (os, arch) => Err(format!("没有适用于 {os}-{arch} 的官方 Node 24 发行包")),
    }
}

fn linux_is_musl() -> bool {
    #[cfg(target_os = "linux")]
    {
        let loader = match std::env::consts::ARCH {
            "x86_64" => "/lib/ld-musl-x86_64.so.1",
            "aarch64" => "/lib/ld-musl-aarch64.so.1",
            _ => return false,
        };
        Path::new(loader).exists()
    }
    #[cfg(not(target_os = "linux"))]
    false
}

fn download_metadata(client: &reqwest::blocking::Client, url: &str) -> Result<String, String> {
    let mut response = client
        .get(url)
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .map_err(|error| format!("下载 Node 发行元数据失败：{error}"))?;
    if response
        .content_length()
        .is_some_and(|length| length > MAX_SHASUMS_BYTES)
    {
        return Err("Node 校验清单超过大小限制".to_owned());
    }
    let mut bytes = Vec::new();
    response
        .by_ref()
        .take(MAX_SHASUMS_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("读取 Node 发行元数据失败：{error}"))?;
    if bytes.len() as u64 > MAX_SHASUMS_BYTES {
        return Err("Node 校验清单超过大小限制".to_owned());
    }
    String::from_utf8(bytes).map_err(|_| "Node 校验清单不是有效 UTF-8".to_owned())
}

fn manifest_artifact(manifest: &str, suffix: &str) -> Result<(String, String, String), String> {
    for line in manifest.lines() {
        let mut fields = line.split_whitespace();
        let Some(hash) = fields.next() else { continue };
        let Some(filename) = fields.next() else {
            continue;
        };
        if fields.next().is_some()
            || hash.len() != 64
            || !hash.bytes().all(|byte| byte.is_ascii_hexdigit())
            || !filename
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-'))
            || !filename.starts_with("node-v24.")
            || !filename.ends_with(suffix)
        {
            continue;
        }
        let version = filename
            .strip_prefix("node-v")
            .and_then(|name| name.strip_suffix(suffix))
            .ok_or_else(|| "Node 校验清单中的发行包名称无效".to_owned())?;
        let Some((major, minor, patch)) = parse_version(version) else {
            continue;
        };
        if major < MINIMUM_MAJOR || version != format!("{major}.{minor}.{patch}") {
            continue;
        }
        return Ok((
            filename.to_owned(),
            version.to_owned(),
            hash.to_ascii_lowercase(),
        ));
    }
    Err(format!("校验清单没有匹配的 Node 24 发行包（{suffix}）"))
}

fn download_checked_archive(
    client: &reqwest::blocking::Client,
    url: &str,
    path: &Path,
    expected_hash: &str,
) -> Result<(), String> {
    let mut response = client
        .get(url)
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .map_err(|error| format!("下载 Node 发行包失败：{error}"))?;
    if response
        .content_length()
        .is_some_and(|length| length > MAX_NODE_ARCHIVE_BYTES)
    {
        return Err("Node 发行包超过大小限制".to_owned());
    }
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| format!("安全创建 Node 下载文件失败：{error}"))?;
    let mut hasher = Sha256::new();
    let mut total = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = response
            .read(&mut buffer)
            .map_err(|error| format!("读取 Node 发行包失败：{error}"))?;
        if count == 0 {
            break;
        }
        total = total.saturating_add(count as u64);
        if total > MAX_NODE_ARCHIVE_BYTES {
            return Err("Node 发行包超过大小限制".to_owned());
        }
        hasher.update(&buffer[..count]);
        file.write_all(&buffer[..count])
            .map_err(|error| format!("写入 Node 发行包失败：{error}"))?;
    }
    file.sync_all()
        .map_err(|error| format!("同步 Node 发行包失败：{error}"))?;
    let actual_hash =
        hasher
            .finalize()
            .iter()
            .fold(String::with_capacity(64), |mut result, byte| {
                let _ = write!(result, "{byte:02x}");
                result
            });
    if actual_hash != expected_hash {
        return Err("Node 发行包 SHA-256 校验失败".to_owned());
    }
    Ok(())
}

fn extract_archive(archive: &Path, destination: &Path, release_root: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let powershell = executable_in_path("powershell.exe")
            .ok_or_else(|| "未找到 PowerShell，无法解压 Node 发行包".to_owned())?;
        let script = r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($env:AGENTCHAT_NODE_ARCHIVE)
$paths = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$count = 0
$total = 0L
try {
    foreach ($entry in $zip.Entries) {
        $count += 1
        if ($count -gt 25000) { throw 'Node ZIP 文件数量超过限制' }
        $total += [long]$entry.Length
        if ($total -gt 536870912) { throw 'Node ZIP 解压总大小超过限制' }

        $name = $entry.FullName
        if ($name.Contains('\') -or $name.Contains(':') -or $name.StartsWith('/')) { throw 'Node ZIP 含有不安全路径' }
        $trimmed = $name.TrimEnd('/')
        $parts = $trimmed.Split('/')
        if ($parts.Length -eq 0 -or $parts[0] -ne $env:AGENTCHAT_NODE_ROOT -or ($parts | Where-Object { $_ -eq '' -or $_ -eq '.' -or $_ -eq '..' })) { throw 'Node ZIP 含有不安全路径' }
        foreach ($part in $parts) {
            if ($part -ne $part.TrimEnd([char[]]@(' ', '.'))) { throw 'Node ZIP 路径含有尾随空格或句点' }
            $baseName = $part.Split('.')[0]
            if ($baseName -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$') { throw 'Node ZIP 路径含有 Windows 保留设备名' }
        }
        if (-not $paths.Add(($parts -join '/'))) { throw 'Node ZIP 含有大小写不兼容的重复路径' }

        $unixType = ($entry.ExternalAttributes -shr 16) -band 0xF000
        if ($unixType -notin @(0, 0x8000, 0x4000) -or ($entry.ExternalAttributes -band 0x400) -ne 0) { throw 'Node ZIP 含有不支持的文件类型或链接' }
    }
} finally {
    $zip.Dispose()
}
Expand-Archive -LiteralPath $env:AGENTCHAT_NODE_ARCHIVE -DestinationPath $env:AGENTCHAT_NODE_EXTRACT -Force
"#;
        let output = Command::new(powershell)
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .env("AGENTCHAT_NODE_ARCHIVE", archive)
            .env("AGENTCHAT_NODE_EXTRACT", destination)
            .env("AGENTCHAT_NODE_ROOT", release_root)
            .output()
            .map_err(|error| format!("启动 PowerShell 解压 Node 失败：{error}"))?;
        if output.status.success() {
            Ok(())
        } else {
            Err(format!("解压 Node ZIP 失败：{}", output_detail(&output)))
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let tar = executable_in_path("tar")
            .ok_or_else(|| "未找到 tar，无法解压 Node 发行包".to_owned())?;
        let listing = Command::new(&tar)
            .args(["-tzf"])
            .arg(archive)
            .output()
            .map_err(|error| format!("读取 Node tarball 文件列表失败：{error}"))?;
        if !listing.status.success() {
            return Err(format!(
                "读取 Node tarball 文件列表失败：{}",
                output_detail(&listing)
            ));
        }
        let listing = String::from_utf8_lossy(&listing.stdout);
        validate_tar_paths(&listing, release_root)?;

        let verbose = Command::new(&tar)
            .args(["-tvzf"])
            .arg(archive)
            .output()
            .map_err(|error| format!("读取 Node tarball 链接列表失败：{error}"))?;
        if !verbose.status.success() {
            return Err(format!(
                "读取 Node tarball 链接列表失败：{}",
                output_detail(&verbose)
            ));
        }
        let verbose = String::from_utf8_lossy(&verbose.stdout);
        validate_tar_links(&verbose, release_root)?;

        let output = Command::new(tar)
            .arg("-xzf")
            .arg(archive)
            .arg("-C")
            .arg(destination)
            .output()
            .map_err(|error| format!("启动 tar 解压 Node 失败：{error}"))?;
        if output.status.success() {
            Ok(())
        } else {
            Err(format!(
                "解压 Node tarball 失败：{}",
                output_detail(&output)
            ))
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn validate_tar_paths(listing: &str, expected_root: &str) -> Result<(), String> {
    let mut found_root = false;
    for entry in listing.lines() {
        let components = archive_path_components(entry, expected_root)?;
        found_root |= components.len() == 1;
    }
    if found_root {
        Ok(())
    } else {
        Err("Node tarball 不包含预期的顶层目录".to_owned())
    }
}

#[cfg(not(target_os = "windows"))]
fn archive_path_components<'a>(
    entry: &'a str,
    expected_root: &str,
) -> Result<Vec<&'a str>, String> {
    let entry = entry.strip_prefix("./").unwrap_or(entry);
    let entry = entry.strip_suffix('/').unwrap_or(entry);
    if entry.is_empty() || entry.starts_with('/') || entry.contains('\\') || entry.contains(':') {
        return Err("Node tarball 含有绝对或不安全路径".to_owned());
    }
    let components: Vec<_> = entry.split('/').collect();
    if components.first() != Some(&expected_root)
        || components[1..]
            .iter()
            .any(|component| component.is_empty() || *component == "." || *component == "..")
    {
        return Err("Node tarball 路径越出预期顶层目录".to_owned());
    }
    Ok(components)
}

#[cfg(not(target_os = "windows"))]
fn validate_tar_links(listing: &str, expected_root: &str) -> Result<(), String> {
    for line in listing.lines() {
        let Some(kind) = line.as_bytes().first() else {
            continue;
        };
        let (entry, target, symbolic) = match *kind {
            b'l' => match line.split_once(" -> ") {
                Some((entry, target)) => (entry, target, true),
                None => return Err("Node tarball 符号链接格式无效".to_owned()),
            },
            b'h' => match line.split_once(" link to ") {
                Some((entry, target)) => (entry, target, false),
                None => return Err("Node tarball 硬链接格式无效".to_owned()),
            },
            b'-' | b'd' => continue,
            _ => return Err("Node tarball 含有不支持的特殊文件".to_owned()),
        };
        let entry = entry
            .split_whitespace()
            .last()
            .ok_or_else(|| "Node tarball 链接路径缺失".to_owned())?;
        let components = archive_path_components(entry, expected_root)?;
        if target.is_empty()
            || target.chars().any(char::is_whitespace)
            || target.contains('\\')
            || target.contains(':')
        {
            return Err("Node tarball 链接目标不安全".to_owned());
        }
        if symbolic {
            if target.starts_with('/') {
                return Err("Node tarball 含有绝对符号链接".to_owned());
            }
            let mut depth = components.len().saturating_sub(2);
            for component in target.split('/') {
                match component {
                    "" | "." => {}
                    ".." if depth > 0 => depth -= 1,
                    ".." => return Err("Node tarball 符号链接越出顶层目录".to_owned()),
                    _ => depth += 1,
                }
            }
        } else {
            archive_path_components(target, expected_root)?;
        }
    }
    Ok(())
}

fn node_executable(release_dir: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    return release_dir.join("node.exe");
    #[cfg(not(target_os = "windows"))]
    release_dir.join("bin/node")
}

fn managed_node_candidate() -> Option<PathBuf> {
    crate::host::data_dir()
        .ok()
        .map(|path| path.join("runtimes/node-v24"))
        .map(|path| node_executable(&path))
}

fn executable_in_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|directory| directory.join(name))
        .find(|path| path.is_file())
}

fn output_detail(output: &std::process::Output) -> String {
    if output.stderr.is_empty() {
        bounded_output(&output.stdout)
    } else {
        bounded_output(&output.stderr)
    }
}

fn bounded_output(bytes: &[u8]) -> String {
    let value = String::from_utf8_lossy(bytes).trim().to_owned();
    if value.chars().count() > 500 {
        format!("{}…", value.chars().take(500).collect::<String>())
    } else {
        value
    }
}

#[cfg(target_os = "linux")]
fn version_has_minimum_major(value: &str, minimum: u64) -> bool {
    let normalized = value.split_once(':').map_or(value, |(_, rest)| rest);
    let Some(start) = normalized.find(|character: char| character.is_ascii_digit()) else {
        return false;
    };
    let numeric = normalized[start..]
        .split(|character: char| !character.is_ascii_digit() && character != '.')
        .next()
        .unwrap_or_default();
    numeric
        .split('.')
        .next()
        .and_then(|major| major.parse::<u64>().ok())
        .is_some_and(|major| major >= minimum)
}

fn candidates() -> Vec<Candidate> {
    let mut result = Vec::new();
    if let Some(path) = std::env::var_os("AGENTCHAT_NODE") {
        result.push(Candidate {
            path: PathBuf::from(path),
            source: "configured",
        });
    }

    let binary = if cfg!(windows) { "node.exe" } else { "node" };
    if let Some(path) = std::env::var_os("PATH") {
        result.extend(std::env::split_paths(&path).map(|directory| Candidate {
            path: directory.join(binary),
            source: "path",
        }));
    }

    #[cfg(target_os = "macos")]
    result.extend(
        ["/opt/homebrew/bin/node", "/usr/local/bin/node"]
            .into_iter()
            .map(|path| Candidate {
                path: PathBuf::from(path),
                source: "system",
            }),
    );

    #[cfg(target_os = "linux")]
    result.extend(
        ["/usr/bin/node", "/usr/local/bin/node"]
            .into_iter()
            .map(|path| Candidate {
                path: PathBuf::from(path),
                source: "system",
            }),
    );

    #[cfg(target_os = "windows")]
    {
        for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Some(root) = std::env::var_os(variable) {
                result.push(Candidate {
                    path: PathBuf::from(root).join("nodejs").join("node.exe"),
                    source: "system",
                });
            }
        }
    }

    if let Some(path) = managed_node_candidate() {
        result.push(Candidate {
            path,
            source: "managed",
        });
    }

    result
}

fn probe(path: &Path) -> Result<Probe, String> {
    let version_output = run_with_timeout(path, &["--version"])?;
    if !version_output.status.success() {
        return Err(format!("运行 {} --version 失败", path.display()));
    }
    let version = String::from_utf8_lossy(&version_output.stdout)
        .trim()
        .trim_start_matches('v')
        .to_owned();
    let (major, minor, patch) =
        parse_version(&version).ok_or_else(|| format!("无法解析 Node 版本：{version}"))?;

    let sqlite_output = run_with_timeout(
        path,
        &[
            "-e",
            "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(':memory:'); db.close();",
        ],
    )?;
    if !sqlite_output.status.success() {
        return Err(format!("Node {version} 无法加载 node:sqlite"));
    }

    let architecture_output =
        run_with_timeout(path, &["-p", "`${process.platform}-${process.arch}`"])?;
    if !architecture_output.status.success() {
        return Err(format!("读取 Node {version} 的运行平台失败"));
    }
    let architecture = String::from_utf8_lossy(&architecture_output.stdout)
        .trim()
        .to_owned();
    let expected_architecture = expected_node_architecture();
    if architecture != expected_architecture {
        return Err(format!(
            "Node {version} 架构为 {architecture}，应用需要 {expected_architecture}"
        ));
    }
    Ok(Probe {
        version: format!("{major}.{minor}.{patch}"),
        major,
        architecture,
    })
}

fn expected_node_architecture() -> String {
    let platform = match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    };
    let architecture = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => other,
    };
    format!("{platform}-{architecture}")
}

fn parse_version(value: &str) -> Option<(u64, u64, u64)> {
    if value.contains('-') {
        return None;
    }
    let core = value.split('+').next()?;
    let mut pieces = core.split('.');
    let major = pieces.next()?.parse().ok()?;
    let minor = pieces.next()?.parse().ok()?;
    let patch = pieces.next()?.parse().ok()?;
    pieces.next().is_none().then_some((major, minor, patch))
}

fn run_with_timeout(path: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    let mut child = Command::new(path)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("启动 Node 检查失败：{error}"))?;
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return child.wait_with_output().map_err(|error| error.to_string()),
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(20)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Node runtime 检查超时".to_owned());
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("检查 Node runtime 进程失败：{error}"));
            }
        }
    }
}
