package com.openducktor.network

import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.launch
import okhttp3.Call
import okhttp3.CookieJar
import okhttp3.Headers
import okhttp3.ConnectionPool
import okhttp3.MediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.Response
import okio.Buffer
import okio.BufferedSink

/** The number of body bytes that one request buffers before it stops reading, as on iOS. */
private const val MAX_BUFFERED_BYTES = 1L shl 20
private const val WHOLE_BODY_PART_BYTES = 64L * 1024

/** The state of one request. Only [NetworkClient.control] reads or writes it. */
private class NetworkRequest(val call: Call) {
  var response: Response? = null
  val body = Buffer()
  var pendingRead: Promise? = null
  /** A body read runs on the io pool. Only one runs at a time, and only it uses the response body. */
  var reading = false
  var finished = false
  var failure: CodedException? = null
  /** True for a JSON body, which JavaScript reads whole. Event streams get each part at once. */
  var whole = false
}

/**
 * Owns one OkHttp client and the state of each request.
 * [control] is a single-thread scope that orders start, read, and cancel calls, and owns all request state.
 * Blocking network calls run on a separate pool, so an idle stream never blocks another request.
 * Each request reads its body ahead of JavaScript, as on iOS, so one `read` call gets every buffered byte.
 */
internal class NetworkClient {
  private val controlExecutor = Executors.newSingleThreadExecutor { runnable -> Thread(runnable, "OpenDucktorNetwork-control") }
  private val ioExecutor = Executors.newCachedThreadPool { runnable -> Thread(runnable, "OpenDucktorNetwork-io") }
  val control = CoroutineScope(SupervisorJob() + controlExecutor.asCoroutineDispatcher())
  private val io = CoroutineScope(SupervisorJob() + ioExecutor.asCoroutineDispatcher())
  private val requests = ConcurrentHashMap<String, NetworkRequest>()

  // A fresh client: React Native's shared client has a cookie jar and can have a cache.
  // Platform trust only: no custom trust manager, pinning, or hostname verifier.
  private val http = OkHttpClient.Builder()
    .followRedirects(false)
    .followSslRedirects(false)
    // OkHttp never resends a one-shot body, so a command on an idle connection that the host already
    // closed fails. Node closes idle connections after 5 seconds, so the pool drops them after 4 seconds.
    .connectionPool(ConnectionPool(5, 4, TimeUnit.SECONDS))
    .cookieJar(CookieJar.NO_COOKIES)
    .connectTimeout(10, TimeUnit.SECONDS)
    // Event streams stay open for hours, so reads have no timeout.
    .readTimeout(0, TimeUnit.MILLISECONDS)
    .build()

  /** Runs on [control]. */
  fun start(requestId: String, method: String, url: String, headers: Map<String, String>, body: String?, promise: Promise) {
    val call = try {
      http.newCall(buildRequest(method, url, headers, body))
    } catch (error: IllegalArgumentException) {
      promise.reject(networkException(NetworkErrorCode.NETWORK, error.message ?: error.toString()))
      return
    }
    val request = NetworkRequest(call)
    requests[requestId] = request
    io.launch {
      val response = try {
        call.execute()
      } catch (error: Exception) {
        requests.remove(requestId, request)
        promise.reject(networkException(error, call))
        return@launch
      }
      control.launch {
        if (requests[requestId] !== request) {
          // `cancel` removed the request before the head arrived.
          closeResponse(response)
          promise.reject(canceledException())
          return@launch
        }
        request.response = response
        request.whole = response.header("Content-Type")?.startsWith("application/json") == true
        promise.resolve(mapOf("status" to response.code, "headers" to lowercasedHeaders(response.headers)))
        readAhead(requestId, request, response)
      }
    }
  }

  /** Runs on [control]. Resolves every buffered byte at once, or waits for the next bytes. */
  fun read(requestId: String, promise: Promise) {
    val request = requests[requestId]
    if (request == null) {
      promise.reject(canceledException())
      return
    }
    val response = request.response
    if (response == null) {
      promise.reject(networkException(NetworkErrorCode.NETWORK, "The response head has not arrived."))
      return
    }
    request.pendingRead = promise
    deliver(requestId, request)
    readAhead(requestId, request, response)
  }

  /** Runs on the JavaScript thread. A canceled call fails its pending execute or read with a canceled error. */
  fun cancel(requestId: String) {
    control.launch {
      val request = requests.remove(requestId) ?: return@launch
      request.call.cancel()
      request.pendingRead?.reject(canceledException())
      request.pendingRead = null
      // A running body read closes the response when it ends.
      val response = request.response
      if (response != null && !request.reading) closeResponse(response)
    }
  }

  /** The close task runs after the queued calls and settles each pending read. Then both pools stop. */
  fun close() {
    control.launch {
      for (request in requests.values) {
        request.call.cancel()
        request.pendingRead?.reject(canceledException())
      }
      requests.clear()
    }
    controlExecutor.shutdown()
    ioExecutor.shutdown()
  }

  /** Runs on [control]. Reads the next part of the body unless a read runs, the body ended, or the buffer is full. */
  private fun readAhead(requestId: String, request: NetworkRequest, response: Response) {
    if (request.reading || request.finished || request.body.size >= MAX_BUFFERED_BYTES) return
    request.reading = true
    io.launch {
      val chunk = Buffer()
      try {
        // Okio returns the bytes of one socket read, at most 8 KiB.
        val count = checkNotNull(response.body).source().read(chunk, MAX_BUFFERED_BYTES)
        control.launch {
          if (count == -1L) finish(requestId, request, response, null) else append(requestId, request, response, chunk)
        }
      } catch (error: Exception) {
        val failure = networkException(error, request.call)
        control.launch { finish(requestId, request, response, failure) }
      }
    }
  }

  /** Runs on [control]. */
  private fun append(requestId: String, request: NetworkRequest, response: Response, chunk: Buffer) {
    request.reading = false
    if (requests[requestId] !== request) {
      closeResponse(response)
      return
    }
    request.body.writeAll(chunk)
    deliver(requestId, request)
    readAhead(requestId, request, response)
  }

  /** Runs on [control] at the end of the body. [failure] is null when the body ended normally. */
  private fun finish(requestId: String, request: NetworkRequest, response: Response, failure: CodedException?) {
    request.reading = false
    request.finished = true
    request.failure = failure
    closeResponse(response)
    if (requests[requestId] === request) deliver(requestId, request)
  }

  /**
   * Runs on [control]. Settles the pending read with the buffered bytes first, then with the end of the body.
   * A JSON body goes in parts of at least [WHOLE_BODY_PART_BYTES], so a long history crosses to
   * JavaScript in a few calls instead of one for each socket read.
   */
  private fun deliver(requestId: String, request: NetworkRequest) {
    val promise = request.pendingRead ?: return
    val ready = !request.whole || request.finished || request.body.size >= WHOLE_BODY_PART_BYTES
    if (request.body.size > 0 && ready) {
      request.pendingRead = null
      promise.resolve(request.body.readByteArray())
      return
    }
    if (!request.finished) return
    request.pendingRead = null
    requests.remove(requestId, request)
    val failure = request.failure
    if (failure != null) promise.reject(failure) else promise.resolve(null)
  }

  /** Closing a response can read the rest of its body, so it runs on the io pool. */
  private fun closeResponse(response: Response) {
    io.launch { response.close() }
  }

  private fun buildRequest(method: String, url: String, headers: Map<String, String>, body: String?): Request {
    val requestBody = when {
      body != null -> OneShotBody(body.toByteArray(Charsets.UTF_8))
      method == "POST" -> OneShotBody(ByteArray(0))
      else -> null
    }
    val builder = Request.Builder().url(url).method(method, requestBody)
    for ((name, value) in headers) {
      builder.header(name, value)
    }
    return builder.build()
  }
}

/**
 * OkHttp tries the next address of the host after a connect failure. After it starts to send a
 * request, it can resend the request on a new connection, but never with a one-shot body. So a host
 * command never runs twice. The null media type keeps the caller's content-type header as the only
 * content type.
 */
private class OneShotBody(private val bytes: ByteArray) : RequestBody() {
  override fun contentType(): MediaType? = null

  override fun contentLength(): Long = bytes.size.toLong()

  override fun writeTo(sink: BufferedSink) {
    sink.write(bytes)
  }

  override fun isOneShot(): Boolean = true
}

private fun lowercasedHeaders(headers: Headers): Map<String, String> =
  headers.names().associate { name -> name.lowercase(Locale.ROOT) to headers.values(name).joinToString(", ") }
