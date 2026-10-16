//! Antigravity IDE 进程控制
//!
//! 提供启动、关闭、检测 Antigravity IDE 进程的功能
//! 基于 sysinfo 实现跨平台进程管理

use std::process::Command;
use std::thread;
use std::time::Duration;
use sysinfo::System;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(not(target_os = "windows"))]
use super::logger::log_error;
use super::config::load_app_config;
use super::logger::{log_info, log_warn};

/// 获取当前运行可执行文件的规范化路径
fn get_current_exe_path() -> Option<std::path::PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.canonicalize().ok())
}

/// 检查 Antigravity IDE 是否正在运行
pub fn is_antigravity_running() -> bool {
    let mut system = System::new();
    system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    let current_exe = get_current_exe_path();
    let current_pid = std::process::id();

    // 加载手动配置路径（移到循环外以提高性能）
    let manual_path = load_app_config()
        .ok()
        .and_then(|c| c.antigravity_executable)
        .and_then(|p| std::path::PathBuf::from(p).canonicalize().ok());

    for (pid, process) in system.processes() {
        let pid_u32 = pid.as_u32();
        if pid_u32 == current_pid {
            continue;
        }

        let name = process.name().to_string_lossy().to_lowercase();
        let exe_path = process
            .exe()
            .and_then(|p| p.to_str())
            .unwrap_or("")
            .to_lowercase();

        // 排除自身路径（处理 Linux 上管理器被误认为 Antigravity 的情况）
        if let (Some(ref my_path), Some(p_exe)) = (&current_exe, process.exe()) {
            if let Ok(p_path) = p_exe.canonicalize() {
                if my_path == &p_path {
                    continue;
                }
            }
        }

        // 优先检查手动配置路径匹配
        if let (Some(ref m_path), Some(p_exe)) = (&manual_path, process.exe()) {
            if let Ok(p_path) = p_exe.canonicalize() {
                // macOS: 检查是否在同一个 .app 包内
                #[cfg(target_os = "macos")]
                {
                    let m_path_str = m_path.to_string_lossy();
                    let p_path_str = p_path.to_string_lossy();
                    if let (Some(m_idx), Some(p_idx)) =
                        (m_path_str.find(".app"), p_path_str.find(".app"))
                    {
                        if m_path_str[..m_idx + 4] == p_path_str[..p_idx + 4] {
                            // 即使路径匹配，也必须通过名称和参数确认不是 Helper
                            let args = process.cmd();
                            let is_helper_by_args = args
                                .iter()
                                .any(|arg| arg.to_string_lossy().contains("--type="));
                            let is_helper_by_name = name.contains("helper")
                                || name.contains("plugin")
                                || name.contains("renderer")
                                || name.contains("gpu")
                                || name.contains("crashpad")
                                || name.contains("utility")
                                || name.contains("audio")
                                || name.contains("sandbox");
                            if !is_helper_by_args && !is_helper_by_name {
                                return true;
                            }
                        }
                    }
                }

                #[cfg(not(target_os = "macos"))]
                if m_path == &p_path {
                    return true;
                }
            }
        }

        // 通用 helper 进程排除逻辑
        let args = process.cmd();
        let args_str = args
            .iter()
            .map(|arg| arg.to_string_lossy().to_lowercase())
            .collect::<Vec<String>>()
            .join(" ");

        let is_helper = args_str.contains("--type=")
            || name.contains("helper")
            || name.contains("plugin")
            || name.contains("renderer")
            || name.contains("gpu")
            || name.contains("crashpad")
            || name.contains("utility")
            || name.contains("audio")
            || name.contains("sandbox")
            || exe_path.contains("crashpad");

        #[cfg(target_os = "macos")]
        {
            if exe_path.contains("antigravity.app") && !is_helper {
                return true;
            }
        }

        #[cfg(target_os = "windows")]
        {
            if name == "antigravity.exe" && !is_helper {
                return true;
            }
        }

        #[cfg(target_os = "linux")]
        {
            if (name.contains("antigravity") || exe_path.contains("/antigravity"))
                && !name.contains("tools")
                && !is_helper
            {
                return true;
            }
        }
    }

    false
}

#[cfg(target_os = "linux")]
/// 获取当前进程及所有直系亲属（祖先 + 后代）的 PID 集合
fn get_self_family_pids(system: &sysinfo::System) -> std::collections::HashSet<u32> {
    let current_pid = std::process::id();
    let mut family_pids = std::collections::HashSet::new();
    family_pids.insert(current_pid);

    // 1. 向上查找所有祖先（Ancestors）- 防止杀死启动器
    let mut next_pid = current_pid;
    // 防止无限循环，最大深度 10
    for _ in 0..10 {
        let pid_val = sysinfo::Pid::from_u32(next_pid);
        if let Some(process) = system.process(pid_val) {
            if let Some(parent) = process.parent() {
                let parent_id = parent.as_u32();
                // 避免循环或重复
                if !family_pids.insert(parent_id) {
                    break;
                }
                next_pid = parent_id;
            } else {
                break;
            }
        } else {
            break;
        }
    }

    // 2. 向下查找所有后代（Descendants）
    // 构建父子关系映射（Parent -> Children）
    let mut adj: std::collections::HashMap<u32, Vec<u32>> = std::collections::HashMap::new();
    for (pid, process) in system.processes() {
        if let Some(parent) = process.parent() {
            adj.entry(parent.as_u32()).or_default().push(pid.as_u32());
        }
    }

    // BFS 遍历查找所有后代
    let mut queue = std::collections::VecDeque::new();
    queue.push_back(current_pid);

    while let Some(pid) = queue.pop_front() {
        if let Some(children) = adj.get(&pid) {
            for &child in children {
                if family_pids.insert(child) {
                    queue.push_back(child);
                }
            }
        }
    }

    family_pids
}

/// 获取所有 Antigravity 进程的 PID（包括主进程和 helper 进程）
fn get_antigravity_pids() -> Vec<u32> {
    let mut system = System::new();
    system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    // Linux: 启用家族进程树排除
    #[cfg(target_os = "linux")]
    let family_pids = get_self_family_pids(&system);

    let mut pids = Vec::new();
    let current_pid = std::process::id();
    let current_exe = get_current_exe_path();

    // 加载手动配置路径作为辅助参考
    let manual_path = load_app_config()
        .ok()
        .and_then(|c| c.antigravity_executable)
        .and_then(|p| std::path::PathBuf::from(p).canonicalize().ok());

    for (pid, process) in system.processes() {
        let pid_u32 = pid.as_u32();

        // 排除自身 PID
        if pid_u32 == current_pid {
            continue;
        }

        // 排除自身可执行文件路径（加固防止宽泛名称匹配）
        if let (Some(ref my_path), Some(p_exe)) = (&current_exe, process.exe()) {
            if let Ok(p_path) = p_exe.canonicalize() {
                if my_path == &p_path {
                    continue;
                }
            }
        }

        let _name = process.name().to_string_lossy().to_lowercase();

        #[cfg(target_os = "linux")]
        {
            // 1. 排除家族进程（自身、子进程、父进程）
            if family_pids.contains(&pid_u32) {
                continue;
            }
            // 2. 额外保护：匹配 "tools" 很可能是管理器（如果不是子进程）
            if _name.contains("tools") {
                continue;
            }
        }

        #[cfg(not(target_os = "linux"))]
        {
            // 其他平台：仅排除自身
            if pid_u32 == current_pid {
                continue;
            }
        }

        // 检查手动配置路径匹配
        if let (Some(ref m_path), Some(p_exe)) = (&manual_path, process.exe()) {
            if let Ok(p_path) = p_exe.canonicalize() {
                #[cfg(target_os = "macos")]
                {
                    let m_path_str = m_path.to_string_lossy();
                    let p_path_str = p_path.to_string_lossy();
                    if let (Some(m_idx), Some(p_idx)) =
                        (m_path_str.find(".app"), p_path_str.find(".app"))
                    {
                        if m_path_str[..m_idx + 4] == p_path_str[..p_idx + 4] {
                            let args = process.cmd();
                            let is_helper_by_args = args
                                .iter()
                                .any(|arg| arg.to_string_lossy().contains("--type="));
                            let is_helper_by_name = _name.contains("helper")
                                || _name.contains("plugin")
                                || _name.contains("renderer")
                                || _name.contains("gpu")
                                || _name.contains("crashpad")
                                || _name.contains("utility")
                                || _name.contains("audio")
                                || _name.contains("sandbox");
                            if !is_helper_by_args && !is_helper_by_name {
                                pids.push(pid_u32);
                                continue;
                            }
                        }
                    }
                }

                #[cfg(not(target_os = "macos"))]
                if m_path == &p_path {
                    pids.push(pid_u32);
                    continue;
                }
            }
        }

        // 获取可执行文件路径
        let exe_path = process
            .exe()
            .and_then(|p| p.to_str())
            .unwrap_or("")
            .to_lowercase();

        // 通用 helper 进程排除逻辑
        let args = process.cmd();
        let args_str = args
            .iter()
            .map(|arg| arg.to_string_lossy().to_lowercase())
            .collect::<Vec<String>>()
            .join(" ");

        let is_helper = args_str.contains("--type=")
            || _name.contains("helper")
            || _name.contains("plugin")
            || _name.contains("renderer")
            || _name.contains("gpu")
            || _name.contains("crashpad")
            || _name.contains("utility")
            || _name.contains("audio")
            || _name.contains("sandbox")
            || exe_path.contains("crashpad");

        #[cfg(target_os = "macos")]
        {
            // 匹配 Antigravity 主应用包内的进程，排除 Helper/Plugin/Renderer 等
            if exe_path.contains("antigravity.app") && !is_helper {
                pids.push(pid_u32);
            }
        }

        #[cfg(target_os = "windows")]
        {
            let name = process.name().to_string_lossy().to_lowercase();
            if name == "antigravity.exe" && !is_helper {
                pids.push(pid_u32);
            }
        }

        #[cfg(target_os = "linux")]
        {
            let name = process.name().to_string_lossy().to_lowercase();
            if (name == "antigravity" || exe_path.contains("/antigravity"))
                && !name.contains("tools")
                && !is_helper
            {
                pids.push(pid_u32);
            }
        }
    }

    if !pids.is_empty() {
        log_info(&format!(
            "Found {} Antigravity processes: {:?}",
            pids.len(),
            pids
        ));
    }

    pids
}

/// 获取 Antigravity 可执行文件路径和启动参数（从运行进程）
///
/// 这是最可靠的方法，可以找到任意位置的安装
fn get_process_info() -> (Option<std::path::PathBuf>, Option<Vec<String>>) {
    let mut system = System::new_all();
    system.refresh_all();

    let current_exe = get_current_exe_path();
    let current_pid = std::process::id();

    for (pid, process) in system.processes() {
        let pid_u32 = pid.as_u32();
        if pid_u32 == current_pid {
            continue;
        }

        // 排除管理器进程本身
        if let (Some(ref my_path), Some(p_exe)) = (&current_exe, process.exe()) {
            if let Ok(p_path) = p_exe.canonicalize() {
                if my_path == &p_path {
                    continue;
                }
            }
        }

        let name = process.name().to_string_lossy().to_lowercase();

        // 获取可执行文件路径和命令行参数
        if let Some(exe) = process.exe() {
            let mut args = process.cmd().iter();
            let exe_path = args
                .next()
                .map_or(exe.to_string_lossy(), |arg| arg.to_string_lossy())
                .to_lowercase();

            // 提取实际参数（跳过可执行文件路径）
            let args = args
                .map(|arg| arg.to_string_lossy().to_string())
                .collect::<Vec<String>>();

            let args_str = args.join(" ").to_lowercase();

            // 通用 helper 进程排除逻辑
            let is_helper = args_str.contains("--type=")
                || args_str.contains("node-ipc")
                || args_str.contains("nodeipc")
                || args_str.contains("max-old-space-size")
                || args_str.contains("node_modules")
                || name.contains("helper")
                || name.contains("plugin")
                || name.contains("renderer")
                || name.contains("gpu")
                || name.contains("crashpad")
                || name.contains("utility")
                || name.contains("audio")
                || name.contains("sandbox")
                || exe_path.contains("crashpad");

            let path = Some(exe.to_path_buf());
            let args = Some(args);

            #[cfg(target_os = "macos")]
            {
                // macOS: 排除 helper 进程，仅匹配主应用，并检查 Frameworks
                if exe_path.contains("antigravity.app")
                    && !is_helper
                    && !exe_path.contains("frameworks")
                {
                    // 尝试提取 .app 路径以更好地支持 open 命令
                    if let Some(app_idx) = exe_path.find(".app") {
                        let app_path_str = &exe.to_string_lossy()[..app_idx + 4];
                        let path = Some(std::path::PathBuf::from(app_path_str));
                        return (path, args);
                    }
                    return (path, args);
                }
            }

            #[cfg(target_os = "windows")]
            {
                // Windows: 严格匹配进程名并排除 helpers
                if name == "antigravity.exe" && !is_helper {
                    return (path, args);
                }
            }

            #[cfg(target_os = "linux")]
            {
                // Linux: 检查进程名或路径中的 antigravity，排除 helpers 和管理器
                if (name == "antigravity" || exe_path.contains("/antigravity"))
                    && !name.contains("tools")
                    && !is_helper
                {
                    return (path, args);
                }
            }
        }
    }
    (None, None)
}

/// 从运行进程获取 Antigravity 可执行文件路径
///
/// 最可靠的方法，可以找到任意位置的安装
pub fn get_path_from_running_process() -> Option<std::path::PathBuf> {
    let (path, _) = get_process_info();
    path
}

/// 获取 Antigravity 可执行文件路径（跨平台）
///
/// 搜索策略（优先级从高到低）：
/// 1. 从运行进程获取路径（最可靠，支持任意位置）
/// 2. 遍历标准安装位置
/// 3. 返回 None
pub fn get_antigravity_executable_path() -> Option<std::path::PathBuf> {
    // 策略 1: 从运行进程获取（支持任意位置）
    if let Some(path) = get_path_from_running_process() {
        return Some(path);
    }

    // 策略 2: 检查标准安装位置
    check_standard_locations()
}

/// 检查标准安装位置
fn check_standard_locations() -> Option<std::path::PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let path = std::path::PathBuf::from("/Applications/Antigravity.app");
        if path.exists() {
            return Some(path);
        }
    }

    #[cfg(target_os = "windows")]
    {
        use std::env;

        // 获取环境变量
        let local_appdata = env::var("LOCALAPPDATA").ok();
        let program_files =
            env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".to_string());
        let program_files_x86 =
            env::var("ProgramFiles(x86)").unwrap_or_else(|_| "C:\\Program Files (x86)".to_string());

        let mut possible_paths = Vec::new();

        // 用户安装位置（优先）
        if let Some(local) = local_appdata {
            possible_paths.push(
                std::path::PathBuf::from(&local)
                    .join("Programs")
                    .join("Antigravity")
                    .join("Antigravity.exe"),
            );
        }

        // 系统安装位置
        possible_paths.push(
            std::path::PathBuf::from(&program_files)
                .join("Antigravity")
                .join("Antigravity.exe"),
        );

        // 32 位兼容位置
        possible_paths.push(
            std::path::PathBuf::from(&program_files_x86)
                .join("Antigravity")
                .join("Antigravity.exe"),
        );

        // 返回第一个存在的路径
        for path in possible_paths {
            if path.exists() {
                return Some(path);
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        let possible_paths = vec![
            std::path::PathBuf::from("/usr/bin/antigravity"),
            std::path::PathBuf::from("/opt/Antigravity/antigravity"),
            std::path::PathBuf::from("/usr/share/antigravity/antigravity"),
        ];

        // 用户本地安装
        if let Some(home) = dirs::home_dir() {
            let user_local = home.join(".local/bin/antigravity");
            if user_local.exists() {
                return Some(user_local);
            }
        }

        for path in possible_paths {
            if path.exists() {
                return Some(path);
            }
        }
    }

    None
}

/// 关闭 Antigravity 进程
pub fn close_antigravity(#[allow(unused_variables)] timeout_secs: u64) -> Result<(), String> {
    log_info("Closing Antigravity...");

    // 在关闭前先获取并保存路径到配置文件（用于后续启动）
    log_info("Attempting to get Antigravity path from running process...");
    match get_path_from_running_process() {
        Some(path) => {
            let path_str = path.to_string_lossy().to_string();
            log_info(&format!(
                "Saving Antigravity path before closing: {}",
                path_str
            ));

            if let Err(e) = super::config::update_antigravity_path(path_str) {
                log_warn(&format!("Failed to save Antigravity path to config: {}", e));
            } else {
                log_info("Antigravity path saved to config successfully");
            }
        }
        None => {
            log_warn("Could not get Antigravity path from running process");
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Windows: 通过 PID 精确关闭，支持多版本或自定义文件名
        let pids = get_antigravity_pids();
        if !pids.is_empty() {
            log_info(&format!(
                "Precisely closing {} identified processes on Windows...",
                pids.len()
            ));

            let mut success_count = 0;
            let mut fail_count = 0;

            for pid in pids {
                match Command::new("taskkill")
                    .args(["/F", "/PID", &pid.to_string()])
                    .creation_flags(0x08000000) // CREATE_NO_WINDOW
                    .output()
                {
                    Ok(output) => {
                        if output.status.success() {
                            success_count += 1;
                        } else {
                            fail_count += 1;
                            let stderr = crate::utils::encoding::decode_console_output(&output.stderr);
                            if !stderr.contains("not found") && !stderr.is_empty() {
                                log_warn(&format!("Failed to kill PID {}: {}", pid, stderr.trim()));
                            }
                        }
                    }
                    Err(e) => {
                        fail_count += 1;
                        log_warn(&format!(
                            "Failed to execute taskkill for PID {}: {}",
                            pid, e
                        ));
                    }
                }
            }

            log_info(&format!(
                "Process termination complete: {} succeeded, {} failed",
                success_count, fail_count
            ));

            // 给系统一些时间清理 PID
            thread::sleep(Duration::from_millis(500));
        }
    }

    #[cfg(target_os = "macos")]
    {
        // macOS: 优化关闭策略以避免"窗口意外终止"弹窗
        // 策略：仅向主进程发送 SIGTERM，让它协调关闭子进程

        let pids = get_antigravity_pids();
        if !pids.is_empty() {
            // 1. 识别主进程（PID）
            // 策略：Electron/Tauri 的主进程没有 `--type` 参数，而 Helper 进程有 `--type=renderer/gpu/utility` 等
            let mut system = System::new();
            system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

            let mut main_pid = None;

            // 加载手动配置路径作为最高优先级参考
            let manual_path = load_app_config()
                .ok()
                .and_then(|c| c.antigravity_executable)
                .and_then(|p| std::path::PathBuf::from(p).canonicalize().ok());

            log_info("Analyzing process list to identify main process:");
            for pid_u32 in &pids {
                let pid = sysinfo::Pid::from_u32(*pid_u32);
                if let Some(process) = system.process(pid) {
                    let name = process.name().to_string_lossy();
                    let args = process.cmd();
                    let args_str = args
                        .iter()
                        .map(|arg| arg.to_string_lossy().into_owned())
                        .collect::<Vec<String>>()
                        .join(" ");

                    log_info(&format!(
                        " - PID: {} | Name: {} | Args: {}",
                        pid_u32, name, args_str
                    ));

                    // 1. 优先匹配手动路径
                    if let (Some(ref m_path), Some(p_exe)) = (&manual_path, process.exe()) {
                        if let Ok(p_path) = p_exe.canonicalize() {
                            let m_path_str = m_path.to_string_lossy();
                            let p_path_str = p_path.to_string_lossy();
                            if let (Some(m_idx), Some(p_idx)) =
                                (m_path_str.find(".app"), p_path_str.find(".app"))
                            {
                                if m_path_str[..m_idx + 4] == p_path_str[..p_idx + 4] {
                                    // 深度验证：即使路径匹配，也必须排除 Helper 关键字和参数
                                    let is_helper_by_args = args_str.contains("--type=");
                                    let is_helper_by_name = name.to_lowercase().contains("helper")
                                        || name.to_lowercase().contains("plugin")
                                        || name.to_lowercase().contains("renderer")
                                        || name.to_lowercase().contains("gpu")
                                        || name.to_lowercase().contains("crashpad")
                                        || name.to_lowercase().contains("utility")
                                        || name.to_lowercase().contains("audio")
                                        || name.to_lowercase().contains("sandbox")
                                        || name.to_lowercase().contains("language_server");

                                    if !is_helper_by_args && !is_helper_by_name {
                                        main_pid = Some(pid_u32);
                                        log_info(&format!(
                                            "   => Identified as main process (manual path match)"
                                        ));
                                        break;
                                    }
                                }
                            }
                        }
                    }

                    // 2. 特征分析匹配（回退方案）
                    let is_helper_by_name = name.to_lowercase().contains("helper")
                        || name.to_lowercase().contains("crashpad")
                        || name.to_lowercase().contains("utility")
                        || name.to_lowercase().contains("audio")
                        || name.to_lowercase().contains("sandbox")
                        || name.to_lowercase().contains("language_server")
                        || name.to_lowercase().contains("plugin")
                        || name.to_lowercase().contains("renderer");

                    let is_helper_by_args = args_str.contains("--type=");

                    if !is_helper_by_name && !is_helper_by_args {
                        if main_pid.is_none() {
                            main_pid = Some(pid_u32);
                            log_info(&format!(
                                "   => Identified as main process (Name/Args analysis)"
                            ));
                        }
                    } else {
                        log_info(&format!("   => Identified as helper process (Helper/Args)"));
                    }
                }
            }

            // 阶段 1: 优雅退出（SIGTERM）
            if let Some(pid) = main_pid {
                log_info(&format!("Sending SIGTERM to main process PID: {}", pid));
                let output = Command::new("kill")
                    .args(["-15", &pid.to_string()])
                    .output();

                if let Ok(result) = output {
                    if !result.status.success() {
                        let error = String::from_utf8_lossy(&result.stderr);
                        log_warn(&format!("Main process SIGTERM failed: {}", error));
                    }
                }
            } else {
                log_warn(
                    "No clear main process identified, attempting SIGTERM for all processes (may cause popups)",
                );
                for pid in &pids {
                    let _ = Command::new("kill")
                        .args(["-15", &pid.to_string()])
                        .output();
                }
            }

            // 等待优雅退出（最多 timeout_secs 的 70%）
            let graceful_timeout = (timeout_secs * 7) / 10;
            let start = std::time::Instant::now();
            while start.elapsed() < Duration::from_secs(graceful_timeout) {
                if !is_antigravity_running() {
                    log_info("All Antigravity processes gracefully closed");
                    return Ok(());
                }
                thread::sleep(Duration::from_millis(500));
            }

            // 阶段 2: 强制终止（SIGKILL）- 针对所有剩余进程（Helpers）
            if is_antigravity_running() {
                let remaining_pids = get_antigravity_pids();
                if !remaining_pids.is_empty() {
                    log_warn(&format!(
                        "Graceful exit timeout, force killing {} remaining processes (SIGKILL)",
                        remaining_pids.len()
                    ));
                    for pid in &remaining_pids {
                        let output = Command::new("kill").args(["-9", &pid.to_string()]).output();

                        if let Ok(result) = output {
                            if !result.status.success() {
                                let error = String::from_utf8_lossy(&result.stderr);
                                if !error.contains("No such process") {
                                    log_error(&format!(
                                        "SIGKILL process {} failed: {}",
                                        pid, error
                                    ));
                                }
                            }
                        }
                    }
                    thread::sleep(Duration::from_secs(1));
                }

                // 最终检查
                if !is_antigravity_running() {
                    log_info("All processes exited after forced cleanup");
                    return Ok(());
                }
            } else {
                log_info("All processes exited after SIGTERM");
                return Ok(());
            }
        } else {
            // pids 为空时，认为未运行，不在此报错，因为可能已经关闭
            log_info("Antigravity not running, no need to close");
            return Ok(());
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Linux: 也尝试识别主进程并委托退出
        let pids = get_antigravity_pids();
        if !pids.is_empty() {
            let mut system = System::new();
            system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

            let mut main_pid = None;

            // 加载手动配置路径作为最高优先级参考
            let manual_path = load_app_config()
                .ok()
                .and_then(|c| c.antigravity_executable)
                .and_then(|p| std::path::PathBuf::from(p).canonicalize().ok());

            log_info("Analyzing Linux process list to identify main process:");
            for pid_u32 in &pids {
                let pid = sysinfo::Pid::from_u32(*pid_u32);
                if let Some(process) = system.process(pid) {
                    let name = process.name().to_string_lossy().to_lowercase();
                    let args = process.cmd();
                    let args_str = args
                        .iter()
                        .map(|arg| arg.to_string_lossy().into_owned())
                        .collect::<Vec<String>>()
                        .join(" ");

                    log_info(&format!(
                        " - PID: {} | Name: {} | Args: {}",
                        pid_u32, name, args_str
                    ));

                    // 1. 优先匹配手动路径
                    if let (Some(ref m_path), Some(p_exe)) = (&manual_path, process.exe()) {
                        if let Ok(p_path) = p_exe.canonicalize() {
                            if &p_path == m_path {
                                // 确认不是 Helper
                                let is_helper_by_args = args_str.contains("--type=");
                                let is_helper_by_name = name.contains("helper")
                                    || name.contains("renderer")
                                    || name.contains("gpu")
                                    || name.contains("crashpad")
                                    || name.contains("utility")
                                    || name.contains("audio")
                                    || name.contains("sandbox");
                                if !is_helper_by_args && !is_helper_by_name {
                                    main_pid = Some(pid_u32);
                                    log_info(&format!(
                                        "   => Identified as main process (manual path match)"
                                    ));
                                    break;
                                }
                            }
                        }
                    }

                    // 2. 特征分析匹配
                    let is_helper_by_args = args_str.contains("--type=");
                    let is_helper_by_name = name.contains("helper")
                        || name.contains("renderer")
                        || name.contains("gpu")
                        || name.contains("crashpad")
                        || name.contains("utility")
                        || name.contains("audio")
                        || name.contains("sandbox")
                        || name.contains("plugin")
                        || name.contains("language_server");

                    if !is_helper_by_args && !is_helper_by_name {
                        if main_pid.is_none() {
                            main_pid = Some(pid_u32);
                            log_info(&format!(
                                "   => Identified as main process (Feature analysis)"
                            ));
                        }
                    } else {
                        log_info(&format!("   => Identified as helper process (Helper/Args)"));
                    }
                }
            }

            // 阶段 1: 优雅退出（SIGTERM）
            if let Some(pid) = main_pid {
                log_info(&format!(
                    "Attempting to gracefully close main process {} (SIGTERM)",
                    pid
                ));
                let _ = Command::new("kill")
                    .args(["-15", &pid.to_string()])
                    .output();
            } else {
                log_warn(
                    "No clear Linux main process identified, sending SIGTERM to all associated processes",
                );
                for pid in &pids {
                    let _ = Command::new("kill")
                        .args(["-15", &pid.to_string()])
                        .output();
                }
            }

            // 等待优雅退出
            let graceful_timeout = (timeout_secs * 7) / 10;
            let start = std::time::Instant::now();
            while start.elapsed() < Duration::from_secs(graceful_timeout) {
                if !is_antigravity_running() {
                    log_info("Antigravity gracefully closed");
                    return Ok(());
                }
                thread::sleep(Duration::from_millis(500));
            }

            // 阶段 2: 强制终止（SIGKILL）- 针对所有剩余进程
            if is_antigravity_running() {
                let remaining_pids = get_antigravity_pids();
                if !remaining_pids.is_empty() {
                    log_warn(&format!(
                        "Graceful exit timeout, force killing {} remaining processes (SIGKILL)",
                        remaining_pids.len()
                    ));
                    for pid in &remaining_pids {
                        let _ = Command::new("kill").args(["-9", &pid.to_string()]).output();
                    }
                    thread::sleep(Duration::from_secs(1));
                }
            }
        } else {
            // pids 为空，意味着没有检测到进程或全部被逻辑排除
            log_info("No Antigravity processes found to close (possibly filtered or not running)");
        }
    }

    // 最终检查
    if is_antigravity_running() {
        return Err(
            "Unable to close Antigravity process, please close manually and retry".to_string(),
        );
    }

    log_info("Antigravity closed successfully");
    Ok(())
}

/// 启动 Antigravity
#[allow(unused_mut)]
pub fn start_antigravity() -> Result<(), String> {
    log_info("Starting Antigravity...");

    // 优先使用配置中手动指定的路径和参数
    let config = load_app_config().ok();
    let manual_path = config
        .as_ref()
        .and_then(|c| c.antigravity_executable.clone());
    let args = config.and_then(|c| c.antigravity_args.clone());

    if let Some(mut path_str) = manual_path {
        let mut path = std::path::PathBuf::from(&path_str);

        #[cfg(target_os = "macos")]
        {
            // 容错：如果路径在 .app 包内（如误选 Helper），自动纠正到 .app 目录
            if let Some(app_idx) = path_str.find(".app") {
                let corrected_app = &path_str[..app_idx + 4];
                if corrected_app != path_str {
                    log_info(&format!(
                        "Detected macOS path inside .app bundle, auto-correcting to: {}",
                        corrected_app
                    ));
                    path_str = corrected_app.to_string();
                    path = std::path::PathBuf::from(&path_str);
                }
            }
        }

        if path.exists() {
            log_info(&format!(
                "Starting with manual configuration path: {}",
                path_str
            ));

            #[cfg(target_os = "macos")]
            {
                // macOS: 如果是 .app 目录，使用 open
                if path_str.ends_with(".app") || path.is_dir() {
                    let mut cmd = Command::new("open");
                    cmd.arg("-a").arg(&path_str);

                    // 添加启动参数
                    if let Some(ref args) = args {
                        for arg in args {
                            cmd.arg(arg);
                        }
                    }

                    cmd.spawn()
                        .map_err(|e| format!("Startup failed (open): {}", e))?;
                } else {
                    let mut cmd = Command::new(&path_str);

                    // 添加启动参数
                    if let Some(ref args) = args {
                        for arg in args {
                            cmd.arg(arg);
                        }
                    }

                    cmd.spawn()
                        .map_err(|e| format!("Startup failed (direct): {}", e))?;
                }
            }

            #[cfg(not(target_os = "macos"))]
            {
                let mut cmd = Command::new(&path_str);

                // 添加启动参数
                if let Some(ref args) = args {
                    for arg in args {
                        cmd.arg(arg);
                    }
                }

                #[cfg(target_os = "windows")]
                {
                    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
                }

                cmd.spawn().map_err(|e| format!("Startup failed: {}", e))?;
            }

            log_info(&format!(
                "Antigravity startup command sent (manual path: {}, args: {:?})",
                path_str, args
            ));
            return Ok(());
        } else {
            log_warn(&format!(
                "Manual configuration path does not exist: {}, falling back to auto-detection",
                path_str
            ));
        }
    }

    // 自动检测启动
    #[cfg(target_os = "macos")]
    {
        // 改进：使用 output() 等待 open 命令完成并捕获"找不到应用"错误
        let mut cmd = Command::new("open");
        cmd.args(["-a", "Antigravity"]);

        // 添加启动参数
        if let Some(ref args) = args {
            for arg in args {
                cmd.arg(arg);
            }
        }

        let output = cmd
            .output()
            .map_err(|e| format!("Unable to execute open command: {}", e))?;

        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr);
            return Err(format!(
                "Startup failed (open exited with {}): {}",
                output.status, error
            ));
        }
    }

    #[cfg(target_os = "windows")]
    {
        let has_args = args.as_ref().map_or(false, |a| !a.is_empty());

        if has_args {
            if let Some(detected_path) = get_antigravity_executable_path() {
                let path_str = detected_path.to_string_lossy().to_string();
                log_info(&format!(
                    "Starting with auto-detected path (has args): {}",
                    path_str
                ));

                let mut cmd = Command::new(&path_str);
                if let Some(ref args) = args {
                    for arg in args {
                        cmd.arg(arg);
                    }
                }

                cmd.creation_flags(0x08000000) // CREATE_NO_WINDOW
                    .spawn()
                    .map_err(|e| format!("Startup failed: {}", e))?;
            } else {
                return Err("Startup arguments configured but cannot find Antigravity executable path. Please set the executable path manually in Settings.".to_string());
            }
        } else {
            let mut cmd = Command::new("cmd");
            cmd.args(["/C", "start", "antigravity://"]);

            let result = cmd
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .spawn();
            if result.is_err() {
                return Err("Startup failed, please open Antigravity manually".to_string());
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        let mut cmd = Command::new("antigravity");

        // 添加启动参数
        if let Some(ref args) = args {
            for arg in args {
                cmd.arg(arg);
            }
        }

        cmd.spawn().map_err(|e| format!("Startup failed: {}", e))?;
    }

    log_info(&format!(
        "Antigravity startup command sent (default detection, args: {:?})",
        args
    ));

    // 等待 Antigravity 启动，然后尝试保存路径
    thread::sleep(Duration::from_secs(2));

    if let Some(path) = get_path_from_running_process() {
        let path_str = path.to_string_lossy().to_string();
        log_info(&format!(
            "Detected Antigravity path after startup: {}",
            path_str
        ));

        if let Err(e) = super::config::update_antigravity_path(path_str) {
            log_warn(&format!("Failed to save detected path to config: {}", e));
        } else {
            log_info("Antigravity path saved to config after startup");
        }
    }

    Ok(())
}
