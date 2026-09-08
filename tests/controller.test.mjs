import assert from "node:assert/strict";
import test from "node:test";
import { createController, loadStoredState } from "../js/app.mjs";
import { createBackupExport, createInitialState } from "../js/core.mjs";
import { validateViewModel } from "../js/view.mjs";

const shared = {
  schema_version: 1,
  type: "restaurants",
  restaurants: [
    { id: "a", name: "甲店", scope: "primary", location: "LG", source_urls: ["https://maps.apple.com/?q=a", "https://example.com/a"] },
    { id: "b", name: "乙店", scope: "primary", location: "LG" }
  ]
};
const v2Key = "lunch-picker.state.v2";
const v1Key = "lunch-picker.state.v1";
function memoryStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    fail: false,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) {
      if (this.fail) throw new Error("storage full");
      values.set(key, value);
    }
  };
}
function controller(state = createInitialState(), storage = memoryStorage(), document = shared) {
  return createController(document, state, { storage, today: () => "2026-09-07", random: () => 0 });
}
function legacyState() {
  return {
    schema_version: 1,
    settings: createInitialState().settings,
    restaurants: [{ ...shared.restaurants[0], id: "kfc", cuisine: "快餐", price_per_person: 30, walking_minutes: null, map_query: "kfc" }],
    history: [{ date: "2026-09-04", status: "skipped" }]
  };
}

test("迁移写入成功保留 v1 原字节，缺省跳过原因可正常展示", () => {
  const legacy = JSON.stringify(legacyState());
  const storage = memoryStorage({ [v1Key]: legacy });
  const migrated = loadStoredState(shared, storage);
  assert.equal(storage.getItem(v1Key), legacy);
  assert.deepEqual(JSON.parse(storage.getItem(v2Key)), migrated);
  assert.deepEqual(migrated.history, legacyState().history);
  validateViewModel(controller(migrated).getViewModel());
});

test("无效迁移及迁移写入失败均保留旧状态，不生成空数据", () => {
  for (const raw of ["{", JSON.stringify(legacyState())]) {
    const storage = memoryStorage({ [v1Key]: raw });
    storage.fail = true;
    assert.throws(() => loadStoredState(shared, storage), /迁移失败|无法写入/);
    assert.equal(storage.getItem(v1Key), raw);
    assert.equal(storage.getItem(v2Key), null);
  }
});

test("抽取直到耗尽不重复，确认覆盖前不写入，确认后每日只保留一条", () => {
  const storage = memoryStorage();
  const app = controller(undefined, storage);
  const first = app.dispatch({ type: "draw", startNewSession: true });
  const second = app.dispatch({ type: "draw", startNewSession: false });
  assert.notEqual(first.viewModel.currentRestaurant.id, second.viewModel.currentRestaurant.id);
  assert.equal(app.dispatch({ type: "draw", startNewSession: false }).status, "exhausted");
  assert.equal(storage.getItem(v2Key), null);
  app.dispatch({ type: "draw", startNewSession: true });
  app.dispatch({ type: "confirmRestaurant", confirmed: false });
  const before = storage.getItem(v2Key);
  app.dispatch({ type: "draw", startNewSession: true });
  app.dispatch({ type: "draw", startNewSession: false });
  assert.equal(app.dispatch({ type: "confirmRestaurant", confirmed: false }).status, "confirmation_required");
  assert.equal(storage.getItem(v2Key), before);
  app.dispatch({ type: "confirmRestaurant", confirmed: true });
  assert.equal(app.getViewModel().history.length, 1);
  assert.equal(app.getViewModel().history[0].restaurantId, "b");
});

test("备份校验或写入失败时内存和磁盘不变，成功后仍使用最新共享目录", () => {
  const initial = createInitialState();
  const storage = memoryStorage({ [v2Key]: JSON.stringify(initial) });
  const app = controller(initial, storage);
  const before = app.getViewModel();
  const backup = createBackupExport({ ...initial, pending_restaurant_names: ["线索"], hidden_shared_restaurant_ids: ["a"] });
  const collision = { ...backup, personal_restaurants: [shared.restaurants[0]] };
  assert.throws(() => app.dispatch({ type: "previewBackup", document: collision }), /冲突/);
  storage.fail = true;
  assert.throws(() => app.dispatch({ type: "importBackup", document: backup }), /storage full/);
  assert.deepEqual(app.getViewModel(), before);
  assert.equal(storage.getItem(v2Key), JSON.stringify(initial));
  storage.fail = false;
  app.dispatch({ type: "importBackup", document: backup });
  const updated = { ...shared, restaurants: [...shared.restaurants, { id: "c", name: "丙店", scope: "primary", location: "LG" }] };
  const reloaded = controller(loadStoredState(updated, storage), storage, updated);
  assert.deepEqual(reloaded.getViewModel().restaurants.map((r) => r.id), ["b", "c"]);
  assert.deepEqual(reloaded.dispatch({ type: "exportBackup" }).pending_restaurant_names, ["线索"]);
});

test("忌口与来源只改变展示，不影响抽取；地图来源不出现在 view model", () => {
  const normal = controller();
  const dietary = controller({ ...createInitialState(), dietary_preferences: { avoid_pork: true } });
  assert.deepEqual(normal.getViewModel().restaurants[0].sourceUrls, ["https://example.com/a"]);
  assert.equal(normal.getViewModel().restaurants[0].dietaryNotice, null);
  assert.match(dietary.getViewModel().restaurants[0].dietaryNotice, /尚未核实/);
  assert.equal(normal.dispatch({ type: "draw", startNewSession: true }).viewModel.currentRestaurant.id,
    dietary.dispatch({ type: "draw", startNewSession: true }).viewModel.currentRestaurant.id);
});

test("手工记录拒绝未来日期，且无效 intent 无法写入", () => {
  const app = controller();
  assert.throws(() => app.dispatch({ type: "saveRecord", originalDate: null, date: "2026-09-08", status: "restaurant", restaurantId: "a", restaurantName: "甲店", source: "manual", reason: "other", confirmed: false }), /今天或过去/);
  assert.throws(() => app.dispatch({ type: "changeScope", scope: "invalid" }), /scope 无效/);
  assert.equal(app.getViewModel().history.length, 0);
});
