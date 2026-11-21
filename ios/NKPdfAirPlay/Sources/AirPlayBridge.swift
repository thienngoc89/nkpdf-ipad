import Foundation
import WebKit

final class AirPlayBridge: NSObject {
    static let shared = AirPlayBridge()

    private weak var primaryWebView: WKWebView?
    private weak var externalWebView: WKWebView?
    private var isExternalReady = false
    private var latestSnapshotJSON: String?

    private override init() {
        super.init()
    }

    func attachPrimaryWebView(_ webView: WKWebView) {
        primaryWebView = webView
    }

    func attachExternalWebView(_ webView: WKWebView) {
        externalWebView = webView
        isExternalReady = false
    }

    func detachExternalWebView() {
        externalWebView = nil
        isExternalReady = false
    }

    func handlePrimaryMessage(_ body: Any) {
        guard let jsonString = serializeJSON(body) else { return }
        if let dict = body as? [String: Any], (dict["type"] as? String) == "board_snapshot" {
            latestSnapshotJSON = jsonString
        }
        forwardToExternal(jsonString)
    }

    func handleExternalReady() {
        isExternalReady = true
        if let snapshot = latestSnapshotJSON {
            forwardToExternal(snapshot)
        }
        DispatchQueue.main.async { [weak self] in
            self?.primaryWebView?.evaluateJavaScript("window.__nkpdfRequestAirPlaySnapshot && window.__nkpdfRequestAirPlaySnapshot();", completionHandler: nil)
        }
    }

    private func forwardToExternal(_ jsonString: String) {
        guard isExternalReady, let ext = externalWebView else { return }
        let js = "window.__nkpdfReceiveAirPlayState && window.__nkpdfReceiveAirPlayState(\(jsonString));"
        DispatchQueue.main.async {
            ext.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    private func serializeJSON(_ body: Any) -> String? {
        if let str = body as? String {
            return str
        }
        guard JSONSerialization.isValidJSONObject(body),
              let data = try? JSONSerialization.data(withJSONObject: body, options: []),
              let str = String(data: data, encoding: .utf8) else {
            return nil
        }
        return str
    }
}
