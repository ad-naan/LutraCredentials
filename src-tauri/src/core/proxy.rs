//! 本地代理引擎：将 HTTP 请求转发到配置的 AI 提供商，支持故障转移和聚合模式

use axum::{
    body::Body,
    extract::State,
    response::Response,
    routing::any,
    Router,
};
use http::{Method, Uri, HeaderMap, header};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::{net::SocketAddr, sync::Arc, time::Duration};
use tokio::{net::TcpListener, sync::RwLock, task::JoinHandle};
use tower::ServiceBuilder;
use tower_http::trace::TraceLayer;

use crate::utils::logger::{log_debug, log_error, log_info};

/// 上游端点配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpstreamConfig {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub api_key: Option<String>,
    pub auth_header: Option<String>,
    pub auth_prefix: Option<String>,
    pub priority: u32,
    pub timeout_ms: u64,
    pub enabled: bool,
}

impl UpstreamConfig {
    pub fn auth_kv(&self) -> Option<(String, String)> {
        let key = self.api_key.as_ref()?;
        let header = self.auth_header.as_deref().unwrap_or("Authorization");
        let prefix = self.auth_prefix.as_deref().unwrap_or("Bearer ");
        Some((header.to_string(), format!("{}{}", prefix, key)))
    }
}

/// 代理配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyConfig {
    pub enabled: bool,
    pub port: u16,
    pub upstreams: Vec<UpstreamConfig>,
    pub failover_enabled: bool,
    pub max_retries: u32,
    pub health_check_interval_secs: u64,
    /// 聚合模式：parallel（并行请求所有上游，取首个成功响应）
    pub aggregation_mode: AggregationMode,
    /// 聚合模式下并行请求的超时（毫秒）
    pub aggregation_timeout_ms: u64,
}

/// 聚合模式
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AggregationMode {
    /// 禁用（使用故障转移）
    Disabled,
    /// 并行请求所有上游，取首个成功的响应
    Race,
    /// 并行请求所有上游，取延迟最低的成功响应
    LowestLatency,
}

impl Default for AggregationMode {
    fn default() -> Self {
        Self::Disabled
    }
}

impl Default for ProxyConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            port: 3456,
            upstreams: Vec::new(),
            failover_enabled: true,
            max_retries: 3,
            health_check_interval_secs: 30,
            aggregation_mode: AggregationMode::Disabled,
            aggregation_timeout_ms: 30000,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpstreamHealth {
    pub id: String,
    pub name: String,
    pub healthy: bool,
    pub last_checked: Option<i64>,
    pub latency_ms: Option<u64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyStatus {
    pub running: bool,
    pub listen_addr: Option<String>,
    pub active_upstream_id: Option<String>,
    pub active_upstream_name: Option<String>,
    pub total_requests: u64,
    pub failed_requests: u64,
    pub upstreams_health: Vec<UpstreamHealth>,
    pub started_at: Option<i64>,
    pub error: Option<String>,
}

impl Default for ProxyStatus {
    fn default() -> Self {
        Self {
            running: false,
            listen_addr: None,
            active_upstream_id: None,
            active_upstream_name: None,
            total_requests: 0,
            failed_requests: 0,
            upstreams_health: Vec::new(),
            started_at: None,
            error: None,
        }
    }
}

struct ProxyRuntimeInner {
    config: RwLock<ProxyConfig>,
    status: RwLock<ProxyStatus>,
    http_client: Client,
}

impl ProxyRuntimeInner {
    fn new(config: ProxyConfig) -> Self {
        let http_client = Client::builder()
            .timeout(Duration::from_secs(30))
            .danger_accept_invalid_certs(false)
            .build()
            .expect("Failed to build HTTP client");

        Self {
            config: RwLock::new(config),
            status: RwLock::new(ProxyStatus::default()),
            http_client,
        }
    }

    async fn get_sorted_upstreams(&self) -> Vec<UpstreamConfig> {
        let config = self.config.read().await;
        let mut upstreams: Vec<_> = config.upstreams.iter()
            .filter(|u| u.enabled)
            .cloned()
            .collect();
        upstreams.sort_by_key(|u| u.priority);
        upstreams
    }

    async fn forward(
        &self,
        method: Method,
        uri: Uri,
        headers: HeaderMap,
        body: bytes::Bytes,
    ) -> Result<Response<Body>, String> {
        let upstreams = self.get_sorted_upstreams().await;
        if upstreams.is_empty() {
            return Err("No available upstreams".to_string());
        }

        let (aggregation_mode, aggregation_timeout_ms, max_retries) = {
            let config = self.config.read().await;
            (
                config.aggregation_mode.clone(),
                config.aggregation_timeout_ms,
                if config.failover_enabled { config.max_retries as usize } else { 1 },
            )
        };

        // 聚合模式：并行请求
        if aggregation_mode != AggregationMode::Disabled && upstreams.len() > 1 {
            return self.forward_aggregated(&upstreams, &method, &uri, &headers, &body, &aggregation_mode, aggregation_timeout_ms).await;
        }

        // 串行故障转移
        let mut last_error = None;

        for (retry_idx, upstream) in upstreams.iter().enumerate().take(max_retries) {
            log_debug(&format!("Proxy forwarding to upstream {} ({})", upstream.name, upstream.base_url));

            match self.forward_single(upstream, &method, &uri, &headers, &body).await {
                Ok(response) => {
                    let mut status = self.status.write().await;
                    status.active_upstream_id = Some(upstream.id.clone());
                    status.active_upstream_name = Some(upstream.name.clone());
                    status.total_requests += 1;
                    return Ok(response);
                }
                Err(e) => {
                    log_error(&format!("Upstream {} failed (attempt {}/{}): {}", 
                        upstream.name, retry_idx + 1, max_retries, e));
                    last_error = Some(e);
                    let mut status = self.status.write().await;
                    status.failed_requests += 1;
                }
            }
        }

        Err(last_error.unwrap_or_else(|| "All upstreams failed".to_string()))
    }

    /// 聚合模式：并行请求所有上游
    async fn forward_aggregated(
        &self,
        upstreams: &[UpstreamConfig],
        method: &Method,
        uri: &Uri,
        headers: &HeaderMap,
        body: &bytes::Bytes,
        mode: &AggregationMode,
        timeout_ms: u64,
    ) -> Result<Response<Body>, String> {
        log_debug(&format!("Aggregated forwarding to {} upstreams (mode: {:?})", upstreams.len(), mode));

        let timeout = Duration::from_millis(timeout_ms);
        let client = self.http_client.clone();

        // 为每个上游创建一个 future，返回 (UpstreamConfig, Result<Response, String>, elapsed_ms)
        let futures: Vec<_> = upstreams
            .iter()
            .map(|upstream| {
                let u = upstream.clone();
                let m = method.clone();
                let u_uri = uri.clone();
                let h = headers.clone();
                let b = body.clone();
                let client = client.clone();
                async move {
                    let start = std::time::Instant::now();
                    let result = forward_single_static(&client, &u, &m, &u_uri, &h, &b).await;
                    let elapsed = start.elapsed().as_millis() as u64;
                    (u, result, elapsed)
                }
            })
            .collect();

        match mode {
            AggregationMode::Race => {
                // 真正的竞速：用 tokio::select! 等待第一个成功响应
                // 使用 channel 收集第一个成功结果
                let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<
                    (UpstreamConfig, Response<Body>, u64),
                >();

                let mut handles = Vec::new();
                for fut in futures {
                    let tx = tx.clone();
                    handles.push(tokio::spawn(async move {
                        let (upstream, result, latency) = fut.await;
                        if let Ok(response) = result {
                            let _ = tx.send((upstream, response, latency));
                        }
                    }));
                }
                drop(tx); // 关闭发送端，所有 spawn 完成后 rx 会结束

                // 等待第一个成功结果或超时
                match tokio::time::timeout(timeout, rx.recv()).await {
                    Ok(Some((upstream, response, latency))) => {
                        log_debug(&format!("Aggregated race winner: {} ({}ms)", upstream.name, latency));
                        let mut status = self.status.write().await;
                        status.active_upstream_id = Some(upstream.id.clone());
                        status.active_upstream_name = Some(upstream.name.clone());
                        status.total_requests += 1;
                        Ok(response)
                    }
                    Ok(None) => {
                        // 所有上游都失败了
                        let mut status = self.status.write().await;
                        status.failed_requests += 1;
                        Err("All aggregated upstreams failed".to_string())
                    }
                    Err(_) => {
                        let mut status = self.status.write().await;
                        status.failed_requests += 1;
                        Err("Aggregation timeout".to_string())
                    }
                }
            }
            AggregationMode::LowestLatency => {
                // 等待所有完成，取延迟最低的成功响应
                let results = tokio::time::timeout(
                    timeout,
                    futures::future::join_all(futures),
                )
                .await
                .map_err(|_| "Aggregation timeout".to_string())?;

                let mut best: Option<(UpstreamConfig, Response<Body>, u64)> = None;

                for (upstream, result, latency) in results {
                    match result {
                        Ok(response) => {
                            if best.is_none() || latency < best.as_ref().unwrap().2 {
                                best = Some((upstream, response, latency));
                            }
                        }
                        Err(e) => {
                            log_error(&format!("Aggregated upstream {} failed: {}", upstream.name, e));
                        }
                    }
                }

                match best {
                    Some((upstream, response, latency)) => {
                        log_debug(&format!("Aggregated lowest-latency winner: {} ({}ms)", upstream.name, latency));
                        let mut status = self.status.write().await;
                        status.active_upstream_id = Some(upstream.id.clone());
                        status.active_upstream_name = Some(upstream.name.clone());
                        status.total_requests += 1;
                        Ok(response)
                    }
                    None => {
                        let mut status = self.status.write().await;
                        status.failed_requests += 1;
                        Err("All aggregated upstreams failed".to_string())
                    }
                }
            }
            AggregationMode::Disabled => {
                // 不应该到达这里
                Err("Aggregation disabled".to_string())
            }
        }
    }

    async fn forward_single(
        &self,
        upstream: &UpstreamConfig,
        method: &Method,
        uri: &Uri,
        headers: &HeaderMap,
        body: &bytes::Bytes,
    ) -> Result<Response<Body>, String> {
        forward_single_static(&self.http_client, upstream, method, uri, headers, body).await
    }

    async fn health_check(&self) -> Vec<UpstreamHealth> {
        let upstreams = self.get_sorted_upstreams().await;
        let mut results = Vec::new();

        for upstream in upstreams {
            let url = format!("{}/health", upstream.base_url.trim_end_matches('/'));
            let start = std::time::Instant::now();

            let result = self.http_client
                .get(&url)
                .timeout(Duration::from_millis(upstream.timeout_ms))
                .send()
                .await;

            let latency = start.elapsed().as_millis() as u64;
            let now = chrono::Utc::now().timestamp();

            let (healthy, error) = match result {
                Ok(resp) if resp.status().is_success() => (true, None),
                Ok(resp) => (false, Some(format!("HTTP {}", resp.status()))),
                Err(e) => (false, Some(e.to_string())),
            };

            results.push(UpstreamHealth {
                id: upstream.id,
                name: upstream.name,
                healthy,
                last_checked: Some(now),
                latency_ms: Some(latency),
                error,
            });
        }

        results
    }
}

/// 静态转发函数（用于聚合模式并发调用）
async fn forward_single_static(
    client: &Client,
    upstream: &UpstreamConfig,
    method: &Method,
    uri: &Uri,
    headers: &HeaderMap,
    body: &bytes::Bytes,
) -> Result<Response<Body>, String> {
    let path_and_query = uri
        .path_and_query()
        .map(|pq| pq.to_string())
        .unwrap_or_else(|| uri.path().to_string());
    let upstream_url = format!(
        "{}{}",
        upstream.base_url.trim_end_matches('/'),
        path_and_query
    );

    let mut request = client
        .request(method.clone(), &upstream_url)
        .timeout(Duration::from_millis(upstream.timeout_ms));

    for (name, value) in headers {
        if name == header::HOST {
            continue;
        }
        request = request.header(name.clone(), value);
    }

    if let Some((header_name, header_value)) = upstream.auth_kv() {
        request = request.header(header_name, header_value);
    }

    let response = request
        .body(body.clone())
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let status = response.status();
    let mut builder = Response::builder().status(status);

    for (name, value) in response.headers() {
        builder = builder.header(name.clone(), value);
    }

    let stream = response.bytes_stream();
    let body = Body::from_stream(stream);

    builder
        .body(body)
        .map_err(|e| format!("Build response failed: {}", e))
}

/// 代理运行时句柄：包含运行时状态和服务器任务句柄
struct ProxyRuntimeHandle {
    runtime: Arc<ProxyRuntimeInner>,
    server_handle: JoinHandle<()>,
    health_check_handle: JoinHandle<()>,
}

static PROXY_RUNTIME: once_cell::sync::Lazy<tokio::sync::RwLock<Option<ProxyRuntimeHandle>>> = 
    once_cell::sync::Lazy::new(|| tokio::sync::RwLock::new(None));

async fn proxy_handler(
    State(state): State<Arc<ProxyRuntimeInner>>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: bytes::Bytes,
) -> Response<Body> {
    {
        let mut status = state.status.write().await;
        status.total_requests += 1;
    }

    match state.forward(method, uri, headers, body).await {
        Ok(response) => response,
        Err(e) => {
            let mut status = state.status.write().await;
            status.failed_requests += 1;
            Response::builder()
                .status(502)
                .body(Body::from(format!("Proxy error: {}", e)))
                .unwrap()
        }
    }
}

/// 定期健康检查任务
async fn periodic_health_check(runtime: Arc<ProxyRuntimeInner>, interval_secs: u64) {
    if interval_secs == 0 {
        return;
    }

    let mut interval = tokio::time::interval(Duration::from_secs(interval_secs));
    loop {
        interval.tick().await;
        
        // 检查是否已停止
        let should_stop = {
            let status = runtime.status.read().await;
            !status.running
        };
        
        if should_stop {
            break;
        }

        let health = runtime.health_check().await;
        let mut status = runtime.status.write().await;
        status.upstreams_health = health;
        log_debug("Periodic health check completed");
    }
    log_info("Health check task stopped");
}

pub async fn start_proxy_server(config: ProxyConfig) -> Result<ProxyStatus, String> {
    // 先停止现有服务器
    stop_proxy_server().await?;
    tokio::time::sleep(Duration::from_millis(200)).await;

    let runtime = Arc::new(ProxyRuntimeInner::new(config.clone()));
    let health = runtime.health_check().await;

    let app = Router::new()
        .route("/", any(proxy_handler))
        .route("/{*path}", any(proxy_handler))
        .layer(
            ServiceBuilder::new()
                .layer(TraceLayer::new_for_http())
                .into_inner(),
        )
        .with_state(runtime.clone());

    let addr = SocketAddr::from(([127, 0, 0, 1], config.port));
    let listener = TcpListener::bind(addr)
        .await
        .map_err(|e| format!("Failed to bind port {}: {}", config.port, e))?;

    log_info(&format!("Proxy server binding on 127.0.0.1:{}", config.port));

    // 启动 HTTP 服务器任务
    let server_handle = tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            log_error(&format!("Proxy server error: {}", e));
        }
    });

    // 启动定期健康检查任务
    let health_runtime = runtime.clone();
    let health_check_interval = config.health_check_interval_secs;
    let health_check_handle = tokio::spawn(async move {
        periodic_health_check(health_runtime, health_check_interval).await;
    });

    tokio::time::sleep(Duration::from_millis(300)).await;

    let status = ProxyStatus {
        running: true,
        listen_addr: Some(format!("127.0.0.1:{}", config.port)),
        active_upstream_id: health.first().map(|h| h.id.clone()),
        active_upstream_name: health.first().map(|h| h.name.clone()),
        upstreams_health: health.clone(),
        started_at: Some(chrono::Utc::now().timestamp()),
        error: None,
        total_requests: 0,
        failed_requests: 0,
    };

    {
        let mut s = runtime.status.write().await;
        *s = status.clone();
    }

    // 保存运行时句柄
    let handle = ProxyRuntimeHandle {
        runtime,
        server_handle,
        health_check_handle,
    };
    let mut guard = PROXY_RUNTIME.write().await;
    *guard = Some(handle);

    log_info("Proxy server started successfully");
    Ok(status)
}

pub async fn stop_proxy_server() -> Result<(), String> {
    let mut guard = PROXY_RUNTIME.write().await;
    if let Some(handle) = guard.take() {
        // 停止健康检查任务
        handle.health_check_handle.abort();
        
        // 停止 HTTP 服务器
        handle.server_handle.abort();
        
        // 更新状态
        {
            let mut status = handle.runtime.status.write().await;
            status.running = false;
            status.error = None;
        }
        
        log_info("Proxy server stopped");
    }
    Ok(())
}

pub async fn get_proxy_status() -> Result<ProxyStatus, String> {
    let guard = PROXY_RUNTIME.read().await;
    if let Some(handle) = guard.as_ref() {
        Ok(handle.runtime.status.read().await.clone())
    } else {
        Ok(ProxyStatus::default())
    }
}

pub async fn get_proxy_config() -> Result<ProxyConfig, String> {
    let guard = PROXY_RUNTIME.read().await;
    if let Some(handle) = guard.as_ref() {
        Ok(handle.runtime.config.read().await.clone())
    } else {
        Ok(ProxyConfig::default())
    }
}

pub async fn set_proxy_config(config: ProxyConfig) -> Result<ProxyStatus, String> {
    log_info("Updating proxy configuration...");
    if config.enabled {
        start_proxy_server(config).await
    } else {
        stop_proxy_server().await?;
        Ok(ProxyStatus::default())
    }
}

pub async fn test_upstream_health(
    base_url: String,
    _api_key: Option<String>,
    timeout_ms: u64,
) -> Result<UpstreamHealth, String> {
    let client = Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("{}/health", base_url.trim_end_matches('/'));
    let start = std::time::Instant::now();

    let result = client.get(&url).send().await;
    let latency = start.elapsed().as_millis() as u64;
    let now = chrono::Utc::now().timestamp();

    let (healthy, error) = match result {
        Ok(resp) if resp.status().is_success() => (true, None),
        Ok(resp) => (false, Some(format!("HTTP {}", resp.status()))),
        Err(e) => (false, Some(e.to_string())),
    };

    Ok(UpstreamHealth {
        id: "test".to_string(),
        name: base_url.clone(),
        healthy,
        last_checked: Some(now),
        latency_ms: Some(latency),
        error,
    })
}

pub async fn proxy_health_check() -> Result<Vec<UpstreamHealth>, String> {
    let status = get_proxy_status().await?;
    if !status.running {
        return Err("Proxy is not running".to_string());
    }

    let guard = PROXY_RUNTIME.read().await;
    if let Some(handle) = guard.as_ref() {
        let health = handle.runtime.health_check().await;
        let mut status = handle.runtime.status.write().await;
        status.upstreams_health = health.clone();
        Ok(health)
    } else {
        Err("Proxy runtime not available".to_string())
    }
}
