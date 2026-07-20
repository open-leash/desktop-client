import AppKit
import Foundation
import WebKit

private func writeMessage(_ message: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(message),
          let data = try? JSONSerialization.data(withJSONObject: message),
          let line = String(data: data, encoding: .utf8) else { return }
    FileHandle.standardOutput.write(Data((line + "\n").utf8))
}

private final class IslandPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

private final class FirstMouseWebView: WKWebView {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

@MainActor
private final class IslandController: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    private let panel: IslandPanel
    private let webView: FirstMouseWebView
    private var screen: NSScreen?
    private var pendingPayload: [String: Any]?
    private var pageReady = false

    init(htmlPath: String) {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.addUserScript(WKUserScript(
            source: "window.__OPENLEASH_NATIVE_ISLAND__ = true;",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))

        webView = FirstMouseWebView(frame: .zero, configuration: configuration)
        panel = IslandPanel(
            contentRect: NSRect(x: 0, y: 0, width: 300, height: 48),
            styleMask: [.borderless, .nonactivatingPanel, .utilityWindow, .hudWindow],
            backing: .buffered,
            defer: false
        )
        super.init()

        configuration.userContentController.add(self, name: "openleash")
        webView.navigationDelegate = self
        webView.autoresizingMask = [.width, .height]
        webView.setValue(false, forKey: "drawsBackground")
        webView.layer?.backgroundColor = NSColor.clear.cgColor

        panel.isFloatingPanel = true
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.isMovable = false
        panel.isMovableByWindowBackground = false
        panel.level = .screenSaver
        panel.collectionBehavior = [
            .canJoinAllSpaces,
            .fullScreenAuxiliary,
            .stationary,
            .ignoresCycle
        ]
        panel.contentView = webView

        let fileURL = URL(fileURLWithPath: htmlPath)
        webView.loadFileURL(fileURL, allowingReadAccessTo: fileURL.deletingLastPathComponent())
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        pageReady = true
        writeMessage(["type": "ready", "windowId": panel.windowNumber])
        if let pendingPayload {
            show(payload: pendingPayload)
        }
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard let body = message.body as? [String: Any],
              let type = body["type"] as? String else { return }

        if type == "resize" {
            let width = (body["width"] as? NSNumber)?.doubleValue ?? 300
            let height = (body["height"] as? NSNumber)?.doubleValue ?? 48
            resize(width: width, height: height)
            return
        }

        if type == "action" {
            writeMessage(body)
        }
    }

    func show(payload: [String: Any]) {
        pendingPayload = payload
        guard pageReady else { return }
        screen = activeScreen()
        place(width: panel.frame.width, height: panel.frame.height)
        panel.level = .screenSaver
        panel.orderFrontRegardless()

        guard JSONSerialization.isValidJSONObject(payload),
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        let quoted = String(data: try! JSONSerialization.data(withJSONObject: [json]), encoding: .utf8)!
        let stringLiteral = String(quoted.dropFirst().dropLast())
        let metrics = displayMetrics(for: screen ?? activeScreen())
        let metricsJSON = String(
            data: try! JSONSerialization.data(withJSONObject: metrics),
            encoding: .utf8
        )!
        webView.evaluateJavaScript("window.setOpenLeashDisplayMetrics(\(metricsJSON)); window.renderOpenLeashNotice(JSON.parse(\(stringLiteral)))")
    }

    func dismiss() {
        pendingPayload = nil
        webView.evaluateJavaScript("window.dismissOpenLeashNotice && window.dismissOpenLeashNotice()")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
            guard self?.pendingPayload == nil else { return }
            self?.panel.orderOut(nil)
        }
    }

    func inspect() {
        let display = screen ?? activeScreen()
        let metrics = displayMetrics(for: display)
        webView.evaluateJavaScript("window.inspectOpenLeashIsland && window.inspectOpenLeashIsland()") { [weak self] result, _ in
            guard let self else { return }
            var state: [String: Any] = [
                "type": "state",
                "visible": self.panel.isVisible,
                "frame": [
                    "x": self.panel.frame.origin.x,
                    "y": self.panel.frame.origin.y,
                    "width": self.panel.frame.width,
                    "height": self.panel.frame.height,
                    "topInset": display.frame.maxY - self.panel.frame.maxY
                ],
                "display": metrics
            ]
            if let layout = result as? [String: Any] {
                state["layout"] = layout
            }
            writeMessage(state)
        }
    }

    func expandActivityForVerification() {
        webView.evaluateJavaScript("document.body.classList.contains('has-display-notch') ? document.getElementById('notchRail').click() : document.getElementById('cap').click()")
    }

    private func resize(width requestedWidth: Double, height requestedHeight: Double) {
        let width = CGFloat(max(220, min(780, requestedWidth.rounded(.up))))
        let height = CGFloat(max(42, min(760, requestedHeight.rounded(.up))))
        place(width: width, height: height)
    }

    private func place(width: CGFloat, height: CGFloat) {
        let targetScreen = screen ?? activeScreen()
        screen = targetScreen
        let frame = targetScreen.frame
        let target = NSRect(
            x: frame.midX - width / 2,
            y: frame.maxY - height,
            width: width,
            height: height
        )
        panel.setFrame(target, display: true)
        if panel.isVisible {
            panel.orderFrontRegardless()
        }
    }

    private func displayMetrics(for display: NSScreen) -> [String: Any] {
        var safeTop: CGFloat = 0
        var notchWidth: CGFloat = 0
        var hasNotch = false

        if #available(macOS 12.0, *) {
            safeTop = max(0, display.safeAreaInsets.top)
            if let leftArea = display.auxiliaryTopLeftArea,
               let rightArea = display.auxiliaryTopRightArea {
                notchWidth = max(0, rightArea.minX - leftArea.maxX)
                hasNotch = notchWidth > 1
                if hasNotch {
                    safeTop = max(safeTop, min(leftArea.height, rightArea.height))
                }
            } else {
                hasNotch = safeTop > 0
            }
        }

        switch ProcessInfo.processInfo.environment["OPENLEASH_ISLAND_TEST_DISPLAY"] {
        case "notch":
            safeTop = 32
            notchWidth = 210
            hasNotch = true
        case "plain":
            safeTop = 0
            notchWidth = 0
            hasNotch = false
        default:
            break
        }

        return [
            "hasNotch": hasNotch,
            "safeTop": safeTop.rounded(.up),
            "notchWidth": notchWidth.rounded(.up)
        ]
    }

    private func activeScreen() -> NSScreen {
        let pointer = NSEvent.mouseLocation
        return NSScreen.screens.first(where: { NSMouseInRect(pointer, $0.frame, false) })
            ?? NSScreen.main
            ?? NSScreen.screens[0]
    }
}

@main
private struct OpenLeashIslandApplication {
    static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)

        guard CommandLine.arguments.count > 1 else {
            writeMessage(["type": "error", "message": "notice.html path is required"])
            exit(2)
        }

        let controller = IslandController(htmlPath: CommandLine.arguments[1])
        DispatchQueue.global(qos: .userInitiated).async {
            while let line = readLine() {
                guard let data = line.data(using: .utf8),
                      let message = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let type = message["type"] as? String else { continue }
                DispatchQueue.main.async {
                    switch type {
                    case "show":
                        if let payload = message["payload"] as? [String: Any] {
                            controller.show(payload: payload)
                        }
                    case "dismiss":
                        controller.dismiss()
                    case "inspect":
                        controller.inspect()
                    case "expandActivity":
                        controller.expandActivityForVerification()
                    case "quit":
                        controller.dismiss()
                        app.terminate(nil)
                    default:
                        break
                    }
                }
            }
            DispatchQueue.main.async { app.terminate(nil) }
        }

        app.run()
    }
}
