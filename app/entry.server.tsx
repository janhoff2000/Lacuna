import { PassThrough } from "node:stream";

import { createReadableStreamFromReadable } from "@react-router/node";
import type { EntryContext } from "react-router";
import { ServerRouter } from "react-router";
import { renderToPipeableStream } from "react-dom/server";
import { isbot } from "isbot";

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext,
  _loadContext: unknown,
) {
  void _loadContext;
  return new Promise<Response>((resolve, reject) => {
    const callbackName = isbot(request.headers.get("user-agent") ?? "")
      ? "onAllReady"
      : "onShellReady";
    let shellRendered = false;

    const { abort, pipe } = renderToPipeableStream(
      <ServerRouter context={reactRouterContext} url={request.url} />,
      {
        [callbackName]() {
          shellRendered = true;
          const body = new PassThrough();
          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(createReadableStreamFromReadable(body), {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
          pipe(body);
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = shellRendered ? responseStatusCode : 500;
          console.error(error);
        },
      },
    );

    setTimeout(abort, 5_000);
  });
}
