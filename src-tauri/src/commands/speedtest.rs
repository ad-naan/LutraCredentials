//! 端点测速：对候选 Base URL 发两次 GET（热身 + 计时），返回延迟毫秒数。
//!
//! 协议要点（参考 cc-switch speedtest 服务）：
//! - 热身请求复用连接池、消除 DNS/TLS 首包惩罚；第二次请求计时
//! - HTTP 4xx/5xx 也算成功（无认证 GET 能拿到任何状态码即证明链路通）
//! - 所有端点并发执行，单端点失败不影响其它端点

use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use tauri::AppHandle;

use crate::utils::logger::{log_debug, log_info};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EndpointLatency {
    pub url: String,
    pub latency: Option<u64>,
    pub status: Option<u16>,
    pub error: Option<String>,
}

/// 超时钳制在 [2, 30] 秒
fn sanitize_timeout(timeout_secs: Option<u64>) -> Duration {
    let secs = timeout_secs.unwrap_or(8).clamp(2, 30);
    Duration::from_secs(secs)
}

fn classify_reqwest_error(err: &reqwest::Error) -> String {
    if err.is_timeout() {
        "请求超时".to_string()
    } else if err.is_connect() {
        "连接失败".to_string()
    } else {
        err.to_string()
    }
}

async fn measure_endpoint(client: &reqwest::Client, url: &str, timeout: Duration) -> EndpointLatency {
    let mut result = EndpointLatency {
        url: url.to_string(),
        latency: None,
        status: None,
        error: None,
    };

    let parsed = match reqwest::Url::parse(url) {
        Ok(u) => u,
        Err(e) => {
            result.error = Some(format!("无效 URL: {}", e));
            return result;
        }
    };
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        result.error = Some("仅支持 http/https".to_string());
        return result;
    }

    let client = client.clone();
    let url = parsed;

    // 热身请求：忽略结果，只为了让连接池建好 TCP/TLS
    let _ = client
        .get(url.clone())
        .timeout(timeout)
        .send()
        .await;

    // 第二次请求计时
    let start = Instant::now();
    match client.get(url).timeout(timeout).send().await {
        Ok(resp) => {
            result.latency = Some(start.elapsed().as_millis() as u64);
            result.status = Some(resp.status().as_u16());
        }
        Err(e) => {
            result.error = Some(classify_reqwest_error(&e));
        }
    }

    result
}

#[tauri::command]
pub async fn test_api_endpoints(
    _app: AppHandle,
    urls: Vec<String>,
    timeout_secs: Option<u64>,
) -> Result<Vec<EndpointLatency>, String> {
    log_debug(&format!("端点测速: {} 个候选", urls.len()));

    let timeout = sanitize_timeout(timeout_secs);
    let client = reqwest::Client::builder()
        .user_agent("LutraCredentials-SpeedTest/1.0")
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let mut tasks = tokio::task::JoinSet::new();
    for url in urls {
        let client = client.clone();
        tasks.spawn(async move { measure_endpoint(&client, &url, timeout).await });
    }

    let mut results = Vec::new();
    while let Some(joined) = tasks.join_next().await {
        match joined {
            Ok(r) => results.push(r),
            Err(e) => results.push(EndpointLatency {
                url: String::new(),
                latency: None,
                status: None,
                error: Some(format!("测速任务失败: {}", e)),
            }),
        }
    }

    log_info(&format!("端点测速完成: {} 个结果", results.len()));
    Ok(results)
}
