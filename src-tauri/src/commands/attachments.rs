use serde::Serialize;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

const MAX_ATTACHMENTS: usize = 3;
const MAX_TEXT_BYTES: usize = 4 * 1024 * 1024;
const MAX_IMAGE_BYTES: usize = 3 * 1024 * 1024;
const MAX_TOTAL_BYTES: usize = 8 * 1024 * 1024;
const EXPIRED_AFTER: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
enum AttachmentKind {
    Text,
    Image,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedAttachment {
    id: String,
    name: String,
    size: u64,
    mime_type: &'static str,
    kind: AttachmentKind,
}

struct ValidatedAttachment {
    id: String,
    name: String,
    bytes: Vec<u8>,
    mime_type: &'static str,
    kind: AttachmentKind,
}

#[tauri::command]
pub async fn pick_attachments(
    app: AppHandle,
    remaining: u8,
) -> Result<Vec<StagedAttachment>, String> {
    if remaining == 0 || usize::from(remaining) > MAX_ATTACHMENTS {
        return Err("附件数量已达上限".to_owned());
    }
    tauri::async_runtime::spawn_blocking(move || {
        // Let users select several files at once, while keeping each request bounded by
        // the remaining attachment slots in the current message.
        let selected = app
            .dialog()
            .file()
            .add_filter(
                "文本与代码",
                &[
                    "txt", "md", "markdown", "json", "csv", "tsv", "log", "yaml", "yml", "toml",
                    "xml", "html", "css", "js", "jsx", "ts", "tsx", "py", "rs", "go", "java", "c",
                    "cpp", "h", "hpp", "sh", "sql", "ini", "conf",
                ],
            )
            .add_filter("图片", &["png", "jpg", "jpeg", "gif", "webp"])
            .blocking_pick_files();
        let Some(selected) = selected else {
            return Ok(Vec::new());
        };
        if selected.is_empty() {
            return Ok(Vec::new());
        }
        if selected.len() > usize::from(remaining) {
            return Err(format!("最多还能添加 {} 个附件", remaining));
        }
        let paths = selected
            .into_iter()
            .map(|path| {
                path.into_path()
                    .map_err(|_| "无法读取所选文件路径".to_owned())
            })
            .collect::<Result<Vec<_>, _>>()?;
        let data_dir = crate::host::data_dir()?;
        stage_paths(&data_dir, paths)
    })
    .await
    .map_err(|_| "附件选择任务失败".to_owned())?
}

#[tauri::command]
pub async fn delete_attachments(ids: Vec<String>) -> Result<(), String> {
    if ids.len() > MAX_ATTACHMENTS || ids.iter().any(|id| parse_id(id).is_err()) {
        return Err("附件引用无效".to_owned());
    }
    let data_dir = crate::host::data_dir()?;
    tauri::async_runtime::spawn_blocking(move || delete_staged_ids(&data_dir, ids))
        .await
        .map_err(|_| "附件清理任务失败".to_owned())?
}

pub(crate) fn delete_staged_ids(data_dir: &Path, ids: Vec<String>) -> Result<(), String> {
    if ids.len() > MAX_ATTACHMENTS || ids.iter().any(|id| parse_id(id).is_err()) {
        return Err("附件引用无效".to_owned());
    }
    delete_staged(data_dir, ids)
}

pub fn cleanup_expired(data_dir: &Path) -> Result<(), String> {
    if !data_dir.exists() {
        return Ok(());
    }
    let directory = staged_dir(data_dir, false)?;
    let Some(directory) = directory else {
        return Ok(());
    };
    let entries = fs::read_dir(directory).map_err(|_| "无法检查暂存附件".to_owned())?;
    let now = SystemTime::now();
    for entry in entries {
        let entry = entry.map_err(|_| "无法检查暂存附件".to_owned())?;
        if entry
            .file_type()
            .map_err(|_| "无法检查暂存附件".to_owned())?
            .is_file()
            && parse_id(&entry.file_name().to_string_lossy()).is_ok()
        {
            let metadata = entry
                .metadata()
                .map_err(|_| "无法检查暂存附件".to_owned())?;
            if metadata
                .modified()
                .ok()
                .and_then(|modified| now.duration_since(modified).ok())
                .is_some_and(|age| age > EXPIRED_AFTER)
            {
                fs::remove_file(entry.path()).map_err(|_| "无法清理过期附件".to_owned())?;
            }
        }
    }
    Ok(())
}

fn stage_paths(data_dir: &Path, paths: Vec<PathBuf>) -> Result<Vec<StagedAttachment>, String> {
    let mut attachments = Vec::with_capacity(paths.len());
    let mut total = 0usize;
    for path in paths {
        let name = safe_name(&path)?;
        let extension = extension(&name)?;
        let (kind, mime_type, limit) = classify_extension(extension)?;
        let bytes = read_source(&path, limit)?;
        validate_content(kind, extension, &bytes)?;
        total = total
            .checked_add(bytes.len())
            .filter(|size| *size <= MAX_TOTAL_BYTES)
            .ok_or("附件总大小超过 8 MiB")?;
        attachments.push(ValidatedAttachment {
            id: Uuid::new_v4().to_string(),
            name,
            bytes,
            mime_type,
            kind,
        });
    }

    let directory = staged_dir(data_dir, true)?.ok_or("附件暂存目录不可用")?;
    let mut created = Vec::with_capacity(attachments.len());
    for attachment in &attachments {
        let path = directory.join(&attachment.id);
        let write_result = write_private_file(&path, &attachment.bytes);
        if let Err(error) = write_result {
            let _ = fs::remove_file(&path);
            for id in &created {
                let _ = fs::remove_file(directory.join(id));
            }
            return Err(error);
        }
        created.push(attachment.id.clone());
    }

    let staged = attachments
        .into_iter()
        .map(|attachment| StagedAttachment {
            id: attachment.id,
            name: attachment.name,
            size: attachment.bytes.len() as u64,
            mime_type: attachment.mime_type,
            kind: attachment.kind,
        })
        .collect();
    Ok(staged)
}

fn safe_name(path: &Path) -> Result<String, String> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("文件名无效")?;
    let clean = name.trim();
    if clean.is_empty()
        || clean.chars().count() > 255
        || clean.chars().any(|character| {
            character.is_control()
                || matches!(
                    character,
                    '/' | '\\'
                        | '\u{061c}'
                        | '\u{200e}'
                        | '\u{200f}'
                        | '\u{2028}'..='\u{202e}'
                        | '\u{2066}'..='\u{2069}'
                )
        })
    {
        return Err("文件名无效或过长".to_owned());
    }
    Ok(clean.to_owned())
}

fn extension(name: &str) -> Result<&str, String> {
    name.rsplit_once('.')
        .map(|(_, extension)| extension)
        .filter(|extension| !extension.is_empty())
        .ok_or_else(|| "不支持的附件格式".to_owned())
}

fn classify_extension(extension: &str) -> Result<(AttachmentKind, &'static str, usize), String> {
    let extension = extension.to_ascii_lowercase();
    if matches!(
        extension.as_str(),
        "txt"
            | "md"
            | "markdown"
            | "json"
            | "csv"
            | "tsv"
            | "log"
            | "yaml"
            | "yml"
            | "toml"
            | "xml"
            | "html"
            | "css"
            | "js"
            | "jsx"
            | "ts"
            | "tsx"
            | "py"
            | "rs"
            | "go"
            | "java"
            | "c"
            | "cpp"
            | "h"
            | "hpp"
            | "sh"
            | "sql"
            | "ini"
            | "conf"
    ) {
        return Ok((AttachmentKind::Text, "text/plain", MAX_TEXT_BYTES));
    }
    if matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp") {
        return Ok((
            AttachmentKind::Image,
            image_mime(&extension),
            MAX_IMAGE_BYTES,
        ));
    }
    Err("不支持的附件格式".to_owned())
}

fn image_mime(extension: &str) -> &'static str {
    match extension {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    }
}

fn read_source(path: &Path, limit: usize) -> Result<Vec<u8>, String> {
    let link_metadata = fs::symlink_metadata(path).map_err(|_| "无法读取所选文件".to_owned())?;
    if !link_metadata.file_type().is_file() {
        return Err("附件必须是普通文件，不能是符号链接或目录".to_owned());
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // Open the reparse point itself so the handle metadata checks the object we read.
        options.custom_flags(windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let mut file = options
        .open(path)
        .map_err(|_| "无法打开所选文件".to_owned())?;
    let metadata = file.metadata().map_err(|_| "无法读取所选文件".to_owned())?;
    #[cfg(windows)]
    let is_reparse_point = {
        use std::os::windows::fs::MetadataExt;

        metadata.file_attributes()
            & windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT
            != 0
    };
    #[cfg(not(windows))]
    let is_reparse_point = false;
    if !metadata.file_type().is_file() || is_reparse_point {
        return Err("附件必须是普通文件".to_owned());
    }
    let mut bytes = Vec::with_capacity(limit.min(64 * 1024));
    Read::by_ref(&mut file)
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "无法读取所选文件".to_owned())?;
    if bytes.len() > limit {
        return Err(if limit == MAX_TEXT_BYTES {
            "文本附件超过 4 MiB".to_owned()
        } else {
            "图片附件超过 3 MiB".to_owned()
        });
    }
    Ok(bytes)
}

fn validate_content(kind: AttachmentKind, extension: &str, bytes: &[u8]) -> Result<(), String> {
    match kind {
        AttachmentKind::Text => {
            std::str::from_utf8(bytes).map_err(|_| "文本附件必须使用 UTF-8 编码".to_owned())?;
        }
        AttachmentKind::Image => {
            let valid = match extension.to_ascii_lowercase().as_str() {
                "png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
                "jpg" | "jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
                "gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
                "webp" => bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
                _ => false,
            };
            if !valid {
                return Err("图片扩展名与文件内容不匹配".to_owned());
            }
        }
    }
    Ok(())
}

fn staged_dir(data_dir: &Path, create: bool) -> Result<Option<PathBuf>, String> {
    let canonical_data_dir =
        fs::canonicalize(data_dir).map_err(|_| "应用数据目录不可用".to_owned())?;
    let attachments = canonical_data_dir.join("attachments");
    let staged = attachments.join("staged");
    if create {
        ensure_directory(&attachments)?;
        ensure_directory(&staged)?;
    } else {
        match fs::symlink_metadata(&attachments) {
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err("附件暂存目录不可用".to_owned()),
        }
        match fs::symlink_metadata(&staged) {
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err("附件暂存目录不可用".to_owned()),
        }
    }
    for path in [&attachments, &staged] {
        let metadata = fs::symlink_metadata(path).map_err(|_| "附件暂存目录不可用".to_owned())?;
        if !metadata.file_type().is_dir() {
            return Err("附件暂存目录不能是符号链接".to_owned());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(path, fs::Permissions::from_mode(0o700))
                .map_err(|_| "无法保护附件暂存目录".to_owned())?;
        }
    }
    let canonical = fs::canonicalize(&staged).map_err(|_| "附件暂存目录不可用".to_owned())?;
    if canonical != staged {
        return Err("附件暂存目录边界无效".to_owned());
    }
    Ok(Some(canonical))
}

fn ensure_directory(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_dir() => Ok(()),
        Ok(_) => Err("附件暂存目录不能是符号链接".to_owned()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => match fs::create_dir(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                let metadata =
                    fs::symlink_metadata(path).map_err(|_| "附件暂存目录不可用".to_owned())?;
                if metadata.file_type().is_dir() {
                    Ok(())
                } else {
                    Err("附件暂存目录不能是符号链接".to_owned())
                }
            }
            Err(_) => Err("无法创建附件暂存目录".to_owned()),
        },
        Err(_) => Err("附件暂存目录不可用".to_owned()),
    }
}

fn write_private_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file: File = options.open(path).map_err(|_| "无法暂存附件".to_owned())?;
    file.write_all(bytes)
        .and_then(|()| file.sync_all())
        .map_err(|_| "无法暂存附件".to_owned())
}

fn delete_staged(data_dir: &Path, ids: Vec<String>) -> Result<(), String> {
    let Some(directory) = staged_dir(data_dir, false)? else {
        return Ok(());
    };
    for id in ids {
        let path = directory.join(id);
        match fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("无法清理暂存附件".to_owned()),
        }
    }
    Ok(())
}

fn parse_id(value: &str) -> Result<Uuid, String> {
    let id = Uuid::parse_str(value).map_err(|_| "附件引用无效".to_owned())?;
    if id.to_string() != value {
        return Err("附件引用无效".to_owned());
    }
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDirectory(PathBuf);

    impl TempDirectory {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("agentchat-attachments-{}", Uuid::new_v4()));
            fs::create_dir_all(&path).expect("temporary test directory should be created");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn classifies_supported_formats_and_rejects_unsupported_extensions() {
        assert!(matches!(
            classify_extension("MD"),
            Ok((AttachmentKind::Text, "text/plain", MAX_TEXT_BYTES))
        ));
        assert!(matches!(
            classify_extension("webp"),
            Ok((AttachmentKind::Image, "image/webp", MAX_IMAGE_BYTES))
        ));
        assert_eq!(
            classify_extension("zip").err().as_deref(),
            Some("不支持的附件格式")
        );
    }

    #[test]
    fn validates_utf8_text_and_image_signatures() {
        assert!(validate_content(AttachmentKind::Text, "txt", "你好".as_bytes()).is_ok());
        assert_eq!(
            validate_content(AttachmentKind::Text, "txt", &[0xc3, 0x28]).unwrap_err(),
            "文本附件必须使用 UTF-8 编码"
        );
        assert!(validate_content(AttachmentKind::Image, "png", b"\x89PNG\r\n\x1a\nbody").is_ok());
        assert_eq!(
            validate_content(AttachmentKind::Image, "png", b"not an image").unwrap_err(),
            "图片扩展名与文件内容不匹配"
        );
    }

    #[test]
    fn stages_valid_file_with_private_directory_and_file_permissions() {
        let temp = TempDirectory::new();
        let data_dir = temp.path().join("data");
        fs::create_dir(&data_dir).unwrap();
        let source = temp.path().join("notes.md");
        fs::write(&source, "本机附件").unwrap();

        let staged = stage_paths(&data_dir, vec![source]).unwrap();

        assert_eq!(staged.len(), 1);
        assert_eq!(staged[0].name, "notes.md");
        assert_eq!(staged[0].size, "本机附件".len() as u64);
        assert_eq!(staged[0].mime_type, "text/plain");
        assert!(matches!(staged[0].kind, AttachmentKind::Text));
        let directory = data_dir.join("attachments").join("staged");
        assert_eq!(
            fs::read(directory.join(&staged[0].id)).unwrap(),
            "本机附件".as_bytes()
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&directory).unwrap().permissions().mode() & 0o777,
                0o700
            );
            assert_eq!(
                fs::metadata(directory.join(&staged[0].id))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symbolic_link_sources_and_staging_directories() {
        use std::os::unix::fs::symlink;

        let temp = TempDirectory::new();
        let data_dir = temp.path().join("data");
        fs::create_dir(&data_dir).unwrap();
        let source = temp.path().join("source.txt");
        fs::write(&source, "content").unwrap();
        let source_link = temp.path().join("source-link.txt");
        symlink(&source, &source_link).unwrap();
        assert!(read_source(&source_link, MAX_TEXT_BYTES).is_err());

        let target = temp.path().join("target");
        fs::create_dir(&target).unwrap();
        symlink(&target, data_dir.join("attachments")).unwrap();
        assert_eq!(
            staged_dir(&data_dir, true).unwrap_err(),
            "附件暂存目录不能是符号链接"
        );
    }
}
