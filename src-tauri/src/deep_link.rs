use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

const PENDING_TTL: Duration = Duration::from_secs(30);

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct DeepLink {
    pub bot: Option<String>,
    pub thread: Option<String>,
}

pub struct PendingDeepLink(Mutex<Option<(DeepLink, Instant)>>);

impl PendingDeepLink {
    pub fn new() -> Self {
        Self(Mutex::new(None))
    }

    pub fn set(&self, link: DeepLink) {
        if let Ok(mut slot) = self.0.lock() {
            *slot = Some((link, Instant::now()));
        }
    }

    pub fn take_fresh(&self) -> Option<DeepLink> {
        let mut slot = self.0.lock().ok()?;
        let (link, at) = slot.take()?;
        (at.elapsed() <= PENDING_TTL).then_some(link)
    }
}

impl Default for PendingDeepLink {
    fn default() -> Self {
        Self::new()
    }
}

fn decode(value: &str) -> String {
    let bytes = value.replace('+', " ").into_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        let hex = bytes
            .get(index + 1..index + 3)
            .and_then(|pair| std::str::from_utf8(pair).ok())
            .and_then(|pair| u8::from_str_radix(pair, 16).ok());
        match (bytes[index], hex) {
            (b'%', Some(byte)) => {
                out.push(byte);
                index += 3;
            }
            (other, _) => {
                out.push(other);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Parses `touri://open?bot=<id>&thread=<id>`. Any other scheme, host or empty selection is rejected.
pub fn parse(url: &str) -> Option<DeepLink> {
    let rest = url.strip_prefix("touri://")?;
    let (host, query) = rest.split_once('?').unwrap_or((rest, ""));
    if host.trim_end_matches('/') != "open" {
        return None;
    }
    let find = |key: &str| {
        query
            .split('&')
            .filter_map(|pair| pair.split_once('='))
            .find(|(name, _)| *name == key)
            .map(|(_, value)| decode(value))
            .filter(|value| !value.is_empty())
    };
    let link = DeepLink {
        bot: find("bot"),
        thread: find("thread"),
    };
    (link.bot.is_some() || link.thread.is_some()).then_some(link)
}

pub fn dispatch<R: Runtime>(app: &AppHandle<R>, link: &DeepLink) {
    crate::window_config::show_main(app, None);
    let _ = app.emit("deep-link", link.clone());
}

pub fn handle_url<R: Runtime>(app: &AppHandle<R>, url: &str) {
    if let Some(link) = parse(url) {
        dispatch(app, &link);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_bot_and_thread() {
        assert_eq!(
            parse("touri://open?bot=bot-1&thread=th%202"),
            Some(DeepLink {
                bot: Some("bot-1".into()),
                thread: Some("th 2".into())
            })
        );
    }

    #[test]
    fn accepts_a_single_selector() {
        assert_eq!(
            parse("touri://open?thread=abc"),
            Some(DeepLink {
                bot: None,
                thread: Some("abc".into())
            })
        );
    }

    #[test]
    fn rejects_other_schemes_hosts_and_empty_queries() {
        assert_eq!(parse("https://open?bot=a"), None);
        assert_eq!(parse("touri://settings?bot=a"), None);
        assert_eq!(parse("touri://open"), None);
        assert_eq!(parse("touri://open?bot="), None);
    }

    #[test]
    fn pending_links_expire_after_one_use() {
        let pending = PendingDeepLink::new();
        pending.set(DeepLink {
            bot: Some("b".into()),
            thread: None,
        });
        assert!(pending.take_fresh().is_some());
        assert!(pending.take_fresh().is_none());
    }
}
