use std::collections::HashMap;
use std::sync::mpsc::{sync_channel, SyncSender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Runtime, WebviewUrl, WebviewWindowBuilder};

use crate::host_bridge::SecretPromptRequest;

type SecretValues = Option<HashMap<String, String>>;
type PendingCards = Arc<Mutex<HashMap<String, SyncSender<SecretValues>>>>;

#[derive(Clone, Default)]
pub struct SecretCardManager {
    pending: PendingCards,
}

impl SecretCardManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn prompt<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        request: SecretPromptRequest,
    ) -> Result<Option<HashMap<String, String>>, String> {
        let (sender, receiver) = sync_channel(1);
        self.pending
            .lock()
            .map_err(|_| "secret card state lock poisoned".to_string())?
            .insert(request.request_id.clone(), sender);
        let label = format!("secret-card-{}", request.request_id);
        let html = card_html(&request);
        let url = format!("data:text/html,{}", percent_encode(&html));
        let window = WebviewWindowBuilder::new(
            app,
            &label,
            WebviewUrl::External(url.parse().map_err(|_| "secret card URL invalid")?),
        )
        .title("touri · secure entry")
        .inner_size(440.0, 360.0)
        .always_on_top(true)
        .resizable(false)
        .on_download(crate::download_guard::deny_download)
        .build()
        .map_err(|error| {
            let _ = self.cancel(&request.request_id);
            format!("open secret card failed: {error}")
        })?;
        let result = receiver.recv_timeout(Duration::from_secs(600));
        let _ = window.close();
        let _ = self
            .pending
            .lock()
            .map(|mut pending| pending.remove(&request.request_id));
        result.map_err(|_| "secret card timed out".to_string())
    }

    pub fn submit(&self, request_id: &str, values: HashMap<String, String>) -> Result<(), String> {
        let sender = self
            .pending
            .lock()
            .map_err(|_| "secret card state lock poisoned".to_string())?
            .remove(request_id)
            .ok_or_else(|| "secret card request not found".to_string())?;
        sender
            .send(Some(values))
            .map_err(|_| "secret card waiter is gone".to_string())
    }

    pub fn cancel(&self, request_id: &str) -> Result<(), String> {
        let Some(sender) = self
            .pending
            .lock()
            .map_err(|_| "secret card state lock poisoned".to_string())?
            .remove(request_id)
        else {
            return Ok(());
        };
        sender
            .send(None)
            .map_err(|_| "secret card waiter is gone".to_string())
    }
}

#[tauri::command]
pub fn secret_card_submit(
    manager: tauri::State<'_, SecretCardManager>,
    request_id: String,
    values: HashMap<String, String>,
) -> Result<(), String> {
    manager.submit(&request_id, values)
}

#[tauri::command]
pub fn secret_card_cancel(
    manager: tauri::State<'_, SecretCardManager>,
    request_id: String,
) -> Result<(), String> {
    manager.cancel(&request_id)
}

fn card_html(request: &SecretPromptRequest) -> String {
    let mut fields = String::new();
    for kind in &request.field_kinds {
        let input_type = if kind == "password" || kind == "otp" {
            "password"
        } else {
            "text"
        };
        fields.push_str(&format!(
            "<label>{}</label><input name=\"{}\" type=\"{}\" autocomplete=\"off\" required>",
            escape_html(kind),
            escape_html(kind),
            input_type
        ));
    }
    format!(
        r#"<!doctype html><meta charset="utf-8"><title>touri · entrada segura</title>
<style>body{{font:15px -apple-system,sans-serif;padding:24px;color:#171717}}h2{{margin:0 0 8px}}p{{color:#666}}label{{display:block;margin:14px 0 5px;font-weight:600}}input{{box-sizing:border-box;width:100%;padding:9px;border:1px solid #aaa;border-radius:6px}}button{{margin-top:20px;padding:9px 14px;border:0;border-radius:6px;background:#dc2626;color:white}}#cancel{{margin-left:8px;background:#777}}</style>
<h2>{}</h2><p>{}</p><form id="form">{}<button>Salvar com segurança</button><button id="cancel" type="button">Cancelar</button></form>
<script>
const invoke=(name,args)=>window.__TAURI_INTERNALS__.invoke(name,args);
const requestId={:?};
document.querySelector('#form').addEventListener('submit', async event=>{{event.preventDefault();const values=Object.fromEntries(new FormData(event.currentTarget).entries());await invoke('secret_card_submit',{{requestId,values}});}});
document.querySelector('#cancel').addEventListener('click',()=>invoke('secret_card_cancel',{{requestId}}));
</script>"#,
        escape_html(&request.title),
        escape_html(&request.origin),
        fields,
        request.request_id
    )
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn percent_encode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                char::from(byte).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}
