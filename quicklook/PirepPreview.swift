import AppKit
import Foundation
import QuickLookUI
import WebKit

@objc(PirepPreviewViewController)
final class PirepPreviewViewController: NSViewController, QLPreviewingController, WKNavigationDelegate {
    private var webView: WKWebView!
    private let errorLabel = NSTextField(wrappingLabelWithString: "")
    private var pendingMarkdown: String?

    override func loadView() {
        let configuration = WKWebViewConfiguration()
        let preferences = WKWebpagePreferences()
        preferences.allowsContentJavaScript = true
        configuration.defaultWebpagePreferences = preferences

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        let container = NSView()
        webView.translatesAutoresizingMaskIntoConstraints = false
        errorLabel.translatesAutoresizingMaskIntoConstraints = false
        errorLabel.alignment = .center
        errorLabel.maximumNumberOfLines = 0
        errorLabel.lineBreakMode = .byWordWrapping
        errorLabel.textColor = .secondaryLabelColor
        errorLabel.isHidden = true
        container.addSubview(webView)
        container.addSubview(errorLabel)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            webView.topAnchor.constraint(equalTo: container.topAnchor),
            webView.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            errorLabel.centerXAnchor.constraint(equalTo: container.centerXAnchor),
            errorLabel.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            errorLabel.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 24),
            errorLabel.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -24),
        ])
        view = container
    }

    func preparePreviewOfFile(at url: URL, completionHandler: @escaping (Error?) -> Void) {
        do {
            _ = view
            webView.isHidden = false
            errorLabel.isHidden = true
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
        webView.evaluateJavaScript("""
        if (typeof window.renderQuickLook !== "function") throw new Error("Renderer script did not start");
        window.renderQuickLook((\(json))[0]);
        true;
        """) { _, error in
            if let error { self.show(error) }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        show(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        show(error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        show(NSError(domain: "PirepPreview", code: 1, userInfo: [
            NSLocalizedDescriptionKey: "The web content process terminated.",
        ]))
    }

    private func show(_ error: Error) {
        errorLabel.stringValue = "Preview unavailable\n\(error.localizedDescription)"
        webView.isHidden = true
        errorLabel.isHidden = false
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        decisionHandler(navigationAction.navigationType == .linkActivated ? .cancel : .allow)
    }
}
