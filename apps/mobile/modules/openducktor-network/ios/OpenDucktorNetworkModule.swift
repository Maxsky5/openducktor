import ExpoModulesCore

public final class OpenDucktorNetworkModule: Module {
  private let client = NetworkClient()

  public func definition() -> ModuleDefinition {
    Name("OpenDucktorNetwork")

    // `start` and `read` run on the client queue. `cancel` enqueues on the same serial queue
    // from the JavaScript thread, so the client handles the three calls in JavaScript call order.
    AsyncFunction("start") {
      (requestId: String, method: String, url: String, headers: [String: String], body: String?, promise: Promise) in
      client.start(requestId: requestId, method: method, url: url, headers: headers, body: body, promise: promise)
    }.runOnQueue(client.queue)

    AsyncFunction("read") { (requestId: String, promise: Promise) in
      client.read(requestId: requestId, promise: promise)
    }.runOnQueue(client.queue)

    Function("cancel") { (requestId: String) in
      client.cancel(requestId: requestId)
    }

    OnDestroy {
      client.invalidate()
    }
  }
}
