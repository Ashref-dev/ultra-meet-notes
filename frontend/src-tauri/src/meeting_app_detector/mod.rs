use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

const MEETING_APP_DETECTION_EVENT: &str = "meeting-app-detected";
const POLL_INTERVAL: Duration = Duration::from_secs(5);
const DEDUP_WINDOW: Duration = Duration::from_secs(60);

pub const MEETING_BUNDLE_IDS: &[(&str, &str)] = &[
    ("us.zoom.xos", "Zoom"),
    ("us.zoom.ringcentral", "Zoom"),
    ("com.microsoft.teams2", "Microsoft Teams"),
    ("com.microsoft.teams", "Microsoft Teams"),
    ("com.tinyspeck.slackmacgap", "Slack"),
    ("com.hnc.Discord", "Discord"),
    ("com.cisco.webexmeetingsapp", "Cisco Webex"),
    ("com.bluejeans.App", "BlueJeans"),
    ("com.gotomeeting.GoToMeeting", "GoToMeeting"),
    ("com.ringcentral.RingCentralVideo", "RingCentral"),
    ("com.google.Chrome", "Google Chrome"),
    ("com.microsoft.edgemac", "Microsoft Edge"),
    ("com.apple.Safari", "Safari"),
    ("company.thebrowser.Browser", "Arc"),
    ("com.brave.Browser", "Brave"),
    ("org.mozilla.firefox", "Firefox"),
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingAppDetectedPayload {
    pub app_name: String,
    pub bundle_id: String,
    pub detected_at: String,
}

#[derive(Default)]
pub struct MeetingAppDetectorState {
    detector: Mutex<MeetingAppDetector>,
}

impl MeetingAppDetectorState {
    pub fn start<R: Runtime>(&self, app_handle: AppHandle<R>) -> Result<(), String> {
        let mut detector = self
            .detector
            .lock()
            .map_err(|_| "Meeting app detector state lock poisoned".to_string())?;
        detector.start(app_handle)
    }

    pub fn stop(&self) -> Result<(), String> {
        let mut detector = self
            .detector
            .lock()
            .map_err(|_| "Meeting app detector state lock poisoned".to_string())?;
        detector.stop();
        Ok(())
    }
}

#[derive(Default)]
pub struct MeetingAppDetector {
    #[cfg(target_os = "macos")]
    platform: MacOsMeetingAppDetector,
}

impl MeetingAppDetector {
    pub fn start<R: Runtime>(&mut self, app_handle: AppHandle<R>) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            return self.platform.start(app_handle);
        }

        #[cfg(not(target_os = "macos"))]
        {
            let _ = app_handle;
            Ok(())
        }
    }

    pub fn stop(&mut self) {
        #[cfg(target_os = "macos")]
        self.platform.stop();
    }
}

fn meeting_app_name_for_bundle_id(bundle_id: &str) -> Option<&'static str> {
    MEETING_BUNDLE_IDS
        .iter()
        .find_map(|(known_bundle_id, app_name)| (*known_bundle_id == bundle_id).then_some(*app_name))
}

fn build_payload(app_name: String, bundle_id: String) -> MeetingAppDetectedPayload {
    MeetingAppDetectedPayload {
        app_name,
        bundle_id,
        detected_at: chrono::Utc::now().to_rfc3339(),
    }
}

fn should_emit_detection(
    dedup_map: &Arc<Mutex<HashMap<String, Instant>>>,
    bundle_id: &str,
) -> Result<bool, String> {
    let mut guard = dedup_map
        .lock()
        .map_err(|_| "Meeting app dedup map lock poisoned".to_string())?;
    let now = Instant::now();

    guard.retain(|_, detected_at| now.duration_since(*detected_at) < DEDUP_WINDOW);

    if let Some(last_detected_at) = guard.get(bundle_id) {
        if now.duration_since(*last_detected_at) < DEDUP_WINDOW {
            return Ok(false);
        }
    }

    guard.insert(bundle_id.to_string(), now);
    Ok(true)
}

fn emit_detection_event<R: Runtime>(
    app_handle: &AppHandle<R>,
    dedup_map: &Arc<Mutex<HashMap<String, Instant>>>,
    app_name: String,
    bundle_id: String,
) {
    match should_emit_detection(dedup_map, &bundle_id) {
        Ok(false) => {}
        Ok(true) => {
            let payload = build_payload(app_name.clone(), bundle_id.clone());
            if let Err(error) = app_handle.emit(MEETING_APP_DETECTION_EVENT, payload) {
                tracing::error!(
                    bundle_id = %bundle_id,
                    app_name = %app_name,
                    ?error,
                    "Failed to emit meeting app detection event"
                );
            } else {
                tracing::info!(bundle_id = %bundle_id, app_name = %app_name, "Meeting app detected");
            }
        }
        Err(error) => {
            tracing::error!(bundle_id = %bundle_id, app_name = %app_name, %error, "Failed to update meeting app dedup state");
        }
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use std::collections::{HashMap, HashSet};

    use super::{emit_detection_event, meeting_app_name_for_bundle_id, Instant, Arc, Mutex, POLL_INTERVAL};
    use std::ptr::NonNull;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, NSObjectProtocol, ProtocolObject};
    use objc2_app_kit::{
        NSRunningApplication, NSWorkspace, NSWorkspaceApplicationKey,
        NSWorkspaceDidLaunchApplicationNotification,
    };
    use objc2_foundation::{NSNotification, NSNotificationCenter};
    use tauri::{AppHandle, Runtime};

    pub struct MacOsMeetingAppDetector {
        notification_center: Option<Retained<NSNotificationCenter>>,
        observer_token: Option<Retained<ProtocolObject<dyn NSObjectProtocol>>>,
        observer_block: Option<RcBlock<dyn Fn(NonNull<NSNotification>)>>,
        poll_task: Option<tokio::task::JoinHandle<()>>,
        running_snapshot: Arc<Mutex<HashSet<String>>>,
        dedup_map: Arc<Mutex<HashMap<String, Instant>>>,
    }

    impl Default for MacOsMeetingAppDetector {
        fn default() -> Self {
            Self {
                notification_center: None,
                observer_token: None,
                observer_block: None,
                poll_task: None,
                running_snapshot: Arc::new(Mutex::new(HashSet::new())),
                dedup_map: Arc::new(Mutex::new(HashMap::new())),
            }
        }
    }

    // SAFETY: Access to the detector is serialized through a Mutex in managed state.
    // The observer block only captures Send + Sync data, and the Objective-C
    // types used here are treated as opaque handles that are only created,
    // removed, and dropped through synchronized detector lifecycle methods.
    unsafe impl Send for MacOsMeetingAppDetector {}

    impl MacOsMeetingAppDetector {
        pub fn start<R: Runtime>(&mut self, app_handle: AppHandle<R>) -> Result<(), String> {
            if self.observer_token.is_some() || self.poll_task.is_some() {
                tracing::debug!("Meeting app detector already running");
                return Ok(());
            }

            let initial_snapshot = current_running_whitelisted_apps();
            {
                let mut snapshot_guard = self
                    .running_snapshot
                    .lock()
                    .map_err(|_| "Meeting app snapshot lock poisoned".to_string())?;
                *snapshot_guard = initial_snapshot.keys().cloned().collect();
            }

            let workspace = NSWorkspace::sharedWorkspace();
            let notification_center = workspace.notificationCenter();
            let dedup_map = Arc::clone(&self.dedup_map);
            let observer_app_handle = app_handle.clone();
            let observer_block: RcBlock<dyn Fn(NonNull<NSNotification>)> = RcBlock::new(move |notification_ptr: NonNull<NSNotification>| {
                let notification = unsafe { notification_ptr.as_ref() };

                if let Some((bundle_id, app_name)) = launched_app_from_notification(notification) {
                    emit_detection_event(&observer_app_handle, &dedup_map, app_name, bundle_id);
                }
            });

            let observer_token = unsafe {
                notification_center.addObserverForName_object_queue_usingBlock(
                    Some(NSWorkspaceDidLaunchApplicationNotification),
                    None,
                    None,
                    &observer_block,
                )
            };

            let poll_snapshot = Arc::clone(&self.running_snapshot);
            let poll_dedup = Arc::clone(&self.dedup_map);
            let poll_app_handle = app_handle;
            let poll_task = tokio::spawn(async move {
                loop {
                    tokio::time::sleep(POLL_INTERVAL).await;

                    let current_apps = current_running_whitelisted_apps();
                    let current_bundle_ids: HashSet<String> = current_apps.keys().cloned().collect();

                    let newly_detected = match poll_snapshot.lock() {
                        Ok(mut snapshot_guard) => {
                            let launched_since_last_poll = current_bundle_ids
                                .difference(&snapshot_guard)
                                .cloned()
                                .collect::<Vec<_>>();
                            *snapshot_guard = current_bundle_ids;
                            launched_since_last_poll
                        }
                        Err(_) => {
                            tracing::error!("Meeting app snapshot lock poisoned during poll");
                            continue;
                        }
                    };

                    for bundle_id in newly_detected {
                        if let Some(app_name) = current_apps.get(&bundle_id) {
                            emit_detection_event(
                                &poll_app_handle,
                                &poll_dedup,
                                app_name.clone(),
                                bundle_id.clone(),
                            );
                        }
                    }
                }
            });

            self.notification_center = Some(notification_center);
            self.observer_token = Some(observer_token);
            self.observer_block = Some(observer_block);
            self.poll_task = Some(poll_task);

            tracing::info!("Started macOS meeting app detector");
            Ok(())
        }

        pub fn stop(&mut self) {
            if let (Some(notification_center), Some(observer_token)) =
                (self.notification_center.as_ref(), self.observer_token.take())
            {
                unsafe {
                    notification_center.removeObserver(observer_token.as_ref());
                }
            }

            self.observer_block = None;
            self.notification_center = None;

            if let Some(poll_task) = self.poll_task.take() {
                poll_task.abort();
            }

            if let Ok(mut snapshot_guard) = self.running_snapshot.lock() {
                snapshot_guard.clear();
            }

            if let Ok(mut dedup_guard) = self.dedup_map.lock() {
                dedup_guard.clear();
            }

            tracing::info!("Stopped macOS meeting app detector");
        }
    }

    fn string_value(value: Option<Retained<objc2_foundation::NSString>>) -> Option<String> {
        value.map(|item| item.to_string())
    }

    fn running_app_identity(app: &NSRunningApplication) -> Option<(String, String)> {
        let bundle_id = string_value(app.bundleIdentifier())?;
        let default_app_name = meeting_app_name_for_bundle_id(&bundle_id)?;
        let app_name = string_value(app.localizedName()).unwrap_or_else(|| default_app_name.to_string());
        Some((bundle_id, app_name))
    }

    fn current_running_whitelisted_apps() -> HashMap<String, String> {
        let running_applications = NSWorkspace::sharedWorkspace().runningApplications();
        let mut apps = HashMap::new();

        for running_application in running_applications.iter() {
            if let Some((bundle_id, app_name)) = running_app_identity(&running_application) {
                apps.insert(bundle_id, app_name);
            }
        }

        apps
    }

    fn launched_app_from_notification(notification: &NSNotification) -> Option<(String, String)> {
        let user_info = notification.userInfo()?;
        let app_object: Retained<AnyObject> = user_info.objectForKeyedSubscript(unsafe { NSWorkspaceApplicationKey })?;
        let running_application = app_object.downcast::<NSRunningApplication>().ok()?;
        running_app_identity(&running_application)
    }
}

#[cfg(target_os = "macos")]
use macos::MacOsMeetingAppDetector;

#[cfg(not(target_os = "macos"))]
#[derive(Default)]
struct MacOsMeetingAppDetector;

#[cfg(not(target_os = "macos"))]
impl MacOsMeetingAppDetector {
    fn start<R: Runtime>(&mut self, app_handle: AppHandle<R>) -> Result<(), String> {
        let _ = app_handle;
        Ok(())
    }

    fn stop(&mut self) {}
}

#[tauri::command]
pub async fn enable_meeting_app_detection<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    crate::audio::recording_preferences::update_meeting_app_detection_preference(&app, true)
        .await
        .map_err(|error| format!("Failed to persist meeting app detection preference: {error}"))?;

    let detector_state = app.state::<MeetingAppDetectorState>();
    MeetingAppDetectorState::start(&detector_state, app.clone())
}

#[tauri::command]
pub async fn disable_meeting_app_detection<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    crate::audio::recording_preferences::update_meeting_app_detection_preference(&app, false)
        .await
        .map_err(|error| format!("Failed to persist meeting app detection preference: {error}"))?;

    let detector_state = app.state::<MeetingAppDetectorState>();
    MeetingAppDetectorState::stop(&detector_state)
}
