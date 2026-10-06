import { FileBlob, PresentationFile } from "@oai/artifact-tool";
const p = await PresentationFile.importPptx(await FileBlob.load("/Users/lazyz14/Projects/Navigation_system/artifacts/offline-navigation-mvp-report-2026-09-28-v2.pptx"));
for (const id of ["sh/sna103ap", "sh/oryp8fah", "sh/sjix0zy1", "sh/ofq5svm5", "sh/kzu5c32t"]) {
  const shape = p.resolve(id);
  console.log(id, JSON.stringify(shape.text.style));
}
