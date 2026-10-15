use tauri::{menu::MenuItemKind, Runtime};

pub fn native_text(value: &str) -> &str {
    match value {
        "File" => "Arquivo",
        "Edit" => "Editar",
        "View" => "Visualizar",
        "Window" => "Janela",
        "Help" => "Ajuda",
        "Toggle Full Screen" => "Alternar tela cheia",
        "Undo" => "Desfazer",
        "Redo" => "Refazer",
        "Cut" => "Recortar",
        "Copy" => "Copiar",
        "Paste" => "Colar",
        "Select All" => "Selecionar tudo",
        "Close Window" => "Fechar janela",
        "Minimize" => "Minimizar",
        "Zoom" | "Maximize" => "Ampliar",
        "Services" => "Serviços",
        "Hide Others" => "Ocultar outros",
        "Show All" => "Mostrar todos",
        "About touri" => "Sobre o touri",
        "Quit touri" => "Sair do touri",
        "Hide touri" => "Ocultar touri",
        _ => value,
    }
}

pub fn localize_menu<R: Runtime>(items: Vec<MenuItemKind<R>>) -> tauri::Result<()> {
    for item in items {
        match item {
            MenuItemKind::Submenu(menu) => {
                menu.set_text(native_text(&menu.text()?))?;
                localize_menu(menu.items()?)?;
            }
            MenuItemKind::Predefined(item) => item.set_text(native_text(&item.text()?))?,
            MenuItemKind::MenuItem(item) => item.set_text(native_text(&item.text()?))?,
            MenuItemKind::Check(item) => item.set_text(native_text(&item.text()?))?,
            MenuItemKind::Icon(item) => item.set_text(native_text(&item.text()?))?,
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::native_text;
    #[test]
    fn r3_native_menu_labels_use_portuguese() {
        for label in [
            "File",
            "Edit",
            "View",
            "Window",
            "Help",
            "Toggle Full Screen",
            "Copy",
            "Services",
        ] {
            assert_ne!(native_text(label), label);
        }
        assert_eq!(native_text("touri"), "touri");
        assert!(include_str!("../Info.plist").contains("<string>pt-BR</string>"));
    }
}
