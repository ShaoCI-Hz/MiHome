use serde::{Deserialize, Serialize};

/// 凭据条目在系统凭据管理器中的标识
const KEYRING_SERVICE: &str = "mihome-desktop";
const KEYRING_ACCOUNT: &str = "xiaomi-auth";

#[derive(Serialize, Deserialize)]
pub struct AuthPayload {
    pub data: String,
}

/// 保存认证数据到 Windows 凭据管理器（加密存储）
#[tauri::command]
fn save_auth(payload: AuthPayload) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).map_err(|e| e.to_string())?;
    entry.set_password(&payload.data).map_err(|e| e.to_string())
}

/// 读取认证数据；不存在时返回 None
#[tauri::command]
fn load_auth() -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// 删除认证数据（退出登录）
#[tauri::command]
fn delete_auth() -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// 【开发诊断专用】读取外部测试凭据文件（验证请求构造用），开源发布前移除
#[tauri::command]
fn read_diag_auth() -> Result<Option<String>, String> {
    let p = std::path::Path::new(
        r"C:\Users\HeZi\AppData\Local\Temp\mihome-probe\auth.json",
    );
    if p.exists() {
        std::fs::read_to_string(p).map(Some).map_err(|e| e.to_string())
    } else {
        Ok(None)
    }
}

/// 追加一行日志到文件（前端各环节插桩，开发自测用）
#[tauri::command]
fn log_write(line: String) -> Result<(), String> {
    use std::io::Write;
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../logs");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("app.log");
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    writeln!(f, "[{ts}] {line}").map_err(|e| e.to_string())
}

/// 带 Set-Cookie 提取的 GET 请求（JS 侧读不到 Set-Cookie，登录回调必须走这里）。
/// 手动逐跳跟随重定向，**按域名过滤**发送 cookie（对齐 Python requests.Session 行为），
/// 并记录每跳诊断（hops）。
#[derive(Serialize)]
pub struct FetchResult {
    pub status: u16,
    pub text: String,
    pub cookies: std::collections::HashMap<String, String>,
    pub hops: Vec<String>,
}

#[derive(Clone)]
struct Ck {
    name: String,
    value: String,
    /// 归一化域名（无前导点，小写）
    domain: String,
    host_only: bool,
}

fn domain_matches(host: &str, ck: &Ck) -> bool {
    let h = host.to_lowercase();
    if ck.host_only {
        h == ck.domain
    } else {
        h == ck.domain || h.ends_with(&format!(".{}", ck.domain))
    }
}

/// 解析单条 Set-Cookie
fn parse_set_cookie(s: &str, fallback_host: &str) -> Option<Ck> {
    let mut parts = s.split(';');
    let kv = parts.next()?;
    let eq = kv.find('=')?;
    let name = kv[..eq].trim().to_string();
    if name.is_empty() {
        return None;
    }
    let value = kv[eq + 1..].trim().to_string();
    let mut domain = String::new();
    let mut host_only = true;
    for attr in parts {
        let a = attr.trim();
        if let Some(rest) = a.strip_prefix("Domain=") {
            domain = rest.trim().trim_start_matches('.').to_lowercase();
            host_only = false;
        }
    }
    if domain.is_empty() {
        domain = fallback_host.to_lowercase();
        host_only = true;
    }
    Some(Ck {
        name,
        value,
        domain,
        host_only,
    })
}

#[tauri::command]
async fn mi_fetch(
    url: String,
    headers: std::collections::HashMap<String, String>,
) -> Result<FetchResult, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;

    let mut current: reqwest::Url = match url.parse::<reqwest::Url>() {
        Ok(u) => u,
        Err(e) => return Err(format!("invalid url: {e}")),
    };
    let mut jar: Vec<Ck> = Vec::new();
    let mut hops: Vec<String> = Vec::new();
    let mut final_status = 0u16;
    let mut final_text = String::new();

    for _ in 0..10 {
        let host = current.host_str().unwrap_or_default().to_string();
        let mut req = client.get(current.clone());
        for (k, v) in &headers {
            if k.eq_ignore_ascii_case("cookie") {
                continue;
            }
            req = req.header(k.as_str(), v.as_str());
        }
        // 按域过滤发送 cookie（对齐 requests 行为）
        let cookie_line = jar
            .iter()
            .filter(|ck| domain_matches(&host, ck))
            .map(|ck| format!("{}={}", ck.name, ck.value))
            .collect::<Vec<_>>()
            .join("; ");
        if !cookie_line.is_empty() {
            req = req.header(reqwest::header::COOKIE, cookie_line);
        }
        let resp = req.send().await.map_err(|e| e.to_string())?;
        let status = resp.status();

        // 收集本跳 Set-Cookie（同名同域覆盖）
        let mut set_names: Vec<String> = Vec::new();
        for v in resp.headers().get_all(reqwest::header::SET_COOKIE) {
            if let Ok(s) = v.to_str() {
                if let Some(ck) = parse_set_cookie(s, &host) {
                    set_names.push(format!("{}@{}{}", ck.name, ck.domain, if ck.host_only { "(host)" } else { "" }));
                    jar.retain(|x| !(x.name == ck.name && x.domain == ck.domain && x.host_only == ck.host_only));
                    jar.push(ck);
                }
            }
        }
        hops.push(format!(
            "{} => {} set=[{}]",
            current.host_str().unwrap_or("?"),
            status.as_u16(),
            set_names.join(",")
        ));

        if status.is_redirection() {
            if let Some(loc) = resp.headers().get(reqwest::header::LOCATION) {
                if let Ok(loc_str) = loc.to_str() {
                    current = current
                        .join(loc_str)
                        .map_err(|e| format!("redirect url error: {e}"))?;
                    continue;
                }
            }
            return Err(format!("redirect {} without location", status.as_u16()));
        }
        final_status = status.as_u16();
        final_text = resp.text().await.map_err(|e| e.to_string())?;
        break;
    }

    let mut cookies = std::collections::HashMap::new();
    for ck in jar {
        cookies.insert(ck.name, ck.value);
    }

    Ok(FetchResult {
        status: final_status,
        text: final_text,
        cookies,
        hops,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None::<Vec<&str>>,
        ))
        // 关闭按钮 → 隐藏到托盘（真正退出走托盘菜单）
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .setup(|app| {
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
            use tauri::Manager;

            let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出米家", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let mut builder = TrayIconBuilder::with_id("main-tray")
                .tooltip("米家 MiHome")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                builder = builder.icon(icon.clone());
            }
            builder.build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            save_auth,
            load_auth,
            delete_auth,
            mi_fetch,
            read_diag_auth,
            log_write
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
