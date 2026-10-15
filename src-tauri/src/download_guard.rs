//! Webview downloads are always refused. wry's default handler accepts them and WebKit then
//! issues a sandbox extension for ~/Downloads synchronously on the main thread, which can hang
//! the whole app. File saves go through `file_save::save_file` instead.
use tauri::{webview::DownloadEvent, Runtime, Webview};

pub fn deny_download<R: Runtime>(_webview: Webview<R>, event: DownloadEvent<'_>) -> bool {
    !matches!(event, DownloadEvent::Requested { .. })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn requested_downloads_are_denied() {
        let app = tauri::test::mock_app();
        let window = tauri::WebviewWindowBuilder::new(&app, "t", tauri::WebviewUrl::default())
            .build()
            .unwrap();
        let webview = window.as_ref().clone();
        let mut destination = PathBuf::from("/tmp/x");
        let requested = DownloadEvent::Requested {
            url: "blob:https://tauri.localhost/1".parse().unwrap(),
            destination: &mut destination,
        };
        assert!(!deny_download(webview, requested));
    }
}
