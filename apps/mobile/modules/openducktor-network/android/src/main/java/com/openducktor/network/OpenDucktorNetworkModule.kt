package com.openducktor.network

import com.facebook.react.modules.network.CustomClientBuilder
import com.facebook.react.modules.websocket.WebSocketModule
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class OpenDucktorNetworkModule : Module() {
  private val client = NetworkClient()

  override fun definition() = ModuleDefinition {
    Name("OpenDucktorNetwork")

    OnCreate {
      // A terminal upgrade that answers with a redirect must fail, as it does on iOS.
      WebSocketModule.setCustomClientBuilder(
        CustomClientBuilder { builder ->
          builder.followRedirects(false).followSslRedirects(false)
        }
      )
    }

    OnDestroy {
      WebSocketModule.setCustomClientBuilder(null)
      client.close()
    }

    // `start` and `read` run on the client control scope. `cancel` launches on the same
    // single-thread scope from the JavaScript thread, so the client handles the three calls in
    // JavaScript call order.
    AsyncFunction("start") { requestId: String, method: String, url: String, headers: Map<String, String>, body: String?, promise: Promise ->
      client.start(requestId, method, url, headers, body, promise)
    }.runOnQueue(client.control)

    AsyncFunction("read") { requestId: String, promise: Promise ->
      client.read(requestId, promise)
    }.runOnQueue(client.control)

    Function("cancel") { requestId: String ->
      client.cancel(requestId)
    }
  }
}
