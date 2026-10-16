//! 代理命令：启动/停止/配置本地路由代理

use crate::core::proxy::{
    ProxyConfig, ProxyStatus, UpstreamHealth,
};
use crate::utils::logger::log_info;

/// 获取当前代理状态
#[tauri::command]
pub async fn get_proxy_status() -> Result<ProxyStatus, String> {
    crate::core::proxy::get_proxy_status().await
}

/// 获取当前代理配置
#[tauri::command]
pub async fn get_proxy_config() -> Result<ProxyConfig, String> {
    crate::core::proxy::get_proxy_config().await
}

/// 设置代理配置（会自动重启代理）
#[tauri::command]
pub async fn set_proxy_config(config: ProxyConfig) -> Result<ProxyStatus, String> {
    log_info("Updating proxy configuration...");
    crate::core::proxy::set_proxy_config(config).await
}

/// 启动代理服务器
#[tauri::command]
pub async fn start_proxy(config: ProxyConfig) -> Result<ProxyStatus, String> {
    log_info("Starting proxy server...");
    crate::core::proxy::start_proxy_server(config).await
}

/// 停止代理服务器
#[tauri::command]
pub async fn stop_proxy() -> Result<(), String> {
    log_info("Stopping proxy server...");
    crate::core::proxy::stop_proxy_server().await
}

/// 测试单个上游健康状态
#[tauri::command]
pub async fn test_upstream(
    base_url: String,
    api_key: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<UpstreamHealth, String> {
    crate::core::proxy::test_upstream_health(base_url, api_key, timeout_ms.unwrap_or(5000)).await
}

/// 执行健康检查（检查所有已配置的上游）
#[tauri::command]
pub async fn proxy_health_check() -> Result<Vec<UpstreamHealth>, String> {
    crate::core::proxy::proxy_health_check().await
}
