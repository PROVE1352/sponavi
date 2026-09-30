import { markdownToHwpx, renderHwpxToSvg, markdownToPdf, parse } from "kordoc";
import { readFileSync, writeFileSync } from "node:fs";
const md = readFileSync("./SUBMISSION_2026-10.md", "utf-8");
const opts = { theme: { tableHeaderBold: true }, page: { size: "A4", footer: "스포내비(SpoNavi) — 2026 국민체육진흥공단 공공데이터 활용 경진대회 서비스 개발 부문" } };
const hwpx = await markdownToHwpx(md, opts);
const out = "/Users/kyuchan/Desktop/[제출서류]서비스 개발 부문_스포내비_v1.hwpx";
writeFileSync(out, Buffer.from(hwpx)); console.log("hwpx bytes", hwpx.byteLength);
const r = await renderHwpxToSvg(Buffer.from(hwpx), { reflow: true });
console.log("pageCount", r.pageCount, "stats", JSON.stringify(r.stats), "warnings", (r.warnings||[]).slice(0,5));
writeFileSync("./preview.svg", r.svg);
try { const pdf = await markdownToPdf(md, opts); writeFileSync("./preview.pdf", Buffer.from(pdf)); console.log("pdf bytes", pdf.byteLength); } catch (e) { console.log("pdf failed:", e.message.slice(0,200)); }
const back = await parse(Buffer.from(hwpx)); console.log("reparse ok", back.success, "blocks", back.blocks?.length, "pages", back.metadata?.pageCount);
