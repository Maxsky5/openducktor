import ExpoModulesCore
import Foundation
import Network

/// The `code` of each JavaScript rejection.
enum NetworkErrorCode: String {
  case network = "ERR_ODT_NETWORK"
  case timeout = "ERR_ODT_TIMEOUT"
  case tls = "ERR_ODT_TLS"
  case localNetworkDenied = "ERR_ODT_LOCAL_NETWORK_DENIED"
  case canceled = "ERR_ODT_CANCELED"
}

func networkException(_ code: NetworkErrorCode, _ message: String) -> Exception {
  return Exception(name: "OpenDucktorNetworkException", description: message, code: code.rawValue)
}

/// Classifies a URL session failure from its error domain, code, and network path. The message keeps the platform text.
func networkException(for error: Error) -> Exception {
  let nsError = error as NSError
  return networkException(networkErrorCode(for: nsError), nsError.localizedDescription)
}

private func networkErrorCode(for error: NSError) -> NetworkErrorCode {
  guard error.domain == NSURLErrorDomain else {
    return .network
  }
  if error.code == NSURLErrorCancelled {
    return .canceled
  }
  if reportsLocalNetworkDenied(error) {
    return .localNetworkDenied
  }
  switch error.code {
  case NSURLErrorTimedOut:
    return .timeout
  // Only a certificate failure is a TLS failure, which the app never retries on its own.
  case NSURLErrorServerCertificateHasBadDate,
    NSURLErrorServerCertificateUntrusted,
    NSURLErrorServerCertificateHasUnknownRoot,
    NSURLErrorServerCertificateNotYetValid,
    NSURLErrorClientCertificateRejected,
    NSURLErrorClientCertificateRequired:
    return .tls
  default:
    // This includes NSURLErrorAppTransportSecurityRequiresSecureConnection and
    // NSURLErrorSecureConnectionFailed. CFNetwork also reports NSURLErrorSecureConnectionFailed for
    // a socket that closes during the handshake, so the app retries it.
    return .network
  }
}

/// URL session failures carry the network path under `_NSURLErrorNWPathKey`, on the error or on an underlying error.
/// The value is an `nw_path_t`. The Swift `NWPath` structure does not bridge from it, so read the reason with the C function.
private func reportsLocalNetworkDenied(_ error: NSError) -> Bool {
  var current: NSError? = error
  while let candidate = current {
    if let path = candidate.userInfo["_NSURLErrorNWPathKey"] as? nw_path_t,
      nw_path_get_unsatisfied_reason(path) == nw_path_unsatisfied_reason_local_network_denied
    {
      return true
    }
    current = candidate.userInfo[NSUnderlyingErrorKey] as? NSError
  }
  return false
}
