import assert from "node:assert/strict";
import test from "node:test";
import { discardLocalCsvSplit, readLocalCsvSplitPart, splitLocalCsv, type LocalSplitDirectory } from "../app/lib/pasc-local-csv-split";
import { PASC_LOCAL_MAX_ANALYSIS_ROWS, PASC_LOCAL_MAX_CSV_RECORD_BYTES, PASC_LOCAL_SPLIT_REQUIRED_BYTES } from "../app/lib/pasc-local-limits";
import { streamAndPreprocessLocalCsvBatches, type PascLocalSettings } from "../app/lib/pasc-local-preprocess";

function localDisk(failOnName = "") {
  const files = new Map<string, Uint8Array<ArrayBuffer>>(), folders = new Set<string>([""]), removed: string[] = [];
  let aborts = 0;
  const missing = () => new DOMException("missing", "NotFoundError");
  const directory = (base: string): LocalSplitDirectory => ({
    async getDirectoryHandle(name, options) {
      const full = base + name + "/";
      if (!folders.has(full) && !options?.create) throw missing();
      folders.add(full); return directory(full);
    },
    async getFileHandle(name, options) {
      const full = base + name;
      if (!files.has(full)) { if (!options?.create) throw missing(); files.set(full, new Uint8Array()); }
      return {
        async getFile() { return new File([files.get(full)!], name, { type: "text/csv" }); },
        async createWritable() {
          const pieces: Uint8Array<ArrayBuffer>[] = [];
          return {
            async write(value) {
              if (name === failOnName) throw new DOMException("fixture disk full", "QuotaExceededError");
              pieces.push(typeof value === "string" ? new TextEncoder().encode(value) : value.slice());
            },
            async close() {
              const combined = new Uint8Array(pieces.reduce((sum, item) => sum + item.length, 0)); let offset = 0;
              for (const piece of pieces) { combined.set(piece, offset); offset += piece.length; }
              files.set(full, combined);
            },
            async abort() { aborts += 1; },
          };
        },
      };
    },
    async removeEntry(name) {
      const full = base + name; removed.push(full);
      if (files.delete(full)) return;
      if (!folders.has(full + "/")) throw missing();
      if ([...files.keys()].some(path => path.startsWith(full + "/"))) throw new DOMException("not empty", "InvalidModificationError");
      folders.delete(full + "/");
    },
  });
  files.set("other-analysis.csv", new TextEncoder().encode("protected"));
  return { files, folders, removed, root: directory(""), aborts: () => aborts };
}

test("local CSV parts preserve UTF-8, quoted multiline records, escaped quotes and header date variants across byte boundaries", async () => {
  const disk = localDisk(), header = '\uFEFF"id",x,y,D_20240101,20240113,Date_2024/1/25\r\n';
  const rows = ['"坡体, ""一号""",110,20,1,2,3\r\n', '"跨\r\n行",111,21,4,5,6\r', '末行,112,22,7,8,9'];
  const source = new File([header, ...rows], "own.csv");
  source.text = async () => { throw new Error("never read the whole source"); };
  const split = await splitLocalCsv(source, { rootProvider: async () => disk.root, maxPartRows: 1, maxPartBytes: 1024, chunkBytes: 1 });
  assert.equal(split.partCount, 3); assert.equal(split.rowCount, 3);
  assert.equal("parts" in split, false, "metadata must not grow with every part");
  for (let index = 1; index <= split.partCount; index += 1) {
    const part = await readLocalCsvSplitPart(split, index, async () => disk.root);
    assert.deepEqual(new Uint8Array(await part.arrayBuffer()), new TextEncoder().encode(header + rows[index - 1]));
  }
  assert.equal(JSON.parse(new TextDecoder().decode(disk.files.get(split.directory + "/manifest.json"))).sourceBytes, source.size);
  await assert.rejects(readLocalCsvSplitPart(split, 0, async () => disk.root), /编号无效/);
  await discardLocalCsvSplit(split, async () => disk.root);
  assert.deepEqual([...disk.files.keys()], ["other-analysis.csv"]);
  assert.deepEqual([...disk.folders], [""]);
  assert.ok(disk.removed.every(path => path !== "other-analysis.csv"));
});

test("byte budgets rotate only at complete rows and repeat the original header", async () => {
  const disk = localDisk(), header = "id,x\n", rows = Array.from({ length: 7 }, (_, index) => `p${index},1\n`);
  const split = await splitLocalCsv(new File([header, ...rows], "many.csv"), { rootProvider: async () => disk.root, maxPartRows: 100, maxPartBytes: header.length + rows[0].length * 2, chunkBytes: 3 });
  assert.equal(split.partCount, 4);
  let data = "";
  for (let index = 1; index <= split.partCount; index += 1) {
    const file = await readLocalCsvSplitPart(split, index, async () => disk.root);
    assert.ok(file.size <= split.maxPartBytes);
    const text = await file.text(); assert.ok(text.startsWith(header)); data += text.slice(header.length);
  }
  assert.equal(data, rows.join(""));
});

test("a source advertised above 1 GiB is read in bounded chunks and cancellation removes only the current job", async () => {
  const disk = localDisk(), controller = new AbortController(), reads: number[] = [];
  const source = {
    name: "over-one-gib.csv", size: PASC_LOCAL_SPLIT_REQUIRED_BYTES + 17,
    slice(start: number, end: number) {
      reads.push(end - start);
      assert.ok(end - start <= 1024);
      const bytes = new TextEncoder().encode("1,2\n".repeat((end - start) / 4));
      if (!start) bytes.set(new TextEncoder().encode("a,b\n"));
      return new Blob([bytes]);
    },
  } as unknown as File;
  await assert.rejects(splitLocalCsv(source, { rootProvider: async () => disk.root, chunkBytes: 1024, signal: controller.signal, onProgress: () => controller.abort() }), { name: "AbortError" });
  assert.deepEqual(reads, [1024]);
  assert.deepEqual([...disk.files.keys()], ["other-analysis.csv"]);
  assert.deepEqual([...disk.folders], [""]);
});

test("malformed CSV, disk failures and oversized records clean partial files and preserve unrelated jobs", async () => {
  for (const [source, failure] of [[new File(['id,x\n"unclosed,1'], "bad.csv"), ""], [new File(["id,x\np1,1\n"], "full.csv"), "manifest.json"], [new File(["x".repeat(PASC_LOCAL_MAX_CSV_RECORD_BYTES + 1)], "long.csv"), ""]] as const) {
    const disk = localDisk(failure);
    await assert.rejects(splitLocalCsv(source, { rootProvider: async () => disk.root, chunkBytes: 64 * 1024 }));
    assert.deepEqual([...disk.files.keys()], ["other-analysis.csv"]);
    assert.deepEqual([...disk.folders], [""]);
  }
  const disk = localDisk();
  await assert.rejects(discardLocalCsvSplit({ directory: "../outside", partCount: 1 } as Parameters<typeof discardLocalCsvSplit>[0], async () => disk.root), /目录无效/);
  assert.equal(disk.removed.length, 0);
});

const settings: PascLocalSettings = { displacementUnit: "mm", velocityUnit: "mm/year", signConvention: "subsidence_negative", preprocessingState: "already_smoothed" };
test("preprocessing bounds the global ID registry even when all source coordinates are invalid", async () => {
  const dates = Array.from({ length: 20 }, (_, index) => new Date(Date.UTC(2024, 0, 1 + index * 12)).toISOString().slice(0, 10));
  const text = ["id,lon,lat," + dates.join(","), ...Array.from({ length: PASC_LOCAL_MAX_ANALYSIS_ROWS + 1 }, (_, index) => `p${index},NaN,20,` + dates.map(() => "").join(","))].join("\n");
  await assert.rejects(streamAndPreprocessLocalCsvBatches(new File([text], "invalid-rows.csv"), settings, 256, async () => { throw new Error("invalid rows must not reach inference"); }, () => {}, () => false), /单片超过 100,000 行/);
});

test("preprocessing refuses a time-axis batch that would exceed its memory budget before allocating the matrix", async () => {
  const dates = Array.from({ length: 11_000 }, (_, index) => new Date(Date.UTC(1990, 0, 1 + index)).toISOString().slice(0, 10));
  const source = new File([["id", "lon", "lat", ...dates].join(",") + "\np1,110,20," + dates.map(() => "1").join(",")], "wide.csv");
  await assert.rejects(streamAndPreprocessLocalCsvBatches(source, settings, 1024, async () => {}, () => {}, () => false), /日期维度与批量超过本机内存预算/);
});
