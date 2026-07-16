#!/usr/bin/env node
import {readFile,writeFile} from "node:fs/promises";import {extname,resolve} from "node:path";import {planStudentImport} from "../lib/chateau-rules.mjs";
const args=process.argv.slice(2),file=args.find(x=>!x.startsWith("--")),dryRun=!args.includes("--apply"),reportPath=resolve(args.find(x=>x.startsWith("--report="))?.slice(9)||"student-import-report.json");
if(!file){console.error("Usage: pnpm migration:students <students.csv|students.json> [--apply] [--report=path]");process.exit(2)}
const text=await readFile(resolve(file),"utf8");let rows;
if(extname(file).toLowerCase()===".json")rows=JSON.parse(text);else{const lines=text.replace(/^\uFEFF/,"").split(/\r?\n/).filter(Boolean),headers=lines.shift().split(",").map(x=>x.trim());rows=lines.map(line=>{const cells=line.match(/(?:^|,)("(?:[^"]|"")*"|[^,]*)/g).map(x=>x.replace(/^,/,"").replace(/^"|"$/g,"").replace(/""/g,'"'));return Object.fromEntries(headers.map((h,i)=>[h,cells[i]??""]))})}
if(!Array.isArray(rows))throw new Error("The import root must be an array.");const report={mode:dryRun?"dry-run":"validated-for-apply",created_at:new Date().toISOString(),...planStudentImport(rows)};await writeFile(reportPath,JSON.stringify(report,null,2));console.log(JSON.stringify({mode:report.mode,total:report.total,valid:report.valid,failed:report.failed,report:reportPath},null,2));
if(!dryRun){console.error("Validated only: database application requires a configured staging D1 binding and is intentionally blocked in this local tool.");process.exit(3)}if(report.failed)process.exitCode=1;
