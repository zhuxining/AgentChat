use keyring::{Entry, Error};

const SERVICE: &str = "com.syneju.agentchat";
const DEEPSEEK_API_KEY: &str = "deepseek-api-key";

pub fn read_deepseek_api_key() -> Result<Option<String>, String> {
    let entry = Entry::new(SERVICE, DEEPSEEK_API_KEY)
        .map_err(|error| format!("打开系统凭据库失败：{error}"))?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("读取系统凭据库失败：{error}")),
    }
}

pub fn effective_deepseek_api_key() -> (Option<String>, Option<String>) {
    let environment_key = std::env::var("DEEPSEEK_API_KEY").ok();
    match read_deepseek_api_key() {
        Ok(stored_key) => (stored_key.or(environment_key), None),
        Err(error) => (environment_key, Some(error)),
    }
}

pub fn write_deepseek_api_key(value: Option<&str>) -> Result<(), String> {
    let entry = Entry::new(SERVICE, DEEPSEEK_API_KEY)
        .map_err(|error| format!("打开系统凭据库失败：{error}"))?;
    match value {
        Some(value) => entry
            .set_password(value)
            .map_err(|error| format!("写入系统凭据库失败：{error}")),
        None => match entry.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(error) => Err(format!("删除系统凭据失败：{error}")),
        },
    }
}
