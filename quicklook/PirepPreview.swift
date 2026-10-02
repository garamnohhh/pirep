import AppKit
import Foundation
import QuickLookUI
import WebKit

@objc(PirepPreviewViewController)
final class PirepPreviewViewController: NSViewController, QLPreviewingController, WKNavigationDelegate {
    private var webView: WKWebView!
    private var pendingMarkdown: String?

    override func loadView() {
        let configuration = WKWebViewConfiguration()
        let preferences = WKWebpagePreferences()
        preferences.allowsContentJavaScript = true
        configuration.defaultWebpagePreferences = preferences

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        view = webView
    }

    func preparePreviewOfFile(at url: URL, completionHandler: @escaping (Error?) -> Void) {
        do {
            _ = view
            pendingMarkdown = try String(contentsOf: url, encoding: .utf8)
            let renderer = Bundle.main.resourceURL!.appendingPathComponent("Renderer/index.html")
            webView.loadFileURL(renderer, allowingReadAccessTo: renderer.deletingLastPathComponent())
            completionHandler(nil)
        } catch {
            completionHandler(error)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let markdown = pendingMarkdown,
              let data = try? JSONSerialization.data(withJSONObject: [markdown]),
              let json = String(data: data, encoding: .utf8) else { return }
        pendingMarkdown = nil
        webView.evaluateJavaScript("window.renderQuickLook && window.renderQuickLook((\(json))[0])")
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        decisionHandler(navigationAction.navigationType == .linkActivated ? .cancel : .allow)
    }
}
