use crate::core::oauth;
use crate::utils::logger::{log_error, log_warn};
use serde::{Deserialize, Serialize};
use serde_json::json;

/// Cloud Code API 端点（与 Antigravity IDE 1.20.x 客户端保持一致）
const CLOUD_CODE_BASE_URL: &str = "https://cloudcode-pa.googleapis.com";
const CLOUD_CODE_FALLBACK_URL: &str = "https://daily-cloudcode-pa.sandbox.googleapis.com";

const QUOTA_MODELS_PATH: &str = "/v1internal:fetchAvailableModels";
const QUOTA_SUMMARY_PATH: &str = "/v1internal:retrieveUserQuotaSummary";
const LOAD_PROJECT_PATH: &str = "/v1internal:loadCodeAssist";

const X_GOOG_API_CLIENT: &str = "gl-node/22.21.1";
const ANTIGRAVITY_VERSION: &str = "1.20.5";

/// 模拟 Antigravity IDE 的 User-Agent
fn cloud_code_user_agent() -> String {
    let arch = match std::env::consts::ARCH {
        "x86_64" => "amd64",
        "aarch64" => "arm64",
        other => other,
    };
    format!(
        "antigravity/{} {}/{} google-api-nodejs-client/10.3.0",
        ANTIGRAVITY_VERSION,
        std::env::consts::OS,
        arch
    )
}

#[derive(Debug, Serialize, Deserialize)]
struct QuotaResponse {
    #[serde(default)]
    models: std::collections::HashMap<String, ModelInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ModelInfo {
    #[serde(rename = "quotaInfo")]
    quota_info: Option<QuotaInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
struct QuotaInfo {
    #[serde(rename = "remainingFraction")]
    remaining_fraction: Option<f64>,
    #[serde(rename = "resetTime")]
    reset_time: Option<String>,
}

#[derive(Debug, Deserialize)]
struct LoadProjectResponse {
    #[serde(rename = "cloudaicompanionProject")]
    project_id: Option<String>,
    #[serde(rename = "currentTier")]
    current_tier: Option<Tier>,
    #[serde(rename = "paidTier")]
    paid_tier: Option<Tier>,
}

#[derive(Debug, Deserialize)]
struct Tier {
    id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QuotaData {
    pub models: Vec<ModelQuota>,
    /// retrieveUserQuotaSummary 返回的周期性用量桶（如 5h / weekly）
    #[serde(default)]
    pub usage_buckets: Vec<UsageBucket>,
    pub subscription_tier: Option<String>,
    pub is_forbidden: bool,
    pub last_updated: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModelQuota {
    pub name: String,
    pub percentage: i32,
    pub reset_time: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UsageBucket {
    /// 桶标识，如 "gemini-5h"、"claude:weekly"
    pub id: String,
    pub display_name: Option<String>,
    pub percentage: i32,
    pub reset_time: String,
}

impl QuotaData {
    pub fn new() -> Self {
        Self {
            models: Vec::new(),
            usage_buckets: Vec::new(),
            subscription_tier: None,
            is_forbidden: false,
            last_updated: chrono::Utc::now().timestamp_millis(),
        }
    }
}

/// 依次尝试主端点和备用端点执行请求
async fn post_cloud_code(
    path: &str,
    access_token: &str,
    payload: &serde_json::Value,
) -> Result<(reqwest::Response, String), String> {
    let client = oauth::get_client();
    let user_agent = cloud_code_user_agent();
    let mut last_err = String::new();

    for base in [CLOUD_CODE_BASE_URL, CLOUD_CODE_FALLBACK_URL] {
        let url = format!("{}{}", base, path);
        let res = client
            .post(&url)
            .bearer_auth(access_token)
            .header("User-Agent", &user_agent)
            .header("x-goog-api-client", X_GOOG_API_CLIENT)
            .json(payload)
            .send()
            .await;

        match res {
            Ok(res) => return Ok((res, base.to_string())),
            Err(e) => {
                log_warn(&format!("[Quota] {} request failed: {}", url, e));
                last_err = format!("{}: {}", url, e);
            }
        }
    }

    Err(last_err)
}

pub async fn fetch_project_id(access_token: &str) -> (Option<String>, Option<String>) {
    let meta = json!({"metadata": {"ideType": "ANTIGRAVITY"}});

    match post_cloud_code(LOAD_PROJECT_PATH, access_token, &meta).await {
        Ok((res, _)) => {
            if res.status().is_success() {
                if let Ok(data) = res.json::<LoadProjectResponse>().await {
                    let project_id = data.project_id.clone();
                    let tier = data
                        .paid_tier
                        .and_then(|t| t.id)
                        .or_else(|| data.current_tier.and_then(|t| t.id));
                    return (project_id, tier);
                }
            }
        }
        Err(e) => log_error(&format!("loadCodeAssist error: {}", e)),
    }

    (None, None)
}

pub async fn fetch_quota(
    access_token: &str,
    project_id: Option<&str>,
) -> Result<(QuotaData, Option<String>), String> {
    // Fetch project_id and subscription_tier if not provided
    let (final_project_id, subscription_tier) = match project_id {
        Some(p) => (p.to_string(), None),
        None => {
            let (fetched_pid, fetched_tier) = fetch_project_id(access_token).await;
            (
                fetched_pid.unwrap_or_else(|| "bamboo-precept-lgxtn".to_string()),
                fetched_tier,
            )
        }
    };

    let payload = json!({ "project": final_project_id });

    let (response, _) = post_cloud_code(QUOTA_MODELS_PATH, access_token, &payload).await?;

    if !response.status().is_success() {
        if response.status().as_u16() == 403 {
            let mut q = QuotaData::new();
            q.is_forbidden = true;
            q.subscription_tier = subscription_tier;
            return Ok((q, Some(final_project_id)));
        }
        return Err(format!("Quota API error: {}", response.status()));
    }

    let quota_res: QuotaResponse = response.json().await.map_err(|e| e.to_string())?;
    let mut quota_data = QuotaData::new();

    for (name, info) in quota_res.models {
        if let Some(quota_info) = info.quota_info {
            let percentage = quota_info
                .remaining_fraction
                .map(|f| (f * 100.0) as i32)
                .unwrap_or(0);

            // Filter interesting models
            if name.contains("gemini") || name.contains("claude") {
                quota_data.models.push(ModelQuota {
                    name,
                    percentage,
                    reset_time: quota_info.reset_time.unwrap_or_default(),
                });
            }
        }
    }

    // Fetch periodic usage buckets (5h / weekly) via retrieveUserQuotaSummary
    if let Ok((summary_res, _)) =
        post_cloud_code(QUOTA_SUMMARY_PATH, access_token, &payload).await
    {
        if summary_res.status().is_success() {
            if let Ok(summary) = summary_res.json::<serde_json::Value>().await {
                quota_data.usage_buckets = parse_usage_buckets(&summary);
            }
        }
    }

    // Set subscription tier
    quota_data.subscription_tier = subscription_tier;

    Ok((quota_data, Some(final_project_id)))
}

/// 解析 retrieveUserQuotaSummary 响应中的用量桶
///
/// 响应结构：`{ "groups": [ { "buckets": [ { "bucketId", "displayName", "remainingFraction", "resetTime" } ] } ] }`
fn parse_usage_buckets(summary: &serde_json::Value) -> Vec<UsageBucket> {
    let mut buckets = Vec::new();

    if let Some(groups) = summary.get("groups").and_then(|v| v.as_array()) {
        for group in groups {
            let group_buckets = match group.get("buckets").and_then(|v| v.as_array()) {
                Some(b) => b,
                None => continue,
            };
            for bucket in group_buckets {
                let (Some(id), Some(fraction)) = (
                    bucket.get("bucketId").and_then(|v| v.as_str()),
                    bucket.get("remainingFraction").and_then(|v| v.as_f64()),
                ) else {
                    continue;
                };
                buckets.push(UsageBucket {
                    id: id.to_string(),
                    display_name: bucket
                        .get("displayName")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    percentage: (fraction * 100.0) as i32,
                    reset_time: bucket
                        .get("resetTime")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string(),
                });
            }
        }
    }

    buckets
}
