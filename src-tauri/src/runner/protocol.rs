use serde::{Deserialize, Serialize};
use serde_json::Value;

fn unsafe_attachment_name_character(character: char) -> bool {
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
}

// 请求合同：UI 到 Node Runner 的类型化 IPC 边界。Command 层只依赖这里的类型与
// validate；子进程传输与帧协议坐在 transport.rs 的 seam 之后。

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum RunnerRequest {
    Initialize,
    McpStatuses,
    BotSummaries,
    ReadBotMemory {
        bot_id: String,
    },
    SaveBotMemory {
        bot_id: String,
        expected_revision: u64,
        content: String,
    },
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
        #[serde(default)]
        attachments: Vec<AttachmentReference>,
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

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentReference {
    pub id: String,
    pub name: String,
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
            Self::ReadBotMemory { bot_id } | Self::SaveBotMemory { bot_id, .. } => {
                if bot_id.trim().is_empty() || !valid_text(bot_id, 400) {
                    return Err("Bot ID 无效".to_owned());
                }
                if let Self::SaveBotMemory {
                    expected_revision,
                    content,
                    ..
                } = self
                {
                    if *expected_revision > 9_007_199_254_740_991 {
                        return Err("Bot 记忆版本无效".to_owned());
                    }
                    if content.chars().count() > 2_000 {
                        return Err("Bot 记忆最多 2000 个字符".to_owned());
                    }
                }
            }
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
                text,
                request_id,
                attachments,
                ..
            } => {
                let valid_attachments = attachments.len() <= 3
                    && attachments.iter().all(|attachment| {
                        uuid::Uuid::parse_str(&attachment.id)
                            .is_ok_and(|id| id.to_string() == attachment.id)
                            && !attachment.name.trim().is_empty()
                            && valid_text(&attachment.name, 1_024)
                            && !attachment
                                .name
                                .chars()
                                .any(unsafe_attachment_name_character)
                    })
                    && attachments
                        .iter()
                        .map(|attachment| &attachment.id)
                        .collect::<std::collections::HashSet<_>>()
                        .len()
                        == attachments.len();
                if (text.trim().is_empty() && attachments.is_empty())
                    || !valid_text(text, 64_000)
                    || request_id.trim().is_empty()
                    || !valid_text(request_id, 400)
                    || !valid_attachments
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
            | Self::McpStatuses
            | Self::BotSummaries
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

#[derive(Debug, Deserialize, Serialize)]
pub struct RunnerReply {
    pub result: Value,
}

#[derive(Serialize)]
pub(crate) struct WireRequest {
    pub(crate) id: u64,
    #[serde(flatten)]
    pub(crate) request: RunnerRequest,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct WireResponse {
    pub(crate) id: u64,
    pub(crate) ok: bool,
    pub(crate) result: Option<Value>,
    pub(crate) error: Option<String>,
}

impl WireResponse {
    pub(crate) fn into_result(self) -> Result<(u64, Result<Value, String>), String> {
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

#[cfg(test)]
mod tests {
    use super::*;

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
    fn bot_summaries_round_trips_as_a_parameterless_public_request() {
        let request: RunnerRequest =
            serde_json::from_value(serde_json::json!({"op": "botSummaries"})).unwrap();
        assert!(request.validate().is_ok());
        assert_eq!(
            serde_json::to_value(&request).unwrap(),
            serde_json::json!({"op": "botSummaries"})
        );
        assert_eq!(
            serde_json::to_value(WireRequest { id: 7, request }).unwrap(),
            serde_json::json!({"id": 7, "op": "botSummaries"})
        );
    }

    #[test]
    fn rejects_malformed_bot_summaries_requests() {
        for value in [
            serde_json::json!({"op": "BotSummaries"}),
            serde_json::json!({"op": "bot_summaries"}),
            serde_json::json!({"op": "botSummariesUnknown"}),
            serde_json::json!({}),
            serde_json::json!({"op": null}),
            serde_json::json!({"op": 7}),
            serde_json::json!({"op": {"botSummaries": {}}}),
            serde_json::json!("botSummaries"),
            serde_json::json!([{"op": "botSummaries"}]),
            Value::Null,
        ] {
            assert!(
                serde_json::from_value::<RunnerRequest>(value.clone()).is_err(),
                "accepted malformed request: {value}"
            );
        }
        assert!(
            serde_json::from_str::<RunnerRequest>(r#"{"op":"botSummaries","op":"close"}"#).is_err()
        );
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
