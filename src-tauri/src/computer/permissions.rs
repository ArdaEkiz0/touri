use super::HostError;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PermissionState {
    Granted,
    Denied,
    NotDetermined,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct PermissionsStatus {
    pub accessibility: PermissionState,
    #[serde(rename = "screen-recording")]
    pub screen_recording: PermissionState,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionsRequestResult {
    pub status: PermissionState,
    pub needs_relaunch: bool,
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{PermissionState, PermissionsRequestResult, PermissionsStatus};
    use core_foundation::base::TCFType;
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::string::CFString;
    use core_graphics::access::ScreenCaptureAccess;
    use std::ffi::c_void;

    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn AXIsProcessTrusted() -> bool;
        fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;
    }

    fn accessibility_granted() -> bool {
        unsafe { AXIsProcessTrusted() }
    }

    fn screen_recording_granted() -> bool {
        ScreenCaptureAccess.preflight()
    }

    pub(super) fn status() -> PermissionsStatus {
        PermissionsStatus {
            accessibility: if accessibility_granted() {
                PermissionState::Granted
            } else {
                PermissionState::NotDetermined
            },
            screen_recording: if screen_recording_granted() {
                PermissionState::Granted
            } else {
                PermissionState::NotDetermined
            },
        }
    }

    pub(super) fn all_granted() -> bool {
        accessibility_granted() && screen_recording_granted()
    }

    pub(super) fn request_permission(
        permission: &str,
    ) -> Result<PermissionsRequestResult, super::HostError> {
        match permission {
            "accessibility" => {
                let key = CFString::from_static_string("AXTrustedCheckOptionPrompt");
                let value = CFBoolean::true_value();
                let options = CFDictionary::from_CFType_pairs(&[(key, value)]);
                let granted =
                    unsafe { AXIsProcessTrustedWithOptions(options.as_CFTypeRef().cast()) };
                Ok(PermissionsRequestResult {
                    status: if granted {
                        PermissionState::Granted
                    } else {
                        PermissionState::NotDetermined
                    },
                    needs_relaunch: false,
                })
            }
            "screen-recording" => {
                let granted = ScreenCaptureAccess.request();
                Ok(PermissionsRequestResult {
                    status: if granted {
                        PermissionState::Granted
                    } else {
                        PermissionState::NotDetermined
                    },
                    needs_relaunch: !granted,
                })
            }
            _ => Err(super::HostError::InvalidParams(
                "unknown permission".to_string(),
            )),
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod macos {
    use super::{PermissionState, PermissionsRequestResult, PermissionsStatus};

    pub(super) fn status() -> PermissionsStatus {
        PermissionsStatus {
            accessibility: PermissionState::NotDetermined,
            screen_recording: PermissionState::NotDetermined,
        }
    }

    pub(super) fn all_granted() -> bool {
        false
    }

    pub(super) fn request_permission(
        permission: &str,
    ) -> Result<PermissionsRequestResult, super::HostError> {
        Err(super::HostError::InvalidParams(format!(
            "permission unavailable on this platform: {permission}"
        )))
    }
}

pub fn status() -> PermissionsStatus {
    macos::status()
}

pub fn all_granted() -> bool {
    macos::all_granted()
}

pub fn request_permission(permission: &str) -> Result<PermissionsRequestResult, HostError> {
    macos::request_permission(permission)
}

pub fn request(params: &Value) -> Result<Value, HostError> {
    let permission = params
        .get("permission")
        .and_then(Value::as_str)
        .ok_or_else(|| HostError::InvalidParams("permission is required".to_string()))?;
    serde_json::to_value(request_permission(permission)?)
        .map_err(|error| HostError::Native(error.to_string()))
}
