import UIKit

final class ExternalDisplaySceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        window.frame = windowScene.screen.bounds
        window.backgroundColor = UIColor(red: 0.078, green: 0.090, blue: 0.102, alpha: 1.0)
        window.rootViewController = ExternalDisplayViewController()
        window.isHidden = false
        self.window = window
    }

    func sceneDidDisconnect(_ scene: UIScene) {
        AirPlayBridge.shared.detachExternalWebView()
        window?.isHidden = true
        window = nil
    }
}
