use keyring::{Entry, Error};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const SERVICE: &str = "com.syneju.agentchat";
const DEEPSEEK_API_KEY: &str = "deepseek-api-key";
const MAX_FILE: u64 = 1_048_576;
static NEXT_FILE: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
enum CredentialSource {
    Keyring { entry: String },
    Env { variable: String },
    File { path: String, entry: String },
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceParams {
    source: CredentialSource,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WriteParams {
    source: CredentialSource,
    credential: Value,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EnvParams {
    name: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FileParams {
    path: String,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct CredentialFile {
    entries: BTreeMap<String, Value>,
}

/// This entry point is private to the child stdout reader, never a Tauri command.
pub(crate) fn native_request(
    data_dir: &Path,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let invalid = || "内部凭据请求参数无效".to_owned();
    match method {
        "readCredential" => {
            let params: SourceParams = serde_json::from_value(params).map_err(|_| invalid())?;
            read_source(data_dir, &params.source).map(|value| value.unwrap_or(Value::Null))
        }
        "writeCredential" => {
            let params: WriteParams = serde_json::from_value(params).map_err(|_| invalid())?;
            validate_credential(&params.credential)?;
            write_source(data_dir, &params.source, Some(params.credential))?;
            Ok(Value::Null)
        }
        "deleteCredential" => {
            let params: SourceParams = serde_json::from_value(params).map_err(|_| invalid())?;
            write_source(data_dir, &params.source, None)?;
            Ok(Value::Null)
        }
        "env" => {
            let params: EnvParams = serde_json::from_value(params).map_err(|_| invalid())?;
            read_env(&params.name).map(|value| value.map_or(Value::Null, Value::String))
        }
        "fileExists" => {
            let params: FileParams = serde_json::from_value(params).map_err(|_| invalid())?;
            if params.path.is_empty() || params.path.len() > 8_000 || params.path.contains('\0') {
                return Err(invalid());
            }
            // Ambient authentication probes only get existence, never file contents.
            let path = if params.path == "~" || params.path.starts_with("~/") {
                std::env::var_os("HOME")
                    .or_else(|| std::env::var_os("USERPROFILE"))
                    .map(|home| {
                        PathBuf::from(home).join(if params.path == "~" {
                            ""
                        } else {
                            &params.path[2..]
                        })
                    })
            } else {
                Some(PathBuf::from(params.path))
            };
            Ok(Value::Bool(path.is_some_and(|path| path.exists())))
        }
        _ => Err("不支持的内部凭据操作".to_owned()),
    }
}

fn valid_entry(entry: &str) -> Result<(), String> {
    if entry.is_empty() || entry.len() > 400 || entry.chars().any(char::is_control) {
        return Err("凭据条目无效".to_owned());
    }
    Ok(())
}

fn read_env(name: &str) -> Result<Option<String>, String> {
    let mut bytes = name.bytes();
    if name.len() > 256
        || !bytes
            .next()
            .is_some_and(|byte| byte.is_ascii_alphabetic() || byte == b'_')
        || !bytes.all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
    {
        return Err("环境变量名称无效".to_owned());
    }
    match std::env::var(name) {
        Ok(value) if value.len() <= 65_536 => Ok(Some(value)),
        Ok(_) => Err("环境凭据超过大小限制".to_owned()),
        Err(std::env::VarError::NotPresent) => Ok(None),
        Err(_) => Err("环境凭据编码无效".to_owned()),
    }
}

fn validate_credential(value: &Value) -> Result<(), String> {
    let invalid = || "凭据格式无效".to_owned();
    if serde_json::to_vec(value).map_err(|_| invalid())?.len() > 65_536 {
        return Err("凭据超过大小限制".to_owned());
    }
    let object = value.as_object().ok_or_else(invalid)?;
    match value.get("type").and_then(Value::as_str) {
        Some("api_key") => {
            if object
                .keys()
                .any(|key| !["type", "key", "env"].contains(&key.as_str()))
                || value.get("key").is_some_and(|key| !key.is_string())
                || value.get("env").is_some_and(|env| {
                    env.as_object()
                        .is_none_or(|env| env.values().any(|value| !value.is_string()))
                })
            {
                return Err(invalid());
            }
            if let Some(key) = value.get("key").and_then(Value::as_str) {
                validate_key_expression(key)?;
            }
        }
        Some("oauth") => {
            if !value.get("access").is_some_and(Value::is_string)
                || !value.get("refresh").is_some_and(Value::is_string)
                || !value.get("expires").is_some_and(Value::is_number)
            {
                return Err(invalid());
            }
        }
        _ => return Err(invalid()),
    }
    Ok(())
}

fn validate_key_expression(key: &str) -> Result<(), String> {
    if key.trim_start().starts_with('!') {
        return Err("不支持命令形式的凭据".to_owned());
    }
    if key.starts_with('$') {
        let name = key
            .strip_prefix("${")
            .and_then(|key| key.strip_suffix('}'))
            .or_else(|| key.strip_prefix('$'))
            .ok_or("环境凭据引用无效")?;
        // Validate without resolving, so saving a reference does not require its variable.
        if name.is_empty()
            || name.len() > 256
            || !name.bytes().enumerate().all(|(index, byte)| {
                byte == b'_' || byte.is_ascii_alphabetic() || (index > 0 && byte.is_ascii_digit())
            })
        {
            return Err("环境凭据引用无效".to_owned());
        }
    }
    Ok(())
}

fn resolve_file_credential(mut value: Value) -> Result<Value, String> {
    validate_credential(&value)?;
    if value["type"] == "api_key" {
        if let Some(key) = value.get("key").and_then(Value::as_str) {
            if let Some(reference) = key.strip_prefix('$') {
                let name = reference
                    .strip_prefix('{')
                    .and_then(|name| name.strip_suffix('}'))
                    .unwrap_or(reference);
                let resolved = read_env(name)?
                    .filter(|value| !value.is_empty())
                    .ok_or("凭据引用的环境变量不可用")?;
                value["key"] = Value::String(resolved);
            }
        }
    }
    Ok(value)
}

fn keyring_entry(name: &str) -> Result<Entry, String> {
    valid_entry(name)?;
    Entry::new(SERVICE, name).map_err(|_| "打开系统凭据库失败".to_owned())
}

fn read_source(data_dir: &Path, source: &CredentialSource) -> Result<Option<Value>, String> {
    match source {
        CredentialSource::Keyring { entry } => {
            match keyring_entry(entry)?.get_password() {
                Ok(password) => {
                    // The legacy entry contains a raw key. Keep it in place for migration.
                    let value = if entry == DEEPSEEK_API_KEY {
                        json!({"type":"api_key", "key":password})
                    } else {
                        serde_json::from_str(&password).map_err(|_| "系统凭据格式无效")?
                    };
                    validate_credential(&value)?;
                    Ok(Some(value))
                }
                Err(Error::NoEntry) => Ok(None),
                Err(_) => Err("读取系统凭据库失败".to_owned()),
            }
        }
        CredentialSource::Env { variable } => Ok(read_env(variable)?
            .filter(|value| !value.is_empty())
            .map(|key| json!({"type":"api_key", "key":key}))),
        CredentialSource::File { path, entry } => {
            valid_entry(entry)?;
            let (directory, name) = credential_directory(data_dir, path)?;
            let file = read_file(&directory, &name)?;
            file.entries
                .get(entry)
                .cloned()
                .map(resolve_file_credential)
                .transpose()
        }
    }
}

fn write_source(
    data_dir: &Path,
    source: &CredentialSource,
    credential: Option<Value>,
) -> Result<(), String> {
    match source {
        CredentialSource::Env { .. } => Err("环境变量凭据是只读来源".to_owned()),
        CredentialSource::Keyring { entry } => {
            let store = keyring_entry(entry)?;
            match credential {
                Some(credential) => {
                    let password = if entry == DEEPSEEK_API_KEY {
                        credential
                            .get("key")
                            .and_then(Value::as_str)
                            .filter(|_| credential["type"] == "api_key")
                            .ok_or("旧凭据条目只支持 API Key")?
                            .to_owned()
                    } else {
                        serde_json::to_string(&credential).map_err(|_| "凭据编码失败")?
                    };
                    store
                        .set_password(&password)
                        .map_err(|_| "写入系统凭据库失败".to_owned())
                }
                None => match store.delete_credential() {
                    Ok(()) | Err(Error::NoEntry) => Ok(()),
                    Err(_) => Err("删除系统凭据失败".to_owned()),
                },
            }
        }
        CredentialSource::File { path, entry } => {
            valid_entry(entry)?;
            let (directory, name) = credential_directory(data_dir, path)?;
            let mut file = read_file(&directory, &name)?;
            match credential {
                Some(credential) => {
                    file.entries.insert(entry.clone(), credential);
                }
                None => {
                    file.entries.remove(entry);
                }
            }
            let contents = serde_json::to_vec(&file).map_err(|_| "凭据编码失败")?;
            if contents.len() as u64 > MAX_FILE {
                return Err("凭据文件超过大小限制".to_owned());
            }
            directory.atomic_write(&name, &contents)
        }
    }
}

fn credential_components(path: &str) -> Result<Vec<&str>, String> {
    // Reject backslashes on every platform; Windows drive/UNC paths never become relative.
    if path.len() > 4_000 || path.contains('\\') || path.contains('\0') || path.contains(':') {
        return Err("凭据文件路径无效".to_owned());
    }
    let parts: Vec<_> = path.split('/').collect();
    if parts.len() < 2
        || parts.len() > 20
        || parts[0] != "credentials"
        || parts.iter().any(|part| {
            let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
            part.is_empty()
                || *part == "."
                || *part == ".."
                || part.ends_with(['.', ' '])
                || part
                    .chars()
                    .any(|value| value.is_control() || "<>|?*".contains(value))
                || ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
                || ((stem.starts_with("COM") || stem.starts_with("LPT"))
                    && stem.len() == 4
                    && matches!(stem.as_bytes()[3], b'1'..=b'9'))
        })
        || Path::new(path)
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("凭据文件必须位于 credentials 目录内".to_owned());
    }
    Ok(parts)
}

fn credential_directory(data_dir: &Path, path: &str) -> Result<(PrivateDirectory, String), String> {
    let mut parts = credential_components(path)?;
    let name = parts.pop().ok_or("凭据文件路径无效")?.to_owned();
    let mut directory = PrivateDirectory::root(data_dir)?;
    for part in parts {
        directory = directory.child(part)?;
    }
    Ok((directory, name))
}

fn read_file(directory: &PrivateDirectory, name: &str) -> Result<CredentialFile, String> {
    let Some(file) = directory.read(name)? else {
        return Ok(CredentialFile::default());
    };
    let mut contents = Vec::new();
    file.take(MAX_FILE + 1)
        .read_to_end(&mut contents)
        .map_err(|_| "读取凭据文件失败")?;
    if contents.len() as u64 > MAX_FILE {
        return Err("凭据文件超过大小限制".to_owned());
    }
    serde_json::from_slice(&contents).map_err(|_| "凭据文件格式无效".to_owned())
}

#[cfg(unix)]
struct PrivateDirectory(File);

#[cfg(unix)]
impl PrivateDirectory {
    fn root(path: &Path) -> Result<Self, String> {
        use std::os::unix::fs::OpenOptionsExt;
        let file = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(path)
            .map_err(|_| "打开凭据数据目录失败")?;
        Self::check_owner(&file)?;
        Ok(Self(file))
    }

    fn check_owner(file: &File) -> Result<(), String> {
        use std::os::unix::fs::MetadataExt;
        let metadata = file.metadata().map_err(|_| "读取凭据权限失败")?;
        // geteuid has no preconditions.
        if metadata.uid() != unsafe { libc::geteuid() } {
            return Err("凭据文件所有者无效".to_owned());
        }
        Ok(())
    }

    fn name(name: &str) -> Result<std::ffi::CString, String> {
        std::ffi::CString::new(name).map_err(|_| "凭据文件路径无效".to_owned())
    }

    fn child(&self, name: &str) -> Result<Self, String> {
        use std::os::fd::{AsRawFd, FromRawFd};
        let name = Self::name(name)?;
        // All names are validated single components, and every traversal is relative to an open directory.
        let created = unsafe { libc::mkdirat(self.0.as_raw_fd(), name.as_ptr(), 0o700) };
        if created == -1
            && std::io::Error::last_os_error().kind() != std::io::ErrorKind::AlreadyExists
        {
            return Err("创建凭据目录失败".to_owned());
        }
        let fd = unsafe {
            libc::openat(
                self.0.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd == -1 {
            return Err("凭据目录无效或包含符号链接".to_owned());
        }
        let file = unsafe { File::from_raw_fd(fd) };
        Self::check_owner(&file)?;
        if unsafe { libc::fchmod(fd, 0o700) } == -1 {
            return Err("设置凭据目录权限失败".to_owned());
        }
        Ok(Self(file))
    }

    fn read(&self, name: &str) -> Result<Option<File>, String> {
        use std::os::fd::{AsRawFd, FromRawFd};
        use std::os::unix::fs::MetadataExt;
        let name = Self::name(name)?;
        let fd = unsafe {
            libc::openat(
                self.0.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC,
            )
        };
        if fd == -1 {
            return match std::io::Error::last_os_error().kind() {
                std::io::ErrorKind::NotFound => Ok(None),
                _ => Err("凭据文件无效或包含符号链接".to_owned()),
            };
        }
        let file = unsafe { File::from_raw_fd(fd) };
        Self::check_owner(&file)?;
        let metadata = file.metadata().map_err(|_| "读取凭据文件状态失败")?;
        if !metadata.is_file() || metadata.nlink() != 1 {
            return Err("凭据路径必须是独立的普通文件".to_owned());
        }
        if unsafe { libc::fchmod(fd, 0o600) } == -1 {
            return Err("设置凭据文件权限失败".to_owned());
        }
        Ok(Some(file))
    }

    fn atomic_write(&self, name: &str, contents: &[u8]) -> Result<(), String> {
        use std::os::fd::{AsRawFd, FromRawFd};
        let name = Self::name(name)?;
        let temporary = Self::name(&format!(
            ".credential-{}-{}",
            std::process::id(),
            NEXT_FILE.fetch_add(1, Ordering::Relaxed)
        ))?;
        let directory = self.0.as_raw_fd();
        let fd = unsafe {
            libc::openat(
                directory,
                temporary.as_ptr(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                0o600,
            )
        };
        if fd == -1 {
            return Err("创建临时凭据文件失败".to_owned());
        }
        let mut file = unsafe { File::from_raw_fd(fd) };
        let result = (|| {
            file.write_all(contents).map_err(|_| "写入凭据文件失败")?;
            file.sync_all().map_err(|_| "同步凭据文件失败")?;
            if unsafe { libc::renameat(directory, temporary.as_ptr(), directory, name.as_ptr()) }
                == -1
            {
                return Err("替换凭据文件失败".to_owned());
            }
            self.0.sync_all().map_err(|_| "同步凭据目录失败".to_owned())
        })();
        if result.is_err() {
            unsafe {
                libc::unlinkat(directory, temporary.as_ptr(), 0);
            }
        }
        result
    }
}

#[cfg(windows)]
struct PrivateDirectory {
    path: PathBuf,
    // Omitting FILE_SHARE_DELETE pins every ancestor until the operation finishes.
    guards: Vec<std::sync::Arc<File>>,
}

#[cfg(windows)]
mod windows_private {
    use super::*;
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::{LocalFree, GENERIC_READ, GENERIC_WRITE};
    use windows_sys::Win32::Security::Authorization::{
        ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
        SetSecurityInfo, SDDL_REVISION_1, SE_FILE_OBJECT,
    };
    use windows_sys::Win32::Security::{
        GetSecurityDescriptorDacl, GetTokenInformation, TokenUser, ACL, DACL_SECURITY_INFORMATION,
        PROTECTED_DACL_SECURITY_INFORMATION, TOKEN_USER,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, MoveFileExW, BY_HANDLE_FILE_INFORMATION,
        FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS,
        FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ, FILE_SHARE_WRITE, MOVEFILE_REPLACE_EXISTING,
        MOVEFILE_WRITE_THROUGH, READ_CONTROL, WRITE_DAC,
    };

    struct LocalAllocation(*mut std::ffi::c_void);
    impl Drop for LocalAllocation {
        fn drop(&mut self) {
            // The wrapped memory is allocated by the Windows conversion APIs below.
            unsafe {
                LocalFree(self.0);
            }
        }
    }

    fn private_acl(file: &File) -> Result<(), String> {
        // GetCurrentProcessToken() is the documented pseudo handle -4 on Windows 8+.
        let token = (-4isize) as windows_sys::Win32::Foundation::HANDLE;
        let mut size = 0;
        unsafe {
            GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut size);
        }
        if size == 0 || size > 65_536 {
            return Err("读取凭据所有者失败".to_owned());
        }
        // usize storage gives TOKEN_USER its required pointer alignment.
        let mut storage = vec![0usize; (size as usize).div_ceil(std::mem::size_of::<usize>())];
        if unsafe {
            GetTokenInformation(
                token,
                TokenUser,
                storage.as_mut_ptr().cast(),
                size,
                &mut size,
            )
        } == 0
        {
            return Err("读取凭据所有者失败".to_owned());
        }
        let user = unsafe { &*storage.as_ptr().cast::<TOKEN_USER>() };
        let mut sid_text = std::ptr::null_mut();
        if unsafe { ConvertSidToStringSidW(user.User.Sid, &mut sid_text) } == 0
            || sid_text.is_null()
        {
            return Err("读取凭据所有者失败".to_owned());
        }
        let sid_allocation = LocalAllocation(sid_text.cast());
        let mut length = 0;
        while length < 256 && unsafe { *sid_text.add(length) } != 0 {
            length += 1;
        }
        if length == 256 {
            return Err("凭据所有者无效".to_owned());
        }
        let sid = String::from_utf16(unsafe { std::slice::from_raw_parts(sid_text, length) })
            .map_err(|_| "凭据所有者无效")?;
        drop(sid_allocation);
        // Protect against inherited broad grants; only this user and SYSTEM retain access.
        let descriptor_text: Vec<u16> = format!("D:P(A;OICI;FA;;;{sid})(A;OICI;FA;;;SY)\0")
            .encode_utf16()
            .collect();
        let mut descriptor = std::ptr::null_mut();
        if unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                descriptor_text.as_ptr(),
                SDDL_REVISION_1,
                &mut descriptor,
                std::ptr::null_mut(),
            )
        } == 0
            || descriptor.is_null()
        {
            return Err("创建凭据安全描述符失败".to_owned());
        }
        let _descriptor_allocation = LocalAllocation(descriptor);
        let mut present = 0;
        let mut defaulted = 0;
        let mut acl: *mut ACL = std::ptr::null_mut();
        if unsafe { GetSecurityDescriptorDacl(descriptor, &mut present, &mut acl, &mut defaulted) }
            == 0
            || present == 0
            || acl.is_null()
        {
            return Err("创建凭据访问规则失败".to_owned());
        }
        if unsafe {
            SetSecurityInfo(
                file.as_raw_handle(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                acl,
                std::ptr::null_mut(),
            )
        } != 0
        {
            return Err("设置凭据访问权限失败".to_owned());
        }
        Ok(())
    }

    fn check_handle(file: &File, directory: bool) -> Result<(), String> {
        let mut info = BY_HANDLE_FILE_INFORMATION::default();
        if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
            return Err("读取凭据文件状态失败".to_owned());
        }
        if info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
            || (info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0) != directory
            || (!directory && info.nNumberOfLinks != 1)
        {
            return Err("凭据路径不能包含重解析点、符号链接或硬链接".to_owned());
        }
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use windows_sys::Win32::Security::Authorization::{
            ConvertSecurityDescriptorToStringSecurityDescriptorW, GetSecurityInfo,
        };

        fn assert_private(file: &File) {
            let mut descriptor = std::ptr::null_mut();
            assert_eq!(
                unsafe {
                    GetSecurityInfo(
                        file.as_raw_handle(),
                        SE_FILE_OBJECT,
                        DACL_SECURITY_INFORMATION,
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        &mut descriptor,
                    )
                },
                0
            );
            let _descriptor = LocalAllocation(descriptor);
            let mut text = std::ptr::null_mut();
            let mut length = 0;
            assert_ne!(
                unsafe {
                    ConvertSecurityDescriptorToStringSecurityDescriptorW(
                        descriptor,
                        SDDL_REVISION_1,
                        DACL_SECURITY_INFORMATION,
                        &mut text,
                        &mut length,
                    )
                },
                0
            );
            let _text = LocalAllocation(text.cast());
            let text = String::from_utf16(unsafe {
                std::slice::from_raw_parts(text, length.saturating_sub(1) as usize)
            })
            .unwrap();
            assert!(text.starts_with("D:P"), "{text}");
            assert_eq!(text.matches("(A;").count(), 2, "{text}");
            assert!(text.contains(";;;SY)"), "{text}");
            for group in [";;;WD)", ";;;BU)", ";;;AU)", ";;;BA)"] {
                assert!(!text.contains(group), "{text}");
            }
        }

        #[test]
        fn files_and_directories_have_private_protected_dacls_and_atomic_replacement() {
            let path = std::env::temp_dir().join(format!(
                "agentchat-windows-acl-{}-{}",
                std::process::id(),
                NEXT_FILE.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir(&path).unwrap();
            let directory = PrivateDirectory::root(&path)
                .unwrap()
                .child("credentials")
                .unwrap();
            for guard in directory.guards.iter().skip(1) {
                assert_private(guard);
            }
            directory.atomic_write("providers.json", b"first").unwrap();
            directory.atomic_write("providers.json", b"second").unwrap();
            let mut file = directory.read("providers.json").unwrap().unwrap();
            assert_private(&file);
            let mut result = String::new();
            file.read_to_string(&mut result).unwrap();
            assert_eq!(result, "second");
            drop(file);
            drop(directory);
            std::fs::remove_dir_all(path).unwrap();
        }
    }

    impl PrivateDirectory {
        fn open_directory(path: &Path, protect: bool) -> Result<File, String> {
            let access = GENERIC_READ | if protect { READ_CONTROL | WRITE_DAC } else { 0 };
            let file = OpenOptions::new()
                .access_mode(access)
                .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
                .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS)
                .open(path)
                .map_err(|_| "打开凭据目录失败")?;
            check_handle(&file, true)?;
            if protect {
                private_acl(&file)?;
            }
            Ok(file)
        }
        pub(super) fn root(path: &Path) -> Result<Self, String> {
            let file = Self::open_directory(path, false)?;
            let path = std::fs::canonicalize(path).map_err(|_| "解析凭据目录失败")?;
            Ok(Self {
                path,
                guards: vec![std::sync::Arc::new(file)],
            })
        }
        pub(super) fn child(&self, name: &str) -> Result<Self, String> {
            let path = self.path.join(name);
            match std::fs::create_dir(&path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(_) => return Err("创建凭据目录失败".to_owned()),
            }
            let file = Self::open_directory(&path, true)?;
            let mut guards = self.guards.clone();
            guards.push(std::sync::Arc::new(file));
            Ok(Self { path, guards })
        }
        pub(super) fn read(&self, name: &str) -> Result<Option<File>, String> {
            let file = match OpenOptions::new()
                .access_mode(GENERIC_READ | READ_CONTROL | WRITE_DAC)
                .share_mode(FILE_SHARE_READ)
                .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
                .open(self.path.join(name))
            {
                Ok(file) => file,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
                Err(_) => return Err("打开凭据文件失败".to_owned()),
            };
            check_handle(&file, false)?;
            if !file
                .metadata()
                .map_err(|_| "读取凭据文件状态失败")?
                .is_file()
            {
                return Err("凭据路径必须是普通文件".to_owned());
            }
            private_acl(&file)?;
            Ok(Some(file))
        }
        pub(super) fn atomic_write(&self, name: &str, contents: &[u8]) -> Result<(), String> {
            use std::os::windows::ffi::OsStrExt;
            let temporary = self.path.join(format!(
                ".credential-{}-{}",
                std::process::id(),
                NEXT_FILE.fetch_add(1, Ordering::Relaxed)
            ));
            let result = (|| {
                let mut file = OpenOptions::new()
                    .write(true)
                    .access_mode(GENERIC_WRITE | READ_CONTROL | WRITE_DAC)
                    .share_mode(0)
                    .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
                    .create_new(true)
                    .open(&temporary)
                    .map_err(|_| "创建临时凭据文件失败")?;
                check_handle(&file, false)?;
                // An empty file is made private before any credential bytes are written.
                private_acl(&file)?;
                file.write_all(contents).map_err(|_| "写入凭据文件失败")?;
                file.sync_all().map_err(|_| "同步凭据文件失败")?;
                drop(file);
                let from: Vec<u16> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
                let target: Vec<u16> = self
                    .path
                    .join(name)
                    .as_os_str()
                    .encode_wide()
                    .chain(Some(0))
                    .collect();
                if unsafe {
                    MoveFileExW(
                        from.as_ptr(),
                        target.as_ptr(),
                        MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
                    )
                } == 0
                {
                    return Err("替换凭据文件失败".to_owned());
                }
                Ok(())
            })();
            if result.is_err() {
                let _ = std::fs::remove_file(temporary);
            }
            result
        }
    }
}

#[cfg(not(any(unix, windows)))]
struct PrivateDirectory;
#[cfg(not(any(unix, windows)))]
impl PrivateDirectory {
    fn root(_: &Path) -> Result<Self, String> {
        Err("当前平台尚不支持私有凭据文件".to_owned())
    }
    fn child(&self, _: &str) -> Result<Self, String> {
        Err("当前平台尚不支持私有凭据文件".to_owned())
    }
    fn read(&self, _: &str) -> Result<Option<File>, String> {
        Err("当前平台尚不支持私有凭据文件".to_owned())
    }
    fn atomic_write(&self, _: &str, _: &[u8]) -> Result<(), String> {
        Err("当前平台尚不支持私有凭据文件".to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Directory(PathBuf);
    impl Directory {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "agentchat-credentials-{}-{}",
                std::process::id(),
                NEXT_FILE.fetch_add(1, Ordering::Relaxed)
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
    fn source() -> Value {
        json!({"type":"file","path":"credentials/providers.json","entry":"instance-a"})
    }
    fn call(directory: &Directory, method: &str, params: Value) -> Result<Value, String> {
        native_request(&directory.0, method, params)
    }

    #[test]
    fn file_credentials_round_trip_replace_delete_and_preserve_other_entries() {
        let directory = Directory::new();
        assert_eq!(
            call(&directory, "readCredential", json!({"source":source()})).unwrap(),
            Value::Null
        );
        let credential = json!({"type":"oauth","access":"access","refresh":"refresh","expires":1234,"accountId":"account"});
        call(
            &directory,
            "writeCredential",
            json!({"source":source(),"credential":credential}),
        )
        .unwrap();
        let other = json!({"type":"file","path":"credentials/providers.json","entry":"instance-b"});
        call(
            &directory,
            "writeCredential",
            json!({"source":other,"credential":{"type":"api_key","key":"literal"}}),
        )
        .unwrap();
        assert_eq!(
            call(&directory, "readCredential", json!({"source":source()})).unwrap(),
            credential
        );
        call(&directory, "deleteCredential", json!({"source":source()})).unwrap();
        assert_eq!(
            call(&directory, "readCredential", json!({"source":source()})).unwrap(),
            Value::Null
        );
        assert_eq!(
            call(&directory, "readCredential", json!({"source":other})).unwrap()["key"],
            "literal"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(directory.0.join("credentials"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
            assert_eq!(
                std::fs::metadata(directory.0.join("credentials/providers.json"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn rejects_unknown_sources_fields_mutable_environment_and_unsafe_paths() {
        let directory = Directory::new();
        for path in [
            "providers.json",
            "/credentials/key",
            "credentials/../key",
            "credentials//key",
            "credentials/./key",
            "credentials\\key",
            "credentials/C:key",
            "credentials/key/",
            "credentials/.. /key",
            "credentials/key.",
            "credentials/NUL.json",
            "credentials/COM1",
        ] {
            let source = json!({"type":"file","path":path,"entry":"a"});
            assert!(
                call(&directory, "readCredential", json!({"source":source})).is_err(),
                "{path}"
            );
        }
        for source in [
            json!({"type":"env","variable":"HOME","fallback":"keyring"}),
            json!({"type":"raw","key":"secret"}),
        ] {
            assert!(call(&directory, "readCredential", json!({"source":source})).is_err());
        }
        let source = json!({"type":"env","variable":"HOME"});
        assert!(call(
            &directory,
            "writeCredential",
            json!({"source":source,"credential":{"type":"api_key","key":"key"}})
        )
        .is_err());
        assert!(call(&directory, "deleteCredential", json!({"source":source})).is_err());
        assert!(call(&directory, "env", json!({"name":"INVALID=KEY"})).is_err());
    }

    #[test]
    fn file_key_references_are_explicit_and_commands_never_execute() {
        let directory = Directory::new();
        let variable = format!("AGENTCHAT_CREDENTIAL_TEST_{}", std::process::id());
        std::env::set_var(&variable, "resolved-key");
        for key in [format!("${variable}"), format!("${{{variable}}}")] {
            call(
                &directory,
                "writeCredential",
                json!({"source":source(),"credential":{"type":"api_key","key":key}}),
            )
            .unwrap();
            assert_eq!(
                call(&directory, "readCredential", json!({"source":source()})).unwrap()["key"],
                "resolved-key"
            );
        }
        std::env::remove_var(variable);
        assert!(call(&directory, "readCredential", json!({"source":source()})).is_err());
        for key in [
            "!echo secret",
            "  !cat private",
            "${HOME}/extra",
            "$",
            "$A B",
        ] {
            assert!(call(
                &directory,
                "writeCredential",
                json!({"source":source(),"credential":{"type":"api_key","key":key}})
            )
            .is_err());
        }
        assert!(validate_credential(&json!({"type":"api_key","env":{"PROJECT":"id"}})).is_ok());
        assert!(validate_credential(
            &json!({"type":"oauth","access":"a","refresh":"r","expires":"invalid"})
        )
        .is_err());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlink_directories_files_hardlinks_and_nonregular_files() {
        use std::os::unix::fs::symlink;
        let directory = Directory::new();
        let outside = Directory::new();
        symlink(&outside.0, directory.0.join("credentials")).unwrap();
        assert!(call(&directory, "readCredential", json!({"source":source()})).is_err());
        std::fs::remove_file(directory.0.join("credentials")).unwrap();
        std::fs::create_dir(directory.0.join("credentials")).unwrap();
        std::fs::write(outside.0.join("secret"), "private").unwrap();
        symlink(
            outside.0.join("secret"),
            directory.0.join("credentials/providers.json"),
        )
        .unwrap();
        assert!(call(&directory, "readCredential", json!({"source":source()})).is_err());
        std::fs::remove_file(directory.0.join("credentials/providers.json")).unwrap();
        std::fs::hard_link(
            outside.0.join("secret"),
            directory.0.join("credentials/providers.json"),
        )
        .unwrap();
        assert!(call(&directory, "readCredential", json!({"source":source()})).is_err());
        std::fs::remove_file(directory.0.join("credentials/providers.json")).unwrap();
        std::fs::create_dir(directory.0.join("credentials/providers.json")).unwrap();
        assert!(call(&directory, "readCredential", json!({"source":source()})).is_err());
        assert_eq!(
            std::fs::read_to_string(outside.0.join("secret")).unwrap(),
            "private"
        );
    }

    #[test]
    fn environment_and_ambient_existence_probes_only_return_requested_values() {
        let directory = Directory::new();
        let name = format!("AGENTCHAT_ENV_RPC_TEST_{}", std::process::id());
        std::env::set_var(&name, "test-env-key");
        assert_eq!(
            call(&directory, "env", json!({"name":name})).unwrap(),
            "test-env-key"
        );
        assert_eq!(
            call(
                &directory,
                "readCredential",
                json!({"source":{"type":"env","variable":name}})
            )
            .unwrap(),
            json!({"type":"api_key","key":"test-env-key"})
        );
        std::env::remove_var(&name);
        assert_eq!(
            call(&directory, "env", json!({"name":name})).unwrap(),
            Value::Null
        );
        assert_eq!(
            call(
                &directory,
                "readCredential",
                json!({"source":{"type":"env","variable":name}})
            )
            .unwrap(),
            Value::Null
        );
        let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"));
        assert_eq!(
            call(&directory, "fileExists", json!({"path":"~"})).unwrap(),
            home.is_some_and(|home| Path::new(&home).exists())
        );
        assert!(call(&directory, "fileExists", json!({"path":"secret\0path"})).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn tightens_existing_file_and_directory_permissions_before_reading() {
        use std::os::unix::fs::PermissionsExt;
        let directory = Directory::new();
        let credentials = directory.0.join("credentials");
        std::fs::create_dir(&credentials).unwrap();
        let path = credentials.join("providers.json");
        std::fs::write(
            &path,
            r#"{"entries":{"instance-a":{"type":"api_key","key":"literal"}}}"#,
        )
        .unwrap();
        std::fs::set_permissions(&credentials, std::fs::Permissions::from_mode(0o777)).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o666)).unwrap();
        assert_eq!(
            call(&directory, "readCredential", json!({"source":source()})).unwrap()["key"],
            "literal"
        );
        assert_eq!(
            std::fs::metadata(&credentials)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[test]
    fn malformed_and_large_files_return_safe_errors_and_are_never_overwritten() {
        let directory = Directory::new();
        std::fs::create_dir(directory.0.join("credentials")).unwrap();
        let path = directory.0.join("credentials/providers.json");
        std::fs::write(&path, "private-secret-invalid-json").unwrap();
        let error = call(&directory, "readCredential", json!({"source":source()})).unwrap_err();
        assert!(!error.contains("private-secret"));
        assert!(call(&directory, "deleteCredential", json!({"source":source()})).is_err());
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "private-secret-invalid-json"
        );
        std::fs::write(&path, vec![b' '; MAX_FILE as usize + 1]).unwrap();
        assert!(call(&directory, "readCredential", json!({"source":source()})).is_err());
        assert_eq!(
            call(&directory, "fileExists", json!({"path":path})).unwrap(),
            true
        );
    }
}
