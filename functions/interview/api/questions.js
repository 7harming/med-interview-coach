import { handleQuestions } from "../../_lib/handlers.js";

export function onRequest(context) {
  return handleQuestions(context.request, context.env);
}
