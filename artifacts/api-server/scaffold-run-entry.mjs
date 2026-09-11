import { writeScaffoldWorkspace, readCorpusComponent, listCorpusComponents } from "./src/lib/scaffold-engine";
const wsId = "_scaffold_verify_6_4c";
const r = await writeScaffoldWorkspace(wsId, "vite-react", "scaffold-verify");
console.log(JSON.stringify(r, null, 2));
const names = await listCorpusComponents();
console.log("corpus:", names.length, "components");
const btn = await readCorpusComponent("button");
console.log("button content length:", btn ? btn.length : "MISSING");
process.exit(0);
