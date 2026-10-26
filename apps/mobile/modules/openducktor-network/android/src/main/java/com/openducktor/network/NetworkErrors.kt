package com.openducktor.network

import expo.modules.kotlin.exception.CodedException
import java.io.InterruptedIOException
import java.security.cert.CertPathValidatorException
import java.security.cert.CertificateException
import javax.net.ssl.SSLPeerUnverifiedException
import okhttp3.Call

/** The `code` of each JavaScript rejection. Android has no Local Network permission, so it never reports `ERR_ODT_LOCAL_NETWORK_DENIED`. */
internal enum class NetworkErrorCode(val value: String) {
  NETWORK("ERR_ODT_NETWORK"),
  TIMEOUT("ERR_ODT_TIMEOUT"),
  TLS("ERR_ODT_TLS"),
  CANCELED("ERR_ODT_CANCELED")
}

internal fun networkException(code: NetworkErrorCode, message: String): CodedException =
  CodedException(code.value, message, null)

internal fun canceledException(): CodedException =
  networkException(NetworkErrorCode.CANCELED, "The request was canceled.")

/** Classifies a failure from the call state and the exception types. The message keeps the platform text. */
internal fun networkException(error: Exception, call: Call): CodedException {
  val code = when {
    call.isCanceled() -> NetworkErrorCode.CANCELED
    hasTlsCause(error) -> NetworkErrorCode.TLS
    // SocketTimeoutException is an InterruptedIOException. OkHttp also uses InterruptedIOException for its own timeouts.
    error is InterruptedIOException -> NetworkErrorCode.TIMEOUT
    else -> NetworkErrorCode.NETWORK
  }
  return networkException(code, error.message ?: error.toString())
}

/**
 * Only a failed certificate check is a TLS failure, which the app never retries on its own.
 * Conscrypt reports an untrusted chain as an `SSLHandshakeException` with a certificate cause, and
 * OkHttp reports a host name mismatch as `SSLPeerUnverifiedException`. An `SSLHandshakeException`
 * with no certificate cause, such as a socket that closes or resets during the handshake, is a
 * network failure, so the app retries it.
 */
private fun hasTlsCause(error: Throwable): Boolean =
  generateSequence(error) { it.cause }.any {
    it is SSLPeerUnverifiedException || it is CertificateException || it is CertPathValidatorException
  }
