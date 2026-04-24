use log::{info, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use sysinfo::System;
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

/// Meeting detection rules.
///
/// Each entry has:
/// - `display_name`: shown in the UI banner
/// - `app_processes`: the main app process (must be running as a precondition)
/// - `meeting_indicators`: processes that only appear during an active meeting/call.
///   If empty, the app process itself is treated as the indicator (for apps
///   where the process only launches when joining a call).
struct MeetingApp {
    display_name: &'static str,
    app_processes: &'static [&'static str],
    meeting_indicators: &'static [&'static str],
}

const MEETING_APPS: &[MeetingApp] = &[
    MeetingApp {
        display_name: "Zoom",
        app_processes: &["zoom.us"],
        meeting_indicators: &["cpthost"],
    },
    MeetingApp {
        display_name: "Feishu",
        app_processes: &["feishu", "lark"],
        meeting_indicators: &["feishu_vc", "lark_vc", "byteaudiod"],
    },
    MeetingApp {
        display_name: "Tencent Meeting",
        app_processes: &["wemeet"],
        meeting_indicators: &["wemeetapp"],
    },
    MeetingApp {
        display_name: "VooV Meeting",
        app_processes: &["voov"],
        meeting_indicators: &[],
    },
    MeetingApp {
        display_name: "Microsoft Teams",
        app_processes: &["microsoft teams", "ms-teams", "teams"],
        meeting_indicators: &[],
    },
    MeetingApp {
        display_name: "Discord",
        app_processes: &["discord"],
        meeting_indicators: &[],
    },
    MeetingApp {
        display_name: "Webex",
        app_processes: &["webex", "webexmta"],
        meeting_indicators: &["ciscocollabhost"],
    },
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingAppDetected {
    pub app_name: String,
}

pub struct MeetingDetectionState {
    enabled: AtomicBool,
}

impl MeetingDetectionState {
    pub fn new() -> Self {
        Self {
            enabled: AtomicBool::new(true),
        }
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }

    pub fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::Relaxed);
    }
}

fn has_process(system: &System, patterns: &[&str]) -> bool {
    for process in system.processes().values() {
        let name = process.name().to_string_lossy().to_lowercase();
        for &p in patterns {
            if name.contains(p) {
                return true;
            }
        }
    }
    false
}

fn scan_active_meetings(system: &mut System) -> HashSet<String> {
    system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    let mut active: HashSet<String> = HashSet::new();
    for app in MEETING_APPS {
        if !has_process(system, app.app_processes) {
            continue;
        }
        if app.meeting_indicators.is_empty() {
            active.insert(app.display_name.to_string());
        } else if has_process(system, app.meeting_indicators) {
            active.insert(app.display_name.to_string());
        }
    }
    active
}

const BANNER_WINDOW_LABEL: &str = "meeting-banner";
const BANNER_WIDTH: f64 = 420.0;
const BANNER_HEIGHT: f64 = 64.0;

/// Show the floating banner window for a detected meeting app.
fn show_banner_window<R: Runtime>(app_handle: &AppHandle<R>, app_name: &str) {
    // If the banner window already exists, just update & show it
    if let Some(win) = app_handle.get_webview_window(BANNER_WINDOW_LABEL) {
        let _ = win.emit("meeting-app-detected", MeetingAppDetected {
            app_name: app_name.to_string(),
        });
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }

    // Build the URL with the app name as a query parameter
    let url_str = format!("/meeting-banner?app={}", urlencoded(app_name));
    let url = WebviewUrl::App(url_str.into());

    // Get primary monitor to center the window horizontally at top
    let x = app_handle
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| {
            let size = m.size();
            ((size.width as f64 / m.scale_factor()) - BANNER_WIDTH) / 2.0
        })
        .unwrap_or(500.0);

    match WebviewWindowBuilder::new(app_handle, BANNER_WINDOW_LABEL, url)
        .title("Meeting Detected")
        .inner_size(BANNER_WIDTH, BANNER_HEIGHT)
        .position(x, 36.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .build()
    {
        Ok(_) => info!("Banner window created for: {}", app_name),
        Err(e) => warn!("Failed to create banner window: {}", e),
    }
}

/// Simple percent-encoding for the app name in query string.
fn urlencoded(s: &str) -> String {
    s.replace(' ', "%20")
}

pub fn start_detection_loop<R: Runtime>(app_handle: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        let mut system = System::new();

        let mut known_meetings = scan_active_meetings(&mut system);
        if !known_meetings.is_empty() {
            info!(
                "Meetings already active at startup (will not notify): {:?}",
                known_meetings
            );
        }

        let mut notified: HashSet<String> = HashSet::new();

        loop {
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;

            let state: tauri::State<'_, MeetingDetectionState> = match app_handle.try_state() {
                Some(s) => s,
                None => continue,
            };
            if !state.is_enabled() {
                continue;
            }

            if crate::audio::recording_commands::is_recording().await {
                continue;
            }

            let currently_active = scan_active_meetings(&mut system);

            for app in &currently_active {
                if !known_meetings.contains(app) && !notified.contains(app) {
                    info!("Meeting started in: {}", app);
                    notified.insert(app.clone());
                    show_banner_window(&app_handle, app);
                }
            }

            known_meetings.retain(|a| currently_active.contains(a));
            notified.retain(|a| currently_active.contains(a));

            known_meetings = currently_active;
        }
    });
}

/// Close the banner popup window (called from the banner UI).
#[tauri::command]
pub async fn dismiss_meeting_banner<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(BANNER_WINDOW_LABEL) {
        win.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Close banner and bring main window to front to start recording.
#[tauri::command]
pub async fn accept_meeting_banner<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    // Close banner
    if let Some(win) = app.get_webview_window(BANNER_WINDOW_LABEL) {
        let _ = win.close();
    }

    // Focus main window and trigger recording start
    if let Some(main_win) = app.get_webview_window("main") {
        let _ = main_win.unminimize();
        let _ = main_win.show();
        let _ = main_win.set_focus();
        // Set the auto-start flag and navigate to home
        let _ = main_win.eval("sessionStorage.setItem('autoStartRecording', 'true')");
        let _ = main_win.eval("window.location.assign('/')");
    }
    Ok(())
}

#[tauri::command]
pub async fn set_meeting_detection_enabled<R: Runtime>(
    app: AppHandle<R>,
    enabled: bool,
) -> Result<(), String> {
    let state = app
        .try_state::<MeetingDetectionState>()
        .ok_or("MeetingDetectionState not initialized")?;
    state.set_enabled(enabled);
    info!("Meeting detection set to: {}", enabled);
    Ok(())
}

#[tauri::command]
pub async fn get_meeting_detection_enabled<R: Runtime>(
    app: AppHandle<R>,
) -> Result<bool, String> {
    let state = app
        .try_state::<MeetingDetectionState>()
        .ok_or("MeetingDetectionState not initialized")?;
    Ok(state.is_enabled())
}
