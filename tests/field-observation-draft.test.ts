import assert from "node:assert/strict";
import test from "node:test";
import { createFieldPhotoDraftLifecycle, parseFieldDraftCoordinates } from "../app/lib/field-observation-draft.js";

test("field drafts require both coordinate fields while retaining explicit zero coordinates", () => {
  for (const [longitude, latitude] of [["", ""], [" ", "20"], ["110", "\t"], ["", "0"], ["0", ""]]) {
    assert.equal(parseFieldDraftCoordinates(longitude, latitude), null);
  }
  assert.deepEqual(parseFieldDraftCoordinates("0", "0"), { longitude: 0, latitude: 0 });
  assert.deepEqual(parseFieldDraftCoordinates(" 110.35 ", "20.09"), { longitude: 110.35, latitude: 20.09 });
  assert.deepEqual(parseFieldDraftCoordinates("-180", "-90"), { longitude: -180, latitude: -90 });
  assert.deepEqual(parseFieldDraftCoordinates("180", "90"), { longitude: 180, latitude: 90 });
  for (const [longitude, latitude] of [["NaN", "20"], ["Infinity", "20"], ["181", "0"], ["0", "-91"]]) {
    assert.equal(parseFieldDraftCoordinates(longitude, latitude), null);
  }
});

test("updating OCR metadata retains live previews; replacing or discarding photos releases only unused URLs", () => {
  const revoked: string[] = [];
  const draft = createFieldPhotoDraftLifecycle(url => revoked.push(url));
  draft.replacePreviewUrls(["blob:first", "blob:second"]);
  draft.replacePreviewUrls(["blob:first", "blob:second"]);
  assert.deepEqual(revoked, [], "an OCR metadata update must not revoke reused photo previews");
  draft.replacePreviewUrls(["blob:second", "blob:third"]);
  assert.deepEqual(revoked, ["blob:first"]);
  draft.clear();
  assert.deepEqual(revoked, ["blob:first", "blob:second", "blob:third"]);
  draft.clear();
  assert.equal(revoked.length, 3, "repeated cleanup releases each preview once");
});

test("a replacement read, cancellation, save, or unmount invalidates pending photo and CSV results", async () => {
  const draft = createFieldPhotoDraftLifecycle(() => {});
  const photoRead = draft.beginRead();
  let finishOldRead!: () => void;
  const oldResult = new Promise<void>(resolve => { finishOldRead = resolve; });
  const applied: string[] = [];
  const pending = oldResult.then(() => { if (draft.isCurrentRead(photoRead)) applied.push("old-photo"); });
  const csvRead = draft.beginRead();
  assert.equal(draft.isCurrentRead(csvRead), true);
  finishOldRead();
  await pending;
  assert.deepEqual(applied, [], "a late OCR result cannot overwrite a newer draft");
  draft.clear();
  assert.equal(draft.isCurrentRead(csvRead), false);
  const nextPhotoRead = draft.beginRead();
  assert.equal(draft.isCurrentRead(nextPhotoRead), true);
});
