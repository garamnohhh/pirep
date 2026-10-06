use serde::Serialize;

const MARKDOWN_UTI: &str = "net.daringfireball.markdown";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownDefaultApp {
    name: Option<String>,
    is_self: bool,
}

fn is_self_handler(handler_bundle_id: &str, current_bundle_id: &str) -> bool {
    handler_bundle_id == current_bundle_id
}

#[tauri::command]
pub fn get_markdown_default_app() -> Result<MarkdownDefaultApp, String> {
    #[cfg(target_os = "macos")]
    {
        return Ok(macOS::get_default_app());
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Setting the default Markdown app is only supported on macOS.".into())
    }
}

#[tauri::command]
pub fn set_markdown_default_app() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        return macOS::set_default_app();
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Setting the default Markdown app is only supported on macOS.".into())
    }
}

#[cfg(target_os = "macos")]
#[allow(non_snake_case)]
mod macOS {
    use super::{is_self_handler, MarkdownDefaultApp, MARKDOWN_UTI};
    use std::{
        ffi::{c_char, c_void, CString},
        ptr,
    };

    type CFTypeRef = *const c_void;
    type CFStringRef = *const c_void;
    type CFURLRef = *const c_void;
    type CFBundleRef = *const c_void;

    const UTF8: u32 = 0x0800_0100;
    const ROLE_ALL: u32 = 0xFFFF_FFFF;

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFStringCreateWithCString(
            allocator: CFTypeRef,
            value: *const c_char,
            encoding: u32,
        ) -> CFStringRef;
        fn CFStringGetCString(
            value: CFStringRef,
            buffer: *mut c_char,
            size: isize,
            encoding: u32,
        ) -> bool;
        fn CFRelease(value: CFTypeRef);
        fn CFBundleGetMainBundle() -> CFBundleRef;
        fn CFBundleGetIdentifier(bundle: CFBundleRef) -> CFStringRef;
        fn CFBundleCreate(allocator: CFTypeRef, url: CFURLRef) -> CFBundleRef;
        fn CFBundleGetValueForInfoDictionaryKey(bundle: CFBundleRef, key: CFStringRef)
            -> CFTypeRef;
        fn CFURLCopyLastPathComponent(url: CFURLRef) -> CFStringRef;
    }

    #[link(name = "CoreServices", kind = "framework")]
    unsafe extern "C" {
        fn LSCopyDefaultApplicationURLForContentType(
            content_type: CFStringRef,
            role: u32,
            error: *mut CFTypeRef,
        ) -> CFURLRef;
        fn LSSetDefaultRoleHandlerForContentType(
            content_type: CFStringRef,
            role: u32,
            bundle_id: CFStringRef,
        ) -> i32;
    }

    unsafe fn cf_string(value: &str) -> Option<CFStringRef> {
        let value = CString::new(value).ok()?;
        let string = CFStringCreateWithCString(ptr::null(), value.as_ptr(), UTF8);
        (!string.is_null()).then_some(string)
    }

    unsafe fn to_string(value: CFStringRef) -> Option<String> {
        if value.is_null() {
            return None;
        }
        let mut buffer = [0 as c_char; 1024];
        if !CFStringGetCString(value, buffer.as_mut_ptr(), buffer.len() as isize, UTF8) {
            return None;
        }
        Some(
            std::ffi::CStr::from_ptr(buffer.as_ptr())
                .to_string_lossy()
                .into_owned(),
        )
    }

    unsafe fn main_bundle_id() -> Option<String> {
        let bundle = CFBundleGetMainBundle();
        if bundle.is_null() {
            return None;
        }
        to_string(CFBundleGetIdentifier(bundle))
    }

    pub(super) fn get_default_app() -> MarkdownDefaultApp {
        unsafe {
            let Some(content_type) = cf_string(MARKDOWN_UTI) else {
                return MarkdownDefaultApp {
                    name: None,
                    is_self: false,
                };
            };
            let mut error = ptr::null();
            let url = LSCopyDefaultApplicationURLForContentType(content_type, ROLE_ALL, &mut error);
            CFRelease(content_type);
            if !error.is_null() {
                CFRelease(error);
            }
            if url.is_null() {
                return MarkdownDefaultApp {
                    name: None,
                    is_self: false,
                };
            }

            let bundle = CFBundleCreate(ptr::null(), url);
            let bundle_id = if bundle.is_null() {
                None
            } else {
                to_string(CFBundleGetIdentifier(bundle))
            };
            let name = if bundle.is_null() {
                None
            } else {
                ["CFBundleDisplayName", "CFBundleName"]
                    .into_iter()
                    .find_map(|key| {
                        let key = cf_string(key)?;
                        let value = CFBundleGetValueForInfoDictionaryKey(bundle, key);
                        CFRelease(key);
                        to_string(value)
                    })
            }
            .or_else(|| {
                let last = CFURLCopyLastPathComponent(url);
                let name = to_string(last)
                    .map(|name| name.strip_suffix(".app").unwrap_or(&name).to_string());
                if !last.is_null() {
                    CFRelease(last);
                }
                name
            });
            if !bundle.is_null() {
                CFRelease(bundle);
            }
            CFRelease(url);
            let is_self = bundle_id
                .as_deref()
                .zip(main_bundle_id().as_deref())
                .is_some_and(|(handler, current)| is_self_handler(handler, current));
            MarkdownDefaultApp { name, is_self }
        }
    }

    pub(super) fn set_default_app() -> Result<(), String> {
        unsafe {
            let content_type =
                cf_string(MARKDOWN_UTI).ok_or("Could not create Markdown type identifier")?;
            let bundle_id =
                main_bundle_id().ok_or("Could not read this app's bundle identifier")?;
            let bundle_id =
                cf_string(&bundle_id).ok_or("Could not read this app's bundle identifier")?;
            let status = LSSetDefaultRoleHandlerForContentType(content_type, ROLE_ALL, bundle_id);
            CFRelease(content_type);
            CFRelease(bundle_id);
            if status == 0 {
                Ok(())
            } else {
                Err(format!("Launch Services returned error {status}"))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::is_self_handler;

    #[test]
    fn identifies_this_app_by_bundle_identifier_not_path() {
        assert!(is_self_handler("com.garamnoh.pirep", "com.garamnoh.pirep"));
        assert!(!is_self_handler(
            "com.garamnoh.pirep.testdap",
            "com.garamnoh.pirep"
        ));
        assert!(!is_self_handler("com.example.other", "com.garamnoh.pirep"));
    }
}
