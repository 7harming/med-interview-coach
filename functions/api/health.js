import { handleHealth } from "../_lib/handlers.js";

export function onRequest(context) {
  return handleHealth(context.request, context.env);
}
