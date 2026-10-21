import { z } from "zod";

/**
 * CDP payloads that the browser feature and the engines read. Chromium can add fields, so objects
 * stay open.
 */

/** Command parameters, results, and event parameters before a reader parses them. */
export const cdpPayloadSchema = z.record(z.string(), z.json());

export const executionContextCreatedSchema = z.object({
  context: z.object({
    id: z.number().int(),
    name: z.string(),
    origin: z.string(),
    auxData: z
      .object({ frameId: z.string().optional(), isDefault: z.boolean().optional() })
      .loose()
      .optional(),
  }),
});

export const executionContextDestroyedSchema = z.object({ executionContextId: z.number().int() });

const cdpRemoteObjectSchema = z.object({
  type: z.string(),
  subtype: z.string().optional(),
  value: z.json().optional(),
  unserializableValue: z.string().optional(),
  description: z.string().optional(),
  objectId: z.string().optional(),
});
type CdpRemoteObject = z.infer<typeof cdpRemoteObjectSchema>;

const callFrameSchema = z.object({
  url: z.string(),
  lineNumber: z.number(),
  columnNumber: z.number(),
});

const stackTraceSchema = z.object({ callFrames: z.array(callFrameSchema) });

export const frameNavigatedSchema = z.object({
  frame: z.object({
    id: z.string(),
    parentId: z.string().optional(),
    url: z.string(),
    urlFragment: z.string().optional(),
    unreachableUrl: z.string().optional(),
  }),
});

export const navigatedWithinDocumentSchema = z.object({ frameId: z.string(), url: z.string() });

export const frameIdEventSchema = z.object({ frameId: z.string() });

export const frameRequestedNavigationSchema = z.object({
  frameId: z.string(),
  url: z.string(),
});

export const frameTreeResultSchema = z.object({
  frameTree: z.object({ frame: z.object({ id: z.string(), url: z.string() }) }),
});

export const navigationHistoryResultSchema = z.object({
  currentIndex: z.number().int(),
  entries: z.array(z.object({ id: z.number().int(), url: z.string(), title: z.string() })),
});

export const javascriptDialogOpeningSchema = z.object({
  message: z.string(),
  type: z.enum(["alert", "confirm", "prompt", "beforeunload"]),
  defaultPrompt: z.string().optional(),
});

export const fileChooserOpenedSchema = z.object({
  frameId: z.string(),
  mode: z.enum(["selectSingle", "selectMultiple"]),
  backendNodeId: z.number().int().optional(),
});

export const consoleApiCalledSchema = z.object({
  type: z.string(),
  args: z.array(cdpRemoteObjectSchema),
  stackTrace: stackTraceSchema.optional(),
});

export const exceptionThrownSchema = z.object({
  exceptionDetails: z.object({
    text: z.string(),
    url: z.string().optional(),
    lineNumber: z.number(),
    columnNumber: z.number(),
    exception: cdpRemoteObjectSchema.optional(),
    stackTrace: stackTraceSchema.optional(),
  }),
});

export const logEntryAddedSchema = z.object({
  entry: z.object({
    level: z.enum(["verbose", "info", "warning", "error"]),
    text: z.string(),
    url: z.string().optional(),
    lineNumber: z.number().optional(),
  }),
});

export const bindingCalledSchema = z.object({
  name: z.string(),
  payload: z.string(),
  executionContextId: z.number().int(),
});

export const requestWillBeSentSchema = z.object({
  requestId: z.string(),
  frameId: z.string().optional(),
  type: z.string().optional(),
  request: z.object({ url: z.string() }),
});

export const loadingFailedSchema = z.object({
  requestId: z.string(),
  errorText: z.string(),
  canceled: z.boolean().optional(),
});

export const evaluateResultSchema = z.object({
  result: cdpRemoteObjectSchema,
  exceptionDetails: z.object({ text: z.string() }).optional(),
});

export const loadNetworkResourceResultSchema = z.object({
  resource: z.object({
    success: z.boolean(),
    httpStatusCode: z.number().optional(),
    stream: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
  }),
});

export const ioReadResultSchema = z.object({
  data: z.string(),
  eof: z.boolean(),
  base64Encoded: z.boolean().optional(),
});

export const nodeForLocationResultSchema = z.object({
  backendNodeId: z.number().int(),
  frameId: z.string().optional(),
});

export const boxModelResultSchema = z.object({
  model: z.object({ border: z.array(z.number()).length(8) }),
});

export const resolveNodeResultSchema = z.object({ object: cdpRemoteObjectSchema });

export const partialAxTreeResultSchema = z.object({
  nodes: z.array(
    z.object({
      ignored: z.boolean().optional(),
      role: z.object({ value: z.json().optional() }).optional(),
      name: z.object({ value: z.json().optional() }).optional(),
    }),
  ),
});

export const screenshotResultSchema = z.object({ data: z.string() });

export const layoutMetricsResultSchema = z.object({
  cssVisualViewport: z.object({
    clientWidth: z.number(),
    clientHeight: z.number(),
    pageX: z.number(),
    pageY: z.number(),
  }),
});

/** `Target.attachedToTarget` and `Target.detachedFromTarget` name the flat session. */
export const targetSessionEventSchema = z.object({ sessionId: z.string() });

export const targetInfoResultSchema = z.object({
  targetInfo: z.object({
    targetId: z.string(),
    type: z.string(),
    title: z.string(),
    url: z.string(),
    attached: z.boolean().optional(),
    openerId: z.string().optional(),
    browserContextId: z.string().optional(),
  }),
});

/** Text of one console argument, the way DevTools shows it in one line. */
export const remoteObjectText = (value: CdpRemoteObject): string => {
  if (value.unserializableValue !== undefined) {
    return value.unserializableValue;
  }
  if (value.value !== undefined) {
    return JSON.stringify(value.value) ?? "undefined";
  }
  return value.description ?? `[${value.subtype ?? value.type}]`;
};
