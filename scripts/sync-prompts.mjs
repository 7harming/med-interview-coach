import { readFileSync, writeFileSync } from "node:fs";

const names = ["interviewer", "coach", "transcribe"];
const body = names
  .map((name) => {
    const text = readFileSync(new URL(`../prompts/${name}.md`, import.meta.url), "utf8");
    return `export const ${name} = ${JSON.stringify(text)};`;
  })
  .join("\n\n");

writeFileSync(new URL("../functions/_lib/prompt-texts.js", import.meta.url), `${body}\n`);
