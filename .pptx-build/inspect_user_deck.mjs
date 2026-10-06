import { FileBlob, PresentationFile } from "@oai/artifact-tool";
const source = "/Users/lazyz14/Projects/Navigation_system/artifacts/offline-navigation-mvp-report-2026-09-28-v2.pptx";
const presentation = await PresentationFile.importPptx(await FileBlob.load(source));
const snapshot = await presentation.inspect({
  kind: "slide,textbox,shape,image,notes,layout",
  include: "id,slide,name,text,textPreview,textLines,bbox,alt",
  maxChars: 30000,
});
console.log(snapshot.ndjson);
