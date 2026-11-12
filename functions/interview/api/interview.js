import { handleInterview } from "../../_lib/handlers.js";

export function onRequest(context) {
  return handleInterview(context.request, context.env);
}
