import { handleTranscribe } from "../../_lib/handlers.js";

export function onRequest(context) {
  return handleTranscribe(context.request, context.env);
}
