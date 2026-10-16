//! 用量统计：扫描 Claude/Codex/Gemini 的本地会话日志，解析 usage 数据并聚合统计。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::AppHandle;

use crate::utils::logger::{log_debug, log_info};

/// 用量统计数据
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct UsageSummary {
    /// 总会话数
    pub total_sessions: u64,
    /// 总请求数
    pub total_requests: u64,
    /// 总输入 token
    pub total_input_tokens: u64,
    /// 总输出 token
    pub total_output_tokens: u64,
    /// 总缓存读取 token
    pub total_cache_read_tokens: u64,
    /// 总缓存创建 token
    pub total_cache_creation_tokens: u64,
    /// 估算成本（美元）
    pub estimated_cost_usd: f64,
    /// 按日期聚合
    pub by_date: HashMap<String, DailyUsage>,
    /// 按模型聚合
    pub by_model: HashMap<String, ModelUsage>,
}

/// 单日用量
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct DailyUsage {
    pub requests: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_creation_tokens: u64,
    pub estimated_cost: f64,
}

/// 单模型用量
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ModelUsage {
    pub requests: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_creation_tokens: u64,
    pub estimated_cost: f64,
}

/// Token 用量详情（来自会话日志）
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct TokenUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_creation_tokens: u64,
}

/// 简单模型定价（单位：美元/百万 token）
/// 实际项目中应该从 models.dev 或用户配置获取
fn get_model_price(model: &str) -> (f64, f64) {
    let model_lower = model.to_lowercase();
    
    // Claude 系列
    if model_lower.contains("claude-3-5") || model_lower.contains("claude-3.5") {
        return (3.0, 15.0); // input, output
    }
    if model_lower.contains("claude-3") {
        return (3.0, 15.0);
    }
    if model_lower.contains("claude-opus") {
        return (15.0, 75.0);
    }
    if model_lower.contains("claude-sonnet") {
        return (3.0, 15.0);
    }
    if model_lower.contains("claude-haiku") {
        return (0.25, 1.25);
    }
    
    // GPT 系列
    if model_lower.contains("gpt-4o") {
        return (2.5, 10.0);
    }
    if model_lower.contains("gpt-4-turbo") {
        return (10.0, 30.0);
    }
    if model_lower.contains("gpt-4") {
        return (30.0, 60.0);
    }
    if model_lower.contains("gpt-3.5-turbo") {
        return (0.5, 1.5);
    }
    
    // Gemini 系列
    if model_lower.contains("gemini-2.0") {
        return (0.0, 0.0); // 免费
    }
    if model_lower.contains("gemini-1.5-pro") {
        return (1.25, 5.0);
    }
    if model_lower.contains("gemini-1.5-flash") {
        return (0.075, 0.3);
    }
    if model_lower.contains("gemini-1.0") {
        return (0.5, 1.5);
    }
    
    // 默认价格
    (1.0, 5.0)
}

fn estimate_cost(input: u64, output: u64, cache_read: u64, cache_creation: u64, model: &str) -> f64 {
    let (input_price, output_price) = get_model_price(model);
    let cache_read_price = input_price * 0.1; // 缓存读取 10% input
    let cache_creation_price = input_price * 0.4; // 缓存写入 40% input (Anthropic 规则)
    
    let input_cost = (input as f64) * input_price / 1_000_000.0;
    let output_cost = (output as f64) * output_price / 1_000_000.0;
    let cache_read_cost = (cache_read as f64) * cache_read_price / 1_000_000.0;
    let cache_creation_cost = (cache_creation as f64) * cache_creation_price / 1_000_000.0;
    
    input_cost + output_cost + cache_read_cost + cache_creation_cost
}

/// 解析 Claude 会话日志 (JSONL)
/// 格式：每行一个 JSON，type=assistant 的 message.usage 包含 token 信息
fn parse_claude_session(file_path: &PathBuf) -> Vec<(String, TokenUsage, String)> {
    let mut results = Vec::new();
    
    if !file_path.exists() {
        return results;
    }
    
    if let Ok(content) = std::fs::read_to_string(file_path) {
        for line in content.lines() {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
                let msg_type = json.get("type").and_then(|v| v.as_str()).unwrap_or("");
                
                if msg_type == "assistant" {
                    if let Some(usage_obj) = json.get("message").and_then(|m| m.get("usage")) {
                        let input = usage_obj.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                        let output = usage_obj.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                        let cache_read = usage_obj.get("cache_read_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                        let cache_creation = usage_obj.get("cache_creation_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                        
                        let model = json.get("message")
                            .and_then(|m| m.get("model"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("claude-unknown")
                            .to_string();
                        
                        let timestamp = json.get("timestamp")
                            .and_then(|v| v.as_i64())
                            .unwrap_or(0);
                        
                        let date = if timestamp > 0 {
                            chrono::DateTime::from_timestamp(timestamp, 0)
                                .map(|dt| dt.format("%Y-%m-%d").to_string())
                                .unwrap_or_else(|| "unknown".to_string())
                        } else {
                            "unknown".to_string()
                        };
                        
                        results.push((
                            date,
                            TokenUsage {
                                input_tokens: input,
                                output_tokens: output,
                                cache_read_tokens: cache_read,
                                cache_creation_tokens: cache_creation,
                            },
                            model,
                        ));
                    }
                }
            }
        }
    }
    
    results
}

/// 解析 Codex 会话日志
/// 格式：~/.codex/sessions/YYYY/MM/DD/*.jsonl
fn parse_codex_session(file_path: &PathBuf) -> Vec<(String, TokenUsage, String)> {
    let mut results = Vec::new();
    
    if !file_path.exists() {
        return results;
    }
    
    if let Ok(content) = std::fs::read_to_string(file_path) {
        for line in content.lines() {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
                // Codex 使用 session_meta.turn_context.model
                let model = json.get("session_meta")
                    .and_then(|m| m.get("turn_context"))
                    .and_then(|tc| tc.get("model"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("codex-unknown")
                    .to_string();
                
                // token_count 可能是累计值，需要计算 delta
                if let Some(token_count) = json.get("event_msg").and_then(|m| m.get("token_count")) {
                    if let Some(tc) = token_count.as_u64() {
                        // 简化：直接使用（实际需要维护每个 session 的累计值来算 delta）
                        let date = json.get("session_meta")
                            .and_then(|m| m.get("created_at"))
                            .and_then(|v| v.as_str())
                            .map(|s| {
                                s.get(..10).unwrap_or("unknown").to_string()
                            })
                            .unwrap_or_else(|| "unknown".to_string());
                        
                        // 简化估算：假设 30% input, 70% output
                        let input = tc * 30 / 100;
                        let output = tc * 70 / 100;
                        
                        results.push((
                            date,
                            TokenUsage {
                                input_tokens: input,
                                output_tokens: output,
                                cache_read_tokens: 0,
                                cache_creation_tokens: 0,
                            },
                            model,
                        ));
                    }
                }
            }
        }
    }
    
    results
}

/// 解析 Gemini 会话日志
/// 格式：~/.gemini/tmp/<project_hash>/chats/session-*.json(l)
fn parse_gemini_session(file_path: &PathBuf) -> Vec<(String, TokenUsage, String)> {
    let mut results = Vec::new();
    
    if !file_path.exists() {
        return results;
    }
    
    // Gemini 可能是 .json 或 .jsonl
    let content = match std::fs::read_to_string(file_path) {
        Ok(c) => c,
        Err(_) => return results,
    };
    
    // 尝试 JSONL 格式
    for line in content.lines() {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
            if let Some(usage) = parse_gemini_usage_from_json(&json) {
                results.push(usage);
            }
        }
    }
    
    // 尝试 JSON 格式（整个文件是一个会话）
    if results.is_empty() {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(usage) = parse_gemini_usage_from_json(&json) {
                results.push(usage);
            }
        }
    }
    
    results
}

fn parse_gemini_usage_from_json(json: &serde_json::Value) -> Option<(String, TokenUsage, String)> {
    let model = json.get("model")
        .or_else(|| json.get("generationConfig"))
        .and_then(|c| c.get("model"))
        .and_then(|v| v.as_str())
        .unwrap_or("gemini-unknown")
        .to_string();
    
    let usage = json.get("usageMetadata")?;
    
    let input = usage.get("promptTokenCount").and_then(|v| v.as_u64()).unwrap_or(0);
    let output = usage.get("candidatesTokenCount").and_then(|v| v.as_u64()).unwrap_or(0);
    let cache_read = usage.get("cachedContentTokenCount").and_then(|v| v.as_u64()).unwrap_or(0);
    
    // Gemini 没有 cache_creation 字段，设为 0
    let cache_creation = 0u64;
    
    let date = json.get("createTime")
        .and_then(|v| v.as_str())
        .map(|s| s.get(..10).unwrap_or("unknown").to_string())
        .unwrap_or_else(|| "unknown".to_string());
    
    Some((
        date,
        TokenUsage {
            input_tokens: input,
            output_tokens: output,
            cache_read_tokens: cache_read,
            cache_creation_tokens: cache_creation,
        },
        model,
    ))
}

fn get_home_dir() -> Option<PathBuf> {
    dirs::home_dir()
}

#[tauri::command]
pub async fn scan_session_usage(_app: AppHandle) -> Result<UsageSummary, String> {
    log_info("开始扫描会话用量...");
    
    let mut summary = UsageSummary::default();
    let home = get_home_dir().ok_or("无法获取用户主目录")?;
    
    // 1. 扫描 Claude 会话
    let claude_projects = home.join(".claude").join("projects");
    if claude_projects.exists() {
        log_debug(&format!("扫描 Claude 项目: {:?}", claude_projects));
        
        if let Ok(entries) = std::fs::read_dir(&claude_projects) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    // 递归查找所有 .jsonl 文件
                    if let Ok(files) = walkdir(&path, &["jsonl"]) {
                        for file in files {
                            let records = parse_claude_session(&file);
                            for (date, usage, model) in records {
                                summary.total_requests += 1;
                                summary.total_input_tokens += usage.input_tokens;
                                summary.total_output_tokens += usage.output_tokens;
                                summary.total_cache_read_tokens += usage.cache_read_tokens;
                                summary.total_cache_creation_tokens += usage.cache_creation_tokens;
                                
                                let cost = estimate_cost(
                                    usage.input_tokens,
                                    usage.output_tokens,
                                    usage.cache_read_tokens,
                                    usage.cache_creation_tokens,
                                    &model,
                                );
                                summary.estimated_cost_usd += cost;
                                
                                // 按日期聚合
                                let daily = summary.by_date.entry(date.clone()).or_default();
                                daily.requests += 1;
                                daily.input_tokens += usage.input_tokens;
                                daily.output_tokens += usage.output_tokens;
                                daily.cache_read_tokens += usage.cache_read_tokens;
                                daily.cache_creation_tokens += usage.cache_creation_tokens;
                                daily.estimated_cost += cost;
                                
                                // 按模型聚合
                                let model_usage = summary.by_model.entry(model.clone()).or_default();
                                model_usage.requests += 1;
                                model_usage.input_tokens += usage.input_tokens;
                                model_usage.output_tokens += usage.output_tokens;
                                model_usage.cache_read_tokens += usage.cache_read_tokens;
                                model_usage.cache_creation_tokens += usage.cache_creation_tokens;
                                model_usage.estimated_cost += cost;
                            }
                        }
                    }
                }
            }
        }
    }
    
    // 2. 扫描 Codex 会话
    let codex_sessions = home.join(".codex").join("sessions");
    if codex_sessions.exists() {
        log_debug(&format!("扫描 Codex 会话: {:?}", codex_sessions));
        
        if let Ok(files) = walkdir(&codex_sessions, &["jsonl"]) {
            for file in files {
                let records = parse_codex_session(&file);
                for (date, usage, model) in records {
                    summary.total_requests += 1;
                    summary.total_input_tokens += usage.input_tokens;
                    summary.total_output_tokens += usage.output_tokens;
                    
                    let cost = estimate_cost(
                        usage.input_tokens,
                        usage.output_tokens,
                        0,
                        0,
                        &model,
                    );
                    summary.estimated_cost_usd += cost;
                    
                    let daily = summary.by_date.entry(date).or_default();
                    daily.requests += 1;
                    daily.input_tokens += usage.input_tokens;
                    daily.output_tokens += usage.output_tokens;
                    daily.estimated_cost += cost;
                    
                    let model_usage = summary.by_model.entry(model).or_default();
                    model_usage.requests += 1;
                    model_usage.input_tokens += usage.input_tokens;
                    model_usage.output_tokens += usage.output_tokens;
                    model_usage.estimated_cost += cost;
                }
            }
        }
    }
    
    // 3. 扫描 Gemini 会话
    let gemini_tmp = home.join(".gemini").join("tmp");
    if gemini_tmp.exists() {
        log_debug(&format!("扫描 Gemini 会话: {:?}", gemini_tmp));
        
        if let Ok(files) = walkdir(&gemini_tmp, &["json", "jsonl"]) {
            for file in files {
                let records = parse_gemini_session(&file);
                for (date, usage, model) in records {
                    summary.total_requests += 1;
                    summary.total_input_tokens += usage.input_tokens;
                    summary.total_output_tokens += usage.output_tokens;
                    summary.total_cache_read_tokens += usage.cache_read_tokens;
                    
                    let cost = estimate_cost(
                        usage.input_tokens,
                        usage.output_tokens,
                        usage.cache_read_tokens,
                        0,
                        &model,
                    );
                    summary.estimated_cost_usd += cost;
                    
                    let daily = summary.by_date.entry(date).or_default();
                    daily.requests += 1;
                    daily.input_tokens += usage.input_tokens;
                    daily.output_tokens += usage.output_tokens;
                    daily.cache_read_tokens += usage.cache_read_tokens;
                    daily.estimated_cost += cost;
                    
                    let model_usage = summary.by_model.entry(model).or_default();
                    model_usage.requests += 1;
                    model_usage.input_tokens += usage.input_tokens;
                    model_usage.output_tokens += usage.output_tokens;
                    model_usage.cache_read_tokens += usage.cache_read_tokens;
                    model_usage.estimated_cost += cost;
                }
            }
        }
    }
    
    // 计算总会话数（按日期去重）
    summary.total_sessions = summary.by_date.len() as u64;
    
    log_info(&format!(
        "用量扫描完成: {} 请求, {} input tokens, {} output tokens, ${:.4} 估算成本",
        summary.total_requests,
        summary.total_input_tokens,
        summary.total_output_tokens,
        summary.estimated_cost_usd
    ));
    
    Ok(summary)
}

/// 递归遍历目录查找指定扩展名的文件
fn walkdir(dir: &PathBuf, extensions: &[&str]) -> std::io::Result<Vec<PathBuf>> {
    let mut results = Vec::new();
    
    fn walk(dir: &PathBuf, extensions: &[&str], results: &mut Vec<PathBuf>) -> std::io::Result<()> {
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            
            if path.is_dir() {
                walk(&path, extensions, results)?;
            } else if let Some(ext) = path.extension() {
                let ext_str = ext.to_string_lossy().to_lowercase();
                if extensions.iter().any(|e| e.to_lowercase() == ext_str) {
                    results.push(path);
                }
            }
        }
        Ok(())
    }
    
    walk(dir, extensions, &mut results)?;
    Ok(results)
}
