/**
 * A small JavaScript scanner that finds module specifiers: static imports,
 * re-exports, side-effect imports and `import("literal")`. It understands
 * comments, strings, template literals (with nesting) and regex literals well
 * enough for compiler output and hand-written ES modules.
 *
 * @module
 */

export interface SpecifierRef {
  /** The specifier text (without quotes). */
  value: string;
  /** Offsets of the string literal's contents (inside the quotes). */
  start: number;
  end: number;
  kind: "static" | "dynamic";
}

const ID = /[A-Za-z0-9_$\u0080-￿]/;
// After these tokens a `/` starts a regex, not a division.
const REGEX_AFTER_KEYWORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await",
]);

/** Finds every module specifier in `src`. */
export function scanSpecifiers(src: string): SpecifierRef[] {
  const out: SpecifierRef[] = [];
  const n = src.length;
  let i = 0;
  // Last significant token: "id:<word>", "punct:<ch>", "str", "num", "regex", "tpl"
  let last = "punct:;";
  // Token history for import/export detection.
  let stmtImport = false; // inside `import … from` / `export … from` statement
  let lastWord = "";
  let prevWord = "";
  const braceStack: number[] = []; // template nesting: depth markers
  let depth = 0;
  // import("literal") tracking: the paren depth of the call, and the literal seen so far
  let dynamicPending = -1;
  let dynamicCandidate: { value: string; start: number; end: number } | null = null;

  const regexAllowed = () => {
    if (last.startsWith("punct:")) {
      const p = last.slice(6);
      return p !== ")" && p !== "]" && p !== "}";
    }
    if (last.startsWith("id:")) return REGEX_AFTER_KEYWORDS.has(last.slice(3));
    return false;
  };

  function readString(q: string): number {
    let j = i + 1;
    while (j < n) {
      const c = src[j];
      if (c === "\\") j += 2;
      else if (c === q) return j;
      else if (c === "\n" && q !== "`") return j;
      else j++;
    }
    return n;
  }

  function readTemplate(from: number): number {
    // returns index of closing backtick, or of "${" start (then pushes nesting)
    let j = from;
    while (j < n) {
      const c = src[j];
      if (c === "\\") j += 2;
      else if (c === "`") return j;
      else if (c === "$" && src[j + 1] === "{") return j;
      else j++;
    }
    return n;
  }

  while (i < n) {
    const c = src[i];
    // whitespace
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v" || c === " " || c === "﻿") {
      i++;
      continue;
    }
    // comments
    if (c === "/" && src[i + 1] === "/") {
      const e = src.indexOf("\n", i);
      i = e < 0 ? n : e;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const e = src.indexOf("*/", i + 2);
      i = e < 0 ? n : e + 2;
      continue;
    }
    // strings
    if (c === '"' || c === "'") {
      const e = readString(c);
      const value = src.slice(i + 1, e);
      if (lastWord === "import" && last === "id:import" && prevWord !== ".") {
        out.push({ value, start: i + 1, end: e, kind: "static" }); // import "x"
        stmtImport = false;
      } else if (last === "id:from" && stmtImport) {
        out.push({ value, start: i + 1, end: e, kind: "static" });
        stmtImport = false;
      } else if (last === "punct:(" && dynamicPending === depth) {
        dynamicCandidate = { value, start: i + 1, end: e };
      }
      i = e + 1;
      last = "str";
      continue;
    }
    // template literals
    if (c === "`") {
      const e = readTemplate(i + 1);
      if (src[e] === "$") {
        braceStack.push(depth);
        depth++;
        i = e + 2;
        last = "punct:(";
      } else {
        i = e + 1;
        last = "tpl";
      }
      continue;
    }
    if (c === "}" && braceStack.length && braceStack[braceStack.length - 1] === depth - 1) {
      // end of ${…}: continue the template
      braceStack.pop();
      depth--;
      const e = readTemplate(i + 1);
      if (src[e] === "$") {
        braceStack.push(depth);
        depth++;
        i = e + 2;
        last = "punct:(";
      } else {
        i = e + 1;
        last = "tpl";
      }
      continue;
    }
    // regex literal
    if (c === "/" && regexAllowed()) {
      let j = i + 1;
      let inClass = false;
      while (j < n) {
        const d = src[j];
        if (d === "\\") j += 2;
        else if (d === "\n") break;
        else if (inClass) {
          if (d === "]") inClass = false;
          j++;
        } else if (d === "[") {
          inClass = true;
          j++;
        } else if (d === "/") break;
        else j++;
      }
      j++;
      while (j < n && ID.test(src[j])) j++;
      i = j;
      last = "regex";
      continue;
    }
    // identifiers / keywords
    if (ID.test(c) && !(c >= "0" && c <= "9")) {
      let j = i + 1;
      while (j < n && ID.test(src[j])) j++;
      const word = src.slice(i, j);
      const afterDot = last === "punct:.";
      if (!afterDot) {
        if ((word === "import" || word === "export") && (last.startsWith("punct:") || last.startsWith("id:") || last === "str" || last === "num" || last === "tpl" || last === "regex")) {
          // `import(` is dynamic; `import.meta` is not a statement
          let k = j;
          while (k < n && /\s/.test(src[k])) k++;
          if (word === "import" && src[k] === "(") {
            dynamicPending = depth + 1;
          } else if (word === "import" && src[k] === ".") {
            // import.meta
          } else {
            stmtImport = true;
          }
        }
      }
      prevWord = afterDot ? "." : lastWord;
      lastWord = word;
      last = `id:${word}`;
      i = j;
      continue;
    }
    // numbers
    if (c >= "0" && c <= "9") {
      let j = i + 1;
      while (j < n && /[0-9A-Za-z_.]/.test(src[j])) j++;
      i = j;
      last = "num";
      continue;
    }
    // punctuation
    if (c === "(" || c === "[" || c === "{") depth++;
    if (c === ")" || c === "]" || c === "}") {
      if (c === ")" && dynamicPending === depth && dynamicCandidate) {
        out.push({ ...dynamicCandidate, kind: "dynamic" });
      }
      if (c === ")" && dynamicPending === depth) {
        dynamicPending = -1;
        dynamicCandidate = null;
      }
      depth = Math.max(0, depth - 1);
    }
    if (c === ";") stmtImport = false;
    if (c !== "(" && dynamicCandidate && last === "str") {
      // anything other than `)` after the string means it is not a plain literal call
      if (c !== ")") dynamicCandidate = null;
    }
    last = `punct:${c}`;
    lastWord = "";
    i++;
  }
  return out;
}

/** Replaces specifiers using `map` (return undefined to keep one). */
export function rewriteSpecifiers(src: string, refs: SpecifierRef[], map: (ref: SpecifierRef) => string | undefined): string {
  let out = "";
  let pos = 0;
  for (const r of [...refs].sort((a, b) => a.start - b.start)) {
    const next = map(r);
    if (next === undefined) continue;
    out += src.slice(pos, r.start) + next.replace(/["'\\\n]/g, (c) => "\\" + (c === "\n" ? "n" : c));
    pos = r.end;
  }
  return out + src.slice(pos);
}
