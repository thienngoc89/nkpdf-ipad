import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        return true
    }

    func application(
        _ application: UIApplication,
        configurationForConnecting connectingSceneSession: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        if #available(iOS 16.0, *) {
            if connectingSceneSession.role == .windowExternalDisplayNonInteractive {
                let config = UISceneConfiguration(
                    name: "External Display Configuration",
                    sessionRole: connectingSceneSession.role
                )
                config.delegateClass = ExternalDisplaySceneDelegate.self
                return config
            }
        }
        if connectingSceneSession.role == .windowExternalDisplay {
            let config = UISceneConfiguration(
                name: "External Display Configuration",
                sessionRole: connectingSceneSession.role
            )
            config.delegateClass = ExternalDisplaySceneDelegate.self
            return config
        }

        let config = UISceneConfiguration(
            name: "Primary Configuration",
            sessionRole: connectingSceneSession.role
        )
        config.delegateClass = PrimarySceneDelegate.self
        return config
    }
}
