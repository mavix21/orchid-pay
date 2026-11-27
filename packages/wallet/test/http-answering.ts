import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientError from "effect/http/HttpClientError";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

export const jsonResponse = (body: string) =>
  new Response(body, { headers: { "Content-Type": "application/json" } });

export const bodyText = (req: HttpClientRequest.HttpClientRequest) =>
  Predicate.isTagged(req.body, "Uint8Array")
    ? new TextDecoder().decode(req.body.body)
    : "";

export const httpClientAnswering = (
  reply: (
    request: HttpClientRequest.HttpClientRequest,
  ) => Effect.Effect<Response, HttpClientError.HttpClientError>,
) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      reply(request).pipe(
        Effect.map((res) => HttpClientResponse.fromWeb(request, res)),
      ),
    ),
  );
