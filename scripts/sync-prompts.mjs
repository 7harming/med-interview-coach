import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);

function readText(path) {
  return readFileSync(new URL(path, root), "utf8");
}

const names = ["interviewer", "coach", "transcribe"];
const prompts = names
  .map((name) => `export const ${name} = ${JSON.stringify(readText(`prompts/${name}.md`))};`)
  .join("\n\n");
writeFileSync(new URL("functions/_lib/prompt-texts.js", root), `${prompts}\n`);

const questions = JSON.parse(readText("data/questions.json"));
const rubric = JSON.parse(readText("data/rubric.json"));
const data = `export const questions = ${JSON.stringify(questions)};\n\nexport const rubric = ${JSON.stringify(rubric)};\n`;
writeFileSync(new URL("functions/_lib/data.js", root), data);
