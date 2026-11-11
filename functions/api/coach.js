import { handleCoach } from "../_lib/handlers.js";

export function onRequest(context) {
  return handleCoach(context.request, context.env);
}
