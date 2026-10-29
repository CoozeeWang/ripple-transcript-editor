//! Eager standard AppKit items avoid WebKit's custom DOM drag provider path.
use crate::segment_clipboard::Payload;
#[cfg(target_os = "macos")]
pub fn install_capture(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let window = app.get_webview_window("main").ok_or("Missing drag window")?;
    window.with_webview(|platform| { mac::install(platform.ns_window() as _); }).map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn start_segment_drag(app: tauri::AppHandle, window: tauri::WebviewWindow, payload: Payload) -> Result<bool, String> {
    if crate::segment_protocol::app_channel(&app).is_none() || window.label() != "main" { return Err("Unsupported application identity".into()); }
    payload.validate()?;
    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = std::sync::mpsc::channel();
        #[cfg(feature = "segment-transfer-test")]
        let report = Some(crate::app_data(&app)?.join("segment-drag-probe.json"));
        #[cfg(not(feature = "segment-transfer-test"))]
        let report = None;
        window.with_webview(move |platform| {
            let error_tx = tx.clone();
            if let Err(error) = mac::start(platform.inner() as _, platform.ns_window() as _, payload, tx, report) { let _ = error_tx.send(Err(error)); }
        }).map_err(|e|e.to_string())?;
        tauri::async_runtime::spawn_blocking(move || rx.recv().map_err(|_| "Drag interrupted".to_string())?)
            .await.map_err(|e|e.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    { let _ = (window, payload); Err("Native segment drag unavailable".into()) }
}
#[cfg(target_os = "macos")]
mod mac {
    use super::Payload;
    use std::{cell::RefCell, sync::mpsc::Sender};
    use objc2::{define_class, msg_send, rc::Retained, runtime::{ProtocolObject, AnyObject}, DefinedClass, MainThreadOnly, AnyThread, Message};
    use objc2_app_kit::{NSApplication, NSDraggingSource, NSDraggingContext, NSDraggingSession, NSDragOperation, NSDraggingItem, NSPasteboardItem, NSView, NSWindow, NSEvent, NSEventType, NSEventMask};
    use objc2_foundation::{NSObject, NSObjectProtocol, MainThreadMarker, NSArray, NSString, NSPoint, NSRect, NSSize};
    struct Ivars { done: RefCell<Option<Sender<Result<bool,String>>>>, _item: Retained<NSPasteboardItem>, report: Option<std::path::PathBuf> }
    define_class!(
        #[unsafe(super = NSObject)]
        #[thread_kind = MainThreadOnly]
        #[ivars = Ivars]
        struct SegmentSource;
        unsafe impl NSObjectProtocol for SegmentSource {}
        unsafe impl NSDraggingSource for SegmentSource {
            #[unsafe(method(draggingSession:sourceOperationMaskForDraggingContext:))]
            fn operation(&self, _session:&NSDraggingSession, _context:NSDraggingContext) -> NSDragOperation { NSDragOperation::Copy }
            #[unsafe(method(ignoreModifierKeysForDraggingSession:))]
            fn ignore_modifiers(&self, _session:&NSDraggingSession) -> bool { true }
            #[unsafe(method(draggingSession:endedAtPoint:operation:))]
            fn ended(&self, _session:&NSDraggingSession, _point:NSPoint, operation:NSDragOperation) {
                if let Some(path) = &self.ivars().report {
                    let mut value: serde_json::Value = std::fs::read(path).ok().and_then(|bytes|serde_json::from_slice(&bytes).ok()).unwrap_or_default();
                    value["completed"] = true.into(); value["copied"] = (operation == NSDragOperation::Copy).into();
                    let _ = std::fs::write(path, value.to_string());
                }
                if let Some(done)=self.ivars().done.borrow_mut().take() { let _=done.send(Ok(operation == NSDragOperation::Copy)); }
            }
        }
    );
    // AppKit does not own the source. Retain the latest source (and eager item)
    // through its end callback, replacing it only after that session has ended.
    thread_local! { static SOURCE: RefCell<Option<Retained<SegmentSource>>> = const { RefCell::new(None) }; }
    // IPC is asynchronous: Tao may replace NSApplication.currentEvent with an
    // ApplicationDefined wake event before the command reaches the main thread.
    // Retain only genuine local mouse events from our own main window instead.
    thread_local! {
        static MOUSE: RefCell<Option<Retained<NSEvent>>> = const { RefCell::new(None) };
        static MONITOR: RefCell<Option<Retained<AnyObject>>> = const { RefCell::new(None) };
    }
    pub fn install(window: *mut NSWindow) {
        let Some(window) = (unsafe { window.as_ref() }) else { return; };
        let number = window.windowNumber();
        let block = block2::RcBlock::new(move |event: std::ptr::NonNull<NSEvent>| {
            let event_ref = unsafe { event.as_ref() };
            if event_ref.r#type() == NSEventType::LeftMouseUp {
                MOUSE.with(|slot| *slot.borrow_mut() = None);
            } else if event_ref.windowNumber() == number {
                MOUSE.with(|slot| *slot.borrow_mut() = Some(event_ref.retain()));
            } else {
                MOUSE.with(|slot| *slot.borrow_mut() = None);
            }
            event.as_ptr()
        });
        let monitor = unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(
            NSEventMask::LeftMouseDown | NSEventMask::LeftMouseDragged | NSEventMask::LeftMouseUp, &block) };
        MONITOR.with(|slot| { let old = std::mem::replace(&mut *slot.borrow_mut(), monitor); if let Some(old) = old { unsafe { NSEvent::removeMonitor(&old); } } });
    }
    fn validate_event(kind: NSEventType, source_window: isize, target_window: isize) -> Result<(), String> {
        if !matches!(kind, NSEventType::LeftMouseDown | NSEventType::LeftMouseDragged) { return Err("Invalid drag event".into()); }
        if source_window != target_window { return Err("Mouse event belongs to another window".into()); }
        Ok(())
    }
    #[test]
    fn captured_mouse_gesture_is_valid_but_wake_release_and_other_windows_are_not() {
        assert!(validate_event(NSEventType::LeftMouseDragged, 42, 42).is_ok());
        assert!(validate_event(NSEventType::LeftMouseDown, 42, 42).is_ok());
        assert!(validate_event(NSEventType::ApplicationDefined, 0, 42).is_err());
        assert!(validate_event(NSEventType::LeftMouseUp, 42, 42).is_err());
        assert!(validate_event(NSEventType::LeftMouseDragged, 43, 42).is_err());
    }
    pub fn start(view:*mut NSView, window:*mut NSWindow, payload:Payload, done:Sender<Result<bool,String>>, report:Option<std::path::PathBuf>) -> Result<(),String> {
        let mtm=MainThreadMarker::new().ok_or("Drag must start on main thread")?;
        if let Some(path) = &report {
            let app = NSApplication::sharedApplication(mtm);
            let snapshot = serde_json::json!({"currentEventType":app.currentEvent().map(|e|e.r#type().0), "capturedEventType":MOUSE.with(|slot|slot.borrow().as_ref().map(|e|e.r#type().0)), "pressedMouseButtons":NSEvent::pressedMouseButtons(), "completed":false});
            let _ = std::fs::write(path, snapshot.to_string());
        }
        if NSEvent::pressedMouseButtons() & 1 == 0 { return Err("Mouse released before drag started".into()); }
        let app=NSApplication::sharedApplication(mtm);
        let event=MOUSE.with(|slot|slot.borrow().clone()).ok_or("No captured mouse event for drag")?;
        validate_event(event.r#type(), event.windowNumber(), unsafe {window.as_ref()}.ok_or("Missing drag window")?.windowNumber())?;
        let view=unsafe {view.as_ref()}.ok_or("Missing drag view")?;


        if SOURCE.with(|slot|slot.borrow().as_ref().is_some_and(|s|s.ivars().done.borrow().is_some())) { return Err("Drag already active".into()); }
        let item=NSPasteboardItem::new();
        for (kind,value) in [("public.utf8-plain-text",payload.plain),("public.html",payload.html),("public.rtf",payload.rtf)] {
            if !item.setString_forType(&NSString::from_str(&value), &NSString::from_str(kind)) { return Err("Drag data write failed".into()); }
        }
        let drag=NSDraggingItem::initWithPasteboardWriter(NSDraggingItem::alloc(),ProtocolObject::from_ref(&*item));
        let point=view.convertPoint_fromView(event.locationInWindow(),None);
        let icon=app.applicationIconImage().ok_or("Missing drag image")?;
        unsafe { drag.setDraggingFrame_contents(NSRect::new(NSPoint::new(point.x,point.y-36.0),NSSize::new(36.0,36.0)),Some(&icon)); }
        let source=SegmentSource::alloc(mtm).set_ivars(Ivars{done:RefCell::new(Some(done)),_item:item,report});
        let source:Retained<SegmentSource>=unsafe {msg_send![super(source),init]};
        SOURCE.with(|slot|*slot.borrow_mut()=Some(source.clone()));
        view.beginDraggingSessionWithItems_event_source(&NSArray::from_retained_slice(&[drag]),&event,ProtocolObject::from_ref(&*source));
        Ok(())
    }
}
