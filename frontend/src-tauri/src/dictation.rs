use serde::{Deserialize, Serialize};
use regex::Regex;
use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::{LazyLock, Mutex as StdMutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::audio::audio_processing::{audio_to_mono, resample_audio};
use crate::audio::extract_speech_16k;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};
#[cfg(target_os = "macos")]
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
#[cfg(target_os = "macos")]
use tauri_plugin_notification::NotificationExt;

#[cfg(target_os = "macos")]
use core_foundation::base::TCFType;
#[cfg(target_os = "macos")]
use core_foundation::runloop::{kCFRunLoopCommonModes, CFRunLoop, CFRunLoopTimer};
#[cfg(target_os = "macos")]
use core_graphics::event::{
    CGEvent, CGEventFlags, CGEventTap, CGEventTapLocation, CGEventTapOptions,
    CGEventTapPlacement, CGEventType, EventField,
};

const DICTATION_WIDGET_LABEL: &str = "dictation-widget";
const DICTATION_WIDGET_WIDTH: f64 = 400.0;
const DICTATION_WIDGET_HEIGHT: f64 = 128.0;
const MAX_DICTATION_SECONDS: usize = 60;
const DICTATION_LOW_LATENCY_BUFFER_TARGET_FRAMES: u32 = 256;
const DICTATION_CAPTURE_WARMUP_TIMEOUT_MS: u64 = 300;
const DEFAULT_HOTKEY: &str = "fn+space";
const DEBUG_EVENT_LIMIT: usize = 50;
const KEY_RETURN: u16 = 0x24;
const KEY_TAB: u16 = 0x30;
const KEY_SPACE: u16 = 0x31;
const KEY_ESCAPE: u16 = 0x35;
const KEY_FUNCTION: u16 = 0x3F;
const KEY_LEFT_COMMAND: u16 = 0x37;
const KEY_RIGHT_COMMAND: u16 = 0x36;
const KEY_LEFT_CONTROL: u16 = 0x3B;
const KEY_RIGHT_CONTROL: u16 = 0x3E;
const KEY_LEFT_OPTION: u16 = 0x3A;
const KEY_RIGHT_OPTION: u16 = 0x3D;
const KEY_LEFT_SHIFT: u16 = 0x38;
const KEY_RIGHT_SHIFT: u16 = 0x3C;
const KEY_A: u16 = 0x00;
const KEY_B: u16 = 0x0B;
const KEY_C: u16 = 0x08;
const KEY_D: u16 = 0x02;
const KEY_E: u16 = 0x0E;
const KEY_F: u16 = 0x03;
const KEY_G: u16 = 0x05;
const KEY_H: u16 = 0x04;
const KEY_I: u16 = 0x22;
const KEY_J: u16 = 0x26;
const KEY_K: u16 = 0x28;
const KEY_L: u16 = 0x25;
const KEY_M: u16 = 0x2E;
const KEY_N: u16 = 0x2D;
const KEY_O: u16 = 0x1F;
const KEY_P: u16 = 0x23;
const KEY_Q: u16 = 0x0C;
const KEY_R: u16 = 0x0F;
const KEY_S: u16 = 0x01;
const KEY_T: u16 = 0x11;
const KEY_U: u16 = 0x20;
const KEY_V: u16 = 0x09;
const KEY_W: u16 = 0x0D;
const KEY_X: u16 = 0x07;
const KEY_Y: u16 = 0x10;
const KEY_Z: u16 = 0x06;
const KEY_0: u16 = 0x1D;
const KEY_1: u16 = 0x12;
const KEY_2: u16 = 0x13;
const KEY_3: u16 = 0x14;
const KEY_4: u16 = 0x15;
const KEY_5: u16 = 0x17;
const KEY_6: u16 = 0x16;
const KEY_7: u16 = 0x1A;
const KEY_8: u16 = 0x1C;
const KEY_9: u16 = 0x19;
const KEY_F1: u16 = 0x7A;
const KEY_F2: u16 = 0x78;
const KEY_F3: u16 = 0x63;
const KEY_F4: u16 = 0x76;
const KEY_F5: u16 = 0x60;
const KEY_F6: u16 = 0x61;
const KEY_F7: u16 = 0x62;
const KEY_F8: u16 = 0x64;
const KEY_F9: u16 = 0x65;
const KEY_F10: u16 = 0x6D;
const KEY_F11: u16 = 0x67;
const KEY_F12: u16 = 0x6F;
const KEY_F13: u16 = 0x69;
const KEY_F14: u16 = 0x6B;
const KEY_F15: u16 = 0x71;
const KEY_F16: u16 = 0x6A;
const KEY_F17: u16 = 0x40;
const KEY_F18: u16 = 0x4F;
const KEY_F19: u16 = 0x50;
const KEY_F20: u16 = 0x5A;

static DICTATION_ACTIVE: AtomicBool = AtomicBool::new(false);
static DICTATION_PROCESSING: AtomicBool = AtomicBool::new(false);
static DICTATION_PREWARMING: AtomicBool = AtomicBool::new(false);
static HOTKEY_HELD: AtomicBool = AtomicBool::new(false);
static FN_HELD: AtomicBool = AtomicBool::new(false);
static CMD_HELD: AtomicBool = AtomicBool::new(false);
static CTRL_HELD: AtomicBool = AtomicBool::new(false);
static ALT_HELD: AtomicBool = AtomicBool::new(false);
static SHIFT_HELD: AtomicBool = AtomicBool::new(false);
static HOTKEY_KEY_CODE: AtomicU16 = AtomicU16::new(KEY_SPACE);
static HOTKEY_REQUIRE_FN: AtomicBool = AtomicBool::new(true);
static HOTKEY_REQUIRE_CONTROL: AtomicBool = AtomicBool::new(false);
static HOTKEY_REQUIRE_COMMAND: AtomicBool = AtomicBool::new(false);
static HOTKEY_REQUIRE_OPTION: AtomicBool = AtomicBool::new(false);
static HOTKEY_REQUIRE_SHIFT: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "macos")]
static ACCESSIBILITY_PROMPTED_THIS_SESSION: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "macos")]
static INPUT_MONITORING_PROMPTED_THIS_SESSION: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "macos")]
static DICTATION_PERMISSION_WARNING_NOTIFIED_THIS_SESSION: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "macos")]
static DICTATION_PERMISSION_WARNING_DIALOG_SHOWN_THIS_SESSION: AtomicBool = AtomicBool::new(false);

static LAST_TRANSCRIPT: LazyLock<StdMutex<Option<String>>> = LazyLock::new(|| StdMutex::new(None));
static HOTKEY_CONFIG: LazyLock<StdMutex<DictationHotkeyConfig>> =
    LazyLock::new(|| StdMutex::new(DictationHotkeyConfig::default()));
static DICTATION_DEBUG_STATE: LazyLock<StdMutex<DictationDebugState>> =
    LazyLock::new(|| StdMutex::new(DictationDebugState::default()));

#[derive(Debug, Clone, Serialize)]
struct WidgetPayload {
    state: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    transcript: Option<String>,
    hotkey: String,
}

#[derive(Debug, Clone)]
struct DictationHotkeyConfig {
    key_code: u16,
    require_fn: bool,
    require_control: bool,
    require_command: bool,
    require_option: bool,
    require_shift: bool,
    display: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DictationDebugEvent {
    timestamp_ms: u64,
    event_type: String,
    keycode: u16,
    expected_keycode: u16,
    key: String,
    flags: String,
    autorepeat: bool,
    matches_hotkey: bool,
    modifiers_ok: bool,
    consume_candidate: bool,
    hotkey_held_before: bool,
    hotkey_held_after: bool,
    action: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DictationDebugState {
    listener_running: bool,
    listener_mode: String,
    listener_last_error: Option<String>,
    listener_started_at_ms: Option<u64>,
    event_count: u64,
    events: Vec<DictationDebugEvent>,
}

impl Default for DictationDebugState {
    fn default() -> Self {
        Self {
            listener_running: false,
            listener_mode: "not-started".to_string(),
            listener_last_error: None,
            listener_started_at_ms: None,
            event_count: 0,
            events: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct DictationDebugSnapshot {
    listener_running: bool,
    listener_mode: String,
    listener_last_error: Option<String>,
    listener_started_at_ms: Option<u64>,
    event_count: u64,
    accessibility_granted: bool,
    input_monitoring_granted: bool,
    current_hotkey: String,
    current_keycode: u16,
    require_fn: bool,
    require_control: bool,
    require_command: bool,
    require_option: bool,
    require_shift: bool,
    dictation_active: bool,
    dictation_processing: bool,
    hotkey_held: bool,
    fn_held: bool,
    cmd_held: bool,
    ctrl_held: bool,
    alt_held: bool,
    shift_held: bool,
    events: Vec<DictationDebugEvent>,
}

impl Default for DictationHotkeyConfig {
    fn default() -> Self {
        Self {
            key_code: KEY_SPACE,
            require_fn: true,
            require_control: false,
            require_command: false,
            require_option: false,
            require_shift: false,
            display: DEFAULT_HOTKEY.to_string(),
        }
    }
}

#[derive(Debug, Clone)]
struct CapturedAudio {
    sample_rate: u32,
    samples: Vec<f32>,
}

struct DictationRecorder {
    stream: cpal::Stream,
    sample_rate: u32,
    buffer: std::sync::Arc<StdMutex<Vec<f32>>>,
}

// SAFETY: cpal::Stream is used only through synchronized access in this module.
unsafe impl Send for DictationRecorder {}

static ACTIVE_RECORDER: LazyLock<StdMutex<Option<DictationRecorder>>> =
    LazyLock::new(|| StdMutex::new(None));

#[cfg(target_os = "macos")]
struct HotkeyListenerState {
    run_loop: CFRunLoop,
    thread_handle: std::thread::JoinHandle<()>,
}

#[cfg(target_os = "macos")]
static HOTKEY_LISTENER: LazyLock<StdMutex<Option<HotkeyListenerState>>> =
    LazyLock::new(|| StdMutex::new(None));

#[cfg(target_os = "macos")]
#[derive(Clone, Copy, Debug)]
enum EventTapMode {
    Filter,
    ListenOnly,
}

#[cfg(target_os = "macos")]
fn check_accessibility_permission() -> bool {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGPreflightPostEventAccess() -> bool;
    }
    unsafe { CGPreflightPostEventAccess() }
}

#[cfg(target_os = "macos")]
fn check_input_monitoring_permission() -> bool {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGPreflightListenEventAccess() -> bool;
    }
    unsafe { CGPreflightListenEventAccess() }
}

#[cfg(target_os = "macos")]
fn request_accessibility_permission_internal() -> bool {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGRequestPostEventAccess() -> bool;
    }
    unsafe { CGRequestPostEventAccess() }
}

#[cfg(target_os = "macos")]
fn request_input_monitoring_permission_internal() -> bool {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGRequestListenEventAccess() -> bool;
    }
    unsafe { CGRequestListenEventAccess() }
}

#[cfg(target_os = "macos")]
fn notify_dictation_permission_warning<R: Runtime>(
    app: &AppHandle<R>,
    accessibility_granted: bool,
    input_monitoring_granted: bool,
) {
    if DICTATION_PERMISSION_WARNING_NOTIFIED_THIS_SESSION.swap(true, Ordering::SeqCst) {
        return;
    }

    let mut missing = Vec::new();
    if !accessibility_granted {
        missing.push("Accessibility");
    }
    if !input_monitoring_granted {
        missing.push("Input Monitoring");
    }
    if missing.is_empty() {
        return;
    }

    let body = format!(
        "Dictation hotkey is disabled until {} permission is granted. Open System Settings > Privacy & Security, grant access, then restart listener.",
        missing.join(" and ")
    );

    if let Err(e) = app
        .notification()
        .builder()
        .title("Dictation permission required")
        .body(&body)
        .show()
    {
        log::warn!("Failed to show dictation permission notification: {}", e);
    }
}

#[cfg(target_os = "macos")]
fn open_macos_privacy_settings(preference_pane: &str) {
    let url = format!(
        "x-apple.systempreferences:com.apple.preference.security?{}",
        preference_pane
    );
    if let Err(e) = Command::new("open").arg(&url).spawn() {
        log::warn!("Failed to open System Settings for {}: {}", preference_pane, e);
    }
}

#[cfg(target_os = "macos")]
fn show_dictation_permission_dialog<R: Runtime>(
    app: &AppHandle<R>,
    accessibility_granted: bool,
    input_monitoring_granted: bool,
) {
    if DICTATION_PERMISSION_WARNING_DIALOG_SHOWN_THIS_SESSION.swap(true, Ordering::SeqCst) {
        return;
    }

    let mut missing = Vec::new();
    if !accessibility_granted {
        missing.push("Accessibility");
    }
    if !input_monitoring_granted {
        missing.push("Input Monitoring");
    }
    if missing.is_empty() {
        return;
    }

    let preferred_pane = if !accessibility_granted {
        "Privacy_Accessibility"
    } else {
        "Privacy_ListenEvent"
    };

    let body = format!(
        "Dictation hotkey cannot start because {} permission is missing.\n\nClick \"Open Settings\" to grant access in System Settings > Privacy & Security.",
        missing.join(" and ")
    );

    app.dialog()
        .message(body)
        .title("Dictation Permission Required")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Open Settings".to_string(),
            "Later".to_string(),
        ))
        .show(move |open_settings| {
            if open_settings {
                open_macos_privacy_settings(preferred_pane);
            }
        });
}

#[cfg(target_os = "macos")]
fn maybe_prompt_missing_dictation_permissions<R: Runtime>(app: &AppHandle<R>) {
    let mut accessibility_granted = check_accessibility_permission();
    let mut input_monitoring_granted = check_input_monitoring_permission();

    if !accessibility_granted
        && !ACCESSIBILITY_PROMPTED_THIS_SESSION.swap(true, Ordering::SeqCst)
    {
        let granted = request_accessibility_permission_internal();
        log::info!(
            "Dictation auto-request Accessibility permission result: {}",
            granted
        );
        accessibility_granted = check_accessibility_permission();
    }

    if !input_monitoring_granted
        && !INPUT_MONITORING_PROMPTED_THIS_SESSION.swap(true, Ordering::SeqCst)
    {
        let granted = request_input_monitoring_permission_internal();
        log::info!(
            "Dictation auto-request Input Monitoring permission result: {}",
            granted
        );
        input_monitoring_granted = check_input_monitoring_permission();
    }

    if !accessibility_granted || !input_monitoring_granted {
        show_dictation_permission_dialog(app, accessibility_granted, input_monitoring_granted);
        notify_dictation_permission_warning(app, accessibility_granted, input_monitoring_granted);
    }
}

#[cfg(not(target_os = "macos"))]
fn check_accessibility_permission() -> bool {
    false
}

#[cfg(not(target_os = "macos"))]
fn check_input_monitoring_permission() -> bool {
    false
}

fn hotkey_config_from_atoms() -> DictationHotkeyConfig {
    DictationHotkeyConfig {
        key_code: HOTKEY_KEY_CODE.load(Ordering::SeqCst),
        require_fn: HOTKEY_REQUIRE_FN.load(Ordering::SeqCst),
        require_control: HOTKEY_REQUIRE_CONTROL.load(Ordering::SeqCst),
        require_command: HOTKEY_REQUIRE_COMMAND.load(Ordering::SeqCst),
        require_option: HOTKEY_REQUIRE_OPTION.load(Ordering::SeqCst),
        require_shift: HOTKEY_REQUIRE_SHIFT.load(Ordering::SeqCst),
        display: String::new(),
    }
}

fn sync_hotkey_atoms(cfg: &DictationHotkeyConfig) {
    HOTKEY_KEY_CODE.store(cfg.key_code, Ordering::SeqCst);
    HOTKEY_REQUIRE_FN.store(cfg.require_fn, Ordering::SeqCst);
    HOTKEY_REQUIRE_CONTROL.store(cfg.require_control, Ordering::SeqCst);
    HOTKEY_REQUIRE_COMMAND.store(cfg.require_command, Ordering::SeqCst);
    HOTKEY_REQUIRE_OPTION.store(cfg.require_option, Ordering::SeqCst);
    HOTKEY_REQUIRE_SHIFT.store(cfg.require_shift, Ordering::SeqCst);
}

fn current_hotkey_display() -> String {
    HOTKEY_CONFIG
        .lock()
        .map(|c| c.display.clone())
        .unwrap_or_else(|_| DEFAULT_HOTKEY.to_string())
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn keycode_to_name(keycode: u16) -> String {
    match keycode {
        KEY_SPACE => "space".to_string(),
        KEY_RETURN => "enter".to_string(),
        KEY_TAB => "tab".to_string(),
        KEY_ESCAPE => "esc".to_string(),
        KEY_FUNCTION => "fn".to_string(),
        KEY_LEFT_COMMAND | KEY_RIGHT_COMMAND => "cmd".to_string(),
        KEY_LEFT_CONTROL | KEY_RIGHT_CONTROL => "ctrl".to_string(),
        KEY_LEFT_OPTION | KEY_RIGHT_OPTION => "option".to_string(),
        KEY_LEFT_SHIFT | KEY_RIGHT_SHIFT => "shift".to_string(),
        KEY_A => "a".to_string(),
        KEY_B => "b".to_string(),
        KEY_C => "c".to_string(),
        KEY_D => "d".to_string(),
        KEY_E => "e".to_string(),
        KEY_F => "f".to_string(),
        KEY_G => "g".to_string(),
        KEY_H => "h".to_string(),
        KEY_I => "i".to_string(),
        KEY_J => "j".to_string(),
        KEY_K => "k".to_string(),
        KEY_L => "l".to_string(),
        KEY_M => "m".to_string(),
        KEY_N => "n".to_string(),
        KEY_O => "o".to_string(),
        KEY_P => "p".to_string(),
        KEY_Q => "q".to_string(),
        KEY_R => "r".to_string(),
        KEY_S => "s".to_string(),
        KEY_T => "t".to_string(),
        KEY_U => "u".to_string(),
        KEY_V => "v".to_string(),
        KEY_W => "w".to_string(),
        KEY_X => "x".to_string(),
        KEY_Y => "y".to_string(),
        KEY_Z => "z".to_string(),
        KEY_0 => "0".to_string(),
        KEY_1 => "1".to_string(),
        KEY_2 => "2".to_string(),
        KEY_3 => "3".to_string(),
        KEY_4 => "4".to_string(),
        KEY_5 => "5".to_string(),
        KEY_6 => "6".to_string(),
        KEY_7 => "7".to_string(),
        KEY_8 => "8".to_string(),
        KEY_9 => "9".to_string(),
        KEY_F1 => "f1".to_string(),
        KEY_F2 => "f2".to_string(),
        KEY_F3 => "f3".to_string(),
        KEY_F4 => "f4".to_string(),
        KEY_F5 => "f5".to_string(),
        KEY_F6 => "f6".to_string(),
        KEY_F7 => "f7".to_string(),
        KEY_F8 => "f8".to_string(),
        KEY_F9 => "f9".to_string(),
        KEY_F10 => "f10".to_string(),
        KEY_F11 => "f11".to_string(),
        KEY_F12 => "f12".to_string(),
        KEY_F13 => "f13".to_string(),
        KEY_F14 => "f14".to_string(),
        KEY_F15 => "f15".to_string(),
        KEY_F16 => "f16".to_string(),
        KEY_F17 => "f17".to_string(),
        KEY_F18 => "f18".to_string(),
        KEY_F19 => "f19".to_string(),
        KEY_F20 => "f20".to_string(),
        other => format!("keycode:{other}"),
    }
}

#[cfg(target_os = "macos")]
fn format_flags(flags: CGEventFlags) -> String {
    let mut tokens: Vec<&str> = Vec::new();
    if flags.contains(CGEventFlags::CGEventFlagSecondaryFn) {
        tokens.push("fn");
    }
    if flags.contains(CGEventFlags::CGEventFlagCommand) {
        tokens.push("cmd");
    }
    if flags.contains(CGEventFlags::CGEventFlagControl) {
        tokens.push("ctrl");
    }
    if flags.contains(CGEventFlags::CGEventFlagAlternate) {
        tokens.push("option");
    }
    if flags.contains(CGEventFlags::CGEventFlagShift) {
        tokens.push("shift");
    }
    if tokens.is_empty() {
        "none".to_string()
    } else {
        tokens.join("+")
    }
}

fn set_listener_debug_state(running: bool, mode: &str, error: Option<String>) {
    if let Ok(mut debug) = DICTATION_DEBUG_STATE.lock() {
        debug.listener_running = running;
        debug.listener_mode = mode.to_string();
        debug.listener_last_error = error;
        if running {
            debug.listener_started_at_ms = Some(now_millis());
        }
    }
}

fn push_debug_event(event: DictationDebugEvent) {
    if let Ok(mut debug) = DICTATION_DEBUG_STATE.lock() {
        debug.event_count = debug.event_count.saturating_add(1);
        debug.events.push(event);
        if debug.events.len() > DEBUG_EVENT_LIMIT {
            let overflow = debug.events.len() - DEBUG_EVENT_LIMIT;
            debug.events.drain(0..overflow);
        }
    }
}

#[cfg(target_os = "macos")]
fn is_keydown_hotkey_match(
    event_type: CGEventType,
    keycode: u16,
    flags: CGEventFlags,
    autorepeat: bool,
    cfg: &DictationHotkeyConfig,
) -> bool {
    matches!(event_type, CGEventType::KeyDown)
        && !autorepeat
        && keycode == cfg.key_code
        && modifiers_match(flags, cfg)
}

#[cfg(target_os = "macos")]
fn should_trace_debug_event(_keycode: u16, _cfg: &DictationHotkeyConfig) -> bool {
    // Trace all key events for diagnostics — the debug buffer is capped at
    // DEBUG_EVENT_LIMIT entries so this won't grow unbounded.
    true
}

fn emit_widget_state<R: Runtime>(
    app: &AppHandle<R>,
    state: &str,
    message: &str,
    transcript: Option<String>,
) {
    let payload = WidgetPayload {
        state: state.to_string(),
        message: message.to_string(),
        transcript,
        hotkey: current_hotkey_display(),
    };

    let _ = app.emit("dictation-widget-update", payload);
}

fn ensure_widget_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(win) = app.get_webview_window(DICTATION_WIDGET_LABEL) {
        let _ = win.show();
        return;
    }

    let x = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| {
            let size = m.size();
            ((size.width as f64 / m.scale_factor()) - DICTATION_WIDGET_WIDTH) / 2.0
        })
        .unwrap_or(520.0);

    let _ = WebviewWindowBuilder::new(
        app,
        DICTATION_WIDGET_LABEL,
        WebviewUrl::App("/dictation-widget".into()),
    )
    .title("Dictation Widget")
    .inner_size(DICTATION_WIDGET_WIDTH, DICTATION_WIDGET_HEIGHT)
    .position(x, 32.0)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .build();
}

fn hide_widget_after_delay<R: Runtime>(app: AppHandle<R>, ms: u64) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(ms)).await;
        if let Some(win) = app.get_webview_window(DICTATION_WIDGET_LABEL) {
            let _ = win.hide();
        }
    });
}

#[cfg(target_os = "macos")]
fn modifiers_match(flags: CGEventFlags, cfg: &DictationHotkeyConfig) -> bool {
    let has_fn = flags.contains(CGEventFlags::CGEventFlagSecondaryFn) || FN_HELD.load(Ordering::SeqCst);
    let has_ctrl = flags.contains(CGEventFlags::CGEventFlagControl) || CTRL_HELD.load(Ordering::SeqCst);
    let has_cmd = flags.contains(CGEventFlags::CGEventFlagCommand) || CMD_HELD.load(Ordering::SeqCst);
    let has_alt = flags.contains(CGEventFlags::CGEventFlagAlternate) || ALT_HELD.load(Ordering::SeqCst);
    let has_shift = flags.contains(CGEventFlags::CGEventFlagShift) || SHIFT_HELD.load(Ordering::SeqCst);

    has_fn == cfg.require_fn
        && has_ctrl == cfg.require_control
        && has_cmd == cfg.require_command
        && has_alt == cfg.require_option
        && has_shift == cfg.require_shift
}

fn push_audio_chunk(
    shared: &std::sync::Arc<StdMutex<Vec<f32>>>,
    data: &[f32],
    channels: u16,
    max_samples: usize,
) {
    if data.is_empty() {
        return;
    }

    let mono = if channels > 1 {
        audio_to_mono(data, channels)
    } else {
        data.to_vec()
    };

    if let Ok(mut buffer) = shared.lock() {
        if buffer.len() + mono.len() > max_samples {
            let overflow = (buffer.len() + mono.len()) - max_samples;
            let drop_n = overflow.min(buffer.len());
            buffer.drain(0..drop_n);
        }
        buffer.extend_from_slice(&mono);
    }
}

fn choose_dictation_buffer_size(supported: &cpal::SupportedStreamConfig) -> cpal::BufferSize {
    match supported.buffer_size() {
        cpal::SupportedBufferSize::Range { min, max } => {
            let target = DICTATION_LOW_LATENCY_BUFFER_TARGET_FRAMES.clamp(*min, *max);
            cpal::BufferSize::Fixed(target)
        }
        cpal::SupportedBufferSize::Unknown => cpal::BufferSize::Default,
    }
}

fn start_microphone_capture() -> Result<(), String> {
    let mut guard = ACTIVE_RECORDER
        .lock()
        .map_err(|e| format!("Failed to lock recorder state: {e}"))?;

    if guard.is_some() {
        return Ok(());
    }

    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| "No default microphone device available".to_string())?;

    let supported = device
        .default_input_config()
        .map_err(|e| format!("Failed to get microphone config: {e}"))?;

    let sample_rate = supported.sample_rate().0;
    let channels = supported.channels();
    let stream_config = cpal::StreamConfig {
        channels,
        sample_rate: cpal::SampleRate(sample_rate),
        // Prefer a smaller buffer to reduce hotkey-to-capture latency.
        buffer_size: choose_dictation_buffer_size(&supported),
    };

    let max_samples = (sample_rate as usize) * MAX_DICTATION_SECONDS;
    let shared_buffer = std::sync::Arc::new(StdMutex::new(Vec::<f32>::new()));
    let first_callback_received = std::sync::Arc::new(AtomicBool::new(false));

    let err_fn = |err| {
        log::error!("Dictation microphone stream error: {err}");
    };

    let stream = match supported.sample_format() {
        cpal::SampleFormat::F32 => {
            let shared = shared_buffer.clone();
            let first_ready = first_callback_received.clone();
            device
                .build_input_stream(
                    &stream_config,
                    move |data: &[f32], _: &cpal::InputCallbackInfo| {
                        if !data.is_empty() {
                            first_ready.store(true, Ordering::Relaxed);
                        }
                        push_audio_chunk(&shared, data, channels, max_samples);
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("Failed to open F32 microphone stream: {e}"))?
        }
        cpal::SampleFormat::I16 => {
            let shared = shared_buffer.clone();
            let first_ready = first_callback_received.clone();
            device
                .build_input_stream(
                    &stream_config,
                    move |data: &[i16], _: &cpal::InputCallbackInfo| {
                        if !data.is_empty() {
                            first_ready.store(true, Ordering::Relaxed);
                        }
                        let f32_data: Vec<f32> = data
                            .iter()
                            .map(|&sample| sample as f32 / i16::MAX as f32)
                            .collect();
                        push_audio_chunk(&shared, &f32_data, channels, max_samples);
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("Failed to open I16 microphone stream: {e}"))?
        }
        cpal::SampleFormat::U16 => {
            let shared = shared_buffer.clone();
            let first_ready = first_callback_received.clone();
            device
                .build_input_stream(
                    &stream_config,
                    move |data: &[u16], _: &cpal::InputCallbackInfo| {
                        if !data.is_empty() {
                            first_ready.store(true, Ordering::Relaxed);
                        }
                        let f32_data: Vec<f32> = data
                            .iter()
                            .map(|&sample| (sample as f32 / u16::MAX as f32) * 2.0 - 1.0)
                            .collect();
                        push_audio_chunk(&shared, &f32_data, channels, max_samples);
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("Failed to open U16 microphone stream: {e}"))?
        }
        cpal::SampleFormat::I32 => {
            let shared = shared_buffer.clone();
            let first_ready = first_callback_received.clone();
            device
                .build_input_stream(
                    &stream_config,
                    move |data: &[i32], _: &cpal::InputCallbackInfo| {
                        if !data.is_empty() {
                            first_ready.store(true, Ordering::Relaxed);
                        }
                        let f32_data: Vec<f32> = data
                            .iter()
                            .map(|&sample| sample as f32 / i32::MAX as f32)
                            .collect();
                        push_audio_chunk(&shared, &f32_data, channels, max_samples);
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("Failed to open I32 microphone stream: {e}"))?
        }
        cpal::SampleFormat::I8 => {
            let shared = shared_buffer.clone();
            let first_ready = first_callback_received.clone();
            device
                .build_input_stream(
                    &stream_config,
                    move |data: &[i8], _: &cpal::InputCallbackInfo| {
                        if !data.is_empty() {
                            first_ready.store(true, Ordering::Relaxed);
                        }
                        let f32_data: Vec<f32> = data
                            .iter()
                            .map(|&sample| sample as f32 / i8::MAX as f32)
                            .collect();
                        push_audio_chunk(&shared, &f32_data, channels, max_samples);
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("Failed to open I8 microphone stream: {e}"))?
        }
        other => {
            return Err(format!("Unsupported microphone sample format: {other:?}"));
        }
    };

    stream
        .play()
        .map_err(|e| format!("Failed to start microphone stream: {e}"))?;

    // Avoid showing "Listening" before the first audio callback arrives.
    let warmup_deadline =
        Instant::now() + Duration::from_millis(DICTATION_CAPTURE_WARMUP_TIMEOUT_MS);
    while !first_callback_received.load(Ordering::Relaxed) && Instant::now() < warmup_deadline {
        std::thread::sleep(Duration::from_millis(10));
    }

    *guard = Some(DictationRecorder {
        stream,
        sample_rate,
        buffer: shared_buffer,
    });

    Ok(())
}

fn abort_microphone_capture() -> Result<(), String> {
    let mut guard = ACTIVE_RECORDER
        .lock()
        .map_err(|e| format!("Failed to lock recorder state: {e}"))?;

    if let Some(recorder) = guard.take() {
        drop(recorder.stream);
    }

    Ok(())
}

fn stop_microphone_capture() -> Result<CapturedAudio, String> {
    let mut guard = ACTIVE_RECORDER
        .lock()
        .map_err(|e| format!("Failed to lock recorder state: {e}"))?;

    let recorder = guard
        .take()
        .ok_or_else(|| "No active dictation recording found".to_string())?;

    // Explicitly drop stream before reading data.
    drop(recorder.stream);

    let samples = recorder
        .buffer
        .lock()
        .map_err(|e| format!("Failed to read captured samples: {e}"))?
        .clone();

    Ok(CapturedAudio {
        sample_rate: recorder.sample_rate,
        samples,
    })
}

fn normalize_and_extract_speech(captured: CapturedAudio) -> Vec<f32> {
    let audio_16k = if captured.sample_rate != 16_000 {
        resample_audio(&captured.samples, captured.sample_rate, 16_000)
    } else {
        captured.samples
    };

    // For push-to-talk dictation, preserve the full utterance to avoid clipping
    // leading words. VAD is used only to detect true no-speech input.
    match extract_speech_16k(&audio_16k) {
        Ok(speech) if speech.is_empty() => Vec::new(),
        _ => audio_16k,
    }
}

fn clean_qwen_asr_output(text: &str) -> String {
    static LANGUAGE_PREFIX_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(concat!(
            r"(?im)^\s*language\s+(?:",
            r"English|Chinese|Japanese|Korean|French|German|Spanish|",
            r"Portuguese|Russian|Italian|Dutch|Turkish|Arabic|Polish|",
            r"Swedish|Norwegian|Danish|Finnish|Hungarian|Czech|Romanian|",
            r"Bulgarian|Greek|Serbian|Croatian|Slovak|Slovenian|",
            r"Ukrainian|Catalan|Vietnamese|Thai|Indonesian|Malay|",
            r"Hindi|Tamil|Telugu|Bengali|Urdu|Persian|Hebrew|",
            r"Cantonese|Yue|None|null",
            r")[:：]?\s*"
        ))
        .expect("valid regex")
    });
    static LANGUAGE_SENTENCE_PREFIX_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(concat!(
            r"(?i)([。！？.!?]\s*)language\s+(?:",
            r"English|Chinese|Japanese|Korean|French|German|Spanish|",
            r"Portuguese|Russian|Italian|Dutch|Turkish|Arabic|Polish|",
            r"Swedish|Norwegian|Danish|Finnish|Hungarian|Czech|Romanian|",
            r"Bulgarian|Greek|Serbian|Croatian|Slovak|Slovenian|",
            r"Ukrainian|Catalan|Vietnamese|Thai|Indonesian|Malay|",
            r"Hindi|Tamil|Telugu|Bengali|Urdu|Persian|Hebrew|",
            r"Cantonese|Yue|None|null",
            r")[:：]?\s*"
        ))
        .expect("valid regex")
    });
    static MULTISPACE_RE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"[ \t]{2,}").expect("valid regex"));

    let mut cleaned = text.trim().to_string();
    if cleaned.is_empty() {
        return cleaned;
    }

    cleaned = LANGUAGE_PREFIX_RE.replace_all(&cleaned, "").into_owned();
    loop {
        let next = LANGUAGE_SENTENCE_PREFIX_RE
            .replace_all(&cleaned, "$1")
            .into_owned();
        if next == cleaned {
            break;
        }
        cleaned = next;
    }
    cleaned = MULTISPACE_RE.replace_all(&cleaned, " ").into_owned();
    cleaned.trim().to_string()
}

fn normalize_transcript(provider: &str, text: &str) -> String {
    let normalized = if provider == "qwenAsr" {
        clean_qwen_asr_output(text)
    } else {
        text.to_string()
    };
    normalized.trim().to_string()
}

async fn transcribe_audio<R: Runtime>(app: &AppHandle<R>, samples_16k: Vec<f32>) -> Result<String, String> {
    crate::audio::transcription::engine::validate_transcription_model_ready(app).await?;

    let transcript_config = crate::api::api::api_get_transcript_config(app.clone(), app.state(), None)
        .await
        .ok()
        .flatten();

    let provider = transcript_config
        .as_ref()
        .map(|cfg| cfg.provider.as_str())
        .unwrap_or("parakeet");

    let result = match provider {
        "localWhisper" => crate::whisper_engine::commands::whisper_transcribe_audio(samples_16k.clone()).await,
        "qwenAsr" => crate::qwen_asr_engine::commands::qwen_asr_transcribe_audio(samples_16k.clone()).await,
        "parakeet" => crate::parakeet_engine::commands::parakeet_transcribe_audio(samples_16k.clone()).await,
        _ => crate::parakeet_engine::commands::parakeet_transcribe_audio(samples_16k.clone()).await,
    };

    match result {
        Ok(text) => {
            let cleaned = normalize_transcript(provider, &text);
            if !cleaned.is_empty() {
                return Ok(cleaned);
            }
            Err("Transcription returned empty text".to_string())
        }
        Err(primary_err) => {
            // Fallback sequence for robustness
            let fallback_qwen = crate::qwen_asr_engine::commands::qwen_asr_transcribe_audio(samples_16k.clone()).await;
            if let Ok(text) = fallback_qwen {
                let cleaned = normalize_transcript("qwenAsr", &text);
                if !cleaned.is_empty() {
                    return Ok(cleaned);
                }
            }

            let fallback_whisper = crate::whisper_engine::commands::whisper_transcribe_audio(samples_16k.clone()).await;
            if let Ok(text) = fallback_whisper {
                let cleaned = normalize_transcript("localWhisper", &text);
                if !cleaned.is_empty() {
                    return Ok(cleaned);
                }
            }

            Err(format!("Transcription failed: {primary_err}"))
        }
    }
}

#[cfg(target_os = "macos")]
fn read_clipboard_text() -> Option<String> {
    let output = Command::new("pbpaste")
        .env("LANG", "en_US.UTF-8")
        .env("LC_CTYPE", "UTF-8")
        .env("LC_ALL", "en_US.UTF-8")
        .output()
        .ok()?;
    Some(String::from_utf8_lossy(&output.stdout).to_string())
}

#[cfg(target_os = "macos")]
fn write_clipboard_text(text: &str) -> Result<(), String> {
    let mut child = Command::new("pbcopy")
        .env("LANG", "en_US.UTF-8")
        .env("LC_CTYPE", "UTF-8")
        .env("LC_ALL", "en_US.UTF-8")
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start pbcopy: {e}"))?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(text.as_bytes())
            .map_err(|e| format!("Failed writing to pbcopy stdin: {e}"))?;
    }

    let status = child
        .wait()
        .map_err(|e| format!("Failed waiting for pbcopy: {e}"))?;

    if status.success() {
        Ok(())
    } else {
        Err("pbcopy failed".to_string())
    }
}

#[cfg(target_os = "macos")]
fn paste_with_apple_script() -> Result<(), String> {
    let status = Command::new("osascript")
        .arg("-e")
        .arg(r#"tell application "System Events" to keystroke "v" using command down"#)
        .status()
        .map_err(|e| format!("Failed to run osascript for paste: {e}"))?;

    if status.success() {
        Ok(())
    } else {
        Err("osascript paste command failed. Grant Accessibility permission to Ultra Meet.".to_string())
    }
}

#[cfg(target_os = "macos")]
fn paste_via_temporary_clipboard(text: &str) -> Result<(), String> {
    let previous = read_clipboard_text();
    write_clipboard_text(text)?;
    paste_with_apple_script()?;

    if let Some(prev_text) = previous {
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(450)).await;
            let _ = write_clipboard_text(&prev_text);
        });
    }

    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn paste_via_temporary_clipboard(_text: &str) -> Result<(), String> {
    Err("Auto-paste currently supports macOS only".to_string())
}

async fn finish_dictation<R: Runtime>(app: AppHandle<R>, captured: CapturedAudio) {
    let process_result = async {
        if captured.samples.len() < (captured.sample_rate as usize / 5) {
            return Err("Audio too short, please hold the hotkey longer".to_string());
        }

        let speech = normalize_and_extract_speech(captured);
        if speech.len() < 2_400 {
            return Err("No clear speech detected".to_string());
        }

        let text = transcribe_audio(&app, speech).await?;

        if let Ok(mut last) = LAST_TRANSCRIPT.lock() {
            *last = Some(text.clone());
        }

        match paste_via_temporary_clipboard(&text) {
            Ok(_) => {
                emit_widget_state(&app, "success", "Transcribed and pasted", Some(text.clone()));
            }
            Err(e) => {
                emit_widget_state(
                    &app,
                    "success",
                    &format!("Transcribed (paste failed: {e})"),
                    Some(text.clone()),
                );
            }
        }

        Ok::<(), String>(())
    }
    .await;

    if let Err(e) = process_result {
        emit_widget_state(&app, "error", &e, None);
    }

    DICTATION_PROCESSING.store(false, Ordering::SeqCst);
    hide_widget_after_delay(app, 2000);
}

pub async fn start_dictation<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if DICTATION_PROCESSING.load(Ordering::SeqCst) {
        return Err("Still processing previous dictation".to_string());
    }

    if DICTATION_ACTIVE.swap(true, Ordering::SeqCst) {
        return Ok(());
    }

    DICTATION_PREWARMING.store(false, Ordering::SeqCst);

    match start_microphone_capture() {
        Ok(_) => {
            ensure_widget_window(&app);
            emit_widget_state(&app, "recording", "Listening... release hotkey to transcribe", None);
            Ok(())
        }
        Err(e) => {
            DICTATION_ACTIVE.store(false, Ordering::SeqCst);
            ensure_widget_window(&app);
            emit_widget_state(&app, "error", &e, None);
            hide_widget_after_delay(app, 1800);
            Err(e)
        }
    }
}

pub async fn stop_dictation<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if !DICTATION_ACTIVE.swap(false, Ordering::SeqCst) {
        return Ok(());
    }

    DICTATION_PROCESSING.store(true, Ordering::SeqCst);
    DICTATION_PREWARMING.store(false, Ordering::SeqCst);
    emit_widget_state(&app, "processing", "Transcribing...", None);

    let captured = stop_microphone_capture()?;
    tauri::async_runtime::spawn(finish_dictation(app, captured));

    Ok(())
}

fn maybe_start_dictation_prewarm() {
    if DICTATION_ACTIVE.load(Ordering::SeqCst) || DICTATION_PROCESSING.load(Ordering::SeqCst) {
        return;
    }

    if DICTATION_PREWARMING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }

    tauri::async_runtime::spawn(async move {
        if let Err(err) = start_microphone_capture() {
            log::debug!("Dictation prewarm microphone start failed: {}", err);
            DICTATION_PREWARMING.store(false, Ordering::SeqCst);
        }
    });
}

fn maybe_cancel_dictation_prewarm() {
    if !DICTATION_PREWARMING.load(Ordering::SeqCst) || DICTATION_ACTIVE.load(Ordering::SeqCst) {
        return;
    }

    DICTATION_PREWARMING.store(false, Ordering::SeqCst);
    if let Err(err) = abort_microphone_capture() {
        log::debug!("Dictation prewarm microphone abort failed: {}", err);
    }
}

#[tauri::command]
pub async fn dictation_start_manual<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    start_dictation(app).await
}

#[tauri::command]
pub async fn dictation_stop_manual<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    stop_dictation(app).await
}

#[tauri::command]
pub async fn dictation_get_last_transcript() -> Result<Option<String>, String> {
    LAST_TRANSCRIPT
        .lock()
        .map(|v| v.clone())
        .map_err(|e| format!("Failed to read last transcript: {e}"))
}

#[tauri::command]
pub async fn dictation_paste_last_transcript() -> Result<(), String> {
    let text = LAST_TRANSCRIPT
        .lock()
        .map_err(|e| format!("Failed to lock last transcript: {e}"))?
        .clone()
        .ok_or_else(|| "No previous dictation text available".to_string())?;

    paste_via_temporary_clipboard(&text)
}

#[tauri::command]
pub async fn dictation_get_hotkey() -> Result<String, String> {
    HOTKEY_CONFIG
        .lock()
        .map(|cfg| cfg.display.clone())
        .map_err(|e| format!("Failed to read dictation hotkey: {e}"))
}

#[tauri::command]
pub async fn dictation_get_debug_state() -> Result<DictationDebugSnapshot, String> {
    let cfg = HOTKEY_CONFIG
        .lock()
        .map_err(|e| format!("Failed to lock hotkey config: {e}"))?
        .clone();

    let debug = DICTATION_DEBUG_STATE
        .lock()
        .map_err(|e| format!("Failed to lock debug state: {e}"))?
        .clone();

    Ok(DictationDebugSnapshot {
        listener_running: debug.listener_running,
        listener_mode: debug.listener_mode,
        listener_last_error: debug.listener_last_error,
        listener_started_at_ms: debug.listener_started_at_ms,
        event_count: debug.event_count,
        accessibility_granted: check_accessibility_permission(),
        input_monitoring_granted: check_input_monitoring_permission(),
        current_hotkey: cfg.display,
        current_keycode: cfg.key_code,
        require_fn: cfg.require_fn,
        require_control: cfg.require_control,
        require_command: cfg.require_command,
        require_option: cfg.require_option,
        require_shift: cfg.require_shift,
        dictation_active: DICTATION_ACTIVE.load(Ordering::SeqCst),
        dictation_processing: DICTATION_PROCESSING.load(Ordering::SeqCst),
        hotkey_held: HOTKEY_HELD.load(Ordering::SeqCst),
        fn_held: FN_HELD.load(Ordering::SeqCst),
        cmd_held: CMD_HELD.load(Ordering::SeqCst),
        ctrl_held: CTRL_HELD.load(Ordering::SeqCst),
        alt_held: ALT_HELD.load(Ordering::SeqCst),
        shift_held: SHIFT_HELD.load(Ordering::SeqCst),
        events: debug.events,
    })
}

#[tauri::command]
pub async fn dictation_clear_debug_events() -> Result<(), String> {
    let mut debug = DICTATION_DEBUG_STATE
        .lock()
        .map_err(|e| format!("Failed to lock debug state: {e}"))?;
    debug.events.clear();
    debug.event_count = 0;
    Ok(())
}

/// Restart the global hotkey listener. Useful after granting Accessibility permission
/// so the app can re-create the event tap in Filter mode.
#[tauri::command]
pub async fn dictation_restart_listener<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    stop_global_hotkey_listener();
    start_global_hotkey_listener(&app)?;

    let debug = DICTATION_DEBUG_STATE
        .lock()
        .map_err(|e| format!("Failed to lock debug state: {e}"))?
        .clone();

    Ok(debug.listener_mode)
}

/// Check current accessibility permission status.
#[tauri::command]
pub async fn dictation_check_accessibility() -> Result<bool, String> {
    Ok(check_accessibility_permission())
}

/// Check current Input Monitoring permission status.
#[tauri::command]
pub async fn dictation_check_input_monitoring() -> Result<bool, String> {
    Ok(check_input_monitoring_permission())
}

/// Prompt the user to grant Accessibility permission (macOS only).
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn dictation_request_accessibility() -> Result<bool, String> {
    Ok(request_accessibility_permission_internal())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn dictation_request_accessibility() -> Result<bool, String> {
    Err("Accessibility permission is only applicable on macOS".to_string())
}

/// Prompt the user to grant Input Monitoring permission (macOS only).
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn dictation_request_input_monitoring() -> Result<bool, String> {
    Ok(request_input_monitoring_permission_internal())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn dictation_request_input_monitoring() -> Result<bool, String> {
    Err("Input Monitoring permission is only applicable on macOS".to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetHotkeyResponse {
    pub hotkey: String,
}

fn parse_keycode(key: &str) -> Option<u16> {
    match key {
        "a" => Some(KEY_A),
        "b" => Some(KEY_B),
        "c" => Some(KEY_C),
        "d" => Some(KEY_D),
        "e" => Some(KEY_E),
        "f" => Some(KEY_F),
        "g" => Some(KEY_G),
        "h" => Some(KEY_H),
        "i" => Some(KEY_I),
        "j" => Some(KEY_J),
        "k" => Some(KEY_K),
        "l" => Some(KEY_L),
        "m" => Some(KEY_M),
        "n" => Some(KEY_N),
        "o" => Some(KEY_O),
        "p" => Some(KEY_P),
        "q" => Some(KEY_Q),
        "r" => Some(KEY_R),
        "s" => Some(KEY_S),
        "t" => Some(KEY_T),
        "u" => Some(KEY_U),
        "v" => Some(KEY_V),
        "w" => Some(KEY_W),
        "x" => Some(KEY_X),
        "y" => Some(KEY_Y),
        "z" => Some(KEY_Z),
        "0" => Some(KEY_0),
        "1" => Some(KEY_1),
        "2" => Some(KEY_2),
        "3" => Some(KEY_3),
        "4" => Some(KEY_4),
        "5" => Some(KEY_5),
        "6" => Some(KEY_6),
        "7" => Some(KEY_7),
        "8" => Some(KEY_8),
        "9" => Some(KEY_9),
        "space" => Some(KEY_SPACE),
        "enter" | "return" => Some(KEY_RETURN),
        "tab" => Some(KEY_TAB),
        "esc" | "escape" => Some(KEY_ESCAPE),
        "f1" => Some(KEY_F1),
        "f2" => Some(KEY_F2),
        "f3" => Some(KEY_F3),
        "f4" => Some(KEY_F4),
        "f5" => Some(KEY_F5),
        "f6" => Some(KEY_F6),
        "f7" => Some(KEY_F7),
        "f8" => Some(KEY_F8),
        "f9" => Some(KEY_F9),
        "f10" => Some(KEY_F10),
        "f11" => Some(KEY_F11),
        "f12" => Some(KEY_F12),
        "f13" => Some(KEY_F13),
        "f14" => Some(KEY_F14),
        "f15" => Some(KEY_F15),
        "f16" => Some(KEY_F16),
        "f17" => Some(KEY_F17),
        "f18" => Some(KEY_F18),
        "f19" => Some(KEY_F19),
        "f20" => Some(KEY_F20),
        _ => None,
    }
}

fn parse_hotkey(input: &str) -> Result<DictationHotkeyConfig, String> {
    let tokens: Vec<String> = input
        .split('+')
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .collect();

    if tokens.is_empty() {
        return Err("Hotkey cannot be empty".to_string());
    }

    let mut require_fn = false;
    let mut require_control = false;
    let mut require_command = false;
    let mut require_option = false;
    let mut require_shift = false;
    let mut key_code: Option<u16> = None;

    for token in &tokens {
        match token.as_str() {
            "fn" | "function" => require_fn = true,
            "ctrl" | "control" => require_control = true,
            "cmd" | "command" | "meta" => require_command = true,
            "opt" | "option" | "alt" => require_option = true,
            "shift" => require_shift = true,
            key => {
                if key_code.is_some() {
                    return Err("Only one non-modifier key is supported".to_string());
                }
                key_code = parse_keycode(key);
                if key_code.is_none() {
                    return Err(format!("Unsupported key: {key}"));
                }
            }
        }
    }

    let key_code = key_code.ok_or_else(|| "Hotkey must include a key (e.g. space, f1)".to_string())?;

    if !require_fn && !require_control && !require_command && !require_option && !require_shift {
        return Err("At least one modifier is required".to_string());
    }

    Ok(DictationHotkeyConfig {
        key_code,
        require_fn,
        require_control,
        require_command,
        require_option,
        require_shift,
        display: input.trim().to_string(),
    })
}

#[tauri::command]
pub async fn dictation_set_hotkey(hotkey: String) -> Result<SetHotkeyResponse, String> {
    let parsed = parse_hotkey(&hotkey)?;

    let mut cfg = HOTKEY_CONFIG
        .lock()
        .map_err(|e| format!("Failed to lock hotkey config: {e}"))?;
    *cfg = parsed.clone();
    sync_hotkey_atoms(&parsed);

    Ok(SetHotkeyResponse {
        hotkey: hotkey.trim().to_string(),
    })
}

#[cfg(target_os = "macos")]
fn handle_hotkey_event<R: Runtime>(app: &AppHandle<R>, event_type: CGEventType, keycode: u16, flags: CGEventFlags, autorepeat: bool) {
    let cfg = hotkey_config_from_atoms();

    if matches!(event_type, CGEventType::FlagsChanged) && !HOTKEY_HELD.load(Ordering::SeqCst) {
        if modifiers_match(flags, &cfg) {
            maybe_start_dictation_prewarm();
        } else {
            maybe_cancel_dictation_prewarm();
        }
    }

    // KeyUp should only check key code and held state.
    if matches!(event_type, CGEventType::KeyUp) && keycode == cfg.key_code {
        if HOTKEY_HELD.swap(false, Ordering::SeqCst) {
            let app_clone = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = stop_dictation(app_clone).await;
            });
        }
        return;
    }

    // If fn was released before key-up, stop early.
    if matches!(event_type, CGEventType::FlagsChanged)
        && cfg.require_fn
        && HOTKEY_HELD.load(Ordering::SeqCst)
    {
        let fn_active =
            flags.contains(CGEventFlags::CGEventFlagSecondaryFn) || FN_HELD.load(Ordering::SeqCst);
        if !fn_active {
            if HOTKEY_HELD.swap(false, Ordering::SeqCst) {
                let app_clone = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = stop_dictation(app_clone).await;
                });
            }
        }
        return;
    }

    if !matches!(event_type, CGEventType::KeyDown) {
        return;
    }

    if keycode != cfg.key_code || autorepeat {
        return;
    }

    if !modifiers_match(flags, &cfg) {
        return;
    }

    if HOTKEY_HELD.swap(true, Ordering::SeqCst) {
        return;
    }

    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = start_dictation(app_clone).await;
    });
}

#[cfg(target_os = "macos")]
fn should_consume_hotkey_key_event(
    event_type: CGEventType,
    keycode: u16,
    flags: CGEventFlags,
    cfg: &DictationHotkeyConfig,
) -> bool {
    if keycode != cfg.key_code {
        return false;
    }

    if !matches!(event_type, CGEventType::KeyDown | CGEventType::KeyUp) {
        return false;
    }

    // Consume if current modifiers match, or if we are already in held state
    // (covers key-up after modifier transitions).
    modifiers_match(flags, cfg) || HOTKEY_HELD.load(Ordering::SeqCst)
}

#[cfg(target_os = "macos")]
fn make_consumed_event_from_original(original: &CGEvent) -> CGEvent {
    let consumed = original.clone();
    consumed.set_type(CGEventType::Null);
    consumed
}

#[cfg(target_os = "macos")]
pub fn start_global_hotkey_listener<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let mut guard = HOTKEY_LISTENER
        .lock()
        .map_err(|e| format!("Failed to lock hotkey listener state: {e}"))?;

    if guard.is_some() {
        set_listener_debug_state(true, "already-running", None);
        return Ok(());
    }

    set_listener_debug_state(false, "starting", None);
    maybe_prompt_missing_dictation_permissions(app);

    let app_handle = app.clone();
    let (tx, rx) =
        std::sync::mpsc::channel::<Result<(CFRunLoop, EventTapMode, &'static str), String>>();

    let thread_handle = std::thread::spawn(move || {
        let run_loop = CFRunLoop::get_current();
        FN_HELD.store(false, Ordering::SeqCst);
        CMD_HELD.store(false, Ordering::SeqCst);
        CTRL_HELD.store(false, Ordering::SeqCst);
        ALT_HELD.store(false, Ordering::SeqCst);
        SHIFT_HELD.store(false, Ordering::SeqCst);

        // Check macOS accessibility permission status
        let has_post_access = check_accessibility_permission();
        let has_listen_access = check_input_monitoring_permission();
        log::info!(
            "Dictation: permissions - accessibility={}, input_monitoring={}",
            has_post_access, has_listen_access
        );

        let mut selected_mode: Option<EventTapMode> = None;
        let mut maybe_tap = None;

        // Priority order: Filter mode first (can consume events), then ListenOnly.
        // Within each mode, try Session first (works better on modern macOS for
        // receiving KeyDown/KeyUp events), then HID.
        // ListenOnly@HID on modern macOS often only delivers FlagsChanged events
        // (no KeyDown/KeyUp), making it useless for hotkey detection.
        let attempts: Vec<(CGEventTapLocation, &'static str, CGEventTapOptions, EventTapMode)> = vec![
            (CGEventTapLocation::Session, "session", CGEventTapOptions::Default, EventTapMode::Filter),
            (CGEventTapLocation::HID, "hid", CGEventTapOptions::Default, EventTapMode::Filter),
            (CGEventTapLocation::Session, "session", CGEventTapOptions::ListenOnly, EventTapMode::ListenOnly),
            (CGEventTapLocation::HID, "hid", CGEventTapOptions::ListenOnly, EventTapMode::ListenOnly),
        ];

        for (location, location_name, opt, mode) in attempts {
            let app_handle_inner = app_handle.clone();
            let mode_inner = mode;
            let tap_result = CGEventTap::new(
                location,
                CGEventTapPlacement::HeadInsertEventTap,
                opt,
                vec![
                    CGEventType::KeyDown,
                    CGEventType::KeyUp,
                    CGEventType::FlagsChanged,
                ],
                move |_proxy, event_type, event| {
                    let keycode =
                        event.get_integer_value_field(EventField::KEYBOARD_EVENT_KEYCODE) as u16;
                    let flags = event.get_flags();
                    let autorepeat =
                        event.get_integer_value_field(EventField::KEYBOARD_EVENT_AUTOREPEAT) != 0;

                    if matches!(event_type, CGEventType::FlagsChanged) && keycode == KEY_FUNCTION {
                        FN_HELD.store(
                            flags.contains(CGEventFlags::CGEventFlagSecondaryFn),
                            Ordering::SeqCst,
                        );
                    }
                    if matches!(event_type, CGEventType::FlagsChanged) {
                        match keycode {
                            KEY_LEFT_COMMAND | KEY_RIGHT_COMMAND => {
                                CMD_HELD.store(
                                    flags.contains(CGEventFlags::CGEventFlagCommand),
                                    Ordering::SeqCst,
                                );
                            }
                            KEY_LEFT_CONTROL | KEY_RIGHT_CONTROL => {
                                CTRL_HELD.store(
                                    flags.contains(CGEventFlags::CGEventFlagControl),
                                    Ordering::SeqCst,
                                );
                            }
                            KEY_LEFT_OPTION | KEY_RIGHT_OPTION => {
                                ALT_HELD.store(
                                    flags.contains(CGEventFlags::CGEventFlagAlternate),
                                    Ordering::SeqCst,
                                );
                            }
                            KEY_LEFT_SHIFT | KEY_RIGHT_SHIFT => {
                                SHIFT_HELD.store(
                                    flags.contains(CGEventFlags::CGEventFlagShift),
                                    Ordering::SeqCst,
                                );
                            }
                            _ => {}
                        }
                    }

                    // Never block in event tap callback. Match logic uses atomics.
                    let cfg = hotkey_config_from_atoms();

                    let held_before = HOTKEY_HELD.load(Ordering::SeqCst);
                    let matches_hotkey =
                        is_keydown_hotkey_match(event_type, keycode, flags, autorepeat, &cfg);

                    handle_hotkey_event(&app_handle_inner, event_type, keycode, flags, autorepeat);

                    let held_after = HOTKEY_HELD.load(Ordering::SeqCst);
                    let consume_candidate = matches!(mode_inner, EventTapMode::Filter)
                        && should_consume_hotkey_key_event(event_type, keycode, flags, &cfg);

                    let modifiers_ok = modifiers_match(flags, &cfg);

                    if should_trace_debug_event(keycode, &cfg) {
                        let action = if !held_before && held_after {
                            "start"
                        } else if held_before && !held_after {
                            "stop"
                        } else {
                            "none"
                        };
                        push_debug_event(DictationDebugEvent {
                            timestamp_ms: now_millis(),
                            event_type: format!("{event_type:?}"),
                            keycode,
                            expected_keycode: cfg.key_code,
                            key: keycode_to_name(keycode),
                            flags: format_flags(flags),
                            autorepeat,
                            matches_hotkey,
                            modifiers_ok,
                            consume_candidate,
                            hotkey_held_before: held_before,
                            hotkey_held_after: held_after,
                            action: action.to_string(),
                        });
                    }

                    if consume_candidate {
                        return Some(make_consumed_event_from_original(event));
                    }
                    None
                },
            );

            match tap_result {
                Ok(tap) => {
                    log::info!(
                        "Dictation: event tap created successfully: {:?}@{} (accessibility={}, input_monitoring={})",
                        mode, location_name, has_post_access, has_listen_access
                    );
                    selected_mode = Some(mode);
                    maybe_tap = Some((tap, location_name));
                    break;
                }
                Err(_) => {
                    log::info!(
                        "Dictation: event tap {:?}@{} failed (accessibility={}, input_monitoring={})",
                        mode, location_name, has_post_access, has_listen_access
                    );
                }
            }
        }

        let (tap, location_name) = match maybe_tap {
            Some(tap_with_location) => tap_with_location,
            None => {
                let _ = tx.send(Err("Failed to create macOS global event tap. Grant Input Monitoring and Accessibility permissions to Ultra Meet.".to_string()));
                return;
            }
        };

        let source = match tap.mach_port.create_runloop_source(0) {
            Ok(src) => src,
            Err(_) => {
                let _ = tx.send(Err("Failed to create runloop source for hotkey listener".to_string()));
                return;
            }
        };

        unsafe {
            run_loop.add_source(&source, kCFRunLoopCommonModes);
        }

        tap.enable();

        // macOS auto-disables Filter event taps if the callback takes too long.
        // Add a periodic timer that re-enables the tap to recover from this.
        let mach_port_raw = tap.mach_port.as_concrete_TypeRef();

        extern "C" fn reenable_tap_callback(
            _timer: core_foundation::runloop::CFRunLoopTimerRef,
            info: *mut std::ffi::c_void,
        ) {
            extern "C" {
                fn CGEventTapIsEnabled(tap: core_foundation::base::CFTypeRef) -> bool;
                fn CGEventTapEnable(tap: core_foundation::base::CFTypeRef, enable: bool);
            }
            let port = info as core_foundation::base::CFTypeRef;
            unsafe {
                if !CGEventTapIsEnabled(port) {
                    log::warn!("Dictation: event tap was auto-disabled by macOS, re-enabling...");
                    CGEventTapEnable(port, true);
                }
            }
        }

        let timer = CFRunLoopTimer::new(
            // fire_date: now + 5s
            unsafe { core_foundation::date::CFAbsoluteTimeGetCurrent() + 5.0 },
            // interval: every 2 seconds
            2.0,
            // flags
            0,
            // order
            0,
            reenable_tap_callback,
            // context: pass mach port as raw pointer
            &mut core_foundation::runloop::CFRunLoopTimerContext {
                version: 0,
                info: mach_port_raw as *mut std::ffi::c_void,
                retain: None,
                release: None,
                copyDescription: None,
            },
        );
        unsafe {
            run_loop.add_timer(&timer, kCFRunLoopCommonModes);
        }

        let _ = tx.send(Ok((
            run_loop.clone(),
            selected_mode.unwrap_or(EventTapMode::ListenOnly),
            location_name,
        )));
        CFRunLoop::run_current();
    });

    let (run_loop, mode, location_name) = match rx.recv_timeout(Duration::from_secs(2)) {
        Ok(Ok(result)) => result,
        Ok(Err(e)) => {
            set_listener_debug_state(false, "failed", Some(e.clone()));
            return Err(e);
        }
        Err(_) => {
            let timeout = "Timed out while starting global hotkey listener".to_string();
            set_listener_debug_state(false, "timeout", Some(timeout.clone()));
            return Err(timeout);
        }
    };

    let has_input_monitoring = check_input_monitoring_permission();

    if matches!(mode, EventTapMode::ListenOnly) {
        log::warn!(
            "Dictation hotkey listener running in ListenOnly mode (location: {}). \
             Hotkey events CANNOT be consumed and will pass through to the active app. \
             Grant Accessibility permission to Ultra Meet in System Settings > \
             Privacy & Security > Accessibility to enable key consumption.",
            location_name
        );
        set_listener_debug_state(
            true,
            &format!("{mode:?}@{location_name}"),
            Some("ListenOnly mode: hotkey key-presses will leak to active app. Grant Accessibility permission.".to_string()),
        );
    } else if !has_input_monitoring {
        log::warn!(
            "Dictation hotkey listener running without Input Monitoring permission. \
             KeyDown/KeyUp may be missing, causing hotkeys to not trigger."
        );
        set_listener_debug_state(
            true,
            &format!("{mode:?}@{location_name}"),
            Some("Input Monitoring not granted: KeyDown/KeyUp may be missing. Grant Input Monitoring and restart listener.".to_string()),
        );
    } else {
        log::info!(
            "Dictation hotkey listener started with mode: {:?}, location: {}",
            mode,
            location_name
        );
        set_listener_debug_state(true, &format!("{mode:?}@{location_name}"), None);
    }

    *guard = Some(HotkeyListenerState {
        run_loop,
        thread_handle,
    });

    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn start_global_hotkey_listener<R: Runtime>(_app: &AppHandle<R>) -> Result<(), String> {
    set_listener_debug_state(false, "unsupported-platform", Some("Global dictation hotkey currently supports macOS only".to_string()));
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn stop_global_hotkey_listener() {
    if let Ok(mut guard) = HOTKEY_LISTENER.lock() {
        if let Some(state) = guard.take() {
            HOTKEY_HELD.store(false, Ordering::SeqCst);
            FN_HELD.store(false, Ordering::SeqCst);
            CMD_HELD.store(false, Ordering::SeqCst);
            CTRL_HELD.store(false, Ordering::SeqCst);
            ALT_HELD.store(false, Ordering::SeqCst);
            SHIFT_HELD.store(false, Ordering::SeqCst);
            state.run_loop.stop();
            let _ = state.thread_handle.join();
        }
    }
    set_listener_debug_state(false, "stopped", None);
}

#[cfg(not(target_os = "macos"))]
pub fn stop_global_hotkey_listener() {
    set_listener_debug_state(false, "stopped", None);
}
