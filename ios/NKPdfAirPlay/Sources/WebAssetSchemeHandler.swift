import Foundation
import WebKit

final class WebAssetSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "nkpdf"

    private let rootURL: URL

    init(rootFolderName: String = "WebAssets") {
        if let resURL = Bundle.main.resourceURL?.appendingPathComponent(rootFolderName, isDirectory: true),
           FileManager.default.fileExists(atPath: resURL.path) {
            self.rootURL = resURL
        } else {
            self.rootURL = Bundle.main.bundleURL
        }
        super.init()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(NSError(domain: "NKPdfWeb", code: 400))
            return
        }

        var relPath = url.path
        if relPath.hasPrefix("/") {
            relPath.removeFirst()
        }
        if relPath.isEmpty {
            relPath = "index.html"
        }

        let targetURL = rootURL.appendingPathComponent(relPath).standardizedFileURL
        guard targetURL.path.hasPrefix(rootURL.standardizedFileURL.path),
              let data = try? Data(contentsOf: targetURL) else {
            let response = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: nil)!
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didFinish()
            return
        }

        let mime = mimeType(for: targetURL.pathExtension.lowercased())
        let headers: [String: String] = [
            "Content-Type": mime,
            "Content-Length": "\(data.count)",
            "Cache-Control": "no-store"
        ]
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    private func mimeType(for ext: String) -> String {
        switch ext {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js", "mjs": return "application/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "woff2": return "font/woff2"
        case "woff": return "font/woff"
        case "ttf": return "font/ttf"
        case "pdf": return "application/pdf"
        default: return "application/octet-stream"
        }
    }
}
