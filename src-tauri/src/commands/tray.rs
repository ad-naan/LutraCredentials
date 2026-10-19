use serde::Deserialize;
use tauri::{
    menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle,
};

/// 托盘账号项（由前端按当前账号列表生成）
#[derive(Debug, Clone, Deserialize)]
pub struct TrayAccountItem {
    pub id: String,
    /// 菜单展示文本（账号邮箱）
    pub label: String,
    /// 是否为当前活跃账号（决定勾选态）
    pub active: bool,
}

/// 托盘平台分组
#[derive(Debug, Clone, Deserialize)]
pub struct TrayPlatformGroup {
    /// 平台显示名（已本地化，由前端传入）
    pub name: String,
    pub accounts: Vec<TrayAccountItem>,
}

/// 重建系统托盘菜单：顶部固定「显示主窗口 / 退出」，其后按平台分组展示账号。
/// 点击账号菜单项（id 为 `switch:<account_id>`）由 lib.rs 的 on_menu_event
/// 转成 `tray-switch-account` 事件发给前端，走统一的 switchAccount 流程。
#[tauri::command]
pub fn update_tray_menu(app: AppHandle, groups: Vec<TrayPlatformGroup>) -> Result<(), String> {
    let tray = app
        .tray_by_id("main")
        .ok_or_else(|| "Tray icon not initialized".to_string())?;

    let show_item = MenuItem::with_id(&app, "show", "显示主窗口", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let quit_item = MenuItem::with_id(&app, "quit", "退出", true, None::<&str>)
        .map_err(|e| e.to_string())?;

    let mut items: Vec<Box<dyn IsMenuItem<tauri::Wry>>> = vec![Box::new(show_item), Box::new(quit_item)];

    let has_groups = groups.iter().any(|g| !g.accounts.is_empty());
    if has_groups {
        let separator = PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
        items.push(Box::new(separator));
    }

    for group in groups {
        if group.accounts.is_empty() {
            continue;
        }

        let mut account_items: Vec<Box<dyn IsMenuItem<tauri::Wry>>> = Vec::new();
        for account in group.accounts {
            let item = CheckMenuItem::with_id(
                &app,
                format!("switch:{}", account.id),
                account.label,
                true,
                account.active,
                None::<&str>,
            )
            .map_err(|e| e.to_string())?;
            account_items.push(Box::new(item));
        }

        let account_refs: Vec<&dyn IsMenuItem<tauri::Wry>> =
            account_items.iter().map(|item| item.as_ref()).collect();
        let submenu = Submenu::with_items(&app, group.name, true, &account_refs)
            .map_err(|e| e.to_string())?;
        items.push(Box::new(submenu));
    }

    let menu_refs: Vec<&dyn IsMenuItem<tauri::Wry>> =
        items.iter().map(|item| item.as_ref()).collect();
    let menu = Menu::with_items(&app, &menu_refs).map_err(|e| e.to_string())?;

    tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    Ok(())
}
