#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, WebviewWindow,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, ShortcutState};

/// The desktop buddy.
///
/// Two windows: a transparent, always-on-top, undecorated one holding the pet,
/// and an ordinary window for the chat panel. The interesting part is making the
/// pet window float over everything WITHOUT eating clicks meant for the app
/// underneath — see `set_hit_region`.
///
/// The chat UI is `@bots/widget` unchanged. This is a different shell around the
/// same Preact app, not a second implementation.

/// Clicks pass THROUGH the pet window everywhere except over the pet itself.
///
/// A transparent always-on-top window is a 220×220 hole in the user's desktop:
/// every click inside its bounds goes to it, including the ~85% that is empty
/// space around the creature. `set_ignore_cursor_events` is the only mechanism
/// that fixes it, and it is all-or-nothing per window — so the frontend tracks
/// whether the pointer is over the pet's actual silhouette and toggles it.
///
/// The frontend drives this rather than Rust because only the frontend knows
/// where the pet currently is: it drifts, and its bounding box moves with it.
#[tauri::command]
fn set_hit_region(window: WebviewWindow, over_pet: bool) -> Result<(), String> {
    window
        .set_ignore_cursor_events(!over_pet)
        .map_err(|e| e.to_string())
}

/// Show or hide the chat window, keeping it near the pet.
#[tauri::command]
fn toggle_chat(app: AppHandle) -> Result<(), String> {
    let chat = app.get_webview_window("chat").ok_or("no chat window")?;
    if chat.is_visible().unwrap_or(false) {
        chat.hide().map_err(|e| e.to_string())?;
    } else {
        // Position beside the pet, so summoning it does not teleport the
        // conversation to wherever it was last left.
        if let Some(pet) = app.get_webview_window("pet") {
            if let (Ok(pos), Ok(size)) = (pet.outer_position(), pet.outer_size()) {
                let _ = chat.set_position(tauri::PhysicalPosition {
                    x: pos.x - 400,
                    y: pos.y + size.height as i32 - 620,
                });
            }
        }
        chat.show().map_err(|e| e.to_string())?;
        chat.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Move the pet window. Dragging happens in the webview, which reports deltas.
#[tauri::command]
fn move_pet(window: WebviewWindow, dx: i32, dy: i32) -> Result<(), String> {
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    window
        .set_position(tauri::PhysicalPosition {
            x: pos.x + dx,
            y: pos.y + dy,
        })
        .map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![set_hit_region, toggle_chat, move_pet])
        .setup(|app| {
            let pet = app.get_webview_window("pet").expect("pet window");

            // Start fully click-through. The frontend turns this off the moment
            // the pointer is over the creature; starting the other way round
            // means the window swallows a click before any JS has run.
            pet.set_ignore_cursor_events(true)?;

            let quit = MenuItem::with_id(app, "quit", "Quit Petbot", true, None::<&str>)?;
            let chat = MenuItem::with_id(app, "chat", "Open chat", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&chat, &quit])?;

            TrayIconBuilder::new()
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "chat" => {
                        let _ = toggle_chat(app.clone());
                    }
                    _ => {}
                })
                .build(app)?;

            // Summon from anywhere. A desktop buddy you have to go and find is
            // just a window.
            let handle = app.handle().clone();
            app.global_shortcut().on_shortcut(
                tauri_plugin_global_shortcut::Shortcut::new(
                    Some(Modifiers::SUPER | Modifiers::SHIFT),
                    Code::KeyP,
                ),
                move |_app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let _ = toggle_chat(handle.clone());
                    }
                },
            )?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running petbot");
}
