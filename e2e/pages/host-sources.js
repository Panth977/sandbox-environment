// The same small app written three ways (plain JS, React JSX, Svelte 5), for the host e2e pages.
// Kept in step with examples/angular15/src/app/artifacts.ts.
export const SOURCES = {
  js: {
    "/index.js": `import { host } from "@panth977/sandbox/artifact";
const root = document.getElementById("root");
const user = await host.user();
root.innerHTML = '<p id="who"></p><button class="sbx-btn" id="add">Add</button> <span id="count">0</span>';
root.querySelector("#who").textContent = "JS sees " + user.name;
root.querySelector("#add").onclick = async () => {
  root.querySelector("#count").textContent = String(await host.counter.add(1));
};
`,
  },
  react: {
    "/manifest.json": JSON.stringify({ name: "React", dependencies: { react: "19", "react-dom": "19" } }),
    "/index.jsx": `import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { host } from "@panth977/sandbox/artifact";

function App() {
  const [name, setName] = useState("…");
  const [count, setCount] = useState(0);
  useEffect(() => { host.user().then((u) => setName(u.name)); }, []);
  return (
    <p>
      <span id="who">React sees {name}</span>{" "}
      <button className="sbx-btn" id="add" onClick={async () => setCount(await host.counter.add(1))}>Add</button>{" "}
      <span id="count">{count}</span>
    </p>
  );
}
createRoot(document.getElementById("root")).render(<App />);
`,
  },
  svelte: {
    "/manifest.json": JSON.stringify({ name: "Svelte", dependencies: { svelte: "5" } }),
    "/index.js": `import { mount } from "svelte";
import App from "./App.svelte";
mount(App, { target: document.getElementById("root") });
`,
    "/App.svelte": `<script>
  import { host } from "@panth977/sandbox/artifact";
  let name = $state("…");
  let count = $state(0);
  host.user().then((u) => (name = u.name));
</script>
<p><span id="who">Svelte sees {name}</span>
  <button class="sbx-btn" id="add" onclick={async () => (count = await host.counter.add(1))}>Add</button>
  <span id="count">{count}</span></p>
`,
  },
};
