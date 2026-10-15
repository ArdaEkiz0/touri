use crate::host_bridge::HostBridgeSender;

#[cfg(target_os = "macos")]
mod macos {
    use super::HostBridgeSender;
    use block2::RcBlock;
    use objc2_app_kit::{
        NSWorkspace, NSWorkspaceDidWakeNotification, NSWorkspaceWillSleepNotification,
    };
    use objc2_foundation::NSNotification;
    use serde_json::json;
    use std::ptr::NonNull;

    pub struct PowerMonitor;

    impl PowerMonitor {
        pub fn start(sender: HostBridgeSender) -> Self {
            let center = NSWorkspace::sharedWorkspace().notificationCenter();
            let sleep_sender = sender.clone();
            let sleep_block = RcBlock::new(move |_notification: NonNull<NSNotification>| {
                let _ = sleep_sender.send_notification("power.sleep", json!({ "sleeping": true }));
            });
            let wake_sender = sender;
            let wake_block = RcBlock::new(move |_notification: NonNull<NSNotification>| {
                let _ = wake_sender.send_notification("power.sleep", json!({ "sleeping": false }));
            });
            let will_sleep = unsafe {
                center.addObserverForName_object_queue_usingBlock(
                    Some(NSWorkspaceWillSleepNotification),
                    None,
                    None,
                    &sleep_block,
                )
            };
            let did_wake = unsafe {
                center.addObserverForName_object_queue_usingBlock(
                    Some(NSWorkspaceDidWakeNotification),
                    None,
                    None,
                    &wake_block,
                )
            };
            // The observers live for the app lifetime; intentionally release them at process exit.
            std::mem::forget(will_sleep);
            std::mem::forget(did_wake);
            Self
        }
    }
}

#[cfg(target_os = "macos")]
pub use macos::PowerMonitor;

#[cfg(not(target_os = "macos"))]
#[derive(Debug, Default)]
pub struct PowerMonitor;

#[cfg(not(target_os = "macos"))]
impl PowerMonitor {
    pub fn start(_sender: HostBridgeSender) -> Self {
        Self
    }
}
