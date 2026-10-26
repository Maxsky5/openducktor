# OpenDucktor network

This local Expo module sends streaming HTTP requests for the mobile `RemoteTransport`.
`src/platform/native-remote-transport.ts` uses it.
Expo autolinking finds the module in `apps/mobile/modules`.

## API

`index.ts` exports `OpenDucktorNetwork` and its types.

- `start(requestId, method, url, headers, body)` sends the request. It resolves with `{ status, headers }` when the response head arrives.
- `read(requestId)` resolves the next body chunk as a `Uint8Array`. It resolves `null` at the end of the body.
- `cancel(requestId)` releases the native request. Pending `start` and `read` calls reject with `ERR_ODT_CANCELED`.

The caller supplies a unique request ID for each request.
A `read` call for an unknown request ID rejects with `ERR_ODT_CANCELED`.

## Rules

- The module never follows a redirect. It returns the 3xx head as it is.
- The module keeps no cookies, no HTTP cache, and no stored credentials.
- The module uses only the platform certificate trust. It has no custom trust manager, no pinning, and no hostname verifier.
- The module sends only the headers that the caller supplies. The platform adds its transport headers, such as `Host` and `Accept-Encoding`.
- Response header names are lowercase. The module joins repeated values with ", ".
- The body has no request timeout, because event streams stay open for hours.
- Android uses a 10 second connect timeout and no read timeout.
- iOS sets a request interval of one day, so idle event streams stay open.
- Android tries the next host address after a connect failure. It never sends a request body twice, so a host command never runs twice. It can resend a request with no body, such as a `GET`.
- Each request reads its body ahead of JavaScript, so one `read` call gets every buffered byte. Above 1 MiB of buffered data, iOS pauses the task and Android stops reading until the next `read` call.
- On Android, module creation configures the React Native WebSocket client to not follow redirects. A terminal upgrade that does not answer 101 then fails, as it does on iOS.

## Errors

Each rejection has a `code` and the platform `message`.
The module classifies a failure from structured platform data only.

| Code | iOS | Android |
|---|---|---|
| `ERR_ODT_TLS` | A server or client certificate `NSURLError` code | An `SSLPeerUnverifiedException`, `CertificateException`, or `CertPathValidatorException` cause |
| `ERR_ODT_TIMEOUT` | `NSURLErrorTimedOut` | An `InterruptedIOException`, such as `SocketTimeoutException` |
| `ERR_ODT_LOCAL_NETWORK_DENIED` | A network path with the `localNetworkDenied` unsatisfied reason | Never |
| `ERR_ODT_CANCELED` | `NSURLErrorCancelled`, `cancel`, or module destruction | A canceled OkHttp call, `cancel`, or module destruction |
| `ERR_ODT_NETWORK` | All other failures, including `secureConnectionFailed` and `appTransportSecurityRequiresSecureConnection` | All other failures, including an `SSLHandshakeException` with no certificate cause and an `SSLException` on an open TLS stream |
