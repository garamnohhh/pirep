const GAP: f64 = 0.3;

#[derive(Default)]
struct DoubleTap {
    down_at: Option<f64>,
    last_tap: Option<f64>,
}

impl DoubleTap {
    fn flags(&mut self, command_only: bool, empty: bool, t: f64) -> bool {
        if command_only {
            self.down_at = Some(t);
            return false;
        }
        if empty {
            if let Some(down) = self.down_at.take() {
                if t - down >= GAP { self.last_tap = None; return false; }
                if self.last_tap.is_some_and(|last| t - last < GAP) {
                    self.last_tap = None;
                    return true;
                }
                self.last_tap = Some(t);
            }
            return false;
        }
        self.other();
        false
    }

    fn other(&mut self) { self.down_at = None; self.last_tap = None; }
}

#[cfg(target_os = "macos")]
pub fn install(app: tauri::AppHandle) {
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2_app_kit::{NSEvent, NSEventMask, NSEventModifierFlags, NSEventType};
    use std::{cell::RefCell, ptr::NonNull};
    use tauri::Emitter;

    let state = RefCell::new(DoubleTap::default());
    let mask = NSEventMask::FlagsChanged | NSEventMask::KeyDown
        | NSEventMask::LeftMouseDown | NSEventMask::RightMouseDown;
    let block = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
        let event_ref = unsafe { event.as_ref() };
        let triggered = if event_ref.r#type() == NSEventType::FlagsChanged {
            let relevant = NSEventModifierFlags::Shift | NSEventModifierFlags::Control
                | NSEventModifierFlags::Option | NSEventModifierFlags::Command
                | NSEventModifierFlags::Function;
            let flags = event_ref.modifierFlags() & relevant;
            state.borrow_mut().flags(
                flags == NSEventModifierFlags::Command,
                flags.is_empty(),
                event_ref.timestamp(),
            )
        } else {
            state.borrow_mut().other();
            false
        };
        if triggered {
            eprintln!("double-meta");
            let _ = app.emit("double-meta", ());
        }
        event.as_ptr()
    });
    let monitor: Option<Retained<_>> = unsafe {
        NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &block)
    };
    if let Some(monitor) = monitor { std::mem::forget(monitor); }
    std::mem::forget(block);
}

#[cfg(test)]
mod tests {
    use super::DoubleTap;

    #[test]
    fn two_taps_trigger() {
        let mut s = DoubleTap::default();
        assert!(!s.flags(true, false, 0.0)); assert!(!s.flags(false, true, 0.05));
        assert!(!s.flags(true, false, 0.15)); assert!(s.flags(false, true, 0.2));
    }
    #[test]
    fn long_press_does_not_trigger() {
        let mut s = DoubleTap::default(); s.flags(true, false, 0.0);
        assert!(!s.flags(false, true, 0.31));
    }
    #[test]
    fn other_input_cancels_sequence() {
        let mut s = DoubleTap::default(); s.flags(true, false, 0.0); s.flags(false, true, 0.05);
        s.other(); s.flags(true, false, 0.1); assert!(!s.flags(false, true, 0.15));
    }
    #[test]
    fn slow_taps_do_not_trigger() {
        let mut s = DoubleTap::default(); s.flags(true, false, 0.0); s.flags(false, true, 0.05);
        s.flags(true, false, 0.4); assert!(!s.flags(false, true, 0.45));
    }
    #[test]
    fn command_shift_does_not_trigger() {
        let mut s = DoubleTap::default(); assert!(!s.flags(false, false, 0.0));
    }
}
