import UIKit
import WebKit

final class PrimaryViewController: UIViewController, WKScriptMessageHandler {
    private var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.078, green: 0.090, blue: 0.102, alpha: 1.0)

        let userContentController = WKUserContentController()
        userContentController.add(self, name: "nkpdfAirPlay")

        let config = WKWebViewConfiguration()
        config.userContentController = userContentController
        config.allowsInlineMediaPlayback = true
        config.setURLSchemeHandler(WebAssetSchemeHandler(), forURLScheme: WebAssetSchemeHandler.scheme)

        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = true
        webView.backgroundColor = view.backgroundColor
        view.addSubview(webView)

        AirPlayBridge.shared.attachPrimaryWebView(webView)

        if let url = URL(string: "\(WebAssetSchemeHandler.scheme)://app/index.html?nativeAirPlay=1") {
            webView.load(URLRequest(url: url))
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "nkpdfAirPlay" {
            AirPlayBridge.shared.handlePrimaryMessage(message.body)
        }
    }
}
