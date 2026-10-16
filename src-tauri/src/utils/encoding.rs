//! 控制台输出解码工具
//!
//! Windows cmd.exe 的输出使用系统 OEM 代码页（中文 Windows 下为 GBK/CP936）。
//! 直接用 `String::from_utf8_lossy` 解码会产生乱码。本模块提供辅助函数，
//! 优先尝试 UTF-8，失败后回退到 GBK 解码。

/// 解码控制台输出字节：先尝试 UTF-8，失败后回退到 GBK（CP936）。
pub fn decode_console_output(bytes: &[u8]) -> String {
    // 优先 UTF-8 — 如果字节是合法 UTF-8，直接使用
    if let Ok(s) = std::str::from_utf8(bytes) {
        return s.to_string();
    }
    // 回退到 GBK（CP936），中文 Windows 的默认 OEM 代码页
    let (decoded, _, _) = encoding_rs::GBK.decode(bytes);
    decoded.to_string()
}
