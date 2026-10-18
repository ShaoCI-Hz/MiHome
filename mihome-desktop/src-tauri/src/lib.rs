use serde::{Deserialize, Serialize};

/// 凭据存储：DPAPI（CryptProtectData）加密后落本地文件。
/// 弃用凭据管理器原因：本机（Win11 25H2 build 26300）CredWrite 对超过 ~20 字符的
/// blob 报 ERROR_NOT_ENOUGH_MEMORY(8)（cmdkey 与 keyring 交叉验证均为系统层故障）。
/// DPAPI 是 Windows 凭据管理器底层同一套用户级加密，安全等级不打折且无大小限制。
const AUTH_FILE_MARKER: &str = "mihome-desktop";

fn auth_file_path() -> Result<std::path::PathBuf, String> {
    let base = std::env::var("APPDATA").map_err(|_| "APPDATA 环境变量不存在".to_string())?;
    let dir = std::path::Path::new(&base).join(AUTH_FILE_MARKER);
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建凭据目录失败: {e}"))?;
    Ok(dir.join("auth.bin"))
}

/// DPAPI 加密（当前用户作用域，CRYPTPROTECT_UI_FORBIDDEN）
fn dpapi_encrypt(plain: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    unsafe {
        let in_blob = CRYPT_INTEGER_BLOB {
            cbData: plain.len() as u32,
            pbData: plain.as_ptr() as *mut u8,
        };
        let mut out_blob = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };
        let ok = CryptProtectData(
            &in_blob,
            core::ptr::null_mut(),
            core::ptr::null_mut(),
            core::ptr::null_mut(),
            core::ptr::null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out_blob,
        );
        if ok == 0 {
            return Err("CryptProtectData 失败".to_string());
        }
        let slice = std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize);
        let out = slice.to_vec();
        windows_sys::Win32::Foundation::LocalFree(out_blob.pbData as _);
        Ok(out)
    }
}

/// DPAPI 解密
fn dpapi_decrypt(cipher: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    unsafe {
        let in_blob = CRYPT_INTEGER_BLOB {
            cbData: cipher.len() as u32,
            pbData: cipher.as_ptr() as *mut u8,
        };
        let mut out_blob = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };
        let ok = CryptUnprotectData(
            &in_blob,
            core::ptr::null_mut(),
            core::ptr::null_mut(),
            core::ptr::null_mut(),
            core::ptr::null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out_blob,
        );
        if ok == 0 {
            return Err("CryptUnprotectData 失败（可能被其他用户加密）".to_string());
        }
        let slice = std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize);
        let out = slice.to_vec();
        windows_sys::Win32::Foundation::LocalFree(out_blob.pbData as _);
        Ok(out)
    }
}

#[derive(Serialize, Deserialize)]
pub struct AuthPayload {
    pub data: String,
}

/// 保存认证数据（DPAPI 加密落盘）
#[tauri::command]
fn save_auth(payload: AuthPayload) -> Result<(), String> {
    let cipher = dpapi_encrypt(payload.data.as_bytes())?;
    let path = auth_file_path()?;
    std::fs::write(&path, &cipher).map_err(|e| format!("写凭据文件失败: {e}"))
}

/// 读取认证数据；不存在时返回 None
#[tauri::command]
fn load_auth() -> Result<Option<String>, String> {
    let path = auth_file_path()?;
    let cipher = match std::fs::read(&path) {
        Ok(c) => c,
        Err(_) => return Ok(None),
    };
    let plain = dpapi_decrypt(&cipher)?;
    String::from_utf8(plain)
        .map(Some)
        .map_err(|_| "凭据内容不是有效 UTF-8".to_string())
}

/// 删除认证数据（退出登录）
#[tauri::command]
fn delete_auth() -> Result<(), String> {
    let path = auth_file_path()?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("删凭据文件失败: {e}")),
    }
}

/// 托盘场景菜单项
#[derive(Serialize, Deserialize)]
pub struct TrayScene {
    pub id: String,
    pub name: String,
}

/// 构建托盘菜单（泛型：场景子菜单需要 dyn IsMenuItem 数组，裸类型参数写不出，抽辅助函数）
fn build_tray_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    scenes: &[TrayScene],
) -> Result<tauri::menu::Menu<R>, String> {
    use tauri::menu::{IsMenuItem, Menu, MenuItem, Submenu};

    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let quit = MenuItem::with_id(app, "quit", "退出米家", true, None::<&str>)
        .map_err(|e| e.to_string())?;

    if scenes.is_empty() {
        return Menu::with_items(app, &[&show, &quit]).map_err(|e| e.to_string());
    }

    let scene_items: Vec<MenuItem<R>> = scenes
        .iter()
        .map(|s| {
            MenuItem::with_id(
                app,
                format!("scene:{}", s.id),
                s.name.clone(),
                true,
                None::<&str>,
            )
        })
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    let scene_refs: Vec<&dyn IsMenuItem<R>> = scene_items
        .iter()
        .map(|m| m as &dyn IsMenuItem<R>)
        .collect();
    let scene_menu = Submenu::with_items(app, "手动场景", true, &scene_refs)
        .map_err(|e| e.to_string())?;

    Menu::with_items(app, &[&show, &quit, &scene_menu]).map_err(|e| e.to_string())
}

/// 重建托盘菜单（同步手动场景子菜单，前端在场景变化时调用）
#[tauri::command]
fn update_tray_scenes(
    app: tauri::AppHandle,
    scenes: Vec<TrayScene>,
) -> Result<(), String> {
    let menu = build_tray_menu(&app, &scenes)?;
    if let Some(tray) = app.tray_by_id("main-tray") {
        tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 追加一行日志到文件（开发自测用；发布包中 manifest 路径无效时回退到临时目录）
#[tauri::command]
fn log_write(line: String) -> Result<(), String> {
    use std::io::Write;
    let candidates = [
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../logs"),
        std::env::temp_dir().join("mihome-desktop-logs"),
    ];
    let mut last_err = String::new();
    for dir in &candidates {
        if std::fs::create_dir_all(dir).is_err() {
            continue;
        }
        let path = dir.join("app.log");
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
        {
            let ts = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            return writeln!(f, "[{ts}] {line}").map_err(|e| e.to_string());
        }
        last_err = format!("open {} failed", path.display());
    }
    Err(last_err)
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
    // SSRF 防护：仅允许小米系域名（登录回调/刷新的实际域）
    {
        let host = current.host_str().unwrap_or_default().to_lowercase();
        const ALLOWED: [&str; 3] = ["xiaomi.com", "mijia.tech", "mi.com"];
        let ok = ALLOWED.iter().any(|d| host == *d || host.ends_with(&format!(".{d}")));
        if !ok {
            return Err(format!("host not allowed: {host}"));
        }
    }
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

/// 关闭按钮行为：true=隐藏到托盘（默认），false=直接退出（前端可切换）
static CLOSE_TO_TRAY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);

/// 设置关闭行为（true=隐藏到托盘，false=直接退出）
#[tauri::command]
fn set_close_to_tray(v: bool) {
    use std::sync::atomic::Ordering;
    CLOSE_TO_TRAY.store(v, Ordering::Relaxed);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use std::sync::atomic::Ordering;

    tauri::Builder::default()
        // 单实例：二次启动唤起已有窗口（必须最先注册）
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            use tauri::Manager;
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            // 开机自启时静默后台启动，不抢前台（配合 setup 的 --minimized 检测）
            Some(vec!["--minimized"]),
        ))
        // 关闭按钮：按偏好隐藏到托盘或直接退出；首关发系统通知提示去向
        .on_window_event(move |window, event| {
            use tauri::Manager;
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if !CLOSE_TO_TRAY.load(Ordering::Relaxed) {
                    return; // 用户选择了"直接退出"，放行
                }
                use tauri_plugin_notification::NotificationExt;
                static ONCE: std::sync::Once = std::sync::Once::new();
                ONCE.call_once(|| {
                    let _ = window
                        .app_handle()
                        .notification()
                        .builder()
                        .title("米家已在后台运行")
                        .body("窗口已最小化到系统托盘，右键托盘图标可退出程序")
                        .show();
                });
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .setup(|app| {
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
            use tauri::Manager;

            // 开机自启（--minimized 参数）：静默后台启动，不抢前台
            if std::env::args().any(|a| a == "--minimized") {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }

            // 窗口毛玻璃：优先 Acrylic（效果明显，类 macOS 模糊光斑），
            // 失败回退 Mica（Win11 低饱和），再回退 Blur
            #[cfg(target_os = "windows")]
            if let Some(w) = app.get_webview_window("main") {
                if window_vibrancy::apply_acrylic(&w, None).is_err()
                    && window_vibrancy::apply_mica(&w, None).is_err()
                {
                    let _ = window_vibrancy::apply_blur(&w, None);
                }
            }

            let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出米家", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let mut builder = TrayIconBuilder::with_id("main-tray")
                .tooltip("米家 MiHome")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    use tauri::Emitter;
                    let id = event.id.as_ref();
                    if let Some(scene_id) = id.strip_prefix("scene:") {
                        // 手动场景：通知前端执行（协议层在前端）
                        let _ = app.emit("run-scene", scene_id.to_string());
                        return;
                    }
                    match id {
                        "show" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    }
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
            log_write,
            update_tray_scenes,
            set_close_to_tray
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
