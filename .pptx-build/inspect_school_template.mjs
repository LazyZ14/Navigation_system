import { FileBlob, PresentationFile } from "@oai/artifact-tool";
const source = "/Users/lazyz14/资料/PolyU/STF/case2第四阶段汇报.pptx";
const p = await PresentationFile.importPptx(await FileBlob.load(source));
console.log((await p.inspect({ kind: "slide,textbox,shape,image,layout,notes", include: "id,slide,name,text,textPreview,bbox,isPlaceholder,alt", maxChars: 30000 })).ndjson);
