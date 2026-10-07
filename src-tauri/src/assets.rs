//! `pirepfile://` — serves a vault file to the HTML preview iframe.
//!
//! HTML previews load directly from this isolated origin, so relative references resolve
//! naturally and preview-only CSP can be set on the document response.

use crate::commands::VaultState;
use std::path::{Component, Path, PathBuf};
use tauri::http::{Request, Response};
use tauri::{Manager, Runtime, UriSchemeContext};

pub const SCHEME: &str = "pirepfile";
const HTML_CSP: &str = "default-src 'none'; script-src 'self' 'unsafe-inline' https: pirepfile:; style-src 'self' 'unsafe-inline' https: pirepfile:; font-src 'self' https: data: pirepfile:; img-src 'self' https: data: blob: pirepfile:; media-src 'self' https: data: blob: pirepfile:; connect-src 'self' https: pirepfile:; frame-src 'self' https: data: blob: pirepfile:; form-action https:; base-uri 'self' https: pirepfile:; object-src 'none'";
const KEY_BRIDGE: &str = r#"<script>(()=>{
const selectors=['section[data-label]','.slide','.reveal .slides > section','.step','[data-slide]'];
let slides=[],index=0,presenting=false;
function state(){parent.postMessage({type:'pirep-slides-state',current:index+1,total:slides.length},'*')}
function show(n){if(!slides.length)return;presenting=true;index=Math.max(0,Math.min(n,slides.length-1));document.documentElement.style.cssText='height:100%;overflow:hidden;background:#111';document.body.style.cssText='height:100%;margin:0;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#111';slides.forEach((el,i)=>el.style.display=i===index?'':'none');const el=slides[index],w=el.offsetWidth||1,h=el.offsetHeight||1;el.style.transformOrigin='center';el.style.transform='scale('+Math.min(innerWidth/w,innerHeight/h,1)+')';state()}
addEventListener('message',e=>{if(e.source!==parent||e.data?.type!=='pirep-slides-command')return;const d=e.data;slides=[];for(const s of selectors){const found=[...document.querySelectorAll(s)];if(found.length>=2){slides=found;break}}if(!slides.length)return;switch(d.action){case'next':show(index+1);break;case'prev':show(index-1);break;case'first':show(0);break;case'last':show(slides.length-1);break;case'goto':if(Number.isInteger(d.index))show(d.index);break}});
addEventListener('keydown',e=>{const nav=e.metaKey&&!e.ctrlKey&&!e.altKey&&!e.shiftKey&&(e.key==='['||e.key===']');const pin=e.metaKey&&!e.ctrlKey&&!e.altKey&&!e.shiftKey&&e.key.toLowerCase()==='d';if(nav||pin)e.preventDefault();if(e.key==='Escape'||e.metaKey||e.ctrlKey||e.altKey||presenting&&['ArrowRight','ArrowLeft','PageDown','PageUp',' '].includes(e.key))parent.postMessage({type:'pirep-keydown',key:e.key,metaKey:e.metaKey,ctrlKey:e.ctrlKey,altKey:e.altKey,shiftKey:e.shiftKey},'*')},true);
document.addEventListener('click',()=>{if(presenting)show(index+1)});
function locationState(){parent.postMessage({type:'pirep-preview-location',href:location.href},'*')}
addEventListener('pageshow',locationState);addEventListener('popstate',locationState);addEventListener('hashchange',locationState);locationState();
addEventListener('message',e=>{if(e.source!==parent)return;const d=e.data;if(d?.type==='pirep-preview-request-state')locationState();if(d?.type==='pirep-preview-command'){if(d.action==='back')history.back();else if(d.action==='forward')history.forward()}});
document.addEventListener('click',e=>{const a=e.target instanceof Element?e.target.closest('a[href]'):null;if(!a)return;let url;try{url=new URL(a.href,location.href)}catch{e.preventDefault();return}if(url.protocol==='https:'){e.preventDefault();parent.postMessage({type:'pirep-external-link',url:url.href},'*');return}if(url.protocol==='pirepfile:'&&url.hostname==='localhost'){if(url.pathname===location.pathname&&url.search===location.search)return;e.preventDefault();location.assign(url.href);return}e.preventDefault()},true);
})()</script>"#;

fn inject_key_bridge(mut html: Vec<u8>) -> Vec<u8> {
    let insert = String::from_utf8_lossy(&html)
        .to_ascii_lowercase()
        .rfind("</body>");
    match insert {
        Some(at) => html.splice(at..at, KEY_BRIDGE.bytes()).for_each(drop),
        None => html.extend_from_slice(KEY_BRIDGE.as_bytes()),
    }
    html
}

/// URL path (`/Users/g/My%20Base/deck/support.js`) → absolute filesystem path.
/// Decoding is per segment so that `%20` in a folder name survives. A decoded
/// segment containing a separator just yields a different path — `resolve` still
/// canonicalizes and re-checks containment, so it can't escape the vault.
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(byte) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn decode_path(url_path: &str) -> PathBuf {
    let mut out = PathBuf::from("/");
    for seg in url_path.split('/').filter(|s| !s.is_empty()) {
        out.push(percent_decode(seg));
    }
    out
}

fn mime_for(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "pdf" => "application/pdf",
        "csv" => "text/csv; charset=utf-8",
        "txt" | "md" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// Reject anything that isn't a plain file inside the open vault. `..` is refused
/// outright rather than normalised, and the vault root is re-read per request so a
/// closed or switched vault stops serving immediately.
fn resolve(root: Option<PathBuf>, url_path: &str) -> Result<PathBuf, u16> {
    let root = root.ok_or(403u16)?;
    let path = decode_path(url_path);
    if path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(403);
    }
    let root = root.canonicalize().map_err(|_| 403u16)?;
    let real = path.canonicalize().map_err(|_| 404u16)?;
    if !real.starts_with(&root) || !real.is_file() {
        return Err(403);
    }
    Ok(real)
}

fn serve(root: Option<PathBuf>, url_path: &str) -> Response<Vec<u8>> {
    match resolve(root, url_path) {
        Ok(path) => match std::fs::read(&path) {
            Ok(mut bytes) => {
                let mime = mime_for(&path);
                let mut response = Response::builder()
                    .status(200)
                    .header("Content-Type", mime)
                    .header("Access-Control-Allow-Origin", "*")
                // Vault files change under the app, and a failed load stays
                // failed in the webview's cache for the life of the session.
                    .header("Cache-Control", "no-store");
                if mime.starts_with("text/html") {
                    response = response.header("Content-Security-Policy", HTML_CSP);
                    bytes = inject_key_bridge(bytes);
                }
                response.body(bytes).unwrap()
            }
            Err(_) => Response::builder().status(404).body(Vec::new()).unwrap(),
        },
        Err(code) => Response::builder().status(code).body(Vec::new()).unwrap(),
    }
}

pub fn handler<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let root = ctx
        .app_handle()
        .state::<VaultState>()
        .root
        .lock()
        .unwrap()
        .clone();

    serve(root, request.uri().path())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_segments_and_keeps_separators() {
        assert_eq!(decode_path("/Users/g/My%20Base/deck/support.js"),
                   PathBuf::from("/Users/g/My Base/deck/support.js"));
        // Korean folder names round-trip.
        assert_eq!(decode_path("/v/%ED%95%9C%EA%B8%80/a.css"),
                   PathBuf::from("/v/한글/a.css"));
        // Empty segments collapse; a stray encoded separator is harmless because
        // `resolve` re-checks containment after canonicalizing.
        assert_eq!(decode_path("//v///a.css"), PathBuf::from("/v/a.css"));
    }

    #[test]
    fn refuses_traversal_and_paths_outside_the_vault() {
        let dir = std::env::temp_dir().join(format!("pirep-assets-{}", std::process::id()));
        let vault = dir.join("vault");
        std::fs::create_dir_all(vault.join("deck")).unwrap();
        std::fs::write(vault.join("deck/support.js"), "ok").unwrap();
        std::fs::write(dir.join("outside.txt"), "no").unwrap();

        let root = Some(vault.clone());
        let inside = format!("{}/deck/support.js", vault.to_str().unwrap());
        assert!(resolve(root.clone(), &inside).is_ok());

        let outside = format!("{}/outside.txt", dir.to_str().unwrap());
        assert_eq!(resolve(root.clone(), &outside), Err(403));

        let traversal = format!("{}/deck/../../outside.txt", vault.to_str().unwrap());
        assert_eq!(resolve(root.clone(), &traversal), Err(403));

        // A directory is not servable, and no open vault serves nothing.
        assert_eq!(resolve(root.clone(), vault.to_str().unwrap()), Err(403));
        assert_eq!(resolve(None, &inside), Err(403));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn serves_image_and_text_files_with_exact_mime_and_body() {
        let vault = std::env::temp_dir().join(format!(
            "pirep-assets-response-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&vault).unwrap();

        let cases: [(&str, &str, &[u8]); 4] = [
            ("sample.png", "image/png", b"\x89PNG\r\n\x1a\n"),
            ("sample.jpg", "image/jpeg", b"\xff\xd8\xff\xd9"),
            (
                "sample.svg",
                "image/svg+xml",
                b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>",
            ),
            ("sample.txt", "text/plain; charset=utf-8", b"hello"),
        ];

        for (name, content_type, body) in cases {
            let path = vault.join(name);
            std::fs::write(&path, body).unwrap();

            let response = serve(Some(vault.clone()), path.to_str().unwrap());
            assert_eq!(response.status(), 200);
            assert_eq!(response.headers()["Content-Type"], content_type);
            assert_eq!(response.headers()["Cache-Control"], "no-store");
            assert_eq!(response.body(), body);
            assert_eq!(response.body().len(), body.len());
        }

        std::fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn adds_preview_csp_to_html_only() {
        let vault = std::env::temp_dir().join(format!(
            "pirep-assets-csp-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&vault).unwrap();
        std::fs::write(vault.join("index.html"), "<h1>preview</h1>").unwrap();
        std::fs::write(vault.join("style.css"), "h1{}").unwrap();
        std::fs::write(vault.join("image.png"), b"\x89PNG\r\n\x1a\n").unwrap();

        let html = serve(Some(vault.clone()), vault.join("index.html").to_str().unwrap());
        let csp = html.headers().get("Content-Security-Policy").unwrap().to_str().unwrap();
        assert!(csp.contains("script-src 'self' 'unsafe-inline' https: pirepfile:"));
        assert!(csp.contains("style-src 'self' 'unsafe-inline' https: pirepfile:"));
        assert!(csp.contains("font-src 'self' https: data: pirepfile:"));
        assert!(csp.contains("img-src 'self' https: data: blob: pirepfile:"));

        for name in ["style.css", "image.png"] {
            let response = serve(Some(vault.clone()), vault.join(name).to_str().unwrap());
            assert!(response.headers().get("Content-Security-Policy").is_none());
        }

        std::fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn injects_key_bridge_after_document_scripts() {
        let html = b"<html><body><script>window.own=true</script></body></html>";
        let injected = String::from_utf8(inject_key_bridge(html.to_vec())).unwrap();
        assert!(
            injected.find("window.own=true").unwrap() < injected.find("pirep-keydown").unwrap()
        );
        assert!(injected.contains("parent.postMessage"));
        assert!(injected.contains("'.slide'"));
        assert!(injected.contains("'section[data-label]'"));
        assert!(injected.contains("'pirep-slides-command'"));
        assert!(injected.contains("'pirep-slides-state'"));
        assert!(injected.contains("'pirep-preview-location'"));
        assert!(injected.contains("'pirep-external-link'"));
        assert!(injected.contains("'pirep-preview-command'"));
    }
}
