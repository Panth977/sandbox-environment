import { test } from "node:test";
import assert from "node:assert/strict";
import { rewriteSpecifiers, scanSpecifiers } from "../src/compiler/lexer.ts";

const specs = (src: string) => scanSpecifiers(src).map((r) => `${r.kind}:${r.value}`);

test("static, side-effect, re-export, dynamic", () => {
  const src = `
import React, { useState } from "react";
import * as ns from './ns.js'
import "./side.css";
import {
  a,
  b,
} from "../multi.ts";
export { x } from "./x";
export * from "./all";
const lazy = () => import("./lazy.tsx");
const notLiteral = import("./a" + name);
`;
  assert.deepEqual(specs(src), [
    "static:react", "static:./ns.js", "static:./side.css", "static:../multi.ts", "static:./x", "static:./all", "dynamic:./lazy.tsx",
  ]);
});

test("ignores strings, comments, templates, regex and import.meta", () => {
  const src = `
// import x from "nope1";
/* import y from "nope2" */
const s = "import z from 'nope3'";
const t = \`import q from "nope4" \${ "x" + \`inner \${1}\` } done\`;
const r = /import a from "nope5"/g;
const u = import.meta.url;
const o = { from: "nope6" };
const from = "nope7";
let d = 4 / 2; const e = "keep";
import k from "yes";
`;
  assert.deepEqual(specs(src), ["static:yes"]);
});

test("rewrite keeps everything else", () => {
  const src = `import a from "./a.ts";\nimport("./b");\nconst x = "./a.ts";`;
  const out = rewriteSpecifiers(src, scanSpecifiers(src), (r) => (r.value.startsWith(".") ? "sbx:/" + r.value.slice(2) : undefined));
  assert.equal(out, `import a from "sbx:/a.ts";\nimport("sbx:/b");\nconst x = "./a.ts";`);
});

test("export const is not a re-export", () => {
  assert.deepEqual(specs(`export const a = "x";\nexport default function f() { return "y" }`), []);
});
