import ExpoModulesCore
import Foundation

/// The number of body bytes that one request buffers before its task pauses.
private let maxBufferedBytes = 1 << 20

/// The state of one request. Only the client queue reads or writes it.
private final class NetworkRequest {
  let task: URLSessionDataTask
  var startPromise: Promise?
  var pendingRead: Promise?
  var chunks: [Data] = []
  var bufferedBytes = 0
  var suspended = false
  var finished = false
  var failure: Exception?

  init(task: URLSessionDataTask, startPromise: Promise) {
    self.task = task
    self.startPromise = startPromise
  }
}

/// Owns one URL session and the state of each request.
/// The serial `queue` guards all state. The session delegate also runs on it, so the class is `@unchecked Sendable`.
final class NetworkClient: NSObject, URLSessionDataDelegate, @unchecked Sendable {
  let queue = DispatchQueue(label: "com.openducktor.network")
  private lazy var session = makeSession()
  private var requests: [String: NetworkRequest] = [:]
  private var requestIds: [Int: String] = [:]
  private var invalidated = false

  // MARK: - Calls from the module. `start` and `read` run on `queue`.

  func start(requestId: String, method: String, url: String, headers: [String: String], body: String?, promise: Promise) {
    if invalidated {
      promise.reject(networkException(.canceled, "The network module was destroyed."))
      return
    }
    guard let target = URL(string: url) else {
      promise.reject(networkException(.network, "The request URL is not valid: \(url)"))
      return
    }
    var request = URLRequest(url: target)
    request.httpMethod = method
    for (name, value) in headers {
      request.setValue(value, forHTTPHeaderField: name)
    }
    if let body {
      request.httpBody = Data(body.utf8)
    }
    let task = session.dataTask(with: request)
    requests[requestId] = NetworkRequest(task: task, startPromise: promise)
    requestIds[task.taskIdentifier] = requestId
    task.resume()
  }

  func read(requestId: String, promise: Promise) {
    guard let request = requests[requestId] else {
      promise.reject(networkException(.canceled, "The request was canceled."))
      return
    }
    if !request.chunks.isEmpty {
      promise.resolve(takeBufferedBody(request))
      return
    }
    if let failure = request.failure {
      remove(requestId: requestId, request: request)
      promise.reject(failure)
      return
    }
    if request.finished {
      remove(requestId: requestId, request: request)
      promise.resolve()
      return
    }
    request.pendingRead = promise
  }

  func cancel(requestId: String) {
    queue.async { [self] in
      guard let request = requests[requestId] else {
        return
      }
      remove(requestId: requestId, request: request)
      request.task.cancel()
      let canceled = networkException(.canceled, "The request was canceled.")
      request.startPromise?.reject(canceled)
      request.pendingRead?.reject(canceled)
    }
  }

  func invalidate() {
    queue.async { [self] in
      invalidated = true
      let canceled = networkException(.canceled, "The network module was destroyed.")
      for request in requests.values {
        request.startPromise?.reject(canceled)
        request.pendingRead?.reject(canceled)
      }
      requests.removeAll()
      requestIds.removeAll()
      // Invalidation cancels every task and releases the session's strong reference to this delegate.
      session.invalidateAndCancel()
    }
  }

  // MARK: - URLSessionDataDelegate. Each callback runs on `queue`.

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) {
    // Never follow a redirect. The redirect response arrives as the response head.
    completionHandler(nil)
  }

  func urlSession(
    _ session: URLSession,
    dataTask: URLSessionDataTask,
    didReceive response: URLResponse,
    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
  ) {
    guard let request = request(for: dataTask) else {
      completionHandler(.cancel)
      return
    }
    guard let startPromise = request.startPromise else {
      completionHandler(.allow)
      return
    }
    request.startPromise = nil
    guard let http = response as? HTTPURLResponse else {
      if let requestId = requestIds[dataTask.taskIdentifier] {
        remove(requestId: requestId, request: request)
      }
      completionHandler(.cancel)
      startPromise.reject(networkException(.network, "The response is not an HTTP response."))
      return
    }
    completionHandler(.allow)
    startPromise.resolve(["status": http.statusCode, "headers": lowercasedHeaders(of: http)] as [String: Any])
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    guard let request = request(for: dataTask) else {
      return
    }
    if let pendingRead = request.pendingRead {
      request.pendingRead = nil
      pendingRead.resolve(data)
      return
    }
    request.chunks.append(data)
    request.bufferedBytes += data.count
    if request.bufferedBytes > maxBufferedBytes && !request.suspended {
      request.suspended = true
      dataTask.suspend()
    }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    guard let requestId = requestIds[task.taskIdentifier], let request = requests[requestId] else {
      return
    }
    let failure = error.map(networkException(for:))
    if let startPromise = request.startPromise {
      remove(requestId: requestId, request: request)
      startPromise.reject(failure ?? networkException(.network, "The host closed the connection without a response."))
      return
    }
    if let pendingRead = request.pendingRead {
      remove(requestId: requestId, request: request)
      if let failure {
        pendingRead.reject(failure)
      } else {
        pendingRead.resolve()
      }
      return
    }
    request.finished = true
    request.failure = failure
  }

  // MARK: - Private

  private func makeSession() -> URLSession {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpCookieStorage = nil
    configuration.httpShouldSetCookies = false
    configuration.urlCache = nil
    configuration.urlCredentialStorage = nil
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    // The request interval limits idle time between packets. Event streams can stay idle for a long time.
    configuration.timeoutIntervalForRequest = 24 * 60 * 60
    configuration.timeoutIntervalForResource = 365 * 24 * 60 * 60
    // Event streams hold connections for hours. The iOS default of 4 connections per host
    // would queue host commands behind open streams.
    configuration.httpMaximumConnectionsPerHost = 64
    let delegateQueue = OperationQueue()
    delegateQueue.maxConcurrentOperationCount = 1
    delegateQueue.underlyingQueue = queue
    return URLSession(configuration: configuration, delegate: self, delegateQueue: delegateQueue)
  }

  private func request(for task: URLSessionTask) -> NetworkRequest? {
    guard let requestId = requestIds[task.taskIdentifier] else {
      return nil
    }
    return requests[requestId]
  }

  private func remove(requestId: String, request: NetworkRequest) {
    requests.removeValue(forKey: requestId)
    requestIds.removeValue(forKey: request.task.taskIdentifier)
  }

  private func takeBufferedBody(_ request: NetworkRequest) -> Data {
    var data = Data(capacity: request.bufferedBytes)
    for chunk in request.chunks {
      data.append(chunk)
    }
    request.chunks.removeAll()
    request.bufferedBytes = 0
    if request.suspended {
      request.suspended = false
      request.task.resume()
    }
    return data
  }
}

private func lowercasedHeaders(of response: HTTPURLResponse) -> [String: String] {
  var headers: [String: String] = [:]
  for (key, value) in response.allHeaderFields {
    guard let name = key as? String, let value = value as? String else {
      continue
    }
    let lowercased = name.lowercased()
    if let existing = headers[lowercased] {
      headers[lowercased] = "\(existing), \(value)"
    } else {
      headers[lowercased] = value
    }
  }
  return headers
}
